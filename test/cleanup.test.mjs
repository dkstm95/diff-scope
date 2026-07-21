import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  applyCleanup,
  previewCleanup,
  readCleanupPlan,
} from "../plugins/hope/runtime/cleanup/cleanup-plan.mjs";
import {
  newDiffRun,
  updateDiffRun,
  writeNewDiffRun,
} from "../plugins/hope/runtime/diff/diff-run.mjs";
import {
  main as cleanupMain,
  parseArguments,
} from "../plugins/hope/runtime/cleanup/cli.mjs";
import {
  eligibleAfterFromCreation,
  managedReviewMarker,
} from "../plugins/hope/skills/diff/scripts/lib/review-retention.mjs";

async function createManagedReview(root, suffix) {
  const directory = join(root, `hope-review-${suffix}`);
  await mkdir(directory, { mode: 0o700 });
  await chmod(directory, 0o700);
  const file = join(directory, "hope-review.html");
  const eligibleAfter = eligibleAfterFromCreation(Date.now());
  await writeFile(
    file,
    `${managedReviewMarker(eligibleAfter)}<!doctype html>\n`,
    { mode: 0o600 },
  );
  await chmod(file, 0o600);
  return { directory, file };
}

async function createDiffRun(root, suffix, status) {
  const directory = join(root, `hope-context-${suffix}`);
  await mkdir(directory, { mode: 0o700 });
  await chmod(directory, 0o700);
  const file = join(directory, "diff-run.json");
  const run = newDiffRun({
    url: "https://github.com/example/project/pull/1",
    fingerprint: "a".repeat(64),
    baseSha: "b".repeat(40),
    headSha: "c".repeat(40),
    mergeBaseSha: "d".repeat(40),
  }, { id: `run-${suffix}` });
  await writeNewDiffRun(file, run, { temporaryRoot: root });
  if (status !== "collected") {
    await updateDiffRun(file, { status }, { temporaryRoot: root });
  }
  return { directory, file };
}

test("cleanup preview is non-destructive and apply removes the exact managed review", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hope-cleanup-test-"));
  t.after(async () => await rm(root, { recursive: true, force: true }));
  const review = await createManagedReview(root, "CLEAN1");

  const plan = await previewCleanup({ temporaryRoot: root });
  assert.equal(plan.targets.length, 1);
  assert.equal(plan.targets[0].file, review.file);
  assert.equal((await readCleanupPlan(plan.planPath, { temporaryRoot: root })).id, plan.id);

  const result = await applyCleanup({
    planDigest: plan.planDigest,
    planPath: plan.planPath,
    temporaryRoot: root,
  });
  assert.deepEqual(
    result.targets.map(({ reason, status }) => ({ reason, status })),
    [{ reason: null, status: "removed" }],
  );
  await assert.rejects(() => chmod(review.file, 0o600), { code: "ENOENT" });
});

test("cleanup skips a managed review that changed after preview", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hope-cleanup-change-"));
  t.after(async () => await rm(root, { recursive: true, force: true }));
  const review = await createManagedReview(root, "CHANGE");
  const plan = await previewCleanup({ temporaryRoot: root });
  await writeFile(review.file, "changed but no Hope marker\n", { mode: 0o600 });

  const result = await applyCleanup({
    planDigest: plan.planDigest,
    planPath: plan.planPath,
    temporaryRoot: root,
  });
  assert.deepEqual(
    result.targets.map(({ reason, status }) => ({ reason, status })),
    [{ reason: "not-managed", status: "skipped" }],
  );
});

test("cleanup rejects a digest that was not approved", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hope-cleanup-digest-"));
  t.after(async () => await rm(root, { recursive: true, force: true }));
  const review = await createManagedReview(root, "DIGEST");
  const plan = await previewCleanup({ temporaryRoot: root });

  await assert.rejects(
    applyCleanup({
      planDigest: "0".repeat(64),
      planPath: plan.planPath,
      temporaryRoot: root,
    }),
    /approval does not match/u,
  );
  await chmod(review.file, 0o600);
});

test("cleanup apply is idempotent for the same plan", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hope-cleanup-idempotent-"));
  t.after(async () => await rm(root, { recursive: true, force: true }));
  await createManagedReview(root, "REPEAT");
  const plan = await previewCleanup({ temporaryRoot: root });
  const first = await applyCleanup({
    planDigest: plan.planDigest,
    planPath: plan.planPath,
    temporaryRoot: root,
  });
  const second = await applyCleanup({
    planDigest: plan.planDigest,
    planPath: plan.planPath,
    temporaryRoot: root,
  });
  assert.deepEqual(second, first);
});

test("cleanup includes terminal diff runs and leaves active runs", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hope-cleanup-runs-"));
  t.after(async () => await rm(root, { recursive: true, force: true }));
  const completed = await createDiffRun(root, "DONE01", "completed");
  const active = await createDiffRun(root, "LIVE01", "inspecting");

  const plan = await previewCleanup({ temporaryRoot: root });
  assert.deepEqual(
    plan.targets.map(({ file, kind }) => ({ file, kind })),
    [{ file: completed.file, kind: "diff-run" }],
  );
  const result = await applyCleanup({
    planDigest: plan.planDigest,
    planPath: plan.planPath,
    temporaryRoot: root,
  });
  assert.equal(result.targets[0].status, "removed");
  await assert.rejects(() => chmod(completed.file, 0o600), { code: "ENOENT" });
  await chmod(active.file, 0o600);
});

test("cleanup CLI keeps preview and apply explicit", async () => {
  assert.deepEqual(parseArguments(["preview"]), {
    command: "preview",
    targets: [],
  });
  assert.deepEqual(
    parseArguments(["apply", "--plan", "/tmp/plan.json", "--digest", "abc", "--target", "one"]),
    {
      command: "apply",
      digest: "abc",
      plan: "/tmp/plan.json",
      targets: ["one"],
    },
  );
  await assert.rejects(() => cleanupMain(["apply"]), /requires --plan and --digest/u);
});
