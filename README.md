<p align="center">
  <img src="plugins/hope/assets/telescope.svg" width="128" alt="Hope telescope icon">
</p>

<h1 align="center">Hope</h1>

<p align="center"><strong>See the change. Understand the why. Keep the human in the code.</strong></p>

<p align="center"><a href="README.ko.md">한국어</a></p>

Hope helps people understand a pull request before they approve or merge it. Give
`$hope:diff` a GitHub pull request URL and it turns the exact change into one
visual, interactive review: an evidence-based explanation, an auto-scored quiz,
and an optional microworld for exploring behavior.

Hope runs inside your active Codex subscription session. It needs no OpenAI API
key, model configuration, server, nested model call, cache, or database.

> **Alpha:** `v0.3.0-alpha` focuses on GitHub pull requests. Interfaces and
> schemas may change as this workflow is dogfooded.

## Install

Requirements:

- Node.js 20 or newer;
- [GitHub CLI](https://cli.github.com/) authenticated with access to the pull
  request (`gh auth login`);
- Codex signed in with a ChatGPT subscription.

Install Hope from its tagged marketplace:

```bash
codex plugin marketplace add dkstm95/hope --ref v0.3.0-alpha
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

Hope records the base, merge-base, and head SHAs. It rechecks the pull request
before and after rendering. A force-push, base update, or relevant metadata
change during generation cancels the result instead of presenting a mixed
snapshot.

### 2. Explore the Hope Review

Hope returns one private, self-contained file:

```text
hope-review.html
```

Open it locally in a browser. It needs no network connection and contains:

- the pull request's declared goal and the behavior observed in code;
- visual before/after panels, flows, or decision tables when they clarify the
  change;
- a literate diff that connects selected code evidence to the explanation;
- decisions, invariants, risks, unknowns, and explicit verification limits;
- three to five auto-scored questions, including prediction and risk reasoning;
- an interactive microworld when the behavior benefits from exploration;
- questions worth asking the author;
- optional candidates for durable project knowledge.

The microworld is intentionally optional. A change that is better taught by a
diagram and quiz does not receive a decorative simulator.

The fixed interface uses English. Model-authored explanation and teaching
content follow the user's working language.

## One review, no artifact management

Hope uses bounded structured context and a validated review model internally,
but they are transient. It removes them after rendering or a handled failure
and does not expose `intent.json`, `artifact.json`, or a separate Markdown
explanation.

By default, the HTML lives in a private OS temporary directory. Hope does not:

- create a `.hope/` directory or edit `.gitignore`;
- keep a cache, registry, database, or searchable review index;
- commit or attach the review to the pull request;
- post comments, approve, close, or merge the pull request;
- write knowledge candidates into the target repository.

The user may explicitly request an exported HTML file. Hope still refuses to
overwrite an existing path or publish it automatically.

The review is bound to the captured pull request snapshot, not kept current in
the background. If the head or base changes, run `$hope:diff` again. A default
temporary review creates no project cleanup work: close it when finished and let
the operating system reclaim the temporary location. If you explicitly export
a copy, you control its retention. A person or an AI may perform the merge; Hope
is not part of that operation.

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

The collector bounds files, analyzed lines, bytes, and time. Binary, generated,
lockfile, submodule, rename-only, sensitive-path, and redacted content may appear
as clearly labeled metadata-only coverage. Hope blocks a review when size limits
would produce an arbitrary partial story or when no explainable text remains.

## Safety boundary

Pull request titles, bodies, commit subjects, paths, patches, and repository
contents are untrusted input. Hope never follows instructions found in them. Selected
source is processed by the active Codex service, including source from a private
pull request that your GitHub account can access.

The collector strips unsafe GitHub environment redirects, bounds all external
work, blocks common secret paths, and redacts suspected credentials. Hope never
reads or writes your GitHub token directly. Authentication remains owned by
`gh`.

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
test/                                deterministic contract and runtime tests
tools/check-release.mjs              release/package consistency checks
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for development rules and
[SECURITY.md](SECURITY.md) for private vulnerability reporting.

## License

[MIT](LICENSE)
