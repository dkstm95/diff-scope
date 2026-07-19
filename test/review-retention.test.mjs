import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import test from "node:test";

import {
  cleanupExpiredDefaultReviews,
  eligibleAfterFromCreation,
  managedReviewMarker,
  parseManagedReviewMarker,
} from "../plugins/hope/skills/diff/scripts/lib/review-retention.mjs";

async function managedReview(root, suffix, options = {}) {
  const directory = join(root, `hope-review-${suffix}`);
  await mkdir(directory, { mode: 0o700 });
  await chmod(directory, options.directoryMode ?? 0o700);
  const file = join(directory, "hope-review.html");
  const eligibleAfter = eligibleAfterFromCreation(
    options.creationTimeMs ?? Date.now(),
  );
  await writeFile(
    file,
    options.contents ?? `${managedReviewMarker(eligibleAfter)}<!doctype html>\n`,
    { mode: 0o600 },
  );
  await chmod(file, options.fileMode ?? 0o600);
  if (options.extraFile) {
    await writeFile(join(directory, options.extraFile), "keep", { mode: 0o600 });
  }
  return { directory, eligibleAfter, file };
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

test("removes a managed default review only at its exact seven-day eligibility", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hope-retention-test-"));
  t.after(async () => await rm(root, { recursive: true, force: true }));
  const review = await managedReview(root, "ABC123");
  const eligibleAt = Date.parse(review.eligibleAfter);

  assert.deepEqual(
    await cleanupExpiredDefaultReviews({ temporaryRoot: root, nowMs: eligibleAt - 1 }),
    { removedCount: 0 },
  );
  assert.equal(await exists(review.file), true);

  assert.deepEqual(
    await cleanupExpiredDefaultReviews({ temporaryRoot: root, nowMs: eligibleAt }),
    { removedCount: 1 },
  );
  assert.equal(await exists(review.directory), false);
});

test("accepts only the exact authoritative eligibleAfter marker", () => {
  const eligibleAfter = "2026-07-26T12:34:56.789Z";
  assert.equal(
    parseManagedReviewMarker(managedReviewMarker(eligibleAfter)),
    eligibleAfter,
  );
  for (const invalid of [
    "<!-- Hope-managed temporary review -->\n",
    "<!-- Hope-managed temporary review; eligibleAfter=2026-07-26T12:34:56Z -->\n",
    "<!-- Hope-managed temporary review; eligibleAfter=2026-07-26T12:34:56.789+00:00 -->\n",
    "<!-- Hope-managed temporary review; eligibleAfter=2026-02-30T12:34:56.789Z -->\n",
  ]) {
    assert.equal(parseManagedReviewMarker(invalid), undefined);
  }
});

test("touching a managed review does not move its embedded eligibility", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hope-retention-touch-"));
  t.after(async () => await rm(root, { recursive: true, force: true }));
  const nowMs = Date.now();
  const review = await managedReview(root, "TOUCH1", {
    creationTimeMs: nowMs - 8 * 24 * 60 * 60 * 1_000,
  });
  const touchedAt = new Date(nowMs);
  await utimes(review.file, touchedAt, touchedAt);
  await utimes(review.directory, touchedAt, touchedAt);

  assert.deepEqual(
    await cleanupExpiredDefaultReviews({ temporaryRoot: root, nowMs }),
    { removedCount: 1 },
  );
  assert.equal(await exists(review.directory), false);
});

test("concurrent retention passes remove an eligible review at most once", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hope-retention-race-"));
  t.after(async () => await rm(root, { recursive: true, force: true }));
  const review = await managedReview(root, "RACE01");
  const nowMs = Date.parse(review.eligibleAfter);

  const results = await Promise.all([
    cleanupExpiredDefaultReviews({ temporaryRoot: root, nowMs }),
    cleanupExpiredDefaultReviews({ temporaryRoot: root, nowMs }),
  ]);

  assert.equal(results.reduce((total, result) => total + result.removedCount, 0), 1);
  assert.equal(await exists(review.directory), false);
});

