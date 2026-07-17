#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { renderUnderstandingBundle } from "./lib/render-artifact.mjs";

const MAX_INPUT_BYTES = 4 * 1024 * 1024;

function usage() {
  return `Usage:
  node render-diff.mjs --input <artifact.json> --context <change-context.json> [--output <new-directory>]

Options:
  --input   ArtifactV1 JSON file to validate and render.
  --context ChangeContextV1 JSON file that the artifact must exactly represent.
  --output  New directory for durable output. Existing paths are refused.
  --help    Show this help message.
`;
}

export function parseRenderArguments(argumentsList) {
  const parsed = { input: undefined, context: undefined, output: undefined, help: false };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--help" || argument === "-h") {
      parsed.help = true;
      continue;
    }
    if (!["--input", "--context", "--output"].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argumentsList[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${argument} requires a path`);
    }
    const key = argument.slice(2);
    if (parsed[key] !== undefined) {
      throw new Error(`${argument} may be provided only once`);
    }
    parsed[key] = value;
    index += 1;
  }
  if (!parsed.help && parsed.input === undefined) {
    throw new Error("--input is required");
  }
  if (!parsed.help && parsed.context === undefined) {
    throw new Error("--context is required");
  }
  return parsed;
}

export async function loadJsonDocument(inputPath, label = "Input") {
  const inputStatus = await stat(inputPath);
  if (!inputStatus.isFile()) {
    throw new Error(`${label} is not a regular file: ${inputPath}`);
  }
  if (inputStatus.size > MAX_INPUT_BYTES) {
    throw new Error(`${label} exceeds the ${MAX_INPUT_BYTES}-byte limit`);
  }

  const source = await readFile(inputPath, "utf8");
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`, { cause: error });
  }
}

export async function main(argumentsList = process.argv.slice(2)) {
  const parsed = parseRenderArguments(argumentsList);
  if (parsed.help) {
    process.stdout.write(usage());
    return undefined;
  }

  const artifact = await loadJsonDocument(parsed.input, "ArtifactV1 input");
  const context = await loadJsonDocument(parsed.context, "ChangeContextV1 input");
  const result = await renderUnderstandingBundle(artifact, {
    context,
    outputDir: parsed.output,
  });
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
