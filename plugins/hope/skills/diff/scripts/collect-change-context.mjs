#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import console from "node:console";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { chmod, lstat, mkdtemp, open, realpath, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";

import { canonicalizeJson } from "../../align/scripts/lib/validate-intent.mjs";

const GIT_PREFIX = ["--no-pager", "--literal-pathspecs", "-c", "core.fsmonitor=false"];
const METADATA_MAX_BYTES = 8 * 1024 * 1024;
const WINDOWS_DRIVE_PATTERN = /^[a-zA-Z]:/;
const URL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const CHANGE_CONTEXT_FINGERPRINT_DOMAIN = "hope:change-context:v2\0";
const RAW_STABILITY_FINGERPRINT_DOMAIN = "hope:change-raw-stability:v1\0";

export const DEFAULT_LIMITS = Object.freeze({
  totalPatchBytes: 256 * 1024,
  filePatchBytes: 64 * 1024,
  maxFiles: 80,
  changedLines: 4_000,
  timeoutMs: 10_000,
});

const STATUS_NAMES = Object.freeze({
  A: "added",
  C: "copied",
  D: "deleted",
  M: "modified",
  R: "renamed",
  T: "type-changed",
  U: "unmerged",
  X: "unknown",
});

const LOCKFILE_NAMES = new Set([
  "bun.lock",
  "bun.lockb",
  "cargo.lock",
  "composer.lock",
  "gemfile.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "poetry.lock",
  "uv.lock",
  "yarn.lock",
]);

const GENERATED_SEGMENTS = new Set([
  ".next",
  ".nuxt",
  "__generated__",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "out",
  "target",
  "vendor",
]);

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

class GitCommandError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "GitCommandError";
    this.code = code;
  }
}

class CollectionDeadlineError extends Error {
  constructor(timeoutMs) {
    super(`Collection exceeded the overall ${timeoutMs}ms deadline.`);
    this.name = "CollectionDeadlineError";
    this.code = "deadline";
  }
}

export function createDeadline(timeoutMs, now = () => performance.now()) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError("Deadline must be a positive integer number of milliseconds.");
  }
  const expiresAt = now() + timeoutMs;

  return Object.freeze({
    remainingMs() {
      const remaining = Math.ceil(expiresAt - now());
      if (remaining <= 0) {
        throw new CollectionDeadlineError(timeoutMs);
      }
      return remaining;
    },
  });
}

export function mergeLimits(overrides = {}) {
  for (const name of Object.keys(overrides)) {
    if (!Object.hasOwn(DEFAULT_LIMITS, name)) {
      throw new TypeError(`Unknown collector limit: ${name}.`);
    }
  }

  const limits = { ...DEFAULT_LIMITS, ...overrides };

  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`Limit ${name} must be a positive integer.`);
    }
    if (value > DEFAULT_LIMITS[name]) {
      throw new TypeError(`Limit ${name} cannot exceed ${DEFAULT_LIMITS[name]}.`);
    }
  }

  return limits;
}

function sanitizeErrorText(value, cwd) {
  const compact = String(value).replaceAll("\0", "").trim().slice(0, 1_000);
  if (!compact) {
    return "Git returned no diagnostic output.";
  }

  return cwd ? compact.replaceAll(cwd, "<repo>") : compact;
}

export function createGitEnvironment(environment = process.env) {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name, value]) => !name.toUpperCase().startsWith("GIT_") && value !== undefined,
    ),
  );
}

async function runGit(
  cwd,
  args,
  { timeoutMs, maxBytes = METADATA_MAX_BYTES, allowTruncated = false } = {},
) {
  return await new Promise((resolve, reject) => {
    const child = spawn("git", [...GIT_PREFIX, ...args], {
      cwd,
      env: createGitEnvironment(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let outputTruncated = false;
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs ?? DEFAULT_LIMITS.timeoutMs);

    child.stdout.on("data", (chunk) => {
      if (outputTruncated) {
        return;
      }

      const remaining = maxBytes - stdoutBytes;
      if (chunk.length <= remaining) {
        stdoutChunks.push(chunk);
        stdoutBytes += chunk.length;
        return;
      }

      if (remaining > 0) {
        stdoutChunks.push(chunk.subarray(0, remaining));
        stdoutBytes += remaining;
      }
      outputTruncated = true;
      child.kill("SIGKILL");
    });

    child.stderr.on("data", (chunk) => {
      const remaining = 64 * 1024 - stderrBytes;
      if (remaining <= 0) {
        return;
      }
      const kept = chunk.subarray(0, remaining);
      stderrChunks.push(kept);
      stderrBytes += kept.length;
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(new GitCommandError(`Unable to start Git: ${error.message}`, "spawn"));
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);

      const stdout = Buffer.concat(stdoutChunks);
      const stderr = Buffer.concat(stderrChunks).toString("utf8");

      if (timedOut) {
        reject(
          new GitCommandError(
            `Git command exceeded the ${timeoutMs ?? DEFAULT_LIMITS.timeoutMs}ms limit.`,
            "timeout",
          ),
        );
        return;
      }

      if (outputTruncated && allowTruncated) {
        resolve({ stdout, truncated: true });
        return;
      }

      if (outputTruncated) {
        reject(
          new GitCommandError(
            `Git output exceeded the ${maxBytes}-byte command limit.`,
            "output-limit",
          ),
        );
        return;
      }

      if (code !== 0) {
        reject(
          new GitCommandError(
            `Git command failed: ${sanitizeErrorText(stderr, cwd)}`,
            "git-failed",
          ),
        );
        return;
      }

      resolve({ stdout, truncated: false });
    });
  });
}

function completeNulFields(buffer) {
  const fields = buffer.toString("utf8").split("\0");
  fields.pop();
  return fields;
}

function hasHiddenIndexFlags(buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const end = buffer.indexOf(0, offset);
    if (end < 0 || end - offset < 2 || buffer[offset + 1] !== 0x20) {
      return true;
    }
    const tag = buffer[offset];
    if (tag === 0x53 || (tag >= 0x61 && tag <= 0x7a)) {
      return true;
    }
    offset = end + 1;
  }
  return false;
}

