import { createHash, randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  ContextBindingError,
  validateArtifact,
  validateArtifactAgainstContext,
  validateArtifactAgainstIntent,
} from "./validate-artifact.mjs";

const BROWSER_STYLE = String.raw`:root {
  color-scheme: light;
  --ink: #18201d;
  --muted: #5f6b66;
  --paper: #f7f5ef;
  --panel: #fffdf7;
  --line: #d9d8cf;
  --accent: #166a52;
  --accent-soft: #dff1e9;
  --warning: #744d0f;
  --warning-soft: #fff1ce;
  --danger: #9c342f;
  --success: #17633f;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-synthesis: none;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  color: var(--ink);
  background: var(--paper);
  line-height: 1.65;
}

header, main, footer {
  width: min(1080px, calc(100% - 32px));
  margin-inline: auto;
}

header { padding: 64px 0 24px; }
header p { max-width: 760px; color: var(--muted); }

main { display: grid; gap: 24px; padding-bottom: 56px; }

section {
  border: 1px solid var(--line);
  border-radius: 18px;
  padding: clamp(20px, 4vw, 36px);
  background: var(--panel);
  box-shadow: 0 12px 36px rgba(28, 37, 33, 0.06);
}

h1, h2, h3, h4 { line-height: 1.25; }
h1 { margin: 0; font-size: clamp(2rem, 5vw, 3.8rem); letter-spacing: -0.04em; }
h2 { margin-top: 0; font-size: clamp(1.45rem, 3vw, 2rem); }
h3 { margin-top: 28px; }
p, ul, ol { max-width: 78ch; }

.eyebrow {
  margin: 0 0 10px;
  color: var(--accent);
  font-size: 0.82rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.lede { font-size: 1.12rem; }
.muted { color: var(--muted); }

.notice {
  border-left: 4px solid var(--warning);
  border-radius: 8px;
  padding: 14px 16px;
  color: var(--warning);
  background: var(--warning-soft);
}

.grid { display: grid; gap: 16px; }
.grid.two { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }

.card {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 16px;
  background: #fff;
}

.card > :first-child { margin-top: 0; }
.card > :last-child { margin-bottom: 0; }

.flow { padding-left: 1.4rem; }
.flow li { margin-block: 10px; }

.tag {
  display: inline-block;
  margin-right: 8px;
  border-radius: 999px;
  padding: 2px 9px;
  color: var(--accent);
  background: var(--accent-soft);
  font-size: 0.8rem;
  font-weight: 700;
}

fieldset {
  margin: 0 0 20px;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 16px;
}

legend { padding: 0 8px; font-weight: 750; }
.choice { display: flex; gap: 10px; align-items: flex-start; margin-block: 9px; }
.choice input { margin-top: 0.38rem; }

button, select {
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 10px 13px;
  color: var(--ink);
  background: #fff;
  font: inherit;
}

button {
  border-color: var(--accent);
  color: white;
  background: var(--accent);
  font-weight: 750;
  cursor: pointer;
}

button:hover { filter: brightness(0.93); }
button:focus-visible, select:focus-visible, input:focus-visible {
  outline: 3px solid rgba(22, 106, 82, 0.3);
  outline-offset: 2px;
}

.result { min-height: 1.6em; margin-top: 14px; font-weight: 750; }
.correct { color: var(--success); }
.incorrect { color: var(--danger); }
.answer { margin: 10px 0 0; padding: 10px 12px; border-radius: 8px; background: #f0efe9; }

.controls { display: flex; flex-wrap: wrap; gap: 14px; margin-block: 20px; }
.control { display: grid; gap: 5px; min-width: 190px; }
.control label { font-weight: 700; }

.trace { position: relative; }
.trace ol { padding-left: 1.4rem; }
.trace li { margin-block: 10px; }
.outcome { border-top: 1px solid var(--line); padding-top: 12px; font-weight: 700; }
.lesson { border-left: 4px solid var(--accent); padding: 12px 16px; background: var(--accent-soft); }

code {
  border-radius: 4px;
  padding: 2px 5px;
  background: #eeece4;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  overflow-wrap: anywhere;
}

footer { padding: 0 0 40px; color: var(--muted); font-size: 0.9rem; }

@media (max-width: 600px) {
  header { padding-top: 36px; }
  section { border-radius: 12px; }
}`;

