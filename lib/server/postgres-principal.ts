import type pg from "pg";
import type { AuthContext } from "@/lib/server/auth";
import { sanitizeStoredText } from "@/lib/server/sanitize";

export async function ensureAuthPrincipal(client: pg.Pool | pg.PoolClient, auth: Pick<AuthContext, "userId" | "email" | "organizationId" | "organizationRole">) {
  await ensurePrincipalIds(client, {
    userId: auth.userId,
    email: auth.email,
    organizationId: auth.organizationId,
    organizationRole: auth.organizationRole,
  });
}

export async function ensurePrincipalIds(
  client: pg.Pool | pg.PoolClient,
  {
    userId,
    email,
    organizationId,
    organizationRole,
  }: {
    userId?: string;
    email?: string;
    organizationId?: string;
    organizationRole?: string;
  },
) {
  const safeUserId = userId ? sanitizeStoredText(userId, 160) : undefined;
  const safeEmail = email ? sanitizeStoredText(email, 320) : undefined;
  const safeOrgId = organizationId ? sanitizeStoredText(organizationId, 160) : undefined;
  if (safeUserId) {
    await client.query(
      `insert into users (id, email, updated_at)
       values ($1, $2, now())
       on conflict (id) do update set
         email = coalesce(excluded.email, users.email),
         updated_at = now()`,
      [safeUserId, safeEmail],
    );
  }
  if (safeOrgId) {
    await client.query(
      `insert into organizations (id, name, updated_at)
       values ($1, $2, now())
       on conflict (id) do update set updated_at = now()`,
      [safeOrgId, safeOrgId],
    );
  }
  if (safeUserId && safeOrgId) {
    await client.query(
      `insert into organization_members (organization_id, user_id, role)
       values ($1, $2, $3)
       on conflict (organization_id, user_id) do update set role = excluded.role`,
      [safeOrgId, safeUserId, sanitizeStoredText(organizationRole || "member", 80)],
    );
  }
}
