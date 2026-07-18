import { createHash, randomBytes } from "node:crypto";
import { chmod, link, lstat, mkdtemp, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";

import {
  ChangeRequestBindingError,
  validateReviewAgainstChangeRequest,
  validateReviewModel,
} from "./validate-review.mjs";

const REVIEW_STYLE = String.raw`:root {
  color-scheme: light;
  --ink: #17201d;
  --muted: #5d6964;
  --paper: #f4f3ed;
  --panel: #fffdf7;
  --line: #d7d8cf;
  --accent: #12684f;
  --accent-soft: #def1e8;
  --declared: #315fa8;
  --observed: #17633f;
  --inferred: #7a5314;
  --unknown: #963d37;
  --warning: #7a5314;
  --warning-soft: #fff0ca;
  --danger: #9c342f;
  --success: #17633f;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-synthesis: none;
}
* { box-sizing: border-box; }
body { margin: 0; color: var(--ink); background: var(--paper); line-height: 1.62; }
header, main, footer { width: min(1120px, calc(100% - 32px)); margin-inline: auto; }
header { padding: 56px 0 26px; }
header p { max-width: 78ch; }
main { display: grid; gap: 22px; padding-bottom: 56px; }
section { border: 1px solid var(--line); border-radius: 18px; padding: clamp(20px, 4vw, 36px); background: var(--panel); box-shadow: 0 12px 34px rgba(28, 37, 33, .055); }
h1, h2, h3, h4 { line-height: 1.24; }
h1 { margin: 0; font-size: clamp(2rem, 5vw, 3.7rem); letter-spacing: -.045em; }
h2 { margin-top: 0; font-size: clamp(1.4rem, 3vw, 2rem); }
h3 { margin-top: 28px; }
p, li { max-width: 82ch; }
.eyebrow { margin: 0 0 8px; color: var(--accent); font-size: .8rem; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
.lede { font-size: 1.12rem; }
.muted { color: var(--muted); }
.notice { border-left: 4px solid var(--warning); border-radius: 8px; padding: 13px 15px; color: var(--warning); background: var(--warning-soft); }
.grid { display: grid; gap: 16px; }
.grid.two { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
.card { border: 1px solid var(--line); border-radius: 12px; padding: 16px; background: #fff; }
.card > :first-child { margin-top: 0; }
.card > :last-child { margin-bottom: 0; }
.meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin: 18px 0; }
.meta dt { color: var(--muted); font-size: .78rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
.meta dd { margin: 3px 0 0; overflow-wrap: anywhere; }
.tag { display: inline-block; margin-right: 7px; border-radius: 999px; padding: 2px 9px; font-size: .78rem; font-weight: 800; text-transform: capitalize; background: var(--accent-soft); color: var(--accent); }
.tag.declared { color: var(--declared); background: #e5edfb; }
.tag.observed { color: var(--observed); background: #e3f2e9; }
.tag.inferred { color: var(--inferred); background: #fff0ca; }
.tag.unknown { color: var(--unknown); background: #fae6e2; }
.claim { margin-block: 12px; }
.claim p { margin: 6px 0; }
.evidence { margin-top: 10px; color: var(--muted); }
.evidence summary { cursor: pointer; font-weight: 700; }
.evidence ul { margin-bottom: 0; }
.excerpt { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 18rem; overflow: auto; border: 1px solid var(--line); border-radius: 8px; padding: 12px; background: #f2f1eb; }
.before-after { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.before-after h5 { margin: 0 0 8px; }
.visual-flow { display: flex; flex-wrap: wrap; align-items: stretch; gap: 10px; padding: 0; list-style: none; }
.visual-flow li { flex: 1 1 180px; position: relative; border: 1px solid var(--line); border-radius: 12px; padding: 14px; background: #fff; }
.visual-flow li:not(:last-child)::after { content: "→"; position: absolute; right: -12px; top: 50%; z-index: 1; color: var(--accent); font-weight: 900; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid var(--line); padding: 10px; text-align: left; vertical-align: top; }
th { background: #f0efe8; }
.flow { padding-left: 1.4rem; }
.flow li { margin-block: 10px; }
.file-map { font-size: .92rem; }
.file-map code { word-break: break-all; }
.literate-change { border-left: 3px solid var(--accent); padding-left: 14px; margin-block: 18px; }
fieldset { margin: 0 0 20px; border: 1px solid var(--line); border-radius: 12px; padding: 16px; }
legend { padding: 0 8px; font-weight: 760; }
.choice { display: flex; gap: 10px; align-items: flex-start; margin-block: 9px; }
.choice input { margin-top: .38rem; }
button, select { border: 1px solid var(--line); border-radius: 9px; padding: 10px 13px; color: var(--ink); background: #fff; font: inherit; }
button { border-color: var(--accent); color: #fff; background: var(--accent); font-weight: 760; cursor: pointer; }
button:hover { filter: brightness(.93); }
button:focus-visible, select:focus-visible, input:focus-visible, summary:focus-visible { outline: 3px solid rgba(18,104,79,.3); outline-offset: 2px; }
.answer { margin: 10px 0 0; padding: 10px 12px; border-radius: 8px; background: #f0efe9; }
.result { min-height: 1.6em; margin-top: 14px; font-weight: 760; }
.correct { color: var(--success); }
.incorrect { color: var(--danger); }
.controls { display: flex; flex-wrap: wrap; gap: 14px; margin-block: 20px; }
.control { display: grid; gap: 5px; min-width: 190px; }
.control label { font-weight: 700; }
.trace ol { padding-left: 1.4rem; }
.outcome { border-top: 1px solid var(--line); padding-top: 12px; font-weight: 700; }
.lesson { border-left: 4px solid var(--accent); padding: 12px 16px; background: var(--accent-soft); }
code { border-radius: 4px; padding: 2px 5px; background: #eeece4; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
footer { padding: 0 0 40px; color: var(--muted); font-size: .9rem; }
[hidden] { display: none !important; }
@media (max-width: 640px) {
  header { padding-top: 34px; }
  section { border-radius: 12px; }
  .before-after { grid-template-columns: 1fr; }
  .visual-flow li:not(:last-child)::after { content: "↓"; right: 50%; top: auto; bottom: -19px; }
}`;

const REVIEW_SCRIPT = String.raw`"use strict";
const review = JSON.parse(document.getElementById("review-data").textContent);
const evidenceById = new Map(review.evidence.map(function (entry) { return [entry.id, entry]; }));

function element(tagName, text, className) {
  const node = document.createElement(tagName);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function heading(parent, level, text) {
  const node = element("h" + String(level), text);
  parent.append(node);
  return node;
}

function appendList(parent, values, ordered) {
  const list = element(ordered ? "ol" : "ul");
  values.forEach(function (value) { list.append(element("li", value)); });
  parent.append(list);
  return list;
}

function shortSha(value) { return value.slice(0, 12); }

function evidenceLabel(entry) {
  let label = entry.label + " · " + entry.source;
  if (entry.path !== null) label += " · " + entry.path;
  if (entry.commitSha !== null) label += " · " + shortSha(entry.commitSha);
  return label;
}

function appendEvidence(parent, evidenceIds) {
  if (evidenceIds.length === 0) return;
  const details = element("details", undefined, "evidence");
  details.append(element("summary", "Evidence (" + String(evidenceIds.length) + ")"));
  const list = element("ul");
  evidenceIds.forEach(function (evidenceId) {
    const entry = evidenceById.get(evidenceId);
    const item = element("li");
    item.append(element("span", evidenceLabel(entry)));
    if (entry.excerpt !== null) item.append(element("pre", entry.excerpt, "excerpt"));
    list.append(item);
  });
  details.append(list);
  parent.append(details);
}

function renderClaim(value) {
  const article = element("article", undefined, "claim");
  article.append(element("span", value.basis, "tag " + value.basis));
  article.append(element("p", value.text));
  appendEvidence(article, value.evidenceIds);
  return article;
}

function renderSnapshot() {
  document.getElementById("review-title").textContent = review.title;
  document.getElementById("review-lede").textContent = review.overview.summary.text;
  const change = review.changeRequest;
  const values = [
    ["Change Request", change.repository + " #" + change.id],
    ["PR title", change.title],
    ["Author", change.author],
    ["Stage", change.reviewStage + (change.isDraft ? " · draft" : "")],
    ["Commits", String(change.commitCount)],
    ["Base SHA", change.baseSha],
    ["Merge-base SHA", change.mergeBaseSha],
    ["Head SHA", change.headSha],
    ["Comparison", shortSha(change.mergeBaseSha) + " → " + shortSha(change.headSha)],
    ["Coverage", change.coverage.status + " · " + String(change.coverage.representedFiles) + "/" + String(change.coverage.discoveredFiles) + " files"],
    ["Analyzed lines", String(change.coverage.analyzedChangedLines) + "/" + String(change.coverage.changedLines) + " changed lines"],
  ];
  const metadata = document.getElementById("snapshot-meta");
  values.forEach(function (pair) {
    const wrapper = element("div");
    wrapper.append(element("dt", pair[0]), element("dd", pair[1]));
    metadata.append(wrapper);
  });
  document.getElementById("snapshot-fingerprint").textContent = change.fingerprint;
  if (change.coverage.status !== "complete" || change.warnings.length > 0 || change.exclusions.length > 0) {
    const warning = document.getElementById("scope-warning");
    warning.hidden = false;
    const messages = [];
    if (change.coverage.status !== "complete") messages.push("Coverage is " + change.coverage.status + ". Treat conclusions outside represented bodies cautiously.");
    messages.push.apply(messages, change.warnings);
    change.exclusions.forEach(function (entry) { messages.push(entry.path + " — " + entry.reason); });
    appendList(warning, messages, false);
  }
  const fileBody = document.getElementById("file-map-body");
  change.files.forEach(function (file) {
    const row = element("tr");
    const pathCell = element("td");
    pathCell.append(element("code", file.path));
    const previousCell = element("td");
    if (file.previousPath === null) previousCell.append(document.createTextNode("—"));
    else previousCell.append(element("code", file.previousPath));
    row.append(pathCell, previousCell, element("td", file.status), element("td", "+" + String(file.additions) + " / -" + String(file.deletions)), element("td", file.bodyState));
    fileBody.append(row);
  });
}

function renderBackground() {
  const content = document.getElementById("background-content");
  if (review.background.length === 0) content.append(element("p", "No additional background was needed for this change.", "muted"));
  else review.background.forEach(function (claim) { content.append(renderClaim(claim)); });
}

function renderOverview() {
  const summary = document.getElementById("overview-summary");
  summary.append(renderClaim(review.overview.summary));
  const observable = document.getElementById("observable-changes");
  review.overview.observableChanges.forEach(function (claim) { observable.append(renderClaim(claim)); });
  const comparisons = document.getElementById("overview-before-after");
  review.overview.beforeAfter.forEach(function (entry) {
    const article = element("article", undefined, "card");
    article.append(element("span", entry.basis, "tag " + entry.basis));
    heading(article, 4, entry.area);
    const panels = element("div", undefined, "before-after");
    const before = element("div", undefined, "card"); before.append(element("h5", "Before"), element("p", entry.before));
    const after = element("div", undefined, "card"); after.append(element("h5", "After"), element("p", entry.after));
    panels.append(before, after);
    article.append(panels, element("p", "Why: " + entry.why, "muted"));
    appendEvidence(article, entry.evidenceIds);
    comparisons.append(article);
  });
}

function renderVisuals() {
  const section = document.getElementById("visual-section");
  const content = document.getElementById("visual-content");
  if (review.visuals.length === 0) {
    content.append(element("p", review.visualOmissionReason, "muted"));
    return;
  }
  review.visuals.forEach(function (visual) {
    const article = element("article", undefined, "card");
    heading(article, 3, visual.title);
    article.append(element("p", visual.caption, "muted"));
    if (visual.kind === "before-after") {
      visual.items.forEach(function (item) {
        heading(article, 4, item.label);
        const panels = element("div", undefined, "before-after");
        const before = element("div", undefined, "card"); before.append(element("h5", "Before"), element("p", item.before));
        const after = element("div", undefined, "card"); after.append(element("h5", "After"), element("p", item.after));
        panels.append(before, after); article.append(panels);
      });
    } else if (visual.kind === "flow") {
      const flow = element("ol", undefined, "visual-flow");
      visual.steps.forEach(function (step) {
        const item = element("li"); item.append(element("strong", step.label), element("p", step.detail)); flow.append(item);
      });
      article.append(flow);
    } else {
      const wrapper = element("div", undefined, "table-wrap");
      const table = element("table");
      const head = element("thead"); const headRow = element("tr"); headRow.append(element("th", "Case"));
      visual.columns.forEach(function (column) { headRow.append(element("th", column)); }); head.append(headRow); table.append(head);
      const body = element("tbody");
      visual.rows.forEach(function (row) { const tableRow = element("tr"); tableRow.append(element("th", row.label)); row.cells.forEach(function (cell) { tableRow.append(element("td", cell)); }); body.append(tableRow); });
      table.append(body); wrapper.append(table); article.append(wrapper);
    }
    appendEvidence(article, visual.evidenceIds);
    content.append(article);
  });
  section.hidden = false;
}

function renderWorkstreams() {
  const content = document.getElementById("workstream-content");
  review.workstreams.forEach(function (workstream) {
    const article = element("article", undefined, "card");
    heading(article, 3, workstream.title);
    article.append(element("p", workstream.summary));
    const list = element("ol", undefined, "flow");
    workstream.steps.forEach(function (step) {
      const item = element("li"); item.append(element("span", step.basis, "tag " + step.basis), element("strong", step.component + ": "), document.createTextNode(step.behavior)); appendEvidence(item, step.evidenceIds); list.append(item);
    });
    article.append(list); appendEvidence(article, workstream.evidenceIds); content.append(article);
  });
}

function renderLiterateDiff() {
  const content = document.getElementById("literate-content");
  review.literateDiff.forEach(function (entry) {
    const article = element("article", undefined, "card");
    const title = element("h3"); title.append(element("code", entry.path)); article.append(title, element("p", entry.role, "muted"));
    entry.changes.forEach(function (change) {
      const block = element("div", undefined, "literate-change"); heading(block, 4, change.headline); block.append(element("p", change.explanation)); appendEvidence(block, change.evidenceIds); article.append(block);
    });
    content.append(article);
  });
}

function renderSafety() {
  const renderClaims = function (targetId, claims) { const target = document.getElementById(targetId); claims.forEach(function (claim) { target.append(renderClaim(claim)); }); };
  renderClaims("invariant-content", review.invariants);
  renderClaims("risk-content", review.risks);
  const decisions = document.getElementById("decision-content");
  if (review.decisions.length === 0) decisions.append(element("p", "No decision was stated strongly enough to preserve here.", "muted"));
  review.decisions.forEach(function (entry) {
    const card = element("article", undefined, "card"); card.append(element("span", entry.basis, "tag " + entry.basis)); heading(card, 4, entry.decision); card.append(element("p", entry.rationale), element("p", "Trade-off: " + entry.tradeoff, "muted")); appendEvidence(card, entry.evidenceIds); decisions.append(card);
  });
  const verification = document.getElementById("verification-content");
  review.verification.forEach(function (entry) { const item = element("li"); item.append(element("span", entry.status, "tag"), element("code", entry.command), document.createTextNode(" — " + entry.result)); appendEvidence(item, entry.evidenceIds); verification.append(item); });
}

function renderAuthorQuestions() {
  const content = document.getElementById("question-content");
  if (review.authorQuestions.length === 0) { content.append(element("p", "No unresolved author questions were identified from the available evidence.", "muted")); return; }
  review.authorQuestions.forEach(function (entry) { const card = element("article", undefined, "card"); heading(card, 3, entry.question); card.append(element("p", entry.why)); appendEvidence(card, entry.evidenceIds); content.append(card); });
}

function renderQuiz() {
  const form = document.getElementById("quiz-form");
  const views = [];
  review.quiz.questions.forEach(function (question, index) {
    const fieldset = element("fieldset"); fieldset.append(element("legend", String(index + 1) + ". " + question.prompt), element("span", question.category, "tag"));
    const inputs = [];
    question.options.forEach(function (option) {
      const label = element("label", undefined, "choice"); const input = element("input"); input.type = question.type === "single" ? "radio" : "checkbox"; input.name = "question-" + question.id; input.value = option.id; input.id = "question-" + question.id + "-" + option.id; label.setAttribute("for", input.id); label.append(input, element("span", option.text)); fieldset.append(label); inputs.push(input);
    });
    const feedback = element("p", undefined, "answer"); feedback.hidden = true; fieldset.append(feedback); appendEvidence(fieldset, question.evidenceIds); form.append(fieldset); views.push({ question: question, inputs: inputs, feedback: feedback });
  });
  const button = element("button", "Check answers and show explanations"); button.type = "submit"; form.append(button);
  form.addEventListener("submit", function (event) {
    event.preventDefault(); let correctCount = 0;
    views.forEach(function (view) {
      const selected = new Set(view.inputs.filter(function (input) { return input.checked; }).map(function (input) { return input.value; }));
      const expected = new Set(view.question.correctOptionIds);
      const correct = selected.size === expected.size && Array.from(expected).every(function (optionId) { return selected.has(optionId); });
      if (correct) correctCount += 1; view.feedback.hidden = false; view.feedback.className = "answer " + (correct ? "correct" : "incorrect"); view.feedback.textContent = (correct ? "Correct. " : "Review this answer. ") + view.question.explanation;
    });
    const percent = Math.round((correctCount / views.length) * 100); const passed = percent >= review.quiz.passPercent; const result = document.getElementById("quiz-result"); result.className = "result " + (passed ? "correct" : "incorrect"); result.textContent = String(correctCount) + "/" + String(views.length) + " correct · " + String(percent) + "% · " + (passed ? "Pass" : "Below threshold") + ". This score locates gaps; it does not prove complete understanding."; result.focus();
  });
}

function renderTrace(parent, label, trace) {
  const panel = element("article", undefined, "card trace"); heading(panel, 4, label); const list = element("ol"); trace.steps.forEach(function (step) { const item = element("li"); item.append(element("strong", step.component + ": "), document.createTextNode(step.behavior)); list.append(item); }); panel.append(list, element("p", "Outcome: " + trace.outcome, "outcome")); parent.append(panel);
}

function renderMicroworld() {
  if (review.microworld === null) return;
  const section = document.getElementById("microworld-section"); section.hidden = false; const world = review.microworld; document.getElementById("microworld-title").textContent = world.title; document.getElementById("microworld-instructions").textContent = world.instructions; appendEvidence(document.getElementById("microworld-evidence"), world.evidenceIds);
  const controls = document.getElementById("microworld-controls"); const selections = new Map();
  function update() {
    const scenario = world.scenarios.find(function (candidate) { return world.controls.every(function (control) { const binding = candidate.when.find(function (entry) { return entry.controlId === control.id; }); return binding && binding.optionId === selections.get(control.id); }); });
    const view = document.getElementById("scenario-view"); view.textContent = ""; if (!scenario) { view.append(element("p", "No scenario matches this combination.", "notice")); return; } heading(view, 3, scenario.title); const comparison = element("div", undefined, "grid two"); renderTrace(comparison, "Before change", scenario.before); renderTrace(comparison, "After change", scenario.after); view.append(comparison, element("p", scenario.lesson, "lesson"));
  }
  world.controls.forEach(function (control) { const wrapper = element("div", undefined, "control"); const label = element("label", control.label); const select = element("select"); select.id = "control-" + control.id; label.setAttribute("for", select.id); control.options.forEach(function (option) { const node = element("option", option.text); node.value = option.id; if (option.id === control.defaultOptionId) node.selected = true; select.append(node); }); selections.set(control.id, control.defaultOptionId); select.addEventListener("change", function () { selections.set(control.id, select.value); update(); }); wrapper.append(label, select); controls.append(wrapper); });
  update();
}

function renderSsotCandidates() {
  if (review.ssotCandidates.length === 0) return;
  const section = document.getElementById("ssot-section"); section.hidden = false; const content = document.getElementById("ssot-content"); review.ssotCandidates.forEach(function (entry) { const card = element("article", undefined, "card"); card.append(element("span", entry.target, "tag")); heading(card, 3, entry.insight); card.append(element("p", entry.whyDurable)); if (entry.path !== null) { const path = element("p", "Suggested existing owner: ", "muted"); path.append(element("code", entry.path)); card.append(path); } appendEvidence(card, entry.evidenceIds); content.append(card); });
}

renderSnapshot();
renderBackground();
renderOverview();
renderVisuals();
renderWorkstreams();
renderLiterateDiff();
renderSafety();
renderAuthorQuestions();
renderQuiz();
renderMicroworld();
renderSsotCandidates();`;

export function serializeReviewForHtml(review) {
  return JSON.stringify(review)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function sha256Base64(value) {
  return createHash("sha256").update(value, "utf8").digest("base64");
}

export function renderReviewHtml(review) {
  validateReviewModel(review);
  const data = serializeReviewForHtml(review);
  const contentSecurityPolicy = [
    "default-src 'none'",
    `style-src 'sha256-${sha256Base64(REVIEW_STYLE)}'`,
    `script-src 'sha256-${sha256Base64(REVIEW_SCRIPT)}' 'sha256-${sha256Base64(data)}'`,
    "img-src 'none'",
    "font-src 'none'",
    "connect-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "child-src 'none'",
    "manifest-src 'none'",
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
  <title>Hope Review</title>
  <style>${REVIEW_STYLE}</style>
</head>
<body>
  <header>
    <p class="eyebrow">Hope · diff</p>
    <h1 id="review-title">Hope Review</h1>
    <p id="review-lede" class="lede"></p>
  </header>
  <main>
    <section aria-labelledby="snapshot-heading">
      <p class="eyebrow">Review snapshot</p>
      <h2 id="snapshot-heading">Exact Change Request scope</h2>
      <p class="muted">This offline review represents one immutable base-to-head snapshot. Regenerate it after any new commit or force-push.</p>
      <dl id="snapshot-meta" class="meta"></dl>
      <p class="muted">Fingerprint: <code id="snapshot-fingerprint"></code></p>
      <div id="scope-warning" class="notice" role="note" hidden></div>
      <details>
        <summary>Changed file map</summary>
        <div class="table-wrap"><table class="file-map"><thead><tr><th>Path</th><th>Previous path</th><th>Status</th><th>Lines</th><th>Body</th></tr></thead><tbody id="file-map-body"></tbody></table></div>
      </details>
    </section>
    <section aria-labelledby="background-heading"><p class="eyebrow">Context</p><h2 id="background-heading">Background</h2><div id="background-content"></div></section>
    <section aria-labelledby="overview-heading"><p class="eyebrow">At a glance</p><h2 id="overview-heading">What changed</h2><div id="overview-summary"></div><h3>Observable changes</h3><div id="observable-changes"></div><h3>Before and after</h3><div id="overview-before-after" class="grid"></div></section>
    <section id="visual-section" aria-labelledby="visual-heading"><p class="eyebrow">Visual explanation</p><h2 id="visual-heading">Visual model</h2><div id="visual-content" class="grid"></div></section>
    <section aria-labelledby="workstream-heading"><p class="eyebrow">Causal path</p><h2 id="workstream-heading">How it works</h2><div id="workstream-content" class="grid"></div></section>
    <section aria-labelledby="literate-heading"><p class="eyebrow">Selected evidence</p><h2 id="literate-heading">Literate diff</h2><p class="muted">A selective, causal walkthrough of the most important changed files. Full raw patches are not embedded.</p><div id="literate-content" class="grid"></div></section>
    <section aria-labelledby="safety-heading"><p class="eyebrow">Safety and judgment</p><h2 id="safety-heading">Invariants, risks, and decisions</h2><div class="grid two"><div><h3>Invariants</h3><div id="invariant-content"></div></div><div><h3>Risks</h3><div id="risk-content"></div></div></div><h3>Decisions and trade-offs</h3><div id="decision-content" class="grid"></div><h3>Verification</h3><ul id="verification-content"></ul></section>
    <section aria-labelledby="author-questions-heading"><p class="eyebrow">Unresolved context</p><h2 id="author-questions-heading">Questions for the author</h2><div id="question-content" class="grid"></div></section>
    <section aria-labelledby="quiz-heading"><p class="eyebrow">Focused self-check</p><h2 id="quiz-heading">Understanding quiz</h2><p class="muted">The score helps locate understanding gaps; it does not prove complete understanding or approve a merge.</p><form id="quiz-form"></form><p id="quiz-result" class="result" role="status" aria-live="polite" tabindex="-1"></p></section>
    <section id="microworld-section" aria-labelledby="microworld-heading" hidden><p class="eyebrow">Interactive model</p><h2 id="microworld-heading">Microworld</h2><p class="notice">This is a bounded explanatory model. It does not execute project code.</p><h3 id="microworld-title"></h3><p id="microworld-instructions"></p><div id="microworld-evidence"></div><div id="microworld-controls" class="controls"></div><div id="scenario-view" role="region" aria-live="polite" aria-label="Selected scenario"></div></section>
    <section id="ssot-section" aria-labelledby="ssot-heading" hidden><p class="eyebrow">Optional preservation</p><h2 id="ssot-heading">Consider preserving</h2><p class="muted">Only durable, human-confirmed knowledge belongs in an existing project source of truth. Hope never writes these candidates automatically.</p><div id="ssot-content" class="grid"></div></section>
  </main>
  <footer>Generated by Hope for this exact Change Request snapshot. This file works offline and makes no network requests.</footer>
  <noscript>JavaScript is required to display the review, quiz, and optional microworld.</noscript>
  <script id="review-data" type="application/json">${data}</script>
  <script>${REVIEW_SCRIPT}</script>
</body>
</html>
`;
}

async function pathExists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

async function chooseOutputFile(outputFile) {
  if (outputFile === undefined) {
    const directory = await mkdtemp(join(tmpdir(), "hope-review-"));
    await chmod(directory, 0o700);
    return { file: join(directory, "hope-review.html"), privateDirectory: directory };
  }
  if (typeof outputFile !== "string" || outputFile.trim().length === 0) throw new TypeError("outputFile must be a non-empty path");
  const file = resolve(outputFile);
  if (extname(file).toLowerCase() !== ".html") throw new Error("outputFile must end in .html");
  if (await pathExists(file)) throw new Error(`Refusing to overwrite existing output path: ${file}`);
  const parentStatus = await stat(dirname(file));
  if (!parentStatus.isDirectory()) throw new Error(`Output parent is not a directory: ${dirname(file)}`);
  if ((await lstat(dirname(file))).isSymbolicLink()) throw new Error(`Refusing a symlink output parent: ${dirname(file)}`);
  return { file, privateDirectory: null };
}

export async function writeReviewHtml(review, options = {}) {
  if (options.changeRequest === undefined) throw new ChangeRequestBindingError(["ChangeRequestV1 is required before rendering"]);
  validateReviewAgainstChangeRequest(review, options.changeRequest);
  const html = renderReviewHtml(review);
  const output = await chooseOutputFile(options.outputFile);
  const temporaryFile = join(dirname(output.file), `.${basename(output.file)}.${randomBytes(8).toString("hex")}.tmp`);
  let published = false;
  try {
    await writeFile(temporaryFile, html, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await chmod(temporaryFile, 0o600);
    await link(temporaryFile, output.file);
    published = true;
    await unlink(temporaryFile);
  } catch (error) {
    await rm(temporaryFile, { force: true });
    if (published) await rm(output.file, { force: true });
    if (output.privateDirectory !== null) await rm(output.privateDirectory, { recursive: true, force: true });
    throw error;
  }
  return { file: output.file };
}
