# HTTPS Staging

Staging should not run Basic Auth over long-lived plaintext HTTP. Basic Auth sends credentials on every request, so use HTTPS before inviting internal testers beyond a brief private smoke check.

Do not commit real certificates, private keys, Caddy storage, Basic Auth passwords, model API keys, or DNS provider tokens.

## Recommended Shape

Use Caddy in front of the app:

```text
Internet -> Caddy :80/:443 -> cad-agent:3000
```

Caddy handles:

- Let's Encrypt certificate issuance for a real domain
- HTTP `80` to HTTPS `443` redirect
- TLS termination
- reverse proxy to `cad-agent:3000`

The app middleware can continue to enforce `STAGING_BASIC_AUTH_USER` and `STAGING_BASIC_AUTH_PASSWORD`. If you later move Basic Auth to Caddy, generate a Caddy bcrypt hash and remove the app-level credentials from the app container.

## Environment

Add these server-only values to the staging `.env` file:

```bash
STAGING_DOMAIN=cad-staging.example.com
LETSENCRYPT_EMAIL=ops@example.com
STAGING_ACCESS_MODE=https
STAGING_HTTPS_ENABLED=1
```

Keep the existing server-only values:

```bash
CAD_AGENT_BASE_URL=https://api.example.com/v1
CAD_AGENT_API_KEY=replace-with-real-server-side-key
CAD_AGENT_PRIMARY_MODEL=primary-real-model
STAGING_BASIC_AUTH_USER=replace-with-staging-user
STAGING_BASIC_AUTH_PASSWORD=replace-with-strong-staging-password
CLERK_SECRET_KEY=replace-with-real-clerk-secret-key
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=replace-with-real-clerk-publishable-key
DATABASE_URL=postgres://cad_agent:replace-with-strong-postgres-password@postgres:5432/cad_agent
```

## Caddy Compose

This repository includes a standalone HTTPS compose example:

```bash
docker compose -f docker-compose.staging.https.yml --env-file .env up -d --build
```

It uses:

- `deploy/Caddyfile.staging`
- `cad-agent:3000` as the upstream
- host ports `80` and `443`
- existing `bilnd123_cad_outputs` and `bilnd123_run_logs` volumes for app state
- persistent `caddy_data` and `caddy_config` volumes for certificate state

The Caddyfile redirects HTTP to HTTPS:

```caddyfile
http://{$STAGING_DOMAIN} {
  redir https://{host}{uri} permanent
}
```

and proxies HTTPS traffic:

```caddyfile
https://{$STAGING_DOMAIN} {
  reverse_proxy cad-agent:3000
}
```

## DNS And Let's Encrypt

1. Create an `A` record from the staging domain to the server public IP.
2. Confirm inbound ports `80` and `443` are open at the cloud security group and host firewall.
3. Start `docker-compose.staging.https.yml`.
4. Check Caddy logs:

```bash
docker compose -f docker-compose.staging.https.yml logs --tail=100 caddy
```

5. Verify:

```bash
curl -I http://cad-staging.example.com
curl -u "$STAGING_BASIC_AUTH_USER:$STAGING_BASIC_AUTH_PASSWORD" https://cad-staging.example.com/api/health
```

The first command should redirect to HTTPS. The second command should return the health JSON without exposing secrets.

For a v1.2 SaaS access handoff, authenticated health must include:

```json
{
  "app": "ok",
  "httpsConfigured": true,
  "accessMode": "https",
  "cadRunnerConfigured": true,
  "llmConfigured": true,
  "outputDirWritable": true,
  "dataLayer": {
    "mode": "postgres",
    "productionReady": true
  }
}
```

The `warning` field should be absent or `null` once HTTPS is active. Do not claim HTTPS completion while `httpsConfigured` is `false`, `accessMode` is not `https`, `STAGING_DOMAIN` is empty, or `STAGING_HTTPS_ENABLED` is not `1`.

## If You Do Not Have A Domain

Do not treat IP-only HTTP as a durable internal trial setup. Use one of these temporary approaches:

- Cloudflare Tunnel with Access policy in front of the app
- Tailscale or another private mesh network
- cloud security-group IP allowlist for a tiny tester set
- a short-lived SSH tunnel for a single operator smoke test

If using the existing `12601` HTTP compose for a short smoke, keep Basic Auth enabled and limit exposure with firewall rules.

### Temporary Option A: Cloud Firewall IP Allowlist

Use this only for a small tester set with stable egress IPs.

1. Collect tester public egress CIDRs out of band. Do not commit them.
2. In the cloud firewall or security group, allow inbound TCP only on the selected staging port from those CIDRs.
3. Remove any `0.0.0.0/0` or `::/0` rule for the staging port.
4. Keep SSH restricted separately; do not open SSH as part of CAD testing.
5. Confirm from an unlisted network that `/api/health` is unreachable.
6. Confirm from an allowlisted network that unauthenticated `/api/health` returns `401`.
7. Set the server-only `.env` value:

```bash
STAGING_ACCESS_MODE=http_restricted
```

### Temporary Option B: Tailscale

Use this when testers can join a private mesh network.

1. Install Tailscale on the staging host and tester machines.
2. Restrict the staging app to the Tailscale interface or block public ingress at the cloud firewall.
3. Share the Tailscale hostname or private address only with internal testers.
4. Keep app-level Basic Auth enabled.
5. Set the server-only `.env` value:

```bash
STAGING_ACCESS_MODE=private_network_or_tunnel
```

### Temporary Option C: Cloudflare Tunnel

Use this when a public hostname is useful but direct public ingress should stay closed.

1. Create a Cloudflare Tunnel for the staging host.
2. Point the tunnel service to `http://cad-agent:3000` or the local compose port.
3. Protect the hostname with Cloudflare Access and an internal identity policy.
4. Close direct public ingress to the app port in the cloud firewall.
5. Keep app-level Basic Auth enabled unless the Access policy is formally replacing it.
6. Set the server-only `.env` value:

```bash
STAGING_ACCESS_MODE=private_network_or_tunnel
```

When HTTPS is active through Caddy or another TLS reverse proxy, set:

```bash
STAGING_ACCESS_MODE=https
```

## Rollback

To return to the HTTP-only staging compose:

```bash
docker compose -f docker-compose.staging.https.yml down
docker compose -f docker-compose.staging.yml --env-file .env up -d --build
```

Only stop this project. Do not stop unrelated Docker projects on the same server.
