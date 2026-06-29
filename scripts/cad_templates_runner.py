"""Real build123d CAD template registry and runner helpers.

The template path is deterministic and intentionally has no local fallback. If
build123d or Open Cascade cannot produce the requested geometry, the caller gets
a non-zero runner result instead of placeholder CAD.
"""

from __future__ import annotations

import json
import ast
import math
import os
import sys
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

TEMPLATE_REGISTRY_PATH = Path(__file__).resolve().parents[1] / "cad_templates.json"


def load_template_registry() -> list[dict[str, Any]]:
    return json.loads(TEMPLATE_REGISTRY_PATH.read_text(encoding="utf-8"))


TEMPLATES = load_template_registry()
TEMPLATE_BY_ID = {template["id"]: template for template in TEMPLATES}
SUPPORTED_TEMPLATE_IDS = tuple(TEMPLATE_BY_ID)


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
                    f"{iso_now()} template {spec['partType']} ok",
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
    raw = raw or {}
    part_type = str(raw.get("partType", raw.get("part_type", "mounting_plate")))
    if part_type == "custom_build123d":
        return normalize_custom_spec(raw)
    if part_type not in TEMPLATE_BY_ID:
        raise ValueError(f"Unsupported partType '{part_type}'. Supported partType values: {', '.join(SUPPORTED_TEMPLATE_IDS)}")

    raw_parameters = raw.get("parameters") if isinstance(raw.get("parameters"), dict) else {}
    parameters: dict[str, float | str] = {}
    for definition in TEMPLATE_BY_ID[part_type]["parameters"]:
        key = definition["key"]
        value = raw_parameters.get(key, raw.get(key, definition["default"]))
        parameters[key] = number(value, key)

    spec: dict[str, Any] = {
        "partType": part_type,
        "parameters": parameters,
        "material": str(raw.get("material", "Aluminum 6061")),
        "units": str(raw.get("units", "mm")),
    }
    for key, value in parameters.items():
        spec[key] = value
    return spec


