import { constants as fsConstants } from "node:fs";
import {
  chmod,
  lstat,
  open,
  readdir,
  rename,
  rm,
  rmdir,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { randomBytes, randomUUID } from "node:crypto";

import {
  currentUserId,
  fileIdentity,
  hasExactPermissions,
  ownedByCurrentUser,
  safeTemporaryRootStatus,
  sameIdentity,
} from "../shared/private-files.mjs";

const MAX_RUN_BYTES = 256 * 1024;
const RUN_DIRECTORY_PATTERN = /^hope-context-[A-Za-z0-9]{6}$/u;
const RUN_FILE_NAME = "diff-run.json";
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/u;
const RUN_STATUSES = new Set([
  "collected",
  "inspecting",
  "validated",
  "completed",
  "cancelled",
]);
const TERMINAL_RUN_STATUSES = new Set(["completed", "cancelled"]);

function runPathParts(runPath, temporaryRoot) {
  const file = resolve(runPath);
  const directory = dirname(file);
  if (
    basename(file) !== RUN_FILE_NAME ||
    dirname(directory) !== temporaryRoot ||
    !RUN_DIRECTORY_PATTERN.test(basename(directory))
  ) {
    throw new Error("Diff run must be a Hope diff-run.json file in the private temporary root.");
  }
  return { directory, file };
}

async function assertPrivateRunDirectory(directory) {
  const status = await lstat(directory);
  const unsafeMode = process.platform !== "win32" && (status.mode & 0o077) !== 0;
  if (!status.isDirectory() || status.isSymbolicLink() || unsafeMode) {
    throw new Error("Diff run directory is not private.");
  }
}

async function readBoundedJson(file) {
  const pathStatus = await lstat(file);
  const unsafeMode = process.platform !== "win32" && (pathStatus.mode & 0o077) !== 0;
  if (
    !pathStatus.isFile() ||
    pathStatus.isSymbolicLink() ||
    unsafeMode ||
    pathStatus.size > MAX_RUN_BYTES
  ) {
    throw new Error("Diff run file is not a small private file.");
  }
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const handle = await open(file, fsConstants.O_RDONLY | noFollow);
  try {
    const status = await handle.stat();
    if (!status.isFile() || status.size > MAX_RUN_BYTES) {
      throw new Error("Diff run changed while opening.");
    }
    return JSON.parse(await handle.readFile("utf8"));
  } finally {
    await handle.close();
  }
}

export function validateDiffRun(run) {
  if (
    run === null ||
    typeof run !== "object" ||
    run.schemaVersion !== 1 ||
    typeof run.id !== "string" ||
    !Number.isSafeInteger(run.revision) ||
    run.revision < 1 ||
    !RUN_STATUSES.has(run.status) ||
    typeof run.createdAt !== "string" ||
    typeof run.updatedAt !== "string" ||
    typeof run.url !== "string" ||
    !["en", "ko"].includes(run.locale) ||
    run.contextFile !== "change-request.json" ||
    run.reviewFile !== "review-model.json" ||
    !FINGERPRINT_PATTERN.test(run.fingerprint) ||
    run.snapshot === null ||
    typeof run.snapshot !== "object" ||
    !SHA_PATTERN.test(run.snapshot.baseSha) ||
    !SHA_PATTERN.test(run.snapshot.headSha) ||
    !SHA_PATTERN.test(run.snapshot.mergeBaseSha)
  ) {
    throw new Error("Diff run has an unsupported shape.");
  }
  return run;
}

export function newDiffRun(changeRequest, options = {}) {
  const now = new Date(options.nowMs ?? Date.now()).toISOString();
  return validateDiffRun({
    schemaVersion: 1,
    id: options.id ?? randomUUID(),
    revision: 1,
    status: "collected",
    createdAt: now,
    updatedAt: now,
    url: changeRequest.url,
    locale: options.locale ?? "en",
    contextFile: "change-request.json",
    reviewFile: "review-model.json",
    fingerprint: changeRequest.fingerprint,
    snapshot: {
      baseSha: changeRequest.baseSha,
      headSha: changeRequest.headSha,
      mergeBaseSha: changeRequest.mergeBaseSha,
    },
    lastInspection: null,
    result: null,
    lastError: null,
  });
}

export async function writeNewDiffRun(runPath, run, options = {}) {
  const temporaryRoot = resolve(options.temporaryRoot ?? tmpdir());
  const { directory, file } = runPathParts(runPath, temporaryRoot);
  await assertPrivateRunDirectory(directory);
  const value = validateDiffRun(run);
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.chmod(0o600);
  } finally {
    await handle.close();
  }
  return file;
}

export async function readDiffRun(runPath, options = {}) {
  const temporaryRoot = resolve(options.temporaryRoot ?? tmpdir());
  const { directory, file } = runPathParts(runPath, temporaryRoot);
  await assertPrivateRunDirectory(directory);
  return validateDiffRun(await readBoundedJson(file));
}

