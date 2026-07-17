# Contributing

Hope is intentionally small. Keep changes inside the alpha promise: one private,
approved intent revision from a clean working tree; one completed local
working-tree change; one active subscription-session generator; and one safe,
three-file learning bundle.

Preserve the product boundary: one user-visible case, immutable intent and
change checkpoints, and disposable views. `$hope:diff` may consume `$hope:align` output,
but it must never rewrite an approved intent to fit the implementation. A
code-only `$hope:diff` without prior alignment must remain supported.

## Development

Use Node.js 20 or newer. No dependency installation is required.

```bash
npm run check
```

Tests must remain deterministic and offline. Do not add API keys, model calls,
network fixtures, model-authored executable HTML, or target-project runtime
dependencies.

Generated bundles are private temporary learning tools, not repository records.
Do not add a default `.hope/` archive or automatically write promotion
candidates into a target repository. Durable knowledge belongs in the target
project's existing tests, code comments, architecture documentation, runbooks,
or change records after human review. The default lifecycle discards the entire
generated bundle, including `artifact.json`, after merge.

Before opening a pull request, describe the approved intent or explicitly note
that there was none, the observable before-to-after behavior, any intent
deviation, the relevant risk, and the commands that actually ran.
