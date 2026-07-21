# Contributing

Hope is a plugin today and a harness that grows from real work. Keep both paths
on one implementation.

Read [PRINCIPLES.md](PRINCIPLES.md) before making a project-wide design
decision.

## Design rules

- Use plain names and short sentences.
- Name code after the feature or data it represents.
- Do not add a generic `Runner`, `Manager`, or base class without two real uses.
- Keep host adapters and skill scripts thin.
- Keep feature logic under `runtime/<feature>`.
- Share a rule only after another feature needs it.
- Store private state with a schema version, revision, and atomic write.
- Never let cleanup or bookkeeping hide a result that was already created.

See [docs/architecture.md](docs/architecture.md) before changing the main
folders.

## Add a feature

Start with one user goal. Give it a small command surface and test it without an
AI session. Add a skill only when an AI needs instructions to use those
commands.

A feature that creates files, worktrees, or branches must record exactly what it
created. Cleanup must use that record. It must never guess ownership from a
path, name, or prefix.

Destructive work needs:

1. a non-destructive preview;
2. clear user confirmation;
3. an exact plan or record;
4. a final identity check;
5. a result for every removed or skipped item.

## Keep diff honest

The diff flow reads one complete Change Request at an exact base, merge-base,
and head. It must never mix pull request versions or present a silent prefix as
the full change.

The deterministic `analysisPlan` uses passes of at most 4,000 changed lines and
64 KiB of safe patch text. Inspector responses are at most 16 KiB. The full
model-visible limit is 250 commits, 200 files, 20,000 changed lines, 768 KiB of
safe patch text, and a 128 KiB normalized summary.

The summary receipt chain and every pass receipt chain must finish. The review
model records their page counts and terminal receipts in `analysisCoverage`.
These values bind the model to the exact pages. They do not prove that an AI
understood them.

GitHub collection stays read-only. The authenticated `gh` command owns tokens.
Hope must not read, store, print, or accept a token argument.

## Keep output safe

The fixed renderer validates every model field. It does not run model-authored
HTML, CSS, JavaScript, SVG, URLs, or shell commands.

Default reviews are private and managed by Hope. Explicit exports are owned by
the user and must never become cleanup targets. Hope never overwrites an
existing export.

## Test

Use Node.js 20 or newer. No dependency install is needed.

```bash
npm run check
```

Tests must be offline and deterministic. Use fake GitHub responses. Cover the
normal flow, stale snapshots, limits, unsafe input, interruption, retry,
cleanup preview, changed cleanup targets, and idempotent apply.

Before opening a pull request, state:

- the user goal;
- the visible before and after behavior;
- the main safety rule;
- the commands that passed;
- any work intentionally left for a later change.
