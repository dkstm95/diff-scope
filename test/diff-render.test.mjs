import assert from "node:assert/strict";
import test from "node:test";

import {
  CODE_THEME,
  COLORS,
  LAYOUT,
  TYPE,
} from "../design/tokens.mjs";
import { digestJson } from "../features/diff/hash.mjs";
import { renderReview } from "../features/diff/render.mjs";
import { validateAnalysis } from "../features/diff/validate.mjs";
import { makeAnalysis, makeSnapshot } from "../test-support/diff-fixture.mjs";

const runId = "3".repeat(32);

test("rendering is byte-identical and keeps untrusted content inert", async () => {
  const snapshot = makeSnapshot({
    title: '</title><script src="https://evil.example/x.js"></script>',
  });
  const analysis = makeAnalysis(snapshot, runId);
  analysis.coreChange.details[0].text = "<img src=x onerror=alert(1)>";
  const review = validateAnalysis(analysis, snapshot, { runId });
  const [first, second] = await Promise.all([
    renderReview(review),
    renderReview(review),
  ]);
  assert.deepEqual(first.bytes, second.bytes);
  const html = first.bytes.toString("utf8");
  assert.doesNotMatch(html, /<script src="https:\/\/evil/u);
  assert.match(html, /&lt;script src=/u);
  assert.match(html, /Content-Security-Policy/u);
  assert.match(html, /default-src &#39;none&#39;|default-src 'none'/u);
  assert.match(html, /data:font\/woff2;base64/u);
  assert.match(html, new RegExp(`--accent:${COLORS.light.accent}`, "u"));
  assert.match(
    html,
    new RegExp(`--component-border:${COLORS.light.componentBorder}`, "u"),
  );
  assert.match(html, new RegExp(`--code-bg:${CODE_THEME.light.background}`, "u"));
  assert.match(html, new RegExp(`--code-fg:${CODE_THEME.dark.foreground}`, "u"));
  assert.match(html, new RegExp(`max-width: ${LAYOUT.contentWidth}px`, "u"));
  assert.match(
    html,
    new RegExp(`font: 300 ${TYPE.body.wide.fontSize}px/${TYPE.body.wide.lineHeight}`, "u"),
  );
  assert.match(html, /font-family: "Hope Sans"/u);
  assert.match(html, /font-family: "Hope Code"/u);
  assert.match(html, /font-weight: 400;/u);
  assert.equal((html.match(/@font-face/gu) ?? []).length, 4);
  assert.match(html, /\.status\.kind-verify,/u);
  assert.doesNotMatch(html, /\n\.kind-verify,/u);
  assert.match(html, /aria-label="Switch to dark mode"/u);
  assert.doesNotMatch(html, /aria-pressed=/u);
  assert.match(html, /\.theme-icon\[hidden\] \{ display: none; \}/u);
  assert.match(html, /toggleAttribute\("hidden"/u);
  assert.doesNotMatch(html, /data-copy-section/u);
  assert.doesNotMatch(html, /class="copy-link"/u);
  assert.doesNotMatch(html, />Change theme</u);
  const header = html.match(/<header class="topbar">[\s\S]*?<\/header>/u)?.[0] ?? "";
  assert.match(html, /<div class="pr-hero">[\s\S]*?<h1>/u);
  assert.match(html, /rel="noreferrer noopener" target="_blank"/u);
  assert.doesNotMatch(header, /<h1>/u);
  assert.match(html, /<section class="synopsis" id="synopsis"/u);
  assert.match(html, /class="toc-synopsis"><a href="#synopsis"/u);
  assert.match(html, /\.section-heading h2::before/u);
  assert.match(html, /content: counter\(review-section\)/u);
  assert.match(html, /<details class="evidence" open>/u);
  assert.match(html, /<pre class="syntax-code"><code aria-label=/u);
  assert.match(html, /class="syntax-token-[a-f0-9]{16}"/u);
  assert.match(html, /:root\[data-theme="dark"\] \.syntax-token-[a-f0-9]{16}/u);
  assert.doesNotMatch(html, /<span[^>]+style=/u);
  assert.match(html, /class="review-item kind-verify review-item-compact"/u);
  assert.match(html, /id="summary-review-item-1"/u);
  assert.match(html, /id="summary-review-item-1"[\s\S]*?<h3><a href="#review-item-1">/u);
  assert.equal((html.match(/id="review-item-1"/gu) ?? []).length, 1);
  assert.match(html, /class="item-basis"/u);
  assert.match(html, /class="related-limits"/u);
  assert.match(html, /href="#scope-limit-1"/u);
  assert.match(html, /class="scope-limit" id="scope-limit-1"/u);
  assert.match(html, /<summary aria-label="[^"]+ · Evidence · \d+">Evidence · \d+<\/summary>/u);
  assert.match(html, /\.evidence > summary \{[\s\S]*?min-height: 32px;/u);
  assert.match(html, /\.evidence > summary::before,/u);
  assert.match(html, /\.syntax-line-patch\.syntax-line-unlocated/u);
  assert.match(html, /\.syntax-line-patch\.syntax-line-unlocated::before \{ display: none; \}/u);
  assert.match(html, /class="evidence-reference"/u);
  assert.equal((html.match(/id="evidence-[a-f0-9]{12}"/gu) ?? []).length > 0, true);
  assert.match(html, /<caption class="sr-only">/u);
  assert.match(html, /<time datetime="[^"]+" title="[^"]+">/u);
  assert.equal((html.match(/This offline file does not track later pull request changes\./gu) ?? []).length, 1);
  assert.match(html, />Captured sources</u);
  assert.match(html, />Context check status</u);
  assert.match(html, />Checked changed files</u);
  assert.match(html, />Checked</u);
  assert.match(html, />Check limited</u);
  assert.match(html, />Not applicable</u);
  assert.match(html, /href="#scope-limit-1"/u);
  assert.match(html, />pull request description</u);
  assert.match(html, />change excerpt</u);
  assert.doesNotMatch(html, />source-[0-9]+</u);
  const synopsis = html.match(/<section class="synopsis"[\s\S]*?<\/section>/u)?.[0] ?? "";
  assert.ok(synopsis.indexOf("synopsis.why") === -1);
  assert.ok(synopsis.indexOf("synopsis-status") > synopsis.indexOf("Why it matters"));
  assert.match(html, /\.flow-short > li:not\(:last-child\)::after/u);
  assert.match(html, /width: 44px;[\s\S]*height: 44px;/u);
  assert.match(html, new RegExp(`@media \\(max-width: ${LAYOUT.tocBreakpoint}px\\)`, "u"));
  assert.match(html, /\.syntax-line \{[\s\S]*?display: block;[\s\S]*?width: max-content;/u);
  assert.match(html, /grid-template-columns: 8ch minmax\(0, 1fr\)/u);
});

test("Korean and dark theme are reflected without a header language badge", async () => {
  const snapshot = makeSnapshot({ locale: "ko-KR", theme: "dark" });
  const review = validateAnalysis(makeAnalysis(snapshot, runId), snapshot, { runId });
  const rendered = await renderReview(review);
  const html = rendered.bytes.toString("utf8");
  assert.match(html, /<html lang="ko-KR" data-theme="dark">/u);
  assert.match(html, /변경의 핵심/u);
  assert.equal((html.match(/변경 요약/gu) ?? []).length, 3);
  assert.doesNotMatch(html, /한눈에 보기/u);
  assert.match(html, /스냅샷 bbbbbbbb/u);
  assert.match(html, /2026-07-23 00:00 UTC/u);
  assert.match(html, new RegExp("a".repeat(40), "u"));
  assert.match(html, new RegExp("c".repeat(40), "u"));
  assert.match(html, /핵심 설명/u);
  assert.match(html, /수집한 출처/u);
  assert.match(html, /맥락 확인 상태/u);
  assert.match(html, /확인한 변경 파일/u);
  assert.match(html, /주요 설명·판단을 제한함/u);
  assert.match(html, /변경 파일 밖의 기존 코드/u);
  assert.match(html, /src\/retry\.js · 변경 조각 2–4/u);
  assert.match(html, /aria-label="라이트 모드로 전환"/u);
  assert.doesNotMatch(html, /aria-pressed=/u);
  assert.match(html, /data-theme-icon="dark"[^>]* hidden/u);
  assert.match(html, /data-theme-icon="light"[^>]*>/u);
  assert.doesNotMatch(html, />테마 변경</u);
  assert.doesNotMatch(html, />#<\/button>/u);
  assert.doesNotMatch(html, /class="language-badge"/u);
  assert.doesNotMatch(html, />modified</u);
  assert.doesNotMatch(html, />explained</u);
});

test("the synopsis bounds long item and scope lists", async () => {
  const snapshot = makeSnapshot();
  const analysis = makeAnalysis(snapshot, runId);
  analysis.reviewItems = Array.from({ length: 5 }, (_, index) => ({
    ...analysis.reviewItems[0],
    title: `Review item ${index + 1}`,
  }));
  const review = validateAnalysis(analysis, snapshot, { runId });
  const extendedReview = {
    ...review,
    limits: [
      ...review.limits,
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `extra-limit-${index + 1}`,
        impact: `Scope impact ${index + 1}`,
        kind: "unchanged-context",
        material: true,
        reason: "Not collected",
        subject: `Context ${index + 1}`,
      })),
    ],
  };
  const rendered = await renderReview(extendedReview);
  const html = rendered.bytes.toString("utf8");

  assert.match(html, />2 more review items</u);
  assert.match(html, />2 more scope notes</u);
  assert.equal(
    (html.match(/class="review-item kind-verify"/gu) ?? []).length,
    5,
  );
  assert.equal(
    (html.match(/class="review-item kind-verify review-item-compact"/gu) ?? []).length,
    3,
  );
});

test("short behavior steps use the responsive flow and long steps fall back", async () => {
  const snapshot = makeSnapshot();
  const shortAnalysis = makeAnalysis(snapshot, runId);
  shortAnalysis.behavior = {
    steps: [
      { ...shortAnalysis.coreChange.after, text: "Keep the final error." },
      { ...shortAnalysis.coreChange.after, text: "Return it to the caller." },
    ],
    summary: shortAnalysis.coreChange.after,
  };
  const shortReview = validateAnalysis(shortAnalysis, snapshot, { runId });
  const shortHtml = (await renderReview(shortReview)).bytes.toString("utf8");
  assert.match(shortHtml, /<ol class="flow flow-short">/u);

  const longAnalysis = makeAnalysis(snapshot, runId);
  longAnalysis.behavior = {
    steps: [
      { ...longAnalysis.coreChange.after, text: "Keep the final error." },
      { ...longAnalysis.coreChange.after, text: "x".repeat(141) },
    ],
    summary: longAnalysis.coreChange.after,
  };
  const longReview = validateAnalysis(longAnalysis, snapshot, { runId });
  const longHtml = (await renderReview(longReview)).bytes.toString("utf8");
  assert.match(longHtml, /<ol class="flow">/u);
  assert.doesNotMatch(longHtml, /<ol class="flow flow-short">/u);
});

test("unavailable-file reasons use the review language", async () => {
  const original = makeSnapshot({ locale: "ko-KR" });
  const { digest: _digest, ...value } = original;
  value.files = [
    ...value.files,
    {
      additions: 1,
      bodyReason: "The file name commonly contains private configuration",
      bodyReasonKind: "private-path",
      bodyState: "redacted",
      deletions: 0,
      id: "file-2",
      path: ".env",
      providerStatus: "added",
      sourceIds: [],
    },
  ];
  value.limits = [
    ...value.limits,
    {
      id: "limit-2",
      kind: "file-unavailable",
      reason: "The file name commonly contains private configuration",
      reasonKind: "private-path",
      subject: ".env",
    },
  ];
  const snapshot = { ...value, digest: digestJson(value) };
  const analysis = makeAnalysis(snapshot, runId);
  analysis.limitImpacts.push({
    impact: "실제 환경 설정 값은 판단할 수 없습니다.",
    limitId: "limit-2",
    material: true,
  });
  analysis.contextChecks.push({
    evidence: [],
    explanation: "환경 설정 파일 본문을 확인하지 않았습니다.",
    limitIds: ["limit-2"],
    status: "limited",
    subject: "실제 환경 설정 값",
  });
  const review = validateAnalysis(analysis, snapshot, { runId });
  const rendered = await renderReview(review);
  const html = rendered.bytes.toString("utf8");

  assert.match(html, /파일 이름이 일반적으로 비공개 설정에 사용됩니다/u);
  assert.doesNotMatch(
    html,
    /The file name commonly contains private configuration/u,
  );
});
