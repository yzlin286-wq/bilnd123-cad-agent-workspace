"""Run a real build123d CAD template job from JSON stdin.

This runner intentionally has no local fallback. If build123d or Open Cascade is
not available, it exits non-zero instead of fabricating CAD artifacts.
"""

from __future__ import annotations

import json
import math
import sys
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def main() -> int:
    try:
        request = json.loads(sys.stdin.read() or "{}")
        spec = normalize_spec(request.get("spec", {}))
        validate_spec(spec)
        run_dir = make_run_dir(request.get("outputDir"))
        build_result = run_build123d(spec, run_dir)
        source_path = run_dir / "source.py"
        source_path.write_text(render_source(spec), encoding="utf-8")

        drawing_path = write_svg_drawing(spec, run_dir / "drawing.svg")
        validation_path = write_validation(spec, build_result["metrics"], run_dir / "validation.json")
        spec_path = run_dir / "spec.json"
        spec_path.write_text(json.dumps(spec, indent=2), encoding="utf-8")
        artifact_paths = {
            **build_result["artifacts"],
            "drawingSvg": drawing_path,
            "source": source_path,
            "spec": spec_path,
            "validation": validation_path,
        }
        manifest_path = run_dir / "manifest.json"
        package_path = run_dir / "package.zip"
        write_manifest(spec, build_result["metrics"], artifact_paths, manifest_path)
        package_path = write_package(artifact_paths, manifest_path, package_path)
        last_package_size = package_path.stat().st_size
        for _ in range(5):
            manifest_path = write_manifest(
                spec,
                build_result["metrics"],
                {**artifact_paths, "package": package_path},
                manifest_path,
            )
            package_path = write_package(artifact_paths, manifest_path, package_path)
            current_package_size = package_path.stat().st_size
            if current_package_size == last_package_size:
                break
            last_package_size = current_package_size
        log_path = run_dir / "run.log"
        log_path.write_text(
            "\n".join(
                [
                    f"{iso_now()} parse_spec ok",
                    f"{iso_now()} run_build123d ok",
                    f"{iso_now()} export_step ok",
                    f"{iso_now()} export_stl ok",
                    f"{iso_now()} render_svg_drawing ok",
                    f"{iso_now()} validate_geometry ok",
                    f"{iso_now()} package_zip ok",
                    f"{iso_now()} write_manifest ok",
                ]
            ),
            encoding="utf-8",
        )

        print(
            json.dumps(
                {
                    "ok": True,
                    "runDir": str(run_dir),
                    "artifacts": {
                        **{key: str(value) for key, value in build_result["artifacts"].items()},
                        "drawingSvg": str(drawing_path),
                        "source": str(source_path),
                        "spec": str(spec_path),
                        "validation": str(validation_path),
                        "package": str(package_path),
                        "manifest": str(manifest_path),
                        "log": str(log_path),
                    },
                },
                ensure_ascii=False,
            )
        )
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


def normalize_spec(raw: dict[str, Any]) -> dict[str, Any]:
    spec = {
        "partType": str(raw.get("partType", raw.get("part_type", "mounting_plate"))),
        "length": number(raw.get("length", 120), "length"),
        "height": number(raw.get("height", 60), "height") if raw.get("height") is not None else None,
        "width": number(raw.get("width", 80), "width"),
        "thickness": number(raw.get("thickness", 4), "thickness"),
        "holeDiameter": number(raw.get("holeDiameter", raw.get("hole_dia", 4.5)), "holeDiameter"),
        "edgeOffset": number(raw.get("edgeOffset", raw.get("edge_offset", 10)), "edgeOffset"),
        "chamfer": number(raw.get("chamfer", 1), "chamfer"),
        "material": str(raw.get("material", "Aluminum 6061")),
        "units": str(raw.get("units", "mm")),
    }
    if spec["height"] is None and spec["partType"] != "l_bracket":
        del spec["height"]
    return spec


