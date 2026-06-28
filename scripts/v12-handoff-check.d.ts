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
  observed: {
    domainUrl: string;
    ipAddress: string;
    ipFallbackUrl: string;
    accessMode: string;
    httpsConfigured: boolean;
    warning: string;
    health: {
      app: string;
      cadRunnerConfigured: boolean;
      llmConfigured: boolean;
      outputDirWritable: boolean;
      supportedTemplates: string[];
    };
    auth: {
      clerkConfigured: boolean;
      basicAuthConfigured: boolean;
      devBypassEnabled: boolean;
      adminAllowlistConfigured: boolean;
    };
    dataLayer: {
      mode: string;
      productionReady: boolean;
      connected: boolean;
      projectStore: string;
      schemaReady: boolean;
    };
    admin: {
      email: string;
      passwordDelivery: string;
      credentialPath: string;
    };
    verification: {
      adminLoginVerified: boolean;
      adminPageVerified: boolean;
      nonAdminBlockedVerified: boolean;
      adminProjectCreateVerified: boolean;
      adminPackageDownloadVerified: boolean;
      artifactAuthzVerified: boolean;
    };
  };
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
