#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { constants as fsConstants, realpathSync } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { validateChangeRequest } from "./collect-change-request.mjs";
import {
  buildInspectionPages,
  inspectionPass,
  inspectionSummary,
  MAX_INSPECTION_OUTPUT_BYTES,
  selectInspectionPage,
} from "./lib/inspection-pages.mjs";

export const MAX_CONTEXT_BYTES = 4 * 1024 * 1024;

async function readBounded(handle, maximumBytes) {
  const chunks = [];
  let offset = 0;
  while (offset <= maximumBytes) {
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maximumBytes + 1 - offset));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    if (bytesRead === 0) break;
    chunks.push(buffer.subarray(0, bytesRead));
    offset += bytesRead;
  }
  if (offset > maximumBytes) {
    throw new Error(`ChangeRequestV1 context exceeds the ${maximumBytes}-byte inspection limit.`);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readChangeRequestContext(inputPath) {
  const resolved = path.resolve(inputPath);
  const pathStatus = await lstat(resolved);
  if (!pathStatus.isFile() || pathStatus.isSymbolicLink()) {
    throw new Error(`Context is not a regular, non-symlink file: ${resolved}`);
  }
  if (pathStatus.size > MAX_CONTEXT_BYTES) {
    throw new Error(`ChangeRequestV1 context exceeds the ${MAX_CONTEXT_BYTES}-byte inspection limit.`);
  }
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const handle = await open(resolved, fsConstants.O_RDONLY | noFollow);
  try {
    const status = await handle.stat();
    if (!status.isFile() || status.size > MAX_CONTEXT_BYTES) {
      throw new Error("Context changed or exceeded the bounded inspection limit while opening.");
    }
    let parsed;
    try {
      parsed = JSON.parse(await readBounded(handle, MAX_CONTEXT_BYTES));
    } catch (error) {
      if (error?.message?.includes("inspection limit")) throw error;
      throw new Error("Context is not valid JSON.");
    }
    return validateChangeRequest(parsed);
  } finally {
    await handle.close();
  }
}

export function inspectSummary(changeRequest) {
  validateChangeRequest(changeRequest);
  return inspectionSummary(changeRequest);
}

export function inspectPass(changeRequest, passId) {
  validateChangeRequest(changeRequest);
  return inspectionPass(changeRequest, passId);
}

export function parseArguments(argv) {
  const options = { summary: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--summary") {
      if (options.summary) throw new TypeError("--summary may be provided only once.");
      options.summary = true;
      continue;
    }
    if (!["--context", "--pass", "--after"].includes(argument)) {
      throw new TypeError(`Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new TypeError(`${argument} requires a value.`);
    const key = argument.slice(2);
    if (options[key] !== undefined) throw new TypeError(`${argument} may be provided only once.`);
    options[key] = value;
    index += 1;
  }
  if (options.help) return options;
  if (options.context === undefined) throw new TypeError("--context is required.");
  if (options.summary === (options.pass !== undefined)) {
    throw new TypeError("Choose exactly one of --summary or --pass <pass-id>.");
  }
  return options;
}

function helpText() {
  return [
    `Inspect one bounded view page of at most ${MAX_INSPECTION_OUTPUT_BYTES} stdout bytes from a Hope ChangeRequestV1 context.`,
    "",
    "Usage:",
    "  node inspect-change-request.mjs --context <change-request.json> --summary",
    "  node inspect-change-request.mjs --context <change-request.json> --summary --after <receipt>",
    "  node inspect-change-request.mjs --context <change-request.json> --pass <pass-id>",
    "  node inspect-change-request.mjs --context <change-request.json> --pass <pass-id> --after <receipt>",
  ].join("\n");
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(`${helpText()}\n`);
    return undefined;
  }
  const context = await readChangeRequestContext(options.context);
  const pages = buildInspectionPages(context, options.summary
    ? { kind: "summary" }
    : { kind: "pass", passId: options.pass });
  const result = selectInspectionPage(pages, options.after);
  const output = `${JSON.stringify(result)}\n`;
  if (Buffer.byteLength(output) > MAX_INSPECTION_OUTPUT_BYTES) {
    throw new Error("Inspection stdout exceeded its bounded page limit.");
  }
  process.stdout.write(output);
  return result;
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
  main().catch((error) => {
    process.stderr.write(`inspect-change-request: ${error.message}\n`);
    process.exitCode = 1;
  });
}
