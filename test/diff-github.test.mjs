import assert from "node:assert/strict";
import test from "node:test";

import {
  collectGitHubPullRequest,
  parseGitHubPullRequestUrl,
} from "../features/diff/github.mjs";

function response(value) {
  return { stdout: JSON.stringify(value) };
}

function fakeGitHub({
  body = "Keep the real error.",
  commitMessage = "Keep the error\n\nBody",
  contentSize,
  incompletePatch = false,
  missingFiles = false,
  providerFile,
  secretFile = false,
  title = "Keep the error",
} = {}) {
  const changedFile = providerFile ?? {
    additions: 1,
    deletions: 1,
    filename: secretFile ? ".env" : "src/error.js",
    patch: incompletePatch ? undefined : "@@ -1 +1 @@\n-old\n+new",
    status: "modified",
  };
  return async (command, arguments_) => {
    assert.equal(command, "gh");
    assert.deepEqual(arguments_.slice(0, 3), ["api", "--hostname", "github.com"]);
    const path = arguments_.at(-1);
    if (path === "/repos/example/repo/pulls/1") {
      return response({
        additions: 1,
        base: {
          repo: { full_name: "example/repo" },
          sha: "a".repeat(40),
        },
        body,
        changed_files: 1,
        commits: 1,
        deletions: 1,
        head: {
          repo: { full_name: "example/repo" },
          sha: "b".repeat(40),
        },
        number: 1,
        state: "open",
        title,
        user: { login: "octocat" },
      });
    }
    if (path.includes("/compare/")) {
      return response({ merge_base_commit: { sha: "c".repeat(40) } });
    }
    if (path.includes("/pulls/1/files?")) {
      return response(missingFiles ? [] : [changedFile]);
    }
    if (path.includes("/pulls/1/commits?")) {
      return response([{
        commit: { message: commitMessage },
        sha: "b".repeat(40),
      }]);
    }
    if (path.includes("/contents/")) {
      const text = path.endsWith(`ref=${"a".repeat(40)}`) ? "old" : "new";
      return response({
        content: Buffer.from(text).toString("base64"),
        encoding: "base64",
        size: contentSize ?? Buffer.byteLength(text),
        type: "file",
      });
    }
    throw new Error(`Unexpected GitHub path: ${path}`);
  };
}

test("GitHub URL parsing is canonical and rejects lookalikes", () => {
  assert.deepEqual(
    parseGitHubPullRequestUrl("https://github.com/example/repo/pull/1"),
    {
      number: 1,
      owner: "example",
      repository: "repo",
      url: "https://github.com/example/repo/pull/1",
    },
  );
  assert.throws(
    () => parseGitHubPullRequestUrl("https://evil.example/example/repo/pull/1"),
    /canonical/u,
  );
  assert.throws(
    () => parseGitHubPullRequestUrl("https://github.com/example/repo/pull/1?diff=1"),
    /canonical/u,
  );
});

test("GitHub collection binds the exact snapshot and all changed files", async () => {
  const snapshot = await collectGitHubPullRequest(
    "https://github.com/example/repo/pull/1",
    {
      clock: () => new Date("2026-07-23T00:00:00.000Z"),
      gh: fakeGitHub(),
      locale: "en-US",
      localeSource: "override",
      theme: "system",
      themeSource: "default",
    },
  );
  assert.equal(snapshot.files.length, 1);
  assert.equal(snapshot.files[0].bodyState, "included");
  assert.equal(snapshot.files[0].sourceIds.length, 1);
  assert.equal(snapshot.snapshot.mergeBase, "c".repeat(40));
  assert.match(snapshot.digest, /^[a-f0-9]{64}$/u);
});

test("ordinary pull request metadata becomes model sources", async () => {
  const snapshot = await collectGitHubPullRequest(
    "https://github.com/example/repo/pull/1",
    {
      gh: fakeGitHub({
        body: "A safe description.",
        commitMessage: "A safe commit title\n\nDetails",
        title: "A safe pull request title",
      }),
      locale: "en-US",
      theme: "system",
    },
  );

  assert.deepEqual(
    snapshot.sources
      .filter((item) => [
        "pull-request-title",
        "pull-request-description",
        "commit-title",
      ].includes(item.kind))
      .map((item) => [item.kind, item.text]),
    [
      ["pull-request-title", "A safe pull request title"],
      ["pull-request-description", "A safe description."],
      ["commit-title", "A safe commit title"],
    ],
  );
});

for (const [metadataKind, githubOptions] of [
  ["title", { title: "Rotate ghp_AAAAAAAAAAAAAAAAAAAAAAAA now" }],
  ["body", { body: "Leaked github_pat_AAAAAAAAAAAAAAAAAAAAAAAA" }],
  ["commit title", { commitMessage: "Remove sk-proj-AAAAAAAAAAAAAAAAAAAAAAAA\n\nDetails" }],
]) {
  test(`a suspected credential in the pull request ${metadataKind} fails closed`, async () => {
    let error;
    try {
      await collectGitHubPullRequest(
        "https://github.com/example/repo/pull/1",
        {
          gh: fakeGitHub(githubOptions),
          locale: "en-US",
          theme: "system",
        },
      );
    } catch (caught) {
      error = caught;
    }

    assert.ok(error instanceof Error);
    assert.equal(
      error.message,
      "GitHub pull request metadata contains a suspected credential; "
        + "Hope did not create a review.",
    );
    assert.doesNotMatch(error.message, /ghp_|github_pat_|sk-proj-/u);
  });
}

