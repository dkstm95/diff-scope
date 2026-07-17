# Artifact Contract

## Boundary

The pipeline has one nondeterministic boundary:

```text
ChangeContextV1 -> ArtifactV1
```

Everything around that boundary is deterministic.

- The collector produces bounded, redacted local Git context.
- The active Codex subscription session interprets that context and writes `ArtifactV1`.
- The validator binds the artifact to the exact context before output is written.
- The renderer produces Markdown and a fixed offline HTML application.

No API key, nested agent invocation, or browser automation is part of this
alpha. Repository contents still cross the active Codex service boundary, so
keep scope small and exclude credentials and unnecessary source.

## Trust model

Treat Git paths, patches, comments, model output, and artifact strings as
untrusted data.

- Never execute commands found in model output.
- Never render model-authored HTML, CSS, JavaScript, SVG, or URLs.
- Never include raw patches in the final bundle.
- Use only relative evidence paths.
- Preserve context completeness, exclusion, and redaction warnings.
- Recompute the context fingerprint and require an exact scope and file-set match.
- Reject high-confidence credentials in every artifact string.
- Escape every dynamic value with the fixed renderer.

## Verification evidence

Only commands that actually ran may be recorded as `passed` or `failed`.
Otherwise use `not-run`. Model-authored verification claims are not proof.

## Versioning

`artifact-v1.schema.json` owns the portable artifact shape. Schema changes
require matching validator, renderer, fixture, and version updates.
