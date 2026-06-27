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

Back up only what the team needs for internal review. Do not store model API keys in backups.

Cleanup command:

```bash
npm run cleanup:cad
```

Useful environment variables:

- `CAD_OUTPUT_RETENTION_HOURS`: default `72`
- `CAD_OUTPUT_MAX_BYTES`: optional byte cap; oldest run directories are deleted first

Example cron entry:

```cron
15 * * * * cd /opt/bilnd123-cad-agent-workspace && npm run cleanup:cad >> logs/cleanup.log 2>&1
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

## API Key Rotation

1. Create the replacement key in the model provider.
2. Update the server `.env` file.
3. Restart the staging service:

```bash
docker compose -f docker-compose.staging.yml --env-file .env up -d
```

4. Run `npm run smoke:staging`.
5. Revoke the old key.

Never commit real keys, cookies, tokens, or private server passwords to the repository.

## Run Logs

View recent runs:

```bash
tail -n 50 logs/runs.jsonl
```

Fields include timestamp, route, runId, revisionId, partType, model, status, durationMs, artifactCount, validationPassed, errorCode, and truncated prompt.
