#!/usr/bin/env node

import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const fromRoot = (relativePath) => new URL(relativePath, root);
const read = async (relativePath) => await readFile(fromRoot(relativePath), "utf8");
const readJson = async (relativePath) => JSON.parse(await read(relativePath));

const requiredFiles = [
  ".agents/plugins/marketplace.json",
  ".github/workflows/pages.yml",
  "demo/source/artifact-v1.json",
  "demo/source/change-context-v1.json",
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
  "test/site.test.mjs",
  "tools/build-site.mjs",
  "website/index.html",
  "website/robots.txt",
  "website/site.js",
  "website/styles.css",
  "README.md",
  "README.ko.md",
  "LICENSE",
];

await Promise.all(requiredFiles.map(async (file) => await access(fromRoot(file))));

const [
  packageJson,
  plugin,
  marketplace,
  artifactSchema,
  contextSchema,
  skill,
  readme,
  landing,
  pagesWorkflow,
] =
  await Promise.all([
    readJson("package.json"),
    readJson("plugins/diff-scope/.codex-plugin/plugin.json"),
    readJson(".agents/plugins/marketplace.json"),
    readJson("plugins/diff-scope/skills/diff/references/artifact-v1.schema.json"),
    readJson("plugins/diff-scope/skills/diff/references/change-context-v1.schema.json"),
    read("plugins/diff-scope/skills/diff/SKILL.md"),
    read("README.md"),
    read("website/index.html"),
    read(".github/workflows/pages.yml"),
  ]);

assert.equal(packageJson.name, "diff-scope");
assert.equal(packageJson.version, plugin.version);
assert.equal(plugin.name, "diff-scope");
assert.equal(plugin.skills, "./skills/");
assert.equal(plugin.homepage, "https://dkstm95.github.io/diff-scope/");
assert.equal(plugin.interface.websiteURL, plugin.homepage);
assert.ok(plugin.interface.defaultPrompt.length >= 1 && plugin.interface.defaultPrompt.length <= 3);
for (const prompt of plugin.interface.defaultPrompt) {
  assert.ok(prompt.length <= 128);
}
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
assert.equal(packageJson.scripts["build:site"], "node tools/build-site.mjs");
assert.match(landing, /href="\.\/demo\/"/u);
assert.match(landing, /data-copy-target="install-prompt"/u);
assert.doesNotMatch(landing, /codex:\/\//u);
assert.match(landing, new RegExp(`v${packageJson.version.replaceAll(".", "\\.")}`, "u"));
const installRefs = [...landing.matchAll(/--ref\s+(v[^\s<]+)/gu)].map((match) => match[1]);
assert.deepEqual([...new Set(installRefs)], [`v${packageJson.version}`]);
assert.match(pagesWorkflow, /actions\/configure-pages@v6/u);
assert.match(pagesWorkflow, /actions\/upload-pages-artifact@v5/u);
assert.match(pagesWorkflow, /actions\/deploy-pages@v5/u);

console.log(`DiffScope ${packageJson.version} release metadata is consistent.`);
