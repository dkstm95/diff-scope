#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { chmod, lstat, mkdtemp, open, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { TextDecoder } from "node:util";
import { promisify } from "node:util";

import {
  IntentValidationError,
  MAX_INTENT_BYTES,
  calculateIntentFingerprint,
  collectIntentIssues,
} from "./lib/validate-intent.mjs";

export const MAX_DRAFT_BYTES = MAX_INTENT_BYTES;

const DRAFT_KEYS = [
  "schemaVersion",
  "goal",
  "outcomes",
  "constraints",
  "decisions",
  "nonGoals",
  "scenarios",
];
const GIT_PREFIX = ["--no-pager", "--literal-pathspecs", "-c", "core.fsmonitor=false"];
const execFileAsync = promisify(execFile);
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export class IntentDraftValidationError extends IntentValidationError {
  constructor(issues) {
    super(issues);
    this.name = "IntentDraftValidationError";
    this.message = `Intent draft validation failed:\n- ${issues.join("\n- ")}`;
  }
}

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function usage() {
  return `Usage:
  node finalize-intent.mjs --input <draft.json> --root <repo-root>

Options:
  --input  Approved intent draft JSON without baseline or fingerprint.
  --root   Target Git repository. Its working tree must be clean.
  --help   Show this help message.
`;
}

