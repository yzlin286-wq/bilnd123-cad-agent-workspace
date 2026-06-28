export type AdminVerificationCheck = {
  id: string;
  ok: boolean;
  message: string;
};

export type AdminVerificationResult = {
  ok: boolean;
  generatedAt: string;
  adminEmail: string;
  userId: string;
  checks: AdminVerificationCheck[];
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
  evidence: {
    userFound: boolean;
    primaryEmail: string;
    passwordEnabled: boolean;
    banned: boolean;
    locked: boolean;
    publicRole: string;
    privateRole: string;
    adminByMetadata: boolean;
    adminByEmail: boolean;
    adminByUserId: boolean;
    adminAuthorized: boolean;
  };
};

export function evaluateAdminVerification(input?: {
  clerkSecretConfigured?: boolean;
  clerkPublishableConfigured?: boolean;
  adminEmail?: string;
  user?: {
    id?: string;
    passwordEnabled?: boolean;
    banned?: boolean;
    locked?: boolean;
    primaryEmailAddress?: { emailAddress?: string };
    emailAddresses?: Array<{ emailAddress?: string }>;
    publicMetadata?: Record<string, unknown>;
    privateMetadata?: Record<string, unknown>;
  };
  allowedAdminEmails?: string[];
  allowedAdminUserIds?: string[];
  error?: string;
}): AdminVerificationResult;
