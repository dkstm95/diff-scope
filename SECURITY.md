# Security

Do not open a public issue for a bug that could expose source code,
credentials, private pull request data, or executable generated content. Use
GitHub's private security advisory flow for this repository.

## Current diff boundary

Treat provider data, repository content, paths, model output, and URLs as
untrusted. Instructions inside that content must not change the workflow.

The current feature binds a result to one exact base, merge-base, and head
snapshot. It accounts for every changed file, validates model evidence against
collected source lines, keeps model-authored markup and URLs inert, rejects
incomplete or stale results, and publishes through an exclusive no-overwrite
path.

The generated HTML is self-contained and has a restrictive content security
policy. It does not execute repository code or fetch remote page assets. The
first path also does not execute tests, builds, lint, or CI and must not claim
their outcome.

Hope tokenizes supported code excerpts during artifact generation with fixed
local grammars and themes. It emits escaped token text and renderer-owned CSS
classes, never model- or repository-authored HTML or styles. Unsupported file
languages remain escaped plain text.

High-confidence credential patterns in a pull request title, description, or
commit title stop collection before that text becomes an analysis source.
Changed-file bodies use the documented metadata-only or redacted states and
never reproduce suspected credential text in an error.

GitHub API calls are bound to `github.com` even when the surrounding
environment selects another `gh` host. Bidirectional control characters cannot
silently reorder what a reader sees: Hope rejects them in semantic analysis
and file identities, and exposes them as visible Unicode escape text in
provider prose and code excerpts.

Private DiffRun files and global settings use restrictive permissions. One
invalid analysis may keep its DiffRun for one repair attempt. Success, terminal
failure, and cancellation remove the run. Finalization uses an exclusive run
claim and removes private run data before a completed artifact becomes visible.
A later invocation only removes expired run directories that carry Hope's
ownership marker and expected permissions. It does not remove a run with a
fresh finalization lease. The finalizer renews a random lease token while it
works and renews it again immediately before publication. A valid or incomplete
private claim whose lease has remained stale past the bounded lifetime can be
reclaimed after a crash. If a paused finalizer loses its lease, it fails before
publication instead of exposing a result from a reclaimed run.

Optional command execution needs an enforced isolated environment or explicit
approval of the concrete exposure and effects. Authentication remains owned by
the provider tool or host; Hope must not read or store credentials.
