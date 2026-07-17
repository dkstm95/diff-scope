<p align="center">
  <img src="plugins/hope/assets/telescope.svg" width="128" alt="Hope telescope icon">
</p>

<h1 align="center">Hope</h1>

<p align="center"><strong>Align intent. Understand change. Keep the human in the code.</strong></p>

<p align="center"><a href="README.ko.md">한국어</a></p>

Hope helps people stay oriented while AI writes code. It connects two moments
that are usually lost in chat history:

- `$hope:align` establishes the goal, decisions, constraints, non-goals, and expected
  scenarios before coding;
- `$hope:diff` binds that approved intent to the exact local change, explains what
  actually happened, checks understanding, and makes the behavior explorable.

Both skills run inside your active Codex subscription session. Hope needs no API
key, model configuration, server, or nested model call.

> **Alpha:** `v0.2.0-alpha` is subscription-only and targets one local work unit.
> Interfaces and schemas may change as the workflow is dogfooded.

## Install

Requirements: Git, Node.js 20 or newer, and Codex signed in with a ChatGPT
subscription.

If you installed DiffScope `v0.1.0-alpha`, remove its plugin and marketplace
before installing Hope:

```bash
codex plugin remove diff-scope@diff-scope
codex plugin marketplace remove diff-scope
```

Then install Hope:

```bash
codex plugin marketplace add dkstm95/hope --ref v0.2.0-alpha
codex plugin add hope@hope
```

Start a new Codex task after installation so `$hope:align` and `$hope:diff` are loaded.

## Use

### 1. Align before coding

Begin with a clean working tree, then invoke:

```text
$hope:align
```

Describe what you want to change. Hope and Codex surface only unresolved choices
that need your judgment; there is no arbitrary maximum number of decision cards.
After your explicit approval, Hope writes an immutable intent revision to a
private OS temporary directory and binds it to the current `HEAD`.

Keep the returned `intent.json` path. It is the input that lets `$hope:diff` compare
the implementation with what you actually approved instead of reconstructing
intent after the fact.

### 2. Implement one work unit

Work with Codex normally. Keep unrelated changes outside the working tree so the
review has one coherent boundary.

If the requested intent changes after implementation starts, never rewrite the
approved revision to fit the code. This alpha cannot finalize a replacement
from a dirty tree: either finish, revert, or separate the current work under the
user's control and run `$hope:align` from the next clean boundary, or let `$hope:diff`
report the current mismatch for review.

### 3. Understand before approval or merge

When the work unit is complete, invoke:

```text
$hope:diff
```

Give `$hope:diff` the approved `intent.json` path when one exists. Hope collects the
exact `HEAD -> working tree` snapshot, binds the review to both the immutable
intent revision and the change fingerprint, then identifies fulfilled intent,
deviations that need your review, unresolved mismatches, and code evidence.

`$hope:diff` also works without `$hope:align`. In that fallback mode it explains and
teaches the change from code evidence, but it cannot claim that the
implementation matches a previously approved intent.

## The learning bundle

Hope writes one private temporary bundle by default:

- `artifact.json` — validated source data bound to the exact intent revision, if
  supplied, and the exact collected change;
- `explanation.md` — the goal, causal path, intent comparison, decisions, risks,
  and evidence;
- `index.html` — the explanation, auto-scored quiz, and offline interactive
  microworld.

The bundle's fixed interface and labels use English. Model-authored
explanations, quiz text, and microworld content follow the user's working
language.

The bundle supports review; passing the quiz does not prove complete
understanding. If the working tree changes, the old review is stale and must not
be presented as current.

Hope does not commit this bundle, create a `.hope/` archive, edit `.gitignore`,
or publish anything. After merge, discard the entire bundle—including
`artifact.json`—unless you explicitly pin it for audit or education. Generated
explanations, quiz state, and microworld files are disposable views, not project
documentation.

## Reduce cognitive debt without creating document debt

Keeping every AI-generated artifact after merge would create another body of
material that can drift from the code. Hope instead separates temporary learning
tools from durable knowledge.

Before merge, `$hope:diff` can identify knowledge worth promoting. Promote it only
when it is hard to reconstruct, likely to affect a future decision, still valid
after the merge, and confirmed by a human. Put it in an existing source of truth:

- behavior contracts and edge cases belong in tests, types, assertions, or
  fixtures;
- local, non-obvious rationale belongs next to the code;
- architectural decisions belong in the project's ADR or design documentation;
- operational constraints belong in its runbook;
- small change rationale belongs in the commit or pull request.

Personal quiz answers and generated HTML do not belong in the repository. The
principle is: **preserve intent, regenerate explanations, require
understanding.**

## Alpha scope

`$hope:align` finalizes only from a clean working tree. `$hope:diff` analyzes only:

```text
HEAD -> current working tree
```

That includes staged, unstaged, and safe untracked text files. This alpha assumes
the working tree contains one completed work unit.

Hope refuses `skip-worktree` and `assume-unchanged` index flags because they can
hide tracked changes; sparse worktrees are therefore outside this alpha.

Commit ranges, branches, pull requests, remote or other-author changes, API
providers, CI batch generation, binary files, generated files, and lockfiles are
outside this release's supported scope.

## Safety boundary

Repository contents in the selected scope are processed by the active Codex
service. The local collectors bound files, changed lines, bytes, and time; block
common secret paths; redact suspected credentials; disable external Git diff
helpers; and treat the repository as untrusted input.

The final HTML is rendered from a fixed runtime. It does not execute
model-authored HTML, CSS, JavaScript, SVG, URLs, or shell commands, and it needs
no network connection. Secret detection is a guardrail, not a guarantee, so
review the selected scope before using Hope on sensitive repositories.

## Develop

The deterministic collectors, validators, renderer, quiz, and microworld runtime
use only Node.js built-ins. Tests do not call Codex or the network.

```bash
npm test
npm run check
```

Repository layout:

```text
.agents/plugins/marketplace.json     Codex marketplace
plugins/hope/                        distributable plugin
  .codex-plugin/plugin.json
  skills/align/                      approved intent workflow
  skills/diff/                       post-change teaching workflow and runtime
test/                                deterministic contract and runtime tests
tools/check-release.mjs              release/package consistency checks
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for development rules and
[SECURITY.md](SECURITY.md) for private vulnerability reporting.

## License

[MIT](LICENSE)
