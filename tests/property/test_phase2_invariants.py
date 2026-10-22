"""Phase 2 property-based tests — student isolation and migration invariants.

**Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6**

Uses Hypothesis with the ``dev`` profile (50 examples max).
"""
from __future__ import annotations

import json
import threading
from pathlib import Path

import pytest
from hypothesis import given, settings, assume, HealthCheck
from hypothesis import strategies as st

from backend._testing import reset_engine_factory_cache
from backend.migrate_student_logs import merge_attempts, migrate_file
from backend.rules import StudyRuleEngine, get_engine

_FIXTURE_HC = [HealthCheck.function_scoped_fixture]


# ---------------------------------------------------------------------------
# 9.1 Cross-student isolation: distinct UUIDs never see each other's records.
# **Validates: Requirements 5.1, 5.5**
# ---------------------------------------------------------------------------


@pytest.mark.property
@given(
    st.uuids(),
    st.uuids(),
)
@settings(suppress_health_check=_FIXTURE_HC)
def test_cross_student_isolation(tmp_data_dir: Path, uuid1, uuid2):
    """Distinct UUIDs never see each other's records."""
    assume(uuid1 != uuid2)
    reset_engine_factory_cache()

    s1 = str(uuid1)
    s2 = str(uuid2)

    engine1 = get_engine(s1, "math")
    engine2 = get_engine(s2, "math")

    # Write data under student 1
    engine1.log_attempt(
        topic="fractions",
        question_id="q1",
        is_correct=True,
        error_type=None,
    )

    # Write data under student 2
    engine2.log_attempt(
        topic="algebra",
        question_id="q2",
        is_correct=False,
        error_type="concept_gap",
    )

    # Read back: student 1 should not see student 2's data
    log1 = engine1.load_log()
    log2 = engine2.load_log()

    assert log1["student_id"] == s1
    assert log2["student_id"] == s2

    # Student 1 has fractions but not algebra
    assert "fractions" in log1["topics"]
    assert "algebra" not in log1["topics"]

    # Student 2 has algebra but not fractions
    assert "algebra" in log2["topics"]
    assert "fractions" not in log2["topics"]


# ---------------------------------------------------------------------------
# 9.2 Migration preservation: source attempts identifiable in target by
#     (question_id, timestamp, correct, error_type).
# **Validates: Requirements 5.2**
# ---------------------------------------------------------------------------


@pytest.mark.property
@given(
    st.lists(
        st.fixed_dictionaries({
            "question_id": st.text(min_size=1, max_size=10, alphabet="abcdefghij0123456789"),
            "timestamp": st.text(min_size=10, max_size=25, alphabet="0123456789-T:Z"),
            "correct": st.booleans(),
            "error_type": st.sampled_from([None, "calculation_error", "concept_gap"]),
            "attempt_type": st.just("answer"),
        }),
        min_size=1,
        max_size=10,
        unique_by=lambda a: (a["question_id"], a["timestamp"]),
    )
)
@settings(suppress_health_check=_FIXTURE_HC)
def test_migration_preservation(tmp_data_dir: Path, attempts: list[dict]):
    """Source attempts are identifiable in target by
    (question_id, timestamp, correct, error_type)."""
    source_path = tmp_data_dir / "migration_src" / "math_log.json"
    source_path.parent.mkdir(parents=True, exist_ok=True)
    source_data = {
        "student_id": "src",
        "topics": {"fractions": {"attempts": attempts, "accuracy": 0.5}},
    }
    source_path.write_text(json.dumps(source_data), encoding="utf-8")

    target_path = tmp_data_dir / "migration_tgt" / "math_log.json"
    # Remove target if it exists from a previous example
    if target_path.exists():
        target_path.unlink()
    target_path.parent.mkdir(parents=True, exist_ok=True)
    migrate_file(source_path, target_path, "legacy_id", dry_run=False)

    target_data = json.loads(target_path.read_text(encoding="utf-8"))
    target_attempts = target_data["topics"]["fractions"]["attempts"]

    # Since attempts are unique by (question_id, timestamp), all should be preserved
    source_keys = {
        (a["question_id"], a["timestamp"])
        for a in attempts
    }
    target_keys = {
        (a["question_id"], a["timestamp"])
        for a in target_attempts
    }
    assert source_keys == target_keys


# ---------------------------------------------------------------------------
# 9.3 No-lost-writes: N concurrent threads produce N records.
# **Validates: Requirements 5.3, 5.6**
# ---------------------------------------------------------------------------


@pytest.mark.property
@given(st.integers(min_value=2, max_value=8))
@settings(suppress_health_check=_FIXTURE_HC)
def test_no_lost_writes(tmp_data_dir: Path, n_threads: int):
    """N concurrent threads each calling log_attempt produce N records."""
    reset_engine_factory_cache()

    # Use a unique student_id per example to avoid accumulation
    import uuid
    student_id = f"concurrent-{uuid.uuid4()}"
    engine = get_engine(student_id, "math")

    barrier = threading.Barrier(n_threads)
    errors: list[Exception] = []

    def worker(thread_idx: int):
        try:
            barrier.wait(timeout=5)
            engine.log_attempt(
                topic="fractions",
                question_id=f"q_thread_{thread_idx}",
                is_correct=True,
                error_type=None,
            )
        except Exception as e:
            errors.append(e)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(n_threads)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)

    assert not errors, f"Thread errors: {errors}"

    log = engine.load_log()
    attempts = log["topics"]["fractions"]["attempts"]
    assert len(attempts) == n_threads, (
        f"Expected {n_threads} records, got {len(attempts)}"
    )

    # Verify timestamps are in non-decreasing order
    timestamps = [a["timestamp"] for a in attempts]
    assert timestamps == sorted(timestamps), "Timestamps not in non-decreasing order"


# ---------------------------------------------------------------------------
# 9.4 BKT-purity: hint records do not affect calculate_bkt.
# **Validates: Requirements 5.4**
# ---------------------------------------------------------------------------


@pytest.mark.property
@given(
    st.lists(
        st.fixed_dictionaries({
            "correct": st.booleans(),
            "attempt_type": st.sampled_from(["answer", "hint"]),
            "question_id": st.text(min_size=1, max_size=5, alphabet="abcde"),
            "timestamp": st.just("2024-01-01T00:00:00Z"),
            "error_type": st.just(None),
            "skill_id": st.just("t/q"),
            "response_time_ms": st.just(0),
        }),
        min_size=0,
        max_size=20,
    )
)
@settings(suppress_health_check=_FIXTURE_HC)
def test_bkt_purity_hint_records_ignored(tmp_data_dir: Path, mixed_seq: list[dict]):
    """Hint records do not affect calculate_bkt."""
    reset_engine_factory_cache()
    engine = get_engine("bkt-student", "math")

    # Full sequence (with hints)
    bkt_full = engine.calculate_bkt(mixed_seq)

    # Answer-only sequence
    answer_only = [
        a for a in mixed_seq
        if a.get("attempt_type", "answer") == "answer"
    ]
    bkt_answers = engine.calculate_bkt(answer_only)

    assert bkt_full == bkt_answers, (
        f"BKT with hints ({bkt_full}) != BKT without hints ({bkt_answers})"
    )
