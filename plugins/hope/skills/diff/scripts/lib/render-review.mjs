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
a { color: var(--accent); text-underline-offset: .18em; }
.section-nav, .jump-nav { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 auto 22px; }
.section-nav { width: min(1120px, calc(100% - 32px)); }
.section-nav a, .jump-nav a { border: 1px solid var(--line); border-radius: 999px; padding: 6px 11px; color: var(--accent); background: var(--panel); font-size: .88rem; font-weight: 750; text-decoration: none; }
.section-nav a:hover, .jump-nav a:hover { border-color: var(--accent); }
.workstream-card { scroll-margin-top: 18px; }
.inline-links { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: baseline; }
.inline-links .label { color: var(--muted); font-weight: 750; }
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
.path-list { columns: 2 280px; }
.path-list li { break-inside: avoid; margin-block: 5px; }
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
.compact-meta { grid-template-columns: repeat(auto-fit, minmax(145px, 1fr)); margin-bottom: 0; }
.compact-meta > div { border-top: 1px solid var(--line); padding-top: 10px; }
.technical-details > summary { cursor: pointer; font-size: 1.15rem; font-weight: 800; }
.technical-details[open] > summary { margin-bottom: 24px; }
.technical-details .details-intro { margin-top: 0; }
[hidden] { display: none !important; }
@media (max-width: 640px) {
  header { padding-top: 34px; }
  section { border-radius: 12px; }
  .before-after { grid-template-columns: 1fr; }
  .visual-flow li:not(:last-child)::after { content: "↓"; right: 50%; top: auto; bottom: -19px; }
}`;

const REVIEW_UI = {
  en: {
    documentTitle: "Hope Review",
    reviewSections: "Review sections",
    nav: {
      summary: "Summary",
      behavior: "How it works",
      focus: "Risks & questions",
      code: "Key code",
      try: "Try it",
      quiz: "Check understanding",
      details: "Details",
    },
    context: {
      pr: "PR",
      author: "Author",
      stage: "Status",
      commits: "Commits",
      files: "Files",
      changedLines: "Changed lines",
      coverage: "Analysis scope",
      partialNotice: "{count} changed file(s) could not be inspected in full. The explanation uses only the available content; see analysis details for the reasons.",
      attentionNotice: "Some review inputs need attention. See analysis details before relying on the explanation.",
    },
    coverage: { complete: "Complete", partial: "Some content excluded", blocked: "Unable to analyze" },
    stage: { draft: "Draft", ready: "Ready for review", historical: "Merged or closed", abandoned: "Closed" },
    state: { open: "Open", closed: "Closed", merged: "Merged" },
    basis: { declared: "Author context", observed: "Confirmed in code", inferred: "Hope interpretation", unknown: "Needs confirmation" },
    evidenceSource: { "pr-description": "PR description", commit: "Commit", code: "Code", test: "Test" },
    fileStatus: { added: "Added", modified: "Modified", deleted: "Deleted", renamed: "Renamed", copied: "Copied", "type-changed": "Type changed" },
    bodyState: {
      included: "Content inspected",
      redacted: "Excluded for security",
      binary: "Binary file",
      "generated-or-lockfile": "Generated or lock file",
      "secret-path": "Sensitive path",
      "invalid-utf8": "Unreadable text",
      "missing-patch": "Change body unavailable",
      submodule: "Submodule",
      symlink: "Symbolic link",
      "size-limit": "Excluded by size limit",
      "metadata-only": "File information only",
    },
    exclusionReason: {
      "commit-title-size-limit": "Commit title exceeded the size limit",
      "suspected-secret-redacted": "Content excluded because it may contain a secret",
      "unsafe-path": "Unsafe path",
      "secret-path": "Sensitive path",
      "generated-or-lockfile": "Generated or lock file",
      "metadata-only": "File information only",
      binary: "Binary file",
      "missing-or-truncated-patch": "Change body missing or truncated",
      submodule: "Submodule",
      "per-file-byte-limit": "File exceeded the size limit",
      "truncated-patch": "Change body was truncated",
      "redaction-line-mismatch": "Content could not be safely redacted",
      "per-line-byte-limit": "A changed line exceeded the size limit",
      "total-patch-byte-limit": "The change exceeded the total size limit",
      "description-byte-limit": "PR description exceeded the size limit",
      "provider-file-enumeration-incomplete": "The provider did not return the complete file list",
      "total-changed-line-limit": "The change exceeded the changed-line limit",
      "file-count-limit": "The change exceeded the file-count limit",
      "summary-byte-limit": "The review summary exceeded the size limit",
    },
    quizCategory: { prediction: "Behavior prediction", flow: "Flow", invariant: "Must-hold condition", risk: "Risk", "safe-change": "Safe change" },
    verificationStatus: { "not-run": "Not run", unknown: "Not confirmed" },
    ssotTarget: { test: "Test", "code-comment": "Code comment", "architecture-doc": "Architecture document", "api-doc": "API document", runbook: "Runbook", "existing-project-ssot": "Existing project document" },
    overview: {
      eyebrow: "Start here",
      heading: "What changed",
      whyHeading: "Why this changed",
      noBackground: "No additional reason was needed to explain this change.",
      observableHeading: "Visible changes",
      beforeAfterHeading: "Before and after",
      before: "Before",
      after: "After",
      why: "Why",
    },
    visual: { eyebrow: "Visual explanation", heading: "Visual model", case: "Case" },
    behavior: {
      eyebrow: "Behavior",
      heading: "How it works",
      help: "Follow the change through its main behavior flows.",
      navigation: "Change flows",
      relatedPaths: "Related changed files",
      connectionsEyebrow: "Connections",
      connectionsHeading: "How the flows affect each other",
      noConnections: "No interaction between change flows was needed for this change.",
      connects: "Connects",
      relatedFlows: "Related change flows",
      none: "None",
    },
    focus: {
      eyebrow: "Review focus",
      heading: "Risks, decisions, and questions",
      invariants: "Must-hold conditions",
      risks: "Risks",
      decisions: "Decisions and trade-offs",
      noDecisions: "No decision was stated strongly enough to preserve here.",
      tradeoff: "Trade-off",
      verification: "Checks",
      questions: "Questions that need an answer",
      noQuestions: "No unresolved questions were identified from the available evidence.",
    },
    code: {
      eyebrow: "Code evidence",
      heading: "Key code changes",
      help: "A focused walkthrough of representative changed files. The full raw patch is not embedded.",
    },
    microworld: {
      eyebrow: "Explore",
      heading: "Try the behavior",
      notice: "This is a limited explanatory model. It does not run project code.",
      noScenario: "No scenario matches this combination.",
      before: "Before the change",
      after: "After the change",
      outcome: "Outcome",
      regionLabel: "Selected scenario",
    },
    quiz: {
      eyebrow: "Check yourself",
      heading: "Check your understanding",
      help: "Use these questions to find gaps in your understanding. The score is not merge approval.",
      submit: "Check answers and show explanations",
      correct: "Correct.",
      review: "Review this answer.",
      pass: "Passed",
      below: "Below the target",
      resultSuffix: "This score helps locate gaps; it does not prove complete understanding.",
      correctCount: "correct",
    },
    projectKnowledge: {
      eyebrow: "Optional follow-up",
      heading: "What may belong in project docs",
      help: "Keep only durable, human-confirmed knowledge in an existing project source of truth. Hope never writes it automatically.",
      owner: "Suggested existing owner",
    },
    details: {
      eyebrow: "Review basis",
      heading: "Analysis details",
      summary: "Show the exact PR version and analysis details",
      help: "This review represents one exact base-to-head PR version. Regenerate it after a new commit or force-push.",
      prTitle: "PR title",
      baseSha: "Base SHA",
      mergeBaseSha: "Merge-base SHA",
      headSha: "Head SHA",
      comparison: "Comparison",
      fileMap: "File map",
      representedFiles: "Files represented",
      inspectedBodies: "File contents inspected",
      explainableLines: "Changed lines inspected",
      processingUnits: "Processing units",
      inspectionPages: "Inspection pages",
      selectedWalkthrough: "Files in key code walkthrough",
      fingerprint: "Fingerprint",
      scopeNotes: "Scope notes",
      scopeStatus: "Collection status",
      changedFileMap: "Changed file map",
      path: "Path",
      previousPath: "Previous path",
      status: "Status",
      lines: "Lines",
      body: "Content",
      processingUnit: "Processing unit",
      relatedFlows: "Related change flows",
      processedUnits: "Analysis processing units",
      processingHelp: "These units only keep large changes inspectable. They are not the behavior flows used in the explanation.",
      unitLines: "changed lines",
      unitBytes: "bytes",
      unitPages: "inspection pages",
      rawWarning: "Collector note",
      warningSummary: "{count} item(s): {reason}",
    },
    evidence: "Evidence",
    footer: "Generated by Hope for this exact PR version. This offline file makes no network requests.",
    noscript: "JavaScript is required to display the review, understanding check, and optional interactive model.",
  },
  ko: {
    documentTitle: "Hope 리뷰",
    reviewSections: "리뷰 섹션",
    nav: {
      summary: "요약",
      behavior: "동작 흐름",
      focus: "위험과 질문",
      code: "핵심 코드",
      try: "동작 실험",
      quiz: "이해 확인",
      details: "세부 정보",
    },
    context: {
      pr: "PR",
      author: "작성자",
      stage: "상태",
      commits: "커밋",
      files: "파일",
      changedLines: "변경 줄",
      coverage: "분석 범위",
      partialNotice: "변경 파일 {count}개의 내용을 전부 확인하지 못했습니다. 설명은 확인 가능한 내용만 사용하며, 이유는 분석 세부 정보에서 볼 수 있습니다.",
      attentionNotice: "일부 리뷰 입력을 확인해야 합니다. 설명을 신뢰하기 전에 분석 세부 정보를 살펴보세요.",
    },
    coverage: { complete: "전체 분석", partial: "일부 제외", blocked: "분석 불가" },
    stage: { draft: "초안", ready: "리뷰 준비됨", historical: "머지 또는 종료됨", abandoned: "종료됨" },
    state: { open: "열림", closed: "닫힘", merged: "머지됨" },
    basis: { declared: "작성자 설명", observed: "코드에서 확인", inferred: "Hope의 해석", unknown: "확인 필요" },
    evidenceSource: { "pr-description": "PR 설명", commit: "커밋", code: "코드", test: "테스트" },
    fileStatus: { added: "추가", modified: "수정", deleted: "삭제", renamed: "이름 변경", copied: "복사", "type-changed": "형식 변경" },
    bodyState: {
      included: "내용 확인",
      redacted: "보안상 제외",
      binary: "바이너리 파일",
      "generated-or-lockfile": "생성/잠금 파일",
      "secret-path": "민감 경로로 제외",
      "invalid-utf8": "텍스트로 읽을 수 없음",
      "missing-patch": "변경 본문 없음",
      submodule: "서브모듈",
      symlink: "심볼릭 링크",
      "size-limit": "크기 제한으로 제외",
      "metadata-only": "파일 정보만 확인",
    },
    exclusionReason: {
      "commit-title-size-limit": "커밋 제목이 크기 제한을 넘음",
      "suspected-secret-redacted": "비밀 정보가 포함됐을 수 있어 내용을 제외함",
      "unsafe-path": "안전하지 않은 경로",
      "secret-path": "민감한 경로",
      "generated-or-lockfile": "생성 파일 또는 잠금 파일",
      "metadata-only": "파일 정보만 확인 가능",
      binary: "바이너리 파일",
      "missing-or-truncated-patch": "변경 본문이 없거나 잘림",
      submodule: "서브모듈",
      "per-file-byte-limit": "파일이 크기 제한을 넘음",
      "truncated-patch": "변경 본문이 잘림",
      "redaction-line-mismatch": "내용을 안전하게 가릴 수 없음",
      "per-line-byte-limit": "변경 줄이 크기 제한을 넘음",
      "total-patch-byte-limit": "전체 변경이 크기 제한을 넘음",
      "description-byte-limit": "PR 설명이 크기 제한을 넘음",
      "provider-file-enumeration-incomplete": "Git 서비스가 전체 파일 목록을 반환하지 않음",
      "total-changed-line-limit": "변경 줄 수가 제한을 넘음",
      "file-count-limit": "파일 수가 제한을 넘음",
      "summary-byte-limit": "리뷰 요약이 크기 제한을 넘음",
    },
    quizCategory: { prediction: "동작 예측", flow: "동작 흐름", invariant: "필수 조건", risk: "위험", "safe-change": "안전한 변경" },
    verificationStatus: { "not-run": "실행 안 함", unknown: "확인되지 않음" },
    ssotTarget: { test: "테스트", "code-comment": "코드 주석", "architecture-doc": "아키텍처 문서", "api-doc": "API 문서", runbook: "운영 문서", "existing-project-ssot": "기존 프로젝트 문서" },
    overview: {
      eyebrow: "먼저 볼 내용",
      heading: "무엇이 바뀌었나",
      whyHeading: "왜 바뀌었나",
      noBackground: "이 변경을 설명하는 데 추가 배경은 필요하지 않습니다.",
      observableHeading: "눈에 보이는 변화",
      beforeAfterHeading: "변경 전과 후",
      before: "변경 전",
      after: "변경 후",
      why: "이유",
    },
    visual: { eyebrow: "시각적 설명", heading: "한눈에 보는 동작", case: "상황" },
    behavior: {
      eyebrow: "동작",
      heading: "어떻게 동작하나",
      help: "주요 동작 흐름을 따라가며 변경을 이해합니다.",
      navigation: "변경 흐름",
      relatedPaths: "관련 변경 파일",
      connectionsEyebrow: "연결 관계",
      connectionsHeading: "각 흐름이 서로 미치는 영향",
      noConnections: "이 변경에서는 흐름 사이의 별도 상호작용이 필요하지 않았습니다.",
      connects: "연결된 흐름",
      relatedFlows: "관련 변경 흐름",
      none: "없음",
    },
    focus: {
      eyebrow: "리뷰할 내용",
      heading: "위험, 결정, 확인할 질문",
      invariants: "반드시 지켜야 할 조건",
      risks: "위험",
      decisions: "결정과 고려한 대안",
      noDecisions: "여기에 남길 만큼 명확한 결정은 확인되지 않았습니다.",
      tradeoff: "감수한 점",
      verification: "확인 결과",
      questions: "확인이 필요한 질문",
      noQuestions: "현재 근거에서는 추가로 확인할 질문이 발견되지 않았습니다.",
    },
    code: {
      eyebrow: "코드 근거",
      heading: "핵심 코드 변경",
      help: "대표적인 변경 파일을 따라가며 핵심을 설명합니다. 전체 원본 diff는 포함하지 않습니다.",
    },
    microworld: {
      eyebrow: "직접 살펴보기",
      heading: "동작 실험",
      notice: "이 기능은 이해를 돕기 위한 제한된 모델이며 프로젝트 코드를 실행하지 않습니다.",
      noScenario: "이 조합에 맞는 시나리오가 없습니다.",
      before: "변경 전",
      after: "변경 후",
      outcome: "결과",
      regionLabel: "선택한 시나리오",
    },
    quiz: {
      eyebrow: "스스로 확인하기",
      heading: "이해도 확인",
      help: "질문을 통해 이해가 부족한 부분을 찾습니다. 점수는 머지 승인을 의미하지 않습니다.",
      submit: "정답과 설명 확인",
      correct: "맞았습니다.",
      review: "이 답을 다시 살펴보세요.",
      pass: "기준 통과",
      below: "기준 미달",
      resultSuffix: "이 점수는 이해가 부족한 지점을 찾는 데만 사용되며 완전한 이해를 증명하지 않습니다.",
      correctCount: "개 정답",
    },
    projectKnowledge: {
      eyebrow: "선택 사항",
      heading: "프로젝트 문서에 남길 내용",
      help: "오래 유지할 가치가 있고 사람이 확인한 지식만 기존 프로젝트 문서에 남깁니다. Hope가 자동으로 작성하지 않습니다.",
      owner: "남길 위치 제안",
    },
    details: {
      eyebrow: "리뷰 기준",
      heading: "분석 세부 정보",
      summary: "분석한 PR 버전과 세부 정보 보기",
      help: "이 리뷰는 분석 당시의 정확한 PR 버전을 나타냅니다. 새 커밋이나 강제 푸시 이후에는 다시 생성하세요.",
      prTitle: "PR 제목",
      baseSha: "Base SHA",
      mergeBaseSha: "Merge-base SHA",
      headSha: "Head SHA",
      comparison: "비교 범위",
      fileMap: "파일 맵",
      representedFiles: "확인된 파일",
      inspectedBodies: "내용을 확인한 파일",
      explainableLines: "내용을 확인한 변경 줄",
      processingUnits: "분석 처리 단위",
      inspectionPages: "검사 페이지",
      selectedWalkthrough: "핵심 코드에서 다룬 파일",
      fingerprint: "분석 식별값",
      scopeNotes: "분석 범위 안내",
      scopeStatus: "수집 상태",
      changedFileMap: "변경 파일 전체 목록",
      path: "경로",
      previousPath: "이전 경로",
      status: "상태",
      lines: "변경 줄",
      body: "내용",
      processingUnit: "처리 단위",
      relatedFlows: "관련 변경 흐름",
      processedUnits: "분석 처리 단위",
      processingHelp: "큰 변경을 빠짐없이 살펴보기 위해 나눈 기술적 단위입니다. 설명에 쓰는 동작 흐름과는 다릅니다.",
      unitLines: "변경 줄",
      unitBytes: "바이트",
      unitPages: "검사 페이지",
      rawWarning: "수집기 안내",
      warningSummary: "{count}개 항목: {reason}",
    },
    evidence: "근거",
    footer: "Hope가 이 PR 버전을 기준으로 생성했습니다. 이 오프라인 파일은 네트워크를 사용하지 않습니다.",
    noscript: "리뷰, 이해도 확인, 선택적 동작 실험을 표시하려면 JavaScript가 필요합니다.",
  },
};

const REVIEW_SCRIPT = String.raw`"use strict";
const UI_COPY = ${JSON.stringify(REVIEW_UI)};
const review = JSON.parse(document.getElementById("review-data").textContent);
const ui = UI_COPY[review.locale];
const evidenceById = new Map(review.evidence.map(function (entry) { return [entry.id, entry]; }));
const plannedPassById = new Map(review.changeRequest.analysisPlan.passes.map(function (pass) { return [pass.id, pass]; }));
const passIdsByPath = new Map();
review.changeRequest.analysisPlan.passes.forEach(function (pass) {
  pass.paths.forEach(function (path) {
    if (!passIdsByPath.has(path)) passIdsByPath.set(path, []);
    passIdsByPath.get(path).push(pass.id);
  });
});
const workstreamById = new Map(review.workstreams.map(function (workstream) { return [workstream.id, workstream]; }));
const workstreamIdsByPath = new Map();
review.workstreams.forEach(function (workstream) {
  workstream.paths.forEach(function (path) {
    if (!workstreamIdsByPath.has(path)) workstreamIdsByPath.set(path, []);
    workstreamIdsByPath.get(path).push(workstream.id);
  });
});

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

