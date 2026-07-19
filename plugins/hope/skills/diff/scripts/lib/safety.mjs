const SECRET_PATTERNS = [
  {
    label: "PEM private-key header",
    pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----|-----BEGIN PGP PRIVATE KEY BLOCK-----/u,
  },
  {
    label: "provider token",
    pattern: /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{16,}|AIza[A-Za-z0-9_-]{30,}|(?:AKIA|ASIA)[A-Z0-9]{16}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,})\b/u,
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
    requiredSubstrings: ["://", "@"],
    pattern: /(?:^|[^a-z0-9+.-])[a-z][a-z0-9+.-]{0,63}:\/\/[^\s/@:]+:[^\s/@]+@/iu,
  },
];

const SENSITIVE_KEY_PATTERN = /(?:^|[^a-z0-9])(?:api[_-]?key|secret(?:[_-]?(?:access|private|client))?[_-]?key|private[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|refresh[_-]?token|password|passwd|pwd|secret|token)(?:$|[^a-z0-9])/iu;
const SENSITIVE_COMPACT_KEY_SUFFIX_PATTERN = /(?:apikey|secretaccesskey|secretkey|privatekey|clientsecret|accesstoken|authtoken|refreshtoken)$/iu;
const DETECTOR_DEFINITION_SUFFIXES = new Set([
  "pattern",
  "patterns",
  "regex",
  "regexes",
  "rule",
  "rules",
  "matcher",
  "matchers",
  "detector",
  "detectors",
]);
const BARE_ASSIGNMENT_PATTERN = /(?:^|[\s,{;])([A-Za-z0-9_.:@/-]+)[ \t]*(?::|(?:\?\?|\|\||&&|\*\*|>>>|<<|>>|[+\-*/%&|^])?=(?!=|>))[ \t]*(?:"((?:\\.|[^"\\\r\n])*)"(?![ \t]*(?:"|\+))|'((?:\\.|[^'\\\r\n])*)'(?![ \t]*(?:'|\+))|`((?:\\.|[^`\\\r\n])*)`(?![ \t]*(?:`|\+))|([^\r\n,;}]+))/gmu;
const QUOTED_KEY_ASSIGNMENT_PATTERN = /(?:^|[\s,{;])(["'`])((?:\\.|(?!\1)[^\\\r\n])*)\1[ \t]*(?::|(?:\?\?|\|\||&&|\*\*|>>>|<<|>>|[+\-*/%&|^])?=(?!=|>))[ \t]*(?:"((?:\\.|[^"\\\r\n])*)"(?![ \t]*(?:"|\+))|'((?:\\.|[^'\\\r\n])*)'(?![ \t]*(?:'|\+))|`((?:\\.|[^`\\\r\n])*)`(?![ \t]*(?:`|\+))|([^\r\n,;}]+))/gmu;
const BRACKETED_ASSIGNMENT_PATTERN = /\[[ \t]*(["'`])((?:\\.|(?!\1)[^\\\r\n])*)\1[ \t]*\][ \t]*(?::|(?:\?\?|\|\||&&|\*\*|>>>|<<|>>|[+\-*/%&|^])?=(?!=|>))[ \t]*(?:"((?:\\.|[^"\\\r\n])*)"(?![ \t]*(?:"|\+))|'((?:\\.|[^'\\\r\n])*)'(?![ \t]*(?:'|\+))|`((?:\\.|[^`\\\r\n])*)`(?![ \t]*(?:`|\+))|([^\r\n,;}]+))/gmu;

function childPath(parent, child) {
  const value = String(child);
  const safeSegment = /^[A-Za-z_$][A-Za-z0-9_$-]{0,63}$/u.test(value) &&
    secretLabels(value).length === 0
    ? value
    : "<property>";
  return parent === "$" ? `$.${safeSegment}` : `${parent}.${safeSegment}`;
}

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isPlaceholder(value) {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length === 0 ||
    /^(?:\[?redacted\]?|<redacted>|placeholder|example|value|changeme|x+|\*+)$/u.test(normalized) ||
    /^<[^>]+>$|^\$\{[^}]+\}$/u.test(normalized) ||
    /^(?:your|example)[_-]?[a-z0-9_-]+$/u.test(normalized)
  );
}

function isSafeReference(value) {
  const normalized = value.trim();
  return (
    /^(?:process\.env|os\.environ|env|config|settings|secrets?)(?:(?:\.|\?\.)[a-z_$][a-z0-9_$.-]*|(?:\?\.)?[ \t]*\[[ \t]*(?:"[^"]*"|'[^']*'|`[^`]*`)[ \t]*\])+$/iu.test(normalized) ||
    /^\$[a-z_][a-z0-9_]*$/iu.test(normalized) ||
    /^(?:null|undefined|none|false|true)$/iu.test(normalized) ||
    /^[a-z_$][a-z0-9_$.]*[ \t]*\([^\r\n"'`]*\)$/iu.test(normalized)
  );
}

function isCancellationTokenAnnotation(key, value) {
  let normalized = value.trim();
  normalized = normalized.replace(/\)\s*:\s*[^\r\n]*$/u, "").replace(/\)\s*$/u, "").trim();
  return (
    (
      keyTokens(key).at(-1) === "token" &&
      /^CancellationToken(?:\s*=\s*CancellationToken\.None)?$/u.test(normalized)
    ) ||
    (key === "CancellationToken" && normalized === "CancellationToken.None")
  );
}

function decodeStaticKey(value) {
  try {
    return value
      .replace(/\\u\{([a-f0-9]{1,6})\}/giu, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
      .replace(/\\u([a-f0-9]{4})/giu, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
      .replace(/\\x([a-f0-9]{2})/giu, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
      .replace(/\\([\\"'`])/gu, "$1");
  } catch {
    return "";
  }
}

function keyTokens(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);
}

function isSensitiveKey(value) {
  const normalized = value.replace(/([a-z0-9])([A-Z])/gu, "$1_$2");
  return (
    SENSITIVE_KEY_PATTERN.test(normalized) ||
    SENSITIVE_COMPACT_KEY_SUFFIX_PATTERN.test(normalized.replace(/[^a-z0-9]+/giu, ""))
  );
}

function isDetectorDefinitionOpener(key, value, quoted) {
  const suffix = keyTokens(key).at(-1);
  return (
    !quoted &&
    DETECTOR_DEFINITION_SUFFIXES.has(suffix) &&
    /^(?:\[|\{)$/u.test(value.trim())
  );
}

function assignmentIsUnsafe(key, value, quoted) {
  if (isDetectorDefinitionOpener(key, value, quoted)) return false;
  if (!quoted && isCancellationTokenAnnotation(key, value)) return false;
  return !isPlaceholder(value) && (quoted || !isSafeReference(value));
}

function hasUnsafeQuotedPlaceholderTail(source, match, quoted, assigned) {
  if (!quoted || !isPlaceholder(assigned)) return false;
  const sameLineTail = source
    .slice(match.index + match[0].length)
    .split(/\r?\n/u, 1)[0]
    .trimStart();
  return (
    sameLineTail.length > 0 &&
    !/^(?:;|,|\)|\]|\})/u.test(sameLineTail)
  );
}

function containsUnsafeAssignment(value) {
  BARE_ASSIGNMENT_PATTERN.lastIndex = 0;
  let match = BARE_ASSIGNMENT_PATTERN.exec(value);
  while (match !== null) {
    if (isSensitiveKey(match[1])) {
      const quoted = match[2] !== undefined || match[3] !== undefined || match[4] !== undefined;
      const assigned = match[2] ?? match[3] ?? match[4] ?? match[5] ?? "";
      if (
        hasUnsafeQuotedPlaceholderTail(value, match, quoted, assigned) ||
        assignmentIsUnsafe(match[1], assigned, quoted)
      ) return true;
    }
    match = BARE_ASSIGNMENT_PATTERN.exec(value);
  }
  for (const pattern of [QUOTED_KEY_ASSIGNMENT_PATTERN, BRACKETED_ASSIGNMENT_PATTERN]) {
    pattern.lastIndex = 0;
    match = pattern.exec(value);
    while (match !== null) {
      const key = decodeStaticKey(match[2]);
      if (isSensitiveKey(key)) {
        const quoted = match[3] !== undefined || match[4] !== undefined || match[5] !== undefined;
        const assigned = match[3] ?? match[4] ?? match[5] ?? match[6] ?? "";
        if (
          hasUnsafeQuotedPlaceholderTail(value, match, quoted, assigned) ||
          assignmentIsUnsafe(key, assigned, quoted)
        ) return true;
      }
      match = pattern.exec(value);
    }
  }
  return false;
}

function secretLabels(value) {
  const labels = [];
  const normalized = value.replaceAll('\\"', '"').replaceAll("\\'", "'");
  for (const entry of SECRET_PATTERNS) {
    const matches = (candidate) =>
      (entry.requiredSubstrings ?? []).every((part) => candidate.includes(part)) &&
      entry.pattern.test(candidate);
    if (matches(value) || matches(normalized)) labels.push(entry.label);
  }
  if (containsUnsafeAssignment(normalized)) labels.push("secret assignment");
  return [...new Set(labels)];
}

export function collectSecretIssues(root) {
  const issues = [];
  const pending = [{ path: "$", key: null, value: root }];
  const seen = new WeakSet();
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current.value === "string") {
      const labels = secretLabels(current.value);
      if (
        typeof current.key === "string" &&
        isSensitiveKey(current.key) &&
        !isPlaceholder(current.value) &&
        !isSafeReference(current.value)
      ) {
        labels.push("secret assignment");
      }
      if (labels.length > 0) issues.push(`${current.path} contains suspected ${[...new Set(labels)].join(" and ")}`);
      continue;
    }
    if (current.value === null || typeof current.value !== "object" || seen.has(current.value)) continue;
    seen.add(current.value);
    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        pending.push({ path: `${current.path}[${index}]`, key: null, value: current.value[index] });
      }
      continue;
    }
    for (const [key, value] of Object.entries(current.value)) {
      pending.push({ path: childPath(current.path, key), key, value });
    }
  }
  return issues;
}

function canonicalize(value, ancestors) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON does not support non-finite numbers");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw new TypeError(`Canonical JSON does not support ${typeof value}`);
  if (ancestors.has(value)) throw new TypeError("Canonical JSON does not support cyclic values");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return `[${value.map((entry) => canonicalize(entry, ancestors)).join(",")}]`;
    if (!isRecord(value)) throw new TypeError("Canonical JSON supports only plain objects");
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key], ancestors)}`).join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalizeJson(value) {
  return canonicalize(value, new WeakSet());
}
