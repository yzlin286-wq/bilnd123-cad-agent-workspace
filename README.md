# Build123d CAD Agent

AI CAD Agent workspace built with Next.js, React, Three.js, and build123d.

The product surface is intentionally user-facing: users start with natural language, then watch an agent workstream create an engineering spec, run the CAD kernel, validate geometry, and expose real artifacts for preview and download.

Current stage: `v1.2 SaaS access handoff`.

## Product Shape

- Landing page: `Build CAD with natural language`
- Workspace: narrow history rail, ChatGPT-like agent thread, and CAD artifact canvas
- Workstream: understanding request, engineering spec, build123d source, CAD kernel, STEP export, preview mesh, validation, packaging
- CAD Canvas tabs: Preview, Drawing, Parameters, Files
- No user-facing internal control panels
- Supported CAD templates: `mounting_plate` and `l_bracket`
- Upload sketch: visible as `Coming soon`, disabled until image-to-CAD is implemented
- Recent projects, messages, revisions, and artifact metadata persist locally for alpha trials
- Trial feedback captures thumbs up/down and optional comments without user accounts
- `/admin` provides an admin-only alpha usage dashboard
- `/app` provides a protected SaaS dashboard with template cards, recent projects, recent artifacts, usage, and alpha health
- Clerk is the preferred SaaS auth provider; Basic Auth is only a staging access gate when Clerk is configured
- Postgres is the staging SaaS data layer when `DATABASE_URL` is set; JSON remains a dev fallback

Not currently supported:

- Sketch/image upload to CAD
- Arbitrary CAD parts beyond the supported templates
- Assemblies
- Complex production drawings
- Public anonymous production traffic
- Payment, tenancy, BOM, or RFQ flows

SaaS access handoff status:

- Auth: Clerk scaffold is implemented. When Clerk keys are configured, Basic Auth no longer acts as a SaaS identity.
- Admin bootstrap: `npm run admin:bootstrap` creates or updates a Clerk admin user without printing the password.
- Data: `db/schema.sql` defines the Postgres schema and the runtime adapter uses Postgres when `DATABASE_URL` is configured.
- Authorization: artifacts are checked against project/revision ownership before download.
- HTTPS/domain: `docker-compose.staging.https.yml` and Caddy config are provided, but a real domain/DNS setup is still required before claiming HTTPS access.
- Build evidence: set `APP_COMMIT_SHA` in the server-only `.env` before rebuilding so `/api/health`, smoke output, and handoff reports prove the deployed commit.

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
STAGING_ACCESS_MODE=unknown
STAGING_HTTPS_ENABLED=0
APP_COMMIT_SHA=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
DATABASE_URL=
POSTGRES_PASSWORD=
SAAS_ADMIN_USER_IDS=
SAAS_ADMIN_EMAILS=
CAD_OUTPUT_RETENTION_HOURS=72
CAD_OUTPUT_MAX_BYTES=1073741824
```

For Docker staging, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is also a build-time value for the Next.js client bundle. After adding or rotating Clerk publishable keys, rebuild the image with the compose `--env-file .env up -d --build` flow; a container restart alone is not enough.

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
npm run db:migrate
npm run admin:bootstrap
npm run admin:flow:verify
npm run cleanup:cad
npm run runs:classify
npm run runs:summary
npm run failures:export
npm run staging:report
npm run staging:protocol
npm run handoff:current-access
npm run handoff:domain:check
npm run handoff:env:audit
npm run handoff:preflight
npm run handoff:check
npm run release:check
```

CI runs `npm ci`, lint, typecheck, unit tests, production build, and Python build123d smoke tests for both `mounting_plate` and `l_bracket`. The runner smoke also checks `package.zip`.

Local development URL:

```text
http://127.0.0.1:3000
```

## Main APIs

- `GET /api/health`: safe health summary for staging
- `GET /admin`: admin-only alpha usage dashboard
- `GET /app`: signed-in SaaS dashboard
- `GET /app/projects`: signed-in recent projects list
- `GET /api/projects`: recent saved project summaries
- `GET /api/projects/[id]`: saved project, messages, revisions, and artifact metadata
- `POST /api/agent/run`: SSE agent orchestration endpoint
- `POST /api/agent/revise`: SSE revision endpoint that applies `currentSpec + specDelta` by default
- `POST /api/cad/rebuild`: rebuilds a revision from an explicit parameter/spec payload
- `POST /api/feedback`: saves thumbs up/down internal trial feedback
- `GET /api/artifacts/[id]`: streams generated artifacts from local output storage

Legacy diagnostic endpoints may remain for development, but the user-facing app is driven by the agent/rebuild/artifact flow above.

## Staging

