"use client";

import { Check, Circle, Loader2, TriangleAlert } from "lucide-react";
import type { WorkstreamStep } from "@/lib/agent/spec";

export function WorkstreamCard({ steps }: { steps: WorkstreamStep[] }) {
  return (
    <div className="workstream-card">
      {steps.map((step) => (
        <div className={`workstream-step ${step.status}`} key={step.id}>
          <StepIcon status={step.status} />
          <div>
            <strong>{step.label}</strong>
            {step.detail ? <span>{step.detail}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function StepIcon({ status }: { status: WorkstreamStep["status"] }) {
  if (status === "done") return <Check size={15} />;
  if (status === "running") return <Loader2 size={15} className="spin" />;
  if (status === "failed") return <TriangleAlert size={15} />;
  return <Circle size={15} />;
}
