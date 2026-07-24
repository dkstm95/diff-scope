#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { main as runDiffCommand } from "../features/diff/cli.mjs";
import { main as runSettingsCommand } from "../settings/cli.mjs";

const { version: VERSION } = createRequire(import.meta.url)("../package.json");

function usage() {
  return [
    "Use the Hope harness.",
    "",
    "Usage:",
    "  hope --help",
    "  hope --version",
    "  hope diff",
    "  hope settings <show|set|reset>",
    "",
    "Automatic diff analysis currently runs through the Hope Claude or Codex skill.",
  ].join("\n");
}

export function parseArguments(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return { command: "help" };
  }
  if (argv.length === 1 && ["--version", "-v"].includes(argv[0])) {
    return { command: "version" };
  }
  const [command, ...rest] = argv;
  if (!["diff", "settings"].includes(command)) {
    throw new TypeError(`Unknown Hope command: ${command}`);
  }
  return { arguments: rest, command };
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseArguments(argv);
  const stdout = dependencies.stdout ?? process.stdout;
  if (options.command === "help") {
    stdout.write(`${usage()}\n`);
    return;
  }
  if (options.command === "version") {
    stdout.write(`${VERSION}\n`);
    return;
  }
  if (options.command === "settings") {
    return await (dependencies.runSettingsCommand ?? runSettingsCommand)(
      options.arguments,
      { ...dependencies, stdout },
    );
  }
  return await (dependencies.runDiffCommand ?? runDiffCommand)(
    options.arguments.length === 0 ? ["automatic"] : options.arguments,
    { ...dependencies, stdout },
  );
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
    process.stderr.write(`hope: ${error.message}\n`);
    process.exitCode = error.code === "HOPE_DIFF_MODEL_ADAPTER_REQUIRED" ? 2 : 1;
  });
}
