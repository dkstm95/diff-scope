import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  renderExplanationMarkdown,
  renderIndexHtml,
  renderUnderstandingBundle,
} from "../plugins/diff-scope/skills/diff/scripts/lib/render-artifact.mjs";
import {
  ArtifactValidationError,
  ContextBindingError,
  calculateChangeContextFingerprint,
  validateArtifact,
  validateArtifactAgainstContext,
} from "../plugins/diff-scope/skills/diff/scripts/lib/validate-artifact.mjs";
import { parseRenderArguments } from "../plugins/diff-scope/skills/diff/scripts/render-diff.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(testDirectory, "fixtures", "artifact-v1.json");

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
  const context = {
    schemaVersion: 1,
    scope: {
      kind: "working-tree",
      comparison:
        options.comparison ?? "HEAD -> working tree (staged + unstaged + safe untracked)",
      includeUntrackedBodies: true,
    },
    complete: options.complete ?? artifact.change.context.complete,
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
      contextBytes: 128,
    },
    files,
    patches: files
      .filter((file) => file.bodyIncluded)
      .map((file) => ({ path: file.path, kind: "diff", text: `diff for ${file.path}` })),
    excluded,
    warnings,
  };
  context.fingerprint = calculateChangeContextFingerprint(context);
  return context;
}

function bindArtifact(artifact, context) {
  artifact.change.comparison = context.scope.comparison;
  artifact.change.context.fingerprint = context.fingerprint;
  artifact.change.context.complete = context.complete;
  artifact.change.context.warnings = clone(context.warnings);
  artifact.change.context.excluded = clone(context.excluded);
  return artifact;
}

test("validates a complete ArtifactV1 fixture", async () => {
  const artifact = await fixture();
  assert.equal(validateArtifact(artifact), artifact);
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
  ];

  for (const [label, secret] of secretCases) {
    await t.test(label, () => {
      const candidate = clone(artifact);
      candidate.explanation.goal = `민감 정보 ${secret}`;
      assert.throws(() => validateArtifact(candidate), /contains suspected/);
    });
  }

  const redacted = clone(artifact);
  redacted.explanation.risks.push("문서 예시는 password=[REDACTED] 형식만 사용한다.");
  assert.doesNotThrow(() => validateArtifact(redacted));

  const safeExplanations = [
    "password = hash(input)",
    "private_key = null",
    "secret = undefined",
    "client_secret = none",
    "api_key = false",
    "private_key = process.env.PRIVATE_KEY",
    "password = config.passwordHash",
    "access_token = ${ACCESS_TOKEN}",
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
    candidate.explanation.goalHint = "not part of ArtifactV1";
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

test("requires the normal CLI context argument", () => {
  assert.throws(() => parseRenderArguments(["--input", "artifact.json"]), /--context is required/);
  assert.deepEqual(
    parseRenderArguments(["--input", "artifact.json", "--context", "change-context.json"]),
    {
      input: "artifact.json",
      context: "change-context.json",
      output: undefined,
      help: false,
    },
  );
});

test("binds ArtifactV1 exactly to its untampered ChangeContextV1", async (t) => {
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
      /fingerprint does not match ChangeContextV1/,
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
      /without included ChangeContextV1 bodies/,
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
      /omits path\(s\) with included ChangeContextV1 bodies/,
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

test("refuses unbound or mismatched bundles before creating output", async (t) => {
  const artifact = await fixture();
  await assert.rejects(renderUnderstandingBundle(artifact), ContextBindingError);

  const context = contextForArtifact(artifact);
  bindArtifact(artifact, context);
  artifact.change.context.fingerprint = "b".repeat(64);
  const parent = await mkdtemp(join(tmpdir(), "renderer-binding-test-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const output = join(parent, "bundle");
  await assert.rejects(
    renderUnderstandingBundle(artifact, { context, outputDir: output }),
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
});

test("shows exact exclusions only when the context excluded something", async () => {
  const empty = await fixture();
  assert.doesNotMatch(renderExplanationMarkdown(empty), /### 제외된 컨텍스트/);
  assert.match(renderIndexHtml(empty), /id="context-exclusion-block" hidden/);

  const excluded = clone(empty);
  excluded.change.context.excluded = [
    { path: "notes.txt", reason: "untracked-body-not-requested" },
  ];
  const markdown = renderExplanationMarkdown(excluded);
  const html = renderIndexHtml(excluded);
  assert.match(markdown, /### 제외된 컨텍스트/);
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
  assert.equal(mode(await stat(output)), 0o700);
  for (const filename of await readdir(output)) {
    assert.equal(mode(await stat(join(output, filename))), 0o600);
  }
  assert.deepEqual(JSON.parse(await readFile(result.files.artifact, "utf8")), artifact);
  assert.match(await readFile(result.files.explanation, "utf8"), /## 관찰 가능한 변화/);
});

test("uses a private temporary directory by default", async (t) => {
  const result = await renderBound(await fixture());
  t.after(() => rm(result.directory, { recursive: true, force: true }));
  assert.equal(dirname(result.directory), resolve(tmpdir()));
  assert.equal(mode(await stat(result.directory)), 0o700);
});

test("validates before creating output and refuses existing paths", async (t) => {
  const artifact = await fixture();
  const parent = await mkdtemp(join(tmpdir(), "renderer-refusal-test-"));
  t.after(() => rm(parent, { recursive: true, force: true }));

  const invalidOutput = join(parent, "invalid-output");
  const invalid = clone(artifact);
  invalid.schemaVersion = 2;
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
