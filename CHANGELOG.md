# Changelog

## 0.3.0-alpha - 2026-07-18

Hope narrows its alpha to one job: helping a person understand a GitHub pull
request before approval or merge.

- Make `$hope:diff <GitHub PR URL>` the only public skill and defer pre-change
  intent alignment until pull-request reviews reveal which context is repeatedly
  missing.
- Replace the local `HEAD -> working tree` boundary with a provider-independent
  Change Request contract and a first GitHub pull-request adapter.
- Analyze the pull request's merge-base-to-head change as one review across any
  number of commits, for both the viewer's and another author's pull requests.
- Bind every review to the captured base, merge-base, head, metadata, file set,
  and canonical change fingerprint, and reject a snapshot that changes during
  generation.
- Replace the `artifact.json`, `explanation.md`, and `index.html` bundle with one
  private, self-contained `hope-review.html`.
- Add safe fixed-renderer visualizations, a literate diff, author questions,
  three to five auto-scored questions, and an optional declarative microworld.
- Keep internal Change Request context and Review Model files transient, refuse
  to persist blocked collections, and provide path-restricted failure cleanup.
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