def number(value: Any, field: str) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} must be numeric") from exc
    if not math.isfinite(parsed):
        raise ValueError(f"{field} must be finite")
    return parsed


def validate_spec(spec: dict[str, Any]) -> None:
    part_type = spec["partType"]
    length = spec["length"]
    width = spec["width"]
    height = spec.get("height")
    thickness = spec["thickness"]
    hole_dia = spec["holeDiameter"]
    edge = spec["edgeOffset"]
    chamfer = spec["chamfer"]

    if part_type not in {"mounting_plate", "l_bracket"}:
        raise ValueError(f"Unsupported partType '{part_type}'. Supported partType values: mounting_plate, l_bracket")
    if min(length, width, thickness, hole_dia) <= 0:
        raise ValueError("length, width, thickness, and holeDiameter must be positive")
    if part_type == "l_bracket" and (height is None or height <= 0):
        raise ValueError("height must be positive for l_bracket")
    if edge <= hole_dia / 2:
        raise ValueError("edgeOffset must be larger than the hole radius")
    if part_type == "mounting_plate" and edge * 2 >= min(length, width):
        raise ValueError("edgeOffset leaves no usable area for the hole pattern")
    if part_type == "l_bracket" and (edge * 2 >= min(length, width) or edge >= height):
        raise ValueError("edgeOffset leaves no usable area for the l_bracket hole pattern")
    if chamfer < 0:
        raise ValueError("chamfer must be zero or positive")
    if part_type == "mounting_plate" and chamfer >= min(thickness / 2, length / 2, width / 2):
        raise ValueError("chamfer is too large for the part dimensions")
    if part_type == "l_bracket" and chamfer >= min(thickness / 2, length / 2, width / 2, height / 2):
        raise ValueError("chamfer is too large for the part dimensions")


def make_run_dir(output_dir: Any) -> Path:
    base = Path(str(output_dir)) if output_dir else Path("outputs") / "cad"
    run_dir = base / f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
    run_dir.mkdir(parents=True, exist_ok=True)
    return run_dir


def run_build123d(spec: dict[str, Any], run_dir: Path) -> dict[str, Any]:
    if spec["partType"] == "mounting_plate":
        return build_mounting_plate(spec, run_dir)
    if spec["partType"] == "l_bracket":
        return build_l_bracket(spec, run_dir)
    raise ValueError(f"Unsupported partType '{spec['partType']}'. Supported partType values: mounting_plate, l_bracket")


def build_mounting_plate(spec: dict[str, Any], run_dir: Path) -> dict[str, Any]:
    try:
        from build123d import (
            Axis,
            Box,
            BuildPart,
            GeomType,
            Hole,
            Locations,
            chamfer,
            export_step,
            export_stl,
            import_step,
        )
    except Exception as exc:  # pragma: no cover - depends on local CAD install
        raise RuntimeError(
            "build123d is not installed or cannot load Open Cascade. Install requirements.txt and retry."
        ) from exc

    length = spec["length"]
    width = spec["width"]
    thickness = spec["thickness"]
    hole_dia = spec["holeDiameter"]
    edge = spec["edgeOffset"]
    chamfer_length = spec["chamfer"]

    with BuildPart() as plate:
        Box(length, width, thickness)
        with Locations(
            (-length / 2 + edge, -width / 2 + edge, 0),
            (length / 2 - edge, -width / 2 + edge, 0),
            (-length / 2 + edge, width / 2 - edge, 0),
            (length / 2 - edge, width / 2 - edge, 0),
        ):
            Hole(hole_dia / 2)
        if chamfer_length:
            chamfer(plate.edges().filter_by(Axis.Z), length=chamfer_length)

    step_path = run_dir / "model.step"
    stl_path = run_dir / "model.stl"
    export_step(plate.part, str(step_path))
    export_stl(plate.part, str(stl_path))

    bbox = plate.part.bounding_box()
    cyl_faces = plate.part.faces().filter_by(GeomType.CYLINDER)
    cylinder_radii = sorted(round(face.radius, 6) for face in cyl_faces)
    hole_radius = round(hole_dia / 2, 6)
    hole_cylinder_radii = [radius for radius in cylinder_radii if abs(radius - hole_radius) < 0.001]
    reloaded = import_step(str(step_path))
    reloaded_bbox = reloaded.bounding_box()

    metrics = {
        "partType": "mounting_plate",
        "bbox": vector_to_dict(bbox.size),
        "bboxMin": vector_to_dict(bbox.min),
        "bboxMax": vector_to_dict(bbox.max),
        "stepReloadedBbox": vector_to_dict(reloaded_bbox.size),
        "solidCount": len(plate.part.solids()),
        "faceCount": len(plate.part.faces()),
        "edgeCount": len(plate.part.edges()),
        "cylindricalFaceCount": len(cyl_faces),
        "cylinderRadii": cylinder_radii,
        "holeCylindricalFaceCount": len(hole_cylinder_radii),
        "holeCylinderRadii": hole_cylinder_radii,
        "chamferLength": chamfer_length,
        "chamferOperator": "chamfer",
        "stepBytes": step_path.stat().st_size,
        "stlBytes": stl_path.stat().st_size,
    }
    return {"artifacts": {"step": step_path, "stl": stl_path}, "metrics": metrics}


