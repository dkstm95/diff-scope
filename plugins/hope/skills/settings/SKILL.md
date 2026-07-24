---
name: settings
description: Show, set, or reset the global Hope language and theme preferences shared by the harness and plugin. Use when someone invokes $hope:settings in Codex, /hope:settings in Claude Code, or asks to change Hope's default language or light, dark, or system theme.
---

# Hope settings

Use the generated settings command for the current host.

Claude Code:

```text
node "${CLAUDE_PLUGIN_ROOT}/runtime/settings/cli.mjs"
```

Codex:

```text
node <skill-dir>/../../runtime/settings/cli.mjs
```

For Codex, replace `<skill-dir>` with the absolute directory that contains this
file.

Use one of these exact forms:

```text
show
set locale ko-KR
set locale en-US
set theme system
set theme light
set theme dark
reset
```

Use `show` when the request is ambiguous. Do not edit the settings file
directly, inspect unrelated environment values, or store a preference inferred
only from the current conversation language.

Report the command result plainly. A new review uses the changed default; an
existing offline review does not change.
