// Generated from features/diff/github.mjs. Do not edit.
import { isUtf8 } from "node:buffer";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { CONTRACT_VERSION, LIMITS } from "./constants.mjs";
import { digestJson } from "./hash.mjs";
import { redactionKind } from "./redact.mjs";
import { containsBidiControl, exposeBidiControls } from "./text.mjs";

const execFile = promisify(execFileCallback);
const githubFileStatuses = new Set([
  "added",
  "changed",
  "copied",
  "modified",
  "removed",
  "renamed",
  "unchanged",
]);

function byteLength(value) {
  return Buffer.byteLength(value ?? "", "utf8");
}

function cleanText(value) {
  return exposeBidiControls(String(value ?? "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "\uFFFD"));
}

function assertCredentialFreeMetadata(texts) {
  if (redactionKind("pull-request-metadata.txt", texts) === "credential-pattern") {
    throw new Error(
      "GitHub pull request metadata contains a suspected credential; "
      + "Hope did not create a review.",
    );
  }
}

function commitTitle(commit) {
  const message = commit?.commit?.message;
  return typeof message === "string"
    ? cleanText(message.split("\n", 1)[0])
    : undefined;
}

function contentPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function unavailableReason(kind, detail) {
  return {
    "credential-pattern": "The file body matched a high-confidence credential pattern",
    "invalid-text": "The body is not UTF-8 text",
    "no-text-diff": "GitHub did not report a text diff for this changed file",
    "private-path": "The file name commonly contains private configuration",
    "safe-size-limit": `The file exceeds Hope's ${LIMITS.safeBodyBytes}-byte safe-text limit`,
    "special-entry": `GitHub reported a ${String(detail ?? "special")} entry`,
  }[kind];
}

export function parseGitHubPullRequestUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Hope diff needs a GitHub pull request URL");
  }
  if (
    url.protocol !== "https:"
    || url.hostname.toLowerCase() !== "github.com"
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new TypeError("Hope diff supports canonical https://github.com pull request URLs");
  }
  const match = url.pathname.match(
    /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)\/?$/u,
  );
  if (!match) {
    throw new TypeError("Hope diff needs a URL shaped like https://github.com/owner/repo/pull/123");
  }
  return Object.freeze({
    number: Number.parseInt(match[3], 10),
    owner: match[1],
    repository: match[2],
    url: `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`,
  });
}

function ghFailure(error) {
  if (error?.code === "ENOENT") {
    return new Error("GitHub CLI is required. Install gh and authenticate it before using Hope diff.");
  }
  const status = Number.isInteger(error?.code) ? ` (exit ${error.code})` : "";
  return new Error(`GitHub collection failed${status}. Check gh auth and the pull request URL.`);
}

export async function runGhApi(path, {
  exec = execFile,
  maxBuffer = 4 * 1024 * 1024,
} = {}) {
  try {
    const { stdout } = await exec(
      "gh",
      [
        "api",
        "--hostname",
        "github.com",
        "--method",
        "GET",
        "-H",
        "Accept: application/vnd.github+json",
        path,
      ],
      { encoding: "utf8", maxBuffer },
    );
    return JSON.parse(stdout);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("GitHub returned invalid JSON", { cause: error });
    }
    throw ghFailure(error);
  }
}

async function collectPages(path, expected, options) {
  const entries = [];
  for (let page = 1; entries.length < expected; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const value = await runGhApi(`${path}${separator}per_page=100&page=${page}`, options);
    if (!Array.isArray(value)) throw new Error("GitHub pagination returned a non-array page");
    if (value.length === 0) break;
    entries.push(...value);
    if (value.length < 100) break;
  }
  if (entries.length !== expected) {
    throw new Error(
      `GitHub reported ${expected} items but Hope collected ${entries.length}`,
    );
  }
  return entries;
}