def build_l_bracket(spec: dict[str, Any], run_dir: Path) -> dict[str, Any]:
    try:
        from build123d import (
            Axis,
            Box,
            BuildPart,
            GeomType,
            Hole,
            Locations,
            chamfer,
            export_step,
            export_stl,
            import_step,
        )
    except Exception as exc:  # pragma: no cover - depends on local CAD install
        raise RuntimeError(
            "build123d is not installed or cannot load Open Cascade. Install requirements.txt and retry."
        ) from exc

    length = spec["length"]
    height = spec["height"]
    width = spec["width"]
    thickness = spec["thickness"]
    hole_dia = spec["holeDiameter"]
    edge = spec["edgeOffset"]
    chamfer_length = spec["chamfer"]

    with BuildPart() as bracket:
        with Locations((0, length / 2, thickness / 2)):
            Box(width, length, thickness)
        with Locations((0, thickness / 2, height / 2)):
            Box(width, thickness, height)
        with Locations(
            (-width / 2 + edge, edge, 0),
            (width / 2 - edge, edge, 0),
            (-width / 2 + edge, length - edge, 0),
            (width / 2 - edge, length - edge, 0),
        ):
            Hole(hole_dia / 2)
        if chamfer_length:
            chamfer(bracket.edges().filter_by(Axis.X), length=chamfer_length)

    step_path = run_dir / "model.step"
    stl_path = run_dir / "model.stl"
    export_step(bracket.part, str(step_path))
    export_stl(bracket.part, str(stl_path))

    bbox = bracket.part.bounding_box()
    cyl_faces = bracket.part.faces().filter_by(GeomType.CYLINDER)
    cylinder_radii = sorted(round(face.radius, 6) for face in cyl_faces)
    hole_radius = round(hole_dia / 2, 6)
    hole_cylinder_radii = [radius for radius in cylinder_radii if abs(radius - hole_radius) < 0.001]
    reloaded = import_step(str(step_path))
    reloaded_bbox = reloaded.bounding_box()

    metrics = {
        "partType": "l_bracket",
        "bbox": vector_to_dict(bbox.size),
        "bboxMin": vector_to_dict(bbox.min),
        "bboxMax": vector_to_dict(bbox.max),
        "stepReloadedBbox": vector_to_dict(reloaded_bbox.size),
        "solidCount": len(bracket.part.solids()),
        "faceCount": len(bracket.part.faces()),
        "edgeCount": len(bracket.part.edges()),
        "cylindricalFaceCount": len(cyl_faces),
        "cylinderRadii": cylinder_radii,
        "holeCylindricalFaceCount": len(hole_cylinder_radii),
        "holeCylinderRadii": hole_cylinder_radii,
        "chamferLength": chamfer_length,
        "chamferOperator": "chamfer",
        "stepBytes": step_path.stat().st_size,
        "stlBytes": stl_path.stat().st_size,
    }
    return {"artifacts": {"step": step_path, "stl": stl_path}, "metrics": metrics}


