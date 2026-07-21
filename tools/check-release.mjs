#!/usr/bin/env node

import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";

import {
  MAX_INSPECTION_OUTPUT_BYTES,
} from "../plugins/hope/skills/diff/scripts/lib/inspection-pages.mjs";

const root = new URL("../", import.meta.url);
const fromRoot = (path) => new URL(path, root);
const read = async (path) => await readFile(fromRoot(path), "utf8");
const readJson = async (path) => JSON.parse(await read(path));
const currentVersion = "0.4.0-alpha";

const requiredFiles = [
  ".agents/plugins/marketplace.json",
  "plugins/hope/.codex-plugin/plugin.json",
  "plugins/hope/LICENSE",
  "plugins/hope/assets/telescope.svg",
  "plugins/hope/runtime/shared/private-files.mjs",
  "plugins/hope/runtime/diff/cli.mjs",
  "plugins/hope/runtime/diff/diff-run.mjs",
  "plugins/hope/runtime/diff/latest-pull-request.mjs",
  "plugins/hope/runtime/cleanup/cli.mjs",
  "plugins/hope/runtime/cleanup/cleanup-plan.mjs",
  "plugins/hope/skills/diff/SKILL.md",
  "plugins/hope/skills/diff/agents/openai.yaml",
  "plugins/hope/skills/diff/scripts/hope-diff.mjs",
  "plugins/hope/skills/diff/scripts/collect-change-request.mjs",
  "plugins/hope/skills/diff/scripts/inspect-change-request.mjs",
  "plugins/hope/skills/diff/scripts/render-review.mjs",
  "plugins/hope/skills/diff/scripts/lib/inspection-pages.mjs",
  "plugins/hope/skills/diff/scripts/lib/render-review.mjs",
  "plugins/hope/skills/diff/scripts/lib/review-retention.mjs",
  "plugins/hope/skills/diff/scripts/lib/safety.mjs",
  "plugins/hope/skills/diff/scripts/lib/validate-review.mjs",
  "plugins/hope/skills/diff/references/change-request-v1.schema.json",
  "plugins/hope/skills/diff/references/review-model-v1.schema.json",
  "plugins/hope/skills/diff/references/review-contract.md",
  "plugins/hope/skills/cleanup/SKILL.md",
  "plugins/hope/skills/cleanup/agents/openai.yaml",
  "plugins/hope/skills/cleanup/assets/telescope.svg",
  "plugins/hope/skills/cleanup/scripts/cleanup.mjs",
  "docs/architecture.md",
  "README.md",
  "README.ko.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CHANGELOG.md",
  "LICENSE",
];

const retiredFiles = [
  "plugins/hope/skills/align",
  "plugins/hope/skills/diff/references/artifact-contract.md",
  "plugins/hope/skills/diff/references/artifact-v2.schema.json",
  "plugins/hope/skills/diff/scripts/collect-change-context.mjs",
  "plugins/hope/skills/diff/scripts/render-diff.mjs",
];

await Promise.all(requiredFiles.map(async (path) => await access(fromRoot(path))));
await Promise.all(retiredFiles.map(async (path) => {
  await assert.rejects(access(fromRoot(path)), undefined, `${path} must not ship`);
}));

const skillDirectories = (await readdir(fromRoot("plugins/hope/skills/"), {
  withFileTypes: true,
}))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
assert.deepEqual(skillDirectories, ["cleanup", "diff"]);

const [
  packageJson,
  plugin,
  marketplace,
  changeRequestSchema,
  reviewModelSchema,
  diffSkill,
  cleanupSkill,
  diffOpenAi,
  cleanupOpenAi,
  diffCli,
  diffRun,
  latestPullRequest,
  cleanupCli,
  cleanupPlan,
  privateFiles,
  retention,
  readme,
  readmeKo,
  architecture,
  contributing,
  security,
  changelog,
  releaseWorkflow,
] = await Promise.all([
  readJson("package.json"),
  readJson("plugins/hope/.codex-plugin/plugin.json"),
  readJson(".agents/plugins/marketplace.json"),
  readJson("plugins/hope/skills/diff/references/change-request-v1.schema.json"),
  readJson("plugins/hope/skills/diff/references/review-model-v1.schema.json"),
  read("plugins/hope/skills/diff/SKILL.md"),
  read("plugins/hope/skills/cleanup/SKILL.md"),
  read("plugins/hope/skills/diff/agents/openai.yaml"),
  read("plugins/hope/skills/cleanup/agents/openai.yaml"),
  read("plugins/hope/runtime/diff/cli.mjs"),
  read("plugins/hope/runtime/diff/diff-run.mjs"),
  read("plugins/hope/runtime/diff/latest-pull-request.mjs"),
  read("plugins/hope/runtime/cleanup/cli.mjs"),
  read("plugins/hope/runtime/cleanup/cleanup-plan.mjs"),
  read("plugins/hope/runtime/shared/private-files.mjs"),
  read("plugins/hope/skills/diff/scripts/lib/review-retention.mjs"),
  read("README.md"),
  read("README.ko.md"),
  read("docs/architecture.md"),
  read("CONTRIBUTING.md"),
  read("SECURITY.md"),
  read("CHANGELOG.md"),
  read(".github/workflows/release.yml"),
]);