async function readContent(owner, repository, path, revision, options) {
  if (!path || !revision) return { state: "absent" };
  const item = await runGhApi(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`
      + `/contents/${contentPath(path)}?ref=${encodeURIComponent(revision)}`,
    options,
  );
  if (
    !item
    || typeof item !== "object"
    || Array.isArray(item)
    || item.type !== "file"
  ) {
    return {
      reason: unavailableReason("special-entry", item?.type),
      reasonKind: "special-entry",
      state: "special",
    };
  }
  if (!Number.isSafeInteger(item.size) || item.size < 0) {
    throw new Error(`GitHub returned an invalid size for ${path}`);
  }
  if (item.size > LIMITS.safeBodyBytes) {
    return {
      reason: unavailableReason("safe-size-limit"),
      reasonKind: "safe-size-limit",
      state: "oversized",
    };
  }
  if (item.encoding !== "base64" || typeof item.content !== "string") {
    throw new Error(`GitHub did not return a complete body for ${path}`);
  }
  const bytes = Buffer.from(item.content.replace(/\s/gu, ""), "base64");
  if (bytes.length !== item.size) {
    throw new Error(`GitHub returned a partial body for ${path}`);
  }
  if (!isUtf8(bytes)) {
    return {
      reason: unavailableReason("invalid-text"),
      reasonKind: "invalid-text",
      state: "binary",
    };
  }
  return { state: "text", text: cleanText(bytes.toString("utf8")) };
}

function patchIsComplete(file) {
  if (typeof file.patch !== "string") return false;
  let additions = 0;
  let deletions = 0;
  for (const line of cleanText(file.patch).split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return additions === file.additions && deletions === file.deletions;
}

function source(id, kind, text, extra = {}) {
  return Object.freeze({
    id,
    kind,
    lineCount: text.split("\n").length,
    text,
    ...extra,
  });
}

function addSource(sources, kind, text, extra = {}) {
  if (text === undefined || text === null) return undefined;
  const value = source(`source-${sources.length + 1}`, kind, cleanText(text), extra);
  sources.push(value);
  return value.id;
}

async function collectFileBodies(target, pull, providerFiles, options) {
  const [baseOwner, baseRepository] = pull.base.repo.full_name.split("/");
  const [headOwner, headRepository] = pull.head.repo.full_name.split("/");
  let total = 0;
  const values = [];
  for (const file of [...providerFiles].sort((left, right) => (
    left.filename.localeCompare(right.filename, "en")
  ))) {
    if (
      typeof file.filename !== "string"
      || containsBidiControl(file.filename)
      || containsBidiControl(file.previous_filename)
      || !Number.isSafeInteger(file.additions)
      || !Number.isSafeInteger(file.deletions)
      || !githubFileStatuses.has(file.status)
    ) {
      throw new Error("GitHub returned an invalid changed file");
    }
    const completePatch = patchIsComplete(file) ? cleanText(file.patch) : undefined;
    const patchTexts = completePatch === undefined ? [] : [completePatch];
    const earlyRedaction = redactionKind(file.filename, patchTexts)
      ?? redactionKind(file.previous_filename ?? file.filename, patchTexts);
    if (earlyRedaction) {
      values.push({
        additions: file.additions,
        bodyReason: unavailableReason(earlyRedaction),
        bodyReasonKind: earlyRedaction,
        bodyState: "redacted",
        deletions: file.deletions,
        filename: file.filename,
        previousFilename: file.previous_filename,
        providerStatus: file.status,
      });
      continue;
    }
    if (
      completePatch === undefined
      && file.additions === 0
      && file.deletions === 0
    ) {
      values.push({
        additions: file.additions,
        bodyReason: unavailableReason("no-text-diff"),
        bodyReasonKind: "no-text-diff",
        bodyState: "metadata-only",
        deletions: file.deletions,
        filename: file.filename,
        previousFilename: file.previous_filename,
        providerStatus: file.status,
      });
      continue;
    }
    if (completePatch !== undefined) {
      const patchBytes = byteLength(completePatch);
      if (patchBytes > LIMITS.safeBodyBytes) {
        values.push({
          additions: file.additions,
          bodyReason: unavailableReason("safe-size-limit"),
          bodyReasonKind: "safe-size-limit",
          bodyState: "metadata-only",
          deletions: file.deletions,
          filename: file.filename,
          previousFilename: file.previous_filename,
          providerStatus: file.status,
        });
        continue;
      }
      total += patchBytes;
      if (total > LIMITS.safeBodyTotalBytes) {
        throw new Error(
          `Safe changed-file text exceeds Hope's ${LIMITS.safeBodyTotalBytes}-byte limit`,
        );
      }
      values.push({
        additions: file.additions,
        bodyState: "included",
        deletions: file.deletions,
        filename: file.filename,
        patch: completePatch,
        previousFilename: file.previous_filename,
        providerStatus: file.status,
      });
      continue;
    }
    const beforePath = file.status === "renamed" ? file.previous_filename : file.filename;
    const before = file.status === "added"
      ? { state: "absent" }
      : await readContent(
        baseOwner,
        baseRepository,
        beforePath,
        pull.base.sha,
        options,
      );
    const after = file.status === "removed"
      ? { state: "absent" }
      : await readContent(
        headOwner,
        headRepository,
        file.filename,
        pull.head.sha,
        options,
      );
    const texts = [before.text, after.text].filter(Boolean);
    const fileBytes = texts.reduce((sum, text) => sum + byteLength(text), 0);
    if (fileBytes > LIMITS.safeBodyBytes) {
      throw new Error(
        `${file.filename} exceeds Hope's ${LIMITS.safeBodyBytes}-byte safe-text limit`,
      );
    }
    total += fileBytes;
    if (total > LIMITS.safeBodyTotalBytes) {
      throw new Error(
        `Safe changed-file text exceeds Hope's ${LIMITS.safeBodyTotalBytes}-byte limit`,
      );
    }

    const redaction = redactionKind(file.filename, texts)
      ?? redactionKind(file.previous_filename ?? file.filename, texts);
    const unavailable = [before, after].find((item) => (
      item.state === "binary"
      || item.state === "oversized"
      || item.state === "special"
    ));
    const bodyState = redaction
      ? "redacted"
      : unavailable
        ? "metadata-only"
        : "included";
    values.push({
      additions: file.additions,
      after: bodyState === "included" ? after.text : undefined,
      before: bodyState === "included" ? before.text : undefined,
      bodyReason: redaction ? unavailableReason(redaction) : unavailable?.reason,
      bodyReasonKind: redaction ?? unavailable?.reasonKind,
      bodyState,
      deletions: file.deletions,
      filename: file.filename,
      previousFilename: file.previous_filename,
      providerStatus: file.status,
    });
  }
  return values;
}

