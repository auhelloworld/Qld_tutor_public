"""Lightweight exercise validation for the bank-review import pipeline."""

from __future__ import annotations

import re
from typing import Any

from pydantic import ValidationError

from core.schema.exercise_schema import ExerciseItem

# Keep in sync with scripts/check_exercises.py SUPPORTED_DIAGRAM_TYPES
SUPPORTED_DIAGRAM_TYPES = {
    "right_triangle",
    "triangle",
    "rectangle",
    "circle",
    "coordinate_plane",
    "number_line",
    "rectangular_prism",
    "simple_bar_chart",
    "confidence_intervals",
    "pascal_triangle",
    "data_table",
    "sample_space_grid",
    "function_graph",
    "slope_field",
    "tree_diagram",
    "venn_diagram",
    "unit_circle",
    "sector",
    "box_plot",
    "construction_diagram",
    "food_web",
    "particle_model",
    "process_flow",
    "force_diagram",
}

CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def _diagram_type(ex: dict[str, Any]) -> str | None:
    diagram = ex.get("diagram_data")
    if isinstance(diagram, dict) and isinstance(diagram.get("type"), str):
        return diagram["type"]
    return None


def validate_exercise_for_bank_review(ex: Any) -> dict[str, Any]:
    """Validate one exercise for preview/append.

    Returns:
        {
          "id": str | None,
          "valid_for_append": bool,
          "issues": [{"severity": "error"|"warning", "code": str, "message": str}],
          "diagram_type": str | None,
        }
    """
    issues: list[dict[str, str]] = []
    ex_id: str | None = None

    if not isinstance(ex, dict):
        return {
            "id": None,
            "valid_for_append": False,
            "issues": [{"severity": "error", "code": "not_object", "message": "exercise must be a JSON object"}],
            "diagram_type": None,
        }

    raw_id = ex.get("id")
    if not isinstance(raw_id, str) or not raw_id.strip():
        issues.append({"severity": "error", "code": "missing_id", "message": "missing non-empty id"})
    else:
        ex_id = raw_id.strip()

    try:
        ExerciseItem.model_validate(ex)
    except ValidationError as exc:
        for err in exc.errors():
            loc = ".".join(str(p) for p in err.get("loc", ()))
            msg = err.get("msg", "validation error")
            issues.append({
                "severity": "error",
                "code": "schema_error",
                "message": f"{loc}: {msg}" if loc else msg,
            })
    except Exception as exc:  # pragma: no cover - defensive
        issues.append({
            "severity": "error",
            "code": "schema_error",
            "message": f"{type(exc).__name__}: {exc}",
        })

    diagram_type = _diagram_type(ex)
    if diagram_type and diagram_type not in SUPPORTED_DIAGRAM_TYPES:
        issues.append({
            "severity": "error",
            "code": "unsupported_diagram",
            "message": f"unsupported diagram_data.type {diagram_type!r}",
        })

    for field in ("question", "answer", "sample_reasoning"):
        text = ex.get(field)
        if isinstance(text, str) and CONTROL_CHARS.search(text):
            issues.append({
                "severity": "error",
                "code": "control_chars",
                "message": f"{field}: contains unsupported control characters",
            })

    has_error = any(i["severity"] == "error" for i in issues)
    return {
        "id": ex_id,
        "valid_for_append": (not has_error) and bool(ex_id),
        "issues": issues,
        "diagram_type": diagram_type,
    }
