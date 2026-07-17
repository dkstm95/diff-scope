import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  renderExplanationMarkdown,
  renderIndexHtml,
  renderUnderstandingBundle,
} from "../plugins/hope/skills/diff/scripts/lib/render-artifact.mjs";
import {
  ArtifactValidationError,
  ContextBindingError,
  IntentBindingError,
  calculateChangeContextFingerprint,
  collectChangeContextIssues,
  validateArtifact,
  validateArtifactAgainstContext,
  validateArtifactAgainstIntent,
} from "../plugins/hope/skills/diff/scripts/lib/validate-artifact.mjs";
import {
  assertLiveContextMatches,
  parseRenderArguments,
} from "../plugins/hope/skills/diff/scripts/render-diff.mjs";
import { calculateIntentFingerprint } from "../plugins/hope/skills/align/scripts/lib/validate-intent.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(testDirectory, "fixtures", "artifact-v2.json");

async function fixture() {
  return JSON.parse(await readFile(fixturePath, "utf8"));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mode(value) {
  return value.mode & 0o777;
}

function renderBound(artifact, options = {}) {
  const context = contextForArtifact(artifact);
  bindArtifact(artifact, context);
  return renderUnderstandingBundle(artifact, {
    ...options,
    context,
    intent: Object.hasOwn(options, "intent") ? options.intent : artifact.intent?.snapshot,
  });
}

function contextForArtifact(artifact, options = {}) {
  const files = artifact.change.files.map((file) => ({
    path: file.path,
    status: "modified",
    source: "tracked",
    additions: 1,
    deletions: 1,
    bodyIncluded: true,
  }));
  if (options.files) {
    files.push(...clone(options.files));
  }
  const warnings = clone(options.warnings ?? artifact.change.context.warnings);
  const excluded = clone(options.excluded ?? artifact.change.context.excluded);
  const complete =
    options.complete ??
    (artifact.change.context.complete &&
      warnings.length === 0 &&
      excluded.length === 0 &&
      files.every((file) => file.bodyIncluded));
  const context = {
    schemaVersion: 2,
    baseCommit: "1".repeat(40),
    scope: {
      kind: "working-tree",
      comparison:
        options.comparison ?? "HEAD -> working tree (staged + unstaged + safe untracked)",
      includeUntrackedBodies: true,
    },
    complete,
    summary: {
      discoveredFiles: files.length,
      representedFiles: files.length,
      includedBodies: files.filter((file) => file.bodyIncluded).length,
      omittedBodies: files.filter((file) => !file.bodyIncluded).length,
      additions: files.reduce((total, file) => total + (file.additions ?? 0), 0),
      deletions: files.reduce((total, file) => total + (file.deletions ?? 0), 0),
      changedLines: files.reduce(
        (total, file) =>
          total + (file.bodyIncluded ? (file.additions ?? 0) + (file.deletions ?? 0) : 0),
        0,
      ),
      contextBytes: 0,
    },
    files,
    patches: files
      .filter((file) => file.bodyIncluded)
      .map((file) => ({ path: file.path, kind: "diff", text: `diff for ${file.path}` })),
    excluded,
    warnings,
  };
  context.summary.contextBytes = context.patches.reduce(
    (total, patch) => total + Buffer.byteLength(patch.text, "utf8"),
    0,
  );
  context.fingerprint = calculateChangeContextFingerprint(context);
  return context;
}

function bindArtifact(artifact, context) {
  artifact.change.comparison = context.scope.comparison;
  artifact.change.context.baseCommit = context.baseCommit;
  artifact.change.context.fingerprint = context.fingerprint;
  artifact.change.context.complete = context.complete;
  artifact.change.context.warnings = clone(context.warnings);
  artifact.change.context.excluded = clone(context.excluded);
  return artifact;
}

test("validates a complete ArtifactV2 fixture", async () => {
  const artifact = await fixture();
  assert.equal(validateArtifact(artifact), artifact);
});

test("reports malformed intent as ArtifactValidationError without semantic crashes", async () => {
  const artifact = await fixture();
  artifact.intent = {};
  assert.throws(
    () => validateArtifact(artifact),
    (error) => error instanceof ArtifactValidationError && !/TypeError/u.test(error.name),
  );

  const malformedSnapshot = await fixture();
  malformedSnapshot.intent.snapshot = {};
  assert.throws(
    () => validateArtifact(malformedSnapshot),
    (error) => error instanceof ArtifactValidationError && !/TypeError/u.test(error.name),
  );
});

test("supports standalone diff with null intent and alignment", async () => {
  const artifact = await fixture();
  artifact.intent = null;
  artifact.alignment = null;
  artifact.explanation.decisions.forEach((decision) => {
    decision.source = "inferred";
  });
  artifact.knowledge.promotionCandidates.forEach((candidate) => {
    candidate.intentItemIds = [];
  });
  artifact.quiz.questions.forEach((question) => {
    question.intentItemIds = [];
  });
  artifact.microworld.intentItemIds = [];

  assert.equal(validateArtifact(artifact), artifact);
  assert.equal(validateArtifactAgainstIntent(artifact, undefined), artifact);
  assert.match(renderExplanationMarkdown(artifact), /No approved intent is linked/);
  assert.match(renderIndexHtml(artifact), /No approved intent is linked/);

  const questionLeak = clone(artifact);
  questionLeak.quiz.questions[0].intentItemIds = ["reject-invalid-request"];
  assert.throws(
    () => validateArtifact(questionLeak),
    /intentItemIds must be empty when \$\.intent is null/,
  );

  const microworldLeak = clone(artifact);
  microworldLeak.microworld.intentItemIds = ["reject-invalid-request"];
  assert.throws(
    () => validateArtifact(microworldLeak),
    /microworld\.intentItemIds must be empty when \$\.intent is null/,
  );
});

test("binds an embedded IntentV1 exactly and never rewrites it", async (t) => {
  const artifact = await fixture();
  assert.equal(validateArtifactAgainstIntent(artifact, artifact.intent.snapshot), artifact);
  assert.throws(() => validateArtifactAgainstIntent(artifact, undefined), IntentBindingError);

  await t.test("different valid intent", () => {
    const externalIntent = clone(artifact.intent.snapshot);
    externalIntent.goal = "다른 승인 목표";
    externalIntent.fingerprint = calculateIntentFingerprint(externalIntent);
    assert.throws(
      () => validateArtifactAgainstIntent(artifact, externalIntent),
      /does not match the supplied IntentV1/,
    );
  });

  await t.test("tampered embedded snapshot", () => {
    const candidate = clone(artifact);
    candidate.intent.snapshot.goal = "구현에 맞춰 사후 수정된 목표";
    assert.throws(() => validateArtifact(candidate), /embedded IntentV1 snapshot/);
  });
});

test("requires exact intent coverage and evidence-bound alignment", async (t) => {
  const artifact = await fixture();

  await t.test("missing intent item", () => {
    const candidate = clone(artifact);
    candidate.alignment.checks.pop();
    assert.throws(() => validateArtifact(candidate), /is missing intent item/);
  });

  await t.test("duplicate intent item", () => {
    const candidate = clone(artifact);
    candidate.alignment.checks[1].intentItemId =
      candidate.alignment.checks[0].intentItemId;
    assert.throws(() => validateArtifact(candidate), /duplicates intent item id/);
  });

  await t.test("unknown alignment evidence", () => {
    const candidate = clone(artifact);
    candidate.alignment.checks[0].evidencePaths = ["src/not-collected.mjs"];
    assert.throws(() => validateArtifact(candidate), /references an unknown file/);
  });

  await t.test("assessed check without evidence", () => {
    const candidate = clone(artifact);
    candidate.alignment.checks[0].evidencePaths = [];
    assert.throws(() => validateArtifact(candidate), /must cite code evidence/);
  });

  await t.test("not-assessable check without evidence", () => {
    const candidate = clone(artifact);
    candidate.alignment.checks[0].status = "not-assessable";
    candidate.alignment.checks[0].evidencePaths = [];
    assert.doesNotThrow(() => validateArtifact(candidate));
  });

  await t.test("approved decision must be verbatim intent evidence", () => {
    const candidate = clone(artifact);
    candidate.explanation.decisions[0].decision = "구현을 보고 다시 표현한 결정";
    assert.throws(() => validateArtifact(candidate), /must exactly match an IntentV1 decision/);
  });
});

test("keeps deviations unaccepted and validates knowledge promotion references", async (t) => {
  const artifact = await fixture();

  await t.test("deviation cannot claim structured acceptance", () => {
    const candidate = clone(artifact);
    candidate.alignment.deviations[0].reviewStatus = "accepted";
    assert.throws(() => validateArtifact(candidate), /must be needs-user-review/);
  });

  await t.test("promotion target is bounded", () => {
    const candidate = clone(artifact);
    candidate.knowledge.promotionCandidates[0].target = "generated-wiki";
    assert.throws(() => validateArtifact(candidate), /target must be test/);
  });

  await t.test("promotion intent reference exists", () => {
    const candidate = clone(artifact);
    candidate.knowledge.promotionCandidates[0].intentItemIds = ["unknown-intent"];
    assert.throws(() => validateArtifact(candidate), /references an unknown intent item/);
  });

  await t.test("promotion evidence is included", () => {
    const candidate = clone(artifact);
    candidate.knowledge.promotionCandidates[0].evidencePaths = ["docs/not-collected.md"];
    assert.throws(() => validateArtifact(candidate), /references an unknown file/);
  });
});

test("requires intent-bound teaching content when approved intent is present", async (t) => {
  const artifact = await fixture();

  await t.test("every quiz question declares its intent links", () => {
    const candidate = clone(artifact);
    delete candidate.quiz.questions[0].intentItemIds;
    assert.throws(() => validateArtifact(candidate), /intentItemIds is required/);
  });

  await t.test("generic quiz content with no intent link is rejected", () => {
    const candidate = clone(artifact);
    candidate.quiz.questions.forEach((question) => {
      question.intentItemIds = [];
    });
    assert.throws(
      () => validateArtifact(candidate),
      /at least one evidence-backed question linked to approved intent/,
    );
  });

  await t.test("quiz links must reference an approved intent item", () => {
    const candidate = clone(artifact);
    candidate.quiz.questions[0].intentItemIds = ["unknown-intent"];
    assert.throws(() => validateArtifact(candidate), /references an unknown intent item/);
  });

  await t.test("generic microworld content with no intent link is rejected", () => {
    const candidate = clone(artifact);
    candidate.microworld.intentItemIds = [];
    assert.throws(
      () => validateArtifact(candidate),
      /must link at least one approved outcome or constraint/,
    );
  });

  await t.test("microworld links are limited to outcomes and constraints", () => {
    const candidate = clone(artifact);
    candidate.microworld.intentItemIds = ["validate-at-router"];
    assert.throws(
      () => validateArtifact(candidate),
      /must reference an approved outcome or constraint/,
    );
  });

  await t.test("microworld links must reference an approved intent item", () => {
    const candidate = clone(artifact);
    candidate.microworld.intentItemIds = ["unknown-intent"];
    assert.throws(() => validateArtifact(candidate), /references an unknown intent item/);
  });
});

test("rejects high-confidence secrets in every artifact string", async (t) => {
  const artifact = await fixture();
  const secretCases = [
    ["PEM", "-----BEGIN RSA PRIVATE KEY-----"],
    ["provider token", "sk-proj-abcdefghijklmnopqrstuvwxyz1234567890"],
    ["Bearer", "Bearer abcdefghijklmnopqrstuvwxyz"],
    ["JWT", "eyJabcdefghij.abcdefghijk.abcdefghijk"],
    ["URL userinfo", "https://person:password@example.test/path"],
    ["JSON assignment", '{"private_key":"super-secret-material"}'],
    ["escaped JSON assignment", '{\\"private_key\\":\\"super-secret-material\\"}'],
    ["quoted private-key assignment", 'private_key = "literal-private-material"'],
    ["quoted expression is still literal", 'password = "hash(input)"'],
    ["prefixed AWS assignment", "MY_AWS_SECRET_ACCESS_KEY=literal-secret-material"],
    ["npm assignment", "npm_auth_token=literal-secret-material"],
    ["camel-case assignment", "serviceApiKey=literal-secret-material"],
    ["compact suffix assignment", "MYAPIKEY=artifact-compact-sentinel"],
    ["multiword bare value", "password = artifact multiword bare sentinel"],
    ["literal-bearing call", 'password = reveal("artifact call literal sentinel")'],
    ["spaced literal-bearing call", 'password = reveal ("artifact spaced call sentinel")'],
    [
      "literal-bearing call with suffix",
      'password = reveal("artifact call value") + artifact trailing sentinel',
    ],
    ["plain quoted continuation", 'password =\n  "artifact-plain-continuation-sentinel"'],
    ["CRLF quoted continuation", 'password =\r\n  "artifact-crlf-continuation-sentinel"\r\n'],
    [
      "addition quoted continuation",
      '+password =\n+  "artifact-addition-continuation-sentinel"',
    ],
    [
      "deletion quoted continuation",
      "-password =\n-  'artifact-deletion-continuation-sentinel'",
    ],
    [
      "context quoted continuation",
      ' password =\n   "artifact-context-continuation-sentinel"',
    ],
    [
      "context removal and addition",
      ' password =\n-  "artifact-old-context-sentinel"\n+  "artifact-new-context-sentinel"',
    ],
    [
      "context removal only",
      ' password =\n-  "artifact-removed-only-context-sentinel"\n next',
    ],
    [
      "context addition only",
      ' password =\n+  "artifact-added-only-context-sentinel"\n next',
    ],
    [
      "multiline call",
      'password = reveal (\n  "artifact-multiline-call-sentinel"\n)',
    ],
    [
      "context multiline call removal and addition",
      ' password = reveal(\n-  "artifact-old-call-sentinel"\n+  "artifact-new-call-sentinel"',
    ],
    [
      "bracketed Python assignment",
      '+os.environ["API_KEY"] = "artifact-python-bracket-literal"',
    ],
    [
      "bracketed JavaScript assignment with diff marker",
      "-process.env['API_KEY'] = 'artifact-javascript-bracket-literal'",
    ],
    ["computed object key", '{ ["password"]: "artifact-computed-literal" }'],
    ["computed map key", "+{['API_KEY']='artifact-computed-map-literal'}"],
    [
      "optional-chain bracket assignment",
      'credentials?.["password"] = "artifact-optional-chain-literal"',
    ],
    [
      "nested bracket container",
      'credentials["nested"]["password"] = "artifact-nested-sentinel"',
    ],
    ["call-result container", 'getCredentials()["password"] = "artifact-call-sentinel"'],
    [
      "parenthesized container",
      '(credentials)["password"] = "artifact-parenthesized-sentinel"',
    ],
    [
      "unicode-escaped static key",
      'credentials["pass\\u0077ord"] = "artifact-unicode-sentinel"',
    ],
    [
      "hex-escaped static key",
      'credentials["pass\\x77ord"] = "artifact-hex-sentinel"',
    ],
    ["backtick key and RHS", "credentials[`password`] = `artifact-backtick-sentinel`"],
    [
      "quoted reference-shaped literal",
      'credentials["password"] = "process.env.PASSWORD-artifact-quoted-sentinel"',
    ],
    [
      "exact quoted reference-shaped literal",
      'credentials["password"] = "process.env.PASSWORD"',
    ],
  ];

  for (const [label, secret] of secretCases) {
    await t.test(label, () => {
      const candidate = clone(artifact);
      candidate.explanation.goal = secret.includes("\n") ? secret : `민감 정보 ${secret}`;
      let error;
      try {
        validateArtifact(candidate);
      } catch (caught) {
        error = caught;
      }
      assert.match(error?.message ?? "", /contains suspected/u);
      if (secret.includes("sentinel")) {
        assert.doesNotMatch(error.message, /sentinel/u);
      }
    });
  }

  const bracketed = clone(artifact);
  bracketed.explanation.goal = '+process.env["API_KEY"] = "bundle-crossing-literal"';
  let bracketedError;
  try {
    validateArtifact(bracketed);
  } catch (error) {
    bracketedError = error;
  }
  assert.match(bracketedError?.message ?? "", /contains suspected secret assignment/u);
  assert.doesNotMatch(bracketedError.message, /bundle-crossing-literal/u);

  const redacted = clone(artifact);
  redacted.explanation.risks.push("문서 예시는 password=[REDACTED] 형식만 사용한다.");
  assert.doesNotThrow(() => validateArtifact(redacted));

  const safeExplanations = [
    "password = hash(input)",
    "password = hash (input)",
    "password = hash(\n  input\n)",
    'password =\n  config?.["PASSWORD"]',
    'password =\n  ""',
    '+password =\n-  "mismatched-marker-literal"',
    'password =\n-  "unmarked-transition-literal"\n+  "unmarked-transition-new"',
    '+password =\n-  "mismatched-transition-literal"\n+  "mismatched-transition-new"',
    "private_key = null",
    "secret = undefined",
    "client_secret = none",
    "api_key = false",
    "private_key = process.env.PRIVATE_KEY",
    "password = config.passwordHash",
    "access_token = ${ACCESS_TOKEN}",
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
  for (const explanation of safeExplanations) {
    const candidate = clone(artifact);
    candidate.explanation.goal = explanation;
    assert.doesNotThrow(() => validateArtifact(candidate), explanation);
  }
});

test("rejects unknown keys and unsafe or dangling references", async (t) => {
  const artifact = await fixture();

  await t.test("unknown keys", () => {
    const candidate = clone(artifact);
    candidate.explanation.goalHint = "not part of ArtifactV2";
    assert.throws(
      () => validateArtifact(candidate),
      (error) =>
        error instanceof ArtifactValidationError &&
        error.message.includes("$.explanation.goalHint is not allowed"),
    );
  });

  await t.test("unsafe evidence paths", () => {
    const candidate = clone(artifact);
    candidate.quiz.questions[0].evidencePaths[0] = "../private-key";
    assert.throws(() => validateArtifact(candidate), /must be a safe relative POSIX path/);
  });

  await t.test("disallowed text controls", () => {
    const candidate = clone(artifact);
    candidate.explanation.goal = "unsafe\u0001text";
    assert.throws(() => validateArtifact(candidate), /disallowed control character/);
  });

  await t.test("text length counts Unicode code points", () => {
    const accepted = clone(artifact);
    accepted.explanation.goal = "😀".repeat(4_000);
    assert.doesNotThrow(() => validateArtifact(accepted));

    const rejected = clone(artifact);
    rejected.explanation.goal = "😀".repeat(4_001);
    assert.throws(() => validateArtifact(rejected), /at most 4000 characters/);
  });

  await t.test("evidence paths outside the declared change", () => {
    const candidate = clone(artifact);
    candidate.quiz.questions[0].evidencePaths[0] = "src/unknown.mjs";
    assert.throws(() => validateArtifact(candidate), /references an unknown file/);
  });

  await t.test("unknown correct option ids", () => {
    const candidate = clone(artifact);
    candidate.quiz.questions[0].correctOptionIds = ["not-an-option"];
    assert.throws(() => validateArtifact(candidate), /references an unknown option/);
  });

  await t.test("duplicate ids", () => {
    const candidate = clone(artifact);
    candidate.quiz.questions[0].options[1].id = "router";
    assert.throws(() => validateArtifact(candidate), /duplicates option id/);
  });

  await t.test("quiz question count outside the advertised three-to-five range", () => {
    const tooFew = clone(artifact);
    tooFew.quiz.questions = tooFew.quiz.questions.slice(0, 2);
    assert.throws(() => validateArtifact(tooFew), /between 3 and 5 items/);

    const tooMany = clone(artifact);
    tooMany.quiz.questions.push(
      { ...clone(tooMany.quiz.questions[0]), id: "boundary-four" },
      { ...clone(tooMany.quiz.questions[0]), id: "boundary-five" },
      { ...clone(tooMany.quiz.questions[0]), id: "boundary-six" },
    );
    assert.throws(() => validateArtifact(tooMany), /between 3 and 5 items/);
  });
});

test("requires exact and bounded microworld cartesian coverage", async (t) => {
  const artifact = await fixture();

  await t.test("missing combination", () => {
    const candidate = clone(artifact);
    candidate.microworld.scenarios.pop();
    assert.throws(
      () => validateArtifact(candidate),
      (error) =>
        error instanceof ArtifactValidationError &&
        error.message.includes("is missing combination") &&
        error.message.includes("must contain exactly 4 scenarios"),
    );
  });

  await t.test("duplicate combination", () => {
    const candidate = clone(artifact);
    candidate.microworld.scenarios[3].when = clone(candidate.microworld.scenarios[2].when);
    assert.throws(() => validateArtifact(candidate), /duplicates another scenario combination/);
  });

  await t.test("more than twelve combinations", () => {
    const candidate = clone(artifact);
    candidate.microworld.controls.push({
      id: "client-kind",
      label: "클라이언트",
      defaultOptionId: "web",
      options: [
        { id: "web", text: "웹" },
        { id: "mobile", text: "모바일" },
        { id: "cli", text: "CLI" },
        { id: "worker", text: "워커" },
      ],
    });
    assert.throws(() => validateArtifact(candidate), /produce more than 12 combinations/);
  });

  await t.test("oversized controls never enter cartesian enumeration", () => {
    const candidate = clone(artifact);
    candidate.microworld.controls = Array.from({ length: 40 }, (_, controlIndex) => ({
      id: `control-${controlIndex}`,
      label: `컨트롤 ${controlIndex}`,
      defaultOptionId: "option-0",
      options: Array.from({ length: 40 }, (_, optionIndex) => ({
        id: `option-${optionIndex}`,
        text: `옵션 ${optionIndex}`,
      })),
    }));
    assert.throws(() => validateArtifact(candidate), /between 1 and 3 items/);
  });

  await t.test("oversized options never enter cartesian enumeration", () => {
    const candidate = clone(artifact);
    candidate.microworld.controls = Array.from({ length: 3 }, (_, controlIndex) => ({
      id: `control-${controlIndex}`,
      label: `컨트롤 ${controlIndex}`,
      defaultOptionId: "option-0",
      options: Array.from({ length: 1000 }, (_, optionIndex) => ({
        id: `option-${optionIndex}`,
        text: `옵션 ${optionIndex}`,
      })),
    }));
    assert.throws(() => validateArtifact(candidate), /between 2 and 4 items/);
  });
});

test("requires repository and context arguments for live CLI validation", () => {
  assert.throws(() => parseRenderArguments(["--input", "artifact.json"]), /--context is required/);
  assert.throws(
    () =>
      parseRenderArguments([
        "--input",
        "artifact.json",
        "--context",
        "change-context.json",
      ]),
    /--root is required/,
  );
  assert.deepEqual(
    parseRenderArguments([
      "--root",
      "repo",
      "--input",
      "artifact.json",
      "--context",
      "change-context.json",
    ]),
    {
      input: "artifact.json",
      context: "change-context.json",
      intent: undefined,
      root: "repo",
      output: undefined,
      help: false,
    },
  );
  assert.deepEqual(
    parseRenderArguments([
      "--input",
      "artifact.json",
      "--context",
      "change-context.json",
      "--root",
      "repo",
      "--intent",
      "intent.json",
    ]),
    {
      input: "artifact.json",
      context: "change-context.json",
      intent: "intent.json",
      root: "repo",
      output: undefined,
      help: false,
    },
  );
});

test("refuses stale or incomplete live CLI contexts", () => {
  const stored = {
    baseCommit: "1".repeat(40),
    fingerprint: "a".repeat(64),
    complete: true,
  };
  assert.equal(assertLiveContextMatches(stored, clone(stored)).fingerprint, stored.fingerprint);

  const incomplete = clone(stored);
  incomplete.complete = false;
  assert.throws(() => assertLiveContextMatches(stored, incomplete), /incomplete live context/);

  const stale = clone(stored);
  stale.fingerprint = "b".repeat(64);
  assert.throws(() => assertLiveContextMatches(stored, stale), /is stale/);
});

test("binds ArtifactV2 exactly to its untampered ChangeContextV2", async (t) => {
  const sourceArtifact = await fixture();
  const sourceContext = contextForArtifact(sourceArtifact);
  bindArtifact(sourceArtifact, sourceContext);
  assert.equal(validateArtifactAgainstContext(sourceArtifact, sourceContext), sourceArtifact);

  await t.test("tampered context digest", () => {
    const artifact = clone(sourceArtifact);
    const context = clone(sourceContext);
    context.files[0].status = "added";
    assert.throws(
      () => validateArtifactAgainstContext(artifact, context),
      /fingerprint does not match the context contents/,
    );
  });

  await t.test("wrong comparison", () => {
    const artifact = clone(sourceArtifact);
    artifact.change.comparison = "another range";
    assert.throws(
      () => validateArtifactAgainstContext(artifact, sourceContext),
      /comparison does not match/,
    );
  });

  await t.test("intent baseline differs from the collected base commit", () => {
    const artifact = clone(sourceArtifact);
    const context = clone(sourceContext);
    context.baseCommit = "2".repeat(40);
    context.fingerprint = calculateChangeContextFingerprint(context);
    bindArtifact(artifact, context);
    assert.throws(
      () => validateArtifactAgainstContext(artifact, context),
      /baseline.head does not match ChangeContextV2 baseCommit/,
    );
  });

  await t.test("unsupported commit range context", () => {
    const artifact = clone(sourceArtifact);
    const context = clone(sourceContext);
    context.scope.kind = "commit-range";
    context.fingerprint = calculateChangeContextFingerprint(context);
    artifact.change.context.fingerprint = context.fingerprint;
    assert.throws(
      () => validateArtifactAgainstContext(artifact, context),
      /scope.kind must be working-tree/,
    );
  });

  await t.test("wrong artifact fingerprint", () => {
    const artifact = clone(sourceArtifact);
    artifact.change.context.fingerprint = "b".repeat(64);
    assert.throws(
      () => validateArtifactAgainstContext(artifact, sourceContext),
      /fingerprint does not match ChangeContextV2/,
    );
  });

  await t.test("dropped warning", async () => {
    const artifact = await fixture();
    const context = contextForArtifact(artifact, { warnings: ["bounded context warning"] });
    bindArtifact(artifact, context);
    artifact.change.context.warnings = [];
    assert.throws(
      () => validateArtifactAgainstContext(artifact, context),
      /warnings do not exactly match/,
    );
  });

  await t.test("dropped exclusion", async () => {
    const artifact = await fixture();
    const context = contextForArtifact(artifact, {
      excluded: [{ path: "notes.txt", reason: "untracked-body-not-requested" }],
      files: [
        {
          path: "notes.txt",
          status: "untracked",
          source: "untracked",
          additions: null,
          deletions: null,
          bodyIncluded: false,
          omissionReason: "untracked-body-not-requested",
        },
      ],
    });
    bindArtifact(artifact, context);
    artifact.change.context.excluded = [];
    assert.throws(
      () => validateArtifactAgainstContext(artifact, context),
      /excluded does not exactly match/,
    );
  });

  await t.test("invented artifact file", () => {
    const artifact = clone(sourceArtifact);
    artifact.change.files.push({
      path: "src/invented.mjs",
      responsibility: "컨텍스트에 없는 파일",
    });
    assert.throws(
      () => validateArtifactAgainstContext(artifact, sourceContext),
      /without included ChangeContextV2 bodies/,
    );
  });

  await t.test("omitted included file", async () => {
    const artifact = await fixture();
    const context = contextForArtifact(artifact, {
      files: [
        {
          path: "src/extra.mjs",
          status: "added",
          source: "tracked",
          additions: 1,
          deletions: 0,
          bodyIncluded: true,
        },
      ],
    });
    bindArtifact(artifact, context);
    assert.throws(
      () => validateArtifactAgainstContext(artifact, context),
      /omits path\(s\) with included ChangeContextV2 bodies/,
    );
  });

  await t.test("malformed context shape", () => {
    const context = clone(sourceContext);
    context.files[0].bodyIncluded = "yes";
    assert.throws(
      () => validateArtifactAgainstContext(sourceArtifact, context),
      ContextBindingError,
    );
  });
});

test("validates ChangeContextV2 internal counts, body mapping, and canonical fingerprint", async (t) => {
  const artifact = await fixture();
  const context = contextForArtifact(artifact);
  assert.deepEqual(collectChangeContextIssues(context), []);

  const reordered = Object.fromEntries(Object.entries(context).reverse());
  assert.equal(
    calculateChangeContextFingerprint(reordered),
    calculateChangeContextFingerprint(context),
  );

  await t.test("summary count drift", () => {
    const candidate = clone(context);
    candidate.summary.includedBodies += 1;
    assert.ok(
      collectChangeContextIssues(candidate).some((issue) =>
        issue.includes("summary.includedBodies"),
      ),
    );
  });

  await t.test("included body without one patch", () => {
    const candidate = clone(context);
    candidate.patches.pop();
    candidate.summary.contextBytes = candidate.patches.reduce(
      (total, patch) => total + Buffer.byteLength(patch.text, "utf8"),
      0,
    );
    assert.ok(
      collectChangeContextIssues(candidate).some((issue) =>
        issue.includes("requires exactly one matching patch"),
      ),
    );
  });

  await t.test("patch kind disagrees with source", () => {
    const candidate = clone(context);
    candidate.patches[0].kind = "untracked";
    assert.ok(
      collectChangeContextIssues(candidate).some((issue) =>
        issue.includes("source requires matching patch kind"),
      ),
    );
  });

  await t.test("omission and exclusion disagree", () => {
    const candidate = clone(context);
    candidate.files[0].bodyIncluded = false;
    candidate.files[0].omissionReason = "size-limit";
    candidate.patches = candidate.patches.slice(1);
    candidate.excluded = [{ path: candidate.files[0].path, reason: "another-reason" }];
    candidate.complete = false;
    candidate.summary.includedBodies -= 1;
    candidate.summary.omittedBodies += 1;
    candidate.summary.changedLines -= 2;
    candidate.summary.contextBytes = candidate.patches.reduce(
      (total, patch) => total + Buffer.byteLength(patch.text, "utf8"),
      0,
    );
    assert.ok(
      collectChangeContextIssues(candidate).some((issue) =>
        issue.includes("omissionReason must exactly match"),
      ),
    );
  });

  await t.test("complete context cannot contain exclusions", () => {
    const candidate = clone(context);
    candidate.excluded = [{ path: "additional-files-not-enumerated", reason: "file-count-limit:1" }];
    assert.ok(
      collectChangeContextIssues(candidate).some((issue) =>
        issue.includes("complete cannot be true"),
      ),
    );
  });
});

test("refuses unbound or mismatched bundles before creating output", async (t) => {
  const artifact = await fixture();
  await assert.rejects(renderUnderstandingBundle(artifact), ContextBindingError);

  const context = contextForArtifact(artifact);
  bindArtifact(artifact, context);
  const parent = await mkdtemp(join(tmpdir(), "renderer-binding-test-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const missingIntentOutput = join(parent, "missing-intent");
  await assert.rejects(
    renderUnderstandingBundle(artifact, { context, outputDir: missingIntentOutput }),
    IntentBindingError,
  );
  await assert.rejects(lstat(missingIntentOutput), { code: "ENOENT" });

  artifact.change.context.fingerprint = "b".repeat(64);
  const output = join(parent, "mismatched-context");
  await assert.rejects(
    renderUnderstandingBundle(artifact, {
      context,
      intent: artifact.intent.snapshot,
      outputDir: output,
    }),
    ContextBindingError,
  );
  await assert.rejects(lstat(output), { code: "ENOENT" });
});

test("renders deterministic offline HTML with inert embedded data", async () => {
  const artifact = await fixture();
  artifact.explanation.goal = "경계를 확인한다 </script><script>alert('unsafe')</script> & \u2028";

  const first = renderIndexHtml(artifact);
  const second = renderIndexHtml(artifact);
  assert.equal(first, second);
  assert.match(first, /Hope · diff/);
  assert.match(first, /<html lang="en">/);
  assert.match(first, /Approved intent and actual change/);
  assert.match(first, /Knowledge promotion candidates/);
  assert.match(first, /Understanding quiz/);
  assert.match(first, /Microworld/);
  assert.match(first, /Linked approved intent/);
  assert.match(first, /appendIntentLinks\(fieldset, question\.intentItemIds\)/);
  assert.match(first, /artifact\.microworld\.intentItemIds/);
  assert.match(first, /경계를 확인한다/);
  assert.match(first, /id="base-commit"/);
  assert.match(first, /Content-Security-Policy/);
  assert.match(first, /script-src 'sha256-[A-Za-z0-9+/=]+'/);
  assert.match(first, /document\.createElement/);
  assert.match(first, /\.textContent/);
  assert.match(first, /correctOptionIds/);
  assert.match(first, /selected\.size === expected\.size/);
  assert.match(first, /candidate\.when\.find/);
  assert.doesNotMatch(first, /<\/script><script>alert\('unsafe'\)/);
  assert.match(first, /\\u003c\/script\\u003e\\u003cscript\\u003e/);
  assert.match(first, /\\u0026/);
  assert.doesNotMatch(first, /innerHTML/);
  assert.doesNotMatch(first, /\beval\s*\(/);
  assert.doesNotMatch(first, /\bfetch\s*\(/);
  assert.doesNotMatch(first, /new\s+Function/);
  assert.doesNotMatch(first, /https?:\/\//);

  const markdown = renderExplanationMarkdown(artifact);
  assert.match(markdown, /## Teaching intent links/);
  assert.match(markdown, /Quiz boundary: reject\\-invalid\\-request/);
  assert.match(markdown, /Microworld: reject\\-invalid\\-request/);
});

test("shows exact exclusions only when the context excluded something", async () => {
  const empty = await fixture();
  assert.doesNotMatch(renderExplanationMarkdown(empty), /### Excluded context/);
  assert.match(renderIndexHtml(empty), /id="context-exclusion-block" hidden/);

  const excluded = clone(empty);
  excluded.change.context.excluded = [
    { path: "notes.txt", reason: "untracked-body-not-requested" },
  ];
  const markdown = renderExplanationMarkdown(excluded);
  const html = renderIndexHtml(excluded);
  assert.match(markdown, /### Excluded context/);
  assert.ok(markdown.includes("notes\\.txt — untracked\\-body\\-not\\-requested"));
  assert.match(html, /exclusionBlock\.hidden = false/);
  assert.match(html, /notes\.txt/);
});

test("writes a private three-file bundle with no temporary leftovers", async (t) => {
  const artifact = await fixture();
  const parent = await mkdtemp(join(tmpdir(), "renderer-test-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const output = join(parent, "bundle");

  const result = await renderBound(artifact, { outputDir: output });
  assert.equal(result.directory, resolve(output));
  assert.deepEqual(await readdir(output), ["artifact.json", "explanation.md", "index.html"]);
  if (process.platform !== "win32") {
    assert.equal(mode(await stat(output)), 0o700);
    for (const filename of await readdir(output)) {
      assert.equal(mode(await stat(join(output, filename))), 0o600);
    }
  }
  assert.deepEqual(JSON.parse(await readFile(result.files.artifact, "utf8")), artifact);
  const explanation = await readFile(result.files.explanation, "utf8");
  assert.match(explanation, /## Intent alignment/);
  assert.match(explanation, /Base commit/);
  assert.match(explanation, /## Observable changes/);
  assert.match(explanation, /## Teaching intent links/);
  assert.match(explanation, /## Knowledge promotion candidates/);
  assert.match(explanation, /Hope does not modify the repository automatically/);
  assert.match(explanation, /잘못된 요청을 저장소 접근 전에/);
});

test("uses a private temporary directory by default", async (t) => {
  const result = await renderBound(await fixture());
  t.after(() => rm(result.directory, { recursive: true, force: true }));
  assert.equal(dirname(result.directory), resolve(tmpdir()));
  assert.match(basename(result.directory), /^hope-/u);
  if (process.platform !== "win32") {
    assert.equal(mode(await stat(result.directory)), 0o700);
  }
});

test("validates before creating output and refuses existing paths", async (t) => {
  const artifact = await fixture();
  const parent = await mkdtemp(join(tmpdir(), "renderer-refusal-test-"));
  t.after(() => rm(parent, { recursive: true, force: true }));

  const invalidOutput = join(parent, "invalid-output");
  const invalid = clone(artifact);
  invalid.schemaVersion = 1;
  await assert.rejects(renderBound(invalid, { outputDir: invalidOutput }), ArtifactValidationError);
  await assert.rejects(lstat(invalidOutput), { code: "ENOENT" });

  const existingOutput = join(parent, "existing-output");
  await mkdir(existingOutput);
  await assert.rejects(
    renderBound(artifact, { outputDir: existingOutput }),
    /Refusing to overwrite existing output path/,
  );

  const symlinkOutput = join(parent, "symlink-output");
  await symlink(existingOutput, symlinkOutput, "dir");
  await assert.rejects(
    renderBound(artifact, { outputDir: symlinkOutput }),
    /Refusing to overwrite existing output path/,
  );
});
