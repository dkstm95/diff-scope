import { canonicalizeJson, collectSecretIssues } from "./safety.mjs";

const ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const SHA_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/;
const URL_PATTERN = /^https:\/\/github\.com\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}\/pull\/[1-9][0-9]*$/;
const WINDOWS_DRIVE_PATTERN = /^[a-zA-Z]:/;
const URL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const BASIS = ["declared", "observed", "inferred", "unknown"];
const EVIDENCE_SOURCES = [
  "pr-description",
  "commit",
  "code",
  "test",
];
const FILE_STATUSES = ["added", "modified", "deleted", "renamed", "copied", "type-changed"];
const BODY_STATES = [
  "included",
  "redacted",
  "binary",
  "generated-or-lockfile",
  "secret-path",
  "invalid-utf8",
  "missing-patch",
  "submodule",
  "symlink",
  "size-limit",
  "metadata-only",
];

export class ReviewValidationError extends Error {
  constructor(issues) {
    super(`ReviewModelV1 validation failed:\n- ${issues.join("\n- ")}`);
    this.name = "ReviewValidationError";
    this.issues = issues;
  }
}

export class ChangeRequestBindingError extends Error {
  constructor(issues) {
    super(`ChangeRequestV1 binding failed:\n- ${issues.join("\n- ")}`);
    this.name = "ChangeRequestBindingError";
    this.issues = issues;
  }
}

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function child(parent, key) {
  return parent === "$" ? `$.${key}` : `${parent}.${key}`;
}

function record(value, path, requiredKeys, allowedKeys, issues) {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return false;
  }
  for (const key of requiredKeys) {
    if (!own(value, key)) issues.push(`${child(path, key)} is required`);
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) issues.push(`${child(path, key)} is not allowed`);
  }
  return true;
}

