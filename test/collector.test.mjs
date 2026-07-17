import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { promisify } from "node:util";

import {
  classifyGitMode,
  classifyPath,
  collectChangeContext,
  createDeadline,
  createGitEnvironment,
  mergeLimits,
  parseArguments,
  readBoundedRegularFile,
  redactSensitiveText,
  writeContextFile,
} from "../plugins/diff-scope/skills/diff/scripts/collect-change-context.mjs";
import { isSafeRelativePosixPath } from "../plugins/diff-scope/skills/diff/scripts/lib/validate-artifact.mjs";

const execFileAsync = promisify(execFile);

async function git(root, ...args) {
  return await execFileAsync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    shell: false,
  });
}

async function put(root, relativePath, contents) {
  const outputPath = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, contents);
}

async function makeRepository(t) {
  const root = await mkdtemp(path.join(tmpdir(), "collector-test-"));
  t.after(async () => await rm(root, { recursive: true, force: true }));
  await git(root, "init", "-q");
  await git(root, "config", "user.name", "Collector Test");
  await git(root, "config", "user.email", "collector@example.invalid");
  return root;
}

async function commitAll(root, message) {
  await git(root, "add", "--all");
  await git(root, "commit", "-q", "-m", message);
}

function patchFor(context, relativePath) {
  return context.patches.find((patch) => patch.path === relativePath)?.text;
}

test("collects staged, unstaged, and safe untracked changes", async (t) => {
  const root = await makeRepository(t);
  await put(root, "src/app.js", 'export const mode = "old";\n');
  await put(root, "dist/bundle.js", "compiled-v1\n");
  await put(root, "image.bin", Buffer.from([0, 1, 2]));
  await put(root, "target-a.txt", "a\n");
  await put(root, "target-b.txt", "b\n");
  await symlink("target-a.txt", path.join(root, "current.txt"));
  await commitAll(root, "initial");

  await put(
    root,
    "src/app.js",
    [
      'export const mode = "staged-change";',
      'export const token = "ghp_abcdefghijklmnopqrstuvwxyz";',
      "",
    ].join("\n"),
  );
  await git(root, "add", "src/app.js");
  await writeFile(
    path.join(root, "src/app.js"),
    'export const mode = "staged-change";\nexport const token = "ghp_abcdefghijklmnopqrstuvwxyz";\nexport const phase = "unstaged-change";\n',
  );
  await put(root, "dist/bundle.js", "compiled-v2\n");
  await put(root, "image.bin", Buffer.from([0, 3, 4, 5]));
  await unlink(path.join(root, "current.txt"));
  await symlink("target-b.txt", path.join(root, "current.txt"));
  await put(root, "notes.txt", "private untracked notes\n");
  await put(root, ".env", "API_KEY=must-never-be-read\n");
  await put(root, "service-account.json", '{"private_key":"must-never-read-service-account"}\n');

  const context = await collectChangeContext({ root });
  const serialized = JSON.stringify(context);
  const sourcePatch = patchFor(context, "src/app.js");

  assert.equal(context.schemaVersion, 1);
  assert.equal(context.scope.kind, "working-tree");
  assert.equal(context.scope.includeUntrackedBodies, true);
  assert.match(context.fingerprint, /^[a-f0-9]{64}$/u);
  assert.match(sourcePatch, /staged-change/u);
  assert.match(sourcePatch, /unstaged-change/u);
  assert.doesNotMatch(sourcePatch, /ghp_abcdefghijklmnopqrstuvwxyz/u);
  assert.match(sourcePatch, /\[REDACTED\]/u);
  assert.equal(context.files.find((file) => file.path === "notes.txt")?.bodyIncluded, true);
  assert.equal(context.files.find((file) => file.path === ".env")?.omissionReason, "secret-path");
  assert.equal(
    context.files.find((file) => file.path === "service-account.json")?.omissionReason,
    "secret-path",
  );
  assert.equal(
    context.files.find((file) => file.path === "dist/bundle.js")?.omissionReason,
    "generated-or-lockfile",
  );
  assert.equal(context.files.find((file) => file.path === "image.bin")?.omissionReason, "binary");
  assert.equal(
    context.files.find((file) => file.path === "current.txt")?.omissionReason,
    "symlink",
  );
  assert.match(patchFor(context, "notes.txt"), /private untracked notes/u);
  assert.equal(patchFor(context, ".env"), undefined);
  assert.doesNotMatch(serialized, /must-never-be-read|must-never-read-service-account/u);
  assert.doesNotMatch(serialized, new RegExp(root, "u"));
  assert.ok(context.warnings.some((warning) => warning.includes("redacted")));
  assert.ok(context.warnings.some((warning) => warning.includes("safety or size policy")));
});

