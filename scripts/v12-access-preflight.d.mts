export type V12AccessPreflightReport = {
  ok: boolean;
  generatedAt: string;
  access: {
    domain: string;
    ip: string;
    ipFallback: string;
    accessMode: string;
    https: string;
    warning: string;
    health: {
      app: string;
      runner: boolean;
      llm: boolean;
      outputWritable: boolean;
      supportedTemplates: string[];
    };
  };
  admin: {
    email: string;
    passwordDelivery: string;
    passwordRotationRequired: boolean;
    adminVerified: boolean;
    identityVerified: boolean;
    flowEvidenceVerified: boolean;
    flowEvidencePath: string;
  };
  dataLayer: {
    mode: string;
    productionReady: boolean;
    connected: boolean;
    schemaReady: boolean;
  };
  handoff: {
    ok: boolean;
    passed: number;
    total: number;
    failed: number;
    failedChecks: string[];
  };
  blockers: Array<{
    id: string;
    message: string;
  }>;
};

export function evaluateV12AccessPreflight(input?: {
  handoff?: Record<string, unknown>;
  env?: Record<string, string | undefined>;
}): V12AccessPreflightReport;

export function renderV12AccessPreflight(report: V12AccessPreflightReport): string;
