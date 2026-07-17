# Changelog

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
