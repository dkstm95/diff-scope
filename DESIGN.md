# Hope design

Hope should feel calm, direct, and trustworthy.

This file is the source of truth for user-facing design. It applies to the
Hope harness, plugins, skills, commands, and generated files.

[PRINCIPLES.md](PRINCIPLES.md) explains why Hope exists and how project
decisions are made. This file explains how Hope should look, read, and behave.
A feature contract may add a specific rule, but it must not conflict with this
file.

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

On a wide screen, the reading column should be about `760px` to `800px` wide.
A quiet navigation rail may sit beside it. On a narrow screen, the page becomes
one column and the navigation becomes a compact horizontal list.

Do not split the main story into several equal dashboard columns. Use two
columns only for a direct comparison, a control beside its result, or a short
label beside a longer explanation.

## Section boundaries

Every top-level section must have a visible boundary. Whitespace alone is not
enough.

Use one of these boundaries:

- a `1px` neutral line above the section; or
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

## Spacing

Use a small spacing scale. Do not invent a new value for each component.

| Token | Size | Use |
| --- | ---: | --- |
| `space-1` | `4px` | icon or label detail |
| `space-2` | `8px` | tightly related text |
| `space-3` | `12px` | control content |
| `space-4` | `16px` | normal element gap |
| `space-5` | `24px` | card padding or subsection gap |
| `space-6` | `32px` | large subsection gap |
| `space-7` | `48px` | mobile section gap |
| `space-8` | `64px` | desktop section gap |

Rules:

- Keep top-level section gaps between `48px` and `64px`.
- Keep subsection gaps between `24px` and `32px`.
- Keep normal content gaps between `12px` and `16px`.
- Keep container padding between `16px` and `24px`.
- Reduce spacing on a narrow screen; do not add space just to fill the page.
- Avoid adding a parent gap and matching child margins for the same boundary.
- Large empty areas need a clear reading or interaction purpose.

## Typography

Use the system sans-serif font for the interface and reading text. Use the
system monospace font only for code, paths, commands, object IDs, and fixed
technical values.

Use this type scale:

| Role | Desktop | Narrow screen | Weight | Line height |
| --- | ---: | ---: | ---: | ---: |
| Page title | `40px` | `34px` | `700` | `1.10` |
| Section title | `28px` | `26px` | `700` | `1.20` |
| Subsection title | `20px` | `20px` | `700` | `1.30` |
| Lead text | `18px` | `18px` | `400` | `1.55` |
| Body text | `16px` | `16px` | `400` | `1.60` |
| Small text | `14px` | `14px` | `400` | `1.50` |
| Label | `12px` | `12px` | `600` | `1.40` |

Only use font weights `400`, `600`, and `700`.

- Use `400` for normal reading.
- Use `600` for controls, labels, and short emphasis.
- Use `700` for headings and rare strong emphasis.

Do not use small weight differences such as `720`, `750`, `760`, `780`, or
`800`. They create noise without adding a useful level.

Use size and spacing before adding weight. Do not make every label bold. Keep
body text at a readable `16px`; do not shrink important context to make a page
look lighter.

Keep prose near `68ch` or less. Use negative letter spacing only on large
titles. Use wider letter spacing only for short uppercase labels.

## Color and surfaces

Use a neutral page, a neutral panel, and one main accent color.

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

- `6px` for small code or status elements;
- `10px` for controls and cards;
- `16px` for a large interactive workspace.

## Components

### Navigation

Navigation shows location; it does not compete with the document title.

- Keep inactive items quiet.
- Mark the current section with one accent line and clear text.
- Keep each target at least `44px` high.
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

- Use one column below `760px` unless a small direct comparison still fits.
- Do not create horizontal page scrolling. A wide table or code sample may
  scroll inside its own region.
- Keep controls and navigation targets at least `44px` by `44px`.
- Show a strong keyboard focus indicator.
- Keep the reading order and keyboard order the same.
- Give form controls clear labels and state feedback.
- Respect reduced-motion settings.
- Keep the document useful without animation.

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

## Changing this system

Update this file when a design rule should apply across Hope. Keep a rule near
a feature when it is specific to that feature.

Add a new spacing value, type style, color, radius, or component only when an
existing rule cannot express a real user need. A one-off visual preference is
not enough.

## Research references

These sources informed the rules above. They are useful context, not Hope's
authority.

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
