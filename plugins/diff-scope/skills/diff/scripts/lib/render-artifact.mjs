import { createHash, randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  ContextBindingError,
  validateArtifact,
  validateArtifactAgainstContext,
} from "./validate-artifact.mjs";

const HANGUL_PATTERN = /[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7af\ud7b0-\ud7ff]/gu;
const LATIN_WORD_PATTERN = /[A-Za-z]+/gu;

const UI_TEXT = {
  en: {
    lang: "en",
    documentTitle: "Change understanding bundle",
    fallbackTitle: "Change understanding bundle",
    explanationHeading: "Change explanation",
    excludedContextHeading: "Excluded context",
    goalHeading: "Goal",
    observableChangesHeading: "Observable changes",
    filesHeading: "Files and responsibilities",
    beforeAfterHeading: "Before and after",
    behaviorFlowHeading: "Behavior flow",
    invariantsHeading: "Invariants",
    nonGoalsHeading: "Non-goals",
    decisionsHeading: "Decisions and trade-offs",
    risksHeading: "Risks",
    verificationHeading: "Verification",
    quizEyebrow: "Focused self-check",
    quizHeading: "Understanding quiz",
    quizNote:
      "The score points to specific understanding gaps; it does not prove complete understanding.",
    microworldEyebrow: "Interactive exploration",
    microworldHeading: "Interactive microworld",
    selectedScenarioLabel: "Selected scenario",
    footer: "This file works offline and makes no network requests.",
    noscript: "JavaScript is required to use the quiz and microworld.",
    contextIncompleteLead: "Context is incomplete. ",
    reviewScope: "Review the collected scope.",
    contextComplete: "The collector marked this change scope complete.",
    beforeLabel: "Before",
    afterLabel: "After",
    whyLabel: "Why",
    tradeoffLabel: "Trade-off",
    quizSubmit: "Score and show explanations",
    correctLead: "Correct. ",
    incorrectLead: "Review this answer. ",
    correctCountSuffix: " correct",
    passed: "Pass",
    belowThreshold: "Below threshold",
    passThreshold: "pass threshold",
    outcomeLabel: "Outcome",
    missingScenario: "No scenario exists for this combination.",
    beforeTrace: "Before",
    afterTrace: "After",
    changeSummaryHeading: "Change summary",
    comparisonLabel: "Comparison",
    contextLabel: "Context",
    fingerprintLabel: "Fingerprint",
    contextWarningsHeading: "Context warnings",
    complete: "Complete",
    incomplete: "Incomplete",
    none: "None",
    verificationStatus: {
      passed: "passed",
      failed: "failed",
      "not-run": "not run",
    },
  },
  ko: {
    lang: "ko",
    documentTitle: "변경 이해 번들",
    fallbackTitle: "변경 이해 번들",
    explanationHeading: "설명 문서",
    excludedContextHeading: "제외된 컨텍스트",
    goalHeading: "목표",
    observableChangesHeading: "관찰 가능한 변화",
    filesHeading: "파일과 책임",
    beforeAfterHeading: "이전과 이후",
    behaviorFlowHeading: "동작 흐름",
    invariantsHeading: "불변 조건",
    nonGoalsHeading: "비목표",
    decisionsHeading: "결정과 절충",
    risksHeading: "위험",
    verificationHeading: "검증",
    quizEyebrow: "이해 확인",
    quizHeading: "이해도 퀴즈",
    quizNote: "정답률은 특정 이해 공백을 찾기 위한 신호이며, 전체 이해를 증명하지 않습니다.",
    microworldEyebrow: "인터랙티브 탐색",
    microworldHeading: "인터랙티브 마이크로월드",
    selectedScenarioLabel: "선택한 시나리오",
    footer: "이 파일은 오프라인으로 동작하며 네트워크 요청을 만들지 않습니다.",
    noscript: "퀴즈와 마이크로월드를 사용하려면 JavaScript가 필요합니다.",
    contextIncompleteLead: "컨텍스트가 완전하지 않습니다. ",
    reviewScope: "수집 범위를 확인하세요.",
    contextComplete: "수집기가 이 변경 범위를 완전한 것으로 표시했습니다.",
    beforeLabel: "이전",
    afterLabel: "이후",
    whyLabel: "이유",
    tradeoffLabel: "절충",
    quizSubmit: "채점하고 해설 보기",
    correctLead: "정답입니다. ",
    incorrectLead: "다시 확인하세요. ",
    correctCountSuffix: " 정답",
    passed: "기준 통과",
    belowThreshold: "기준 미달",
    passThreshold: "통과 기준",
    outcomeLabel: "결과",
    missingScenario: "해당 조합의 시나리오를 찾지 못했습니다.",
    beforeTrace: "변경 전",
    afterTrace: "변경 후",
    changeSummaryHeading: "변경 요약",
    comparisonLabel: "비교 범위",
    contextLabel: "컨텍스트",
    fingerprintLabel: "지문",
    contextWarningsHeading: "컨텍스트 경고",
    complete: "완전",
    incomplete: "불완전",
    none: "없음",
    verificationStatus: {
      passed: "통과",
      failed: "실패",
      "not-run": "미실행",
    },
  },
};

