import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { sanitizeStoredText } from "@/lib/server/sanitize";

export const FEEDBACK_LOG_PATH = path.resolve(process.cwd(), "logs", "feedback.jsonl");

export type FeedbackRating = "up" | "down";

export type FeedbackEntry = {
  id: string;
  timestamp: string;
  rating: FeedbackRating;
  comment?: string;
  revisionId?: string;
  route?: string;
};

export async function appendFeedback({
  rating,
  comment,
  revisionId,
  route,
  logPath = FEEDBACK_LOG_PATH,
}: {
  rating: FeedbackRating;
  comment?: string;
  revisionId?: string;
  route?: string;
  logPath?: string;
}) {
  const entry: FeedbackEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    rating,
    comment: comment ? sanitizeStoredText(comment, 500) : undefined,
    revisionId: revisionId ? sanitizeStoredText(revisionId, 120) : undefined,
    route: route ? sanitizeStoredText(route, 120) : undefined,
  };
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

export async function readFeedbackEntries(logPath = FEEDBACK_LOG_PATH) {
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
  const entries = await readFeedbackEntries(logPath);
  const negative = entries.filter((entry) => entry.rating === "down");
  return {
    total: entries.length,
    positive: entries.filter((entry) => entry.rating === "up").length,
    negative: negative.length,
    negativeRevisionIds: [...new Set(negative.map((entry) => entry.revisionId).filter(Boolean))],
  };
}
