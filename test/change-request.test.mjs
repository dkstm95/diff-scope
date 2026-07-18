import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  GhApiError,
  SnapshotChangedError,
  assertSameSnapshot,
  calculateChangeRequestFingerprint,
  collectChangeRequest,
  createGhEnvironment,
  normalizePullRequestUrl,
  parseArguments,
  readCurrentSnapshot,
  validateChangeRequest,
  writeChangeRequestFile,
} from "../plugins/hope/skills/diff/scripts/collect-change-request.mjs";

const SHA = {
  base: "1".repeat(40),
  head: "2".repeat(40),
  mergeBase: "3".repeat(40),
  commitA: "4".repeat(40),
  commitB: "2".repeat(40),
  forcePushed: "6".repeat(40),
};

function pull(overrides = {}) {
  return {
    number: 17,
    html_url: "https://github.com/acme/widgets/pull/17",
    title: "Teach retry behavior",
    body: "Explain retry behavior before merge.",
    user: { login: "dependabot[bot]" },
    state: "open",
    draft: false,
    merged_at: null,
    base: { sha: SHA.base },
    head: { sha: SHA.head },
    commits: 2,
    changed_files: 3,
    ...overrides,
  };
}

function commit(sha, title, author = "contributor") {
  return {
    sha,
    commit: { message: `${title}\n\nLonger body is deliberately not collected.` },
    author: author === null ? null : { login: author },
  };
}

function modifiedFile(overrides = {}) {
  return {
    filename: "src/retry.js",
    status: "modified",
    additions: 1,
    deletions: 1,
    patch: "@@ -1 +1 @@\n-return once;\n+return retry();",
    ...overrides,
  };
}

function makeRunner({ before = pull(), after = before, commits, files, compare } = {}) {
  const calls = [];
  let metadataReads = 0;
  const commitResult =
    commits ??
    [
      [commit(SHA.commitA, "Add retry state")],
      [commit(SHA.commitB, "Render retry result", null)],
    ];
  const fileResult =
    files ??
    [
      [modifiedFile()],
      [
        modifiedFile({
          filename: "src/old-name.js",
          previous_filename: "src/legacy.js",
          status: "renamed",
        }),
        modifiedFile({
          filename: "dist/generated.js",
          additions: 10,
          deletions: 4,
          patch: "@@ -1 +1 @@\n-old\n+new",
        }),
      ],
    ];

  const runner = async (request) => {
    calls.push({ ...request, deadline: undefined });
    if (/\/pulls\/17$/u.test(request.endpoint)) {
      const result = metadataReads === 0 ? before : after;
      metadataReads += 1;
      return structuredClone(result);
    }
    if (/\/compare\//u.test(request.endpoint)) {
      return structuredClone(compare ?? { merge_base_commit: { sha: SHA.mergeBase } });
    }
    if (/\/commits\?per_page=100$/u.test(request.endpoint)) {
      return structuredClone(commitResult);
    }
    if (/\/files\?per_page=100$/u.test(request.endpoint)) {
      return structuredClone(fileResult);
    }
    throw new Error(`Unexpected fake request: ${request.endpoint}`);
  };
  return { runner, calls };
}

test("normalizes only canonicalizable github.com pull request HTTPS URLs", () => {
  assert.deepEqual(
    normalizePullRequestUrl("https://github.com/acme/widgets/pull/17/?tab=files#discussion"),
    {
      provider: "github",
      host: "github.com",
      owner: "acme",
      repositoryName: "widgets",
      repository: "acme/widgets",
      id: "17",
      url: "https://github.com/acme/widgets/pull/17",
    },
  );
  for (const invalid of [
    "http://github.com/acme/widgets/pull/17",
    "https://gitlab.com/acme/widgets/pull/17",
    "https://github.com/acme/widgets/issues/17",
    "https://github.com/acme/widgets/pull/017",
    " https://github.com/acme/widgets/pull/17",
    "https://github.com/acme/%2e%2e/widgets/pull/17",
  ]) {
    assert.throws(() => normalizePullRequestUrl(invalid));
  }
});

