# Staging Deployment

This project is staging-ready for internal testing only. It is not ready for public anonymous traffic, payment flows, multi-tenant data, or arbitrary CAD generation.

## Server Requirements

- Docker Engine with Compose support
- Public ingress on one allowed port, for example `12601`
- Enough disk for `outputs/cad`
- Enough CPU/RAM for real build123d/Open Cascade runs

The container aligns with CI:

- Node.js `24.13.0`
- Python `3.11` from Debian bookworm
- `npm ci`
- `requirements.txt` installed into `/app/.venv`
- Next.js production build

## Environment

Create a server-side `.env` file next to `docker-compose.staging.yml`. Do not commit it.

```bash
CAD_AGENT_BASE_URL=https://api.example.com/v1
CAD_AGENT_API_KEY=replace-with-real-server-side-key
CAD_AGENT_PRIMARY_MODEL=primary-real-model
CAD_AGENT_DOWNGRADE_MODEL=secondary-real-model

CAD_RUNNER_COMMAND=/app/.venv/bin/python scripts/run_build123d.py
CAD_RUNNER_TIMEOUT_MS=60000
CAD_MAX_CONCURRENT_RUNS=1
APT_MIRROR=http://mirrors.tencent.com/debian
APT_SECURITY_MIRROR=http://mirrors.tencent.com/debian-security
PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple

STAGING_BASIC_AUTH_USER=replace-with-staging-user
STAGING_BASIC_AUTH_PASSWORD=replace-with-strong-staging-password
STAGING_ACCESS_MODE=unknown
STAGING_DOMAIN=
STAGING_HTTPS_ENABLED=0
APP_COMMIT_SHA=

CLERK_SECRET_KEY=replace-with-real-clerk-secret-key
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=replace-with-real-clerk-publishable-key
SAAS_ADMIN_EMAILS=admin@example.com

POSTGRES_USER=cad_agent
POSTGRES_PASSWORD=replace-with-strong-postgres-password
POSTGRES_DB=cad_agent
DATABASE_URL=postgres://cad_agent:replace-with-strong-postgres-password@postgres:5432/cad_agent
DATABASE_SSL=0

MAX_PROMPT_CHARS=2000
CAD_OUTPUT_RETENTION_HOURS=72
CAD_OUTPUT_MAX_BYTES=1073741824
```

Never prefix model keys with `NEXT_PUBLIC_`. Browser code must not receive `CAD_AGENT_API_KEY`.