- Deployment guide: `docs/STAGING_DEPLOYMENT.md`
- HTTPS guide: `docs/HTTPS_STAGING.md`
- Access control guide: `docs/ACCESS_CONTROL.md`
- SaaS architecture: `docs/SAAS_ARCHITECTURE.md`
- Authorization guide: `docs/AUTHORIZATION.md`
- Data model: `docs/DATA_MODEL.md`
- UI product spec: `docs/UI_PRODUCT_SPEC.md`
- Failure triage guide: `docs/FAILURE_TRIAGE.md`
- Operations guide: `docs/OPERATIONS.md`
- 48-72 hour test protocol: `docs/STAGING_TEST_PROTOCOL.md`
- Docker compose file: `docker-compose.staging.yml`
- HTTPS compose example: `docker-compose.staging.https.yml`
- Manual smoke: `npm run smoke:staging -- --output outputs/smoke/latest.json`

Staging must be protected and is not suitable for public anonymous traffic. Basic Auth may remain as an outer staging gate, but Clerk is the SaaS identity layer once configured. Basic Auth should not be used long-term over plaintext HTTP; use HTTPS, a private tunnel, Tailscale, or IP allowlist before broader internal testing.

Observation tools:

- `npm run runs:summary`: aggregate run counts, duration, validation pass rate, routes, and part types
- `npm run runs:classify`: split failures into expected and unexpected categories
- `npm run failures:export`: write a sanitized failure corpus for triage
- `npm run staging:report`: generate a local sanitized report at `outputs/reports/staging-report.md`
- `npm run staging:protocol`: dry-run the 20-prompt internal trial protocol at `outputs/protocol/latest.json`
- `npm run admin:verify`: verify the declared Clerk admin exists, has password login, and is authorized as admin
- `npm run admin:flow:verify`: verify sanitized evidence for admin login, `/admin`, project create, package download, and cross-owner artifact denial
- `npm run handoff:current-access`: render the current temporary access report without printing passwords
- `npm run handoff:domain:check`: verify DNS, HTTP to HTTPS redirect, HTTPS `/api/health`, and optional IP fallback
- `npm run handoff:env:audit`: audit the server-only `.env` and admin credential file permissions without printing secrets
- `npm run handoff:preflight`: render the private v1.2 access handoff status in the requested Access/Admin format
- `npm run handoff:check`: strict v1.2 SaaS access handoff gate for HTTPS, Clerk, Postgres, and admin credential delivery
- `npm run handoff:report`: render a sanitized v1.2 handoff report from `outputs/reports/v12-handoff-check.json`

`npm run staging:protocol -- --execute --output outputs/protocol/latest.json` calls the real staging service and can incur model/API cost. Use it only when the staging access path and authentication are configured. The v1.2 handoff target expects `STAGING_ACCESS_MODE=https`, `STAGING_DOMAIN=<real-domain>`, and `STAGING_HTTPS_ENABLED=1` once a real domain and certificate are active; until then, `http_restricted` must stay firewall-restricted.

Run `npm run admin:bootstrap` inside the `cad-agent` container, or on a host where `npm ci` has already installed dependencies. The command talks to the real Clerk Backend API, writes the optional server-only credential file with `chmod 600`, persists only safe handoff metadata to `.env` when requested, and never prints the generated password.

For an existing Clerk user, the bootstrap applies `ADMIN_BOOTSTRAP_PASSWORD` by default so the delivered one-time password actually works. Set `ADMIN_BOOTSTRAP_RESET_PASSWORD=0` only when you intentionally do not want to rotate an existing user's password.

Verify the real Clerk admin after bootstrap:

```bash
CLERK_SECRET_KEY=... \
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=... \
V12_ADMIN_EMAIL=admin@example.com \
npm run admin:verify -- --output outputs/reports/v12-admin-verify.json
```

On the staging host, run this inside the application container unless you have also installed host-side npm dependencies:

```bash
docker compose -f docker-compose.staging.yml exec cad-agent \
  npm run admin:verify -- --output /app/logs/v12-admin-verify.json
```

Capture a sanitized admin flow evidence file after the real Clerk admin signs in. The evidence must not include cookies, Basic Auth headers, passwords, API keys, full prompts, traceback text, or provider raw errors.

Use the same `projectId` from `admin_project_create` in the `admin_package_download` check so the package download proves the admin can download the project they just created. For `artifact_cross_owner_forbidden`, include `targetProjectId` for a different project that owns the target `package.zip`; it must not match the project created in this admin flow.

```json
{
  "generatedAt": "2026-06-28T12:00:00.000Z",
  "baseUrl": "https://cad-agent.example.com",
  "adminEmail": "admin@example.com",
  "build": { "commitSha": "85e517e" },
  "checks": [
    { "id": "admin_login", "ok": true, "status": 200 },
    { "id": "admin_page_access", "ok": true, "status": 200 },
    { "id": "non_admin_admin_blocked", "ok": true, "status": 403 },
    { "id": "admin_project_create", "ok": true, "status": 201, "projectId": "..." },
    { "id": "admin_package_download", "ok": true, "status": 200, "artifactName": "package.zip", "projectId": "...", "bytes": 2048 },
    { "id": "artifact_cross_owner_forbidden", "ok": true, "status": 403, "artifactName": "package.zip", "targetProjectId": "different-project-id" }
  ]
}
```

