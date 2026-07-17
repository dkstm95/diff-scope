<p align="center">
  <img src="plugins/diff-scope/assets/telescope.svg" width="128" alt="DiffScope telescope icon">
</p>

<h1 align="center">DiffScope</h1>

<p align="center"><strong>Understand the code AI just finished—before you approve it.</strong></p>

<p align="center"><a href="README.ko.md">한국어</a></p>

DiffScope turns one completed local code change into three connected learning
artifacts:

- an evidence-based explanation of the before-to-after behavior;
- an auto-scored quiz that checks predictions and invariants;
- an offline interactive microworld for exploring the changed behavior.

It runs inside your active Codex subscription session. There is no API key,
model configuration, server, or additional model call.

> **Alpha:** `v0.1.0-alpha` is the first public dogfooding build. Interfaces and
> artifact schemas may change from what we learn after release.

## Install

Requirements: Git, Node.js 20 or newer, and Codex signed in with a ChatGPT
subscription.

```bash
codex plugin marketplace add dkstm95/diff-scope --ref v0.1.0-alpha
codex plugin add diff-scope@diff-scope
```

Start a new Codex task after installation so the new skill is loaded.

## Use

Finish one local coding task, then invoke:

```text
$diff
```

Or ask naturally:

```text
Use $diff to explain my completed change, quiz me, and build a microworld.
```

DiffScope writes a private temporary bundle by default:

- `artifact.json` — validated source data bound to the exact collected context;
- `explanation.md` — the goal, causal path, decisions, risks, and evidence;
- `index.html` — the explanation, auto-scored quiz, and offline microworld.

Ask for a durable output directory when you want to keep the bundle.

## Alpha scope

DiffScope analyzes only:

```text
HEAD -> current working tree
```

That includes staged, unstaged, and safe untracked text files. The alpha assumes
the working tree contains one completed work unit. Separate unrelated changes
before invoking `$diff`.

Commit ranges, branches, pull requests, remote changes, API providers, CI batch
generation, binary files, generated files, and lockfiles are outside this
release's supported scope.

## Safety boundary

Repository contents in the selected scope are processed by the active Codex
service. The local collector bounds file count, changed lines, bytes, and time;
blocks common secret paths; redacts suspected credentials; disables external Git
diff helpers; and treats the repository as untrusted input.

The final HTML is rendered from a fixed runtime. It does not execute
model-authored HTML, CSS, JavaScript, SVG, URLs, or shell commands, and it needs
no network connection. Secret detection is a guardrail, not a guarantee, so
review the collected scope before using DiffScope on sensitive repositories.

## Develop

The deterministic collector, validator, renderer, quiz, and microworld runtime
use only Node.js built-ins. Tests do not call Codex or the network.

```bash
npm test
npm run check
```

Repository layout:

```text
.agents/plugins/marketplace.json     Codex marketplace
plugins/diff-scope/                  distributable plugin
  .codex-plugin/plugin.json
  skills/diff/                       shared skill and deterministic runtime
test/                                collector and renderer tests
tools/check-release.mjs              release/package consistency checks
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for development rules and
[SECURITY.md](SECURITY.md) for private vulnerability reporting.

## License

[MIT](LICENSE)
