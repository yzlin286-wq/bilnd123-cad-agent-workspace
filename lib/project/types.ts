import type { CADArtifact, CADRevision } from "@/lib/agent/spec";

export type StoredMessage = {
  id: string;
  role: "user" | "agent";
  content: string;
  createdAt: string;
  route?: "/api/agent/run" | "/api/agent/revise" | "/api/cad/rebuild";
  revisionId?: string;
  errorCode?: string;
};

export type StoredRevision = CADRevision & {
  artifacts: CADArtifact[];
};

export type StoredProject = {
  id: string;
  ownerUserId: string;
  organizationId?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: StoredMessage[];
  revisions: StoredRevision[];
  latestRevisionId?: string;
};

export type StoredProjectSummary = {
  id: string;
  ownerUserId: string;
  organizationId?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  latestRevisionId?: string;
  revisionCount: number;
  messageCount: number;
  partType?: string;
};

export type ArtifactOwnership = {
  artifactId: string;
  projectId: string;
  revisionId: string;
  ownerUserId: string;
  organizationId?: string;
  artifactKind: CADArtifact["kind"];
};
