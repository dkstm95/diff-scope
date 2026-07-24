import assert from "node:assert/strict";
import test from "node:test";

import { validateAnalysis } from "../features/diff/validate.mjs";
import { makeAnalysis, makeSnapshot } from "../test-support/diff-fixture.mjs";

const runId = "1".repeat(32);

test("analysis validation derives trusted status, scope, evidence, and file use", () => {
  const snapshot = makeSnapshot();
  const validated = validateAnalysis(makeAnalysis(snapshot, runId), snapshot, { runId });
  assert.equal(validated.result.status, "verify");
  assert.equal(validated.result.scope, "limited");
  assert.equal(validated.files[0].disposition, "explained");
  assert.equal(validated.reviewItems[0].evidence[0].excerpt.includes("throw last"), true);
  assert.equal(validated.reviewItems[0].basis, "inferred");
  assert.equal(validated.contextChecks.length, 3);
  assert.equal(validated.sourceIndex.length, snapshot.sources.length);
  assert.equal("text" in validated.sourceIndex[0], false);
});

test("only material collection limits make the review scope limited", () => {
  const snapshot = makeSnapshot();
  const analysis = makeAnalysis(snapshot, runId);
  analysis.limitImpacts[0].material = false;
  analysis.limitImpacts[0].impact = "The changed function is self-contained, so callers are not needed here.";

  const validated = validateAnalysis(analysis, snapshot, { runId });
  assert.equal(validated.result.scope, "sufficient");
  assert.equal(validated.limits.length, 1);
  assert.equal(validated.limits[0].material, false);
});

test("analysis cannot omit, duplicate, or classify unavailable files", () => {
  const snapshot = makeSnapshot();
  const missing = makeAnalysis(snapshot, runId);
  missing.fileDispositions = [];
  assert.throws(
    () => validateAnalysis(missing, snapshot, { runId }),
    /No semantic disposition/u,
  );

  const duplicate = makeAnalysis(snapshot, runId);
  duplicate.fileDispositions.push({ ...duplicate.fileDispositions[0] });
  assert.throws(
    () => validateAnalysis(duplicate, snapshot, { runId }),
    /repeats/u,
  );

  const unavailableValue = { ...snapshot };
  unavailableValue.files = [{
    ...snapshot.files[0],
    bodyState: "redacted",
    bodyReason: "secret",
    sourceIds: [],
  }];
  const unavailable = makeAnalysis(unavailableValue, runId);
  assert.throws(
    () => validateAnalysis(unavailable, unavailableValue, { runId }),
    /cannot classify/u,
  );
});

test("analysis rejects invented evidence, cross-run data, and fake basis", () => {
  const snapshot = makeSnapshot();
  const invented = makeAnalysis(snapshot, runId);
  invented.purpose.evidence[0].sourceId = "source-99";
  assert.throws(
    () => validateAnalysis(invented, snapshot, { runId }),
    /unknown source/u,
  );

  const replay = makeAnalysis(snapshot, "2".repeat(32));
  assert.throws(
    () => validateAnalysis(replay, snapshot, { runId }),
    /runId does not match/u,
  );

  const fakeCode = makeAnalysis(snapshot, runId);
  fakeCode.purpose.basis = "code";
  assert.throws(
    () => validateAnalysis(fakeCode, snapshot, { runId }),
    /non-code evidence/u,
  );
});

test("every code step is backed by code evidence for its listed files", () => {
  const snapshot = makeSnapshot();
  const analysis = makeAnalysis(snapshot, runId);
  analysis.codeSteps[0] = {
    ...analysis.codeSteps[0],
    basis: "stated",
    evidence: [{ endLine: 1, sourceId: "source-2", startLine: 1 }],
  };

  assert.throws(
    () => validateAnalysis(analysis, snapshot, { runId }),
    /needs code evidence/u,
  );
});

test("analysis fails closed on unsupported schemas and model-owned URLs", () => {
  const snapshot = makeSnapshot();
  assert.throws(
    () => validateAnalysis(
      makeAnalysis(snapshot, runId),
      { ...snapshot, schemaVersion: 2 },
      { runId },
    ),
    /Unsupported Hope snapshot schema/u,
  );

  const modelUrl = makeAnalysis(snapshot, runId);
  modelUrl.url = "https://evil.example/review";
  assert.throws(
    () => validateAnalysis(modelUrl, snapshot, { runId }),
    /unknown field: url/u,
  );
});

test("quiz evidence follows the published schema limit", () => {
  const snapshot = makeSnapshot();
  const analysis = makeAnalysis(snapshot, runId);
  const evidence = Array.from({ length: 9 }, (_, index) => ({
    endLine: 1,
    sourceId: index % 2 === 0 ? "source-1" : "source-2",
    startLine: 1,
  }));
  analysis.quiz = Array.from({ length: 3 }, (_, index) => ({
    answer: `Answer ${index + 1}`,
    evidence,
    question: `Question ${index + 1}`,
  }));

  assert.throws(
    () => validateAnalysis(analysis, snapshot, { runId }),
    /quiz\[0\]\.evidence has too many items/u,
  );
});

