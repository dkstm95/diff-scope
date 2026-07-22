import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  isSemanticVersion,
  replaceVersion,
  withVersion,
} from "../tools/prepare-release.mjs";
import {
  parsePackageFileList,
  readPackageFileList,
  stagePlugin,
} from "../tools/stage-plugin.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = resolve(root, "plugins/hope");

async function listFiles(directory, base = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...await listFiles(path, base));
    } else {
      paths.push(relative(base, path).split("\\").join("/"));
    }
  }
  return paths.sort();
}

test("release versions use one supported form", () => {
  assert.equal(isSemanticVersion("0.4.1-alpha"), true);
  assert.equal(isSemanticVersion("1.0.0-rc.1+build.2"), true);
  assert.equal(isSemanticVersion("v1.0.0"), false);
  assert.equal(isSemanticVersion("1.0"), false);
  assert.equal(isSemanticVersion("01.0.0"), false);
  assert.equal(isSemanticVersion("1.0.0-01"), false);
  assert.equal(isSemanticVersion("1.0.0-alpha..1"), false);
  assert.deepEqual(withVersion({ name: "hope", version: "old" }, "1.0.0"), {
    name: "hope",
    version: "1.0.0",
  });
  assert.throws(() => withVersion({}, "next"), /semantic version/u);
  assert.equal(
    replaceVersion('{\n  "version": "0.1.0",\n  "items": ["one", "two"]\n}\n', "1.0.0"),
    '{\n  "version": "1.0.0",\n  "items": ["one", "two"]\n}\n',
  );
  assert.throws(() => replaceVersion('{"name":"hope"}', "1.0.0"), /does not declare/u);
});

test("the package file list rejects ambiguous or unsafe paths", () => {
  assert.throws(() => parsePackageFileList("b\na\n"), /sorted/u);
  assert.throws(() => parsePackageFileList("a\na\n"), /duplicate/u);
  assert.throws(() => parsePackageFileList("../secret\n"), /unsafe/iu);
  assert.throws(() => parsePackageFileList("folder\\file\n"), /unsafe/iu);
  assert.throws(() => parsePackageFileList("folder/./file\n"), /unsafe/iu);
});

test("the release package contains exactly the approved plugin files", async (context) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "hope-package-test-"));
  const destination = join(temporaryRoot, "hope");
  context.after(async () => await rm(temporaryRoot, { recursive: true, force: true }));

  const expected = await readPackageFileList();
  assert.deepEqual(await listFiles(pluginRoot), expected);
  assert.deepEqual(await stagePlugin(destination), expected);
  assert.deepEqual(await listFiles(destination), expected);

  for (const entry of expected) {
    assert.deepEqual(
      await readFile(resolve(destination, entry)),
      await readFile(resolve(pluginRoot, entry)),
      entry,
    );
  }

  await assert.rejects(stagePlugin(destination), /already exists/u);
  await assert.rejects(
    stagePlugin(resolve(pluginRoot, "release-stage")),
    /outside plugins\/hope/u,
  );
});
