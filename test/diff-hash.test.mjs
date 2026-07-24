import assert from "node:assert/strict";
import test from "node:test";

import { digestJson } from "../features/diff/hash.mjs";

test("snapshot digests match their JSON representation", () => {
  const value = {
    array: [1, undefined, 3],
    missing: undefined,
    nested: { present: true, skipped: undefined },
  };
  assert.equal(digestJson(value), digestJson(JSON.parse(JSON.stringify(value))));
});
