import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  GhApiError,
  SnapshotChangedError,
  assertSameSnapshot,
  calculateAnalysisPassFingerprint,
  calculateChangeRequestFingerprint,
  collectChangeRequest,
  createGhEnvironment,
  normalizePullRequestUrl,
  parseArguments,
  readCurrentSnapshot,
  validateChangeRequest,
  writeChangeRequestFile,
} from "../plugins/hope/skills/diff/scripts/collect-change-request.mjs";
import {
  MAX_CONTEXT_BYTES as INSPECTOR_MAX_CONTEXT_BYTES,
  inspectPass,
  inspectSummary,
  parseArguments as parseInspectArguments,
  readChangeRequestContext,
} from "../plugins/hope/skills/diff/scripts/inspect-change-request.mjs";
import {
  MAX_CONTEXT_BYTES as RENDERER_MAX_CONTEXT_BYTES,
} from "../plugins/hope/skills/diff/scripts/render-review.mjs";

const SHA = {
  base: "1".repeat(40),
  head: "2".repeat(40),
  mergeBase: "3".repeat(40),
  commitA: "4".repeat(40),
  commitB: "2".repeat(40),
  forcePushed: "6".repeat(40),
};
const execFileAsync = promisify(execFile);

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
    updated_at: "2026-07-18T00:00:00Z",
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

function fileAt(context, filePath) {
  return context.files.find((file) => file.path === filePath);
}

function patchTextFor(context, filePath) {
  return context.patches
    .filter((patch) => patch.path === filePath)
    .map((patch) => patch.text)
    .join("");
}

function additionPatch(count, makeLine = (index) => `+line-${index}`) {
  return [`@@ -0,0 +1,${count} @@`, ...Array.from({ length: count }, (_, index) => makeLine(index + 1))].join("\n");
}

function deletionPatch(count, makeLine = (index) => `-line-${index}`) {
  return [`@@ -1,${count} +0,0 @@`, ...Array.from({ length: count }, (_, index) => makeLine(index + 1))].join("\n");
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
  assert.deepEqual(fileAt(context, "src/old-name.js"), {
    path: "src/old-name.js",
    previousPath: "src/legacy.js",
    status: "renamed",
    additions: 1,
    deletions: 1,
    bodyState: "included",
  });
  assert.equal(fileAt(context, "dist/generated.js").bodyState, "generated-or-lockfile");
  assert.equal(context.coverage.status, "partial");
  assert.equal(context.coverage.includedBodies, 2);
  assert.equal(context.coverage.explainableChangedLines, 4);
  assert.equal(context.analysisPlan.passes.length, 1);
  assert.deepEqual(context.analysisPlan.passes[0].paths, ["src/old-name.js", "src/retry.js"]);
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
  const firstSecretSnapshot = await readCurrentSnapshot({
    url: context.url,
    runner: makeRunner({
      before: pull({ body: "API_KEY=first-secret-value" }),
    }).runner,
  });
  const secondSecretSnapshot = await readCurrentSnapshot({
    url: context.url,
    runner: makeRunner({
      before: pull({ body: "API_KEY=second-secret-value" }),
    }).runner,
  });
  assert.equal(
    firstSecretSnapshot.snapshotFingerprint,
    secondSecretSnapshot.snapshotFingerprint,
  );
  assert.throws(
    () => assertSameSnapshot(firstSecretSnapshot, secondSecretSnapshot),
    SnapshotChangedError,
  );

  const firstVersionedSnapshot = await readCurrentSnapshot({
    url: context.url,
    runner: makeRunner({
      before: pull({
        body: "Intent A\nPASSWORD=first-secret-value",
        updated_at: "2026-07-18T00:00:00Z",
      }),
    }).runner,
  });
  const secondVersionedSnapshot = await readCurrentSnapshot({
    url: context.url,
    runner: makeRunner({
      before: pull({
        body: "Intent B\nPASSWORD=second-secret-value",
        updated_at: "2026-07-18T00:00:00Z",
      }),
    }).runner,
  });
  assert.notEqual(
    firstVersionedSnapshot.snapshotFingerprint,
    secondVersionedSnapshot.snapshotFingerprint,
  );
  assert.throws(
    () => assertSameSnapshot(firstVersionedSnapshot, secondVersionedSnapshot),
    SnapshotChangedError,
  );
});