function assertNoHiddenIndexFlags(result) {
  if (result.truncated || hasHiddenIndexFlags(result.stdout)) {
    throw new Error(
      "Hope $hope:diff refuses repositories with skip-worktree or assume-unchanged index flags; clear those flags and retry.",
    );
  }
}

function hasControlCharacters(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 31 || codePoint === 127) {
      return true;
    }
  }
  return false;
}

function isSafeRelativePath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Array.from(value).length > 300 ||
    value.startsWith("/") ||
    value.startsWith("~") ||
    value.includes("\\") ||
    value.includes("\uFFFD") ||
    value.trim() !== value ||
    WINDOWS_DRIVE_PATTERN.test(value) ||
    URL_SCHEME_PATTERN.test(value) ||
    hasControlCharacters(value)
  ) {
    return false;
  }

  return value
    .split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function pathPlaceholder(value) {
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 12);
  return `unsafe-path-${digest}`;
}

export function classifyPath(filePath) {
  if (!isSafeRelativePath(filePath)) {
    return "unsafe-path";
  }

  const lower = filePath.toLowerCase();
  const segments = lower.split("/");
  const basename = segments.at(-1);

  if (
    basename?.startsWith(".env") ||
    basename === ".netrc" ||
    basename === "_netrc" ||
    basename === ".npmrc" ||
    basename === ".pypirc" ||
    basename === "kubeconfig" ||
    basename === "credentials" ||
    basename?.startsWith("credentials.") ||
    basename === "secrets.json" ||
    basename === "secrets.yaml" ||
    basename === "secrets.yml" ||
    /^(?:(?:firebase|gcp|google)[-_])?service[-_]?account(?:[-_](?:credentials|key))?\.json$/iu.test(
      basename ?? "",
    ) ||
    basename === "id_rsa" ||
    basename === "id_ed25519" ||
    /\.(?:key|p12|pem|pfx)$/iu.test(basename ?? "") ||
    segments.includes(".aws") ||
    segments.includes(".ssh") ||
    (segments.includes(".kube") && basename === "config")
  ) {
    return "secret-path";
  }

  if (
    LOCKFILE_NAMES.has(basename ?? "") ||
    segments.some((segment) => GENERATED_SEGMENTS.has(segment)) ||
    /(?:^|[._])generated(?:[._]|$)/iu.test(basename ?? "") ||
    /\.min\.(?:css|js|mjs|cjs)$/iu.test(basename ?? "") ||
    /\.map$/iu.test(basename ?? "")
  ) {
    return "generated-or-lockfile";
  }

  return null;
}

export function classifyGitMode(oldMode, newMode, statusCode = "") {
  if (oldMode === "160000" || newMode === "160000") {
    return "submodule";
  }
  if (oldMode === "120000" || newMode === "120000") {
    return "symlink";
  }
  if (statusCode.startsWith("T")) {
    return "file-type-change";
  }
  return null;
}

function parseNameStatus(buffer) {
  const fields = completeNulFields(buffer);
  const entries = [];

  for (let index = 0; index + 1 < fields.length; index += 2) {
    const statusCode = fields[index];
    const rawPath = fields[index + 1];
    entries.push({ rawPath, statusCode });
  }

  return entries;
}

function parseRawModes(buffer) {
  const fields = completeNulFields(buffer);
  const modes = new Map();

  for (let index = 0; index + 1 < fields.length; index += 2) {
    const header = fields[index];
    const rawPath = fields[index + 1];
    const match = /^:(\d{6}) (\d{6}) [a-f0-9]+ [a-f0-9]+ ([A-Z])/u.exec(header);
    if (match) {
      modes.set(rawPath, {
        oldMode: match[1],
        newMode: match[2],
        statusCode: match[3],
      });
    }
  }

  return modes;
}

