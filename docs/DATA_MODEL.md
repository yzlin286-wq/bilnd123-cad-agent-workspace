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

The app has a repository-shaped JSON fallback in `logs/projects.json` for local development and current HTTP-restricted staging continuity. It stores:

- project owner user id
- organization id
- messages
- revisions
- artifact metadata

Postgres is not active unless `DATABASE_URL` is provisioned and the adapter is wired. Do not claim production SaaS persistence until that happens.

## Secret Policy

The data layer must not store:

- model API keys
- Basic Auth passwords
- Clerk/Supabase secrets
- provider raw responses
- full tracebacks
- private server paths
