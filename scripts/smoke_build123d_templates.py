"""Smoke every supported build123d template through the real runner."""

from __future__ import annotations

import json
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE_PATH = ROOT / "cad_templates.json"
RUNNER_PATH = ROOT / "scripts" / "run_build123d.py"
REQUIRED_PACKAGE_ENTRIES = {
    "model.step",
    "model.stl",
    "drawing.svg",
    "source.py",
    "spec.json",
    "validation.json",
    "manifest.json",
}


def main() -> int:
    templates = json.loads(TEMPLATE_PATH.read_text(encoding="utf-8"))
    failures: list[str] = []
    for template in templates:
        spec = canonical_spec(template)
        result = subprocess.run(
            [sys.executable, str(RUNNER_PATH)],
            input=json.dumps({"spec": spec}),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=ROOT,
            check=False,
        )
        if result.returncode != 0:
            failures.append(f"{template['id']}: runner failed: {result.stderr.strip()}")
            continue
        try:
            payload = json.loads(result.stdout.strip().splitlines()[-1])
            assert payload["ok"] is True
            validate_payload(template["id"], payload)
        except Exception as exc:  # noqa: BLE001 - report all smoke failures
            failures.append(f"{template['id']}: {exc}")

    if failures:
        for failure in failures:
            print(failure, file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, "templateCount": len(templates)}, indent=2))
    return 0


def canonical_spec(template: dict) -> dict:
    parameters = {parameter["key"]: parameter["default"] for parameter in template["parameters"]}
    return {
        "partType": template["id"],
        "parameters": parameters,
        **parameters,
        "material": "Aluminum 6061",
        "units": "mm",
    }


def validate_payload(part_type: str, payload: dict) -> None:
    artifacts = payload["artifacts"]
    for key in ["step", "stl", "drawingSvg", "source", "spec", "validation", "manifest", "package"]:
        path = Path(artifacts[key])
        assert path.exists(), f"missing artifact {key}"
        assert path.stat().st_size > 0, f"empty artifact {key}"

    validation = json.loads(Path(artifacts["validation"]).read_text(encoding="utf-8"))
    assert validation["passed"] is True, validation
    assert validation["metrics"]["partType"] == part_type

    manifest = json.loads(Path(artifacts["manifest"]).read_text(encoding="utf-8"))
    assert manifest["engineeringSpec"]["partType"] == part_type
    assert any(item["kind"] == "package" and item["name"] == "package.zip" for item in manifest["artifacts"])

    with zipfile.ZipFile(artifacts["package"]) as archive:
        names = set(archive.namelist())
    missing = REQUIRED_PACKAGE_ENTRIES - names
    assert not missing, f"package.zip missing {sorted(missing)}"


if __name__ == "__main__":
    raise SystemExit(main())
