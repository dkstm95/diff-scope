# Changelog

## 0.4.0-alpha - Unreleased

- Make the repository root the Hope package so the independent harness,
  shared features, product documents, and Codex skill ship together.
- Add an independent `hope` harness entry and keep the Codex skill as a thin
  adapter to the same diff boundary.
- Let Claude Code load the same plugin package and `diff` skill through its own
  manifest and marketplace catalog. Codex and Claude Code do not carry separate
  skill or feature implementations.
- Move the Hope diff product definition to `docs/diff.md` as the shared source
  of truth for both entry paths.
- Remove the retired Change Request, Review Model, renderer, HTML design,
  DiffRun, and their tests instead of carrying them into the new diff.
- Remove the current cleanup implementation because it only managed retired
  diff runs and review files. Rebuild cleanup after the new artifact lifecycle
  defines exact ownership.
- Mark diff as rebuilding and fail clearly without creating a replacement
  artifact through an improvised path.

## 0.3.2-alpha - 2026-07-19

- Make the review scope explicit: Hope uses changed code hunks, the PR
  description, and commit titles, but not code outside those hunks,
  pull-request discussion, review comments, or CI.
- Use the localized review title, link the original pull request, centralize
  evidence excerpts, reduce small-review repetition, and improve narrow-screen
  navigation, interactive-model disclosure, and quiz accessibility.
- Avoid treating TypeScript `CancellationToken` annotations as credentials,
  while retaining high-confidence secret detection and full-body exclusion.
- Double bounded inspection pages to 16 KiB, make `--validate-only` offline,
  and preserve private inputs only when a transient GitHub failure needs a
  retry.
- Stop invalidating a review solely because GitHub's volatile `updated_at`
  value changed while all consumed pull-request fields stayed the same.

## 0.3.1-alpha - 2026-07-19

- Give every default private Hope Review an immutable, strict ISO
  `eligibleAfter` marker fixed seven days after creation and report the same
  value in the renderer handoff; later filesystem timestamp changes do not move
  it.
- Before a later default render, remove only eligible Hope-managed temporary
  review directories whose location, name, marker, ownership, permissions,
  sole-file structure, link count, and non-symlink checks all match, and scan a
  POSIX temporary root only when it is private or safely sticky-shared.
- Keep cleanup best-effort and concurrency-safe without adding a cache,
  registry, database, background process, or project artifact.
- Exclude explicit exports from retention management; their paths and lifetime
  remain entirely user-controlled.

## 0.3.0-alpha - 2026-07-18

Hope narrows its alpha to one job: helping a person understand a GitHub pull
request before approval or merge.

- Make `$hope:diff <GitHub PR URL>` the only public skill and defer pre-change
  intent alignment until pull-request reviews reveal which context is repeatedly
  missing.
- Replace the local `HEAD -> working tree` boundary with a provider-independent
  Change Request contract and a first GitHub pull-request adapter.
- Analyze a supported pull request's merge-base-to-head change as one review
  across its collected commits, for both the viewer's and another author's pull
  requests.
- Replace the single global analysis window with one complete file map and a
  deterministic plan of passes bounded to 4,000 changed lines and 64 KiB each,
  so exceeding one pass no longer truncates or blocks an otherwise supported
  large pull request.
- Add an honest active-subscription, model-visible preflight budget: up to 250
  commits and 200 files only within a 128 KiB normalized summary, 20,000 changed
  lines, 256 KiB of safe patch text per file, 768 KiB overall, and a 32 KiB pull
  request description. Overages fail before paging begins.
- Add a read-only inspector that presents the whole-change summary first and
  then every planned pass through snapshot-bound stdout pages of at most 8 KiB,
  while keeping all inspection state transient.
- Require Review Model `analysisCoverage` to record the active session's summary
  and pass page-count/terminal-receipt attestation, bind it to each exact
  deterministic view without claiming proof of AI reading or cognition, then
  synthesize semantic workstreams and their cross-workstream effects.
- Bind every review to the captured base, merge-base, head, metadata, file set,
  and canonical change fingerprint, and reject a snapshot that changes during
  generation.
- Replace the `artifact.json`, `explanation.md`, and `index.html` bundle with one
  private, self-contained `hope-review.html`.
- Add safe fixed-renderer visualizations, a literate diff, author questions,
  one global set of three to five auto-scored questions, and at most one
  optional declarative microworld for the whole change.
- Lead the review with the PR title, explanation, and compact trust context;
  place the interactive model before the understanding check; and move exact
  snapshot metadata, the file map, and processing details into a collapsed
  final section.
- Localize every fixed label, status, feedback message, and accessibility
  description from an explicit `en` or `ko` Review Model locale, while mapping
  internal terms to plain user-facing language.
- Keep internal Change Request context and Review Model files transient, validate
  without deleting them so correctable model errors can be retried, render once
  with cleanup after validation, refuse to persist blocked collections, and
  provide path-restricted abandonment cleanup.
- Omit an entire file patch from passes and evidence when its body triggers
  secret detection, retaining only `bodyState: redacted` metadata and visible
  partial coverage; only `included` bodies can back code/test evidence or the
  literate diff.
- Keep raw secret metadata out of snapshot hashes while binding GitHub's
  `updated_at` version, so real metadata edits stale a review without turning
  the fingerprint into a credential oracle.
- Bind declared excerpts to the collected PR description or commit subject,
  bind literate-diff evidence to the same changed file, and forbid unverified
  pass/fail claims while this alpha has no checkout or CI adapter.
- Require only an active Codex subscription, Node.js 20, and authenticated
  GitHub CLI access; no local repository, Git, OpenAI API key, cache, or database
  is required.
- Never post the generated review, merge the pull request, or apply a durable
  knowledge candidate automatically.

## 0.2.0-alpha - 2026-07-17

DiffScope becomes Hope and expands from post-change explanation to a connected
before-and-after workflow.

- Add `$hope:align` to establish an explicitly approved, immutable intent revision
  from a clean working tree before coding.
- Let `$hope:diff` compare an optional approved intent with the exact
  `HEAD -> working tree` snapshot while retaining a code-only fallback.
- Require quiz and microworld intent references so the teaching surfaces cannot
  silently ignore a bound `$hope:align` checkpoint.
- Bind ArtifactV2 to both the supplied intent revision and the collected change
  fingerprint so later edits cannot silently reuse a stale review.
- Distinguish fulfilled intent, deviations, and unresolved mismatches in the
  explanation, quiz, and offline interactive microworld.
- Keep generated learning bundles private and temporary by default; propose only
  human-reviewed candidates for promotion into an existing project source of
  truth.
- Refuse unresolved indexes and incomplete or invalid-text change contexts, and
  strengthen credential redaction before code reaches the active session.
- Use an English fixed bundle interface while keeping generated teaching content
  in the user's working language.
- Rename the plugin, marketplace, package, and repository metadata to Hope.

## 0.1.0-alpha - 2026-07-17

Released under the DiffScope name.

First public dogfooding release.

- Collect bounded `HEAD -> working tree` changes, including safe untracked text.
- Generate an evidence-based explanation through the active Codex subscription session.
- Render an auto-scored understanding quiz and offline interactive microworld.
- Bind generated artifacts to the exact collected context before rendering.
- Reject unsafe paths, suspected secrets, executable model-authored content, and incomplete structures.
