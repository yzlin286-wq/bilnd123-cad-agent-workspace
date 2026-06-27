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
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: StoredMessage[];
  revisions: StoredRevision[];
  latestRevisionId?: string;
};

export type StoredProjectSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  latestRevisionId?: string;
  revisionCount: number;
  messageCount: number;
  partType?: string;
};
