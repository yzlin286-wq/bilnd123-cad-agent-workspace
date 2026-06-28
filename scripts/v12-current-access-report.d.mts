export type CurrentAccessBlocker = {
  id: string;
  message: string;
};

export type CurrentAccessReport = {
  ok: boolean;
  generatedAt: string;
  currentAccess: {
    baseUrl: string;
    domainUrl: string;
    ip: string;
    ipFallback: string;
    basicAuthProtected: boolean;
    healthStatus: number;
    adminStatus: number;
    appStatus: number;
    temporarySmokeAccessReady: boolean;
    appBlockedWithoutSaasSession: boolean;
    adminBlockedWithoutSaasSession: boolean;
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
      schemaReady: boolean;
    };
    build: {
      deployedCommit: string;
    };
  };
  admin: {
    user: string;
    passwordDelivery: string;
    passwordRotationRequired: boolean;
    temporaryBasicAuthOnly: boolean;
  };
  v12Handoff: {
    ready: boolean;
    handoffGateOk: boolean;
    passed: number;
    total: number;
    failedChecks: string[];
    blockers: CurrentAccessBlocker[];
  };
};

export function evaluateCurrentAccessReport(input?: Record<string, unknown>): CurrentAccessReport;
export function renderCurrentAccessReport(report: CurrentAccessReport): string;
