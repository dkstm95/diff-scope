import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

import {
  calculateIntentFingerprint,
  canonicalizeJson,
  collectSecretIssues,
  collectIntentIssues,
} from "../../../align/scripts/lib/validate-intent.mjs";

const ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const WINDOWS_DRIVE_PATTERN = /^[a-zA-Z]:/;
const URL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const CHANGE_CONTEXT_FINGERPRINT_DOMAIN = "hope:change-context:v2\0";

function hasControlCharacter(value) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 31 || codePoint === 127;
  });
}

function hasDisallowedTextControlCharacter(value) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return (
      (codePoint >= 0 && codePoint <= 8) ||
      codePoint === 11 ||
      codePoint === 12 ||
      (codePoint >= 14 && codePoint <= 31) ||
      codePoint === 127
    );
  });
}

export class ArtifactValidationError extends Error {
  constructor(issues) {
    super(`ArtifactV2 validation failed:\n- ${issues.join("\n- ")}`);
    this.name = "ArtifactValidationError";
    this.issues = issues;
  }
}

export class ContextBindingError extends Error {
  constructor(issues) {
    super(`ChangeContextV2 binding failed:\n- ${issues.join("\n- ")}`);
    this.name = "ContextBindingError";
    this.issues = issues;
  }
}

export class IntentBindingError extends Error {
  constructor(issues) {
    super(`IntentV1 binding failed:\n- ${issues.join("\n- ")}`);
    this.name = "IntentBindingError";
    this.issues = issues;
  }
}

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function location(parent, child) {
  return parent === "$" ? `$.${child}` : `${parent}.${child}`;
}

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function record(value, path, requiredKeys, allowedKeys, issues) {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return false;
  }

  for (const key of requiredKeys) {
    if (!own(value, key)) {
      issues.push(`${location(path, key)} is required`);
    }
  }

  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      issues.push(`${location(path, key)} is not allowed`);
    }
  }

  return true;
}

