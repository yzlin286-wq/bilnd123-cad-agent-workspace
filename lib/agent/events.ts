import type { CADArtifact, CADRevision, EngineeringSpec, ValidationReport, WorkstreamStatus } from "@/lib/agent/spec";

export type AgentEvent =
  | {
      type: "run.started";
      runId: string;
      prompt: string;
    }
  | {
      type: "step";
      stepId: string;
      label: string;
      status: WorkstreamStatus;
      detail?: string;
    }
  | {
      type: "spec";
      spec: EngineeringSpec;
    }
  | {
      type: "artifact";
      artifact: CADArtifact;
    }
  | {
      type: "preview";
      artifact: CADArtifact;
    }
  | {
      type: "validation";
      validation: ValidationReport;
    }
  | {
      type: "revision";
      revision: CADRevision;
    }
  | {
      type: "error";
      code: string;
      message: string;
      userMessage: string;
    }
  | {
      type: "run.completed";
      revision: CADRevision;
    };

export function encodeSSE(event: AgentEvent) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
