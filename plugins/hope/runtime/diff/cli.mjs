#!/usr/bin/env node
// Generated from features/diff/cli.mjs by tools/build-plugin.mjs. Do not edit.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { DIFF_REBUILD_CODE, runDiff } from "./index.mjs";

export function parseDiffArguments(argv) {
  if (argv.length !== 0) {
    throw new TypeError("Hope diff does not accept arguments while it is being rebuilt.");
  }
  return {};
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  return await (dependencies.runDiff ?? runDiff)(parseDiffArguments(argv));
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
    process.stderr.write(`hope diff: ${error.message}\n`);
    process.exitCode = error.code === DIFF_REBUILD_CODE ? 2 : 1;
  });
}
