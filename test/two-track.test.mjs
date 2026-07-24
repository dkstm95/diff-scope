import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DIFF_MODEL_ADAPTER_CODE,
  DIFF_MODEL_ADAPTER_MESSAGE,
  runDiff,
} from "../features/diff/index.mjs";
import { parseDiffArguments } from "../features/diff/cli.mjs";
import { main, parseArguments } from "../harness/hope.mjs";
import { normalizeLineEndings } from "../tools/build-plugin.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));

test("generated plugin text uses the same line endings on every system", () => {
  assert.equal(normalizeLineEndings("one\r\ntwo\rthree\n"), "one\ntwo\nthree\n");
});

test("the harness parses independent diff and settings entries", () => {
  assert.deepEqual(parseArguments(["diff"]), {
    arguments: [],
    command: "diff",
  });
  assert.deepEqual(parseArguments(["settings", "show"]), {
    arguments: ["show"],
    command: "settings",
  });
  assert.deepEqual(parseDiffArguments([
    "prepare",
    "https://github.com/example/repo/pull/1",
    "--locale",
    "ko-KR",
  ]), {
    command: "prepare",
    hostLocale: undefined,
    locale: "ko-KR",
    outputPath: undefined,
    theme: undefined,
    url: "https://github.com/example/repo/pull/1",
  });
});

test("the harness reports the package version", async () => {
  let output = "";
  await main(["--version"], {
    stdout: {
      write(value) {
        output += value;
      },
    },
  });
  assert.equal(output, `${packageJson.version}\n`);
});

test("the independent harness does not pretend to have an AI adapter", () => {
  assert.throws(runDiff, (error) => {
    assert.equal(error.code, DIFF_MODEL_ADAPTER_CODE);
    assert.equal(error.message, DIFF_MODEL_ADAPTER_MESSAGE);
    return true;
  });
});

test("the harness delegates diff and settings to shared commands", async () => {
  const received = [];
  await main(["diff"], {
    runDiffCommand: async (arguments_) => received.push(["diff", arguments_]),
  });
  await main(["settings", "show"], {
    runSettingsCommand: async (arguments_) => received.push(["settings", arguments_]),
  });
  assert.deepEqual(received, [
    ["diff", ["automatic"]],
    ["settings", ["show"]],
  ]);
});

test("Codex and Claude Code share one diff skill and one settings skill", async () => {
  const diffDirectory = resolve(root, "plugins/hope/skills/diff");
  const settingsDirectory = resolve(root, "plugins/hope/skills/settings");
  const diff = await readFile(resolve(diffDirectory, "SKILL.md"), "utf8");
  const settings = await readFile(resolve(settingsDirectory, "SKILL.md"), "utf8");
  const codexPlugin = JSON.parse(await readFile(
    resolve(root, "plugins/hope/.codex-plugin/plugin.json"),
    "utf8",
  ));
  const claudePlugin = JSON.parse(await readFile(
    resolve(root, "plugins/hope/.claude-plugin/plugin.json"),
    "utf8",
  ));

  await access(resolve(root, "plugins/hope/runtime/features/diff/cli.mjs"));
  await access(resolve(root, "plugins/hope/runtime/settings/cli.mjs"));
  assert.equal(codexPlugin.skills, "./skills/");
  assert.equal(claudePlugin.skills, "./skills/");
  assert.match(diff, /runtime\/features\/diff\/cli\.mjs/u);
  assert.match(diff, /\$\{CLAUDE_PLUGIN_ROOT\}/u);
  assert.match(diff, /Use `coreChange\.details` for the main explanation/u);
  assert.match(diff, /Add `contextChecks`/u);
  assert.match(diff, /Make each claim no broader than its evidence/u);
  assert.match(settings, /runtime\/settings\/cli\.mjs/u);
});

test("the harness and generated runtime report the same missing AI boundary", () => {
  const harness = spawnSync(
    process.execPath,
    [resolve(root, "harness/hope.mjs"), "diff"],
    { encoding: "utf8" },
  );
  const plugin = spawnSync(
    process.execPath,
    [resolve(root, "plugins/hope/runtime/features/diff/cli.mjs"), "automatic"],
    { encoding: "utf8" },
  );
  assert.equal(harness.status, 2);
  assert.equal(plugin.status, 2);
  assert.match(harness.stderr, new RegExp(DIFF_MODEL_ADAPTER_MESSAGE, "u"));
  assert.match(plugin.stderr, new RegExp(DIFF_MODEL_ADAPTER_MESSAGE, "u"));
});

test("the harness and plugin share one global settings file", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "hope-two-track-settings-"));
  const environment = { ...process.env, HOPE_CONFIG_HOME: configHome };
  const saved = spawnSync(
    process.execPath,
    [
      resolve(root, "harness/hope.mjs"),
      "settings",
      "set",
      "locale",
      "ko-KR",
    ],
    { encoding: "utf8", env: environment },
  );
  assert.equal(saved.status, 0, saved.stderr);
  const shown = spawnSync(
    process.execPath,
    [resolve(root, "plugins/hope/runtime/settings/cli.mjs"), "show"],
    { encoding: "utf8", env: environment },
  );
  assert.equal(shown.status, 0, shown.stderr);
  assert.match(shown.stdout, /언어: ko-KR/u);
  assert.match(shown.stdout, /언어 선택 기준: 저장된 설정/u);
});

test("release checks bind versions only for tag builds", () => {
  const checkRelease = resolve(root, "tools/check-release.mjs");
  const runCheck = (githubEnvironment) => spawnSync(
    process.execPath,
    [checkRelease],
    {
      encoding: "utf8",
      env: { ...process.env, ...githubEnvironment },
    },
  );

  const pullRequest = runCheck({
    GITHUB_REF_NAME: "7/merge",
    GITHUB_REF_TYPE: "branch",
  });
  const release = runCheck({
    GITHUB_REF_NAME: `v${packageJson.version}`,
    GITHUB_REF_TYPE: "tag",
  });
  const wrongRelease = runCheck({
    GITHUB_REF_NAME: "v0.0.0-wrong",
    GITHUB_REF_TYPE: "tag",
  });

  assert.equal(pullRequest.status, 0, pullRequest.stderr);
  assert.equal(release.status, 0, release.stderr);
  assert.notEqual(wrongRelease.status, 0);
});
