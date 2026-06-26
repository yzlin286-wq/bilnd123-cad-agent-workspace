"use client";

import { Background, Controls, MiniMap, ReactFlow, type Edge, type Node } from "@xyflow/react";

const nodes: Node[] = [
  { id: "prompt", position: { x: 0, y: 60 }, data: { label: "User Prompt" }, type: "input" },
  { id: "spec", position: { x: 190, y: 60 }, data: { label: "Engineering Spec" } },
  { id: "code", position: { x: 410, y: 60 }, data: { label: "build123d Code" } },
  { id: "runner", position: { x: 650, y: 60 }, data: { label: "CAD Runner" } },
  { id: "validate", position: { x: 900, y: 60 }, data: { label: "Geometry Validator" } },
  { id: "files", position: { x: 1160, y: 60 }, data: { label: "STEP / Drawing / Source" }, type: "output" },
];

const edges: Edge[] = [
  { id: "prompt-spec", source: "prompt", target: "spec", animated: false },
  { id: "spec-code", source: "spec", target: "code", animated: false },
  { id: "code-runner", source: "code", target: "runner", animated: false },
  { id: "runner-validate", source: "runner", target: "validate", animated: false },
  { id: "validate-files", source: "validate", target: "files", animated: true },
];

export function WorkstreamFlow() {
  return (
    <div className="flow-frame">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        minZoom={0.3}
        maxZoom={1.4}
        nodesDraggable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#334155" gap={18} />
        <MiniMap pannable zoomable />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
