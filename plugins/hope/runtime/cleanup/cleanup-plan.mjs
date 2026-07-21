import { constants as fsConstants } from "node:fs";
import {
  chmod,
  lstat,
  mkdtemp,
  open,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { createHash, randomUUID } from "node:crypto";

import {
  listManagedReviews,
  removeManagedReview,
} from "../../skills/diff/scripts/lib/review-retention.mjs";
import {
  listTerminalDiffRuns,
  removeTerminalDiffRun,
} from "../diff/diff-run.mjs";

export const CLEANUP_PLAN_TTL_MS = 30 * 60 * 1_000;
const MAX_PLAN_BYTES = 1024 * 1024;
const MAX_TARGETS = 1_000;
const PLAN_DIRECTORY_PATTERN = /^hope-cleanup-[A-Za-z0-9]{6}$/u;

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function targetId(target) {
  return digest(target);
}

function planBody(plan) {
  const { planDigest: ignoredDigest, planPath: ignoredPath, ...body } = plan;
  return body;
}

function withPlanDigest(plan) {
  return { ...plan, planDigest: digest(planBody(plan)) };
}

async function writeNewPrivateJson(file, value) {
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.chmod(0o600);
  } finally {
    await handle.close();
  }
}

async function assertPrivatePlanDirectory(directory, temporaryRoot) {
  if (
    dirname(directory) !== temporaryRoot ||
    !PLAN_DIRECTORY_PATTERN.test(basename(directory))
  ) {
    throw new Error("Cleanup plan must be inside a Hope cleanup directory.");
  }
  const status = await lstat(directory);
  const unsafeMode = process.platform !== "win32" && (status.mode & 0o077) !== 0;
  if (!status.isDirectory() || status.isSymbolicLink() || unsafeMode) {
    throw new Error("Cleanup plan directory is not private.");
  }
}

async function readPrivateJson(file, label, temporaryRoot) {
  const resolved = resolve(file);
  const directory = dirname(resolved);
  await assertPrivatePlanDirectory(directory, temporaryRoot);
  const pathStatus = await lstat(resolved);
  const unsafeMode = process.platform !== "win32" && (pathStatus.mode & 0o077) !== 0;
  if (
    !pathStatus.isFile() ||
    pathStatus.isSymbolicLink() ||
    unsafeMode ||
    pathStatus.size > MAX_PLAN_BYTES
  ) {
    throw new Error(`${label} is not a small private file.`);
  }
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const handle = await open(resolved, fsConstants.O_RDONLY | noFollow);
  try {
    const status = await handle.stat();
    if (!status.isFile() || status.size > MAX_PLAN_BYTES) {
      throw new Error(`${label} changed while opening.`);
    }
    return JSON.parse(await handle.readFile("utf8"));
  } finally {
    await handle.close();
  }
}

function validatePlan(plan) {
  if (
    plan === null ||
    typeof plan !== "object" ||
    plan.schemaVersion !== 1 ||
    plan.revision !== 1 ||
    typeof plan.id !== "string" ||
    typeof plan.createdAt !== "string" ||
    typeof plan.expiresAt !== "string" ||
    !Array.isArray(plan.targets) ||
    plan.targets.length > MAX_TARGETS ||
    typeof plan.planDigest !== "string"
  ) {
    throw new Error("Cleanup plan has an unsupported shape.");
  }
  if (digest(planBody(plan)) !== plan.planDigest) {
    throw new Error("Cleanup plan changed after preview.");
  }
  const ids = new Set();
  for (const target of plan.targets) {
    if (
      target === null ||
      typeof target !== "object" ||
      !["diff-run", "managed-review"].includes(target.kind) ||
      typeof target.id !== "string" ||
      ids.has(target.id)
    ) {
      throw new Error("Cleanup plan contains an invalid target.");
    }
    ids.add(target.id);
  }
  return plan;
}