test("a complete patch does not fetch full changed files", async () => {
  const seen = [];
  const github = fakeGitHub();
  await collectGitHubPullRequest(
    "https://github.com/example/repo/pull/1",
    {
      gh: async (command, arguments_) => {
        seen.push(arguments_.at(-1));
        return await github(command, arguments_);
      },
      locale: "en-US",
      theme: "system",
    },
  );
  assert.equal(seen.some((path) => path.includes("/contents/")), false);
});

test("an incomplete patch falls back to exact before and after files", async () => {
  const seen = [];
  const github = fakeGitHub({ incompletePatch: true });
  const snapshot = await collectGitHubPullRequest(
    "https://github.com/example/repo/pull/1",
    {
      gh: async (command, arguments_) => {
        seen.push(arguments_.at(-1));
        return await github(command, arguments_);
      },
      locale: "en-US",
      theme: "system",
    },
  );
  assert.equal(seen.filter((path) => path.includes("/contents/")).length, 2);
  assert.equal(snapshot.files[0].sourceIds.length, 2);
});

test("a provider file without text changes stays metadata-only without a body request", async () => {
  const seen = [];
  const github = fakeGitHub({
    providerFile: {
      additions: 0,
      deletions: 0,
      filename: "design/fonts/HopeCode.woff2",
      status: "added",
    },
  });
  const snapshot = await collectGitHubPullRequest(
    "https://github.com/example/repo/pull/1",
    {
      gh: async (command, arguments_) => {
        seen.push(arguments_.at(-1));
        return await github(command, arguments_);
      },
      locale: "en-US",
      theme: "system",
    },
  );

  assert.equal(seen.some((path) => path.includes("/contents/")), false);
  assert.equal(snapshot.files[0].bodyState, "metadata-only");
  assert.equal(snapshot.files[0].bodyReasonKind, "no-text-diff");
  assert.equal(snapshot.limits.at(-1).reasonKind, "no-text-diff");
});

test("an oversized safe-text body becomes a visible metadata-only limit", async () => {
  const seen = [];
  const github = fakeGitHub({
    contentSize: 300_000,
    providerFile: {
      additions: 4_000,
      deletions: 0,
      filename: "dist/generated-bundle.js",
      status: "added",
    },
  });
  const snapshot = await collectGitHubPullRequest(
    "https://github.com/example/repo/pull/1",
    {
      gh: async (command, arguments_) => {
        seen.push(arguments_.at(-1));
        return await github(command, arguments_);
      },
      locale: "en-US",
      theme: "system",
    },
  );

  assert.equal(seen.filter((path) => path.includes("/contents/")).length, 1);
  assert.equal(snapshot.files[0].bodyState, "metadata-only");
  assert.equal(snapshot.files[0].bodyReasonKind, "safe-size-limit");
  assert.equal(snapshot.limits.at(-1).reasonKind, "safe-size-limit");
});

test("a private path is redacted before Hope fetches its body", async () => {
  const seen = [];
  const github = fakeGitHub({ secretFile: true });
  const snapshot = await collectGitHubPullRequest(
    "https://github.com/example/repo/pull/1",
    {
      gh: async (command, arguments_) => {
        seen.push(arguments_.at(-1));
        return await github(command, arguments_);
      },
      locale: "en-US",
      theme: "system",
    },
  );
  assert.equal(seen.some((path) => path.includes("/contents/")), false);
  assert.equal(snapshot.files[0].bodyState, "redacted");
  assert.deepEqual(snapshot.files[0].sourceIds, []);
  assert.equal(snapshot.limits.length, 3);
  assert.equal(snapshot.limits[2].reasonKind, "private-path");
});

test("GitHub collection fails when pagination is incomplete", async () => {
  await assert.rejects(
    collectGitHubPullRequest(
      "https://github.com/example/repo/pull/1",
      {
        gh: fakeGitHub({ missingFiles: true }),
        locale: "en-US",
        theme: "system",
      },
    ),
    /reported 1 items but Hope collected 0/u,
  );
});

test("provider control characters stay inert without changing line coordinates", async () => {
  const base = fakeGitHub();
  const gh = async (command, arguments_) => {
    const path = arguments_.at(-1);
    if (path.includes("/pulls/1/files?")) {
      return response([{
        additions: 1,
        deletions: 1,
        filename: "src/control.js",
        patch: "@@ -1 +1 @@\n-old\n+safe\u001bunsafe\u202Ehidden",
        status: "modified",
      }]);
    }
    return await base(command, arguments_);
  };
  const snapshot = await collectGitHubPullRequest(
    parseGitHubPullRequestUrl("https://github.com/example/repo/pull/1"),
    {
      gh,
      locale: "en-US",
      localeSource: "override",
      theme: "system",
      themeSource: "default",
    },
  );
  const source = snapshot.sources.find((item) => item.kind === "patch");

  assert.match(source.text, /safe\uFFFDunsafe/u);
  assert.match(source.text, /\\u202Ehidden/u);
  assert.doesNotMatch(source.text, /\u202E/u);
  assert.equal(source.lineCount, 3);
});