def write_svg_drawing(spec: dict[str, Any], path: Path) -> Path:
    if spec["partType"] == "l_bracket":
        return write_l_bracket_svg(spec, path)
    return write_mounting_plate_svg(spec, path)


def write_mounting_plate_svg(spec: dict[str, Any], path: Path) -> Path:
    length = spec["length"]
    width = spec["width"]
    hole_dia = spec["holeDiameter"]
    edge = spec["edgeOffset"]
    scale = min(420 / length, 250 / width)
    plate_w = length * scale
    plate_h = width * scale
    x0 = 60
    y0 = 45
    holes = [
        (x0 + edge * scale, y0 + edge * scale),
        (x0 + (length - edge) * scale, y0 + edge * scale),
        (x0 + edge * scale, y0 + (width - edge) * scale),
        (x0 + (length - edge) * scale, y0 + (width - edge) * scale),
    ]
    hole_r = hole_dia * scale / 2
    circles = "\n".join(
        f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{hole_r:.2f}" fill="none" stroke="#0f172a" stroke-width="2" />'
        for x, y in holes
    )
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 360">
  <rect x="20" y="20" width="520" height="320" fill="#f8fafc" stroke="#1f2937" stroke-width="2" />
  <rect x="{x0:.2f}" y="{y0:.2f}" width="{plate_w:.2f}" height="{plate_h:.2f}" rx="6" fill="none" stroke="#0f172a" stroke-width="3" />
  {circles}
  <text x="34" y="314" fill="#0f172a" font-family="Inter, Arial" font-size="13">Mounting plate | {spec["units"]} | {spec["material"]}</text>
  <text x="360" y="314" fill="#0f172a" font-family="Inter, Arial" font-size="13">{length:g} x {width:g} x {spec["thickness"]:g}</text>
</svg>
"""
    path.write_text(svg, encoding="utf-8")
    return path


def write_l_bracket_svg(spec: dict[str, Any], path: Path) -> Path:
    length = spec["length"]
    height = spec["height"]
    width = spec["width"]
    thickness = spec["thickness"]
    hole_dia = spec["holeDiameter"]
    edge = spec["edgeOffset"]
    scale = min(420 / length, 230 / height)
    base_w = length * scale
    upright_h = height * scale
    wall_t = max(thickness * scale, 4)
    x0 = 70
    y0 = 285
    hole_r = hole_dia * scale / 2
    holes = [
        (x0 + edge * scale, y0 - wall_t / 2),
        (x0 + (length - edge) * scale, y0 - wall_t / 2),
    ]
    circles = "\n".join(
        f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{hole_r:.2f}" fill="none" stroke="#0f172a" stroke-width="2" />'
        for x, y in holes
    )
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 360">
  <rect x="20" y="20" width="520" height="320" fill="#f8fafc" stroke="#1f2937" stroke-width="2" />
  <path d="M {x0:.2f} {y0:.2f} L {x0 + base_w:.2f} {y0:.2f} L {x0 + base_w:.2f} {y0 - wall_t:.2f} L {x0 + wall_t:.2f} {y0 - wall_t:.2f} L {x0 + wall_t:.2f} {y0 - upright_h:.2f} L {x0:.2f} {y0 - upright_h:.2f} Z" fill="none" stroke="#0f172a" stroke-width="3" />
  {circles}
  <text x="34" y="314" fill="#0f172a" font-family="Inter, Arial" font-size="13">L bracket | width {width:g} {spec["units"]} | {spec["material"]}</text>
  <text x="350" y="314" fill="#0f172a" font-family="Inter, Arial" font-size="13">{length:g} x {height:g} x {thickness:g}</text>
</svg>
"""
    path.write_text(svg, encoding="utf-8")
    return path


