#!/usr/bin/env node

import { realpathSync } from "node:fs";
import {
  chmod,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { build as esbuild } from "esbuild";

import {
  generatedPluginFiles,
  pluginPackageFiles,
} from "./plugin-files.mjs";

const root = new URL("../", import.meta.url);
const fromRoot = (path) => new URL(path, root);

export const normalizeLineEndings = (content) => content.replace(/\r\n?/gu, "\n");
export const pluginBundleEntries = generatedPluginFiles;

export async function expectedPluginFile(entry) {
  if (entry.bundle) {
    const result = await esbuild({
      absWorkingDir: fileURLToPath(root),
      bundle: true,
      charset: "utf8",
      entryPoints: [entry.source],
      format: "esm",
      legalComments: "inline",
      minify: true,
      platform: "node",
      target: "node20",
      treeShaking: true,
      write: false,
    });
    if (result.outputFiles.length !== 1) {
      throw new Error(`Expected one bundled output for ${entry.source}`);
    }
    const text = normalizeLineEndings(result.outputFiles[0].text);
    return `${entry.banner}${text}`;
  }
  const source = await readFile(fromRoot(entry.source));
  if (entry.binary) return source;
  const text = normalizeLineEndings(source.toString("utf8"));
  if (text.startsWith("#!")) {
    const firstLineEnd = text.indexOf("\n") + 1;
    return `${text.slice(0, firstLineEnd)}${entry.banner}${text.slice(firstLineEnd)}`;
  }
  return `${entry.banner}${text}`;
}

export async function buildPlugin() {
  await rm(fileURLToPath(fromRoot("plugins/hope/docs")), {
    force: true,
    recursive: true,
  });
  await rm(fileURLToPath(fromRoot("plugins/hope/runtime")), {
    force: true,
    recursive: true,
  });
  for (const entry of pluginBundleEntries) {
    const destination = fileURLToPath(fromRoot(entry.destination));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, await expectedPluginFile(entry));
    await chmod(
      destination,
      entry.destination.endsWith("/cli.mjs") ? 0o755 : 0o644,
    );
  }
  await writeFile(
    fromRoot("tools/plugin-package-files.txt"),
    `${pluginPackageFiles.join("\n")}\n`,
    "utf8",
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
  buildPlugin().catch((error) => {
    process.stderr.write(`build-plugin: ${error.message}\n`);
    process.exitCode = 1;
  });
}