test("redacts credentials without leaking raw values and marks coverage partial", async () => {
  const secretFile = modifiedFile({
    filename: "src/config.js",
    patch:
      '@@ -1 +1 @@\n-const API_KEY = "old-credential-value";\n+const API_KEY = "ghp_abcdefghijklmnopqrstuvwxyz";',
  });
  const metadata = pull({ commits: 1, changed_files: 3 });
  const { runner } = makeRunner({
    before: metadata,
    commits: [[commit(SHA.head, "Rotate config reference")]],
    files: [[
      secretFile,
      modifiedFile({ filename: ".env", patch: "@@ -1 +1 @@\n-A=1\n+A=2" }),
      modifiedFile({ filename: "src/safe-control.js" }),
    ]],
  });
  const context = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner,
  });
  const serialized = JSON.stringify(context);
  assert.equal(fileAt(context, "src/config.js").bodyState, "redacted");
  assert.equal(fileAt(context, ".env").bodyState, "secret-path");
  assert.equal(context.coverage.status, "partial");
  assert.match(serialized, /suspected-secret-redacted/u);
  assert.doesNotMatch(serialized, /old-credential-value|ghp_abcdefghijklmnopqrstuvwxyz/u);
  assert.equal(context.patches.some((patch) => patch.path === "src/config.js"), false);
  assert.ok(context.exclusions.some((entry) => entry.reason === "suspected-secret-redacted"));
});

test("keeps only the safe metadata prefix before an encoded multiline secret", async () => {
  const description = [
    "Visible intent before",
    'config["pass\\u0077ord"] = """',
    "FAKE_METADATA_MULTILINE_SECRET_MATERIAL",
    '"""',
    "Visible intent after",
  ].join("\n");
  const context = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner: makeRunner({
      before: pull({ body: description }),
    }).runner,
  });
  const serialized = JSON.stringify(context);
  assert.equal(
    context.description,
    "Visible intent before\n[REDACTED_SENSITIVE_TEXT]",
  );
  assert.equal(context.coverage.status, "partial");
  assert.doesNotMatch(serialized, /METADATA_MULTILINE_SECRET_MATERIAL|Visible intent after/u);
});

test("rejects a change request when every file body is sensitive", async () => {
  await assert.rejects(
    collectChangeRequest({
      url: "https://github.com/acme/widgets/pull/17",
      runner: makeRunner({
        before: pull({ commits: 1, changed_files: 1 }),
        commits: [[commit(SHA.head, "Rotate credential")]],
        files: [[modifiedFile({
          filename: "src/config.js",
          patch: '@@ -1 +1 @@\n-const password = "old";\n+const password = "new";',
        })]],
      }).runner,
    }),
    (error) => error?.code === "no-explainable-text",
  );
});

test("redacts residual suspicious assignment lines instead of blocking collection", async () => {
  const metadata = pull({ commits: 1, changed_files: 2 });
  const { runner } = makeRunner({
    before: metadata,
    commits: [[commit(SHA.head, "Update secret-handling fixtures")]],
    files: [[modifiedFile({
      filename: "test/safety-fixture.js",
      additions: 2,
      deletions: 2,
      patch:
        "@@ -1,2 +1,2 @@\n" +
        "-const secretFile = null;\n" +
        "-const sample = null;\n" +
        "+const secretFile = modifiedFile({\n" +
        '+const sample = "password = \\\"alpha beta\\\";";',
    }), modifiedFile({ filename: "src/safe-control.js" })]],
  });
  const context = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner,
  });
  const patch = patchTextFor(context, "test/safety-fixture.js");
  assert.equal(context.coverage.status, "partial");
  assert.equal(fileAt(context, "test/safety-fixture.js").bodyState, "redacted");
  assert.equal(patch, "");
  assert.doesNotMatch(patch, /modifiedFile|alpha beta/u);
  assert.doesNotThrow(() => validateChangeRequest(context));
});

test("redacts an embedded PEM header literal without blocking security-tool changes", async () => {
  const metadata = pull({ commits: 1, changed_files: 2 });
  const { runner } = makeRunner({
    before: metadata,
    commits: [[commit(SHA.head, "Add PEM detection")]],
    files: [[modifiedFile({
      filename: "src/scanner.js",
      additions: 2,
      deletions: 1,
      patch:
        "@@ -1 +1,2 @@\n" +
        "-const marker = null;\n" +
        "+const marker = /-----BEGIN PRIVATE KEY-----/u;\n" +
        "+scan(nextInput);",
    }), modifiedFile({ filename: "src/safe-control.js" })]],
  });
  const context = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner,
  });
  assert.equal(context.coverage.status, "partial");
  assert.equal(fileAt(context, "src/scanner.js").bodyState, "redacted");
  assert.equal(patchTextFor(context, "src/scanner.js"), "");
  assert.doesNotMatch(patchTextFor(context, "src/scanner.js"), /BEGIN PRIVATE KEY/u);
  assert.doesNotMatch(patchTextFor(context, "src/scanner.js"), /scan\(nextInput\)/u);
});

