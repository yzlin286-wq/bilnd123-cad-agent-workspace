import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appendFeedback, summarizeFeedback } from "../lib/server/feedback";

test("feedback log stores sanitized alpha trial feedback summary", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "feedback-"));
  const logPath = path.join(tempRoot, "feedback.jsonl");

  await appendFeedback({
    rating: "up",
    comment: "Looks good",
    revisionId: "rev001",
    route: "/api/agent/run",
    logPath,
  });
  await appendFeedback({
    rating: "down",
    comment: "failed with sk-real-looking-secret password=hunter2",
    revisionId: "rev002",
    route: "/api/agent/revise",
    logPath,
  });

  const summary = await summarizeFeedback(logPath);
  const raw = await fs.readFile(logPath, "utf8");

  assert.equal(summary.total, 2);
  assert.equal(summary.positive, 1);
  assert.equal(summary.negative, 1);
  assert.deepEqual(summary.negativeRevisionIds, ["rev002"]);
  assert.equal(raw.includes("sk-real-looking-secret"), false);
  assert.equal(raw.includes("hunter2"), false);

  await fs.rm(tempRoot, { recursive: true, force: true });
});
