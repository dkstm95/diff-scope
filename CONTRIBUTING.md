# Contributing

Hope is intentionally small. Keep changes inside the alpha promise: one complete
Change Request captured at an exact base, merge-base, and head; one deterministic
plan of bounded analysis passes; one active subscription-session generator; and
one safe, self-contained HTML review.

The public workflow accepts a GitHub pull request URL. Provider-specific
collection belongs in an adapter; validation and rendering belong to the common
Change Request and Review Model contracts. The GitHub adapter must use the
user's existing `gh` authentication without reading or storing tokens directly.

Preserve exact snapshot binding. Never combine metadata or patches from
different pull request revisions, silently substitute a merge commit, or present
an arbitrary size-truncated subset as a complete review. The collector must
represent the complete provider-reported file map. Its `analysisPlan` must assign
every inspectable safe patch segment to an ordered pass of at most 4,000 changed
lines and 64 KiB. Needing several passes is neither partial nor blocked.
Authorship affects labels only: the viewer's and another author's pull requests
use the same pipeline.

Keep the model-visible budget honest and explicit: at most 250 commits and 200
changed files only when the normalized summary is at most 128 KiB, 20,000 total
changed lines, 256 KiB of safe patch text per file, 768 KiB of safe patch text
overall, and 32 KiB of pull request description. Check all of these limits
before paging begins. They bound what one active subscription session can
inspect, not merely what the adapter can store or transport.

## Development

Use Node.js 20 or newer. No dependency installation is required.

```bash
npm run check
```

Tests must remain deterministic and offline. Use fake GitHub adapter responses;
do not add API keys, live network fixtures, model calls, model-authored
executable HTML, or target-project runtime dependencies. Exercise force-push and
metadata staleness, deterministic pass boundaries, boundary-sized and
deletion-heavy changes, complete `analysisCoverage`, total safety caps, partial
body coverage, secret redaction across pass boundaries, hostile PR content, and
safe output handling explicitly. Cover the 128 KiB normalized-summary preflight,
the complete model-visible budget, and validation retries that preserve private
inputs.

Use the inspector contract in order: follow the summary receipt chain to its
terminal page, then do the same for every planned pass. Each invocation must
remain within the 16 KiB stdout ceiling; never aggregate page commands into one
tool output. The Review Model must bind the summary and every planned pass's
page count and terminal receipt in `analysisCoverage` before semantic synthesis.
Those fields are the active session's inspection attestation, bound by the
validator to the exact deterministic views; do not describe them as proof that
the AI read or understood the pages. Passes and stdout pages are technical
context units; create causal workstreams and cross-workstream conclusions only
after all passes are covered. Produce at most one interactive model and then one
global understanding check for the whole review.

The only user-facing file is `hope-review.html`. Collected Change Request
context, inspector output, active-session notes, and the validated Review Model
are transient. Run non-destructive `--validate-only` first; correct the Review
Model and retry validation without discarding the private inputs. Render once
with `--cleanup` only after validation succeeds, or use cleanup-only when the
workflow is abandoned. Do not create per-pass reports. Incomplete provider
data, model-visible budget overages, missing ordinary patches or planned passes,
and stale snapshots must fail closed. Blocked collections must not be written.
Do not add a cache, database, registry, default `.hope/` archive, automatic
pull-request post, or automatic knowledge promotion.

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
