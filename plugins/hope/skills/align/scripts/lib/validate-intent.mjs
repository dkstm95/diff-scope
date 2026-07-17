import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

const ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;
const HEAD_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_TEXT_LENGTH = 4_000;
const FINGERPRINT_DOMAIN = "hope:intent:v1\0";

export const MAX_INTENT_BYTES = 256 * 1024;

export class IntentValidationError extends Error {
  constructor(issues) {
    super(`IntentV1 validation failed:\n- ${issues.join("\n- ")}`);
    this.name = "IntentValidationError";
    this.issues = issues;
  }
}

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function childPath(parent, child) {
  return parent === "$" ? `$.${child}` : `${parent}.${child}`;
}

function record(value, path, requiredKeys, allowedKeys, issues) {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return false;
  }

  for (const key of requiredKeys) {
    if (!own(value, key)) {
      issues.push(`${childPath(path, key)} is required`);
    }
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      issues.push(`${childPath(path, key)} is not allowed`);
    }
  }
  return true;
}

function hasDisallowedControlCharacter(value) {
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

function text(value, path, issues) {
  if (typeof value !== "string") {
    issues.push(`${path} must be a string`);
    return false;
  }
  if (value.trim().length === 0) {
    issues.push(`${path} must not be empty or whitespace-only`);
    return false;
  }
  if (Array.from(value).length > MAX_TEXT_LENGTH) {
    issues.push(`${path} must contain at most ${MAX_TEXT_LENGTH} characters`);
    return false;
  }
  if (hasDisallowedControlCharacter(value)) {
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

function list(value, path, minimum, issues) {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array`);
    return false;
  }
  if (value.length < minimum) {
    issues.push(`${path} must contain at least ${minimum} item${minimum === 1 ? "" : "s"}`);
    return false;
  }
  return true;
}

function validateItems(value, path, minimum, keys, issues) {
  if (!list(value, path, minimum, issues)) {
    return;
  }

  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!record(item, itemPath, keys, keys, issues)) {
      return;
    }
    id(item.id, `${itemPath}.id`, issues);
    for (const key of keys) {
      if (key !== "id") {
        text(item[key], `${itemPath}.${key}`, issues);
      }
    }
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

const ASSIGNMENT_PATTERN =
  /(?:^|[\s,{;+\-])(?:(?:(["'])((?:\\.|[^"'\\\r\n])*)\1)|([A-Za-z0-9_./:@-]+))[ \t]*(?::|=(?!=|>))[ \t]*(?:"((?:\\.|[^"\\\r\n])*)"|'((?:\\.|[^'\\\r\n])*)'|`((?:\\.|[^`\\\r\n])*)`|((?:\$\{[^}\r\n]+\}(?=[ \t]*(?:[,;}\]]|\r?$))|\$\{[^}\r\n]+\}[^\r\n,;}]*|(?:\[|<)?[Rr][Ee][Dd][Aa][Cc][Tt][Ee][Dd](?:\]|>)?|[^\r\n,;}]+)))/gmu;

const BRACKETED_ASSIGNMENT_PATTERN =
  /\[[ \t]*(?:"((?:\\.|[^"\\\r\n])*)"|'((?:\\.|[^'\\\r\n])*)'|`((?:\\.|[^`\\\r\n])*)`)[ \t]*\][ \t]*(?::|=(?!=|>))[ \t]*(?:"((?:\\.|[^"\\\r\n])*)"|'((?:\\.|[^'\\\r\n])*)'|`((?:\\.|[^`\\\r\n])*)`|((?:\$\{[^}\r\n]+\}(?=[ \t]*(?:[,;}\]]|\r?$))|\$\{[^}\r\n]+\}[^\r\n,;}]*|(?:\[|<)?[Rr][Ee][Dd][Aa][Cc][Tt][Ee][Dd](?:\]|>)?|[^\r\n,;}]+)))/gmu;

