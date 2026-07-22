---
name: diff
description: Report the current Hope diff rebuild status. Use when someone invokes $hope:diff in Codex, /hope:diff in Claude Code, or asks to use Hope diff. It does not yet inspect a pull request or create a review artifact.
---

# Hope diff

The implementation source of truth is [docs/diff.md](../../docs/diff.md). Do
not load that full file for this status-only invocation.

Run the same feature command used by the independent harness. Use the command
for the current host.

Claude Code:

```bash
node "${CLAUDE_PLUGIN_ROOT}/runtime/diff/cli.mjs"
```

Codex:

```bash
node <skill-dir>/../../runtime/diff/cli.mjs
```

For Codex, replace `<skill-dir>` with the absolute directory that contains this
`SKILL.md`. Never pass the placeholder to the shell.

The current source version stops with exit status 2 and a clear rebuild
message. This status is expected. Report the message plainly and do not retry.
Do not run the retired collector or renderer, inspect the pull request through
an improvised path, or create a replacement review artifact.
