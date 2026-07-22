import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DIFF_REBUILD_CODE,
  DIFF_REBUILD_MESSAGE,
  runDiff,
} from "../features/diff/index.mjs";
import { parseDiffArguments } from "../features/diff/cli.mjs";
import { main, parseArguments } from "../harness/hope.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("the harness parses its independent diff entry", () => {
  assert.deepEqual(parseArguments(["diff"]), {
    arguments: [],
    command: "diff",
  });
  assert.deepEqual(parseDiffArguments([]), {});
  assert.throws(
    () => parseDiffArguments(["--url", "https://github.com/example/repo/pull/1"]),
    /does not accept arguments while it is being rebuilt/u,
  );
});

test("the retired diff cannot run through the shared feature boundary", () => {
  assert.throws(runDiff, (error) => {
    assert.equal(error.code, DIFF_REBUILD_CODE);
    assert.equal(error.message, DIFF_REBUILD_MESSAGE);
    return true;
  });
});

test("the harness delegates diff to the shared feature boundary", async () => {
  let received;
  const expected = { status: "test" };
  const result = await main(
    ["diff"],
    {
      runDiffCommand: async (arguments_) => {
        received = arguments_;
        return expected;
      },
    },
  );
  assert.equal(result, expected);
  assert.deepEqual(received, []);
});

test("Codex and Claude Code share one skill and generated command", async () => {
  const skillDirectory = resolve(root, "plugins/hope/skills/diff");
  const featureCommand = resolve(skillDirectory, "../../runtime/diff/cli.mjs");
  const skill = await readFile(resolve(skillDirectory, "SKILL.md"), "utf8");
  const codexPlugin = JSON.parse(await readFile(
    resolve(root, "plugins/hope/.codex-plugin/plugin.json"),
    "utf8",
  ));
  const claudePlugin = JSON.parse(await readFile(
    resolve(root, "plugins/hope/.claude-plugin/plugin.json"),
    "utf8",
  ));
  const claudeMarketplace = JSON.parse(await readFile(
    resolve(root, ".claude-plugin/marketplace.json"),
    "utf8",
  ));

  await access(featureCommand);
  assert.equal(codexPlugin.skills, "./skills/");
  assert.equal(claudePlugin.skills, "./skills/");
  assert.ok(claudeMarketplace.plugins.some(
    (entry) => entry.name === "hope" && entry.source === "./plugins/hope",
  ));
  assert.match(skill, /\.\.\/\.\.\/runtime\/diff\/cli\.mjs/u);
  assert.match(skill, /\$\{CLAUDE_PLUGIN_ROOT\}\/runtime\/diff\/cli\.mjs/u);
});

test("the harness and skill command stop at the same rebuild boundary", () => {
  const harness = spawnSync(process.execPath, [resolve(root, "harness/hope.mjs"), "diff"], {
    encoding: "utf8",
  });
  const skillCommand = spawnSync(
    process.execPath,
    [resolve(root, "plugins/hope/runtime/diff/cli.mjs")],
    { encoding: "utf8" },
  );

  assert.equal(harness.status, 2);
  assert.equal(skillCommand.status, 2);
  assert.match(harness.stderr, new RegExp(DIFF_REBUILD_MESSAGE, "u"));
  assert.match(skillCommand.stderr, new RegExp(DIFF_REBUILD_MESSAGE, "u"));
});