test("redacts every line of a private key embedded after source syntax", async () => {
  const metadata = pull({ commits: 1, changed_files: 2 });
  const { runner } = makeRunner({
    before: metadata,
    commits: [[commit(SHA.head, "Remove embedded key fixture")]],
    files: [[modifiedFile({
      filename: "src/config.js",
      additions: 4,
      deletions: 0,
      patch:
        "@@ -0,0 +1,4 @@\n" +
        "+const key = `-----BEGIN PRIVATE KEY-----\n" +
        "+SENSITIVE_PRIVATE_MATERIAL\n" +
        "+-----END PRIVATE KEY-----`;\n" +
        "+use(key);",
    }), modifiedFile({ filename: "src/safe-control.js" })]],
  });
  const context = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner,
  });
  const patch = patchTextFor(context, "src/config.js");
  assert.equal(context.coverage.status, "partial");
  assert.equal(context.files[0].bodyState, "redacted");
  assert.equal(patch, "");
  assert.doesNotMatch(patch, /BEGIN PRIVATE KEY|PRIVATE_MATERIAL|END PRIVATE KEY/u);
  assert.doesNotMatch(patch, /use\(key\)/u);
});

test("redacts a multiline sensitive assignment through its closing delimiter", async () => {
  const metadata = pull({ commits: 1, changed_files: 2 });
  const { runner } = makeRunner({
    before: metadata,
    commits: [[commit(SHA.head, "Remove multiline credential fixture")]],
    files: [[modifiedFile({
      filename: "src/config.js",
      additions: 4,
      deletions: 0,
      patch:
        "@@ -0,0 +1,4 @@\n" +
        "+const password = `\n" +
        "+FAKE_MULTILINE_SECRET_MATERIAL\n" +
        "+`;\n" +
        "+use(config);",
    }), modifiedFile({ filename: "src/safe-control.js" })]],
  });
  const context = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner,
  });
  const patch = patchTextFor(context, "src/config.js");
  assert.equal(context.coverage.status, "partial");
  assert.equal(patch, "");
  assert.doesNotMatch(patch, /MULTILINE_SECRET_MATERIAL|password/u);
  assert.doesNotMatch(patch, /use\(config\)/u);
});

test("redacts a private key assembled from escaped concatenated lines", async () => {
  const metadata = pull({ commits: 1, changed_files: 2 });
  const { runner } = makeRunner({
    before: metadata,
    commits: [[commit(SHA.head, "Remove concatenated key fixture")]],
    files: [[modifiedFile({
      filename: "src/config.js",
      additions: 4,
      deletions: 0,
      patch:
        "@@ -0,0 +1,4 @@\n" +
        "+const key = \"-----BEGIN PRIVATE KEY-----\\n\" +\n" +
        "+\"FAKE_CONCATENATED_PRIVATE_MATERIAL\\n\" +\n" +
        "+\"-----END PRIVATE KEY-----\";\n" +
        "+use(key);",
    }), modifiedFile({ filename: "src/safe-control.js" })]],
  });
  const context = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner,
  });
  const patch = patchTextFor(context, "src/config.js");
  assert.equal(context.coverage.status, "partial");
  assert.equal(patch, "");
  assert.doesNotMatch(patch, /BEGIN PRIVATE KEY|CONCATENATED_PRIVATE_MATERIAL|END PRIVATE KEY/u);
  assert.doesNotMatch(patch, /use\(key\)/u);
});

test("omits a file body for triple-quoted sensitive values", async () => {
  const context = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner: makeRunner({
      before: pull({ commits: 1, changed_files: 2 }),
      commits: [[commit(SHA.head, "Remove triple-quoted credential")]],
      files: [[modifiedFile({
        filename: "src/config.py",
        additions: 4,
        deletions: 0,
        patch:
          '@@ -0,0 +1,4 @@\n+password = """\n' +
          "+FAKE_TRIPLE_QUOTED_SECRET_MATERIAL\n" +
          '+"""\n' +
          "+use(config)",
      }), modifiedFile({ filename: "src/safe-control.js" })]],
    }).runner,
  });
  const patch = patchTextFor(context, "src/config.py");
  assert.equal(fileAt(context, "src/config.py").bodyState, "redacted");
  assert.equal(patch, "");
  assert.doesNotMatch(patch, /TRIPLE_QUOTED_SECRET_MATERIAL|password|use\(config\)/u);
});

