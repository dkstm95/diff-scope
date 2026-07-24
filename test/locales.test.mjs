import assert from "node:assert/strict";
import test from "node:test";

import {
  checkLocaleParity,
  label,
  loadLocale,
  normalizeLocale,
} from "../locales/index.mjs";

test("the supported locale dictionaries have identical keys", async () => {
  const keys = await checkLocaleParity();
  assert.ok(keys.includes("section.core"));
  assert.ok(keys.includes("settings.locale"));
});

test("locale normalization is narrow and labels fail closed", async () => {
  assert.equal(normalizeLocale("ko"), "ko-KR");
  assert.equal(normalizeLocale("en_US"), "en-US");
  assert.equal(normalizeLocale("ja-JP"), undefined);
  const dictionary = await loadLocale("ko-KR");
  assert.equal(label(dictionary, "item.resolve"), "해결 필요");
  assert.throws(() => label(dictionary, "missing.value"), /Missing locale key/u);
});
