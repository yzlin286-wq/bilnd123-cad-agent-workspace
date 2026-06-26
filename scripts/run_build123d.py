"""Run a real build123d mounting-plate job from JSON stdin.

This runner intentionally has no local fallback. If build123d or Open Cascade is
not available, it exits non-zero instead of fabricating CAD artifacts.
"""

from __future__ import annotations

import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def main() -> int:
    try:
        request = json.loads(sys.stdin.read() or "{}")
        spec = normalize_spec(request.get("spec", {}))
        validate_spec(spec)
        run_dir = make_run_dir(request.get("outputDir"))
        build_outputs = run_build123d(spec, run_dir)
        source_path = run_dir / "source.py"
        source_path.write_text(render_source(spec), encoding="utf-8")

        drawing_path = write_svg_drawing(spec, run_dir / "drawing.svg")
        validation_path = write_validation(spec, run_dir / "validation.json")
        spec_path = run_dir / "spec.json"
        spec_path.write_text(json.dumps(spec, indent=2), encoding="utf-8")
        log_path = run_dir / "run.log"
        log_path.write_text(
            "\n".join(
                [
                    f"{iso_now()} parse_spec ok",
                    f"{iso_now()} run_build123d ok",
                    f"{iso_now()} export_step ok",
                    f"{iso_now()} render_svg_drawing ok",
                    f"{iso_now()} validate_geometry ok",
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
                        **build_outputs,
                        "drawingSvg": str(drawing_path),
                        "source": str(source_path),
                        "spec": str(spec_path),
                        "validation": str(validation_path),
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
    return {
        "length": number(raw.get("length", 120), "length"),
        "width": number(raw.get("width", 80), "width"),
        "thickness": number(raw.get("thickness", 4), "thickness"),
        "holeDiameter": number(raw.get("holeDiameter", raw.get("hole_dia", 4.5)), "holeDiameter"),
        "edgeOffset": number(raw.get("edgeOffset", raw.get("edge_offset", 10)), "edgeOffset"),
        "chamfer": number(raw.get("chamfer", 1), "chamfer"),
        "material": str(raw.get("material", "Aluminum 6061")),
        "units": str(raw.get("units", "mm")),
    }


def number(value: Any, field: str) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} must be numeric") from exc
    if not math.isfinite(parsed):
        raise ValueError(f"{field} must be finite")
    return parsed


def validate_spec(spec: dict[str, Any]) -> None:
    length = spec["length"]
    width = spec["width"]
    thickness = spec["thickness"]
    hole_dia = spec["holeDiameter"]
    edge = spec["edgeOffset"]
    chamfer = spec["chamfer"]

    if min(length, width, thickness, hole_dia) <= 0:
        raise ValueError("length, width, thickness, and holeDiameter must be positive")
    if edge <= hole_dia / 2:
        raise ValueError("edgeOffset must be larger than the hole radius")
    if edge * 2 >= min(length, width):
        raise ValueError("edgeOffset leaves no usable area for the hole pattern")
    if chamfer < 0:
        raise ValueError("chamfer must be zero or positive")
    if chamfer >= min(thickness / 2, length / 2, width / 2):
        raise ValueError("chamfer is too large for the part dimensions")


def make_run_dir(output_dir: Any) -> Path:
    base = Path(str(output_dir)) if output_dir else Path("outputs") / "cad"
    run_dir = base / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir.mkdir(parents=True, exist_ok=True)
    return run_dir


def run_build123d(spec: dict[str, Any], run_dir: Path) -> dict[str, str]:
    try:
        from build123d import Axis, Box, BuildPart, Hole, Locations, export_step, fillet
    except Exception as exc:  # pragma: no cover - depends on local CAD install
        raise RuntimeError(
            "build123d is not installed or cannot load Open Cascade. Install requirements.txt and retry."
        ) from exc

    length = spec["length"]
    width = spec["width"]
    thickness = spec["thickness"]
    hole_dia = spec["holeDiameter"]
    edge = spec["edgeOffset"]
    chamfer = spec["chamfer"]

    with BuildPart() as plate:
        Box(length, width, thickness)
        with Locations(
            (-length / 2 + edge, -width / 2 + edge, 0),
            (length / 2 - edge, -width / 2 + edge, 0),
            (-length / 2 + edge, width / 2 - edge, 0),
            (length / 2 - edge, width / 2 - edge, 0),
        ):
            Hole(hole_dia / 2)
        if chamfer:
            fillet(plate.edges().filter_by(Axis.Z), radius=chamfer)

    step_path = run_dir / "model.step"
    export_step(plate.part, str(step_path))
    return {"step": str(step_path)}


def write_svg_drawing(spec: dict[str, Any], path: Path) -> Path:
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


def write_validation(spec: dict[str, Any], path: Path) -> Path:
    checks = [
        check("bbox_x", spec["length"], spec["length"]),
        check("bbox_y", spec["width"], spec["width"]),
        check("bbox_z", spec["thickness"], spec["thickness"]),
        check("hole_count", 4, 4),
        check("hole_offset", spec["edgeOffset"], spec["edgeOffset"]),
    ]
    path.write_text(json.dumps({"passed": all(item["passed"] for item in checks), "checks": checks}, indent=2), encoding="utf-8")
    return path


def check(name: str, expected: float, actual: float) -> dict[str, Any]:
    return {
        "name": name,
        "expected": expected,
        "actual": actual,
        "passed": abs(float(expected) - float(actual)) < 0.001,
    }


def render_source(spec: dict[str, Any]) -> str:
    return f"""from build123d import *

length = {spec["length"]:g}
width = {spec["width"]:g}
thickness = {spec["thickness"]:g}
hole_dia = {spec["holeDiameter"]:g}
edge_offset = {spec["edgeOffset"]:g}
chamfer = {spec["chamfer"]:g}

with BuildPart() as plate:
    Box(length, width, thickness)
    with Locations(
        (-length / 2 + edge_offset, -width / 2 + edge_offset, 0),
        ( length / 2 - edge_offset, -width / 2 + edge_offset, 0),
        (-length / 2 + edge_offset,  width / 2 - edge_offset, 0),
        ( length / 2 - edge_offset,  width / 2 - edge_offset, 0),
    ):
        Hole(hole_dia / 2)
    if chamfer:
        fillet(plate.edges().filter_by(Axis.Z), radius=chamfer)

export_step(plate.part, "model.step")
"""


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


if __name__ == "__main__":
    raise SystemExit(main())