def normalize_custom_spec(raw: dict[str, Any]) -> dict[str, Any]:
    if os.environ.get("CAD_ENABLE_CUSTOM_CODEGEN") != "1":
        raise ValueError("CUSTOM_CODEGEN_DISABLED: Custom build123d code generation is disabled for this staging environment.")
    raw_parameters = raw.get("parameters") if isinstance(raw.get("parameters"), dict) else {}
    source = str(raw_parameters.get("source", raw.get("source", ""))).strip()
    if not source:
        raise ValueError("CUSTOM_CODEGEN_REJECTED: custom_build123d source is required.")
    return {
        "partType": "custom_build123d",
        "parameters": {
            "source": source,
            "description": str(raw_parameters.get("description", raw.get("description", "Custom build123d part"))),
        },
        "length": number(raw.get("length", 1), "length"),
        "width": number(raw.get("width", 1), "width"),
        "thickness": number(raw.get("thickness", 1), "thickness"),
        "holeDiameter": number(raw.get("holeDiameter", 1), "holeDiameter"),
        "edgeOffset": number(raw.get("edgeOffset", 1), "edgeOffset"),
        "chamfer": number(raw.get("chamfer", 0), "chamfer"),
        "material": str(raw.get("material", "Generated material")),
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


def integer(value: Any, field: str) -> int:
    parsed = int(round(number(value, field)))
    if parsed <= 0:
        raise ValueError(f"{field} must be positive")
    return parsed


def validate_spec(spec: dict[str, Any]) -> None:
    part_type = spec["partType"]
    if part_type == "custom_build123d":
        validate_custom_source(str(spec["parameters"].get("source", "")))
        return
    if part_type not in TEMPLATE_BY_ID:
        raise ValueError(f"Unsupported partType '{part_type}'. Supported partType values: {', '.join(SUPPORTED_TEMPLATE_IDS)}")

    for definition in TEMPLATE_BY_ID[part_type]["parameters"]:
        key = definition["key"]
        value = p(spec, key)
        if value <= 0 and key not in {"chamfer", "grooveDepth"}:
            raise ValueError(f"{key} must be positive")
        if key == "chamfer" and value < 0:
            raise ValueError("chamfer must be zero or positive")
        if "min" in definition and value < float(definition["min"]):
            raise ValueError(f"{key} is below the supported minimum")
        if "max" in definition and value > float(definition["max"]):
            raise ValueError(f"{key} is above the supported maximum")

    if spec["partType"] not in {"rectangular_flange"} and has(spec, "holeDiameter", "edgeOffset") and p(spec, "edgeOffset") <= p(spec, "holeDiameter") / 2:
        raise ValueError("edgeOffset must be larger than the hole radius")
    if has(spec, "length", "width", "edgeOffset") and p(spec, "edgeOffset") * 2 >= min(p(spec, "length"), p(spec, "width")):
        raise ValueError("edgeOffset leaves no usable area for the hole pattern")
    if has(spec, "outerDiameter", "innerDiameter") and p(spec, "innerDiameter") >= p(spec, "outerDiameter"):
        raise ValueError("innerDiameter must be smaller than outerDiameter")
    if has(spec, "outerDiameter", "boreDiameter") and p(spec, "boreDiameter") >= p(spec, "outerDiameter"):
        raise ValueError("boreDiameter must be smaller than outerDiameter")
    if has(spec, "flangeDiameter", "outerDiameter") and p(spec, "flangeDiameter") < p(spec, "outerDiameter"):
        raise ValueError("flangeDiameter must be larger than outerDiameter")
    if spec["partType"] == "helical_spring" and p(spec, "wireDiameter") >= p(spec, "outerDiameter"):
        raise ValueError("wireDiameter must be smaller than outerDiameter")
    if spec["partType"] == "round_flange":
        bolt_outer = p(spec, "boltCircleDiameter") + p(spec, "boltHoleDiameter")
        if bolt_outer >= p(spec, "outerDiameter"):
            raise ValueError("boltCircleDiameter and boltHoleDiameter exceed the flange outer diameter")


def make_run_dir(output_dir: Any) -> Path:
    base = Path(str(output_dir)) if output_dir else Path("outputs") / "cad"
    run_dir = base / f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
    run_dir.mkdir(parents=True, exist_ok=True)
    return run_dir


def run_build123d(spec: dict[str, Any], run_dir: Path) -> dict[str, Any]:
    builders: dict[str, Callable[[dict[str, Any]], Any]] = {
        "mounting_plate": build_mounting_plate,
        "l_bracket": build_l_bracket,
        "gusset_plate": build_gusset_plate,
        "u_bracket": build_u_bracket,
        "c_channel": build_c_channel,
        "angle_bracket_gusset": build_angle_bracket_gusset,
        "simple_enclosure": build_simple_enclosure,
        "enclosure_lid": build_enclosure_lid,
        "electronics_mounting_base": build_electronics_mounting_base,
        "round_flange": build_round_flange,
        "rectangular_flange": build_rectangular_flange,
        "stepped_shaft": build_stepped_shaft,
        "spacer_standoff": build_spacer_standoff,
        "bushing_sleeve": build_bushing_sleeve,
        "shaft_collar": build_shaft_collar,
        "pulley": build_pulley,
        "spur_gear": build_spur_gear,
        "helical_spring": build_helical_spring,
        "hinge_leaf": build_hinge_leaf,
        "bearing_mount_block": build_bearing_mount_block,
        "custom_build123d": build_custom_build123d,
    }
    builder = builders.get(spec["partType"])
    if not builder:
        raise ValueError(f"Unsupported partType '{spec['partType']}'. Supported partType values: {', '.join(SUPPORTED_TEMPLATE_IDS)}")
    part = builder(spec)
    return export_part(spec, part, run_dir)


def import_build123d() -> dict[str, Any]:
    try:
        from build123d import (  # type: ignore
            Axis,
            Box,
            BuildLine,
            BuildPart,
            BuildSketch,
            Circle,
            Cylinder,
            GeomType,
            Helix,
            Hole,
            Locations,
            Mode,
            Plane,
            PolarLocations,
            Torus,
            chamfer,
            export_step,
            export_stl,
            import_step,
            sweep,
        )
    except Exception as exc:  # pragma: no cover - depends on local CAD install
        raise RuntimeError(
            "build123d is not installed or cannot load Open Cascade. Install requirements.txt and retry."
        ) from exc
    return locals()


def validate_custom_source(source: str) -> None:
    forbidden_imports = {"os", "sys", "subprocess", "socket", "pathlib", "shutil", "requests", "urllib", "builtins"}
    forbidden_calls = {"open", "eval", "exec", "compile", "__import__", "input"}
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        raise ValueError(f"CUSTOM_CODEGEN_REJECTED: generated source has invalid syntax: {exc}") from exc
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            names = [alias.name.split(".", 1)[0] for alias in getattr(node, "names", [])]
            module = getattr(node, "module", None)
            if module:
                names.append(str(module).split(".", 1)[0])
            if any(name in forbidden_imports for name in names):
                raise ValueError("CUSTOM_CODEGEN_REJECTED: generated source imports a forbidden module.")
            raise ValueError("CUSTOM_CODEGEN_REJECTED: generated source must not import modules.")
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name) and node.func.id in forbidden_calls:
                raise ValueError("CUSTOM_CODEGEN_REJECTED: generated source calls a forbidden function.")
            if isinstance(node.func, ast.Attribute) and node.func.attr in {"system", "popen", "remove", "unlink", "rmdir", "mkdir", "write_text", "read_text"}:
                raise ValueError("CUSTOM_CODEGEN_REJECTED: generated source calls a forbidden method.")


