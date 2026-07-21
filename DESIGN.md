# Hope design

Hope should feel calm, direct, and trustworthy.

This file is the source of truth for user-facing design. It applies to the
Hope harness, plugins, skills, commands, and generated files.

[PRINCIPLES.md](PRINCIPLES.md) explains why Hope exists and how project
decisions are made. This file explains how Hope should look, read, and behave.
A feature contract may add a specific rule, but it must not conflict with this
file.

## Authority

Each design decision has one owner.

| Source | Owns | Does not own |
| --- | --- | --- |
| [PRINCIPLES.md](PRINCIPLES.md) | project direction and product values | visual values and component details |
| `DESIGN.md` | shared visual, writing, interaction, and accessibility rules | feature data and safety behavior |
| Feature contract | feature-specific order, content, and behavior | shared visual rules |
| Source code | the working implementation | a competing design rule |
| Tests and examples | evidence that the implementation follows the rule | the rule itself |

When sources disagree, the owner in this table wins. Fix the other source in
the same change when possible. A screenshot, mockup, generated file, or current
implementation is never a design authority by itself.

Keep this file focused on decisions shared across Hope. Put a rule in a feature
contract when no other feature needs it.

## Adoption status

The design system and all current Hope Review patterns are `experimental` while
Hope is alpha.

`DESIGN.md` is the target. The current `hope-review.html` is not a visual
reference until it follows this file. Its known migration gaps are:

- top-level sections need clearer and more consistent boundaries;
- vertical spacing is too loose in several places;
- type sizes and weights do not yet use one complete scale.

Do not copy a current CSS value merely because it already exists. Check this
file first.

## The intended experience

Hope is a working document, not a control dashboard.

- Give the user one clear reading path.
- Keep navigation and technical detail secondary.
- Show state, risk, and evidence without making the page feel busy.
- Prefer an edited technical article over a collection of cards.
- Use interaction only when it helps the user understand or decide something.

The interface should still make sense when color, decoration, and animation
are removed.

## Visual hierarchy

Use this order to create hierarchy:

1. content order;
2. heading size;
3. spacing;
4. a thin separator;
5. a container;
6. color or emphasis.

Do not start with a card, background color, or shadow. Add one only when the
content needs a clear boundary that the earlier tools cannot provide.

## Page structure

A normal Hope page has three layers:

1. a compact introduction that states the result and important trust facts;
2. one main reading column in task order;
3. secondary navigation and evidence that stay available without competing
   with the main content.

Use these layout tokens:

| Token | Value | Use |
| --- | ---: | --- |
| `layout.shell.max` | `1040px` | navigation and reading column together |
| `layout.reading.max` | `800px` | main reading column |
| `layout.navigation.width` | `176px` | wide-screen navigation rail |
| `layout.prose.max` | `68ch` | normal prose line length |
| `layout.narrow.breakpoint` | `760px` | change to one column |
| `layout.target.min` | `44px` | important control and navigation target |

On a wide screen, a quiet navigation rail may sit beside the reading column.
At or below `layout.narrow.breakpoint`, the page becomes one column and the
navigation becomes a compact horizontal list.

Do not split the main story into several equal dashboard columns. Use two
columns only for a direct comparison, a control beside its result, or a short
label beside a longer explanation.

## Section boundaries

Every top-level section must have a visible boundary. Whitespace alone is not
enough.

Use one of these boundaries:

- `border.section` above the section; or
- one contained workspace around content that is manipulated or compared.

Do not use both unless the section would otherwise be unclear. Do not give each
section a different background color.

Use the same neutral line color throughout the page. A colored border is
reserved for a selected item, warning, error, or other meaningful state.

Within a section:

- use a heading and spacing to separate normal subsections;
- add a thin line when two sibling groups could merge visually;
- use a card only when an item has its own identity, state, or action;
- use at most one strong container level at a time.

Nested cards are a sign that the information structure should be simplified.

## Tokens and implementation

A token gives a small design decision a stable, human-readable name. Choose a
token by its meaning, not because its current value looks close.

Use names in the form `category.role.state`:

- `color.text.primary`;
- `color.border.subtle`;
- `space.section`;
- `type.body`.

In CSS, prefix the name with `--hope-` and replace dots with hyphens. For
example, `color.text.primary` becomes `--hope-color-text-primary`. Other hosts
map the same semantic name to their native format.

Do not use value names such as `green-500`, `gray-2`, or `padding-big` in
feature code. A semantic name can keep its meaning when a theme or value
changes.

Each token needs:

- one name;
- one value or alias;
- a type;
- a short purpose;
- an allowed use;
- a status when it is deprecated.

Reuse an alias when two roles intentionally share a value. Do not copy the raw
value into two definitions. Feature CSS uses token-backed custom properties;
raw shared values belong only in the token definition.

