"""Show Answer in free practice.

Student question payloads carry no answer key. After the student has answered
a question, POST /api/tutor/show-answer returns the right answer for it.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend._testing import reset_engine_factory_cache

STUDENT_ID = "0b6f4a52-7c1e-4d3a-9b8c-2e5f6a7b8c9d"
MCQ = {
    "id": "show_answer_mcq",
    "topic": "AC9M7N02",
    "topic_ids": ["AC9M7N02"],
    "subject": "math",
    "year_level": 7,
    "question_type": "multiple_choice",
    "question": "Which number is prime?",
    "choices": ["A. 9", "B. 11", "C. 15", "D. 21"],
    "correct_choice": "B",
}


@pytest.fixture(autouse=True)
def _isolate(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    reset_engine_factory_cache()
    monkeypatch.setattr("backend.rules.LOG_ROOT", tmp_path / "logs")
    yield
    reset_engine_factory_cache()


@pytest.fixture
def client():
    import backend.tutor_engine as te
    from backend.api import app
    from backend.student_identity import create_student_token

    te._tutor_engine = None
    te.get_tutor_engine().exercises[MCQ["id"]] = dict(MCQ)
    test_client = TestClient(app)
    test_client.headers.update({"Authorization": f"Bearer {create_student_token(STUDENT_ID)}"})
    yield test_client
    te._tutor_engine = None


def test_show_answer_needs_an_answer_first(client):
    response = client.post("/api/tutor/show-answer", json={"question_id": MCQ["id"]})

    assert response.status_code == 409
    assert response.json()["error"] == "answer_needs_an_attempt"


def test_show_answer_after_a_wrong_answer(client):
    marked = client.post("/api/tutor/mark", json={"question_id": MCQ["id"], "student_answer": "A"})
    assert marked.json()["is_correct"] is False
    assert "correct_answer" not in marked.json()

    response = client.post("/api/tutor/show-answer", json={"question_id": MCQ["id"]})

    assert response.status_code == 200
    assert response.json() == {"question_id": MCQ["id"], "correct_answer": "B. 11"}


def test_show_answer_for_an_unknown_question(client):
    response = client.post("/api/tutor/show-answer", json={"question_id": "no_such_question"})

    assert response.status_code == 404


def test_revealed_answer_lists_each_part():
    from backend.tutor_engine import _revealed_answer

    question = {
        "question_type": "multi_part",
        "sub_parts": [
            {"label": "a", "question": "2 + 2", "answer": "4"},
            {"label": "b", "question": "Pick the prime.", "choices": ["A. 9", "B. 11"], "answer": "B"},
        ],
    }

    assert _revealed_answer(question) == "Part (a): 4\nPart (b): B. 11"
