# Security

Do not open a public issue for a bug that could expose source code, credentials,
private pull request data, or generated executable content. Use GitHub's private
security advisory flow for this repository.

## Trust boundary

Hope treats these values as untrusted data:

- pull request titles and descriptions;
- commit titles;
- paths and patches;
- repository source;
- text written by an AI model.

Instructions inside that data cannot change the workflow. The final HTML uses a
fixed offline runtime. It does not run model-authored HTML, CSS, JavaScript,
SVG, URLs, or shell commands. Dynamic text is validated and escaped.

## GitHub access

Hope uses the user's existing authenticated GitHub CLI session. Hope does not
ask for a token argument, read token storage, put a token in a command line, or
save credentials. Authentication and repository access remain owned by `gh`.

Private pull request source crosses the active Codex service boundary when the
user asks Hope to analyze it. Collection is read-only and bounded by time and
size.

When `$hope:diff` has no URL, Hope runs a read-only `gh pr list` in the current
working directory and selects by `createdAt`. It does not read source files or
infer a pull request from the current branch during this lookup.

Secret detection is defense in depth, not a guarantee. If a patch body looks
like it contains a secret, Hope excludes the whole body before analysis. Only
safe included bodies may support code or test evidence. Metadata remains so the
review can report partial coverage.

## Complete input and exact snapshot

Hope binds a review to the captured base, merge-base, head, consumed metadata,
file set, and fingerprint. It recollects the full Change Request before render
and checks the live snapshot again after render. A changed snapshot cancels the
result.

The fingerprint uses bounded, redacted metadata. It deliberately does not bind
GitHub's volatile `updated_at` field. A change to data Hope consumes still
invalidates the snapshot.

Hope supports at most:

- 250 commits;
- 200 changed files;
- 20,000 changed lines;
- 256 KiB of safe patch text in one file;
- 768 KiB of safe patch text in total;
- 128 KiB of normalized summary data;
- 32 KiB of pull request description.

Each analysis pass has at most 4,000 changed lines and 64 KiB of safe patch
text. Each inspector response has at most 16 KiB. Crossing a full-input limit
stops the review. Hope does not present a truncated prefix as complete.

Every summary and pass page is linked by a snapshot-bound receipt. The review
model records the page count and terminal receipt in `analysisCoverage`. The
validator checks the exact values. They are an inspection record, not proof of
AI reading or understanding.

## Private run state

`DiffRun`, Change Request, Review Model, and cleanup plans use private operating
system temporary directories. Files use private permissions where the platform
supports them. State writes are atomic. Run updates use a lock so two commands
cannot silently overwrite each other.

The compact Review Model limit is 4 MiB. The JSON file reader allows 8 MiB so
normal indentation does not reject the same model.

An interrupted process can leave private state behind. `$hope:cleanup` lists
only terminal diff runs. Active or uncertain runs stay in place.

## Managed reviews

A default `hope-review.html` has a strict `eligibleAfter` marker fixed seven
days after creation. Touching the file does not change that time. A later
default render may remove an eligible managed review.

Hope accepts a managed review only when all supported checks match:

- it is a direct `hope-review-XXXXXX/hope-review.html` child of a safe temporary
  root;
- the directory and file are not symbolic links;
- the marker, owner, private permissions, file type, link count, and sole-file
  layout match;
- the file and directory identity still match immediately before removal.

An explicit export does not have the managed marker. It is never a cleanup
target. The renderer refuses to overwrite an existing path. It stages an export
privately and publishes it only after the final snapshot check.

## Explicit cleanup

Cleanup is fail-closed and has two phases. Preview writes a private plan with
the exact target paths and file identities. Apply requires the exact plan path
and digest. It checks every target again and skips anything that changed.

The current cleanup can remove managed reviews and completed or cancelled diff
runs. It cannot remove exports, active runs, project files, worktrees, or Git
branches.

Branch deletion will require a Hope-created branch record. A branch name or
prefix will never be enough. Remote branch deletion is outside the current
scope.

A malicious process running as the same operating-system user is outside this
boundary. Hope does not claim to protect one user from their own processes.

Supported security fixes target the latest alpha release.
