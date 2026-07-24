// Generated from features/diff/hash.mjs. Do not edit.
import { createHash } from "node:crypto";

export function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => (
      item === undefined || typeof item === "function" || typeof item === "symbol"
        ? "null"
        : canonicalJson(item)
    )).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).filter((key) => (
      value[key] !== undefined
      && typeof value[key] !== "function"
      && typeof value[key] !== "symbol"
    )).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return createHash("sha256").update(bytes).digest("hex");
}

export function digestJson(value) {
  return sha256(canonicalJson(value));
}