async function inspectTerminalDiffRunDirectory(directory, userId) {
  const directoryStatus = await lstat(directory);
  if (
    !directoryStatus.isDirectory() ||
    directoryStatus.isSymbolicLink() ||
    !ownedByCurrentUser(directoryStatus, userId) ||
    !hasExactPermissions(directoryStatus, 0o700)
  ) {
    return undefined;
  }

  const entries = await readdir(directory, { withFileTypes: true });
  if (
    entries.length !== 1 ||
    entries[0].name !== RUN_FILE_NAME ||
    !entries[0].isFile() ||
    entries[0].isSymbolicLink()
  ) {
    return undefined;
  }

  const file = join(directory, RUN_FILE_NAME);
  const fileStatus = await lstat(file);
  if (
    !fileStatus.isFile() ||
    fileStatus.isSymbolicLink() ||
    !ownedByCurrentUser(fileStatus, userId) ||
    !hasExactPermissions(fileStatus, 0o600) ||
    fileStatus.nlink !== 1
  ) {
    return undefined;
  }
  const run = validateDiffRun(await readBoundedJson(file));
  if (!TERMINAL_RUN_STATUSES.has(run.status)) return undefined;
  return { directory, directoryStatus, file, fileStatus, run };
}

export async function listTerminalDiffRuns(options = {}) {
  const temporaryRoot = resolve(options.temporaryRoot ?? tmpdir());
  const userId = options.currentUid ?? currentUserId();
  if (await safeTemporaryRootStatus(temporaryRoot, userId) === undefined) return [];

  let entries;
  try {
    entries = await readdir(temporaryRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const runs = [];
  for (const entry of entries) {
    if (!RUN_DIRECTORY_PATTERN.test(entry.name) || !entry.isDirectory()) continue;
    const directory = join(temporaryRoot, entry.name);
    try {
      const candidate = await inspectTerminalDiffRunDirectory(directory, userId);
      if (candidate === undefined) continue;
      runs.push({
        directory,
        directoryIdentity: fileIdentity(candidate.directoryStatus),
        file: candidate.file,
        fileIdentity: fileIdentity(candidate.fileStatus),
        runId: candidate.run.id,
        status: candidate.run.status,
      });
    } catch {
      // Discovery is fail-closed. Uncertain entries are not cleanup targets.
    }
  }
  return runs.sort((first, second) => first.file.localeCompare(second.file));
}

export async function removeTerminalDiffRun(target, options = {}) {
  const temporaryRoot = resolve(options.temporaryRoot ?? tmpdir());
  const userId = options.currentUid ?? currentUserId();
  if (target === null || typeof target !== "object") {
    return { status: "skipped", reason: "invalid-target" };
  }
  const directory = resolve(String(target.directory ?? ""));
  const file = resolve(String(target.file ?? ""));
  if (
    dirname(directory) !== temporaryRoot ||
    !RUN_DIRECTORY_PATTERN.test(basename(directory)) ||
    dirname(file) !== directory ||
    basename(file) !== RUN_FILE_NAME
  ) {
    return { status: "skipped", reason: "outside-managed-root" };
  }

  let current;
  try {
    current = await inspectTerminalDiffRunDirectory(directory, userId);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { status: "already-removed", reason: "missing" };
    }
    return { status: "skipped", reason: "inspection-failed" };
  }
  if (current === undefined) return { status: "skipped", reason: "not-terminal-run" };
  if (
    current.file !== file ||
    current.run.id !== target.runId ||
    current.run.status !== target.status ||
    !sameIdentity(current.directoryStatus, target.directoryIdentity) ||
    !sameIdentity(current.fileStatus, target.fileIdentity)
  ) {
    return { status: "skipped", reason: "precondition-changed" };
  }
  try {
    await unlink(file);
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "already-removed", reason: "missing" };
    return { status: "skipped", reason: "unlink-failed" };
  }
  try {
    await rmdir(directory);
    return { status: "removed", reason: null };
  } catch (error) {
    if (["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error?.code)) {
      return { status: "removed", reason: "directory-kept" };
    }
    return { status: "removed", reason: "directory-cleanup-failed" };
  }
}

async function acquireRunLock(directory) {
  const file = join(directory, "diff-run.lock");
  let handle;
  try {
    handle = await open(file, "wx", 0o600);
    await handle.writeFile(`${process.pid}\n`, "utf8");
    await handle.sync();
    await handle.chmod(0o600);
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error?.code === "EEXIST") {
      throw new Error("Another Hope command is changing this diff run.");
    }
    throw error;
  }
  return async () => {
    await handle.close();
    await unlink(file).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  };
}

export async function updateDiffRun(runPath, change, options = {}) {
  const temporaryRoot = resolve(options.temporaryRoot ?? tmpdir());
  const { directory, file } = runPathParts(runPath, temporaryRoot);
  await assertPrivateRunDirectory(directory);
  const release = await acquireRunLock(directory);
  try {
    const current = validateDiffRun(await readBoundedJson(file));
    if (
      options.expectedRevision !== undefined &&
      current.revision !== options.expectedRevision
    ) {
      throw new Error("Diff run changed. Read its latest status and try again.");
    }
    const next = validateDiffRun({
      ...current,
      ...change,
      id: current.id,
      schemaVersion: current.schemaVersion,
      revision: current.revision + 1,
      createdAt: current.createdAt,
      url: current.url,
      locale: current.locale,
      contextFile: current.contextFile,
      reviewFile: current.reviewFile,
      fingerprint: current.fingerprint,
      snapshot: current.snapshot,
      updatedAt: new Date(options.nowMs ?? Date.now()).toISOString(),
    });
    const temporaryFile = join(
      directory,
      `.diff-run.${randomBytes(8).toString("hex")}.tmp`,
    );
    try {
      const handle = await open(temporaryFile, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(next, null, 2)}\n`, "utf8");
        await handle.sync();
        await handle.chmod(0o600);
      } finally {
        await handle.close();
      }
      await rename(temporaryFile, file);
    } catch (error) {
      await rm(temporaryFile, { force: true });
      throw error;
    }
    await chmod(file, 0o600);
    return next;
  } finally {
    await release();
  }
}
