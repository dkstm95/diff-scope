import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  MAX_DRAFT_BYTES,
  buildFinalIntent,
  captureCleanBaseline,
  finalizeIntentDraft,
  loadIntentDraft,
  parseFinalizeArguments,
} from "../plugins/hope/skills/align/scripts/finalize-intent.mjs";
import {
  IntentValidationError,
  calculateIntentFingerprint,
  canonicalizeJson,
  validateIntent,
} from "../plugins/hope/skills/align/scripts/lib/validate-intent.mjs";

const execFileAsync = promisify(execFile);

function draft() {
  return {
    schemaVersion: 1,
    goal: "사용자가 승인한 의도에 맞는 작은 변경을 구현한다.",
    outcomes: [{ id: "visible-result", statement: "사용자가 결과를 직접 확인할 수 있다." }],
    constraints: [
      {
        id: "subscription-only",
        statement: "별도 API 키를 요구하지 않는다.",
        rationale: "알파의 설치 장벽을 낮춘다.",
      },
    ],
    decisions: [
      {
        id: "private-state",
        decision: "작업 중 상태는 OS 임시 디렉터리에 둔다.",
        rationale: "코드베이스에 생성물을 쌓지 않는다.",
        tradeoff: "다른 기기에서는 자동으로 이어서 볼 수 없다.",
      },
    ],
    nonGoals: [{ id: "remote-change", statement: "원격 PR 변경은 이번 범위가 아니다." }],
    scenarios: [
      {
        id: "approved-start",
        given: "작업 트리가 깨끗하고 의도가 승인되었다.",
        when: "구현을 시작한다.",
        then: "승인된 IntentV1을 읽기 전용 입력으로 사용한다.",
      },
    ],
  };
}

function baseline(head = "a".repeat(40)) {
  return { head, workingTree: "clean" };
}

function mode(value) {
  return value.mode & 0o777;
}

async function git(root, ...argumentsList) {
  return await execFileAsync("git", argumentsList, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    shell: false,
  });
}

async function makeRepository(t, { commit = true } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "hope-align-test-"));
  t.after(async () => await rm(root, { recursive: true, force: true }));
  await git(root, "init", "-q");
  await git(root, "config", "user.name", "Hope Align Test");
  await git(root, "config", "user.email", "hope-align@example.invalid");
  if (commit) {
    await writeFile(path.join(root, "README.md"), "# Fixture\n");
    await git(root, "add", "README.md");
    await git(root, "commit", "-q", "-m", "initial");
  }
  return root;
}

test("validates IntentV1 and fingerprints canonical sorted-key JSON", () => {
  const intent = buildFinalIntent(draft(), baseline());
  assert.equal(validateIntent(intent), intent);
  assert.match(intent.fingerprint, /^[a-f0-9]{64}$/u);
  assert.equal(calculateIntentFingerprint(intent), intent.fingerprint);

  const reordered = {
    scenarios: intent.scenarios,
    nonGoals: intent.nonGoals,
    decisions: intent.decisions,
    constraints: intent.constraints,
    outcomes: intent.outcomes,
    goal: intent.goal,
    baseline: { workingTree: "clean", head: intent.baseline.head },
    schemaVersion: intent.schemaVersion,
    fingerprint: intent.fingerprint,
  };
  assert.equal(canonicalizeJson({ z: 1, a: { y: 2, b: 3 } }), '{"a":{"b":3,"y":2},"z":1}');
  assert.equal(calculateIntentFingerprint(reordered), intent.fingerprint);
  assert.doesNotThrow(() => validateIntent(reordered));
});

test("does not impose a fixed decision or item count", () => {
  const candidate = draft();
  candidate.decisions = Array.from({ length: 500 }, (_, index) => ({
    id: `choice-${index}`,
    decision: `선택 ${index}`,
    rationale: "사용자 판단을 빠뜨리지 않는다.",
    tradeoff: "전체 입력 크기 제한은 계속 적용된다.",
  }));
  const intent = buildFinalIntent(candidate, baseline());
  assert.equal(intent.decisions.length, 500);
  assert.doesNotThrow(() => validateIntent(intent));
});

