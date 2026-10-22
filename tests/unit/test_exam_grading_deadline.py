"""Unit tests for Mock Exam paper grading monotonic deadline enforcement.

Enforces invariants from EX-01:
- The entire paper shares one monotonic budget.
- Closed short-answer adjudication receives the same remaining deadline as open/reasoning items.
- Provider calls cannot exceed the remaining budget.
- Items exceeding deadline become neutral pending review, not false incorrect.
"""
from __future__ import annotations

import time
from unittest.mock import patch
import pytest

from backend.exam_simulator import ExamSimulator


def _make_mock_session():
    return {
        "exam_id": "test-exam-1",
        "student_id": "test-student-1",
        "paper": ["q1", "q2"],
        "responses": {"q1": "student answer 1", "q2": "student answer 2"},
        "started_at": "2026-08-27T10:00:00Z",
        "deadline_at": "2026-08-27T10:45:00Z",
        "completed_at": "2026-08-27T10:40:00Z",
        "time_limit_minutes": 45,
    }


def _make_adjudicable_question(qid: str):
    return {
        "id": qid,
        "question": f"Calculate value for {qid}",
        "answer": "Estimate $80; actual $80.36; error $0.36",
        "question_type": "short_answer",
        "subject": "math",
        "topic_ids": ["AC9M7N01"],
        "difficulty": "developing",
    }


def test_exam_grading_deadline_stops_adjudication_probe(monkeypatch):
    """Original probe: 2 closed short-answers taking 0.7s each with 1.0s paper budget.

    Must NOT run 1.4s and mark complete. Must respect deadline and set grading_timed_out=True.
    """
    questions = {
        "q1": _make_adjudicable_question("q1"),
        "q2": _make_adjudicable_question("q2"),
    }
    sim = ExamSimulator(exercises=questions)
    session = _make_mock_session()

    monkeypatch.setenv("EXAM_GRADING_TIMEOUT_SECONDS", "1.0")

    def slow_adjudicate(*args, **kwargs):
        deadline = kwargs.get("deadline")
        if deadline is not None and time.monotonic() >= deadline:
            return "unavailable"
        timeout = 0.7
        if deadline is not None:
            timeout = min(timeout, max(0.0, deadline - time.monotonic()))
        time.sleep(timeout)
        if deadline is not None and time.monotonic() >= deadline:
            return "unavailable"
        return "confirmed"

    with patch("backend.services.answer_adjudication.adjudicate_equivalence", side_effect=slow_adjudicate):
        start_time = time.monotonic()
        result = sim._grade_paper(session)
        elapsed = time.monotonic() - start_time

    assert elapsed < 1.3, f"Grading took {elapsed:.2f}s, exceeded paper deadline"
    assert result["grading_timed_out"] is True
    assert result["grading_status"] in ("timed_out", "complete_with_pending", "pending")
    assert result["pending_count"] >= 1
    assert result["grading_warning"] is not None
