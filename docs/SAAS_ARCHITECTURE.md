# SaaS Architecture

Current stage: `v1.1 SaaS foundation + product UI polish`.

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

Clerk is the preferred SaaS auth and organization provider.

Required environment variables when Clerk is enabled:

```bash
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
SAAS_ADMIN_USER_IDS=
SAAS_ADMIN_EMAILS=
```

When Clerk is configured, `/app` and `/admin` are protected by Clerk middleware. `/admin` also checks an admin allowlist or organization admin role.

When Clerk is not configured, staging can continue using Basic Auth as a temporary internal fallback. This fallback is not a production SaaS auth replacement.

## Data

`db/schema.sql` defines the target Postgres schema. Until `DATABASE_URL` and a Postgres adapter are provisioned, `logs/projects.json` remains the dev fallback store.

The fallback store is acceptable for local development and short staging continuity checks. It is not a durable SaaS production data layer.

## Runtime Boundaries

- Natural-language CAD still requires a real OpenAI-compatible model endpoint.
- CAD execution still requires the real build123d runner.
- The app must not fabricate CAD artifacts as a fallback.
- Artifact files stay under `outputs/cad`; authorization is checked against project/revision ownership metadata before the path is resolved.