test("bounds the whole intent by bytes instead of capping collection counts", () => {
  const candidate = draft();
  candidate.decisions = Array.from({ length: 70 }, (_, index) => ({
    id: `large-choice-${index}`,
    decision: "가".repeat(4_000),
    rationale: "나".repeat(4_000),
    tradeoff: "다".repeat(4_000),
  }));
  assert.throws(() => buildFinalIntent(candidate, baseline()), /262144-byte canonical JSON limit/u);
});

test("rejects duplicate global ids, unknown fields, stale fingerprints, and secrets", async (t) => {
  await t.test("globally duplicate ids", () => {
    const candidate = draft();
    candidate.decisions[0].id = candidate.outcomes[0].id;
    assert.throws(
      () => buildFinalIntent(candidate, baseline()),
      /duplicates globally unique id "visible-result"/u,
    );
  });

  await t.test("unknown draft fields", () => {
    const candidate = { ...draft(), implementationHint: "skip approval" };
    assert.throws(() => buildFinalIntent(candidate, baseline()), /implementationHint is not allowed/u);
  });

  await t.test("stale fingerprints", () => {
    const intent = buildFinalIntent(draft(), baseline());
    intent.goal = "승인 후 몰래 바뀐 목표";
    assert.throws(
      () => validateIntent(intent),
      (error) =>
        error instanceof IntentValidationError &&
        error.message.includes("does not match the canonical IntentV1 contents"),
    );
  });

  await t.test("suspected credentials", () => {
    const candidate = draft();
    candidate.goal = "토큰 sk-proj-abcdefghijklmnopqrstuvwxyz1234567890 을 저장한다.";
    assert.throws(() => buildFinalIntent(candidate, baseline()), /contains suspected provider token/u);

    const assignment = draft();
    assignment.constraints[0].rationale = 'password = "literal-secret-value"';
    let assignmentError;
    try {
      buildFinalIntent(assignment, baseline());
    } catch (error) {
      assignmentError = error;
    }
    assert.match(assignmentError?.message ?? "", /contains suspected secret assignment/u);
    assert.doesNotMatch(assignmentError.message, /literal-secret-value/u);

    const prefixedAssignments = [
      "AWS_SECRET_ACCESS_KEY=aws-value-must-not-leak",
      "MY_API_KEY: custom-value-must-not-leak",
      "MYAPIKEY=compact-suffix-value-must-not-leak",
      "//registry.npmjs.org/:_authToken=npm-value-must-not-leak",
    ];
    for (const secretAssignment of prefixedAssignments) {
      const prefixed = draft();
      prefixed.constraints[0].rationale = secretAssignment;
      let error;
      try {
        buildFinalIntent(prefixed, baseline());
      } catch (caught) {
        error = caught;
      }
      assert.match(error?.message ?? "", /contains suspected secret assignment/u);
      assert.doesNotMatch(error.message, /value-must-not-leak/u);
    }

    const safeReference = draft();
    safeReference.constraints[0].rationale = "MY_API_KEY = process.env.MY_API_KEY";
    assert.doesNotThrow(() => buildFinalIntent(safeReference, baseline()));

    const safePlaceholder = draft();
    safePlaceholder.constraints[0].rationale = "access_token = ${ACCESS_TOKEN}";
    assert.doesNotThrow(() => buildFinalIntent(safePlaceholder, baseline()));

    const safeCall = draft();
    safeCall.constraints[0].rationale = "password = hash(input)";
    assert.doesNotThrow(() => buildFinalIntent(safeCall, baseline()));

    for (const unsafeAssignment of [
      "password = multiword value must-not-leak",
      'password = reveal("call literal must-not-leak")',
      'password = reveal ("spaced call literal must-not-leak")',
      'password = reveal("call value") + trailing must-not-leak',
    ]) {
      const unsafe = draft();
      unsafe.constraints[0].rationale = unsafeAssignment;
      let error;
      try {
        buildFinalIntent(unsafe, baseline());
      } catch (caught) {
        error = caught;
      }
      assert.match(error?.message ?? "", /contains suspected secret assignment/u);
      assert.doesNotMatch(error.message, /must-not-leak/u);
    }

    const continuedAssignments = [
      'password =\n  "plain-continuation-must-not-leak"',
      '+password =\n+  "addition-continuation-must-not-leak"',
      "-password =\n-  'deletion-continuation-must-not-leak'",
      ' password =\n   "context-continuation-must-not-leak"',
      'password =\r\n  "crlf-continuation-must-not-leak"\r\n',
      ' password =\n-  "old-context-must-not-leak"\n+  "new-context-must-not-leak"',
      ' password =\n-  "removed-only-context-must-not-leak"\n next',
      ' password =\n+  "added-only-context-must-not-leak"\n next',
      'password = reveal (\n  "multiline-call-must-not-leak"\n)',
      ' password = reveal(\n-  "old-call-must-not-leak"\n+  "new-call-must-not-leak"',
    ];
    for (const continuedAssignment of continuedAssignments) {
      const continued = draft();
      continued.constraints[0].rationale = continuedAssignment;
      let error;
      try {
        buildFinalIntent(continued, baseline());
      } catch (caught) {
        error = caught;
      }
      assert.match(error?.message ?? "", /contains suspected secret assignment/u);
      assert.doesNotMatch(error.message, /continuation-must-not-leak/u);
    }

    for (const safeContinuation of [
      'password =\n  config?.["PASSWORD"]',
      'password =\r\n  config?.["PASSWORD"]\r\n',
      'password =\n  ""',
      "password = hash (input)",
      "password = hash(\n  input\n)",
      '+password =\n-  "mismatched-marker-literal"',
      'password =\n-  "unmarked-transition-literal"\n+  "unmarked-transition-new"',
    ]) {
      const continued = draft();
      continued.constraints[0].rationale = safeContinuation;
      assert.doesNotThrow(() => buildFinalIntent(continued, baseline()));
    }

    const bracketedAssignments = [
      {
        text: '+os.environ["API_KEY"] = "python-bracket-literal"',
        literal: "python-bracket-literal",
      },
      {
        text: "-process.env['API_KEY'] = 'javascript-bracket-literal'",
        literal: "javascript-bracket-literal",
      },
      {
        text: '{ ["password"]: "computed-object-literal" }',
        literal: "computed-object-literal",
      },
      {
        text: "+{['API_KEY']='computed-map-literal'}",
        literal: "computed-map-literal",
      },
      {
        text: 'credentials?.["password"] = "optional-chain-literal"',
        literal: "optional-chain-literal",
      },
      {
        text: 'credentials["nested"]["password"] = "nested-container-sentinel"',
        literal: "nested-container-sentinel",
      },
      {
        text: 'getCredentials()["password"] = "call-result-sentinel"',
        literal: "call-result-sentinel",
      },
      {
        text: '(credentials)["password"] = "parenthesized-container-sentinel"',
        literal: "parenthesized-container-sentinel",
      },
      {
        text: 'credentials["pass\\u0077ord"] = "unicode-key-sentinel"',
        literal: "unicode-key-sentinel",
      },
      {
        text: 'credentials["pass\\x77ord"] = "hex-key-sentinel"',
        literal: "hex-key-sentinel",
      },
      {
        text: "credentials[`password`] = `backtick-rhs-sentinel`",
        literal: "backtick-rhs-sentinel",
      },
      {
        text: 'credentials["password"] = "process.env.PASSWORD-quoted-sentinel"',
        literal: "process.env.PASSWORD-quoted-sentinel",
      },
      {
        text: 'credentials["password"] = "process.env.PASSWORD"',
        literal: "process.env.PASSWORD",
      },
    ];
    for (const { text, literal } of bracketedAssignments) {
      const bracketed = draft();
      bracketed.constraints[0].rationale = text;
      let error;
      try {
        buildFinalIntent(bracketed, baseline());
      } catch (caught) {
        error = caught;
      }
      assert.match(error?.message ?? "", /contains suspected secret assignment/u);
      assert.doesNotMatch(error.message, new RegExp(literal, "u"));
    }

    const safeBracketReferences = [
      'process.env["API_KEY"] = process.env["SOURCE_API_KEY"]',
      "os.environ['API_KEY'] = os.environ['SOURCE_API_KEY']",
      '{ ["password"]: process.env["PASSWORD"] }',
      'credentials?.["password"] = config["PASSWORD"]',
      'credentials["password"] = config?.["PASSWORD"]',
      'credentials["password"] = config?.password',
      'credentials["password"] = "[REDACTED]"',
      "credentials[`password`] = `${PASSWORD}`",
      'credentials["password"] === candidate',
      'credentials["password"] == candidate',
      'credentials["password"] => candidate',
    ];
    for (const safeExpression of safeBracketReferences) {
      const safeBracket = draft();
      safeBracket.constraints[0].rationale = safeExpression;
      assert.doesNotThrow(() => buildFinalIntent(safeBracket, baseline()));
    }
  });
});

