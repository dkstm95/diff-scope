import { constants as fsConstants } from "node:fs";
import { lstat, open, readdir, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";

export const DEFAULT_REVIEW_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

const REVIEW_DIRECTORY_PATTERN = /^hope-review-[A-Za-z0-9]{6}$/u;
const REVIEW_FILE_NAME = "hope-review.html";
const MANAGED_REVIEW_MARKER_PATTERN = /^<!-- Hope-managed temporary review; eligibleAfter=(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) -->\n$/u;
const MANAGED_REVIEW_MARKER_BYTES = Buffer.byteLength(
  "<!-- Hope-managed temporary review; eligibleAfter=2000-01-01T00:00:00.000Z -->\n",
);

function posixMode(status) {
  return status.mode & 0o777;
}

function sameFile(first, second) {
  return first.dev === second.dev && first.ino === second.ino;
}

function ownedByCurrentUser(status, currentUid) {
  return currentUid === undefined || status.uid === currentUid;
}

function hasExpectedPermissions(status, expectedMode) {
  return process.platform === "win32" || posixMode(status) === expectedMode;
}

function strictIsoTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    return undefined;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    return undefined;
  }
  return value;
}

export function eligibleAfterFromCreation(creationTimeMs) {
  if (!Number.isFinite(creationTimeMs)) {
    throw new TypeError("creationTimeMs must be finite");
  }
  return new Date(Math.ceil(creationTimeMs) + DEFAULT_REVIEW_RETENTION_MS).toISOString();
}

export function managedReviewMarker(eligibleAfter) {
  const timestamp = strictIsoTimestamp(eligibleAfter);
  if (timestamp === undefined) {
    throw new TypeError("eligibleAfter must be a strict ISO-8601 UTC timestamp");
  }
  return `<!-- Hope-managed temporary review; eligibleAfter=${timestamp} -->\n`;
}

export function parseManagedReviewMarker(value) {
  const match = MANAGED_REVIEW_MARKER_PATTERN.exec(value);
  return match === null ? undefined : strictIsoTimestamp(match[1]);
}

function safePosixTemporaryRoot(status, currentUid) {
  if (process.platform === "win32") return true;
  const mode = status.mode & 0o7777;
  const privateCurrentUserRoot =
    Number.isInteger(currentUid) &&
    status.uid === currentUid &&
    (mode & 0o077) === 0;
  const stickySharedRoot =
    (mode & 0o1000) !== 0 &&
    (mode & 0o002) !== 0 &&
    (status.uid === 0 || status.uid === currentUid);
  return privateCurrentUserRoot || stickySharedRoot;
}

async function readManagedMarker(filePath, expectedStatus) {
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const handle = await open(filePath, fsConstants.O_RDONLY | noFollow);
  try {
    const status = await handle.stat();
    if (!status.isFile() || !sameFile(status, expectedStatus)) return undefined;
    const marker = Buffer.alloc(MANAGED_REVIEW_MARKER_BYTES);
    const { bytesRead } = await handle.read(marker, 0, marker.length, 0);
    return bytesRead === marker.length
      ? parseManagedReviewMarker(marker.toString("utf8"))
      : undefined;
  } finally {
    await handle.close();
  }
}

async function inspectManagedReviewDirectory(directory, currentUid) {
  const directoryStatus = await lstat(directory);
  if (
    !directoryStatus.isDirectory() ||
    directoryStatus.isSymbolicLink() ||
    !ownedByCurrentUser(directoryStatus, currentUid) ||
    !hasExpectedPermissions(directoryStatus, 0o700)
  ) {
    return undefined;
  }

  const entries = await readdir(directory, { withFileTypes: true });
  if (
    entries.length !== 1 ||
    entries[0].name !== REVIEW_FILE_NAME ||
    !entries[0].isFile() ||
    entries[0].isSymbolicLink()
  ) {
    return undefined;
  }

  const file = join(directory, REVIEW_FILE_NAME);
  const fileStatus = await lstat(file);
  if (
    !fileStatus.isFile() ||
    fileStatus.isSymbolicLink() ||
    !ownedByCurrentUser(fileStatus, currentUid) ||
    !hasExpectedPermissions(fileStatus, 0o600) ||
    fileStatus.nlink !== 1 ||
    fileStatus.size < MANAGED_REVIEW_MARKER_BYTES
  ) {
    return undefined;
  }
  const eligibleAfter = await readManagedMarker(file, fileStatus);
  if (typeof eligibleAfter !== "string") return undefined;

  return {
    directory,
    directoryStatus,
    eligibleAfter,
    file,
    fileStatus,
  };
}

async function removeIfStillEligible(candidate, nowMs, currentUid) {
  if (nowMs < Date.parse(candidate.eligibleAfter)) return false;

  const current = await inspectManagedReviewDirectory(candidate.directory, currentUid);
  if (
    current === undefined ||
    !sameFile(current.directoryStatus, candidate.directoryStatus) ||
    !sameFile(current.fileStatus, candidate.fileStatus) ||
    current.eligibleAfter !== candidate.eligibleAfter ||
    nowMs < Date.parse(current.eligibleAfter)
  ) {
    return false;
  }

  try {
    await unlink(current.file);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  try {
    await rmdir(current.directory);
    return true;
  } catch (error) {
    if (["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error?.code)) return false;
    throw error;
  }
}

export async function cleanupExpiredDefaultReviews(options = {}) {
  const temporaryRoot = resolve(options.temporaryRoot ?? tmpdir());
  const nowMs = options.nowMs ?? Date.now();
  const currentUid = options.currentUid ??
    (typeof process.getuid === "function" ? process.getuid() : undefined);

  if (!Number.isFinite(nowMs)) {
    return { removedCount: 0 };
  }

  let rootStatus;
  let entries;
  try {
    rootStatus = await lstat(temporaryRoot);
    if (
      !rootStatus.isDirectory() ||
      rootStatus.isSymbolicLink() ||
      !safePosixTemporaryRoot(rootStatus, currentUid)
    ) {
      return { removedCount: 0 };
    }
    entries = await readdir(temporaryRoot, { withFileTypes: true });
  } catch {
    return { removedCount: 0 };
  }

  let removedCount = 0;
  for (const entry of entries) {
    if (!REVIEW_DIRECTORY_PATTERN.test(entry.name) || !entry.isDirectory()) continue;
    const directory = join(temporaryRoot, entry.name);
    try {
      const candidate = await inspectManagedReviewDirectory(directory, currentUid);
      if (
        candidate !== undefined &&
        dirname(candidate.directory) === temporaryRoot &&
        basename(candidate.directory) === entry.name &&
        await removeIfStillEligible(candidate, nowMs, currentUid)
      ) {
        removedCount += 1;
      }
    } catch {
      // Retention is best-effort and fail-closed: an uncertain entry is preserved.
    }
  }
  return { removedCount };
}

export async function defaultReviewEligibleAfter(filePath, options = {}) {
  const file = resolve(filePath);
  const directory = dirname(file);
  const temporaryRoot = resolve(options.temporaryRoot ?? tmpdir());
  if (
    basename(file) !== REVIEW_FILE_NAME ||
    dirname(directory) !== temporaryRoot ||
    !REVIEW_DIRECTORY_PATTERN.test(basename(directory))
  ) {
    return undefined;
  }
  const currentUid = typeof process.getuid === "function" ? process.getuid() : undefined;
  const candidate = await inspectManagedReviewDirectory(directory, currentUid);
  return candidate?.eligibleAfter;
}
