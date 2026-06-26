import {
  AlertTriangle,
  Box,
  Braces,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  FileArchive,
  FileCode2,
  FileJson2,
  FileText,
  Layers3,
  PlayCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type ArtifactStatus = "ready" | "running" | "failed" | "approval";
export type WorkstreamStatus = "done" | "running" | "queued" | "failed";

export type Project = {
  name: string;
  kind: string;
  active?: boolean;
};

export type Revision = {
  id: string;
  label: string;
  status: string;
  active?: boolean;
};

export type Artifact = {
  name: string;
  kind: string;
  status: ArtifactStatus;
  size: string;
  icon: LucideIcon;
};

export type WorkstreamStep = {
  key: string;
  label: string;
  detail: string;
  status: WorkstreamStatus;
};

export type Parameter = {
  label: string;
  value: number | string;
  unit?: string;
  min?: number;
  max?: number;
};

export type RuntimeReadiness = {
  llmConfigured: boolean;
  cadRunnerConfigured: boolean;
  primaryModel?: string;
  downgradeModel?: string;
};

export const projects: Project[] = [
  { name: "Phone Stand", kind: "3D print" },
  { name: "Aluminum Mounting Plate", kind: "CNC", active: true },
  { name: "PCB Fixture", kind: "Fixture" },
  { name: "Sensor Enclosure", kind: "Sheet metal" },
];

export const revisions: Revision[] = [
  { id: "001", label: "Rev 001", status: "baseline" },
  { id: "002", label: "Rev 002", status: "dimension pass" },
  { id: "003", label: "Rev 003", status: "active review", active: true },
];

export const artifacts: Artifact[] = [
  { name: "model.step", kind: "STEP", status: "ready", size: "184 KB", icon: Box },
  { name: "model.glb", kind: "Preview", status: "ready", size: "92 KB", icon: Layers3 },
  { name: "drawing.svg", kind: "Drawing", status: "ready", size: "48 KB", icon: FileText },
  { name: "source.py", kind: "build123d", status: "approval", size: "7 KB", icon: FileCode2 },
  { name: "validation.json", kind: "Checks", status: "ready", size: "3 KB", icon: FileJson2 },
  { name: "package.zip", kind: "Bundle", status: "ready", size: "312 KB", icon: FileArchive },
];

export const workstreamSteps: WorkstreamStep[] = [
  {
    key: "parse",
    label: "Parse Spec",
    detail: "120 x 80 x 4 mm plate, M4 holes, 10 mm edge offset, 1 mm chamfer.",
    status: "done",
  },
  {
    key: "code",
    label: "Generate build123d",
    detail: "Parametric source created for plate, hole pattern, chamfer, and exports.",
    status: "done",
  },
  {
    key: "run",
    label: "Run CAD Runner",
    detail: "Sandbox runner should execute build123d and emit neutral CAD formats.",
    status: "done",
  },
  {
    key: "preview",
    label: "Render Preview",
    detail: "GLB preview and SVG drawing are attached to the active revision.",
    status: "done",
  },
  {
    key: "validate",
    label: "Validate Geometry",
    detail: "Bounding box, hole diameter, offset, and chamfer checks passed.",
    status: "done",
  },
  {
    key: "approval",
    label: "Await Approval",
    detail: "User review is required before the revision becomes the production baseline.",
    status: "running",
  },
];

export const parameters: Parameter[] = [
  { label: "Length", value: 120, unit: "mm", min: 20, max: 240 },
  { label: "Width", value: 80, unit: "mm", min: 20, max: 200 },
  { label: "Thickness", value: 4, unit: "mm", min: 1, max: 16 },
  { label: "Hole Dia", value: 4.5, unit: "mm", min: 2, max: 12 },
  { label: "Edge Offset", value: 10, unit: "mm", min: 3, max: 30 },
  { label: "Chamfer", value: 1, unit: "mm", min: 0, max: 5 },
  { label: "Material", value: "Aluminum 6061" },
];

export const validationChecks = [
  { name: "bbox_x", expected: "120 mm", actual: "120.00 mm", passed: true },
  { name: "bbox_y", expected: "80 mm", actual: "80.00 mm", passed: true },
  { name: "bbox_z", expected: "4 mm", actual: "4.00 mm", passed: true },
  { name: "hole_count", expected: "4", actual: "4", passed: true },
  { name: "hole_offset", expected: "10 mm", actual: "10.00 mm", passed: true },
];

export const sourceCode = `from build123d import *

length = 120
width = 80
thickness = 4
hole_dia = 4.5
edge_offset = 10
chamfer = 1

with BuildPart() as plate:
    Box(length, width, thickness)
    with Locations(
        (-length / 2 + edge_offset, -width / 2 + edge_offset, 0),
        ( length / 2 - edge_offset, -width / 2 + edge_offset, 0),
        (-length / 2 + edge_offset,  width / 2 - edge_offset, 0),
        ( length / 2 - edge_offset,  width / 2 - edge_offset, 0),
    ):
        Hole(hole_dia / 2)
    fillet(plate.edges().filter_by(Axis.Z), radius=chamfer)

export_step(plate.part, "model.step")
`;

export const eventExamples = [
  { icon: PlayCircle, label: "workflow.step.started", value: "generate_build123d_code" },
  { icon: Braces, label: "artifact.created", value: "model.step ready" },
  { icon: Layers3, label: "cad.preview.ready", value: "model.glb attached" },
  { icon: ClipboardCheck, label: "validation.completed", value: "5 checks passed" },
];

export const statusIcon: Record<WorkstreamStatus, LucideIcon> = {
  done: CheckCircle2,
  running: PlayCircle,
  queued: Circle,
  failed: AlertTriangle,
};

export const artifactStatusLabel: Record<ArtifactStatus, string> = {
  ready: "Ready",
  running: "Running",
  failed: "Failed",
  approval: "Needs review",
};

export const logText = `2026-06-27T01:58:02 parse_spec ok
2026-06-27T01:58:05 generate_build123d_code ok
2026-06-27T01:58:09 run_cad_runner ok
2026-06-27T01:58:11 export_step ok
2026-06-27T01:58:13 render_svg_drawing ok
2026-06-27T01:58:15 validate_geometry ok
2026-06-27T01:58:16 awaiting_user_approval`;

export const validationJson = JSON.stringify(
  {
    revision: "003",
    passed: true,
    checks: validationChecks,
    noFallbackPolicy: {
      directCodeGenerationFallback: false,
      allowedFallback: "real LLM model downgrade only",
    },
  },
  null,
  2,
);
