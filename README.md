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
Claude and Codex skill is the first complete diff path. The independent
harness shares its settings, collection, validation, rendering, and lifecycle
code while its own AI adapter remains explicit future work.
[PRINCIPLES.md](PRINCIPLES.md) defines the project direction, and
[docs/architecture.md](docs/architecture.md) defines the current structure.

## Current state

Hope diff explains one exact GitHub pull request as a private, self-contained
HTML file. It chooses an open pull request from the current repository when no
URL is supplied, or accepts a canonical GitHub pull-request URL.

The Claude and Codex skill uses the active AI session only for the structured
analysis. Shared Hope code collects the pull request, validates every file and
evidence reference, rechecks the snapshot, renders the offline file, and
removes the private run data.

Global Hope settings choose `ko-KR` or `en-US` and `system`, `light`, or `dark`
for both entry paths.

## Requirements

Hope requires Node.js 20 or newer and an authenticated GitHub CLI. Codex or
Claude Code is also required for automatic AI analysis through the plugin
path.

## Harness

Run the harness without Codex or Claude:

```bash
npm run hope -- --help
npm run hope -- diff
npm run hope -- settings show
```

The command lives in `harness/` and calls feature code in `features/`.
`hope diff` currently reports that the independent harness has no AI model
adapter instead of pretending to complete an analysis.

## Plugins and skill

The single package in `plugins/hope/` supports both Codex and Claude Code. Each
host reads its own manifest, while both hosts use the same `diff` skill and the
same generated feature code.

Claude Code can load the package directly during development:

```bash
claude --plugin-dir ./plugins/hope
```

Use `$hope:diff` in Codex or `/hope:diff` in Claude Code. Use
`$hope:settings` or `/hope:settings` to save the shared language and theme
defaults. The repository also includes a Claude Code marketplace catalog, so a
published checkout can be added with:

```bash
claude plugin marketplace add dkstm95/hope
claude plugin install hope@hope
```

The editable sources remain in root `docs/`, `features/`, `settings/`,
`locales/`, and `design/`. Run `npm run build:plugin` to update the package
copies. Release checks compare every generated file with its source so they
cannot become a second implementation or source of truth.

Commit the rebuilt package copies with every source change. A push that changes
only the source fails verification instead of silently publishing an old
plugin copy.

## Develop

Install the locked development dependencies once. The generated plugin remains
self-contained and does not install packages when a person uses it.

```bash
npm install
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
