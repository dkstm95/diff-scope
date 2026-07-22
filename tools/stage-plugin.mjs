#!/usr/bin/env node

import { realpathSync } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
} from "node:fs/promises";
import { dirname, isAbsolute, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const pluginRoot = resolve(root, "plugins/hope");
const packageFileList = new URL("./plugin-package-files.txt", import.meta.url);

export function parsePackageFileList(content) {
  const entries = content.split(/\r?\n/u).filter(Boolean);
  if (entries.length === 0) throw new Error("The plugin package file list is empty");

  const sortedEntries = [...entries].sort();
  if (entries.some((entry, index) => entry !== sortedEntries[index])) {
    throw new Error("The plugin package file list must be sorted");
  }
  if (new Set(entries).size !== entries.length) {
    throw new Error("The plugin package file list contains a duplicate");
  }

  for (const entry of entries) {
    if (
      isAbsolute(entry)
      || entry.startsWith("/")
      || entry.includes("\\")
      || entry.split("/").includes("..")
      || entry.endsWith("/")
      || posix.normalize(entry) !== entry
    ) {
      throw new Error(`Unsafe plugin package path: ${entry}`);
    }
  }
  return entries;
}

export async function readPackageFileList() {
  return parsePackageFileList(await readFile(packageFileList, "utf8"));
}

function isInside(parent, candidate) {
  const pathFromParent = relative(parent, candidate);
  return pathFromParent === "" || (
    !isAbsolute(pathFromParent)
    && !pathFromParent.startsWith(`..${sep}`)
    && pathFromParent !== ".."
  );
}

export async function stagePlugin(destination) {
  const resolvedDestination = resolve(destination);
  if (isInside(pluginRoot, resolvedDestination)) {
    throw new Error("The package staging directory must be outside plugins/hope");
  }
  await access(resolvedDestination).then(
    () => {
      throw new Error(`The package staging directory already exists: ${resolvedDestination}`);
    },
    () => {},
  );

  const entries = await readPackageFileList();
  await mkdir(resolvedDestination, { recursive: true });
  for (const entry of entries) {
    const source = resolve(pluginRoot, entry);
    const sourceInfo = await lstat(source);
    if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) {
      throw new Error(`Plugin package entry is not a regular file: ${entry}`);
    }

    const target = resolve(resolvedDestination, entry);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
    await chmod(target, sourceInfo.mode & 0o777);
  }
  return entries;
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
  const [destination, ...extraArguments] = process.argv.slice(2);
  if (!destination || extraArguments.length > 0) {
    process.stderr.write("Usage: node tools/stage-plugin.mjs <empty-directory>\n");
    process.exitCode = 1;
  } else {
    stagePlugin(destination).catch((error) => {
      process.stderr.write(`stage-plugin: ${error.message}\n`);
      process.exitCode = 1;
    });
  }
}