function workstreamTarget(id) { return "workstream-card-" + id; }

function internalLink(text, target) {
  const link = element("a", text);
  link.setAttribute("href", "#" + target);
  return link;
}

function appendInlineValues(parent, values, renderValue, emptyText) {
  if (values.length === 0) {
    parent.append(document.createTextNode(emptyText));
    return;
  }
  values.forEach(function (value, index) {
    if (index > 0) parent.append(document.createTextNode(", "));
    parent.append(renderValue(value));
  });
}

function mapped(group, value) {
  return ui[group][value] || value;
}

function format(template, values) {
  return Object.entries(values).reduce(function (text, pair) {
    return text.replaceAll("{" + pair[0] + "}", String(pair[1]));
  }, template);
}

function appendMetadata(target, values) {
  values.forEach(function (pair) {
    const wrapper = element("div");
    wrapper.append(element("dt", pair[0]), element("dd", pair[1]));
    target.append(wrapper);
  });
}

function localizedCollectorWarning(message) {
  const match = /^([0-9]+) item\(s\) require attention: ([a-z0-9-]+)\.$/u.exec(message);
  if (match === null) return ui.details.rawWarning + ": " + message;
  return format(ui.details.warningSummary, {
    count: match[1],
    reason: ui.exclusionReason[match[2]] || match[2],
  });
}