`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is public but must be available during `next build` so the Clerk client bundle can initialize. The staging compose files pass it as a Docker build arg. After adding or rotating Clerk keys, rebuild the image with `--env-file .env up -d --build`; do not rely on a container restart alone.

Set `APP_COMMIT_SHA` to the deployed commit before building, for example `APP_COMMIT_SHA=$(git rev-parse --short HEAD)`. `/api/health`, staging smoke, and v1.2 handoff reports expose only this sanitized commit value so the verified deployment can be tied back to a Git commit.

## Docker Compose

```bash
docker compose -f docker-compose.staging.yml --env-file .env up -d --build
```

The app listens inside the container on port `3000`; compose maps it to host port `12601`.

Persistent data:

- `cad_outputs` volume -> `/app/outputs/cad`
- `run_logs` volume -> `/app/logs`
- `postgres_data` volume -> Postgres project/revision/artifact/feedback/usage metadata

The compose file runs `npm run db:migrate` before `npm run start`. You can also run migrations manually:

```bash
docker compose -f docker-compose.staging.yml --env-file .env exec cad-agent npm run db:migrate
```

For domain-based HTTPS, use `docs/HTTPS_STAGING.md` and the standalone Caddy example:

```bash
docker compose -f docker-compose.staging.https.yml --env-file .env up -d --build
```

Only claim `STAGING_ACCESS_MODE=https` after DNS resolves to the server, Caddy has issued a certificate, HTTP redirects to HTTPS, `STAGING_DOMAIN` is set, `STAGING_HTTPS_ENABLED=1`, and authenticated `/api/health` reports `httpsConfigured: true`.

## Real Model Configuration

Use an OpenAI-compatible `/chat/completions` endpoint in `CAD_AGENT_BASE_URL`.

The server calls the model only from API routes. The API key is read from server environment variables and is not returned by `/api/health`.

## CAD Runner Configuration

In Docker, use:

```bash
CAD_RUNNER_COMMAND=/app/.venv/bin/python scripts/run_build123d.py
```

The runner produces real `STEP`, `STL`, `SVG`, `source.py`, `validation.json`, `manifest.json`, and `package.zip` files. If build123d cannot run, the app returns a friendly error and does not fabricate artifacts.

## Basic Auth

Staging servers must set:

```bash
STAGING_BASIC_AUTH_USER=...
STAGING_BASIC_AUTH_PASSWORD=...
```

When both are set, the staging access gate protects the app and APIs. Unauthenticated requests return `401`.

When Clerk is configured, Basic Auth is only an outer staging gate. It does not create a SaaS user session. `/app`, `/admin`, project APIs, and artifact downloads still require a Clerk-authenticated user.

Do not run Basic Auth over long-lived plaintext HTTP. Use HTTPS before inviting internal testers beyond a brief private smoke check.

`/api/health` includes a safe `accessMode` field. Set it explicitly in the server-only `.env`:

- `https`: a real HTTPS reverse proxy or tunnel terminates TLS.
- `private_network_or_tunnel`: access is limited to a private mesh network or an authenticated tunnel.
- `http_restricted`: plaintext HTTP is still in use, but the app port is limited to a narrow cloud firewall allowlist.
- `unknown`: default when no operator has documented the access control posture.

Do not put server IPs, tester IPs, passwords, API keys, Cloudflare tokens, or certificate material into committed files.

## Clerk Admin Bootstrap

Run the bootstrap from the `cad-agent` container, or from a server shell where `npm ci` has already installed dependencies, with real Clerk keys in the process environment. Do not paste the password into git, README, issue trackers, or shell scripts.

```bash
ADMIN_BOOTSTRAP_EMAIL=admin@example.com \
ADMIN_BOOTSTRAP_PASSWORD=replace-with-one-time-password \
ADMIN_BOOTSTRAP_FIRST_NAME=CAD \
ADMIN_BOOTSTRAP_LAST_NAME=Admin \
ADMIN_BOOTSTRAP_RESET_PASSWORD=1 \
ADMIN_BOOTSTRAP_CREDENTIAL_PATH=/opt/bilnd123-cad-agent-workspace/admin-credential.txt \
ADMIN_BOOTSTRAP_ENV_FILE=/opt/bilnd123-cad-agent-workspace/.env \
npm run admin:bootstrap
```

The script:

- creates or updates a Clerk user
- applies the supplied one-time password to new users and, by default, existing users
- sets Clerk public/private metadata `role=admin`
- optionally merges the email into `SAAS_ADMIN_EMAILS`
- optionally writes the one-time password to a chmod `600` server-only file
- never prints the password

Set `ADMIN_BOOTSTRAP_RESET_PASSWORD=0` only if the Clerk admin already exists and password rotation is being handled through another secure channel. For v1.2 handoff, leave the default enabled so the delivered initial password can be verified.

After bootstrapping, restart the app so changed `.env` values are loaded.

Required verification:

- unauthenticated `/app` is redirected to sign-in or blocked
- admin user can sign in and open `/app`
- admin user can open `/admin`
- a non-admin signed-in user cannot open `/admin`
- admin user can create a CAD project and download `package.zip`
- another signed-in user cannot download that artifact and receives `403`

## HTTP Exposure Reduction

If staging is temporarily running on HTTP for smoke checks, pick one of these before broader internal testing:

### Cloud Firewall IP Allowlist

1. Identify the selected staging port.
2. In the cloud firewall, allow inbound TCP to that port only from tester CIDRs kept outside git.
3. Remove broad `0.0.0.0/0` and `::/0` rules for the staging app port.
4. Leave Basic Auth enabled.
5. Set `STAGING_ACCESS_MODE=http_restricted`.
6. Verify from a non-allowlisted network that the port is blocked.
7. Verify from an allowlisted network that unauthenticated `/api/health` returns `401`.

### Tailscale

1. Join the staging host and tester machines to the same tailnet.
2. Restrict public ingress to the app port at the cloud firewall.
3. Reach the app through the Tailscale hostname or private address.
4. Leave Basic Auth enabled.
5. Set `STAGING_ACCESS_MODE=private_network_or_tunnel`.

### Cloudflare Tunnel

1. Run a tunnel on the staging host.
2. Route the tunnel to the app upstream.
3. Protect the hostname with Cloudflare Access.
4. Close direct public ingress to the app port.
5. Leave Basic Auth enabled unless Access is intentionally replacing it.
6. Set `STAGING_ACCESS_MODE=private_network_or_tunnel`.

For domain-based HTTPS with automatic certificates, prefer `docs/HTTPS_STAGING.md` and set `STAGING_ACCESS_MODE=https`.

## Staging Smoke

After deployment:

```bash
STAGING_BASE_URL=http://server.example.com:12601 \
STAGING_BASIC_AUTH_USER=... \
STAGING_BASIC_AUTH_PASSWORD=... \
npm run smoke:staging -- --output outputs/smoke/latest.json
```

The smoke script checks `/api/health`, creates a `mounting_plate`, revises thickness to `6 mm`, verifies unchanged dimensions, downloads generated artifacts including `package.zip`, and verifies the ZIP file contains the expected CAD files.

## v1.2 Handoff Gate

After the real HTTPS domain, Clerk keys, Postgres, and admin bootstrap are configured, verify the Clerk admin:

```bash
CLERK_SECRET_KEY=... \
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=... \
V12_ADMIN_EMAIL=admin@example.com \
npm run admin:verify -- --output outputs/reports/v12-admin-verify.json
```

On the staging host, prefer the container because the deployment checkout does not need host-side `node_modules`:

```bash
docker compose -f docker-compose.staging.yml exec cad-agent \
  npm run admin:verify -- --output /app/logs/v12-admin-verify.json