function localeProse(artifact) {
  const explanation = artifact.explanation;
  const quizText = artifact.quiz.questions.flatMap((question) => [
    question.prompt,
    question.explanation,
    ...question.options.map((option) => option.text),
  ]);
  const microworldText = [
    artifact.microworld.title,
    artifact.microworld.instructions,
    ...artifact.microworld.controls.flatMap((control) => [
      control.label,
      ...control.options.map((option) => option.text),
    ]),
    ...artifact.microworld.scenarios.flatMap((scenario) => [
      scenario.title,
      scenario.lesson,
      scenario.before.outcome,
      scenario.after.outcome,
      ...scenario.before.steps.flatMap((step) => [step.component, step.behavior]),
      ...scenario.after.steps.flatMap((step) => [step.component, step.behavior]),
    ]),
  ];

  return [
    artifact.title,
    artifact.change.summary,
    explanation.goal,
    ...explanation.observableChanges,
    ...explanation.beforeAfter.flatMap((entry) => [
      entry.area,
      entry.before,
      entry.after,
      entry.why,
    ]),
    ...explanation.flow.flatMap((entry) => [entry.component, entry.behavior]),
    ...explanation.invariants,
    ...explanation.decisions.flatMap((entry) => [
      entry.decision,
      entry.rationale,
      entry.tradeoff,
    ]),
    ...explanation.nonGoals,
    ...explanation.risks,
    ...quizText,
    ...microworldText,
  ].join("\n");
}

function textForArtifact(artifact) {
  const prose = localeProse(artifact);
  const hangulCharacters = prose.match(HANGUL_PATTERN)?.length ?? 0;
  const latinWords = prose.match(LATIN_WORD_PATTERN)?.length ?? 0;
  const language = hangulCharacters >= 4 && hangulCharacters >= latinWords ? "ko" : "en";
  return UI_TEXT[language];
}

