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
      requiredTables: string[];
      missingTables: string[];
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
    credential: {
      path: string;
      checked: boolean;
      exists: boolean;
      privatePermissions: boolean;
      userMatches: boolean;
      passwordPresent: boolean;
      rotationRequired: boolean;
      mode: string;
    };
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
export function resolveCurrentAccessRuntimeOptions(
  options?: Record<string, string | undefined>,
  env?: Record<string, string | undefined>,
): {
  baseUrl: string;
  probeBaseUrl: string;
  domainUrl: string;
  ip: string;
  ipFallback: string;
  adminUser: string;
  credentialPath: string;
  passwordDelivery: string;
};
export function inspectCredentialFile(
  filePath: string,
  expectedUser?: string,
): Promise<{
  checked: boolean;
  exists: boolean;
  privatePermissions: boolean;
  userMatches: boolean;
  passwordPresent: boolean;
  rotationRequired: boolean;
  mode: string;
}>;
