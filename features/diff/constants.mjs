export const CONTRACT_VERSION = 1;
export const RENDERER_VERSION = 2;
export const RUN_VERSION = 1;

export const LIMITS = Object.freeze({
  artifactBytes: 6 * 1024 * 1024,
  changedFiles: 200,
  changedLines: 20_000,
  commits: 250,
  evidenceLines: 24,
  inspectionPageBytes: 16 * 1024,
  inspectionTotalBytes: 1024 * 1024,
  modelBytes: 512 * 1024,
  modelItems: 80,
  modelString: 32 * 1024,
  pullRequestBodyBytes: 32 * 1024,
  safeBodyBytes: 256 * 1024,
  safeBodyTotalBytes: 768 * 1024,
});

export const FILE_DISPOSITIONS = Object.freeze([
  "explained",
  "supporting",
  "mechanical",
  "metadata-only",
  "redacted",
]);

export const REVIEW_KINDS = Object.freeze(["resolve", "decide", "verify"]);
export const IMPORTANCE = Object.freeze(["high", "medium", "low"]);
export const BASIS = Object.freeze(["stated", "code", "inferred", "unknown"]);