```bash
npm run admin:flow:verify -- --input outputs/reports/v12-admin-flow-evidence.json --expected-commit "$(git rev-parse --short HEAD)" --output outputs/reports/v12-admin-flow-verify.json
```

Run the v1.2 handoff gate only when a real HTTPS domain and Clerk keys are configured:

```bash
npm run handoff:env:audit -- --env-file .env --output outputs/reports/v12-env-audit.md --json outputs/reports/v12-env-audit.json
npm run handoff:domain:check -- --base-url https://cad-agent.example.com --expected-ip 203.0.113.10 --ip-fallback-url http://203.0.113.10:12602 --output outputs/reports/v12-domain-tls-check.json --markdown outputs/reports/v12-domain-tls-check.md

STAGING_BASE_URL=https://cad-agent.example.com \
STAGING_BASIC_AUTH_USER=... \
STAGING_BASIC_AUTH_PASSWORD=... \
V12_EXPECTED_IP=203.0.113.10 \
V12_IP_FALLBACK_URL=http://203.0.113.10:12602 \
V12_ADMIN_EMAIL=admin@example.com \
V12_ADMIN_PASSWORD_DELIVERY=server_file \
V12_ADMIN_CREDENTIAL_PATH=/opt/bilnd123-cad-agent-workspace/admin-credential.txt \
V12_ADMIN_VERIFY_PATH=outputs/reports/v12-admin-verify.json \
V12_ADMIN_FLOW_EVIDENCE_PATH=outputs/reports/v12-admin-flow-verify.json \
npm run handoff:check -- --expected-commit "$(git rev-parse --short HEAD)" --output outputs/reports/v12-handoff-check.json
```

For the temporary HTTP + Basic Auth staging posture, generate a current-access report instead of calling the handoff complete:

```bash
STAGING_BASE_URL=http://127.0.0.1:3000 \
V12_PUBLIC_BASE_URL=http://203.0.113.10:12602 \
V12_PROBE_BASE_URL=http://127.0.0.1:3000 \
STAGING_BASIC_AUTH_USER=... \
STAGING_BASIC_AUTH_PASSWORD=... \
V12_EXPECTED_IP=203.0.113.10 \
V12_IP_FALLBACK_URL=http://203.0.113.10:12602 \
V12_ADMIN_EMAIL=cad-admin \
V12_ADMIN_PASSWORD_DELIVERY=server_file \
V12_ADMIN_CREDENTIAL_PATH=/opt/bilnd123-cad-agent-workspace/admin-credential.txt \
npm run handoff:current-access -- --handoff outputs/reports/v12-handoff-check.json
```

When running the report inside the container, use `V12_PROBE_BASE_URL` or `--probe-base-url` for the local probe address and `V12_PUBLIC_BASE_URL` or `--base-url` for the real address to show the operator. The current-access report is for operator handoff of a restricted staging URL only. It explicitly reports `Final v1.2 handoff: not ready` until HTTPS/domain, Clerk, and admin-flow evidence pass the strict gate.

Then generate the sanitized handoff report:

```bash
npm run handoff:report -- --input outputs/reports/v12-handoff-check.json --output outputs/reports/v12-handoff-report.md
npm run handoff:preflight -- --handoff outputs/reports/v12-handoff-check.json --output outputs/reports/v12-access-preflight.md --json outputs/reports/v12-access-preflight.json
```

This check intentionally fails for the temporary HTTP + Basic Auth staging posture. It verifies that the HTTPS URL uses a real domain, the domain resolves to `V12_EXPECTED_IP`, HTTP redirects to HTTPS, the optional IP fallback remains Basic Auth protected, the declared Clerk admin exists, the admin verification email matches the declared admin email, the admin is authorized, and the real Clerk admin flow has been verified. It must not be used to claim handoff completion until it passes against the real HTTPS/Clerk deployment. `handoff:preflight` is the private report formatter for the requested Access/Admin handoff fields; it says `Status: not ready` until the strict gate passes. When `V12_ADMIN_PASSWORD_DELIVERY=server_file`, run the check on the staging host so it can verify the credential file exists and is not readable by group/world users. Use `V12_ADMIN_PASSWORD_DELIVERY=secure_channel` only when the password was delivered out of band.

Dev fallback persistence and feedback files live in the staging log volume only when `DATABASE_URL` is absent:

- `logs/projects.json`: saved projects, messages, revisions, and artifact metadata
- `logs/feedback.jsonl`: sanitized thumbs up/down feedback entries

Postgres staging uses the `postgres_data` volume and stores projects, messages, revisions, artifact metadata, feedback, and usage events. Neither store may contain model API keys, Basic Auth passwords, provider raw responses, cookies, or private server paths.
