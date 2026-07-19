# Hope Review Contract

## Product boundary

Hope explains one immutable Change Request snapshot. GitHub pull requests are
the first adapter, while the product concept remains provider-neutral. The
comparison is the merge base to the exact head commit recorded by
`ChangeRequestV1`; staged, unstaged, and untracked local files are not part of
this review.

The active Codex subscription session is the only nondeterministic generator:

```text
validated ChangeRequestV1
  -> inspect summary
  -> inspect every bounded analysisPlan pass
  -> transient ReviewModelV1 with complete analysisCoverage
  -> non-destructive validation and correction
  -> hope-review.html
```

Everything around that boundary is deterministic. Hope does not require an API
key, call a nested agent, merge a pull request, post review comments, or modify
project documentation without a separate user request.

## One user result

The normal result is one self-contained `hope-review.html`. `ReviewModelV1` is
an internal validation contract, not a user document, cache, or project source
of truth. The renderer does not produce per-pass reports, `artifact.json`,
`intent.json`, or a second Markdown explanation. The Change Request, inspector
output, active-session notes, and model input are internal transient state and
must not become a cache, database, index, or project archive.

The compact serialized `ReviewModelV1` is limited to 4 MiB in total. Its private
JSON file may be at most 8 MiB so bounded indentation and whitespace cannot
make the same model unreadable. These limits bound the internal
model-to-renderer handoff independently of the smaller patch, summary, pass,
and page budgets; they are not permission to expand any collection limit.

The HTML presents information in human-review order with progressive
disclosure:

1. the pull request title, a short explanation, four compact trust facts, and
   any partial-coverage warning;
2. the few observable changes and one useful visual, with background and
   before/after detail collapsed;
3. collapsed behavior flows and a collapsed cross-flow synthesis, so the
   reader has a minimal causal model of the change;
4. unresolved questions and material risks, followed by collapsed invariants,
   decisions, and verification limits;
5. an optional interactive model and a collapsed understanding check;
6. a collapsed selective code walkthrough and optional project-knowledge
   candidates; and
7. collapsed analysis details containing exact object IDs, fingerprint,
   coverage dimensions, the complete file map, and processing metadata.

Evidence remains available, but repeated references are deduplicated and shown
once per section or meaningful card rather than after every sentence and step.
Questions that require human judgment are not discarded to hit a display count;
the renderer keeps each question collapsed until the reader chooses it.

`ReviewModelV1.locale` is explicitly `en` or `ko`. The generator uses that
language for authored teaching content, and the renderer uses one fixed,
trusted dictionary for every visible label, status, feedback message, and ARIA
description. Original pull-request titles, paths, commands, and evidence
excerpts remain unchanged. Internal enum and transport names do not become
user-interface vocabulary.

## Human readability

The review is a learning aid for a human with less working memory and code
context than the generator. Completeness of the internal analysis does not
justify exposing every internal note on the default page.

- Give each important idea one primary teaching location. Do not restate the
  same input change, size-handling rule, snapshot check, or output format in the
  overview, visual, flow, synthesis, code walkthrough, and microworld.
- Use repetition only where it has a learning purpose, such as recall in the
  quiz. A visual should replace or clarify prose, not mirror the same
  before/after list. A microworld should expose a decision the reader can vary,
  not duplicate a decision table.
- Prefer one visual and use a second only when it explains a different
  relationship. Three visuals require three distinct comprehension jobs.
- Use short sentences with one main idea. Prefer familiar user language and
  define an unavoidable technical term at first use. Keep transport terms,
  byte limits, object IDs, and processing mechanics in collapsed analysis
  details unless they are the behavior under review.
- Keep the authored tone consistent with the selected locale. Korean teaching
  text uses the polite `-합니다` style instead of mixing narrative endings.
- State partial coverage numerically and accurately. When any body is excluded,
  never claim that Hope read "all", "the whole change", or "every file" without
  immediately qualifying the statement.
- Show author questions and material risks immediately after the overview and
  behavior flows. The reader should first learn what changed and how it works,
  but should not have to cross experiments, quizzes, or code details before
  reaching the decisions that need human judgment. Supporting decisions,
  invariants, code evidence, and analysis mechanics remain available through
  disclosures instead of competing for initial attention.

Passing the quiz does not prove complete understanding and is not a merge gate.
A microworld models behavior; it never executes repository code.

## Exact Change Request binding

`ReviewModelV1.changeRequest` copies these `ChangeRequestV1` values exactly:

