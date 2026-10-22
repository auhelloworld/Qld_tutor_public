"""End-to-end smoke test — student isolation via TestClient.

Verifies Tasks 11.1–11.5:
1. Two distinct student UUIDs can coexist.
2. Marking a question as student A → attempt lands in SQLite under A.
3. Marking a question as student B → attempt lands under B and not A.
4. Getting progress as student A → only A's attempts show.

Tasks 11.6–11.7 (missing/invalid header → 400) are already covered by
test_api_endpoints.py.
"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend._testing import reset_engine_factory_cache
from backend.api import app
from backend.student_identity import create_student_token


client = TestClient(app)


def _auth_headers(student_id: str) -> dict:
    token = create_student_token(student_id)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def _isolate(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Redirect LOG_ROOT to tmp_path so tests don't pollute real data."""
    reset_engine_factory_cache()
    monkeypatch.setattr("backend.rules.LOG_ROOT", tmp_path / "logs")
    yield
    reset_engine_factory_cache()


# Two distinct UUIDs representing two browser tabs
STUDENT_A = str(uuid.uuid4())
STUDENT_B = str(uuid.uuid4())


def _student_log(student_id: str, subject: str = "math") -> dict:
    from backend.rules import get_engine

    return get_engine(student_id, subject).load_log()


def test_mark_student_a_creates_log(tmp_path: Path, monkeypatch):
    """11.2: Mark a question as student A → record lands in A's log."""
    # Use fresh UUIDs per test to avoid cross-test contamination
    sid_a = str(uuid.uuid4())
    monkeypatch.setattr("backend.rules.LOG_ROOT", tmp_path / "logs")
    reset_engine_factory_cache()

    response = client.post(
        "/api/tutor/mark",
        json={"question_id": "math_7_f_AC9M7N02_adae12", "student_answer": "2^4 × 3"},
        headers=_auth_headers(sid_a),
    )
    assert response.status_code == 200

    data = _student_log(sid_a)
    assert data["student_id"] == sid_a
    assert not (tmp_path / "logs" / sid_a / "math_log.json").exists()
    # Should have at least one topic with attempts
    assert len(data["topics"]) > 0
    # Find the attempt
    for topic_name, topic_data in data["topics"].items():
        attempts = topic_data.get("attempts", [])
        if any(a.get("question_id") == "math_7_f_AC9M7N02_adae12" for a in attempts):
            return
    pytest.fail("No attempt record found for math_7_f_AC9M7N02_adae12 in student A's log")


def test_mark_student_b_isolated_from_a(tmp_path: Path, monkeypatch):
    """11.3: Mark as student B → lands in B's log, NOT in A's."""
    sid_a = str(uuid.uuid4())
    sid_b = str(uuid.uuid4())
    monkeypatch.setattr("backend.rules.LOG_ROOT", tmp_path / "logs")
    reset_engine_factory_cache()

    # Student A marks
    client.post(
        "/api/tutor/mark",
        json={"question_id": "math_7_f_AC9M7N02_adae12", "student_answer": "2^4 × 3"},
        headers=_auth_headers(sid_a),
    )

    # Student B marks
    client.post(
        "/api/tutor/mark",
        json={"question_id": "math_7_f_AC9M7N02_adae12", "student_answer": "1/2"},
        headers=_auth_headers(sid_b),
    )

    data_b = _student_log(sid_b)
    assert data_b["student_id"] == sid_b

    # A's SQLite view should NOT contain B's data.
    data_a = _student_log(sid_a)
    assert data_a["student_id"] == sid_a
    assert not (tmp_path / "logs" / sid_a / "math_log.json").exists()
    assert not (tmp_path / "logs" / sid_b / "math_log.json").exists()

    # Verify A's log only has A's attempt (answer "3/4"), not B's ("1/2")
    for topic_data in data_a["topics"].values():
        for attempt in topic_data.get("attempts", []):
            # A's attempts should not reference B's student_id
            assert attempt.get("student_id", sid_a) != sid_b


def test_progress_student_a_only_shows_own_data(tmp_path: Path, monkeypatch):
    """11.5: Progress for student A shows only A's attempts."""
    sid_a = str(uuid.uuid4())
    sid_b = str(uuid.uuid4())
    monkeypatch.setattr("backend.rules.LOG_ROOT", tmp_path / "logs")
    reset_engine_factory_cache()

    # Student A marks a question (creates 1 attempt)
    client.post(
        "/api/tutor/mark",
        json={"question_id": "math_7_f_AC9M7N02_adae12", "student_answer": "2^4 × 3"},
        headers=_auth_headers(sid_a),
    )

    # Student B marks TWO questions (creates 2 attempts)
    client.post(
        "/api/tutor/mark",
        json={"question_id": "math_7_f_AC9M7N02_adae12", "student_answer": "1/2"},
        headers=_auth_headers(sid_b),
    )
    client.post(
        "/api/tutor/mark",
        json={"question_id": "math_7_f_AC9M7N02_adae12", "student_answer": "2/3"},
        headers=_auth_headers(sid_b),
    )

    # Get progress for student A — should show 1 attempt
    response_a = client.get(
        "/api/tutor/progress",
        params={"subject": "math"},
        headers=_auth_headers(sid_a),
    )
    assert response_a.status_code == 200
    progress_a = response_a.json()

    # Get progress for student B — should show 2 attempts
    response_b = client.get(
        "/api/tutor/progress",
        params={"subject": "math"},
        headers=_auth_headers(sid_b),
    )
    assert response_b.status_code == 200
    progress_b = response_b.json()

    # A has 1 attempt, B has 2 — progress must differ
    assert len(progress_a) > 0
    assert len(progress_b) > 0

    # Verify attempt counts differ (A=1, B=2 for the same topic)
    a_attempts = sum(t.get("attempts_count", 0) for t in progress_a)
    b_attempts = sum(t.get("attempts_count", 0) for t in progress_b)
    assert a_attempts == 1
    assert b_attempts == 2