test("reads only explicitly requested safe untracked bodies and redacts them", async (t) => {
  const root = await makeRepository(t);
  await put(root, "tracked.txt", "tracked\n");
  await commitAll(root, "initial");
  await put(root, "notes.txt", "Bearer abcdefghijklmnopqrstuvwxyz\npassword=plain-secret\n");
  await put(root, ".npmrc", "//registry.example/:_authToken=never-read\n");
  await put(root, "asset.dat", Buffer.from([0, 8, 9]));
  await symlink("notes.txt", path.join(root, "linked.txt"));

  const context = await collectChangeContext({ root });
  const notes = context.files.find((file) => file.path === "notes.txt");
  const notesPatch = patchFor(context, "notes.txt");
  const serialized = JSON.stringify(context);

  assert.equal(notes?.bodyIncluded, true);
  assert.equal(notes?.source, "untracked");
  assert.match(notesPatch, /Bearer \[REDACTED\]/u);
  assert.match(notesPatch, /password=\[REDACTED\]/u);
  assert.doesNotMatch(serialized, /plain-secret|never-read|abcdefghijklmnopqrstuvwxyz/u);
  assert.equal(context.files.find((file) => file.path === ".npmrc")?.omissionReason, "secret-path");
  assert.equal(context.files.find((file) => file.path === "asset.dat")?.omissionReason, "binary");
  assert.equal(context.files.find((file) => file.path === "linked.txt")?.omissionReason, "symlink");
});

test("marks partial bounded context incomplete and rejects an entirely omitted context", async (t) => {
  const root = await makeRepository(t);
  await put(root, "a.txt", "old-a\n");
  await put(root, "b.txt", "old-b\n");
  await commitAll(root, "initial");
  await put(root, "a.txt", "new-a\nsecond-a\n");
  await put(root, "b.txt", "new-b\nsecond-b\n");

  const fileLimited = await collectChangeContext({
    root,
    limits: { maxFiles: 1 },
  });
  assert.equal(fileLimited.complete, false);
  assert.equal(fileLimited.files.length, 1);
  assert.ok(fileLimited.excluded.some((item) => item.path === "additional-files-not-enumerated"));

  await assert.rejects(
    collectChangeContext({ root, limits: { filePatchBytes: 20 } }),
    /No explainable text changes were collected \(per-file-byte-limit\)/u,
  );
  await assert.rejects(
    collectChangeContext({ root, limits: { changedLines: 1 } }),
    /No explainable text changes were collected \(changed-line-limit\)/u,
  );
});

test("fails clearly when there are no explainable local changes", async (t) => {
  const cleanRoot = await makeRepository(t);
  await put(cleanRoot, "tracked.txt", "tracked\n");
  await commitAll(cleanRoot, "initial");
  await assert.rejects(collectChangeContext({ root: cleanRoot }), /No local changes found/u);

  const excludedRoot = await makeRepository(t);
  await put(excludedRoot, "tracked.txt", "tracked\n");
  await commitAll(excludedRoot, "initial");
  await put(excludedRoot, ".env", "PASSWORD=do-not-read\n");
  await assert.rejects(
    collectChangeContext({ root: excludedRoot }),
    /No explainable text changes were collected \(secret-path\)/u,
  );
});