const BROWSER_SCRIPT = String.raw`"use strict";

const artifactNode = document.getElementById("artifact-data");
const artifact = JSON.parse(artifactNode.textContent);

function element(tagName, text, className) {
  const node = document.createElement(tagName);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function appendList(parent, items, ordered) {
  const list = element(ordered ? "ol" : "ul");
  for (const item of items) list.append(element("li", item));
  parent.append(list);
  return list;
}

function addHeading(parent, level, text) {
  const heading = element("h" + String(level), text);
  parent.append(heading);
  return heading;
}

function appendEvidence(parent, paths) {
  if (paths.length === 0) return;
  const evidence = element("p", "Evidence: ", "muted");
  paths.forEach(function (path, index) {
    if (index > 0) evidence.append(document.createTextNode(", "));
    evidence.append(element("code", path));
  });
  parent.append(evidence);
}

function appendIntentLinks(parent, intentItemIds) {
  if (intentItemIds.length === 0) return;
  const links = element("p", "Linked approved intent: ", "muted");
  intentItemIds.forEach(function (intentItemId, index) {
    if (index > 0) links.append(document.createTextNode(", "));
    links.append(element("code", intentItemId));
  });
  parent.append(links);
}

function intentItemLabel(item) {
  if (item.statement) return item.statement;
  if (item.decision) return item.decision;
  return "Given " + item.given + " · When " + item.when + " · Then " + item.then;
}

function renderIntentAlignment() {
  const status = document.getElementById("intent-status");
  if (artifact.intent === null) {
    status.textContent =
      "No approved intent is linked. This understanding bundle was generated from the code change alone.";
    status.className = "muted";
    return;
  }

  const snapshot = artifact.intent.snapshot;
  status.append(element("strong", "Approved intent: "));
  status.append(document.createTextNode(snapshot.goal));
  const fingerprint = document.getElementById("intent-fingerprint");
  fingerprint.hidden = false;
  fingerprint.append(document.createTextNode("Intent fingerprint: "));
  fingerprint.append(element("code", artifact.intent.fingerprint));

  const items = []
    .concat(snapshot.outcomes, snapshot.constraints, snapshot.decisions, snapshot.nonGoals, snapshot.scenarios);
  const itemsById = new Map(items.map(function (item) { return [item.id, item]; }));
  const alignmentSummary = document.getElementById("alignment-summary");
  alignmentSummary.textContent = artifact.alignment.summary;

  const checks = document.getElementById("alignment-checks");
  for (const check of artifact.alignment.checks) {
    const item = element("li");
    item.append(element("span", check.status, "tag"));
    const intentItem = itemsById.get(check.intentItemId);
    item.append(element("strong", check.intentItemId + ": "));
    item.append(document.createTextNode(intentItemLabel(intentItem) + " — " + check.assessment));
    appendEvidence(item, check.evidencePaths);
    checks.append(item);
  }

  const deviationBlock = document.getElementById("deviation-block");
  if (artifact.alignment.deviations.length > 0) {
    deviationBlock.hidden = false;
    const deviations = document.getElementById("deviation-list");
    for (const deviation of artifact.alignment.deviations) {
      const item = element("li");
      item.append(element("span", "Needs user review", "tag"));
      item.append(document.createTextNode(deviation.summary));
      appendEvidence(item, deviation.evidencePaths);
      deviations.append(item);
    }
  }
}

function renderKnowledge() {
  const candidates = artifact.knowledge.promotionCandidates;
  const empty = document.getElementById("knowledge-empty");
  if (candidates.length === 0) {
    empty.hidden = false;
    return;
  }
  const list = document.getElementById("knowledge-list");
  for (const candidate of candidates) {
    const item = element("li");
    item.append(element("span", candidate.target, "tag"));
    item.append(element("strong", candidate.insight + ": "));
    item.append(document.createTextNode(candidate.rationale));
    appendEvidence(item, candidate.evidencePaths);
    list.append(item);
  }
}

function renderExplanation() {
  document.getElementById("artifact-title").textContent = artifact.title;
  document.getElementById("artifact-summary").textContent = artifact.change.summary;
  document.getElementById("comparison").textContent = artifact.change.comparison;
  document.getElementById("base-commit").textContent = artifact.change.context.baseCommit;
  document.getElementById("goal").textContent = artifact.explanation.goal;

  const context = document.getElementById("context-status");
  if (!artifact.change.context.complete) {
    context.className = "notice";
    context.setAttribute("role", "note");
    context.append(element("strong", "Context is incomplete. "));
    context.append(
      document.createTextNode(
        artifact.change.context.warnings.length > 0
          ? artifact.change.context.warnings.join(" · ")
          : "Review the collected scope.",
      ),
    );
  } else if (artifact.change.context.warnings.length > 0) {
    context.className = "notice";
    context.setAttribute("role", "note");
    context.textContent = artifact.change.context.warnings.join(" · ");
  } else {
    context.textContent = "The collector marked this change scope as complete.";
    context.className = "muted";
  }

  const exclusionBlock = document.getElementById("context-exclusion-block");
  const exclusions = document.getElementById("context-exclusions");
  if (artifact.change.context.excluded.length > 0) {
    exclusionBlock.hidden = false;
    for (const exclusion of artifact.change.context.excluded) {
      const item = element("li");
      item.append(element("code", exclusion.path));
      item.append(document.createTextNode(" — " + exclusion.reason));
      exclusions.append(item);
    }
  }

  appendList(
    document.getElementById("observable-list"),
    artifact.explanation.observableChanges,
    false,
  );

  const fileList = document.getElementById("file-list");
  for (const file of artifact.change.files) {
    const item = element("li");
    item.append(element("code", file.path));
    item.append(document.createTextNode(" — " + file.responsibility));
    fileList.append(item);
  }

  const beforeAfter = document.getElementById("before-after");
  for (const entry of artifact.explanation.beforeAfter) {
    const card = element("article", undefined, "card");
    addHeading(card, 4, entry.area);
    card.append(element("p", "Before: " + entry.before));
    card.append(element("p", "After: " + entry.after));
    card.append(element("p", "Why: " + entry.why, "muted"));
    beforeAfter.append(card);
  }

  const flow = document.getElementById("flow-list");
  for (const entry of artifact.explanation.flow) {
    const item = element("li");
    item.append(element("span", String(entry.step), "tag"));
    item.append(element("strong", entry.component + ": "));
    item.append(document.createTextNode(entry.behavior));
    flow.append(item);
  }

  appendList(document.getElementById("invariant-list"), artifact.explanation.invariants, false);
  appendList(document.getElementById("non-goal-list"), artifact.explanation.nonGoals, false);
  appendList(document.getElementById("risk-list"), artifact.explanation.risks, false);

  const decisions = document.getElementById("decision-list");
  for (const entry of artifact.explanation.decisions) {
    const item = element("li");
    item.append(
      element("span", entry.source === "approved-intent" ? "Approved intent" : "Inferred", "tag"),
    );
    item.append(element("strong", entry.decision + ": "));
    item.append(document.createTextNode(entry.rationale + " (Trade-off: " + entry.tradeoff + ")"));
    decisions.append(item);
  }

  const verification = document.getElementById("verification-list");
  for (const entry of artifact.explanation.verification) {
    const item = element("li");
    item.append(element("span", entry.status, "tag"));
    item.append(element("code", entry.command));
    item.append(document.createTextNode(" — " + entry.result));
    verification.append(item);
  }
}

function renderQuiz() {
  const form = document.getElementById("quiz-form");
  const answerViews = [];

  artifact.quiz.questions.forEach(function (question, questionIndex) {
    const fieldset = element("fieldset");
    fieldset.append(element("legend", String(questionIndex + 1) + ". " + question.prompt));
    appendIntentLinks(fieldset, question.intentItemIds);
    const inputs = [];

    for (const option of question.options) {
      const label = element("label", undefined, "choice");
      const input = element("input");
      input.type = question.type === "single" ? "radio" : "checkbox";
      input.name = "question-" + question.id;
      input.value = option.id;
      input.id = "question-" + question.id + "-" + option.id;
      label.setAttribute("for", input.id);
      label.append(input, element("span", option.text));
      fieldset.append(label);
      inputs.push(input);
    }

    const feedback = element("p", undefined, "answer");
    feedback.hidden = true;
    fieldset.append(feedback);
    form.append(fieldset);
    answerViews.push({ question: question, inputs: inputs, feedback: feedback });
  });

  const button = element("button", "Check answers and show explanations");
  button.type = "submit";
  form.append(button);

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    let correctCount = 0;

    for (const view of answerViews) {
      const selected = new Set(
        view.inputs.filter(function (input) { return input.checked; }).map(function (input) { return input.value; }),
      );
      const expected = new Set(view.question.correctOptionIds);
      const correct =
        selected.size === expected.size &&
        Array.from(expected).every(function (optionId) { return selected.has(optionId); });
      if (correct) correctCount += 1;
      view.feedback.hidden = false;
      view.feedback.className = "answer " + (correct ? "correct" : "incorrect");
      view.feedback.textContent =
        (correct ? "Correct. " : "Review this answer. ") + view.question.explanation;
    }

    const percent = Math.round((correctCount / answerViews.length) * 100);
    const passed = percent >= artifact.quiz.passPercent;
    const result = document.getElementById("quiz-result");
    result.className = "result " + (passed ? "correct" : "incorrect");
    result.textContent =
      String(correctCount) + "/" + String(answerViews.length) + " correct · " +
      String(percent) + "% · " + (passed ? "Pass" : "Below threshold") +
      " (pass threshold " + String(artifact.quiz.passPercent) + "%)";
    result.focus();
  });
}

function renderTrace(parent, label, trace) {
  const panel = element("article", undefined, "card trace");
  addHeading(panel, 4, label);
  const steps = element("ol");
  for (const step of trace.steps) {
    const item = element("li");
    item.append(element("strong", step.component + ": "));
    item.append(document.createTextNode(step.behavior));
    steps.append(item);
  }
  panel.append(steps, element("p", "Outcome: " + trace.outcome, "outcome"));
  parent.append(panel);
}

function renderMicroworld() {
  document.getElementById("microworld-title").textContent = artifact.microworld.title;
  document.getElementById("microworld-instructions").textContent = artifact.microworld.instructions;
  appendIntentLinks(
    document.getElementById("microworld-intent-links"),
    artifact.microworld.intentItemIds,
  );
  const controls = document.getElementById("microworld-controls");
  const selections = new Map();

  function updateScenario() {
    const scenario = artifact.microworld.scenarios.find(function (candidate) {
      return artifact.microworld.controls.every(function (control) {
        const binding = candidate.when.find(function (entry) { return entry.controlId === control.id; });
        return binding && binding.optionId === selections.get(control.id);
      });
    });

    const view = document.getElementById("scenario-view");
    view.textContent = "";
    if (!scenario) {
      view.append(element("p", "No scenario matches this combination.", "notice"));
      return;
    }

    addHeading(view, 3, scenario.title);
    const comparison = element("div", undefined, "grid two");
    renderTrace(comparison, "Before change", scenario.before);
    renderTrace(comparison, "After change", scenario.after);
    view.append(comparison, element("p", scenario.lesson, "lesson"));
  }

  for (const control of artifact.microworld.controls) {
    const wrapper = element("div", undefined, "control");
    const label = element("label", control.label);
    const select = element("select");
    select.id = "control-" + control.id;
    label.setAttribute("for", select.id);
    for (const option of control.options) {
      const optionNode = element("option", option.text);
      optionNode.value = option.id;
      if (option.id === control.defaultOptionId) optionNode.selected = true;
      select.append(optionNode);
    }
    selections.set(control.id, control.defaultOptionId);
    select.addEventListener("change", function () {
      selections.set(control.id, select.value);
      updateScenario();
    });
    wrapper.append(label, select);
    controls.append(wrapper);
  }

  updateScenario();
}

renderIntentAlignment();
renderExplanation();
renderKnowledge();
renderQuiz();
renderMicroworld();`;

