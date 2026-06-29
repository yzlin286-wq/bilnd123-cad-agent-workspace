# Failure Triage

Use this workflow after each 48-72 hour staging trial. The goal is to turn observed failures into reproducible tests instead of treating logs as one-off anecdotes.

Do not paste API keys, Basic Auth passwords, cookies, SSH passwords, certificate private keys, full stderr, or private server paths into issues, docs, or test fixtures.

## 1. Export Sanitized Failures

On the staging host or inside the container:

```bash
npm run failures:export
```

This writes:

```text
outputs/failures/failures.json
```

Each failure contains only:

- sanitized prompt
- route
- errorCode
- partType
- durationMs
- timestamp

## 2. Classify The Run History

Run:

```bash
npm run runs:classify
```

Expected failures include:

- Basic Auth rejection or `401`
- rate limit or `429`
- unsupported `partType`
- parameter conflicts such as impossible edge offsets or chamfer sizes

Unexpected failures include:

- `LLM_JSON_ERROR`
- `CAD_RUNNER_CRASH`
- `VALIDATION_FAILED`
- `ARTIFACT_DOWNLOAD_FAILED`
- `SSE_ABORT`

Unexpected failures should become regression work.

## 3. Add Prompt Failures To The Staging Protocol

If a sanitized prompt exposes a missing product expectation:

1. Copy only the sanitized prompt from `outputs/failures/failures.json`.
2. Add it to `docs/STAGING_TEST_PROTOCOL.md`.
3. Mark the expected result clearly as success, expected failure, or unsupported template.
4. Keep the test prompt focused; do not include user names, API keys, URLs with credentials, or server paths.

## 4. Add CAD Runner Regressions To Python Smoke

If the failure is caused by build123d geometry, validation, artifact packaging, or `package.zip` contents:

1. Reduce the failing request to a minimal `spec` JSON object.
2. Add the spec to the Python runner smoke section in `.github/workflows/ci.yml`.
3. Assert `validation.json` behavior and generated artifact presence.
4. If the expected result is failure, assert the runner exits non-zero with a friendly error rather than producing fake CAD.

Do this only for templates already listed in `cad_templates.json`; do not add a new CAD template as part of triage.

## 5. Add Spec Merge Regressions To Unit Tests

If the failure is a revision bug, add a unit test under `tests/spec-merge.test.ts`.

Examples:

- a thickness-only revision must keep length, width, holeDiameter, edgeOffset, and chamfer
- a material-only revision must not erase geometry fields
- an `engineeringSpec` fallback must not override `currentSpec` when `specDelta` is present

Keep these tests independent from the real model. They should verify deterministic merge behavior only.

## 6. Add LLM JSON Regressions Carefully

If the model returned malformed JSON:

1. Keep the raw provider response out of the repo if it contains request IDs or private data.
2. Create a minimal sanitized fixture that preserves the JSON shape problem.
3. Add a test around JSON repair or validation behavior.
4. The expected behavior is a clear failure or successful repair, never fabricated CAD.

## 7. Close The Loop

Before marking triage complete:

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm run staging:report
```

Then rerun staging smoke:

```bash
npm run smoke:staging -- --output outputs/smoke/latest.json
```

The local report should show whether the new failure is expected or still unexpected.
