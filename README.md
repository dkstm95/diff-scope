<p align="center">
  <img src="plugins/hope/assets/telescope.svg" width="128" alt="Hope telescope icon">
</p>

<h1 align="center">Hope</h1>

<p align="center"><strong>An AI work harness with supported plugin and skill entry points.</strong></p>

<p align="center"><a href="README.ko.md">한국어</a></p>

Hope is organized around two separate entry paths:

- use the independent Hope harness;
- use the Hope plugin and skill in Codex or Claude Code.

Both paths call the same feature code. Neither path owns a second copy. The
structure is in place, but diff is not usable while its new implementation is
being built.
[PRINCIPLES.md](PRINCIPLES.md) defines the project direction, and
[docs/architecture.md](docs/architecture.md) defines the current structure.

## Current state

Hope diff is being rebuilt from [docs/diff.md](docs/diff.md). The retired
collector, review model, renderer, HTML design, and cleanup for their files have
been removed. This source version does not create a review artifact.

The two entry paths are wired to one shared diff boundary and fail with the
same clear rebuild message. This is a temporary development state, not a
completed diff release.

## Requirements

Hope currently requires Node.js 20 or newer. Codex or Claude Code is also
required when using the plugin path.

## Harness

Run the harness without Codex or Claude:

```bash
npm run hope -- --help
npm run hope -- diff
```

The command lives in `harness/` and calls feature code in `features/`.

## Plugins and skill

The single package in `plugins/hope/` supports both Codex and Claude Code. Each
host reads its own manifest, while both hosts use the same `diff` skill and the
same generated feature code.

Claude Code can load the package directly during development:

```bash
claude --plugin-dir ./plugins/hope
```

The skill appears as `/hope:diff`. The repository also includes a Claude Code
marketplace catalog, so a published checkout can be added with:

```bash
claude plugin marketplace add dkstm95/hope
claude plugin install hope@hope
```

The editable sources remain in root `docs/` and `features/`. Run
`npm run build:plugin` to update the package copies. Release checks compare
every generated file with its source so they cannot become a second
implementation or source of truth.

Commit the rebuilt package copies with every source change. A push that changes
only the source fails verification instead of silently publishing an old
plugin copy.

## Develop

No dependency install is needed.

```bash
npm run check
```

Prepare a release with one command. Pass the version without a `v` prefix:

```bash
npm run release:prepare -- 0.4.1-alpha
```

This updates the package and both host manifests, rebuilds the plugin copies,
and runs all checks. Review and commit the resulting files before creating the
matching `v0.4.1-alpha` tag. The release packages only the files listed in
`tools/plugin-package-files.txt`, and the tag commit must already belong to
`main`.

## License

[MIT](LICENSE)
