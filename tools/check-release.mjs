#!/usr/bin/env node

import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const fromRoot = (relativePath) => new URL(relativePath, root);
const read = async (relativePath) => await readFile(fromRoot(relativePath), "utf8");
const readJson = async (relativePath) => JSON.parse(await read(relativePath));

const requiredFiles = [
  ".agents/plugins/marketplace.json",
  "plugins/hope/.codex-plugin/plugin.json",
  "plugins/hope/LICENSE",
  "plugins/hope/assets/telescope.svg",
  "plugins/hope/skills/align/SKILL.md",
  "plugins/hope/skills/align/agents/openai.yaml",
  "plugins/hope/skills/align/assets/telescope.svg",
  "plugins/hope/skills/align/references/intent-contract.md",
  "plugins/hope/skills/align/references/intent-v1.schema.json",
  "plugins/hope/skills/align/scripts/finalize-intent.mjs",
  "plugins/hope/skills/align/scripts/lib/validate-intent.mjs",
  "plugins/hope/skills/diff/SKILL.md",
  "plugins/hope/skills/diff/agents/openai.yaml",
  "plugins/hope/skills/diff/assets/telescope.svg",
  "plugins/hope/skills/diff/references/artifact-contract.md",
  "plugins/hope/skills/diff/references/artifact-v2.schema.json",
  "plugins/hope/skills/diff/references/change-context-v2.schema.json",
  "plugins/hope/skills/diff/scripts/collect-change-context.mjs",
  "plugins/hope/skills/diff/scripts/render-diff.mjs",
  "README.md",
  "README.ko.md",
  "CHANGELOG.md",
  "LICENSE",
];

await Promise.all(requiredFiles.map(async (file) => await access(fromRoot(file))));

const [
  packageJson,
  plugin,
  marketplace,
  intentSchema,
  artifactSchema,
  contextSchema,
  alignSkill,
  diffSkill,
  readme,
  readmeKo,
  changelog,
  releaseWorkflow,
] = await Promise.all([
  readJson("package.json"),
  readJson("plugins/hope/.codex-plugin/plugin.json"),
  readJson(".agents/plugins/marketplace.json"),
  readJson("plugins/hope/skills/align/references/intent-v1.schema.json"),
  readJson("plugins/hope/skills/diff/references/artifact-v2.schema.json"),
  readJson("plugins/hope/skills/diff/references/change-context-v2.schema.json"),
  read("plugins/hope/skills/align/SKILL.md"),
  read("plugins/hope/skills/diff/SKILL.md"),
  read("README.md"),
  read("README.ko.md"),
  read("CHANGELOG.md"),
  read(".github/workflows/release.yml"),
]);

assert.equal(packageJson.name, "hope");
assert.equal(packageJson.version, "0.2.0-alpha");
assert.equal(packageJson.version, plugin.version);
assert.equal(plugin.name, "hope");
assert.equal(plugin.repository, "https://github.com/dkstm95/hope");
assert.equal(plugin.skills, "./skills/");
assert.equal(plugin.interface.displayName, "Hope");
assert.equal(marketplace.name, "hope");
assert.equal(marketplace.interface.displayName, "Hope");
assert.ok(
  marketplace.plugins.some(
    (entry) => entry.name === "hope" && entry.source.path === "./plugins/hope",
  ),
);

assert.match(alignSkill, /^---\r?\nname: align\r?\ndescription: /u);
assert.match(diffSkill, /^---\r?\nname: diff\r?\ndescription: /u);
assert.doesNotMatch(
  `${alignSkill}\n${diffSkill}`,
  /\[TODO:|understand-change|change-understanding/u,
);

assert.equal(intentSchema.properties.schemaVersion.const, 1);
assert.equal(contextSchema.properties.schemaVersion.const, 2);
assert.equal(contextSchema.properties.scope.properties.kind.const, "working-tree");
assert.equal(contextSchema.properties.scope.properties.includeUntrackedBodies.const, true);
assert.equal(artifactSchema.properties.schemaVersion.const, 2);
assert.ok(artifactSchema.required.includes("intent"));
assert.ok(artifactSchema.required.includes("alignment"));
assert.ok(artifactSchema.required.includes("knowledge"));
assert.ok(
  artifactSchema.properties.quiz.properties.questions.items.required.includes("intentItemIds"),
);
assert.ok(artifactSchema.properties.microworld.required.includes("intentItemIds"));

for (const document of [readme, readmeKo]) {
  assert.match(document, /\$hope:align/u);
  assert.match(document, /\$hope:diff/u);
  assert.match(document, /dkstm95\/hope/u);
  assert.match(document, new RegExp(`v${packageJson.version.replaceAll(".", "\\.")}`, "u"));
}
assert.doesNotMatch(
  `${alignSkill}\n${diffSkill}\n${readme}\n${readmeKo}`,
  /(?<!hope:)\$(?:align|diff)\b/u,
);
assert.match(readme, /private (?:OS )?temporary/u);
assert.match(readme, /does not commit/u);
assert.match(readme, /discard the entire bundle/u);
assert.match(readme, /including\s+`artifact\.json`/u);
assert.match(changelog, /^## 0\.2\.0-alpha /mu);
assert.match(changelog, /^## 0\.1\.0-alpha /mu);
assert.match(changelog, /Released under the DiffScope name/u);
assert.match(releaseWorkflow, /actions\/checkout@v6/u);
assert.match(releaseWorkflow, /actions\/setup-node@v6/u);
assert.doesNotMatch(releaseWorkflow, /actions\/(?:checkout|setup-node)@v7/u);

console.log(`Hope ${packageJson.version} release metadata is consistent.`);
