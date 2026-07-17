# Contributing

DiffScope is intentionally small. Keep changes inside the alpha promise: one
completed local working-tree change, one subscription-session generator, and
three safe learning artifacts.

## Development

Use Node.js 20 or newer. No dependency installation is required.

```bash
npm run check
```

Tests must remain deterministic and offline. Do not add API keys, model calls,
network fixtures, model-authored executable HTML, or target-project runtime
dependencies.

Before opening a pull request, describe the observable before-to-after behavior,
the relevant risk, and the commands that actually ran.