const BROWSER_STYLE = String.raw`:root {
  color-scheme: light;
  --ink: #18201d;
  --muted: #5f6b66;
  --paper: #f7f5ef;
  --panel: #fffdf7;
  --line: #d9d8cf;
  --accent: #5b5bd6;
  --accent-soft: #eeeeff;
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
  outline: 3px solid rgba(91, 91, 214, 0.3);
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
const uiNode = document.getElementById("ui-data");
const artifact = JSON.parse(artifactNode.textContent);
const ui = JSON.parse(uiNode.textContent);

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

function renderExplanation() {
  document.getElementById("artifact-title").textContent = artifact.title;
  document.getElementById("artifact-summary").textContent = artifact.change.summary;
  document.getElementById("comparison").textContent = artifact.change.comparison;
  document.getElementById("goal").textContent = artifact.explanation.goal;

  const context = document.getElementById("context-status");
  if (!artifact.change.context.complete) {
    context.className = "notice";
    context.setAttribute("role", "note");
    context.append(element("strong", ui.contextIncompleteLead));
    context.append(
      document.createTextNode(
        artifact.change.context.warnings.length > 0
          ? artifact.change.context.warnings.join(" · ")
          : ui.reviewScope,
      ),
    );
  } else if (artifact.change.context.warnings.length > 0) {
    context.className = "notice";
    context.setAttribute("role", "note");
    context.textContent = artifact.change.context.warnings.join(" · ");
  } else {
    context.textContent = ui.contextComplete;
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
    card.append(element("p", ui.beforeLabel + ": " + entry.before));
    card.append(element("p", ui.afterLabel + ": " + entry.after));
    card.append(element("p", ui.whyLabel + ": " + entry.why, "muted"));
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
    item.append(element("strong", entry.decision + ": "));
    item.append(
      document.createTextNode(
        entry.rationale + " (" + ui.tradeoffLabel + ": " + entry.tradeoff + ")",
      ),
    );
    decisions.append(item);
  }

  const verification = document.getElementById("verification-list");
  for (const entry of artifact.explanation.verification) {
    const item = element("li");
    item.append(element("span", ui.verificationStatus[entry.status], "tag"));
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

  const button = element("button", ui.quizSubmit);
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
        (correct ? ui.correctLead : ui.incorrectLead) + view.question.explanation;
    }

    const percent = Math.round((correctCount / answerViews.length) * 100);
    const passed = percent >= artifact.quiz.passPercent;
    const result = document.getElementById("quiz-result");
    result.className = "result " + (passed ? "correct" : "incorrect");
    result.textContent =
      String(correctCount) + "/" + String(answerViews.length) + ui.correctCountSuffix + " · " +
      String(percent) + "% · " + (passed ? ui.passed : ui.belowThreshold) +
      " (" + ui.passThreshold + " " + String(artifact.quiz.passPercent) + "%)";
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
  panel.append(steps, element("p", ui.outcomeLabel + ": " + trace.outcome, "outcome"));
  parent.append(panel);
}

function renderMicroworld() {
  document.getElementById("microworld-title").textContent = artifact.microworld.title;
  document.getElementById("microworld-instructions").textContent = artifact.microworld.instructions;
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
      view.append(element("p", ui.missingScenario, "notice"));
      return;
    }

    addHeading(view, 3, scenario.title);
    const comparison = element("div", undefined, "grid two");
    renderTrace(comparison, ui.beforeTrace, scenario.before);
    renderTrace(comparison, ui.afterTrace, scenario.after);
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

renderExplanation();
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

function markdownBeforeAfter(entries, ui) {
  return entries
    .map(
      (entry) =>
        `### ${markdownText(entry.area)}\n\n` +
        `${bullet(`${ui.beforeLabel}: ${entry.before}`)}\n` +
        `${bullet(`${ui.afterLabel}: ${entry.after}`)}\n` +
        `${bullet(`${ui.whyLabel}: ${entry.why}`)}`,
    )
    .join("\n\n");
}

