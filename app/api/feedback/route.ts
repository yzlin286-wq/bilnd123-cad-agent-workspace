import { appendFeedback, summarizeFeedback, type FeedbackRating } from "@/lib/server/feedback";
import { friendlyJSONError } from "@/lib/server/request-guards";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ feedback: await summarizeFeedback() });
}

export async function POST(request: Request) {
  let body: {
    rating?: FeedbackRating;
    comment?: string;
    revisionId?: string;
    route?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return friendlyJSONError("INVALID_JSON", "Invalid feedback payload.", 400);
  }

  if (body.rating !== "up" && body.rating !== "down") {
    return friendlyJSONError("FEEDBACK_RATING_REQUIRED", "Choose thumbs up or thumbs down before sending feedback.", 400);
  }

  const feedback = await appendFeedback({
    rating: body.rating,
    comment: body.comment,
    revisionId: body.revisionId,
    route: body.route,
  });
  return Response.json({ feedback }, { status: 201 });
}
