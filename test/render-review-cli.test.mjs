import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  GhApiError,
  calculateAnalysisPassFingerprint,
  calculateChangeRequestFingerprint,
} from "../plugins/hope/skills/diff/scripts/collect-change-request.mjs";
import {
  loadJsonDocument,
  main,
  MAX_REVIEW_FILE_BYTES,
  parseRenderArguments,
} from "../plugins/hope/skills/diff/scripts/render-review.mjs";
import {
  buildInspectionPages,
  inspectionCompletion,
} from "../plugins/hope/skills/diff/scripts/lib/inspection-pages.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(testDirectory, "fixtures", "review-model-v1.json");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function fixture() {
  return JSON.parse(await readFile(fixturePath, "utf8"));
}

function contextFor(review) {
  const patchBodies = [
    {
      path: "src/routing.mjs",
      text:
        "@@ -1 +1,7 @@\n" +
        "-return service.load(request.id);\n" +
        "+if (!request.id?.trim()) {\n" +
        "+  return { status: 400, code: \"missing_id\" };\n" +
        "+}\n" +
        "+return service.load(request.id);\n" +
        "+audit.validated(request.id);\n" +
        "+metrics.increment(\"valid_request\");\n" +
        "+return response;",
      additions: 7,
      deletions: 1,
    },
    {
      path: "test/routing.test.mjs",
      text:
        "@@ -7,1 +7,5 @@\n" +
        "-assert.equal(response.status, 500);\n" +
        "+assert.equal(response.status, 400);\n" +
        "+assert.equal(repository.calls, 0);\n" +
        "+assert.equal(response.code, \"missing_id\");\n" +
        "+assert.equal(service.calls, 0);\n" +
        "+assert.equal(metrics.calls, 0);",
      additions: 5,
      deletions: 1,
    },
  ];
  const patches = patchBodies.map((patch, index) => ({
    id: `patch-${String(index + 1).padStart(4, "0")}`,
    passId: `pass-${String(index + 1).padStart(3, "0")}`,
    path: patch.path,
    startLine: 1,
    endLine: patch.text.split("\n").length,
    additions: patch.additions,
    deletions: patch.deletions,
    text: patch.text,
  }));
  const passes = patches.map((patch, index) => {
    const pass = {
      id: patch.passId,
      changedLines: patch.additions + patch.deletions,
      patchBytes: Buffer.byteLength(patch.text),
      patchIds: [patch.id],
      paths: [patch.path],
    };
    return {
      ...pass,
      fingerprint: calculateAnalysisPassFingerprint(pass, [patch]),
    };
  });
  const analysisPlan = {
    lineLimitPerPass: 4_000,
    byteLimitPerPass: 64 * 1024,
    passes,
  };
  const context = {
    schemaVersion: 1,
    provider: review.changeRequest.provider,
    host: "github.com",
    repository: review.changeRequest.repository,
    id: review.changeRequest.id,
    url: review.changeRequest.url,
    title: review.changeRequest.title,
    description: "Reject invalid requests before storage.",
    author: review.changeRequest.author,
    state: review.changeRequest.state,
    reviewStage: review.changeRequest.reviewStage,
    isDraft: review.changeRequest.isDraft,
    baseSha: review.changeRequest.baseSha,
    headSha: review.changeRequest.headSha,
    mergeBaseSha: review.changeRequest.mergeBaseSha,
    comparison: clone(review.changeRequest.comparison),
    snapshotFingerprint: "9".repeat(64),
    commitCount: 2,
    commits: [
      {
        sha: "4".repeat(40),
        title: "Validate request identifiers",
        author: "review-author",
      },
      {
        sha: review.changeRequest.headSha,
        title: "Cover missing identifiers",
        author: "review-author",
      },
    ],
    files: clone(review.changeRequest.files),
    patches,
    analysisPlan,
    coverage: {
      ...clone(review.changeRequest.coverage),
      explainableChangedLines: patches.reduce(
        (total, patch) => total + patch.additions + patch.deletions,
        0,
      ),
      patchBytes: patches.reduce(
        (total, patch) => total + Buffer.byteLength(patch.text),
        0,
      ),
    },
    exclusions: clone(review.changeRequest.exclusions),
    warnings: clone(review.changeRequest.warnings),
  };
  review.changeRequest.analysisPlan = clone(analysisPlan);
  review.changeRequest.coverage = clone(context.coverage);
  review.analysisCoverage.processedPasses.forEach((processedPass, index) => {
    processedPass.id = passes[index].id;
    processedPass.fingerprint = passes[index].fingerprint;
  });
  context.fingerprint = calculateChangeRequestFingerprint(context);
  review.changeRequest.fingerprint = context.fingerprint;
  review.analysisCoverage.inspectionProtocolVersion = 1;
  review.analysisCoverage.summary = {
    fingerprint: context.fingerprint,
    ...inspectionCompletion(buildInspectionPages(context, { kind: "summary" })),
  };
  review.analysisCoverage.processedPasses.forEach((processedPass) => {
    Object.assign(
      processedPass,
      inspectionCompletion(
        buildInspectionPages(context, { kind: "pass", passId: processedPass.id }),
      ),
    );
  });
  return context;
}