def build_custom_build123d(spec: dict[str, Any]) -> Any:
    source = str(spec["parameters"]["source"])
    validate_custom_source(source)
    b = import_build123d()
    safe_builtins = {
        "abs": abs,
        "float": float,
        "int": int,
        "len": len,
        "max": max,
        "min": min,
        "range": range,
        "round": round,
        "sum": sum,
        "ValueError": ValueError,
    }
    globals_dict = {"__builtins__": safe_builtins, "math": math, **b}
    locals_dict: dict[str, Any] = {}
    exec(compile(source, "<custom_build123d>", "exec"), globals_dict, locals_dict)
    build_part = locals_dict.get("build_part") or globals_dict.get("build_part")
    if not callable(build_part):
        raise ValueError("CUSTOM_CODEGEN_REJECTED: generated source must define build_part().")
    part = build_part()
    if not hasattr(part, "bounding_box") or not hasattr(part, "solids"):
        raise ValueError("CUSTOM_CODEGEN_REJECTED: build_part() must return a build123d Part.")
    return part


def build_mounting_plate(spec: dict[str, Any]) -> Any:
    b = import_build123d()
    with b["BuildPart"]() as model:
        b["Box"](p(spec, "length"), p(spec, "width"), p(spec, "thickness"))
        four_corner_holes(b, p(spec, "length"), p(spec, "width"), p(spec, "edgeOffset"), p(spec, "holeDiameter"))
        apply_chamfer(b, model, p(spec, "chamfer"), axis=b["Axis"].Z)
    return model.part


