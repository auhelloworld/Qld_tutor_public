"""Tests for the central subject registry (backend/subject_registry.py)."""

from __future__ import annotations

import pytest

from backend.subject_registry import (
    grading_mode_for_subject,
    is_known_subject,
    is_text_graded,
    storage_subject_for_scope,
    display_name_for_subject,
    framework_for_subject,
)


# --- storage resolution: existing behaviour preserved -----------------------

@pytest.mark.parametrize(
    "picker,expected",
    [
        ("math", "math"),
        ("english", "english"),
        ("science", "science"),
        ("senior_math", "math"),
        ("senior_english", "english"),
        ("senior_science", "science"),
        ("senior_methods", "methods"),
        ("methods", "methods"),
        ("senior_general", "general"),
        ("senior_specialist", "specialist"),
        ("senior_essential", "essential"),
        (None, "math"),
    ],
)
def test_storage_subject_for_scope_preserved(picker, expected):
    assert storage_subject_for_scope(picker) == expected


# --- storage resolution: new senior courses get their own subject -----------

@pytest.mark.parametrize(
    "picker,expected",
    [
        ("senior_chemistry", "chemistry"),
        ("senior_physics", "physics"),
        ("senior_biology", "biology"),
        ("senior_literature", "literature"),
        ("senior_eal", "eal"),
    ],
)
def test_storage_subject_for_scope_new_courses(picker, expected):
    assert storage_subject_for_scope(picker) == expected


# --- grading mode -----------------------------------------------------------

def test_grading_mode_sympy_for_maths():
    for s in ("math", "methods", "general", "specialist", "essential"):
        assert grading_mode_for_subject(s) == "sympy"
        assert is_text_graded(s) is False


def test_grading_mode_text_for_english_and_science():
    for s in ("english", "science", "chemistry", "physics", "biology", "literature", "eal"):
        assert grading_mode_for_subject(s) == "text"
        assert is_text_graded(s) is True


def test_unknown_subject_defaults_to_sympy():
    assert grading_mode_for_subject("nonsense") == "sympy"


# --- known-subject guard + metadata -----------------------------------------

def test_is_known_subject():
    assert is_known_subject("methods")
    assert is_known_subject("chemistry")
    assert not is_known_subject("senior_methods")  # picker key, not storage key
    assert not is_known_subject("nonsense")


def test_display_names_qcaa_aligned():
    assert display_name_for_subject("methods") == "Mathematical Methods"
    assert display_name_for_subject("specialist") == "Specialist Mathematics"
    assert display_name_for_subject("chemistry") == "Chemistry"


def test_framework_for_subject():
    assert framework_for_subject("methods") == "QCAA_SENIOR_MATHS"
    assert framework_for_subject("chemistry") == "QCAA_SENIOR_SCIENCE"
    assert framework_for_subject("literature") == "QCAA_SENIOR_ENGLISH"


# --- exam preset family fallback (new courses inherit family blueprints) -----

def test_exam_types_fall_back_to_family():
    from backend.exam_simulator import validate_exam_type_for_subject

    # Chemistry (no explicit entry) inherits the science exam types.
    assert validate_exam_type_for_subject("chemistry", "inquiry") == ("inquiry", None)
    assert validate_exam_type_for_subject("chemistry", "data_interpretation")[0] == "data_interpretation"
    # Literature inherits english types.
    assert validate_exam_type_for_subject("literature", "reading") == ("reading", None)
    # A maths course keeps its Paper presets.
    assert validate_exam_type_for_subject("methods", "paper_1") == ("paper_1", None)
    # Unsupported still falls back to mixed with a warning.
    safe, warning = validate_exam_type_for_subject("chemistry", "paper_1")
    assert safe == "mixed" and warning is not None