test("collects a stable paginated multi-commit PR at merge-base-to-head", async () => {
  const { runner, calls } = makeRunner();
  const context = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner,
  });

  assert.equal(context.schemaVersion, 1);
  assert.equal(context.author, "dependabot[bot]");
  assert.equal(context.commitCount, 2);
  assert.deepEqual(
    context.commits.map(({ sha, title, author }) => ({ sha, title, author })),
    [
      { sha: SHA.commitA, title: "Add retry state", author: "contributor" },
      { sha: SHA.commitB, title: "Render retry result", author: null },
    ],
  );
  assert.equal(context.mergeBaseSha, SHA.mergeBase);
  assert.match(context.snapshotFingerprint, /^[a-f0-9]{64}$/u);
  assert.deepEqual(context.comparison, {
    kind: "merge-base-to-head",
    fromSha: SHA.mergeBase,
    toSha: SHA.head,
  });
  assert.deepEqual(context.files[1], {
    path: "src/old-name.js",
    previousPath: "src/legacy.js",
    status: "renamed",
    additions: 1,
    deletions: 1,
    bodyState: "included",
  });
  assert.equal(context.files[2].bodyState, "generated-or-lockfile");
  assert.equal(context.coverage.status, "partial");
  assert.equal(context.coverage.includedBodies, 2);
  assert.equal(context.coverage.analyzedChangedLines, 4);
  assert.match(context.fingerprint, /^[a-f0-9]{64}$/u);
  assert.equal(calls.filter((call) => call.paginate).length, 2);
  assert.ok(calls.some((call) => call.slurp && /commits/u.test(call.endpoint)));
  assert.equal(validateChangeRequest(context), context);
});

test("an author change does not change collection semantics", async () => {
  const first = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner: makeRunner({ before: pull({ user: { login: "alice" } }) }).runner,
  });
  const second = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner: makeRunner({ before: pull({ user: { login: "bob" } }) }).runner,
  });
  assert.equal(first.author, "alice");
  assert.equal(second.author, "bob");
  assert.deepEqual(first.files, second.files);
  assert.deepEqual(first.patches, second.patches);
  assert.deepEqual(first.coverage, second.coverage);
});

test("normalizes draft, merged, and abandoned review stages", async () => {
  const draft = await readCurrentSnapshot({
    url: "https://github.com/acme/widgets/pull/17",
    runner: makeRunner({ before: pull({ draft: true }) }).runner,
  });
  const merged = await readCurrentSnapshot({
    url: "https://github.com/acme/widgets/pull/17",
    runner: makeRunner({ before: pull({ state: "closed", merged_at: "2026-07-18T00:00:00Z" }) })
      .runner,
  });
  const abandoned = await readCurrentSnapshot({
    url: "https://github.com/acme/widgets/pull/17",
    runner: makeRunner({ before: pull({ state: "closed" }) }).runner,
  });
  assert.equal(draft.reviewStage, "draft");
  assert.equal(merged.state, "merged");
  assert.equal(merged.reviewStage, "historical");
  assert.equal(abandoned.reviewStage, "abandoned");
});

test("rejects force-push and other snapshot changes with a stale-only error", async () => {
  const changed = pull({ head: { sha: SHA.forcePushed } });
  await assert.rejects(
    collectChangeRequest({
      url: "https://github.com/acme/widgets/pull/17",
      runner: makeRunner({ before: pull(), after: changed }).runner,
    }),
    (error) =>
      error instanceof SnapshotChangedError &&
      error.name === "SnapshotChangedError" &&
      error.code === "stale",
  );
  await assert.rejects(
    collectChangeRequest({
      url: "https://github.com/acme/widgets/pull/17",
      runner: makeRunner({
        before: pull({ body: "API_KEY=first-secret-value" }),
        after: pull({ body: "API_KEY=second-secret-value" }),
      }).runner,
    }),
    (error) => error instanceof SnapshotChangedError && error.code === "stale",
  );

  const transport = new GhApiError("offline", "transport");
  await assert.rejects(
    readCurrentSnapshot({
      url: "https://github.com/acme/widgets/pull/17",
      runner: async () => {
        throw transport;
      },
    }),
    (error) => error === transport && error.code !== "stale",
  );
});

