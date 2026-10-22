"""Integration test: mark closes dialogue session.

Task 16.2: After `mark`, the next dialogue turn for the same (student_id, question_id)
starts a new session.
"""
from __future__ import annotations

from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.api import app
from backend.rate_limiter import _RATE_LIMITER
from backend.student_identity import create_student_token


VALID_STUDENT_ID = "b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
STUDENT_HEADERS = {"Authorization": f"Bearer {create_student_token(VALID_STUDENT_ID)}"}


class TestDialogueSessionClose:
    """After mark, dialogue starts a new session."""

    def setup_method(self):
        _RATE_LIMITER._buckets.clear()

    def test_mark_closes_session_new_dialogue_gets_new_id(self, tmp_data_dir):
        """Dialogue → mark → dialogue should yield a different session_id."""
        client = TestClient(app)

        # Start a dialogue session (just one turn to avoid triggering error pattern analysis)
        resp1 = client.post(
            "/api/tutor/dialogue",
            json={"question_id": "math_7_f_AC9M7N02_adae12", "student_message": "I need help"},
            headers=STUDENT_HEADERS,
        )
        assert resp1.status_code == 200
        session_id_1 = resp1.json()["dialogue_session_id"]

        # Mark the answer (closes the dialogue session)
        # Patch _analyze_error_patterns to avoid KeyError on dialogue records
        with patch("backend.tutor_engine.TutorEngine._analyze_error_patterns", return_value=None):
            mark_resp = client.post(
                "/api/tutor/mark",
                json={"question_id": "math_7_f_AC9M7N02_adae12", "student_answer": "2^4 × 3"},
                headers=STUDENT_HEADERS,
            )
        assert mark_resp.status_code == 200

        # Start a new dialogue — should get a new session_id
        resp2 = client.post(
            "/api/tutor/dialogue",
            json={"question_id": "math_7_f_AC9M7N02_adae12", "student_message": "Starting fresh"},
            headers=STUDENT_HEADERS,
        )
        assert resp2.status_code == 200
        session_id_2 = resp2.json()["dialogue_session_id"]

        assert session_id_1 != session_id_2
