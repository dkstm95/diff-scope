import { createHash } from "node:crypto";

const ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const WINDOWS_DRIVE_PATTERN = /^[a-zA-Z]:/;
const URL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

function hasControlCharacter(value) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 31 || codePoint === 127;
  });
}

export class ArtifactValidationError extends Error {
  constructor(issues) {
    super(`ArtifactV1 validation failed:\n- ${issues.join("\n- ")}`);
    this.name = "ArtifactValidationError";
    this.issues = issues;
  }
}

export class ContextBindingError extends Error {
  constructor(issues) {
    super(`ChangeContextV1 binding failed:\n- ${issues.join("\n- ")}`);
    this.name = "ContextBindingError";
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
  if (value.length > 4000) {
    issues.push(`${path} must contain at most 4000 characters`);
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
  if (typeof value !== "string" || value.length === 0 || value.length > 300) {
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
      ["fingerprint", "complete", "warnings", "excluded"],
      ["fingerprint", "complete", "warnings", "excluded"],
      issues,
    )
  ) {
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
      const entryKeys = ["decision", "rationale", "tradeoff"];
      if (record(entry, path, entryKeys, entryKeys, issues)) {
        for (const key of entryKeys) {
          text(entry[key], `${path}.${key}`, issues);
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
    if (array(question.evidencePaths, `${path}.evidencePaths`, 1, 10, issues)) {
      question.evidencePaths.forEach((entry, evidenceIndex) =>
        relativePath(entry, `${path}.evidencePaths[${evidenceIndex}]`, issues),
      );
    }
  });
}

function validateMicroworld(value, issues) {
  const microworldKeys = ["title", "instructions", "controls", "scenarios"];
  if (!record(value, "$.microworld", microworldKeys, microworldKeys, issues)) {
    return;
  }

  text(value.title, "$.microworld.title", issues);
  text(value.instructions, "$.microworld.instructions", issues);

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

const SECRET_PATTERNS = [
  {
    label: "PEM private-key header",
    pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----|-----BEGIN PGP PRIVATE KEY BLOCK-----/u,
  },
  {
    label: "provider token",
    pattern:
      /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{16,}|AIza[A-Za-z0-9_-]{30,}|(?:AKIA|ASIA)[A-Z0-9]{16}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,})\b/u,
  },
  {
    label: "Bearer credential",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{12,}={0,2}\b/iu,
  },
  {
    label: "JWT credential",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
  },
  {
    label: "URL userinfo credential",
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/iu,
  },
];

const SECRET_ASSIGNMENT_PATTERN =
  /\b(?:password|passwd|secret|client[_-]?secret|api[_-]?key|access[_-]?token|private[_-]?key|secret[_-]?key)\b["']?\s*[:=]\s*(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s,;]+))/giu;

function isSecretPlaceholder(value) {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length === 0 ||
    /^(?:\[?redacted\]?|<redacted>|placeholder|example|value|changeme|x+|\*+)$/u.test(normalized) ||
    /^<[^>]+>$|^\$\{[^}]+\}$|^process\.env\.[a-z0-9_]+$/iu.test(normalized) ||
    /^(?:your|example)[_-]?[a-z0-9_-]+$/u.test(normalized)
  );
}

function isEnvironmentOrConfigReference(value) {
  const normalized = value.trim();
  return (
    /^(?:(?:process\.)?env|config|settings|secrets?)\.[a-z0-9_.-]+$/iu.test(normalized) ||
    /^(?:(?:process\.)?env|config|settings|secrets?)\[(?:"[^"]+"|'[^']+')\]$/iu.test(normalized) ||
    /^\$[a-z_][a-z0-9_]*$/iu.test(normalized)
  );
}

function isSafeUnquotedSecretExpression(value) {
  const normalized = value.trim();
  return (
    /^(?:null|undefined|none|false)$/iu.test(normalized) ||
    /^[a-z_$][a-z0-9_$.]*\([^\r\n]*\)$/iu.test(normalized)
  );
}

function secretLabels(value) {
  const labels = [];
  const normalizedEscapes = value.replaceAll('\\"', '"').replaceAll("\\'", "'");
  for (const { label, pattern } of SECRET_PATTERNS) {
    if (pattern.test(value) || pattern.test(normalizedEscapes)) {
      labels.push(label);
    }
  }

  SECRET_ASSIGNMENT_PATTERN.lastIndex = 0;
  let assignment = SECRET_ASSIGNMENT_PATTERN.exec(normalizedEscapes);
  while (assignment) {
    const assignedValue = assignment[1] ?? assignment[2] ?? assignment[3] ?? "";
    const quoted = assignment[1] !== undefined || assignment[2] !== undefined;
    const safeReference = isEnvironmentOrConfigReference(assignedValue);
    const safeExpression = !quoted && isSafeUnquotedSecretExpression(assignedValue);
    if (!isSecretPlaceholder(assignedValue) && !safeReference && !safeExpression) {
      labels.push("secret assignment");
      break;
    }
    assignment = SECRET_ASSIGNMENT_PATTERN.exec(normalizedEscapes);
  }
  return [...new Set(labels)];
}

function collectSecretIssues(root) {
  const issues = [];
  const pending = [{ path: "$", value: root }];
  const seen = new WeakSet();

  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current.value === "string") {
      const labels = secretLabels(current.value);
      if (labels.length > 0) {
        issues.push(`${current.path} contains suspected ${labels.join(" and ")}`);
      }
      continue;
    }
    if (current.value === null || typeof current.value !== "object") {
      continue;
    }
    if (seen.has(current.value)) {
      continue;
    }
    seen.add(current.value);

    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        pending.push({ path: `${current.path}[${index}]`, value: current.value[index] });
      }
      continue;
    }
    for (const [key, value] of Object.entries(current.value)) {
      pending.push({ path: location(current.path, key), value });
    }
  }
  return issues;
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

