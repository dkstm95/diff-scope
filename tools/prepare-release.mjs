#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { buildPlugin } from "./build-plugin.mjs";

const root = new URL("../", import.meta.url);
const fromRoot = (path) => new URL(path, root);

export const versionFiles = Object.freeze([
  "package.json",
  "plugins/hope/.codex-plugin/plugin.json",
  "plugins/hope/.claude-plugin/plugin.json",
]);

const semanticVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/u;

export function isSemanticVersion(version) {
  const match = semanticVersion.exec(version);
  if (!match) return false;
  const [, prerelease, build] = match;
  const prereleaseParts = prerelease?.split(".") ?? [];
  const buildParts = build?.split(".") ?? [];
  return !prereleaseParts.some(
    (part) => part === "" || (/^\d+$/u.test(part) && part.length > 1 && part.startsWith("0")),
  ) && !buildParts.some((part) => part === "");
}

export function withVersion(document, version) {
  if (!isSemanticVersion(version)) {
    throw new Error(`Expected a semantic version without a v prefix, received: ${version}`);
  }
  return { ...document, version };
}

export function replaceVersion(content, version) {
  if (!isSemanticVersion(version)) {
    throw new Error(`Expected a semantic version without a v prefix, received: ${version}`);
  }
  const versionLine = /^(\s*"version"\s*:\s*)"[^"]+"/mu;
  if (!versionLine.test(content)) throw new Error("JSON file does not declare a version");
  return content.replace(versionLine, `$1"${version}"`);
}

async function writeVersion(path, version) {
  const url = fromRoot(path);
  const content = await readFile(url, "utf8");
  JSON.parse(content);
  await writeFile(url, replaceVersion(content, version), "utf8");
}

function run(commandArguments) {
  const result = spawnSync(process.execPath, commandArguments, {
    cwd: fileURLToPath(root),
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${process.execPath} ${commandArguments.join(" ")} failed`);
  }
}

export async function prepareRelease(version) {
  if (!isSemanticVersion(version)) {
    throw new Error(`Expected a semantic version without a v prefix, received: ${version}`);
  }

  await Promise.all(versionFiles.map(async (path) => await writeVersion(path, version)));
  await buildPlugin();
  run(["tools/check-release.mjs"]);
  run(["--test"]);
  process.stdout.write(`Hope ${version} is ready to review and commit.\n`);
}

const isEntrypoint = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isEntrypoint) {
  const [version, ...extraArguments] = process.argv.slice(2);
  if (!version || extraArguments.length > 0) {
    process.stderr.write("Usage: npm run release:prepare -- <version>\n");
    process.exitCode = 1;
  } else {
    prepareRelease(version).catch((error) => {
      process.stderr.write(`prepare-release: ${error.message}\n`);
      process.exitCode = 1;
    });
  }
}