test("omits an encoded-key triple-quoted sensitive body", async () => {
  const context = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner: makeRunner({
      before: pull({ commits: 1, changed_files: 2 }),
      commits: [[commit(SHA.head, "Remove encoded credential")]],
      files: [[modifiedFile({
        filename: "src/encoded-config.py",
        additions: 4,
        deletions: 0,
        patch:
          '@@ -0,0 +1,4 @@\n+config["pass\\u0077ord"] = """\n' +
          "+FAKE_ENCODED_TRIPLE_SECRET_MATERIAL\n" +
          '+"""\n' +
          "+use(config)",
      }), modifiedFile({ filename: "src/safe-control.js" })]],
    }).runner,
  });
  const serialized = JSON.stringify(context);
  assert.equal(fileAt(context, "src/encoded-config.py").bodyState, "redacted");
  assert.equal(patchTextFor(context, "src/encoded-config.py"), "");
  assert.equal(fileAt(context, "src/safe-control.js").bodyState, "included");
  assert.doesNotMatch(serialized, /ENCODED_TRIPLE_SECRET_MATERIAL|pass\\u0077ord/u);
});

test("omits an encoded-key multiline fallback hidden after a comment", async () => {
  const context = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner: makeRunner({
      before: pull({ commits: 1, changed_files: 2 }),
      commits: [[commit(SHA.head, "Remove multiline credential fallback")]],
      files: [[modifiedFile({
        filename: "src/encoded-config.js",
        additions: 3,
        deletions: 0,
        patch:
          '@@ -0,0 +1,3 @@\n+const config = {}; config["pass\\u0077ord"] = "" // benign-looking comment\n' +
          '+|| "FAKE_MULTILINE_FALLBACK_SECRET_MATERIAL";\n' +
          "+use(config);",
      }), modifiedFile({ filename: "src/safe-control.js" })]],
    }).runner,
  });
  const serialized = JSON.stringify(context);
  assert.equal(fileAt(context, "src/encoded-config.js").bodyState, "redacted");
  assert.equal(patchTextFor(context, "src/encoded-config.js"), "");
  assert.equal(fileAt(context, "src/safe-control.js").bodyState, "included");
  assert.doesNotMatch(serialized, /MULTILINE_FALLBACK_SECRET_MATERIAL|pass\\u0077ord/u);
});

test("omits a file body containing a sensitive logical assignment", async () => {
  const context = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner: makeRunner({
      before: pull({ commits: 1, changed_files: 2 }),
      commits: [[commit(SHA.head, "Remove credential default")]],
      files: [[modifiedFile({
        filename: "src/credential-default.js",
        additions: 2,
        deletions: 0,
        patch:
          '@@ -0,0 +1,2 @@\n+config.password ??= "FAKE_NULLISH_ASSIGNMENT_SECRET_MATERIAL";\n' +
          "+use(config);",
      }), modifiedFile({ filename: "src/safe-control.js" })]],
    }).runner,
  });
  const serialized = JSON.stringify(context);
  assert.equal(fileAt(context, "src/credential-default.js").bodyState, "redacted");
  assert.equal(patchTextFor(context, "src/credential-default.js"), "");
  assert.equal(fileAt(context, "src/safe-control.js").bodyState, "included");
  assert.doesNotMatch(serialized, /NULLISH_ASSIGNMENT_SECRET_MATERIAL/u);
});

test("omits a file body for YAML block scalar credentials", async () => {
  const context = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner: makeRunner({
      before: pull({ commits: 1, changed_files: 2 }),
      commits: [[commit(SHA.head, "Remove YAML credential block")]],
      files: [[modifiedFile({
        filename: "config.yaml",
        additions: 3,
        deletions: 0,
        patch:
          "@@ -0,0 +1,3 @@\n" +
          "+password: |\n" +
          "+  FAKE_YAML_BLOCK_SECRET_MATERIAL\n" +
          "+next: safe",
      }), modifiedFile({ filename: "src/safe-control.js" })]],
    }).runner,
  });
  const patch = patchTextFor(context, "config.yaml");
  assert.equal(fileAt(context, "config.yaml").bodyState, "redacted");
  assert.equal(patch, "");
  assert.doesNotMatch(patch, /YAML_BLOCK_SECRET_MATERIAL|password|next: safe/u);
});