test("preserves uncertain, malformed, recent, and differently owned candidates", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hope-retention-safety-"));
  t.after(async () => await rm(root, { recursive: true, force: true }));
  const malformed = await managedReview(root, "BAD001", {
    contents: "<!doctype html>\n",
  });
  const extra = await managedReview(root, "BAD002", { extraFile: "notes.txt" });
  const recent = await managedReview(root, "NEW001");
  const wrongOwner = await managedReview(root, "OWNER1");

  const linkedTarget = await mkdtemp(join(root, "linked-target-"));
  await chmod(linkedTarget, 0o700);
  await writeFile(
    join(linkedTarget, "hope-review.html"),
    `${managedReviewMarker(recent.eligibleAfter)}<!doctype html>\n`,
    { mode: 0o600 },
  );
  const linkedDirectory = join(root, "hope-review-LINK01");
  await symlink(linkedTarget, linkedDirectory, "dir");

  const linkedFileDirectory = join(root, "hope-review-LINK02");
  await mkdir(linkedFileDirectory, { mode: 0o700 });
  await chmod(linkedFileDirectory, 0o700);
  const linkedFileTarget = join(root, "linked-review.html");
  await writeFile(
    linkedFileTarget,
    `${managedReviewMarker(recent.eligibleAfter)}<!doctype html>\n`,
    { mode: 0o600 },
  );
  await symlink(linkedFileTarget, join(linkedFileDirectory, "hope-review.html"));

  const farFuture = Math.max(
    Date.parse(malformed.eligibleAfter),
    Date.parse(extra.eligibleAfter),
    Date.parse(recent.eligibleAfter),
    Date.parse(wrongOwner.eligibleAfter),
  ) + 1;
  const otherUid = (typeof process.getuid === "function" ? process.getuid() : 0) + 1;

  await cleanupExpiredDefaultReviews({
    temporaryRoot: root,
    nowMs: farFuture,
    currentUid: otherUid,
  });
  assert.equal(await exists(wrongOwner.file), true);

  await cleanupExpiredDefaultReviews({
    temporaryRoot: root,
    nowMs: Date.parse(recent.eligibleAfter) - 1,
  });
  for (const path of [
    malformed.file,
    extra.file,
    recent.file,
    linkedDirectory,
    join(linkedFileDirectory, "hope-review.html"),
  ]) {
    assert.equal(await exists(path), true);
  }
});

test(
  "preserves a managed-looking directory with non-private permissions",
  { skip: process.platform === "win32" },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "hope-retention-mode-"));
    t.after(async () => await rm(root, { recursive: true, force: true }));
    const review = await managedReview(root, "MODE01", { directoryMode: 0o755 });

    assert.deepEqual(
      await cleanupExpiredDefaultReviews({
        temporaryRoot: root,
        nowMs: Date.parse(review.eligibleAfter),
      }),
      { removedCount: 0 },
    );
    assert.equal(await exists(review.file), true);
  },
);

test(
  "refuses to scan an unsafe non-sticky shared POSIX temporary root",
  { skip: process.platform === "win32" },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "hope-retention-root-mode-"));
    t.after(async () => await rm(root, { recursive: true, force: true }));
    const review = await managedReview(root, "ROOT01", {
      creationTimeMs: Date.now() - 8 * 24 * 60 * 60 * 1_000,
    });
    await chmod(root, 0o777);

    assert.deepEqual(
      await cleanupExpiredDefaultReviews({
        temporaryRoot: root,
        nowMs: Date.parse(review.eligibleAfter),
      }),
      { removedCount: 0 },
    );
    assert.equal(await exists(review.file), true);
  },
);

test(
  "allows a sticky shared POSIX temporary root",
  { skip: process.platform === "win32" },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "hope-retention-sticky-root-"));
    t.after(async () => await rm(root, { recursive: true, force: true }));
    const review = await managedReview(root, "ROOT02", {
      creationTimeMs: Date.now() - 8 * 24 * 60 * 60 * 1_000,
    });
    await chmod(root, 0o1777);

    assert.deepEqual(
      await cleanupExpiredDefaultReviews({
        temporaryRoot: root,
        nowMs: Date.parse(review.eligibleAfter),
      }),
      { removedCount: 1 },
    );
    assert.equal(await exists(review.directory), false);
  },
);