const CONTINUED_ASSIGNMENT_HEAD_PATTERN =
  /(?:^|[\s,{;])(?:(?:(["'])((?:\\.|[^"'\\\r\n])*)\1)|([A-Za-z0-9_./:@-]+))[ \t]*(?::|=(?!=|>))[ \t]*(?:[A-Za-z_$][A-Za-z0-9_$.]*[ \t]*\([ \t]*)?\r?$/u;

const BRACKETED_CONTINUED_ASSIGNMENT_HEAD_PATTERN =
  /\[[ \t]*(?:"((?:\\.|[^"\\\r\n])*)"|'((?:\\.|[^'\\\r\n])*)'|`((?:\\.|[^`\\\r\n])*)`)[ \t]*\][ \t]*(?::|=(?!=|>))[ \t]*(?:[A-Za-z_$][A-Za-z0-9_$.]*[ \t]*\([ \t]*)?\r?$/u;

const CONTINUED_QUOTED_VALUE_PATTERN =
  /^[ \t]*(?:"((?:\\.|[^"\\\r\n])*)"|'((?:\\.|[^'\\\r\n])*)'|`((?:\\.|[^`\\\r\n])*)`)[ \t]*[,;}]?[ \t]*\r?$/u;

const SENSITIVE_KEY_SEQUENCES = [
  ["api", "key"],
  ["secret", "access", "key"],
  ["secret", "key"],
  ["private", "key"],
  ["client", "secret"],
  ["access", "token"],
  ["auth", "token"],
  ["refresh", "token"],
];

const SENSITIVE_COMPACT_KEYS = new Set([
  "apikey",
  "secretaccesskey",
  "secretkey",
  "privatekey",
  "clientsecret",
  "accesstoken",
  "authtoken",
  "refreshtoken",
]);

const SENSITIVE_TERMINAL_KEY_TOKENS = new Set([
  "password",
  "passwd",
  "pwd",
  "secret",
  "token",
]);

function assignmentKeyTokens(rawKey) {
  return rawKey
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);
}

function containsSequence(tokens, sequence) {
  if (sequence.length > tokens.length) {
    return false;
  }
  for (let start = 0; start <= tokens.length - sequence.length; start += 1) {
    if (sequence.every((token, offset) => tokens[start + offset] === token)) {
      return true;
    }
  }
  return false;
}

function isSensitiveAssignmentKey(rawKey) {
  const tokens = assignmentKeyTokens(rawKey);
  if (tokens.length === 0) {
    return false;
  }
  if (SENSITIVE_TERMINAL_KEY_TOKENS.has(tokens.at(-1))) {
    return true;
  }
  if (
    tokens.some((token) =>
      [...SENSITIVE_COMPACT_KEYS].some(
        (compactKey) => token === compactKey || token.endsWith(compactKey),
      ),
    )
  ) {
    return true;
  }
  return SENSITIVE_KEY_SEQUENCES.some((sequence) => containsSequence(tokens, sequence));
}

function decodeStaticAssignmentKey(rawKey, delimiter) {
  let decoded = "";

  for (let index = 0; index < rawKey.length; index += 1) {
    const character = rawKey[index];
    if (delimiter === "`" && character === "$" && rawKey[index + 1] === "{") {
      return null;
    }
    if (character !== "\\") {
      decoded += character;
      continue;
    }

    index += 1;
    if (index >= rawKey.length) {
      return null;
    }
    const escaped = rawKey[index];
    const simpleEscapes = {
      0: "\0",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\v",
    };
    if (Object.hasOwn(simpleEscapes, escaped)) {
      if (escaped === "0" && /[0-9]/u.test(rawKey[index + 1] ?? "")) {
        return null;
      }
      decoded += simpleEscapes[escaped];
      continue;
    }
    if (escaped === "\n") {
      continue;
    }
    if (escaped === "\r") {
      if (rawKey[index + 1] === "\n") {
        index += 1;
      }
      continue;
    }
    if (escaped === "x") {
      const hex = rawKey.slice(index + 1, index + 3);
      if (!/^[a-f0-9]{2}$/iu.test(hex)) {
        return null;
      }
      decoded += String.fromCodePoint(Number.parseInt(hex, 16));
      index += 2;
      continue;
    }
    if (escaped === "u") {
      if (rawKey[index + 1] === "{") {
        const end = rawKey.indexOf("}", index + 2);
        const hex = end === -1 ? "" : rawKey.slice(index + 2, end);
        const codePoint = /^[a-f0-9]{1,6}$/iu.test(hex) ? Number.parseInt(hex, 16) : -1;
        if (codePoint < 0 || codePoint > 0x10ffff) {
          return null;
        }
        decoded += String.fromCodePoint(codePoint);
        index = end;
        continue;
      }
      const hex = rawKey.slice(index + 1, index + 5);
      if (!/^[a-f0-9]{4}$/iu.test(hex)) {
        return null;
      }
      decoded += String.fromCodePoint(Number.parseInt(hex, 16));
      index += 4;
      continue;
    }

    decoded += escaped;
  }

  return decoded;
}

function parseSensitiveAssignments(value) {
  const assignments = [];
  ASSIGNMENT_PATTERN.lastIndex = 0;
  let match = ASSIGNMENT_PATTERN.exec(value);
  while (match) {
    const rawKey = match[2] ?? match[3] ?? "";
    const key = match[2] === undefined ? rawKey : decodeStaticAssignmentKey(rawKey, match[1]);
    if (key !== null && isSensitiveAssignmentKey(key)) {
      assignments.push({
        value: match[4] ?? match[5] ?? match[6] ?? match[7] ?? "",
        quoted: match[4] !== undefined || match[5] !== undefined || match[6] !== undefined,
      });
    }
    match = ASSIGNMENT_PATTERN.exec(value);
  }

  BRACKETED_ASSIGNMENT_PATTERN.lastIndex = 0;
  match = BRACKETED_ASSIGNMENT_PATTERN.exec(value);
  while (match) {
    const rawKey = match[1] ?? match[2] ?? match[3] ?? "";
    const delimiter = match[1] !== undefined ? '"' : match[2] !== undefined ? "'" : "`";
    const key = decodeStaticAssignmentKey(rawKey, delimiter);
    if (key !== null && isSensitiveAssignmentKey(key)) {
      assignments.push({
        value: match[4] ?? match[5] ?? match[6] ?? match[7] ?? "",
        quoted: match[4] !== undefined || match[5] !== undefined || match[6] !== undefined,
      });
    }
    match = BRACKETED_ASSIGNMENT_PATTERN.exec(value);
  }

  const lines = value.split(/\r?\n/u);
  for (let index = 0; index < lines.length - 1; index += 1) {
    const head = parseContinuedAssignmentHead(lines[index]);
    if (head === null || !isSensitiveAssignmentKey(head.key)) {
      continue;
    }
    for (const candidate of continuedValueCandidates(lines, index, head.marker)) {
      const continuation = CONTINUED_QUOTED_VALUE_PATTERN.exec(candidate.body);
      if (continuation === null) {
        continue;
      }
      assignments.push({
        value: continuation[1] ?? continuation[2] ?? continuation[3] ?? "",
        quoted: true,
      });
    }
  }
  return assignments;
}

function splitDiffMarker(line) {
  if (/^[+\- ]/u.test(line)) {
    return { marker: line.charAt(0), body: line.slice(1) };
  }
  return { marker: "", body: line };
}

function parseContinuedAssignmentHead(line) {
  const { marker, body } = splitDiffMarker(line);
  const bareMatch = CONTINUED_ASSIGNMENT_HEAD_PATTERN.exec(body);
  if (bareMatch !== null) {
    const rawKey = bareMatch[2] ?? bareMatch[3] ?? "";
    const key = bareMatch[2] === undefined
      ? rawKey
      : decodeStaticAssignmentKey(rawKey, bareMatch[1]);
    return key === null ? null : { marker, key };
  }

  const bracketedMatch = BRACKETED_CONTINUED_ASSIGNMENT_HEAD_PATTERN.exec(body);
  if (bracketedMatch === null) {
    return null;
  }
  const rawKey = bracketedMatch[1] ?? bracketedMatch[2] ?? bracketedMatch[3] ?? "";
  const delimiter = bracketedMatch[1] !== undefined
    ? '"'
    : bracketedMatch[2] !== undefined
      ? "'"
      : "`";
  const key = decodeStaticAssignmentKey(rawKey, delimiter);
  return key === null ? null : { marker, key };
}

function bodyForMatchingContinuation(line, marker) {
  if (marker !== "") {
    return line.startsWith(marker) ? line.slice(1) : null;
  }
  return /^[+\-]/u.test(line) ? null : line;
}

function continuedValueCandidates(lines, headIndex, marker) {
  const nextLine = lines[headIndex + 1];
  if (marker === " " && /^[+\-]/u.test(nextLine ?? "")) {
    const candidates = [{ body: nextLine.slice(1) }];
    if (nextLine.startsWith("-") && lines[headIndex + 2]?.startsWith("+")) {
      candidates.push({ body: lines[headIndex + 2].slice(1) });
    }
    return candidates;
  }
  const body = bodyForMatchingContinuation(nextLine ?? "", marker);
  return body === null ? [] : [{ body }];
}

function isSecretPlaceholder(value) {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length === 0 ||
    /^(?:\[?redacted\]?|<redacted>|placeholder|example|value|changeme|x+|\*+)$/u.test(
      normalized,
    ) ||
    /^<[^>]+>$|^\$\{[^}]+\}$/iu.test(normalized) ||
    /^(?:your|example)[_-]?[a-z0-9_-]+$/u.test(normalized)
  );
}

