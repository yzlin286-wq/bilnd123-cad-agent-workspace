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
PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple

STAGING_BASIC_AUTH_USER=replace-with-staging-user
STAGING_BASIC_AUTH_PASSWORD=replace-with-strong-staging-password

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

## Real Model Configuration

Use an OpenAI-compatible `/chat/completions` endpoint in `CAD_AGENT_BASE_URL`.

The server calls the model only from API routes. The API key is read from server environment variables and is not returned by `/api/health`.

## CAD Runner Configuration

In Docker, use:

```bash
CAD_RUNNER_COMMAND=/app/.venv/bin/python scripts/run_build123d.py
```

The runner produces real `STEP`, `STL`, `SVG`, `source.py`, `validation.json`, and `manifest.json` files. If build123d cannot run, the app returns a friendly error and does not fabricate artifacts.

## Basic Auth

Staging servers must set:

```bash
STAGING_BASIC_AUTH_USER=...
STAGING_BASIC_AUTH_PASSWORD=...
```

When both are set, the staging access gate protects the app and APIs. Unauthenticated requests return `401`.

## Staging Smoke

After deployment:

```bash
STAGING_BASE_URL=http://server.example.com:12601 \
STAGING_BASIC_AUTH_USER=... \
STAGING_BASIC_AUTH_PASSWORD=... \
npm run smoke:staging
```

The smoke script checks `/api/health`, creates a `mounting_plate`, revises thickness to `6 mm`, verifies unchanged dimensions, and downloads generated artifacts.

## Logs

Run history is appended to:

```text
logs/runs.jsonl
```

Each line includes route, run id, revision id, part type, model name when available, status, duration, artifact count, validation status, and truncated prompt. It never records API keys.

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
