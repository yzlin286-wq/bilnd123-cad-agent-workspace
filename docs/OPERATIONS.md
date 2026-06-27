# Operations

This document covers internal staging operation for the CAD Agent. It is not a public production runbook.

## Backups And Cleanup

Generated CAD artifacts live under:

```text
outputs/cad
```

Run metadata lives under:

```text
logs/runs.jsonl
```

Alpha project and feedback records live under:

```text
logs/projects.json
logs/feedback.jsonl
```

Back up only what the team needs for internal review. Do not store model API keys in backups.

Cleanup command:

```bash
npm run cleanup:cad
```

Useful environment variables:

- `CAD_OUTPUT_RETENTION_HOURS`: default `72`
- `CAD_OUTPUT_MAX_BYTES`: optional byte cap; oldest run directories are deleted first

`CAD_OUTPUT_RETENTION_HOURS` controls time-based retention. `CAD_OUTPUT_MAX_BYTES` controls total bytes under `outputs/cad`; when the cap is exceeded, the oldest run directories are removed first.

Example cron entry:

```cron
15 * * * * cd /opt/bilnd123-cad-agent-workspace && npm run cleanup:cad >> logs/cleanup.log 2>&1
```

Container cron example:

```cron
15 * * * * cd /opt/bilnd123-cad-agent-workspace && docker compose -f docker-compose.staging.yml exec -T cad-agent npm run cleanup:cad >> /var/log/bilnd123-cleanup.log 2>&1
```

Systemd timer example:

```ini
# /etc/systemd/system/bilnd123-cleanup.service
[Unit]
Description=Cleanup bilnd123 CAD outputs

[Service]
Type=oneshot
WorkingDirectory=/opt/bilnd123-cad-agent-workspace
ExecStart=/usr/bin/docker compose -f docker-compose.staging.yml exec -T cad-agent npm run cleanup:cad
```

```ini
# /etc/systemd/system/bilnd123-cleanup.timer
[Unit]
Description=Run bilnd123 CAD cleanup hourly

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
```

Enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now bilnd123-cleanup.timer
systemctl list-timers bilnd123-cleanup.timer
```

The cleanup script only removes direct run directories under `outputs/cad`, does not delete the root directory, and does not follow symlinks.

## Disk Control

For staging, put `outputs/cad` on a volume with enough free space for STEP/STL exports. Set `CAD_OUTPUT_MAX_BYTES` to keep the volume bounded.

If disk fills:

1. Run `node scripts/cleanup-cad-outputs.mjs --dry-run`.
2. Lower `CAD_OUTPUT_RETENTION_HOURS`.
3. Run `npm run cleanup:cad`.
4. Restart the container if the app was unable to write artifacts.

## Common Errors

### CAD Runner Timeout

Symptoms:

- Request returns a friendly CAD failure.
- `logs/runs.jsonl` has `CAD_REBUILD_FAILED` or `AGENT_RUN_FAILED`.

Actions:

- Increase `CAD_RUNNER_TIMEOUT_MS`.
- Lower `CAD_MAX_CONCURRENT_RUNS`.
- Check CPU and memory during build123d execution.

### build123d Or Open Cascade Install Failure

Symptoms:

- Runner stderr mentions build123d or Open Cascade.
- Python smoke fails in CI or container build.

Actions:

- Rebuild the Docker image.
- Confirm `requirements.txt` installs inside `/app/.venv`.
- Run a direct smoke command inside the container:

```bash
echo '{"spec":{"partType":"mounting_plate","length":120,"width":80,"thickness":4,"holeDiameter":4.5,"edgeOffset":10,"chamfer":1}}' \
  | /app/.venv/bin/python scripts/run_build123d.py