test("finalizes only a clean committed baseline into a private unique temp bundle", async (t) => {
  const root = await makeRepository(t);
  const first = await finalizeIntentDraft(draft(), { root });
  const second = await finalizeIntentDraft(draft(), { root });
  t.after(async () => await rm(first.directory, { recursive: true, force: true }));
  t.after(async () => await rm(second.directory, { recursive: true, force: true }));

  const expectedHead = (await git(root, "rev-parse", "HEAD")).stdout.trim();
  assert.equal(first.intent.baseline.head, expectedHead);
  assert.equal(first.intent.baseline.workingTree, "clean");
  assert.equal(path.basename(first.directory).startsWith("hope-align-"), true);
  assert.equal(first.path, path.join(first.directory, "intent.json"));
  assert.notEqual(first.directory, second.directory);
  assert.equal(mode(await stat(first.directory)), 0o700);
  assert.equal(mode(await stat(first.path)), 0o600);

  const written = JSON.parse(await readFile(first.path, "utf8"));
  assert.deepEqual(written, first.intent);
  assert.equal(calculateIntentFingerprint(written), written.fingerprint);
});

test("refuses dirty or unborn repositories", async (t) => {
  const dirtyRoot = await makeRepository(t);
  await writeFile(path.join(dirtyRoot, "untracked.txt"), "work in progress\n");
  await assert.rejects(
    finalizeIntentDraft(draft(), { root: dirtyRoot }),
    /only from a clean working tree/u,
  );

  const unbornRoot = await makeRepository(t, { commit: false });
  await assert.rejects(captureCleanBaseline(unbornRoot), /Unable to inspect|valid HEAD/u);
});

