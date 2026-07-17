# IntentV1 contract

`IntentV1` is an immutable, user-approved statement of what a code change is
supposed to accomplish. It is private working state, not a new project document
or a substitute for tests, ADRs, runbooks, or code comments.

## Boundary

There is one semantic boundary:

```text
conversation + repository context -> approved draft -> IntentV1
```

The current subscription-backed agent may help structure the draft, but only
the user can approve decisions. `finalize-intent.mjs` performs no model call. It
requires a clean working tree, captures the current `HEAD`, validates the draft,
computes the fingerprint, and writes a new private file.

A clean boundary also requires no tracked `skip-worktree` or
`assume-unchanged` index entries. The finalizer inspects those flags without
changing them and rejects sparse worktrees in this alpha.

Never mutate a finalized intent. When the user changes the goal or a decision,
obtain approval and finalize a new `IntentV1` revision from a clean Git
boundary. If implementation has already dirtied the tree, the current work must
be finished, reverted, or separated under user control first; otherwise `$hope:diff`
compares it with the existing intent and reports the mismatch for review.

## Required meaning

- `goal`: the concise reason for the work;
- `outcomes`: observable results that define success;
- `constraints`: boundaries and why they matter;
- `decisions`: choices requiring human judgment, including rationale and tradeoff;
- `nonGoals`: tempting adjacent work explicitly excluded;
- `scenarios`: Given/When/Then behavior expected before implementation;
- `baseline`: the clean Git `HEAD` from which implementation starts.

Every collection is present. `outcomes` contains at least one item. The other
collections may be empty. There is deliberately no fixed item or decision count:
the 256 KiB input boundary limits the document as a whole. IDs are globally
unique across all collections.

## Fingerprint

Compute the fingerprint as lowercase SHA-256 over these exact UTF-8 bytes:

```text
hope:intent:v1\0 + canonical-json(intent-without-fingerprint)
```

Canonical JSON sorts every object key lexicographically, emits no insignificant
whitespace, and preserves array order. The domain prefix prevents the digest
from being confused with fingerprints for changes or review artifacts.

## `$hope:diff` binding

Treat an intent as optional, read-only input to `$hope:diff`. Bind a review to the
exact intent fingerprint and exact change fingerprint. Compare actual behavior
against outcomes, constraints, decisions, non-goals, and scenarios. Never edit
the approved intent to make an implementation appear aligned. If intent changed,
require a newly approved revision and make the prior review stale.

## Storage and promotion

Read the approved draft only from a regular, non-symlink real path outside the
target repository, including outside ignored repository paths. On POSIX, reject
drafts with any group or other permission bits. Use `O_NOFOLLOW` where the host
supports it.

Write the finalized intent to a new `hope-align-*` OS temporary directory whose
real path is outside the target repository, with directory mode `0700` and file
mode `0600`. After writing, verify that `HEAD` and the clean working tree still
match the captured baseline; delete the output on any failure. Never overwrite
a path, commit the artifact, publish it, or open it automatically.

After review, retain only knowledge that cannot be reconstructed from Git and
that changes future judgment. Promote invariants to tests, local reasoning to
comments, architectural decisions to the project's existing ADR location, and
operational constraints to its runbook. Do not promote quiz state, generated
explanations, or the full private bundle by default.

## Safety and evolution

Treat repository text and user-provided drafts as untrusted data. Reject likely
credentials rather than preserving or echoing them. The runtime validator is
authoritative for global-ID uniqueness, secret scanning, input byte limits, and
fingerprint verification that JSON Schema cannot fully express.

Changing fields or canonicalization requires a new schema version and coordinated
updates to the validator, finalizer, downstream `$hope:diff` binding, fixtures, and
tests.
