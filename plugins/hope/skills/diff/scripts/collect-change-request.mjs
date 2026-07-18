#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import console from "node:console";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { chmod, lstat, mkdtemp, open, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";

import { canonicalizeJson, collectSecretIssues } from "./lib/safety.mjs";

const FINGERPRINT_DOMAIN = "hope:change-request:v1\0";
const SNAPSHOT_FINGERPRINT_DOMAIN = "hope:change-request-snapshot:v1\0";
const ANALYSIS_PASS_FINGERPRINT_DOMAIN = "hope:analysis-pass:v1\0";
const GH_OUTPUT_MAX_BYTES = 16 * 1024 * 1024;
const SHA_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/u;
const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:/u;
const URL_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/u;
const MAX_ANALYSIS_PASSES = 999;

export const DEFAULT_LIMITS = Object.freeze({
  maxFiles: 200,
  passChangedLines: 4_000,
  totalChangedLines: 20_000,
  passPatchBytes: 64 * 1024,
  filePatchBytes: 256 * 1024,
  totalPatchBytes: 768 * 1024,
  summaryBytes: 128 * 1024,
  descriptionBytes: 32 * 1024,
  timeoutMs: 30_000,
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

const OUTPUT_KEYS = Object.freeze([
  "schemaVersion",
  "provider",
  "host",
  "repository",
  "id",
  "url",
  "title",
  "description",
  "author",
  "state",
  "reviewStage",
  "isDraft",
  "baseSha",
  "headSha",
  "mergeBaseSha",
  "comparison",
  "snapshotFingerprint",
  "commitCount",
  "commits",
  "files",
  "patches",
  "analysisPlan",
  "coverage",
  "exclusions",
  "warnings",
  "fingerprint",
]);

export class SnapshotChangedError extends Error {
  constructor() {
    super("The change request changed during collection; retry against the current PR snapshot.");
    this.name = "SnapshotChangedError";
    this.code = "stale";
  }
}

export class GhApiError extends Error {
  constructor(message, code = "transport") {
    super(message);
    this.name = "GhApiError";
    this.code = code;
  }
}

class CollectionError extends Error {
  constructor(message, code = "collection") {
    super(message);
    this.name = "CollectionError";
    this.code = code;
  }
}

function hasDisallowedControl(value) {
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

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCommitSha(value) {
  return typeof value === "string" && SHA_PATTERN.test(value);
}

function isSafeRelativePath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Array.from(value).length > 300 ||
    value.startsWith("/") ||
    value.startsWith("~") ||
    value.includes("\\") ||
    value.trim() !== value ||
    WINDOWS_DRIVE_PATTERN.test(value) ||
    URL_SCHEME_PATTERN.test(value) ||
    hasDisallowedControl(value)
  ) {
    return false;
  }
  return value
    .split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function pathPlaceholder(value) {
  return `unsafe-path-${createHash("sha256").update(String(value)).digest("hex").slice(0, 12)}`;
}

function safePath(value) {
  return isSafeRelativePath(value) ? value : pathPlaceholder(value);
}

function compareCanonicalText(left, right) {
  const leftText = String(left);
  const rightText = String(right);
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
}

function classifyPath(filePath) {
  if (!isSafeRelativePath(filePath)) {
    return "unsafe-path";
  }
  const lower = filePath.toLowerCase();
  const segments = lower.split("/");
  const basename = segments.at(-1) ?? "";
  if (
    basename.startsWith(".env") ||
    [".netrc", "_netrc", ".npmrc", ".pypirc", "kubeconfig", "credentials"].includes(
      basename,
    ) ||
    basename.startsWith("credentials.") ||
    ["secrets.json", "secrets.yaml", "secrets.yml", "id_rsa", "id_ed25519"].includes(
      basename,
    ) ||
    /^(?:(?:firebase|gcp|google)[-_])?service[-_]?account(?:[-_](?:credentials|key))?\.json$/iu.test(
      basename,
    ) ||
    /\.(?:key|p12|pem|pfx)$/iu.test(basename) ||
    segments.includes(".aws") ||
    segments.includes(".ssh") ||
    (segments.includes(".kube") && basename === "config")
  ) {
    return "secret-path";
  }
  if (
    LOCKFILE_NAMES.has(basename) ||
    segments.some((segment) => GENERATED_SEGMENTS.has(segment)) ||
    /(?:^|[._])generated(?:[._]|$)/iu.test(basename) ||
    /\.min\.(?:css|js|mjs|cjs)$/iu.test(basename) ||
    /\.map$/iu.test(basename)
  ) {
    return "generated-or-lockfile";
  }
  return null;
}

function unescapedDelimiterIndex(value, delimiter, startIndex = 0) {
  let escaped = false;
  for (let index = startIndex; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === delimiter) return index;
  }
  return -1;
}

function sensitiveMultilineDelimiter(value) {
  const match =
    /(?:api[_-]?key|secret(?:[_-]?access)?[_-]?key|private[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|refresh[_-]?token|password|passwd|pwd|secret|token)["'`\]]*\s*(?::|=(?!=|>))\s*(["'`])/iu
      .exec(value);
  if (!match) return null;
  const delimiter = match[1];
  const openerIndex = match.index + match[0].lastIndexOf(delimiter);
  return unescapedDelimiterIndex(value, delimiter, openerIndex + 1) === -1
    ? delimiter
    : null;
}

function redactSensitiveText(value) {
  const lines = String(value).split("\n");
  const output = [];
  let redactions = 0;
  let insidePem = false;
  let sensitiveDelimiter = null;
  for (const originalLine of lines) {
    if (sensitiveDelimiter !== null) {
      const prefix = /^[+\- ]/u.test(originalLine) ? originalLine[0] : "";
      output.push(`${prefix}[REDACTED_SENSITIVE_BLOCK]`);
      redactions += 1;
      if (unescapedDelimiterIndex(originalLine, sensitiveDelimiter) !== -1) {
        sensitiveDelimiter = null;
      }
      continue;
    }
    const marker = /^([+\- ]?)(-----BEGIN [^-]+-----)/u.exec(originalLine);
    if (marker) {
      insidePem = true;
      redactions += 1;
      output.push(`${marker[1]}[REDACTED_PEM_BLOCK]`);
      if (/-----END [^-]+-----/u.test(originalLine)) {
        insidePem = false;
      }
      continue;
    }
    if (insidePem) {
      const prefix = /^[+\- ]/u.test(originalLine) ? originalLine[0] : "";
      output.push(`${prefix}[REDACTED_PEM_BLOCK]`);
      redactions += 1;
      if (/-----END [^-]+-----/u.test(originalLine)) {
        insidePem = false;
      }
      continue;
    }

    const embeddedPemMatch =
      /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----|-----BEGIN PGP PRIVATE KEY BLOCK-----/u
        .exec(originalLine);
    if (embeddedPemMatch) {
      const prefix = /^[+\- ]/u.test(originalLine) ? originalLine[0] : "";
      const before = originalLine.slice(0, embeddedPemMatch.index).trimEnd();
      const remainder = originalLine.slice(embeddedPemMatch.index + embeddedPemMatch[0].length);
      const trimmedRemainder = remainder.trim();
      const isRegexLiteral =
        before.endsWith("/") && /^\/[dgimsuvy]*[;,)\]]?$/u.test(trimmedRemainder);
      const isClosedMarkerLiteral =
        !/[+]/u.test(trimmedRemainder) &&
        !/\\[rn]/u.test(trimmedRemainder) &&
        /^(?:["'`])[;,)\]]?$/u.test(trimmedRemainder);
      const beginsMultilineBlock =
        !isRegexLiteral &&
        !isClosedMarkerLiteral &&
        !/-----END [^-]+-----/u.test(originalLine);
      output.push(
        `${prefix}${beginsMultilineBlock ? "[REDACTED_PEM_BLOCK]" : "[REDACTED_PEM_HEADER]"}`,
      );
      redactions += 1;
      insidePem = beginsMultilineBlock;
      continue;
    }
    const multilineDelimiter = sensitiveMultilineDelimiter(originalLine);
    if (multilineDelimiter !== null) {
      const prefix = /^[+\- ]/u.test(originalLine) ? originalLine[0] : "";
      output.push(`${prefix}[REDACTED_SENSITIVE_BLOCK]`);
      redactions += 1;
      sensitiveDelimiter = multilineDelimiter;
      continue;
    }
    let line = originalLine;
    const replacements = [
      [
        /((?:api[_-]?key|secret(?:[_-]?access)?[_-]?key|private[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|refresh[_-]?token|password|passwd|pwd|secret|token)["'`\]]*\s*(?::|=(?!=|>))\s*)(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|`(?:\\.|[^`\\\r\n])*`|[^\s,;}]+)/giu,
        "$1[REDACTED]",
      ],
      [/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]"],
      [
        /\b(?:sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{12,}|(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{20,})\b/gu,
        "[REDACTED_TOKEN]",
      ],
      [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[REDACTED_JWT]"],
      [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/giu, "$1[REDACTED]@"],
    ];
    for (const [pattern, replacement] of replacements) {
      const next = line.replace(pattern, replacement);
      if (next !== line) {
        redactions += 1;
        line = next;
      }
    }
    const inspectedLine = /^[+\- ]/u.test(line) ? line.slice(1) : line;
    if (collectSecretIssues(inspectedLine).length > 0) {
      const prefix = /^[+\- ]/u.test(line) ? line[0] : "";
      line = `${prefix}[REDACTED_SENSITIVE_LINE]`;
      redactions += 1;
    }
    output.push(line);
  }
  return { text: output.join("\n"), redactions };
}

function redactSensitiveMetadata(value) {
  const detected = redactSensitiveText(value);
  if (detected.redactions === 0) return detected;
  const safePrefix = [];
  for (const line of String(value).split("\n")) {
    if (redactSensitiveText(line).redactions > 0) break;
    safePrefix.push(line);
  }
  const prefix = safePrefix.join("\n").trimEnd();
  return {
    text: prefix.length > 0
      ? `${prefix}\n[REDACTED_SENSITIVE_TEXT]`
      : "[REDACTED_SENSITIVE_TEXT]",
    redactions: detected.redactions,
  };
}

function createDeadline(timeoutMs) {
  const expiresAt = performance.now() + timeoutMs;
  return Object.freeze({
    remainingMs() {
      const remaining = Math.ceil(expiresAt - performance.now());
      if (remaining <= 0) {
        throw new CollectionError(`Collection exceeded the ${timeoutMs}ms deadline.`, "deadline");
      }
      return remaining;
    },
  });
}

function mergeLimits(overrides = {}) {
  for (const key of Object.keys(overrides)) {
    if (!Object.hasOwn(DEFAULT_LIMITS, key)) {
      throw new TypeError(`Unknown collector limit: ${key}.`);
    }
  }
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`Limit ${key} must be a positive integer.`);
    }
    if (value > DEFAULT_LIMITS[key]) {
      throw new TypeError(`Limit ${key} cannot exceed ${DEFAULT_LIMITS[key]}.`);
    }
  }
  if (limits.filePatchBytes > limits.totalPatchBytes) {
    throw new TypeError("Limit filePatchBytes cannot exceed totalPatchBytes.");
  }
  if (limits.passPatchBytes > limits.totalPatchBytes) {
    throw new TypeError("Limit passPatchBytes cannot exceed totalPatchBytes.");
  }
  if (limits.passChangedLines > limits.totalChangedLines) {
    throw new TypeError("Limit passChangedLines cannot exceed totalChangedLines.");
  }
  return limits;
}

export function createGhEnvironment(environment = process.env) {
  const blocked = new Set([
    "GH_HOST",
    "GH_REPO",
    "GH_HTTP_UNIX_SOCKET",
    "GH_DEBUG",
    "GH_FORCE_TTY",
  ]);
  const sanitized = Object.fromEntries(
    Object.entries(environment).filter(
      ([name, value]) => value !== undefined && !blocked.has(name.toUpperCase()),
    ),
  );
  return {
    ...sanitized,
    GH_PROMPT_DISABLED: "1",
    GH_PAGER: "cat",
    PAGER: "cat",
    NO_COLOR: "1",
  };
}

export function normalizePullRequestUrl(input) {
  if (typeof input !== "string" || input.length === 0 || input.trim() !== input) {
    throw new TypeError("A GitHub pull request HTTPS URL is required.");
  }
  if (/%(?:2e|2f|5c)/iu.test(input)) {
    throw new TypeError("Encoded path separators and dot segments are not supported.");
  }
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new TypeError("The pull request URL is not valid.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname.toLowerCase() !== "github.com" ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new TypeError("Only https://github.com pull request URLs are supported.");
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length !== 4 || segments[2] !== "pull") {
    throw new TypeError("Expected a GitHub URL shaped like owner/repository/pull/number.");
  }
  const [owner, repository, , rawId] = segments;
  if (
    !OWNER_PATTERN.test(owner) ||
    !REPOSITORY_PATTERN.test(repository) ||
    !/^[1-9][0-9]*$/u.test(rawId)
  ) {
    throw new TypeError("The GitHub owner, repository, or pull request number is invalid.");
  }
  const id = String(Number.parseInt(rawId, 10));
  if (!Number.isSafeInteger(Number(rawId)) || id !== rawId) {
    throw new TypeError("The pull request number must be a canonical positive integer.");
  }
  return Object.freeze({
    provider: "github",
    host: "github.com",
    owner,
    repositoryName: repository,
    repository: `${owner}/${repository}`,
    id,
    url: `https://github.com/${owner}/${repository}/pull/${id}`,
  });
}

async function defaultGhRunner({ endpoint, paginate = false, slurp = false, deadline }) {
  const args = [
    "api",
    "--hostname",
    "github.com",
    "--method",
    "GET",
    "-H",
    "Accept: application/vnd.github+json",
  ];
  if (paginate) {
    args.push("--paginate");
  }
  if (slurp) {
    args.push("--slurp");
  }
  args.push(endpoint);
  return await new Promise((resolve, reject) => {
    const child = spawn("gh", args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: createGhEnvironment(),
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let exceeded = false;
    let timedOut = false;
    const timeoutMs = deadline.remainingMs();
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > GH_OUTPUT_MAX_BYTES) {
        exceeded = true;
        child.kill("SIGKILL");
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (stderrBytes < 64 * 1024) {
        const kept = chunk.subarray(0, 64 * 1024 - stderrBytes);
        stderr.push(kept);
        stderrBytes += kept.length;
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new GhApiError(`Unable to start GitHub CLI: ${error.message}`, "spawn"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new GhApiError("GitHub API request exceeded the collection deadline.", "timeout"));
        return;
      }
      if (exceeded) {
        reject(new GhApiError("GitHub API response exceeded the bounded output limit.", "output-limit"));
        return;
      }
      if (code !== 0) {
        const diagnostic = redactSensitiveMetadata(Buffer.concat(stderr).toString("utf8"))
          .text.replaceAll("\0", "")
          .trim()
          .slice(0, 500);
        reject(
          new GhApiError(
            diagnostic ? `GitHub API request failed: ${diagnostic}` : "GitHub API request failed.",
            "gh-api",
          ),
        );
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(stdout).toString("utf8")));
      } catch {
        reject(new GhApiError("GitHub API returned invalid JSON.", "invalid-response"));
      }
    });
  });
}

async function callRunner(runner, request) {
  const value = await runner(request);
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      throw new GhApiError("GitHub adapter returned invalid JSON.", "invalid-response");
    }
  }
  return value;
}

