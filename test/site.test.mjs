import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  calculateChangeContextFingerprint,
  validateArtifactAgainstContext,
} from "../plugins/diff-scope/skills/diff/scripts/lib/validate-artifact.mjs";
import {
  buildSite,
  countSensitiveRedactions,
  parseBuildSiteArguments,
} from "../tools/build-site.mjs";

const artifactPath = new URL("../demo/source/artifact-v1.json", import.meta.url);
const contextPath = new URL("../demo/source/change-context-v1.json", import.meta.url);

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("public demo is exactly bound and contains no suspected sensitive material", async () => {
  const [artifact, context] = await Promise.all([json(artifactPath), json(contextPath)]);
  assert.equal(calculateChangeContextFingerprint(context), context.fingerprint);
  assert.equal(artifact.change.context.fingerprint, context.fingerprint);
  assert.equal(validateArtifactAgainstContext(artifact, context), artifact);
  assert.equal(countSensitiveRedactions(context), 0);
  assert.ok(
    countSensitiveRedactions({
      patches: [
        {
          text: "-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----",
        },
      ],
    }) > 0,
  );
});

test("builds a deterministic, offline Pages site from the shipped renderer", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "diff-scope-site-test-"));
  const first = join(temporary, "first");
  const second = join(temporary, "second");
  try {
    await buildSite(first);
    await buildSite(second);

    const expectedFiles = [
      "index.html",
      "styles.css",
      "site.js",
      "robots.txt",
      "assets/telescope.svg",
      "demo/artifact.json",
      "demo/explanation.md",
      "demo/index.html",
    ];
    for (const file of expectedFiles) {
      await readFile(join(first, file));
    }

    const [landing, firstDemo, secondDemo, firstArtifact, secondArtifact] = await Promise.all([
      readFile(join(first, "index.html"), "utf8"),
      readFile(join(first, "demo", "index.html"), "utf8"),
      readFile(join(second, "demo", "index.html"), "utf8"),
      readFile(join(first, "demo", "artifact.json"), "utf8"),
      readFile(join(second, "demo", "artifact.json"), "utf8"),
    ]);

    assert.match(landing, /href="\.\/demo\/"/u);
    assert.match(landing, /data-copy-target="install-prompt"/u);
    assert.doesNotMatch(landing, /codex:\/\//u);
    assert.doesNotMatch(landing, /<(?:script|link)[^>]+(?:src|href)="https?:/iu);
    assert.match(firstDemo, /<html lang="en">/u);
    assert.match(firstDemo, /connect-src 'none'/u);
    assert.match(firstDemo, /Interactive microworld/u);
    assert.equal(firstDemo, secondDemo);
    assert.equal(firstArtifact, secondArtifact);

    await assert.rejects(() => buildSite(first), /Refusing to overwrite existing site path/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("site build CLI accepts only the documented output option", () => {
  assert.equal(parseBuildSiteArguments([]).clean, true);
  assert.deepEqual(parseBuildSiteArguments(["--output", "/tmp/diff-scope-pages"]), {
    output: "/tmp/diff-scope-pages",
    clean: false,
  });
  assert.throws(() => parseBuildSiteArguments(["--clean"]), /Usage/);
});
