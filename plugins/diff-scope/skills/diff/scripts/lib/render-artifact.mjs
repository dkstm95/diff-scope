import { createHash, randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  ContextBindingError,
  validateArtifact,
  validateArtifactAgainstContext,
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

function renderExplanation() {
  document.getElementById("artifact-title").textContent = artifact.title;
  document.getElementById("artifact-summary").textContent = artifact.change.summary;
  document.getElementById("comparison").textContent = artifact.change.comparison;
  document.getElementById("goal").textContent = artifact.explanation.goal;

  const context = document.getElementById("context-status");
  if (!artifact.change.context.complete) {
    context.className = "notice";
    context.setAttribute("role", "note");
    context.append(element("strong", "컨텍스트가 완전하지 않습니다. "));
    context.append(
      document.createTextNode(
        artifact.change.context.warnings.length > 0
          ? artifact.change.context.warnings.join(" · ")
          : "수집 범위를 확인하세요.",
      ),
    );
  } else if (artifact.change.context.warnings.length > 0) {
    context.className = "notice";
    context.setAttribute("role", "note");
    context.textContent = artifact.change.context.warnings.join(" · ");
  } else {
    context.textContent = "수집기가 이 변경 범위를 완전한 것으로 표시했습니다.";
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
    card.append(element("p", "이전: " + entry.before));
    card.append(element("p", "이후: " + entry.after));
    card.append(element("p", "이유: " + entry.why, "muted"));
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
    item.append(document.createTextNode(entry.rationale + " (절충: " + entry.tradeoff + ")"));
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

  const button = element("button", "채점하고 해설 보기");
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
        (correct ? "정답입니다. " : "다시 확인하세요. ") + view.question.explanation;
    }

    const percent = Math.round((correctCount / answerViews.length) * 100);
    const passed = percent >= artifact.quiz.passPercent;
    const result = document.getElementById("quiz-result");
    result.className = "result " + (passed ? "correct" : "incorrect");
    result.textContent =
      String(correctCount) + "/" + String(answerViews.length) + " 정답 · " +
      String(percent) + "% · " + (passed ? "기준 통과" : "기준 미달") +
      " (통과 기준 " + String(artifact.quiz.passPercent) + "%)";
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
  panel.append(steps, element("p", "결과: " + trace.outcome, "outcome"));
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
      view.append(element("p", "해당 조합의 시나리오를 찾지 못했습니다.", "notice"));
      return;
    }

    addHeading(view, 3, scenario.title);
    const comparison = element("div", undefined, "grid two");
    renderTrace(comparison, "변경 전", scenario.before);
    renderTrace(comparison, "변경 후", scenario.after);
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

function markdownBeforeAfter(entries) {
  return entries
    .map(
      (entry) =>
        `### ${markdownText(entry.area)}\n\n` +
        `${bullet(`이전: ${entry.before}`)}\n` +
        `${bullet(`이후: ${entry.after}`)}\n` +
        `${bullet(`이유: ${entry.why}`)}`,
    )
    .join("\n\n");
}

export function renderExplanationMarkdown(artifact) {
  validateArtifact(artifact);

  const contextStatus = artifact.change.context.complete ? "완전" : "불완전";
  const warnings =
    artifact.change.context.warnings.length > 0
      ? bullets(artifact.change.context.warnings)
      : "- 없음";
  const exclusionsSection =
    artifact.change.context.excluded.length > 0
      ? `### 제외된 컨텍스트\n\n${artifact.change.context.excluded
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
    .map((entry) => bullet(`${entry.decision} — ${entry.rationale} (절충: ${entry.tradeoff})`))
    .join("\n");
  const verification = artifact.explanation.verification
    .map((entry) => bullet(`[${entry.status}] ${entry.command} — ${entry.result}`))
    .join("\n");

  return `# ${markdownText(artifact.title)}

## 변경 요약

${markdownText(artifact.change.summary)}

- 비교 범위: ${markdownText(artifact.change.comparison)}
- 컨텍스트: ${contextStatus}
- 지문: ${markdownText(artifact.change.context.fingerprint)}

### 컨텍스트 경고

${warnings}

${exclusionsSection}
## 목표

${markdownText(artifact.explanation.goal)}

## 관찰 가능한 변화

${bullets(artifact.explanation.observableChanges)}

## 파일과 책임

${files}

## 이전과 이후

${markdownBeforeAfter(artifact.explanation.beforeAfter)}

## 동작 흐름

${flow}

## 불변 조건

${bullets(artifact.explanation.invariants)}

## 결정과 절충

${decisions}

## 비목표

${bullets(artifact.explanation.nonGoals)}

## 위험

${bullets(artifact.explanation.risks)}

## 검증

${verification}
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
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}">
  <title>변경 이해 번들</title>
  <style>${BROWSER_STYLE}</style>
</head>
<body>
  <header>
    <p class="eyebrow">DiffScope</p>
    <h1 id="artifact-title">변경 이해 번들</h1>
    <p id="artifact-summary" class="lede"></p>
  </header>
  <main>
    <section aria-labelledby="explanation-heading">
      <h2 id="explanation-heading">설명 문서</h2>
      <p id="comparison" class="muted"></p>
      <div id="context-status"></div>
      <div id="context-exclusion-block" hidden>
        <h3>제외된 컨텍스트</h3>
        <ul id="context-exclusions"></ul>
      </div>
      <h3>목표</h3>
      <p id="goal"></p>
      <h3>관찰 가능한 변화</h3>
      <div id="observable-list"></div>
      <h3>파일과 책임</h3>
      <ul id="file-list"></ul>
      <h3>이전과 이후</h3>
      <div id="before-after" class="grid two"></div>
      <h3>동작 흐름</h3>
      <ol id="flow-list" class="flow"></ol>
      <div class="grid two">
        <div><h3>불변 조건</h3><div id="invariant-list"></div></div>
        <div><h3>비목표</h3><div id="non-goal-list"></div></div>
      </div>
      <h3>결정과 절충</h3>
      <ul id="decision-list"></ul>
      <h3>위험</h3>
      <div id="risk-list"></div>
      <h3>검증</h3>
      <ul id="verification-list"></ul>
    </section>

    <section aria-labelledby="quiz-heading">
      <p class="eyebrow">Focused self-check</p>
      <h2 id="quiz-heading">이해도 퀴즈</h2>
      <p class="muted">정답률은 특정 이해 공백을 찾기 위한 신호이며, 전체 이해를 증명하지 않습니다.</p>
      <form id="quiz-form"></form>
      <p id="quiz-result" class="result" role="status" aria-live="polite" tabindex="-1"></p>
    </section>

    <section aria-labelledby="microworld-heading">
      <p class="eyebrow">Interactive microworld</p>
      <h2 id="microworld-heading">마이크로월드</h2>
      <h3 id="microworld-title"></h3>
      <p id="microworld-instructions"></p>
      <div id="microworld-controls" class="controls"></div>
      <div id="scenario-view" role="region" aria-live="polite" aria-label="선택한 시나리오"></div>
    </section>
  </main>
  <footer>이 파일은 오프라인으로 동작하며 네트워크 요청을 만들지 않습니다.</footer>
  <noscript>퀴즈와 마이크로월드를 사용하려면 JavaScript가 필요합니다.</noscript>
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
