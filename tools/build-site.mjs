#!/usr/bin/env node

import { cp, lstat, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { redactSensitiveText } from "../plugins/diff-scope/skills/diff/scripts/collect-change-context.mjs";
import { renderUnderstandingBundle } from "../plugins/diff-scope/skills/diff/scripts/lib/render-artifact.mjs";
import {
  calculateChangeContextFingerprint,
  validateArtifactAgainstContext,
} from "../plugins/diff-scope/skills/diff/scripts/lib/validate-artifact.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const websiteSource = join(root, "website");
const iconSource = join(root, "plugins", "diff-scope", "assets", "telescope.svg");
const artifactSource = join(root, "demo", "source", "artifact-v1.json");
const contextSource = join(root, "demo", "source", "change-context-v1.json");
const defaultOutput = join(root, "dist", "site");

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function countSensitiveRedactions(value) {
  if (typeof value === "string") {
    return redactSensitiveText(value).redactions;
  }
  if (Array.isArray(value)) {
    return value.reduce((total, entry) => total + countSensitiveRedactions(entry), 0);
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value).reduce(
      (total, entry) => total + countSensitiveRedactions(entry),
      0,
    );
  }
  return 0;
}

export function parseBuildSiteArguments(argumentsList) {
  if (argumentsList.length === 0) {
    return { output: defaultOutput, clean: true };
  }
  if (argumentsList.length !== 2 || argumentsList[0] !== "--output") {
    throw new Error("Usage: node tools/build-site.mjs [--output <new-directory>]");
  }
  if (argumentsList[1].trim().length === 0) {
    throw new Error("--output requires a non-empty path");
  }
  return { output: resolve(argumentsList[1]), clean: false };
}

export async function buildSite(outputDirectory) {
  const output = resolve(outputDirectory);
  if (await pathExists(output)) {
    throw new Error(`Refusing to overwrite existing site path: ${output}`);
  }

  const [artifact, context] = await Promise.all([
    readJson(artifactSource),
    readJson(contextSource),
  ]);
  const fingerprint = calculateChangeContextFingerprint(context);
  if (fingerprint !== context.fingerprint) {
    throw new Error("Public demo context fingerprint is stale");
  }
  validateArtifactAgainstContext(artifact, context);

  if (countSensitiveRedactions(context) !== 0) {
    throw new Error("Public demo context contains suspected sensitive material");
  }

  await mkdir(dirname(output), { recursive: true });
  await mkdir(output);
  try {
    await cp(websiteSource, output, { recursive: true, errorOnExist: true });
    await mkdir(join(output, "assets"));
    await cp(iconSource, join(output, "assets", "telescope.svg"), {
      errorOnExist: true,
    });
    await renderUnderstandingBundle(artifact, {
      context,
      outputDir: join(output, "demo"),
    });
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }

  return {
    directory: output,
    demo: join(output, "demo", "index.html"),
  };
}

export async function main(argumentsList = process.argv.slice(2)) {
  const parsed = parseBuildSiteArguments(argumentsList);
  if (parsed.clean) {
    await rm(parsed.output, { recursive: true, force: true });
  }
  const result = await buildSite(parsed.output);
  process.stdout.write(`${result.directory}\n`);
  return result;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
