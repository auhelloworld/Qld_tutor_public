"""Unit tests for ``core.schema.exercise_schema``.

Verification gate for task 2 of the curriculum-framework-foundation spec.
Covers the cases enumerated in the task brief:

1.  Happy-path AC9 exercise (year_level set, unit None) → accepted.
2.  Happy-path Senior exercise (unit set, year_level None) → accepted.
3.  AC9 without ``year_level`` → ValidationError.
4.  AC9 with ``unit`` set → ValidationError.
5.  Senior without ``unit`` → ValidationError.
6.  Senior with ``year_level`` set → ValidationError.
7.  Unknown framework → ValidationError.
8.  ``topic_ids = []`` → ValidationError (min_length=1).
9.  Duplicate ``topic_ids`` → ValidationError.
10. Empty-string entries in ``topic_ids`` → ValidationError.
11. >20 ``topic_ids`` → ValidationError (max_length=20).
12. Unknown field with ``extra='forbid'`` → ValidationError.
13. ``difficulty`` outside the literal set → ValidationError.
14. Transitional shim: importing ``ExerciseItem`` from the legacy path
    ``core.schema.ingestion_schema`` still works and constructs the legacy
    four-field shape.
"""

from __future__ import annotations

import json
import warnings

import pytest
from pydantic import ValidationError

from core.schema.exercise_schema import ExerciseItem
from scripts.check_exercises import validate_collection, validate_files


# ---------------------------------------------------------------------------
# Minimal valid payload helpers
# ---------------------------------------------------------------------------


def _ac9_payload(**overrides):
    base = {
        "id": "math_7_f_AC9M7N02_adae12",
        "topic": "fractions",
        "question": "Simplify 18/24.",
        "answer": "3/4",
        "steps": ["Find GCD", "Divide"],
        "framework": "AC9_MATHS",
        "topic_ids": ["AC9M7N04"],
        "subject": "math",
        "difficulty": "developing",
        "year_level": 7,
        "unit": None,
    }
    base.update(overrides)
    return base