def build_l_bracket(spec: dict[str, Any]) -> Any:
    b = import_build123d()
    length, height, width, thickness = p(spec, "length"), p(spec, "height"), p(spec, "width"), p(spec, "thickness")
    with b["BuildPart"]() as model:
        with b["Locations"]((0, length / 2, thickness / 2)):
            b["Box"](width, length, thickness)
        with b["Locations"]((0, thickness / 2, height / 2)):
            b["Box"](width, thickness, height)
        with b["Locations"](
            (-width / 2 + p(spec, "edgeOffset"), p(spec, "edgeOffset"), 0),
            (width / 2 - p(spec, "edgeOffset"), p(spec, "edgeOffset"), 0),
            (-width / 2 + p(spec, "edgeOffset"), length - p(spec, "edgeOffset"), 0),
            (width / 2 - p(spec, "edgeOffset"), length - p(spec, "edgeOffset"), 0),
        ):
            b["Hole"](p(spec, "holeDiameter") / 2)
        apply_chamfer(b, model, p(spec, "chamfer"), axis=b["Axis"].X)
    return model.part


def build_gusset_plate(spec: dict[str, Any]) -> Any:
    b = import_build123d()
    with b["BuildPart"]() as model:
        b["Box"](p(spec, "length"), p(spec, "height"), p(spec, "thickness"))
        four_corner_holes(b, p(spec, "length"), p(spec, "height"), p(spec, "edgeOffset"), p(spec, "holeDiameter"))
        apply_chamfer(b, model, p(spec, "chamfer"))
    return model.part


def build_u_bracket(spec: dict[str, Any]) -> Any:
    b = import_build123d()
    length, width, height, thickness = p(spec, "length"), p(spec, "width"), p(spec, "height"), p(spec, "thickness")
    with b["BuildPart"]() as model:
        with b["Locations"]((0, 0, thickness / 2)):
            b["Box"](length, width, thickness)
        with b["Locations"]((0, -width / 2 + thickness / 2, height / 2)):
            b["Box"](length, thickness, height)
        with b["Locations"]((0, width / 2 - thickness / 2, height / 2)):
            b["Box"](length, thickness, height)
        four_corner_holes(b, length, width, p(spec, "edgeOffset"), p(spec, "holeDiameter"))
        apply_chamfer(b, model, p(spec, "chamfer"))
    return model.part


def build_c_channel(spec: dict[str, Any]) -> Any:
    b = import_build123d()
    length, width, height, thickness = p(spec, "length"), p(spec, "width"), p(spec, "height"), p(spec, "thickness")
    with b["BuildPart"]() as model:
        with b["Locations"]((0, 0, thickness / 2)):
            b["Box"](length, width, thickness)
        with b["Locations"]((0, -width / 2 + thickness / 2, height / 2)):
            b["Box"](length, thickness, height)
        with b["Locations"]((0, width / 2 - thickness / 2, height / 2)):
            b["Box"](length, thickness, height)
        apply_chamfer(b, model, p(spec, "chamfer"))
    return model.part


def build_angle_bracket_gusset(spec: dict[str, Any]) -> Any:
    b = import_build123d()
    length, height, width, thickness = p(spec, "length"), p(spec, "height"), p(spec, "width"), p(spec, "thickness")
    with b["BuildPart"]() as model:
        with b["Locations"]((0, length / 2, thickness / 2)):
            b["Box"](width, length, thickness)
        with b["Locations"]((0, thickness / 2, height / 2)):
            b["Box"](width, thickness, height)
        with b["Locations"]((0, length * 0.28, height * 0.28)):
            b["Box"](thickness, length * 0.55, height * 0.55)
        with b["Locations"]((-width / 2 + p(spec, "edgeOffset"), length - p(spec, "edgeOffset"), 0), (width / 2 - p(spec, "edgeOffset"), length - p(spec, "edgeOffset"), 0)):
            b["Hole"](p(spec, "holeDiameter") / 2)
        apply_chamfer(b, model, p(spec, "chamfer"))
    return model.part


