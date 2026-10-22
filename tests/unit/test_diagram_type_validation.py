"""Root-level ``diagram_data.type`` must be validated like sub-part payloads.

Before this, ``ExerciseSubPart`` rejected an unrenderable diagram type but
``ExerciseItem`` accepted anything, so a typo reached the browser and rendered
as placeholder text with no validation error. The guarantee depended on
remembering to run ``scripts/check_exercises.py``.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from core.schema.exercise_schema import SUPPORTED_DIAGRAM_TYPES, ExerciseItem

pytestmark = pytest.mark.fast

REPO_ROOT = Path(__file__).resolve().parents[2]


def _base_item(**overrides) -> dict:
    item = {
        "id": "diagram_probe_1",
        "framework": "AC9_MATHS",
        "subject": "math",
        "year_level": 7,
        "topic": "Probe",
        "topic_ids": ["AC9M7N01"],
        "question_type": "multiple_choice",
        "difficulty": "foundational",
        "question": "Probe?",
        "choices": ["a", "b", "c", "d"],
        "correct_choice": "A",
        "answer": "a",
    }
    item.update(overrides)
    return item


def test_supported_type_is_accepted():
    item = ExerciseItem(
        **_base_item(diagram_data={"type": "data_table", "headers": ["a"], "rows": [["1"]]})
    )
    assert item.diagram_data is not None


def test_absent_diagram_is_accepted():
    assert ExerciseItem(**_base_item()).diagram_data is None


def test_unsupported_root_type_is_rejected():
    with pytest.raises(ValueError, match="unsupported diagram_data.type"):
        ExerciseItem(**_base_item(diagram_data={"type": "totally_made_up_chart"}))


@pytest.mark.parametrize("diagram", [{}, {"type": ""}, {"type": "   "}, {"type": 7}])
def test_missing_or_blank_root_type_is_rejected(diagram):
    with pytest.raises(ValueError, match="diagram_data must include a type"):
        ExerciseItem(**_base_item(diagram_data=diagram))


def test_root_accepts_every_supported_type():
    """A type valid in a sub-part must also be valid at the root."""
    for diagram_type in sorted(SUPPORTED_DIAGRAM_TYPES):
        ExerciseItem(**_base_item(diagram_data={"type": diagram_type}))


def test_every_authored_diagram_payload_still_validates():
    """The live banks and imported exams must already satisfy the new rule."""
    unsupported: list[str] = []
    checked = 0
    paths = sorted((REPO_ROOT / "data").glob("exercise_*.json")) + sorted(
        (REPO_ROOT / "data" / "exams").glob("*.json")
    )
    for path in paths:
        if "bak" in path.name:
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        items = payload if isinstance(payload, list) else payload.get("questions") or []
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            candidates = [item.get("diagram_data")]
            candidates += [
                part.get("diagram_data")
                for part in (item.get("sub_parts") or [])
                if isinstance(part, dict)
            ]
            for diagram in candidates:
                if not isinstance(diagram, dict):
                    continue
                checked += 1
                diagram_type = diagram.get("type")
                if diagram_type not in SUPPORTED_DIAGRAM_TYPES:
                    unsupported.append(f"{path.name}:{item.get('id')}:{diagram_type!r}")

    assert checked > 900, f"expected to inspect the authored diagrams, only saw {checked}"
    assert not unsupported, f"unrenderable diagram types in authored content: {unsupported[:10]}"