test("refuses hidden index flags without exposing paths or mutating the index", async (t) => {
  const cases = [
    { label: "skip-worktree", flags: ["--skip-worktree"] },
    { label: "assume-unchanged", flags: ["--assume-unchanged"] },
    {
      label: "both flags",
      flags: ["--skip-worktree", "--assume-unchanged"],
    },
  ];

  for (const { label, flags } of cases) {
    await t.test(label, async (t) => {
      const root = await makeRepository(t);
      const hiddenPath = "customer-merger-plan.txt";
      await writeFile(path.join(root, hiddenPath), "committed\n");
      await git(root, "add", hiddenPath);
      await git(root, "commit", "-q", "-m", "add hidden fixture");
      await git(root, "update-index", ...flags, "--", hiddenPath);
      await writeFile(path.join(root, hiddenPath), "dirty but hidden\n");

      assert.equal((await git(root, "status", "--porcelain=v1")).stdout, "");
      const before = (await git(root, "ls-files", "-v", "--", hiddenPath)).stdout;
      assert.match(before, /^(?:S|[a-z]) /u);

      await assert.rejects(
        captureCleanBaseline(root),
        (error) =>
          /skip-worktree or assume-unchanged index flags/u.test(error.message) &&
          !error.message.includes(hiddenPath),
      );

      const after = (await git(root, "ls-files", "-v", "--", hiddenPath)).stdout;
      assert.equal(after, before);
      assert.equal(await readFile(path.join(root, hiddenPath), "utf8"), "dirty but hidden\n");
    });
  }
});

