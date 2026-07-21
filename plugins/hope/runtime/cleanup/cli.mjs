#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  applyCleanup,
  previewCleanup,
} from "./cleanup-plan.mjs";

function usage() {
  return [
    "Preview or apply cleanup for files managed by Hope.",
    "",
    "Usage:",
    "  node cleanup.mjs preview",
    "  node cleanup.mjs apply --plan <plan.json> --digest <sha256> [--target <id>]...",
    "",
    "Preview never deletes files. Apply only accepts targets from that exact preview.",
    "This version covers managed reviews and completed or cancelled diff runs.",
    "Local and remote branches are not cleanup targets yet.",
  ].join("\n");
}

export function parseArguments(argv) {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  const [command, ...rest] = argv;
  if (!["preview", "apply"].includes(command)) {
    throw new TypeError("Choose preview or apply.");
  }
  const options = { command, targets: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (!["--plan", "--digest", "--target"].includes(argument)) {
      throw new TypeError(`Unknown argument: ${argument}`);
    }
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) {
      throw new TypeError(`${argument} requires a value.`);
    }
    if (argument === "--target") options.targets.push(value);
    else {
      const key = argument.slice(2);
      if (options[key] !== undefined) throw new TypeError(`${argument} may be provided only once.`);
      options[key] = value;
    }
    index += 1;
  }
  if (command === "preview" && rest.length > 0) {
    throw new TypeError("preview does not accept options.");
  }
  if (command === "apply" && (!options.plan || !options.digest)) {
    throw new TypeError("apply requires --plan and --digest.");
  }
  return options;
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return undefined;
  }
  const preview = dependencies.previewCleanup ?? previewCleanup;
  const apply = dependencies.applyCleanup ?? applyCleanup;
  const result = options.command === "preview"
    ? await preview()
    : await apply({
        planDigest: options.digest,
        planPath: options.plan,
        targetIds: options.targets,
      });
  process.stdout.write(`${JSON.stringify(result)}\n`);
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
    process.stderr.write(`hope-cleanup: ${error.message}\n`);
    process.exitCode = 1;
  });
}