test("compares a full context with a metadata-only snapshot", async () => {
  const { runner } = makeRunner();
  const context = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner,
  });
  const snapshot = await readCurrentSnapshot({
    url: context.url,
    runner: makeRunner().runner,
  });
  assert.equal(assertSameSnapshot(context, snapshot), snapshot);
  assert.throws(
    () => assertSameSnapshot(context, { ...snapshot, title: "Changed title" }),
    SnapshotChangedError,
  );
  assert.throws(
    () =>
      assertSameSnapshot(
        { ...snapshot, description: "API_KEY=first-secret-value" },
        { ...snapshot, description: "API_KEY=second-secret-value" },
      ),
    SnapshotChangedError,
  );
});

test("redacts credentials without leaking raw values and marks coverage partial", async () => {
  const secretFile = modifiedFile({
    filename: "src/config.js",
    patch:
      '@@ -1 +1 @@\n-const API_KEY = "old-credential-value";\n+const API_KEY = "ghp_abcdefghijklmnopqrstuvwxyz";',
  });
  const metadata = pull({ commits: 1, changed_files: 2 });
  const { runner } = makeRunner({
    before: metadata,
    commits: [[commit(SHA.head, "Rotate config reference")]],
    files: [[secretFile, modifiedFile({ filename: ".env", patch: "@@ -1 +1 @@\n-A=1\n+A=2" })]],
  });
  const context = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner,
  });
  const serialized = JSON.stringify(context);
  assert.equal(context.files[0].bodyState, "redacted");
  assert.equal(context.files[1].bodyState, "secret-path");
  assert.equal(context.coverage.status, "partial");
  assert.match(serialized, /REDACTED/u);
  assert.doesNotMatch(serialized, /old-credential-value|ghp_abcdefghijklmnopqrstuvwxyz/u);
  assert.ok(context.exclusions.some((entry) => entry.reason === "suspected-secret-redacted"));
});

test("redacts an embedded PEM header literal without blocking security-tool changes", async () => {
  const metadata = pull({ commits: 1, changed_files: 1 });
  const { runner } = makeRunner({
    before: metadata,
    commits: [[commit(SHA.head, "Add PEM detection")]],
    files: [[modifiedFile({
      filename: "src/scanner.js",
      patch:
        "@@ -1 +1 @@\n" +
        "-const marker = null;\n" +
        "+const marker = /-----BEGIN PRIVATE KEY-----/u;",
    })]],
  });
  const context = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner,
  });
  assert.equal(context.coverage.status, "partial");
  assert.equal(context.files[0].bodyState, "redacted");
  assert.match(context.patches[0].text, /REDACTED_PEM_HEADER/u);
  assert.doesNotMatch(context.patches[0].text, /BEGIN PRIVATE KEY/u);
});

test("treats binary and generated files as partial metadata-only coverage", async () => {
  const metadata = pull({ commits: 1, changed_files: 3 });
  const context = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner: makeRunner({
      before: metadata,
      commits: [[commit(SHA.head, "Update asset")]],
      files: [
        [
          modifiedFile(),
          modifiedFile({ filename: "image.png", additions: 0, deletions: 0, patch: undefined }),
          modifiedFile({
            filename: "package-lock.json",
            additions: 5_000,
            deletions: 0,
            patch: undefined,
          }),
        ],
      ],
    }).runner,
  });
  assert.deepEqual(
    context.files.map((file) => file.bodyState),
    ["included", "binary", "generated-or-lockfile"],
  );
  assert.equal(context.coverage.status, "partial");
  assert.equal(context.coverage.metadataOnlyBodies, 2);
  assert.equal(context.coverage.changedLines, 5_002);
  assert.equal(context.coverage.analyzedChangedLines, 2);
});

