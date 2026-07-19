<p align="center">
  <img src="plugins/hope/assets/telescope.svg" width="128" alt="Hope telescope icon">
</p>

<h1 align="center">Hope</h1>

<p align="center"><strong>See the change. Understand the why. Keep the human in the code.</strong></p>

<p align="center"><a href="README.ko.md">한국어</a></p>

Hope helps people understand a small or large pull request before they approve
or merge it. Give `$hope:diff` a GitHub pull request URL and it turns the exact
whole change into one private offline review: what changed and why, how the
behavior fits together, key code and risks, an optional interactive model, and
an auto-scored understanding check.

Hope runs inside your active Codex subscription session. It needs no OpenAI API
key, model configuration, server, nested model call, cache, or database.

> **Alpha:** `v0.3.1-alpha` focuses on GitHub pull requests. Interfaces and
> schemas may change as this workflow is dogfooded.

## Install

Requirements:

- Node.js 20 or newer;
- [GitHub CLI](https://cli.github.com/) authenticated with access to the pull
  request (`gh auth login`);
- Codex signed in with a ChatGPT subscription.

Install Hope from its tagged marketplace:

```bash
codex plugin marketplace add dkstm95/hope --ref v0.3.1-alpha
codex plugin add hope@hope
```

If an earlier Hope or DiffScope alpha is installed, remove its plugin and
marketplace first, then run the commands above:

```bash
codex plugin remove hope@hope
codex plugin marketplace remove hope
codex plugin remove diff-scope@diff-scope
codex plugin marketplace remove diff-scope
```

Start a new Codex task after installation so `$hope:diff` is loaded.

## Use

### 1. Give Hope the pull request URL

```text
$hope:diff https://github.com/owner/repository/pull/123
```

Hope resolves the GitHub pull request through your existing `gh`
authentication and collects the pull request comparison from its merge base to
its head. No local clone or checkout is required. A pull request with many
commits is still one change request and one review.

The same flow works for your own pull request and another author's pull request.
Open, draft, merged, and closed pull requests retain their real lifecycle state
in the review; ready-to-review open pull requests are the primary alpha case.

Hope records the base, merge-base, and head SHAs. Before rendering, it
recollects and compares the complete Change Request; after rendering, it
rechecks the live pull request metadata. A force-push, base update, relevant
metadata change, or context mismatch cancels the result instead of presenting a
mixed snapshot.

### 2. Let Hope inspect the whole change progressively

Hope captures one complete Change Request and file map, then creates a
deterministic `analysisPlan`. It first reads the whole-change summary and then
inspects every pass in order. Each pass contains at most 4,000 changed lines and
64 KiB of safe patch text, so a large pull request uses several bounded passes
instead of one oversized prompt or an arbitrary truncated prefix.

Summary and pass views are delivered as compact pages of at most 8 KiB. Each
next page requires the preceding snapshot-bound receipt, and the Review Model
records the page count and terminal receipt as the active session's inspection
attestation before rendering. The validator binds that attestation to the exact
deterministic view; it does not claim to prove that an AI read or understood the
pages. Paging keeps supported file maps, commit history, and patches from being
silently clipped by an AI tool's command-output limit.

Passes and their stdout pages are internal context units, not user artifacts or
sections in the review. After inspecting all of them, Hope connects evidence
across pass boundaries and organizes the change into behavior flows and their
interactions. It adds one interactive model only when useful, followed by one
understanding check. Users do not choose, name, save, or clean up passes.

Exceeding one pass's limits alone does not make coverage partial and does not
block a review; Hope adds another bounded pass. It still fails closed when
provider data is incomplete, a total safety cap is exceeded, an ordinary text
patch or planned pass is missing, or the pull request snapshot becomes stale.
The model-visible budget is checked before paging begins, so an unsupported
change fails explicitly instead of starting a review the active subscription
session cannot honestly finish.

### 3. Explore the Hope Review

Hope returns one private, self-contained file:

```text
hope-review.html
```

Open it locally in a browser. It needs no network connection and contains:

- the pull request title, a concise summary, and a compact analysis-scope notice;
- what changed, why it changed, and before/after behavior;
- visual before/after panels, flows, or decision tables when they clarify the
  change;
- behavior flows and how they affect each other;
- risks, must-hold conditions, decisions, verification limits, and questions;
- a focused walkthrough that connects key code evidence to the explanation;
- an interactive behavior model when exploration helps, followed by three to
  five auto-scored understanding questions;
- optional candidates for durable project knowledge; and
- collapsed technical details with the exact PR version, full file map, and
  analysis coverage.

The interactive model is intentionally optional. A change that is better
explained by a diagram and questions does not receive a decorative simulator.

The fixed interface, explanation, feedback, and teaching content use the
selected English or Korean review language. Pull-request titles, paths,
commands, and evidence excerpts stay in their original form.

## One review, no artifact management

Hope uses one complete structured Change Request, bounded inspector passes, and
a validated review model internally, but all of that state is transient. It
validates the private Review Model without deleting it, corrects and retries any
validation error, then removes private inputs after the final render or an
explicit abandonment cleanup. It does not expose per-pass reports,
`intent.json`, `artifact.json`, or a separate Markdown explanation.

By default, the HTML lives in a private OS temporary directory. Hope does not:

- create a `.hope/` directory or edit `.gitignore`;
- keep a cache, registry, database, or searchable review index;
- commit or attach the review to the pull request;
- post comments, approve, close, or merge the pull request;
- write knowledge candidates into the target repository.

Before creating a default temporary review, Hope safely removes its own default
reviews that have been eligible for cleanup for at least seven days. The render
handoff includes the exact `eligibleAfter` time embedded in the review's first
line when it is created. Touching the file does not move that authoritative
time. Cleanup happens only on a later default render, so a review is not deleted
by a background process at that instant. Anything with an unexpected name,
marker, structure, or symbolic link is preserved. Hope also requires the
expected owner and private permissions on platforms that expose those checks.
On POSIX, it scans only a current-user-private or safely sticky-shared temporary
root.

The user may explicitly request an exported HTML file. Hope still refuses to
overwrite an existing path or publish it automatically. Exports do not carry
the managed-temporary marker and can never qualify for deletion. A matching OS
temporary path may be inspected and rejected, but exports remain unmanaged and
under the user's control.

The review is bound to the captured pull request snapshot, not kept current in
the background. If the head or base changes, run `$hope:diff` again. A default
temporary review creates no project cleanup work: close it when finished, and
Hope can remove it on the first later default render after `eligibleAfter`.
The operating system may reclaim it earlier or later. If you explicitly export
a copy, you alone control its retention. A person or an AI may perform the
merge; Hope is not part of that operation.

## Reduce cognitive debt without creating document debt

Keeping every generated explanation after merge creates another body of
material that can drift from the code. Hope therefore separates a disposable
learning view from durable project knowledge.

The pull request preserves the historical reason for a change. Current system
truth remains in code, tests, types, and the project's existing source-of-truth
documentation. A Hope Review may suggest knowledge worth promoting, but it never
applies that suggestion. Promote an item only when it is difficult to
reconstruct, likely to affect a future decision, still true after merge, and
confirmed by a human:

- behavior contracts and edge cases belong in tests, types, assertions, or
  fixtures;
- local, non-obvious rationale belongs next to the code;
- architectural decisions belong in the project's ADR or design documentation;
- operational constraints belong in its runbook;
- small change rationale belongs in the pull request.

The principle is: **preserve durable intent, regenerate explanations, require
understanding.**

## Alpha scope

Hope models the input as a provider-independent **Change Request**. The first
adapter supports GitHub pull requests through the authenticated GitHub CLI. Git,
a local repository, and an OpenAI API key are not required. Other forges, OpenAI
API generation, CI batch generation, and automatic PR publication are outside
this alpha.

The collector bounds total external work, bytes, and time, while the inspector
bounds each analysis pass to 4,000 changed lines and 64 KiB of safe patch text.
Binary, generated, lockfile, submodule, rename-only, and sensitive-path bodies
may appear as clearly labeled metadata-only coverage. If secret detection
triggers anywhere in a file patch, Hope omits that entire body from patches,
analysis, evidence, and the literate diff; the file remains in the map as
`bodyState: redacted` with partial metadata-only coverage. Hope reports
discovery, body, and analysis coverage separately. Multiple passes alone are
neither partial nor blocking; incomplete provider data, total safety caps,
missing ordinary text or passes, no explainable text, and stale snapshots fail
closed.

The current GitHub alpha accepts up to 250 commits and 200 changed files only
when their normalized whole-change summary is at most 128 KiB. It accepts up to
20,000 changed lines, 256 KiB of safe patch text for one file, and 768 KiB of
safe patch text in total. Pull request descriptions are limited to 32 KiB, and
each inspector page remains at most 8 KiB. These are explicit active-subscription,
model-visible safety ceilings, not pass boundaries. Hope checks them before
paging; crossing one stops the review instead of producing an incomplete or
operationally unusable explanation.

## Safety boundary

Pull request titles, bodies, commit subjects, paths, patches, and repository
contents are untrusted input. Hope never follows instructions found in them. Selected
source is processed by the active Codex service, including source from a private
pull request that your GitHub account can access.

The collector strips unsafe GitHub environment redirects, bounds all external
work, and blocks common secret paths. If a file patch triggers secret detection,
Hope exposes no part of that body to analysis or evidence. Hope never reads or
writes your GitHub token directly. Authentication remains owned by `gh`.

The final HTML is rendered by a fixed runtime. It does not execute
model-authored HTML, CSS, JavaScript, SVG, URLs, or shell commands, and it does
not embed raw patches. Secret detection is a guardrail, not a guarantee, so
review the pull request scope before using Hope on sensitive repositories.

## Develop

The deterministic adapter boundary, collector, validators, renderer, quiz, and
microworld runtime use only Node.js built-ins. Tests use fake GitHub adapters and
do not call Codex or the network.

```bash
npm test
npm run check
```

Repository layout:

```text
.agents/plugins/marketplace.json     Codex marketplace
plugins/hope/                        distributable plugin
  .codex-plugin/plugin.json
  skills/diff/                       pull-request understanding workflow
    scripts/inspect-change-request.mjs bounded summary and pass inspector
    scripts/lib/inspection-pages.mjs 8 KiB receipt-chain transport
test/                                deterministic contract and runtime tests
tools/check-release.mjs              release/package consistency checks
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for development rules and
[SECURITY.md](SECURITY.md) for private vulnerability reporting.

## License

[MIT](LICENSE)