function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new GhApiError(`GitHub response field ${label} is invalid.`, "invalid-response");
  }
  return value;
}

function normalizeMetadata(locator, pull) {
  if (!isRecord(pull)) {
    throw new GhApiError("GitHub pull request metadata is not an object.", "invalid-response");
  }
  if (integer(pull.number, "number") !== Number(locator.id)) {
    throw new GhApiError("GitHub returned a different pull request number.", "invalid-response");
  }
  if (pull.html_url !== undefined) {
    const returned = normalizePullRequestUrl(pull.html_url);
    if (
      returned.repository.toLowerCase() !== locator.repository.toLowerCase() ||
      returned.id !== locator.id
    ) {
      throw new GhApiError("GitHub returned a different pull request URL.", "invalid-response");
    }
  }
  if (
    typeof pull.title !== "string" ||
    pull.title.trim().length === 0 ||
    hasDisallowedControl(pull.title) ||
    (pull.body !== null && pull.body !== undefined && typeof pull.body !== "string") ||
    typeof pull.user?.login !== "string" ||
    pull.user.login.length === 0 ||
    typeof pull.updated_at !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(pull.updated_at) ||
    hasDisallowedControl(pull.user.login) ||
    !["open", "closed"].includes(pull.state) ||
    typeof pull.draft !== "boolean" ||
    !isCommitSha(pull.base?.sha) ||
    !isCommitSha(pull.head?.sha)
  ) {
    throw new GhApiError("GitHub pull request metadata is malformed.", "invalid-response");
  }
  const commitCount = integer(pull.commits, "commits");
  const changedFiles = integer(pull.changed_files, "changed_files");
  if (commitCount < 1) {
    throw new GhApiError("GitHub pull request has no commits to explain.", "invalid-response");
  }
  const state = pull.merged_at ? "merged" : pull.state;
  const reviewStage =
    state === "merged"
      ? "historical"
      : state === "closed"
        ? "abandoned"
        : pull.draft
          ? "draft"
          : "ready";
  const snapshot = {
    repository: locator.repository,
    id: locator.id,
    url: locator.url,
    title: pull.title,
    description: pull.body ?? "",
    author: pull.user.login,
    state,
    reviewStage,
    isDraft: pull.draft,
    baseSha: pull.base.sha,
    headSha: pull.head.sha,
    commitCount,
    changedFiles,
  };
  const safeFingerprintSnapshot = {
    ...snapshot,
    metadataUpdatedAt: pull.updated_at,
    title: redactSensitiveMetadata(snapshot.title).text,
    description: redactSensitiveMetadata(
      truncateUtf8(snapshot.description, DEFAULT_LIMITS.descriptionBytes).text,
    ).text,
  };
  return Object.freeze({
    ...snapshot,
    snapshotFingerprint: createHash("sha256")
      .update(SNAPSHOT_FINGERPRINT_DOMAIN, "utf8")
      .update(canonicalizeJson(safeFingerprintSnapshot), "utf8")
      .digest("hex"),
  });
}