function isEnvironmentOrConfigReference(value) {
  const normalized = value.trim();
  return (
    /^(?:process\.env|os\.environ|env|config|settings|secrets?)(?:(?:\.|\?\.)[a-z_$][a-z0-9_$.-]*|(?:\?\.)?[ \t]*\[[ \t]*(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|`(?:\\.|[^`\\\r\n])*`)[ \t]*\])+$/iu.test(
      normalized,
    ) ||
    /^\$[a-z_][a-z0-9_]*$/iu.test(normalized)
  );
}

function isSafeUnquotedSecretExpression(value) {
  const normalized = value.trim();
  return (
    /^(?:null|undefined|none|false)$/iu.test(normalized) ||
    /^[a-z_$][a-z0-9_$.]*[ \t]*\([^\r\n"'`]*\)$/iu.test(normalized) ||
    /^[a-z_$][a-z0-9_$.]*[ \t]*\([ \t]*$/iu.test(normalized)
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

  for (const assignment of parseSensitiveAssignments(normalizedEscapes)) {
    const assignedValue = assignment.value;
    const quoted = assignment.quoted;
    const safeReference = !quoted && isEnvironmentOrConfigReference(assignedValue);
    const safeExpression = !quoted && isSafeUnquotedSecretExpression(assignedValue);
    if (!isSecretPlaceholder(assignedValue) && !safeReference && !safeExpression) {
      labels.push("secret assignment");
      break;
    }
  }
  return [...new Set(labels)];
}

export function collectSecretIssues(root) {
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
      pending.push({ path: childPath(current.path, key), value });
    }
  }
  return issues;
}

