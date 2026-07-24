import assert from "node:assert/strict";
import test from "node:test";

import {
  createCodeHighlighter,
  languageFromPath,
} from "../features/diff/highlight.mjs";

test("code paths select a bounded supported language", () => {
  assert.equal(languageFromPath("src/review.ts"), "typescript");
  assert.equal(languageFromPath("web/App.tsx"), "tsx");
  assert.equal(languageFromPath("Dockerfile"), "dockerfile");
  assert.equal(languageFromPath("scripts/release.zsh"), "bash");
  assert.equal(languageFromPath("assets/image.png"), undefined);
});

test("GitHub light and dark token colors are emitted as trusted CSS classes", async () => {
  const highlighter = await createCodeHighlighter();
  const rendered = highlighter.render({
    excerpt: 'const answer = "<script>alert(1)</script>";',
    path: "src/answer.ts",
    sourceKind: "after-file",
  });
  const styles = highlighter.styleSheet();

  assert.match(rendered, /class="syntax-line"/u);
  assert.match(rendered, /class="syntax-token-[a-f0-9]{16}"/u);
  assert.match(rendered, /&lt;script&gt;/u);
  assert.doesNotMatch(rendered, /<script>/u);
  assert.doesNotMatch(rendered, /style=/u);
  assert.match(styles, /color:#CF222E/u);
  assert.match(styles, /color:#FF7B72/u);
  assert.match(styles, /:root\[data-theme="dark"\]/u);
});

test("patches mark changed lines while unknown files stay inert", async () => {
  const highlighter = await createCodeHighlighter();
  const patch = highlighter.render({
    excerpt: "@@ -10,2 +20,2 @@\n-const oldValue = true;\n+const newValue = false;\n unchanged();",
    path: "src/value.ts",
    sourceKind: "patch",
  });
  const unknown = highlighter.render({
    excerpt: "<tag>plain</tag>",
    path: "assets/example.unknown",
    sourceKind: "after-file",
  });

  assert.match(patch, /syntax-line-removed/u);
  assert.match(patch, /syntax-line-added/u);
  assert.match(patch, /class="syntax-token-[a-f0-9]{16}"/u);
  assert.match(patch, /data-old-line="10" data-new-line=""/u);
  assert.match(patch, /data-old-line="" data-new-line="20"/u);
  assert.match(patch, /data-old-line="11" data-new-line="21"/u);
  assert.match(patch, /<\/span><span class="syntax-line/u);
  assert.doesNotMatch(patch, /<\/span>\s+<span class="syntax-line/u);
  assert.equal(unknown, "&lt;tag&gt;plain&lt;/tag&gt;");
});

test("patches without hunk coordinates do not reserve an empty line-number column", async () => {
  const highlighter = await createCodeHighlighter();
  const patch = highlighter.render({
    excerpt: "+const safe = true;\n-const old = false;",
    path: "src/value.ts",
    sourceKind: "patch",
  });

  assert.equal((patch.match(/syntax-line-unlocated/gu) ?? []).length, 2);
  assert.doesNotMatch(patch, /data-old-line=/u);
});

test("bidirectional controls are shown instead of changing visual order", async () => {
  const highlighter = await createCodeHighlighter();
  const rendered = highlighter.render({
    excerpt: "const safe = true; // \u202E } hidden",
    path: "src/value.ts",
    sourceKind: "after-file",
  });

  assert.match(rendered, /\\u202E/u);
  assert.doesNotMatch(rendered, /\u202E/u);
});

test("highlighted source uses adjacent block lines without spacer text nodes", async () => {
  const highlighter = await createCodeHighlighter();
  const rendered = highlighter.render({
    excerpt: "const first = 1;\nconst second = 2;",
    path: "src/value.ts",
    sourceKind: "after-file",
  });

  assert.match(rendered, /<\/span><\/span><span class="syntax-line"/u);
  assert.doesNotMatch(rendered, /<\/span><\/span>\s+<span class="syntax-line"/u);
});