export function parseFinalizeArguments(argumentsList) {
  const parsed = { input: undefined, root: undefined, help: false };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--help" || argument === "-h") {
      parsed.help = true;
      continue;
    }
    if (!["--input", "--root"].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argumentsList[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${argument} requires a path`);
    }
    const key = argument.slice(2);
    if (parsed[key] !== undefined) {
      throw new Error(`${argument} may be provided only once`);
    }
    parsed[key] = value;
    index += 1;
  }

  if (!parsed.help && parsed.input === undefined) {
    throw new Error("--input is required");
  }
  if (!parsed.help && parsed.root === undefined) {
    throw new Error("--root is required");
  }
  return parsed;
}

export function isPathInside(candidatePath, parentPath) {
  const relative = path.relative(parentPath, candidatePath);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function assertPrivateDraftPermissions(status) {
  if (process.platform !== "win32" && (status.mode & 0o077) !== 0) {
    throw new Error("Intent draft must not grant any group or other permissions.");
  }
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameFileSnapshot(left, right) {
  return (
    sameFile(left, right) &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

export async function loadIntentDraft(inputPath, { repositoryRoot } = {}) {
  const inputStatus = await lstat(inputPath);
  if (!inputStatus.isFile()) {
    throw new Error(`Intent draft is not a regular file: ${inputPath}`);
  }
  if (inputStatus.size > MAX_DRAFT_BYTES) {
    throw new Error(`Intent draft exceeds the ${MAX_DRAFT_BYTES}-byte limit`);
  }
  assertPrivateDraftPermissions(inputStatus);

  const inputRealPath = await realpath(inputPath);
  const repositoryRealPath =
    repositoryRoot === undefined ? undefined : await resolveRepositoryRoot(repositoryRoot);
  if (
    repositoryRealPath !== undefined &&
    isPathInside(inputRealPath, repositoryRealPath)
  ) {
    throw new Error("Intent draft real path must be outside the target repository.");
  }

  const noFollowFlag = fsConstants.O_NOFOLLOW ?? 0;
  let handle;
  try {
    handle = await open(inputPath, fsConstants.O_RDONLY | noFollowFlag);
  } catch (error) {
    if (error.code === "ELOOP") {
      throw new Error("Intent draft must not be a symbolic link.", { cause: error });
    }
    throw error;
  }
  let bytes;
  try {
    const openedStatus = await handle.stat();
    if (!openedStatus.isFile()) {
      throw new Error(`Intent draft is not a regular file: ${inputPath}`);
    }
    if (!sameFileSnapshot(inputStatus, openedStatus)) {
      throw new Error("Intent draft changed while it was being opened.");
    }
    assertPrivateDraftPermissions(openedStatus);
    if (openedStatus.size > MAX_DRAFT_BYTES) {
      throw new Error(`Intent draft exceeds the ${MAX_DRAFT_BYTES}-byte limit`);
    }
    bytes = await handle.readFile();
    const finalStatus = await handle.stat();
    if (!sameFileSnapshot(openedStatus, finalStatus)) {
      throw new Error("Intent draft changed while it was being read.");
    }
    assertPrivateDraftPermissions(finalStatus);
    if (finalStatus.size > MAX_DRAFT_BYTES || finalStatus.size !== bytes.length) {
      throw new Error("Intent draft changed size while it was being read.");
    }
  } finally {
    await handle.close();
  }
  const finalRealPath = await realpath(inputPath);
  if (finalRealPath !== inputRealPath) {
    throw new Error("Intent draft path changed while it was being read.");
  }
  if (
    repositoryRealPath !== undefined &&
    isPathInside(finalRealPath, repositoryRealPath)
  ) {
    throw new Error("Intent draft real path must be outside the target repository.");
  }
  if (bytes.length > MAX_DRAFT_BYTES) {
    throw new Error(`Intent draft exceeds the ${MAX_DRAFT_BYTES}-byte limit`);
  }

  let source;
  try {
    source = utf8Decoder.decode(bytes);
  } catch (error) {
    throw new Error("Intent draft is not valid UTF-8", { cause: error });
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`Intent draft is not valid JSON: ${error.message}`, { cause: error });
  }
}

export function createGitEnvironment(environment = process.env) {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name, value]) => !name.toUpperCase().startsWith("GIT_") && value !== undefined,
    ),
  );
}

async function runGit(root, argumentsList, { encoding = "utf8" } = {}) {
  try {
    return await execFileAsync("git", [...GIT_PREFIX, ...argumentsList], {
      cwd: root,
      encoding,
      env: createGitEnvironment(),
      maxBuffer: 4 * 1024 * 1024,
      shell: false,
      timeout: 10_000,
    });
  } catch (error) {
    const diagnostic = String(error.stderr ?? error.message ?? "Git failed")
      .replaceAll("\0", "")
      .replaceAll(root, "<repo>")
      .trim()
      .slice(0, 1_000);
    throw new Error(`Unable to inspect the target Git repository: ${diagnostic}`, { cause: error });
  }
}

function hasHiddenIndexFlags(output) {
  if (!Buffer.isBuffer(output)) {
    return true;
  }

  let offset = 0;
  while (offset < output.length) {
    const end = output.indexOf(0, offset);
    if (end < 0 || end - offset < 2 || output[offset + 1] !== 0x20) {
      return true;
    }
    const tag = output[offset];
    if (tag === 0x53 || (tag >= 0x61 && tag <= 0x7a)) {
      return true;
    }
    offset = end + 1;
  }
  return false;
}

async function assertNoHiddenIndexFlags(root) {
  const { stdout } = await runGit(root, ["ls-files", "-v", "-z"], { encoding: null });
  if (hasHiddenIndexFlags(stdout)) {
    throw new Error(
      "Hope $hope:align refuses repositories with skip-worktree or assume-unchanged index flags; clear those flags and retry.",
    );
  }
}

async function assertCleanWorkingTree(root) {
  await assertNoHiddenIndexFlags(root);
  const { stdout } = await runGit(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (stdout.length > 0) {
    throw new Error(
      "Hope $hope:align can finalize only from a clean working tree; staged, unstaged, or untracked changes were found.",
    );
  }
  await assertNoHiddenIndexFlags(root);
}

async function readHead(root) {
  const { stdout } = await runGit(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
  const head = stdout.trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(head)) {
    throw new Error("Git did not return a valid HEAD object id.");
  }
  return head;
}

export async function resolveRepositoryRoot(root) {
  const requestedRoot = await realpath(root);
  const rootStatus = await lstat(requestedRoot);
  if (!rootStatus.isDirectory()) {
    throw new Error(`Repository root is not a directory: ${root}`);
  }
  const { stdout } = await runGit(requestedRoot, ["rev-parse", "--show-toplevel"]);
  const topLevel = stdout.trim();
  if (topLevel.length === 0) {
    throw new Error("Git did not return a repository root.");
  }
  return await realpath(topLevel);
}

async function captureCleanBaselineAtRoot(resolvedRoot) {
  await assertCleanWorkingTree(resolvedRoot);
  const firstHead = await readHead(resolvedRoot);
  await assertCleanWorkingTree(resolvedRoot);
  const secondHead = await readHead(resolvedRoot);
  if (firstHead !== secondHead) {
    throw new Error("HEAD changed while Hope was finalizing the intent; run $hope:align again.");
  }
  await assertCleanWorkingTree(resolvedRoot);
  return { head: secondHead, workingTree: "clean" };
}

export async function captureCleanBaseline(root) {
  const resolvedRoot = await resolveRepositoryRoot(root);
  return await captureCleanBaselineAtRoot(resolvedRoot);
}

export function buildFinalIntent(draft, baseline) {
  if (!isRecord(draft)) {
    throw new IntentDraftValidationError(["$ must be an object"]);
  }

  const issues = [];
  for (const key of Object.keys(draft)) {
    if (!DRAFT_KEYS.includes(key)) {
      issues.push(`$.${key} is not allowed in a draft`);
    }
  }

  const intent = {
    schemaVersion: draft.schemaVersion,
    baseline,
    goal: draft.goal,
    outcomes: draft.outcomes,
    constraints: draft.constraints,
    decisions: draft.decisions,
    nonGoals: draft.nonGoals,
    scenarios: draft.scenarios,
  };
  try {
    intent.fingerprint = calculateIntentFingerprint(intent);
  } catch {
    issues.push("$ could not be fingerprinted as canonical JSON");
    intent.fingerprint = "0".repeat(64);
  }
  issues.push(...collectIntentIssues(intent));
  if (issues.length > 0) {
    throw new IntentDraftValidationError(issues);
  }
  return intent;
}

export async function writePrivateIntent(
  intent,
  { repositoryRoot, temporaryRoot = tmpdir() } = {},
) {
  if (repositoryRoot === undefined) {
    throw new TypeError("repositoryRoot is required for private intent output");
  }
  const repositoryRealPath = await resolveRepositoryRoot(repositoryRoot);
  const temporaryRealPath = await realpath(temporaryRoot);
  const temporaryStatus = await lstat(temporaryRealPath);
  if (!temporaryStatus.isDirectory()) {
    throw new Error("Intent temporary root must be a directory.");
  }
  if (isPathInside(temporaryRealPath, repositoryRealPath)) {
    throw new Error("Intent temporary root real path must be outside the target repository.");
  }

  const createdDirectory = await mkdtemp(path.join(temporaryRealPath, "hope-align-"));
  let directory = createdDirectory;
  let outputPath = path.join(directory, "intent.json");
  let handle;
  try {
    await chmod(directory, 0o700);
    directory = await realpath(directory);
    if (
      !isPathInside(directory, temporaryRealPath) ||
      isPathInside(directory, repositoryRealPath)
    ) {
      throw new Error("Intent output directory escaped its private temporary root.");
    }
    outputPath = path.join(directory, "intent.json");
    handle = await open(
      outputPath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      0o600,
    );
    await handle.writeFile(`${JSON.stringify(intent, null, 2)}\n`, "utf8");
    await handle.chmod(0o600);
    await handle.close();
    handle = undefined;
    const outputRealPath = await realpath(outputPath);
    if (
      !isPathInside(outputRealPath, directory) ||
      isPathInside(outputRealPath, repositoryRealPath)
    ) {
      throw new Error("Intent output real path escaped its private temporary directory.");
    }
    return { directory, path: outputRealPath };
  } catch (error) {
    if (handle !== undefined) {
      await handle.close().catch(() => undefined);
    }
    await rm(createdDirectory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function finalizeIntentDraft(
  draft,
  { root, temporaryRoot = tmpdir(), afterWrite } = {},
) {
  if (root === undefined) {
    throw new TypeError("root is required");
  }
  if (afterWrite !== undefined && typeof afterWrite !== "function") {
    throw new TypeError("afterWrite must be a function when provided");
  }
  const repositoryRoot = await resolveRepositoryRoot(root);
  const baseline = await captureCleanBaselineAtRoot(repositoryRoot);
  const intent = buildFinalIntent(draft, baseline);
  let output;
  try {
    output = await writePrivateIntent(intent, { repositoryRoot, temporaryRoot });
    if (afterWrite !== undefined) {
      await afterWrite({ ...output, repositoryRoot });
    }
    let finalBaseline;
    try {
      finalBaseline = await captureCleanBaselineAtRoot(repositoryRoot);
    } catch (error) {
      throw new Error(
        "The repository changed after Hope wrote the intent; the output was discarded.",
        { cause: error },
      );
    }
    if (finalBaseline.head !== baseline.head) {
      throw new Error(
        "HEAD changed after Hope wrote the intent; the output was discarded.",
      );
    }
    return { ...output, intent };
  } catch (error) {
    if (output !== undefined) {
      await rm(output.directory, { recursive: true, force: true }).catch(() => undefined);
    }
    throw error;
  }
}

export async function main(argumentsList = process.argv.slice(2)) {
  const parsed = parseFinalizeArguments(argumentsList);
  if (parsed.help) {
    process.stdout.write(usage());
    return undefined;
  }

  const repositoryRoot = await resolveRepositoryRoot(parsed.root);
  const draft = await loadIntentDraft(parsed.input, { repositoryRoot });
  const result = await finalizeIntentDraft(draft, { root: repositoryRoot });
  process.stdout.write(`${result.path}\n`);
  return result;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
