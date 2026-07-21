import { lstat } from "node:fs/promises";
import process from "node:process";

export function currentUserId() {
  return typeof process.getuid === "function" ? process.getuid() : undefined;
}

export function ownedByCurrentUser(status, userId) {
  return userId === undefined || status.uid === userId;
}

export function hasExactPermissions(status, expectedMode) {
  return process.platform === "win32" || (status.mode & 0o777) === expectedMode;
}

export function fileIdentity(status) {
  return {
    ctimeMs: status.ctimeMs,
    dev: status.dev,
    ino: status.ino,
    mtimeMs: status.mtimeMs,
    size: status.size,
  };
}

export function sameIdentity(status, identity) {
  return (
    identity !== null &&
    typeof identity === "object" &&
    status.ctimeMs === identity.ctimeMs &&
    status.dev === identity.dev &&
    status.ino === identity.ino &&
    status.mtimeMs === identity.mtimeMs &&
    status.size === identity.size
  );
}

export function isSafeTemporaryRoot(status, userId) {
  if (process.platform === "win32") return true;
  const mode = status.mode & 0o7777;
  const privateRoot =
    Number.isInteger(userId) &&
    status.uid === userId &&
    (mode & 0o077) === 0;
  const stickySharedRoot =
    (mode & 0o1000) !== 0 &&
    (mode & 0o002) !== 0 &&
    (status.uid === 0 || status.uid === userId);
  return privateRoot || stickySharedRoot;
}

export async function safeTemporaryRootStatus(temporaryRoot, userId) {
  try {
    const status = await lstat(temporaryRoot);
    if (
      !status.isDirectory() ||
      status.isSymbolicLink() ||
      !isSafeTemporaryRoot(status, userId)
    ) {
      return undefined;
    }
    return status;
  } catch {
    return undefined;
  }
}
