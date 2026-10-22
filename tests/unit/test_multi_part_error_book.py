"""Error Book evidence for progressive multi-part answers (bug report B03).

Scenarios:
- main: one part is wrong and the student leaves -> the Error Book keeps it.
- main: a later in-place fix of that part does not erase the evidence.
- edge: the cause can be recorded; a later independent finish then counts as
  the retry, and the wrong answer stays visible.
- edge: the same wrong answer sent twice is kept once.
- high risk: placement (diagnostic) misses stay out of the Error Book, and the
  attempt outcome used by mastery (BKT) does not change.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from backend.rules import StudyRuleEngine, get_engine
from backend.student_identity import create_student_token

STUDENT = "b03b2c3d-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
QUESTION_ID = "multipart_b03_001"
TOPIC = "AC9M7N04"


@pytest.fixture
def tutor():
    import backend.tutor_engine as te

    te._tutor_engine = None
    engine = te.get_tutor_engine()
    engine.exercises[QUESTION_ID] = {
        "id": QUESTION_ID,
        "topic": "fractions",
        "question_type": "multi_part",
        "question": "A multi-part question.",
        "answer": "a: 6\nb: 10\nc: 15",
        "sub_parts": [
            {"label": "a", "question": "What is 2 * 3?", "answer": "6", "marks": 1},
            {"label": "b", "question": "What is 5 * 2?", "answer": "10", "marks": 1},
            {"label": "c", "question": "What is 3 * 5?", "answer": "15", "marks": 1},
        ],
        "framework": "AC9_MATHS",
        "topic_ids": [TOPIC],
        "subject": "math",
        "difficulty": "developing",
        "year_level": 7,
        "unit": None,
    }
    yield engine
    te._tutor_engine = None


def _rows():
    return get_engine(STUDENT, "math").query_mistake_states()["rows"]


def test_wrong_part_then_leaving_keeps_the_part_in_the_error_book(tutor):
    result = tutor.mark(QUESTION_ID, '{"a": "999"}', student_id=STUDENT, first_attempt=True)
    # Mastery evidence stays neutral while parts are blank.
    assert result["outcome"] == "unanswered"

    rows = _rows()
    assert [row["question_id"] for row in rows] == [QUESTION_ID]
    row = rows[0]
    assert row["topic_id"] == TOPIC
    assert row["error_type"] == "partial_incorrect"
    assert row["closure_stage"] == "needs_understanding"
    assert row["attempt_count"] == 1
    assert json.loads(row["attempt"]["student_answer"]) == {"a": "999"}

    stored = get_engine(STUDENT, "math").get_attempts_for_question(QUESTION_ID)
    assert {attempt["outcome"] for attempt in stored} == {"unanswered"}


def test_in_place_fix_of_the_part_does_not_erase_the_evidence(tutor):
    tutor.mark(QUESTION_ID, '{"a": "999"}', student_id=STUDENT, first_attempt=True)
    tutor.mark(QUESTION_ID, '{"a": "999"}', student_id=STUDENT, first_attempt=False)
    tutor.mark(QUESTION_ID, '{"a": "6"}', student_id=STUDENT, first_attempt=False)
    finished = tutor.mark(QUESTION_ID, '{"b": "10", "c": "15"}', student_id=STUDENT, first_attempt=False)
    assert finished["outcome"] == "correct"

    rows = _rows()
    assert len(rows) == 1
    row = rows[0]
    assert json.loads(row["attempt"]["student_answer"]) == {"a": "999"}
    assert row["attempt"]["part_error_history"] == [
        {
            "label": "a",
            "student_answer": "999",
            "error_type": "incorrect_value",
            "recorded_at": row["attempt"]["part_error_history"][0]["recorded_at"],
        }
    ]
    # No cause was named yet, so the quick fix is not a completed retry.
    assert row["fixed_by_later_correct"] is False
    assert row["closure_stage"] == "needs_understanding"


def test_cause_then_independent_finish_counts_as_the_retry(tutor):
    tutor.mark(QUESTION_ID, '{"a": "999"}', student_id=STUDENT, first_attempt=True)
    engine = get_engine(STUDENT, "math")
    assert engine.update_latest_incorrect_attempt_metadata(
        QUESTION_ID,
        {"error_cause": "calculation_slip", "cause_recorded_at": datetime.now(timezone.utc).isoformat()},
        topics=[TOPIC],
    )
    assert engine.get_mistake_state(QUESTION_ID)["closure_stage"] == "needs_retry"

    tutor.mark(QUESTION_ID, '{"a": "6", "b": "10", "c": "15"}', student_id=STUDENT)

    row = _rows()[0]
    assert row["fixed_by_later_correct"] is True
    assert row["closure_stage"] == "needs_transfer"
    assert json.loads(row["attempt"]["student_answer"]) == {"a": "999"}

    # The transfer step needs the wrong part as its confirmed source error.
    source_attempts = engine.get_attempts_for_question(QUESTION_ID, attempt_types=("answer",))
    match = tutor._error_book_review_match(
        source_question_id=QUESTION_ID,
        candidate_question={**tutor.exercises[QUESTION_ID], "id": "multipart_b03_variant"},
        source_attempts=source_attempts,
    )
    assert "confirmed_source_error_not_found" not in match["blockers"]
    suggestion = tutor.suggest_practice(
        TOPIC, "error_book", student_id=STUDENT, prior_question_id=QUESTION_ID, subject="math",
    )
    assert "confirmed_source_error_not_found" not in suggestion["variation_match"].get("blockers", [])


def test_placement_misses_on_parts_stay_out_of_the_error_book():
    attempt = {
        "attempt_id": "diag-1",
        "question_id": QUESTION_ID,
        "attempt_type": "diagnostic",
        "error_book_eligible": False,
        "timestamp": "2026-10-18T00:00:00+00:00",
        "student_answer": '{"a": "999"}',
        "part_results": [
            {"label": "a", "outcome": "incorrect", "is_correct": False, "student_answer": "999"},
            {"label": "b", "outcome": "unanswered", "is_correct": False, "student_answer": ""},
        ],
    }
    assert StudyRuleEngine._derive_mistake_state([(TOPIC, attempt)]) is None


def test_error_book_api_shows_the_wrong_part_and_accepts_a_cause():
    """Verified bug case: math_7_ms_AC9M7N03_798af4 with a = 999."""
    from backend.api import app

    client = TestClient(app)
    headers = {"Authorization": f"Bearer {create_student_token(STUDENT)}"}
    marked = client.post(
        "/api/tutor/mark",
        json={"question_id": "math_7_ms_AC9M7N03_798af4", "student_answer": '{"a": "999"}', "first_attempt": True},
        headers=headers,
    )
    assert marked.status_code == 200, marked.text

    mistakes = client.get("/api/tutor/mistakes", params={"subject": "math", "year_level": 7}, headers=headers).json()
    entry = next(m for m in mistakes["mistakes"] if m["question_id"] == "math_7_ms_AC9M7N03_798af4")
    assert entry["topic_id"] == "AC9M7N03"
    assert json.loads(entry["student_answer"]) == {"a": "999"}

    cause = client.post(
        "/api/tutor/mistakes/cause",
        json={
            "subject": "math",
            "question_id": "math_7_ms_AC9M7N03_798af4",
            "topic_id": "AC9M7N03",
            "error_cause": "calculation_slip",
        },
        headers=headers,
    )
    assert cause.status_code == 200, cause.text
    assert cause.json()["closure_stage"] == "needs_retry"
