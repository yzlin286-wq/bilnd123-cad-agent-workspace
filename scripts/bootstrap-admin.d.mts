export function updateAdminHandoffEnvFile(
  filePath: string,
  input?: {
    adminEmail?: string;
    credentialPath?: string;
  },
): Promise<void>;
