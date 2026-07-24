#!/usr/bin/env node
// Generated from features/diff/cli.mjs. Do not edit.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  cancelDiff,
  DIFF_MODEL_ADAPTER_CODE,
  finishDiff,
  prepareDiff,
  readDiffPage,
  runDiff,
} from "./index.mjs";

function usage() {
  return [
    "Use the Hope diff feature.",
    "",
    "The automatic AI path is provided by the Hope skill.",
    "",
    "Internal skill protocol:",
    "  hope diff prepare [GitHub PR URL] [--host-locale <locale>] [--locale <locale>] [--theme <theme>] [--output <path>]",
    "  hope diff inspect --run <private-run-path> --page <number>",
    "  hope diff finish --run <private-run-path>",
    "  hope diff cancel --run <private-run-path>",
  ].join("\n");
}

function takeOptions(values) {
  const options = {};
  const positionals = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    const key = value.slice(2);
    if (!["host-locale", "locale", "theme", "output", "run", "page"].includes(key)) {
      throw new TypeError(`Unknown Hope diff option: ${value}`);
    }
    const next = values[index + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new TypeError(`Hope diff option ${value} needs a value`);
    }
    if (options[key] !== undefined) {
      throw new TypeError(`Hope diff option ${value} was repeated`);
    }
    options[key] = next;
    index += 1;
  }
  return { options, positionals };
}

export function parseDiffArguments(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return { command: "help" };
  }
  const [command, ...rest] = argv;
  if (!["prepare", "inspect", "finish", "cancel"].includes(command)) {
    return { arguments: argv, command: "automatic" };
  }
  const { options, positionals } = takeOptions(rest);
  if (command === "prepare") {
    if (positionals.length > 1 || options.run || options.page) {
      throw new TypeError(usage());
    }
    return {
      command,
      hostLocale: options["host-locale"],
      locale: options.locale,
      outputPath: options.output,
      theme: options.theme,
      url: positionals[0],
    };
  }
  if (positionals.length > 0 || !options.run) throw new TypeError(usage());
  if (command === "inspect") {
    const page = Number.parseInt(options.page, 10);
    if (!options.page || !Number.isSafeInteger(page) || String(page) !== options.page) {
      throw new TypeError(usage());
    }
    return { command, page, runPath: options.run };
  }
  if (options.page) throw new TypeError(usage());
  return { command, runPath: options.run };
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseDiffArguments(argv);
  const stdout = dependencies.stdout ?? process.stdout;
  let result;
  if (options.command === "help") {
    stdout.write(`${usage()}\n`);
    return;
  }
  if (options.command === "automatic") {
    return await (dependencies.runDiff ?? runDiff)(options.arguments);
  }
  if (options.command === "prepare") {
    result = await (dependencies.prepareDiff ?? prepareDiff)(options, dependencies);
  } else if (options.command === "inspect") {
    result = await (dependencies.readDiffPage ?? readDiffPage)(
      options.runPath,
      options.page,
      dependencies,
    );
  } else if (options.command === "finish") {
    result = await (dependencies.finishDiff ?? finishDiff)(options.runPath, dependencies);
  } else {
    result = await (dependencies.cancelDiff ?? cancelDiff)(options.runPath, dependencies);
  }
  if (result !== undefined) stdout.write(`${JSON.stringify(result, null, 2)}\n`);
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
    const details = error.code === "HOPE_ANALYSIS_INVALID"
      ? `\n${JSON.stringify({ canRetry: error.canRetry, code: error.code })}`
      : "";
    process.stderr.write(`hope diff: ${error.message}${details}\n`);
    process.exitCode = error.code === DIFF_MODEL_ADAPTER_CODE
      ? 2
      : error.code === "HOPE_ANALYSIS_INVALID"
        ? 3
        : error.code === "HOPE_DIFF_STALE"
          ? 4
          : 1;
  });
}
