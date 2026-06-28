export type AdminFlowEvidenceCheck = {
  id: string;
  ok?: boolean;
  status?: number;
  location?: string;
  artifactName?: string;
  bytes?: number;
  projectId?: string;
  [key: string]: unknown;
};

export type AdminFlowEvidenceResult = {
  ok: boolean;
  generatedAt: string;
  evidenceGeneratedAt: string;
  baseUrl: string;
  adminEmail: string;
  build: {
    expectedCommit: string;
    deployedCommit: string;
  };
  flags: {
    adminLoginVerified: boolean;
    adminPageVerified: boolean;
    nonAdminBlockedVerified: boolean;
    adminProjectCreateVerified: boolean;
    adminPackageDownloadVerified: boolean;
    artifactAuthzVerified: boolean;
  };
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
  checks: Array<{
    id: string;
    ok: boolean;
    status?: number;
    location: string;
    artifactName: string;
    bytes?: number;
    projectId: string;
  }>;
  issues: Array<{
    id: string;
    message: string;
  }>;
};

export function evaluateAdminFlowEvidence(
  evidence: {
    generatedAt?: string;
    baseUrl?: string;
    adminEmail?: string;
    checks?: AdminFlowEvidenceCheck[];
    [key: string]: unknown;
  },
  options?: {
    expectedBaseUrl?: string;
    expectedAdminEmail?: string;
    expectedCommit?: string;
  },
): AdminFlowEvidenceResult;
