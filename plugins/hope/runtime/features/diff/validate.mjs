// Generated from features/diff/validate.mjs. Do not edit.
import {
  BASIS,
  CONTRACT_VERSION,
  FILE_DISPOSITIONS,
  IMPORTANCE,
  LIMITS,
  REVIEW_KINDS,
} from "./constants.mjs";
import { deriveReviewResult, sortReviewItems } from "./derive.mjs";
import { containsBidiControl } from "./text.mjs";

const codeSources = new Set(["patch", "before-file", "after-file"]);
const statedSources = new Set([
  "pull-request-title",
  "pull-request-description",
  "commit-title",
]);
const contextStatuses = ["checked", "not-applicable", "limited"];

function object(value, name, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${name} has an unknown field: ${key}`);
  }
  return value;
}

function array(value, name, maximum = LIMITS.modelItems) {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  if (value.length > maximum) throw new RangeError(`${name} has too many items`);
  return value;
}

function text(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  if (Buffer.byteLength(value, "utf8") > LIMITS.modelString) {
    throw new RangeError(`${name} is too long`);
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${name} contains a control character`);
  }
  if (containsBidiControl(value)) {
    throw new TypeError(`${name} contains a bidirectional control character`);
  }
  return value.replace(/\r\n?/gu, "\n");
}

function enumeration(value, name, values) {
  if (!values.includes(value)) {
    throw new RangeError(`${name} must be one of ${values.join(", ")}`);
  }
  return value;
}

function evidenceReference(value, name, sourceMap) {
  object(value, name, ["sourceId", "startLine", "endLine"]);
  if (typeof value.sourceId !== "string") throw new TypeError(`${name}.sourceId is invalid`);
  const source = sourceMap.get(value.sourceId);
  if (!source) throw new Error(`${name} refers to an unknown source: ${value.sourceId}`);
  if (
    !Number.isSafeInteger(value.startLine)
    || !Number.isSafeInteger(value.endLine)
    || value.startLine < 1
    || value.endLine < value.startLine
    || value.endLine > source.lineCount
  ) {
    throw new RangeError(`${name} has an invalid line range`);
  }
  if (value.endLine - value.startLine + 1 > LIMITS.evidenceLines) {
    throw new RangeError(
      `${name} exceeds the ${LIMITS.evidenceLines}-line evidence limit`,
    );
  }
  const excerpt = source.text
    .split("\n")
    .slice(value.startLine - 1, value.endLine)
    .join("\n");
  if (excerpt.trim().length === 0) {
    throw new Error(`${name} refers only to empty source text`);
  }
  return Object.freeze({
    endLine: value.endLine,
    excerpt,
    fileId: source.fileId,
    path: source.path,
    revision: source.revision,
    sourceId: source.id,
    sourceKind: source.kind,
    startLine: value.startLine,
  });
}

function evidenceList(
  value,
  name,
  sourceMap,
  { allowEmpty = false, maximum = 12 } = {},
) {
  const values = array(value, name, maximum);
  if (!allowEmpty && values.length === 0) {
    throw new Error(`${name} must include evidence`);
  }
  const seen = new Set();
  return values.map((item, index) => {
    const validated = evidenceReference(item, `${name}[${index}]`, sourceMap);
    const key = `${validated.sourceId}:${validated.startLine}:${validated.endLine}`;
    if (seen.has(key)) throw new Error(`${name} contains duplicate evidence`);
    seen.add(key);
    return validated;
  });
}

function claim(value, name, sourceMap, { title = false } = {}) {
  const keys = title
    ? ["title", "text", "basis", "evidence"]
    : ["text", "basis", "evidence"];
  object(value, name, keys);
  const basis = enumeration(value.basis, `${name}.basis`, BASIS);
  const evidence = evidenceList(value.evidence, `${name}.evidence`, sourceMap, {
    allowEmpty: basis === "unknown",
  });
  if (basis === "unknown" && evidence.length > 0) {
    throw new Error(`${name} cannot use evidence with an unknown basis`);
  }
  if (basis !== "unknown" && evidence.length === 0) {
    throw new Error(`${name} needs evidence for its basis`);
  }
  if (
    basis === "stated"
    && evidence.some((item) => !statedSources.has(item.sourceKind))
  ) {
    throw new Error(`${name} uses code as a stated-source basis`);
  }
  if (
    basis === "code"
    && evidence.some((item) => !codeSources.has(item.sourceKind))
  ) {
    throw new Error(`${name} uses non-code evidence as a code basis`);
  }
  return Object.freeze({
    basis,
    evidence,
    text: text(value.text, `${name}.text`),
    ...(title ? { title: text(value.title, `${name}.title`) } : {}),
  });
}