export function renderExplanationMarkdown(artifact) {
  validateArtifact(artifact);
  const ui = textForArtifact(artifact);

  const contextStatus = artifact.change.context.complete ? ui.complete : ui.incomplete;
  const warnings =
    artifact.change.context.warnings.length > 0
      ? bullets(artifact.change.context.warnings)
      : bullet(ui.none);
  const exclusionsSection =
    artifact.change.context.excluded.length > 0
      ? `### ${ui.excludedContextHeading}\n\n${artifact.change.context.excluded
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
        `${entry.decision} — ${entry.rationale} (${ui.tradeoffLabel}: ${entry.tradeoff})`,
      ),
    )
    .join("\n");
  const verification = artifact.explanation.verification
    .map((entry) =>
      bullet(`[${ui.verificationStatus[entry.status]}] ${entry.command} — ${entry.result}`),
    )
    .join("\n");

  return `# ${markdownText(artifact.title)}

## ${ui.changeSummaryHeading}

${markdownText(artifact.change.summary)}

- ${ui.comparisonLabel}: ${markdownText(artifact.change.comparison)}
- ${ui.contextLabel}: ${contextStatus}
- ${ui.fingerprintLabel}: ${markdownText(artifact.change.context.fingerprint)}

### ${ui.contextWarningsHeading}

${warnings}

${exclusionsSection}
## ${ui.goalHeading}

${markdownText(artifact.explanation.goal)}

## ${ui.observableChangesHeading}

${bullets(artifact.explanation.observableChanges)}

## ${ui.filesHeading}

${files}

## ${ui.beforeAfterHeading}

${markdownBeforeAfter(artifact.explanation.beforeAfter, ui)}

## ${ui.behaviorFlowHeading}

${flow}

## ${ui.invariantsHeading}

${bullets(artifact.explanation.invariants)}

## ${ui.decisionsHeading}

${decisions}

## ${ui.nonGoalsHeading}

${bullets(artifact.explanation.nonGoals)}

## ${ui.risksHeading}

${bullets(artifact.explanation.risks)}

## ${ui.verificationHeading}

${verification}
`;
}

function serializeJsonForHtml(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export function serializeArtifactForHtml(artifact) {
  return serializeJsonForHtml(artifact);
}

function sha256Base64(value) {
  return createHash("sha256").update(value, "utf8").digest("base64");
}

export function renderIndexHtml(artifact) {
  validateArtifact(artifact);
  const ui = textForArtifact(artifact);
  const artifactJson = serializeArtifactForHtml(artifact);
  const uiJson = serializeJsonForHtml(ui);
  const styleHash = sha256Base64(BROWSER_STYLE);
  const scriptHash = sha256Base64(BROWSER_SCRIPT);
  const dataHash = sha256Base64(artifactJson);
  const uiHash = sha256Base64(uiJson);
  const contentSecurityPolicy = [
    "default-src 'none'",
    `style-src 'sha256-${styleHash}'`,
    `script-src 'sha256-${scriptHash}' 'sha256-${dataHash}' 'sha256-${uiHash}'`,
    "img-src 'none'",
    "font-src 'none'",
    "connect-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");

  return `<!doctype html>
<html lang="${ui.lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}">
  <title>${ui.documentTitle}</title>
  <style>${BROWSER_STYLE}</style>
</head>
<body>
  <header>
    <p class="eyebrow">DiffScope</p>
    <h1 id="artifact-title">${ui.fallbackTitle}</h1>
    <p id="artifact-summary" class="lede"></p>
  </header>
  <main>
    <section aria-labelledby="explanation-heading">
      <h2 id="explanation-heading">${ui.explanationHeading}</h2>
      <p id="comparison" class="muted"></p>
      <div id="context-status"></div>
      <div id="context-exclusion-block" hidden>
        <h3>${ui.excludedContextHeading}</h3>
        <ul id="context-exclusions"></ul>
      </div>
      <h3>${ui.goalHeading}</h3>
      <p id="goal"></p>
      <h3>${ui.observableChangesHeading}</h3>
      <div id="observable-list"></div>
      <h3>${ui.filesHeading}</h3>
      <ul id="file-list"></ul>
      <h3>${ui.beforeAfterHeading}</h3>
      <div id="before-after" class="grid two"></div>
      <h3>${ui.behaviorFlowHeading}</h3>
      <ol id="flow-list" class="flow"></ol>
      <div class="grid two">
        <div><h3>${ui.invariantsHeading}</h3><div id="invariant-list"></div></div>
        <div><h3>${ui.nonGoalsHeading}</h3><div id="non-goal-list"></div></div>
      </div>
      <h3>${ui.decisionsHeading}</h3>
      <ul id="decision-list"></ul>
      <h3>${ui.risksHeading}</h3>
      <div id="risk-list"></div>
      <h3>${ui.verificationHeading}</h3>
      <ul id="verification-list"></ul>
    </section>

    <section aria-labelledby="quiz-heading">
      <p class="eyebrow">${ui.quizEyebrow}</p>
      <h2 id="quiz-heading">${ui.quizHeading}</h2>
      <p class="muted">${ui.quizNote}</p>
      <form id="quiz-form"></form>
      <p id="quiz-result" class="result" role="status" aria-live="polite" tabindex="-1"></p>
    </section>

    <section aria-labelledby="microworld-heading">
      <p class="eyebrow">${ui.microworldEyebrow}</p>
      <h2 id="microworld-heading">${ui.microworldHeading}</h2>
      <h3 id="microworld-title"></h3>
      <p id="microworld-instructions"></p>
      <div id="microworld-controls" class="controls"></div>
      <div id="scenario-view" role="region" aria-live="polite" aria-label="${ui.selectedScenarioLabel}"></div>
    </section>
  </main>
  <footer>${ui.footer}</footer>
  <noscript>${ui.noscript}</noscript>
  <script id="ui-data" type="application/json">${uiJson}</script>
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
    const directory = await mkdtemp(join(tmpdir(), "diff-scope-"));
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
    throw new ContextBindingError(["ChangeContextV1 is required before rendering a bundle"]);
  }
  validateArtifactAgainstContext(artifact, options.context);

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