export async function readCurrentSnapshot({
  url,
  runner = defaultGhRunner,
  deadline,
  limits,
} = {}) {
  const locator = normalizePullRequestUrl(url);
  const resolvedLimits = limits ? mergeLimits(limits) : DEFAULT_LIMITS;
  const activeDeadline = deadline ?? createDeadline(resolvedLimits.timeoutMs);
  const endpoint = `repos/${locator.owner}/${locator.repositoryName}/pulls/${locator.id}`;
  const pull = await callRunner(runner, { endpoint, deadline: activeDeadline });
  return normalizeMetadata(locator, pull);
}

export function assertSameSnapshot(first, second) {
  if (
    typeof first?.snapshotFingerprint === "string" &&
    typeof second?.snapshotFingerprint === "string" &&
    first.snapshotFingerprint !== second.snapshotFingerprint
  ) {
    throw new SnapshotChangedError();
  }
  const bothMetadataOnly =
    Object.hasOwn(first ?? {}, "changedFiles") && Object.hasOwn(second ?? {}, "changedFiles");
  const project = (value) => ({
    repository: value?.repository,
    id: value?.id,
    url: value?.url,
    title: bothMetadataOnly
      ? value?.title
      : redactSensitiveMetadata(value?.title ?? "").text,
    description: bothMetadataOnly
      ? value?.description
      : redactSensitiveMetadata(
          truncateUtf8(value?.description ?? "", DEFAULT_LIMITS.descriptionBytes).text,
        ).text,
    author: value?.author,
    state: value?.state,
    reviewStage: value?.reviewStage,
    isDraft: value?.isDraft,
    baseSha: value?.baseSha,
    headSha: value?.headSha,
    commitCount: value?.commitCount,
    changedFiles: value?.changedFiles ?? value?.coverage?.discoveredFiles,
  });
  if (canonicalizeJson(project(first)) !== canonicalizeJson(project(second))) {
    throw new SnapshotChangedError();
  }
  return second;
}

function truncateUtf8(value, maximumBytes) {
  let bytes = 0;
  let text = "";
  for (const character of String(value)) {
    const characterBytes = Buffer.byteLength(character);
    if (bytes + characterBytes > maximumBytes) {
      return { text, truncated: true, bytes };
    }
    text += character;
    bytes += characterBytes;
  }
  return { text, truncated: false, bytes };
}

function flattenPages(value, label) {
  if (!Array.isArray(value)) {
    throw new GhApiError(`${label} response must be an array.`, "invalid-response");
  }
  if (value.length > 0 && value.every((page) => Array.isArray(page))) {
    return value.flat();
  }
  if (value.some((entry) => Array.isArray(entry))) {
    throw new GhApiError(`${label} response has inconsistent pagination.`, "invalid-response");
  }
  return value;
}

function firstLine(value) {
  return String(value).split(/\r?\n/u, 1)[0];
}

function normalizeCommit(commit, index, tracker) {
  if (!isRecord(commit) || !isCommitSha(commit.sha) || typeof commit.commit?.message !== "string") {
    throw new GhApiError(`GitHub commit ${index + 1} is malformed.`, "invalid-response");
  }
  let title = firstLine(commit.commit.message);
  if (title.trim().length === 0) {
    title = "Untitled commit";
  }
  if (Array.from(title).length > 4_000) {
    title = Array.from(title).slice(0, 4_000).join("");
    tracker.block("commit-metadata", "commit-title-size-limit");
  }
  const redacted = redactSensitiveMetadata(title);
  if (redacted.redactions > 0) {
    tracker.partial("commit-metadata", "suspected-secret-redacted");
  }
  const author = commit.author?.login;
  if (author !== undefined && author !== null && (typeof author !== "string" || author.length === 0)) {
    throw new GhApiError(`GitHub commit ${index + 1} author is malformed.`, "invalid-response");
  }
  return {
    sha: commit.sha,
    title: redacted.text,
    author: author ?? null,
  };
}

function normalizeFileStatus(value) {
  const statuses = {
    added: "added",
    modified: "modified",
    removed: "deleted",
    renamed: "renamed",
    copied: "copied",
    changed: "type-changed",
  };
  const status = statuses[value];
  if (!status) {
    throw new GhApiError(`GitHub file status ${String(value)} is unsupported.`, "invalid-response");
  }
  return status;
}

function countPatchChanges(patch) {
  let additions = 0;
  let deletions = 0;
  let inHunk = false;
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk || line === "\\ No newline at end of file") {
      continue;
    }
    if (line.startsWith("+")) {
      additions += 1;
    } else if (line.startsWith("-")) {
      deletions += 1;
    }
  }
  return { additions, deletions };
}

function isSubmodulePatch(patch) {
  const changed = patch
    .split("\n")
    .filter((line) => /^[+-](?![+-])/u.test(line))
    .map((line) => line.slice(1));
  return (
    changed.length > 0 &&
    changed.every((line) => /^Subproject commit [a-f0-9]{40}(?:-dirty)?$/u.test(line))
  );
}

function makeTracker() {
  const exclusions = [];
  const seen = new Set();
  let blocked = false;
  let partial = false;
  function add(pathValue, reason, isBlocking) {
    const key = `${pathValue}\0${reason}`;
    if (!seen.has(key)) {
      seen.add(key);
      exclusions.push({ path: pathValue, reason });
    }
    if (isBlocking) {
      blocked = true;
    } else {
      partial = true;
    }
  }
  return {
    exclusions,
    block(pathValue, reason) {
      add(pathValue, reason, true);
    },
    partial(pathValue, reason) {
      add(pathValue, reason, false);
    },
    status() {
      return blocked ? "blocked" : partial ? "partial" : "complete";
    },
  };
}

function completeUtf8Lines(value) {
  const lines = [];
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "\n") {
      lines.push(value.slice(start, index + 1));
      start = index + 1;
    }
  }
  if (start < value.length) {
    lines.push(value.slice(start));
  }
  return lines;
}

