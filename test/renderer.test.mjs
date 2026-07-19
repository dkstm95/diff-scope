import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  MAX_REVIEW_MODEL_BYTES,
  ReviewValidationError,
  validateReviewAgainstChangeRequest,
  validateReviewModel,
} from "../plugins/hope/skills/diff/scripts/lib/validate-review.mjs";
import { collectSecretIssues } from "../plugins/hope/skills/diff/scripts/lib/safety.mjs";
import {
  buildInspectionPages,
  inspectionCompletion,
} from "../plugins/hope/skills/diff/scripts/lib/inspection-pages.mjs";

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
  const context = {
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
        id: "patch-0001",
        passId: "pass-001",
        path: "src/routing.mjs",
        startLine: 1,
        endLine: 6,
        additions: 7,
        deletions: 1,
        text:
          "diff --git a/src/routing.mjs b/src/routing.mjs\n" +
          "--- a/src/routing.mjs\n+++ b/src/routing.mjs\n@@ -1,3 +1,6 @@\n" +
          "+if (!request.id?.trim()) {\n" +
          "+  return { status: 400, code: \"missing_id\" };\n" +
          "+}\n" +
          " return service.load(request.id);\n",
      },
      {
        id: "patch-0002",
        passId: "pass-002",
        path: "test/routing.test.mjs",
        startLine: 7,
        endLine: 9,
        additions: 5,
        deletions: 1,
        text:
          "diff --git a/test/routing.test.mjs b/test/routing.test.mjs\n" +
          "--- a/test/routing.test.mjs\n+++ b/test/routing.test.mjs\n@@ -7,2 +7,3 @@\n" +
          "+assert.equal(response.status, 400);\n" +
          "+assert.equal(repository.calls, 0);\n",
      },
    ],
    analysisPlan: clone(review.changeRequest.analysisPlan),
    coverage: clone(review.changeRequest.coverage),
    exclusions: clone(review.changeRequest.exclusions),
    warnings: clone(review.changeRequest.warnings),
    fingerprint: review.changeRequest.fingerprint,
  };
  const summary = inspectionCompletion(buildInspectionPages(context, { kind: "summary" }));
  review.analysisCoverage.inspectionProtocolVersion = 1;
  review.analysisCoverage.summary = {
    fingerprint: context.fingerprint,
    ...summary,
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

test("validates the complete ReviewModelV1 fixture", async () => {
  const review = await fixture();
  assert.equal(validateReviewModel(review), review);
  assert.equal(validateReviewAgainstChangeRequest(review, changeRequestForReview(review)), review);
});

test("requires an explicit supported review locale", async (t) => {
  const review = await fixture();

  await t.test("missing locale", () => {
    const candidate = clone(review);
    delete candidate.locale;
    assert.throws(() => validateReviewModel(candidate), /\$\.locale is required/u);
  });

  for (const value of [null, "ja", "ko-KR"]) {
    await t.test(`unsupported locale ${String(value)}`, () => {
      const candidate = clone(review);
      candidate.locale = value;
      assert.throws(() => validateReviewModel(candidate), /\$\.locale must be en or ko/u);
    });
  }
});

test("rejects a ReviewModelV1 that exceeds the renderer input budget", async () => {
  const review = await fixture();
  const excerpt = "review-context-".repeat(400).slice(0, 3999);
  for (let index = 0; index < 1_100; index += 1) {
    review.evidence.push({
      id: `oversized-${index}`,
      source: "pr-description",
      label: `Oversized evidence ${index}`,
      path: null,
      side: null,
      startLine: null,
      endLine: null,
      commitSha: null,
      excerpt,
    });
  }

  assert.ok(Buffer.byteLength(JSON.stringify(review)) > MAX_REVIEW_MODEL_BYTES);
  assert.throws(
    () => validateReviewModel(review),
    new RegExp(`at most ${MAX_REVIEW_MODEL_BYTES} serialized bytes`, "u"),
  );
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
    analysisPlan: {
      ...clone(source.analysisPlan),
      lineLimitPerPass: source.analysisPlan.lineLimitPerPass - 1,
    },
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

test("requires every bounded analysis pass to be processed once, in order, and with grounded evidence", async (t) => {
  const review = await fixture();

  await t.test("missing pass", () => {
    const candidate = clone(review);
    candidate.analysisCoverage.processedPasses.pop();
    assert.throws(
      () => validateReviewModel(candidate),
      /must contain every planned analysis pass exactly once and in order/u,
    );
  });

  await t.test("reordered pass", () => {
    const candidate = clone(review);
    candidate.analysisCoverage.processedPasses.reverse();
    assert.throws(
      () => validateReviewModel(candidate),
      /\.id must match .*analysisPlan\.passes/u,
    );
  });

  await t.test("mismatched pass fingerprint", () => {
    const candidate = clone(review);
    candidate.analysisCoverage.processedPasses[0].fingerprint = "d".repeat(64);
    assert.throws(
      () => validateReviewModel(candidate),
      /\.fingerprint must match .*analysisPlan\.passes/u,
    );
  });

  await t.test("non-code pass evidence", () => {
    const candidate = clone(review);
    candidate.analysisCoverage.processedPasses[0].evidenceIds = ["pr-description"];
    assert.throws(
      () => validateReviewModel(candidate),
      /must cite code or test evidence from its planned paths/u,
    );
  });

  await t.test("evidence from another pass", () => {
    const candidate = clone(review);
    candidate.analysisCoverage.processedPasses[0].evidenceIds = ["routing-test"];
    assert.throws(
      () => validateReviewModel(candidate),
      /must cite code or test evidence from its planned paths/u,
    );
  });

  await t.test("excerpt must occur in a fragment belonging to that pass", () => {
    const context = changeRequestForReview(review);
    context.patches[0].passId = "pass-002";
    assert.throws(
      () => validateReviewAgainstChangeRequest(review, context),
      /patch fragment belonging to that pass/u,
    );
  });

    await t.test("summary completion attestation must bind the exact deterministic view", () => {
    const context = changeRequestForReview(review);
    review.analysisCoverage.summary.terminalReceipt = "f".repeat(64);
    assert.throws(
      () => validateReviewAgainstChangeRequest(review, context),
      /summary\.terminalReceipt does not match/u,
    );
  });

    await t.test("pass completion attestation must bind the exact deterministic view", () => {
    const context = changeRequestForReview(review);
    review.analysisCoverage.processedPasses[0].pageCount += 1;
    review.analysisCoverage.processedPasses[1].terminalReceipt = "f".repeat(64);
    assert.throws(
      () => validateReviewAgainstChangeRequest(review, context),
      /pageCount does not match|terminalReceipt does not match/u,
    );
  });
});

test("validates bounded analysis-plan summaries against collection totals", async (t) => {
  const review = await fixture();

  await t.test("pass line limit", () => {
    const candidate = clone(review);
    candidate.changeRequest.analysisPlan.passes[0].changedLines = 4001;
    candidate.changeRequest.coverage.explainableChangedLines += 3993;
    assert.throws(() => validateReviewModel(candidate), /cannot exceed .*lineLimitPerPass/u);
  });

  await t.test("explainable-line total", () => {
    const candidate = clone(review);
    candidate.changeRequest.coverage.explainableChangedLines += 1;
    assert.throws(
      () => validateReviewModel(candidate),
      /analysisPlan changed lines must equal .*coverage\.explainableChangedLines/u,
    );
  });

  await t.test("patch-byte total", () => {
    const candidate = clone(review);
    candidate.changeRequest.coverage.patchBytes += 1;
    assert.throws(
      () => validateReviewModel(candidate),
      /analysisPlan patch bytes must equal .*coverage\.patchBytes/u,
    );
  });

  await t.test("duplicate planned patch", () => {
    const candidate = clone(review);
    candidate.changeRequest.analysisPlan.passes[1].patchIds = ["patch-0001"];
    assert.throws(() => validateReviewModel(candidate), /duplicates patch id/u);
  });

  await t.test("unknown planned path", () => {
    const candidate = clone(review);
    candidate.changeRequest.analysisPlan.passes[0].paths = ["src/not-changed.mjs"];
    assert.throws(() => validateReviewModel(candidate), /must reference a changed file/u);
  });
});

test("links overlapping workstreams and grounds cross-workstream synthesis", async (t) => {
  const review = await fixture();

  await t.test("overlapping workstream paths are allowed", () => {
    const candidate = clone(review);
    candidate.workstreams[1].paths.push("src/routing.mjs");
    assert.doesNotThrow(() => validateReviewModel(candidate));
  });

  await t.test("unknown workstream path", () => {
    const candidate = clone(review);
    candidate.workstreams[0].paths = ["src/not-changed.mjs"];
    assert.throws(() => validateReviewModel(candidate), /workstreams\[0\]\.paths\[0\] must reference a changed file/u);
  });

  await t.test("duplicate workstream id", () => {
    const candidate = clone(review);
    candidate.workstreams[1].id = candidate.workstreams[0].id;
    assert.throws(() => validateReviewModel(candidate), /duplicates workstream id/u);
  });

  await t.test("interaction needs two unique workstreams", () => {
    const candidate = clone(review);
    candidate.synthesis.interactions[0].workstreamIds = ["request-validation"];
    assert.throws(() => validateReviewModel(candidate), /must contain between 2 and 12 items/u);
  });

  await t.test("interaction references known workstreams", () => {
    const candidate = clone(review);
    candidate.synthesis.interactions[0].workstreamIds[1] = "unknown-stream";
    assert.throws(() => validateReviewModel(candidate), /references unknown workstream/u);
  });

  await t.test("interaction grounds every connected workstream", () => {
    const candidate = clone(review);
    candidate.synthesis.interactions[0].evidenceIds = ["router-guard"];
    assert.throws(
      () => validateReviewModel(candidate),
      /must ground each connected workstream/u,
    );
  });

  await t.test("observed synthesis cites code or test", () => {
    const candidate = clone(review);
    candidate.synthesis.summary.evidenceIds = ["pr-description"];
    assert.throws(() => validateReviewModel(candidate), /synthesis\.summary\.evidenceIds must cite code or test evidence/u);
  });

  await t.test("unknown synthesis requires an author question", () => {
    const candidate = clone(review);
    candidate.synthesis.interactions[0].basis = "unknown";
    candidate.synthesis.interactions[0].evidenceIds = [];
    assert.throws(() => validateReviewModel(candidate), /an unknown claim requires an author question/u);
  });
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
    assert.throws(() => validateReviewModel(candidate), /included body/);
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
    assert.throws(() => validateReviewModel(candidate), /included body/);
  });

  await t.test("unrelated-file evidence", () => {
    const candidate = clone(review);
    candidate.literateDiff[0].changes[0].evidenceIds = ["routing-test"];
    assert.throws(
      () => validateReviewModel(candidate),
      /must cite code or test evidence for its selected file/u,
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
    [
      "encoded bracketed triple-quoted assignment",
      'config["pass\\u0077ord"] = """\nFAKE_ENCODED_TRIPLE_SECRET_MATERIAL\n"""',
    ],
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

test("never echoes credentials from invalid ReviewModel identifiers or property keys", async (t) => {
  const secret = "sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ123456";

  await t.test("dangling identifier", async () => {
    const review = await fixture();
    review.quiz.questions[0].evidenceIds[0] = secret;
    assert.throws(
      () => validateReviewModel(review),
      (error) => {
        assert.ok(error instanceof ReviewValidationError);
        assert.ok(!error.message.includes(secret));
        assert.ok(!error.issues.join("\n").includes(secret));
        return /suspected|redacted/u.test(error.message);
      },
    );
  });

  await t.test("unsupported property key", async () => {
    const review = await fixture();
    review[secret] = secret;
    assert.throws(
      () => validateReviewModel(review),
      (error) => {
        assert.ok(error instanceof ReviewValidationError);
        assert.ok(!error.message.includes(secret));
        assert.ok(!error.issues.join("\n").includes(secret));
        return /suspected|redacted/u.test(error.message);
      },
    );
  });
});

test("distinguishes secret-detector declarations from credential assignments", () => {
  assert.deepEqual(collectSecretIssues("const SECRET_PATTERNS = ["), []);
  assert.deepEqual(collectSecretIssues("const passwordRules = {"), []);
  assert.deepEqual(collectSecretIssues("const CLIENT_SECRET_REGEXES = ["), []);
  assert.deepEqual(collectSecretIssues('password = "" ;'), []);
  assert.deepEqual(collectSecretIssues('password = "example"; # fixture'), []);

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
    'config["pass\\u0077ord"] = "" +\n"FAKE_CONCATENATED_SECRET_MATERIAL"',
    'config["pass\\u0077ord"] = "" || "FAKE_FALLBACK_SECRET_MATERIAL"',
    'config["pass\\u0077ord"] = "" // benign-looking comment\n|| "FAKE_MULTILINE_FALLBACK_SECRET_MATERIAL"',
    'config.password ??= "FAKE_NULLISH_ASSIGNMENT_SECRET_MATERIAL"',
    'config.password ||= "FAKE_LOGICAL_ASSIGNMENT_SECRET_MATERIAL"',
    'password += "FAKE_COMPOUND_SECRET_MATERIAL"',
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
  assert.match(first, /<html lang="ko">/u);
  assert.match(first, /<title>Hope 리뷰<\/title>/u);
  assert.match(first, /<h2 id="overview-heading">무엇이 바뀌었나<\/h2>/u);
  assert.match(first, /<h2 id="review-focus-heading">확인할 점<\/h2>/u);
  assert.match(first, /<h2 id="workstream-heading">어떻게 동작하나<\/h2>/u);
  assert.match(first, /<h2 id="literate-heading">코드로 확인하기<\/h2>/u);
  assert.match(first, /<h2 id="microworld-heading">동작 실험<\/h2>/u);
  assert.match(first, /<h2 id="quiz-heading">이해 확인<\/h2>/u);
  assert.match(first, /<h2 id="details-heading">분석 세부 정보<\/h2>/u);
  assert.match(first, /class="technical-details"><summary>분석한 PR 버전과 세부 정보 보기<\/summary>/u);
  assert.match(first, /"observed":"변경 내용에서 확인"/u);
  assert.match(first, /"not-run":"실행 안 함"/u);
  assert.match(first, /"generated-or-lockfile":"생성\/잠금 파일"/u);
  assert.doesNotMatch(first, /id="workstream-navigation"/);
  assert.match(first, /element\("details", undefined, "card disclosure-card workstream-card"\)/u);
  assert.match(first, /workstreamTarget/);
  assert.match(first, /return "workstream-card-" \+ id/u);
  assert.match(first, /synthesis-interactions/);
  assert.match(first, /Base SHA/);
  assert.match(first, /Merge-base SHA/);
  assert.match(first, /Head SHA/);
  assert.match(first, /PR 제목/);
  const header = first.slice(first.indexOf("<header>"), first.indexOf("</header>"));
  assert.match(header, /id="review-context"/u);
  assert.doesNotMatch(header, /Base SHA|Merge-base SHA|Head SHA|Fingerprint|검증 ID/u);
  const compactContextStart = first.indexOf("const compactValues = [");
  const compactContext = first.slice(compactContextStart, first.indexOf("];", compactContextStart) + 2);
  assert.match(compactContext, /ui\.context\.size/u);
  assert.doesNotMatch(compactContext, /ui\.context\.(?:author|commits|files|changedLines)/u);
  const sectionOrder = [
    'id="overview"',
    'id="workstreams"',
    'id="review-focus"',
    'id="microworld-section"',
    'id="quiz"',
    'id="literate-diff"',
    'id="details"',
  ].map((marker) => first.indexOf(marker));
  assert.ok(sectionOrder.every((position) => position >= 0));
  assert.deepEqual(sectionOrder, [...sectionOrder].sort((left, right) => left - right));
  assert.match(first, /Content-Security-Policy/);
  assert.match(first, /default-src 'none'/);
  assert.match(first, /connect-src 'none'/);
  assert.match(first, /frame-src 'none'/);
  assert.match(first, /worker-src 'none'/);
  assert.match(first, /script-src 'sha256-[A-Za-z0-9+/=]+'/);
  assert.match(first, /document\.createElement/);
  assert.match(first, /\.textContent/);
  assert.match(first, /file\.previousPath/u);
  assert.match(first, /passIdsByPath/u);
  assert.match(first, /workstreamIdsByPath/u);
  assert.match(first, /processedPass\.summary/u);
  assert.match(first, /correctOptionIds/);
  assert.match(first, /selected\.size === expected\.size/);
  assert.match(first, /candidate\.when\.find/);
  assert.match(first, /이 실험은 설명을 돕는 예시이며 프로젝트 코드를 실행하지 않습니다/u);
  assert.match(first, /id="quiz-disclosure"/u);
  assert.match(first, /id="scenario-status" class="sr-only" role="status" aria-live="polite"/u);
  assert.match(first, /<th scope="col">경로<\/th>/u);
  assert.match(first, /min-height: 44px/u);
  assert.match(first, /\.workstream-card \{ scroll-margin-top: 76px; \}/u);
  assert.match(first, /@media \(max-width: 900px\)[\s\S]*\.workstream-card \{ scroll-margin-top: 18px; \}/u);
  assert.match(first, /\.table-wrap:focus-visible,[^}]*\.quiz-question:focus,[^}]*\.result:focus \{ outline: 3px solid var\(--accent\)/u);
  assert.match(first, /\.control \{[^}]*flex: 1 1 190px;[^}]*min-width: 0;[^}]*max-width: 100%;/u);
  assert.match(first, /\.control select \{ width: 100%; min-width: 0; max-width: 100%; \}/u);
  assert.match(first, /\.grid > \*, \.card, details, section, fieldset, \.table-wrap \{ min-width: 0; max-width: 100%; \}/u);
  assert.match(first, /fieldset \{ min-inline-size: 0;/u);
  assert.match(first, /\.choice > span \{ min-width: 0; overflow-wrap: anywhere; \}/u);
  assert.match(first, /\.table-wrap \{ width: 100%; max-width: 100%; overflow-x: auto;/u);
  assert.match(first, /@media \(max-width: 400px\)[\s\S]*\.meta \{ grid-template-columns: 1fr; \}[\s\S]*\.compact-meta \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/u);
  assert.match(first, /flow\.setAttribute\("role", "list"\)/u);
  assert.match(first, /element\("span", String\(index \+ 1\), "flow-number"\)/u);
  assert.doesNotMatch(first, /counter-reset: hope-step|\.visual-flow li::marker/u);
  assert.match(first, /element\("fieldset", undefined, "quiz-question"\)/u);
  assert.match(first, /"more":"배경과 변경 전후 자세히 보기","before":"변경 전","after":"변경 후"/u);
  assert.match(first, /"before":"선택한 조건","after":"예상 동작","outcome":"결과"/u);
  assert.doesNotMatch(first, /appendEvidence\(item, step\.evidenceIds\)/u);
  assert.doesNotMatch(first, /appendEvidence\(fieldset, question\.evidenceIds\)/u);
  assert.doesNotMatch(first, /<\/script><script>alert\('unsafe'\)/);
  assert.match(first, /\\u003c\/script\\u003e\\u003cscript\\u003e/);
  assert.match(first, /\\u0026/);
  assert.doesNotMatch(first, /innerHTML/);
  assert.doesNotMatch(first, /\beval\s*\(/);
  assert.doesNotMatch(first, /\bfetch\s*\(/);
  assert.doesNotMatch(first, /XMLHttpRequest|WebSocket|EventSource|new\s+Function/);
  assert.doesNotMatch(first, /<script[^>]+src=|<link[^>]+href=|<img[^>]+src=/);

  const csp = first.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/u)?.[1];
  const style = first.match(/<style>([\s\S]*?)<\/style>/u)?.[1];
  const data = first.match(/<script id="review-data" type="application\/json">([\s\S]*?)<\/script>/u)?.[1];
  const runtime = first.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/u)?.[1];
  assert.ok(csp && style && data && runtime);
  for (const body of [style, data, runtime]) {
    const digest = createHash("sha256").update(body, "utf8").digest("base64");
    assert.ok(csp.includes(`'sha256-${digest}'`));
  }
});

test("renders the fixed interface in the selected language", async () => {
  const review = await fixture();
  review.locale = "en";
  const html = renderReviewHtml(review);
  assert.match(html, /<html lang="en">/u);
  assert.match(html, /<title>Hope Review<\/title>/u);
  assert.match(html, /<h2 id="overview-heading">What changed<\/h2>/u);
  assert.match(html, /<h2 id="review-focus-heading">What to verify<\/h2>/u);
  assert.match(html, /<h2 id="workstream-heading">How it works<\/h2>/u);
  assert.match(html, /<h2 id="microworld-heading">Try the behavior<\/h2>/u);
  assert.match(html, /<h2 id="quiz-heading">Quiz<\/h2>/u);
  assert.match(html, /<h2 id="literate-heading">Check the code<\/h2>/u);
  assert.match(html, /<h2 id="details-heading">Analysis details<\/h2>/u);
});

test("keeps maximum-length review text inside shrinkable layout containers", async () => {
  const review = await fixture();
  const unbroken = "A".repeat(4000);
  review.authorQuestions[0].question = unbroken;
  review.quiz.questions[0].prompt = unbroken;
  review.quiz.questions[0].options[0].text = unbroken;
  const html = renderReviewHtml(review);
  assert.match(html, new RegExp(`"question":"${unbroken}"`, "u"));
  assert.match(html, /overflow-wrap: anywhere/u);
  assert.match(html, /min-inline-size: 0/u);
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
  const temporaryRoot = await mkdtemp(join(tmpdir(), "hope-review-root-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const result = await writeReviewHtml(review, {
    changeRequest: changeRequestForReview(review),
    temporaryRoot,
  });
  assert.equal(basename(result.file), "hope-review.html");
  assert.match(basename(dirname(result.file)), /^hope-review-/u);
  assert.deepEqual(await readdir(dirname(result.file)), ["hope-review.html"]);
  const source = await readFile(result.file, "utf8");
  const marker = /^<!-- Hope-managed temporary review; eligibleAfter=(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) -->\n<!doctype html>[\s\S]*<title>Hope 리뷰<\/title>/u.exec(
    source,
  );
  assert.notEqual(marker, null);
  assert.match(result.eligibleAfter, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  assert.equal(marker[1], result.eligibleAfter);
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
  assert.equal(result.eligibleAfter, null);
  assert.deepEqual(await readdir(parent), ["review.html"]);
  assert.doesNotMatch(await readFile(output, "utf8"), /Hope-managed temporary review/u);

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

test("a later default render removes an eligible managed review", async (t) => {
  const review = await fixture();
  const context = changeRequestForReview(review);
  const temporaryRoot = await mkdtemp(join(tmpdir(), "hope-review-cycle-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));

  const first = await writeReviewHtml(review, {
    changeRequest: context,
    temporaryRoot,
  });
  const second = await writeReviewHtml(review, {
    changeRequest: context,
    nowMs: Date.parse(first.eligibleAfter),
    temporaryRoot,
  });

  await assert.rejects(lstat(dirname(first.file)), { code: "ENOENT" });
  assert.equal((await lstat(second.file)).isFile(), true);
});

test("a default retention pass never removes an explicit export", async (t) => {
  const review = await fixture();
  const context = changeRequestForReview(review);
  const temporaryRoot = await mkdtemp(join(tmpdir(), "hope-review-export-root-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const exportDirectory = join(temporaryRoot, "hope-review-EXPRT1");
  await mkdir(exportDirectory, { mode: 0o700 });
  const exportFile = join(exportDirectory, "hope-review.html");

  const exported = await writeReviewHtml(review, {
    changeRequest: context,
    outputFile: exportFile,
  });
  await writeReviewHtml(review, {
    changeRequest: context,
    nowMs: Date.now() + 8 * 24 * 60 * 60 * 1_000,
    temporaryRoot,
  });

  assert.equal(exported.eligibleAfter, null);
  assert.equal((await lstat(exportFile)).isFile(), true);
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