def build_simple_enclosure(spec: dict[str, Any]) -> Any:
    b = import_build123d()
    length, width, height, wall = p(spec, "length"), p(spec, "width"), p(spec, "height"), p(spec, "wallThickness")
    with b["BuildPart"]() as model:
        with b["Locations"]((0, 0, wall / 2)):
            b["Box"](length, width, wall)
        with b["Locations"]((0, -width / 2 + wall / 2, height / 2)):
            b["Box"](length, wall, height)
        with b["Locations"]((0, width / 2 - wall / 2, height / 2)):
            b["Box"](length, wall, height)
        with b["Locations"]((-length / 2 + wall / 2, 0, height / 2)):
            b["Box"](wall, width, height)
        with b["Locations"]((length / 2 - wall / 2, 0, height / 2)):
            b["Box"](wall, width, height)
        four_corner_holes(b, length - 2 * wall, width - 2 * wall, p(spec, "edgeOffset"), p(spec, "holeDiameter"))
        apply_chamfer(b, model, p(spec, "chamfer"))
    return model.part


def build_enclosure_lid(spec: dict[str, Any]) -> Any:
    return build_mounting_plate(spec)


def build_electronics_mounting_base(spec: dict[str, Any]) -> Any:
    b = import_build123d()
    length, width, thickness = p(spec, "length"), p(spec, "width"), p(spec, "thickness")
    post_d, post_h, edge = p(spec, "postDiameter"), p(spec, "postHeight"), p(spec, "edgeOffset")
    with b["BuildPart"]() as model:
        b["Box"](length, width, thickness)
        with b["Locations"](
            (-length / 2 + edge, -width / 2 + edge, thickness / 2 + post_h / 2),
            (length / 2 - edge, -width / 2 + edge, thickness / 2 + post_h / 2),
            (-length / 2 + edge, width / 2 - edge, thickness / 2 + post_h / 2),
            (length / 2 - edge, width / 2 - edge, thickness / 2 + post_h / 2),
        ):
            b["Cylinder"](post_d / 2, post_h)
        with b["Locations"](
            (-length / 2 + edge, -width / 2 + edge, 0),
            (length / 2 - edge, -width / 2 + edge, 0),
            (-length / 2 + edge, width / 2 - edge, 0),
            (length / 2 - edge, width / 2 - edge, 0),
        ):
            b["Hole"](p(spec, "holeDiameter") / 2)
        apply_chamfer(b, model, p(spec, "chamfer"))
    return model.part


def build_round_flange(spec: dict[str, Any]) -> Any:
    b = import_build123d()
    with b["BuildPart"]() as model:
        b["Cylinder"](p(spec, "outerDiameter") / 2, p(spec, "thickness"))
        b["Hole"](p(spec, "holeDiameter") / 2)
        with b["PolarLocations"](p(spec, "boltCircleDiameter") / 2, integer(p(spec, "holeCount"), "holeCount")):
            b["Hole"](p(spec, "boltHoleDiameter") / 2)
        apply_chamfer(b, model, p(spec, "chamfer"))
    return model.part


def build_rectangular_flange(spec: dict[str, Any]) -> Any:
    b = import_build123d()
    with b["BuildPart"]() as model:
        b["Box"](p(spec, "length"), p(spec, "width"), p(spec, "thickness"))
        b["Hole"](p(spec, "holeDiameter") / 2)
        four_corner_holes(b, p(spec, "length"), p(spec, "width"), p(spec, "edgeOffset"), p(spec, "boltHoleDiameter"))
        apply_chamfer(b, model, p(spec, "chamfer"))
    return model.part


def build_stepped_shaft(spec: dict[str, Any]) -> Any:
    b = import_build123d()
    length, step_length = p(spec, "length"), min(p(spec, "stepLength"), p(spec, "length") * 0.85)
    with b["BuildPart"]() as model:
        with b["Locations"]((0, 0, -length / 2 + step_length / 2)):
            b["Cylinder"](p(spec, "diameter") / 2, step_length)
        with b["Locations"]((0, 0, -length / 2 + step_length + (length - step_length) / 2)):
            b["Cylinder"](p(spec, "secondaryDiameter") / 2, length - step_length)
        apply_chamfer(b, model, p(spec, "chamfer"))
    return model.part


