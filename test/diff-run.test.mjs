import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  readFile,
  symlink,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LIMITS } from "../features/diff/constants.mjs";
import { finishDiff } from "../features/diff/index.mjs";
import {
  buildInspectionPages,
  claimDiffRunFinalization,
  cleanupExpiredRuns,
  createDiffRun,
  inspectDiffRun,
  loadDiffRun,
  removeDiffRun,
} from "../features/diff/run.mjs";
import { makeAnalysis, makeSnapshot } from "../test-support/diff-fixture.mjs";

test("a DiffRun requires every page and publishes one review", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "hope-run-test-"));
  const snapshot = makeSnapshot();
  const created = await createDiffRun(snapshot, { temporaryRoot });

  await assert.rejects(
    finishDiff(created.path, { temporaryRoot }),
    /Read every Hope inspection page/u,
  );
  for (let page = 1; page <= created.pageCount; page += 1) {
    const value = await inspectDiffRun(created.path, page, { temporaryRoot });
    assert.equal(value.page, page);
  }
  await writeFile(
    created.analysisPath,
    `${JSON.stringify(makeAnalysis(snapshot, created.runId), null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  const result = await finishDiff(created.path, {
    revalidate: async () => ({
      matches: true,
      revalidatedAt: "2026-07-23T00:01:00.000Z",
    }),
    temporaryRoot,
  });
  assert.match(result.outputPath, /hope-review\.html$/u);
  await assert.rejects(loadDiffRun(created.path, { temporaryRoot }), /ENOENT/u);
});

test("one invalid analysis can be repaired without rereading inspection pages", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "hope-run-retry-"));
  const snapshot = makeSnapshot();
  const created = await createDiffRun(snapshot, { temporaryRoot });
  for (let page = 1; page <= created.pageCount; page += 1) {
    await inspectDiffRun(created.path, page, { temporaryRoot });
  }

  const invalid = makeAnalysis(snapshot, created.runId);
  invalid.snapshotDigest = "0".repeat(64);
  await writeFile(
    created.analysisPath,
    `${JSON.stringify(invalid, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );

  await assert.rejects(
    finishDiff(created.path, { temporaryRoot }),
    (error) => {
      assert.equal(error.code, "HOPE_ANALYSIS_INVALID");
      assert.equal(error.canRetry, true);
      return true;
    },
  );

  await writeFile(
    created.analysisPath,
    `${JSON.stringify(makeAnalysis(snapshot, created.runId), null, 2)}\n`,
    { mode: 0o600 },
  );
  const result = await finishDiff(created.path, {
    revalidate: async () => ({
      matches: true,
      revalidatedAt: "2026-07-23T00:01:00.000Z",
    }),
    temporaryRoot,
  });

  assert.match(result.outputPath, /hope-review\.html$/u);
  await assert.rejects(loadDiffRun(created.path, { temporaryRoot }), /ENOENT/u);
});