For now, the small token tables in this file are canonical. Do not add a token
package before a second real surface needs the same values. When that need
exists, add one DTCG-compatible token file and generate platform values from
it. The token file then owns values; this file continues to own their meaning
and use. Never maintain two hand-written token files for different hosts.

## Spacing

Use a small semantic spacing scale. Do not invent a new value for each
component.

| Token | Wide screen | Narrow screen | Use |
| --- | ---: | ---: | --- |
| `space.detail` | `4px` | `4px` | icon or label detail |
| `space.tight` | `8px` | `8px` | tightly related text |
| `space.control` | `12px` | `12px` | content inside a control |
| `space.content` | `16px` | `16px` | normal element gap |
| `space.container` | `24px` | `16px` | card or workspace padding |
| `space.subsection` | `32px` | `24px` | subsection boundary |
| `space.section` | `64px` | `48px` | top-level section boundary |

Rules:

- Use the wide or narrow value from the table instead of choosing a value
  inside a range.
- Reduce spacing on a narrow screen; do not add space just to fill the page.
- Avoid adding a parent gap and matching child margins for the same boundary.
- Large empty areas need a clear reading or interaction purpose.

## Typography

Use the system sans-serif font for the interface and reading text. Use the
system monospace font only for code, paths, commands, object IDs, and fixed
technical values.

Use this type scale:

| Token | Wide screen | Narrow screen | Weight | Line height |
| --- | ---: | ---: | ---: | ---: |
| `type.page-title` | `40px` | `34px` | `700` | `1.10` |
| `type.section-title` | `28px` | `26px` | `700` | `1.20` |
| `type.subsection-title` | `20px` | `20px` | `700` | `1.30` |
| `type.lead` | `18px` | `18px` | `400` | `1.55` |
| `type.body` | `16px` | `16px` | `400` | `1.60` |
| `type.small` | `14px` | `14px` | `400` | `1.50` |
| `type.label` | `12px` | `12px` | `600` | `1.40` |

Only use font weights `400`, `600`, and `700`.

- Use `400` for normal reading.
- Use `600` for controls, labels, and short emphasis.
- Use `700` for headings and rare strong emphasis.

Do not use small weight differences such as `720`, `750`, `760`, `780`, or
`800`. They create noise without adding a useful level.

Use size and spacing before adding weight. Do not make every label bold. Keep
body text at a readable `16px`; do not shrink important context to make a page
look lighter.

Keep prose at or below `layout.prose.max`. Use negative letter spacing only on
large titles. Use wider letter spacing only for short uppercase labels.

## Color and surfaces

Use a neutral page, a neutral panel, and one main accent color.

| Token | Value | Use |
| --- | --- | --- |
| `color.text.primary` | `#1d201e` | normal text |
| `color.text.secondary` | `#686d69` | supporting text |
| `color.surface.page` | `#f7f7f5` | page background |
| `color.surface.panel` | `#ffffff` | contained workspace |
| `color.border.subtle` | `#dfe1dd` | normal separator |
| `color.border.strong` | `#c8cbc6` | stronger neutral boundary |
| `color.accent` | `#2b6655` | link, focus, selection, progress, main action |
| `color.accent.soft` | `#e8f1ed` | quiet selected surface |
| `color.state.declared` | `#315fa8` | author-declared claim |
| `color.state.observed` | `#17633f` | observed claim and success |
| `color.state.inferred` | `#7a5314` | inferred claim and warning |
| `color.state.unknown` | `#963d37` | unknown claim |
| `color.state.danger` | `#9c342f` | destructive or failed state |

`color.state.success` aliases `color.state.observed`.
`color.state.warning` aliases `color.state.inferred`. A soft state surface may
be added only with a tested text-and-background contrast pair.

| Token | Value | Use |
| --- | --- | --- |
| `border.section` | `1px solid color.border.subtle` | section and subsection boundary |
| `focus.ring` | `3px solid color.accent` | keyboard focus indicator |
| `focus.offset` | `3px` | space between control and focus ring |

- Use the accent for links, selection, focus, progress, and the main action.
- Use semantic colors only for states such as success, warning, danger,
  observed, inferred, or unknown.
- Never use color only for decoration or to distinguish chapters.
- Text and interactive controls must meet WCAG AA contrast.
- Every state shown with color must also have text, shape, or position.

Use a border before a shadow. Shadows are off by default. A shadow is allowed
only when it explains real layering, such as a temporary overlay above the
page.

Use three corner sizes at most:

- `radius.small`: `6px` for small code or status elements;
- `radius.control`: `10px` for controls and cards;
- `radius.workspace`: `16px` for a large interactive workspace.

## Component lifecycle

A shared component or pattern has one visible status.