function reviewItem(value, index, sourceMap, limitMap) {
  const name = `reviewItems[${index}]`;
  object(value, name, [
    "kind",
    "importance",
    "basis",
    "title",
    "explanation",
    "effect",
    "nextStep",
    "doneWhen",
    "evidence",
    "limitIds",
  ]);
  const basis = enumeration(value.basis, `${name}.basis`, BASIS);
  const evidence = evidenceList(value.evidence, `${name}.evidence`, sourceMap);
  if (
    basis === "stated"
    && evidence.some((item) => !statedSources.has(item.sourceKind))
  ) {
    throw new Error(`${name} uses code as a stated-source basis`);
  }
  if (
    basis === "code"
    && evidence.some((item) => !codeSources.has(item.sourceKind))
  ) {
    throw new Error(`${name} uses non-code evidence as a code basis`);
  }
  const limitIds = value.limitIds === undefined
    ? []
    : array(value.limitIds, `${name}.limitIds`, 12);
  if (new Set(limitIds).size !== limitIds.length) {
    throw new Error(`${name}.limitIds contains a duplicate`);
  }
  for (const limitId of limitIds) {
    if (!limitMap.has(limitId)) {
      throw new Error(`${name}.limitIds refers to an unknown limit`);
    }
  }
  return {
    basis,
    doneWhen: text(value.doneWhen, `${name}.doneWhen`),
    effect: text(value.effect, `${name}.effect`),
    evidence,
    explanation: text(value.explanation, `${name}.explanation`),
    importance: enumeration(value.importance, `${name}.importance`, IMPORTANCE),
    kind: enumeration(value.kind, `${name}.kind`, REVIEW_KINDS),
    limitIds: Object.freeze([...limitIds]),
    nextStep: text(value.nextStep, `${name}.nextStep`),
    originalIndex: index,
    title: text(value.title, `${name}.title`),
  };
}

function validateFileDispositions(values, snapshot) {
  const entries = array(values, "fileDispositions", LIMITS.changedFiles);
  const files = new Map(snapshot.files.map((file) => [file.id, file]));
  const selected = new Map();
  for (const [index, entry] of entries.entries()) {
    const name = `fileDispositions[${index}]`;
    object(entry, name, ["fileId", "disposition"]);
    const file = files.get(entry.fileId);
    if (!file) throw new Error(`${name} refers to an unknown file`);
    if (file.bodyState !== "included") {
      throw new Error(`${name} cannot classify a ${file.bodyState} file`);
    }
    if (selected.has(entry.fileId)) {
      throw new Error(`${name} repeats ${entry.fileId}`);
    }
    const disposition = enumeration(
      entry.disposition,
      `${name}.disposition`,
      FILE_DISPOSITIONS.slice(0, 3),
    );
    selected.set(entry.fileId, disposition);
  }
  for (const file of snapshot.files) {
    if (file.bodyState === "included" && !selected.has(file.id)) {
      throw new Error(`No semantic disposition was provided for ${file.path}`);
    }
  }
  return snapshot.files.map((file) => Object.freeze({
    ...file,
    disposition: file.bodyState === "redacted"
      ? "redacted"
      : file.bodyState === "metadata-only"
        ? "metadata-only"
        : selected.get(file.id),
  }));
}

function validateLimitImpacts(values, snapshot) {
  const entries = array(
    values,
    "limitImpacts",
    LIMITS.changedFiles + 2,
  );
  const limits = new Map(snapshot.limits.map((limit) => [limit.id, limit]));
  const selected = new Map();
  for (const [index, entry] of entries.entries()) {
    const name = `limitImpacts[${index}]`;
    object(entry, name, ["limitId", "material", "impact"]);
    if (!limits.has(entry.limitId)) throw new Error(`${name} refers to an unknown limit`);
    if (selected.has(entry.limitId)) throw new Error(`${name} repeats ${entry.limitId}`);
    if (typeof entry.material !== "boolean") {
      throw new TypeError(`${name}.material must be a boolean`);
    }
    selected.set(entry.limitId, Object.freeze({
      impact: text(entry.impact, `${name}.impact`),
      material: entry.material,
    }));
  }
  for (const limit of snapshot.limits) {
    if (!selected.has(limit.id)) {
      throw new Error(`No impact was provided for ${limit.subject}`);
    }
  }
  return snapshot.limits.map((limit) => Object.freeze({
    ...limit,
    ...selected.get(limit.id),
  }));
}

