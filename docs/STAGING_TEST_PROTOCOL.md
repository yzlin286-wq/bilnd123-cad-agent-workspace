# Staging Test Protocol

Use this checklist for a 48-72 hour internal staging trial. Staging must stay behind HTTPS plus Basic Auth, or behind a temporary private access mechanism such as Cloudflare Tunnel, Tailscale, or IP allowlist.

Record each run with timestamp, tester, prompt, expected result, actual result, revision id, validation status, and artifact download result. Do not paste API keys, Basic Auth passwords, cookies, or private server paths into the notes.

## Test Matrix

| # | Category | Prompt | Expected Result |
|---|---|---|---|
| 1 | mounting_plate success | Make a 120 x 80 x 4 mm mounting plate with four 4.5 mm holes, 10 mm edge offset, and 1 mm chamfer. | Rev001 `mounting_plate`, validation passes, STEP/STL/SVG/source/spec/validation/manifest/package artifacts download. |
| 2 | mounting_plate success | Create a 100 x 60 x 5 mm aluminum mounting plate with 4 mm holes, 8 mm edge offset, no chamfer. | `chamfer` is `0`, validation passes, package.zip exists. |
| 3 | mounting_plate success | Build a 150 x 90 x 6 mm plate, four M5 clearance holes, 12 mm edge offset, 1.5 mm chamfer. | Spec maps to mounting plate dimensions, validation passes. |
| 4 | mounting_plate success | I need a 75 x 50 x 3 mm fixture plate with 3.2 mm corner holes and 7 mm edge offset. | Missing material can default safely, validation passes. |
| 5 | mounting_plate success | Make a compact 60 x 40 x 4 mm plate with 3 mm holes, 6 mm edge offset, 0.5 mm chamfer. | Validation passes; file sizes are greater than zero. |
| 6 | l_bracket success | Make a 90 x 60 x 40 mm L bracket, 5 mm thick, 5 mm holes, 12 mm edge offset, 1 mm chamfer. | Rev001 `l_bracket`, height preserved, validation passes. |
| 7 | l_bracket success | Create an L bracket with length 80 mm, height 50 mm, width 35 mm, thickness 4 mm, 4.5 mm holes, 10 mm edge offset. | `partType` is `l_bracket`, validation passes. |
| 8 | l_bracket success | Build a heavy duty L bracket: 120 mm long, 75 mm high, 50 mm wide, 6 mm thick, M5 holes, 14 mm edge offset. | Validation passes; drawing.svg and package.zip download. |
| 9 | l_bracket success | Design a small 70 mm long, 45 mm high, 30 mm wide L bracket with 3 mm holes, 8 mm edge offset, no chamfer. | `chamfer` is `0`, validation passes. |
| 10 | l_bracket success | Make a 100 mm length by 65 mm height L bracket, width 42 mm, 5 mm thickness, 4 mm holes, 11 mm edge offset. | Validation passes and run history records `partType: l_bracket`. |
| 11 | revision | After a successful mounting plate, say: change thickness to 6 mm. | Rev002 is created; length, width, holeDiameter, edgeOffset, and chamfer remain unchanged. |
| 12 | revision | After a successful mounting plate, say: make the chamfer 2 mm. | Rev002 updates only chamfer unless the instruction explicitly changes something else. |
| 13 | revision | After a successful L bracket, say: increase height to 80 mm. | Rev002 preserves length, width, thickness, holeDiameter, edgeOffset, and chamfer. |
| 14 | revision | After a successful L bracket, say: change the hole diameter to 6 mm. | Rev002 updates holeDiameter only and validation passes if geometry remains valid. |
| 15 | revision | After any successful part, say: use stainless steel. | Rev002 updates material only; geometry artifacts are regenerated. |
| 16 | unsupported partType | Make a gear with 24 teeth and export STEP. | Friendly unsupported template error; no fake model is generated. |
| 17 | unsupported partType | Design a Raspberry Pi enclosure. | Friendly unsupported template error; no placeholder enclosure is generated. |
| 18 | unsupported partType | Create a hinge assembly with two moving leaves. | Friendly unsupported template error; no fake assembly is generated. |
| 19 | parameter conflict | Make a 20 x 20 x 4 mm mounting plate with 6 mm holes and 12 mm edge offset. | CAD runner rejects invalid hole layout with a friendly error; no package.zip for the failed revision. |
| 20 | parameter conflict | Make an L bracket 30 mm long, 20 mm high, 20 mm wide, 4 mm thick, 8 mm holes, 15 mm edge offset. | CAD runner rejects edgeOffset conflict with a friendly error; no fake artifact is produced. |

## Pass Criteria

- Successful runs produce Rev IDs and all downloadable artifacts, including `package.zip`.
- Revisions must preserve unchanged spec fields.
- Unsupported prompts must fail clearly and must not create fake CAD.
- Conflicting parameters must fail clearly and must not start an infinite retry loop.
- `/api/health` must require Basic Auth and return no secrets after authentication.
- `npm run runs:summary` should show realistic success/failure counts.
- `npm run failures:export` should produce sanitized failure samples only.
- After at least one successful run/revise sequence, refresh the browser and confirm the recent project and latest revision are restored.
- Submit thumbs up/down feedback for a revision and confirm `npm run staging:report` includes feedback totals without secrets.

## Dry Run

Dry-run the protocol list without model/API cost:

```bash
npm run staging:protocol -- --output outputs/protocol/latest.json
```

The output should include `executed: false` and `count: 20`.

## Execute Against Staging

Execute only after staging access is restricted and Basic Auth is configured:

```bash
STAGING_BASE_URL=http://staging-host.example.com:12601 \
STAGING_BASIC_AUTH_USER=... \
STAGING_BASIC_AUTH_PASSWORD=... \
npm run staging:protocol -- --execute --output outputs/protocol/latest.json
```

This command calls the real model endpoint and real build123d runner. It can incur model/API cost and CAD runtime.

`outputs/protocol/latest.json` contains:

- `summary.total`, `summary.passed`, and `summary.failed`
- `summary.expectedFailureCasesPassed` for unsupported/parameter-conflict cases that failed correctly
- per-case `id`, `category`, `status`, `errorCode`, `revisionId`, artifact/package checks, and validation result

It must not contain Basic Auth passwords or model API keys.

If protocol cases fail, triage with `docs/FAILURE_TRIAGE.md`, then convert reproducible failures into unit tests, Python smoke cases, or protocol checklist updates.