test("only one finalization can claim a run", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "hope-run-concurrent-"));
  const snapshot = makeSnapshot();
  const created = await createDiffRun(snapshot, { temporaryRoot });
  for (let page = 1; page <= created.pageCount; page += 1) {
    await inspectDiffRun(created.path, page, { temporaryRoot });
  }
  await writeFile(
    created.analysisPath,
    `${JSON.stringify(makeAnalysis(snapshot, created.runId), null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );

  let continueRendering;
  let renderingStarted;
  const started = new Promise((resolve) => {
    renderingStarted = resolve;
  });
  const blocked = new Promise((resolve) => {
    continueRendering = resolve;
  });
  const dependencies = {
    finalize: async () => ({ outputPath: "review.html" }),
    removeRun: async (path) => await removeDiffRun(path, { temporaryRoot }),
    render: async () => {
      renderingStarted();
      await blocked;
      return { bytes: Buffer.from("review"), digest: "digest" };
    },
    revalidate: async () => ({
      matches: true,
      revalidatedAt: "2026-07-23T00:01:00.000Z",
    }),
    temporaryRoot,
  };

  const first = finishDiff(created.path, dependencies);
  await started;
  await assert.rejects(
    finishDiff(created.path, dependencies),
    /already being finalized/u,
  );
  continueRendering();
  await first;
});

test("a lost finalization lease prevents publication", async (context) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "hope-run-lost-lease-"));
  const snapshot = makeSnapshot();
  const created = await createDiffRun(snapshot, { temporaryRoot });
  context.after(async () => await removeDiffRun(created.path, { temporaryRoot }).catch(() => {}));
  for (let page = 1; page <= created.pageCount; page += 1) {
    await inspectDiffRun(created.path, page, { temporaryRoot });
  }
  await writeFile(
    created.analysisPath,
    `${JSON.stringify(makeAnalysis(snapshot, created.runId), null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  let published = false;

  await assert.rejects(
    finishDiff(created.path, {
      finalize: async () => {
        published = true;
        return {};
      },
      render: async () => {
        await unlink(join(created.path, ".finish.lock"));
        return { bytes: Buffer.from("review"), digest: "digest" };
      },
      revalidate: async () => ({
        matches: true,
        revalidatedAt: "2026-07-23T00:01:00.000Z",
      }),
      temporaryRoot,
    }),
    /finalization lease was lost/u,
  );
  assert.equal(published, false);
});

test("an expired finalization lease prevents publication", async (context) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "hope-run-expired-lease-"));
  const snapshot = makeSnapshot();
  const created = await createDiffRun(snapshot, { temporaryRoot });
  context.after(async () => await removeDiffRun(created.path, { temporaryRoot }).catch(() => {}));
  for (let page = 1; page <= created.pageCount; page += 1) {
    await inspectDiffRun(created.path, page, { temporaryRoot });
  }
  await writeFile(
    created.analysisPath,
    `${JSON.stringify(makeAnalysis(snapshot, created.runId), null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  let published = false;

  await assert.rejects(
    finishDiff(created.path, {
      finalize: async () => {
        published = true;
        return {};
      },
      render: async () => {
        const stale = new Date(Date.now() - 2 * 60 * 60 * 1000);
        await utimes(join(created.path, ".finish.lock"), stale, stale);
        return { bytes: Buffer.from("review"), digest: "digest" };
      },
      revalidate: async () => ({
        matches: true,
        revalidatedAt: "2026-07-23T00:01:00.000Z",
      }),
      temporaryRoot,
    }),
    /finalization lease expired/u,
  );
  assert.equal(published, false);
});

test("expiry cleanup leaves an actively finalized old run in place", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "hope-run-active-expiry-"));
  const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const created = await createDiffRun(makeSnapshot(), {
    clock: () => old,
    temporaryRoot,
  });
  const run = await loadDiffRun(created.path, { temporaryRoot });
  const claim = await claimDiffRunFinalization(run);
  try {
    const removed = await cleanupExpiredRuns({ temporaryRoot });
    assert.deepEqual(removed, []);
    await access(created.path);
  } finally {
    await claim.release();
    await removeDiffRun(created.path, { temporaryRoot });
  }
});

test("a heartbeat keeps a long finalization lease active", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "hope-run-stale-expiry-"));
  const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const created = await createDiffRun(makeSnapshot(), {
    clock: () => old,
    temporaryRoot,
  });
  const run = await loadDiffRun(created.path, { temporaryRoot });
  const claim = await claimDiffRunFinalization(run);
  const dueForHeartbeat = new Date(Date.now() - 30 * 60 * 1000);
  await utimes(join(created.path, ".finish.lock"), dueForHeartbeat, dueForHeartbeat);
  await claim.renew();

  const removed = await cleanupExpiredRuns({ temporaryRoot });
  assert.deepEqual(removed, []);
  await access(created.path);
  await claim.release();
  await removeDiffRun(created.path, { temporaryRoot });
});

test("expiry cleanup reclaims a stale lease even when its PID is reused", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "hope-run-reused-pid-"));
  const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const created = await createDiffRun(makeSnapshot(), {
    clock: () => old,
    temporaryRoot,
  });
  const run = await loadDiffRun(created.path, { temporaryRoot });
  const claim = await claimDiffRunFinalization(run, {
    scheduleHeartbeat: () => undefined,
  });
  const stale = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await utimes(join(created.path, ".finish.lock"), stale, stale);
  await assert.rejects(claim.renew(), /lease expired/u);

  const removed = await cleanupExpiredRuns({ temporaryRoot });
  assert.deepEqual(removed, [created.path]);
  await assert.rejects(access(created.path), /ENOENT/u);
  await claim.release();
});

test("expiry cleanup reclaims an old incomplete finalization claim", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "hope-run-incomplete-claim-"));
  const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const created = await createDiffRun(makeSnapshot(), {
    clock: () => old,
    temporaryRoot,
  });
  const claimPath = join(created.path, ".finish.lock");
  await writeFile(claimPath, "", { flag: "wx", mode: 0o600 });
  const stale = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await utimes(claimPath, stale, stale);

  const removed = await cleanupExpiredRuns({ temporaryRoot });
  assert.deepEqual(removed, [created.path]);
  await assert.rejects(access(created.path), /ENOENT/u);
});

test("a failed finalization claim initialization removes its lock", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "hope-run-claim-failure-"));
  const created = await createDiffRun(makeSnapshot(), { temporaryRoot });
  const run = await loadDiffRun(created.path, { temporaryRoot });
  let removedPath;

  await assert.rejects(
    claimDiffRunFinalization(run, {
      openFile: async () => ({
        close: async () => {},
        sync: async () => {},
        writeFile: async () => {
          throw new Error("claim write failed");
        },
      }),
      unlinkFile: async (path) => {
        removedPath = path;
      },
    }),
    /claim write failed/u,
  );
  assert.equal(removedPath, join(created.path, ".finish.lock"));
  await removeDiffRun(created.path, { temporaryRoot });
});

test("a run is cleaned before its review becomes visible", async (context) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "hope-run-cleanup-"));
  const snapshot = makeSnapshot();
  const created = await createDiffRun(snapshot, { temporaryRoot });
  context.after(async () => await removeDiffRun(created.path, { temporaryRoot }).catch(() => {}));
  for (let page = 1; page <= created.pageCount; page += 1) {
    await inspectDiffRun(created.path, page, { temporaryRoot });
  }
  await writeFile(
    created.analysisPath,
    `${JSON.stringify(makeAnalysis(snapshot, created.runId), null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  let published = false;

  await assert.rejects(
    finishDiff(created.path, {
      finalize: async () => {
        published = true;
        return {};
      },
      removeRun: async () => {
        throw new Error("cleanup failed");
      },
      render: async () => ({ bytes: Buffer.from("review"), digest: "digest" }),
      revalidate: async () => ({
        matches: true,
        revalidatedAt: "2026-07-23T00:01:00.000Z",
      }),
      temporaryRoot,
    }),
    /cleanup failed/u,
  );
  assert.equal(published, false);
});

test("inspection pages must be read in order", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "hope-run-order-"));
  const created = await createDiffRun(makeSnapshot(), { temporaryRoot });
  await assert.rejects(
    inspectDiffRun(created.path, 2, { temporaryRoot }),
    /page 1 next/u,
  );
});