docker compose -f docker-compose.staging.yml exec cad-agent \
  cat /app/logs/v12-admin-verify.json > outputs/reports/v12-admin-verify.json
```

After real Clerk login testing, capture sanitized admin flow evidence. Do not include cookies, Basic Auth headers, passwords, API keys, full prompts, provider raw errors, tracebacks, or server paths.

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
    { "id": "artifact_cross_owner_forbidden", "ok": true, "status": 403 }
  ]
}
```

Verify that evidence before handoff:

```bash
npm run admin:flow:verify -- --input outputs/reports/v12-admin-flow-evidence.json --expected-commit "$(git rev-parse --short HEAD)" --output outputs/reports/v12-admin-flow-verify.json
```

Audit the server-only `.env` before handoff. This report prints only booleans, file modes, and blockers; it must not print the actual Clerk keys, Basic Auth password, `DATABASE_URL`, or admin password.

```bash
npm run handoff:env:audit -- --env-file .env --output outputs/reports/v12-env-audit.md --json outputs/reports/v12-env-audit.json
```

Verify the public DNS and TLS path before running the full handoff gate:

```bash
npm run handoff:domain:check -- --base-url https://cad-agent.example.com --expected-ip 203.0.113.10 --ip-fallback-url http://203.0.113.10:12602 --output outputs/reports/v12-domain-tls-check.json --markdown outputs/reports/v12-domain-tls-check.md
```

Then run the strict handoff gate:

