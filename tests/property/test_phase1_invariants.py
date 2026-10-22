"""Phase 1 property-based tests — curriculum framework invariants.

**Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7**

Uses Hypothesis with the ``dev`` profile (50 examples max).
All tests use the ``tmp_data_dir`` fixture for filesystem isolation.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from hypothesis import given, settings, assume, HealthCheck
from hypothesis import strategies as st

from backend._testing import reset_engine_factory_cache
from backend.curriculum_frameworks import (
    get_framework,
    get_framework_for_topic_id,
    iter_frameworks,
)
from backend.curriculum_loader import CurriculumLoader
from backend.migrations.migrate_ac9_maths import AC9MathsMigration
from backend.rules import StudyRuleEngine, get_engine

_FIXTURE_HC = [HealthCheck.function_scoped_fixture]


# ---------------------------------------------------------------------------
# 8.1 Per-framework idempotence: byte-equivalent output across two runs
# **Validates: Requirements 4.1**
# ---------------------------------------------------------------------------


@pytest.mark.property
@given(st.just(None))
@settings(max_examples=1, suppress_health_check=_FIXTURE_HC)
def test_migration_idempotence(tmp_data_dir: Path, monkeypatch: pytest.MonkeyPatch, _):
    """Running AC9MathsMigration twice on the same input produces
    byte-equivalent output."""
    monkeypatch.setattr("backend.migrations.migrate_ac9_maths._CURRICULUM_ROOT", tmp_data_dir / "curriculum")
    migration = AC9MathsMigration()
    summary1 = migration.run()

    # Read the output after first run
    output_path = tmp_data_dir / "curriculum" / "ac9_maths" / "year7.json"
    first_content = output_path.read_text(encoding="utf-8")

    # Run again
    summary2 = migration.run()
    second_content = output_path.read_text(encoding="utf-8")

    assert first_content == second_content, "Migration is not idempotent"
    assert summary2.written == 0, "Second run should write 0 files"


# ---------------------------------------------------------------------------
# 8.2 No-invented-codes: recommend_next_topic returns a Topic_Id from the
#     active slice or None.
# **Validates: Requirements 4.2**
# ---------------------------------------------------------------------------


@pytest.mark.property
@given(st.sampled_from(["year7"]))
@settings(suppress_health_check=_FIXTURE_HC)
def test_recommend_returns_topic_from_slice_or_none(tmp_data_dir: Path, year: str):
    """recommend_next_topic returns a Topic_Id from the active slice or null."""
    reset_engine_factory_cache()
    engine = get_engine("prop-student", "math")

    result = engine.recommend_next_topic(year)
    topic_id = result["topic_id"]

    if topic_id is None:
        return  # null is acceptable

    # Verify it's in the slice
    loader = CurriculumLoader()
    year_int = int(year.removeprefix("year"))
    slice_obj = loader.load_slice("AC9_MATHS", year_int)
    all_topic_ids = {t.topic_id for t in slice_obj.topics}
    assert topic_id in all_topic_ids, (
        f"recommend_next_topic returned {topic_id!r} which is not in the slice"
    )


# ---------------------------------------------------------------------------
# 8.3 Framework-validator round-trip: every stored Topic_Id is accepted by
#     exactly one framework's validator.
# **Validates: Requirements 4.3**
# ---------------------------------------------------------------------------


@pytest.mark.property
@given(st.just(None))
@settings(max_examples=1, suppress_health_check=_FIXTURE_HC)
def test_stored_topic_ids_accepted_by_exactly_one_framework(tmp_data_dir: Path, _):
    """Every Topic_Id stored in any slice is accepted by exactly one
    framework's validator."""
    loader = CurriculumLoader()

    # Collect all topic_ids from all loadable slices
    all_topic_ids: list[str] = []
    for fw in iter_frameworks():
        if fw.supported_year_levels:
            for year in fw.supported_year_levels:
                try:
                    slice_obj = loader.load_slice(fw.framework_id, year)
                    all_topic_ids.extend(t.topic_id for t in slice_obj.topics)
                except FileNotFoundError:
                    pass

    assert len(all_topic_ids) > 0, "No topic_ids found in any slice"

    for topic_id in all_topic_ids:
        accepting = [
            fw.framework_id
            for fw in iter_frameworks()
            if fw.validator(topic_id)
        ]
        assert len(accepting) == 1, (
            f"Topic_Id {topic_id!r} accepted by {len(accepting)} frameworks: {accepting}"
        )


