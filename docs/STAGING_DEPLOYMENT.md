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

MAX_PROMPT_CHARS=2000
CAD_OUTPUT_RETENTION_HOURS=72
CAD_OUTPUT_MAX_BYTES=1073741824
```

Never prefix model keys with `NEXT_PUBLIC_`. Browser code must not receive `CAD_AGENT_API_KEY`.

## Docker Compose

```bash
docker compose -f docker-compose.staging.yml --env-file .env up -d --build
```

The app listens inside the container on port `3000`; compose maps it to host port `12601`.

Persistent data:

- `cad_outputs` volume -> `/app/outputs/cad`
- `run_logs` volume -> `/app/logs`

For domain-based HTTPS, use `docs/HTTPS_STAGING.md` and the standalone Caddy example:

```bash
docker compose -f docker-compose.staging.https.yml --env-file .env up -d --build
```

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

Do not run Basic Auth over long-lived plaintext HTTP. Use HTTPS before inviting internal testers beyond a brief private smoke check.

`/api/health` includes a safe `accessMode` field. Set it explicitly in the server-only `.env`:

- `https`: a real HTTPS reverse proxy or tunnel terminates TLS.
- `private_network_or_tunnel`: access is limited to a private mesh network or an authenticated tunnel.
- `http_restricted`: plaintext HTTP is still in use, but the app port is limited to a narrow cloud firewall allowlist.
- `unknown`: default when no operator has documented the access control posture.

Do not put server IPs, tester IPs, passwords, API keys, Cloudflare tokens, or certificate material into committed files.

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
