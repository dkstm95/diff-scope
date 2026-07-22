#!/usr/bin/env node

import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

import {
  expectedPluginFile,
  normalizeLineEndings,
  pluginBundleEntries,
} from "./build-plugin.mjs";

const root = new URL("../", import.meta.url);
const fromRoot = (path) => new URL(path, root);
const read = async (path) => await readFile(fromRoot(path), "utf8");
const readJson = async (path) => JSON.parse(await read(path));
const currentVersion = "0.4.0-alpha";

const requiredFiles = [
  ".agents/plugins/marketplace.json",
  ".claude-plugin/marketplace.json",
  "docs/architecture.md",
  "docs/diff.md",
  "features/diff/cli.mjs",
  "features/diff/index.mjs",
  "harness/hope.mjs",
  "plugins/hope/.claude-plugin/plugin.json",
  "plugins/hope/.codex-plugin/plugin.json",
  "plugins/hope/LICENSE",
  "plugins/hope/assets/telescope.svg",
  "plugins/hope/docs/diff.md",
  "plugins/hope/runtime/diff/cli.mjs",
  "plugins/hope/runtime/diff/index.mjs",
  "plugins/hope/skills/diff/SKILL.md",
  "plugins/hope/skills/diff/agents/openai.yaml",
  "plugins/hope/skills/diff/assets/telescope.svg",
  "PRINCIPLES.md",
  "README.md",
  "README.ko.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "LICENSE",
];

const retiredPaths = [
  "DESIGN.md",
  "docs/design-research.md",
  "plugins/hope/runtime/cleanup/cleanup-plan.mjs",
  "plugins/hope/runtime/diff/diff-run.mjs",
  "plugins/hope/runtime/diff/latest-pull-request.mjs",
  "plugins/hope/skills/cleanup/SKILL.md",
  "plugins/hope/skills/diff/references/change-request-v1.schema.json",
  "plugins/hope/skills/diff/references/review-model-v1.schema.json",
  "plugins/hope/skills/diff/scripts/hope-diff.mjs",
];

await Promise.all(requiredFiles.map(async (path) => await access(fromRoot(path))));
await Promise.all(retiredPaths.map(async (path) => {
  await assert.rejects(access(fromRoot(path)), undefined, `${path} must not ship`);
}));

for (const entry of pluginBundleEntries) {
  assert.equal(
    normalizeLineEndings(await read(entry.destination)),
    await expectedPluginFile(entry),
    `${entry.destination} must be rebuilt from ${entry.source}`,
  );
}

const [
  packageJson,
  codexPlugin,
  claudePlugin,
  codexMarketplace,
  claudeMarketplace,
  skill,
  architecture,
  diff,
  release,
  readme,
  readmeKo,
] =
  await Promise.all([
    readJson("package.json"),
    readJson("plugins/hope/.codex-plugin/plugin.json"),
    readJson("plugins/hope/.claude-plugin/plugin.json"),
    readJson(".agents/plugins/marketplace.json"),
    readJson(".claude-plugin/marketplace.json"),
    read("plugins/hope/skills/diff/SKILL.md"),
    read("docs/architecture.md"),
    read("docs/diff.md"),
    read(".github/workflows/release.yml"),
    read("README.md"),
    read("README.ko.md"),
  ]);

assert.equal(packageJson.version, currentVersion);
assert.equal(packageJson.bin.hope, "./harness/hope.mjs");
assert.equal(codexPlugin.name, "hope");
assert.equal(codexPlugin.version, currentVersion);
assert.equal(claudePlugin.name, "hope");
assert.equal(claudePlugin.version, currentVersion);
if (process.env.GITHUB_REF_TYPE === "tag") {
  assert.equal(process.env.GITHUB_REF_NAME, `v${currentVersion}`);
}
assert.equal(codexPlugin.skills, "./skills/");
assert.equal(claudePlugin.skills, "./skills/");
assert.ok(codexMarketplace.plugins.some(
  (entry) => entry.name === "hope" && entry.source.path === "./plugins/hope",
));
const claudeMarketplaceEntry = claudeMarketplace.plugins.find(
  (entry) => entry.name === "hope",
);
assert.equal(claudeMarketplaceEntry.source, "./plugins/hope");
assert.equal(claudeMarketplaceEntry.version, undefined);
assert.match(skill, /^---\r?\nname: diff\r?\ndescription: /u);
assert.match(skill, /runtime\/diff\/cli\.mjs/u);
assert.match(skill, /\$\{CLAUDE_PLUGIN_ROOT\}\/runtime\/diff\/cli\.mjs/u);
assert.match(architecture, /harness -> features <- host adapters/u);
assert.match(architecture, /\.codex-plugin\/plugin\.json/u);
assert.match(architecture, /\.claude-plugin\/plugin\.json/u);
assert.match(diff, /^# Hope diff\r?\n/u);
assert.match(diff, /currently being rebuilt/u);
assert.match(release, /npm run build:plugin/u);
assert.match(release, /working-directory: plugins\/hope/u);
assert.match(release, /zip -r "\.\.\/\.\.\/hope-\$\{GITHUB_REF_NAME\}\.zip" \./u);
assert.match(release, /unzip -p [^\n]* \.claude-plugin\/plugin\.json/u);
assert.match(release, /unzip -p [^\n]* \.codex-plugin\/plugin\.json/u);
assert.match(release, /--generate-notes/u);
assert.match(readme, /src="plugins\/hope\/assets\/telescope\.svg"/u);
assert.match(readme, /claude --plugin-dir \.\/plugins\/hope/u);
assert.match(readmeKo, /src="plugins\/hope\/assets\/telescope\.svg"/u);
assert.match(readmeKo, /claude --plugin-dir \.\/plugins\/hope/u);

console.log(`Hope ${currentVersion} package structure is consistent.`);
