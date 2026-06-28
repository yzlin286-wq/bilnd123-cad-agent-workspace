import type { RunHistoryRoute } from "@/lib/server/run-history";
import { isPostgresConfigured, withPostgresTransaction } from "@/lib/server/postgres";
import { ensurePrincipalIds } from "@/lib/server/postgres-principal";
import { sanitizeStoredText } from "@/lib/server/sanitize";

export async function appendUsageEvent(entry: {
  route: RunHistoryRoute;
  userId?: string;
  organizationId?: string;
  projectId?: string;
  partType?: string;
  status: "success" | "failure";
  durationMs: number;
  errorCode?: string;
}) {
  if (!isPostgresConfigured()) return;
  try {
    await withPostgresTransaction(async (client) => {
      await ensurePrincipalIds(client, {
        userId: entry.userId,
        organizationId: entry.organizationId,
      });
      await client.query(
        `insert into usage_events
          (organization_id, user_id, project_id, route, part_type, status, duration_ms, error_code)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          entry.organizationId ? sanitizeStoredText(entry.organizationId, 160) : null,
          entry.userId ? sanitizeStoredText(entry.userId, 160) : null,
          entry.projectId ? sanitizeStoredText(entry.projectId, 160) : null,
          entry.route,
          entry.partType ? sanitizeStoredText(entry.partType, 80) : null,
          entry.status,
          Math.round(entry.durationMs),
          entry.errorCode ? sanitizeStoredText(entry.errorCode, 120) : null,
        ],
      );
    });
  } catch {
    // Usage telemetry must never leak connection details or break the user-facing CAD flow.
  }
}
