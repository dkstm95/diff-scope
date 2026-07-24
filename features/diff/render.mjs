import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  CODE_THEME,
  COLORS,
  DESIGN_VERSION,
  LAYOUT,
  SPACE,
  TYPE,
} from "../../design/tokens.mjs";
import { label, loadLocale } from "../../locales/index.mjs";
import { LIMITS, RENDERER_VERSION } from "./constants.mjs";
import { sha256 } from "./hash.mjs";
import { createCodeHighlighter } from "./highlight.mjs";
import { exposeBidiControls } from "./text.mjs";

const fontUrls = Object.freeze({
  code: new URL("../../design/fonts/HopeCode.woff2", import.meta.url),
  sansBold: new URL("../../design/fonts/HopeSansBold.woff2", import.meta.url),
  sansLight: new URL("../../design/fonts/HopeSansLight.woff2", import.meta.url),
  sansMedium: new URL("../../design/fonts/HopeSansMedium.woff2", import.meta.url),
});

const evidenceOccurrences = new WeakMap();

function html(value) {
  return exposeBidiControls(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function hashSource(value) {
  return createHash("sha256").update(value).digest("base64");
}

function userText(value, className = "") {
  return `<bdi dir="auto"${className ? ` class="${className}"` : ""}>${html(value)}</bdi>`;
}

function basisKey(basis) {
  return {
    code: "basis.shownInCode",
    inferred: "basis.inferred",
    stated: "basis.stated",
    unknown: "basis.couldNotConfirm",
  }[basis];
}

function sourceTitle(evidence, dictionary) {
  const lines = `${evidence.startLine}–${evidence.endLine}`;
  if (evidence.path) {
    return `${evidence.path} · ${label(dictionary, `source.${evidence.sourceKind}`)} ${lines}`;
  }
  return `${label(dictionary, `source.${evidence.sourceKind}`)} ${lines}`;
}

function trustedCodeUrl(review, evidence) {
  if (
    !evidence.path
    || !evidence.revision
    || !["before-file", "after-file"].includes(evidence.sourceKind)
  ) {
    return undefined;
  }
  const { owner, name } = review.snapshot.repository;
  const path = evidence.path.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
    + `/blob/${encodeURIComponent(evidence.revision)}/${path}`
    + `#L${evidence.startLine}-L${evidence.endLine}`;
}

function accessibleEvidenceLabel(context, count, dictionary) {
  const evidence = `${label(dictionary, "common.evidence")} · ${count}`;
  const normalized = String(context ?? "").replace(/\s+/gu, " ").trim();
  if (!normalized) return evidence;
  const shortened = [...normalized].slice(0, 160).join("");
  return `${shortened}${shortened.length < normalized.length ? "…" : ""} · ${evidence}`;
}

function evidenceTarget(evidence) {
  const key = `${evidence.sourceId}:${evidence.startLine}:${evidence.endLine}`;
  return `evidence-${createHash("sha256").update(key).digest("hex").slice(0, 12)}`;
}

function evidenceBlock(
  items,
  dictionary,
  review,
  codeHighlighter,
  { context = "", open = false } = {},
) {
  if (items.length === 0) return "";
  return `<details class="evidence"${open ? " open" : ""}>
    <summary aria-label="${html(accessibleEvidenceLabel(context, items.length, dictionary))}">${html(label(dictionary, "common.evidence"))} · ${items.length}</summary>
    <div class="evidence-list">
      ${items.map((item) => {
        let seen = evidenceOccurrences.get(codeHighlighter);
        if (!seen) {
          seen = new Set();
          evidenceOccurrences.set(codeHighlighter, seen);
        }
        const target = evidenceTarget(item);
        const url = trustedCodeUrl(review, item);
        const title = sourceTitle(item, dictionary);
        if (seen.has(target)) {
          return `<article class="evidence-reference">
            <a href="#${target}">${html(title)}</a>
          </article>`;
        }
        seen.add(target);
        const codeSource = ["after-file", "before-file", "patch"].includes(item.sourceKind);
        return `<article class="evidence-item" id="${target}">
          <div class="evidence-meta">
            ${url
              ? `<a href="${html(url)}" rel="noreferrer noopener" target="_blank">${html(title)}</a>`
              : `<span>${html(title)}</span>`}
          </div>
          <pre class="${codeSource ? "syntax-code" : "source-text"}"><code${codeSource
            ? ` aria-label="${html(item.excerpt)}"`
            : ""}>${codeSource
            ? codeHighlighter.render(item)
            : html(item.excerpt)}</code></pre>
        </article>`;
      }).join("")}
    </div>
  </details>`;
}

function claimBlock(
  claim,
  dictionary,
  review,
  codeHighlighter,
  className = "",
  { evidenceOpen = false } = {},
) {
  return `<div class="claim ${html(className)}">
    <p>${userText(claim.text)}</p>
    <div class="claim-meta">
      <div class="claim-basis">${html(label(dictionary, basisKey(claim.basis)))}</div>
      ${evidenceBlock(
        claim.evidence,
        dictionary,
        review,
        codeHighlighter,
        { context: claim.text, open: evidenceOpen },
      )}
    </div>
  </div>`;
}

function titledClaim(
  item,
  dictionary,
  review,
  codeHighlighter,
  { evidenceOpen = false } = {},
) {
  return `<article class="explanation-step">
    <h3>${userText(item.title)}</h3>
    ${claimBlock(item, dictionary, review, codeHighlighter, "", { evidenceOpen })}
  </article>`;
}

function kindLabel(kind, dictionary) {
  return label(dictionary, `item.${kind}`);
}

function importanceLabel(importance, dictionary) {
  return label(dictionary, `importance.${importance}`);
}

function countedLabel(dictionary, key, count) {
  return label(dictionary, key).replace("{count}", String(count));
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return String(value);
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
    + ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

function reviewItem(item, dictionary, review, codeHighlighter, { compact = false } = {}) {
  const className = `review-item kind-${html(item.kind)}${compact ? " review-item-compact" : ""}`;
  const id = compact ? `summary-${item.id}` : item.id;
  const relatedLimits = item.limitIds.map((limitId) => (
    review.limits.find((limit) => limit.id === limitId)
  )).filter(Boolean);
  return `<article class="${className}" id="${html(id)}">
    <div class="item-head">
      <span class="status kind-${html(item.kind)}">${html(kindLabel(item.kind, dictionary))}</span>
      <span class="importance">${html(importanceLabel(item.importance, dictionary))}</span>
      <span class="item-basis">${html(label(dictionary, basisKey(item.basis)))}</span>
    </div>
    <h3>${compact
      ? `<a href="#${html(item.id)}">${userText(item.title)}</a>`
      : userText(item.title)}</h3>
    <p>${userText(item.explanation)}</p>
    ${compact ? "" : `
      ${relatedLimits.length === 0 ? "" : `<p class="related-limits">
        <span>${html(label(dictionary, "item.relatedLimits"))}</span>
        ${relatedLimits.map((limit) => {
          const displayed = limitText(limit, dictionary);
          return `<a href="#scope-${html(limit.id)}">${userText(displayed.subject)}</a>`;
        }).join(" · ")}
      </p>`}
      <dl class="item-actions">
        <div><dt>${html(label(dictionary, "item.effect"))}</dt><dd>${userText(item.effect)}</dd></div>
        <div><dt>${html(label(dictionary, "item.nextStep"))}</dt><dd>${userText(item.nextStep)}</dd></div>
        <div><dt>${html(label(dictionary, "item.doneWhen"))}</dt><dd>${userText(item.doneWhen)}</dd></div>
      </dl>
      ${evidenceBlock(item.evidence, dictionary, review, codeHighlighter, {
        context: item.title,
      })}
    `}
  </article>`;
}

function section({ id, title, content }) {
  return `<section class="review-section" id="${html(id)}">
    <div class="section-heading">
      <h2>${html(title)}</h2>
    </div>
    ${content}
  </section>`;
}

function resultLabel(result, dictionary) {
  if (result.status === "none") return label(dictionary, "review.noItems");
  return label(dictionary, `review.status.${result.status}`);
}

function scopeLabel(scope, dictionary) {
  return label(dictionary, scope === "limited" ? "scope.limited" : "scope.sufficient");
}

function countSummary(result, dictionary) {
  return ["resolve", "decide", "verify"]
    .filter((kind) => result.counts[kind] > 0)
    .map((kind) => `${kindLabel(kind, dictionary)} ${result.counts[kind]}`)
    .join(" · ");
}

function limitText(limit, dictionary) {
  if (limit.kind === "unchanged-context") {
    return {
      reason: label(dictionary, "scope.unchanged.reason"),
      subject: label(dictionary, "scope.unchanged.subject"),
    };
  }
  if (limit.kind === "verification") {
    return {
      reason: label(dictionary, "scope.verification.reason"),
      subject: label(dictionary, "scope.verification.subject"),
    };
  }
  if (limit.kind === "file-unavailable" && limit.reasonKind) {
    return {
      reason: label(dictionary, `scope.fileUnavailable.${limit.reasonKind}`),
      subject: limit.subject,
    };
  }
  return { reason: limit.reason, subject: limit.subject };
}

function contextCheck(
  check,
  dictionary,
  review,
  codeHighlighter,
) {
  const relatedLimits = check.limitIds.map((limitId) => (
    review.limits.find((limit) => limit.id === limitId)
  )).filter(Boolean);
  return `<article class="context-check">
    <div class="context-check-head">
      <h4>${userText(check.subject)}</h4>
      <span class="context-status context-${html(check.status)}">${html(label(dictionary, `context.${check.status === "not-applicable" ? "notApplicable" : check.status}`))}</span>
    </div>
    <p>${userText(check.explanation)}</p>
    ${relatedLimits.length === 0 ? "" : `<p class="related-limits">
      ${relatedLimits.map((limit) => {
        const displayed = limitText(limit, dictionary);
        return `<a href="#scope-${html(limit.id)}">${userText(displayed.subject)}</a>`;
      }).join(" · ")}
    </p>`}
    ${evidenceBlock(check.evidence, dictionary, review, codeHighlighter, {
      context: check.subject,
    })}
  </article>`;
}

function synopsis(review, dictionary, codeHighlighter) {
  const visibleItems = review.reviewItems.slice(0, 3);
  const hiddenItems = review.reviewItems.length - visibleItems.length;
  const materialLimits = review.limits.filter((limit) => limit.material);
  const visibleLimits = materialLimits.slice(0, 3);
  const hiddenLimits = materialLimits.length - visibleLimits.length;
  return `<section class="synopsis" id="synopsis" aria-labelledby="synopsis-title">
    <div class="synopsis-head">
      <h2 id="synopsis-title">${html(label(dictionary, "section.synopsis"))}</h2>
    </div>
    <div class="synopsis-grid">
      <div class="synopsis-row">
        <h3>${html(label(dictionary, "synopsis.purpose"))}</h3>
        <div class="synopsis-value">${claimBlock(
          review.purpose,
          dictionary,
          review,
          codeHighlighter,
        )}</div>
      </div>
      <div class="before-after">
        <div class="synopsis-row">
          <h3>${html(label(dictionary, "synopsis.before"))}</h3>
          <div class="synopsis-value">${claimBlock(
            review.coreChange.before,
            dictionary,
            review,
            codeHighlighter,
          )}</div>
        </div>
        <div class="synopsis-row">
          <h3>${html(label(dictionary, "synopsis.now"))}</h3>
          <div class="synopsis-value">${claimBlock(
            review.coreChange.after,
            dictionary,
            review,
            codeHighlighter,
          )}</div>
        </div>
      </div>
      <div class="synopsis-row">
        <h3>${html(label(dictionary, "synopsis.why"))}</h3>
        <div class="synopsis-value">${claimBlock(
          review.coreChange.why,
          dictionary,
          review,
          codeHighlighter,
        )}</div>
      </div>
      <div class="status-row synopsis-status">
        <span class="status summary-${html(review.result.status)}">${html(resultLabel(review.result, dictionary))}</span>
        <span class="status scope-${html(review.result.scope)}">${html(scopeLabel(review.result.scope, dictionary))}</span>
      </div>
      <div class="synopsis-row synopsis-review">
        <h3>${html(label(dictionary, "synopsis.items"))}</h3>
        <div class="synopsis-value">
          <p class="summary-line">${html(countSummary(review.result, dictionary) || resultLabel(review.result, dictionary))}</p>
          ${visibleItems.map((item) => reviewItem(
            item,
            dictionary,
            review,
            codeHighlighter,
            { compact: true },
          )).join("")}
          ${hiddenItems > 0
            ? `<p class="more-link"><a href="#judge">${html(countedLabel(dictionary, "review.moreItems", hiddenItems))}</a></p>`
            : ""}
        </div>
      </div>
      <div class="synopsis-row">
        <h3>${html(label(dictionary, "synopsis.scope"))}</h3>
        <div class="synopsis-value">
          <p class="summary-line">${html(scopeLabel(review.result.scope, dictionary))}</p>
          ${visibleLimits.map((limit) => `<p><a href="#scope-${html(limit.id)}">${userText(limit.impact)}</a></p>`).join("")}
          ${hiddenLimits > 0
            ? `<p class="more-link"><a href="#evidence-and-scope">${html(countedLabel(dictionary, "scope.moreLimits", hiddenLimits))}</a></p>`
            : ""}
        </div>
      </div>
    </div>
  </section>`;
}

function evidenceSection(review, dictionary, codeHighlighter) {
  const sourceRows = review.sourceIndex.map((source) => {
    const pullRequestSource = [
      "pull-request-title",
      "pull-request-description",
    ].includes(source.kind);
    const location = source.path
      ? userText(source.path)
      : pullRequestSource
        ? `${html(review.snapshot.repository.owner)}/${html(review.snapshot.repository.name)} · PR #${review.snapshot.pullRequest.number}`
        : "—";
    return `<tr>
      <td>${html(label(dictionary, `source.${source.kind}`))}</td>
      <td>${location}</td>
      <td>${source.revision ? `<code>${html(source.revision.slice(0, 12))}</code>` : "—"}</td>
      <td>${html(countedLabel(dictionary, "source.lines", source.lineCount))}</td>
    </tr>`;
  }).join("");
  const files = review.files.map((file) => `<tr>
    <td>${userText(file.path)}</td>
    <td>${html(label(dictionary, `file.status.${file.providerStatus}`))}</td>
    <td>${html(label(dictionary, `file.use.${file.disposition}`))}</td>
    <td>+${file.additions} −${file.deletions}</td>
  </tr>`).join("");
  const limits = review.limits.map((limit) => {
    const displayed = limitText(limit, dictionary);
    return `<article class="scope-limit" id="scope-${html(limit.id)}">
    <div class="scope-limit-head">
      <h3>${userText(displayed.subject)}</h3>
      <span class="scope-impact">${html(label(dictionary, limit.material ? "scope.material" : "scope.nonMaterial"))}</span>
    </div>
    <dl>
      <div><dt>${html(label(dictionary, "scope.reason"))}</dt><dd>${userText(displayed.reason)}</dd></div>
      <div><dt>${html(label(dictionary, "scope.result"))}</dt><dd>${userText(limit.impact)}</dd></div>
    </dl>
  </article>`;
  }).join("");
  const snapshot = review.snapshot;
  return section({
    content: `
      <div class="evidence-group">
        <h3>${html(label(dictionary, "evidence.sources"))}</h3>
        <div class="table-scroll">
          <table>
            <caption class="sr-only">${html(label(dictionary, "evidence.sources"))}</caption>
            <thead><tr><th>${html(label(dictionary, "common.evidence"))}</th><th>${html(label(dictionary, "source.location"))}</th><th>${html(label(dictionary, "source.revision"))}</th><th>${html(label(dictionary, "file.lines"))}</th></tr></thead>
            <tbody>${sourceRows}</tbody>
          </table>
        </div>
      </div>
      <div class="evidence-group">
        <h3>${html(label(dictionary, "evidence.context"))}</h3>
        <div class="context-checks">${review.contextChecks.map((check) => contextCheck(
          check,
          dictionary,
          review,
          codeHighlighter,
        )).join("")}</div>
      </div>
      ${limits ? `<div class="scope-limits">${limits}</div>` : ""}
      <div class="evidence-group">
        <h3>${html(label(dictionary, "evidence.checkedFiles"))}</h3>
        <div class="table-scroll">
          <table>
            <caption class="sr-only">${html(label(dictionary, "evidence.checkedFiles"))}</caption>
            <thead><tr><th>${html(label(dictionary, "file.name"))}</th><th>${html(label(dictionary, "file.change"))}</th><th>${html(label(dictionary, "file.use"))}</th><th>${html(label(dictionary, "file.lines"))}</th></tr></thead>
            <tbody>${files}</tbody>
          </table>
        </div>
      </div>
      <details class="artifact-details">
        <summary>${html(label(dictionary, "artifact.details"))}</summary>
        <dl>
          <div><dt>${html(label(dictionary, "artifact.base"))}</dt><dd><code>${html(snapshot.snapshot.base)}</code></dd></div>
          <div><dt>${html(label(dictionary, "artifact.mergeBase"))}</dt><dd><code>${html(snapshot.snapshot.mergeBase)}</code></dd></div>
          <div><dt>${html(label(dictionary, "artifact.head"))}</dt><dd><code>${html(snapshot.snapshot.head)}</code></dd></div>
          <div><dt>${html(label(dictionary, "artifact.capturedAt"))}</dt><dd><time datetime="${html(snapshot.capturedAt)}" title="${html(snapshot.capturedAt)}">${html(formatTimestamp(snapshot.capturedAt))}</time></dd></div>
          <div><dt>${html(label(dictionary, "artifact.provider"))}</dt><dd>GitHub</dd></div>
          <div><dt>${html(label(dictionary, "artifact.repository"))}</dt><dd>${html(snapshot.repository.owner)}/${html(snapshot.repository.name)}</dd></div>
          <div><dt>${html(label(dictionary, "artifact.locale"))}</dt><dd>${html(snapshot.settings.locale)} · ${html(label(dictionary, `source.${snapshot.settings.localeSource}`))}</dd></div>
          <div><dt>${html(label(dictionary, "artifact.theme"))}</dt><dd>${html(label(dictionary, `theme.${snapshot.settings.theme}`))}</dd></div>
        </dl>
      </details>`,
    id: "evidence-and-scope",
    title: label(dictionary, "section.evidence"),
  });
}

function buildSections(review, dictionary, codeHighlighter) {
  const sections = [];
  if (review.background.length > 0) {
    sections.push({
      html: section({
        content: review.background.map(
          (item) => titledClaim(item, dictionary, review, codeHighlighter),
        ).join(""),
        id: "background",
        title: label(dictionary, "section.background"),
      }),
      id: "background",
      title: label(dictionary, "section.background"),
    });
  }
  sections.push({
    html: section({
      content: review.coreChange.details.map(
        (item) => claimBlock(item, dictionary, review, codeHighlighter, "core-detail"),
      ).join(""),
      id: "core-change",
      title: label(dictionary, "section.core"),
    }),
    id: "core-change",
    title: label(dictionary, "section.core"),
  });
  if (review.behavior) {
    const shortFlow = review.behavior.steps.length <= 5
      && review.behavior.steps.every((step) => step.text.length <= 140);
    sections.push({
      html: section({
        content: `${claimBlock(
          review.behavior.summary,
          dictionary,
          review,
          codeHighlighter,
        )}
          <ol class="flow${shortFlow ? " flow-short" : ""}">${review.behavior.steps.map(
            (step) => `<li>${claimBlock(
              step,
              dictionary,
              review,
              codeHighlighter,
            )}</li>`,
          ).join("")}</ol>`,
        id: "explore",
        title: label(dictionary, "section.explore"),
      }),
      id: "explore",
      title: label(dictionary, "section.explore"),
    });
  }
  if (review.codeSteps.length > 0) {
    sections.push({
      html: section({
        content: review.codeSteps.map((item, index) => titledClaim(
          item,
          dictionary,
          review,
          codeHighlighter,
          { evidenceOpen: index === 0 },
        )).join(""),
        id: "follow-code",
        title: label(dictionary, "section.code"),
      }),
      id: "follow-code",
      title: label(dictionary, "section.code"),
    });
  }
  if (review.reviewItems.length > 0) {
    sections.push({
      html: section({
        content: `<div class="review-items">${review.reviewItems.map(
          (item) => reviewItem(item, dictionary, review, codeHighlighter),
        ).join("")}</div>`,
        id: "judge",
        title: label(dictionary, "section.judge"),
      }),
      id: "judge",
      title: label(dictionary, "section.judge"),
    });
  }
  if (review.quiz.length > 0) {
    sections.push({
      html: section({
        content: `<div class="quiz">${review.quiz.map((item) => `<details id="${html(item.id)}">
          <summary>${userText(item.question)}</summary>
          <p>${userText(item.answer)}</p>
          ${evidenceBlock(item.evidence, dictionary, review, codeHighlighter, {
            context: item.question,
          })}
        </details>`).join("")}</div>`,
        id: "quiz",
        title: label(dictionary, "section.quiz"),
      }),
      id: "quiz",
      title: label(dictionary, "section.quiz"),
    });
  }
  sections.push({
    html: evidenceSection(review, dictionary, codeHighlighter),
    id: "evidence-and-scope",
    title: label(dictionary, "section.evidence"),
  });
  return sections;
}

function themeVariables(colors) {
  return [
    `--accent:${colors.accent}`,
    `--bg:${colors.background}`,
    `--border:${colors.border}`,
    `--component-border:${colors.componentBorder}`,
    `--decide:${colors.decide}`,
    `--muted:${colors.muted}`,
    `--panel:${colors.panel}`,
    `--resolve:${colors.resolve}`,
    `--scope:${colors.scope}`,
    `--text:${colors.text}`,
    `--verify:${colors.verify}`,
  ].join(";");
}

function codeThemeVariables(colors) {
  return [
    `--code-added-bg:${colors.addedBackground}`,
    `--code-bg:${colors.background}`,
    `--code-fg:${colors.foreground}`,
    `--code-hunk-bg:${colors.hunkBackground}`,
    `--code-removed-bg:${colors.removedBackground}`,
  ].join(";");
}

function css(fontBase64, syntaxStyles) {
  const [space1, space2, space3, space4, space5, space6] = SPACE;
  const wide = TYPE.body.wide;
  const narrow = TYPE.body.narrow;
  const wideCode = TYPE.code.wide;
  const narrowCode = TYPE.code.narrow;
  const widePageTitle = TYPE.pageTitle.wide;
  const narrowPageTitle = TYPE.pageTitle.narrow;
  const wideSection = TYPE.sectionTitle.wide;
  const narrowSection = TYPE.sectionTitle.narrow;
  const wideSubsection = TYPE.subsectionTitle.wide;
  const narrowSubsection = TYPE.subsectionTitle.narrow;

  return `@font-face {
  font-family: "Hope Sans";
  src: url(data:font/woff2;base64,${fontBase64.sansLight}) format("woff2");
  font-style: normal;
  font-weight: 300;
  font-display: swap;
}
@font-face {
  font-family: "Hope Sans";
  src: url(data:font/woff2;base64,${fontBase64.sansMedium}) format("woff2");
  font-style: normal;
  font-weight: 500;
  font-display: swap;
}
@font-face {
  font-family: "Hope Sans";
  src: url(data:font/woff2;base64,${fontBase64.sansBold}) format("woff2");
  font-style: normal;
  font-weight: 700;
  font-display: swap;
}
@font-face {
  font-family: "Hope Code";
  src: url(data:font/woff2;base64,${fontBase64.code}) format("woff2");
  font-style: normal;
  font-weight: 400;
  font-display: swap;
}

:root {
  color-scheme: light;
  ${themeVariables(COLORS.light)};
  ${codeThemeVariables(CODE_THEME.light)};
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    ${themeVariables(COLORS.dark)};
    ${codeThemeVariables(CODE_THEME.dark)};
  }
}

:root[data-theme="dark"] {
  color-scheme: dark;
  ${themeVariables(COLORS.dark)};
  ${codeThemeVariables(CODE_THEME.dark)};
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 300 ${wide.fontSize}px/${wide.lineHeight} "Hope Sans", sans-serif;
  text-rendering: optimizeLegibility;
}
h1,
h2,
h3,
strong,
b { font-weight: 700; }
code,
pre {
  font-family: "Hope Code", ui-monospace, monospace;
  font-weight: 400;
}
a {
  color: var(--accent);
  text-underline-offset: .2em;
}
button,
summary { font: inherit; }
button { color: inherit; }

.skip {
  position: fixed;
  z-index: 20;
  top: ${space2}px;
  left: ${space2}px;
  transform: translateY(-160%);
  padding: ${space2}px ${space3}px;
  border: 1px solid var(--border);
  background: var(--panel);
}
.skip:focus { transform: none; }
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.topbar {
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}
.topbar-inner {
  display: flex;
  max-width: ${LAYOUT.documentWidth}px;
  margin: auto;
  min-height: 52px;
  padding: ${space3}px ${space5}px;
  align-items: center;
  gap: ${space4}px;
}
.brand {
  font: 500 ${TYPE.brand.fontSize}px/${TYPE.brand.lineHeight} "Hope Sans", sans-serif;
  letter-spacing: .12em;
  white-space: nowrap;
}
.top-context {
  min-width: 0;
  flex: 1;
  color: var(--muted);
  text-align: center;
  font-size: ${TYPE.supporting.wide.fontSize}px;
  font-weight: 500;
}
.top-context a {
  color: inherit;
  text-decoration: none;
}
.top-context a:hover,
.top-context a:focus-visible { color: var(--text); }
.pr-hero {
  margin-bottom: ${space4}px;
}
.pr-hero h1 {
  margin: 0;
  font-size: ${widePageTitle.fontSize}px;
  line-height: ${widePageTitle.lineHeight};
  overflow-wrap: anywhere;
}
.pr-hero h1 a {
  color: var(--text);
  text-decoration: none;
}
.pr-hero h1 a:hover,
.pr-hero h1 a:focus-visible {
  color: var(--accent);
  text-decoration: underline;
}
.pr-meta,
.pr-snapshot {
  color: var(--muted);
  font-size: ${TYPE.supporting.wide.fontSize}px;
  font-weight: 500;
}
.pr-meta { margin-top: ${space2}px; }
.pr-snapshot {
  font-family: "Hope Code", ui-monospace, monospace;
  font-weight: 400;
}
.pr-freshness {
  max-width: ${LAYOUT.proseWidth};
  margin-top: ${space1}px;
  color: var(--muted);
  font-size: ${TYPE.supporting.wide.fontSize}px;
  font-weight: 500;
}

.theme-button {
  border: 1px solid var(--component-border);
  border-radius: ${space1}px;
  background: var(--panel);
  cursor: pointer;
}
.theme-button {
  display: inline-grid;
  width: ${space6}px;
  height: ${space6}px;
  padding: ${space1}px;
  place-items: center;
}
.theme-button:hover {
  border-color: var(--component-border);
}
.theme-icon {
  width: 18px;
  height: 18px;
  stroke: currentColor;
}
.theme-icon[hidden] { display: none; }

.layout {
  display: grid;
  max-width: ${LAYOUT.documentWidth}px;
  margin: auto;
  padding: ${space5}px;
  grid-template-columns: minmax(0, 1fr) ${LAYOUT.tableOfContentsWidth}px;
  gap: ${space6}px;
}
.main {
  width: 100%;
  max-width: ${LAYOUT.contentWidth}px;
  min-width: 0;
  counter-reset: review-section;
}
.toc-desktop {
  position: sticky;
  top: ${space5}px;
  align-self: start;
  padding-left: ${space4}px;
  border-left: 1px solid var(--border);
}
.toc-desktop h2,
.toc-mobile summary {
  font-size: ${TYPE.menu.fontSize}px;
  line-height: ${TYPE.menu.lineHeight};
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: .08em;
}
.toc-synopsis {
  margin-top: ${space3}px;
}
.toc-desktop ol { padding-left: ${space5}px; }
.toc-desktop li { margin: ${space2}px 0; }
.toc-desktop .toc-synopsis a,
.toc-desktop a {
  color: var(--muted);
  text-decoration: none;
  font-weight: 500;
}
.toc-desktop .toc-synopsis a:hover,
.toc-desktop .toc-synopsis a:focus,
.toc-desktop a:hover,
.toc-desktop a:focus { color: var(--text); }
.toc-mobile { display: none; }

.synopsis {
  margin-bottom: ${space5}px;
  padding: ${space4}px;
  border: 1px solid var(--border);
  background: var(--panel);
}
.synopsis-head {
  padding-bottom: ${space3}px;
  border-bottom: 1px solid var(--border);
}
.synopsis h2 {
  margin: 0;
  font-size: ${narrowSection.fontSize}px;
  line-height: ${narrowSection.lineHeight};
}
.synopsis-grid > div > h3,
.before-after > div > h3 {
  margin: 0 0 ${space1}px;
  color: var(--muted);
  font-size: ${TYPE.supporting.wide.fontSize}px;
  line-height: 1.3;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: .06em;
}
.status-row,
.item-head {
  display: flex;
  flex-wrap: wrap;
  gap: ${space2}px;
}
.synopsis-status { padding-top: ${space1}px; }
.status,
.importance {
  display: inline-flex;
  padding: ${space1}px ${space2}px;
  align-items: center;
  border: 1px solid currentColor;
  border-radius: 999px;
  font-size: ${TYPE.micro.fontSize}px;
  line-height: ${TYPE.micro.lineHeight};
  font-weight: 500;
}
.status.kind-resolve,
.summary-action { color: var(--resolve); }
.status.kind-decide,
.summary-decision { color: var(--decide); }
.status.kind-verify,
.summary-verify { color: var(--verify); }
.scope-limited,
.scope-sufficient,
.summary-none { color: var(--scope); }
.synopsis-grid {
  display: grid;
  padding-top: ${space4}px;
  gap: ${space3}px;
}
.before-after {
  display: grid;
  gap: ${space3}px;
}
.synopsis-row {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  gap: ${space3}px;
  align-items: start;
}
.synopsis-value {
  min-width: 0;
}
.claim p,
.summary-line,
.synopsis-grid > div > p,
.item-actions dd,
.scope-limit dd,
.quiz p {
  max-width: ${LAYOUT.proseWidth};
}
.claim p,
.summary-line { margin: 0; }
.more-link { margin: ${space2}px 0 0; }
.claim-meta {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 0 ${space2}px;
  align-items: center;
}
.claim-basis {
  color: var(--muted);
  font-size: ${TYPE.micro.fontSize}px;
  line-height: ${TYPE.micro.lineHeight};
  font-weight: 500;
}
.claim-meta > .evidence {
  min-width: 0;
  max-width: 100%;
}
.claim-meta > .evidence[open] { flex: 1 1 100%; }
.item-basis {
  align-self: center;
  color: var(--muted);
  font-size: ${TYPE.micro.fontSize}px;
  font-weight: 500;
}

.evidence {
  min-width: 0;
  max-width: 100%;
  margin-top: ${space2}px;
}
.claim-meta > .evidence { margin-top: 0; }
.evidence > summary {
  display: flex;
  min-height: 32px;
  align-items: center;
  color: var(--muted);
  cursor: pointer;
  font-size: ${TYPE.supporting.wide.fontSize}px;
  font-weight: 500;
}
.evidence-list {
  display: grid;
  min-width: 0;
  max-width: 100%;
  margin-top: ${space2}px;
  gap: ${space2}px;
}
.evidence-item {
  min-width: 0;
  max-width: 100%;
  border: 1px solid var(--component-border);
  background: var(--panel);
}
.evidence-reference {
  border: 1px solid var(--component-border);
  background: var(--panel);
}
.evidence-reference a {
  display: flex;
  min-height: 44px;
  padding: ${space2}px;
  align-items: center;
}
.evidence-meta {
  padding: ${space2}px;
  border-bottom: 1px solid var(--border);
  font: 400 ${TYPE.supporting.wide.fontSize}px/${TYPE.supporting.wide.lineHeight} "Hope Code", ui-monospace, monospace;
  overflow-wrap: anywhere;
}
.evidence pre {
  width: 100%;
  max-width: 100%;
  margin: 0;
  padding: ${space3}px;
  background: var(--panel);
  color: var(--text);
  overflow: auto;
  font: 400 ${wideCode.fontSize}px/${wideCode.lineHeight} "Hope Code", ui-monospace, monospace;
}
.evidence code {
  display: block;
  width: max-content;
  min-width: 100%;
}
.evidence pre.syntax-code {
  background: var(--code-bg);
  color: var(--code-fg);
}
.syntax-line {
  display: block;
  width: max-content;
  min-width: 100%;
}
.syntax-line-patch {
  display: inline-grid;
  grid-template-columns: 8ch minmax(0, 1fr);
}
.syntax-line-patch.syntax-line-unlocated {
  grid-template-columns: minmax(0, 1fr);
}
.syntax-line-patch::before {
  position: sticky;
  left: 0;
  padding-right: 1ch;
  border-right: 1px solid var(--border);
  background: var(--code-bg);
  color: var(--muted);
  content: attr(data-old-line) " " attr(data-new-line);
  text-align: right;
  user-select: none;
}
.syntax-line-patch.syntax-line-unlocated::before { display: none; }
.syntax-content { white-space: pre; }
.syntax-line-patch .syntax-content { padding-left: 1ch; }
.syntax-prefix {
  display: inline-block;
  width: 2ch;
  font-weight: 700;
}
.syntax-line-added { background: var(--code-added-bg); }
.syntax-line-removed { background: var(--code-removed-bg); }
.syntax-line-hunk { background: var(--code-hunk-bg); }

.review-section {
  counter-increment: review-section;
  margin: 0;
  padding: ${space4}px 0 ${space5}px;
  border-bottom: 1px solid var(--border);
}
.section-heading {
  display: flex;
  position: relative;
  margin-bottom: ${space2}px;
  padding-left: ${space3}px;
  align-items: center;
  gap: ${space2}px;
}
.section-heading::before {
  position: absolute;
  top: .1em;
  bottom: .1em;
  left: 0;
  width: 3px;
  background: var(--accent);
  content: "";
}
.section-heading h2 {
  margin: 0;
  font-size: ${wideSection.fontSize}px;
  line-height: ${wideSection.lineHeight};
}
.section-heading h2::before {
  margin-right: ${space3}px;
  content: counter(review-section);
  font-family: "Hope Code", ui-monospace, monospace;
  font-weight: 400;
}
.explanation-step + .explanation-step,
.review-item + .review-item { margin-top: ${space4}px; }
.explanation-step h3,
.review-item h3,
.scope-limit h3 {
  margin: 0 0 ${space2}px;
  font-size: ${wideSubsection.fontSize}px;
  line-height: ${wideSubsection.lineHeight};
}
.evidence-group + .evidence-group,
.evidence-group + .scope-limits,
.scope-limits + .evidence-group { margin-top: ${space4}px; }
.evidence-group > h3 {
  margin: 0 0 ${space2}px;
  font-size: ${wideSubsection.fontSize}px;
  line-height: ${wideSubsection.lineHeight};
}
.flow { padding-left: ${space5}px; }
.flow > li {
  margin: ${space3}px 0;
  padding-left: ${space2}px;
}
.flow-short {
  display: flex;
  margin: ${space3}px 0 0;
  padding: 0;
  gap: 28px;
  list-style: none;
  overflow-x: auto;
}
.flow-short > li {
  position: relative;
  min-width: 150px;
  margin: 0;
  padding: ${space3}px;
  flex: 1 0 0;
  border: 1px solid var(--component-border);
  background: var(--panel);
}
.flow-short > li:not(:last-child)::after {
  position: absolute;
  top: 50%;
  right: -22px;
  color: var(--muted);
  content: "→";
  font: 400 18px/1 "Hope Code", ui-monospace, monospace;
  transform: translateY(-50%);
}

.review-item {
  padding: ${space4}px;
  border: 1px solid var(--component-border);
  background: var(--panel);
}
.review-item > p {
  max-width: ${LAYOUT.proseWidth};
  margin: ${space2}px 0;
}
.review-item-compact {
  padding: ${space2}px 0;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: transparent;
}
.review-item-compact:last-of-type { border-bottom: 0; }
.review-item-compact h3 {
  margin: ${space1}px 0 0;
  font-size: inherit;
  line-height: inherit;
}
.review-item-compact h3 a {
  color: inherit;
  text-decoration: none;
}
.review-item-compact h3 a:hover,
.review-item-compact h3 a:focus-visible {
  color: var(--accent);
  text-decoration: underline;
}
.review-item-compact > p { display: none; }
.item-actions {
  display: grid;
  margin: ${space3}px 0;
  gap: ${space2}px;
}
.item-actions > div,
.scope-limit dl > div,
.artifact-details dl > div {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: ${space3}px;
}
.item-actions dt,
.scope-limit dt,
.artifact-details dt {
  color: var(--muted);
  font-weight: 500;
}
.item-actions dd,
.scope-limit dd,
.artifact-details dd { margin: 0; }
.related-limits {
  display: flex;
  flex-wrap: wrap;
  gap: ${space1}px;
  color: var(--muted);
  font-size: ${TYPE.supporting.wide.fontSize}px;
  font-weight: 500;
}

.scope-limits {
  display: grid;
  margin-bottom: ${space4}px;
  gap: ${space3}px;
}
.context-checks {
  display: grid;
  gap: ${space3}px;
}
.context-check,
.scope-limit {
  padding: ${space3}px;
  border: 1px solid var(--component-border);
  background: var(--panel);
}
.context-check-head,
.scope-limit-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: ${space2}px;
}
.context-check h4,
.scope-limit-head h3 { margin: 0; }
.context-check > p { margin: ${space2}px 0; }
.context-status,
.scope-impact {
  color: var(--muted);
  font-size: ${TYPE.supporting.wide.fontSize}px;
  font-weight: 500;
}
.context-checked { color: var(--accent); }
.context-limited { color: var(--scope); }
.scope-limit dl { margin: 0; }
.table-scroll {
  overflow: auto;
  border: 1px solid var(--component-border);
}
table {
  width: 100%;
  border-collapse: collapse;
  background: var(--panel);
}
th,
td {
  padding: ${space2}px ${space3}px;
  border-bottom: 1px solid var(--border);
  text-align: left;
}
th {
  color: var(--muted);
  font-size: ${TYPE.supporting.wide.fontSize}px;
  font-weight: 500;
}
td:first-child {
  font-family: "Hope Code", ui-monospace, monospace;
  font-weight: 400;
  overflow-wrap: anywhere;
}
.artifact-details { margin-top: ${space3}px; }
.evidence > summary,
.artifact-details > summary,
.quiz > details > summary,
.toc-mobile > summary {
  display: flex;
  min-height: 44px;
  gap: ${space1}px;
  align-items: center;
  cursor: pointer;
  font-weight: 500;
  list-style: none;
}
.evidence > summary { min-height: 32px; }
.evidence > summary::-webkit-details-marker,
.artifact-details > summary::-webkit-details-marker,
.quiz > details > summary::-webkit-details-marker,
.toc-mobile > summary::-webkit-details-marker {
  display: none;
}
.evidence > summary::before,
.artifact-details > summary::before,
.quiz > details > summary::before,
.toc-mobile > summary::before {
  content: "›";
  display: inline-block;
  flex: 0 0 auto;
  transition: transform 120ms ease;
}
.evidence[open] > summary::before,
.artifact-details[open] > summary::before,
.quiz > details[open] > summary::before,
.toc-mobile[open] > summary::before {
  transform: rotate(90deg);
}
.artifact-details dl {
  display: grid;
  gap: ${space2}px;
}
.quiz {
  display: grid;
  gap: ${space2}px;
}
.quiz > details {
  padding: ${space3}px;
  border: 1px solid var(--component-border);
  background: var(--panel);
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

@media (max-width: ${LAYOUT.tocBreakpoint}px) {
  .layout {
    display: block;
    padding: ${space4}px;
  }
  .toc-desktop { display: none; }
  .toc-mobile {
    display: block;
    width: max-content;
    max-width: 100%;
    margin: 0 0 ${space4}px auto;
  }
  .toc-mobile > summary {
    display: flex;
    min-height: 44px;
    padding: ${space2}px ${space3}px;
    align-items: center;
    border: 1px solid var(--component-border);
    background: var(--panel);
    cursor: pointer;
  }
  .toc-mobile[open] {
    width: 100%;
    padding: ${space3}px;
    border: 1px solid var(--component-border);
    background: var(--panel);
  }
  .toc-mobile[open] > summary {
    min-height: 44px;
    padding: 0 0 ${space2}px;
    border: 0;
    border-bottom: 1px solid var(--border);
    background: transparent;
  }
  .toc-mobile ol { padding-left: ${space5}px; }
  .toc-mobile a {
    color: var(--muted);
    font-weight: 500;
    text-decoration: none;
  }
  .toc-mobile a:hover,
  .toc-mobile a:focus-visible { color: var(--text); }
}

@media (max-width: ${LAYOUT.narrowBreakpoint}px) {
  body {
    font-size: ${narrow.fontSize}px;
    line-height: ${narrow.lineHeight};
  }
  .topbar-inner {
    padding: ${space3}px ${space4}px;
  }
  .top-context {
    overflow: hidden;
    font-size: ${TYPE.supporting.narrow.fontSize}px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pr-hero h1 {
    font-size: ${narrowPageTitle.fontSize}px;
    line-height: ${narrowPageTitle.lineHeight};
  }
  .pr-meta,
  .pr-snapshot,
  .pr-freshness {
    font-size: ${TYPE.supporting.narrow.fontSize}px;
    line-height: ${TYPE.supporting.narrow.lineHeight};
  }
  .synopsis { padding: ${space4}px; }
  .synopsis-grid > div > h3,
  .before-after > div > h3,
  .evidence > summary {
    font-size: ${TYPE.supporting.narrow.fontSize}px;
    line-height: ${TYPE.supporting.narrow.lineHeight};
  }
  .evidence > summary { min-height: 44px; }
  .status-row { margin-top: ${space3}px; }
  .section-heading h2 {
    font-size: ${narrowSection.fontSize}px;
    line-height: ${narrowSection.lineHeight};
  }
  .explanation-step h3,
  .review-item h3 {
    font-size: ${narrowSubsection.fontSize}px;
    line-height: ${narrowSubsection.lineHeight};
  }
  .evidence pre {
    font-size: ${narrowCode.fontSize}px;
    line-height: ${narrowCode.lineHeight};
  }
  .item-actions > div,
  .scope-limit dl > div,
  .artifact-details dl > div {
    grid-template-columns: 1fr;
    gap: ${space1}px;
  }
  .flow-short {
    display: grid;
    gap: 28px;
    overflow: visible;
  }
  .flow-short > li { min-width: 0; }
  .flow-short > li:not(:last-child)::after {
    top: auto;
    right: 50%;
    bottom: -23px;
    content: "↓";
    transform: translateX(50%);
  }
  .theme-button {
    width: 44px;
    height: 44px;
    margin-left: auto;
  }
}

@media (max-width: ${LAYOUT.compactBreakpoint}px) {
  .layout { padding: ${space3}px; }
  .topbar-inner { padding: ${space3}px; }
  .status,
  .importance,
  .claim-basis,
  .item-basis { font-size: ${TYPE.micro.compactFontSize}px; }
  .top-context { display: none; }
  .synopsis-row { grid-template-columns: 1fr; gap: ${space1}px; }
}

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  * {
    animation: none !important;
    transition: none !important;
  }
}

@media (forced-colors: active) {
  .status,
  .review-item,
  .synopsis,
  .scope-limit { forced-color-adjust: auto; }
  .review-section { border-left-color: Highlight; }
}

${syntaxStyles}

@media print {
  :root,
  :root[data-theme],
  :root:not([data-theme="light"]) {
    color-scheme: light;
    ${themeVariables(COLORS.light)};
    ${codeThemeVariables(CODE_THEME.light)};
    --bg: #fff;
    --border: #bbb;
    --muted: #555;
    --panel: #fff;
    --text: #000;
  }
  .toc-desktop,
  .toc-mobile,
  .theme-button,
  .skip { display: none; }
  .layout {
    display: block;
    max-width: none;
    padding: 0;
  }
  .main { max-width: none; }
  .review-section,
  .review-item,
  .evidence-item { break-inside: avoid; }
  a {
    color: inherit;
    text-decoration: none;
  }
}
`;
}

function clientScript(dictionary) {
  const labels = JSON.stringify({
    dark: label(dictionary, "common.useDarkTheme"),
    light: label(dictionary, "common.useLightTheme"),
  });
  return `(()=>{"use strict";const labels=${labels};const root=document.documentElement;const theme=document.getElementById("theme-toggle");const currentTheme=()=>root.dataset.theme==="dark"||(!root.dataset.theme&&matchMedia("(prefers-color-scheme: dark)").matches)?"dark":"light";const syncTheme=()=>{if(!theme)return;const next=currentTheme()==="dark"?"light":"dark";theme.setAttribute("aria-label",labels[next]);theme.setAttribute("title",labels[next]);for(const icon of theme.querySelectorAll("[data-theme-icon]"))icon.toggleAttribute("hidden",icon.dataset.themeIcon!==next);};syncTheme();theme?.addEventListener("click",()=>{root.dataset.theme=currentTheme()==="dark"?"light":"dark";syncTheme();});matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change",syncTheme);const openTarget=()=>{if(!location.hash)return;const target=document.getElementById(location.hash.slice(1));if(!target)return;for(let parent=target.parentElement;parent;parent=parent.parentElement)if(parent.tagName==="DETAILS")parent.open=true;};addEventListener("hashchange",openTarget);openTarget();})();`;
}

export async function renderReview(review, { fonts } = {}) {
  const dictionary = await loadLocale(review.snapshot.settings.locale);
  const fontBytes = fonts ?? Object.fromEntries(await Promise.all(
    Object.entries(fontUrls).map(async ([name, url]) => [name, await readFile(url)]),
  ));
  const codeHighlighter = await createCodeHighlighter();
  const script = clientScript(dictionary);
  const sections = buildSections(review, dictionary, codeHighlighter);
  const synopsisHtml = synopsis(review, dictionary, codeHighlighter);
  const styles = css(
    Object.fromEntries(Object.entries(fontBytes).map(
      ([name, bytes]) => [name, bytes.toString("base64")],
    )),
    codeHighlighter.styleSheet(),
  );
  const title = review.snapshot.pullRequest.title;
  const { owner, name } = review.snapshot.repository;
  const prUrl = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
    + `/pull/${review.snapshot.pullRequest.number}`;
  const theme = review.snapshot.settings.theme;
  const themeAttribute = theme === "system" ? "" : ` data-theme="${html(theme)}"`;
  const toc = `<div class="toc-synopsis"><a href="#synopsis">${html(label(dictionary, "section.synopsis"))}</a></div>
  <ol>${sections.map(
    (item) => `<li><a href="#${html(item.id)}">${html(item.title)}</a></li>`,
  ).join("")}</ol>`;
  const document = `<!doctype html>
<html lang="${html(review.snapshot.settings.locale)}"${themeAttribute}>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; object-src 'none'; frame-src 'none'; connect-src 'none'; img-src data:; font-src data:; style-src 'sha256-${hashSource(styles)}'; script-src 'sha256-${hashSource(script)}'">
  <title>${html(title)} · Hope diff</title>
  <style>${styles}</style>
</head>
<body>
  <a class="skip" href="#review">${html(label(dictionary, "common.skip"))}</a>
  <header class="topbar">
    <div class="topbar-inner">
      <div class="brand">HOPE · DIFF</div>
      <div class="top-context"><a href="${html(prUrl)}" rel="noreferrer noopener" target="_blank">${html(owner)}/${html(name)} · PR #${review.snapshot.pullRequest.number}</a></div>
      <button class="theme-button" id="theme-toggle" type="button" aria-label="${html(label(dictionary, theme === "dark" ? "common.useLightTheme" : "common.useDarkTheme"))}" title="${html(label(dictionary, theme === "dark" ? "common.useLightTheme" : "common.useDarkTheme"))}">
        <svg class="theme-icon" data-theme-icon="dark" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${theme === "dark" ? " hidden" : ""}>
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79"></path>
        </svg>
        <svg class="theme-icon" data-theme-icon="light" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${theme === "dark" ? "" : " hidden"}>
          <circle cx="12" cy="12" r="4"></circle>
          <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"></path>
        </svg>
      </button>
    </div>
  </header>
  <div class="layout">
    <main class="main" id="review">
      <div class="pr-hero">
        <h1><a href="${html(prUrl)}" rel="noreferrer noopener" target="_blank">${userText(title)}</a></h1>
        <div class="pr-meta">${html(owner)}/${html(name)} · PR #${review.snapshot.pullRequest.number}</div>
        <div class="pr-snapshot">${html(label(dictionary, "artifact.snapshot"))} ${html(review.snapshot.snapshot.head.slice(0, 8))} · <time datetime="${html(review.snapshot.capturedAt)}" title="${html(review.snapshot.capturedAt)}">${html(formatTimestamp(review.snapshot.capturedAt))}</time></div>
        <div class="pr-freshness">${html(label(dictionary, "artifact.notice"))}</div>
      </div>
      <details class="toc-mobile">
        <summary>${html(label(dictionary, "common.menu"))}</summary>
        ${toc}
      </details>
      ${synopsisHtml}
      ${sections.map((item) => item.html).join("")}
    </main>
    <nav class="toc-desktop" aria-label="${html(label(dictionary, "common.menu"))}">
      <h2>${html(label(dictionary, "common.menu"))}</h2>
      ${toc}
    </nav>
  </div>
  <script>${script}</script>
</body>
</html>
`;
  const bytes = Buffer.from(document, "utf8");
  if (bytes.length > LIMITS.artifactBytes) {
    throw new Error(`Hope review exceeds ${LIMITS.artifactBytes} bytes`);
  }
  return Object.freeze({
    bytes,
    designVersion: DESIGN_VERSION,
    digest: sha256(bytes),
    rendererVersion: RENDERER_VERSION,
  });
}
