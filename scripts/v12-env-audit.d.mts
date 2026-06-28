export type V12EnvAuditReport = {
  ok: boolean;
  generatedAt: string;
  envFile: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
  configured: {
    stagingDomain: boolean;
    stagingHttpsEnabled: boolean;
    accessMode: string;
    clerkSecret: boolean;
    clerkPublishable: boolean;
    databaseUrl: boolean;
    basicAuth: boolean;
    adminEmail: boolean;
    adminCredentialPath: boolean;
  };
  files: {
    env: FileAuditInfo;
    adminCredential: FileAuditInfo;
  };
  checks: Array<{
    id: string;
    ok: boolean;
    message: string;
  }>;
};

export type FileAuditInfo = {
  checked?: boolean;
  exists?: boolean;
  privatePermissions?: boolean;
  mode?: string;
};

export function parseEnvText(text: string): Record<string, string>;

export function evaluateV12EnvAudit(input?: {
  env?: Record<string, string | undefined>;
  envFile?: string;
  envFileInfo?: FileAuditInfo;
  credentialFileInfo?: FileAuditInfo;
}): V12EnvAuditReport;

export function renderV12EnvAudit(report: V12EnvAuditReport): string;