function validateGlobalIds(intent, issues) {
  const collections = ["outcomes", "constraints", "decisions", "nonGoals", "scenarios"];
  const seen = new Map();

  for (const collection of collections) {
    const items = intent[collection];
    if (!Array.isArray(items)) {
      continue;
    }
    items.forEach((item, index) => {
      if (!isRecord(item) || typeof item.id !== "string" || !ID_PATTERN.test(item.id)) {
        return;
      }
      const path = `$.${collection}[${index}].id`;
      const firstPath = seen.get(item.id);
      if (firstPath !== undefined) {
        issues.push(`${path} duplicates globally unique id "${item.id}" from ${firstPath}`);
      } else {
        seen.set(item.id, path);
      }
    });
  }
}

function canonicalize(value, ancestors) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON does not support non-finite numbers");
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new TypeError(`Canonical JSON does not support ${typeof value}`);
  }
  if (ancestors.has(value)) {
    throw new TypeError("Canonical JSON does not support cyclic values");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => canonicalize(entry, ancestors)).join(",")}]`;
    }
    if (!isRecord(value)) {
      throw new TypeError("Canonical JSON supports only plain objects");
    }
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key], ancestors)}`);
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalizeJson(value) {
  return canonicalize(value, new WeakSet());
}

export function calculateIntentFingerprint(intent) {
  if (!isRecord(intent)) {
    throw new TypeError("IntentV1 must be an object");
  }

  const payload = {};
  for (const [key, value] of Object.entries(intent)) {
    if (key !== "fingerprint") {
      payload[key] = value;
    }
  }
  return createHash("sha256")
    .update(FINGERPRINT_DOMAIN, "utf8")
    .update(canonicalizeJson(payload), "utf8")
    .digest("hex");
}

