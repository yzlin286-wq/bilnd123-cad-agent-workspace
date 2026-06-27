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
```

Keep the existing server-only values:

```bash
CAD_AGENT_BASE_URL=https://api.example.com/v1
CAD_AGENT_API_KEY=replace-with-real-server-side-key
CAD_AGENT_PRIMARY_MODEL=primary-real-model
STAGING_BASIC_AUTH_USER=replace-with-staging-user
STAGING_BASIC_AUTH_PASSWORD=replace-with-strong-staging-password
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

## If You Do Not Have A Domain

Do not treat IP-only HTTP as a durable internal trial setup. Use one of these temporary approaches:

- Cloudflare Tunnel with Access policy in front of the app
- Tailscale or another private mesh network
- cloud security-group IP allowlist for a tiny tester set
- a short-lived SSH tunnel for a single operator smoke test

If using the existing `12601` HTTP compose for a short smoke, keep Basic Auth enabled and limit exposure with firewall rules.

## Rollback

To return to the HTTP-only staging compose:

```bash
docker compose -f docker-compose.staging.https.yml down
docker compose -f docker-compose.staging.yml --env-file .env up -d --build
```

Only stop this project. Do not stop unrelated Docker projects on the same server.