test("ignores hostile Git environment redirection and stays in the requested worktree", async (t) => {
  const requestedRoot = await makeRepository(t);
  await put(requestedRoot, "requested.txt", "old requested\n");
  await commitAll(requestedRoot, "requested initial");
  await put(requestedRoot, "requested.txt", "new requested\n");

  const hostileRoot = await makeRepository(t);
  await put(hostileRoot, "hostile.txt", "old hostile\n");
  await commitAll(hostileRoot, "hostile initial");
  await put(hostileRoot, "hostile.txt", "redirected hostile content\n");

  const previous = {
    GIT_ALTERNATE_OBJECT_DIRECTORIES: process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES,
    GIT_CONFIG_COUNT: process.env.GIT_CONFIG_COUNT,
    GIT_CONFIG_KEY_0: process.env.GIT_CONFIG_KEY_0,
    GIT_CONFIG_VALUE_0: process.env.GIT_CONFIG_VALUE_0,
    GIT_DIR: process.env.GIT_DIR,
    GIT_INDEX_FILE: process.env.GIT_INDEX_FILE,
    GIT_OBJECT_DIRECTORY: process.env.GIT_OBJECT_DIRECTORY,
    GIT_WORK_TREE: process.env.GIT_WORK_TREE,
  };
  process.env.GIT_DIR = path.join(hostileRoot, ".git");
  process.env.GIT_WORK_TREE = hostileRoot;
  process.env.GIT_INDEX_FILE = path.join(hostileRoot, ".git", "index");
  process.env.GIT_OBJECT_DIRECTORY = path.join(hostileRoot, ".git", "objects");
  process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES = path.join(requestedRoot, ".git", "objects");
  process.env.GIT_CONFIG_COUNT = "1";
  process.env.GIT_CONFIG_KEY_0 = "core.worktree";
  process.env.GIT_CONFIG_VALUE_0 = hostileRoot;

  let context;
  try {
    context = await collectChangeContext({ root: requestedRoot });
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }

  assert.match(patchFor(context, "requested.txt"), /new requested/u);
  assert.equal(
    context.files.some((file) => file.path === "hostile.txt"),
    false,
  );
  assert.doesNotMatch(JSON.stringify(context), /redirected hostile content/u);
});

test("hashes and excludes Git paths longer than the 300-character context contract", async (t) => {
  const root = await makeRepository(t);
  await put(root, "tracked.txt", "tracked\n");
  await commitAll(root, "initial");
  const longPath = ["a".repeat(100), "b".repeat(100), `${"c".repeat(99)}.txt`].join("/");
  assert.ok(longPath.length > 300);
  await put(root, longPath, "must not enter context\n");
  await put(root, "~ambiguous.txt", "must also stay behind a placeholder\n");
  await put(root, "tracked.txt", "safe tracked change\n");

  const context = await collectChangeContext({ root });
  const placeholders = context.files.filter((file) => file.path.startsWith("unsafe-path-"));

  assert.equal(classifyPath(longPath), "unsafe-path");
  assert.equal(classifyPath("~ambiguous.txt"), "unsafe-path");
  assert.equal(placeholders.length, 2);
  for (const entry of placeholders) {
    assert.equal(entry.omissionReason, "unsafe-path");
    assert.ok(
      context.excluded.some((item) => item.path === entry.path && item.reason === "unsafe-path"),
    );
  }
  assert.ok(context.files.every((file) => isSafeRelativePosixPath(file.path)));
  assert.ok(context.patches.every((patch) => isSafeRelativePosixPath(patch.path)));
  assert.ok(context.excluded.every((entry) => isSafeRelativePosixPath(entry.path)));
  assert.doesNotMatch(JSON.stringify(context), new RegExp("c".repeat(99), "u"));
  assert.doesNotMatch(JSON.stringify(context), /~ambiguous\.txt/u);
});

