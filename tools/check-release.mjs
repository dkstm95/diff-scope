#!/usr/bin/env node

import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const fromRoot = (relativePath) => new URL(relativePath, root);
const read = async (relativePath) => await readFile(fromRoot(relativePath), "utf8");
const readJson = async (relativePath) => JSON.parse(await read(relativePath));

const requiredFiles = [
  ".agents/plugins/marketplace.json",
  "plugins/diff-scope/.codex-plugin/plugin.json",
  "plugins/diff-scope/LICENSE",
  "plugins/diff-scope/assets/telescope.svg",
  "plugins/diff-scope/skills/diff/SKILL.md",
  "plugins/diff-scope/skills/diff/agents/openai.yaml",
  "plugins/diff-scope/skills/diff/assets/telescope.svg",
  "plugins/diff-scope/skills/diff/references/artifact-contract.md",
  "plugins/diff-scope/skills/diff/references/artifact-v1.schema.json",
  "plugins/diff-scope/skills/diff/references/change-context-v1.schema.json",
  "plugins/diff-scope/skills/diff/scripts/collect-change-context.mjs",
  "plugins/diff-scope/skills/diff/scripts/render-diff.mjs",
  "README.md",
  "README.ko.md",
  "LICENSE",
];

await Promise.all(requiredFiles.map(async (file) => await access(fromRoot(file))));

const [packageJson, plugin, marketplace, artifactSchema, contextSchema, skill, readme] =
  await Promise.all([
    readJson("package.json"),
    readJson("plugins/diff-scope/.codex-plugin/plugin.json"),
    readJson(".agents/plugins/marketplace.json"),
    readJson("plugins/diff-scope/skills/diff/references/artifact-v1.schema.json"),
    readJson("plugins/diff-scope/skills/diff/references/change-context-v1.schema.json"),
    read("plugins/diff-scope/skills/diff/SKILL.md"),
    read("README.md"),
  ]);

assert.equal(packageJson.name, "diff-scope");
assert.equal(packageJson.version, plugin.version);
assert.equal(plugin.name, "diff-scope");
assert.equal(plugin.skills, "./skills/");
assert.equal(marketplace.name, "diff-scope");
assert.ok(
  marketplace.plugins.some(
    (entry) => entry.name === "diff-scope" && entry.source.path === "./plugins/diff-scope",
  ),
);
assert.match(skill, /^---\r?\nname: diff\r?\ndescription: /u);
assert.doesNotMatch(skill, /\[TODO:|understand-change|change-understanding/u);
assert.equal(contextSchema.properties.scope.properties.kind.const, "working-tree");
assert.equal(contextSchema.properties.scope.properties.includeUntrackedBodies.const, true);
assert.equal(artifactSchema.properties.schemaVersion.const, 1);
assert.match(readme, /\$diff/u);
assert.match(readme, new RegExp(`v${packageJson.version.replaceAll(".", "\\.")}`, "u"));

console.log(`DiffScope ${packageJson.version} release metadata is consistent.`);