function evidenceLabel(entry) {
  let label = entry.label + " · " + mapped("evidenceSource", entry.source);
  if (entry.path !== null) label += " · " + entry.path;
  if (entry.commitSha !== null) label += " · " + shortSha(entry.commitSha);
  return label;
}

function appendEvidence(parent, evidenceIds) {
  if (evidenceIds.length === 0) return;
  const details = element("details", undefined, "evidence");
  details.append(element("summary", ui.evidence + " (" + String(evidenceIds.length) + ")"));
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

function relatedWorkstreamIds(evidenceIds) {
  const ids = new Set();
  evidenceIds.forEach(function (evidenceId) {
    const path = evidenceById.get(evidenceId).path;
    if (path === null) return;
    (workstreamIdsByPath.get(path) || []).forEach(function (workstreamId) { ids.add(workstreamId); });
  });
  return Array.from(ids);
}

function appendWorkstreamScope(parent, evidenceIds) {
  const ids = relatedWorkstreamIds(evidenceIds);
  if (ids.length === 0) return;
  const scope = element("p", undefined, "inline-links");
  scope.append(element("span", ui.behavior.relatedFlows + ":", "label"));
  appendInlineValues(scope, ids, function (id) {
    return internalLink(workstreamById.get(id).title, workstreamTarget(id));
  }, ui.behavior.none);
  parent.append(scope);
}

function renderClaim(value) {
  const article = element("article", undefined, "claim");
  article.append(element("span", mapped("basis", value.basis), "tag " + value.basis));
  article.append(element("p", value.text));
  appendEvidence(article, value.evidenceIds);
  return article;
}

function renderReviewContext() {
  const change = review.changeRequest;
  document.getElementById("review-title").textContent = change.title;
  document.getElementById("review-lede").textContent = review.overview.summary.text;
  appendEvidence(document.getElementById("review-lede-evidence"), review.overview.summary.evidenceIds);
  document.title = change.title + " · Hope";

  const compactValues = [
    [ui.context.pr, change.repository + " #" + change.id],
    [ui.context.author, change.author],
    [ui.context.stage, mapped("stage", change.reviewStage)],
    [ui.context.commits, String(change.commitCount)],
    [ui.context.files, String(change.coverage.representedFiles)],
    [ui.context.changedLines, String(change.coverage.changedLines)],
    [ui.context.coverage, mapped("coverage", change.coverage.status)],
  ];
  appendMetadata(document.getElementById("review-context"), compactValues);

  const excludedFileCount = change.files.filter(function (file) { return file.bodyState !== "included"; }).length;
  if (change.coverage.status !== "complete" || change.warnings.length > 0 || change.exclusions.length > 0) {
    const warning = document.getElementById("scope-summary-warning");
    warning.hidden = false;
    warning.textContent = excludedFileCount > 0
      ? format(ui.context.partialNotice, { count: excludedFileCount })
      : ui.context.attentionNotice;
  }
}

function renderTechnicalDetails() {
  const change = review.changeRequest;
  const passPageCount = review.analysisCoverage.processedPasses.reduce(function (total, pass) { return total + pass.pageCount; }, 0);
  const values = [
    [ui.context.pr, change.repository + " #" + change.id],
    [ui.details.prTitle, change.title],
    [ui.context.author, change.author],
    [ui.context.stage, mapped("stage", change.reviewStage)],
    [ui.context.commits, String(change.commitCount)],
    [ui.details.baseSha, change.baseSha],
    [ui.details.mergeBaseSha, change.mergeBaseSha],
    [ui.details.headSha, change.headSha],
    [ui.details.comparison, shortSha(change.mergeBaseSha) + " → " + shortSha(change.headSha)],
    [ui.details.scopeStatus, mapped("coverage", change.coverage.status)],
    [ui.details.representedFiles, String(change.coverage.representedFiles) + "/" + String(change.coverage.discoveredFiles)],
    [ui.details.inspectedBodies, String(change.coverage.includedBodies) + "/" + String(change.coverage.representedFiles)],
    [ui.details.explainableLines, String(change.coverage.explainableChangedLines) + "/" + String(change.coverage.changedLines)],
    [ui.details.processingUnits, String(review.analysisCoverage.processedPasses.length) + "/" + String(change.analysisPlan.passes.length)],
    [ui.details.inspectionPages, String(review.analysisCoverage.summary.pageCount) + " + " + String(passPageCount)],
    [ui.details.selectedWalkthrough, String(review.literateDiff.length)],
  ];
  appendMetadata(document.getElementById("details-meta"), values);
  document.getElementById("details-fingerprint").textContent = change.fingerprint;
  if (change.coverage.status !== "complete" || change.warnings.length > 0 || change.exclusions.length > 0) {
    const warning = document.getElementById("scope-details-warning");
    warning.hidden = false;
    const messages = change.exclusions.map(function (entry) {
      const translated = ui.exclusionReason[entry.reason] || entry.reason;
      return entry.path + " — " + translated;
    });
    if (messages.length === 0) messages.push(ui.context.attentionNotice);
    if (change.warnings.length > 0) {
      messages.push.apply(messages, change.warnings.map(localizedCollectorWarning));
    }
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
    const passCell = element("td");
    appendInlineValues(passCell, passIdsByPath.get(file.path) || [], function (passId) { return element("code", passId); }, "—");
    const workstreamCell = element("td");
    appendInlineValues(workstreamCell, workstreamIdsByPath.get(file.path) || [], function (workstreamId) {
      return internalLink(workstreamById.get(workstreamId).title, workstreamTarget(workstreamId));
    }, "—");
    row.append(pathCell, previousCell, element("td", mapped("fileStatus", file.status)), element("td", "+" + String(file.additions) + " / -" + String(file.deletions)), element("td", mapped("bodyState", file.bodyState)), passCell, workstreamCell);
    fileBody.append(row);
  });
  const passContent = document.getElementById("analysis-pass-content");
  review.analysisCoverage.processedPasses.forEach(function (processedPass) {
    const plannedPass = plannedPassById.get(processedPass.id);
    const details = element("details", undefined, "card");
    details.append(element("summary", processedPass.id + " · " + String(plannedPass.changedLines) + " " + ui.details.unitLines + " · " + String(plannedPass.patchBytes) + " " + ui.details.unitBytes + " · " + String(processedPass.pageCount) + " " + ui.details.unitPages));
    details.append(element("p", processedPass.summary));
    const paths = element("ul", undefined, "path-list");
    plannedPass.paths.forEach(function (path) { const item = element("li"); item.append(element("code", path)); paths.append(item); });
    details.append(paths);
    appendEvidence(details, processedPass.evidenceIds);
    passContent.append(details);
  });
}