function validateContextChecks(values, sourceMap, limitMap) {
  const entries = array(values, "contextChecks", 20);
  if (entries.length === 0) {
    throw new Error("contextChecks needs at least one item");
  }
  const subjects = new Set();
  const linkedLimits = new Set();
  const checks = entries.map((value, index) => {
    const name = `contextChecks[${index}]`;
    object(value, name, [
      "subject",
      "status",
      "explanation",
      "evidence",
      "limitIds",
    ]);
    const subject = text(value.subject, `${name}.subject`);
    if (subjects.has(subject)) throw new Error(`${name} repeats its subject`);
    subjects.add(subject);
    const status = enumeration(
      value.status,
      `${name}.status`,
      contextStatuses,
    );
    const evidence = evidenceList(
      value.evidence,
      `${name}.evidence`,
      sourceMap,
      { allowEmpty: true },
    );
    const limitIds = array(value.limitIds, `${name}.limitIds`, 12);
    if (new Set(limitIds).size !== limitIds.length) {
      throw new Error(`${name}.limitIds contains a duplicate`);
    }
    for (const limitId of limitIds) {
      if (!limitMap.has(limitId)) {
        throw new Error(`${name}.limitIds refers to an unknown limit`);
      }
    }
    if (status === "checked" && evidence.length === 0) {
      throw new Error(`${name} needs evidence when checked`);
    }
    if (status === "checked" && limitIds.length > 0) {
      throw new Error(`${name} cannot link limits when checked`);
    }
    if (status === "limited" && limitIds.length === 0) {
      throw new Error(`${name} needs at least one limit when limited`);
    }
    if (status === "not-applicable" && limitIds.length > 0) {
      throw new Error(`${name} cannot link limits when not applicable`);
    }
    if (status === "limited") {
      for (const limitId of limitIds) linkedLimits.add(limitId);
    }
    return Object.freeze({
      evidence,
      explanation: text(value.explanation, `${name}.explanation`),
      limitIds: Object.freeze([...limitIds]),
      status,
      subject,
    });
  });
  for (const limitId of limitMap.keys()) {
    if (!linkedLimits.has(limitId)) {
      throw new Error(`No context check accounts for ${limitId}`);
    }
  }
  return checks;
}

function validateCodeSteps(values, sourceMap, fileMap) {
  return array(values, "codeSteps", 20).map((value, index) => {
    const name = `codeSteps[${index}]`;
    object(value, name, ["title", "text", "basis", "evidence", "fileIds"]);
    const validatedClaim = claim({
      basis: value.basis,
      evidence: value.evidence,
      text: value.text,
      title: value.title,
    }, name, sourceMap, { title: true });
    const fileIds = array(value.fileIds, `${name}.fileIds`, 20);
    if (fileIds.length === 0) throw new Error(`${name} needs at least one file`);
    if (new Set(fileIds).size !== fileIds.length) {
      throw new Error(`${name}.fileIds contains a duplicate`);
    }
    for (const fileId of fileIds) {
      if (!fileMap.has(fileId)) throw new Error(`${name} refers to an unknown file`);
    }
    const evidenceFiles = new Set(
      validatedClaim.evidence.map((item) => item.fileId).filter(Boolean),
    );
    if (evidenceFiles.size === 0) {
      throw new Error(`${name} needs code evidence`);
    }
    if (
      [...evidenceFiles].some((id) => !fileIds.includes(id))
      || fileIds.some((id) => !evidenceFiles.has(id))
    ) {
      throw new Error(`${name} evidence does not match its files`);
    }
    return Object.freeze({ ...validatedClaim, fileIds: Object.freeze([...fileIds]) });
  });
}