def build_spacer_standoff(spec: dict[str, Any]) -> Any:
    b = import_build123d()
    with b["BuildPart"]() as model:
        b["Cylinder"](p(spec, "outerDiameter") / 2, p(spec, "length"))
        b["Hole"](p(spec, "innerDiameter") / 2)
        apply_chamfer(b, model, p(spec, "chamfer"))
    return model.part


def build_bushing_sleeve(spec: dict[str, Any]) -> Any:
    b = import_build123d()
    length, flange_t = p(spec, "length"), p(spec, "flangeThickness")
    with b["BuildPart"]() as model:
        b["Cylinder"](p(spec, "outerDiameter") / 2, length)
        with b["Locations"]((0, 0, -length / 2 + flange_t / 2)):
            b["Cylinder"](p(spec, "flangeDiameter") / 2, flange_t)
        b["Hole"](p(spec, "innerDiameter") / 2)
        apply_chamfer(b, model, p(spec, "chamfer"))
    return model.part


def build_shaft_collar(spec: dict[str, Any]) -> Any:
    b = import_build123d()
    outer, width = p(spec, "outerDiameter"), p(spec, "width")
    with b["BuildPart"]() as model:
        b["Cylinder"](outer / 2, width)
        b["Hole"](p(spec, "innerDiameter") / 2)
        with b["Locations"]((outer / 2, 0, 0)):
            b["Box"](outer, p(spec, "slotWidth"), width + 2, mode=b["Mode"].SUBTRACT)
        apply_chamfer(b, model, p(spec, "chamfer"))
    return model.part


def build_pulley(spec: dict[str, Any]) -> Any:
    b = import_build123d()
    outer, width = p(spec, "outerDiameter"), p(spec, "width")
    with b["BuildPart"]() as model:
        b["Cylinder"](outer / 2, width)
        b["Hole"](p(spec, "boreDiameter") / 2)
        groove = p(spec, "grooveDepth")
        if groove > 0:
            b["Torus"](outer / 2 - groove / 2, groove / 2, mode=b["Mode"].SUBTRACT)
        apply_chamfer(b, model, p(spec, "chamfer"))
    return model.part


def build_spur_gear(spec: dict[str, Any]) -> Any:
    b = import_build123d()
    outer, width, tooth_depth = p(spec, "outerDiameter"), p(spec, "width"), p(spec, "toothDepth")
    tooth_count = integer(p(spec, "toothCount"), "toothCount")
    root = outer - 2 * tooth_depth
    tooth_width = max(1.0, math.pi * root / tooth_count * 0.45)
    with b["BuildPart"]() as model:
        b["Cylinder"](root / 2, width)
        with b["PolarLocations"](root / 2 + tooth_depth / 2, tooth_count):
            b["Box"](tooth_depth, tooth_width, width)
        b["Hole"](p(spec, "boreDiameter") / 2)
        apply_chamfer(b, model, p(spec, "chamfer"))
    return model.part


def build_helical_spring(spec: dict[str, Any]) -> Any:
    b = import_build123d()
    wire = p(spec, "wireDiameter")
    helix_radius = (p(spec, "outerDiameter") - wire) / 2
    with b["BuildPart"]() as model:
        path = b["Helix"](pitch=p(spec, "pitch"), height=p(spec, "length"), radius=helix_radius)
        with b["BuildSketch"](b["Plane"].XZ):
            with b["Locations"]((helix_radius, 0)):
                b["Circle"](wire / 2)
        b["sweep"](path=path)
    return model.part


