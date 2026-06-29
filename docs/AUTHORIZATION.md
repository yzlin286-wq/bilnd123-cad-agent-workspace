# Authorization

## Route Protection

- `/app/*`: requires an application identity, meaning a signed local password session, a signed-in Clerk user when `SAAS_AUTH_PROVIDER=clerk`, or explicit local `SAAS_DEV_AUTH_BYPASS=1`.
- `/admin`: requires a SaaS identity and admin status.
- Staging may also use Basic Auth as an outer access gate.
- Basic Auth is not a SaaS user identity. It only lets the request reach the app.

Admin status can come from:

- Local password login issued from `APP_AUTH_USER` / `APP_AUTH_PASSWORD`
- Clerk organization role: `admin`, `org:admin`, or `owner` when Clerk is explicitly enabled
- `SAAS_ADMIN_USER_IDS`
- `SAAS_ADMIN_EMAILS`
- Clerk user metadata `role=admin`, set by `npm run admin:bootstrap` when Clerk is explicitly enabled

## Project Ownership

Every project must have at least one ownership boundary:

- `owner_user_id`
- `organization_id`

Users can access a project only when they are:

- The project owner
- A member of the owning organization
- An admin

## Artifact Authorization

`GET /api/artifacts/[id]` must:

1. Require auth.
2. Resolve artifact ownership from project/revision metadata.
3. Verify the current user can access the project.
4. Return `401` for unauthenticated requests.
5. Return `403` for authenticated users outside the project/org.
6. Resolve the artifact path only after authorization.
7. Preserve path traversal protection under `outputs/cad`.

The route must never expose local server paths.

## Current Caveat

Temporary HTTP staging can still use Basic Auth for health checks and smoke/API validation, but interactive `/app` and `/admin` access must not treat Basic Auth as a signed-in app user. Current staging uses local password login by default. If Clerk is explicitly re-enabled later, the handoff must verify real Clerk login, non-admin `/admin` denial, project ownership, and artifact `401`/`403` behavior.