# ---------------------------------------------------------------------------
# 8.4 Validator-disjointness: random strings accepted by at most one framework.
# **Validates: Requirements 4.4**
# ---------------------------------------------------------------------------


@pytest.mark.property
@given(st.text(min_size=5, max_size=30))
@settings(suppress_health_check=_FIXTURE_HC)
def test_random_strings_accepted_by_at_most_one_framework(tmp_data_dir: Path, s: str):
    """Random strings are accepted by at most one framework validator."""
    accepting = [
        fw.framework_id
        for fw in iter_frameworks()
        if fw.validator(s)
    ]
    assert len(accepting) <= 1, (
        f"String {s!r} accepted by multiple frameworks: {accepting}"
    )


# ---------------------------------------------------------------------------
# 8.5 Strict-prerequisites gate: recommend_next_topic never returns a topic
#     with unmet prereqs in a Strict_Sequence.
# **Validates: Requirements 4.5**
# ---------------------------------------------------------------------------


@pytest.mark.property
@given(st.integers(min_value=0, max_value=5))
@settings(suppress_health_check=_FIXTURE_HC)
def test_strict_prerequisites_gate(tmp_data_dir: Path, mastered_count: int):
    """recommend_next_topic never returns a topic with unmet prereqs."""
    reset_engine_factory_cache()

    # Load the slice and check if it has prerequisites
    loader = CurriculumLoader()
    try:
        slice_obj = loader.load_slice("AC9_MATHS", 7)
    except FileNotFoundError:
        return

    sequence = slice_obj.sequence
    if not sequence.prerequisites:
        return  # No prereqs to test

    engine = get_engine("prereq-student", "math")

    # Master the first N topics
    log = engine.load_log()
    topics_to_master = list(sequence.sequence)[:mastered_count]
    for tid in topics_to_master:
        log["topics"][tid] = {
            "attempts": [
                {"question_id": f"q_{tid}", "correct": True, "error_type": None,
                 "timestamp": "2024-01-01T00:00:00Z", "skill_id": f"{tid}/q",
                 "response_time_ms": 0, "attempt_type": "answer"}
                for _ in range(10)
            ],
            "accuracy": 1.0,
        }
    engine.save_log(log)

    result = engine.recommend_next_topic("year7")
    recommended = result["topic_id"]

    if recommended is None:
        return

    # If the sequence is strict, verify all prereqs are met
    if sequence.is_strict:
        prereqs = sequence.prerequisites.get(recommended, [])
        for prereq in prereqs:
            prereq_attempts = log.get("topics", {}).get(prereq, {}).get("attempts", [])
            bkt = engine.calculate_bkt(prereq_attempts)
            assert bkt >= 0.8, (
                f"Recommended {recommended!r} but prereq {prereq!r} has BKT={bkt}"
            )


# ---------------------------------------------------------------------------
# 8.6 Year 10 dual-visibility invariants.
# **Validates: Requirements 4.6**
# ---------------------------------------------------------------------------


@pytest.mark.property
@given(st.lists(st.sampled_from(["methods", "biology", "english"]), max_size=3))
@settings(suppress_health_check=_FIXTURE_HC)
def test_year10_dual_visibility(tmp_data_dir: Path, previewed_subjects: list[str]):
    """query_topics_for_year10 returns no AC9 year != 10, no senior unit != 1,
    no duplicate topic_ids."""
    from backend.curriculum_frameworks import query_topics_for_year10

    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        topics = query_topics_for_year10(previewed_subjects)

    seen_ids: set[str] = set()
    for t in topics:
        topic_id = t.get("topic_id") or t.get("id", "")

        # No duplicate topic_ids
        assert topic_id not in seen_ids, f"Duplicate topic_id: {topic_id}"
        seen_ids.add(topic_id)

        # Check year constraints for AC9 topics
        fw_id = get_framework_for_topic_id(topic_id)
        if fw_id and fw_id.startswith("AC9"):
            year = t.get("year_level")
            if year is not None:
                assert year == 10, f"AC9 topic {topic_id} has year {year}, expected 10"

        # Check unit constraints for Senior topics
        if fw_id and fw_id.startswith("QCAA_SENIOR"):
            unit = t.get("unit")
            if unit is not None:
                assert unit == 1, f"Senior topic {topic_id} has unit {unit}, expected 1"


# ---------------------------------------------------------------------------
# 8.7 All Phase 1 property tests use tmp_data_dir.
# **Validates: Requirements 4.7**
# (This is verified structurally — every test above takes tmp_data_dir as a
# fixture parameter.)
# ---------------------------------------------------------------------------