function parseNumstat(buffer) {
  const fields = completeNulFields(buffer);
  const stats = new Map();

  for (const field of fields) {
    const match = /^([^\t]+)\t([^\t]+)\t([\s\S]+)$/u.exec(field);
    if (!match) {
      continue;
    }

    const [, additionsText, deletionsText, rawPath] = match;
    if (additionsText === "-" || deletionsText === "-") {
      stats.set(rawPath, { additions: null, deletions: null, binary: true });
      continue;
    }

    stats.set(rawPath, {
      additions: Number.parseInt(additionsText, 10),
      deletions: Number.parseInt(deletionsText, 10),
      binary: false,
    });
  }

  return stats;
}

function statusName(statusCode) {
  return STATUS_NAMES[statusCode.charAt(0)] ?? "unknown";
}

const ASSIGNMENT_PATTERN =
  /(?:^|[\s,{;])(?:(?:(['"])((?:\\.|[^'"\\\r\n])*)\1)|([A-Za-z0-9_./:@-]+))[ \t]*(?::|=(?!=|>))[ \t]*(?:"((?:\\.|[^"\\\r\n])*)"|'((?:\\.|[^'\\\r\n])*)'|`((?:\\.|[^`\\\r\n])*)`|((?:\$\{[^}\r\n]+\}(?=[ \t]*(?:[,;}\]]|\r?$))|\$\{[^}\r\n]+\}[^\r\n,;}]*|(?:\[|<)?[Rr][Ee][Dd][Aa][Cc][Tt][Ee][Dd](?:\]|>)?|[^\r\n,;}]+)))/gmu;

const BRACKETED_ASSIGNMENT_PATTERN =
  /\[[ \t]*(?:"((?:\\.|[^"\\\r\n])*)"|'((?:\\.|[^'\\\r\n])*)'|`((?:\\.|[^`\\\r\n])*)`)[ \t]*\][ \t]*(?::|=(?!=|>))[ \t]*(?:"((?:\\.|[^"\\\r\n])*)"|'((?:\\.|[^'\\\r\n])*)'|`((?:\\.|[^`\\\r\n])*)`|((?:\$\{[^}\r\n]+\}(?=[ \t]*(?:[,;}\]]|\r?$))|\$\{[^}\r\n]+\}[^\r\n,;}]*|(?:\[|<)?[Rr][Ee][Dd][Aa][Cc][Tt][Ee][Dd](?:\]|>)?|[^\r\n,;}]+)))/gmu;

const CONTINUED_ASSIGNMENT_HEAD_PATTERN =
  /(?:^|[\s,{;])(?:(?:(['"])((?:\\.|[^'"\\\r\n])*)\1)|([A-Za-z0-9_./:@-]+))[ \t]*(?::|=(?!=|>))[ \t]*(?:[A-Za-z_$][A-Za-z0-9_$.]*[ \t]*\([ \t]*)?\r?$/u;

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

function isSensitiveAssignmentKey(rawKey) {
  const tokens = assignmentKeyTokens(rawKey);
  if (tokens.length === 0 || SENSITIVE_TERMINAL_KEY_TOKENS.has(tokens.at(-1))) {
    return tokens.length > 0;
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
  return SENSITIVE_KEY_SEQUENCES.some((sequence) =>
    sequence.length <= tokens.length &&
    tokens.some((_, start) =>
      sequence.every((token, offset) => tokens[start + offset] === token),
    ),
  );
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
    const candidates = [
      { index: headIndex + 1, marker: nextLine.charAt(0), body: nextLine.slice(1) },
    ];
    if (nextLine.startsWith("-") && lines[headIndex + 2]?.startsWith("+")) {
      candidates.push({
        index: headIndex + 2,
        marker: "+",
        body: lines[headIndex + 2].slice(1),
      });
    }
    return candidates;
  }
  const body = bodyForMatchingContinuation(nextLine ?? "", marker);
  return body === null ? [] : [{ index: headIndex + 1, marker, body }];
}

function isExplicitSafeAssignmentPlaceholder(value) {
  const normalized = value.trim();
  const lower = normalized.toLowerCase();
  return (
    normalized.length === 0 ||
    /^(?:\[?redacted\]?|<redacted>|placeholder|example|value|changeme|x+|\*+)$/u.test(lower) ||
    /^<[^>]+>$|^\$\{[^}]+\}$/u.test(normalized) ||
    /^(?:your|example)[_-]?[a-z0-9_-]+$/u.test(lower)
  );
}

function isSafeUnquotedAssignmentReference(value) {
  const normalized = value.trim();
  const lower = normalized.toLowerCase();
  return (
    /^(?:null|undefined|none|false)$/u.test(lower) ||
    /^\$[a-z_][a-z0-9_]*$/iu.test(normalized) ||
    /^(?:process\.env|os\.environ|env|config|settings|secrets?)(?:(?:\.|\?\.)[a-z_$][a-z0-9_$.-]*|(?:\?\.)?[ \t]*\[[ \t]*(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|`(?:\\.|[^`\\\r\n])*`)[ \t]*\])+$/iu.test(
      normalized,
    )
  );
}

function isSafeUnquotedAssignmentExpression(value) {
  const normalized = value.trim();
  return (
    /^[a-z_$][a-z0-9_$.]*[ \t]*\([^\r\n"'`]*\)$/iu.test(normalized) ||
    /^[a-z_$][a-z0-9_$.]*[ \t]*\([ \t]*$/iu.test(normalized)
  );
}

function isSafeAssignmentValue(value, quoted) {
  return (
    isExplicitSafeAssignmentPlaceholder(value) ||
    (!quoted &&
      (isSafeUnquotedAssignmentReference(value) || isSafeUnquotedAssignmentExpression(value)))
  );
}

function redactContinuedAssignmentValues(sourceLines) {
  const lines = [...sourceLines];
  let redactions = 0;

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
      const value = continuation[1] ?? continuation[2] ?? continuation[3] ?? "";
      if (isSafeAssignmentValue(value, true)) {
        continue;
      }
      const valueOffset = candidate.body.lastIndexOf(value);
      if (valueOffset < 0) {
        continue;
      }
      const redactedBody =
        `${candidate.body.slice(0, valueOffset)}[REDACTED]` +
        candidate.body.slice(valueOffset + value.length);
      lines[candidate.index] = `${candidate.marker}${redactedBody}`;
      redactions += 1;
    }
  }

  return { lines, redactions };
}

function redactAssignmentValues(line) {
  const diffMarker = /^[+\- ]/u.test(line) ? line.charAt(0) : "";
  const body = diffMarker ? line.slice(1) : line;
  ASSIGNMENT_PATTERN.lastIndex = 0;
  const redactedBody = body.replace(
    ASSIGNMENT_PATTERN,
    (
      match,
      keyQuote,
      quotedKey,
      bareKey,
      doubleValue,
      singleValue,
      backtickValue,
      bareValue,
    ) => {
      const rawKey = quotedKey ?? bareKey ?? "";
      const key = quotedKey === undefined ? rawKey : decodeStaticAssignmentKey(rawKey, keyQuote);
      if (key === null || !isSensitiveAssignmentKey(key)) {
        return match;
      }
      const value = doubleValue ?? singleValue ?? backtickValue ?? bareValue ?? "";
      const quoted =
        doubleValue !== undefined || singleValue !== undefined || backtickValue !== undefined;
      if (isSafeAssignmentValue(value, quoted)) {
        return match;
      }
      const valueOffset = match.lastIndexOf(value);
      return `${match.slice(0, valueOffset)}[REDACTED]${match.slice(valueOffset + value.length)}`;
    },
  );
  BRACKETED_ASSIGNMENT_PATTERN.lastIndex = 0;
  const fullyRedactedBody = redactedBody.replace(
    BRACKETED_ASSIGNMENT_PATTERN,
    (
      match,
      doubleKey,
      singleKey,
      backtickKey,
      doubleValue,
      singleValue,
      backtickValue,
      bareValue,
    ) => {
      const rawKey = doubleKey ?? singleKey ?? backtickKey ?? "";
      const delimiter = doubleKey !== undefined ? '"' : singleKey !== undefined ? "'" : "`";
      const key = decodeStaticAssignmentKey(rawKey, delimiter);
      if (key === null || !isSensitiveAssignmentKey(key)) {
        return match;
      }
      const value = doubleValue ?? singleValue ?? backtickValue ?? bareValue ?? "";
      const quoted =
        doubleValue !== undefined || singleValue !== undefined || backtickValue !== undefined;
      if (isSafeAssignmentValue(value, quoted)) {
        return match;
      }
      const valueOffset = match.lastIndexOf(value);
      return `${match.slice(0, valueOffset)}[REDACTED]${match.slice(valueOffset + value.length)}`;
    },
  );
  return `${diffMarker}${fullyRedactedBody}`;
}

export function redactSensitiveText(value) {
  const continued = redactContinuedAssignmentValues(value.split("\n"));
  const lines = continued.lines;
  const result = [];
  let redactions = continued.redactions;
  let insidePem = false;

  for (const originalLine of lines) {
    const pemBegin = /^([+\- ]?)(-----BEGIN [^-]+-----)/u.exec(originalLine);
    if (pemBegin) {
      insidePem = true;
      redactions += 1;
      result.push(`${pemBegin[1]}[REDACTED_PEM_BLOCK]`);
      if (/-----END [^-]+-----/u.test(originalLine)) {
        insidePem = false;
      }
      continue;
    }

    if (insidePem) {
      if (/^([+\- ]?)(-----END [^-]+-----)/u.test(originalLine)) {
        insidePem = false;
      }
      continue;
    }

    let line = redactAssignmentValues(originalLine);
    if (line !== originalLine) {
      redactions += 1;
    }
    const replacements = [
      [/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]"],
      [
        /\b(?:sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{12,}|(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{20,})\b/gu,
        "[REDACTED_TOKEN]",
      ],
      [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[REDACTED_JWT]"],
      [
        /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/giu,
        "$1[REDACTED]@",
      ],
    ];

    for (const [pattern, replacement] of replacements) {
      const nextLine = line.replace(pattern, replacement);
      if (nextLine !== line) {
        redactions += 1;
        line = nextLine;
      }
    }
    result.push(line);
  }

  return { text: result.join("\n"), redactions };
}

function makeDiffArgs(diffTarget, outputArgs, filePath) {
  const args = [
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--submodule=short",
    "--unified=3",
    "--no-renames",
    ...outputArgs,
    diffTarget,
    "--",
  ];
  if (filePath !== undefined) {
    args.push(filePath);
  }
  return args;
}

async function resolveRepository(root, deadline) {
  const rootStats = await stat(root);
  if (!rootStats.isDirectory()) {
    throw new TypeError("The repository root must be a directory.");
  }

  const requestedRoot = await realpath(root);
  const result = await runGit(requestedRoot, ["rev-parse", "--show-toplevel"], {
    timeoutMs: deadline.remainingMs(),
  });
  const repoRoot = await realpath(result.stdout.toString("utf8").trim());
  const relativeRequest = path.relative(repoRoot, requestedRoot);
  if (
    relativeRequest === ".." ||
    relativeRequest.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeRequest)
  ) {
    throw new GitCommandError(
      "Git resolved a worktree that does not contain the requested root.",
      "worktree-mismatch",
    );
  }
  return repoRoot;
}

async function resolveWorkingTreeScope(repoRoot, deadline) {
  const head = await runGit(repoRoot, ["rev-parse", "--verify", "HEAD^{commit}"], {
    timeoutMs: deadline.remainingMs(),
  });
  return {
    diffTarget: "HEAD",
    baseCommit: head.stdout.toString("utf8").trim(),
    scope: {
      kind: "working-tree",
      comparison: "HEAD -> working tree (staged + unstaged + safe untracked)",
      includeUntrackedBodies: true,
    },
  };
}

function buildTrackedEntry(nameEntry, modes, stats) {
  const rawPath = nameEntry.rawPath;
  const safePath = isSafeRelativePath(rawPath) ? rawPath : pathPlaceholder(rawPath);
  const mode = modes.get(rawPath);
  const fileStats = stats.get(rawPath);
  const pathReason = classifyPath(rawPath);
  const modeReason = classifyGitMode(mode?.oldMode, mode?.newMode, nameEntry.statusCode);
  const binaryReason = fileStats?.binary ? "binary" : null;
  const missingStatReason = fileStats ? null : "missing-numstat";

  return {
    rawPath,
    output: {
      path: safePath,
      status: statusName(nameEntry.statusCode),
      source: "tracked",
      additions: fileStats?.additions ?? null,
      deletions: fileStats?.deletions ?? null,
      bodyIncluded: false,
      ...(pathReason || modeReason || binaryReason || missingStatReason
        ? {
            omissionReason: pathReason ?? modeReason ?? binaryReason ?? missingStatReason,
          }
        : {}),
    },
  };
}

function buildUntrackedEntry(rawPath) {
  const pathReason = classifyPath(rawPath);
  return {
    rawPath,
    output: {
      path: isSafeRelativePath(rawPath) ? rawPath : pathPlaceholder(rawPath),
      status: "untracked",
      source: "untracked",
      additions: null,
      deletions: null,
      bodyIncluded: false,
      ...(pathReason
        ? {
            omissionReason: pathReason,
          }
        : {}),
    },
  };
}

function countChangedLines(additions, deletions) {
  return (additions ?? 0) + (deletions ?? 0);
}

function countTextLines(value) {
  if (value.length === 0) {
    return 0;
  }
  return value.endsWith("\n") ? value.split("\n").length - 1 : value.split("\n").length;
}

function makeUntrackedPatch(filePath, contents, lines) {
  const prefixed = contents
    .split("\n")
    .map((line, index, all) => (index === all.length - 1 && line === "" ? "" : `+${line}`))
    .filter((line, index, all) => line !== "" || index !== all.length - 1)
    .join("\n");
  return [
    `diff --git a/${filePath} b/${filePath}`,
    "new untracked file",
    "--- /dev/null",
    `+++ b/${filePath}`,
    `@@ -0,0 +1,${lines} @@`,
    prefixed,
  ].join("\n");
}

function updateLengthPrefixed(hash, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(length);
  hash.update(bytes);
}

function addRawStabilityFrame(state, kind, filePath, bytes) {
  updateLengthPrefixed(state.rawStabilityHash, kind);
  updateLengthPrefixed(state.rawStabilityHash, filePath);
  updateLengthPrefixed(state.rawStabilityHash, bytes);
}

function exclusion(entry, reason) {
  entry.output.omissionReason = reason;
  return { path: entry.output.path, reason };
}

async function includeTrackedBody(repoRoot, diffTarget, entry, state, limits, deadline) {
  if (entry.output.omissionReason) {
    state.excluded.push({
      path: entry.output.path,
      reason: entry.output.omissionReason,
    });
    return;
  }

  const changedLines = countChangedLines(entry.output.additions, entry.output.deletions);
  if (state.includedChangedLines + changedLines > limits.changedLines) {
    state.complete = false;
    state.excluded.push(exclusion(entry, "changed-line-limit"));
    return;
  }

  const result = await runGit(repoRoot, makeDiffArgs(diffTarget, [], entry.rawPath), {
    timeoutMs: deadline.remainingMs(),
    maxBytes: limits.filePatchBytes + 1,
    allowTruncated: true,
  });
  if (result.truncated || result.stdout.length > limits.filePatchBytes) {
    state.complete = false;
    state.excluded.push(exclusion(entry, "per-file-byte-limit"));
    return;
  }

  addRawStabilityFrame(state, "diff", entry.output.path, result.stdout);
  let patchText;
  try {
    patchText = utf8Decoder.decode(result.stdout);
  } catch {
    state.complete = false;
    state.excluded.push(exclusion(entry, "binary-or-invalid-utf8"));
    return;
  }

  const redacted = redactSensitiveText(patchText);
  const patchBytes = Buffer.byteLength(redacted.text);
  if (state.patchBytes + patchBytes > limits.totalPatchBytes) {
    state.complete = false;
    state.excluded.push(exclusion(entry, "total-byte-limit"));
    return;
  }

  entry.output.bodyIncluded = true;
  state.patchBytes += patchBytes;
  state.includedChangedLines += changedLines;
  state.redactions += redacted.redactions;
  state.patches.push({ path: entry.output.path, kind: "diff", text: redacted.text });
}

export async function readBoundedRegularFile(absolutePath, maxBytes, deadline) {
  deadline.remainingMs();
  let handle;
  let buffer;
  try {
    const pathStats = await lstat(absolutePath);
    deadline.remainingMs();
    if (pathStats.isSymbolicLink()) {
      return { omissionReason: "symlink" };
    }
    if (!pathStats.isFile()) {
      return { omissionReason: "not-a-regular-file" };
    }
    if (pathStats.size > maxBytes) {
      return { omissionReason: "per-file-byte-limit" };
    }

    handle = await open(
      absolutePath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0),
    );
    deadline.remainingMs();
    const fileStats = await handle.stat();
    deadline.remainingMs();
    if (!fileStats.isFile()) {
      return { omissionReason: "not-a-regular-file" };
    }
    if (fileStats.size > maxBytes) {
      return { omissionReason: "per-file-byte-limit" };
    }

    const bounded = Buffer.alloc(maxBytes + 1);
    let offset = 0;
    while (offset < bounded.length) {
      deadline.remainingMs();
      const { bytesRead } = await handle.read(bounded, offset, bounded.length - offset, null);
      deadline.remainingMs();
      if (bytesRead === 0) {
        break;
      }
      offset += bytesRead;
    }
    if (offset > maxBytes) {
      return { omissionReason: "per-file-byte-limit" };
    }
    buffer = bounded.subarray(0, offset);
  } catch (error) {
    if (error?.code === "ELOOP") {
      return { omissionReason: "symlink" };
    }
    throw error;
  } finally {
    await handle?.close();
  }
  deadline.remainingMs();
  return { buffer };
}

async function includeUntrackedBody(repoRoot, entry, state, limits, deadline) {
  deadline.remainingMs();
  if (entry.output.omissionReason) {
    state.excluded.push({
      path: entry.output.path,
      reason: entry.output.omissionReason,
    });
    return;
  }

  const absolutePath = path.join(repoRoot, ...entry.rawPath.split("/"));
  const localFile = await readBoundedRegularFile(absolutePath, limits.filePatchBytes, deadline);
  if (localFile.omissionReason) {
    if (localFile.omissionReason === "per-file-byte-limit") {
      state.complete = false;
    }
    state.excluded.push(exclusion(entry, localFile.omissionReason));
    return;
  }

  let contents;
  try {
    contents = utf8Decoder.decode(localFile.buffer);
  } catch {
    state.excluded.push(exclusion(entry, "binary-or-invalid-utf8"));
    return;
  }
  if (contents.includes("\0")) {
    state.excluded.push(exclusion(entry, "binary"));
    return;
  }

  const lines = countTextLines(contents);
  if (state.includedChangedLines + lines > limits.changedLines) {
    state.complete = false;
    state.excluded.push(exclusion(entry, "changed-line-limit"));
    return;
  }

  const redacted = redactSensitiveText(contents);
  const patchText = makeUntrackedPatch(entry.output.path, redacted.text, lines);
  const patchBytes = Buffer.byteLength(patchText);
  if (state.patchBytes + patchBytes > limits.totalPatchBytes) {
    state.complete = false;
    state.excluded.push(exclusion(entry, "total-byte-limit"));
    return;
  }

  entry.output.additions = lines;
  entry.output.deletions = 0;
  entry.output.bodyIncluded = true;
  addRawStabilityFrame(state, "untracked", entry.output.path, localFile.buffer);
  state.patchBytes += patchBytes;
  state.includedChangedLines += lines;
  state.redactions += redacted.redactions;
  state.patches.push({ path: entry.output.path, kind: "untracked", text: patchText });
}

function makeFingerprint(contextWithoutFingerprint) {
  return createHash("sha256")
    .update(CHANGE_CONTEXT_FINGERPRINT_DOMAIN, "utf8")
    .update(canonicalizeJson(contextWithoutFingerprint), "utf8")
    .digest("hex");
}

async function collectChangeContextOnce({ root, limits, deadline }) {
  const repoRoot = await resolveRepository(root, deadline);
  const resolvedScope = await resolveWorkingTreeScope(repoRoot, deadline);

  const metadataCommands = [
    makeDiffArgs(resolvedScope.diffTarget, ["--name-status", "-z"]),
    makeDiffArgs(resolvedScope.diffTarget, ["--raw", "-z"]),
    makeDiffArgs(resolvedScope.diffTarget, ["--numstat", "-z"]),
    ["ls-files", "--others", "--exclude-standard", "-z"],
    ["ls-files", "--unmerged", "-z"],
    ["ls-files", "-v", "-z"],
  ];

  const metadataResults = await Promise.all(
    metadataCommands.map(
      async (args) =>
        await runGit(repoRoot, args, {
          timeoutMs: deadline.remainingMs(),
          maxBytes: METADATA_MAX_BYTES,
          allowTruncated: true,
        }),
    ),
  );
  const [
    nameStatusResult,
    rawResult,
    numstatResult,
    untrackedResult,
    unmergedResult,
    indexFlagsResult,
  ] = metadataResults;

  assertNoHiddenIndexFlags(indexFlagsResult);
  const finalIndexFlagsResult = await runGit(repoRoot, ["ls-files", "-v", "-z"], {
    timeoutMs: deadline.remainingMs(),
    maxBytes: METADATA_MAX_BYTES,
    allowTruncated: true,
  });
  assertNoHiddenIndexFlags(finalIndexFlagsResult);

  const nameStatusEntries = parseNameStatus(nameStatusResult.stdout);
  if (
    unmergedResult.truncated ||
    unmergedResult.stdout.length > 0 ||
    nameStatusEntries.some((entry) => entry.statusCode.includes("U"))
  ) {
    throw new Error("Unresolved index entries found; resolve conflicts before collecting changes.");
  }

  const state = {
    complete: true,
    excluded: [],
    includedChangedLines: 0,
    patchBytes: 0,
    patches: [],
    rawStabilityHash: createHash("sha256").update(RAW_STABILITY_FINGERPRINT_DOMAIN, "utf8"),
    redactions: 0,
    warnings: [],
  };
  if (metadataResults.some((result) => result.truncated)) {
    state.complete = false;
    state.warnings.push(
      "Git metadata exceeded the collector command limit; some paths may be absent.",
    );
  }

  const modes = parseRawModes(rawResult.stdout);
  const stats = parseNumstat(numstatResult.stdout);
  const tracked = nameStatusEntries.map((entry) => buildTrackedEntry(entry, modes, stats));
  const untracked = untrackedResult
    ? completeNulFields(untrackedResult.stdout).map((rawPath) => buildUntrackedEntry(rawPath))
    : [];
  const discovered = [...tracked, ...untracked].sort((left, right) =>
    left.output.path.localeCompare(right.output.path, "en"),
  );
  if (discovered.length === 0) {
    throw new Error("No local changes found between HEAD and the working tree.");
  }

  let selected = discovered;
  if (discovered.length > limits.maxFiles) {
    selected = discovered.slice(0, limits.maxFiles);
    state.complete = false;
    state.excluded.push({
      path: "additional-files-not-enumerated",
      reason: `file-count-limit:${discovered.length - limits.maxFiles}`,
    });
    state.warnings.push(
      `${discovered.length - limits.maxFiles} file(s) were omitted by the ${limits.maxFiles}-file limit.`,
    );
  }

  for (const entry of selected) {
    deadline.remainingMs();
    if (entry.output.source === "tracked") {
      await includeTrackedBody(repoRoot, resolvedScope.diffTarget, entry, state, limits, deadline);
    } else {
      await includeUntrackedBody(repoRoot, entry, state, limits, deadline);
    }
    deadline.remainingMs();
  }

  const postBodyIndexFlagsResult = await runGit(repoRoot, ["ls-files", "-v", "-z"], {
    timeoutMs: deadline.remainingMs(),
    maxBytes: METADATA_MAX_BYTES,
    allowTruncated: true,
  });
  assertNoHiddenIndexFlags(postBodyIndexFlagsResult);

  if (state.patches.length === 0) {
    const reasons = [...new Set(state.excluded.map((item) => item.reason))].sort().join(", ");
    throw new Error(
      `No explainable text changes were collected${reasons ? ` (${reasons})` : ""}.`,
    );
  }

  const reportedOmissions = state.excluded;
  if (reportedOmissions.length > 0) {
    state.complete = false;
    const reasons = [...new Set(reportedOmissions.map((item) => item.reason))].sort().join(", ");
    state.warnings.push(
      `${reportedOmissions.length} file body/bodies were excluded by safety or size policy (${reasons}).`,
    );
  }
  if (state.redactions > 0) {
    state.complete = false;
    state.warnings.push(
      `${state.redactions} suspected secret value(s) were redacted from collected text.`,
    );
  }

  const files = selected.map((entry) => entry.output);
  const summary = {
    discoveredFiles: discovered.length,
    representedFiles: files.length,
    includedBodies: files.filter((file) => file.bodyIncluded).length,
    omittedBodies: files.filter((file) => !file.bodyIncluded).length,
    additions: files.reduce((total, file) => total + (file.additions ?? 0), 0),
    deletions: files.reduce((total, file) => total + (file.deletions ?? 0), 0),
    changedLines: state.includedChangedLines,
    contextBytes: state.patchBytes,
  };
  const contextWithoutFingerprint = {
    schemaVersion: 2,
    baseCommit: resolvedScope.baseCommit,
    scope: resolvedScope.scope,
    complete: state.complete,
    summary,
    files,
    patches: state.patches,
    excluded: state.excluded,
    warnings: state.warnings,
  };
  deadline.remainingMs();

  const context = {
    ...contextWithoutFingerprint,
    fingerprint: makeFingerprint(contextWithoutFingerprint),
  };
  return {
    context,
    rawStabilityFingerprint: state.rawStabilityHash.digest("hex"),
  };
}

export function assertStableCollectionPair(first, second) {
  if (
    first?.context?.baseCommit !== second?.context?.baseCommit ||
    first?.context?.fingerprint !== second?.context?.fingerprint ||
    first?.rawStabilityFingerprint !== second?.rawStabilityFingerprint
  ) {
    throw new Error("Working tree changed during collection; retry after changes stop.");
  }
  return second.context;
}

export async function collectChangeContext({
  root = process.cwd(),
  limits: limitOverrides,
} = {}) {
  const limits = mergeLimits(limitOverrides);
  const deadline = createDeadline(limits.timeoutMs);
  const first = await collectChangeContextOnce({ root, limits, deadline });
  const second = await collectChangeContextOnce({ root, limits, deadline });
  return assertStableCollectionPair(first, second);
}

async function pathExists(targetPath) {
  try {
    await lstat(targetPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function writeContextFile(context, output) {
  const contents = `${JSON.stringify(context, null, 2)}\n`;
  let directory;
  let outputPath;

  if (output) {
    outputPath = path.resolve(output);
    if (await pathExists(outputPath)) {
      throw new Error("Refusing to overwrite an existing output path.");
    }
    directory = path.dirname(outputPath);
  } else {
    directory = await mkdtemp(path.join(tmpdir(), "hope-"));
    await chmod(directory, 0o700);
    outputPath = path.join(directory, "change-context.json");
  }

  let handle;
  try {
    handle = await open(outputPath, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.chmod(0o600);
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => {});
      handle = undefined;
      await unlink(outputPath).catch(() => {});
    }
    throw error;
  } finally {
    if (handle) {
      await handle.close();
    }
  }

  return outputPath;
}

export function parseArguments(argv) {
  const options = { root: process.cwd() };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root" || argument === "--output") {
      const value = argv[index + 1];
      if (!value) {
        throw new TypeError(`${argument} requires a value.`);
      }
      const key = argument.slice(2);
      options[key] = value;
      index += 1;
      continue;
    }
    if (argument === "--help") {
      options.help = true;
      continue;
    }
    throw new TypeError(`Unknown argument: ${argument}`);
  }

  return options;
}

function helpText() {
  return [
    "Collect a bounded, redacted Git ChangeContextV2 file.",
    "",
    "Usage:",
    "  node collect-change-context.mjs [--root <repo>] [--output <new-file>]",
    "",
    "Collects HEAD -> working tree, including safe untracked file bodies.",
    "Without --output, a mode-0700 temporary directory is created.",
  ].join("\n");
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return;
  }

  const context = await collectChangeContext(options);
  const outputPath = await writeContextFile(context, options.output);
  console.log(`ChangeContextV2 written to ${outputPath}`);
}

const isEntrypoint = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isEntrypoint) {
  main().catch((error) => {
    console.error(`collect-change-context: ${error.message}`);
    process.exitCode = 1;
  });
}