test("omits a file body for concatenated sensitive assignments", async () => {
  const context = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner: makeRunner({
      before: pull({ commits: 1, changed_files: 2 }),
      commits: [[commit(SHA.head, "Remove concatenated credential")]],
      files: [[modifiedFile({
        filename: "src/config.js",
        additions: 3,
        deletions: 0,
        patch:
          "@@ -0,0 +1,3 @@\n" +
          '+const password = "FAKE_FIRST_SECRET_PART" +\n' +
          '+  "FAKE_SECOND_SECRET_PART";\n' +
          "+use(config);",
      }), modifiedFile({ filename: "src/safe-control.js" })]],
    }).runner,
  });
  const patch = patchTextFor(context, "src/config.js");
  assert.equal(fileAt(context, "src/config.js").bodyState, "redacted");
  assert.equal(patch, "");
  assert.doesNotMatch(patch, /FIRST_SECRET_PART|SECOND_SECRET_PART|password|use\(config\)/u);
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
  assert.equal(fileAt(context, "src/retry.js").bodyState, "included");
  assert.equal(fileAt(context, "image.png").bodyState, "binary");
  assert.equal(fileAt(context, "package-lock.json").bodyState, "generated-or-lockfile");
  assert.equal(context.coverage.status, "partial");
  assert.equal(context.coverage.metadataOnlyBodies, 2);
  assert.equal(context.coverage.changedLines, 5_002);
  assert.equal(context.coverage.explainableChangedLines, 2);
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
  assert.equal(fileAt(context, "src/new.js").bodyState, "metadata-only");
  assert.equal(context.coverage.status, "partial");
});

test("keeps a sensitive previous path metadata-only after a rename", async () => {
  const metadata = pull({ commits: 1, changed_files: 2 });
  const context = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner: makeRunner({
      before: metadata,
      commits: [[commit(SHA.head, "Rename private configuration")]],
      files: [[
        modifiedFile(),
        modifiedFile({
          filename: "config.txt",
          previous_filename: ".env",
          status: "renamed",
          patch: "@@ -1 +1 @@\n-PASSWORD=old-value\n+PASSWORD=new-value",
        }),
      ]],
    }).runner,
  });
  const serialized = JSON.stringify(context);
  assert.equal(fileAt(context, "config.txt").bodyState, "secret-path");
  assert.equal(context.coverage.status, "partial");
  assert.ok(context.exclusions.some(
    (entry) => entry.path === ".env" && entry.reason === "secret-path",
  ));
  assert.doesNotMatch(serialized, /old-value|new-value/u);
  assert.equal(context.patches.some((patch) => patch.path === "config.txt"), false);
});

test("collects a generated file after it moves into a source path", async () => {
  const metadata = pull({ commits: 1, changed_files: 1 });
  const context = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner: makeRunner({
      before: metadata,
      commits: [[commit(SHA.head, "Promote generated helper to source")]],
      files: [[modifiedFile({
        filename: "src/runtime.js",
        previous_filename: "dist/generated.js",
        status: "renamed",
      })]],
    }).runner,
  });
  assert.equal(fileAt(context, "src/runtime.js").bodyState, "included");
  assert.equal(context.coverage.status, "complete");
  assert.equal(context.patches.some((patch) => patch.path === "src/runtime.js"), true);
});

test("uses changed lines as a per-pass budget while retaining hard safety blocks", async () => {
  const metadata = pull({ commits: 1, changed_files: 2 });
  const baseOptions = {
    url: "https://github.com/acme/widgets/pull/17",
  };
  const context = await collectChangeRequest({
    ...baseOptions,
    limits: { maxFiles: 1 },
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

  const multiPass = await collectChangeRequest({
    url: baseOptions.url,
    limits: { passChangedLines: 2 },
    runner: makeRunner({
      before: metadata,
      commits: [[commit(SHA.head, "Bound analyzed lines")]],
      files: [[modifiedFile(), modifiedFile({ filename: "src/second.js" })]],
    }).runner,
  });
  assert.equal(multiPass.coverage.status, "complete");
  assert.equal(multiPass.coverage.explainableChangedLines, 4);
  assert.deepEqual(multiPass.analysisPlan.passes.map((pass) => pass.changedLines), [2, 2]);
  assert.ok(multiPass.files.every((file) => file.bodyState === "included"));

  const missing = await collectChangeRequest({
    url: baseOptions.url,
    runner: makeRunner({
      before: metadata,
      commits: [[commit(SHA.head, "Missing patch")]],
      files: [[modifiedFile(), modifiedFile({ filename: "src/missing.js", patch: undefined })]],
    }).runner,
  });
  assert.equal(missing.coverage.status, "blocked");
  assert.equal(fileAt(missing, "src/missing.js").bodyState, "missing-patch");

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
  assert.equal(fileAt(sized, "src/large.js").bodyState, "size-limit");

  const totalLimited = await collectChangeRequest({
    url: baseOptions.url,
    limits: { passChangedLines: 2, totalChangedLines: 3 },
    runner: makeRunner({
      before: metadata,
      commits: [[commit(SHA.head, "Bound total changed lines")]],
      files: [[modifiedFile(), modifiedFile({ filename: "src/second.js" })]],
    }).runner,
  });
  assert.equal(totalLimited.coverage.status, "blocked");
  assert.equal(totalLimited.coverage.explainableChangedLines, 4);
  assert.ok(totalLimited.exclusions.some((entry) => entry.reason === "total-changed-line-limit"));
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
    limits: {
      descriptionBytes: 10,
      filePatchBytes: 64,
      passPatchBytes: 64,
      totalPatchBytes: 64,
    },
    runner: makeRunner({
      before: metadata,
      commits: [[commit(SHA.head, "Bound bytes")]],
      files: [[modifiedFile(), modifiedFile({ filename: "src/second.js" })]],
    }).runner,
  });
  assert.equal(bounded.coverage.status, "blocked");
  assert.ok(Buffer.byteLength(bounded.description) <= 10);
  assert.ok(bounded.exclusions.some((entry) => entry.reason === "description-byte-limit"));
  assert.ok(bounded.exclusions.some((entry) => entry.reason === "total-patch-byte-limit"));
  assert.equal(fileAt(bounded, "src/second.js").bodyState, "size-limit");

  await assert.rejects(
    collectChangeRequest({
      url: "https://github.com/acme/widgets/pull/17",
      runner: makeRunner({ before: pull({ commits: 251 }) }).runner,
    }),
    (error) => error.code === "commit-limit",
  );
});

