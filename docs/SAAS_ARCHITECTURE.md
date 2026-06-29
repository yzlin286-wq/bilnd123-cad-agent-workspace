# SaaS Architecture

Current stage: `v1.2 local password staging access`.

## Scope

The product is moving from internal alpha workspace to a controlled SaaS foundation. The supported CAD templates remain:

- `mounting_plate`
- `l_bracket`

Not supported in this stage:

- Arbitrary CAD generation
- Sketch/image upload to CAD
- Payments
- BOM/RFQ workflows
- Onshape/Fusion plugins
- Anonymous production use

## Auth

The current staging identity layer is a local username/password login backed by a signed httpOnly cookie. Basic Auth remains the outer staging gate only.

Required environment variables:

```bash
SAAS_AUTH_PROVIDER=local_password
APP_AUTH_USER=
APP_AUTH_PASSWORD=
APP_AUTH_SESSION_SECRET=
APP_AUTH_EMAIL=
```

`APP_AUTH_SESSION_SECRET` must be at least 32 characters and must stay server-only.

Clerk handoff tooling remains available only when explicitly enabled:

```bash
SAAS_AUTH_PROVIDER=clerk
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
SAAS_ADMIN_USER_IDS=
SAAS_ADMIN_EMAILS=
```

By default, `/app` and `/admin` require the local password session. `/admin` treats the local password user as the staging administrator.

Basic Auth is only an outer staging gate. It must not be treated as the application identity for `/app`, `/admin`, project APIs, or artifact authorization.

When `SAAS_AUTH_PROVIDER=clerk`, Clerk can protect `/app` and `/admin`; this is no longer the default staging path.

Admin bootstrap runs from the `cad-agent` container, or from a host shell after `npm ci` has installed dependencies:

```bash
ADMIN_BOOTSTRAP_EMAIL=admin@example.com \
ADMIN_BOOTSTRAP_PASSWORD=one-time-password \
ADMIN_BOOTSTRAP_CREDENTIAL_PATH=/opt/bilnd123-cad-agent-workspace/admin-credential.txt \
ADMIN_BOOTSTRAP_ENV_FILE=/opt/bilnd123-cad-agent-workspace/.env \
npm run admin:bootstrap
```

The bootstrap script creates or updates a Clerk user, sets admin metadata, applies the supplied one-time password by default, optionally merges the email into `SAAS_ADMIN_EMAILS`, and can write the one-time password to a chmod `600` server-only file. It never prints the password.

## Data

`db/schema.sql` defines the Postgres schema. When `DATABASE_URL` is configured, the runtime repository stores projects, messages, revisions, artifacts, feedback, and usage events in Postgres.

The JSON fallback store is acceptable for local development and short staging continuity checks only. It is not a durable SaaS production data layer.

Staging compose includes an internal Postgres service and runs `npm run db:migrate` before starting the app. A managed Postgres can be used by setting `DATABASE_URL` and `DATABASE_SSL=1` when required.

## Access Handoff

The v1.2 handoff is only complete when all of these are true:

- A real domain resolves to the staging host.
- Caddy or an equivalent reverse proxy terminates HTTPS and redirects HTTP to HTTPS.
- `/api/health` returns `httpsConfigured: true`, `accessMode: "https"`, and no HTTP warning.
- Real Clerk keys are configured.
- `/api/health` returns `auth.clerkConfigured: true` and `auth.devBypassEnabled: false`.
- An admin Clerk user has been bootstrapped and verified.
- `dataLayer.mode` is `postgres` and `productionReady` is `true`.
- `npm run handoff:check` passes against the HTTPS staging URL.

## Runtime Boundaries

- Natural-language CAD still requires a real OpenAI-compatible model endpoint.
- CAD execution still requires the real build123d runner.
- The app must not fabricate CAD artifacts as a fallback.
- Artifact files stay under `outputs/cad`; authorization is checked against project/revision ownership metadata before the path is resolved.