test("loads only bounded regular UTF-8 JSON drafts", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "hope-align-input-test-"));
  t.after(async () => await rm(root, { recursive: true, force: true }));

  const validPath = path.join(root, "draft.json");
  await writeFile(validPath, JSON.stringify(draft()));
  await chmod(validPath, 0o600);
  assert.deepEqual(await loadIntentDraft(validPath), draft());

  const oversizedPath = path.join(root, "oversized.json");
  await writeFile(oversizedPath, Buffer.alloc(MAX_DRAFT_BYTES + 1, 0x20));
  await chmod(oversizedPath, 0o600);
  await assert.rejects(loadIntentDraft(oversizedPath), /exceeds the 262144-byte limit/u);

  const invalidUtf8Path = path.join(root, "invalid-utf8.json");
  await writeFile(invalidUtf8Path, Buffer.from([0xff, 0xfe]));
  await chmod(invalidUtf8Path, 0o600);
  await assert.rejects(loadIntentDraft(invalidUtf8Path), /not valid UTF-8/u);

  if (process.platform !== "win32") {
    const permissivePath = path.join(root, "permissive.json");
    await writeFile(permissivePath, JSON.stringify(draft()));
    await chmod(permissivePath, 0o640);
    await assert.rejects(
      loadIntentDraft(permissivePath),
      /must not grant any group or other permissions/u,
    );
  }

  const symlinkPath = path.join(root, "draft-link.json");
  await symlink(validPath, symlinkPath);
  assert.equal((await lstat(symlinkPath)).isSymbolicLink(), true);
  await assert.rejects(loadIntentDraft(symlinkPath), /not a regular file/u);
});

test("rejects ignored draft and temp real paths inside the target repository", async (t) => {
  const root = await makeRepository(t);
  await writeFile(path.join(root, ".gitignore"), ".private/\n");
  await git(root, "add", ".gitignore");
  await git(root, "commit", "-q", "-m", "ignore private test state");

  const privateRoot = path.join(root, ".private");
  await mkdir(privateRoot);
  const ignoredDraftPath = path.join(privateRoot, "draft.json");
  await writeFile(ignoredDraftPath, JSON.stringify(draft()));
  await chmod(ignoredDraftPath, 0o600);
  assert.equal((await git(root, "status", "--porcelain")).stdout, "");

  await assert.rejects(
    loadIntentDraft(ignoredDraftPath, { repositoryRoot: root }),
    /real path must be outside the target repository/u,
  );
  await assert.rejects(
    finalizeIntentDraft(draft(), { root, temporaryRoot: privateRoot }),
    /temporary root real path must be outside the target repository/u,
  );
  assert.deepEqual(
    (await readdir(privateRoot)).filter((name) => name.startsWith("hope-align-")),
    [],
  );
});

test("deletes output when the repository changes after writing", async (t) => {
  const root = await makeRepository(t);
  let outputDirectory;
  await assert.rejects(
    finalizeIntentDraft(draft(), {
      root,
      afterWrite: async (output) => {
        outputDirectory = output.directory;
        await writeFile(path.join(root, "raced-change.txt"), "changed after output\n");
      },
    }),
    /repository changed after Hope wrote the intent/u,
  );
  assert.notEqual(outputDirectory, undefined);
  await assert.rejects(lstat(outputDirectory), (error) => error.code === "ENOENT");
});

test("parses the narrow finalizer CLI", () => {
  assert.deepEqual(parseFinalizeArguments(["--input", "draft.json", "--root", "."]), {
    input: "draft.json",
    root: ".",
    help: false,
  });
  assert.deepEqual(parseFinalizeArguments(["--help"]), {
    input: undefined,
    root: undefined,
    help: true,
  });
  assert.throws(() => parseFinalizeArguments(["--input", "draft.json"]), /--root is required/u);
  assert.throws(() => parseFinalizeArguments(["--output", "intent.json"]), /Unknown argument/u);
});
