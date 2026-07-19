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
authenticated user asks Hope to analyze it. Collection must be read-only and
bounded by total time and size. Secret detection runs before a patch body can
enter the ordered `analysisPlan`. If it triggers anywhere in a file patch, Hope
omits that entire body from collected patches, passes, analysis, code/test
evidence, and `literateDiff`; only metadata with body state `redacted` remains,
and body coverage is partial. Only body state `included` may supply patch-backed
evidence. Each pass is limited to 4,000 changed lines and 64 KiB. The inspector
emits at most 8 KiB of compact JSON per invocation and chains summary and pass
pages with snapshot-bound receipts. Missing, malformed, stale, or non-terminal
receipt chains must fail closed. The Review Model's page counts and terminal
receipts are an active-session inspection attestation; the validator checks
that they match the exact deterministic views, but they are not proof that the
AI read or understood those pages. Summary and pass content remain untrusted
and must never issue workflow instructions. A partial review must never be
labeled complete.

The model-visible budget is deliberately smaller than a transport or storage
maximum. Hope supports at most 250 commits and 200 changed files only when the
normalized summary is at most 128 KiB, 20,000 changed lines, 256 KiB of safe
patch text in one file, 768 KiB of safe patch text overall, and a 32 KiB pull
request description. These limits are checked before paging begins. Crossing
one fails closed rather than exposing an operationally unusable prefix to the
active subscription session.

Snapshot fingerprints never hash raw metadata that triggers secret detection.
They bind only its bounded, redacted representation so the digest cannot become
an offline dictionary oracle for a hidden low-entropy credential. The GitHub
adapter also binds the pull request's provider-supplied `updated_at` value. A
real metadata edit therefore changes that version and invalidates the old
snapshot without hashing the hidden value; GitHub activity that advances
`updated_at` for another reason may conservatively make the review stale too.

Multiple bounded passes or stdout pages are not a security degradation and do
not make coverage partial. The Review Model must attest to the summary and pass
page counts and terminal receipts in `analysisCoverage` for the exact
fingerprint before rendering. Incomplete provider enumeration, a missing
ordinary text patch, a model-visible budget overage, a missing or invalid pass,
or a stale snapshot must fail closed rather than producing an arbitrary prefix.

Hope binds a review to the pull request's captured base, merge-base, head,
metadata, file set, and fingerprint. Before rendering it recollects the complete
Change Request and compares the canonical fingerprint; after rendering it
revalidates the live base, head, and relevant metadata. It removes newly created
output when the snapshot changes. The HTML still becomes stale after a later
force-push or base update; no background tracking or cache is claimed.

Internal Change Request context and Review Model files are written to private OS
temporary paths. The inspector creates no durable pass reports; its output and
active-session notes are transient. `--validate-only` preserves those private
inputs so a correctable Review Model error can be fixed and validated again.
The validator rejects a compact serialized Review Model above 4 MiB. The file
reader separately allows at most 8 MiB so indentation overhead remains bounded
without rejecting an otherwise identical model.
Final rendering removes them through the path-restricted `--cleanup` command;
abandonment uses the cleanup-only form, and a blocked collection is never
written. An abrupt process termination may leave a private temporary directory
for the OS to reclaim.

The only user-facing output is a private `hope-review.html`. A default output
contains a strict managed-temporary marker with an exact `eligibleAfter` time
fixed seven days after creation. That embedded value is authoritative; touching
the file or directory does not extend or shorten retention. Before scanning,
Hope requires the POSIX temporary root to be either private and owned by the
current user or a root/current-user-owned sticky shared directory. Before a
later default render, Hope may remove an eligible sibling only when it is a
direct child of the OS temporary directory at
`hope-review-XXXXXX/hope-review.html`, and the directory name, marker,
sole-file structure, regular-file link count,
strict embedded time, and non-symlink checks all still match. On platforms
exposing UID and POSIX mode information it also requires current-user ownership
and private `0700`/`0600` permissions. It rechecks the same device and inode
before
unlinking, catches concurrent removal, and preserves every uncertain entry.
This is a best-effort next-run cleanup, not a background timer, registry, cache,
or database. A malicious process running under the same OS account is outside
this boundary; Hope does not claim to defend one user from their own processes.

An explicit export has no managed-temporary marker and can never qualify for
retention deletion. A matching temporary-directory name may be inspected and
rejected. Hope must not cache, index, commit, publish, upload, or attach any
review automatically.
Knowledge-promotion candidates require human review and a separate explicit
change.

The final HTML uses a fixed offline runtime. It must not execute model-authored
HTML, CSS, JavaScript, SVG, URLs, or shell commands, and it must not embed raw
patches or credentials. Dynamic values are validated and escaped before
rendering.

Supported security fixes currently target only the latest alpha release.