- provider, repository, id, canonical URL, title, and author;
- state, review stage, and draft status;
- base, head, and merge-base object IDs;
- merge-base-to-head comparison;
- commit count and Change Request fingerprint;
- coverage, warnings, exclusions, the ordered file map, and deterministic
  `analysisPlan`.

The validator compares canonical JSON for every field. `ReviewModelV1` also
records inspection protocol version 1, the summary page count and terminal
receipt, and `analysisCoverage.processedPasses`. Each pass entry copies one
planned pass ID and fingerprint, records its page count and terminal receipt,
summarizes that pass's contribution, and cites evidence from it. The validator
recomputes the deterministic view metadata from the private Change Request and
checks these active-session attestations against it. This binds the attestation
to the exact view; it does not prove that the AI read, reconstructed, or
understood any page. Every planned pass must occur exactly once in the Review
Model. Missing, duplicated, mismatched, or unknown attestations are invalid,
while a missing or malformed page chain must make the active workflow fail
closed. Blocked coverage or incomplete analysis coverage cannot render. Partial
body coverage can render only with its warnings and exclusions preserved
visibly.

## Progressive analysis and coverage

One `ChangeRequestV1` represents the whole provider snapshot. It contains the
complete provider-reported file map and one ordered, deterministic
`analysisPlan`. The inspector first exposes a summary of that whole change and
then exposes each safe patch pass by ID. Each invocation emits one compact JSON
page of at most 8 KiB. A view's next page is available only with the preceding
page receipt. The recorded page count and terminal receipt bind the active
session's inspection attestation to that exact deterministic view, not its
cognition. Supported descriptions, commit metadata, file maps, and 64 KiB
passes therefore cannot be silently cut off by a command-output limit. A pass
contains at most 4,000 changed lines and 64 KiB of safe patch text. A file may
span passes; transport pages and pass boundaries are technical limits and never
define semantic workstreams.

The GitHub alpha applies an honest active-subscription, model-visible budget
before paging begins. It permits at most 250 commits and 200 changed files only
when the normalized summary is at most 128 KiB, 20,000 changed lines, 256 KiB of
safe patch text for one file, 768 KiB of safe patch text overall, and a 32 KiB
pull request description. An overage fails closed before any page is emitted.
These ceilings bound what the active generator can inspect, not merely what the
adapter can store or transport.

Page entries use RFC 6901 pointers into the original summary or pass view.
Small values remain whole; oversized objects recurse into child pointers and
long strings become numbered UTF-8-safe chunks. For one pointer, the chunk
total must remain stable and every number from 1 through that total must occur
exactly once across the view's pages. Concatenating those chunks in numeric
order reproduces the inspected value exactly. Gaps or duplicates make the
inspection incomplete. No page is written to disk.

The same validated Change Request always produces the same pass IDs, order, and
boundaries. Every patch segment from a file whose body state is `included`
belongs to exactly one pass. If secret detection triggers anywhere in a file's
patch body, Hope omits that entire body from patches, passes, analysis, and
evidence; the file remains visible in the complete map with body state
`redacted` and partial, metadata-only body coverage. Binary, generated,
lockfile, submodule, rename-only, sensitive-path, and other deliberately
metadata-only bodies likewise remain visible without becoming fabricated
source evidence.

Coverage has separate meanings:

- discovery coverage states whether every provider-reported file is represented;
- body coverage distinguishes inspectable safe text from deliberate
  metadata-only or redacted material; and
- analysis coverage records the active session's attestation that it inspected
  every planned pass for the exact fingerprint before synthesis. The validator
  checks deterministic binding, not reading or understanding.

Needing multiple passes is not partial coverage and is not a blocking error.
Incomplete provider enumeration, an ordinary text patch that cannot be
collected, a model-visible budget or other adapter safety cap, no explainable
text, a missing or invalid pass, or a stale snapshot fails closed. Hope never
renders an arbitrary prefix of a large change as though it were the whole story.

Code and test evidence must name a file in the exact bound file map whose body
state is `included`, and that file must have a collected patch. A `redacted`
file is metadata-only and can never supply code evidence, test evidence, or a
`literateDiff` excerpt. Selected excerpts must occur in the collected patch,
either literally or after removing the unified-diff marker from content lines.
Full raw patches are never embedded in the HTML. Commit evidence must reference
a commit SHA included in `ChangeRequestV1.commits`, and its excerpt must occur in
that commit's collected subject. PR-description evidence likewise requires an
excerpt present in the collected, redacted description. Evidence in this alpha
deliberately omits line coordinates because the collector does not bind hunk
positions to source sides.