async function putInputs(t, review, context) {
  const directory = await mkdtemp(join(tmpdir(), "hope-context-"));
  t.after(async () => await rm(directory, { recursive: true, force: true }));
  const input = join(directory, "review-model.json");
  const contextPath = join(directory, "change-request.json");
  await writeFile(input, JSON.stringify(review));
  await writeFile(contextPath, JSON.stringify(context));
  return { directory, input, contextPath };
}

test("parses the narrow renderer CLI and restricts cleanup to Hope-owned inputs", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ordinary-inputs-"));
  t.after(async () => await rm(directory, { recursive: true, force: true }));
  const input = join(directory, "review-model.json");
  const context = join(directory, "change-request.json");
  await writeFile(input, "keep-review");
  await writeFile(context, "keep-context");

  assert.throws(
    () =>
      parseRenderArguments([
        "--input",
        input,
        "--context",
        context,
        "--cleanup",
      ]),
    /Hope-owned temporary directory/u,
  );
  assert.throws(
    () => parseRenderArguments(["--context", context, "--cleanup"]),
    /Hope-owned temporary directory/u,
  );
  assert.equal(await readFile(input, "utf8"), "keep-review");
  assert.equal(await readFile(context, "utf8"), "keep-context");
  assert.throws(
    () => parseRenderArguments(["--input", input, "--context", input]),
    /must be different/u,
  );
  assert.throws(
    () => parseRenderArguments([
      "--input",
      input,
      "--context",
      context,
      "--validate-only",
      "--cleanup",
    ]),
    /cannot be combined/u,
  );
  assert.throws(
    () => parseRenderArguments([
      "--input",
      input,
      "--context",
      context,
      "--validate-only",
      "--output",
      "review.html",
    ]),
    /not allowed with --validate-only/u,
  );
});

test("cleanup-only mode removes an interrupted Hope context without a valid review", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hope-context-"));
  const input = join(directory, "review-model.json");
  const context = join(directory, "change-request.json");
  await writeFile(input, "incomplete model");
  await writeFile(context, "private PR context");

  const result = await main(["--context", context, "--cleanup"]);

  assert.deepEqual(result, { cleaned: true });
  await assert.rejects(lstat(input), { code: "ENOENT" });
  await assert.rejects(lstat(context), { code: "ENOENT" });
  await assert.rejects(lstat(directory), { code: "ENOENT" });
});

test("cleanup-only mode refuses a symlinked Hope directory", async (t) => {
  const target = await mkdtemp(join(tmpdir(), "cleanup-target-"));
  const link = join(tmpdir(), `hope-context-link-${process.pid}-${Date.now()}`);
  t.after(async () => await rm(target, { recursive: true, force: true }));
  t.after(async () => await rm(link, { force: true }));
  await writeFile(join(target, "change-request.json"), "keep-private-context");
  await symlink(target, link);

  await assert.rejects(
    main(["--context", join(link, "change-request.json"), "--cleanup"]),
    /non-symlink temporary directory/u,
  );
  assert.equal(
    await readFile(join(target, "change-request.json"), "utf8"),
    "keep-private-context",
  );
});

test(
  "cleanup-only mode refuses a non-private Hope directory on POSIX",
  { skip: process.platform === "win32" },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "hope-context-"));
    t.after(async () => await rm(directory, { recursive: true, force: true }));
    const input = join(directory, "review-model.json");
    const context = join(directory, "change-request.json");
    await writeFile(input, "keep-review");
    await writeFile(context, "keep-context");
    await chmod(directory, 0o755);

    await assert.rejects(
      main(["--context", context, "--cleanup"]),
      /private, non-symlink temporary directory/u,
    );
    assert.equal(await readFile(input, "utf8"), "keep-review");
    assert.equal(await readFile(context, "utf8"), "keep-context");
  },
);