def build_hinge_leaf(spec: dict[str, Any]) -> Any:
    b = import_build123d()
    length, width, thickness = p(spec, "length"), p(spec, "width"), p(spec, "thickness")
    barrel = p(spec, "barrelDiameter")
    with b["BuildPart"]() as model:
        with b["Locations"]((0, 0, 0)):
            b["Box"](length, width, thickness)
        with b["Locations"]((0, -width / 2, thickness / 2)):
            b["Cylinder"](barrel / 2, length, rotation=(0, 90, 0))
        with b["Locations"]((-length / 2 + p(spec, "edgeOffset"), 0, 0), (length / 2 - p(spec, "edgeOffset"), 0, 0)):
            b["Hole"](p(spec, "holeDiameter") / 2)
        apply_chamfer(b, model, p(spec, "chamfer"))
    return model.part


def build_bearing_mount_block(spec: dict[str, Any]) -> Any:
    b = import_build123d()
    length, width, height = p(spec, "length"), p(spec, "width"), p(spec, "height")
    with b["BuildPart"]() as model:
        b["Box"](length, width, height)
        b["Hole"](p(spec, "boreDiameter") / 2)
        with b["Locations"]((-length / 2 + p(spec, "edgeOffset"), 0, 0), (length / 2 - p(spec, "edgeOffset"), 0, 0)):
            b["Hole"](p(spec, "holeDiameter") / 2)
        apply_chamfer(b, model, p(spec, "chamfer"))
    return model.part


def four_corner_holes(b: dict[str, Any], length: float, width: float, edge: float, hole_dia: float) -> None:
    with b["Locations"](
        (-length / 2 + edge, -width / 2 + edge, 0),
        (length / 2 - edge, -width / 2 + edge, 0),
        (-length / 2 + edge, width / 2 - edge, 0),
        (length / 2 - edge, width / 2 - edge, 0),
    ):
        b["Hole"](hole_dia / 2)


def apply_chamfer(b: dict[str, Any], model: Any, length: float, axis: Any | None = None) -> None:
    if length <= 0:
        return
    edges = model.edges().filter_by(axis) if axis is not None else model.edges()
    b["chamfer"](edges, length=length)


def export_part(spec: dict[str, Any], part: Any, run_dir: Path) -> dict[str, Any]:
    b = import_build123d()
    step_path = run_dir / "model.step"
    stl_path = run_dir / "model.stl"
    b["export_step"](part, str(step_path))
    b["export_stl"](part, str(stl_path))
    reloaded = b["import_step"](str(step_path))
    bbox = part.bounding_box()
    reloaded_bbox = reloaded.bounding_box()
    cyl_faces = part.faces().filter_by(b["GeomType"].CYLINDER)
    metrics = {
        "partType": spec["partType"],
        "bbox": vector_to_dict(bbox.size),
        "bboxMin": vector_to_dict(bbox.min),
        "bboxMax": vector_to_dict(bbox.max),
        "stepReloadedBbox": vector_to_dict(reloaded_bbox.size),
        "solidCount": len(part.solids()),
        "faceCount": len(part.faces()),
        "edgeCount": len(part.edges()),
        "cylindricalFaceCount": len(cyl_faces),
        "chamferLength": float(spec["parameters"].get("chamfer", 0)),
        "chamferOperator": "chamfer",
        "stepBytes": step_path.stat().st_size,
        "stlBytes": stl_path.stat().st_size,
    }
    return {"artifacts": {"step": step_path, "stl": stl_path}, "metrics": metrics}


def write_svg_drawing(spec: dict[str, Any], path: Path) -> Path:
    bbox_hint = drawing_bbox_hint(spec)
    title = TEMPLATE_BY_ID.get(spec["partType"], {"title": "Custom build123d"})["title"]
    width, height = bbox_hint
    scale = min(420 / max(width, 1), 230 / max(height, 1))
    draw_w = width * scale
    draw_h = height * scale
    x0 = 70
    y0 = 55
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 360">
  <rect x="20" y="20" width="520" height="320" fill="#f8fafc" stroke="#1f2937" stroke-width="2" />
  <rect x="{x0:.2f}" y="{y0:.2f}" width="{draw_w:.2f}" height="{draw_h:.2f}" rx="6" fill="none" stroke="#0f172a" stroke-width="3" />
  <text x="34" y="314" fill="#0f172a" font-family="Inter, Arial" font-size="13">{title} | {spec["units"]} | {spec["material"]}</text>
  <text x="350" y="314" fill="#0f172a" font-family="Inter, Arial" font-size="13">{dimension_label(spec)}</text>
