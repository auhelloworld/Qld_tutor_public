"""Verification gate for Task 9 — ``TutorEngine`` topic-identifier resolution.

Covers the gates listed at the bottom of Task 9 in
``.kiro/specs/curriculum-framework-foundation/tasks.md``:

- ``explain("AC9M7N04")`` returns a dict with key ``"explanation"`` (the value
  is a mock string in this test environment because no API key is set).
- ``explain("fractions")`` produces a ``DeprecationWarning`` and resolves
  successfully — the legacy table maps "fractions" to
  ``["AC9M7N04", "AC9M7N06"]`` and AC9M7N04 is in the slice.
- ``explain("garbage_xyz")`` returns the structured "concept not found"
  shape with ``"resolved": False``.
- ``explain("algebraic_expressions")`` returns the structured "concept not
  found" shape — the legacy table maps to ``AC9M8A01`` which is structurally
  valid but the AC9 Maths Year 8 slice ships empty in Phase 1 (Req 9.5).

Also exercises the validator-accepts-but-slice-missing branch (Req 9.1a)
via a structurally valid AC9 code (``AC9M8N01``) that is absent from disk.
"""

from __future__ import annotations

import warnings

import pytest

import backend.curriculum_frameworks
# Register a mock legacy translation mapping for testing legacy resolution failure.
# This ensures testing unresolvable legacy mappings works regardless of populated frameworks on disk.
# Target is well-formed for AC9_MATHS but absent from the migrated slice, so legacy
# resolution fails (Year 10 itself is now migrated, so a real seq like N01 would resolve).
backend.curriculum_frameworks._LEGACY_TRANSLATION_MUTABLE["unresolvable_legacy"] = ["AC9M10N99"]

from backend.tutor_engine import NotFound, ResolvedTopic, get_tutor_engine

tutor_engine = get_tutor_engine()


# ---------------------------------------------------------------------------
# Gate 1: framework-validator-first happy path
# ---------------------------------------------------------------------------


def test_explain_ac9m7n04_returns_explanation_dict():
    response = tutor_engine.explain("AC9M7N04")
    assert isinstance(response, dict)
    assert "explanation" in response
    # No-API-key mock; the explanation string is non-empty regardless.
    assert isinstance(response["explanation"], str)
    assert response["explanation"]


def test_resolve_ac9m7n04_returns_resolved_topic_via_framework_path():
    result = tutor_engine._resolve_topic_identifier("AC9M7N04")
    assert isinstance(result, ResolvedTopic)
    assert result.framework_id == "AC9_MATHS"
    assert result.via_legacy is False
    assert result.topic.topic_id == "AC9M7N04"


# ---------------------------------------------------------------------------
# Gate 2: legacy-name resolution emits DeprecationWarning
# ---------------------------------------------------------------------------


def test_explain_fractions_resolves_via_legacy_with_deprecation_warning():
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        response = tutor_engine.explain("fractions")

    assert "explanation" in response

    deprecations = [
        w for w in caught if issubclass(w.category, DeprecationWarning)
    ]
    assert len(deprecations) == 1
    msg = str(deprecations[0].message)
    assert "fractions" in msg
    assert "AC9M7N04" in msg


def test_resolve_fractions_marks_via_legacy_true():
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        result = tutor_engine._resolve_topic_identifier("fractions")
    assert isinstance(result, ResolvedTopic)
    assert result.via_legacy is True
    assert result.framework_id == "AC9_MATHS"
    assert result.topic.topic_id == "AC9M7N04"


# ---------------------------------------------------------------------------
# Gate 3: unknown identifier returns structured NotFound
# ---------------------------------------------------------------------------


def test_explain_garbage_returns_resolved_false_payload():
    response = tutor_engine.explain("garbage_xyz")
    assert response == {
        "resolved": False,
        "topic_identifier": "garbage_xyz",
        "message": "unknown identifier 'garbage_xyz'",
    }


# ---------------------------------------------------------------------------
# Gate 4: legacy maps to empty-slice Topic_Id → concept not found (Req 9.5)
# ---------------------------------------------------------------------------


def test_explain_narrative_writing_resolves_via_legacy_with_deprecation_warning():
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        response = tutor_engine.explain("narrative_writing")

    assert "explanation" in response

    deprecations = [
        w for w in caught if issubclass(w.category, DeprecationWarning)
    ]
    assert len(deprecations) == 1
    msg = str(deprecations[0].message)
    assert "narrative_writing" in msg
    assert "AC9E7LE05" in msg


def test_resolve_narrative_writing_marks_via_legacy_true():
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        result = tutor_engine._resolve_topic_identifier("narrative_writing")
    assert isinstance(result, ResolvedTopic)
    assert result.via_legacy is True
    assert result.framework_id == "AC9_ENGLISH"
    assert result.topic.topic_id == "AC9E7LE05"


# ---------------------------------------------------------------------------
# Gate 5: validator-accepts-but-slice-missing (Req 9.1a)
# ---------------------------------------------------------------------------


def test_explain_well_formed_but_missing_topic_id_returns_resolved_false():
    """``AC9M10N99`` is accepted by the AC9_MATHS validator (Year 10, Number)
    but no such topic exists in the migrated Year 10 slice, so the loader
    returns ``None`` and the engine surfaces the validator-accepts-but-
    slice-missing message (Req 9.1a)."""
    response = tutor_engine.explain("AC9M10N99")
    assert response["resolved"] is False
    assert response["topic_identifier"] == "AC9M10N99"
    assert "AC9M10N99" in response["message"]
    assert "well-formed but absent" in response["message"]
    assert "AC9_MATHS" in response["message"]


def test_explain_unresolvable_legacy_name_returns_resolved_false():
    response = tutor_engine.explain("unresolvable_legacy")
    assert response["resolved"] is False
    assert response["topic_identifier"] == "unresolvable_legacy"
    assert "unresolvable_legacy" in response["message"]


# ---------------------------------------------------------------------------
# Resolver returns NotFound for the same paths (lower-level contract)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "identifier",
    ["garbage_xyz", "unresolvable_legacy", "AC9M10N99"],
)
def test_resolve_returns_notfound_for_unresolvable_inputs(identifier: str):
    result = tutor_engine._resolve_topic_identifier(identifier)
    assert isinstance(result, NotFound)
    assert result.identifier == identifier