function validateSemantics(artifact, issues) {
  const files = Array.isArray(artifact.change?.files) ? artifact.change.files : [];
  const filePaths = files.map((file) => file?.path);
  addDuplicateIssues(filePaths, "$.change.files", "path", issues);
  const knownPaths = new Set(filePaths.filter((path) => isSafeRelativePosixPath(path)));

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

    const evidencePaths = Array.isArray(question.evidencePaths) ? question.evidencePaths : [];
    addDuplicateIssues(evidencePaths, `${path}.evidencePaths`, "evidence path", issues);
    evidencePaths.forEach((evidencePath, evidenceIndex) => {
      if (isSafeRelativePosixPath(evidencePath) && !knownPaths.has(evidencePath)) {
        issues.push(`${path}.evidencePaths[${evidenceIndex}] references an unknown file`);
      }
    });
  });

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
  const rootKeys = ["schemaVersion", "title", "change", "explanation", "quiz", "microworld"];
  if (!record(artifact, "$", rootKeys, rootKeys, issues)) {
    return issues;
  }

  if (artifact.schemaVersion !== 1) {
    issues.push("$.schemaVersion must equal 1");
  }
  text(artifact.title, "$.title", issues);
  validateChange(artifact.change, issues);
  validateExplanation(artifact.explanation, issues);
  validateQuiz(artifact.quiz, issues);
  validateMicroworld(artifact.microworld, issues);
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

export function collectChangeContextIssues(context) {
  const issues = [];
  const rootKeys = [
    "schemaVersion",
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

  if (context.schemaVersion !== 1) {
    issues.push("$context.schemaVersion must equal 1");
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
      issues.push("$context.scope.comparison must match the DiffScope working-tree comparison");
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
      if (typeof patch.text !== "string" || patch.text.length > 262144) {
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
  }
  return issues;
}

export function calculateChangeContextFingerprint(context) {
  if (!isRecord(context)) {
    throw new TypeError("ChangeContextV1 must be an object");
  }
  const withoutFingerprint = {};
  for (const [key, value] of Object.entries(context)) {
    if (key !== "fingerprint") {
      withoutFingerprint[key] = value;
    }
  }
  return createHash("sha256").update(JSON.stringify(withoutFingerprint)).digest("hex");
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
    issues.push("$.change.context.fingerprint does not match ChangeContextV1");
  }
  if (artifact.change.comparison !== context.scope.comparison) {
    issues.push("$.change.comparison does not match ChangeContextV1 scope");
  }
  if (artifact.change.context.complete !== context.complete) {
    issues.push("$.change.context.complete does not match ChangeContextV1");
  }
  if (!equalStringArrays(artifact.change.context.warnings, context.warnings)) {
    issues.push("$.change.context.warnings do not exactly match ChangeContextV1");
  }
  if (!equalExclusionArrays(artifact.change.context.excluded, context.excluded)) {
    issues.push("$.change.context.excluded does not exactly match ChangeContextV1");
  }

  const expectedPaths = new Set(
    context.files.filter((file) => file.bodyIncluded).map((file) => file.path),
  );
  const artifactPaths = new Set(artifact.change.files.map((file) => file.path));
  const inventedPaths = [...artifactPaths].filter((path) => !expectedPaths.has(path));
  const omittedPaths = [...expectedPaths].filter((path) => !artifactPaths.has(path));
  if (inventedPaths.length > 0) {
    issues.push("$.change.files includes path(s) without included ChangeContextV1 bodies");
  }
  if (omittedPaths.length > 0) {
    issues.push("$.change.files omits path(s) with included ChangeContextV1 bodies");
  }

  if (issues.length > 0) {
    throw new ContextBindingError(issues);
  }
  return artifact;
}