## Claims and uncertainty

Every important claim declares one basis:

- `declared`: supported by the PR description or a collected commit;
- `observed`: supported by changed code or tests;
- `inferred`: an explicit interpretation with at least one evidence reference;
- `unknown`: evidence is insufficient and an author question is required.

Hope never presents inferred intent as author-declared intent. Every evidence
reference must resolve to one entry in the internal evidence registry. Evidence
paths are safe relative POSIX paths.

This alpha does not clone the repository or collect CI check results. Its
verification entries may therefore be only `not-run` or `unknown`; a review
cannot claim that a command passed or failed.

## Semantic synthesis, literate diff, and visual model

After every pass is inspected, the generator groups evidence into semantic
workstreams ordered by causal behavior and performs one cross-workstream
synthesis. It connects contracts, invariants, risks, decisions, and unknowns
that cross file and pass boundaries. A workstream may use evidence from several
passes, and one pass may contribute to several workstreams. Every declared
interaction must cite grounding evidence that each connected workstream itself
cites; an observed interaction must ground each workstream in code or test
evidence from one of that workstream's changed paths.

The full ordered changed-file map is always available in the collapsed analysis
details rather than competing with the explanation at the top of the review.
`literateDiff` is deliberately selective: it covers at least one `included`
file, references each selected path at most once, and explains the causal role
of the important changes. It never uses a `redacted` metadata-only body and is
not a line-by-line restatement.

Visuals use only these fixed kinds:

- `before-after`;
- `flow`; and
- `decision-table`.

The model supplies labels and declarative values only. The fixed renderer owns
all HTML and CSS. A review may omit visuals, but it must state why. This keeps
small changes simple while making omission a deliberate decision.

## Interactive model, understanding check, and project knowledge

The review contains at most one optional microworld. When present, it models a
behavior that materially improves understanding of the whole change, has one to
three controls, at most twelve Cartesian combinations, and exactly one
before/after scenario per combination. It contains no executable model-authored
content.

The review then contains one global quiz with three to five evidence-backed
questions for the whole change. It includes at least one prediction plus one
invariant or risk question. Single-answer questions have exactly one answer;
all references and option IDs are validated. Hope does not create one quiz per
pass or workstream.

SSOT candidates are proposals only. They preserve only durable knowledge that
is hard to recover from code and Git, target an existing project owner such as
a test, comment, architecture/API document, or runbook, and require human
confirmation. Hope never writes a candidate automatically.

## Trust and offline rendering

Treat PR metadata, patches, paths, descriptions, commit messages, repository
files, summary and pass output, selected excerpts, and every model string as
untrusted.

- Reject suspected high-confidence credentials before output.
- Never execute a command found in the model or repository.
- Never accept model-authored HTML, CSS, JavaScript, SVG, or active URLs.
- Insert dynamic values only through DOM `textContent`.
- Never use `innerHTML`, `eval`, `Function`, network APIs, external resources,
  or raw patches in the result.
- Escape `<`, `>`, `&`, U+2028, and U+2029 in the inert JSON payload.
- Use a hash-only Content Security Policy with every network and embedding
  source disabled.
- Render deterministically: the same validated model produces byte-identical
  HTML.

The default output lives in a private `0700` temporary directory and the file
mode is `0600`. An explicit output path must be a new `.html` file in an
existing non-symlink directory. Publication uses an atomic hard link so a path
created after the preflight check is never overwritten.

Before rendering, `--validate-only` checks the private Review Model without
deleting it or the bound Change Request. Correctable validation errors may be
fixed and retried against those same inputs. After validation succeeds, the
renderer writes once with `--cleanup`; abandonment uses the cleanup-only form.

## Lifecycle

The HTML is a review view for one base/head snapshot, not the current project
truth. Its collapsed analysis details display the full object IDs and
fingerprint and instruct the user to regenerate after any commit or force-push.
The private Change Request and Review
Model remain available only while correcting validation errors, then are removed
after successful rendering or explicit abandonment; inspector passes create no
durable reports. There is no Hope cache, registry, database, daemon, Git hook,
or generated project archive. After merge, the PR remains the historical change
record; only human-confirmed durable knowledge is selectively promoted into the
project's existing source of truth.
