import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { canonicalizeJson } from "./safety.mjs";

const RECEIPT_DOMAIN = "hope:inspection-page:v1\0";
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/u;
const PASS_ID_PATTERN = /^pass-[0-9]{3}$/u;
const MAX_ENTRY_BYTES = 12 * 1024;
const MAX_ENTRIES_BYTES = 15 * 1024;

export const INSPECTION_PROTOCOL_VERSION = 1;
export const MAX_INSPECTION_OUTPUT_BYTES = 16 * 1024;

function bytes(value) {
  return Buffer.byteLength(JSON.stringify(value));
}

function pointerSegment(value) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

function childPointer(pointer, segment) {
  return `${pointer}/${pointerSegment(segment)}`;
}

function stringChunkEntry(pointer, number, total, text) {
  return { pointer, stringChunk: { number, total, text } };
}

function splitString(pointer, value) {
  const characters = Array.from(value);
  const chunks = [];
  let start = 0;
  while (start < characters.length) {
    let low = start + 1;
    let high = characters.length;
    let accepted = start;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = characters.slice(start, middle).join("");
      const size = bytes(stringChunkEntry(pointer, 999_999, 999_999, candidate));
      if (size <= MAX_ENTRY_BYTES) {
        accepted = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    if (accepted === start) {
      throw new Error(`Inspection string chunk cannot fit within the bounded page entry: ${pointer}`);
    }
    chunks.push(characters.slice(start, accepted).join(""));
    start = accepted;
  }
  return chunks.map((text, index) => stringChunkEntry(pointer, index + 1, chunks.length, text));
}

function flattenValue(value, pointer = "") {
  const complete = { pointer, value };
  if (bytes(complete) <= MAX_ENTRY_BYTES) return [complete];
  if (typeof value === "string") return splitString(pointer, value);
  if (Array.isArray(value)) {
    if (value.length === 0) return [complete];
    return value.flatMap((entry, index) => flattenValue(entry, childPointer(pointer, index)));
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
    if (keys.length === 0) return [complete];
    return keys.flatMap((key) => flattenValue(value[key], childPointer(pointer, key)));
  }
  throw new Error(`Inspection value cannot fit within the bounded page entry: ${pointer}`);
}

function packEntries(entries) {
  const groups = [];
  let current = [];
  for (const entry of entries) {
    const candidate = [...current, entry];
    if (current.length > 0 && bytes(candidate) > MAX_ENTRIES_BYTES) {
      groups.push(current);
      current = [entry];
    } else {
      current = candidate;
    }
    if (bytes(current) > MAX_ENTRIES_BYTES) {
      throw new Error(`Inspection entry exceeds the bounded page payload: ${entry.pointer}`);
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function receiptFor(pageWithoutReceipt) {
  return createHash("sha256")
    .update(RECEIPT_DOMAIN, "utf8")
    .update(canonicalizeJson(pageWithoutReceipt), "utf8")
    .digest("hex");
}

function buildPassValue(changeRequest, passId) {
  if (typeof passId !== "string" || !PASS_ID_PATTERN.test(passId)) {
    throw new TypeError("--pass requires an id such as pass-001.");
  }
  const pass = changeRequest.analysisPlan.passes.find((candidate) => candidate.id === passId);
  if (!pass) throw new Error(`Analysis pass does not exist: ${passId}`);
  const patchesById = new Map(changeRequest.patches.map((patch) => [patch.id, patch]));
  return {
    value: {
      schemaVersion: 1,
      changeRequest: {
        provider: changeRequest.provider,
        repository: changeRequest.repository,
        id: changeRequest.id,
        url: changeRequest.url,
        state: changeRequest.state,
        reviewStage: changeRequest.reviewStage,
        isDraft: changeRequest.isDraft,
        baseSha: changeRequest.baseSha,
        mergeBaseSha: changeRequest.mergeBaseSha,
        headSha: changeRequest.headSha,
        comparison: changeRequest.comparison,
        snapshotFingerprint: changeRequest.snapshotFingerprint,
        fingerprint: changeRequest.fingerprint,
      },
      analysis: {
        lineLimitPerPass: changeRequest.analysisPlan.lineLimitPerPass,
        byteLimitPerPass: changeRequest.analysisPlan.byteLimitPerPass,
        pass,
      },
      patches: pass.patchIds.map((patchId) => patchesById.get(patchId)),
    },
    view: { kind: "pass", id: pass.id, fingerprint: pass.fingerprint },
  };
}

export function inspectionSummary(changeRequest) {
  const { patches: _patches, ...summary } = changeRequest;
  return summary;
}

export function inspectionPass(changeRequest, passId) {
  return buildPassValue(changeRequest, passId).value;
}

export function buildInspectionPages(changeRequest, { kind, passId } = {}) {
  if (!FINGERPRINT_PATTERN.test(changeRequest?.fingerprint ?? "")) {
    throw new TypeError("A fingerprinted ChangeRequestV1 is required for inspection paging.");
  }
  let value;
  let view;
  if (kind === "summary") {
    value = inspectionSummary(changeRequest);
    view = { kind: "summary", id: "summary", fingerprint: changeRequest.fingerprint };
  } else if (kind === "pass") {
    ({ value, view } = buildPassValue(changeRequest, passId));
  } else {
    throw new TypeError("Inspection kind must be summary or pass.");
  }

  const groups = packEntries(flattenValue(value));
  const total = groups.length;
  const pages = [];
  let after = null;
  groups.forEach((entries, index) => {
    const pageWithoutReceipt = {
      protocolVersion: INSPECTION_PROTOCOL_VERSION,
      changeRequestFingerprint: changeRequest.fingerprint,
      view,
      page: {
        number: index + 1,
        total,
        after,
        hasNext: index + 1 < total,
      },
      entries,
    };
    const page = { ...pageWithoutReceipt, receipt: receiptFor(pageWithoutReceipt) };
    const outputBytes = Buffer.byteLength(`${JSON.stringify(page)}\n`);
    if (outputBytes > MAX_INSPECTION_OUTPUT_BYTES) {
      throw new Error(
        `Inspection page ${index + 1} exceeds the ${MAX_INSPECTION_OUTPUT_BYTES}-byte stdout limit.`,
      );
    }
    pages.push(page);
    after = page.receipt;
  });
  return pages;
}

export function selectInspectionPage(pages, after) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new TypeError("At least one inspection page is required.");
  }
  if (after === undefined) return pages[0];
  if (typeof after !== "string" || !FINGERPRINT_PATTERN.test(after)) {
    throw new TypeError("--after must be the lowercase SHA-256 receipt from the previous page.");
  }
  const previousIndex = pages.findIndex((page) => page.receipt === after);
  if (previousIndex < 0) {
    throw new Error("--after does not match a receipt for this snapshot and inspection view.");
  }
  if (previousIndex + 1 >= pages.length) {
    throw new Error("--after is already the terminal receipt for this inspection view.");
  }
  return pages[previousIndex + 1];
}

export function inspectionCompletion(pages) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new TypeError("At least one inspection page is required.");
  }
  const terminal = pages.at(-1);
  return {
    pageCount: pages.length,
    terminalReceipt: terminal.receipt,
  };
}
