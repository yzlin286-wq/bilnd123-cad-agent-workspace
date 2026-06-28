# Data Model

The target SaaS data model lives in `db/schema.sql`.

## Entities

- `users`: Clerk-backed users.
- `organizations`: Clerk-backed organizations or internal teams.
- `organization_members`: membership and role mapping.
- `projects`: CAD project ownership, title, and latest revision pointer.
- `messages`: user and agent thread messages.
- `revisions`: CAD specs, parameter manifests, and validation reports.
- `artifacts`: downloadable artifact metadata bound to project and revision.
- `feedback`: thumbs up/down and optional comments bound to revision and user/org.
- `usage_events`: route, partType, status, duration, org/user/project attribution.

## Required Ownership

`projects` requires `owner_user_id` or `organization_id`. Artifact authorization derives from the owning project, not from filesystem paths.

## Current Implementation

The app has a Postgres adapter that is active whenever `DATABASE_URL` is configured. It stores:

- users and organizations observed from the auth context
- project owner and organization attribution
- messages
- revisions
- artifact metadata
- feedback
- usage events

Run migrations before starting staging:

```bash
npm run db:migrate
```

`/api/health` reports:

```json
{
  "dataLayer": {
    "mode": "postgres",
    "projectStore": "postgres",
    "productionReady": true
  }
}
```

The app also has a repository-shaped JSON fallback in `logs/projects.json` for local development and emergency staging continuity when `DATABASE_URL` is absent. It stores:

- project owner user id
- organization id
- messages
- revisions
- artifact metadata

Do not claim production SaaS persistence unless `DATABASE_URL` is configured, migrations have run, and `/api/health` reports `dataLayer.productionReady: true`.

## Secret Policy

The data layer must not store:

- model API keys
- Basic Auth passwords
- Clerk/Supabase secrets
- provider raw responses
- full tracebacks
- private server paths