test("classifies a pure rename without a patch as metadata-only rather than binary", async () => {
  const metadata = pull({ commits: 1, changed_files: 2 });
  const context = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner: makeRunner({
      before: metadata,
      commits: [[commit(SHA.head, "Rename helper")]],
      files: [
        [
          modifiedFile(),
          modifiedFile({
            filename: "src/new.js",
            previous_filename: "src/old.js",
            status: "renamed",
            additions: 0,
            deletions: 0,
            patch: undefined,
          }),
        ],
      ],
    }).runner,
  });
  assert.equal(context.files[1].bodyState, "metadata-only");
  assert.equal(context.coverage.status, "partial");
});

test("blocks file, changed-line, missing-patch, and size-limit incompleteness", async () => {
  const metadata = pull({ commits: 1, changed_files: 2 });
  const baseOptions = {
    url: "https://github.com/acme/widgets/pull/17",
    limits: { maxFiles: 1, changedLines: 4, filePatchBytes: 64, totalPatchBytes: 128 },
  };
  const context = await collectChangeRequest({
    ...baseOptions,
    runner: makeRunner({
      before: metadata,
      commits: [[commit(SHA.head, "Bound collection")]],
      files: [[modifiedFile(), modifiedFile({ filename: "src/second.js" })]],
    }).runner,
  });
  assert.equal(context.coverage.status, "blocked");
  assert.equal(context.files.length, 1);
  assert.ok(context.exclusions.some((entry) => entry.reason === "file-count-limit"));
  await assert.rejects(
    writeChangeRequestFile(context),
    /coverage is blocked.*no transient file was written/iu,
  );

  const lineLimited = await collectChangeRequest({
    url: baseOptions.url,
    limits: { changedLines: 2 },
    runner: makeRunner({
      before: metadata,
      commits: [[commit(SHA.head, "Bound analyzed lines")]],
      files: [[modifiedFile(), modifiedFile({ filename: "src/second.js" })]],
    }).runner,
  });
  assert.equal(lineLimited.coverage.status, "blocked");
  assert.equal(lineLimited.coverage.analyzedChangedLines, 2);
  assert.equal(lineLimited.files[1].bodyState, "size-limit");
  assert.ok(lineLimited.exclusions.some((entry) => entry.reason === "changed-line-limit"));

  const missing = await collectChangeRequest({
    url: baseOptions.url,
    runner: makeRunner({
      before: metadata,
      commits: [[commit(SHA.head, "Missing patch")]],
      files: [[modifiedFile(), modifiedFile({ filename: "src/missing.js", patch: undefined })]],
    }).runner,
  });
  assert.equal(missing.coverage.status, "blocked");
  assert.equal(missing.files[1].bodyState, "missing-patch");

  const largePatch = "@@ -1 +1 @@\n-old\n+" + "x".repeat(100);
  const sized = await collectChangeRequest({
    url: baseOptions.url,
    limits: { filePatchBytes: 64 },
    runner: makeRunner({
      before: metadata,
      commits: [[commit(SHA.head, "Large patch")]],
      files: [[modifiedFile(), modifiedFile({ filename: "src/large.js", patch: largePatch })]],
    }).runner,
  });
  assert.equal(sized.coverage.status, "blocked");
  assert.equal(sized.files[1].bodyState, "size-limit");
});

test("detects GitHub text patch truncation from additions and deletions", async () => {
  const metadata = pull({ commits: 1, changed_files: 2 });
  const context = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner: makeRunner({
      before: metadata,
      commits: [[commit(SHA.head, "Detect truncation")]],
      files: [
        [modifiedFile(), modifiedFile({ filename: "src/truncated.js", additions: 2, deletions: 1 })],
      ],
    }).runner,
  });
  assert.equal(context.coverage.status, "blocked");
  assert.equal(context.files[1].bodyState, "missing-patch");
  assert.ok(context.exclusions.some((entry) => entry.reason === "truncated-patch"));
});

