export type DomainTlsCheck = {
  id: string;
  ok: boolean;
  message: string;
};

export type DomainTlsReadinessResult = {
  ok: boolean;
  generatedAt: string;
  baseUrl: string;
  expectedIp: string;
  ipFallbackUrl: string;
  observed: {
    dns: {
      hostname: string;
      addresses: string[];
    };
    httpRedirect: {
      status: number;
      location: string;
    };
    https: {
      unauthStatus: number;
      healthStatus: number;
      app: string;
      cadRunnerConfigured: boolean;
      llmConfigured: boolean;
      outputDirWritable: boolean;
      httpsConfigured: boolean;
      accessMode: string;
      warning: string;
      supportedTemplates: string[];
    };
    ipFallback?: {
      unauthStatus: number;
      healthStatus: number;
      app: string;
    };
  };
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
  checks: DomainTlsCheck[];
};

export function evaluateDomainTlsReadiness(input?: {
  baseUrl?: string;
  expectedIp?: string;
  dnsResolution?: Record<string, unknown>;
  httpRedirect?: Record<string, unknown>;
  httpsUnauthStatus?: number;
  httpsHealthStatus?: number;
  httpsHealth?: Record<string, unknown>;
  ipFallbackUrl?: string;
  ipFallbackUnauthStatus?: number;
  ipFallbackHealthStatus?: number;
  ipFallbackHealth?: Record<string, unknown>;
}): DomainTlsReadinessResult;

export function renderDomainTlsReadiness(report: DomainTlsReadinessResult): string;