| Status | Meaning |
| --- | --- |
| `experimental` | useful in a real flow, but behavior or API may still change |
| `supported` | documented, tested, accessible, and safe for normal reuse |
| `deprecated` | kept for migration only; a replacement and removal plan exist |

A component moves to `supported` only when it has:

- a real user need and at least one working use;
- a purpose that an existing component does not already serve;
- design, content, code, and usage guidance that agree;
- tested keyboard, responsive, long-content, and accessibility behavior;
- clear states, tokens, and boundaries;
- an owner and a way to report a problem.

Do not silently remove or rename a supported component or token. Mark it
deprecated, name the replacement, explain the migration, and remove it only in
a planned breaking change.

When a pattern becomes reusable across features, document it with this record:

1. name and status;
2. user problem and purpose;
3. when to use and when not to use;
4. anatomy and states;
5. content and interaction rules;
6. keyboard and responsive behavior;
7. tokens and allowed variants;
8. accessibility evidence and known limits;
9. working examples and tests;
10. owner, change history, and replacement when deprecated.

Keep executable examples and component tests near the implementation. Link to
them from the record instead of copying code into this file.

## Components

### Navigation

Navigation shows location; it does not compete with the document title.

- Keep inactive items quiet.
- Mark the current section with one accent line and clear text.
- Keep each target at least `layout.target.min` high.
- Preserve the document order on every screen size.

### Cards

A card represents one item with its own identity, state, or action. It is not a
default wrapper for a section or paragraph.

Use a list, heading, or separator when the content only needs reading order.
Avoid a page made of equal cards when some information is clearly more
important than the rest.

### Notices

Use a notice only when the user may act differently because of it. State what
happened, why it matters, and what the user can do next. A notice uses one
semantic border and a quiet surface, not a large saturated block.

### Tables

Use a table for exact repeated fields or comparisons. Keep headers short. On a
narrow screen, allow the table itself to scroll instead of forcing the whole
page wider.

### Disclosures

Hide supporting detail, not required context. The summary must say what will
be revealed. Evidence excerpts, object IDs, file maps, and analysis mechanics
normally begin collapsed.

### Diagrams and images

Use a visual when it makes a relationship easier to understand than prose.

Good uses include:

- a flow with three or more dependent steps;
- a sequence whose state changes over time;
- a hierarchy or ownership map;
- a before-and-after UI change;
- several exact mappings or repeated comparisons.

Do not add a diagram that repeats the nearby text. Prefer one useful visual.
Add another only when it has a different comprehension job. Images supplement
the text; they never replace the explanation or accessible label.

## Interactive learning

An interactive element needs a specific learning job.

### System map

The system map may use a contained workspace because the reader selects a flow
and reads its related steps. Keep the selected flow clear. Keep the detail
panel close to the selection.

### Code walkthrough

Order code by behavior, not by file name. On a wide screen, keep the changed
file label beside its explanation. On a narrow screen, return it to the normal
flow. Keep exact source excerpts behind evidence links until the reader asks
for them.

### Microworld

The microworld is its own section. It lets the reader change a small input and
observe a meaningful result. It models behavior and never claims to run the
project code.

Do not add a microworld when a static example teaches the same idea more
clearly.

### Quiz

The quiz is its own section. It helps the reader find a gap in understanding.
Its score is not proof of understanding and is never a merge gate.

## Writing

Use short sentences and familiar words. Give each sentence one main idea.

- Start with the result or change that matters to the user.
- Name an action with a verb and a thing with a concrete noun.
- Define an unavoidable technical term at first use.
- Keep internal transport names and processing mechanics out of the main path.
- Keep the tone consistent within one language.
- Say what is known, inferred, unknown, or not checked.
- Do not use visual polish to imply certainty that the evidence does not
  support.

## Responsive and accessible behavior

- Use WCAG 2.2 Level AA as the minimum target. Do not claim conformance without
  recorded test evidence for the rendered result.
- Use one column at or below `layout.narrow.breakpoint` unless a small direct
  comparison still fits.
- Do not create horizontal page scrolling. A wide table or code sample may
  scroll inside its own region.
- Keep important controls and navigation targets at least
  `layout.target.min` by `layout.target.min`.
- Use `focus.ring` and `focus.offset` for keyboard focus. Keep sticky
  navigation from covering the focused item.
- Keep the reading order and keyboard order the same.
- Give form controls clear labels and state feedback.
- Respect reduced-motion settings.
- Keep the document useful without animation.
- Verify that text can grow to `200%` without losing content or function.

## Hope Review pattern

The diff result follows this order:

1. what changed and the limits of the review;
2. the system map and points that need human judgment;
3. the code walkthrough;
4. the optional microworld;
5. the quiz;
6. evidence and technical details.

Each chapter gets a visible boundary. Only the system map and microworld get a
large contained workspace by default. The other chapters stay in the main
reading flow.

