// Generated from features/diff/index.mjs. Do not edit.
import { lstat, open } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { resolveSettings } from "../../settings/index.mjs";
import { LIMITS } from "./constants.mjs";
import { finalizeReview } from "./finalize.mjs";
import {
  collectGitHubPullRequest,
  parseGitHubPullRequestUrl,
  revalidateGitHubSnapshot,
} from "./github.mjs";
import { renderReview } from "./render.mjs";
import {
  claimDiffRunFinalization,
  createDiffRun,
  inspectDiffRun,
  loadDiffRun,
  recordAnalysisFailure,
  removeDiffRun,
} from "./run.mjs";
import { discoverGitHubPullRequest } from "./target.mjs";
import { validateAnalysis } from "./validate.mjs";

export const DIFF_MODEL_ADAPTER_CODE = "HOPE_DIFF_MODEL_ADAPTER_REQUIRED";
export const DIFF_MODEL_ADAPTER_MESSAGE =
  "Automatic Hope diff analysis currently runs through the Claude or Codex skill.";

async function readAnalysis(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error("Hope analysis is not a regular file");
  }
  if (info.size > LIMITS.modelBytes) {
    throw new Error(`Hope analysis exceeds ${LIMITS.modelBytes} bytes`);
  }
  const handle = await open(path, "r");
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile()
      || opened.dev !== info.dev
      || opened.ino !== info.ino
      || opened.size !== info.size
    ) {
      throw new Error("Hope analysis changed while being opened");
    }
    return JSON.parse(await handle.readFile("utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("Hope analysis is not valid JSON", { cause: error });
    }
    throw error;
  } finally {
    await handle.close();
  }
}

export async function prepareDiff({
  hostLocale,
  locale,
  outputPath,
  theme,
  url,
} = {}, dependencies = {}) {
  const settings = await (dependencies.resolveSettings ?? resolveSettings)({
    hostLocale,
    locale,
    theme,
    ...(dependencies.settingsOptions ?? {}),
  });
  const target = url
    ? parseGitHubPullRequestUrl(url)
    : await (dependencies.discoverTarget ?? discoverGitHubPullRequest)(
      dependencies.targetOptions,
    );
  const snapshot = await (dependencies.collect ?? collectGitHubPullRequest)(target, {
    clock: dependencies.clock,
    gh: dependencies.gh,
    locale: settings.locale,
    localeSource: settings.localeSource,
    theme: settings.theme,
    themeSource: settings.themeSource,
  });
  const run = await (dependencies.createRun ?? createDiffRun)(snapshot, {
    clock: dependencies.clock,
    outputPath,
    temporaryRoot: dependencies.temporaryRoot,
  });
  return Object.freeze({
    ...run,
    analysisSchemaPath: fileURLToPath(
      new URL("./analysis-v1.schema.json", import.meta.url),
    ),
    locale: settings.locale,
    pullRequest: snapshot.pullRequest,
    selection: target.selection ?? "explicit",
    theme: settings.theme,
  });
}

export async function readDiffPage(runPath, page, dependencies = {}) {
  return await (dependencies.inspectRun ?? inspectDiffRun)(runPath, page, {
    temporaryRoot: dependencies.temporaryRoot,
  });
}

export async function finishDiff(runPath, dependencies = {}) {
  const run = await (dependencies.loadRun ?? loadDiffRun)(runPath, {
    temporaryRoot: dependencies.temporaryRoot,
  });
  let finalizationClaim;
  try {
    finalizationClaim = await claimDiffRunFinalization(run);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error("This Hope diff run is already being finalized");
    }
    throw error;
  }
  try {
    const analysisReady = run.manifest.phase === "inspected"
      || (
        run.manifest.phase === "analysis-invalid"
        && run.manifest.analysisAttempts === 1
      );
    if (
      !analysisReady
      || run.manifest.deliveredPages.length !== run.manifest.pageCount
    ) {
      throw new Error("Read every Hope inspection page before submitting analysis");
    }

    let validated;
    try {
      const analysis = await readAnalysis(run.analysisPath);
      validated = (dependencies.validate ?? validateAnalysis)(
        analysis,
        run.snapshot,
        { runId: run.manifest.runId },
      );
    } catch (error) {
      const result = await (dependencies.recordFailure ?? recordAnalysisFailure)(run, {
        temporaryRoot: dependencies.temporaryRoot,
      });
      error.code = "HOPE_ANALYSIS_INVALID";
      error.canRetry = result.canRetry;
      throw error;
    }

    try {
      const rendered = await (dependencies.render ?? renderReview)(validated);
      const revalidation = await (
        dependencies.revalidate ?? revalidateGitHubSnapshot
      )(run.snapshot, {
        clock: dependencies.clock,
        gh: dependencies.gh,
      });
      if (!revalidation.matches) {
        const error = new Error(
          "The pull request changed while Hope was reviewing it. No review was created.",
        );
        error.code = "HOPE_DIFF_STALE";
        throw error;
      }
      await finalizationClaim.renew();
      await (dependencies.removeRun ?? removeDiffRun)(run.path, {
        temporaryRoot: dependencies.temporaryRoot,
      });
      const ticket = await (dependencies.finalize ?? finalizeReview)(rendered.bytes, {
        artifactDigest: rendered.digest,
        outputPath: run.manifest.outputPath,
        revalidatedAt: revalidation.revalidatedAt,
        runId: run.manifest.runId,
        snapshotDigest: run.snapshot.digest,
        temporaryRoot: dependencies.temporaryRoot,
      });
      return Object.freeze({
        ...ticket,
        pullRequest: run.snapshot.pullRequest,
        result: validated.result,
      });
    } catch (error) {
      await (dependencies.removeRun ?? removeDiffRun)(run.path, {
        temporaryRoot: dependencies.temporaryRoot,
      }).catch(() => {});
      throw error;
    }
  } finally {
    await finalizationClaim.release();
  }
}

export async function cancelDiff(runPath, dependencies = {}) {
  await (dependencies.removeRun ?? removeDiffRun)(runPath, {
    temporaryRoot: dependencies.temporaryRoot,
  });
}

export function runDiff() {
  const error = new Error(DIFF_MODEL_ADAPTER_MESSAGE);
  error.code = DIFF_MODEL_ADAPTER_CODE;
  throw error;
}
