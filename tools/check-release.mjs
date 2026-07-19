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
  "plugins/hope/skills/diff/scripts/inspect-change-request.mjs",
  "plugins/hope/skills/diff/scripts/render-review.mjs",
  "plugins/hope/skills/diff/scripts/lib/inspection-pages.mjs",
  "plugins/hope/skills/diff/scripts/lib/safety.mjs",
  "plugins/hope/skills/diff/scripts/lib/validate-review.mjs",
  "plugins/hope/skills/diff/scripts/lib/render-review.mjs",
  "README.md",
  "README.ko.md",
  "CHANGELOG.md",
  "SECURITY.md",
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
  reviewContract,
  diffSkill,
  diffOpenAi,
  diffInspector,
  readme,
  readmeKo,
  changelog,
  security,
  releaseWorkflow,
] = await Promise.all([
  readJson("package.json"),
  readJson("plugins/hope/.codex-plugin/plugin.json"),
  readJson(".agents/plugins/marketplace.json"),
  readJson("plugins/hope/skills/diff/references/change-request-v1.schema.json"),
  readJson("plugins/hope/skills/diff/references/review-model-v1.schema.json"),
  read("plugins/hope/skills/diff/references/review-contract.md"),
  read("plugins/hope/skills/diff/SKILL.md"),
  read("plugins/hope/skills/diff/agents/openai.yaml"),
  read("plugins/hope/skills/diff/scripts/inspect-change-request.mjs"),
  read("README.md"),
  read("README.ko.md"),
  read("CHANGELOG.md"),
  read("SECURITY.md"),
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
assert.match(diffSkill, /inspect-change-request\.mjs --context <change-request\.json> --summary/u);
assert.match(diffSkill, /inspect-change-request\.mjs --context <change-request\.json> --pass <pass-id>/u);
assert.match(diffSkill, /--after <receipt>/u);
assert.match(diffSkill, /page\.hasNext/u);
assert.match(diffSkill, /analysisPlan/u);
assert.match(diffSkill, /analysisCoverage/u);
assert.match(diffSkill, /top-level `locale`[\s\S]*`ko` or `en`/u);
assert.match(diffSkill, /4,000 changed lines/u);
assert.match(diffSkill, /64\s+KiB/u);
assert.match(diffSkill, /--validate-only/u);
assert.match(diffSkill, /render-review\.mjs --input/u);
assert.match(diffSkill, /--cleanup/u);
assert.match(diffSkill, /render-review\.mjs --context <change-request\.json> --cleanup/u);
assert.match(diffSkill, /hope-review\.html/u);
assert.doesNotMatch(
  `${diffSkill}\n${diffOpenAi}`,
  /\$hope:align|IntentV1|artifact\.json|explanation\.md|collect-change-context|render-diff/u,
);
assert.match(diffOpenAi, /\$hope:diff/u);
assert.match(diffInspector, /--summary/u);
assert.match(diffInspector, /--pass/u);
assert.match(diffInspector, /--after/u);
assert.match(diffInspector, /MAX_INSPECTION_OUTPUT_BYTES/u);
assert.match(diffInspector, /validateChangeRequest/u);
assert.match(reviewContract, /analysisPlan/u);
assert.match(reviewContract, /analysisCoverage\.processedPasses/u);
assert.match(reviewContract, /terminal receipt/u);
assert.match(reviewContract, /attest/u);
assert.match(reviewContract, /cross-workstream/u);
assert.match(reviewContract, /one global quiz/u);
assert.match(reviewContract, /human-review order/u);
assert.match(reviewContract, /collapsed analysis details/u);
assert.match(reviewContract, /fixed,[\s\S]*trusted dictionary/u);
assert.match(diffSkill, /compact serialized[\s\S]*4 MiB[\s\S]*8 MiB/u);
assert.match(reviewContract, /ReviewModelV1[\s\S]*4 MiB[\s\S]*8 MiB/u);
assert.match(security, /Review Model[\s\S]*4 MiB[\s\S]*8 MiB/u);

assert.equal(changeRequestSchema.properties.schemaVersion.const, 1);
assert.equal(reviewModelSchema.properties.schemaVersion.const, 1);
assert.match(changeRequestSchema.title, /ChangeRequestV1/u);
assert.match(reviewModelSchema.title, /ReviewModelV1/u);
assert.ok(changeRequestSchema.required.includes("analysisPlan"));
assert.ok(reviewModelSchema.required.includes("analysisCoverage"));
assert.ok(reviewModelSchema.required.includes("locale"));
assert.deepEqual(reviewModelSchema.properties.locale.enum, ["en", "ko"]);
assert.deepEqual(
  reviewModelSchema.$defs.analysisCoverage.required,
  ["inspectionProtocolVersion", "summary", "processedPasses"],
);
assert.ok(reviewModelSchema.$defs.processedPass.required.includes("pageCount"));
assert.ok(reviewModelSchema.$defs.processedPass.required.includes("terminalReceipt"));
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
  assert.match(document, /analysisPlan/u);
  assert.match(document, /4,000/u);
  assert.match(document, /64\s+KiB/u);
  assert.match(document, /250/u);
  assert.match(document, /200/u);
  assert.match(document, /20,000/u);
  assert.match(document, /768\s+KiB/u);
  assert.match(document, /128\s+KiB/u);
  assert.match(document, /no (?:cache|network)|캐시/u);
  assert.match(document, new RegExp(`v${currentVersion.replaceAll(".", "\\.")}`, "u"));
  assert.doesNotMatch(document, /\$hope:align|HEAD\s*->\s*(?:current )?working tree/u);
}
assert.doesNotMatch(readme, /fixed interface uses English/u);
assert.doesNotMatch(readmeKo, /고정 UI는 영어/u);

assert.match(changelog, /^## 0\.3\.0-alpha /mu);
assert.match(changelog, /^## 0\.2\.0-alpha /mu);
assert.match(changelog, /^## 0\.1\.0-alpha /mu);
assert.match(changelog, /Released under the DiffScope name/u);
assert.match(releaseWorkflow, /actions\/checkout@v6/u);
assert.match(releaseWorkflow, /actions\/setup-node@v6/u);
assert.doesNotMatch(releaseWorkflow, /actions\/(?:checkout|setup-node)@v7/u);

console.log(`Hope ${packageJson.version} release metadata is consistent.`);
