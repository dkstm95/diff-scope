#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { main as runDiffCommand } from "../features/diff/cli.mjs";

const { version: VERSION } = createRequire(import.meta.url)("../package.json");

function usage() {
  return [
    "Use the Hope harness.",
    "",
    "Usage:",
    "  hope --help",
    "  hope --version",
    "  hope diff",
    "",
    "Hope diff is being rebuilt from docs/diff.md.",
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
  if (command !== "diff") throw new TypeError(`Unknown Hope command: ${command}`);
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
  return await (dependencies.runDiffCommand ?? runDiffCommand)(options.arguments);
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
    process.exitCode = error.code === "HOPE_DIFF_REBUILDING" ? 2 : 1;
  });
}
