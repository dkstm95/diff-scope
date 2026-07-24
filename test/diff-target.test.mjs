import assert from "node:assert/strict";
import test from "node:test";

import { discoverGitHubPullRequest } from "../features/diff/target.mjs";

function discoveryExec({ branch = "feature", pullRequests }) {
  return async (command, arguments_) => {
    if (command === "git") return { stdout: `${branch}\n` };
    assert.equal(command, "gh");
    if (arguments_[0] === "repo") {
      return { stdout: JSON.stringify({ nameWithOwner: "example/repo" }) };
    }
    return { stdout: JSON.stringify(pullRequests) };
  };
}

test("URL-free discovery prefers the current branch pull request", async () => {
  const target = await discoverGitHubPullRequest({
    exec: discoveryExec({
      pullRequests: [
        {
          createdAt: "2026-07-23T02:00:00Z",
          headRefName: "other",
          number: 9,
          url: "https://github.com/example/repo/pull/9",
        },
        {
          createdAt: "2026-07-23T01:00:00Z",
          headRefName: "feature",
          number: 7,
          url: "https://github.com/example/repo/pull/7",
        },
      ],
    }),
  });
  assert.equal(target.number, 7);
  assert.equal(target.selection, "current-branch");
});

test("URL-free discovery falls back to the latest authored pull request", async () => {
  const target = await discoverGitHubPullRequest({
    exec: discoveryExec({
      branch: "unpublished",
      pullRequests: [
        {
          createdAt: "2026-07-22T01:00:00Z",
          headRefName: "old",
          number: 7,
          url: "https://github.com/example/repo/pull/7",
        },
        {
          createdAt: "2026-07-23T01:00:00Z",
          headRefName: "new",
          number: 9,
          url: "https://github.com/example/repo/pull/9",
        },
      ],
    }),
  });
  assert.equal(target.number, 9);
  assert.equal(target.selection, "latest-authored");
});