test(
  "excludes an untracked FIFO without blocking",
  { skip: process.platform === "win32", timeout: 5_000 },
  async (t) => {
    const root = await makeRepository(t);
    await put(root, "tracked.txt", "tracked\n");
    await commitAll(root, "initial");
    await execFileAsync("mkfifo", [path.join(root, "events.pipe")], {
      shell: false,
    });

    const fifoPath = path.join(root, "events.pipe");
    const result = await readBoundedRegularFile(fifoPath, 64 * 1024, createDeadline(3_000));

    assert.equal(result.omissionReason, "not-a-regular-file");
    assert.equal(result.buffer, undefined);
  },
);

test("writes mode-restricted output and refuses existing or symlink paths", async (t) => {
  const root = await makeRepository(t);
  await put(root, "tracked.txt", "old\n");
  await commitAll(root, "initial");
  await put(root, "tracked.txt", "new\n");
  const context = await collectChangeContext({ root });

  const defaultOutput = await writeContextFile(context);
  const defaultDirectory = path.dirname(defaultOutput);
  t.after(async () => await rm(defaultDirectory, { recursive: true, force: true }));
  assert.equal((await lstat(defaultDirectory)).mode & 0o777, 0o700);
  assert.equal((await lstat(defaultOutput)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(defaultOutput, "utf8")).fingerprint, context.fingerprint);

  const explicitDirectory = await mkdtemp(path.join(tmpdir(), "collector-output-"));
  t.after(async () => await rm(explicitDirectory, { recursive: true, force: true }));
  await chmod(explicitDirectory, 0o700);
  const explicitOutput = path.join(explicitDirectory, "context.json");
  await writeContextFile(context, explicitOutput);
  assert.equal((await lstat(explicitOutput)).mode & 0o777, 0o600);
  await assert.rejects(writeContextFile(context, explicitOutput), /Refusing to overwrite/u);

  const danglingTarget = path.join(explicitDirectory, "missing.json");
  const symlinkOutput = path.join(explicitDirectory, "linked.json");
  await symlink(danglingTarget, symlinkOutput);
  await assert.rejects(writeContextFile(context, symlinkOutput), /Refusing to overwrite/u);
});

test("classifies sensitive paths and Git modes without broad generated-name false positives", () => {
  assert.equal(classifyPath(".env.local"), "secret-path");
  assert.equal(classifyPath(".envrc"), "secret-path");
  assert.equal(classifyPath("deploy/server.pem"), "secret-path");
  assert.equal(classifyPath("config/secrets.yaml"), "secret-path");
  assert.equal(classifyPath("config/service-account.json"), "secret-path");
  assert.equal(classifyPath("config/service_account.json"), "secret-path");
  assert.equal(classifyPath("config/google-service-account-key.json"), "secret-path");
  assert.equal(classifyPath("src/generated/client.ts"), "generated-or-lockfile");
  assert.equal(classifyPath("src/client.generated.ts"), "generated-or-lockfile");
  assert.equal(classifyPath("understanding-ai-generated-code.md"), null);
  assert.equal(classifyPath("../escape.txt"), "unsafe-path");
  assert.equal(classifyPath(`${"😀".repeat(151)}.md`), "unsafe-path");
  assert.equal(classifyPath(" leading.txt"), "unsafe-path");
  assert.equal(classifyPath("trailing.txt "), "unsafe-path");
  assert.equal(classifyPath("~/config.txt"), "unsafe-path");
  assert.equal(classifyPath("C:/config.txt"), "unsafe-path");
  assert.equal(classifyPath("https:config.txt"), "unsafe-path");
  assert.equal(classifyPath("src//config.txt"), "unsafe-path");
  assert.equal(classifyPath("src/./config.txt"), "unsafe-path");
  assert.equal(classifyPath("1:config.txt"), null);
  assert.equal(classifyGitMode("100644", "160000", "T"), "submodule");
  assert.equal(classifyGitMode("120000", "120000", "M"), "symlink");
  assert.equal(classifyGitMode("100644", "100755", "M"), null);
});

