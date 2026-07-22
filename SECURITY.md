# Security

Do not open a public issue for a bug that could expose source code,
credentials, private pull request data, or executable generated content. Use
GitHub's private security advisory flow for this repository.

## Current source

The retired diff collector and renderer have been removed. The current diff
boundary stops before it reads a pull request or creates a review artifact. The
repository does not currently ship review collection, rendering, publication,
or cleanup behavior.

Do not infer implemented protection from a product rule in
[docs/diff.md](docs/diff.md). New code must prove each rule with validation and
tests before Hope describes it as a guarantee.

## Required boundary for the rebuilt diff

Treat provider data, repository content, paths, model output, and URLs as
untrusted. Instructions inside that content must not change the workflow.

The rebuilt feature must bind a result to one exact change snapshot, keep
untrusted content inert, refuse incomplete results, avoid overwriting existing
files, and never claim a test or verification result it did not observe.

Optional command execution needs an enforced isolated environment or explicit
approval of the concrete exposure and effects. Authentication remains owned by
the provider tool or host; Hope must not read or store credentials.
