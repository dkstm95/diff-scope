#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { constants as fsConstants } from "node:fs";
import { lstat, open, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  SnapshotChangedError,
  assertSameSnapshot,
  collectChangeRequest,
  readCurrentSnapshot,
  validateChangeRequest,
} from "./collect-change-request.mjs";
import { writeReviewHtml } from "./lib/render-review.mjs";
import { validateReviewAgainstChangeRequest } from "./lib/validate-review.mjs";

const MAX_REVIEW_BYTES = 4 * 1024 * 1024;
const MAX_CONTEXT_BYTES = 2 * 1024 * 1024;

function usage() {
  return `Usage:
  node render-review.mjs --input <review-model.json> --context <change-request.json> [--output <new-file.html>] [--cleanup]
  node render-review.mjs --context <change-request.json> --cleanup

Options:
  --input    Transient ReviewModelV1 JSON generated in the active AI session.
  --context  Transient ChangeRequestV1 JSON produced by collect-change-request.mjs.
  --output   Export to a new HTML file. Existing paths are never overwritten.
  --cleanup  Remove Hope-owned transient JSON after success, failure, or an
             interrupted model-generation step when --input is omitted.
  --help     Show this help message.
`;
}

export function parseRenderArguments(argumentsList) {
  const parsed = {
    input: undefined,
    context: undefined,
    output: undefined,
    cleanup: false,
    cleanupOnly: false,
    help: false,
  };

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--help" || argument === "-h") {
      parsed.help = true;
      continue;
    }
    if (argument === "--cleanup") {
      if (parsed.cleanup) {
        throw new Error("--cleanup may be provided only once");
      }
      parsed.cleanup = true;
      continue;
    }
    if (!["--input", "--context", "--output"].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argumentsList[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${argument} requires a path`);
    }
    const key = argument.slice(2);
    if (parsed[key] !== undefined) {
      throw new Error(`${argument} may be provided only once`);
    }
    parsed[key] = value;
    index += 1;
  }

  if (!parsed.help && parsed.context === undefined) {
    throw new Error("--context is required");
  }
  if (!parsed.help && parsed.input === undefined) {
    if (!parsed.cleanup) {
      throw new Error("--input is required unless --context is used with --cleanup");
    }
    if (parsed.output !== undefined) {
      throw new Error("--output is not allowed for cleanup-only mode");
    }
    parsed.cleanupOnly = true;
  }
  if (
    !parsed.help &&
    parsed.input !== undefined &&
    resolve(parsed.input) === resolve(parsed.context)
  ) {
    throw new Error("--input and --context must be different files");
  }
  if (!parsed.help && parsed.cleanup) {
    if (parsed.cleanupOnly) {
      assertHopeOwnedContextPath(parsed.context);
    } else {
      assertHopeOwnedCleanupInputs(parsed.input, parsed.context);
    }
  }
  return parsed;
}

async function readBoundedHandle(handle, maximumBytes) {
  const chunks = [];
  let bytesRead = 0;
  while (bytesRead <= maximumBytes) {
    const remaining = maximumBytes + 1 - bytesRead;
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
    const result = await handle.read(buffer, 0, buffer.length, bytesRead);
    if (result.bytesRead === 0) {
      break;
    }
    chunks.push(buffer.subarray(0, result.bytesRead));
    bytesRead += result.bytesRead;
  }
  if (bytesRead > maximumBytes) {
    throw new Error(`input exceeds the ${maximumBytes}-byte limit`);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function loadJsonDocument(inputPath, label, maximumBytes) {
  const pathStatus = await lstat(inputPath);
  if (!pathStatus.isFile() || pathStatus.isSymbolicLink()) {
    throw new Error(`${label} is not a regular, non-symlink file: ${inputPath}`);
  }
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const handle = await open(inputPath, fsConstants.O_RDONLY | noFollow);
  try {
    const status = await handle.stat();
    if (!status.isFile()) {
      throw new Error(`${label} is not a regular file: ${inputPath}`);
    }
    if (status.size > maximumBytes) {
      throw new Error(`${label} exceeds the ${maximumBytes}-byte limit`);
    }
    const source = await readBoundedHandle(handle, maximumBytes).catch((error) => {
      if (error.message.startsWith("input exceeds")) {
        throw new Error(`${label} exceeds the ${maximumBytes}-byte limit`, { cause: error });
      }
      throw error;
    });
    try {
      return JSON.parse(source);
    } catch (error) {
      throw new Error(`${label} is not valid JSON: ${error.message}`, { cause: error });
    }
  } finally {
    await handle.close();
  }
}

export function assertLiveChangeRequestMatches(stored, live) {
  validateChangeRequest(stored);
  validateChangeRequest(live);
  try {
    assertSameSnapshot(stored, live);
  } catch (error) {
    if (error instanceof SnapshotChangedError || error?.code === "stale") {
      throw new Error(
        "The pull request changed while Hope was preparing this review. Run $hope:diff again for the current snapshot.",
        { cause: error },
      );
    }
    throw error;
  }
  if (stored.fingerprint !== live.fingerprint) {
    throw new Error(
      "The pull request changed while Hope was preparing this review. Run $hope:diff again for the current snapshot.",
    );
  }
  return live;
}

export function assertHopeOwnedCleanupInputs(inputPath, contextPath) {
  const resolvedInput = resolve(inputPath);
  const resolvedContext = resolve(contextPath);
  const inputDirectory = dirname(resolvedInput);
  if (
    inputDirectory !== dirname(resolvedContext) ||
    dirname(inputDirectory) !== resolve(tmpdir()) ||
    !basename(inputDirectory).startsWith("hope-context-") ||
    basename(resolvedInput) !== "review-model.json" ||
    basename(resolvedContext) !== "change-request.json"
  ) {
    throw new Error(
      "--cleanup is limited to review-model.json and change-request.json in the same Hope-owned temporary directory",
    );
  }
  return [resolvedInput, resolvedContext];
}

export function assertHopeOwnedContextPath(contextPath) {
  const resolvedContext = resolve(contextPath);
  const directory = dirname(resolvedContext);
  if (
    dirname(directory) !== resolve(tmpdir()) ||
    !basename(directory).startsWith("hope-context-") ||
    basename(resolvedContext) !== "change-request.json"
  ) {
    throw new Error(
      "--cleanup is limited to change-request.json in a Hope-owned temporary directory",
    );
  }
  return resolvedContext;
}

async function removeTransientFile(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

async function removeEmptyHopeContextDirectory(filePaths) {
  const directories = new Set(filePaths.map((filePath) => dirname(resolve(filePath))));
  for (const directory of directories) {
    if (!basename(directory).startsWith("hope-context-")) {
      continue;
    }
    try {
      await rmdir(directory);
    } catch (error) {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error?.code)) {
        throw error;
      }
    }
  }
}

async function assertPrivateHopeDirectory(filePaths) {
  const directories = new Set(filePaths.map((filePath) => dirname(resolve(filePath))));
  for (const directory of directories) {
    const status = await lstat(directory);
    const hasUnsafePosixPermissions =
      process.platform !== "win32" && (status.mode & 0o077) !== 0;
    if (!status.isDirectory() || status.isSymbolicLink() || hasUnsafePosixPermissions) {
      throw new Error("Hope cleanup requires a private, non-symlink temporary directory");
    }
  }
}

export async function cleanupTransientInputs(filePaths) {
  if (filePaths.length !== 2) {
    throw new Error("Hope cleanup requires exactly two transient input paths");
  }
  const unique = assertHopeOwnedCleanupInputs(filePaths[0], filePaths[1]);
  await assertPrivateHopeDirectory(unique);
  await Promise.all(unique.map(async (filePath) => await removeTransientFile(filePath)));
  await removeEmptyHopeContextDirectory(unique);
}

export async function cleanupTransientContext(contextPath) {
  const context = assertHopeOwnedContextPath(contextPath);
  const review = join(dirname(context), "review-model.json");
  await assertPrivateHopeDirectory([context, review]);
  await Promise.all([context, review].map(async (filePath) => await removeTransientFile(filePath)));
  await removeEmptyHopeContextDirectory([context, review]);
}

async function removeFailedOutput(result, requestedOutput) {
  if (!result?.file) {
    return;
  }
  await removeTransientFile(result.file);
  if (requestedOutput === undefined) {
    const directory = dirname(result.file);
    if (basename(directory).startsWith("hope-review-")) {
      try {
        await rmdir(directory);
      } catch (error) {
        if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error?.code)) {
          throw error;
        }
      }
    }
  }
}

export async function main(
  argumentsList = process.argv.slice(2),
  dependencies = {},
) {
  const parsed = parseRenderArguments(argumentsList);
  if (parsed.help) {
    process.stdout.write(usage());
    return undefined;
  }
  if (parsed.cleanupOnly) {
    await cleanupTransientContext(parsed.context);
    process.stdout.write("Hope transient context removed.\n");
    return { cleaned: true };
  }

  const collect = dependencies.collectChangeRequest ?? collectChangeRequest;
  const currentSnapshot = dependencies.readCurrentSnapshot ?? readCurrentSnapshot;
  const write = dependencies.writeReviewHtml ?? writeReviewHtml;
  let result;
  let primaryError;

  try {
    const review = await loadJsonDocument(
      parsed.input,
      "ReviewModelV1 input",
      MAX_REVIEW_BYTES,
    );
    const storedContext = await loadJsonDocument(
      parsed.context,
      "ChangeRequestV1 context",
      MAX_CONTEXT_BYTES,
    );
    validateChangeRequest(storedContext);

    const liveContext = assertLiveChangeRequestMatches(
      storedContext,
      await collect({ url: storedContext.url }),
    );
    validateReviewAgainstChangeRequest(review, liveContext);

    result = await write(review, {
      changeRequest: liveContext,
      outputFile: parsed.output,
    });

    try {
      const finalSnapshot = await currentSnapshot({ url: storedContext.url });
      assertSameSnapshot(liveContext, finalSnapshot);
    } catch (error) {
      await removeFailedOutput(result, parsed.output);
      result = undefined;
      if (error instanceof SnapshotChangedError || error?.code === "stale") {
        throw new Error(
          "The pull request changed before the Hope review was finalized; the new HTML was removed.",
          { cause: error },
        );
      }
      throw new Error(
        "Hope could not revalidate the pull request after rendering; the new HTML was removed. Check GitHub access and try again.",
        { cause: error },
      );
    }

  } catch (error) {
    primaryError = error;
  }

  try {
    if (parsed.cleanup) {
      await cleanupTransientInputs([parsed.input, parsed.context]);
    }
  } catch (cleanupError) {
    if (primaryError) {
      primaryError.message = `${primaryError.message}\nTransient input cleanup also failed: ${cleanupError.message}`;
      Object.defineProperty(primaryError, "cleanupError", {
        configurable: true,
        enumerable: false,
        value: cleanupError,
      });
    } else {
      primaryError = cleanupError;
    }
  }

  if (primaryError) {
    throw primaryError;
  }

  process.stdout.write(`${result.file}\n`);
  return result;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
