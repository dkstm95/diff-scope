# Contributing

Hope is intentionally small. Keep changes inside the alpha promise: one bounded
Change Request captured at an exact base, merge-base, and head; one active
subscription-session generator; and one safe, self-contained HTML review.

The public workflow accepts a GitHub pull request URL. Provider-specific
collection belongs in an adapter; validation and rendering belong to the common
Change Request and Review Model contracts. The GitHub adapter must use the
user's existing `gh` authentication without reading or storing tokens directly.

Preserve exact snapshot binding. Never combine metadata or patches from
different pull request revisions, silently substitute a merge commit, or present
an arbitrary size-truncated subset as a complete review. Authorship affects
labels only: the viewer's and another author's pull requests use the same
pipeline.

## Development

Use Node.js 20 or newer. No dependency installation is required.

```bash
npm run check
```

Tests must remain deterministic and offline. Use fake GitHub adapter responses;
do not add API keys, live network fixtures, model calls, model-authored
executable HTML, or target-project runtime dependencies. Exercise force-push and
metadata staleness, size limits, partial coverage, secret redaction, hostile PR
content, and safe output handling explicitly.

The only user-facing file is `hope-review.html`. Collected Change Request context
and the validated Review Model are transient and must be removed on normal
success and handled failure. Blocked collections must not be written. Do not add
a cache, database, registry, default `.hope/` archive, automatic pull-request
post, or automatic knowledge promotion.

Generated reviews are private temporary learning tools, not repository records.
Durable knowledge belongs in the target project's existing tests, code comments,
architecture documentation, runbooks, or pull request after human review.

Before opening a pull request, describe:

- the goal and why the change is needed;
- observable before-to-after behavior;
- important decisions and tradeoffs;
- the relevant invariant, risk, and unknowns;
- commands that actually ran;
- a durable knowledge candidate and existing SSOT target, or `none`.