test("redacts PEM blocks, tokens, credentials, and assignment values", () => {
  const input = [
    "-----BEGIN PRIVATE KEY-----",
    "top-secret-material",
    "-----END PRIVATE KEY-----",
    "Authorization: Bearer abc.def-ghi",
    "api_key='sk-abcdefghijklmnopqrstuvwxyz'",
    'password = "two words secret"',
    '"private_key": "-----BEGIN PRIVATE KEY-----\\nbase64-secret\\n-----END PRIVATE KEY-----",',
    "private-key='escaped\\nprivate material'",
    'privateKey = "camel case key material"',
    "aws_access_key_id=ASIA1234567890ABCDEF",
    'secret_access_key="aws secret access value"',
    "secret-access-key=unquoted-aws-secret",
    "temporary credential ASIAFEDCBA0987654321",
    "https://person:password@example.test/path",
  ].join("\n");
  const result = redactSensitiveText(input);

  assert.match(result.text, /\[REDACTED_PEM_BLOCK\]/u);
  assert.match(result.text, /Bearer \[REDACTED\]/u);
  assert.match(result.text, /api_key='\[REDACTED\]'/u);
  assert.match(result.text, /password = "\[REDACTED\]"/u);
  assert.match(result.text, /"private_key": "\[REDACTED\]"/u);
  assert.match(result.text, /private-key='\[REDACTED\]'/u);
  assert.match(result.text, /privateKey = "\[REDACTED\]"/u);
  assert.match(result.text, /aws_access_key_id=\[REDACTED\]/u);
  assert.match(result.text, /secret_access_key="\[REDACTED\]"/u);
  assert.match(result.text, /secret-access-key=\[REDACTED\]/u);
  assert.match(result.text, /temporary credential \[REDACTED_TOKEN\]/u);
  assert.match(result.text, /https:\/\/\[REDACTED\]@example\.test/u);
  assert.doesNotMatch(
    result.text,
    /top-secret-material|abc\.def-ghi|sk-abcdefghijklmnopqrstuvwxyz|two words secret|base64-secret|private material|camel case key material|ASIA1234567890ABCDEF|aws secret access value|unquoted-aws-secret|ASIAFEDCBA0987654321|person:password/u,
  );
  assert.ok(result.redactions >= 4);
});

test("parses only the supported CLI surface", () => {
  assert.deepEqual(
    parseArguments(["--root", "repo", "--output", "context.json"]),
    {
      root: "repo",
      output: "context.json",
    },
  );
  assert.throws(() => parseArguments(["--unknown"]), /Unknown argument/u);
  assert.throws(() => parseArguments(["--base", "main"]), /Unknown argument/u);
});

test("strips all Git-prefixed variables while preserving system environment", () => {
  assert.deepEqual(
    createGitEnvironment({
      GIT_CEILING_DIRECTORIES: "/tmp",
      GIT_COMMON_DIR: "/tmp/common",
      GIT_CONFIG_GLOBAL: "/tmp/config",
      git_dir: "/tmp/repo.git",
      HOME: "/safe/home",
      PATH: "/safe/bin",
      UNRELATED: "kept",
    }),
    {
      HOME: "/safe/home",
      PATH: "/safe/bin",
      UNRELATED: "kept",
    },
  );
});

test("uses one deterministic overall deadline budget", () => {
  let now = 1_000;
  const deadline = createDeadline(10_000, () => now);

  assert.equal(deadline.remainingMs(), 10_000);
  now = 4_250;
  assert.equal(deadline.remainingMs(), 6_750);
  now = 10_999.2;
  assert.equal(deadline.remainingMs(), 1);
  now = 11_000;
  assert.throws(() => deadline.remainingMs(), /overall 10000ms deadline/u);
});

test("allows only tighter collector limits within ChangeContextV1 caps", () => {
  assert.equal(mergeLimits({ maxFiles: 12 }).maxFiles, 12);
  assert.throws(() => mergeLimits({ maxFiles: 81 }), /cannot exceed 80/u);
  assert.throws(() => mergeLimits({ changedLines: 4_001 }), /cannot exceed 4000/u);
  assert.throws(() => mergeLimits({ totalPatchBytes: 262_145 }), /cannot exceed 262144/u);
  assert.throws(() => mergeLimits({ extraLimit: 1 }), /Unknown collector limit/u);
});
