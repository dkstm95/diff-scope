// Generated from features/diff/finalize.mjs. Do not edit.
import { randomBytes } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdtemp,
  open,
  realpath,
  rm,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { CONTRACT_VERSION } from "./constants.mjs";

async function syncDirectory(path) {
  let handle;
  try {
    handle = await open(path, "r");
    await handle.sync();
  } catch (error) {
    if (process.platform !== "win32" && !["EINVAL", "ENOTSUP", "EISDIR"].includes(error?.code)) {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

async function writeExclusive(path, bytes) {
  const handle = await open(path, "wx", 0o600);
  let written;
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    written = await handle.stat();
  } finally {
    await handle.close();
  }
  const info = await lstat(path);
  if (
    !info.isFile()
    || info.isSymbolicLink()
    || info.nlink !== 1
    || info.dev !== written.dev
    || info.ino !== written.ino
    || info.size !== bytes.length
  ) {
    throw new Error("Hope review staging file has an unsafe identity");
  }
  return written;
}

function hasIdentity(info, expected) {
  return info.isFile()
    && !info.isSymbolicLink()
    && info.dev === expected.dev
    && info.ino === expected.ino;
}

export async function finalizeReview(bytes, {
  artifactDigest,
  linkFile = link,
  outputPath,
  revalidatedAt,
  runId,
  snapshotDigest,
  temporaryRoot = tmpdir(),
} = {}) {
  let privateDirectory;
  let target;
  if (outputPath) {
    const requested = isAbsolute(outputPath) ? outputPath : resolve(outputPath);
    const parent = await realpath(dirname(requested));
    target = join(parent, basename(requested));
  } else {
    const trustedTemporaryRoot = await realpath(temporaryRoot);
    privateDirectory = await mkdtemp(join(trustedTemporaryRoot, "hope-review-"));
    if (process.platform !== "win32") await chmod(privateDirectory, 0o700);
    target = join(privateDirectory, "hope-review.html");
  }

  const parent = dirname(target);
  const staging = join(
    parent,
    `.${basename(target)}.hope-${randomBytes(12).toString("hex")}.tmp`,
  );
  let published = false;
  let written;
  try {
    written = await writeExclusive(staging, bytes);
    try {
      await linkFile(staging, target);
      published = true;
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new Error(`Hope did not replace the existing output: ${target}`);
      }
      if (["EXDEV", "ENOTSUP", "EPERM"].includes(error?.code)) {
        throw new Error(
          "This filesystem cannot publish a Hope review without an overwrite race",
        );
      }
      throw error;
    }
    const [stagingInfo, targetInfo] = await Promise.all([
      lstat(staging),
      lstat(target),
    ]);
    if (
      !hasIdentity(stagingInfo, written)
      || !hasIdentity(targetInfo, written)
      || stagingInfo.nlink !== 2
      || targetInfo.nlink !== 2
    ) {
      throw new Error("Hope review publication identity changed");
    }
    await unlink(staging);
    const finalInfo = await lstat(target);
    if (!hasIdentity(finalInfo, written) || finalInfo.nlink !== 1) {
      throw new Error("Hope review publication identity changed");
    }
    await syncDirectory(parent);
  } catch (error) {
    if (published && written) {
      try {
        const targetInfo = await lstat(target);
        if (hasIdentity(targetInfo, written)) await unlink(target);
      } catch {
        // An unknown target is never removed.
      }
    }
    await unlink(staging).catch(() => {});
    if (privateDirectory) {
      await rm(privateDirectory, { recursive: true, force: true }).catch(() => {});
    }
    throw error;
  }

  return Object.freeze({
    artifactDigest,
    outputPath: target,
    publicationSchemaVersion: CONTRACT_VERSION,
    revalidatedAt,
    runId,
    snapshotDigest,
  });
}
