#!/usr/bin/env node

import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  collectChangeRequest,
  writeChangeRequestFile,
} from "../../skills/diff/scripts/collect-change-request.mjs";
import { main as inspectChangeRequest } from "../../skills/diff/scripts/inspect-change-request.mjs";
import {
  cleanupTransientContext,
  main as renderReview,
} from "../../skills/diff/scripts/render-review.mjs";
import {
  newDiffRun,
  readDiffRun,
  updateDiffRun,
  writeNewDiffRun,
} from "./diff-run.mjs";
import { resolveLatestPullRequest } from "./latest-pull-request.mjs";

function usage() {
  return [
    "Run the Hope diff workflow with one private run record.",
    "",
    "Usage:",
    "  node hope-diff.mjs start (--latest | --url <github-pr-url>) [--locale en|ko]",
    "  node hope-diff.mjs inspect --run <diff-run.json> (--summary | --pass <id>) [--after <receipt>]",
    "  node hope-diff.mjs validate --run <diff-run.json> --input <review-model.json>",
    "  node hope-diff.mjs render --run <diff-run.json> --input <review-model.json> [--output <new-file.html>]",
    "  node hope-diff.mjs status --run <diff-run.json>",
    "  node hope-diff.mjs abandon --run <diff-run.json>",
  ].join("\n");
}

export function parseArguments(argv) {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  const [command, ...rest] = argv;
  if (!["start", "inspect", "validate", "render", "status", "abandon"].includes(command)) {
    throw new TypeError("Choose start, inspect, validate, render, status, or abandon.");
  }
  const options = { command, summary: false };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--summary") {
      if (options.summary) throw new TypeError("--summary may be provided only once.");
      options.summary = true;
      continue;
    }
    if (argument === "--latest") {
      if (options.latest) throw new TypeError("--latest may be provided only once.");
      options.latest = true;
      continue;
    }
    if (!["--url", "--locale", "--run", "--pass", "--after", "--input", "--output"].includes(argument)) {
      throw new TypeError(`Unknown argument: ${argument}`);
    }
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) throw new TypeError(`${argument} requires a value.`);
    const key = argument.slice(2);
    if (options[key] !== undefined) throw new TypeError(`${argument} may be provided only once.`);
    options[key] = value;
    index += 1;
  }
  const allowedOptions = {
    abandon: new Set(["run"]),
    inspect: new Set(["after", "pass", "run", "summary"]),
    render: new Set(["input", "output", "run"]),
    start: new Set(["latest", "locale", "url"]),
    status: new Set(["run"]),
    validate: new Set(["input", "run"]),
  };
  for (const [name, value] of Object.entries(options)) {
    if (
      name !== "command" &&
      value !== undefined &&
      value !== false &&
      !allowedOptions[command].has(name)
    ) {
      throw new TypeError(`--${name} is not allowed with ${command}.`);
    }
  }
  if (command === "start") {
    if ((options.url !== undefined) === (options.latest === true)) {
      throw new TypeError("start requires exactly one of --latest or --url.");
    }
    if (options.locale !== undefined && !["en", "ko"].includes(options.locale)) {
      throw new TypeError("--locale must be en or ko.");
    }
  } else {
    if (!options.run) throw new TypeError(`${command} requires --run.`);
  }
  if (command === "inspect" && options.summary === (options.pass !== undefined)) {
    throw new TypeError("inspect requires exactly one of --summary or --pass.");
  }
  if (["validate", "render"].includes(command) && !options.input) {
    throw new TypeError(`${command} requires --input.`);
  }
  return options;
}

