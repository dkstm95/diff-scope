#!/usr/bin/env node

import { readFile, rm, stat } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { renderUnderstandingBundle } from "./lib/render-artifact.mjs";
import { collectChangeContext } from "./collect-change-context.mjs";

const MAX_INPUT_BYTES = 4 * 1024 * 1024;

function usage() {
  return `Usage:
  node render-diff.mjs --root <repo> --input <artifact.json> --context <change-context.json> [--intent <intent.json>] [--output <new-directory>]

Options:
  --root    Repository root to recollect immediately before and after output.
  --input   ArtifactV2 JSON file to validate and render.
  --context ChangeContextV2 JSON file that the artifact must exactly represent.
  --intent  Optional IntentV1 JSON file that the artifact must embed exactly.
  --output  New directory for durable output. Existing paths are refused.
  --help    Show this help message.
`;
}

export function parseRenderArguments(argumentsList) {
  const parsed = {
    input: undefined,
    context: undefined,
    intent: undefined,
    root: undefined,
    output: undefined,
    help: false,
  };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--help" || argument === "-h") {
      parsed.help = true;
      continue;
    }
    if (!["--root", "--input", "--context", "--intent", "--output"].includes(argument)) {
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
  if (!parsed.help && parsed.root === undefined) {
    throw new Error("--root is required");
  }
  return parsed;
}

export function assertLiveContextMatches(storedContext, liveContext) {
  if (liveContext?.complete !== true) {
    throw new Error(
      "Refusing to render an incomplete live context; remove redactions and omissions, then recollect.",
    );
  }
  if (
    storedContext?.baseCommit !== liveContext.baseCommit ||
    storedContext?.fingerprint !== liveContext.fingerprint
  ) {
    throw new Error(
      "Stored ChangeContextV2 is stale because the live base commit or fingerprint changed.",
    );
  }
  return liveContext;
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

  const artifact = await loadJsonDocument(parsed.input, "ArtifactV2 input");
  const context = await loadJsonDocument(parsed.context, "ChangeContextV2 input");
  const intent =
    parsed.intent === undefined
      ? undefined
      : await loadJsonDocument(parsed.intent, "IntentV1 input");
  const liveContext = assertLiveContextMatches(
    context,
    await collectChangeContext({ root: parsed.root }),
  );
  const result = await renderUnderstandingBundle(artifact, {
    context: liveContext,
    intent,
    outputDir: parsed.output,
  });
  try {
    const postWriteContext = await collectChangeContext({ root: parsed.root });
    assertLiveContextMatches(liveContext, postWriteContext);
  } catch (error) {
    await rm(result.directory, { recursive: true, force: true });
    throw new Error(
      "Working tree changed before the bundle could be finalized; the new bundle was removed.",
      { cause: error },
    );
  }
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