test("a canonical temporary-root alias can resume a DiffRun", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "hope-run-canonical-"));
  const alias = `${temporaryRoot}-alias`;
  await symlink(temporaryRoot, alias, "dir");
  const created = await createDiffRun(makeSnapshot(), { temporaryRoot });
  const aliasPath = created.path.replace(temporaryRoot, alias);
  const loaded = await loadDiffRun(aliasPath, { temporaryRoot: alias });
  assert.equal(loaded.manifest.runId, created.runId);
});

test("UTF-8 inspection chunks reconstruct the exact source text", () => {
  const snapshot = makeSnapshot();
  const text = Array.from(
    { length: 2_000 },
    (_, index) => `${index + 1}: 모델 복원 상태를 확인합니다.`,
  ).join("\n");
  const source = {
    ...snapshot.sources[2],
    lineCount: 2_000,
    text,
  };
  const pages = buildInspectionPages({
    ...snapshot,
    sources: [...snapshot.sources.slice(0, 2), source],
  });
  const reconstructed = pages
    .filter((page) => page.value?.sourceId === source.id)
    .map((page) => page.value.text)
    .join("\n");
  assert.equal(reconstructed, text);
});

test("inspection chunks account for JSON escaping", () => {
  const snapshot = makeSnapshot();
  const text = Array.from(
    { length: 200 },
    (_, index) => `${index + 1}: ${String.raw`"quoted\\path"`.repeat(8)}`,
  ).join("\n");
  const source = {
    ...snapshot.sources[2],
    lineCount: 200,
    text,
  };
  const pages = buildInspectionPages({
    ...snapshot,
    sources: [...snapshot.sources.slice(0, 2), source],
  });
  const reconstructed = pages
    .filter((page) => page.value?.sourceId === source.id)
    .map((page) => page.value.text)
    .join("\n");

  assert.equal(reconstructed, text);
  for (const page of pages) {
    assert.ok(
      Buffer.byteLength(JSON.stringify(page), "utf8")
        <= LIMITS.inspectionPageBytes,
    );
  }
});

