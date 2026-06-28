# Authorization

## Route Protection

- `/app/*`: requires a SaaS identity, meaning a signed-in Clerk user or explicit local `SAAS_DEV_AUTH_BYPASS=1`.
- `/admin`: requires a SaaS identity and admin status.
- Staging may also use Basic Auth as an outer access gate.
- Basic Auth is not a SaaS user identity. It only lets the request reach the app.

Admin status can come from:

- Clerk organization role: `admin`, `org:admin`, or `owner`
- `SAAS_ADMIN_USER_IDS`
- `SAAS_ADMIN_EMAILS`
- Clerk user metadata `role=admin`, set by `npm run admin:bootstrap`

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

Temporary HTTP staging can still use Basic Auth for health checks and smoke/API validation, but interactive `/app` and `/admin` access must not treat Basic Auth as a signed-in SaaS user. A v1.2 access handoff must verify real Clerk login, non-admin `/admin` denial, project ownership, and artifact `401`/`403` behavior.