function normalizeMarkdownText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function markdownText(value) {
  return normalizeMarkdownText(value).replace(/([\\`*_{}[\]()#+.!|<>-])/g, "\\$1");
}

function bullet(value) {
  return `- ${markdownText(value)}`;
}

function bullets(values) {
  return values.map(bullet).join("\n");
}

function markdownBeforeAfter(entries) {
  return entries
    .map(
      (entry) =>
        `### ${markdownText(entry.area)}\n\n` +
        `${bullet(`Before: ${entry.before}`)}\n` +
        `${bullet(`After: ${entry.after}`)}\n` +
        `${bullet(`Why: ${entry.why}`)}`,
    )
    .join("\n\n");
}

function markdownEvidence(paths) {
  return paths.length === 0 ? "No evidence" : `Evidence: ${paths.map(markdownText).join(", ")}`;
}

export function renderExplanationMarkdown(artifact) {
  validateArtifact(artifact);

  const contextStatus = artifact.change.context.complete ? "Complete" : "Incomplete";
  const warnings =
    artifact.change.context.warnings.length > 0
      ? bullets(artifact.change.context.warnings)
      : "- None";
  const exclusionsSection =
    artifact.change.context.excluded.length > 0
      ? `### Excluded context\n\n${artifact.change.context.excluded
          .map((entry) => bullet(`${entry.path} — ${entry.reason}`))
          .join("\n")}\n`
      : "";
  const files = artifact.change.files
    .map((file) => bullet(`${file.path} — ${file.responsibility}`))
    .join("\n");
  const flow = artifact.explanation.flow
    .map((entry) => bullet(`${entry.step}. ${entry.component}: ${entry.behavior}`))
    .join("\n");
  const decisions = artifact.explanation.decisions
    .map((entry) =>
      bullet(
        `[${entry.source}] ${entry.decision} — ${entry.rationale} (Trade-off: ${entry.tradeoff})`,
      ),
    )
    .join("\n");
  const verification = artifact.explanation.verification
    .map((entry) => bullet(`[${entry.status}] ${entry.command} — ${entry.result}`))
    .join("\n");
  const alignmentSection =
    artifact.intent === null
      ? `## Intent alignment\n\nNo approved intent is linked. This understanding bundle was generated from the code change alone.\n`
      : `## Intent alignment\n\n` +
        `${markdownText(artifact.intent.snapshot.goal)}\n\n` +
        `- Intent fingerprint: ${markdownText(artifact.intent.fingerprint)}\n\n` +
        `### Alignment summary\n\n${markdownText(artifact.alignment.summary)}\n\n` +
        `### Intent item checks\n\n${artifact.alignment.checks
          .map((check) =>
            bullet(
              `[${check.status}] ${check.intentItemId} — ${check.assessment} (${markdownEvidence(check.evidencePaths)})`,
            ),
          )
          .join("\n")}\n\n` +
        `### Intent deviations\n\n${
          artifact.alignment.deviations.length === 0
            ? "- None"
            : artifact.alignment.deviations
                .map((deviation) =>
                  bullet(
                    `[needs-user-review] ${deviation.summary} (${markdownEvidence(deviation.evidencePaths)})`,
                  ),
                )
                .join("\n")
        }\n`;
  const knowledgeCandidates =
    artifact.knowledge.promotionCandidates.length === 0
      ? "- None"
      : artifact.knowledge.promotionCandidates
          .map((candidate) =>
            bullet(
              `[${candidate.target}] ${candidate.insight} — ${candidate.rationale} (${markdownEvidence(candidate.evidencePaths)})`,
            ),
          )
          .join("\n");
  const quizIntentLinks = artifact.quiz.questions
    .filter((question) => question.intentItemIds.length > 0)
    .map((question) =>
      bullet(`Quiz ${question.id}: ${question.intentItemIds.join(", ")}`),
    )
    .join("\n");
  const microworldIntentLinks =
    artifact.microworld.intentItemIds.length > 0
      ? artifact.microworld.intentItemIds.map(markdownText).join(", ")
      : "None (standalone change understanding)";

  return `# ${markdownText(artifact.title)}

${alignmentSection}

## Change summary

${markdownText(artifact.change.summary)}

- Comparison: ${markdownText(artifact.change.comparison)}
- Base commit: ${markdownText(artifact.change.context.baseCommit)}
- Context: ${contextStatus}
- Fingerprint: ${markdownText(artifact.change.context.fingerprint)}

### Context warnings

${warnings}

${exclusionsSection}
## Goal

${markdownText(artifact.explanation.goal)}

## Observable changes

${bullets(artifact.explanation.observableChanges)}

## Files and responsibilities

${files}

## Before and after

${markdownBeforeAfter(artifact.explanation.beforeAfter)}

## Behavior flow

${flow}

## Invariants

${bullets(artifact.explanation.invariants)}

## Decisions and trade-offs

${decisions}

## Non-goals

${bullets(artifact.explanation.nonGoals)}

## Risks

${bullets(artifact.explanation.risks)}

## Verification

${verification}

## Teaching intent links

${quizIntentLinks || "- None (standalone change understanding)"}

- Microworld: ${microworldIntentLinks}

## Knowledge promotion candidates

${knowledgeCandidates}

Promotion candidates are proposals only; Hope does not modify the repository automatically.
`;
}

export function serializeArtifactForHtml(artifact) {
  return JSON.stringify(artifact)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function sha256Base64(value) {
  return createHash("sha256").update(value, "utf8").digest("base64");
}

export function renderIndexHtml(artifact) {
  validateArtifact(artifact);
  const artifactJson = serializeArtifactForHtml(artifact);
  const styleHash = sha256Base64(BROWSER_STYLE);
  const scriptHash = sha256Base64(BROWSER_SCRIPT);
  const dataHash = sha256Base64(artifactJson);
  const contentSecurityPolicy = [
    "default-src 'none'",
    `style-src 'sha256-${styleHash}'`,
    `script-src 'sha256-${scriptHash}' 'sha256-${dataHash}'`,
    "img-src 'none'",
    "font-src 'none'",
    "connect-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}">
  <title>Hope Change Understanding Bundle</title>
  <style>${BROWSER_STYLE}</style>
</head>
<body>
  <header>
    <p class="eyebrow">Hope · diff</p>
    <h1 id="artifact-title">Change Understanding Bundle</h1>
    <p id="artifact-summary" class="lede"></p>
  </header>
  <main>
    <section aria-labelledby="intent-alignment-heading">
      <p class="eyebrow">Intent alignment</p>
      <h2 id="intent-alignment-heading">Approved intent and actual change</h2>
      <p id="intent-status"></p>
      <p id="intent-fingerprint" class="muted" hidden></p>
      <p id="alignment-summary"></p>
      <ol id="alignment-checks" class="flow"></ol>
      <div id="deviation-block" hidden>
        <h3>Deviations requiring user judgment</h3>
        <ul id="deviation-list"></ul>
      </div>
    </section>

    <section aria-labelledby="explanation-heading">
      <h2 id="explanation-heading">Explanation</h2>
      <p id="comparison" class="muted"></p>
      <p class="muted">Base commit: <code id="base-commit"></code></p>
      <div id="context-status"></div>
      <div id="context-exclusion-block" hidden>
        <h3>Excluded context</h3>
        <ul id="context-exclusions"></ul>
      </div>
      <h3>Goal</h3>
      <p id="goal"></p>
      <h3>Observable changes</h3>
      <div id="observable-list"></div>
      <h3>Files and responsibilities</h3>
      <ul id="file-list"></ul>
      <h3>Before and after</h3>
      <div id="before-after" class="grid two"></div>
      <h3>Behavior flow</h3>
      <ol id="flow-list" class="flow"></ol>
      <div class="grid two">
        <div><h3>Invariants</h3><div id="invariant-list"></div></div>
        <div><h3>Non-goals</h3><div id="non-goal-list"></div></div>
      </div>
      <h3>Decisions and trade-offs</h3>
      <ul id="decision-list"></ul>
      <h3>Risks</h3>
      <div id="risk-list"></div>
      <h3>Verification</h3>
      <ul id="verification-list"></ul>
    </section>

    <section aria-labelledby="knowledge-heading">
      <p class="eyebrow">Cognitive debt</p>
      <h2 id="knowledge-heading">Knowledge promotion candidates</h2>
      <p class="muted">Candidates for preserving knowledge that is hard to reconstruct from code and Git in an existing source of truth. Hope does not modify the repository automatically.</p>
      <p id="knowledge-empty" class="muted" hidden>No promotion candidates were identified for this change.</p>
      <ul id="knowledge-list"></ul>
    </section>

    <section aria-labelledby="quiz-heading">
      <p class="eyebrow">Focused self-check</p>
      <h2 id="quiz-heading">Understanding quiz</h2>
      <p class="muted">The score helps locate specific understanding gaps; it does not prove complete understanding.</p>
      <form id="quiz-form"></form>
      <p id="quiz-result" class="result" role="status" aria-live="polite" tabindex="-1"></p>
    </section>

    <section aria-labelledby="microworld-heading">
      <p class="eyebrow">Interactive microworld</p>
      <h2 id="microworld-heading">Microworld</h2>
      <h3 id="microworld-title"></h3>
      <p id="microworld-instructions"></p>
      <div id="microworld-intent-links"></div>
      <div id="microworld-controls" class="controls"></div>
      <div id="scenario-view" role="region" aria-live="polite" aria-label="Selected scenario"></div>
    </section>
  </main>
  <footer>This file created by Hope works offline and makes no network requests.</footer>
  <noscript>JavaScript is required to use the quiz and microworld.</noscript>
  <script id="artifact-data" type="application/json">${artifactJson}</script>
  <script>${BROWSER_SCRIPT}</script>
</body>
</html>
`;
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function createOutputDirectory(outputDir) {
  if (outputDir === undefined) {
    const directory = await mkdtemp(join(tmpdir(), "hope-"));
    await chmod(directory, 0o700);
    return directory;
  }

  if (typeof outputDir !== "string" || outputDir.trim().length === 0) {
    throw new TypeError("outputDir must be a non-empty path");
  }
  const directory = resolve(outputDir);
  if (await pathExists(directory)) {
    throw new Error(`Refusing to overwrite existing output path: ${directory}`);
  }
  await mkdir(directory, { mode: 0o700 });
  await chmod(directory, 0o700);
  return directory;
}

async function writeBundleAtomically(directory, outputs) {
  const suffix = randomBytes(8).toString("hex");
  const staged = [];
  try {
    for (const [filename, contents] of outputs) {
      const temporaryPath = join(directory, `.${filename}.${suffix}.tmp`);
      await writeFile(temporaryPath, contents, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await chmod(temporaryPath, 0o600);
      staged.push([temporaryPath, join(directory, filename)]);
    }
    for (const [temporaryPath, finalPath] of staged) {
      await rename(temporaryPath, finalPath);
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function renderUnderstandingBundle(artifact, options = {}) {
  if (options.context === undefined) {
    throw new ContextBindingError(["ChangeContextV2 is required before rendering a bundle"]);
  }
  validateArtifactAgainstContext(artifact, options.context);
  validateArtifactAgainstIntent(artifact, options.intent);

  const artifactJson = `${JSON.stringify(artifact, null, 2)}\n`;
  const explanationMarkdown = renderExplanationMarkdown(artifact);
  const indexHtml = renderIndexHtml(artifact);
  const directory = await createOutputDirectory(options.outputDir);
  await writeBundleAtomically(directory, [
    ["artifact.json", artifactJson],
    ["explanation.md", explanationMarkdown],
    ["index.html", indexHtml],
  ]);

  return {
    directory,
    files: {
      artifact: join(directory, "artifact.json"),
      explanation: join(directory, "explanation.md"),
      index: join(directory, "index.html"),
    },
  };
}
