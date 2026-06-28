export type BasicAuthRotationResult = {
  ok: boolean;
  user: string;
  envFile: string;
  credentialPath: string;
  accessMode: string;
  passwordPresent: boolean;
  passwordGenerated: boolean;
  passwordDelivery: "server_file";
  rotationRequired: boolean;
};

export function rotateBasicAuthCredential(input?: {
  envFile?: string;
  credentialPath?: string;
  user?: string;
  password?: string;
  accessMode?: string;
}): Promise<BasicAuthRotationResult>;

export function updateStagingEnvFile(
  filePath: string,
  input?: {
    user?: string;
    password?: string;
    accessMode?: string;
    credentialPath?: string;
  },
): Promise<void>;

export function writeBasicAuthCredentialFile(
  filePath: string,
  input?: {
    user?: string;
    password?: string;
    accessMode?: string;
  },
): Promise<void>;

export function generateBasicAuthPassword(): string;
