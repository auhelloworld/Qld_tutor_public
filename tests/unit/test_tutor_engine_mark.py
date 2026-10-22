"""Verification gate for TutorEngine.mark with per-student isolation.

Tests:
- mark with valid question writes to per-student SQLite storage.
- mark with non-existent question_id → question_not_found response.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from backend._testing import reset_engine_factory_cache


@pytest.fixture(autouse=True)
def _isolate(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Reset engine cache and redirect LOG_ROOT to tmp_path for isolation."""
    reset_engine_factory_cache()
    monkeypatch.setattr("backend.rules.LOG_ROOT", tmp_path / "logs")
    yield
    reset_engine_factory_cache()


@pytest.fixture
def tutor():
    """Return a fresh TutorEngine instance (uses MOCK mode since no API key)."""
    # Reset the singleton so we get a fresh instance
    import backend.tutor_engine as te
    te._tutor_engine = None
    engine = te.get_tutor_engine()
    return engine


STUDENT_ID = "test-student-001"


def test_mark_valid_question_writes_to_per_student_log(tmp_path, tutor):
    """mark with a valid math question writes a record to data/logs/<s>/math_log.json."""
    from backend.rules import LOG_ROOT

    result = tutor.mark("math_7_f_AC9M7N02_adae12", "3/4", student_id=STUDENT_ID)

    # The result should have the standard shape (from mock LLM)
    assert "is_correct" in result
    assert "feedback" in result

    from backend.rules import get_engine
    data = get_engine(STUDENT_ID, "math").load_log()
    assert not (LOG_ROOT / STUDENT_ID / "math_log.json").exists()
    assert data["student_id"] == STUDENT_ID
    # The topic for math_7_f_AC9M7N02_adae12 is "fractions"
    assert "AC9M7N02" in data["topics"]
    attempts = data["topics"]["AC9M7N02"]["attempts"]
    assert len(attempts) >= 1
    assert attempts[-1]["question_id"] == "math_7_f_AC9M7N02_adae12"
    assert attempts[-1]["attempt_type"] == "answer"


def test_mark_nonexistent_question_returns_question_not_found(tutor):
    """mark with non-existent question_id → question_not_found response."""
    result = tutor.mark("nonexistent_q_999", "some answer", student_id=STUDENT_ID)

    assert result["is_correct"] is False
    assert result["error_type"] == "question_not_found"
    assert "not found" in result["feedback"].lower()


def test_mark_short_answer_optional_units(tutor):
    """Test that a short-answer question with units is marked correctly when student omits units, and vice versa."""
    # Inject a test exercise
    tutor.exercises["sa_test_001"] = {
        "id": "sa_test_001",
        "topic": "formulas_substitution",
        "question_type": "short_answer",
        "question": "Calculate the area.",
        "answer": "60 cm²",
        "framework": "AC9_MATHS",
        "topic_ids": ["AC9M7A01"],
        "subject": "math",
        "difficulty": "foundational",
        "year_level": 7,
        "unit": "cm²"
    }

    # Case 1: Student answer does not have units, but matches the correct answer numeric value
    res1 = tutor.mark("sa_test_001", "60", student_id=STUDENT_ID)
    assert res1["is_correct"] is True
    assert "correct" in res1["feedback"].lower()

    # Case 2: Student answer has units, matches correct answer
    res2 = tutor.mark("sa_test_001", "60 cm²", student_id=STUDENT_ID)
    assert res2["is_correct"] is True

    # Case 3: Student answer has different units, should be incorrect
    res3 = tutor.mark("sa_test_001", "60 m²", student_id=STUDENT_ID)
    assert res3["is_correct"] is False

    # Case 4: Student answer is wrong number, should be incorrect
    res4 = tutor.mark("sa_test_001", "50", student_id=STUDENT_ID)
    assert res4["is_correct"] is False