test("loads JSON through one bounded non-symlink file handle", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "review-input-test-"));
  t.after(async () => await rm(directory, { recursive: true, force: true }));
  const source = join(directory, "source.json");
  const link = join(directory, "link.json");
  await writeFile(source, '{"ok":true}');
  await symlink(source, link);

  assert.deepEqual(await loadJsonDocument(source, "fixture", 100), { ok: true });
  await assert.rejects(loadJsonDocument(link, "fixture", 100), /non-symlink/u);
  await assert.rejects(loadJsonDocument(source, "fixture", 4), /byte limit/u);

  const secret = "sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ123456";
  await writeFile(source, `{"value":"${secret}",`);
  await assert.rejects(
    loadJsonDocument(source, "fixture", 100),
    (error) => /not valid JSON/u.test(error.message) && !error.message.includes(secret),
  );
});

test("allows bounded JSON formatting overhead above the compact model budget", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "review-formatting-test-"));
  t.after(async () => await rm(directory, { recursive: true, force: true }));
  const source = join(directory, "source.json");
  const formatting = " ".repeat(MAX_REVIEW_FILE_BYTES / 2 + 1);
  await writeFile(source, `{"ok":true}${formatting}`);

  assert.deepEqual(
    await loadJsonDocument(source, "fixture", MAX_REVIEW_FILE_BYTES),
    { ok: true },
  );
  await assert.rejects(
    loadJsonDocument(source, "fixture", MAX_REVIEW_FILE_BYTES / 2),
    /byte limit/u,
  );
});

test("renders one HTML and removes both transient inputs on success", async (t) => {
  const review = await fixture();
  const context = contextFor(review);
  const inputs = await putInputs(t, review, context);

  const result = await main(
    [
      "--input",
      inputs.input,
      "--context",
      inputs.contextPath,
      "--cleanup",
    ],
    {
      collectChangeRequest: async () => clone(context),
      readCurrentSnapshot: async () => clone(context),
    },
  );
  t.after(async () => await rm(dirname(result.file), { recursive: true, force: true }));

  assert.equal((await lstat(result.file)).isFile(), true);
  await assert.rejects(lstat(inputs.input), { code: "ENOENT" });
  await assert.rejects(lstat(inputs.contextPath), { code: "ENOENT" });
  await assert.rejects(lstat(inputs.directory), { code: "ENOENT" });
});

test("validates without rendering or removing retryable inputs", async (t) => {
  const review = await fixture();
  const context = contextFor(review);
  const inputs = await putInputs(t, review, context);
  let writes = 0;

  const result = await main(
    [
      "--input",
      inputs.input,
      "--context",
      inputs.contextPath,
      "--validate-only",
    ],
    {
      collectChangeRequest: async () => clone(context),
      readCurrentSnapshot: async () => clone(context),
      writeReviewHtml: async () => {
        writes += 1;
        return { file: "unreachable" };
      },
    },
  );

  assert.deepEqual(result, { validated: true });
  assert.equal(writes, 0);
  assert.equal((await lstat(inputs.input)).isFile(), true);
  assert.equal((await lstat(inputs.contextPath)).isFile(), true);
});

test("keeps inputs after a correctable validate-only model error", async (t) => {
  const review = await fixture();
  const context = contextFor(review);
  review.quiz.questions = [];
  const inputs = await putInputs(t, review, context);

  await assert.rejects(
    main(
      [
        "--input",
        inputs.input,
        "--context",
        inputs.contextPath,
        "--validate-only",
      ],
      {
        collectChangeRequest: async () => clone(context),
        readCurrentSnapshot: async () => clone(context),
      },
    ),
    /ReviewModelV1 validation failed/u,
  );
  assert.equal((await lstat(inputs.input)).isFile(), true);
  assert.equal((await lstat(inputs.contextPath)).isFile(), true);
});

