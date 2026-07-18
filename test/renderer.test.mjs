import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  renderReviewHtml,
  serializeReviewForHtml,
  writeReviewHtml,
} from "../plugins/hope/skills/diff/scripts/lib/render-review.mjs";
import {
  ChangeRequestBindingError,
  ReviewValidationError,
  validateReviewAgainstChangeRequest,
  validateReviewModel,
} from "../plugins/hope/skills/diff/scripts/lib/validate-review.mjs";
import { collectSecretIssues } from "../plugins/hope/skills/diff/scripts/lib/safety.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(testDirectory, "fixtures", "review-model-v1.json");

async function fixture() {
  return JSON.parse(await readFile(fixturePath, "utf8"));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mode(status) {
  return status.mode & 0o777;
}

function changeRequestForReview(review) {
  return {
    schemaVersion: 1,
    provider: review.changeRequest.provider,
    host: "github.com",
    repository: review.changeRequest.repository,
    id: review.changeRequest.id,
    url: review.changeRequest.url,
    title: review.changeRequest.title,
    description: "Reject invalid requests before storage and preserve valid request behavior.",
    author: review.changeRequest.author,
    state: review.changeRequest.state,
    reviewStage: review.changeRequest.reviewStage,
    isDraft: review.changeRequest.isDraft,
    baseSha: review.changeRequest.baseSha,
    headSha: review.changeRequest.headSha,
    mergeBaseSha: review.changeRequest.mergeBaseSha,
    comparison: clone(review.changeRequest.comparison),
    snapshotFingerprint: "9".repeat(64),
    commitCount: review.changeRequest.commitCount,
    commits: [
      {
        sha: "4444444444444444444444444444444444444444",
        title: "Validate request identifiers",
        author: "review-author",
      },
      {
        sha: "5555555555555555555555555555555555555555",
        title: "Cover missing identifiers",
        author: "review-author",
      },
    ],
    files: clone(review.changeRequest.files),
    patches: [
      {
        path: "src/routing.mjs",
        text:
          "diff --git a/src/routing.mjs b/src/routing.mjs\n" +
          "--- a/src/routing.mjs\n+++ b/src/routing.mjs\n@@ -1,3 +1,6 @@\n" +
          "+if (!request.id?.trim()) {\n" +
          "+  return { status: 400, code: \"missing_id\" };\n" +
          "+}\n" +
          " return service.load(request.id);\n",
      },
      {
        path: "test/routing.test.mjs",
        text:
          "diff --git a/test/routing.test.mjs b/test/routing.test.mjs\n" +
          "--- a/test/routing.test.mjs\n+++ b/test/routing.test.mjs\n@@ -7,2 +7,3 @@\n" +
          "+assert.equal(response.status, 400);\n" +
          "+assert.equal(repository.calls, 0);\n",
      },
    ],
    coverage: clone(review.changeRequest.coverage),
    exclusions: clone(review.changeRequest.exclusions),
    warnings: clone(review.changeRequest.warnings),
    fingerprint: review.changeRequest.fingerprint,
  };
}

test("validates the complete ReviewModelV1 fixture", async () => {
  const review = await fixture();
  assert.equal(validateReviewModel(review), review);
  assert.equal(validateReviewAgainstChangeRequest(review, changeRequestForReview(review)), review);
});

test("binds every mirrored ChangeRequest field exactly", async (t) => {
  const review = await fixture();
  const source = changeRequestForReview(review);
  const mutations = {
    provider: "gitlab",
    repository: "other/repository",
    id: "43",
    url: "https://github.com/dkstm95/example/pull/43",
    title: "Different title",
    author: "another-author",
    state: "closed",
    reviewStage: "abandoned",
    isDraft: true,
    baseSha: "6".repeat(40),
    headSha: "7".repeat(40),
    mergeBaseSha: "8".repeat(40),
    comparison: { kind: "merge-base-to-head", fromSha: "8".repeat(40), toSha: "7".repeat(40) },
    commitCount: 3,
    fingerprint: "b".repeat(64),
    coverage: { ...source.coverage, changedLines: source.coverage.changedLines + 1 },
    warnings: ["bounded warning"],
    exclusions: [{ path: "large.txt", reason: "size limit" }],
    files: source.files.slice().reverse(),
  };
  for (const [key, replacement] of Object.entries(mutations)) {
    await t.test(key, () => {
      const context = clone(source);
      context[key] = replacement;
      assert.throws(
        () => validateReviewAgainstChangeRequest(review, context),
        (error) => error instanceof ChangeRequestBindingError && error.message.includes(key),
      );
    });
  }
});

test("refuses blocked Change Request coverage", async () => {
  const review = await fixture();
  const context = changeRequestForReview(review);
  review.changeRequest.coverage.status = "blocked";
  context.coverage.status = "blocked";
  assert.throws(
    () => validateReviewAgainstChangeRequest(review, context),
    /coverage is blocked/,
  );
});

test("binds code, test, commit, and selected excerpt evidence", async (t) => {
  const review = await fixture();

  await t.test("unknown changed path", () => {
    const candidate = clone(review);
    candidate.evidence.find((entry) => entry.id === "router-guard").path = "src/unknown.mjs";
    assert.throws(() => validateReviewModel(candidate), /must reference a changed file/);
  });

  await t.test("metadata-only changed path", () => {
    const candidate = clone(review);
    candidate.changeRequest.files[0].bodyState = "binary";
    assert.throws(() => validateReviewModel(candidate), /included or redacted body/);
  });

  await t.test("missing collected patch", () => {
    const context = changeRequestForReview(review);
    context.patches = context.patches.slice(1);
    assert.throws(
      () => validateReviewAgainstChangeRequest(review, context),
      /has no included ChangeRequestV1 patch/,
    );
  });

  await t.test("unknown commit", () => {
    const candidate = clone(review);
    candidate.evidence.find((entry) => entry.id === "validation-commit").commitSha = "9".repeat(40);
    assert.throws(
      () => validateReviewAgainstChangeRequest(candidate, changeRequestForReview(candidate)),
      /is not included in ChangeRequestV1.commits/,
    );
  });

  await t.test("hallucinated excerpt", () => {
    const candidate = clone(review);
    candidate.evidence.find((entry) => entry.id === "router-guard").excerpt =
      "return launchUncollectedBehavior();";
    assert.throws(
      () => validateReviewAgainstChangeRequest(candidate, changeRequestForReview(candidate)),
      /excerpt does not occur in the collected ChangeRequestV1 patch/,
    );
  });

  await t.test("hallucinated PR-description excerpt", () => {
    const candidate = clone(review);
    candidate.evidence.find((entry) => entry.id === "pr-description").excerpt =
      "An author declaration that is not in the PR body";
    assert.throws(
      () => validateReviewAgainstChangeRequest(candidate, changeRequestForReview(candidate)),
      /does not occur in ChangeRequestV1.description/u,
    );
  });

  await t.test("hallucinated commit-title excerpt", () => {
    const candidate = clone(review);
    candidate.evidence.find((entry) => entry.id === "validation-commit").excerpt =
      "A different commit title";
    assert.throws(
      () => validateReviewAgainstChangeRequest(candidate, changeRequestForReview(candidate)),
      /does not occur in the bound ChangeRequestV1 commit title/u,
    );
  });

  await t.test("unbound line coordinates", () => {
    const candidate = clone(review);
    const evidence = candidate.evidence.find((entry) => entry.id === "router-guard");
    evidence.side = "head";
    evidence.startLine = 3;
    evidence.endLine = 6;
    assert.throws(
      () => validateReviewModel(candidate),
      /must be null in this alpha/u,
    );
  });

  await t.test("raw diff marker excerpt", () => {
    const candidate = clone(review);
    candidate.evidence.find((entry) => entry.id === "routing-test").excerpt =
      "+assert.equal(response.status, 400);";
    assert.doesNotThrow(() =>
      validateReviewAgainstChangeRequest(candidate, changeRequestForReview(candidate)),
    );
  });
});

test("requires evidence for claim basis and an author question for unknown claims", async (t) => {
  const review = await fixture();

  await t.test("declared", () => {
    const candidate = clone(review);
    candidate.background[0].evidenceIds = ["router-guard"];
    assert.throws(() => validateReviewModel(candidate), /PR description or commit evidence/);
  });

  await t.test("observed", () => {
    const candidate = clone(review);
    candidate.overview.summary.evidenceIds = ["pr-description"];
    assert.throws(() => validateReviewModel(candidate), /code or test evidence/);
  });

  await t.test("inferred", () => {
    const candidate = clone(review);
    candidate.risks[0].evidenceIds = [];
    assert.throws(() => validateReviewModel(candidate), /must cite evidence for inferred claims/);
  });

  await t.test("unknown", () => {
    const candidate = clone(review);
    candidate.authorQuestions = [];
    assert.throws(() => validateReviewModel(candidate), /requires an author question/);
  });

  await t.test("dangling evidence", () => {
    const candidate = clone(review);
    candidate.risks[0].evidenceIds = ["unknown-evidence"];
    assert.throws(() => validateReviewModel(candidate), /references unknown evidence/);
  });
});

test("keeps the literate diff selective, unique, and evidence-backed", async (t) => {
  const review = await fixture();

  await t.test("unknown file", () => {
    const candidate = clone(review);
    candidate.literateDiff[0].path = "src/not-changed.mjs";
    assert.throws(() => validateReviewModel(candidate), /must reference a changed file/);
  });

  await t.test("duplicate selected path", () => {
    const candidate = clone(review);
    candidate.literateDiff[1].path = candidate.literateDiff[0].path;
    assert.throws(() => validateReviewModel(candidate), /duplicates path/);
  });

  await t.test("metadata-only file", () => {
    const candidate = clone(review);
    candidate.changeRequest.files[0].bodyState = "generated-or-lockfile";
    assert.throws(() => validateReviewModel(candidate), /included or redacted body/);
  });

  await t.test("unrelated-file evidence", () => {
    const candidate = clone(review);
    candidate.literateDiff[0].changes[0].evidenceIds = ["routing-test"];
    assert.throws(
      () => validateReviewModel(candidate),
      /must cite code or test evidence for src\/routing\.mjs/u,
    );
  });
});

test("does not claim repository verification passed without collected CI evidence", async () => {
  const review = await fixture();
  review.verification[0].status = "passed";
  assert.throws(() => validateReviewModel(review), /status must be not-run, unknown/u);
});

test("validates deliberate visual models", async (t) => {
  const review = await fixture();

  await t.test("omission requires a reason", () => {
    const candidate = clone(review);
    candidate.visuals = [];
    candidate.visualOmissionReason = null;
    assert.throws(() => validateReviewModel(candidate), /visualOmissionReason is required/);
  });

  await t.test("reason is null when visuals exist", () => {
    const candidate = clone(review);
    candidate.visualOmissionReason = "Not needed";
    assert.throws(() => validateReviewModel(candidate), /must be null/);
  });

  await t.test("unsupported kind", () => {
    const candidate = clone(review);
    candidate.visuals[0].kind = "mermaid";
    assert.throws(() => validateReviewModel(candidate), /kind must be/);
  });

  await t.test("decision table rows match columns", () => {
    const candidate = clone(review);
    candidate.visuals = [{
      id: "decision-visual",
      kind: "decision-table",
      title: "Decision table",
      caption: "Expected outcomes",
      evidenceIds: ["router-guard"],
      columns: ["Input", "Outcome"],
      rows: [{ label: "Missing", cells: ["missing", "400", "extra"] }],
    }];
    assert.throws(() => validateReviewModel(candidate), /must match the decision-table column count/);
  });
});

test("requires a focused evidence-backed quiz", async (t) => {
  const review = await fixture();

  await t.test("prediction", () => {
    const candidate = clone(review);
    candidate.quiz.questions[0].category = "flow";
    assert.throws(() => validateReviewModel(candidate), /include a prediction question/);
  });

  await t.test("invariant or risk", () => {
    const candidate = clone(review);
    candidate.quiz.questions[1].category = "flow";
    assert.throws(() => validateReviewModel(candidate), /include an invariant or risk question/);
  });

  await t.test("single answer", () => {
    const candidate = clone(review);
    candidate.quiz.questions[0].correctOptionIds.push("query-store");
    assert.throws(() => validateReviewModel(candidate), /exactly one answer for single/);
  });

  await t.test("three to five questions", () => {
    const candidate = clone(review);
    candidate.quiz.questions = candidate.quiz.questions.slice(0, 2);
    assert.throws(() => validateReviewModel(candidate), /between 3 and 5 items/);
  });
});

test("supports no microworld and validates exact optional microworld coverage", async (t) => {
  const review = await fixture();
  const absent = clone(review);
  absent.microworld = null;
  assert.doesNotThrow(() => validateReviewModel(absent));
  assert.match(renderReviewHtml(absent), /"microworld":null/);

  await t.test("missing combination", () => {
    const candidate = clone(review);
    candidate.microworld.scenarios.pop();
    assert.throws(() => validateReviewModel(candidate), /missing a control combination|between 2 and 12 items/);
  });

  await t.test("duplicate combination", () => {
    const candidate = clone(review);
    candidate.microworld.scenarios[1].when = clone(candidate.microworld.scenarios[0].when);
    assert.throws(() => validateReviewModel(candidate), /duplicates a control combination/);
  });

  await t.test("more than twelve combinations", () => {
    const candidate = clone(review);
    candidate.microworld.controls = Array.from({ length: 3 }, (_, controlIndex) => ({
      id: `control-${controlIndex}`,
      label: `Control ${controlIndex}`,
      defaultOptionId: "option-0",
      options: Array.from({ length: 3 }, (_, optionIndex) => ({
        id: `option-${optionIndex}`,
        text: `Option ${optionIndex}`,
      })),
    }));
    assert.throws(() => validateReviewModel(candidate), /more than 12 combinations/);
  });
});

test("rejects high-confidence secrets anywhere in the ReviewModel", async (t) => {
  const cases = [
    ["Bearer", "Bearer abcdefghijklmnopqrstuvwxyz"],
    ["quoted JSON assignment", '{"private_key":"super-secret-material"}'],
    ["bracketed assignment", 'config["client_secret"] = "literal-client-material"'],
  ];
  for (const [name, secret] of cases) {
    await t.test(name, async () => {
      const review = await fixture();
      review.overview.summary.text = secret;
      assert.throws(
        () => validateReviewModel(review),
        (error) => error instanceof ReviewValidationError && /suspected/.test(error.message),
      );
    });
  }
});

test("distinguishes secret-detector declarations from credential assignments", () => {
  assert.deepEqual(collectSecretIssues("const SECRET_PATTERNS = ["), []);
  assert.deepEqual(collectSecretIssues("const passwordRules = {"), []);
  assert.deepEqual(collectSecretIssues("const CLIENT_SECRET_REGEXES = ["), []);

  for (const assignment of [
    "const SECRET = [",
    "const CLIENT_SECRET = {",
    "AWS_SECRET_ACCESS_KEY = [",
    "MY_API_KEY = {",
    "MYAPIKEY = [",
    "PASSWORD_HASH = [",
    "TOKEN_VALUE = {",
    "SECRET_VALUE = [",
    "SECRET_CLIENT_KEY = {",
    'SECRET_PATTERNS = ["literal-client-material"]',
  ]) {
    assert.match(collectSecretIssues(assignment).join("\n"), /secret assignment/u);
  }
});

test("renders deterministic offline HTML with inert untrusted text", async () => {
  const review = await fixture();
  review.overview.summary.text = "경계를 확인한다 </script><script>alert('unsafe')</script> & \u2028";
  const first = renderReviewHtml(review);
  const second = renderReviewHtml(review);
  assert.equal(first, second);
  assert.match(first, /Hope · diff/);
  assert.match(first, /Review snapshot/);
  assert.match(first, /Questions for the author/);
  assert.match(first, /Literate diff/);
  assert.match(first, /Understanding quiz/);
  assert.match(first, /Microworld/);
  assert.match(first, /Consider preserving/);
  assert.match(first, /Base SHA/);
  assert.match(first, /Merge-base SHA/);
  assert.match(first, /Head SHA/);
  assert.match(first, /PR title/);
  assert.match(first, /Content-Security-Policy/);
  assert.match(first, /default-src 'none'/);
  assert.match(first, /connect-src 'none'/);
  assert.match(first, /frame-src 'none'/);
  assert.match(first, /worker-src 'none'/);
  assert.match(first, /script-src 'sha256-[A-Za-z0-9+/=]+'/);
  assert.match(first, /document\.createElement/);
  assert.match(first, /\.textContent/);
  assert.match(first, /file\.previousPath/u);
  assert.match(first, /correctOptionIds/);
  assert.match(first, /selected\.size === expected\.size/);
  assert.match(first, /candidate\.when\.find/);
  assert.match(first, /This is a bounded explanatory model/);
  assert.doesNotMatch(first, /<\/script><script>alert\('unsafe'\)/);
  assert.match(first, /\\u003c\/script\\u003e\\u003cscript\\u003e/);
  assert.match(first, /\\u0026/);
  assert.doesNotMatch(first, /innerHTML/);
  assert.doesNotMatch(first, /\beval\s*\(/);
  assert.doesNotMatch(first, /\bfetch\s*\(/);
  assert.doesNotMatch(first, /XMLHttpRequest|WebSocket|EventSource|new\s+Function/);
  assert.doesNotMatch(first, /<script[^>]+src=|<link[^>]+href=|<img[^>]+src=/);
});

test("serializes selected excerpts as inert data and renders them only with textContent", async () => {
  const review = await fixture();
  review.evidence.find((entry) => entry.id === "router-guard").excerpt =
    "<svg onload=alert('unsafe')>";
  const serialized = serializeReviewForHtml(review);
  assert.match(serialized, /\\u003csvg onload=alert/);
  assert.doesNotMatch(serialized, /<svg/);
  const html = renderReviewHtml(review);
  assert.match(html, /element\("pre", entry\.excerpt, "excerpt"\)/);
  assert.doesNotMatch(html, /innerHTML/);
});

test("writes one private Hope Review file by default", async (t) => {
  const review = await fixture();
  const result = await writeReviewHtml(review, { changeRequest: changeRequestForReview(review) });
  t.after(() => rm(dirname(result.file), { recursive: true, force: true }));
  assert.equal(basename(result.file), "hope-review.html");
  assert.match(basename(dirname(result.file)), /^hope-review-/u);
  assert.deepEqual(await readdir(dirname(result.file)), ["hope-review.html"]);
  assert.match(await readFile(result.file, "utf8"), /<title>Hope Review<\/title>/);
  if (process.platform !== "win32") {
    assert.equal(mode(await stat(dirname(result.file))), 0o700);
    assert.equal(mode(await stat(result.file)), 0o600);
  }
});

test("writes an explicit new HTML file without overwriting existing paths", async (t) => {
  const review = await fixture();
  const context = changeRequestForReview(review);
  const parent = await mkdtemp(join(tmpdir(), "hope-review-renderer-test-"));
  t.after(() => rm(parent, { recursive: true, force: true }));

  const output = join(parent, "review.html");
  const result = await writeReviewHtml(review, { changeRequest: context, outputFile: output });
  assert.equal(result.file, output);
  assert.deepEqual(await readdir(parent), ["review.html"]);

  await assert.rejects(
    writeReviewHtml(review, { changeRequest: context, outputFile: output }),
    /Refusing to overwrite existing output path/,
  );

  const nonHtml = join(parent, "review.txt");
  await assert.rejects(
    writeReviewHtml(review, { changeRequest: context, outputFile: nonHtml }),
    /must end in \.html/,
  );

  const target = join(parent, "target");
  await mkdir(target);
  const symlinkParent = join(parent, "linked-parent");
  await symlink(target, symlinkParent, "dir");
  await assert.rejects(
    writeReviewHtml(review, {
      changeRequest: context,
      outputFile: join(symlinkParent, "linked-review.html"),
    }),
    /symlink output parent/,
  );
});

test("validates and binds before creating output", async (t) => {
  const review = await fixture();
  const parent = await mkdtemp(join(tmpdir(), "hope-review-refusal-test-"));
  t.after(() => rm(parent, { recursive: true, force: true }));

  await assert.rejects(writeReviewHtml(review), ChangeRequestBindingError);

  const invalid = clone(review);
  invalid.schemaVersion = 2;
  const invalidOutput = join(parent, "invalid.html");
  await assert.rejects(
    writeReviewHtml(invalid, {
      changeRequest: changeRequestForReview(invalid),
      outputFile: invalidOutput,
    }),
    ReviewValidationError,
  );
  await assert.rejects(lstat(invalidOutput), { code: "ENOENT" });

  const mismatched = clone(review);
  const mismatchedContext = changeRequestForReview(mismatched);
  mismatchedContext.headSha = "9".repeat(40);
  const mismatchedOutput = join(parent, "mismatched.html");
  await assert.rejects(
    writeReviewHtml(mismatched, {
      changeRequest: mismatchedContext,
      outputFile: mismatchedOutput,
    }),
    ChangeRequestBindingError,
  );
  await assert.rejects(lstat(mismatchedOutput), { code: "ENOENT" });
});
