#!/usr/bin/env node

import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

import {
  expectedPluginFile,
  pluginBundleEntries,
} from "./build-plugin.mjs";
import { pluginPackageFiles } from "./plugin-files.mjs";
import { main as runHarness } from "../harness/hope.mjs";

const root = new URL("../", import.meta.url);
const fromRoot = (path) => new URL(path, root);
const read = async (path) => await readFile(fromRoot(path), "utf8");
const readBytes = async (path) => await readFile(fromRoot(path));
const readJson = async (path) => JSON.parse(await read(path));
const packageJson = await readJson("package.json");
const currentVersion = packageJson.version;

const requiredFiles = [
  ".agents/plugins/marketplace.json",
  ".claude-plugin/marketplace.json",
  "docs/architecture.md",
  "docs/design.md",
  "docs/diff.md",
  "design/fonts/HopeCode.woff2",
  "design/fonts/HopeSansBold.woff2",
  "design/fonts/HopeSansLight.woff2",
  "design/fonts/HopeSansMedium.woff2",
  "design/fonts/OFL-D2Coding.txt",
  "design/fonts/OFL-Gmarket.txt",
  "design/fonts/SOURCE.md",
  "design/tokens.mjs",
  "features/diff/analysis-v1.schema.json",
  "features/diff/cli.mjs",
  "features/diff/index.mjs",
  "harness/hope.mjs",
  "locales/index.mjs",
  "settings/cli.mjs",
  "settings/index.mjs",
  "tools/plugin-files.mjs",
  "tools/plugin-package-files.txt",
  "tools/prepare-release.mjs",
  "tools/stage-plugin.mjs",
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

await Promise.all([
  ...requiredFiles,
  ...pluginPackageFiles.map((path) => `plugins/hope/${path}`),
].map(async (path) => await access(fromRoot(path))));
await Promise.all(retiredPaths.map(async (path) => {
  await assert.rejects(access(fromRoot(path)), undefined, `${path} must not ship`);
}));

for (const entry of pluginBundleEntries) {
  const expected = await expectedPluginFile(entry);
  const actual = await readBytes(entry.destination);
  if (Buffer.isBuffer(expected)) {
    assert.deepEqual(
      actual,
      expected,
      `${entry.destination} must be rebuilt from ${entry.source}`,
    );
  } else {
    assert.equal(
      actual.toString("utf8").replace(/\r\n?/gu, "\n"),
      expected,
      `${entry.destination} must be rebuilt from ${entry.source}`,
    );
  }
}

const [
  codexPlugin,
  claudePlugin,
  codexMarketplace,
  claudeMarketplace,
  skill,
  settingsSkill,
  architecture,
  diff,
  release,
  verify,
  readme,
  readmeKo,
] =
  await Promise.all([
    readJson("plugins/hope/.codex-plugin/plugin.json"),
    readJson("plugins/hope/.claude-plugin/plugin.json"),
    readJson(".agents/plugins/marketplace.json"),
    readJson(".claude-plugin/marketplace.json"),
    read("plugins/hope/skills/diff/SKILL.md"),
    read("plugins/hope/skills/settings/SKILL.md"),
    read("docs/architecture.md"),
    read("docs/diff.md"),
    read(".github/workflows/release.yml"),
    read(".github/workflows/verify.yml"),
    read("README.md"),
    read("README.ko.md"),
  ]);

assert.equal(packageJson.version, currentVersion);
assert.equal(packageJson.bin.hope, "./harness/hope.mjs");
assert.equal(codexPlugin.name, "hope");
assert.equal(codexPlugin.version, currentVersion);
assert.equal(claudePlugin.name, "hope");
assert.equal(claudePlugin.version, currentVersion);
let harnessVersion = "";
await runHarness(["--version"], {
  stdout: {
    write(value) {
      harnessVersion += value;
    },
  },
});
assert.equal(harnessVersion, `${currentVersion}\n`);
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
assert.doesNotMatch(claudeMarketplaceEntry.description, /rebuild status/u);
assert.match(skill, /^---\r?\nname: diff\r?\ndescription: /u);
assert.match(skill, /runtime\/features\/diff\/cli\.mjs/u);
assert.match(skill, /\$\{CLAUDE_PLUGIN_ROOT\}\/runtime\/features\/diff\/cli\.mjs/u);
assert.match(settingsSkill, /^---\r?\nname: settings\r?\ndescription: /u);
assert.match(settingsSkill, /runtime\/settings\/cli\.mjs/u);
assert.match(architecture, /harness -> features <- host adapters/u);
assert.match(architecture, /\.codex-plugin\/plugin\.json/u);
assert.match(architecture, /\.claude-plugin\/plugin\.json/u);
assert.match(diff, /^# Hope diff\r?\n/u);
assert.match(diff, /ko-KR/u);
assert.match(diff, /en-US/u);
assert.match(release, /npm run build:plugin/u);
assert.match(release, /npx playwright install --with-deps chromium/u);
assert.match(release, /npm run test:browser/u);
assert.match(release, /fetch-depth: 0/u);
assert.match(release, /git merge-base --is-ancestor "\$\{GITHUB_SHA\}" refs\/remotes\/origin\/main/u);
assert.match(release, /node tools\/stage-plugin\.mjs/u);
assert.match(release, /diff -u tools\/plugin-package-files\.txt/u);
assert.match(release, /unzip -p [^\n]* \.claude-plugin\/plugin\.json/u);
assert.match(release, /unzip -p [^\n]* \.codex-plugin\/plugin\.json/u);
assert.match(release, /--generate-notes/u);
assert.match(verify, /name: Verify/u);
assert.match(verify, /needs: \[check, browser\]/u);
assert.match(verify, /CHECK_RESULT: \$\{\{ needs\.check\.result \}\}/u);
assert.match(verify, /BROWSER_RESULT: \$\{\{ needs\.browser\.result \}\}/u);
assert.match(verify, /npm run test:browser/u);
assert.match(readme, /src="plugins\/hope\/assets\/telescope\.svg"/u);
assert.match(readme, /claude --plugin-dir \.\/plugins\/hope/u);
assert.match(readmeKo, /src="plugins\/hope\/assets\/telescope\.svg"/u);
assert.match(readmeKo, /claude --plugin-dir \.\/plugins\/hope/u);
assert.equal(
  await read("tools/plugin-package-files.txt"),
  `${pluginPackageFiles.join("\n")}\n`,
);

console.log(`Hope ${currentVersion} package structure is consistent.`);