export async function previewCleanup(options = {}) {
  const temporaryRoot = resolve(options.temporaryRoot ?? tmpdir());
  const nowMs = options.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) throw new TypeError("nowMs must be finite.");
  const reviews = await listManagedReviews({
    temporaryRoot,
    currentUid: options.currentUid,
  });
  const runs = await listTerminalDiffRuns({
    temporaryRoot,
    currentUid: options.currentUid,
  });
  if (reviews.length + runs.length > MAX_TARGETS) {
    throw new Error(`Hope found more than ${MAX_TARGETS} cleanup targets.`);
  }

  const directory = await mkdtemp(join(temporaryRoot, "hope-cleanup-"));
  await chmod(directory, 0o700);
  const planPath = join(directory, "plan.json");
  const targets = [
    ...reviews.map((review) => ({ ...review, kind: "managed-review" })),
    ...runs.map((run) => ({ ...run, kind: "diff-run" })),
  ]
    .map((target) => ({ ...target, id: targetId(target) }))
    .sort((first, second) => first.file.localeCompare(second.file));
  const plan = withPlanDigest({
    schemaVersion: 1,
    revision: 1,
    id: randomUUID(),
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + CLEANUP_PLAN_TTL_MS).toISOString(),
    targets,
  });
  await writeNewPrivateJson(planPath, plan);
  return { ...plan, planPath };
}

export async function readCleanupPlan(planPath, options = {}) {
  const temporaryRoot = resolve(options.temporaryRoot ?? tmpdir());
  const resolved = resolve(planPath);
  if (basename(resolved) !== "plan.json") {
    throw new Error("Cleanup plan file must be named plan.json.");
  }
  return validatePlan(await readPrivateJson(resolved, "Cleanup plan", temporaryRoot));
}

function selectedTargetIds(plan, requestedIds) {
  if (requestedIds === undefined || requestedIds.length === 0) {
    return plan.targets.map((target) => target.id);
  }
  const known = new Set(plan.targets.map((target) => target.id));
  const selected = [...new Set(requestedIds)];
  for (const id of selected) {
    if (!known.has(id)) throw new Error(`Cleanup target is not in the approved plan: ${id}`);
  }
  return selected;
}

async function readExistingResult(resultPath, temporaryRoot) {
  try {
    return await readPrivateJson(resultPath, "Cleanup result", temporaryRoot);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function applyCleanup(options) {
  if (options === null || typeof options !== "object") {
    throw new TypeError("Cleanup options are required.");
  }
  const temporaryRoot = resolve(options.temporaryRoot ?? tmpdir());
  const planPath = resolve(options.planPath);
  const plan = await readCleanupPlan(planPath, { temporaryRoot });
  if (plan.planDigest !== options.planDigest) {
    throw new Error("Cleanup approval does not match this plan.");
  }
  const nowMs = options.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs) || nowMs > Date.parse(plan.expiresAt)) {
    throw new Error("Cleanup plan expired. Preview cleanup again.");
  }

  const resultPath = join(dirname(planPath), "result.json");
  const existing = await readExistingResult(resultPath, temporaryRoot);
  if (existing !== undefined) return existing;

  const ids = selectedTargetIds(plan, options.targetIds);
  const selected = new Set(ids);
  const targets = [];
  for (const target of plan.targets) {
    if (!selected.has(target.id)) continue;
    const remove = target.kind === "managed-review"
      ? removeManagedReview
      : removeTerminalDiffRun;
    const outcome = await remove(target, {
      temporaryRoot,
      currentUid: options.currentUid,
    });
    targets.push({
      id: target.id,
      file: target.file,
      kind: target.kind,
      reason: outcome.reason,
      status: outcome.status,
    });
  }
  const result = {
    schemaVersion: 1,
    planId: plan.id,
    planDigest: plan.planDigest,
    completedAt: new Date(nowMs).toISOString(),
    targets,
  };
  try {
    await writeNewPrivateJson(resultPath, result);
    return result;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    return await readPrivateJson(resultPath, "Cleanup result", temporaryRoot);
  }
}
