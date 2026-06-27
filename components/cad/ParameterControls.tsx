"use client";

import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { EngineeringSpec, ParameterManifestItem } from "@/lib/agent/spec";

export function ParameterControls({
  manifest,
  spec,
  disabled,
  onRebuild,
}: {
  manifest: ParameterManifestItem[];
  spec?: EngineeringSpec;
  disabled?: boolean;
  onRebuild: (spec: EngineeringSpec) => void;
}) {
  const [draft, setDraft] = useState<Record<string, number | string>>(() =>
    Object.fromEntries(manifest.map((item) => [item.key, item.value])),
  );

  const nextSpec = useMemo(() => {
    if (!spec) return undefined;
    return {
      ...spec,
      ...draft,
    } as EngineeringSpec;
  }, [draft, spec]);

  if (!manifest.length || !spec) {
    return <div className="empty-panel">Editable parameters will appear after the first generated revision.</div>;
  }

  return (
    <div className="parameter-controls">
      <div className="properties-header">
        <div>
          <p className="microcopy">Properties</p>
          <h3>{spec.partType}</h3>
        </div>
        <span>{spec.units}</span>
      </div>
      {manifest.map((item) => (
        <label key={item.key}>
          <span>{item.label}</span>
          {typeof item.value === "number" ? (
            <>
              <input
                type="range"
                min={item.min}
                max={item.max}
                step={item.key === "chamfer" ? 0.25 : 0.5}
                value={Number(draft[item.key] ?? item.value)}
                disabled={disabled}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, [item.key]: Number(event.target.value) }))
                }
              />
              <strong>
                {draft[item.key] ?? item.value} {item.unit}
              </strong>
            </>
          ) : (
            <input
              value={String(draft[item.key] ?? item.value)}
              disabled={disabled}
              onChange={(event) => setDraft((current) => ({ ...current, [item.key]: event.target.value }))}
            />
          )}
        </label>
      ))}
      <button className="rebuild-button" disabled={disabled || !nextSpec} onClick={() => nextSpec && onRebuild(nextSpec)}>
        <RefreshCw size={16} />
        Rebuild revision
      </button>
    </div>
  );
}
