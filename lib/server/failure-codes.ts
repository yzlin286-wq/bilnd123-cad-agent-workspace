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