function array(value, path, minimum, maximum, issues) {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array`);
    return false;
  }
  if (value.length < minimum || value.length > maximum) {
    issues.push(`${path} must contain between ${minimum} and ${maximum} items`);
    return false;
  }
  return true;
}

function text(value, path, issues) {
  if (typeof value !== "string") {
    issues.push(`${path} must be a string`);
    return false;
  }
  if (value.trim().length === 0) issues.push(`${path} must not be empty or whitespace-only`);
  if (Array.from(value).length > 4000) issues.push(`${path} must contain at most 4000 characters`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    issues.push(`${path} contains a disallowed control character`);
  }
  return true;
}

function integer(value, path, minimum, issues) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    issues.push(`${path} must be a safe integer greater than or equal to ${minimum}`);
    return false;
  }
  return true;
}

function id(value, path, issues) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    issues.push(`${path} must match ${ID_PATTERN}`);
    return false;
  }
  return true;
}

export function isSafeReviewPath(value) {
  if (typeof value !== "string" || value.length === 0 || Array.from(value).length > 300) {
    return false;
  }
  if (
    /[\u0000-\u001f\u007f]/u.test(value) ||
    value.includes("\\") ||
    value.trim() !== value ||
    value.startsWith("/") ||
    value.startsWith("~") ||
    WINDOWS_DRIVE_PATTERN.test(value) ||
    URL_SCHEME_PATTERN.test(value)
  ) {
    return false;
  }
  return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function relativePath(value, path, issues) {
  if (!isSafeReviewPath(value)) issues.push(`${path} must be a safe relative POSIX path`);
}

function enumValue(value, path, allowed, issues) {
  if (!allowed.includes(value)) issues.push(`${path} must be ${allowed.join(", ")}`);
}

function uniqueStrings(values, path, label, issues) {
  if (!Array.isArray(values)) return;
  const seen = new Set();
  values.forEach((value, index) => {
    if (typeof value !== "string") return;
    if (seen.has(value)) issues.push(`${path}[${index}] duplicates ${label} "${value}"`);
    seen.add(value);
  });
}

function idList(value, path, minimum, maximum, issues) {
  if (!array(value, path, minimum, maximum, issues)) return;
  value.forEach((entry, index) => id(entry, `${path}[${index}]`, issues));
  uniqueStrings(value, path, "id", issues);
}

function validateExclusion(value, path, issues) {
  const keys = ["path", "reason"];
  if (!record(value, path, keys, keys, issues)) return;
  relativePath(value.path, `${path}.path`, issues);
  text(value.reason, `${path}.reason`, issues);
}

function validateCoverage(value, path, issues) {
  const keys = [
    "status",
    "discoveredFiles",
    "representedFiles",
    "includedBodies",
    "metadataOnlyBodies",
    "additions",
    "deletions",
    "changedLines",
    "analyzedChangedLines",
    "patchBytes",
  ];
  if (!record(value, path, keys, keys, issues)) return;
  enumValue(value.status, `${path}.status`, ["complete", "partial", "blocked"], issues);
  for (const key of keys.slice(1)) integer(value[key], `${path}.${key}`, 0, issues);
  if (Number.isSafeInteger(value.analyzedChangedLines) && value.analyzedChangedLines > 4000) {
    issues.push(`${path}.analyzedChangedLines must be at most 4000`);
  }
  if (
    Number.isSafeInteger(value.analyzedChangedLines) &&
    Number.isSafeInteger(value.changedLines) &&
    value.analyzedChangedLines > value.changedLines
  ) {
    issues.push(`${path}.analyzedChangedLines cannot exceed ${path}.changedLines`);
  }
}

function validateComparison(value, path, issues) {
  const keys = ["kind", "fromSha", "toSha"];
  if (!record(value, path, keys, keys, issues)) return;
  if (value.kind !== "merge-base-to-head") issues.push(`${path}.kind must be merge-base-to-head`);
  if (typeof value.fromSha !== "string" || !SHA_PATTERN.test(value.fromSha)) {
    issues.push(`${path}.fromSha must be a full lowercase Git object id`);
  }
  if (typeof value.toSha !== "string" || !SHA_PATTERN.test(value.toSha)) {
    issues.push(`${path}.toSha must be a full lowercase Git object id`);
  }
}

function validateChangeFile(value, path, issues) {
  const keys = ["path", "previousPath", "status", "additions", "deletions", "bodyState"];
  if (!record(value, path, keys, keys, issues)) return;
  relativePath(value.path, `${path}.path`, issues);
  if (value.previousPath !== null) relativePath(value.previousPath, `${path}.previousPath`, issues);
  enumValue(value.status, `${path}.status`, FILE_STATUSES, issues);
  integer(value.additions, `${path}.additions`, 0, issues);
  integer(value.deletions, `${path}.deletions`, 0, issues);
  enumValue(value.bodyState, `${path}.bodyState`, BODY_STATES, issues);
}

function validateChangeRequestBinding(value, path, issues) {
  const keys = [
    "provider", "repository", "id", "url", "title", "author", "state", "reviewStage",
    "isDraft", "baseSha", "headSha", "mergeBaseSha", "comparison", "commitCount", "fingerprint",
    "coverage", "warnings", "exclusions", "files",
  ];
  if (!record(value, path, keys, keys, issues)) return;
  if (value.provider !== "github") issues.push(`${path}.provider must be github`);
  if (typeof value.repository !== "string" || !REPOSITORY_PATTERN.test(value.repository)) {
    issues.push(`${path}.repository must be owner/name`);
  }
  if (typeof value.id !== "string" || !/^[1-9][0-9]*$/u.test(value.id) || value.id.length > 20) {
    issues.push(`${path}.id must be a positive decimal Change Request id`);
  }
  if (typeof value.url !== "string" || !URL_PATTERN.test(value.url) || value.url.length > 300) {
    issues.push(`${path}.url must be the canonical GitHub pull request URL`);
  }
  text(value.title, `${path}.title`, issues);
  text(value.author, `${path}.author`, issues);
  enumValue(value.state, `${path}.state`, ["open", "closed", "merged"], issues);
  enumValue(value.reviewStage, `${path}.reviewStage`, ["draft", "ready", "historical", "abandoned"], issues);
  if (typeof value.isDraft !== "boolean") issues.push(`${path}.isDraft must be a boolean`);
  for (const key of ["baseSha", "headSha", "mergeBaseSha"]) {
    if (typeof value[key] !== "string" || !SHA_PATTERN.test(value[key])) {
      issues.push(`${path}.${key} must be a full lowercase Git object id`);
    }
  }
  validateComparison(value.comparison, `${path}.comparison`, issues);
  if (!Number.isSafeInteger(value.commitCount) || value.commitCount < 1 || value.commitCount > 250) {
    issues.push(`${path}.commitCount must be an integer between 1 and 250`);
  }
  if (typeof value.fingerprint !== "string" || !FINGERPRINT_PATTERN.test(value.fingerprint)) {
    issues.push(`${path}.fingerprint must be a lowercase SHA-256 digest`);
  }
  validateCoverage(value.coverage, `${path}.coverage`, issues);
  if (array(value.warnings, `${path}.warnings`, 0, 40, issues)) {
    value.warnings.forEach((entry, index) => text(entry, `${path}.warnings[${index}]`, issues));
  }
  if (array(value.exclusions, `${path}.exclusions`, 0, 100, issues)) {
    value.exclusions.forEach((entry, index) => validateExclusion(entry, `${path}.exclusions[${index}]`, issues));
  }
  if (array(value.files, `${path}.files`, 1, 80, issues)) {
    value.files.forEach((entry, index) => validateChangeFile(entry, `${path}.files[${index}]`, issues));
    uniqueStrings(value.files.map((entry) => entry?.path), `${path}.files`, "path", issues);
  }
  if (isRecord(value.comparison)) {
    if (value.comparison.fromSha !== value.mergeBaseSha) {
      issues.push(`${path}.comparison.fromSha must equal ${path}.mergeBaseSha`);
    }
    if (value.comparison.toSha !== value.headSha) {
      issues.push(`${path}.comparison.toSha must equal ${path}.headSha`);
    }
  }
  if (value.reviewStage === "draft" && value.isDraft !== true) {
    issues.push(`${path}.reviewStage draft requires isDraft true`);
  }
  if (value.reviewStage === "ready" && (value.state !== "open" || value.isDraft !== false)) {
    issues.push(`${path}.reviewStage ready requires an open non-draft Change Request`);
  }
}

function validateEvidence(value, path, issues) {
  const keys = ["id", "source", "label", "path", "side", "startLine", "endLine", "commitSha", "excerpt"];
  if (!record(value, path, keys, keys, issues)) return;
  id(value.id, `${path}.id`, issues);
  enumValue(value.source, `${path}.source`, EVIDENCE_SOURCES, issues);
  text(value.label, `${path}.label`, issues);
  if (value.path !== null) relativePath(value.path, `${path}.path`, issues);
  if (![null, "base", "head"].includes(value.side)) {
    issues.push(`${path}.side must be null, base, or head`);
  }
  if (value.startLine !== null) integer(value.startLine, `${path}.startLine`, 1, issues);
  if (value.endLine !== null) integer(value.endLine, `${path}.endLine`, 1, issues);
  if (value.excerpt === null) issues.push(`${path}.excerpt is required for evidence binding`);
  else text(value.excerpt, `${path}.excerpt`, issues);
  if (["code", "test"].includes(value.source) && value.path === null) {
    issues.push(`${path}.path is required for ${value.source} evidence`);
  }
  if (["pr-description", "commit"].includes(value.source) && value.path !== null) {
    issues.push(`${path}.path must be null for ${value.source} evidence`);
  }
  if (value.side !== null || value.startLine !== null || value.endLine !== null) {
    issues.push(`${path}.side, startLine, and endLine must be null in this alpha; the excerpt is bound directly`);
  }
  if (value.source === "commit") {
    if (typeof value.commitSha !== "string" || !SHA_PATTERN.test(value.commitSha)) {
      issues.push(`${path}.commitSha is required for commit evidence`);
    }
  } else if (value.commitSha !== null) {
    issues.push(`${path}.commitSha must be null unless source is commit`);
  }
}

function validateClaim(value, path, issues, claimEntries) {
  const keys = ["id", "text", "basis", "evidenceIds"];
  if (!record(value, path, keys, keys, issues)) return;
  id(value.id, `${path}.id`, issues);
  text(value.text, `${path}.text`, issues);
  enumValue(value.basis, `${path}.basis`, BASIS, issues);
  idList(value.evidenceIds, `${path}.evidenceIds`, 0, 30, issues);
  claimEntries.push({ value, path });
}

function validateBeforeAfter(value, path, issues, claimEntries) {
  const keys = ["id", "area", "before", "after", "why", "basis", "evidenceIds"];
  if (!record(value, path, keys, keys, issues)) return;
  id(value.id, `${path}.id`, issues);
  for (const key of ["area", "before", "after", "why"]) text(value[key], `${path}.${key}`, issues);
  enumValue(value.basis, `${path}.basis`, BASIS, issues);
  idList(value.evidenceIds, `${path}.evidenceIds`, 0, 30, issues);
  claimEntries.push({ value, path });
}

function validateWorkstream(value, path, issues, claimEntries) {
  const keys = ["id", "title", "summary", "steps", "evidenceIds"];
  if (!record(value, path, keys, keys, issues)) return;
  id(value.id, `${path}.id`, issues);
  text(value.title, `${path}.title`, issues);
  text(value.summary, `${path}.summary`, issues);
  idList(value.evidenceIds, `${path}.evidenceIds`, 0, 30, issues);
  if (array(value.steps, `${path}.steps`, 1, 30, issues)) {
    value.steps.forEach((step, index) => {
      const stepPath = `${path}.steps[${index}]`;
      const stepKeys = ["id", "component", "behavior", "basis", "evidenceIds"];
      if (!record(step, stepPath, stepKeys, stepKeys, issues)) return;
      id(step.id, `${stepPath}.id`, issues);
      text(step.component, `${stepPath}.component`, issues);
      text(step.behavior, `${stepPath}.behavior`, issues);
      enumValue(step.basis, `${stepPath}.basis`, BASIS, issues);
      idList(step.evidenceIds, `${stepPath}.evidenceIds`, 0, 30, issues);
      claimEntries.push({ value: step, path: stepPath });
    });
  }
}

function validateLiterateDiff(value, path, issues) {
  const keys = ["id", "path", "role", "changes"];
  if (!record(value, path, keys, keys, issues)) return;
  id(value.id, `${path}.id`, issues);
  relativePath(value.path, `${path}.path`, issues);
  text(value.role, `${path}.role`, issues);
  if (array(value.changes, `${path}.changes`, 1, 20, issues)) {
    value.changes.forEach((change, index) => {
      const changePath = `${path}.changes[${index}]`;
      const changeKeys = ["id", "headline", "explanation", "evidenceIds"];
      if (!record(change, changePath, changeKeys, changeKeys, issues)) return;
      id(change.id, `${changePath}.id`, issues);
      text(change.headline, `${changePath}.headline`, issues);
      text(change.explanation, `${changePath}.explanation`, issues);
      idList(change.evidenceIds, `${changePath}.evidenceIds`, 1, 30, issues);
    });
  }
}

function validateVisual(value, path, issues) {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return;
  }
  const common = ["id", "kind", "title", "caption", "evidenceIds"];
  const kindKeys = value.kind === "before-after" ? ["items"] : value.kind === "flow" ? ["steps"] : value.kind === "decision-table" ? ["columns", "rows"] : [];
  if (!record(value, path, [...common, ...kindKeys], [...common, ...kindKeys], issues)) return;
  id(value.id, `${path}.id`, issues);
  enumValue(value.kind, `${path}.kind`, ["before-after", "flow", "decision-table"], issues);
  text(value.title, `${path}.title`, issues);
  text(value.caption, `${path}.caption`, issues);
  idList(value.evidenceIds, `${path}.evidenceIds`, 0, 30, issues);
  if (value.kind === "before-after" && array(value.items, `${path}.items`, 1, 12, issues)) {
    value.items.forEach((item, index) => {
      const itemPath = `${path}.items[${index}]`;
      const keys = ["label", "before", "after"];
      if (!record(item, itemPath, keys, keys, issues)) return;
      for (const key of keys) text(item[key], `${itemPath}.${key}`, issues);
    });
  }
  if (value.kind === "flow" && array(value.steps, `${path}.steps`, 2, 16, issues)) {
    value.steps.forEach((step, index) => {
      const stepPath = `${path}.steps[${index}]`;
      const keys = ["id", "label", "detail"];
      if (!record(step, stepPath, keys, keys, issues)) return;
      id(step.id, `${stepPath}.id`, issues);
      text(step.label, `${stepPath}.label`, issues);
      text(step.detail, `${stepPath}.detail`, issues);
    });
  }
  if (value.kind === "decision-table") {
    if (array(value.columns, `${path}.columns`, 2, 8, issues)) {
      value.columns.forEach((entry, index) => text(entry, `${path}.columns[${index}]`, issues));
    }
    if (array(value.rows, `${path}.rows`, 1, 20, issues)) {
      value.rows.forEach((row, index) => {
        const rowPath = `${path}.rows[${index}]`;
        const keys = ["label", "cells"];
        if (!record(row, rowPath, keys, keys, issues)) return;
        text(row.label, `${rowPath}.label`, issues);
        if (array(row.cells, `${rowPath}.cells`, 2, 8, issues)) {
          row.cells.forEach((cell, cellIndex) => text(cell, `${rowPath}.cells[${cellIndex}]`, issues));
          if (Array.isArray(value.columns) && row.cells.length !== value.columns.length) {
            issues.push(`${rowPath}.cells must match the decision-table column count`);
          }
        }
      });
    }
  }
}

function validateDecision(value, path, issues, claimEntries) {
  const keys = ["id", "decision", "rationale", "tradeoff", "basis", "evidenceIds"];
  if (!record(value, path, keys, keys, issues)) return;
  id(value.id, `${path}.id`, issues);
  for (const key of ["decision", "rationale", "tradeoff"]) text(value[key], `${path}.${key}`, issues);
  enumValue(value.basis, `${path}.basis`, BASIS, issues);
  idList(value.evidenceIds, `${path}.evidenceIds`, 0, 30, issues);
  claimEntries.push({ value, path });
}

function validateVerification(value, path, issues) {
  const keys = ["id", "command", "status", "result", "evidenceIds"];
  if (!record(value, path, keys, keys, issues)) return;
  id(value.id, `${path}.id`, issues);
  text(value.command, `${path}.command`, issues);
  enumValue(value.status, `${path}.status`, ["not-run", "unknown"], issues);
  text(value.result, `${path}.result`, issues);
  idList(value.evidenceIds, `${path}.evidenceIds`, 0, 30, issues);
}

function validateAuthorQuestion(value, path, issues) {
  const keys = ["id", "question", "why", "unknownClaimIds", "evidenceIds"];
  if (!record(value, path, keys, keys, issues)) return;
  id(value.id, `${path}.id`, issues);
  text(value.question, `${path}.question`, issues);
  text(value.why, `${path}.why`, issues);
  idList(value.unknownClaimIds, `${path}.unknownClaimIds`, 0, 30, issues);
  idList(value.evidenceIds, `${path}.evidenceIds`, 0, 30, issues);
}

function validateOption(value, path, issues) {
  const keys = ["id", "text"];
  if (!record(value, path, keys, keys, issues)) return;
  id(value.id, `${path}.id`, issues);
  text(value.text, `${path}.text`, issues);
}

function validateQuiz(value, path, issues) {
  const keys = ["passPercent", "questions"];
  if (!record(value, path, keys, keys, issues)) return;
  if (!Number.isSafeInteger(value.passPercent) || value.passPercent < 1 || value.passPercent > 100) {
    issues.push(`${path}.passPercent must be an integer between 1 and 100`);
  }
  if (!array(value.questions, `${path}.questions`, 3, 5, issues)) return;
  value.questions.forEach((question, index) => {
    const questionPath = `${path}.questions[${index}]`;
    const questionKeys = ["id", "category", "type", "prompt", "options", "correctOptionIds", "explanation", "evidenceIds"];
    if (!record(question, questionPath, questionKeys, questionKeys, issues)) return;
    id(question.id, `${questionPath}.id`, issues);
    enumValue(question.category, `${questionPath}.category`, ["prediction", "flow", "invariant", "risk", "safe-change"], issues);
    enumValue(question.type, `${questionPath}.type`, ["single", "multiple"], issues);
    text(question.prompt, `${questionPath}.prompt`, issues);
    if (array(question.options, `${questionPath}.options`, 2, 6, issues)) {
      question.options.forEach((option, optionIndex) => validateOption(option, `${questionPath}.options[${optionIndex}]`, issues));
      uniqueStrings(question.options.map((option) => option?.id), `${questionPath}.options`, "option id", issues);
    }
    idList(question.correctOptionIds, `${questionPath}.correctOptionIds`, 1, 6, issues);
    text(question.explanation, `${questionPath}.explanation`, issues);
    idList(question.evidenceIds, `${questionPath}.evidenceIds`, 1, 30, issues);
    const knownOptions = new Set(Array.isArray(question.options) ? question.options.map((option) => option?.id) : []);
    for (const answerId of Array.isArray(question.correctOptionIds) ? question.correctOptionIds : []) {
      if (!knownOptions.has(answerId)) issues.push(`${questionPath}.correctOptionIds references unknown option "${answerId}"`);
    }
    if (question.type === "single" && question.correctOptionIds?.length !== 1) {
      issues.push(`${questionPath}.correctOptionIds must contain exactly one answer for single`);
    }
  });
  uniqueStrings(value.questions.map((question) => question?.id), `${path}.questions`, "question id", issues);
  if (!value.questions.some((question) => question?.category === "prediction")) {
    issues.push(`${path}.questions must include a prediction question`);
  }
  if (!value.questions.some((question) => ["invariant", "risk"].includes(question?.category))) {
    issues.push(`${path}.questions must include an invariant or risk question`);
  }
}

function validateTrace(value, path, issues) {
  const keys = ["steps", "outcome"];
  if (!record(value, path, keys, keys, issues)) return;
  if (array(value.steps, `${path}.steps`, 1, 12, issues)) {
    value.steps.forEach((step, index) => {
      const stepPath = `${path}.steps[${index}]`;
      const stepKeys = ["component", "behavior"];
      if (!record(step, stepPath, stepKeys, stepKeys, issues)) return;
      text(step.component, `${stepPath}.component`, issues);
      text(step.behavior, `${stepPath}.behavior`, issues);
    });
  }
  text(value.outcome, `${path}.outcome`, issues);
}

function combinationKey(pairs) {
  return pairs.map(([controlId, optionId]) => `${controlId}=${optionId}`).join("\u0001");
}

function enumerateCombinations(controls) {
  let combinations = [[]];
  for (const control of controls) {
    combinations = combinations.flatMap((combination) =>
      control.options.map((option) => [...combination, [control.id, option.id]]),
    );
  }
  return combinations;
}

function validateMicroworld(value, path, issues) {
  if (value === null) return;
  const keys = ["title", "instructions", "evidenceIds", "controls", "scenarios"];
  if (!record(value, path, keys, keys, issues)) return;
  text(value.title, `${path}.title`, issues);
  text(value.instructions, `${path}.instructions`, issues);
  idList(value.evidenceIds, `${path}.evidenceIds`, 1, 30, issues);
  if (array(value.controls, `${path}.controls`, 1, 3, issues)) {
    value.controls.forEach((control, index) => {
      const controlPath = `${path}.controls[${index}]`;
      const controlKeys = ["id", "label", "defaultOptionId", "options"];
      if (!record(control, controlPath, controlKeys, controlKeys, issues)) return;
      id(control.id, `${controlPath}.id`, issues);
      text(control.label, `${controlPath}.label`, issues);
      id(control.defaultOptionId, `${controlPath}.defaultOptionId`, issues);
      if (array(control.options, `${controlPath}.options`, 2, 4, issues)) {
        control.options.forEach((option, optionIndex) => validateOption(option, `${controlPath}.options[${optionIndex}]`, issues));
        uniqueStrings(control.options.map((option) => option?.id), `${controlPath}.options`, "option id", issues);
        if (!control.options.some((option) => option?.id === control.defaultOptionId)) {
          issues.push(`${controlPath}.defaultOptionId references an unknown option`);
        }
      }
    });
    uniqueStrings(value.controls.map((control) => control?.id), `${path}.controls`, "control id", issues);
  }
  if (array(value.scenarios, `${path}.scenarios`, 2, 12, issues)) {
    value.scenarios.forEach((scenario, index) => {
      const scenarioPath = `${path}.scenarios[${index}]`;
      const scenarioKeys = ["id", "title", "when", "before", "after", "lesson"];
      if (!record(scenario, scenarioPath, scenarioKeys, scenarioKeys, issues)) return;
      id(scenario.id, `${scenarioPath}.id`, issues);
      text(scenario.title, `${scenarioPath}.title`, issues);
      if (array(scenario.when, `${scenarioPath}.when`, 1, 3, issues)) {
        scenario.when.forEach((condition, conditionIndex) => {
          const conditionPath = `${scenarioPath}.when[${conditionIndex}]`;
          const conditionKeys = ["controlId", "optionId"];
          if (!record(condition, conditionPath, conditionKeys, conditionKeys, issues)) return;
          id(condition.controlId, `${conditionPath}.controlId`, issues);
          id(condition.optionId, `${conditionPath}.optionId`, issues);
        });
      }
      validateTrace(scenario.before, `${scenarioPath}.before`, issues);
      validateTrace(scenario.after, `${scenarioPath}.after`, issues);
      text(scenario.lesson, `${scenarioPath}.lesson`, issues);
    });
    uniqueStrings(value.scenarios.map((scenario) => scenario?.id), `${path}.scenarios`, "scenario id", issues);
  }

  const controls = Array.isArray(value.controls) ? value.controls : [];
  const enumerable = controls.length >= 1 && controls.length <= 3 && controls.every((control) =>
    isRecord(control) && typeof control.id === "string" && Array.isArray(control.options) &&
    control.options.length >= 2 && control.options.length <= 4 &&
    control.options.every((option) => isRecord(option) && typeof option.id === "string"),
  );
  const count = enumerable ? controls.reduce((total, control) => total * control.options.length, 1) : 0;
  if (count > 12) issues.push(`${path}.controls produce more than 12 combinations`);
  if (!enumerable || count > 12 || !Array.isArray(value.scenarios)) return;
  const expected = new Set(enumerateCombinations(controls).map(combinationKey));
  const actual = new Map();
  const optionsByControl = new Map(controls.map((control) => [control.id, new Set(control.options.map((option) => option.id))]));
  value.scenarios.forEach((scenario, scenarioIndex) => {
    if (!Array.isArray(scenario?.when)) return;
    const pairs = [];
    const seenControls = new Set();
    scenario.when.forEach((condition, conditionIndex) => {
      if (!isRecord(condition)) return;
      if (!optionsByControl.has(condition.controlId)) {
        issues.push(`${path}.scenarios[${scenarioIndex}].when[${conditionIndex}] references an unknown control`);
        return;
      }
      if (!optionsByControl.get(condition.controlId).has(condition.optionId)) {
        issues.push(`${path}.scenarios[${scenarioIndex}].when[${conditionIndex}] references an unknown option`);
      }
      if (seenControls.has(condition.controlId)) {
        issues.push(`${path}.scenarios[${scenarioIndex}].when duplicates control "${condition.controlId}"`);
      }
      seenControls.add(condition.controlId);
      pairs.push([condition.controlId, condition.optionId]);
    });
    if (seenControls.size !== controls.length) {
      issues.push(`${path}.scenarios[${scenarioIndex}].when must bind every control exactly once`);
      return;
    }
    const ordered = controls.map((control) => pairs.find(([controlId]) => controlId === control.id));
    if (ordered.some((pair) => pair === undefined)) return;
    const key = combinationKey(ordered);
    if (!expected.has(key)) return;
    if (actual.has(key)) issues.push(`${path}.scenarios[${scenarioIndex}] duplicates a control combination`);
    actual.set(key, scenarioIndex);
  });
  for (const key of expected) {
    if (!actual.has(key)) issues.push(`${path}.scenarios is missing a control combination`);
  }
}

function validateSsotCandidate(value, path, issues) {
  const keys = ["id", "insight", "whyDurable", "target", "path", "evidenceIds"];
  if (!record(value, path, keys, keys, issues)) return;
  id(value.id, `${path}.id`, issues);
  text(value.insight, `${path}.insight`, issues);
  text(value.whyDurable, `${path}.whyDurable`, issues);
  enumValue(value.target, `${path}.target`, ["test", "code-comment", "architecture-doc", "api-doc", "runbook", "existing-project-ssot"], issues);
  if (value.path !== null) relativePath(value.path, `${path}.path`, issues);
  idList(value.evidenceIds, `${path}.evidenceIds`, 1, 30, issues);
}

function gatherEvidenceReferences(review) {
  const references = [];
  const add = (value, path) => {
    if (Array.isArray(value)) references.push({ value, path });
  };
  review.background?.forEach((entry, index) => add(entry?.evidenceIds, `$.background[${index}].evidenceIds`));
  add(review.overview?.summary?.evidenceIds, "$.overview.summary.evidenceIds");
  review.overview?.observableChanges?.forEach((entry, index) => add(entry?.evidenceIds, `$.overview.observableChanges[${index}].evidenceIds`));
  review.overview?.beforeAfter?.forEach((entry, index) => add(entry?.evidenceIds, `$.overview.beforeAfter[${index}].evidenceIds`));
  review.workstreams?.forEach((workstream, index) => {
    add(workstream?.evidenceIds, `$.workstreams[${index}].evidenceIds`);
    workstream?.steps?.forEach((step, stepIndex) => add(step?.evidenceIds, `$.workstreams[${index}].steps[${stepIndex}].evidenceIds`));
  });
  review.literateDiff?.forEach((entry, index) => entry?.changes?.forEach((change, changeIndex) => add(change?.evidenceIds, `$.literateDiff[${index}].changes[${changeIndex}].evidenceIds`)));
  review.visuals?.forEach((entry, index) => add(entry?.evidenceIds, `$.visuals[${index}].evidenceIds`));
  for (const collection of ["invariants", "risks", "decisions", "verification", "authorQuestions", "ssotCandidates"]) {
    review[collection]?.forEach((entry, index) => add(entry?.evidenceIds, `$.${collection}[${index}].evidenceIds`));
  }
  review.quiz?.questions?.forEach((entry, index) => add(entry?.evidenceIds, `$.quiz.questions[${index}].evidenceIds`));
  add(review.microworld?.evidenceIds, "$.microworld.evidenceIds");
  return references;
}

export function collectReviewModelIssues(review) {
  const issues = [];
  const keys = [
    "schemaVersion", "title", "changeRequest", "background", "overview", "workstreams",
    "literateDiff", "visuals", "visualOmissionReason", "invariants", "risks", "decisions",
    "verification", "authorQuestions", "quiz", "microworld", "ssotCandidates", "evidence",
  ];
  if (!record(review, "$", keys, keys, issues)) return issues;
  if (review.schemaVersion !== 1) issues.push("$.schemaVersion must be 1");
  text(review.title, "$.title", issues);
  validateChangeRequestBinding(review.changeRequest, "$.changeRequest", issues);

  const claimEntries = [];
  if (array(review.background, "$.background", 0, 20, issues)) {
    review.background.forEach((entry, index) => validateClaim(entry, `$.background[${index}]`, issues, claimEntries));
  }
  const overviewKeys = ["summary", "observableChanges", "beforeAfter"];
  if (record(review.overview, "$.overview", overviewKeys, overviewKeys, issues)) {
    validateClaim(review.overview.summary, "$.overview.summary", issues, claimEntries);
    if (array(review.overview.observableChanges, "$.overview.observableChanges", 1, 20, issues)) {
      review.overview.observableChanges.forEach((entry, index) => validateClaim(entry, `$.overview.observableChanges[${index}]`, issues, claimEntries));
    }
    if (array(review.overview.beforeAfter, "$.overview.beforeAfter", 1, 20, issues)) {
      review.overview.beforeAfter.forEach((entry, index) => validateBeforeAfter(entry, `$.overview.beforeAfter[${index}]`, issues, claimEntries));
    }
  }
  if (array(review.workstreams, "$.workstreams", 1, 12, issues)) {
    review.workstreams.forEach((entry, index) => validateWorkstream(entry, `$.workstreams[${index}]`, issues, claimEntries));
  }
  if (array(review.literateDiff, "$.literateDiff", 1, 40, issues)) {
    review.literateDiff.forEach((entry, index) => validateLiterateDiff(entry, `$.literateDiff[${index}]`, issues));
    uniqueStrings(review.literateDiff.map((entry) => entry?.path), "$.literateDiff", "path", issues);
  }
  if (array(review.visuals, "$.visuals", 0, 3, issues)) {
    review.visuals.forEach((entry, index) => validateVisual(entry, `$.visuals[${index}]`, issues));
  }
  if (review.visualOmissionReason !== null) text(review.visualOmissionReason, "$.visualOmissionReason", issues);
  if (Array.isArray(review.visuals) && review.visuals.length === 0 && review.visualOmissionReason === null) {
    issues.push("$.visualOmissionReason is required when $.visuals is empty");
  }
  if (Array.isArray(review.visuals) && review.visuals.length > 0 && review.visualOmissionReason !== null) {
    issues.push("$.visualOmissionReason must be null when $.visuals is not empty");
  }
  for (const [collection, minimum] of [["invariants", 1], ["risks", 1]]) {
    if (array(review[collection], `$.${collection}`, minimum, 20, issues)) {
      review[collection].forEach((entry, index) => validateClaim(entry, `$.${collection}[${index}]`, issues, claimEntries));
    }
  }
  if (array(review.decisions, "$.decisions", 0, 20, issues)) {
    review.decisions.forEach((entry, index) => validateDecision(entry, `$.decisions[${index}]`, issues, claimEntries));
  }
  if (array(review.verification, "$.verification", 1, 20, issues)) {
    review.verification.forEach((entry, index) => validateVerification(entry, `$.verification[${index}]`, issues));
  }
  if (array(review.authorQuestions, "$.authorQuestions", 0, 20, issues)) {
    review.authorQuestions.forEach((entry, index) => validateAuthorQuestion(entry, `$.authorQuestions[${index}]`, issues));
  }
  validateQuiz(review.quiz, "$.quiz", issues);
  validateMicroworld(review.microworld, "$.microworld", issues);
  if (array(review.ssotCandidates, "$.ssotCandidates", 0, 10, issues)) {
    review.ssotCandidates.forEach((entry, index) => validateSsotCandidate(entry, `$.ssotCandidates[${index}]`, issues));
  }
  if (array(review.evidence, "$.evidence", 1, 240, issues)) {
    review.evidence.forEach((entry, index) => validateEvidence(entry, `$.evidence[${index}]`, issues));
    uniqueStrings(review.evidence.map((entry) => entry?.id), "$.evidence", "evidence id", issues);
  }

  const evidenceById = new Map((Array.isArray(review.evidence) ? review.evidence : []).map((entry) => [entry?.id, entry]));
  for (const reference of gatherEvidenceReferences(review)) {
    reference.value.forEach((evidenceId, index) => {
      if (typeof evidenceId === "string" && !evidenceById.has(evidenceId)) {
        issues.push(`${reference.path}[${index}] references unknown evidence "${evidenceId}"`);
      }
    });
  }

  const claimIds = claimEntries.map(({ value }) => value?.id);
  uniqueStrings(claimIds, "$", "claim id", issues);
  const unknownIds = new Set(claimEntries.filter(({ value }) => value?.basis === "unknown").map(({ value }) => value.id));
  const questionedUnknownIds = new Set();
  (Array.isArray(review.authorQuestions) ? review.authorQuestions : []).forEach((question, questionIndex) => {
    (Array.isArray(question?.unknownClaimIds) ? question.unknownClaimIds : []).forEach((claimId, claimIndex) => {
      if (!unknownIds.has(claimId)) {
        issues.push(`$.authorQuestions[${questionIndex}].unknownClaimIds[${claimIndex}] must reference an unknown claim`);
      }
      questionedUnknownIds.add(claimId);
    });
  });
  for (const unknownId of unknownIds) {
    if (!questionedUnknownIds.has(unknownId)) issues.push(`unknown claim "${unknownId}" requires an author question`);
  }

  for (const { value, path } of claimEntries) {
    const linkedEvidence = Array.isArray(value?.evidenceIds) ? value.evidenceIds.map((evidenceId) => evidenceById.get(evidenceId)).filter(Boolean) : [];
    if (value?.basis === "declared" && !linkedEvidence.some((entry) => ["pr-description", "commit"].includes(entry.source))) {
      issues.push(`${path}.evidenceIds must cite PR description or commit evidence for declared claims`);
    }
    if (value?.basis === "observed" && !linkedEvidence.some((entry) => ["code", "test"].includes(entry.source))) {
      issues.push(`${path}.evidenceIds must cite code or test evidence for observed claims`);
    }
    if (value?.basis === "inferred" && linkedEvidence.length === 0) {
      issues.push(`${path}.evidenceIds must cite evidence for inferred claims`);
    }
  }

  const changedFiles = new Map((Array.isArray(review.changeRequest?.files) ? review.changeRequest.files : []).map((file) => [file?.path, file]));
  const literatePaths = Array.isArray(review.literateDiff) ? review.literateDiff.map((entry) => entry?.path) : [];
  literatePaths.forEach((path, index) => {
    const file = changedFiles.get(path);
    if (!file) issues.push(`$.literateDiff[${index}].path must reference a changed file`);
    else if (!["included", "redacted"].includes(file.bodyState)) {
      issues.push(`$.literateDiff[${index}].path must reference an included or redacted body`);
    }
    const changes = Array.isArray(review.literateDiff?.[index]?.changes)
      ? review.literateDiff[index].changes
      : [];
    changes.forEach((change, changeIndex) => {
      const hasSamePathEvidence = (Array.isArray(change?.evidenceIds) ? change.evidenceIds : [])
        .map((evidenceId) => evidenceById.get(evidenceId))
        .some(
          (evidence) =>
            ["code", "test"].includes(evidence?.source) && evidence.path === path,
        );
      if (!hasSamePathEvidence) {
        issues.push(
          `$.literateDiff[${index}].changes[${changeIndex}].evidenceIds must cite code or test evidence for ${path}`,
        );
      }
    });
  });
  if (!literatePaths.some((path) => ["included", "redacted"].includes(changedFiles.get(path)?.bodyState))) {
    issues.push("$.literateDiff must cover at least one included or redacted changed file");
  }
  (Array.isArray(review.evidence) ? review.evidence : []).forEach((entry, index) => {
    if (["code", "test"].includes(entry?.source)) {
      const file = changedFiles.get(entry.path);
      if (!file) issues.push(`$.evidence[${index}].path must reference a changed file`);
      else if (!["included", "redacted"].includes(file.bodyState)) {
        issues.push(`$.evidence[${index}].path must reference an included or redacted body`);
      }
    }
  });

  issues.push(...collectSecretIssues(review));
  return issues;
}

export function validateReviewModel(review) {
  const issues = collectReviewModelIssues(review);
  if (issues.length > 0) throw new ReviewValidationError(issues);
  return review;
}

const BOUND_CHANGE_REQUEST_KEYS = [
  "provider", "repository", "id", "url", "title", "author", "state", "reviewStage", "isDraft",
  "baseSha", "headSha", "mergeBaseSha", "comparison", "commitCount", "fingerprint", "coverage", "warnings",
  "exclusions", "files",
];

export function validateReviewAgainstChangeRequest(review, changeRequest) {
  validateReviewModel(review);
  const issues = [];
  if (!isRecord(changeRequest)) {
    throw new ChangeRequestBindingError(["ChangeRequestV1 is required"]);
  }
  if (changeRequest.schemaVersion !== 1) issues.push("ChangeRequestV1.schemaVersion must be 1");
  for (const key of BOUND_CHANGE_REQUEST_KEYS) {
    if (!own(changeRequest, key)) {
      issues.push(`ChangeRequestV1.${key} is required for ReviewModelV1 binding`);
      continue;
    }
    try {
      if (canonicalizeJson(review.changeRequest[key]) !== canonicalizeJson(changeRequest[key])) {
        issues.push(`$.changeRequest.${key} does not exactly match ChangeRequestV1.${key}`);
      }
    } catch {
      issues.push(`ChangeRequestV1.${key} could not be compared deterministically`);
    }
  }
  if (changeRequest.coverage?.status === "blocked") {
    issues.push("ChangeRequestV1 coverage is blocked and cannot be rendered");
  }
  const contextFiles = new Map((Array.isArray(changeRequest.files) ? changeRequest.files : []).map((file) => [file?.path, file]));
  const patchesByPath = new Map((Array.isArray(changeRequest.patches) ? changeRequest.patches : []).map((patch) => [patch?.path, patch?.text]));
  const commitsBySha = new Map((Array.isArray(changeRequest.commits) ? changeRequest.commits : []).map((commit) => [commit?.sha, commit]));
  review.evidence.forEach((entry, index) => {
    if (["code", "test"].includes(entry.source)) {
      const file = contextFiles.get(entry.path);
      if (!file) issues.push(`$.evidence[${index}].path is not included in ChangeRequestV1.files`);
      if (file && ["included", "redacted"].includes(file.bodyState) && !patchesByPath.has(entry.path)) {
        issues.push(`$.evidence[${index}].path has no included ChangeRequestV1 patch`);
      }
      if (entry.excerpt !== null && patchesByPath.has(entry.path)) {
        const patch = String(patchesByPath.get(entry.path)).replaceAll("\r\n", "\n");
        const normalized = patch
          .split("\n")
          .map((line) => (/^[+\- ]/u.test(line) ? line.slice(1) : line))
          .join("\n");
        const excerpt = entry.excerpt.replaceAll("\r\n", "\n");
        if (!patch.includes(excerpt) && !normalized.includes(excerpt)) {
          issues.push(`$.evidence[${index}].excerpt does not occur in the collected ChangeRequestV1 patch`);
        }
      }
    }
    if (entry.source === "pr-description" && entry.excerpt !== null) {
      const description = String(changeRequest.description ?? "").replaceAll("\r\n", "\n");
      const excerpt = entry.excerpt.replaceAll("\r\n", "\n");
      if (!description.includes(excerpt)) {
        issues.push(`$.evidence[${index}].excerpt does not occur in ChangeRequestV1.description`);
      }
    }
    if (entry.source === "commit") {
      const commit = commitsBySha.get(entry.commitSha);
      if (!commit) {
        issues.push(`$.evidence[${index}].commitSha is not included in ChangeRequestV1.commits`);
      } else if (
        entry.excerpt !== null &&
        !String(commit.title).replaceAll("\r\n", "\n").includes(entry.excerpt.replaceAll("\r\n", "\n"))
      ) {
        issues.push(`$.evidence[${index}].excerpt does not occur in the bound ChangeRequestV1 commit title`);
      }
    }
  });
  if (issues.length > 0) throw new ChangeRequestBindingError(issues);
  return review;
}