function text(value, path, issues) {
  if (typeof value !== "string") {
    issues.push(`${path} must be a string`);
    return false;
  }
  if (value.trim().length === 0) {
    issues.push(`${path} must not be empty or whitespace-only`);
    return false;
  }
  if (Array.from(value).length > 4000) {
    issues.push(`${path} must contain at most 4000 characters`);
    return false;
  }
  if (hasDisallowedTextControlCharacter(value)) {
    issues.push(`${path} contains a disallowed control character`);
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

export function isSafeRelativePosixPath(value) {
  if (typeof value !== "string" || value.length === 0 || Array.from(value).length > 300) {
    return false;
  }
  if (
    hasControlCharacter(value) ||
    value.includes("\\") ||
    value.trim() !== value ||
    value.startsWith("/") ||
    value.startsWith("~") ||
    WINDOWS_DRIVE_PATTERN.test(value) ||
    URL_SCHEME_PATTERN.test(value)
  ) {
    return false;
  }

  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function relativePath(value, path, issues) {
  if (!isSafeRelativePosixPath(value)) {
    issues.push(`${path} must be a safe relative POSIX path`);
    return false;
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

function textList(value, path, issues) {
  if (!array(value, path, 1, 30, issues)) {
    return;
  }
  value.forEach((item, index) => text(item, `${path}[${index}]`, issues));
}

function option(value, path, issues) {
  if (!record(value, path, ["id", "text"], ["id", "text"], issues)) {
    return;
  }
  id(value.id, `${path}.id`, issues);
  text(value.text, `${path}.text`, issues);
}

function trace(value, path, issues) {
  if (!record(value, path, ["steps", "outcome"], ["steps", "outcome"], issues)) {
    return;
  }
  if (array(value.steps, `${path}.steps`, 1, 12, issues)) {
    value.steps.forEach((stepValue, index) => {
      const stepPath = `${path}.steps[${index}]`;
      if (
        record(stepValue, stepPath, ["component", "behavior"], ["component", "behavior"], issues)
      ) {
        text(stepValue.component, `${stepPath}.component`, issues);
        text(stepValue.behavior, `${stepPath}.behavior`, issues);
      }
    });
  }
  text(value.outcome, `${path}.outcome`, issues);
}

function intentItemIds(snapshot) {
  if (!isRecord(snapshot)) {
    return [];
  }
  return [
    ...(Array.isArray(snapshot.outcomes) ? snapshot.outcomes : []),
    ...(Array.isArray(snapshot.constraints) ? snapshot.constraints : []),
    ...(Array.isArray(snapshot.decisions) ? snapshot.decisions : []),
    ...(Array.isArray(snapshot.nonGoals) ? snapshot.nonGoals : []),
    ...(Array.isArray(snapshot.scenarios) ? snapshot.scenarios : []),
  ]
    .map((item) => item?.id)
    .filter((itemId) => typeof itemId === "string");
}

function validateIntentEnvelope(value, issues) {
  if (value === null) {
    return;
  }
  if (
    !record(value, "$.intent", ["fingerprint", "snapshot"], ["fingerprint", "snapshot"], issues)
  ) {
    return;
  }
  if (typeof value.fingerprint !== "string" || !FINGERPRINT_PATTERN.test(value.fingerprint)) {
    issues.push("$.intent.fingerprint must be a lowercase SHA-256 digest");
  }
  const intentIssues = collectIntentIssues(value.snapshot);
  issues.push(...intentIssues.map((issue) => `$.intent.snapshot ${issue}`));
  if (
    isRecord(value.snapshot) &&
    typeof value.snapshot.fingerprint === "string" &&
    value.fingerprint !== value.snapshot.fingerprint
  ) {
    issues.push("$.intent.fingerprint must match $.intent.snapshot.fingerprint");
  }
  if (isRecord(value.snapshot)) {
    try {
      if (calculateIntentFingerprint(value.snapshot) !== value.fingerprint) {
        issues.push("$.intent.fingerprint does not match the embedded IntentV1 snapshot");
      }
    } catch {
      issues.push("$.intent.snapshot could not be fingerprinted deterministically");
    }
  }
}

function validateAlignment(value, issues) {
  if (value === null) {
    return;
  }
  if (
    !record(
      value,
      "$.alignment",
      ["summary", "checks", "deviations"],
      ["summary", "checks", "deviations"],
      issues,
    )
  ) {
    return;
  }
  text(value.summary, "$.alignment.summary", issues);
  if (Array.isArray(value.checks)) {
    value.checks.forEach((check, index) => {
      const path = `$.alignment.checks[${index}]`;
      const keys = ["intentItemId", "status", "assessment", "evidencePaths"];
      if (!record(check, path, keys, keys, issues)) {
        return;
      }
      id(check.intentItemId, `${path}.intentItemId`, issues);
      if (!["satisfied", "partial", "violated", "not-assessable"].includes(check.status)) {
        issues.push(`${path}.status must be satisfied, partial, violated, or not-assessable`);
      }
      text(check.assessment, `${path}.assessment`, issues);
      if (array(check.evidencePaths, `${path}.evidencePaths`, 0, 10, issues)) {
        check.evidencePaths.forEach((entry, evidenceIndex) =>
          relativePath(entry, `${path}.evidencePaths[${evidenceIndex}]`, issues),
        );
      }
    });
  } else {
    issues.push("$.alignment.checks must be an array");
  }

  if (Array.isArray(value.deviations)) {
    value.deviations.forEach((deviation, index) => {
      const path = `$.alignment.deviations[${index}]`;
      const keys = ["id", "summary", "intentItemIds", "evidencePaths", "reviewStatus"];
      if (!record(deviation, path, keys, keys, issues)) {
        return;
      }
      id(deviation.id, `${path}.id`, issues);
      text(deviation.summary, `${path}.summary`, issues);
      if (Array.isArray(deviation.intentItemIds)) {
        deviation.intentItemIds.forEach((entry, intentIndex) =>
          id(entry, `${path}.intentItemIds[${intentIndex}]`, issues),
        );
      } else {
        issues.push(`${path}.intentItemIds must be an array`);
      }
      if (array(deviation.evidencePaths, `${path}.evidencePaths`, 1, 10, issues)) {
        deviation.evidencePaths.forEach((entry, evidenceIndex) =>
          relativePath(entry, `${path}.evidencePaths[${evidenceIndex}]`, issues),
        );
      }
      if (deviation.reviewStatus !== "needs-user-review") {
        issues.push(`${path}.reviewStatus must be needs-user-review`);
      }
    });
  } else {
    issues.push("$.alignment.deviations must be an array");
  }
}

function validateKnowledge(value, issues) {
  if (
    !record(
      value,
      "$.knowledge",
      ["promotionCandidates"],
      ["promotionCandidates"],
      issues,
    )
  ) {
    return;
  }
  if (!Array.isArray(value.promotionCandidates)) {
    issues.push("$.knowledge.promotionCandidates must be an array");
    return;
  }
  value.promotionCandidates.forEach((candidate, index) => {
    const path = `$.knowledge.promotionCandidates[${index}]`;
    const keys = ["id", "insight", "rationale", "target", "intentItemIds", "evidencePaths"];
    if (!record(candidate, path, keys, keys, issues)) {
      return;
    }
    id(candidate.id, `${path}.id`, issues);
    text(candidate.insight, `${path}.insight`, issues);
    text(candidate.rationale, `${path}.rationale`, issues);
    if (
      !["test", "code-comment", "architecture-doc", "runbook", "change-record"].includes(
        candidate.target,
      )
    ) {
      issues.push(
        `${path}.target must be test, code-comment, architecture-doc, runbook, or change-record`,
      );
    }
    if (Array.isArray(candidate.intentItemIds)) {
      candidate.intentItemIds.forEach((entry, intentIndex) =>
        id(entry, `${path}.intentItemIds[${intentIndex}]`, issues),
      );
    } else {
      issues.push(`${path}.intentItemIds must be an array`);
    }
    if (array(candidate.evidencePaths, `${path}.evidencePaths`, 1, 10, issues)) {
      candidate.evidencePaths.forEach((entry, evidenceIndex) =>
        relativePath(entry, `${path}.evidencePaths[${evidenceIndex}]`, issues),
      );
    }
  });
}

function validateChange(value, issues) {
  if (
    !record(
      value,
      "$.change",
      ["summary", "comparison", "context", "files"],
      ["summary", "comparison", "context", "files"],
      issues,
    )
  ) {
    return;
  }

  text(value.summary, "$.change.summary", issues);
  text(value.comparison, "$.change.comparison", issues);

  if (
    record(
      value.context,
      "$.change.context",
      ["baseCommit", "fingerprint", "complete", "warnings", "excluded"],
      ["baseCommit", "fingerprint", "complete", "warnings", "excluded"],
      issues,
    )
  ) {
    if (
      typeof value.context.baseCommit !== "string" ||
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value.context.baseCommit)
    ) {
      issues.push("$.change.context.baseCommit must be a full lowercase Git commit object ID");
    }
    if (
      typeof value.context.fingerprint !== "string" ||
      !FINGERPRINT_PATTERN.test(value.context.fingerprint)
    ) {
      issues.push("$.change.context.fingerprint must be a lowercase SHA-256 digest");
    }
    if (typeof value.context.complete !== "boolean") {
      issues.push("$.change.context.complete must be a boolean");
    }
    if (array(value.context.warnings, "$.change.context.warnings", 0, 40, issues)) {
      value.context.warnings.forEach((warning, index) =>
        text(warning, `$.change.context.warnings[${index}]`, issues),
      );
    }
    if (array(value.context.excluded, "$.change.context.excluded", 0, 81, issues)) {
      value.context.excluded.forEach((entry, index) => {
        const path = `$.change.context.excluded[${index}]`;
        if (record(entry, path, ["path", "reason"], ["path", "reason"], issues)) {
          relativePath(entry.path, `${path}.path`, issues);
          text(entry.reason, `${path}.reason`, issues);
        }
      });
    }
  }

  if (array(value.files, "$.change.files", 1, 80, issues)) {
    value.files.forEach((file, index) => {
      const path = `$.change.files[${index}]`;
      if (record(file, path, ["path", "responsibility"], ["path", "responsibility"], issues)) {
        relativePath(file.path, `${path}.path`, issues);
        text(file.responsibility, `${path}.responsibility`, issues);
      }
    });
  }
}

function validateExplanation(value, issues) {
  const keys = [
    "goal",
    "observableChanges",
    "beforeAfter",
    "flow",
    "invariants",
    "decisions",
    "nonGoals",
    "risks",
    "verification",
  ];
  if (!record(value, "$.explanation", keys, keys, issues)) {
    return;
  }

  text(value.goal, "$.explanation.goal", issues);
  textList(value.observableChanges, "$.explanation.observableChanges", issues);

  if (array(value.beforeAfter, "$.explanation.beforeAfter", 1, 20, issues)) {
    value.beforeAfter.forEach((entry, index) => {
      const path = `$.explanation.beforeAfter[${index}]`;
      const entryKeys = ["area", "before", "after", "why"];
      if (record(entry, path, entryKeys, entryKeys, issues)) {
        for (const key of entryKeys) {
          text(entry[key], `${path}.${key}`, issues);
        }
      }
    });
  }

  if (array(value.flow, "$.explanation.flow", 1, 30, issues)) {
    value.flow.forEach((entry, index) => {
      const path = `$.explanation.flow[${index}]`;
      const entryKeys = ["step", "component", "behavior"];
      if (record(entry, path, entryKeys, entryKeys, issues)) {
        if (!Number.isInteger(entry.step) || entry.step < 1 || entry.step > 30) {
          issues.push(`${path}.step must be an integer between 1 and 30`);
        }
        text(entry.component, `${path}.component`, issues);
        text(entry.behavior, `${path}.behavior`, issues);
      }
    });
  }

  textList(value.invariants, "$.explanation.invariants", issues);

  if (array(value.decisions, "$.explanation.decisions", 1, 20, issues)) {
    value.decisions.forEach((entry, index) => {
      const path = `$.explanation.decisions[${index}]`;
      const entryKeys = ["decision", "rationale", "tradeoff", "source"];
      if (record(entry, path, entryKeys, entryKeys, issues)) {
        for (const key of ["decision", "rationale", "tradeoff"]) {
          text(entry[key], `${path}.${key}`, issues);
        }
        if (!["approved-intent", "inferred"].includes(entry.source)) {
          issues.push(`${path}.source must be approved-intent or inferred`);
        }
      }
    });
  }

  textList(value.nonGoals, "$.explanation.nonGoals", issues);
  textList(value.risks, "$.explanation.risks", issues);

  if (array(value.verification, "$.explanation.verification", 1, 20, issues)) {
    value.verification.forEach((entry, index) => {
      const path = `$.explanation.verification[${index}]`;
      const entryKeys = ["command", "status", "result"];
      if (record(entry, path, entryKeys, entryKeys, issues)) {
        text(entry.command, `${path}.command`, issues);
        if (!["passed", "failed", "not-run"].includes(entry.status)) {
          issues.push(`${path}.status must be passed, failed, or not-run`);
        }
        text(entry.result, `${path}.result`, issues);
      }
    });
  }
}

function validateQuiz(value, issues) {
  if (
    !record(value, "$.quiz", ["passPercent", "questions"], ["passPercent", "questions"], issues)
  ) {
    return;
  }

  if (!Number.isInteger(value.passPercent) || value.passPercent < 1 || value.passPercent > 100) {
    issues.push("$.quiz.passPercent must be an integer between 1 and 100");
  }

  if (!array(value.questions, "$.quiz.questions", 3, 5, issues)) {
    return;
  }

  value.questions.forEach((question, index) => {
    const path = `$.quiz.questions[${index}]`;
    const questionKeys = [
      "id",
      "type",
      "prompt",
      "options",
      "correctOptionIds",
      "explanation",
      "intentItemIds",
      "evidencePaths",
    ];
    if (!record(question, path, questionKeys, questionKeys, issues)) {
      return;
    }

    id(question.id, `${path}.id`, issues);
    if (!["single", "multiple"].includes(question.type)) {
      issues.push(`${path}.type must be single or multiple`);
    }
    text(question.prompt, `${path}.prompt`, issues);
    if (array(question.options, `${path}.options`, 2, 6, issues)) {
      question.options.forEach((entry, optionIndex) =>
        option(entry, `${path}.options[${optionIndex}]`, issues),
      );
    }
    if (array(question.correctOptionIds, `${path}.correctOptionIds`, 1, 6, issues)) {
      question.correctOptionIds.forEach((entry, answerIndex) =>
        id(entry, `${path}.correctOptionIds[${answerIndex}]`, issues),
      );
    }
    text(question.explanation, `${path}.explanation`, issues);
    if (Array.isArray(question.intentItemIds)) {
      question.intentItemIds.forEach((entry, intentIndex) =>
        id(entry, `${path}.intentItemIds[${intentIndex}]`, issues),
      );
    } else {
      issues.push(`${path}.intentItemIds must be an array`);
    }
    if (array(question.evidencePaths, `${path}.evidencePaths`, 1, 10, issues)) {
      question.evidencePaths.forEach((entry, evidenceIndex) =>
        relativePath(entry, `${path}.evidencePaths[${evidenceIndex}]`, issues),
      );
    }
  });
}

function validateMicroworld(value, issues) {
  const microworldKeys = ["title", "instructions", "intentItemIds", "controls", "scenarios"];
  if (!record(value, "$.microworld", microworldKeys, microworldKeys, issues)) {
    return;
  }

  text(value.title, "$.microworld.title", issues);
  text(value.instructions, "$.microworld.instructions", issues);
  if (Array.isArray(value.intentItemIds)) {
    value.intentItemIds.forEach((entry, intentIndex) =>
      id(entry, `$.microworld.intentItemIds[${intentIndex}]`, issues),
    );
  } else {
    issues.push("$.microworld.intentItemIds must be an array");
  }

  if (array(value.controls, "$.microworld.controls", 1, 3, issues)) {
    value.controls.forEach((control, index) => {
      const path = `$.microworld.controls[${index}]`;
      const controlKeys = ["id", "label", "defaultOptionId", "options"];
      if (record(control, path, controlKeys, controlKeys, issues)) {
        id(control.id, `${path}.id`, issues);
        text(control.label, `${path}.label`, issues);
        id(control.defaultOptionId, `${path}.defaultOptionId`, issues);
        if (array(control.options, `${path}.options`, 2, 4, issues)) {
          control.options.forEach((entry, optionIndex) =>
            option(entry, `${path}.options[${optionIndex}]`, issues),
          );
        }
      }
    });
  }

  if (!array(value.scenarios, "$.microworld.scenarios", 2, 12, issues)) {
    return;
  }

  value.scenarios.forEach((scenario, index) => {
    const path = `$.microworld.scenarios[${index}]`;
    const scenarioKeys = ["id", "title", "when", "before", "after", "lesson"];
    if (!record(scenario, path, scenarioKeys, scenarioKeys, issues)) {
      return;
    }
    id(scenario.id, `${path}.id`, issues);
    text(scenario.title, `${path}.title`, issues);
    if (array(scenario.when, `${path}.when`, 1, 3, issues)) {
      scenario.when.forEach((condition, conditionIndex) => {
        const conditionPath = `${path}.when[${conditionIndex}]`;
        if (
          record(
            condition,
            conditionPath,
            ["controlId", "optionId"],
            ["controlId", "optionId"],
            issues,
          )
        ) {
          id(condition.controlId, `${conditionPath}.controlId`, issues);
          id(condition.optionId, `${conditionPath}.optionId`, issues);
        }
      });
    }
    trace(scenario.before, `${path}.before`, issues);
    trace(scenario.after, `${path}.after`, issues);
    text(scenario.lesson, `${path}.lesson`, issues);
  });
}

function addDuplicateIssues(values, path, label, issues) {
  const seen = new Set();
  values.forEach((value, index) => {
    if (typeof value !== "string") {
      return;
    }
    if (seen.has(value)) {
      issues.push(`${path}[${index}] duplicates ${label} "${value}"`);
    }
    seen.add(value);
  });
}

function enumerateCombinations(controls) {
  let combinations = [[]];
  for (const control of controls) {
    const next = [];
    for (const combination of combinations) {
      for (const controlOption of control.options) {
        next.push([...combination, [control.id, controlOption.id]]);
      }
    }
    combinations = next;
  }
  return combinations;
}

function combinationKey(pairs) {
  return pairs.map(([controlId, optionId]) => `${controlId}=${optionId}`).join("\u0001");
}

function validateEvidenceReferences(values, path, knownPaths, issues) {
  if (!Array.isArray(values)) {
    return;
  }
  addDuplicateIssues(values, path, "evidence path", issues);
  values.forEach((evidencePath, index) => {
    if (isSafeRelativePosixPath(evidencePath) && !knownPaths.has(evidencePath)) {
      issues.push(`${path}[${index}] references an unknown file`);
    }
  });
}

function validateIntentReferences(values, path, knownIntentIds, issues) {
  if (!Array.isArray(values)) {
    return;
  }
  addDuplicateIssues(values, path, "intent item id", issues);
  values.forEach((intentId, index) => {
    if (typeof intentId === "string" && !knownIntentIds.has(intentId)) {
      issues.push(`${path}[${index}] references an unknown intent item`);
    }
  });
}

function validateSemantics(artifact, issues) {
  const files = Array.isArray(artifact.change?.files) ? artifact.change.files : [];
  const filePaths = files.map((file) => file?.path);
  addDuplicateIssues(filePaths, "$.change.files", "path", issues);
  const knownPaths = new Set(filePaths.filter((path) => isSafeRelativePosixPath(path)));

  const intentSnapshot = isRecord(artifact.intent) && isRecord(artifact.intent.snapshot)
    ? artifact.intent.snapshot
    : null;
  const intentIsBound = intentSnapshot !== null;
  const embeddedIntentIds = intentIsBound ? intentItemIds(intentSnapshot) : [];
  const knownIntentIds = new Set(embeddedIntentIds);
  const knownMicroworldIntentIds = new Set(
    intentIsBound
      ? [
          ...(Array.isArray(intentSnapshot.outcomes) ? intentSnapshot.outcomes : []),
          ...(Array.isArray(intentSnapshot.constraints) ? intentSnapshot.constraints : []),
        ]
          .map((item) => item?.id)
          .filter((itemId) => typeof itemId === "string")
      : [],
  );
  const alignmentChecks = Array.isArray(artifact.alignment?.checks) ? artifact.alignment.checks : [];

  if (artifact.intent === null && artifact.alignment !== null) {
    issues.push("$.alignment must be null when $.intent is null");
  }
  if (artifact.intent !== null && artifact.alignment === null) {
    issues.push("$.alignment must be present when $.intent is bound");
  }
  if (
    artifact.intent === null &&
    Array.isArray(artifact.explanation?.decisions) &&
    artifact.explanation.decisions.some((decision) => decision?.source === "approved-intent")
  ) {
    issues.push("$.explanation.decisions cannot use approved-intent when $.intent is null");
  }
  if (
    intentIsBound &&
    Array.isArray(intentSnapshot.decisions) &&
    Array.isArray(artifact.explanation?.decisions)
  ) {
    const approvedDecisions = new Set(
      intentSnapshot.decisions.map((decision) =>
        JSON.stringify([decision.decision, decision.rationale, decision.tradeoff]),
      ),
    );
    artifact.explanation.decisions.forEach((decision, index) => {
      if (
        decision?.source === "approved-intent" &&
        !approvedDecisions.has(
          JSON.stringify([decision.decision, decision.rationale, decision.tradeoff]),
        )
      ) {
        issues.push(
          `$.explanation.decisions[${index}] marked approved-intent must exactly match an IntentV1 decision`,
        );
      }
    });
  }

  if (intentIsBound && artifact.alignment !== null) {
    const checkedIds = alignmentChecks.map((check) => check?.intentItemId);
    addDuplicateIssues(checkedIds, "$.alignment.checks", "intent item id", issues);
    const checkedIdSet = new Set(checkedIds.filter((itemId) => typeof itemId === "string"));
    for (const itemId of embeddedIntentIds) {
      if (!checkedIdSet.has(itemId)) {
        issues.push(`$.alignment.checks is missing intent item "${itemId}"`);
      }
    }
    checkedIds.forEach((itemId, index) => {
      if (typeof itemId === "string" && !knownIntentIds.has(itemId)) {
        issues.push(`$.alignment.checks[${index}].intentItemId references an unknown intent item`);
      }
    });
    if (alignmentChecks.length !== embeddedIntentIds.length) {
      issues.push(
        `$.alignment.checks must cover exactly ${embeddedIntentIds.length} intent item(s)`,
      );
    }
  }

  alignmentChecks.forEach((check, index) => {
    if (!isRecord(check)) {
      return;
    }
    const evidencePath = `$.alignment.checks[${index}].evidencePaths`;
    validateEvidenceReferences(check.evidencePaths, evidencePath, knownPaths, issues);
    if (
      check.status !== "not-assessable" &&
      Array.isArray(check.evidencePaths) &&
      check.evidencePaths.length === 0
    ) {
      issues.push(`${evidencePath} must cite code evidence unless status is not-assessable`);
    }
  });

  const deviations = Array.isArray(artifact.alignment?.deviations)
    ? artifact.alignment.deviations
    : [];
  addDuplicateIssues(
    deviations.map((deviation) => deviation?.id),
    "$.alignment.deviations",
    "deviation id",
    issues,
  );
  deviations.forEach((deviation, index) => {
    if (!isRecord(deviation)) {
      return;
    }
    validateIntentReferences(
      deviation.intentItemIds,
      `$.alignment.deviations[${index}].intentItemIds`,
      knownIntentIds,
      issues,
    );
    validateEvidenceReferences(
      deviation.evidencePaths,
      `$.alignment.deviations[${index}].evidencePaths`,
      knownPaths,
      issues,
    );
  });

  const candidates = Array.isArray(artifact.knowledge?.promotionCandidates)
    ? artifact.knowledge.promotionCandidates
    : [];
  addDuplicateIssues(
    candidates.map((candidate) => candidate?.id),
    "$.knowledge.promotionCandidates",
    "promotion candidate id",
    issues,
  );
  candidates.forEach((candidate, index) => {
    if (!isRecord(candidate)) {
      return;
    }
    validateIntentReferences(
      candidate.intentItemIds,
      `$.knowledge.promotionCandidates[${index}].intentItemIds`,
      knownIntentIds,
      issues,
    );
    validateEvidenceReferences(
      candidate.evidencePaths,
      `$.knowledge.promotionCandidates[${index}].evidencePaths`,
      knownPaths,
      issues,
    );
  });

  const questions = Array.isArray(artifact.quiz?.questions) ? artifact.quiz.questions : [];
  addDuplicateIssues(
    questions.map((question) => question?.id),
    "$.quiz.questions",
    "question id",
    issues,
  );

  questions.forEach((question, questionIndex) => {
    if (!isRecord(question)) {
      return;
    }
    const path = `$.quiz.questions[${questionIndex}]`;
    const options = Array.isArray(question.options) ? question.options : [];
    const optionIds = options.map((entry) => entry?.id);
    addDuplicateIssues(optionIds, `${path}.options`, "option id", issues);
    const knownOptionIds = new Set(optionIds.filter((entry) => typeof entry === "string"));
    const answers = Array.isArray(question.correctOptionIds) ? question.correctOptionIds : [];
    addDuplicateIssues(answers, `${path}.correctOptionIds`, "answer id", issues);
    answers.forEach((answer, answerIndex) => {
      if (typeof answer === "string" && !knownOptionIds.has(answer)) {
        issues.push(`${path}.correctOptionIds[${answerIndex}] references an unknown option`);
      }
    });
    if (question.type === "single" && answers.length !== 1) {
      issues.push(`${path}.correctOptionIds must contain exactly one answer for single`);
    }

    validateIntentReferences(
      question.intentItemIds,
      `${path}.intentItemIds`,
      knownIntentIds,
      issues,
    );

    const evidencePaths = Array.isArray(question.evidencePaths) ? question.evidencePaths : [];
    addDuplicateIssues(evidencePaths, `${path}.evidencePaths`, "evidence path", issues);
    evidencePaths.forEach((evidencePath, evidenceIndex) => {
      if (isSafeRelativePosixPath(evidencePath) && !knownPaths.has(evidencePath)) {
        issues.push(`${path}.evidencePaths[${evidenceIndex}] references an unknown file`);
      }
    });
  });

  if (artifact.intent === null) {
    questions.forEach((question, questionIndex) => {
      if (Array.isArray(question?.intentItemIds) && question.intentItemIds.length > 0) {
        issues.push(
          `$.quiz.questions[${questionIndex}].intentItemIds must be empty when $.intent is null`,
        );
      }
    });
  } else if (
    intentIsBound &&
    !questions.some(
      (question) =>
        Array.isArray(question?.intentItemIds) &&
        question.intentItemIds.length > 0 &&
        Array.isArray(question.evidencePaths) &&
        question.evidencePaths.length > 0,
    )
  ) {
    issues.push(
      "$.quiz.questions must include at least one evidence-backed question linked to approved intent",
    );
  }

  const microworldIntentIds = artifact.microworld?.intentItemIds;
  validateIntentReferences(
    microworldIntentIds,
    "$.microworld.intentItemIds",
    knownIntentIds,
    issues,
  );
  if (artifact.intent === null) {
    if (Array.isArray(microworldIntentIds) && microworldIntentIds.length > 0) {
      issues.push("$.microworld.intentItemIds must be empty when $.intent is null");
    }
  } else if (intentIsBound && Array.isArray(microworldIntentIds)) {
    if (microworldIntentIds.length === 0) {
      issues.push(
        "$.microworld.intentItemIds must link at least one approved outcome or constraint",
      );
    }
    microworldIntentIds.forEach((intentId, index) => {
      if (typeof intentId === "string" && !knownMicroworldIntentIds.has(intentId)) {
        issues.push(
          `$.microworld.intentItemIds[${index}] must reference an approved outcome or constraint`,
        );
      }
    });
  }

  const controls = Array.isArray(artifact.microworld?.controls) ? artifact.microworld.controls : [];
  addDuplicateIssues(
    controls.map((control) => control?.id),
    "$.microworld.controls",
    "control id",
    issues,
  );

  const optionIdsByControl = new Map();
  controls.forEach((control, controlIndex) => {
    if (!isRecord(control)) {
      return;
    }
    const path = `$.microworld.controls[${controlIndex}]`;
    const options = Array.isArray(control.options) ? control.options : [];
    const optionIds = options.map((entry) => entry?.id);
    addDuplicateIssues(optionIds, `${path}.options`, "option id", issues);
    const knownOptionIds = new Set(optionIds.filter((entry) => typeof entry === "string"));
    if (
      typeof control.defaultOptionId === "string" &&
      !knownOptionIds.has(control.defaultOptionId)
    ) {
      issues.push(`${path}.defaultOptionId references an unknown option`);
    }
    if (typeof control.id === "string") {
      optionIdsByControl.set(control.id, knownOptionIds);
    }
  });

  const structurallyBoundedControls =
    controls.length >= 1 &&
    controls.length <= 3 &&
    controls.every(
      (control) =>
        isRecord(control) &&
        Array.isArray(control.options) &&
        control.options.length >= 2 &&
        control.options.length <= 4,
    );
  const validCombinationShape =
    structurallyBoundedControls &&
    controls.every(
      (control) =>
        typeof control.id === "string" &&
        control.options.every((entry) => isRecord(entry) && typeof entry.id === "string"),
    );
  const combinationCount = validCombinationShape
    ? controls.reduce((total, control) => total * control.options.length, 1)
    : 0;
  if (combinationCount > 12) {
    issues.push("$.microworld.controls produce more than 12 combinations");
  }
  const enumerableControls = validCombinationShape && combinationCount <= 12;
  const combinations = enumerableControls ? enumerateCombinations(controls) : [];

  const scenarios = Array.isArray(artifact.microworld?.scenarios)
    ? artifact.microworld.scenarios
    : [];
  addDuplicateIssues(
    scenarios.map((scenario) => scenario?.id),
    "$.microworld.scenarios",
    "scenario id",
    issues,
  );

  const scenarioKeys = new Set();
  scenarios.forEach((scenario, scenarioIndex) => {
    if (!isRecord(scenario) || !Array.isArray(scenario.when)) {
      return;
    }
    const path = `$.microworld.scenarios[${scenarioIndex}].when`;
    const seenControls = new Set();
    const bindings = new Map();
    scenario.when.forEach((condition, conditionIndex) => {
      if (!isRecord(condition)) {
        return;
      }
      const controlId = condition.controlId;
      const optionId = condition.optionId;
      if (typeof controlId !== "string" || typeof optionId !== "string") {
        return;
      }
      if (seenControls.has(controlId)) {
        issues.push(`${path}[${conditionIndex}] duplicates control "${controlId}"`);
      }
      seenControls.add(controlId);
      if (!optionIdsByControl.has(controlId)) {
        issues.push(`${path}[${conditionIndex}] references an unknown control`);
      } else if (!optionIdsByControl.get(controlId).has(optionId)) {
        issues.push(`${path}[${conditionIndex}] references an unknown control option`);
      }
      bindings.set(controlId, optionId);
    });

    if (enumerableControls && bindings.size !== controls.length) {
      issues.push(`${path} must bind every control exactly once`);
      return;
    }
    if (!enumerableControls) {
      return;
    }
    const orderedPairs = controls.map((control) => [control.id, bindings.get(control.id)]);
    if (orderedPairs.some(([, optionId]) => typeof optionId !== "string")) {
      return;
    }
    const key = combinationKey(orderedPairs);
    if (scenarioKeys.has(key)) {
      issues.push(`${path} duplicates another scenario combination`);
    }
    scenarioKeys.add(key);
  });

  if (enumerableControls) {
    for (const combination of combinations) {
      const key = combinationKey(combination);
      if (!scenarioKeys.has(key)) {
        const readable = combination
          .map(([controlId, optionId]) => `${controlId}=${optionId}`)
          .join(", ");
        issues.push(`$.microworld.scenarios is missing combination: ${readable}`);
      }
    }
    if (scenarios.length !== combinations.length) {
      issues.push(`$.microworld.scenarios must contain exactly ${combinations.length} scenarios`);
    }
  }
}

export function collectArtifactIssues(artifact) {
  const issues = [];
  const rootKeys = [
    "schemaVersion",
    "title",
    "intent",
    "change",
    "alignment",
    "explanation",
    "quiz",
    "microworld",
    "knowledge",
  ];
  if (!record(artifact, "$", rootKeys, rootKeys, issues)) {
    return issues;
  }

  if (artifact.schemaVersion !== 2) {
    issues.push("$.schemaVersion must equal 2");
  }
  text(artifact.title, "$.title", issues);
  validateIntentEnvelope(artifact.intent, issues);
  validateChange(artifact.change, issues);
  validateAlignment(artifact.alignment, issues);
  validateExplanation(artifact.explanation, issues);
  validateQuiz(artifact.quiz, issues);
  validateMicroworld(artifact.microworld, issues);
  validateKnowledge(artifact.knowledge, issues);
  validateSemantics(artifact, issues);
  issues.push(...collectSecretIssues(artifact));
  return issues;
}

export function validateArtifact(artifact) {
  const issues = collectArtifactIssues(artifact);
  if (issues.length > 0) {
    throw new ArtifactValidationError(issues);
  }
  return artifact;
}

function contextCount(value, path, maximum, issues) {
  if (!Number.isInteger(value) || value < 0 || (maximum !== undefined && value > maximum)) {
    const suffix = maximum === undefined ? "" : ` and at most ${maximum}`;
    issues.push(`${path} must be a non-negative integer${suffix}`);
  }
}

function nullableContextCount(value, path, issues) {
  if (value !== null) {
    contextCount(value, path, undefined, issues);
  }
}

function validateChangeContextSemantics(context, issues) {
  const files = Array.isArray(context.files) ? context.files : [];
  const patches = Array.isArray(context.patches) ? context.patches : [];
  const excluded = Array.isArray(context.excluded) ? context.excluded : [];
  const warnings = Array.isArray(context.warnings) ? context.warnings : [];
  const summary = isRecord(context.summary) ? context.summary : null;

  addDuplicateIssues(
    patches.map((patch) => patch?.path),
    "$context.patches",
    "path",
    issues,
  );
  addDuplicateIssues(
    excluded.map((entry) => entry?.path),
    "$context.excluded",
    "path",
    issues,
  );

  const patchesByPath = new Map();
  for (const patch of patches) {
    if (!isRecord(patch) || typeof patch.path !== "string") {
      continue;
    }
    const matches = patchesByPath.get(patch.path) ?? [];
    matches.push(patch);
    patchesByPath.set(patch.path, matches);
  }
  const exclusionsByPath = new Map();
  for (const entry of excluded) {
    if (!isRecord(entry) || typeof entry.path !== "string") {
      continue;
    }
    const matches = exclusionsByPath.get(entry.path) ?? [];
    matches.push(entry);
    exclusionsByPath.set(entry.path, matches);
  }

  files.forEach((file, index) => {
    if (!isRecord(file) || typeof file.path !== "string") {
      return;
    }
    const path = `$context.files[${index}]`;
    const matchingPatches = patchesByPath.get(file.path) ?? [];
    const matchingExclusions = exclusionsByPath.get(file.path) ?? [];

    if (file.source === "untracked" && file.status !== "untracked") {
      issues.push(`${path}.status must be untracked when source is untracked`);
    }
    if (file.source === "tracked" && file.status === "untracked") {
      issues.push(`${path}.status cannot be untracked when source is tracked`);
    }

    if (file.bodyIncluded === true) {
      if (matchingPatches.length !== 1) {
        issues.push(`${path}.bodyIncluded requires exactly one matching patch`);
      }
      if (own(file, "omissionReason")) {
        issues.push(`${path}.omissionReason is not allowed when bodyIncluded is true`);
      }
      if (matchingExclusions.length > 0) {
        issues.push(`${path} cannot be included and excluded at the same time`);
      }
      const patch = matchingPatches[0];
      if (isRecord(patch)) {
        const expectedKind = file.source === "untracked" ? "untracked" : "diff";
        if (patch.kind !== expectedKind) {
          issues.push(`${path} source requires matching patch kind ${expectedKind}`);
        }
      }
    } else if (file.bodyIncluded === false) {
      if (matchingPatches.length > 0) {
        issues.push(`${path}.bodyIncluded is false but a matching patch exists`);
      }
      if (!own(file, "omissionReason")) {
        issues.push(`${path}.omissionReason is required when bodyIncluded is false`);
      }
      if (
        matchingExclusions.length !== 1 ||
        matchingExclusions[0]?.reason !== file.omissionReason
      ) {
        issues.push(`${path} omissionReason must exactly match one excluded entry`);
      }
    }
  });

  excluded.forEach((entry, index) => {
    if (!isRecord(entry) || typeof entry.path !== "string") {
      return;
    }
    const path = `$context.excluded[${index}]`;
    if (entry.path === "additional-files-not-enumerated") {
      if (!/^file-count-limit:[1-9][0-9]*$/u.test(entry.reason)) {
        issues.push(`${path}.reason must record the positive file-count-limit omission`);
      }
      return;
    }
    const file = files.find((candidate) => candidate?.path === entry.path);
    if (
      !isRecord(file) ||
      file.bodyIncluded !== false ||
      file.omissionReason !== entry.reason
    ) {
      issues.push(`${path} must exactly describe one omitted file body`);
    }
  });

  if (summary !== null) {
    const includedFiles = files.filter((file) => file?.bodyIncluded === true);
    const omittedFiles = files.filter((file) => file?.bodyIncluded === false);
    const additions = files.reduce(
      (total, file) => total + (Number.isInteger(file?.additions) ? file.additions : 0),
      0,
    );
    const deletions = files.reduce(
      (total, file) => total + (Number.isInteger(file?.deletions) ? file.deletions : 0),
      0,
    );
    const changedLines = includedFiles.reduce(
      (total, file) =>
        total +
        (Number.isInteger(file?.additions) ? file.additions : 0) +
        (Number.isInteger(file?.deletions) ? file.deletions : 0),
      0,
    );
    const contextBytes = patches.reduce(
      (total, patch) =>
        total + (typeof patch?.text === "string" ? Buffer.byteLength(patch.text, "utf8") : 0),
      0,
    );
    const expected = {
      representedFiles: files.length,
      includedBodies: includedFiles.length,
      omittedBodies: omittedFiles.length,
      additions,
      deletions,
      changedLines,
      contextBytes,
    };
    for (const [key, value] of Object.entries(expected)) {
      if (summary[key] !== value) {
        issues.push(`$context.summary.${key} must equal ${value} from the collected entries`);
      }
    }
    if (Number.isInteger(summary.discoveredFiles) && summary.discoveredFiles < files.length) {
      issues.push("$context.summary.discoveredFiles cannot be less than representedFiles");
    }
    const unrepresented = Number.isInteger(summary.discoveredFiles)
      ? summary.discoveredFiles - files.length
      : 0;
    const fileLimitEntries = excluded.filter(
      (entry) => entry?.path === "additional-files-not-enumerated",
    );
    if (unrepresented > 0) {
      if (
        fileLimitEntries.length !== 1 ||
        fileLimitEntries[0]?.reason !== `file-count-limit:${unrepresented}`
      ) {
        issues.push(
          "$context.excluded must exactly record files omitted by the file-count limit",
        );
      }
    } else if (fileLimitEntries.length > 0) {
      issues.push(
        "$context.excluded cannot contain additional-files-not-enumerated without undisplayed files",
      );
    }
    if (patches.length !== includedFiles.length) {
      issues.push("$context.patches must have one entry for every included body");
    }
  }

  if (
    context.complete === true &&
    (files.some((file) => file?.bodyIncluded === false) ||
      excluded.length > 0 ||
      warnings.length > 0)
  ) {
    issues.push("$context.complete cannot be true with omissions, exclusions, or warnings");
  }
}

export function collectChangeContextIssues(context) {
  const issues = [];
  const rootKeys = [
    "schemaVersion",
    "baseCommit",
    "scope",
    "complete",
    "summary",
    "files",
    "patches",
    "excluded",
    "warnings",
    "fingerprint",
  ];
  if (!record(context, "$context", rootKeys, rootKeys, issues)) {
    return issues;
  }

  if (context.schemaVersion !== 2) {
    issues.push("$context.schemaVersion must equal 2");
  }
  if (
    typeof context.baseCommit !== "string" ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(context.baseCommit)
  ) {
    issues.push("$context.baseCommit must be a full lowercase Git commit object ID");
  }
  if (
    record(
      context.scope,
      "$context.scope",
      ["kind", "comparison", "includeUntrackedBodies"],
      ["kind", "comparison", "includeUntrackedBodies"],
      issues,
    )
  ) {
    if (context.scope.kind !== "working-tree") {
      issues.push("$context.scope.kind must be working-tree");
    }
    if (
      context.scope.comparison !==
      "HEAD -> working tree (staged + unstaged + safe untracked)"
    ) {
      issues.push("$context.scope.comparison must match the Hope working-tree comparison");
    }
    if (context.scope.includeUntrackedBodies !== true) {
      issues.push("$context.scope.includeUntrackedBodies must be true");
    }
  }
  if (typeof context.complete !== "boolean") {
    issues.push("$context.complete must be a boolean");
  }

  const summaryKeys = [
    "discoveredFiles",
    "representedFiles",
    "includedBodies",
    "omittedBodies",
    "additions",
    "deletions",
    "changedLines",
    "contextBytes",
  ];
  if (record(context.summary, "$context.summary", summaryKeys, summaryKeys, issues)) {
    for (const key of summaryKeys.slice(0, 6)) {
      contextCount(context.summary[key], `$context.summary.${key}`, undefined, issues);
    }
    contextCount(context.summary.changedLines, "$context.summary.changedLines", 4000, issues);
    contextCount(context.summary.contextBytes, "$context.summary.contextBytes", 262144, issues);
  }

  if (array(context.files, "$context.files", 0, 80, issues)) {
    context.files.forEach((file, index) => {
      const path = `$context.files[${index}]`;
      const required = ["path", "status", "source", "additions", "deletions", "bodyIncluded"];
      const allowed = [...required, "omissionReason"];
      if (!record(file, path, required, allowed, issues)) {
        return;
      }
      relativePath(file.path, `${path}.path`, issues);
      text(file.status, `${path}.status`, issues);
      if (!["tracked", "untracked"].includes(file.source)) {
        issues.push(`${path}.source must be tracked or untracked`);
      }
      nullableContextCount(file.additions, `${path}.additions`, issues);
      nullableContextCount(file.deletions, `${path}.deletions`, issues);
      if (typeof file.bodyIncluded !== "boolean") {
        issues.push(`${path}.bodyIncluded must be a boolean`);
      }
      if (own(file, "omissionReason")) {
        text(file.omissionReason, `${path}.omissionReason`, issues);
      }
    });
    addDuplicateIssues(
      context.files.map((file) => file?.path),
      "$context.files",
      "path",
      issues,
    );
  }

  if (array(context.patches, "$context.patches", 0, 80, issues)) {
    context.patches.forEach((patch, index) => {
      const path = `$context.patches[${index}]`;
      if (!record(patch, path, ["path", "kind", "text"], ["path", "kind", "text"], issues)) {
        return;
      }
      relativePath(patch.path, `${path}.path`, issues);
      if (!["diff", "untracked"].includes(patch.kind)) {
        issues.push(`${path}.kind must be diff or untracked`);
      }
      if (typeof patch.text !== "string" || Array.from(patch.text).length > 262144) {
        issues.push(`${path}.text must be a string of at most 262144 characters`);
      }
    });
  }

  if (array(context.excluded, "$context.excluded", 0, 81, issues)) {
    context.excluded.forEach((entry, index) => {
      const path = `$context.excluded[${index}]`;
      if (record(entry, path, ["path", "reason"], ["path", "reason"], issues)) {
        relativePath(entry.path, `${path}.path`, issues);
        text(entry.reason, `${path}.reason`, issues);
      }
    });
  }

  if (array(context.warnings, "$context.warnings", 0, 40, issues)) {
    context.warnings.forEach((warning, index) =>
      text(warning, `$context.warnings[${index}]`, issues),
    );
  }
  if (typeof context.fingerprint !== "string" || !FINGERPRINT_PATTERN.test(context.fingerprint)) {
    issues.push("$context.fingerprint must be a lowercase SHA-256 digest");
  } else {
    try {
      if (calculateChangeContextFingerprint(context) !== context.fingerprint) {
        issues.push("$context.fingerprint does not match the context contents");
      }
    } catch {
      issues.push("$context could not be fingerprinted deterministically");
    }
  }
  validateChangeContextSemantics(context, issues);
  return issues;
}

export function calculateChangeContextFingerprint(context) {
  if (!isRecord(context)) {
    throw new TypeError("ChangeContextV2 must be an object");
  }
  const withoutFingerprint = {};
  for (const [key, value] of Object.entries(context)) {
    if (key !== "fingerprint") {
      withoutFingerprint[key] = value;
    }
  }
  return createHash("sha256")
    .update(CHANGE_CONTEXT_FINGERPRINT_DOMAIN, "utf8")
    .update(canonicalizeJson(withoutFingerprint), "utf8")
    .digest("hex");
}

function equalStringArrays(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function equalExclusionArrays(left, right) {
  return (
    left.length === right.length &&
    left.every(
      (value, index) => value.path === right[index].path && value.reason === right[index].reason,
    )
  );
}

export function validateArtifactAgainstContext(artifact, context) {
  validateArtifact(artifact);
  const issues = collectChangeContextIssues(context);
  if (issues.length > 0) {
    throw new ContextBindingError(issues);
  }

  let calculatedFingerprint;
  try {
    calculatedFingerprint = calculateChangeContextFingerprint(context);
  } catch {
    throw new ContextBindingError(["$context could not be fingerprinted deterministically"]);
  }
  if (calculatedFingerprint !== context.fingerprint) {
    issues.push("$context.fingerprint does not match the context contents");
  }
  if (artifact.change.context.fingerprint !== context.fingerprint) {
    issues.push("$.change.context.fingerprint does not match ChangeContextV2");
  }
  if (artifact.change.context.baseCommit !== context.baseCommit) {
    issues.push("$.change.context.baseCommit does not match ChangeContextV2");
  }
  if (
    artifact.intent !== null &&
    artifact.intent.snapshot.baseline.head !== context.baseCommit
  ) {
    issues.push("$.intent.snapshot.baseline.head does not match ChangeContextV2 baseCommit");
  }
  if (artifact.change.comparison !== context.scope.comparison) {
    issues.push("$.change.comparison does not match ChangeContextV2 scope");
  }
  if (artifact.change.context.complete !== context.complete) {
    issues.push("$.change.context.complete does not match ChangeContextV2");
  }
  if (!equalStringArrays(artifact.change.context.warnings, context.warnings)) {
    issues.push("$.change.context.warnings do not exactly match ChangeContextV2");
  }
  if (!equalExclusionArrays(artifact.change.context.excluded, context.excluded)) {
    issues.push("$.change.context.excluded does not exactly match ChangeContextV2");
  }

  const expectedPaths = new Set(
    context.files.filter((file) => file.bodyIncluded).map((file) => file.path),
  );
  const artifactPaths = new Set(artifact.change.files.map((file) => file.path));
  const inventedPaths = [...artifactPaths].filter((path) => !expectedPaths.has(path));
  const omittedPaths = [...expectedPaths].filter((path) => !artifactPaths.has(path));
  if (inventedPaths.length > 0) {
    issues.push("$.change.files includes path(s) without included ChangeContextV2 bodies");
  }
  if (omittedPaths.length > 0) {
    issues.push("$.change.files omits path(s) with included ChangeContextV2 bodies");
  }

  if (issues.length > 0) {
    throw new ContextBindingError(issues);
  }
  return artifact;
}

export function validateArtifactAgainstIntent(artifact, intent) {
  validateArtifact(artifact);
  const issues = [];

  if (intent === undefined) {
    if (artifact.intent !== null) {
      issues.push("--intent is required when ArtifactV2 embeds an IntentV1 snapshot");
    }
  } else {
    const externalIssues = collectIntentIssues(intent);
    issues.push(...externalIssues.map((issue) => `$intent ${issue}`));

    if (artifact.intent === null) {
      issues.push("$.intent must embed the IntentV1 supplied with --intent");
    } else if (externalIssues.length === 0) {
      let externalFingerprint;
      try {
        externalFingerprint = calculateIntentFingerprint(intent);
      } catch {
        issues.push("$intent could not be fingerprinted deterministically");
      }
      if (externalFingerprint !== intent.fingerprint) {
        issues.push("$intent.fingerprint does not match the IntentV1 contents");
      }
      if (artifact.intent.fingerprint !== intent.fingerprint) {
        issues.push("$.intent.fingerprint does not match the supplied IntentV1");
      }
      try {
        if (canonicalizeJson(artifact.intent.snapshot) !== canonicalizeJson(intent)) {
          issues.push("$.intent.snapshot does not exactly match the supplied IntentV1");
        }
      } catch {
        issues.push("IntentV1 snapshots could not be compared deterministically");
      }
    }
  }

  if (issues.length > 0) {
    throw new IntentBindingError(issues);
  }
  return artifact;
}
