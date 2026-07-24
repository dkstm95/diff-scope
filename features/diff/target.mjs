import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { parseGitHubPullRequestUrl } from "./github.mjs";

const execFile = promisify(execFileCallback);

async function runJson(command, arguments_, { exec = execFile } = {}) {
  try {
    const { stdout } = await exec(command, arguments_, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`${command} is required to find the current pull request`);
    }
    throw new Error(`Hope could not find a pull request from the current repository`);
  }
}

async function currentBranch(options) {
  try {
    const { stdout } = await (options.exec ?? execFile)(
      "git",
      ["branch", "--show-current"],
      { encoding: "utf8", maxBuffer: 64 * 1024 },
    );
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function discoverGitHubPullRequest(options = {}) {
  const repository = await runJson(
    "gh",
    ["repo", "view", "--json", "nameWithOwner"],
    options,
  );
  if (typeof repository.nameWithOwner !== "string") {
    throw new Error("GitHub did not identify the current repository");
  }
  const pullRequests = await runJson(
    "gh",
    [
      "pr",
      "list",
      "--repo",
      repository.nameWithOwner,
      "--state",
      "open",
      "--author",
      "@me",
      "--limit",
      "100",
      "--json",
      "number,url,headRefName,createdAt",
    ],
    options,
  );
  if (!Array.isArray(pullRequests) || pullRequests.length === 0) {
    throw new Error("No open pull request authored by you was found in the current repository");
  }
  const branch = await currentBranch(options);
  const branchMatches = branch
    ? pullRequests.filter((pullRequest) => pullRequest.headRefName === branch)
    : [];
  const candidates = branchMatches.length > 0 ? branchMatches : pullRequests;
  const selected = [...candidates].sort((left, right) => (
    String(right.createdAt).localeCompare(String(left.createdAt), "en")
    || right.number - left.number
  ))[0];
  return Object.freeze({
    ...parseGitHubPullRequestUrl(selected.url),
    selection: branchMatches.length > 0 ? "current-branch" : "latest-authored",
  });
}
