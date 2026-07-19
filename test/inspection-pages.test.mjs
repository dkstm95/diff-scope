import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  calculateAnalysisPassFingerprint,
  calculateChangeRequestFingerprint,
} from "../plugins/hope/skills/diff/scripts/collect-change-request.mjs";
import {
  buildInspectionPages,
  inspectionCompletion,
  MAX_INSPECTION_OUTPUT_BYTES,
  selectInspectionPage,
} from "../plugins/hope/skills/diff/scripts/lib/inspection-pages.mjs";
import { readChangeRequestContext } from "../plugins/hope/skills/diff/scripts/inspect-change-request.mjs";

const execFile = promisify(execFileCallback);
const inspector = new URL(
  "../plugins/hope/skills/diff/scripts/inspect-change-request.mjs",
  import.meta.url,
);
const inspectorPath = fileURLToPath(inspector);

test("does not echo malformed context source in JSON diagnostics", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "hope-inspector-parse-"));
  t.after(async () => await rm(directory, { recursive: true, force: true }));
  const contextPath = join(directory, "change-request.json");
  const secret = "sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ123456";
  await writeFile(contextPath, `{"value":"${secret}",`);

  await assert.rejects(
    readChangeRequestContext(contextPath),
    (error) => /not valid JSON/u.test(error.message) && !error.message.includes(secret),
  );
});

function makeContext({ patchText = "@@ -1 +1 @@\n-old\n+new\n" } = {}) {
  const patch = {
    id: "patch-0001",
    passId: "pass-001",
    path: "src/example.mjs",
    startLine: 1,
    endLine: patchText.split("\n").length - 1,
    additions: 1,
    deletions: 1,
    text: patchText,
  };
  const passWithoutFingerprint = {
    id: "pass-001",
    changedLines: 2,
    patchBytes: Buffer.byteLength(patchText),
    patchIds: [patch.id],
    paths: [patch.path],
  };
  const pass = {
    ...passWithoutFingerprint,
    fingerprint: calculateAnalysisPassFingerprint(passWithoutFingerprint, [patch]),
  };
  const withoutFingerprint = {
    schemaVersion: 1,
    provider: "github",
    host: "github.com",
    repository: "acme/widgets",
    id: "17",
    url: "https://github.com/acme/widgets/pull/17",
    title: "Bound inspector output",
    description: "Explain every bounded page.",
    author: "contributor",
    state: "open",
    reviewStage: "ready",
    isDraft: false,
    baseSha: "1".repeat(40),
    headSha: "3".repeat(40),
    mergeBaseSha: "2".repeat(40),
    comparison: {
      kind: "merge-base-to-head",
      fromSha: "2".repeat(40),
      toSha: "3".repeat(40),
    },
    snapshotFingerprint: "4".repeat(64),
    commitCount: 1,
    commits: [{ sha: "3".repeat(40), title: "Bound output", author: "contributor" }],
    files: [{
      path: patch.path,
      previousPath: null,
      status: "modified",
      additions: 1,
      deletions: 1,
      bodyState: "included",
    }],
    patches: [patch],
    analysisPlan: {
      lineLimitPerPass: 4_000,
      byteLimitPerPass: 64 * 1024,
      passes: [pass],
    },
    coverage: {
      status: "complete",
      discoveredFiles: 1,
      representedFiles: 1,
      includedBodies: 1,
      metadataOnlyBodies: 0,
      additions: 1,
      deletions: 1,
      changedLines: 2,
      explainableChangedLines: 2,
      patchBytes: Buffer.byteLength(patchText),
    },
    exclusions: [],
    warnings: [],
  };
  return {
    ...withoutFingerprint,
    fingerprint: calculateChangeRequestFingerprint(withoutFingerprint),
  };
}

function outputBytes(page) {
  return Buffer.byteLength(`${JSON.stringify(page)}\n`);
}

