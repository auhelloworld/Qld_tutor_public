""""I don't know" answers (``gave_up``) in TutorEngine.mark.

The student chooses "I don't know" instead of skipping. The answer is a scored
miss: it counts for Today steps, BKT and review spacing. It does not call the
marker, gives no stars, and does not add an Error Book entry.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from backend._testing import reset_engine_factory_cache
from backend.rules import get_engine

STUDENT_ID = "6f1c2b9e-3d4a-4c5b-9e8f-1a2b3c4d5e6f"
QUESTION_ID = "math_7_f_AC9M7N02_adae12"  # short answer, topic AC9M7N02, Year 7


@pytest.fixture(autouse=True)
def _isolate(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    reset_engine_factory_cache()
    monkeypatch.setattr("backend.rules.LOG_ROOT", tmp_path / "logs")
    yield
    reset_engine_factory_cache()


@pytest.fixture
def tutor():
    import backend.tutor_engine as te

    te._tutor_engine = None
    return te.get_tutor_engine()


def _today_task(kind: str, target: str) -> str:
    day = datetime.now(ZoneInfo("Australia/Brisbane")).date().isoformat()
    return f"today|{day}|math|year7|{kind}|{target}"


def _answer_rows(question_id: str) -> list[dict]:
    return get_engine(STUDENT_ID, "math").get_attempts_for_question(
        question_id, attempt_types=("answer",)
    )


def _no_marker(tutor):
    """Fail the test if any marker runs."""
    boom = AssertionError("the marker must not run for an I don't know answer")
    return patch.multiple(
        tutor,
        _mark_short_answer=lambda *a, **k: (_ for _ in ()).throw(boom),
        _mark_mcq=lambda *a, **k: (_ for _ in ()).throw(boom),
        _mark_reasoning=lambda *a, **k: (_ for _ in ()).throw(boom),
        _mark_multi_part=lambda *a, **k: (_ for _ in ()).throw(boom),
    )


def test_dont_know_records_a_scored_miss_without_the_marker_or_stars(tutor):
    with _no_marker(tutor):
        result = tutor.mark(QUESTION_ID, "", student_id=STUDENT_ID, gave_up=True)

    assert result["is_correct"] is False
    assert result["outcome"] == "incorrect"
    assert result["error_type"] == "dont_know"
    assert result["feedback"]
    assert "quest_award" not in result

    rows = _answer_rows(QUESTION_ID)
    assert len(rows) == 1
    row = rows[0]
    assert row["outcome"] == "incorrect"
    assert row["error_type"] == "dont_know"
    assert row["error_book_eligible"] is False
    assert row["student_answer"] == ""
    assert "misconception_id" not in row


def test_dont_know_does_not_add_an_error_book_entry(tutor):
    tutor.mark(QUESTION_ID, "", student_id=STUDENT_ID, gave_up=True)

    assert get_engine(STUDENT_ID, "math").get_mistake_state(QUESTION_ID) is None


def test_dont_know_after_a_real_mistake_keeps_the_cause_step_working(tutor):
    engine = get_engine(STUDENT_ID, "math")
    engine.log_attempt("AC9M7N02", QUESTION_ID, False, error_type="concept_gap", student_answer="12")
    assert engine.get_mistake_state(QUESTION_ID)["closure_stage"] == "needs_understanding"

    tutor.mark(QUESTION_ID, "", student_id=STUDENT_ID, gave_up=True)
    state = engine.get_mistake_state(QUESTION_ID)
    assert state["closure_stage"] == "needs_understanding"
    assert state["error_type"] == "concept_gap"

    # The cause goes on the real mistake, not on the "I don't know" row.
    assert engine.update_latest_incorrect_attempt_metadata(
        QUESTION_ID,
        {
            "error_cause": "concept_gap",
            "reflection_type": "concept_gap",
            "cause_recorded_at": datetime.now(timezone.utc).isoformat(),
        },
        topics=["AC9M7N02"],
    )
    assert engine.get_mistake_state(QUESTION_ID)["closure_stage"] == "needs_retry"


def test_dont_know_counts_for_today_without_independent_credit(tutor):
    task_id = _today_task("revision", "AC9M7N02")
    tutor.mark(
        QUESTION_ID,
        "",
        student_id=STUDENT_ID,
        gave_up=True,
        today_task_id=task_id,
        is_revision=True,
        support_level=0,
        first_attempt=True,
    )

    now = datetime.now(timezone.utc)
    stats = get_engine(STUDENT_ID, "math").get_today_plan_attempt_stats(
        (now - timedelta(days=1)).isoformat(),
        (now + timedelta(days=1)).isoformat(),
    )
    assert stats[task_id]["attempted"] == 1
    assert stats[task_id]["ordered_evidence"][0]["independent_correct"] is False
    assert stats[task_id]["ordered_evidence"][0]["supported_correct"] is False


def _dont_know_row(index: int) -> dict:
    return {
        "attempt_id": f"dk-{index}", "question_id": f"q{index % 3}", "attempt_type": "answer",
        "outcome": "incorrect", "correct": False, "error_type": "dont_know",
        "student_answer": "", "error_book_eligible": False,
        "timestamp": f"2026-10-20T00:0{index}:00+00:00",
    }


def test_dont_know_is_not_error_pattern_evidence():
    from backend.tutor_engine import _confirmed_error_attempts

    wrong = {**_dont_know_row(0), "attempt_id": "wrong", "error_type": "concept_gap",
             "student_answer": "12", "error_book_eligible": True}

    rows = _confirmed_error_attempts([_dont_know_row(1), wrong])
    assert [row["attempt_id"] for row in rows] == ["wrong"]


def test_dont_know_is_not_misconception_evidence():
    from backend.services.misconception_evidence import analyse_misconception_evidence

    log = {"topics": {"EN7-T1": {"attempts": [_dont_know_row(index) for index in range(6)]}}}
    exercises = {f"q{index}": {"subject": "english", "topic_ids": ["EN7-T1"]} for index in range(3)}

    report = analyse_misconception_evidence([("s1", "english", log)], exercises, subjects=["english"])

    assert report.confirmed_errors["english"] == 0
    assert report.candidates == ()


def test_mark_endpoint_passes_the_dont_know_flag(tmp_path):
    from backend.api import app
    from backend.student_identity import create_student_token

    client = TestClient(app)
    headers = {"Authorization": f"Bearer {create_student_token(STUDENT_ID)}"}

    response = client.post(
        "/api/tutor/mark",
        json={"question_id": QUESTION_ID, "student_answer": "", "gave_up": True},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["is_correct"] is False
    assert body["outcome"] == "incorrect"
    assert body["error_type"] == "dont_know"
    # Giving up shows the right answer and how to get it.
    assert body["correct_answer"] == "$2^4 \\times 3$"
    assert body["solution_steps"][0] == "Divide 48 by 2 to get 24"
    assert body["solution_steps"][-1] == "$48 = 2^4 \\times 3$"


MCQ = {
    "id": "mcq_reveal_test",
    "topic": "AC9M7N02",
    "topic_ids": ["AC9M7N02"],
    "subject": "math",
    "year_level": 7,
    "question_type": "multiple_choice",
    "question": "Which number is prime?",
    "choices": ["A. 9", "B. 11", "C. 15", "D. 21"],
    "correct_choice": "B",
    "steps": ["A prime number has exactly two factors.", "11 has only the factors 1 and 11.", " "],
}


@pytest.mark.parametrize(("answer", "reveal", "shown"), [
    ("A", True, True),     # a final miss shows the answer
    ("B", True, False),    # a right answer needs no answer
    ("A", False, False),   # a miss with a second try left keeps the answer hidden
])
def test_the_right_answer_is_sent_only_after_a_final_miss(tutor, answer, reveal, shown):
    tutor.exercises[MCQ["id"]] = dict(MCQ)

    result = tutor.mark(MCQ["id"], answer, student_id=STUDENT_ID, reveal_answer=reveal)

    assert ("correct_answer" in result) is shown
    assert ("solution_steps" in result) is shown
    if shown:
        assert result["correct_answer"] == "B. 11"
        # The question's own worked steps; blank steps are left out.
        assert result["solution_steps"] == ["A prime number has exactly two factors.", "11 has only the factors 1 and 11."]


def test_mark_view_keeps_the_revealed_answer():
    from backend.services.question_context import student_mark_view

    view = student_mark_view({
        "is_correct": False, "feedback": "No.", "correct_answer": "B. 11",
        "solution_steps": ["Step 1"], "answer": "secret", "steps": ["raw"],
    })
    assert view["correct_answer"] == "B. 11"
    assert view["solution_steps"] == ["Step 1"]
    assert "answer" not in view
    assert "steps" not in view
