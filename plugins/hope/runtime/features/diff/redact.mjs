// Generated from features/diff/redact.mjs. Do not edit.
import { basename } from "node:path";

const privatePathPatterns = [
  /^\.env(?:\.|$)/u,
  /^(?:id_|ssh_host_).*(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)/u,
  /^(?:credentials|secrets?)(?:\.|$)/u,
];

const secretPatterns = [
  /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/u,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/u,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/u,
];

export function redactionKind(path, texts) {
  const name = basename(path).toLowerCase();
  if (
    privatePathPatterns.some((pattern) => pattern.test(name))
    && !/(?:example|sample|template)/u.test(name)
  ) {
    return "private-path";
  }
  for (const text of texts) {
    if (typeof text !== "string") continue;
    if (secretPatterns.some((pattern) => pattern.test(text))) {
      return "credential-pattern";
    }
  }
  return undefined;
}