test("splits a 4001-line single file into deterministic bounded passes", async () => {
  const patch = additionPatch(4_001);
  const context = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner: makeRunner({
      before: pull({ commits: 1, changed_files: 1 }),
      commits: [[commit(SHA.head, "Add a large generated behavior table")]],
      files: [[modifiedFile({ filename: "src/large-table.js", additions: 4_001, deletions: 0, patch })]],
    }).runner,
  });

  assert.equal(context.coverage.status, "complete");
  assert.equal(context.coverage.explainableChangedLines, 4_001);
  assert.deepEqual(context.analysisPlan.passes.map((pass) => pass.changedLines), [4_000, 1]);
  assert.equal(context.patches.length, 2);
  assert.equal(patchTextFor(context, "src/large-table.js"), patch);
  assert.deepEqual(
    context.patches.map(({ startLine, endLine }) => ({ startLine, endLine })),
    [
      { startLine: 1, endLine: 4_001 },
      { startLine: 4_002, endLine: 4_002 },
    ],
  );
});

test("keeps a 16,000-line PR-scale change inside the model-visible budget", async () => {
  const files = Array.from({ length: 4 }, (_, fileIndex) => {
    const patch = additionPatch(
      4_000,
      (lineIndex) => `+case_${fileIndex}_${String(lineIndex).padStart(4, "0")} = handle(input);`,
    );
    return modifiedFile({
      filename: `src/workstream-${fileIndex}.js`,
      additions: 4_000,
      deletions: 0,
      patch,
    });
  });
  const context = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner: makeRunner({
      before: pull({ commits: 1, changed_files: files.length }),
      commits: [[commit(SHA.head, "Implement broad behavior change")]],
      files: [files],
    }).runner,
  });

  assert.equal(context.coverage.status, "complete");
  assert.equal(context.coverage.changedLines, 16_000);
  assert.ok(context.coverage.patchBytes > 400 * 1024);
  assert.ok(context.coverage.patchBytes < 768 * 1024);
  assert.ok(context.analysisPlan.passes.length > 4);
  assert.ok(context.analysisPlan.passes.every((pass) => pass.changedLines <= 4_000));
  assert.ok(context.analysisPlan.passes.every((pass) => pass.patchBytes <= 64 * 1024));
  assert.doesNotThrow(() => validateChangeRequest(context));
});

test("rejects an analysis plan that would require more than 999 passes", async () => {
  const patch = additionPatch(1_000);
  await assert.rejects(
    collectChangeRequest({
      url: "https://github.com/acme/widgets/pull/17",
      limits: { passChangedLines: 1 },
      runner: makeRunner({
        before: pull({ commits: 1, changed_files: 1 }),
        commits: [[commit(SHA.head, "Add granular behavior cases")]],
        files: [[modifiedFile({
          filename: "src/cases.js",
          additions: 1_000,
          deletions: 0,
          patch,
        })]],
      }).runner,
    }),
    (error) => error?.code === "analysis-pass-limit" && /at most 999 passes/u.test(error.message),
  );
});