test("large file maps stay within the inspection page limit", () => {
  const snapshot = makeSnapshot();
  const files = Array.from({ length: LIMITS.changedFiles }, (_, index) => ({
    ...snapshot.files[0],
    id: `file-${index + 1}`,
    path: `src/features/${String(index + 1).padStart(3, "0")}-${"context-".repeat(10)}.mjs`,
    sourceIds: [],
  }));
  const pages = buildInspectionPages({
    ...snapshot,
    files,
  });
  const collectedFiles = pages
    .filter((page) => page.kind === "files")
    .flatMap((page) => page.value.files);

  assert.equal(collectedFiles.length, files.length);
  for (const page of pages) {
    assert.ok(
      Buffer.byteLength(JSON.stringify(page), "utf8")
        <= LIMITS.inspectionPageBytes,
    );
  }
});

test("tampered inspection pages fail closed", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "hope-run-tamper-"));
  const created = await createDiffRun(makeSnapshot(), { temporaryRoot });
  const pagesPath = join(created.path, "pages.json");
  const pages = JSON.parse(await readFile(pagesPath, "utf8"));
  pages[0].value.warning = "changed";
  await writeFile(pagesPath, `${JSON.stringify(pages, null, 2)}\n`, "utf8");
  await assert.rejects(
    loadDiffRun(created.path, { temporaryRoot }),
    /inspection page plan is invalid/u,
  );
});

test("a stale snapshot creates no review artifact", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "hope-run-stale-"));
  const outputPath = join(temporaryRoot, "stale.html");
  const snapshot = makeSnapshot();
  const created = await createDiffRun(snapshot, { outputPath, temporaryRoot });
  for (let page = 1; page <= created.pageCount; page += 1) {
    await inspectDiffRun(created.path, page, { temporaryRoot });
  }
  await writeFile(
    created.analysisPath,
    `${JSON.stringify(makeAnalysis(snapshot, created.runId), null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  await assert.rejects(
    finishDiff(created.path, {
      revalidate: async () => ({
        matches: false,
        revalidatedAt: "2026-07-23T00:01:00.000Z",
      }),
      temporaryRoot,
    }),
    /changed while Hope was reviewing/u,
  );
  await assert.rejects(access(outputPath), /ENOENT/u);
  await assert.rejects(loadDiffRun(created.path, { temporaryRoot }), /ENOENT/u);
});