This order is defined in more detail by the
[Hope Review Contract](plugins/hope/skills/diff/references/review-contract.md).

## Review checklist

Before shipping a user-facing change, check:

- Can the user tell where every top-level section starts and ends?
- Is any boundary relying on whitespace alone?
- Are section and subsection gaps taken from the spacing scale?
- Is there empty space without a reading or interaction purpose?
- Does every text style use the defined size and one of three weights?
- Can a card be replaced by a heading, list, or separator?
- Does every use of color communicate meaning?
- Is the main reading path clear before secondary detail is opened?
- Does every visual or interaction do a distinct comprehension job?
- Does the page work at a narrow width and with a keyboard?
- Does the language distinguish fact, inference, and missing verification?

If the answer is no, simplify the page before adding another style or
component.

## Governance

The project maintainer owns this file today. More contributors may help later,
but ownership must stay explicit.

Start with what exists. Add a shared token, component, or pattern only when it
is:

- useful for a real Hope flow;
- different from an existing solution;
- consistent with current tokens and patterns;
- tested with the people, content, devices, and assistive behavior it affects;
- flexible enough for every use that is already known.

A design change should include:

1. the user problem and evidence;
2. the visible before and after behavior;
3. the rule, token, or component that owns the decision;
4. every affected implementation;
5. tests and manual checks;
6. a migration or deprecation note when an old rule was public or supported.

Update this file in the same pull request when a rule should apply across
Hope. Update a feature contract instead when the rule is specific to one
feature. Keep documentation and implementation changes together when
practical so neither becomes a second truth.

Add a new spacing value, type style, color, radius, or component only when an
existing rule cannot express a real user need. A one-off visual preference is
not enough.

Git history records changes to this experimental system. Add a separate design
changelog only when released consumers need migration notes outside the normal
project changelog.

## Definition of done

A user-facing design change is done when:

- this file and every affected feature contract agree;
- the implementation uses the defined tokens and component rules;
- English and Korean content use the same hierarchy and remain readable;
- long titles, paths, evidence, and untrusted text do not break the layout;
- wide and narrow layouts have been checked;
- keyboard order, focus, labels, state feedback, and reduced motion work;
- text contrast, control contrast, `200%` text growth, and page reflow have
  been checked;
- the offline and security boundaries still hold;
- deterministic tests pass;
- one real generated result has been reviewed by a person.

Record what was actually checked. An unchecked item is a known limit, not an
implied pass.

## Research references

These sources informed the rules above. They are useful context, not Hope's
authority.

- [Design Tokens Format Module 2025.10](https://www.designtokens.org/tr/2025.10/format/)
  informed typed tokens, descriptions, aliases, groups, and explicit
  deprecation metadata. Hope will adopt its file format only when a real second
  token consumer exists.
- [Atlassian design tokens](https://atlassian.design/tokens/design-tokens)
  informed semantic names and choosing a token by meaning instead of its
  current value.
- [Atlassian release phases](https://atlassian.design/release-phases) informed
  explicit experimental, supported, and deprecated states with a migration
  path.
- [GOV.UK contribution criteria](https://design-system.service.gov.uk/community/contribution-criteria/)
  informed the useful, unique, consistent, tested, accessible, and versatile
  checks for shared patterns.
- [Carbon component checklist](https://carbondesignsystem.com/contributing/component-checklist/)
  informed one definition of done across design, code, documentation, and
  reusable assets.
- [Storybook component documentation](https://storybook.js.org/docs/writing-docs/index)
  informed keeping executable examples and generated API facts close to the
  component implementation.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) defines Hope's minimum web
  accessibility target and the checks for contrast, reflow, focus, and target
  behavior.
- [CodeRabbit PR Walkthroughs](https://docs.coderabbit.ai/pr-reviews/walkthroughs)
  informed the grouped walkthrough and conditional diagram structure.
- [Linear: How we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui)
  informed the quiet surface, alignment, hierarchy, and reduced visual noise.
- [Linear UI refresh](https://linear.app/changelog/2026-03-12-ui-refresh)
  reinforced the use of clear hierarchy instead of decoration.
- [Stripe Quickstarts](https://docs.stripe.com/quickstarts) informed the
  step-by-step reading path beside code.
- [Observable notebooks](https://observablehq.com/documentation/notebooks/)
  informed the combination of explanation, visualization, small controls, and
  visible results.
- [GitHub pull request side panels](https://github.blog/changelog/2026-03-19-view-code-and-comments-side-by-side-in-pull-request-files-changed-page/)
  informed keeping context visible without losing the current code position.
- [GOV.UK guidance for accessible documents](https://www.gov.uk/guidance/publishing-accessible-documents)
  informed the preference for clear HTML, meaningful headings, simple tables,
  readable contrast, and text that remains complete without images.
