#!/usr/bin/env node

import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const fromRoot = (relativePath) => new URL(relativePath, root);
const read = async (relativePath) => await readFile(fromRoot(relativePath), "utf8");
const readJson = async (relativePath) => JSON.parse(await read(relativePath));
const currentVersion = "0.3.0-alpha";

const requiredFiles = [
  ".agents/plugins/marketplace.json",
  "plugins/hope/.codex-plugin/plugin.json",
  "plugins/hope/LICENSE",
  "plugins/hope/assets/telescope.svg",
  "plugins/hope/skills/diff/SKILL.md",
  "plugins/hope/skills/diff/agents/openai.yaml",
  "plugins/hope/skills/diff/assets/telescope.svg",
  "plugins/hope/skills/diff/references/change-request-v1.schema.json",
  "plugins/hope/skills/diff/references/review-model-v1.schema.json",
  "plugins/hope/skills/diff/references/review-contract.md",
  "plugins/hope/skills/diff/scripts/collect-change-request.mjs",
  "plugins/hope/skills/diff/scripts/render-review.mjs",
  "plugins/hope/skills/diff/scripts/lib/safety.mjs",
  "plugins/hope/skills/diff/scripts/lib/validate-review.mjs",
  "plugins/hope/skills/diff/scripts/lib/render-review.mjs",
  "README.md",
  "README.ko.md",
  "CHANGELOG.md",
  "LICENSE",
];

const retiredFiles = [
  "plugins/hope/skills/align",
  "plugins/hope/skills/diff/references/artifact-contract.md",
  "plugins/hope/skills/diff/references/artifact-v2.schema.json",
  "plugins/hope/skills/diff/references/change-context-v2.schema.json",
  "plugins/hope/skills/diff/scripts/collect-change-context.mjs",
  "plugins/hope/skills/diff/scripts/render-diff.mjs",
  "plugins/hope/skills/diff/scripts/lib/validate-artifact.mjs",
  "plugins/hope/skills/diff/scripts/lib/render-artifact.mjs",
];

await Promise.all(requiredFiles.map(async (file) => await access(fromRoot(file))));
await Promise.all(
  retiredFiles.map(async (file) => {
    await assert.rejects(access(fromRoot(file)), undefined, `${file} must not ship`);
  }),
);

const skillDirectories = (await readdir(fromRoot("plugins/hope/skills/"), {
  withFileTypes: true,
}))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
assert.deepEqual(skillDirectories, ["diff"]);

const [
  packageJson,
  plugin,
  marketplace,
  changeRequestSchema,
  reviewModelSchema,
  diffSkill,
  diffOpenAi,
  readme,
  readmeKo,
  changelog,
  releaseWorkflow,
] = await Promise.all([
  readJson("package.json"),
  readJson("plugins/hope/.codex-plugin/plugin.json"),
  readJson(".agents/plugins/marketplace.json"),
  readJson("plugins/hope/skills/diff/references/change-request-v1.schema.json"),
  readJson("plugins/hope/skills/diff/references/review-model-v1.schema.json"),
  read("plugins/hope/skills/diff/SKILL.md"),
  read("plugins/hope/skills/diff/agents/openai.yaml"),
  read("README.md"),
  read("README.ko.md"),
  read("CHANGELOG.md"),
  read(".github/workflows/release.yml"),
]);

assert.equal(packageJson.name, "hope");
assert.equal(packageJson.version, currentVersion);
assert.equal(packageJson.version, plugin.version);
assert.equal(plugin.name, "hope");
assert.equal(plugin.repository, "https://github.com/dkstm95/hope");
assert.equal(plugin.skills, "./skills/");
assert.equal(plugin.interface.displayName, "Hope");
assert.match(plugin.description, /pull request/u);
assert.ok(plugin.interface.defaultPrompt.some((prompt) => prompt.includes("$hope:diff")));
assert.doesNotMatch(JSON.stringify(plugin), /\balign\b|\bIntentV1\b/u);

assert.equal(marketplace.name, "hope");
assert.equal(marketplace.interface.displayName, "Hope");
assert.ok(
  marketplace.plugins.some(
    (entry) => entry.name === "hope" && entry.source.path === "./plugins/hope",
  ),
);

assert.match(diffSkill, /^---\r?\nname: diff\r?\ndescription: /u);
assert.match(diffSkill, /\$hope:diff/u);
assert.match(diffSkill, /collect-change-request\.mjs --url/u);
assert.match(diffSkill, /render-review\.mjs --input/u);
assert.match(diffSkill, /--cleanup/u);
assert.match(diffSkill, /render-review\.mjs --context <change-request\.json> --cleanup/u);
assert.match(diffSkill, /hope-review\.html/u);
assert.doesNotMatch(
  `${diffSkill}\n${diffOpenAi}`,
  /\$hope:align|IntentV1|artifact\.json|explanation\.md|collect-change-context|render-diff/u,
);
assert.match(diffOpenAi, /\$hope:diff/u);

assert.equal(changeRequestSchema.properties.schemaVersion.const, 1);
assert.equal(reviewModelSchema.properties.schemaVersion.const, 1);
assert.match(changeRequestSchema.title, /ChangeRequestV1/u);
assert.match(reviewModelSchema.title, /ReviewModelV1/u);
assert.deepEqual(
  reviewModelSchema.$defs.verification.properties.status.enum,
  ["not-run", "unknown"],
);
assert.doesNotMatch(
  JSON.stringify(reviewModelSchema.$defs.evidence.properties.source.enum),
  /verification/u,
);

for (const document of [readme, readmeKo]) {
  assert.match(document, /\$hope:diff/u);
  assert.match(document, /GitHub/u);
  assert.match(document, /hope-review\.html/u);
  assert.match(document, /dkstm95\/hope/u);
  assert.match(document, /merge-base/u);
  assert.match(document, /no (?:cache|network)|캐시/u);
  assert.match(document, new RegExp(`v${currentVersion.replaceAll(".", "\\.")}`, "u"));
  assert.doesNotMatch(document, /\$hope:align|HEAD\s*->\s*(?:current )?working tree/u);
}

assert.match(changelog, /^## 0\.3\.0-alpha /mu);
assert.match(changelog, /^## 0\.2\.0-alpha /mu);
assert.match(changelog, /^## 0\.1\.0-alpha /mu);
assert.match(changelog, /Released under the DiffScope name/u);
assert.match(releaseWorkflow, /actions\/checkout@v6/u);
assert.match(releaseWorkflow, /actions\/setup-node@v6/u);
assert.doesNotMatch(releaseWorkflow, /actions\/(?:checkout|setup-node)@v7/u);

console.log(`Hope ${packageJson.version} release metadata is consistent.`);
