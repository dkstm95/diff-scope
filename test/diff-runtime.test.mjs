import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  newDiffRun,
  readDiffRun,
  updateDiffRun,
  writeNewDiffRun,
} from "../plugins/hope/runtime/diff/diff-run.mjs";
import {
  main as diffMain,
  parseArguments,
} from "../plugins/hope/runtime/diff/cli.mjs";

const changeRequest = {
  url: "https://github.com/example/project/pull/1",
  fingerprint: "a".repeat(64),
  baseSha: "b".repeat(40),
  headSha: "c".repeat(40),
  mergeBaseSha: "d".repeat(40),
};

test("DiffRun keeps feature-specific state in a private revisioned file", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hope-diff-runtime-test-"));
  t.after(async () => await rm(root, { recursive: true, force: true }));
  const directory = await mkdtemp(join(root, "hope-context-"));
  await chmod(directory, 0o700);
  const runPath = join(directory, "diff-run.json");
  const first = newDiffRun(changeRequest, {
    id: "run-1",
    locale: "ko",
    nowMs: 1_700_000_000_000,
  });
  await writeNewDiffRun(runPath, first, { temporaryRoot: root });

  assert.deepEqual(await readDiffRun(runPath, { temporaryRoot: root }), first);
  const second = await updateDiffRun(
    runPath,
    { status: "inspecting" },
    {
      expectedRevision: 1,
      nowMs: 1_700_000_000_100,
      temporaryRoot: root,
    },
  );
  assert.equal(second.revision, 2);
  assert.equal(second.status, "inspecting");
  const protectedRun = await updateDiffRun(
    runPath,
    { contextFile: "../../outside.json", status: "validated" },
    { temporaryRoot: root },
  );
  assert.equal(protectedRun.contextFile, "change-request.json");
  await assert.rejects(
    updateDiffRun(runPath, { status: "validated" }, {
      expectedRevision: 1,
      temporaryRoot: root,
    }),
    /Diff run changed/u,
  );
});

test("abandon records cancellation before removing private inputs", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hope-diff-abandon-test-"));
  t.after(async () => await rm(root, { recursive: true, force: true }));
  const directory = await mkdtemp(join(root, "hope-context-"));
  await chmod(directory, 0o700);
  const runPath = join(directory, "diff-run.json");
  await writeNewDiffRun(runPath, newDiffRun(changeRequest), { temporaryRoot: root });
  await writeFile(join(directory, "change-request.json"), "{}\n", { mode: 0o600 });

  await assert.rejects(
    diffMain(["abandon", "--run", runPath], {
      cleanupTransientContext: async () => {
        throw new Error("simulated cleanup failure");
      },
      temporaryRoot: root,
    }),
    /simulated cleanup failure/u,
  );
  assert.equal((await readDiffRun(runPath, { temporaryRoot: root })).status, "cancelled");
});

test("diff CLI starts a private run without changing the existing collector contract", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hope-diff-cli-test-"));
  t.after(async () => await rm(root, { recursive: true, force: true }));
  const started = await diffMain(
    ["start", "--url", changeRequest.url, "--locale", "ko"],
    {
      collectChangeRequest: async () => changeRequest,
      temporaryRoot: root,
      writeChangeRequestFile: async (value, file) => {
        await writeFile(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
        await chmod(file, 0o600);
        return file;
      },
    },
  );
  assert.equal(started.run.locale, "ko");
  assert.equal(started.run.status, "collected");
  assert.equal((await readDiffRun(started.runPath, { temporaryRoot: root })).id, started.run.id);
});

test("diff CLI can start from the latest PR in the current repository", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hope-diff-latest-test-"));
  t.after(async () => await rm(root, { recursive: true, force: true }));
  let collectedUrl;
  const started = await diffMain(
    ["start", "--latest", "--locale", "ko"],
    {
      collectChangeRequest: async ({ url }) => {
        collectedUrl = url;
        return changeRequest;
      },
      cwd: "/workspace/project",
      resolveLatestPullRequest: async ({ cwd }) => {
        assert.equal(cwd, "/workspace/project");
        return changeRequest.url;
      },
      temporaryRoot: root,
      writeChangeRequestFile: async (value, file) => {
        await writeFile(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
        await chmod(file, 0o600);
        return file;
      },
    },
  );
  assert.equal(collectedUrl, changeRequest.url);
  assert.equal(started.run.url, changeRequest.url);
});

test("diff commands move one run through inspect, validate, and render", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hope-diff-flow-test-"));
  t.after(async () => await rm(root, { recursive: true, force: true }));
  const directory = await mkdtemp(join(root, "hope-context-"));
  await chmod(directory, 0o700);
  const runPath = join(directory, "diff-run.json");
  const contextPath = join(directory, "change-request.json");
  const reviewPath = join(directory, "review-model.json");
  await writeFile(contextPath, "{}\n", { mode: 0o600 });
  await writeFile(reviewPath, "{}\n", { mode: 0o600 });
  await writeNewDiffRun(runPath, newDiffRun(changeRequest), { temporaryRoot: root });

  await diffMain(["inspect", "--run", runPath, "--summary"], {
    inspectChangeRequest: async () => ({ receipt: "receipt-1" }),
    temporaryRoot: root,
  });
  assert.equal((await readDiffRun(runPath, { temporaryRoot: root })).status, "inspecting");

  await diffMain(["validate", "--run", runPath, "--input", reviewPath], {
    renderReview: async (argumentsList) => {
      assert.ok(argumentsList.includes("--validate-only"));
      return { validated: true };
    },
    temporaryRoot: root,
  });
  assert.equal((await readDiffRun(runPath, { temporaryRoot: root })).status, "validated");

  const rendered = await diffMain(["render", "--run", runPath, "--input", reviewPath], {
    renderReview: async (argumentsList) => {
      assert.ok(argumentsList.includes("--cleanup"));
      return { file: "/private/tmp/hope-review.html", eligibleAfter: null };
    },
    temporaryRoot: root,
  });
  assert.equal(rendered.file, "/private/tmp/hope-review.html");
  const completed = await readDiffRun(runPath, { temporaryRoot: root });
  assert.equal(completed.status, "completed");
  assert.equal(completed.result.file, rendered.file);
});

test("diff CLI exposes one clear command grammar", () => {
  assert.deepEqual(parseArguments(["start", "--latest"]), {
    command: "start",
    latest: true,
    summary: false,
  });
  assert.throws(
    () => parseArguments(["start"]),
    /exactly one/u,
  );
  assert.throws(
    () => parseArguments(["start", "--latest", "--url", changeRequest.url]),
    /exactly one/u,
  );
  assert.throws(
    () => parseArguments(["status", "--run", "/tmp/diff-run.json", "--latest"]),
    /not allowed with status/u,
  );
  assert.deepEqual(
    parseArguments(["inspect", "--run", "/tmp/diff-run.json", "--summary"]),
    {
      command: "inspect",
      run: "/tmp/diff-run.json",
      summary: true,
    },
  );
  assert.throws(
    () => parseArguments(["inspect", "--run", "/tmp/diff-run.json"]),
    /exactly one/u,
  );
  assert.throws(
    () => parseArguments(["render", "--run", "/tmp/diff-run.json"]),
    /requires --input/u,
  );
});