export function collectIntentIssues(intent) {
  const issues = [];
  const rootKeys = [
    "schemaVersion",
    "baseline",
    "goal",
    "outcomes",
    "constraints",
    "decisions",
    "nonGoals",
    "scenarios",
    "fingerprint",
  ];
  if (!record(intent, "$", rootKeys, rootKeys, issues)) {
    return issues;
  }

  if (intent.schemaVersion !== 1) {
    issues.push("$.schemaVersion must equal 1");
  }
  try {
    if (Buffer.byteLength(canonicalizeJson(intent), "utf8") > MAX_INTENT_BYTES) {
      issues.push(`$ exceeds the ${MAX_INTENT_BYTES}-byte canonical JSON limit`);
    }
  } catch {
    issues.push("$ could not be measured as canonical JSON");
  }
  if (
    record(
      intent.baseline,
      "$.baseline",
      ["head", "workingTree"],
      ["head", "workingTree"],
      issues,
    )
  ) {
    if (typeof intent.baseline.head !== "string" || !HEAD_PATTERN.test(intent.baseline.head)) {
      issues.push("$.baseline.head must be a lowercase 40- or 64-character Git object id");
    }
    if (intent.baseline.workingTree !== "clean") {
      issues.push('$.baseline.workingTree must equal "clean"');
    }
  }

  text(intent.goal, "$.goal", issues);
  validateItems(intent.outcomes, "$.outcomes", 1, ["id", "statement"], issues);
  validateItems(
    intent.constraints,
    "$.constraints",
    0,
    ["id", "statement", "rationale"],
    issues,
  );
  validateItems(
    intent.decisions,
    "$.decisions",
    0,
    ["id", "decision", "rationale", "tradeoff"],
    issues,
  );
  validateItems(intent.nonGoals, "$.nonGoals", 0, ["id", "statement"], issues);
  validateItems(intent.scenarios, "$.scenarios", 0, ["id", "given", "when", "then"], issues);
  validateGlobalIds(intent, issues);

  if (typeof intent.fingerprint !== "string" || !FINGERPRINT_PATTERN.test(intent.fingerprint)) {
    issues.push("$.fingerprint must be a lowercase SHA-256 digest");
  } else {
    try {
      if (calculateIntentFingerprint(intent) !== intent.fingerprint) {
        issues.push("$.fingerprint does not match the canonical IntentV1 contents");
      }
    } catch {
      issues.push("$ could not be fingerprinted as canonical JSON");
    }
  }

  issues.push(...collectSecretIssues(intent));
  return issues;
}

export function validateIntent(intent) {
  const issues = collectIntentIssues(intent);
  if (issues.length > 0) {
    throw new IntentValidationError(issues);
  }
  return intent;
}
