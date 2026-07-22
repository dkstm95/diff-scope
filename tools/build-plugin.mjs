#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const fromRoot = (path) => new URL(path, root);

export const pluginBundleEntries = Object.freeze([
  {
    banner: "",
    destination: "plugins/hope/LICENSE",
    executable: false,
    source: "LICENSE",
  },
  {
    banner: "<!-- Generated from docs/diff.md by tools/build-plugin.mjs. Do not edit. -->\n\n",
    destination: "plugins/hope/docs/diff.md",
    executable: false,
    source: "docs/diff.md",
  },
  {
    banner: "// Generated from features/diff/index.mjs by tools/build-plugin.mjs. Do not edit.\n",
    destination: "plugins/hope/runtime/diff/index.mjs",
    executable: false,
    source: "features/diff/index.mjs",
  },
  {
    banner: "// Generated from features/diff/cli.mjs by tools/build-plugin.mjs. Do not edit.\n",
    destination: "plugins/hope/runtime/diff/cli.mjs",
    executable: true,
    source: "features/diff/cli.mjs",
  },
]);

export async function expectedPluginFile(entry) {
  const source = await readFile(fromRoot(entry.source), "utf8");
  if (source.startsWith("#!")) {
    const firstLineEnd = source.indexOf("\n") + 1;
    return `${source.slice(0, firstLineEnd)}${entry.banner}${source.slice(firstLineEnd)}`;
  }
  return `${entry.banner}${source}`;
}

export async function buildPlugin() {
  for (const entry of pluginBundleEntries) {
    const destination = fileURLToPath(fromRoot(entry.destination));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, await expectedPluginFile(entry), "utf8");
    await chmod(destination, entry.executable ? 0o755 : 0o644);
  }
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
  buildPlugin().catch((error) => {
    process.stderr.write(`build-plugin: ${error.message}\n`);
    process.exitCode = 1;
  });
}
