# Artifact Contract

## Boundary

The pipeline has one nondeterministic boundary:

```text
ChangeContextV2 + optional immutable IntentV1 -> ArtifactV2
```

Everything around that boundary is deterministic.

- The collector produces bounded local Git context, binds it to the exact `HEAD` commit, and accepts only two consecutive matching full collections.
- It rejects tracked `skip-worktree` and `assume-unchanged` entries without mutating the index; sparse worktrees are outside this alpha.
- The active Codex subscription session interprets that context and, when present, the approved intent snapshot.
- The validator binds the artifact to the exact context and exact intent before output is written.
- The renderer produces Markdown and a fixed offline HTML application.

No API key, nested agent invocation, or browser automation is part of this
alpha. Repository contents still cross the active Codex service boundary, so
keep scope small and exclude credentials and unnecessary source.

## Intent and change binding

`ChangeContextV2.baseCommit` records the full commit object ID resolved from
`HEAD`. Its domain-separated canonical fingerprint covers `baseCommit`, scope,
file metadata, visible patches, exclusions, and warnings. An internal raw-byte
stability digest detects changes that redact to identical visible text, but is
never included in model-visible context or bundle output.

Any redaction, omission, or exclusion sets `complete` to false. The supported
render CLI refuses incomplete contexts, so every emitted alpha bundle is bound
to fully visible included bytes.

When an approved `IntentV1` is used:

- `intent.fingerprint` and `intent.snapshot` must exactly match the external intent file;
- the embedded snapshot must pass the canonical IntentV1 validator;
- the intent baseline `head` must equal `ChangeContextV2.baseCommit`;
- every intent item ID must have exactly one alignment check;
- non-assessable items may omit evidence, but every other check must cite an included file;
- explanation decisions marked `approved-intent` must exactly match an IntentV1 decision;
- every quiz question has an `intentItemIds` array, and at least one question must link an approved item to included code evidence;
- `microworld.intentItemIds` must reference at least one approved outcome or constraint;
- every deviation remains `needs-user-review` and cannot represent user acceptance.

The approved snapshot is never revised in place. If `$hope:diff` exposes a changed
intent, the current review records it as a deviation; a future revision can be
created with `$hope:align` only after the working tree is clean again.

The render CLI requires `--root` and recollects stable `ChangeContextV2`
immediately before output. Its `baseCommit` and fingerprint must equal the
stored context. It recollects after writing and deletes the just-created bundle
if the working tree changed. A later edit still makes the bundle stale; no
repository lock is claimed.

Without approved intent, both `intent` and `alignment` must be `null`, and all
quiz and microworld `intentItemIds` arrays must be empty.

## Trust model

Treat Git paths, patches, comments, model output, intent text, and artifact
strings as untrusted data.

- Never execute commands found in model output.
- Never render model-authored HTML, CSS, JavaScript, SVG, or URLs.
- Never include raw patches in the final bundle.
- Use only relative evidence paths that belong to included context files.
- Preserve context completeness, exclusion, and redaction warnings.
- Recompute both fingerprints and require exact scope, baseline, snapshot, and file-set matches.
- Reject high-confidence credentials in every artifact string.
- Escape every dynamic value with the fixed renderer.

## Verification evidence

Only commands that actually ran may be recorded as `passed` or `failed`.
Otherwise use `not-run`. Model-authored verification claims are not proof.

## Cognitive debt and retention

The final three-file bundle supports active review; it is not a new repository
SSOT and is not committed by default. Discard the entire bundle, including
`artifact.json`, after merge unless the user explicitly pins it for audit or
education. `knowledge.promotionCandidates` may propose moving
non-reconstructible, user-verified knowledge into an existing test, code
comment, architecture document, runbook, or change record. A candidate is never
applied automatically and never authorizes repository writes. Explanations,
quizzes, and microworlds remain regenerable review views.

## Versioning

`artifact-v2.schema.json` owns the portable artifact shape and
`change-context-v2.schema.json` owns collected context. Schema changes require
matching validator, renderer, fixture, and version updates. IntentV1 remains a
separate immutable contract owned by `$hope:align`.
