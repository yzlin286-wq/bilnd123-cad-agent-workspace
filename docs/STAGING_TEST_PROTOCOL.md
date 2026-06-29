# Staging Test Protocol

Use this checklist for a 48-72 hour internal staging trial. Staging must stay behind HTTPS plus Basic Auth, or behind a temporary private access mechanism such as Cloudflare Tunnel, Tailscale, or IP allowlist.

Record each run with timestamp, tester, prompt, expected result, actual result, revision id, validation status, and artifact download result. Do not paste API keys, Basic Auth passwords, cookies, or private server paths into the notes.

## Test Matrix

| # | Category | Prompt | Expected Result |
|---|---|---|---|
| 1 | mounting_plate success | Make a 120 x 80 x 4 mm mounting plate with four 4.5 mm holes, 10 mm edge offset, and 1 mm chamfer. | Rev001 `mounting_plate`, validation passes, STEP/STL/SVG/source/spec/validation/manifest/package artifacts download. |
| 2 | l_bracket success | Make a 90 x 60 x 40 mm L bracket, 5 mm thick, 5 mm holes, 12 mm edge offset, 1 mm chamfer. | Rev001 `l_bracket`, validation passes, package artifacts download. |
| 3 | gusset_plate success | Make a 100 mm by 70 mm gusset plate, 6 mm thick, with 5 mm holes. | Rev001 `gusset_plate`, validation passes. |
| 4 | u_bracket success | Build a U bracket 100 mm long, 50 mm wide, 60 mm high, 5 mm thick, with 5 mm holes. | Rev001 `u_bracket`, validation passes. |
| 5 | c_channel success | Create a 160 mm long C channel, 60 mm wide, 40 mm high, 4 mm thick. | Rev001 `c_channel`, validation passes. |
| 6 | angle_bracket_gusset success | Make a gusseted angle bracket 100 mm long, 70 mm high, 50 mm wide, 6 mm thick. | Rev001 `angle_bracket_gusset`, validation passes. |
| 7 | simple_enclosure success | Design a 120 x 80 x 40 mm simple enclosure with 3 mm walls. | Rev001 `simple_enclosure`, validation passes. |
| 8 | enclosure_lid success | Make an enclosure lid 120 x 80 x 3 mm with 3 mm screw holes. | Rev001 `enclosure_lid`, validation passes. |
| 9 | electronics_mounting_base success | Create a 100 x 70 x 4 mm electronics mounting base with 8 mm posts. | Rev001 `electronics_mounting_base`, validation passes. |
| 10 | round_flange success | Make a round flange, 100 mm outer diameter, 10 mm thick, 30 mm center bore, six 6 mm bolt holes. | Rev001 `round_flange`, validation passes. |
| 11 | rectangular_flange success | Create a 120 x 80 x 8 mm rectangular flange with a 35 mm center hole and 6 mm bolt holes. | Rev001 `rectangular_flange`, validation passes. |
| 12 | stepped_shaft success | Make a stepped shaft 120 mm long, 24 mm main diameter, 16 mm secondary diameter, with a 45 mm step. | Rev001 `stepped_shaft`, validation passes. |
| 13 | spacer_standoff success | Generate a 25 mm long spacer standoff, 10 mm outer diameter, 4 mm inner bore. | Rev001 `spacer_standoff`, validation passes. |
| 14 | bushing_sleeve success | Create a bushing sleeve 35 mm long, 22 mm outer diameter, 10 mm bore, with a 32 mm flange. | Rev001 `bushing_sleeve`, validation passes. |
| 15 | shaft_collar success | Make a shaft collar 36 mm outer diameter, 16 mm bore, 14 mm wide, with a 3 mm split slot. | Rev001 `shaft_collar`, validation passes. |
| 16 | pulley success | Create a 60 mm diameter pulley, 18 mm wide, 8 mm bore, with a 3 mm groove. | Rev001 `pulley`, validation passes. |
| 17 | spur_gear success | Make a spur gear with 24 teeth, 80 mm outer diameter, 10 mm wide, and 12 mm bore. | Rev001 `spur_gear`, validation passes. |
| 18 | helical_spring success | Build a 1000 mm long by 200 mm outer diameter helical spring with 12 mm wire and 80 mm pitch. | Rev001 `helical_spring`, validation passes. |
| 19 | hinge_leaf success | Create a hinge leaf 80 mm long, 35 mm wide, 3 mm thick, with a 10 mm barrel. | Rev001 `hinge_leaf`, validation passes. |
| 20 | bearing_mount_block success | Make a bearing mount block 90 x 45 x 40 mm with a 22 mm bore and 6 mm mounting holes. | Rev001 `bearing_mount_block`, validation passes. |

## Pass Criteria

- Successful runs produce Rev IDs and all downloadable artifacts, including `package.zip`.
- Template prompts must resolve to their exact expected `partType`.
- Revisions must preserve unchanged spec fields in separate regression tests.
- Unsupported prompts and conflicting parameters must fail clearly in regression tests and must not create fake CAD.
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
- `summary.expectedFailureCasesPassed` for any future expected-failure cases that fail correctly
- per-case `id`, `category`, `status`, `errorCode`, `revisionId`, artifact/package checks, and validation result

It must not contain Basic Auth passwords or model API keys.

If protocol cases fail, triage with `docs/FAILURE_TRIAGE.md`, then convert reproducible failures into unit tests, Python smoke cases, or protocol checklist updates.