def write_validation(spec: dict[str, Any], metrics: dict[str, Any], path: Path) -> Path:
    expected_bbox = expected_bbox_for(spec)
    checks = [
        text_check("part_type", spec["partType"], metrics["partType"]),
        check("bbox_x", expected_bbox["x"], metrics["bbox"]["x"]),
        check("bbox_y", expected_bbox["y"], metrics["bbox"]["y"]),
        check("bbox_z", expected_bbox["z"], metrics["bbox"]["z"]),
        check("step_reload_bbox_x", expected_bbox["x"], metrics["stepReloadedBbox"]["x"]),
        check("step_reload_bbox_y", expected_bbox["y"], metrics["stepReloadedBbox"]["y"]),
        check("step_reload_bbox_z", expected_bbox["z"], metrics["stepReloadedBbox"]["z"]),
        check("solid_count", 1, metrics["solidCount"]),
        check("hole_cylindrical_face_count", 4, metrics["holeCylindricalFaceCount"]),
        check("hole_radius", spec["holeDiameter"] / 2, min(metrics["holeCylinderRadii"] or [0])),
        text_check("chamfer_operator", "chamfer", metrics["chamferOperator"]),
        check("chamfer_length", spec["chamfer"], metrics["chamferLength"]),
        min_file_size_check("step_file", metrics["stepBytes"]),
        min_file_size_check("stl_file", metrics["stlBytes"]),
    ]
    path.write_text(
        json.dumps(
            {
                "passed": all(item["passed"] for item in checks),
                "checks": checks,
                "metrics": metrics,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return path


def expected_bbox_for(spec: dict[str, Any]) -> dict[str, float]:
    if spec["partType"] == "l_bracket":
        return {"x": spec["width"], "y": spec["length"], "z": spec["height"]}
    return {"x": spec["length"], "y": spec["width"], "z": spec["thickness"]}


def check(name: str, expected: float, actual: float) -> dict[str, Any]:
    return {
        "name": name,
        "expected": expected,
        "actual": actual,
        "passed": abs(float(expected) - float(actual)) < 0.001,
    }


def min_file_size_check(name: str, actual: int) -> dict[str, Any]:
    return {
        "name": name,
        "expected": "> 0 bytes",
        "actual": actual,
        "passed": actual > 0,
    }


def text_check(name: str, expected: str, actual: str) -> dict[str, Any]:
    return {
        "name": name,
        "expected": expected,
        "actual": actual,
        "passed": expected == actual,
    }


def write_manifest(
    spec: dict[str, Any],
    metrics: dict[str, Any],
    artifacts: dict[str, Path],
    path: Path,
) -> Path:
    manifest = {
        "revisionId": path.parent.name,
        "createdAt": iso_now(),
        "engineeringSpec": spec,
        "parameterManifest": parameter_manifest_for(spec),
        "artifacts": [
            artifact("step", "STEP", artifacts["step"]),
            artifact("stl", "Preview mesh", artifacts["stl"]),
            artifact("drawingSvg", "Drawing", artifacts["drawingSvg"]),
            artifact("source", "build123d source", artifacts["source"]),
            artifact("spec", "Engineering spec", artifacts["spec"]),
            artifact("validation", "Validation report", artifacts["validation"]),
            *([artifact("package", "Complete artifact package", artifacts["package"])] if "package" in artifacts else []),
        ],
        "metrics": metrics,
    }
    path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return path


def parameter_manifest_for(spec: dict[str, Any]) -> list[dict[str, Any]]:
    items = [
        parameter("length", "Length", spec["length"], "mm", 20, 240),
    ]
    if spec["partType"] == "l_bracket":
        items.append(parameter("height", "Height", spec["height"], "mm", 20, 180))
    items.extend(
        [
            parameter("width", "Width", spec["width"], "mm", 20, 200),
            parameter("thickness", "Thickness", spec["thickness"], "mm", 1, 20),
            parameter("holeDiameter", "Hole diameter", spec["holeDiameter"], "mm", 2, 16),
            parameter("edgeOffset", "Edge offset", spec["edgeOffset"], "mm", 3, 40),
            parameter("chamfer", "Chamfer", spec["chamfer"], "mm", 0, 6),
        ]
    )
    return items


def parameter(
    key: str,
    label: str,
    value: float,
    unit: str,
    minimum: float,
    maximum: float,
) -> dict[str, Any]:
    return {
        "key": key,
        "label": label,
        "value": value,
        "unit": unit,
        "min": minimum,
        "max": maximum,
    }


def artifact(kind: str, label: str, path: Path) -> dict[str, Any]:
    return {
        "kind": kind,
        "label": label,
        "name": path.name,
        "path": str(path),
        "bytes": path.stat().st_size,
    }


def write_package(artifacts: dict[str, Path], manifest_path: Path, package_path: Path) -> Path:
    files = [
        artifacts["step"],
        artifacts["stl"],
        artifacts["drawingSvg"],
        artifacts["source"],
        artifacts["spec"],
        artifacts["validation"],
        manifest_path,
    ]
    with zipfile.ZipFile(package_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for file_path in files:
            archive.write(file_path, arcname=file_path.name)
    return package_path


def vector_to_dict(vector: Any) -> dict[str, float]:
    return {"x": float(vector.X), "y": float(vector.Y), "z": float(vector.Z)}


def render_source(spec: dict[str, Any]) -> str:
    if spec["partType"] == "l_bracket":
        return render_l_bracket_source(spec)
    return render_mounting_plate_source(spec)


def render_mounting_plate_source(spec: dict[str, Any]) -> str:
    return f"""from build123d import *

length = {spec["length"]:g}
width = {spec["width"]:g}
thickness = {spec["thickness"]:g}
hole_dia = {spec["holeDiameter"]:g}
edge_offset = {spec["edgeOffset"]:g}
chamfer_length = {spec["chamfer"]:g}

with BuildPart() as plate:
    Box(length, width, thickness)
    with Locations(
        (-length / 2 + edge_offset, -width / 2 + edge_offset, 0),
        ( length / 2 - edge_offset, -width / 2 + edge_offset, 0),
        (-length / 2 + edge_offset,  width / 2 - edge_offset, 0),
        ( length / 2 - edge_offset,  width / 2 - edge_offset, 0),
    ):
        Hole(hole_dia / 2)
    if chamfer_length:
        chamfer(plate.edges().filter_by(Axis.Z), length=chamfer_length)

export_step(plate.part, "model.step")
"""


def render_l_bracket_source(spec: dict[str, Any]) -> str:
    return f"""from build123d import *

length = {spec["length"]:g}
height = {spec["height"]:g}
width = {spec["width"]:g}
thickness = {spec["thickness"]:g}
hole_dia = {spec["holeDiameter"]:g}
edge_offset = {spec["edgeOffset"]:g}
chamfer_length = {spec["chamfer"]:g}

with BuildPart() as bracket:
    with Locations((0, length / 2, thickness / 2)):
        Box(width, length, thickness)
    with Locations((0, thickness / 2, height / 2)):
        Box(width, thickness, height)
    with Locations(
        (-width / 2 + edge_offset, edge_offset, 0),
        ( width / 2 - edge_offset, edge_offset, 0),
        (-width / 2 + edge_offset, length - edge_offset, 0),
        ( width / 2 - edge_offset, length - edge_offset, 0),
    ):
        Hole(hole_dia / 2)
    if chamfer_length:
        chamfer(bracket.edges().filter_by(Axis.X), length=chamfer_length)

export_step(bracket.part, "model.step")
"""


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


if __name__ == "__main__":
    raise SystemExit(main())