export async function collectGitHubPullRequest(value, {
  clock = () => new Date(),
  gh,
  locale,
  localeSource,
  theme,
  themeSource,
} = {}) {
  const target = typeof value === "string" ? parseGitHubPullRequestUrl(value) : value;
  const options = gh ? { exec: gh } : {};
  const prefix = `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repository)}`;
  const pull = await runGhApi(`${prefix}/pulls/${target.number}`, options);
  if (
    !pull
    || typeof pull !== "object"
    || pull.number !== target.number
    || typeof pull.base?.sha !== "string"
    || typeof pull.head?.sha !== "string"
    || typeof pull.base?.repo?.full_name !== "string"
    || typeof pull.head?.repo?.full_name !== "string"
    || typeof pull.title !== "string"
    || !Number.isSafeInteger(pull.changed_files)
    || !Number.isSafeInteger(pull.commits)
    || !Number.isSafeInteger(pull.additions)
    || !Number.isSafeInteger(pull.deletions)
  ) {
    throw new Error("GitHub returned an invalid pull request");
  }
  if (pull.changed_files > LIMITS.changedFiles) {
    throw new Error(`The pull request has ${pull.changed_files} files; Hope supports ${LIMITS.changedFiles}`);
  }
  if (pull.commits > LIMITS.commits) {
    throw new Error(`The pull request has ${pull.commits} commits; Hope supports ${LIMITS.commits}`);
  }
  if (pull.additions + pull.deletions > LIMITS.changedLines) {
    throw new Error(
      `The pull request has ${pull.additions + pull.deletions} changed lines; `
      + `Hope supports ${LIMITS.changedLines}`,
    );
  }
  const title = cleanText(pull.title);
  const body = cleanText(pull.body ?? "");
  assertCredentialFreeMetadata([title, body]);
  if (byteLength(body) > LIMITS.pullRequestBodyBytes) {
    throw new Error(`The pull request description exceeds ${LIMITS.pullRequestBodyBytes} bytes`);
  }

  const compare = await runGhApi(
    `${prefix}/compare/${encodeURIComponent(pull.base.sha)}...${encodeURIComponent(pull.head.sha)}`,
    options,
  );
  if (typeof compare.merge_base_commit?.sha !== "string") {
    throw new Error("GitHub did not return the merge base");
  }
  const providerFiles = await collectPages(
    `${prefix}/pulls/${target.number}/files`,
    pull.changed_files,
    options,
  );
  const providerCommits = await collectPages(
    `${prefix}/pulls/${target.number}/commits`,
    pull.commits,
    options,
  );
  const commitTitles = providerCommits.map(commitTitle);
  assertCredentialFreeMetadata(commitTitles);
  const canonicalKeys = providerFiles.map((file) => file.filename);
  if (new Set(canonicalKeys).size !== canonicalKeys.length) {
    throw new Error("GitHub returned a duplicate changed-file path");
  }

  const collectedFiles = await collectFileBodies(target, pull, providerFiles, options);
  const sources = [];
  addSource(sources, "pull-request-title", title);
  addSource(sources, "pull-request-description", body);
  for (const [index, commit] of providerCommits.entries()) {
    addSource(sources, "commit-title", commitTitles[index], {
      revision: commit.sha,
    });
  }

  const limits = [
    {
      id: "limit-1",
      kind: "unchanged-context",
      reason: "The first Hope diff path collects changed files, not unchanged files elsewhere in the repository",
      subject: "Unchanged files outside the changed-file set",
    },
    {
      id: "limit-2",
      kind: "verification",
      reason: "The first Hope diff path does not collect or execute CI, tests, builds, or lint",
      subject: "Execution and CI results",
    },
  ];
  const files = collectedFiles.map((file, index) => {
    const id = `file-${index + 1}`;
    const sourceIds = [];
    if (file.patch) {
      sourceIds.push(addSource(sources, "patch", file.patch, {
        fileId: id,
        path: file.filename,
        revision: pull.head.sha,
      }));
    } else if (file.bodyState === "included") {
      sourceIds.push(addSource(sources, "before-file", file.before, {
        fileId: id,
        path: file.previousFilename ?? file.filename,
        revision: pull.base.sha,
      }));
      sourceIds.push(addSource(sources, "after-file", file.after, {
        fileId: id,
        path: file.filename,
        revision: pull.head.sha,
      }));
    } else {
      limits.push({
        id: `limit-${limits.length + 1}`,
        kind: "file-unavailable",
        reason: file.bodyReason,
        reasonKind: file.bodyReasonKind,
        subject: file.filename,
      });
    }
    return Object.freeze({
      additions: file.additions,
      bodyReason: file.bodyReason,
      bodyReasonKind: file.bodyReasonKind,
      bodyState: file.bodyState,
      deletions: file.deletions,
      id,
      path: file.filename,
      previousPath: file.previousFilename,
      providerStatus: file.providerStatus,
      sourceIds: sourceIds.filter(Boolean),
    });
  });

  const capturedAt = clock().toISOString();
  const snapshot = {
    schemaVersion: CONTRACT_VERSION,
    capturedAt,
    files,
    limits,
    pullRequest: {
      author: pull.user?.login,
      number: target.number,
      state: pull.state,
      title,
      url: target.url,
    },
    repository: {
      name: target.repository,
      owner: target.owner,
      provider: "github",
    },
    settings: {
      locale,
      localeSource,
      theme,
      themeSource,
    },
    snapshot: {
      base: pull.base.sha,
      head: pull.head.sha,
      mergeBase: compare.merge_base_commit.sha,
    },
    sources,
  };
  return Object.freeze({
    ...snapshot,
    digest: digestJson(snapshot),
  });
}

export async function revalidateGitHubSnapshot(collected, { clock = () => new Date(), gh } = {}) {
  const target = collected.pullRequest;
  const options = gh ? { exec: gh } : {};
  const prefix = `/repos/${encodeURIComponent(collected.repository.owner)}`
    + `/${encodeURIComponent(collected.repository.name)}`;
  const pull = await runGhApi(`${prefix}/pulls/${target.number}`, options);
  const compare = await runGhApi(
    `${prefix}/compare/${encodeURIComponent(pull.base.sha)}...${encodeURIComponent(pull.head.sha)}`,
    options,
  );
  const current = {
    base: pull.base?.sha,
    head: pull.head?.sha,
    mergeBase: compare.merge_base_commit?.sha,
  };
  const matches = current.base === collected.snapshot.base
    && current.head === collected.snapshot.head
    && current.mergeBase === collected.snapshot.mergeBase;
  return Object.freeze({
    current,
    matches,
    revalidatedAt: clock().toISOString(),
  });
}