export function validateAnalysis(analysis, snapshot, {
  runId,
} = {}) {
  if (snapshot?.schemaVersion !== CONTRACT_VERSION) {
    throw new RangeError("Unsupported Hope snapshot schema");
  }
  object(analysis, "analysis", [
    "schemaVersion",
    "runId",
    "snapshotDigest",
    "locale",
    "purpose",
    "coreChange",
    "contextChecks",
    "background",
    "behavior",
    "codeSteps",
    "reviewItems",
    "fileDispositions",
    "limitImpacts",
    "quiz",
  ]);
  if (analysis.schemaVersion !== CONTRACT_VERSION) {
    throw new RangeError("Unsupported Hope analysis schema");
  }
  if (analysis.runId !== runId) throw new Error("Analysis runId does not match");
  if (analysis.snapshotDigest !== snapshot.digest) {
    throw new Error("Analysis snapshot digest does not match");
  }
  if (analysis.locale !== snapshot.settings.locale) {
    throw new Error("Analysis locale does not match the prepared review");
  }

  const sourceMap = new Map(snapshot.sources.map((source) => [source.id, source]));
  const fileMap = new Map(snapshot.files.map((file) => [file.id, file]));
  const limitMap = new Map(snapshot.limits.map((limit) => [limit.id, limit]));
  const core = object(
    analysis.coreChange,
    "coreChange",
    ["before", "after", "why", "details"],
  );
  const background = analysis.background === undefined
    ? []
    : array(analysis.background, "background", 8).map(
      (value, index) => claim(value, `background[${index}]`, sourceMap, { title: true }),
    );
  let behavior;
  if (analysis.behavior !== undefined) {
    object(analysis.behavior, "behavior", ["summary", "steps"]);
    const steps = array(analysis.behavior.steps, "behavior.steps", 12);
    if (steps.length < 2) throw new Error("behavior.steps needs at least two steps");
    behavior = Object.freeze({
      steps: steps.map(
        (value, index) => claim(value, `behavior.steps[${index}]`, sourceMap),
      ),
      summary: claim(analysis.behavior.summary, "behavior.summary", sourceMap),
    });
  }

  const sorted = sortReviewItems(array(
    analysis.reviewItems,
    "reviewItems",
    LIMITS.modelItems,
  ).map((value, index) => reviewItem(value, index, sourceMap, limitMap)));
  const reviewItems = sorted.map((item, index) => Object.freeze({
    ...item,
    id: `review-item-${index + 1}`,
    originalIndex: undefined,
  }));
  const limits = validateLimitImpacts(analysis.limitImpacts, snapshot);
  const contextChecks = validateContextChecks(
    analysis.contextChecks,
    sourceMap,
    limitMap,
  );
  const files = validateFileDispositions(analysis.fileDispositions, snapshot);

  let quiz = [];
  if (analysis.quiz !== undefined) {
    const values = array(analysis.quiz, "quiz", 5);
    if (values.length < 3) throw new Error("quiz needs at least three questions");
    quiz = values.map((value, index) => {
      const name = `quiz[${index}]`;
      object(value, name, ["question", "answer", "evidence"]);
      return Object.freeze({
        answer: text(value.answer, `${name}.answer`),
        evidence: evidenceList(value.evidence, `${name}.evidence`, sourceMap, {
          maximum: 8,
        }),
        id: `quiz-${index + 1}`,
        question: text(value.question, `${name}.question`),
      });
    });
  }

  const coreChange = Object.freeze({
    after: claim(core.after, "coreChange.after", sourceMap),
    before: claim(core.before, "coreChange.before", sourceMap),
    details: Object.freeze(array(core.details, "coreChange.details", 12).map(
      (value, index) => claim(value, `coreChange.details[${index}]`, sourceMap),
    )),
    why: claim(core.why, "coreChange.why", sourceMap),
  });
  if (coreChange.details.length === 0) {
    throw new Error("coreChange.details needs the main explanation");
  }
  if (!snapshot.files.some((file) => file.bodyState === "included")) {
    throw new Error("The core change cannot be grounded without an included file");
  }
  for (const [name, value] of [
    ["coreChange.before", coreChange.before],
    ["coreChange.after", coreChange.after],
  ]) {
    if (
      value.basis === "unknown"
      || !value.evidence.some((item) => codeSources.has(item.sourceKind))
    ) {
      throw new Error(`${name} must be grounded in collected code`);
    }
  }

  const purpose = claim(analysis.purpose, "purpose", sourceMap);
  if (!["stated", "inferred", "unknown"].includes(purpose.basis)) {
    throw new Error("purpose basis must be stated, inferred, or unknown");
  }
  const sourceIndex = snapshot.sources.map((source) => Object.freeze({
    fileId: source.fileId,
    kind: source.kind,
    lineCount: source.lineCount,
    path: source.path,
    revision: source.revision,
  }));

  return Object.freeze({
    analysisSchemaVersion: CONTRACT_VERSION,
    background: Object.freeze(background),
    behavior,
    codeSteps: Object.freeze(validateCodeSteps(analysis.codeSteps, sourceMap, fileMap)),
    contextChecks: Object.freeze(contextChecks),
    coreChange,
    files: Object.freeze(files),
    limits: Object.freeze(limits),
    purpose,
    quiz: Object.freeze(quiz),
    result: deriveReviewResult(reviewItems, limits),
    reviewItems: Object.freeze(reviewItems),
    runId,
    sourceIndex: Object.freeze(sourceIndex),
    snapshot: Object.freeze({
      capturedAt: snapshot.capturedAt,
      digest: snapshot.digest,
      pullRequest: snapshot.pullRequest,
      repository: snapshot.repository,
      settings: snapshot.settings,
      snapshot: snapshot.snapshot,
    }),
  });
}
