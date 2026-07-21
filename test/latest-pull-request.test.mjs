import assert from "node:assert/strict";
import test from "node:test";

import {
  latestPullRequestArguments,
  parseLatestPullRequests,
  resolveLatestPullRequest,
} from "../plugins/hope/runtime/diff/latest-pull-request.mjs";

test("latest PR lookup asks GitHub for every lifecycle state in creation order", () => {
  assert.deepEqual(latestPullRequestArguments, [
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
});

test("latest PR lookup chooses the newest valid creation time", () => {
  const source = JSON.stringify([
    {
      createdAt: "2026-07-19T12:00:00Z",
      url: "https://github.com/example/project/pull/2",
    },
    {
      createdAt: "2026-07-21T12:00:00Z",
      url: "https://github.com/example/project/pull/3",
    },
  ]);
  assert.equal(
    parseLatestPullRequests(source),
    "https://github.com/example/project/pull/3",
  );
});

test("latest PR lookup fails clearly when the repository has no PR", () => {
  assert.throws(() => parseLatestPullRequests("[]"), /No pull request was found/u);
  assert.throws(() => parseLatestPullRequests("not json"), /invalid pull request list/u);
});

test("latest PR lookup keeps the current session directory", async () => {
  let received;
  const url = await resolveLatestPullRequest({
    cwd: "/workspace/project",
    runner: async (options) => {
      received = options;
      return JSON.stringify([{
        createdAt: "2026-07-21T12:00:00Z",
        url: "https://github.com/example/project/pull/4",
      }]);
    },
  });
  assert.deepEqual(received, { cwd: "/workspace/project" });
  assert.equal(url, "https://github.com/example/project/pull/4");
});
