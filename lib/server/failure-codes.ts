import { errorGuidanceForCode } from "@/lib/agent/error-guidance";

export function operationalErrorCode(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error || "");
  const normalized = message.toLowerCase();

  if (/unsupported parttype|unsupported template|supported parttype values/.test(normalized)) {
    return "UNSUPPORTED_PART_TYPE";
  }
  if (
    /edgeoffset|hole radius|no usable area|chamfer is too large|must be positive|must be larger|parameter conflict|invalid dimension/.test(
      normalized,
    )
  ) {
    return "PARAMETER_CONFLICT";
  }
  if (/model did not return valid json|invalid json|did not return json engineering spec|invalid engineering spec/.test(normalized)) {
    return "LLM_JSON_ERROR";
  }
  if (/build123d|open cascade|cad runner produced no json|cad runner exited|runner timed out|traceback/.test(normalized)) {
    return "CAD_RUNNER_CRASH";
  }
  if (/validation failed|validation did not pass/.test(normalized)) {
    return "VALIDATION_FAILED";
  }
  if (/artifact download failed|download returned|download was empty/.test(normalized)) {
    return "ARTIFACT_DOWNLOAD_FAILED";
  }
  if (/sse abort|stream aborted|connection closed/.test(normalized)) {
    return "SSE_ABORT";
  }
  return fallback;
}

const USER_MESSAGES: Record<string, string> = {
  UNSUPPORTED_PART_TYPE:
    "This request is outside the supported staging templates. Supported templates: mounting_plate and l_bracket. Try: make a 120 x 80 x 4 mm mounting plate, or create a 90 x 60 x 40 mm L bracket.",
  PARAMETER_CONFLICT:
    "The requested dimensions conflict with the CAD template constraints. Try reducing edgeOffset, increasing the part dimensions, or reducing the hole diameter.",
  LLM_JSON_ERROR: "The AI model returned a spec the app could not validate. Please retry or contact the staging administrator.",
  CAD_RUNNER_CRASH: "The CAD kernel could not complete this run. Please retry once or contact the staging administrator.",
  VALIDATION_FAILED: "The CAD model was generated but failed geometry validation. Adjust the parameters or report this revision.",
  RATE_LIMITED: "Too many CAD requests. Please wait about a minute and try again.",
  CAD_ENGINE_NOT_CONNECTED: "CAD engine not connected. Connect build123d before rebuilding files.",
  AI_ENGINE_NOT_CONNECTED: "AI CAD engine not connected. Add your model endpoint before using natural language CAD.",
  INVALID_JSON: "Invalid request body. Send valid JSON and try again.",
  PROMPT_REQUIRED: "Prompt is required.",
  PROMPT_TOO_LONG: "Prompt is too long. Shorten the request and try again.",
  REVISION_REQUEST_REQUIRED: "currentSpec, currentRevisionId, and userPrompt are required.",
  SPEC_REQUIRED: "spec is required.",
};

export function userMessageForErrorCode(errorCode: string, fallback = "The CAD agent could not complete this request. Try again or report the run id.") {
  return USER_MESSAGES[errorCode] ?? errorGuidanceForCode(errorCode, fallback).message;
}