test("blocks description and total patch byte overages and refuses more than 250 commits", async () => {
  const metadata = pull({
    body: "A deliberately long pull request description.",
    commits: 1,
    changed_files: 2,
  });
  const bounded = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    limits: { descriptionBytes: 10, totalPatchBytes: 64 },
    runner: makeRunner({
      before: metadata,
      commits: [[commit(SHA.head, "Bound bytes")]],
      files: [[modifiedFile(), modifiedFile({ filename: "src/second.js" })]],
    }).runner,
  });
  assert.equal(bounded.coverage.status, "blocked");
  assert.ok(Buffer.byteLength(bounded.description) <= 10);
  assert.ok(bounded.exclusions.some((entry) => entry.reason === "description-byte-limit"));
  assert.ok(bounded.exclusions.some((entry) => entry.reason === "total-byte-limit"));
  assert.equal(bounded.files[1].bodyState, "size-limit");

  await assert.rejects(
    collectChangeRequest({
      url: "https://github.com/acme/widgets/pull/17",
      runner: makeRunner({ before: pull({ commits: 251 }) }).runner,
    }),
    (error) => error.code === "commit-limit",
  );
});

test("fingerprints canonical content and rejects tampering", async () => {
  const context = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner: makeRunner().runner,
  });
  const reordered = Object.fromEntries(Object.entries(context).reverse());
  assert.equal(calculateChangeRequestFingerprint(reordered), context.fingerprint);
  assert.throws(
    () => validateChangeRequest({ ...context, title: "Tampered" }),
    /fingerprint does not match/u,
  );
});

test("writes private output and refuses existing or symlink paths", async (t) => {
  const context = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner: makeRunner().runner,
  });
  const output = await writeChangeRequestFile(context);
  const directory = path.dirname(output);
  t.after(async () => await rm(directory, { recursive: true, force: true }));
  assert.equal(path.basename(output), "change-request.json");
  assert.equal((await lstat(directory)).mode & 0o777, 0o700);
  assert.equal((await lstat(output)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(output, "utf8")), context);
  await assert.rejects(writeChangeRequestFile(context, output), /overwrite/u);
  assert.deepEqual(JSON.parse(await readFile(output, "utf8")), context);

  const scratch = await mkdtemp(path.join(tmpdir(), "hope-output-test-"));
  t.after(async () => await rm(scratch, { recursive: true, force: true }));
  const target = path.join(scratch, "target.json");
  const link = path.join(scratch, "link.json");
  await writeFile(target, "existing");
  await symlink(target, link);
  await assert.rejects(writeChangeRequestFile(context, link), /overwrite/u);
  assert.equal(await readFile(target, "utf8"), "existing");

  const raced = path.join(scratch, "raced.json");
  const attempts = await Promise.allSettled([
    writeChangeRequestFile(context, raced),
    writeChangeRequestFile(context, raced),
  ]);
  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((attempt) => attempt.status === "rejected").length, 1);
  assert.deepEqual(JSON.parse(await readFile(raced, "utf8")), context);
});

test("parses the narrow CLI and sanitizes GitHub CLI environment controls", () => {
  assert.deepEqual(parseArguments(["--url", "https://github.com/acme/widgets/pull/17"]), {
    url: "https://github.com/acme/widgets/pull/17",
  });
  assert.deepEqual(parseArguments(["--help"]), { help: true });
  assert.throws(() => parseArguments([]), /--url is required/u);
  assert.throws(() => parseArguments(["--token", "secret"]), /Unknown argument/u);

  const environment = createGhEnvironment({
    PATH: "/bin",
    GH_TOKEN: "preserved-without-reading",
    GH_HOST: "evil.example",
    GH_REPO: "evil/repo",
    GH_HTTP_UNIX_SOCKET: "/tmp/socket",
    GH_DEBUG: "api",
    GH_FORCE_TTY: "1",
  });
  assert.equal(environment.GH_TOKEN, "preserved-without-reading");
  assert.equal(environment.GH_HOST, undefined);
  assert.equal(environment.GH_REPO, undefined);
  assert.equal(environment.GH_HTTP_UNIX_SOCKET, undefined);
  assert.equal(environment.GH_DEBUG, undefined);
  assert.equal(environment.GH_FORCE_TTY, undefined);
  assert.equal(environment.GH_PROMPT_DISABLED, "1");
  assert.equal(environment.NO_COLOR, "1");
});
