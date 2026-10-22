"""Phase 1 schema-enrichment tests for QCAA Mathematical Methods.

Verifies the four optional, backward-compatible fields added to
``MathExerciseMetadata`` for senior-maths banks:

    technology_active   — Paper 1 (tech-free) vs Paper 2 (tech-active) tagging
    assessment_objective — QCAA cognition verb the item targets
    unit_topic          — human-readable syllabus topic label
    formula_reference   — formula-book entry the item draws on

The fields must default to ``None`` (so every existing bank still validates)
and a Methods exercise (framework=QCAA_SENIOR_MATHS, subject=methods, unit=3)
carrying them must validate cleanly.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from core.schema.exercise_schema import ExerciseItem, MathExerciseMetadata


def _methods_payload(**overrides):
    base = {
        "id": "methods_u3_t4_001",
        "topic": "introduction to integration",
        "question": "Find the area under y = 2x from x = 0 to x = 3.",
        "answer": "9",
        "steps": ["Integrate 2x to get x^2", "Evaluate x^2 from 0 to 3"],
        "framework": "QCAA_SENIOR_MATHS",
        "topic_ids": ["QCAA_METHODS_U3_T4"],
        "subject": "methods",
        "difficulty": "developing",
        "year_level": None,
        "unit": 3,
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# Defaults: new fields are optional and default to None
# ---------------------------------------------------------------------------


def test_new_math_metadata_fields_default_to_none():
    meta = MathExerciseMetadata()
    assert meta.technology_active is None
    assert meta.assessment_objective is None
    assert meta.unit_topic is None
    assert meta.formula_reference is None


def test_existing_math_metadata_without_new_fields_still_validates():
    """A pre-Phase-1 metadata payload (only legacy fields) must still parse."""
    meta = MathExerciseMetadata.model_validate(
        {
            "strand": "Calculus",
            "sub_strand": "Integration",
            "skill": "Definite integrals",
            "calculator_allowed": False,
        }
    )
    assert meta.strand == "Calculus"
    assert meta.technology_active is None


# ---------------------------------------------------------------------------
# Methods exercise carrying the new fields validates end-to-end
# ---------------------------------------------------------------------------


def test_methods_exercise_with_enrichment_fields_validates():
    item = ExerciseItem.model_validate(
        _methods_payload(
            math_metadata={
                "strand": "Calculus",
                "sub_strand": "Integral calculus",
                "skill": "Definite integration",
                "calculator_allowed": False,
                "technology_active": False,
                "assessment_objective": "apply",
                "unit_topic": "U3 T4 Introduction to integration",
                "formula_reference": "Integral of x^n",
            }
        )
    )
    assert item.framework == "QCAA_SENIOR_MATHS"
    assert item.subject == "methods"
    assert item.unit == 3
    assert item.year_level is None
    assert item.math_metadata is not None
    assert item.math_metadata.technology_active is False
    assert item.math_metadata.assessment_objective == "apply"
    assert item.math_metadata.unit_topic == "U3 T4 Introduction to integration"
    assert item.math_metadata.formula_reference == "Integral of x^n"


def test_technology_active_true_is_accepted():
    item = ExerciseItem.model_validate(
        _methods_payload(math_metadata={"technology_active": True})
    )
    assert item.math_metadata.technology_active is True


# ---------------------------------------------------------------------------
# Validation guards on the new fields
# ---------------------------------------------------------------------------


def test_assessment_objective_outside_literal_set_rejected():
    with pytest.raises(ValidationError):
        ExerciseItem.model_validate(
            _methods_payload(math_metadata={"assessment_objective": "memorise"})
        )


def test_unknown_math_metadata_field_rejected_under_extra_forbid():
    with pytest.raises(ValidationError):
        ExerciseItem.model_validate(
            _methods_payload(math_metadata={"made_up_field": "boom"})
        )


@pytest.mark.parametrize(
    "objective",
    ["recall", "comprehend", "apply", "analyse", "synthesise", "evaluate"],
)
def test_all_assessment_objectives_accepted(objective):
    item = ExerciseItem.model_validate(
        _methods_payload(math_metadata={"assessment_objective": objective})
    )
    assert item.math_metadata.assessment_objective == objective