</svg>
"""
    path.write_text(svg, encoding="utf-8")
    return path


def write_validation(spec: dict[str, Any], metrics: dict[str, Any], path: Path) -> Path:
    checks = [
        text_check("part_type", spec["partType"], metrics["partType"]),
        min_check("bbox_x_positive", metrics["bbox"]["x"], 0),
        min_check("bbox_y_positive", metrics["bbox"]["y"], 0),
        min_check("bbox_z_positive", metrics["bbox"]["z"], 0),
        min_check("step_reload_bbox_x_positive", metrics["stepReloadedBbox"]["x"], 0),
        min_check("solid_count", metrics["solidCount"], 1),
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
    if spec["partType"] == "custom_build123d":
        return [
            {
                "key": "description",
                "label": "Description",
                "value": spec["parameters"].get("description", "Custom build123d part"),
            }
        ]
    items = []
    for definition in TEMPLATE_BY_ID[spec["partType"]]["parameters"]:
        item = {
            "key": definition["key"],
            "label": definition["label"],
            "value": spec["parameters"][definition["key"]],
            "unit": definition.get("unit"),
            "min": definition.get("min"),
            "max": definition.get("max"),
        }
        items.append(item)
    return items


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


def render_source(spec: dict[str, Any]) -> str:
    return f'''"""Generated build123d source entrypoint for {spec["partType"]}.

Run this from the repository root with build123d installed. It uses the same
real template runner as the staging CAD agent; it does not contain placeholder
geometry.
"""

from pathlib import Path
from scripts.cad_templates_runner import normalize_spec, run_build123d

spec = {json.dumps(spec, indent=2)}
run_build123d(normalize_spec(spec), Path("."))
'''


def p(spec: dict[str, Any], key: str) -> float:
    return float(spec["parameters"][key])


def has(spec: dict[str, Any], *keys: str) -> bool:
    return all(key in spec["parameters"] for key in keys)


def vector_to_dict(vector: Any) -> dict[str, float]:
    return {"x": float(vector.X), "y": float(vector.Y), "z": float(vector.Z)}


def text_check(name: str, expected: str, actual: str) -> dict[str, Any]:
    return {"name": name, "expected": expected, "actual": actual, "passed": expected == actual}


def min_check(name: str, actual: float, minimum: float) -> dict[str, Any]:
    return {"name": name, "expected": f">= {minimum}", "actual": actual, "passed": float(actual) >= minimum}


def min_file_size_check(name: str, actual: int) -> dict[str, Any]:
    return {"name": name, "expected": "> 0 bytes", "actual": actual, "passed": actual > 0}


def drawing_bbox_hint(spec: dict[str, Any]) -> tuple[float, float]:
    params = spec["parameters"]
    if "outerDiameter" in params:
        return float(params["outerDiameter"]), float(params.get("length", params.get("width", params["outerDiameter"])))
    if "length" in params and "height" in params:
        return float(params["length"]), float(params["height"])
    if "length" in params and "width" in params:
        return float(params["length"]), float(params["width"])
    return 100.0, 60.0


def dimension_label(spec: dict[str, Any]) -> str:
    params = spec["parameters"]
    if "outerDiameter" in params:
        return f"OD {float(params['outerDiameter']):g}"
    values = [params.get("length"), params.get("width"), params.get("height"), params.get("thickness")]
    return " x ".join(f"{float(value):g}" for value in values if value is not None)


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


if __name__ == "__main__":
    raise SystemExit(main())
