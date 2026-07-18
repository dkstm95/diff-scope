# Security

Please do not open a public issue for a vulnerability that could expose source
code, credentials, private pull request data, or generated executable content.
Use GitHub's private security advisory flow for this repository.

Hope treats pull request titles, bodies, paths, patches, repository source, and
model output as untrusted input. Instructions found in that content must never
control the workflow. Secret detection is defense in depth, not a guarantee.
Users remain responsible for checking the selected pull request before sending
it through their active Codex session.

The GitHub adapter uses the user's existing authenticated GitHub CLI session.
Hope must not request a token argument, read a token from GitHub CLI storage, put
a token in a command line, persist credentials, or include authentication data
in errors or generated output. Authentication and repository authorization
remain owned by `gh`.

Private pull request source crosses the active Codex service boundary when the
authenticated user asks Hope to analyze it. Collection must be read-only,
bounded by time and size, and explicit about metadata-only, redacted, or blocked
coverage. A partial review must never be labeled complete.

Hope binds a review to the pull request's captured base, merge-base, head,
metadata, file set, and fingerprint. It revalidates the pull request before and
after rendering and removes newly created output when the snapshot changes. The
HTML still becomes stale after a later force-push or base update; no background
tracking or cache is claimed.

Internal Change Request context and Review Model files are written to private OS
temporary paths. Normal completion and handled failures remove them through a
path-restricted cleanup command; a blocked collection is never written. An
abrupt process termination may leave a private temporary directory for the OS
to reclaim. The only user-facing output is a private `hope-review.html`. Hope
must not cache, commit, publish, upload, or attach that file automatically.
Knowledge-promotion candidates require human review and a separate explicit
change.

The final HTML uses a fixed offline runtime. It must not execute model-authored
HTML, CSS, JavaScript, SVG, URLs, or shell commands, and it must not embed raw
patches or credentials. Dynamic values are validated and escaped before
rendering.

Supported security fixes currently target only the latest alpha release.
