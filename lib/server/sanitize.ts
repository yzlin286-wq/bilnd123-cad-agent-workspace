const DEFAULT_MAX_TEXT_CHARS = 1000;

export function sanitizeStoredText(value: unknown, maxChars = DEFAULT_MAX_TEXT_CHARS) {
  const sanitized = String(value ?? "")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[redacted-api-key]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/Basic\s+[A-Za-z0-9+/=-]+/gi, "Basic [redacted]")
    .replace(/(password|api[_-]?key|token|secret)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  if (sanitized.length <= maxChars) return sanitized;
  return `${sanitized.slice(0, maxChars)}...`;
}

export function titleFromPrompt(prompt: string) {
  const title = sanitizeStoredText(prompt, 72);
  return title || "Untitled CAD project";
}
