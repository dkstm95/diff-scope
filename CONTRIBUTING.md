# Contributing

Read [PRINCIPLES.md](PRINCIPLES.md) before making a project-wide decision. Read
[docs/architecture.md](docs/architecture.md) before changing the main folders.
Read [docs/diff.md](docs/diff.md) before implementing Hope diff.

## Main rules

- Use short sentences and familiar names.
- Keep `harness -> features <- host adapters` as the dependency direction.
- Do not maintain feature code or product definitions in two places.
- Use `npm run build:plugin` for required package copies. Never edit them.
- Add a shared abstraction only after two real features need it.
- Keep current documentation honest about what is and is not implemented.
- Treat repository and provider content as untrusted input.
- Never present an incomplete or stale result as complete.

## Prepare a release

Use one command to keep every public version and generated package copy in
sync:

```bash
npm run release:prepare -- 0.4.1-alpha
```

Review and commit all changed files. Merge that commit into `main` before
creating the matching `v0.4.1-alpha` tag. Do not add files to a release by
changing the zip command. Add an intentional package file to
`tools/plugin-package-files.txt`; the package test then checks the complete
list.

## Add a feature

Start with one useful end-to-end path. Put shared behavior under `features/`,
expose it through the independent harness, and add a skill only when an AI host
needs instructions to use that behavior.

If a feature creates or deletes anything, define ownership, preview, consent,
identity checks, and failure behavior before implementing cleanup.

## Test

Use Node.js 20 or newer.

```bash
npm install
npm run check
```

Tests must work without network access. Test the harness, Codex, and Claude
Code entry paths and verify that they reach the same feature boundary.