def _senior_payload(**overrides):
    base = {
        "id": "methods_u1_001",
        "topic": "functions",
        "question": "State the domain of f(x) = sqrt(x).",
        "answer": "x >= 0",
        "steps": [],
        "framework": "QCAA_SENIOR_MATHS",
        "topic_ids": ["QCAA_METHODS_U1_T1"],
        "subject": "methods",
        "difficulty": "foundational",
        "year_level": None,
        "unit": 1,
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# 1 & 2. Happy paths
# ---------------------------------------------------------------------------


def test_happy_path_ac9_exercise_accepted():
    item = ExerciseItem.model_validate(_ac9_payload())
    assert item.framework == "AC9_MATHS"
    assert item.year_level == 7
    assert item.unit is None
    assert item.topic_ids == ["AC9M7N04"]


def test_happy_path_senior_exercise_accepted():
    item = ExerciseItem.model_validate(_senior_payload())
    assert item.framework == "QCAA_SENIOR_MATHS"
    assert item.unit == 1
    assert item.year_level is None
    assert item.topic_ids == ["QCAA_METHODS_U1_T1"]


def test_diagram_data_accepts_freeform_dict():
    """The legacy seed exercises carry free-form ``diagram_data`` payloads
    (e.g. ``{"type": "right_triangle", "base": 6, ...}``). The schema must
    accept such dicts as-is until a typed DiagramData model is introduced."""
    payload = _ac9_payload(
        diagram_data={
            "type": "right_triangle",
            "base": 6,
            "height": 5,
            "labels": {"base": "6cm", "height": "5cm"},
        }
    )
    item = ExerciseItem.model_validate(payload)
    assert item.diagram_data is not None
    assert item.diagram_data["type"] == "right_triangle"


def _multi_part_payload(parts):
    return _ac9_payload(
        question_type="multi_part",
        answer="See sub-parts.",
        sub_parts=parts,
    )


def test_multi_part_subpart_contract_accepts_valid_choice_and_rubric():
    item = ExerciseItem.model_validate(
        _multi_part_payload(
            [
                {
                    "label": "a",
                    "question": "Choose yes or no.",
                    "answer": "A",
                    "choices": ["A) yes", "B) no"],
                    "correct_choice": "A",
                    "marks": 1,
                },
                {
                    "label": "b",
                    "question": "Explain why.",
                    "answer": "Because it follows the rule.",
                    "marks": 2,
                    "rubric": {
                        "key_points": ["States the rule.", "Applies the rule."],
                        "max_score": 2,
                    },
                },
            ]
        )
    )
    assert item.sub_parts[0].correct_choice == "A"
    assert item.sub_parts[1].rubric["max_score"] == 2


def test_multi_part_subpart_rejects_correct_choice_without_choices():
    with pytest.raises(ValidationError, match="correct_choice requires choices"):
        ExerciseItem.model_validate(
            _multi_part_payload(
                [
                    {"label": "a", "question": "Choose.", "answer": "A", "correct_choice": "A"},
                    {"label": "b", "question": "State it.", "answer": "B"},
                ]
            )
        )


def test_multi_part_subpart_rejects_correct_choice_not_in_choices():
    with pytest.raises(ValidationError, match="correct_choice must match"):
        ExerciseItem.model_validate(
            _multi_part_payload(
                [
                    {
                        "label": "a",
                        "question": "Choose.",
                        "answer": "C",
                        "choices": ["A) yes", "B) no"],
                        "correct_choice": "C",
                    },
                    {"label": "b", "question": "State it.", "answer": "B"},
                ]
            )
        )


def test_multi_part_subpart_rejects_unattainable_rubric_score():
    with pytest.raises(ValidationError, match="rubric max_score"):
        ExerciseItem.model_validate(
            _multi_part_payload(
                [
                    {
                        "label": "a",
                        "question": "Explain.",
                        "answer": "The rule applies.",
                        "marks": 2,
                        "rubric": {"key_points": ["States the rule.", "Applies it."], "max_score": 1},
                    },
                    {"label": "b", "question": "State it.", "answer": "B"},
                ]
            )
        )


def test_multi_part_subpart_rejects_unsupported_diagram_type():
    with pytest.raises(ValidationError, match="unsupported sub-part diagram_data.type"):
        ExerciseItem.model_validate(
            _multi_part_payload(
                [
                    {
                        "label": "a",
                        "question": "Read the diagram.",
                        "answer": "A",
                        "diagram_data": {"type": "not_a_renderer_type"},
                    },
                    {"label": "b", "question": "State it.", "answer": "B"},
                ]
            )
        )


# ---------------------------------------------------------------------------
# 3-6. AC9 ↔ Senior XOR by jurisdiction (Req 8.5 / 8.6)
# ---------------------------------------------------------------------------


def test_ac9_without_year_level_rejected():
    payload = _ac9_payload(year_level=None)
    with pytest.raises(ValidationError, match="AC9 exercises must declare year_level"):
        ExerciseItem.model_validate(payload)


def test_ac9_with_unit_set_rejected():
    payload = _ac9_payload(unit=1)
    with pytest.raises(ValidationError, match="AC9 exercises must not declare unit"):
        ExerciseItem.model_validate(payload)


def test_senior_without_unit_rejected():
    payload = _senior_payload(unit=None)
    with pytest.raises(ValidationError, match="Senior exercises must declare unit"):
        ExerciseItem.model_validate(payload)


def test_senior_with_year_level_set_rejected():
    payload = _senior_payload(year_level=10)
    with pytest.raises(
        ValidationError, match="Senior exercises must not declare year_level"
    ):
        ExerciseItem.model_validate(payload)


# ---------------------------------------------------------------------------
# 7. Unknown framework
# ---------------------------------------------------------------------------


def test_unknown_framework_rejected():
    payload = _ac9_payload(framework="MADE_UP_FRAMEWORK")
    with pytest.raises(ValidationError, match="unknown framework"):
        ExerciseItem.model_validate(payload)


# ---------------------------------------------------------------------------
# 8-11. topic_ids constraints (Req 8.2)
# ---------------------------------------------------------------------------


def test_topic_ids_empty_list_rejected():
    payload = _ac9_payload(topic_ids=[])
    with pytest.raises(ValidationError):
        ExerciseItem.model_validate(payload)


def test_topic_ids_with_duplicates_rejected():
    payload = _ac9_payload(topic_ids=["AC9M7N04", "AC9M7N04"])
    with pytest.raises(ValidationError, match="duplicates"):
        ExerciseItem.model_validate(payload)


def test_topic_ids_with_empty_string_rejected():
    payload = _ac9_payload(topic_ids=["AC9M7N04", ""])
    with pytest.raises(ValidationError, match="empty strings"):
        ExerciseItem.model_validate(payload)


def test_topic_ids_with_whitespace_only_string_rejected():
    """Whitespace-only entries are functionally empty and must also be
    rejected to keep the cross-framework lookup well-defined."""
    payload = _ac9_payload(topic_ids=["AC9M7N04", "   "])
    with pytest.raises(ValidationError, match="empty strings"):
        ExerciseItem.model_validate(payload)


def test_topic_ids_too_many_rejected():
    """``Field(max_length=20)`` enforces the upper bound declaratively."""
    payload = _ac9_payload(topic_ids=[f"AC9M7N{i:02d}" for i in range(1, 22)])
    with pytest.raises(ValidationError):
        ExerciseItem.model_validate(payload)


# ---------------------------------------------------------------------------
# 12-13. extra='forbid' and difficulty literal (Req 8.4)
# ---------------------------------------------------------------------------


def test_unknown_field_rejected_under_extra_forbid():
    payload = _ac9_payload(unexpected_field="boom")
    with pytest.raises(ValidationError):
        ExerciseItem.model_validate(payload)


def test_difficulty_outside_literal_set_rejected():
    payload = _ac9_payload(difficulty="impossible")
    with pytest.raises(ValidationError):
        ExerciseItem.model_validate(payload)


# ---------------------------------------------------------------------------
# 14. Transitional shim: legacy import path still works (Req 8.10 spirit)
# ---------------------------------------------------------------------------


def test_legacy_ingestion_schema_export_still_constructs_old_shape():
    """``from core.schema.ingestion_schema import ExerciseItem`` must still
    work, and the legacy class must accept the legacy four-field shape
    (no framework, no topic_ids, etc.) — that is what
    ``backend/ingestion_v2.py`` still emits during this transitional phase."""
    with warnings.catch_warnings():
        # The legacy module emits a DeprecationWarning on import; that is
        # expected behaviour, not a test failure.
        warnings.simplefilter("ignore", DeprecationWarning)
        from core.schema.ingestion_schema import (
            ExerciseItem as LegacyExerciseItem,
        )

    # Legacy four-field shape — no framework, no topic_ids.
    legacy = LegacyExerciseItem.model_validate(
        {
            "topic": "fractions",
            "question": "Simplify 18/24.",
            "answer": "3/4",
            "steps": ["Find GCD", "Divide"],
        }
    )
    assert legacy.topic == "fractions"
    assert legacy.answer == "3/4"

    # And the legacy class must NOT be the same class as the new canonical
    # one — they have different field sets.
    assert LegacyExerciseItem is not ExerciseItem
    assert "framework" not in LegacyExerciseItem.model_fields
    assert "framework" in ExerciseItem.model_fields

# ---------------------------------------------------------------------------
# Optional subject-specific metadata remains backward compatible
# ---------------------------------------------------------------------------


def test_math_metadata_validates_for_math_exercise():
    item = ExerciseItem.model_validate(
        _ac9_payload(
            math_metadata={
                "strand": "Number",
                "sub_strand": "Fractions",
                "skill": "Simplify fractions",
                "calculator_allowed": False,
                "expected_working_steps": ["Find the HCF", "Divide numerator and denominator"],
            }
        )
    )
    assert item.math_metadata is not None
    assert item.math_metadata.calculator_allowed is False
    assert item.math_metadata.expected_working_steps == ["Find the HCF", "Divide numerator and denominator"]


def test_english_metadata_validates_for_english_exercise():
    item = ExerciseItem.model_validate(
        _ac9_payload(
            id="english_7_text_evidence_001",
            topic="text evidence",
            question="Which phrase best supports the inference?",
            answer="The phrase about the storm clouds.",
            framework="AC9_ENGLISH",
            topic_ids=["AC9E7LY05"],
            subject="english",
            english_metadata={
                "facet": "text_evidence",
                "passage": "Storm clouds gathered as Mia checked the empty road.",
                "evidence_spans": [{"start": 0, "end": 12}],
                "accepted_answer_variants": ["storm clouds"],
            },
        )
    )
    assert item.english_metadata is not None
    assert item.english_metadata.facet == "text_evidence"
    assert item.english_metadata.accepted_answer_variants == ["storm clouds"]


def test_science_metadata_validates_for_science_exercise():
    item = ExerciseItem.model_validate(
        _ac9_payload(
            id="science_7_inquiry_001",
            topic="variables",
            question="Identify the independent variable in the experiment.",
            answer="The amount of light.",
            framework="AC9_SCIENCE",
            topic_ids=["AC9S7I02"],
            subject="science",
            science_metadata={
                "strand": "Science Inquiry",
                "science_inquiry_skill": "Planning investigations",
                "practical_context": "Plant growth investigation",
                "data_representation": "table",
                "variables": {"independent": "light", "dependent": "growth"},
                "claim_evidence_reasoning": True,
            },
        )
    )
    assert item.science_metadata is not None
    assert item.science_metadata.data_representation == "table"
    assert item.science_metadata.claim_evidence_reasoning is True


def test_old_exercise_without_subject_metadata_still_validates():
    item = ExerciseItem.model_validate(_ac9_payload())
    assert item.math_metadata is None
    assert item.english_metadata is None
    assert item.science_metadata is None


# ---------------------------------------------------------------------------
# Content validation gate
# ---------------------------------------------------------------------------


def _topic_registry(topic_id="AC9M7N04", framework="AC9_MATHS", year_level=7, unit=None):
    return {
        topic_id: {
            "framework": framework,
            "year_level": year_level,
            "unit": unit,
        }
    }


def _framework_registry():
    return {
        "AC9_MATHS": {
            "subject_suffix": "math",
            "supported_subjects": ["math"],
        },
        "AC9_SCIENCE": {
            "subject_suffix": "science",
            "supported_subjects": ["science"],
        },
    }


def test_content_validator_detects_duplicate_ids(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    curriculum = data_dir / "curriculum"
    (curriculum / "ac9_maths").mkdir(parents=True)
    (curriculum / "frameworks.json").write_text(
        json.dumps({"frameworks": [{"framework_id": "AC9_MATHS", "subject_suffix": "math", "supported_subjects": ["math"]}]}),
        encoding="utf-8",
    )
    (curriculum / "ac9_maths" / "year7.json").write_text(
        json.dumps({"framework_id": "AC9_MATHS", "topics": [{"topic_id": "AC9M7N04"}]}),
        encoding="utf-8",
    )
    first = data_dir / "exercise_first.json"
    second = data_dir / "exercise_second.json"
    first.write_text(json.dumps([_ac9_payload(id="duplicate-id")]), encoding="utf-8")
    second.write_text(json.dumps([_ac9_payload(id="duplicate-id")]), encoding="utf-8")

    issues = validate_files([first, second], data_dir=data_dir)

    assert any(issue.code == "duplicate_id" for issue in issues)


def test_content_validator_detects_multi_part_missing_sub_parts():
    issues = validate_collection(
        [_ac9_payload(question_type="multi_part", sub_parts=None)],
        topic_registry=_topic_registry(),
        framework_registry=_framework_registry(),
    )

    assert any(issue.code == "schema_invalid" and "multi_part" in issue.message for issue in issues)


def test_content_validator_warns_science_table_without_visual():
    issues = validate_collection(
        [
            _ac9_payload(
                id="science-table-without-visual",
                framework="AC9_SCIENCE",
                topic_ids=["AC9S7I02"],
                subject="science",
                science_metadata={"data_representation": "table"},
            )
        ],
        topic_registry=_topic_registry("AC9S7I02", framework="AC9_SCIENCE", year_level=7),
        framework_registry=_framework_registry(),
    )

    assert any(issue.severity == "warning" and issue.code == "science_representation_without_visual" for issue in issues)
