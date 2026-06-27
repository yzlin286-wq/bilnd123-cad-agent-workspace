import { canAccessProject, forbiddenResponse, isAdminUser, requireRequestAuth } from "@/lib/server/auth";
import { appendFeedback, summarizeFeedback, type FeedbackRating } from "@/lib/server/feedback";
import { findProjectByRevisionId } from "@/lib/server/project-store";
import { friendlyJSONError } from "@/lib/server/request-guards";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const authResult = await requireRequestAuth(request);
  if (authResult.response) return authResult.response;
  if (!isAdminUser(authResult.auth)) return forbiddenResponse();
  return Response.json({ feedback: await summarizeFeedback() });
}

export async function POST(request: Request) {
  const authResult = await requireRequestAuth(request);
  if (authResult.response) return authResult.response;
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
  if (body.revisionId) {
    const project = await findProjectByRevisionId(body.revisionId);
    if (project && !canAccessProject(authResult.auth, project)) {
      return forbiddenResponse();
    }
  }

  const feedback = await appendFeedback({
    rating: body.rating,
    comment: body.comment,
    revisionId: body.revisionId,
    userId: authResult.auth.userId,
    organizationId: authResult.auth.organizationId,
    route: body.route,
  });
  return Response.json({ feedback }, { status: 201 });
}