function annotatedPatchLines(value) {
  let inHunk = false;
  return completeUtf8Lines(value).map((text, index) => {
    const line = text.endsWith("\n") ? text.slice(0, -1).replace(/\r$/u, "") : text;
    if (line.startsWith("@@")) {
      inHunk = true;
    }
    const isMarker = line === "\\ No newline at end of file";
    const additions = inHunk && !isMarker && line.startsWith("+") ? 1 : 0;
    const deletions = inHunk && !isMarker && line.startsWith("-") ? 1 : 0;
    return {
      lineNumber: index + 1,
      text,
      bytes: Buffer.byteLength(text),
      additions,
      deletions,
    };
  });
}

function normalizeFile(file, state) {
  if (!isRecord(file) || typeof file.filename !== "string") {
    throw new GhApiError("GitHub changed-file metadata is malformed.", "invalid-response");
  }
  const rawPath = file.filename;
  const outputPath = safePath(rawPath);
  const status = normalizeFileStatus(file.status);
  const additions = integer(file.additions, `${outputPath}.additions`);
  const deletions = integer(file.deletions, `${outputPath}.deletions`);
  const previousRawPath =
    status === "renamed" || status === "copied"
      ? typeof file.previous_filename === "string"
        ? file.previous_filename
        : null
      : null;
  const previousPath =
    previousRawPath === null ? null : safePath(previousRawPath);
  if ((status === "renamed" || status === "copied") && previousPath === null) {
    throw new GhApiError(`GitHub ${status} file is missing previous_filename.`, "invalid-response");
  }
  const output = { path: outputPath, previousPath, status, additions, deletions, bodyState: "included" };
  const classifiedPaths = [
    { path: outputPath, classification: classifyPath(rawPath) },
    ...(previousRawPath === null
      ? []
      : [{ path: previousPath, classification: classifyPath(previousRawPath) }]),
  ];
  const unsafePath = classifiedPaths.find((entry) => entry.classification === "unsafe-path");
  if (unsafePath) {
    output.bodyState = "missing-patch";
    state.tracker.block(unsafePath.path, "unsafe-path");
    return output;
  }
  const secretPath = classifiedPaths.find((entry) => entry.classification === "secret-path");
  if (secretPath) {
    output.bodyState = "secret-path";
    state.tracker.partial(secretPath.path, "secret-path");
    return output;
  }
  if (classifyPath(rawPath) === "generated-or-lockfile") {
    output.bodyState = "generated-or-lockfile";
    state.tracker.partial(outputPath, "generated-or-lockfile");
    return output;
  }
  if (typeof file.patch !== "string") {
    if (["renamed", "copied", "type-changed"].includes(status) && additions === 0 && deletions === 0) {
      output.bodyState = "metadata-only";
      state.tracker.partial(outputPath, "metadata-only");
    } else if (additions === 0 && deletions === 0) {
      output.bodyState = "binary";
      state.tracker.partial(outputPath, "binary");
    } else {
      output.bodyState = "missing-patch";
      state.tracker.block(outputPath, "missing-or-truncated-patch");
    }
    return output;
  }
  if (isSubmodulePatch(file.patch)) {
    output.bodyState = "submodule";
    state.tracker.partial(outputPath, "submodule");
    return output;
  }
  const rawPatchBytes = Buffer.byteLength(file.patch);
  if (rawPatchBytes > state.limits.filePatchBytes) {
    output.bodyState = "size-limit";
    state.tracker.block(outputPath, "per-file-byte-limit");
    return output;
  }
  const counted = countPatchChanges(file.patch);
  if (counted.additions !== additions || counted.deletions !== deletions) {
    output.bodyState = "missing-patch";
    state.tracker.block(outputPath, "truncated-patch");
    return output;
  }
  const redacted = redactSensitiveText(file.patch);
  if (redacted.redactions > 0) {
    output.bodyState = "redacted";
    state.tracker.partial(outputPath, "suspected-secret-redacted");
    return output;
  }
  const storedPatchBytes = Buffer.byteLength(redacted.text);
  if (storedPatchBytes === 0) {
    output.bodyState = "metadata-only";
    state.tracker.partial(outputPath, "metadata-only");
    return output;
  }
  if (storedPatchBytes > state.limits.filePatchBytes) {
    output.bodyState = "size-limit";
    state.tracker.block(outputPath, "per-file-byte-limit");
    return output;
  }
  const redactedCount = countPatchChanges(redacted.text);
  if (redactedCount.additions !== additions || redactedCount.deletions !== deletions) {
    output.bodyState = "missing-patch";
    state.tracker.block(outputPath, "redaction-line-mismatch");
    return output;
  }
  if (
    annotatedPatchLines(redacted.text).some(
      (line) => line.bytes > state.limits.passPatchBytes,
    )
  ) {
    output.bodyState = "size-limit";
    state.tracker.block(outputPath, "per-line-byte-limit");
    return output;
  }
  output.bodyState = "included";
  state.patchBodies.push({
    path: outputPath,
    additions,
    deletions,
    text: redacted.text,
    bytes: storedPatchBytes,
  });
  return output;
}

function applyTotalPatchLimit(patchBodies, files, state) {
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const included = [];
  let patchBytes = 0;
  let exceeded = false;
  for (const patch of patchBodies) {
    if (exceeded || patchBytes + patch.bytes > state.limits.totalPatchBytes) {
      exceeded = true;
      const file = filesByPath.get(patch.path);
      if (file) file.bodyState = "size-limit";
      state.tracker.block(patch.path, "total-patch-byte-limit");
      continue;
    }
    included.push(patch);
    patchBytes += patch.bytes;
  }
  return included;
}

export function calculateAnalysisPassFingerprint(pass, patches) {
  const body = {
    id: pass.id,
    changedLines: pass.changedLines,
    patchBytes: pass.patchBytes,
    patchIds: pass.patchIds,
    paths: pass.paths,
    patches,
  };
  return createHash("sha256")
    .update(ANALYSIS_PASS_FINGERPRINT_DOMAIN, "utf8")
    .update(canonicalizeJson(body), "utf8")
    .digest("hex");
}

function buildAnalysisPlan(patchBodies, limits) {
  const passes = [];
  const patches = [];
  let currentPass;
  let currentFragment;

  function beginPass() {
    if (passes.length >= MAX_ANALYSIS_PASSES) {
      throw new CollectionError(
        `The bounded analysis plan supports at most ${MAX_ANALYSIS_PASSES} passes.`,
        "analysis-pass-limit",
      );
    }
    currentPass = {
      id: `pass-${String(passes.length + 1).padStart(3, "0")}`,
      changedLines: 0,
      patchBytes: 0,
      patchIds: [],
      paths: [],
      fragments: [],
    };
    passes.push(currentPass);
    currentFragment = undefined;
  }

  function beginFragment(pathValue, line) {
    const id = `patch-${String(patches.length + 1).padStart(4, "0")}`;
    currentFragment = {
      id,
      passId: currentPass.id,
      path: pathValue,
      startLine: line.lineNumber,
      endLine: line.lineNumber,
      additions: 0,
      deletions: 0,
      lineTexts: [],
    };
    currentPass.fragments.push(currentFragment);
    currentPass.patchIds.push(id);
    if (!currentPass.paths.includes(pathValue)) currentPass.paths.push(pathValue);
    patches.push(currentFragment);
  }

  for (const patchBody of patchBodies) {
    currentFragment = undefined;
    for (const line of annotatedPatchLines(patchBody.text)) {
      const changedLines = line.additions + line.deletions;
      const exceedsCurrent =
        currentPass !== undefined &&
        (currentPass.changedLines + changedLines > limits.passChangedLines ||
          currentPass.patchBytes + line.bytes > limits.passPatchBytes);
      if (currentPass === undefined || exceedsCurrent) beginPass();
      if (
        currentFragment === undefined ||
        currentFragment.passId !== currentPass.id ||
        currentFragment.path !== patchBody.path ||
        currentFragment.endLine + 1 !== line.lineNumber
      ) {
        beginFragment(patchBody.path, line);
      }
      currentFragment.endLine = line.lineNumber;
      currentFragment.additions += line.additions;
      currentFragment.deletions += line.deletions;
      currentFragment.lineTexts.push(line.text);
      currentPass.changedLines += changedLines;
      currentPass.patchBytes += line.bytes;
    }
  }

  const finalizedPatches = patches.map(({ lineTexts, ...patch }) => ({
    ...patch,
    text: lineTexts.join(""),
  }));
  const patchesById = new Map(finalizedPatches.map((patch) => [patch.id, patch]));
  const finalizedPasses = passes.map(({ fragments, ...pass }) => {
    const passPatches = pass.patchIds.map((id) => patchesById.get(id));
    return {
      ...pass,
      fingerprint: calculateAnalysisPassFingerprint(pass, passPatches),
    };
  });
  return {
    patches: finalizedPatches,
    analysisPlan: {
      lineLimitPerPass: limits.passChangedLines,
      byteLimitPerPass: limits.passPatchBytes,
      passes: finalizedPasses,
    },
  };
}

