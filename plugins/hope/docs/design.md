<!-- Generated from docs/design.md. Do not edit. -->

# Hope design

This is the shared visual definition for files made by Hope. A feature document
owns its information and reading order. This file owns the visual language used
to present that information.

The first implementation is the Hope diff review. Do not build a general
component framework before a second Hope feature needs the same component.

## Direction

Hope artifacts should feel:

- direct;
- compact;
- calm;
- easy to scan; and
- clearly divided without looking boxed in.

Use familiar words, short sentences, and one clear reading path. Prefer useful
content over decoration.

The source repository keeps reference images under
`docs/design/baseline-v1/`. They show the intended density and tone. They are
comparison material, not pixel-perfect specifications and do not ship in the
runtime plugin.

`design/tokens.mjs` is the code source of truth for shared colors, type sizes,
spacing, and layout limits. A renderer must read those tokens instead of
copying their values.

## Layout

Use one linear document in every viewport.

On a wide screen:

- keep the main text at a readable width;
- place a compact table of contents beside it when space allows;
- keep the product bar compact and place the artifact title in the document;
- keep dense body text intentionally smaller than mobile text; and
- do not stretch paragraphs across a large monitor.

On a narrow screen:

- keep the same information order and status language;
- use one column;
- put a compact native collapsible table of contents in the product bar;
- do not give the closed table of contents its own body row or vertical gap;
- open its links in a bounded panel directly below the product bar;
- use larger body text and touch targets.

A complex drawer is allowed only after its focus, keyboard, scroll, and deep
link behavior is tested.

## Type

Use three clear roles.

| Role | Font |
| --- | --- |
| Body prose | Hope Sans Light, from Gmarket Sans |
| Wordmark, controls, labels, and headings | Hope Sans Medium or Bold |
| Code, commands, paths, and hashes | Hope Code, from D2Coding |

Embed the fixed WOFF2 files in every offline artifact. Use a local sans-serif
or monospace fallback only for characters that the bundled fonts do not
contain. Do not synthesize a missing font weight.

Hope presents the converted files under Hope-owned family names because both
source licenses reserve their original family names. Keep their source hashes,
build commands, and licenses in `design/fonts/`.

Start with this compact scale and adjust it only through named tokens:

| Use | Wide screen | Narrow screen |
| --- | --- | --- |
| Main body | 14px / 1.55 | 16px / 1.55 |
| Supporting text | 12px / 1.5 | 14px / 1.5 |
| Code | 13px / 1.55 | 14px / 1.55 |
| Page title | 24px / 1.25 | 28px / 1.25 |
| Section title | 18px / 1.35 | 20px / 1.35 |

Keep prose near 60–80 characters per line. Long paths and code may scroll
inside their own region. They must not create page-level horizontal scrolling.

## Space and boundaries

Use a small, consistent spacing scale. Do not invent a new gap for each
component.

```text
4 · 8 · 12 · 16 · 24 · 32
```

Give each top-level section a clear start. Use a heading, a cyan keyline, and
measured space. Number conditional sections in their rendered order so the
document and its table of contents agree. Use one quiet divider at a section
boundary instead of extending the cyan line through the whole section.

Use two border roles:

- a quiet divider for document structure; and
- a stronger component border for controls, code, and separate task or state
  regions.

Do not draw a strong rule between every sentence or row. Do not nest full
component borders inside the first-screen summary. Compact summary items use
rows; their detailed versions may use cards later in the document.

When a change has two to five short behavior steps, show them as connected
cards: horizontal on a wide screen and vertical on a narrow screen. Use the
same text and order in both layouts. Fall back to a normal list when the steps
are long or numerous.

## Color and themes

Generate one artifact that supports light and dark themes.

The official light palette is `Sand Paper`: a warm near-white page with a
slightly brighter reading surface. It should feel softer than pure white
without looking beige or gray. Exact Hope surface values live only in
`design/tokens.mjs`.

Code is a separate visual surface. Use GitHub Light Default inside code regions
in light mode and GitHub Dark Default inside code regions in dark mode. A
document theme change switches both at once, but it does not replace the Hope
palette outside code. Highlight syntax during artifact generation with trusted,
fixed grammars and themes. Insert repository text only as escaped token
content. If Hope does not support a file language, show its escaped source
without guessed highlighting.

The initial theme comes from the resolved Hope setting:

- `system`;
- `light`; or
- `dark`.

The theme control changes only the open document. It does not write Hope
settings or browser storage. Reloading returns to the generated initial theme.
Print uses a light surface.

Use these status roles:

| Meaning | Color role |
| --- | --- |
| Resolve | Red |
| Decide | Amber |
| Verify | Blue |
| Scope | Neutral blue-gray |

Importance stays in text. Never use color as the only status signal.

## Interaction

Every interaction must still leave useful content when JavaScript is disabled.
Use trusted, fixed scripts only.

Supported interactions can include:

- open or close evidence;
- move through the table of contents;
- switch the current document theme;
- try a safe declarative microworld; and
- reveal a quiz explanation.

Do not show a section-copy control while artifacts use temporary local paths.
Stable section IDs remain available for navigation. Add copying only when Hope
has a portable publication URL and can show visible success feedback.

Do not add task completion, assignment, comments, or hidden persistence.

## Accessibility

Target WCAG 2.2 AA.

Every artifact needs:

- one `h1` and a valid heading order;
- landmarks and a skip link;
- visible keyboard focus;
- text labels for every status;
- sufficient contrast in both themes;
- reduced-motion and forced-colors support;
- useful content at 200% text zoom and 400% page zoom;
- a text alternative for every diagram or interactive explanation; and
- correct `lang`, `dir`, and bidirectional isolation for mixed content.

Keep mobile controls at least 44 by 44 CSS pixels. Do not reduce a status or
control label below 12px on a narrow screen. Supporting labels and interactive
summaries use the medium face; body prose keeps the light face.

Test the final file through `file://`, not only through a web server.

## Implementation boundary

Repository, provider, and model content is untrusted. A feature renderer inserts
it as text and never accepts authored HTML, CSS, JavaScript, SVG, or URLs.

Shared design code may contain tokens, fixed assets, and small helpers. The
feature owns its concrete HTML. Promote a feature component into shared code
only after another Hope feature needs the same behavior.
