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
  calculateChangeRequestFingerprint,
} from "../plugins/hope/skills/diff/scripts/collect-change-request.mjs";
import {
  loadJsonDocument,
  main,
  parseRenderArguments,
} from "../plugins/hope/skills/diff/scripts/render-review.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(testDirectory, "fixtures", "review-model-v1.json");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function fixture() {
  return JSON.parse(await readFile(fixturePath, "utf8"));
}

function contextFor(review) {
  const patches = [
    {
      path: "src/routing.mjs",
      text:
        "@@ -1 +1,5 @@\n" +
        "+if (!request.id?.trim()) {\n" +
        "+  return { status: 400, code: \"missing_id\" };\n" +
        "+}\n" +
        " return service.load(request.id);",
    },
    {
      path: "test/routing.test.mjs",
      text:
        "@@ -7,2 +7,2 @@\n" +
        "+assert.equal(response.status, 400);\n" +
        "+assert.equal(repository.calls, 0);",
    },
  ];
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
    coverage: {
      ...clone(review.changeRequest.coverage),
      patchBytes: patches.reduce(
        (total, patch) => total + Buffer.byteLength(patch.text),
        0,
      ),
    },
    exclusions: clone(review.changeRequest.exclusions),
    warnings: clone(review.changeRequest.warnings),
  };
  review.changeRequest.coverage = clone(context.coverage);
  context.fingerprint = calculateChangeRequestFingerprint(context);
  review.changeRequest.fingerprint = context.fingerprint;
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
        readCurrentSnapshot: async () => changed,
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
