# Access Control

This staging app is for short internal trials only. Current HTTP staging must be treated as a brief smoke-test posture, not as a durable internal service.

Do not commit real IP addresses, tester CIDRs, passwords, API keys, tunnel tokens, certificates, or private keys.

## v1.2 Handoff Target

For v1.2, the preferred handoff is a real HTTPS domain with Clerk login and Postgres persistence. The earlier IP allowlist approach remains acceptable only as an interim restricted fallback until DNS and certificate issuance are complete.

Store the real allowlist only in the cloud firewall, host firewall, or server-only operations notes. Do not commit real tester IPs or CIDRs.

After the allowlist is applied, set this server-only value and restart only this project:

```bash
STAGING_ACCESS_MODE=http_restricted
```

## Current Rules

- App-level Basic Auth must stay enabled for staging.
- `/api/artifacts/[id]` is protected by the same Basic Auth proxy as `/api/health`, `/api/agent/run`, `/api/agent/revise`, and `/api/cad/rebuild`.
- `/admin`, `/api/projects`, and `/api/feedback` are protected by the same Basic Auth proxy.
- When Clerk keys are configured, `/app/*` and `/admin` require Clerk auth. Basic Auth alone is not a signed-in user.
- `/admin` requires admin allowlist or organization admin status after sign-in.
- Artifact downloads check project/revision ownership after auth; Basic Auth alone is not the artifact authorization model.
- Plain HTTP plus Basic Auth is acceptable only for a short operator smoke on a restricted network path.
- Before a 48-72 hour internal trial, use HTTPS, a private network, an authenticated tunnel, or a cloud firewall allowlist.
- `/api/health` returns a safe `accessMode` field. It must not expose hostnames, server IPs, secrets, filesystem paths, or model endpoints.

## `STAGING_ACCESS_MODE`

Set this in the server-only `.env` file:

```bash
STAGING_ACCESS_MODE=unknown
```

Allowed values:

- `https`: staging is behind HTTPS.
- `private_network_or_tunnel`: staging is reachable only through Tailscale, a similar private network, or an authenticated tunnel.
- `http_restricted`: staging is still HTTP, but the app port is restricted to a narrow cloud firewall allowlist.
- `unknown`: default when access control has not been documented.

## Cloud Firewall IP Allowlist Checklist

Use placeholder examples in notes and tickets. Keep real tester IPs outside git.

- Choose the staging app port.
- Collect tester egress CIDRs out of band.
- Allow inbound TCP to the staging app port only from those CIDRs.
- Remove broad inbound rules such as `0.0.0.0/0` and `::/0` for the app port.
- Keep SSH rules separate from app testing rules.
- Verify an unlisted network cannot connect to the app port.
- Verify an allowlisted network receives `401` from unauthenticated `/api/health`.
- Verify authenticated `/api/health` returns `httpsConfigured`, `accessMode`, and no secrets.
- Set `STAGING_ACCESS_MODE=http_restricted`.
- Review the allowlist daily during the internal trial and remove it when the trial ends.

## Verify Access Mode And Restriction

Run these checks after applying the allowlist and restarting the app:

- From an allowlisted network, unauthenticated `/api/health` returns `401`.
- From an allowlisted network, authenticated `/api/health` returns `accessMode: "http_restricted"`.
- From a non-allowlisted network or external TCP probe, the staging app port is unreachable.
- Authenticated `/api/health` still reports `cadRunnerConfigured`, `llmConfigured`, `outputDirWritable`, and `supportedTemplates`.
- An unauthenticated package artifact URL returns `401`.
- Do not paste the real allowlisted IP or Basic Auth value into reports.

## Tailscale Checklist

- Install Tailscale on the staging host and tester machines.
- Restrict public ingress to the app port.
- Share only the private Tailscale hostname/address with testers.
- Keep Basic Auth enabled.
- Set `STAGING_ACCESS_MODE=private_network_or_tunnel`.
- Confirm unauthenticated requests still return `401`.

## Cloudflare Tunnel Checklist

- Create a tunnel on the staging host.
- Route the tunnel to the app upstream.
- Add a Cloudflare Access policy for the internal tester group.
- Close direct public ingress to the staging app port.
- Keep Basic Auth enabled unless Cloudflare Access is explicitly replacing it.
- Store tunnel tokens only in server-side secret storage.
- Set `STAGING_ACCESS_MODE=private_network_or_tunnel`.

## HTTPS Checklist

- Use a real domain.
- Point DNS to the staging host or tunnel.
- Run the Caddy compose example from `docs/HTTPS_STAGING.md`.
- Confirm HTTP redirects to HTTPS.
- Confirm authenticated `/api/health` returns `httpsConfigured: true`.
- Set `STAGING_ACCESS_MODE=https`.
- Confirm real Clerk sign-in works.
- Confirm `dataLayer.mode: "postgres"` and `dataLayer.productionReady: true`.
- Confirm unauthenticated `/app` is blocked or redirected to sign-in.
- Confirm non-admin signed-in users cannot access `/admin`.