def test_mark_short_answer_numeric_mismatch_gives_targeted_feedback(tutor):
    """Wrong numeric answers should get diagnostic feedback, not only generic retry text."""
    tutor.exercises["sa_test_numeric_diag"] = {
        "id": "sa_test_numeric_diag",
        "topic": "test numeric diagnostics",
        "question_type": "short_answer",
        "question": "Calculate 12 × 5.",
        "answer": "60",
        "framework": "AC9_MATHS",
        "topic_ids": ["AC9M7N04"],
        "subject": "math",
        "difficulty": "foundational",
        "year_level": 7,
    }

    result = tutor.mark("sa_test_numeric_diag", "30", student_id=STUDENT_ID)

    assert result["is_correct"] is False
    assert result["error_type"] == "incorrect_value"
    assert "simple multiple or fraction" in result["feedback"]



def test_mark_log_write_failure_returns_log_write_failed(tmp_path, tutor):
    """mark where log_attempt raises → is_correct=False, retryable=True, error_type in ('attempt_persistence_failed', 'log_write_failed')."""
    with patch("backend.tutor_engine.get_engine") as mock_get_engine:
        mock_engine = mock_get_engine.return_value
        mock_engine.log_attempt.side_effect = IOError("disk full")

        result = tutor.mark("math_7_f_AC9M7N02_adae12", "3/4", student_id=STUDENT_ID)

    assert result["is_correct"] is False
    assert result["error_type"] in ("attempt_persistence_failed", "log_write_failed")
    assert result.get("retryable") is True
    assert "persist" in result["feedback"].lower() or "saving" in result["feedback"].lower()


def test_save_reflection_success_writes_to_log(tmp_path, tutor):
    """save_reflection updates the authoritative SQLite attempt."""
    from backend.rules import LOG_ROOT
    import sqlite3

    # 1. Mark an answer (which logs an attempt)
    tutor.mark("math_7_f_AC9M7N02_adae12", "1/2", student_id=STUDENT_ID)

    # 2. Save reflection
    res = tutor.save_reflection("math_7_f_AC9M7N02_adae12", "calculation_slip", student_id=STUDENT_ID)
    assert res["success"] is True

    # 3. No legacy JSON mirror is created.
    assert not (LOG_ROOT / STUDENT_ID / "math_log.json").exists()

    # 4. Verify SQLite DB
    from backend.rules import LOG_ROOT
    db_path = LOG_ROOT.parent / "qld_tutor.db"
    conn = sqlite3.connect(str(db_path))
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT extra FROM attempts WHERE student_id = ? AND question_id = ?", (STUDENT_ID, "math_7_f_AC9M7N02_adae12"))
        row = cursor.fetchone()
        assert row is not None
        extra_data = json.loads(row[0])
        assert extra_data["reflection_type"] == "calculation_slip"
    finally:
        conn.close()



def test_mark_request_id_replays_from_domain_record(tutor):
    """A cache miss after commit must not create a second learning attempt."""
    from backend.rules import AttemptRequestConflict, get_engine

    request_id = "tutor-idempotency-001"
    fingerprint = "fingerprint-a"
    first = tutor.mark(
        "math_7_f_AC9M7N02_adae12",
        "3/4",
        student_id=STUDENT_ID,
        request_id=request_id,
        request_fingerprint=fingerprint,
    )

    engine = get_engine(STUDENT_ID, "math")
    attempts_after_first = [
        attempt
        for topic in engine.load_log()["topics"].values()
        for attempt in topic.get("attempts", [])
        if attempt.get("question_id") == "math_7_f_AC9M7N02_adae12"
    ]

    second = tutor.mark(
        "math_7_f_AC9M7N02_adae12",
        "3/4",
        student_id=STUDENT_ID,
        request_id=request_id,
        request_fingerprint=fingerprint,
    )

    attempts_after_retry = [
        attempt
        for topic in engine.load_log()["topics"].values()
        for attempt in topic.get("attempts", [])
        if attempt.get("question_id") == "math_7_f_AC9M7N02_adae12"
    ]
    assert len(attempts_after_first) == len(attempts_after_retry) == 1
    assert second["attempt_id"] == first["attempt_id"]

    with pytest.raises(AttemptRequestConflict):
        tutor.mark(
            "math_7_f_AC9M7N02_adae12",
            "1/2",
            student_id=STUDENT_ID,
            request_id=request_id,
            request_fingerprint="fingerprint-b",
        )
