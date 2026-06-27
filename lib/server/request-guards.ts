import { encodeSSE } from "@/lib/agent/events";
import { getRuntimeConfig } from "@/lib/server/runtime";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const buckets = new Map<string, { count: number; resetAt: number }>();

export function getClientIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local"
  );
}

export function enforceRateLimit(request: Request) {
  const key = `${getClientIp(request)}:${new URL(request.url).pathname}`;
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return undefined;
  }
  bucket.count += 1;
  if (bucket.count <= RATE_LIMIT_MAX_REQUESTS) return undefined;
  return friendlyJSONError("RATE_LIMITED", "Too many CAD requests. Please wait a minute and try again.", 429);
}

export function enforcePromptLimit(prompt: string | undefined, field = "prompt") {
  const maxPromptChars = getRuntimeConfig().maxPromptChars;
  if (!prompt || prompt.length <= maxPromptChars) return undefined;
  return friendlyJSONError(
    "PROMPT_TOO_LONG",
    `${field} is too long. Please keep it under ${maxPromptChars} characters.`,
    413,
  );
}

export function friendlyJSONError(code: string, userMessage: string, status: number) {
  return Response.json({ error: code, userMessage }, { status });
}

export function friendlySSEError(code: string, userMessage: string) {
  return encodeSSE({
    type: "error",
    code,
    message: userMessage,
    userMessage,
  });
}
