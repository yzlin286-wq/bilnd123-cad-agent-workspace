# Build123d CAD Agent

AI CAD Agent workspace built with Next.js, React, Three.js, and build123d.

The product surface is intentionally user-facing: users start with natural language, then watch an agent workstream create an engineering spec, run the CAD kernel, validate geometry, and expose real artifacts for preview and download.

Current stage: `v0.6 staging hardening`.

## Product Shape

- Landing page: `Build CAD with natural language`
- Workspace: narrow history rail, ChatGPT-like agent thread, and CAD artifact canvas
- Workstream: understanding request, engineering spec, build123d source, CAD kernel, STEP export, preview mesh, validation, packaging
- CAD Canvas tabs: Preview, Drawing, Parameters, Files
- No user-facing internal control panels
- Supported CAD templates: `mounting_plate` and `l_bracket`
- Upload sketch: visible as `Coming soon`, disabled until image-to-CAD is implemented

Not currently supported:

- Sketch/image upload to CAD
- Arbitrary CAD parts beyond the supported templates
- Assemblies
- Complex production drawings
- Public anonymous production traffic
- Payment, tenancy, BOM, or RFQ flows

## No Fallback Policy

This project must not fabricate CAD or agent results.

- Natural-language generation goes through `POST /api/agent/run`.
- `/api/agent/run` requires a real OpenAI-compatible model endpoint.
- The only allowed model fallback is a configured downgrade to another real model.
- If the AI engine is missing, the UI shows a friendly connection message and does not generate fake CAD.
- Parameter rebuilds go through `POST /api/cad/rebuild` and require a real `CAD_RUNNER_COMMAND`.
- If build123d is unavailable, the runner exits non-zero and no fake artifacts are produced.
- Model API keys must exist only in server environment variables. Do not expose them with `NEXT_PUBLIC_`.

## Real CAD Artifacts

The runner currently supports:

- `mounting_plate`: length, width, thickness, holeDiameter, edgeOffset, chamfer
- `l_bracket`: length, height, width, thickness, holeDiameter, edgeOffset, chamfer

The build123d runner writes real files under `outputs/cad/<revision>/`:

- `model.step`
- `model.stl`
- `drawing.svg`
- `source.py`
- `spec.json`
- `validation.json`
- `manifest.json`
- `package.zip`
- `run.log`

`validation.json` is based on real build123d/STEP evidence:

- generated part bounding box
- STEP reload bounding box
- solid count
- face/edge count
- cylindrical hole-face count
- hole radius measurement
- exported file sizes
- partType check

## Stack

- Next.js 16 and React 19
- React Three Fiber and Three.js for real STL preview
- build123d for CAD generation and STEP/STL export
- Lucide icons and custom CSS for the AI product shell

## Environment

Copy `.env.example` to `.env.local` and set real values:

```bash
CAD_AGENT_BASE_URL=https://api.example.com/v1
CAD_AGENT_API_KEY=replace-with-real-key
CAD_AGENT_PRIMARY_MODEL=primary-real-model
CAD_AGENT_DOWNGRADE_MODEL=secondary-real-model
CAD_RUNNER_COMMAND=python scripts/run_build123d.py
STAGING_BASIC_AUTH_USER=replace-with-staging-user
STAGING_BASIC_AUTH_PASSWORD=replace-with-strong-staging-password
MAX_PROMPT_CHARS=2000
CAD_RUNNER_TIMEOUT_MS=60000
CAD_MAX_CONCURRENT_RUNS=1
CAD_OUTPUT_RETENTION_HOURS=72
CAD_OUTPUT_MAX_BYTES=1073741824
```

For local build123d validation on Windows:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:CAD_RUNNER_COMMAND = '.\.venv\Scripts\python.exe scripts/run_build123d.py'
npm run dev
```

## Commands

```bash
npm install
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
npm run cleanup:cad
npm run runs:summary
npm run failures:export
```

CI runs `npm ci`, lint, typecheck, unit tests, production build, and Python build123d smoke tests for both `mounting_plate` and `l_bracket`. The runner smoke also checks `package.zip`.

Local development URL:

```text
http://127.0.0.1:3000
```

## Main APIs

- `GET /api/health`: safe health summary for staging
- `POST /api/agent/run`: SSE agent orchestration endpoint
- `POST /api/agent/revise`: SSE revision endpoint that applies `currentSpec + specDelta` by default
- `POST /api/cad/rebuild`: rebuilds a revision from an explicit parameter/spec payload
- `GET /api/artifacts/[id]`: streams generated artifacts from local output storage

Legacy diagnostic endpoints may remain for development, but the user-facing app is driven by the agent/rebuild/artifact flow above.

## Staging

- Deployment guide: `docs/STAGING_DEPLOYMENT.md`
- HTTPS guide: `docs/HTTPS_STAGING.md`
- Operations guide: `docs/OPERATIONS.md`
- 48-72 hour test protocol: `docs/STAGING_TEST_PROTOCOL.md`
- Docker compose file: `docker-compose.staging.yml`
- HTTPS compose example: `docker-compose.staging.https.yml`
- Manual smoke: `npm run smoke:staging`

Staging must be protected with Basic Auth and is not suitable for public anonymous traffic. Basic Auth should not be used long-term over plaintext HTTP; use HTTPS, a private tunnel, Tailscale, or IP allowlist before broader internal testing.