async function start(options, dependencies) {
  const collect = dependencies.collectChangeRequest ?? collectChangeRequest;
  const writeContext = dependencies.writeChangeRequestFile ?? writeChangeRequestFile;
  const temporaryRoot = resolve(dependencies.temporaryRoot ?? tmpdir());
  const url = options.latest
    ? await (dependencies.resolveLatestPullRequest ?? resolveLatestPullRequest)({
        cwd: dependencies.cwd ?? process.cwd(),
      })
    : options.url;
  const directory = await mkdtemp(join(temporaryRoot, "hope-context-"));
  await chmod(directory, 0o700);
  try {
    const changeRequest = await collect({ url });
    const contextPath = join(directory, "change-request.json");
    await writeContext(changeRequest, contextPath);
    const runPath = join(directory, "diff-run.json");
    const run = newDiffRun(changeRequest, { locale: options.locale ?? "en" });
    await writeNewDiffRun(runPath, run, { temporaryRoot });
    const result = { contextPath, run, runPath };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

function contextPathFor(runPath, run) {
  return join(dirname(resolve(runPath)), run.contextFile);
}

function assertReviewInsideRun(runPath, inputPath, run) {
  const resolved = resolve(inputPath);
  const expected = join(dirname(resolve(runPath)), run.reviewFile);
  if (resolved !== expected) {
    throw new Error(`Review input must be the run-owned file: ${expected}`);
  }
  return resolved;
}

async function updateWithoutHidingSuccess(runPath, change, dependencies) {
  try {
    return await updateDiffRun(runPath, change, {
      temporaryRoot: dependencies.temporaryRoot,
    });
  } catch (error) {
    process.stderr.write(`Hope finished the action but could not update its run record: ${error.message}\n`);
    return undefined;
  }
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return undefined;
  }
  if (options.command === "start") return await start(options, dependencies);

  const run = await readDiffRun(options.run, {
    temporaryRoot: dependencies.temporaryRoot,
  });
  const contextPath = contextPathFor(options.run, run);
  if (options.command === "status") {
    process.stdout.write(`${JSON.stringify(run)}\n`);
    return run;
  }
  if (options.command === "inspect") {
    const result = await (dependencies.inspectChangeRequest ?? inspectChangeRequest)([
      "--context",
      contextPath,
      ...(options.summary ? ["--summary"] : ["--pass", options.pass]),
      ...(options.after ? ["--after", options.after] : []),
    ]);
    await updateWithoutHidingSuccess(options.run, {
      status: "inspecting",
      lastInspection: {
        kind: options.summary ? "summary" : "pass",
        passId: options.pass ?? null,
        receipt: result.receipt,
      },
      lastError: null,
    }, dependencies);
    return result;
  }
  if (options.command === "abandon") {
    const next = await updateDiffRun(options.run, {
      status: "cancelled",
      lastError: null,
    }, { temporaryRoot: dependencies.temporaryRoot });
    await (dependencies.cleanupTransientContext ?? cleanupTransientContext)(contextPath);
    process.stdout.write(`${JSON.stringify(next)}\n`);
    return next;
  }

  const input = assertReviewInsideRun(options.run, options.input, run);
  const render = dependencies.renderReview ?? renderReview;
  if (options.command === "validate") {
    const result = await render([
      "--input", input,
      "--context", contextPath,
      "--validate-only",
    ]);
    await updateWithoutHidingSuccess(options.run, {
      status: "validated",
      lastError: null,
    }, dependencies);
    return result;
  }
  if (run.status !== "validated") {
    throw new Error("Validate the review before rendering it.");
  }
  try {
    const result = await render([
      "--input", input,
      "--context", contextPath,
      ...(options.output ? ["--output", options.output] : []),
      "--cleanup",
    ]);
    await updateWithoutHidingSuccess(options.run, {
      status: "completed",
      result,
      lastError: null,
    }, dependencies);
    return result;
  } catch (error) {
    await updateWithoutHidingSuccess(options.run, {
      lastError: { message: error.message },
    }, dependencies);
    throw error;
  }
}

const isEntrypoint = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isEntrypoint) {
  main().catch((error) => {
    process.stderr.write(`hope-diff: ${error.message}\n`);
    process.exitCode = 1;
  });
}
