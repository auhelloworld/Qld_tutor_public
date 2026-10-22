from __future__ import annotations

from backend.services.analytics_scope import (
    topic_in_scope,
    valid_topic_ids_for_scope,
)


def test_valid_topic_ids_for_scope_returns_junior_year_topics():
    topic_ids = valid_topic_ids_for_scope("math", year_level=7)

    assert topic_ids is not None
    assert "AC9M7N02" in topic_ids
    assert "AC9M8N02" not in topic_ids


def test_valid_topic_ids_for_scope_missing_junior_slice_returns_empty_set():
    assert valid_topic_ids_for_scope("math", year_level=12) == set()


def test_valid_topic_ids_for_scope_filters_senior_unit_by_syllabus_subject():
    unit3_ids = valid_topic_ids_for_scope(
        "senior_english",
        unit=3,
        syllabus_subject="english",
    )

    assert unit3_ids == {
        "QCAA_ENGLISH_U3_T1",
        "QCAA_ENGLISH_U3_T2",
        "QCAA_ENGLISH_U3_T3",
    }


def test_valid_topic_ids_for_scope_infers_senior_syllabus_from_subject_key():
    unit4_ids = valid_topic_ids_for_scope("senior_english", unit=4)

    assert unit4_ids == {"QCAA_ENGLISH_U4_T1", "QCAA_ENGLISH_U4_T2"}


def test_topic_in_scope_treats_none_as_unfiltered():
    assert topic_in_scope("AC9M7N02", None) is True
    assert topic_in_scope("AC9M7N02", {"AC9M7N02"}) is True
    assert topic_in_scope("AC9M7N02", {"AC9M8N02"}) is False


# --- senior maths course → exercise-bank subject mapping (Phase 5) ----------

from backend.services.analytics_scope import storage_subject_for_scope


def test_storage_subject_maps_senior_methods_to_methods():
    assert storage_subject_for_scope("senior_methods") == "methods"
    assert storage_subject_for_scope("methods") == "methods"


def test_storage_subject_maps_other_senior_maths_courses():
    assert storage_subject_for_scope("senior_general") == "general"
    assert storage_subject_for_scope("senior_specialist") == "specialist"
    assert storage_subject_for_scope("senior_essential") == "essential"


def test_storage_subject_preserves_existing_mappings():
    assert storage_subject_for_scope("senior_english") == "english"
    assert storage_subject_for_scope("senior_science") == "science"
    assert storage_subject_for_scope("senior_math") == "math"
    assert storage_subject_for_scope("math") == "math"


def test_valid_topic_ids_for_scope_resolves_methods_unit():
    unit3 = valid_topic_ids_for_scope("senior_methods", unit=3, syllabus_subject="methods")
    assert unit3 == {
        "QCAA_METHODS_U3_T1", "QCAA_METHODS_U3_T2", "QCAA_METHODS_U3_T3",
        "QCAA_METHODS_U3_T4", "QCAA_METHODS_U3_T5",
    }


def test_default_scope_loader_reuses_process_shared_cache(monkeypatch):
    from types import SimpleNamespace
    from backend.services import analytics_scope

    calls: list[tuple[str, int]] = []

    class SharedLoader:
        def load_slice(self, framework_id: str, year_level: int):
            calls.append((framework_id, year_level))
            return SimpleNamespace(topics=[])

    shared = SharedLoader()
    monkeypatch.setattr(analytics_scope, "get_shared_loader", lambda: shared)

    assert analytics_scope.valid_topic_ids_for_scope("math", year_level=7) == set()
    assert analytics_scope.valid_topic_ids_for_scope("math", year_level=8) == set()
    assert calls == [("AC9_MATHS", 7), ("AC9_MATHS", 8)]