test("paginates large summary metadata deterministically within stdout bounds", () => {
  const context = makeContext();
  context.description = `Intent ${"\\\"".repeat(20_000)}`;
  context.commits = Array.from({ length: 250 }, (_, index) => ({
    sha: String((index % 9) + 1).repeat(40),
    title: `Commit ${index} ${"x".repeat(500)}`,
    author: "contributor",
  }));
  context.commitCount = context.commits.length;
  context.files = Array.from({ length: 200 }, (_, index) => ({
    path: `src/generated/file-${String(index).padStart(3, "0")}.mjs`,
    previousPath: null,
    status: "modified",
    additions: index === 0 ? 1 : 0,
    deletions: index === 0 ? 1 : 0,
    bodyState: index === 0 ? "included" : "generated-or-lockfile",
  }));
  context.fingerprint = "a".repeat(64);

  const pages = buildInspectionPages(context, { kind: "summary" });
  assert.ok(pages.length > 10);
  assert.ok(pages.every((page) => outputBytes(page) <= MAX_INSPECTION_OUTPUT_BYTES));
  assert.ok(pages.flatMap((page) => page.entries).some((entry) => entry.pointer === "/files/199"));
  assert.ok(pages.flatMap((page) => page.entries).some((entry) => entry.pointer === "/commits/249"));
  assert.ok(pages.flatMap((page) => page.entries).some((entry) => entry.pointer === "/description" && entry.stringChunk));
  assert.equal(Object.keys(pages.at(-1)).at(-1), "receipt");

  const reordered = Object.fromEntries(Object.entries(context).reverse());
  reordered.analysisPlan = Object.fromEntries(Object.entries(context.analysisPlan).reverse());
  assert.deepEqual(buildInspectionPages(reordered, { kind: "summary" }), pages);
});

test("walks a 64 KiB pass through view-bound receipts without splitting Unicode", () => {
  const patchText = `@@ -1 +1 @@\n-old\n+${"🙂\\\"".repeat(8_000)}\n`;
  const context = makeContext({ patchText });
  const pages = buildInspectionPages(context, { kind: "pass", passId: "pass-001" });
  assert.ok(pages.length > 1);
  assert.ok(pages.length <= 8);
  assert.ok(pages.every((page) => outputBytes(page) <= MAX_INSPECTION_OUTPUT_BYTES));

  const text = pages
    .flatMap((page) => page.entries)
    .filter((entry) => entry.pointer === "/patches/0/text")
    .sort((left, right) => left.stringChunk.number - right.stringChunk.number)
    .map((entry) => entry.stringChunk.text)
    .join("");
  assert.equal(text, patchText);

  let page = selectInspectionPage(pages, undefined);
  while (page.page.hasNext) page = selectInspectionPage(pages, page.receipt);
  assert.deepEqual(inspectionCompletion(pages), {
    pageCount: pages.length,
    terminalReceipt: page.receipt,
  });
  assert.throws(() => selectInspectionPage(pages, page.receipt), /terminal receipt/u);
  assert.throws(() => selectInspectionPage(pages, "f".repeat(64)), /snapshot and inspection view/u);
});

test("CLI emits one compact complete page and continues only from its receipt", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "hope-inspection-pages-"));
  t.after(async () => await rm(directory, { recursive: true, force: true }));
  const contextPath = join(directory, "change-request.json");
  await writeFile(contextPath, JSON.stringify(makeContext()), { mode: 0o600 });

  const first = await execFile(process.execPath, [
    inspectorPath,
    "--context",
    contextPath,
    "--summary",
  ]);
  assert.ok(Buffer.byteLength(first.stdout) <= MAX_INSPECTION_OUTPUT_BYTES);
  const page = JSON.parse(first.stdout);
  assert.equal(page.page.number, 1);
  assert.equal(Object.keys(page).at(-1), "receipt");

  await assert.rejects(
    execFile(process.execPath, [
      inspectorPath,
      "--context",
      contextPath,
      "--summary",
      "--after",
      "f".repeat(64),
    ]),
    /does not match a receipt/u,
  );
});