test("handles deletion-heavy changes without treating aggregate size as one pass", async () => {
  const patch = deletionPatch(9_001);
  const context = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner: makeRunner({
      before: pull({ commits: 1, changed_files: 1 }),
      commits: [[commit(SHA.head, "Remove legacy implementation")]],
      files: [[modifiedFile({
        filename: "src/legacy.js",
        status: "removed",
        additions: 0,
        deletions: 9_001,
        patch,
      })]],
    }).runner,
  });

  assert.equal(context.coverage.status, "complete");
  assert.equal(context.coverage.deletions, 9_001);
  assert.deepEqual(context.analysisPlan.passes.map((pass) => pass.changedLines), [4_000, 4_000, 1_001]);
  assert.equal(patchTextFor(context, "src/legacy.js"), patch);
});

test("splits only on complete UTF-8 lines when the byte budget fills", async () => {
  const patch = additionPatch(6, (index) => `+😀-${index}`);
  const context = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    limits: { passPatchBytes: 32 },
    runner: makeRunner({
      before: pull({ commits: 1, changed_files: 1 }),
      commits: [[commit(SHA.head, "Add Unicode labels")]],
      files: [[modifiedFile({ filename: "src/labels.js", additions: 6, deletions: 0, patch })]],
    }).runner,
  });

  assert.ok(context.analysisPlan.passes.length > 1);
  assert.ok(context.analysisPlan.passes.every((pass) => pass.patchBytes <= 32));
  assert.equal(patchTextFor(context, "src/labels.js"), patch);
  assert.ok(context.patches.slice(0, -1).every((fragment) => fragment.text.endsWith("\n")));
  assert.doesNotMatch(JSON.stringify(context.patches), /�/u);
});

test("sorts provider files before partitioning so reordered responses fingerprint identically", async () => {
  const metadata = pull({ commits: 1, changed_files: 3 });
  const files = [
    modifiedFile({ filename: "src/b.js" }),
    modifiedFile({ filename: "src/a.js" }),
    modifiedFile({ filename: "src/c.js" }),
  ];
  const first = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner: makeRunner({ before: metadata, commits: [[commit(SHA.head, "Order files")]], files: [[...files]] }).runner,
  });
  const second = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner: makeRunner({ before: metadata, commits: [[commit(SHA.head, "Order files")]], files: [[files[2], files[0], files[1]]] }).runner,
  });

  assert.deepEqual(first.files.map((file) => file.path), ["src/a.js", "src/b.js", "src/c.js"]);
  assert.deepEqual(first.analysisPlan, second.analysisPlan);
  assert.deepEqual(first.patches, second.patches);
  assert.equal(first.fingerprint, second.fingerprint);
});

test("omits a complete multiline secret before safe pass boundaries are chosen", async () => {
  const patch = [
    "@@ -1 +1,3 @@",
    "-no key",
    "+-----BEGIN PRIVATE KEY-----",
    "+super-secret-material",
    "+-----END PRIVATE KEY-----",
  ].join("\n");
  const context = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    limits: { passChangedLines: 2 },
    runner: makeRunner({
      before: pull({ commits: 1, changed_files: 2 }),
      commits: [[commit(SHA.head, "Redact key fixture")]],
      files: [[
        modifiedFile({ filename: "src/key-scanner.test.js", additions: 3, deletions: 1, patch }),
        modifiedFile({
          filename: "src/safe-control.js",
          additions: 3,
          deletions: 1,
          patch: "@@ -1 +1,3 @@\n-old\n+safe-one\n+safe-two\n+safe-three",
        }),
      ]],
    }).runner,
  });
  const serialized = JSON.stringify(context);
  assert.equal(context.coverage.status, "partial");
  assert.equal(context.coverage.changedLines, 8);
  assert.equal(context.coverage.explainableChangedLines, 4);
  assert.ok(context.analysisPlan.passes.length >= 2);
  assert.equal(fileAt(context, "src/key-scanner.test.js").bodyState, "redacted");
  assert.equal(context.patches.some((entry) => entry.path === "src/key-scanner.test.js"), false);
  assert.doesNotMatch(serialized, /super-secret-material|BEGIN PRIVATE KEY|END PRIVATE KEY/u);
});

test("represents more than 80 changed files within the new explicit safety cap", async () => {
  const files = Array.from({ length: 81 }, (_, index) =>
    modifiedFile({ filename: `src/file-${String(index).padStart(3, "0")}.js` }),
  );
  const context = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner: makeRunner({
      before: pull({ commits: 1, changed_files: files.length }),
      commits: [[commit(SHA.head, "Update broad surface")]],
      files: [files],
    }).runner,
  });
  assert.equal(context.coverage.status, "complete");
  assert.equal(context.files.length, 81);
  assert.equal(context.coverage.representedFiles, 81);
  assert.equal(context.coverage.includedBodies, 81);
});

