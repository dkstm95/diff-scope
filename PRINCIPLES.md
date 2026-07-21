# Hope principles

Hope helps people work with AI while staying able to see, understand, and
control the work.

These principles guide the whole project. A feature, interface, or outside
reference may support them, but does not define Hope by itself.

## Grow into a harness

Hope is growing into an AI work harness. This is the long-term direction of the
project.

The harness will bring tools, context, workflows, state, and results into one
consistent environment. It will grow from useful work instead of empty
framework parts.

## Support two ways to use Hope

People should be able to use Hope in either of these ways:

- use the Hope harness as a complete working environment;
- use selected Hope plugins and skills in a supported host such as Claude or
  Codex.

Plugins and skills are not temporary. They stay useful for people who want one
capability without the full harness.

The two paths use the same feature code and rules. A host adapter stays thin.
Hope does not keep a separate implementation for each host or entry point.

Not every feature must appear in both paths. A harness-only feature is valid
when it needs the wider environment. A feature that is useful on its own can
also be offered as a plugin or skill.

## Keep the person in control

Hope can automate work, but must not hide important choices, state, or results.
The person should be able to understand what Hope did, guide what happens next,
and stop or clean up the work safely.

Show the reason and evidence when they matter. Do not present a generated claim
as a verified fact.

## Build from real work

Start with a clear user goal and the smallest useful feature. Use the feature,
learn from it, and then improve the harness.

Do not add an abstract layer for a possible future need. Share a rule only when
two real features need the same rule.

## Use plain language and clear boundaries

Use short sentences and familiar words in code, commands, and documents. Name a
thing after the job it does or the data it holds.

Each feature owns its behavior and state. Entry points such as plugins, skills,
and future harness interfaces call that feature instead of copying it.

## Own what Hope creates

Hope records the files, state, worktrees, or branches it creates. It never
guesses ownership from a name or prefix.

Destructive work needs a preview, clear confirmation, and a final identity
check. When Hope is uncertain, it leaves the item in place.

## Test a new decision

Before adding a feature or shared layer, ask:

- What clear user goal does it serve?
- Does it belong in the harness, work on its own, or both?
- Can every entry point use the same feature code?
- Can the person see and control important state and choices?
- Does Hope know exactly what it created and may clean up?
- Has the added complexity earned its place through real use?

## Learn without copying

Hope may learn from research, tools, videos, and other projects. Record useful
sources near the feature or decision they influenced.

An outside source is context, not Hope's authority. Hope owns these principles
and changes them only when the direction of the whole project changes.
