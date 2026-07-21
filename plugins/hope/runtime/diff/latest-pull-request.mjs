import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  createGhEnvironment,
  normalizePullRequestUrl,
} from "../../skills/diff/scripts/collect-change-request.mjs";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_BYTES = 64 * 1024;
const TIMEOUT_MS = 15_000;

export const latestPullRequestArguments = Object.freeze([
  "pr",
  "list",
  "--state",
  "all",
  "--limit",
  "10",
  "--search",
  "sort:created-desc",
  "--json",
  "url,createdAt",
]);

async function runGitHubCli({ cwd }) {
  try {
    const { stdout } = await execFileAsync("gh", latestPullRequestArguments, {
      cwd,
      encoding: "utf8",
      env: createGhEnvironment(),
      maxBuffer: MAX_OUTPUT_BYTES,
      timeout: TIMEOUT_MS,
      windowsHide: true,
    });
    return stdout;
  } catch (error) {
    throw new Error(
      "Hope could not list pull requests for the current repository. Check gh auth, run Hope inside a GitHub repository, or give a pull request URL.",
      { cause: error },
    );
  }
}

export function parseLatestPullRequests(source) {
  let values;
  try {
    values = JSON.parse(source);
  } catch {
    throw new Error("GitHub CLI returned an invalid pull request list.");
  }
  if (!Array.isArray(values)) {
    throw new Error("GitHub CLI returned an invalid pull request list.");
  }
  if (values.length === 0) {
    throw new Error(
      "No pull request was found in the current GitHub repository. Give a pull request URL.",
    );
  }

  const pullRequests = values.map((value) => {
    const createdAt = Date.parse(value?.createdAt);
    if (!Number.isFinite(createdAt)) {
      throw new Error("GitHub CLI returned a pull request without a valid creation time.");
    }
    return {
      createdAt,
      url: normalizePullRequestUrl(value?.url).url,
    };
  });
  pullRequests.sort((first, second) =>
    second.createdAt - first.createdAt || first.url.localeCompare(second.url));
  return pullRequests[0].url;
}

export async function resolveLatestPullRequest(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  if (typeof cwd !== "string" || cwd.length === 0) {
    throw new TypeError("cwd must be a non-empty path.");
  }
  const runner = options.runner ?? runGitHubCli;
  return parseLatestPullRequests(await runner({ cwd }));
}
