# Security

Please do not open a public issue for a vulnerability that could expose source
code, credentials, or generated executable content. Use GitHub's private
security advisory flow for this repository.

Hope treats repositories, intent files, diffs, and model output as untrusted
input. Its secret detection is defense in depth, not a guarantee. Users remain
responsible for checking the selected working tree and approved intent before
sending them through their active Codex session.

Intent revisions and generated learning bundles are written to private OS
temporary directories by default. Hope must not commit, publish, or copy them
into a target repository automatically. Knowledge-promotion candidates require
human review and an explicit follow-up change. Unless explicitly pinned for
audit or education, the entire generated bundle is discarded after merge.

Hope refuses `skip-worktree` and `assume-unchanged` index flags instead of
claiming that a potentially hidden working-tree change is complete.

Supported security fixes currently target only the latest alpha release.