function renderBackground() {
  const content = document.getElementById("background-content");
  if (review.background.length === 0) content.append(element("p", ui.overview.noBackground, "muted"));
  else review.background.forEach(function (claim) { content.append(renderClaim(claim)); });
}

function renderOverview() {
  const observable = document.getElementById("observable-changes");
  review.overview.observableChanges.forEach(function (claim) { observable.append(renderClaim(claim)); });
  const comparisons = document.getElementById("overview-before-after");
  review.overview.beforeAfter.forEach(function (entry) {
    const article = element("article", undefined, "card");
    article.append(element("span", mapped("basis", entry.basis), "tag " + entry.basis));
    heading(article, 4, entry.area);
    const panels = element("div", undefined, "before-after");
    const before = element("div", undefined, "card"); before.append(element("h5", ui.overview.before), element("p", entry.before));
    const after = element("div", undefined, "card"); after.append(element("h5", ui.overview.after), element("p", entry.after));
    panels.append(before, after);
    article.append(panels, element("p", ui.overview.why + ": " + entry.why, "muted"));
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
        const before = element("div", undefined, "card"); before.append(element("h5", ui.overview.before), element("p", item.before));
        const after = element("div", undefined, "card"); after.append(element("h5", ui.overview.after), element("p", item.after));
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
      const head = element("thead"); const headRow = element("tr"); headRow.append(element("th", ui.visual.case));
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
  const navigation = document.getElementById("workstream-navigation");
  review.workstreams.forEach(function (workstream) {
    navigation.append(internalLink(workstream.title, workstreamTarget(workstream.id)));
    const article = element("article", undefined, "card workstream-card");
    article.id = workstreamTarget(workstream.id);
    heading(article, 3, workstream.title);
    article.append(element("p", workstream.summary));
    const paths = element("details");
    paths.append(element("summary", ui.behavior.relatedPaths + " (" + String(workstream.paths.length) + ")"));
    const pathList = element("ul", undefined, "path-list");
    workstream.paths.forEach(function (path) { const item = element("li"); item.append(element("code", path)); pathList.append(item); });
    paths.append(pathList);
    article.append(paths);
    const list = element("ol", undefined, "flow");
    workstream.steps.forEach(function (step) {
      const item = element("li"); item.append(element("span", mapped("basis", step.basis), "tag " + step.basis), element("strong", step.component + ": "), document.createTextNode(step.behavior)); appendEvidence(item, step.evidenceIds); list.append(item);
    });
    article.append(list); appendEvidence(article, workstream.evidenceIds); content.append(article);
  });
}

function renderSynthesis() {
  const summary = document.getElementById("synthesis-summary");
  summary.append(renderClaim(review.synthesis.summary));
  const interactions = document.getElementById("synthesis-interactions");
  if (review.synthesis.interactions.length === 0) {
    interactions.append(element("p", ui.behavior.noConnections, "muted"));
    return;
  }
  review.synthesis.interactions.forEach(function (interaction) {
    const card = element("article", undefined, "card");
    card.append(element("span", mapped("basis", interaction.basis), "tag " + interaction.basis));
    card.append(element("p", interaction.text));
    const connected = element("p", undefined, "inline-links");
    connected.append(element("span", ui.behavior.connects + ":", "label"));
    appendInlineValues(connected, interaction.workstreamIds, function (workstreamId) {
      return internalLink(workstreamById.get(workstreamId).title, workstreamTarget(workstreamId));
    }, ui.behavior.none);
    card.append(connected);
    appendEvidence(card, interaction.evidenceIds);
    interactions.append(card);
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
  if (review.decisions.length === 0) decisions.append(element("p", ui.focus.noDecisions, "muted"));
  review.decisions.forEach(function (entry) {
    const card = element("article", undefined, "card"); card.append(element("span", mapped("basis", entry.basis), "tag " + entry.basis)); heading(card, 4, entry.decision); card.append(element("p", entry.rationale), element("p", ui.focus.tradeoff + ": " + entry.tradeoff, "muted")); appendEvidence(card, entry.evidenceIds); decisions.append(card);
  });
  const verification = document.getElementById("verification-content");
  review.verification.forEach(function (entry) { const item = element("li"); item.append(element("span", mapped("verificationStatus", entry.status), "tag"), element("code", entry.command), document.createTextNode(" — " + entry.result)); appendEvidence(item, entry.evidenceIds); verification.append(item); });
}

function renderAuthorQuestions() {
  const content = document.getElementById("question-content");
  if (review.authorQuestions.length === 0) { content.append(element("p", ui.focus.noQuestions, "muted")); return; }
  review.authorQuestions.forEach(function (entry) { const card = element("article", undefined, "card"); heading(card, 3, entry.question); card.append(element("p", entry.why)); appendEvidence(card, entry.evidenceIds); content.append(card); });
}

function renderQuiz() {
  const form = document.getElementById("quiz-form");
  const views = [];
  review.quiz.questions.forEach(function (question, index) {
    const fieldset = element("fieldset"); fieldset.append(element("legend", String(index + 1) + ". " + question.prompt), element("span", mapped("quizCategory", question.category), "tag"));
    const inputs = [];
    question.options.forEach(function (option) {
      const label = element("label", undefined, "choice"); const input = element("input"); input.type = question.type === "single" ? "radio" : "checkbox"; input.name = "question-" + question.id; input.value = option.id; input.id = "question-" + question.id + "-" + option.id; label.setAttribute("for", input.id); label.append(input, element("span", option.text)); fieldset.append(label); inputs.push(input);
    });
    const feedback = element("p", undefined, "answer"); feedback.hidden = true; fieldset.append(feedback); appendWorkstreamScope(fieldset, question.evidenceIds); appendEvidence(fieldset, question.evidenceIds); form.append(fieldset); views.push({ question: question, inputs: inputs, feedback: feedback });
  });
  const button = element("button", ui.quiz.submit); button.type = "submit"; form.append(button);
  form.addEventListener("submit", function (event) {
    event.preventDefault(); let correctCount = 0;
    views.forEach(function (view) {
      const selected = new Set(view.inputs.filter(function (input) { return input.checked; }).map(function (input) { return input.value; }));
      const expected = new Set(view.question.correctOptionIds);
      const correct = selected.size === expected.size && Array.from(expected).every(function (optionId) { return selected.has(optionId); });
      if (correct) correctCount += 1; view.feedback.hidden = false; view.feedback.className = "answer " + (correct ? "correct" : "incorrect"); view.feedback.textContent = (correct ? ui.quiz.correct + " " : ui.quiz.review + " ") + view.question.explanation;
    });
    const percent = Math.round((correctCount / views.length) * 100); const passed = percent >= review.quiz.passPercent; const result = document.getElementById("quiz-result"); result.className = "result " + (passed ? "correct" : "incorrect"); result.textContent = String(correctCount) + "/" + String(views.length) + " " + ui.quiz.correctCount + " · " + String(percent) + "% · " + (passed ? ui.quiz.pass : ui.quiz.below) + ". " + ui.quiz.resultSuffix; result.focus();
  });
}

function renderTrace(parent, label, trace) {
  const panel = element("article", undefined, "card trace"); heading(panel, 4, label); const list = element("ol"); trace.steps.forEach(function (step) { const item = element("li"); item.append(element("strong", step.component + ": "), document.createTextNode(step.behavior)); list.append(item); }); panel.append(list, element("p", ui.microworld.outcome + ": " + trace.outcome, "outcome")); parent.append(panel);
}

function renderMicroworld() {
  if (review.microworld === null) { document.getElementById("microworld-nav-link").hidden = true; return; }
  const section = document.getElementById("microworld-section"); section.hidden = false; const world = review.microworld; document.getElementById("microworld-title").textContent = world.title; document.getElementById("microworld-instructions").textContent = world.instructions; appendWorkstreamScope(document.getElementById("microworld-evidence"), world.evidenceIds); appendEvidence(document.getElementById("microworld-evidence"), world.evidenceIds);
  const controls = document.getElementById("microworld-controls"); const selections = new Map();
  function update() {
    const scenario = world.scenarios.find(function (candidate) { return world.controls.every(function (control) { const binding = candidate.when.find(function (entry) { return entry.controlId === control.id; }); return binding && binding.optionId === selections.get(control.id); }); });
    const view = document.getElementById("scenario-view"); view.textContent = ""; if (!scenario) { view.append(element("p", ui.microworld.noScenario, "notice")); return; } heading(view, 3, scenario.title); const comparison = element("div", undefined, "grid two"); renderTrace(comparison, ui.microworld.before, scenario.before); renderTrace(comparison, ui.microworld.after, scenario.after); view.append(comparison, element("p", scenario.lesson, "lesson"));
  }
  world.controls.forEach(function (control) { const wrapper = element("div", undefined, "control"); const label = element("label", control.label); const select = element("select"); select.id = "control-" + control.id; label.setAttribute("for", select.id); control.options.forEach(function (option) { const node = element("option", option.text); node.value = option.id; if (option.id === control.defaultOptionId) node.selected = true; select.append(node); }); selections.set(control.id, control.defaultOptionId); select.addEventListener("change", function () { selections.set(control.id, select.value); update(); }); wrapper.append(label, select); controls.append(wrapper); });
  update();
}

function renderSsotCandidates() {
  if (review.ssotCandidates.length === 0) return;
  const section = document.getElementById("ssot-section"); section.hidden = false; const content = document.getElementById("ssot-content"); review.ssotCandidates.forEach(function (entry) { const card = element("article", undefined, "card"); card.append(element("span", mapped("ssotTarget", entry.target), "tag")); heading(card, 3, entry.insight); card.append(element("p", entry.whyDurable)); if (entry.path !== null) { const path = element("p", ui.projectKnowledge.owner + ": ", "muted"); path.append(element("code", entry.path)); card.append(path); } appendEvidence(card, entry.evidenceIds); content.append(card); });
}

renderReviewContext();
renderBackground();
renderOverview();
renderVisuals();
renderWorkstreams();
renderSynthesis();
renderLiterateDiff();
renderSafety();
renderAuthorQuestions();
renderMicroworld();
renderQuiz();
renderSsotCandidates();
renderTechnicalDetails();`;

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
  const ui = REVIEW_UI[review.locale];
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
<html lang="${review.locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}">
  <title>${ui.documentTitle}</title>
  <style>${REVIEW_STYLE}</style>
</head>
<body>
  <header>
    <p class="eyebrow">Hope · diff</p>
    <h1 id="review-title">${ui.documentTitle}</h1>
    <p id="review-lede" class="lede"></p>
    <div id="review-lede-evidence"></div>
    <dl id="review-context" class="meta compact-meta"></dl>
    <p id="scope-summary-warning" class="notice" role="note" hidden></p>
  </header>
  <nav class="section-nav" aria-label="${ui.reviewSections}">
    <a href="#overview">${ui.nav.summary}</a>
    <a href="#workstreams">${ui.nav.behavior}</a>
    <a href="#review-focus">${ui.nav.focus}</a>
    <a href="#literate-diff">${ui.nav.code}</a>
    <a id="microworld-nav-link" href="#microworld-section">${ui.nav.try}</a>
    <a href="#quiz">${ui.nav.quiz}</a>
    <a href="#details">${ui.nav.details}</a>
  </nav>
  <main>
    <section id="overview" aria-labelledby="overview-heading"><p class="eyebrow">${ui.overview.eyebrow}</p><h2 id="overview-heading">${ui.overview.heading}</h2><h3>${ui.overview.observableHeading}</h3><div id="observable-changes"></div><h3>${ui.overview.whyHeading}</h3><div id="background-content"></div><h3>${ui.overview.beforeAfterHeading}</h3><div id="overview-before-after" class="grid"></div></section>
    <section id="visual-section" aria-labelledby="visual-heading"><p class="eyebrow">${ui.visual.eyebrow}</p><h2 id="visual-heading">${ui.visual.heading}</h2><div id="visual-content" class="grid"></div></section>
    <section id="workstreams" aria-labelledby="workstream-heading"><p class="eyebrow">${ui.behavior.eyebrow}</p><h2 id="workstream-heading">${ui.behavior.heading}</h2><p class="muted">${ui.behavior.help}</p><nav id="workstream-navigation" class="jump-nav" aria-label="${ui.behavior.navigation}"></nav><div id="workstream-content" class="grid"></div></section>
    <section id="synthesis" aria-labelledby="synthesis-heading"><p class="eyebrow">${ui.behavior.connectionsEyebrow}</p><h2 id="synthesis-heading">${ui.behavior.connectionsHeading}</h2><div id="synthesis-summary"></div><div id="synthesis-interactions" class="grid"></div></section>
    <section id="review-focus" aria-labelledby="review-focus-heading"><p class="eyebrow">${ui.focus.eyebrow}</p><h2 id="review-focus-heading">${ui.focus.heading}</h2><div class="grid two"><div><h3>${ui.focus.invariants}</h3><div id="invariant-content"></div></div><div><h3>${ui.focus.risks}</h3><div id="risk-content"></div></div></div><h3>${ui.focus.decisions}</h3><div id="decision-content" class="grid"></div><h3>${ui.focus.verification}</h3><ul id="verification-content"></ul><h3>${ui.focus.questions}</h3><div id="question-content" class="grid"></div></section>
    <section id="literate-diff" aria-labelledby="literate-heading"><p class="eyebrow">${ui.code.eyebrow}</p><h2 id="literate-heading">${ui.code.heading}</h2><p class="muted">${ui.code.help}</p><div id="literate-content" class="grid"></div></section>
    <section id="microworld-section" aria-labelledby="microworld-heading" hidden><p class="eyebrow">${ui.microworld.eyebrow}</p><h2 id="microworld-heading">${ui.microworld.heading}</h2><p class="notice">${ui.microworld.notice}</p><h3 id="microworld-title"></h3><p id="microworld-instructions"></p><div id="microworld-evidence"></div><div id="microworld-controls" class="controls"></div><div id="scenario-view" role="region" aria-live="polite" aria-label="${ui.microworld.regionLabel}"></div></section>
    <section id="quiz" aria-labelledby="quiz-heading"><p class="eyebrow">${ui.quiz.eyebrow}</p><h2 id="quiz-heading">${ui.quiz.heading}</h2><p class="muted">${ui.quiz.help}</p><form id="quiz-form"></form><p id="quiz-result" class="result" role="status" aria-live="polite" tabindex="-1"></p></section>
    <section id="ssot-section" aria-labelledby="ssot-heading" hidden><p class="eyebrow">${ui.projectKnowledge.eyebrow}</p><h2 id="ssot-heading">${ui.projectKnowledge.heading}</h2><p class="muted">${ui.projectKnowledge.help}</p><div id="ssot-content" class="grid"></div></section>
    <section id="details" aria-labelledby="details-heading"><p class="eyebrow">${ui.details.eyebrow}</p><h2 id="details-heading">${ui.details.heading}</h2><details class="technical-details"><summary>${ui.details.summary}</summary><p class="muted details-intro">${ui.details.help}</p><dl id="details-meta" class="meta"></dl><p class="muted">${ui.details.fingerprint}: <code id="details-fingerprint"></code></p><div id="scope-details-warning" class="notice" role="note" hidden></div><details><summary>${ui.details.changedFileMap}</summary><div class="table-wrap"><table class="file-map"><thead><tr><th>${ui.details.path}</th><th>${ui.details.previousPath}</th><th>${ui.details.status}</th><th>${ui.details.lines}</th><th>${ui.details.body}</th><th>${ui.details.processingUnit}</th><th>${ui.details.relatedFlows}</th></tr></thead><tbody id="file-map-body"></tbody></table></div></details><h3>${ui.details.processedUnits}</h3><p class="muted">${ui.details.processingHelp}</p><div id="analysis-pass-content" class="grid"></div></details></section>
  </main>
  <footer>${ui.footer}</footer>
  <noscript>${ui.noscript}</noscript>
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