assert.equal(packageJson.name, "hope");
assert.equal(packageJson.version, currentVersion);
assert.equal(plugin.name, "hope");
assert.equal(plugin.version, currentVersion);
assert.equal(plugin.skills, "./skills/");
assert.equal(plugin.repository, "https://github.com/dkstm95/hope");
assert.equal(plugin.interface.displayName, "Hope");
assert.match(plugin.description, /harness/u);
assert.ok(plugin.interface.defaultPrompt.some((prompt) => prompt.includes("$hope:diff")));
assert.ok(plugin.interface.defaultPrompt.some((prompt) => prompt.includes("$hope:cleanup")));

assert.equal(marketplace.name, "hope");
assert.ok(marketplace.plugins.some(
  (entry) => entry.name === "hope" && entry.source.path === "./plugins/hope",
));

assert.match(diffSkill, /^---\r?\nname: diff\r?\ndescription: /u);
assert.match(diffSkill, /hope-diff\.mjs start/u);
assert.match(diffSkill, /--latest/u);
assert.match(diffSkill, /hope-diff\.mjs inspect/u);
assert.match(diffSkill, /hope-diff\.mjs validate/u);
assert.match(diffSkill, /hope-diff\.mjs render/u);
assert.match(diffSkill, /hope-diff\.mjs abandon/u);
assert.match(diffSkill, /--after <receipt>/u);
assert.match(diffSkill, /4 MiB/u);
assert.match(diffSkill, /8\s+MiB/u);
assert.match(diffOpenAi, /\$hope:diff/u);

assert.match(cleanupSkill, /^---\r?\nname: cleanup\r?\ndescription: /u);
assert.match(cleanupSkill, /cleanup\.mjs preview/u);
assert.match(cleanupSkill, /cleanup\.mjs apply/u);
assert.match(cleanupSkill, /explicit confirmation/u);
assert.match(cleanupSkill, /does not remove[\s\S]*branches/u);
assert.match(cleanupOpenAi, /\$hope:cleanup/u);

assert.match(diffCli, /start[\s\S]*inspect[\s\S]*validate[\s\S]*render/u);
assert.match(diffRun, /Diff run/u);
assert.match(diffRun, /revision/u);
assert.match(diffRun, /listTerminalDiffRuns/u);
assert.match(latestPullRequest, /sort:created-desc/u);
assert.match(latestPullRequest, /normalizePullRequestUrl/u);
assert.match(cleanupCli, /Preview or apply cleanup/u);
assert.match(cleanupPlan, /previewCleanup/u);
assert.match(cleanupPlan, /applyCleanup/u);
assert.match(cleanupPlan, /planDigest/u);
assert.match(privateFiles, /safeTemporaryRootStatus/u);
assert.match(retention, /DEFAULT_REVIEW_RETENTION_MS\s*=\s*7\s*\*/u);
assert.match(retention, /removeManagedReview/u);
assert.doesNotMatch(`${diffCli}\n${cleanupCli}`, /class\s+\w*Runner/u);

assert.equal(MAX_INSPECTION_OUTPUT_BYTES, 16 * 1024);
assert.equal(changeRequestSchema.properties.schemaVersion.const, 1);
assert.equal(reviewModelSchema.properties.schemaVersion.const, 1);
assert.ok(changeRequestSchema.required.includes("analysisPlan"));
assert.ok(reviewModelSchema.required.includes("analysisCoverage"));
assert.deepEqual(reviewModelSchema.properties.locale.enum, ["en", "ko"]);

for (const document of [readme, readmeKo]) {
  assert.match(document, /\$hope:diff/u);
  assert.match(document, /most recently created PR|생성 시각이 가장 최근인 PR/u);
  assert.match(document, /\$hope:cleanup/u);
  assert.match(document, /hope-review\.html/u);
  assert.match(document, /merge-base/u);
  assert.match(document, /4,000/u);
  assert.match(document, /64\s+KiB/u);
  assert.match(document, /16\s+KiB/u);
  assert.match(document, /250/u);
  assert.match(document, /200/u);
  assert.match(document, /20,000/u);
  assert.match(document, /768\s+KiB/u);
  assert.match(document, /128\s+KiB/u);
  assert.match(document, /eligibleAfter/u);
  assert.match(document, new RegExp(`v${currentVersion.replaceAll(".", "\\.")}`, "u"));
  assert.doesNotMatch(document, /\$hope:align/u);
}
assert.match(architecture, /same feature\s+commands/u);
assert.match(architecture, /never guess branch ownership|deletes only items it created and recorded/u);
assert.match(contributing, /Do not add a generic `Runner`/u);
assert.match(security, /exact plan path\s+and digest/u);
assert.match(security, /Branch deletion will require a Hope-created branch record/u);

assert.match(changelog, /^## 0\.4\.0-alpha /mu);
assert.match(changelog, /^## 0\.3\.2-alpha /mu);
assert.match(changelog, /Released under the DiffScope name/u);
assert.match(releaseWorkflow, /actions\/checkout@v6/u);
assert.match(releaseWorkflow, /actions\/setup-node@v6/u);

console.log(`Hope ${packageJson.version} release metadata is consistent.`);