test("refuses an initially stale review before calling the writer", async (t) => {
  const review = await fixture();
  const context = contextFor(review);
  const inputs = await putInputs(t, review, context);
  const changed = clone(context);
  changed.title = "Changed title";
  changed.fingerprint = calculateChangeRequestFingerprint(changed);
  let writes = 0;

  await assert.rejects(
    main(
      [
        "--input",
        inputs.input,
        "--context",
        inputs.contextPath,
        "--cleanup",
      ],
      {
        collectChangeRequest: async () => changed,
        writeReviewHtml: async () => {
          writes += 1;
          return { file: "unreachable" };
        },
      },
    ),
    /changed while Hope was preparing/u,
  );
  assert.equal(writes, 0);
  await assert.rejects(lstat(inputs.directory), { code: "ENOENT" });
});

test("recollects the full Change Request and rejects a locally re-fingerprinted patch", async (t) => {
  const review = await fixture();
  const liveContext = contextFor(review);
  const storedContext = clone(liveContext);
  const firstPatch = storedContext.patches[0];
  firstPatch.text = firstPatch.text.replace("missing_id", "missing_ix");
  const firstPass = storedContext.analysisPlan.passes[0];
  firstPass.fingerprint = calculateAnalysisPassFingerprint(firstPass, [firstPatch]);
  storedContext.fingerprint = calculateChangeRequestFingerprint(storedContext);
  review.changeRequest.analysisPlan = clone(storedContext.analysisPlan);
  review.changeRequest.fingerprint = storedContext.fingerprint;
  review.analysisCoverage.processedPasses[0].fingerprint = firstPass.fingerprint;
  const inputs = await putInputs(t, review, storedContext);
  let writes = 0;

  await assert.rejects(
    main(
      [
        "--input",
        inputs.input,
        "--context",
        inputs.contextPath,
        "--cleanup",
      ],
      {
        collectChangeRequest: async () => clone(liveContext),
        readCurrentSnapshot: async () => clone(liveContext),
        writeReviewHtml: async () => {
          writes += 1;
          return { file: "unreachable" };
        },
      },
    ),
    /changed while Hope was preparing/u,
  );
  assert.equal(writes, 0);
  await assert.rejects(lstat(inputs.directory), { code: "ENOENT" });
});

test("removes a rendered HTML when the final snapshot is stale", async (t) => {
  const review = await fixture();
  const context = contextFor(review);
  const inputs = await putInputs(t, review, context);
  const outputDirectory = await mkdtemp(join(tmpdir(), "hope-review-"));
  const output = join(outputDirectory, "hope-review.html");
  await writeFile(output, "rendered");

  await assert.rejects(
    main(
      [
        "--input",
        inputs.input,
        "--context",
        inputs.contextPath,
        "--cleanup",
      ],
      {
        collectChangeRequest: async () => clone(context),
        readCurrentSnapshot: async () => ({ ...clone(context), title: "Changed title" }),
        writeReviewHtml: async () => ({ file: output }),
      },
    ),
    /changed before the Hope review was finalized/u,
  );
  await assert.rejects(lstat(outputDirectory), { code: "ENOENT" });
});

test("fails closed with a distinct message when final revalidation is unavailable", async (t) => {
  const review = await fixture();
  const context = contextFor(review);
  const inputs = await putInputs(t, review, context);
  const outputDirectory = await mkdtemp(join(tmpdir(), "hope-review-"));
  const output = join(outputDirectory, "hope-review.html");
  await writeFile(output, "rendered");

  await assert.rejects(
    main(
      [
        "--input",
        inputs.input,
        "--context",
        inputs.contextPath,
        "--cleanup",
      ],
      {
        collectChangeRequest: async () => clone(context),
        readCurrentSnapshot: async () => {
          throw new GhApiError("offline", "transport");
        },
        writeReviewHtml: async () => ({ file: output }),
      },
    ),
    /could not revalidate/u,
  );
  await assert.rejects(lstat(outputDirectory), { code: "ENOENT" });
});

test("keeps the primary parse error while cleaning malformed Hope inputs", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "hope-context-"));
  t.after(async () => await rm(directory, { recursive: true, force: true }));
  const input = join(directory, "review-model.json");
  const context = join(directory, "change-request.json");
  await writeFile(input, "not json");
  await writeFile(context, "also not json");

  await assert.rejects(
    main(["--input", input, "--context", context, "--cleanup"]),
    /ReviewModelV1 input is not valid JSON/u,
  );
  await assert.rejects(lstat(directory), { code: "ENOENT" });
});