```

### LLM JSON Schema Compatibility

The app first requests JSON schema output. If a provider rejects schema output, it retries JSON object mode. If the model still returns invalid JSON, the request fails with a friendly error rather than fabricating a spec.

Actions:

- Use a stronger text/reasoning model for `CAD_AGENT_PRIMARY_MODEL`.
- Configure `CAD_AGENT_DOWNGRADE_MODEL` as another real model endpoint.
- Inspect `logs/runs.jsonl` for status and route, not for full secrets.

### Unsupported Template

Only these `partType` values are supported:

- `mounting_plate`
- `l_bracket`

Unsupported templates fail with a user-readable error and do not generate placeholder CAD.

## Secret Rotation

### Rotate `CAD_AGENT_API_KEY`

1. Create the replacement key in the model provider.
2. Edit the server-only `.env` file:

```bash
cd /opt/bilnd123-cad-agent-workspace
nano .env
```

3. Replace only `CAD_AGENT_API_KEY`.
4. Confirm permissions:

```bash
stat -c '%a %U:%G %n' .env
chmod 600 .env
```

5. Restart only this project:

```bash
docker compose -f docker-compose.staging.yml --env-file .env up -d
```

6. Run `npm run smoke:staging` from a trusted machine with staging auth.
7. Revoke the old key at the provider.

### Rotate `STAGING_BASIC_AUTH_PASSWORD`

1. Generate a replacement on the server:

```bash
openssl rand -base64 32
```

2. Update `STAGING_BASIC_AUTH_PASSWORD` in `.env`.
3. Keep `.env` locked down:

```bash
chmod 600 .env
stat -c '%a %U:%G %n' .env
```

4. Restart only this project:

```bash
docker compose -f docker-compose.staging.yml --env-file .env up -d
```

5. Verify unauthenticated and authenticated health:

```bash
curl -i http://127.0.0.1:12601/api/health
curl -u "$STAGING_BASIC_AUTH_USER:$STAGING_BASIC_AUTH_PASSWORD" http://127.0.0.1:12601/api/health
```

Never commit real keys, cookies, tokens, or private server passwords to the repository.

### Scan Run Logs For Secret Leakage

Run history should not contain model keys, Basic Auth passwords, cookies, SSH passwords, or full stderr. After rotating secrets or changing logging, scan the log file:

```bash
grep -E 'sk-|Bearer |Basic |api[_-]?key|password|token|secret' logs/runs.jsonl || true
```

If the app is containerized:

```bash
docker compose -f docker-compose.staging.yml exec -T cad-agent sh -lc \
  "grep -E 'sk-|Bearer |Basic |api[_-]?key|password|token|secret' /app/logs/runs.jsonl || true"
```

If anything sensitive appears, rotate that secret, export only sanitized failures, and remove the compromised log copy from shared channels.

## Run Logs

View recent runs:

```bash
tail -n 50 logs/runs.jsonl
```

Fields include timestamp, route, runId, revisionId, partType, model, status, durationMs, artifactCount, validationPassed, errorCode, and truncated prompt.

Saved alpha projects are stored in `logs/projects.json`. They contain sanitized messages, revision metadata, artifact IDs/URLs, specs, and validation results. They must not contain provider raw responses, API keys, Basic Auth passwords, cookies, or private server paths.

Trial feedback is stored in `logs/feedback.jsonl`. It contains thumbs up/down, optional sanitized comments, revision IDs, routes, and timestamps.

Summarize run history:

```bash
npm run runs:summary
```

Classify failures:

```bash
npm run runs:classify
```

Export sanitized failure samples:

```bash
npm run failures:export
```

The failure corpus is written to:

```text
outputs/failures/failures.json
```

It includes only sanitized prompt, route, errorCode, partType, durationMs, and timestamp. It must not include API keys, Basic Auth values, full stderr, cookies, or server filesystem paths.

Generate a local admin-safe report:

```bash
npm run staging:report
```

The report is written to:

```text
outputs/reports/staging-report.md
```

It aggregates run summary, failure classification, and the latest smoke result without including full prompts or secrets.

## 48-72 Hour Internal Trial Daily Routine

During the controlled internal trial, run this sequence once per day and after any staging redeploy:

```bash
npm run smoke:staging -- --output outputs/smoke/latest.json
npm run staging:protocol -- --execute --output outputs/protocol/latest.json
npm run runs:classify
npm run staging:report
npm run failures:export
```

Open `/admin` from an allowlisted network to review the same alpha dashboard behind Basic Auth.

Use `npm run runs:classify -- --since <ISO timestamp>` to separate historical unexpected failures from failures introduced after a deployment.

Read `outputs/reports/staging-report.md` before inviting more testers. If the report shows protocol failures or new unexpected failures, pause the trial and triage with `docs/FAILURE_TRIAGE.md`.

## Artifact Download Auth

`GET /api/artifacts/[id]` is protected by the same staging Basic Auth middleware as the rest of the app. The middleware matcher covers `/api/artifacts/...` and excludes only Next.js static image/static asset paths.

Verify from outside:

```bash
curl -i http://staging-host.example.com/api/artifacts/some-id
```

Expected unauthenticated result:

```text
401 Authentication required
```