test("rejects analysis-plan and pass-fingerprint tampering even after resealing the outer model", async () => {
  const context = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner: makeRunner().runner,
  });
  const changedPath = structuredClone(context);
  const pass = changedPath.analysisPlan.passes[0];
  pass.paths = ["src/not-the-bound-path.js"];
  const passPatches = pass.patchIds.map((id) => changedPath.patches.find((patch) => patch.id === id));
  pass.fingerprint = calculateAnalysisPassFingerprint(pass, passPatches);
  changedPath.fingerprint = calculateChangeRequestFingerprint(changedPath);
  assert.throws(() => validateChangeRequest(changedPath), /paths do not match/u);

  const changedText = structuredClone(context);
  changedText.patches[0].text = changedText.patches[0].text.replace("return", "yield ");
  changedText.fingerprint = calculateChangeRequestFingerprint(changedText);
  assert.throws(() => validateChangeRequest(changedText), /fingerprint does not match its patch fragments/u);
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
  if (process.platform !== "win32") {
    assert.equal((await lstat(directory)).mode & 0o777, 0o700);
    assert.equal((await lstat(output)).mode & 0o777, 0o600);
  }
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

test("inspector emits a patch-free summary or exactly one validated pass", async (t) => {
  const context = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    limits: { passChangedLines: 2 },
    runner: makeRunner().runner,
  });
  const output = await writeChangeRequestFile(context);
  t.after(async () => await rm(path.dirname(output), { recursive: true, force: true }));

  const loaded = await readChangeRequestContext(output);
  const summary = inspectSummary(loaded);
  assert.equal(Object.hasOwn(summary, "patches"), false);
  assert.deepEqual(summary.analysisPlan, context.analysisPlan);
  assert.doesNotMatch(JSON.stringify(summary), /return retry/u);

  const selected = inspectPass(loaded, "pass-002");
  assert.equal(selected.analysis.pass.id, "pass-002");
  assert.deepEqual(
    selected.patches.map((patch) => patch.id),
    context.analysisPlan.passes[1].patchIds,
  );
  assert.ok(selected.patches.every((patch) => patch.passId === "pass-002"));
  assert.throws(() => inspectPass(loaded, "pass-999"), /does not exist/u);

  const scratch = await mkdtemp(path.join(tmpdir(), "hope-inspect-test-"));
  t.after(async () => await rm(scratch, { recursive: true, force: true }));
  const link = path.join(scratch, "context-link.json");
  await symlink(output, link);
  await assert.rejects(readChangeRequestContext(link), /non-symlink/u);

  assert.deepEqual(parseInspectArguments(["--context", output, "--summary"]), {
    summary: true,
    context: output,
  });
  assert.throws(
    () => parseInspectArguments(["--context", output, "--summary", "--pass", "pass-001"]),
    /exactly one/u,
  );
});

test("blocks an oversized model-visible summary before paging", async () => {
  const commits = Array.from({ length: 249 }, (_, index) =>
    commit((index + 10).toString(16).padStart(40, "0"), `Commit ${index} ${"x".repeat(600)}`),
  );
  commits.push(commit(SHA.head, `Head ${"x".repeat(600)}`));
  const context = await collectChangeRequest({
    url: "https://github.com/acme/widgets/pull/17",
    runner: makeRunner({
      before: pull({ commits: commits.length, changed_files: 1 }),
      commits: [commits],
      files: [[modifiedFile()]],
    }).runner,
  });
  assert.equal(context.coverage.status, "blocked");
  assert.ok(context.exclusions.some((entry) => entry.reason === "summary-byte-limit"));
  assert.equal(INSPECTOR_MAX_CONTEXT_BYTES, 4 * 1024 * 1024);
  assert.equal(RENDERER_MAX_CONTEXT_BYTES, INSPECTOR_MAX_CONTEXT_BYTES);
  await assert.rejects(
    writeChangeRequestFile(context),
    /coverage is blocked.*no transient file was written/iu,
  );
});

test(
  "inspector CLI still runs when invoked through a symlink",
  { skip: process.platform === "win32" },
  async (t) => {
    const scratch = await mkdtemp(path.join(tmpdir(), "hope-inspector-link-"));
    t.after(async () => await rm(scratch, { recursive: true, force: true }));
    const target = fileURLToPath(new URL(
      "../plugins/hope/skills/diff/scripts/inspect-change-request.mjs",
      import.meta.url,
    ));
    const link = path.join(scratch, "inspect-change-request.mjs");
    await symlink(target, link);
    const { stdout, stderr } = await execFileAsync(process.execPath, [link, "--help"]);
    assert.match(stdout, /Inspect one bounded view/u);
    assert.equal(stderr, "");
  },
);

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
