export type V12HandoffCheck = {
  id: string;
  ok: boolean;
  message: string;
};

export type V12HandoffResult = {
  ok: boolean;
  generatedAt: string;
  baseUrl: string;
  expectedIp: string;
  ipFallbackUrl: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
  checks: V12HandoffCheck[];
};

export function evaluateV12Handoff(input?: Record<string, unknown>): V12HandoffResult;
export function safeUrl(value?: string): string;
export function isProtectedResponse(status?: number, location?: string): boolean;