```bash
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

Generate the sanitized access handoff report from the check output:

```bash
npm run handoff:report -- --input outputs/reports/v12-handoff-check.json --output outputs/reports/v12-handoff-report.md
npm run handoff:preflight -- --handoff outputs/reports/v12-handoff-check.json --output outputs/reports/v12-access-preflight.md --json outputs/reports/v12-access-preflight.json
```

`handoff:preflight` renders the private delivery format requested for v1.2:

```text
Access
- Domain: https://...
- IP: ...
- IP fallback: ...
- accessMode: https
- HTTPS: enabled
- Health: app ok, runner true, llm true, output writable true

Admin
- Admin email: ...
- Admin password: server-only file ... / secure one-time channel
- Password rotation required: yes
- /admin verified: yes
```

It reports `Status: not ready` and lists blockers until the strict handoff gate proves the real HTTPS domain, Clerk admin flow, artifact authorization, and Postgres data layer.

The gate verifies:

- the public URL uses HTTPS
- the public URL uses a real domain rather than a raw IP
- the domain resolves to `V12_EXPECTED_IP`
- HTTP redirects to the HTTPS staging URL
- when `V12_IP_FALLBACK_URL` is set, unauthenticated `/api/health` returns `401` and authenticated `/api/health` returns `200`
- authenticated `/api/health` reports `httpsConfigured: true`, `accessMode: "https"`, no warning, runner true, llm true, output writable true
- health reports `auth.clerkConfigured: true` and `auth.devBypassEnabled: false`
- health reports `dataLayer.mode: "postgres"` and `productionReady: true`
- health reports the deployed `APP_COMMIT_SHA`, and it matches `--expected-commit`
- `/sign-in` renders Clerk UI instead of the placeholder
- `/app` and `/admin` do not return 200 when only the outer staging Basic Auth is satisfied and no Clerk session exists
- admin email and password delivery are declared
- when `V12_ADMIN_PASSWORD_DELIVERY=server_file`, the credential file exists and is not readable by group/world users
- `npm run admin:verify` confirms the declared Clerk user exists, has password login enabled, is not banned or locked, and is authorized as admin by metadata or allowlist
- the admin verification report email must match the declared `--admin-email` / `V12_ADMIN_EMAIL`
- `V12_ADMIN_FLOW_EVIDENCE_PATH` points to the sanitized `admin:flow:verify` output that verifies the real Clerk admin can log in, reach `/admin`, create a CAD project, and download their own `package.zip`
- the `admin_package_download.projectId` matches the `admin_project_create.projectId`
- the admin flow evidence commit matches the deployed `APP_COMMIT_SHA`
- the sanitized evidence verifies a non-admin Clerk user is blocked from `/admin`
- the sanitized evidence verifies a cross-owner artifact download attempt returns `403`

This command intentionally fails against the temporary HTTP + Basic Auth staging posture. Use `smoke:staging` for temporary HTTP smoke checks; use `handoff:check` only for the final v1.2 SaaS access handoff claim. Run it on the staging host when the admin password is delivered through a server-only file; use `V12_ADMIN_PASSWORD_DELIVERY=secure_channel` only when the initial password is delivered out of band.

## Logs

Run history is appended to:

```text
logs/runs.jsonl
```

Each line includes route, run id, revision id, part type, model name when available, status, duration, artifact count, validation status, and truncated prompt. It never records API keys.

Summarize runs:

```bash
npm run runs:summary
```

Classify expected and unexpected failures:

```bash
npm run runs:classify
```

Export sanitized failure samples:

```bash
npm run failures:export
```

Generate a local staging report:

```bash
npm run staging:report
```

Dry-run the 48-72 hour protocol without model/API cost:

```bash
npm run staging:protocol
```

Run the full protocol only when you are ready to spend real model/API and CAD runner time:

```bash
STAGING_BASE_URL=https://cad-staging.example.com npm run staging:protocol -- --execute
```

## Cleanup

Manual cleanup:

```bash
npm run cleanup:cad
```

Dry run:

```bash
node scripts/cleanup-cad-outputs.mjs --dry-run
```

See `docs/OPERATIONS.md` for cron/systemd examples and disk controls.