function warningSummary(exclusions) {
  const counts = new Map();
  for (const exclusion of exclusions) {
    counts.set(exclusion.reason, (counts.get(exclusion.reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([reason, count]) => `${count} item(s) require attention: ${reason}.`)
    .slice(0, 40);
}

export async function collectChangeRequest({ url, runner = defaultGhRunner, limits } = {}) {
  const resolvedLimits = mergeLimits(limits);
  const deadline = createDeadline(resolvedLimits.timeoutMs);
  const locator = normalizePullRequestUrl(url);
  const first = await readCurrentSnapshot({ url: locator.url, runner, deadline });
  if (first.commitCount > 250) {
    throw new CollectionError(
      `Change request has ${first.commitCount} commits; the GitHub adapter supports at most 250.`,
      "commit-limit",
    );
  }

  const baseEndpoint = `repos/${locator.owner}/${locator.repositoryName}`;
  const [compare, commitPages, filePages] = await Promise.all([
    callRunner(runner, {
      endpoint: `${baseEndpoint}/compare/${first.baseSha}...${first.headSha}`,
      deadline,
    }),
    callRunner(runner, {
      endpoint: `${baseEndpoint}/pulls/${locator.id}/commits?per_page=100`,
      paginate: true,
      slurp: true,
      deadline,
    }),
    callRunner(runner, {
      endpoint: `${baseEndpoint}/pulls/${locator.id}/files?per_page=100`,
      paginate: true,
      slurp: true,
      deadline,
    }),
  ]);
  const second = await readCurrentSnapshot({ url: locator.url, runner, deadline });
  assertSameSnapshot(first, second);

  const mergeBaseSha = compare?.merge_base_commit?.sha;
  if (!isCommitSha(mergeBaseSha)) {
    throw new GhApiError("GitHub compare response has no valid merge base.", "invalid-response");
  }
  const rawCommits = flattenPages(commitPages, "GitHub commits");
  const rawFiles = flattenPages(filePages, "GitHub files");
  if (rawCommits.length !== first.commitCount) {
    throw new CollectionError(
      `GitHub returned ${rawCommits.length} of ${first.commitCount} commits.`,
      "commit-enumeration-incomplete",
    );
  }

  const tracker = makeTracker();
  const titleRedaction = redactSensitiveMetadata(first.title);
  if (titleRedaction.redactions > 0) {
    tracker.partial("change-request-title", "suspected-secret-redacted");
  }
  const boundedDescription = truncateUtf8(first.description, resolvedLimits.descriptionBytes);
  if (boundedDescription.truncated) {
    tracker.block("change-request-description", "description-byte-limit");
  }
  const descriptionRedaction = redactSensitiveMetadata(boundedDescription.text);
  if (descriptionRedaction.redactions > 0) {
    tracker.partial("change-request-description", "suspected-secret-redacted");
  }
  const commits = rawCommits.map((commit, index) => normalizeCommit(commit, index, tracker));
  const commitShas = new Set(commits.map((commit) => commit.sha));
  if (commitShas.size !== commits.length) {
    throw new GhApiError("GitHub returned duplicate commit SHAs.", "invalid-response");
  }
  if (commits.at(-1)?.sha !== first.headSha) {
    throw new CollectionError(
      "GitHub commit enumeration is not bound to the pull request head SHA.",
      "commit-enumeration-incomplete",
    );
  }

  if (rawFiles.length !== first.changedFiles) {
    tracker.block("change-request-diff", "provider-file-enumeration-incomplete");
  }
  const additions = rawFiles.reduce(
    (total, file) => total + integer(file?.additions, "file.additions"),
    0,
  );
  const deletions = rawFiles.reduce(
    (total, file) => total + integer(file?.deletions, "file.deletions"),
    0,
  );
  const changedLines = additions + deletions;
  if (![additions, deletions, changedLines].every(Number.isSafeInteger)) {
    throw new GhApiError("GitHub changed-line totals exceed safe integer bounds.", "invalid-response");
  }
  if (changedLines > resolvedLimits.totalChangedLines) {
    tracker.block("change-request-diff", "total-changed-line-limit");
  }
  if (first.changedFiles > resolvedLimits.maxFiles || rawFiles.length > resolvedLimits.maxFiles) {
    tracker.block("additional-files-not-represented", "file-count-limit");
  }
  const orderedFiles = [...rawFiles].sort((left, right) =>
    compareCanonicalText(safePath(left?.filename), safePath(right?.filename)),
  );
  const fileState = {
    limits: resolvedLimits,
    patchBodies: [],
    tracker,
  };
  const files = orderedFiles
    .slice(0, Math.min(resolvedLimits.maxFiles, first.changedFiles))
    .map((file) => normalizeFile(file, fileState));
  const patchBodies = applyTotalPatchLimit(fileState.patchBodies, files, fileState);
  if (patchBodies.length === 0) {
    throw new CollectionError(
      "No explainable text patch was included in the change request.",
      "no-explainable-text",
    );
  }
  const { patches, analysisPlan } = buildAnalysisPlan(patchBodies, resolvedLimits);
  const patchBytes = patches.reduce((total, patch) => total + Buffer.byteLength(patch.text), 0);
  const explainableChangedLines = patches.reduce(
    (total, patch) => total + patch.additions + patch.deletions,
    0,
  );
  let coverage = {
    status: tracker.status(),
    discoveredFiles: first.changedFiles,
    representedFiles: files.length,
    includedBodies: patchBodies.length,
    metadataOnlyBodies: files.length - patchBodies.length,
    additions,
    deletions,
    changedLines,
    explainableChangedLines,
    patchBytes,
  };
  let withoutFingerprint = {
    schemaVersion: 1,
    provider: "github",
    host: "github.com",
    repository: first.repository,
    id: first.id,
    url: first.url,
    title: titleRedaction.text,
    description: descriptionRedaction.text,
    author: first.author,
    state: first.state,
    reviewStage: first.reviewStage,
    isDraft: first.isDraft,
    baseSha: first.baseSha,
    headSha: first.headSha,
    mergeBaseSha,
    comparison: {
      kind: "merge-base-to-head",
      fromSha: mergeBaseSha,
      toSha: first.headSha,
    },
    snapshotFingerprint: first.snapshotFingerprint,
    commitCount: first.commitCount,
    commits,
    files,
    patches,
    analysisPlan,
    coverage,
    exclusions: tracker.exclusions,
    warnings: warningSummary(tracker.exclusions),
  };
  const provisionalSummary = { ...withoutFingerprint, fingerprint: "0".repeat(64) };
  delete provisionalSummary.patches;
  if (Buffer.byteLength(JSON.stringify(provisionalSummary)) > resolvedLimits.summaryBytes) {
    tracker.block("change-request-summary", "summary-byte-limit");
    coverage = { ...coverage, status: tracker.status() };
    withoutFingerprint = {
      ...withoutFingerprint,
      coverage,
      exclusions: tracker.exclusions,
      warnings: warningSummary(tracker.exclusions),
    };
  }
  const result = {
    ...withoutFingerprint,
    fingerprint: calculateChangeRequestFingerprint(withoutFingerprint),
  };
  return validateChangeRequest(result);
}

export function calculateChangeRequestFingerprint(value) {
  if (!isRecord(value)) {
    throw new TypeError("ChangeRequestV1 must be an object to fingerprint it.");
  }
  const withoutFingerprint = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "fingerprint"),
  );
  return createHash("sha256")
    .update(FINGERPRINT_DOMAIN, "utf8")
    .update(canonicalizeJson(withoutFingerprint), "utf8")
    .digest("hex");
}

function inspectionSummaryBytes(value) {
  const { patches: _patches, ...summary } = value;
  return Buffer.byteLength(JSON.stringify(summary));
}

function exactKeys(value, expected, label, issues) {
  if (!isRecord(value)) {
    issues.push(`${label} must be an object`);
    return false;
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (canonicalizeJson(actual) !== canonicalizeJson(wanted)) {
    issues.push(`${label} must contain exactly: ${wanted.join(", ")}`);
    return false;
  }
  return true;
}

function validText(value, { allowEmpty = false, maximum = 4_000 } = {}) {
  return (
    typeof value === "string" &&
    (allowEmpty || value.trim().length > 0) &&
    Array.from(value).length <= maximum &&
    !hasDisallowedControl(value)
  );
}

function validCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function validateChangeRequest(value) {
  const issues = [];
  if (!exactKeys(value, OUTPUT_KEYS, "$", issues)) {
    throw new CollectionError(`ChangeRequestV1 validation failed:\n- ${issues.join("\n- ")}`, "validation");
  }
  if (value.schemaVersion !== 1) issues.push("$.schemaVersion must equal 1");
  if (value.provider !== "github") issues.push("$.provider must equal github");
  if (value.host !== "github.com") issues.push("$.host must equal github.com");

  let locator;
  try {
    locator = normalizePullRequestUrl(value.url);
  } catch {
    issues.push("$.url must be a canonical GitHub pull request URL");
  }
  if (locator && locator.repository !== value.repository) {
    issues.push("$.repository must match $.url");
  }
  if (locator && locator.id !== value.id) {
    issues.push("$.id must match $.url");
  }
  if (!validText(value.title)) issues.push("$.title must be bounded non-empty text");
  if (
    !validText(value.description, { allowEmpty: true, maximum: 32_768 }) ||
    Buffer.byteLength(value.description ?? "") > DEFAULT_LIMITS.descriptionBytes
  ) {
    issues.push("$.description must be bounded control-free text of at most 32 KiB");
  }
  if (!validText(value.author, { maximum: 100 })) {
    issues.push("$.author must be a bounded non-empty login");
  }
  if (!["open", "merged", "closed"].includes(value.state)) {
    issues.push("$.state is invalid");
  }
  if (!["draft", "ready", "historical", "abandoned"].includes(value.reviewStage)) {
    issues.push("$.reviewStage is invalid");
  }
  if (typeof value.isDraft !== "boolean") issues.push("$.isDraft must be boolean");
  const expectedStage =
    value.state === "merged"
      ? "historical"
      : value.state === "closed"
        ? "abandoned"
        : value.isDraft
          ? "draft"
          : "ready";
  if (value.reviewStage !== expectedStage) {
    issues.push("$.reviewStage does not match state and draft status");
  }
  for (const key of ["baseSha", "headSha", "mergeBaseSha"]) {
    if (!isCommitSha(value[key])) issues.push(`$.${key} must be a full lowercase commit SHA`);
  }
  if (!/^[a-f0-9]{64}$/u.test(value.snapshotFingerprint ?? "")) {
    issues.push("$.snapshotFingerprint must be a lowercase SHA-256 digest");
  }
  if (
    !exactKeys(value.comparison, ["kind", "fromSha", "toSha"], "$.comparison", issues) ||
    value.comparison.kind !== "merge-base-to-head" ||
    value.comparison.fromSha !== value.mergeBaseSha ||
    value.comparison.toSha !== value.headSha
  ) {
    issues.push("$.comparison must bind mergeBaseSha to headSha");
  }

  if (!Number.isSafeInteger(value.commitCount) || value.commitCount < 1 || value.commitCount > 250) {
    issues.push("$.commitCount must be between 1 and 250");
  }
  if (!Array.isArray(value.commits) || value.commits.length !== value.commitCount) {
    issues.push("$.commits must exactly match $.commitCount");
  } else {
    const shas = new Set();
    value.commits.forEach((commit, index) => {
      const label = `$.commits[${index}]`;
      if (!exactKeys(commit, ["sha", "title", "author"], label, issues)) return;
      if (!isCommitSha(commit.sha)) issues.push(`${label}.sha is invalid`);
      if (shas.has(commit.sha)) issues.push(`${label}.sha is duplicated`);
      shas.add(commit.sha);
      if (!validText(commit.title)) issues.push(`${label}.title is invalid`);
      if (commit.author !== null && !validText(commit.author, { maximum: 100 })) {
        issues.push(`${label}.author is invalid`);
      }
    });
  }

  const fileStatuses = new Set([
    "added",
    "modified",
    "deleted",
    "renamed",
    "copied",
    "type-changed",
  ]);
  const bodyStates = new Set([
    "included",
    "redacted",
    "binary",
    "generated-or-lockfile",
    "secret-path",
    "invalid-utf8",
    "missing-patch",
    "metadata-only",
    "submodule",
    "symlink",
    "size-limit",
  ]);
  const filePaths = new Set();
  if (!Array.isArray(value.files) || value.files.length < 1 || value.files.length > DEFAULT_LIMITS.maxFiles) {
    issues.push(`$.files must contain between 1 and ${DEFAULT_LIMITS.maxFiles} files`);
  } else {
    value.files.forEach((file, index) => {
      const label = `$.files[${index}]`;
      if (
        !exactKeys(
          file,
          ["path", "previousPath", "status", "additions", "deletions", "bodyState"],
          label,
          issues,
        )
      ) {
        return;
      }
      if (!isSafeRelativePath(file.path)) issues.push(`${label}.path is unsafe`);
      if (filePaths.has(file.path)) issues.push(`${label}.path is duplicated`);
      filePaths.add(file.path);
      if (file.previousPath !== null && !isSafeRelativePath(file.previousPath)) {
        issues.push(`${label}.previousPath is unsafe`);
      }
      if (["renamed", "copied"].includes(file.status) !== (file.previousPath !== null)) {
        issues.push(`${label}.previousPath does not match status`);
      }
      if (!fileStatuses.has(file.status)) issues.push(`${label}.status is invalid`);
      if (!validCount(file.additions) || !validCount(file.deletions)) {
        issues.push(`${label} additions and deletions must be counts`);
      }
      if (!bodyStates.has(file.bodyState)) issues.push(`${label}.bodyState is invalid`);
    });
    const paths = value.files.map((file) => file?.path);
    const sortedPaths = [...paths].sort(compareCanonicalText);
    if (canonicalizeJson(paths) !== canonicalizeJson(sortedPaths)) {
      issues.push("$.files must be sorted deterministically by path");
    }
  }

  const patchIds = new Set();
  const patchPaths = new Set();
  const patchesById = new Map();
  const patchesByPath = new Map();
  let actualPatchBytes = 0;
  let actualExplainableChangedLines = 0;
  if (!Array.isArray(value.patches) || value.patches.length < 1 || value.patches.length > 1_024) {
    issues.push("$.patches must contain between 1 and 1024 fragments");
  } else {
    value.patches.forEach((patch, index) => {
      const label = `$.patches[${index}]`;
      const keys = [
        "id",
        "passId",
        "path",
        "startLine",
        "endLine",
        "additions",
        "deletions",
        "text",
      ];
      if (!exactKeys(patch, keys, label, issues)) return;
      const expectedId = `patch-${String(index + 1).padStart(4, "0")}`;
      if (patch.id !== expectedId) issues.push(`${label}.id must equal ${expectedId}`);
      if (patchIds.has(patch.id)) issues.push(`${label}.id is duplicated`);
      patchIds.add(patch.id);
      patchesById.set(patch.id, patch);
      if (typeof patch.passId !== "string" || !/^pass-[0-9]{3}$/u.test(patch.passId)) {
        issues.push(`${label}.passId is invalid`);
      }
      if (!isSafeRelativePath(patch.path) || !filePaths.has(patch.path)) {
        issues.push(`${label}.path must reference a known safe file`);
      }
      patchPaths.add(patch.path);
      if (!patchesByPath.has(patch.path)) patchesByPath.set(patch.path, []);
      patchesByPath.get(patch.path).push(patch);
      if (!Number.isSafeInteger(patch.startLine) || patch.startLine < 1) {
        issues.push(`${label}.startLine must be a positive integer`);
      }
      if (!Number.isSafeInteger(patch.endLine) || patch.endLine < patch.startLine) {
        issues.push(`${label}.endLine must be at least startLine`);
      }
      if (!validCount(patch.additions) || !validCount(patch.deletions)) {
        issues.push(`${label} additions and deletions must be counts`);
      } else {
        actualExplainableChangedLines += patch.additions + patch.deletions;
      }
      if (typeof patch.text !== "string") {
        issues.push(`${label}.text must be a string`);
      } else {
        const bytes = Buffer.byteLength(patch.text);
        actualPatchBytes += bytes;
        if (bytes < 1) issues.push(`${label}.text must not be empty`);
        if (hasDisallowedControl(patch.text)) {
          issues.push(`${label}.text contains a disallowed control character`);
        }
      }
    });
  }
  if (Array.isArray(value.files)) {
    value.files.forEach((file, index) => {
      const shouldHavePatch = file?.bodyState === "included";
      if (shouldHavePatch !== patchPaths.has(file?.path)) {
        issues.push(`$.files[${index}] patch presence does not match bodyState`);
      }
      const fragments = patchesByPath.get(file?.path) ?? [];
      if (fragments.length > 0) {
        const reconstructed = fragments.map((fragment) => String(fragment.text ?? "")).join("");
        const annotated = annotatedPatchLines(reconstructed);
        let nextLine = 1;
        let additions = 0;
        let deletions = 0;
        let bytes = 0;
        fragments.forEach((fragment, fragmentIndex) => {
          if (fragment.startLine !== nextLine) {
            issues.push(`$.patches for ${file.path} must have contiguous line ranges starting at 1`);
          }
          nextLine = fragment.endLine + 1;
          const boundLines = annotated.slice(fragment.startLine - 1, fragment.endLine);
          if (
            boundLines.length !== fragment.endLine - fragment.startLine + 1 ||
            boundLines.map((line) => line.text).join("") !== fragment.text
          ) {
            issues.push(`$.patches fragment ${fragment.id} does not match its complete-line range`);
          }
          const expectedAdditions = boundLines.reduce((total, line) => total + line.additions, 0);
          const expectedDeletions = boundLines.reduce((total, line) => total + line.deletions, 0);
          if (
            fragment.additions !== expectedAdditions ||
            fragment.deletions !== expectedDeletions
          ) {
            issues.push(`$.patches fragment ${fragment.id} has inconsistent changed-line counts`);
          }
          additions += fragment.additions;
          deletions += fragment.deletions;
          bytes += Buffer.byteLength(fragment.text ?? "");
          if (fragmentIndex < fragments.length - 1 && !String(fragment.text ?? "").endsWith("\n")) {
            issues.push(`$.patches for ${file.path} may split only after a complete line`);
          }
        });
        if (additions !== file.additions || deletions !== file.deletions) {
          issues.push(`$.patches for ${file.path} do not match file additions and deletions`);
        }
        if (bytes > DEFAULT_LIMITS.filePatchBytes) {
          issues.push(`$.patches for ${file.path} exceed the per-file byte limit`);
        }
      }
    });
  }

  const plannedPatchIds = [];
  if (
    exactKeys(
      value.analysisPlan,
      ["lineLimitPerPass", "byteLimitPerPass", "passes"],
      "$.analysisPlan",
      issues,
    )
  ) {
    if (
      !Number.isSafeInteger(value.analysisPlan.lineLimitPerPass) ||
      value.analysisPlan.lineLimitPerPass < 1 ||
      value.analysisPlan.lineLimitPerPass > DEFAULT_LIMITS.passChangedLines
    ) {
      issues.push("$.analysisPlan.lineLimitPerPass is invalid");
    }
    if (
      !Number.isSafeInteger(value.analysisPlan.byteLimitPerPass) ||
      value.analysisPlan.byteLimitPerPass < 1 ||
      value.analysisPlan.byteLimitPerPass > DEFAULT_LIMITS.passPatchBytes
    ) {
      issues.push("$.analysisPlan.byteLimitPerPass is invalid");
    }
    if (
      !Array.isArray(value.analysisPlan.passes) ||
      value.analysisPlan.passes.length < 1 ||
      value.analysisPlan.passes.length > MAX_ANALYSIS_PASSES
    ) {
      issues.push(`$.analysisPlan.passes must contain between 1 and ${MAX_ANALYSIS_PASSES} passes`);
    } else {
      const seenPlannedIds = new Set();
      value.analysisPlan.passes.forEach((pass, index) => {
        const label = `$.analysisPlan.passes[${index}]`;
        const keys = ["id", "fingerprint", "changedLines", "patchBytes", "patchIds", "paths"];
        if (!exactKeys(pass, keys, label, issues)) return;
        const expectedId = `pass-${String(index + 1).padStart(3, "0")}`;
        if (pass.id !== expectedId) issues.push(`${label}.id must equal ${expectedId}`);
        if (!/^[a-f0-9]{64}$/u.test(pass.fingerprint ?? "")) {
          issues.push(`${label}.fingerprint must be a lowercase SHA-256 digest`);
        }
        if (!validCount(pass.changedLines)) issues.push(`${label}.changedLines must be a count`);
        if (!validCount(pass.patchBytes)) issues.push(`${label}.patchBytes must be a count`);
        if (
          Number.isSafeInteger(pass.changedLines) &&
          pass.changedLines > value.analysisPlan.lineLimitPerPass
        ) {
          issues.push(`${label}.changedLines exceeds the per-pass line limit`);
        }
        if (
          Number.isSafeInteger(pass.patchBytes) &&
          pass.patchBytes > value.analysisPlan.byteLimitPerPass
        ) {
          issues.push(`${label}.patchBytes exceeds the per-pass byte limit`);
        }
        if (!Array.isArray(pass.patchIds) || pass.patchIds.length < 1 || pass.patchIds.length > 1_024) {
          issues.push(`${label}.patchIds must contain between 1 and 1024 ids`);
          return;
        }
        if (!Array.isArray(pass.paths) || pass.paths.length < 1 || pass.paths.length > DEFAULT_LIMITS.maxFiles) {
          issues.push(`${label}.paths must contain between 1 and ${DEFAULT_LIMITS.maxFiles} paths`);
          return;
        }
        const passPatches = [];
        for (const patchId of pass.patchIds) {
          if (typeof patchId !== "string" || !/^patch-[0-9]{4}$/u.test(patchId)) {
            issues.push(`${label}.patchIds contains an invalid id`);
            continue;
          }
          if (seenPlannedIds.has(patchId)) issues.push(`${label}.patchIds duplicates ${patchId}`);
          seenPlannedIds.add(patchId);
          plannedPatchIds.push(patchId);
          const fragment = patchesById.get(patchId);
          if (!fragment) {
            issues.push(`${label}.patchIds references unknown ${patchId}`);
          } else {
            passPatches.push(fragment);
            if (fragment.passId !== pass.id) {
              issues.push(`$.patches fragment ${patchId} does not bind to ${pass.id}`);
            }
          }
        }
        const expectedPaths = [...new Set(passPatches.map((fragment) => fragment.path))];
        if (canonicalizeJson(pass.paths) !== canonicalizeJson(expectedPaths)) {
          issues.push(`${label}.paths do not match its ordered patch fragments`);
        }
        const expectedChangedLines = passPatches.reduce(
          (total, fragment) => total + fragment.additions + fragment.deletions,
          0,
        );
        const expectedPatchBytes = passPatches.reduce(
          (total, fragment) => total + Buffer.byteLength(fragment.text ?? ""),
          0,
        );
        if (pass.changedLines !== expectedChangedLines) {
          issues.push(`${label}.changedLines is inconsistent`);
        }
        if (pass.patchBytes !== expectedPatchBytes) {
          issues.push(`${label}.patchBytes is inconsistent`);
        }
        if (calculateAnalysisPassFingerprint(pass, passPatches) !== pass.fingerprint) {
          issues.push(`${label}.fingerprint does not match its patch fragments`);
        }
      });
    }
  }
  if (
    Array.isArray(value.patches) &&
    canonicalizeJson(plannedPatchIds) !== canonicalizeJson(value.patches.map((patch) => patch?.id))
  ) {
    issues.push("$.analysisPlan must cover every patch fragment exactly once and in order");
  }

  const coverageKeys = [
    "status",
    "discoveredFiles",
    "representedFiles",
    "includedBodies",
    "metadataOnlyBodies",
    "additions",
    "deletions",
    "changedLines",
    "explainableChangedLines",
    "patchBytes",
  ];
  if (exactKeys(value.coverage, coverageKeys, "$.coverage", issues)) {
    if (!["complete", "partial", "blocked"].includes(value.coverage.status)) {
      issues.push("$.coverage.status is invalid");
    }
    for (const key of coverageKeys.slice(1)) {
      if (!validCount(value.coverage[key])) issues.push(`$.coverage.${key} must be a count`);
    }
    if (value.coverage.representedFiles !== value.files?.length) {
      issues.push("$.coverage.representedFiles must match $.files");
    }
    if (value.coverage.representedFiles > value.coverage.discoveredFiles) {
      issues.push("$.coverage.representedFiles cannot exceed discovered files");
    }
    if (value.coverage.includedBodies !== patchPaths.size) {
      issues.push("$.coverage.includedBodies must match files with patch fragments");
    }
    if (
      value.coverage.metadataOnlyBodies !==
      value.coverage.representedFiles - value.coverage.includedBodies
    ) {
      issues.push("$.coverage.metadataOnlyBodies is inconsistent");
    }
    if (value.coverage.changedLines !== value.coverage.additions + value.coverage.deletions) {
      issues.push("$.coverage.changedLines is inconsistent");
    }
    const explainableChangedLines = Array.isArray(value.files)
      ? value.files
          .filter((file) => file?.bodyState === "included")
          .reduce((total, file) => total + file.additions + file.deletions, 0)
      : 0;
    if (
      value.coverage.explainableChangedLines !== explainableChangedLines ||
      value.coverage.explainableChangedLines !== actualExplainableChangedLines
    ) {
      issues.push("$.coverage.explainableChangedLines is inconsistent");
    }
    if (value.coverage.explainableChangedLines > value.coverage.changedLines) {
      issues.push("$.coverage.explainableChangedLines cannot exceed total changed lines");
    }
    if (value.coverage.patchBytes !== actualPatchBytes) {
      issues.push("$.coverage.patchBytes is inconsistent");
    }
    if (actualPatchBytes > DEFAULT_LIMITS.totalPatchBytes) {
      issues.push("$.patches exceed the total byte limit");
    }
    if (value.coverage.includedBodies < 1) {
      issues.push("$.coverage must include at least one text body");
    }
    if (value.coverage.status === "complete" && value.coverage.discoveredFiles !== value.files?.length) {
      issues.push("complete coverage must represent every discovered file");
    }
    if (
      value.coverage.status !== "blocked" &&
      (value.coverage.discoveredFiles > DEFAULT_LIMITS.maxFiles ||
        value.coverage.changedLines > DEFAULT_LIMITS.totalChangedLines ||
        value.coverage.patchBytes > DEFAULT_LIMITS.totalPatchBytes ||
        inspectionSummaryBytes(value) > DEFAULT_LIMITS.summaryBytes)
    ) {
      issues.push("non-blocked coverage exceeds a collector safety limit");
    }
  }

  if (!Array.isArray(value.exclusions) || value.exclusions.length > 400) {
    issues.push("$.exclusions must contain at most 400 entries");
  } else {
    value.exclusions.forEach((entry, index) => {
      const label = `$.exclusions[${index}]`;
      if (!exactKeys(entry, ["path", "reason"], label, issues)) return;
      if (!isSafeRelativePath(entry.path)) issues.push(`${label}.path is unsafe`);
      if (!validText(entry.reason)) issues.push(`${label}.reason is invalid`);
    });
  }
  if (!Array.isArray(value.warnings) || value.warnings.length > 40) {
    issues.push("$.warnings must contain at most 40 entries");
  } else {
    value.warnings.forEach((warning, index) => {
      if (!validText(warning)) issues.push(`$.warnings[${index}] is invalid`);
    });
  }
  if (value.coverage?.status === "complete" && value.exclusions?.length !== 0) {
    issues.push("complete coverage cannot have exclusions");
  }
  if (value.coverage?.status !== "complete" && value.exclusions?.length === 0) {
    issues.push("partial or blocked coverage must explain its exclusions");
  }
  const blockingReasons = new Set([
    "description-byte-limit",
    "commit-title-size-limit",
    "provider-file-enumeration-incomplete",
    "file-count-limit",
    "total-changed-line-limit",
    "unsafe-path",
    "missing-or-truncated-patch",
    "truncated-patch",
    "per-file-byte-limit",
    "per-line-byte-limit",
    "total-patch-byte-limit",
    "summary-byte-limit",
    "redaction-line-mismatch",
  ]);
  const hasBlockingReason = Array.isArray(value.exclusions)
    ? value.exclusions.some((entry) => blockingReasons.has(entry?.reason))
    : false;
  if (value.coverage?.status === "blocked" && !hasBlockingReason) {
    issues.push("blocked coverage must identify a blocking exclusion");
  }
  if (["complete", "partial"].includes(value.coverage?.status) && hasBlockingReason) {
    issues.push("a blocking exclusion requires blocked coverage");
  }

  if (!/^[a-f0-9]{64}$/u.test(value.fingerprint ?? "")) {
    issues.push("$.fingerprint must be a lowercase SHA-256 digest");
  } else if (calculateChangeRequestFingerprint(value) !== value.fingerprint) {
    issues.push("$.fingerprint does not match the canonical ChangeRequestV1 content");
  }
  const secretIssues = collectSecretIssues(value);
  if (secretIssues.length > 0) {
    issues.push(
      ...secretIssues.map(
        (issue) => `ChangeRequestV1 ${issue}; the value was not written to output`,
      ),
    );
  }
  if (issues.length > 0) {
    throw new CollectionError(`ChangeRequestV1 validation failed:\n- ${issues.join("\n- ")}`, "validation");
  }
  return value;
}

async function pathExists(targetPath) {
  try {
    await lstat(targetPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function writeChangeRequestFile(value, output) {
  validateChangeRequest(value);
  if (value.coverage.status === "blocked") {
    throw new CollectionError(
      `Change Request coverage is blocked (${value.warnings.join(" ")}); no transient file was written.`,
      "blocked",
    );
  }
  let directory;
  let outputPath;
  let ownsDirectory = false;
  if (output) {
    outputPath = path.resolve(output);
    if (await pathExists(outputPath)) {
      throw new CollectionError("Refusing to overwrite an existing output path.", "output-exists");
    }
    directory = path.dirname(outputPath);
  } else {
    directory = await mkdtemp(path.join(tmpdir(), "hope-context-"));
    ownsDirectory = true;
    await chmod(directory, 0o700);
    outputPath = path.join(directory, "change-request.json");
  }
  let handle;
  let created = false;
  try {
    handle = await open(outputPath, "wx", 0o600);
    created = true;
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.chmod(0o600);
  } catch (error) {
    await handle?.close().catch(() => {});
    handle = undefined;
    if (created) await unlink(outputPath).catch(() => {});
    if (ownsDirectory) await rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  } finally {
    await handle?.close();
  }
  return outputPath;
}

export function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (!["--url", "--output"].includes(argument)) {
      throw new TypeError(`Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new TypeError(`${argument} requires a value.`);
    }
    const key = argument.slice(2);
    if (options[key] !== undefined) {
      throw new TypeError(`${argument} may be provided only once.`);
    }
    options[key] = value;
    index += 1;
  }
  if (!options.help && options.url === undefined) {
    throw new TypeError("--url is required.");
  }
  return options;
}

function helpText() {
  return [
    "Collect a bounded GitHub ChangeRequestV1 snapshot.",
    "",
    "Usage:",
    "  node collect-change-request.mjs --url <github-pr-url> [--output <new-file>]",
    "",
    "Without --output, Hope writes a private temporary change-request.json file.",
  ].join("\n");
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return;
  }
  const changeRequest = await collectChangeRequest({ url: options.url });
  const outputPath = await writeChangeRequestFile(changeRequest, options.output);
  console.log(outputPath);
}

const isEntrypoint = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isEntrypoint) {
  main().catch((error) => {
    console.error(`collect-change-request: ${error.message}`);
    process.exitCode = 1;
  });
}
