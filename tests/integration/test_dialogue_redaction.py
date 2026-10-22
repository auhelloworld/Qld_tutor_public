"""Integration test: answer leak redacted in dialogue.

Task 16.3: A tutor message that would leak the answer is redacted before being returned.
"""
from __future__ import annotations

from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.api import app
from backend.rate_limiter import _RATE_LIMITER
from backend.student_identity import create_student_token


VALID_STUDENT_ID = "c1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
STUDENT_HEADERS = {"Authorization": f"Bearer {create_student_token(VALID_STUDENT_ID)}"}


class TestDialogueRedaction:
    """Tutor messages that leak the answer are redacted."""

    def setup_method(self):
        _RATE_LIMITER._buckets.clear()

    def test_answer_leak_is_redacted(self, tmp_data_dir):
        """When LLM response contains the answer, it gets redacted."""
        # math_7_f_AC9M7N02_adae12 has answer "$2^4 \times 3$" — we'll make the LLM "leak" it
        # Patch _converse to return a message containing the answer
        with patch("backend.dialogue_handler.DialogueHandler._converse") as mock_converse:
            mock_converse.return_value = (
                "The answer is $2^4 \\times 3$, just do prime factorization.",
                False,
                False,
            )
            client = TestClient(app)
            resp = client.post(
                "/api/tutor/dialogue",
                json={"question_id": "math_7_f_AC9M7N02_adae12", "student_message": "what is the answer?"},
                headers=STUDENT_HEADERS,
            )

        assert resp.status_code == 200
        body = resp.json()
        # The answer should be redacted from the tutor_message
        assert body["redaction_applied"] is True
        assert "$2^4" not in body["tutor_message"]
