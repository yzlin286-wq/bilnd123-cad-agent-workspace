import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isPostgresConfigured, queryPostgres, withPostgresTransaction } from "@/lib/server/postgres";
import { ensurePrincipalIds } from "@/lib/server/postgres-principal";
import { sanitizeStoredText } from "@/lib/server/sanitize";

export const FEEDBACK_LOG_PATH = path.resolve(process.cwd(), "logs", "feedback.jsonl");

export type FeedbackRating = "up" | "down";

export type FeedbackEntry = {
  id: string;
  timestamp: string;
  rating: FeedbackRating;
  comment?: string;
  revisionId?: string;
  userId?: string;
  organizationId?: string;
  route?: string;
};

export async function appendFeedback({
  rating,
  comment,
  revisionId,
  userId,
  organizationId,
  route,
  logPath = FEEDBACK_LOG_PATH,
}: {
  rating: FeedbackRating;
  comment?: string;
  revisionId?: string;
  userId?: string;
  organizationId?: string;
  route?: string;
  logPath?: string;
}) {
  const entry: FeedbackEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    rating,
    comment: comment ? sanitizeStoredText(comment, 500) : undefined,
    revisionId: revisionId ? sanitizeStoredText(revisionId, 120) : undefined,
    userId: userId ? sanitizeStoredText(userId, 120) : undefined,
    organizationId: organizationId ? sanitizeStoredText(organizationId, 120) : undefined,
    route: route ? sanitizeStoredText(route, 120) : undefined,
  };
  if (shouldUsePostgresFeedback(logPath)) {
    await withPostgresTransaction(async (client) => {
      await ensurePrincipalIds(client, {
        userId: entry.userId,
        organizationId: entry.organizationId,
      });
      const revisionId = entry.revisionId ? await existingRevisionId(entry.revisionId) : undefined;
      await client.query(
        `insert into feedback (id, revision_id, user_id, organization_id, rating, comment, route, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          entry.id,
          revisionId ?? null,
          entry.userId ?? null,
          entry.organizationId ?? null,
          entry.rating,
          entry.comment ?? null,
          entry.route ?? null,
          entry.timestamp,
        ],
      );
    });
    return entry;
  }
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

export async function readFeedbackEntries(logPath = FEEDBACK_LOG_PATH) {
  if (shouldUsePostgresFeedback(logPath)) {
    const result = await queryPostgres<{
      id: string;
      created_at: Date | string;
      rating: FeedbackRating;
      comment: string | null;
      revision_id: string | null;
      user_id: string | null;
      organization_id: string | null;
      route: string | null;
    }>(
      `select id, created_at, rating, comment, revision_id, user_id, organization_id, route
       from feedback
       order by created_at asc`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      timestamp: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
      rating: row.rating,
      comment: row.comment || undefined,
      revisionId: row.revision_id || undefined,
      userId: row.user_id || undefined,
      organizationId: row.organization_id || undefined,
      route: row.route || undefined,
    }));
  }
  try {
    const text = await fs.readFile(logPath, "utf8");
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as FeedbackEntry);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function summarizeFeedback(logPath = FEEDBACK_LOG_PATH) {
  if (shouldUsePostgresFeedback(logPath)) {
    const result = await queryPostgres<{
      total: string | number;
      positive: string | number;
      negative: string | number;
      negative_revision_ids: string[] | null;
    }>(
      `select
         count(*)::int as total,
         count(*) filter (where rating = 'up')::int as positive,
         count(*) filter (where rating = 'down')::int as negative,
         coalesce(array_agg(distinct revision_id) filter (where rating = 'down' and revision_id is not null), '{}') as negative_revision_ids
       from feedback`,
    );
    const row = result.rows[0];
    return {
      total: Number(row?.total ?? 0),
      positive: Number(row?.positive ?? 0),
      negative: Number(row?.negative ?? 0),
      negativeRevisionIds: row?.negative_revision_ids ?? [],
    };
  }
  const entries = await readFeedbackEntries(logPath);
  const negative = entries.filter((entry) => entry.rating === "down");
  return {
    total: entries.length,
    positive: entries.filter((entry) => entry.rating === "up").length,
    negative: negative.length,
    negativeRevisionIds: [...new Set(negative.map((entry) => entry.revisionId).filter(Boolean))],
  };
}

function shouldUsePostgresFeedback(logPath: string) {
  return logPath === FEEDBACK_LOG_PATH && isPostgresConfigured();
}

async function existingRevisionId(revisionId: string) {
  const result = await queryPostgres<{ id: string }>("select id from revisions where id = $1", [revisionId]);
  return result.rows[0]?.id;
}
