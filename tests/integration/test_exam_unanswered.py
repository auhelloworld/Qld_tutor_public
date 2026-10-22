"""Blank exam answers are "not answered", not concept errors (bug report H).

Scenarios:
- main: a blank answer scores 0 in the exam result, is flagged unanswered, and
  is stored as an unanswered attempt (no Error Book row, no BKT evidence).
- main: a wrong answer in the same exam still becomes a confirmed mistake.
- edge: a multi-part answer whose parts are all empty counts as not answered.
- high risk: the error-pattern evidence ignores the blank attempt.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.api import app
from backend.exam_simulator import ExamSimulator, get_exam_simulator
from backend.rules import get_engine
from backend.services.attempt_outcomes import is_scored_learning_attempt
from backend.student_identity import create_student_token
from backend.tutor_engine import _confirmed_error_attempts

STUDENT = "e7a1b2c3-d4e5-4f60-8a7b-9c0d1e2f3a4b"
HEADERS = {"Authorization": f"Bearer {create_student_token(STUDENT)}"}
TOPIC = "AC9M7N01"


def _short(question_id: str, answer: str) -> dict:
    return {
        "id": question_id, "topic": "squares", "topic_ids": [TOPIC], "subject": "math",
        "year_level": 7, "question_type": "short_answer", "difficulty": "developing",
        "question": f"Question {question_id}", "answer": answer,
    }


@pytest.fixture
def paper(monkeypatch):
    sim = get_exam_simulator()
    items = {
        "exam_blank_q1": _short("exam_blank_q1", "12"),
        "exam_blank_q2": _short("exam_blank_q2", "15"),
        "exam_blank_q3": _short("exam_blank_q3", "20"),
        "exam_blank_mp": {
            **_short("exam_blank_mp", ""),
            "question_type": "multi_part",
            "sub_parts": [
                {"label": "a", "question": "Part a", "answer": "4", "marks": 1},
                {"label": "b", "question": "Part b", "answer": "9", "marks": 1},
            ],
        },
    }
    for question_id, item in items.items():
        monkeypatch.setitem(sim.exercises, question_id, item)
    monkeypatch.setattr(ExamSimulator, "_build_paper", lambda self, **_kwargs: list(items))
    return list(items)


def _attempt(question_id: str) -> dict:
    attempts = get_engine(STUDENT, "math").get_attempts_for_question(question_id)
    assert len(attempts) == 1, attempts
    return attempts[0]


def test_blank_exam_answers_are_not_answered_and_stay_out_of_the_error_book(paper):
    client = TestClient(app)
    started = client.post(
        "/api/exam/start",
        json={"subject": "math", "year_level": 7, "num_questions": 4, "time_limit_minutes": 30},
        headers=HEADERS,
    ).json()
    submitted = client.post(
        "/api/exam/submit",
        json={
            "subject": "math",
            "exam_id": started["exam_id"],
            "responses": {
                "exam_blank_q1": "   ",
                "exam_blank_q2": "99",
                "exam_blank_q3": "20",
                "exam_blank_mp": '{"a": "", "b": " "}',
            },
        },
        headers=HEADERS,
    )
    assert submitted.status_code == 200, submitted.text
    by_id = {entry["question_id"]: entry for entry in submitted.json()["results_per_question"]}

    # The exam result still gives 0 marks for the blank questions.
    assert by_id["exam_blank_q1"]["score"] == 0 and by_id["exam_blank_q1"]["unanswered"] is True
    assert by_id["exam_blank_mp"]["score"] == 0 and by_id["exam_blank_mp"]["unanswered"] is True
    assert "unanswered" not in by_id["exam_blank_q2"]
    assert by_id["exam_blank_q3"]["is_correct"] is True
    assert TOPIC in submitted.json()["weak_topics"]

    blank = _attempt("exam_blank_q1")
    assert blank["outcome"] == "unanswered"
    assert blank["error_type"] == "exam_unanswered"
    assert not is_scored_learning_attempt(blank)
    assert _attempt("exam_blank_mp")["outcome"] == "unanswered"

    wrong = _attempt("exam_blank_q2")
    assert wrong["outcome"] == "incorrect" and wrong["error_type"] == "exam_error"

    mistakes = get_engine(STUDENT, "math").query_mistake_states()["rows"]
    assert [row["question_id"] for row in mistakes] == ["exam_blank_q2"]

    topic_attempts = get_engine(STUDENT, "math").get_topic_attempts(TOPIC)
    assert [a["question_id"] for a in _confirmed_error_attempts(topic_attempts)] == ["exam_blank_q2"]