test("analysis rejects oversized evidence excerpts", () => {
  const snapshot = makeSnapshot();
  const longSource = {
    ...snapshot.sources[2],
    lineCount: 30,
    text: Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join("\n"),
  };
  const longSnapshot = {
    ...snapshot,
    sources: [snapshot.sources[0], snapshot.sources[1], longSource],
  };
  const analysis = makeAnalysis(longSnapshot, runId);
  analysis.codeSteps[0].evidence = [{
    endLine: 25,
    sourceId: "source-3",
    startLine: 1,
  }];

  assert.throws(
    () => validateAnalysis(analysis, longSnapshot, { runId }),
    /24-line evidence limit/u,
  );
});

test("analysis cannot use empty source text as evidence", () => {
  const snapshot = makeSnapshot();
  const emptySnapshot = {
    ...snapshot,
    sources: snapshot.sources.map((source) => (
      source.id === "source-2"
        ? { ...source, lineCount: 1, text: "" }
        : source
    )),
  };
  const analysis = makeAnalysis(emptySnapshot, runId);

  assert.throws(
    () => validateAnalysis(analysis, emptySnapshot, { runId }),
    /empty source text/u,
  );
});

test("analysis fails when the core change is unknown or no file body is available", () => {
  const snapshot = makeSnapshot();
  const unknown = makeAnalysis(snapshot, runId);
  unknown.coreChange.after = {
    basis: "unknown",
    evidence: [],
    text: "The new behavior could not be confirmed.",
  };
  assert.throws(
    () => validateAnalysis(unknown, snapshot, { runId }),
    /coreChange\.after must be grounded/u,
  );

  const unavailableSnapshot = {
    ...snapshot,
    files: snapshot.files.map((file) => ({
      ...file,
      bodyReason: "credential",
      bodyState: "redacted",
      sourceIds: [],
    })),
  };
  const unavailable = makeAnalysis(unavailableSnapshot, runId);
  unavailable.fileDispositions = [];
  assert.throws(
    () => validateAnalysis(unavailable, unavailableSnapshot, { runId }),
    /cannot be grounded without an included file/u,
  );

  const emptyExplanation = makeAnalysis(snapshot, runId);
  emptyExplanation.coreChange.details = [];
  assert.throws(
    () => validateAnalysis(emptyExplanation, snapshot, { runId }),
    /coreChange\.details needs the main explanation/u,
  );
});

test("purpose basis is limited to stated, inferred, or unknown", () => {
  const snapshot = makeSnapshot();
  const analysis = makeAnalysis(snapshot, runId);
  analysis.purpose = {
    basis: "code",
    evidence: [{ endLine: 4, sourceId: "source-3", startLine: 1 }],
    text: "The code changes retry behavior.",
  };

  assert.throws(
    () => validateAnalysis(analysis, snapshot, { runId }),
    /purpose basis must be stated, inferred, or unknown/u,
  );
});

test("context checks account for limits with status-specific evidence", () => {
  const snapshot = makeSnapshot();

  const checkedWithoutEvidence = makeAnalysis(snapshot, runId);
  checkedWithoutEvidence.contextChecks[0].evidence = [];
  assert.throws(
    () => validateAnalysis(checkedWithoutEvidence, snapshot, { runId }),
    /needs evidence when checked/u,
  );

  const limitedWithoutLimit = makeAnalysis(snapshot, runId);
  limitedWithoutLimit.contextChecks[1].limitIds = [];
  assert.throws(
    () => validateAnalysis(limitedWithoutLimit, snapshot, { runId }),
    /needs at least one limit when limited/u,
  );

  const missingLimitAccount = makeAnalysis(snapshot, runId);
  missingLimitAccount.contextChecks = missingLimitAccount.contextChecks.filter(
    (check) => check.status !== "limited",
  );
  assert.throws(
    () => validateAnalysis(missingLimitAccount, snapshot, { runId }),
    /No context check accounts for limit-1/u,
  );

  const notApplicableWithLimit = makeAnalysis(snapshot, runId);
  notApplicableWithLimit.contextChecks[2].limitIds = ["limit-1"];
  assert.throws(
    () => validateAnalysis(notApplicableWithLimit, snapshot, { runId }),
    /cannot link limits when not applicable/u,
  );
});

test("review item basis must match its evidence kind", () => {
  const snapshot = makeSnapshot();
  const analysis = makeAnalysis(snapshot, runId);
  analysis.reviewItems[0].basis = "stated";

  assert.throws(
    () => validateAnalysis(analysis, snapshot, { runId }),
    /stated-source basis/u,
  );
});

test("analysis rejects bidirectional controls in user-facing prose", () => {
  const snapshot = makeSnapshot();
  const analysis = makeAnalysis(snapshot, runId);
  analysis.purpose.text = "Safe text \u202E disguised text";

  assert.throws(
    () => validateAnalysis(analysis, snapshot, { runId }),
    /bidirectional control character/u,
  );
});

test("review items can link only known scope limits once", () => {
  const snapshot = makeSnapshot();
  const unknown = makeAnalysis(snapshot, runId);
  unknown.reviewItems[0].limitIds = ["limit-404"];
  assert.throws(
    () => validateAnalysis(unknown, snapshot, { runId }),
    /unknown limit/u,
  );

  const duplicate = makeAnalysis(snapshot, runId);
  duplicate.reviewItems[0].limitIds = ["limit-1", "limit-1"];
  assert.throws(
    () => validateAnalysis(duplicate, snapshot, { runId }),
    /contains a duplicate/u,
  );
});
