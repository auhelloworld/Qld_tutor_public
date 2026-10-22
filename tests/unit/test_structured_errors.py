"""Tests for Task 14 — Structured error responses.

Verifies each documented error code:
- missing_student_id
- invalid_student_id
- student_answer_too_long
- rate_limited
- internal_error
And confirms 2xx responses are NOT wrapped.
"""
from __future__ import annotations

from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.api import app
from backend.rate_limiter import _RATE_LIMITER
from backend.student_identity import create_student_token


client = TestClient(app)

VALID_STUDENT_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
STUDENT_HEADERS = {"Authorization": f"Bearer {create_student_token(VALID_STUDENT_ID)}"}


class TestStructuredErrors:
    """Integration tests for structured error responses."""

    def setup_method(self):
        """Reset rate limiter between tests."""
        _RATE_LIMITER._buckets.clear()

    def test_missing_student_id_error(self):
        """POST without X-Student-Id → 401 missing_student_id."""
        resp = client.post("/api/tutor/mark", json={"question_id": "math_7_f_AC9M7N02_adae12", "student_answer": "2^4 × 3"})
        assert resp.status_code == 401
        body = resp.json()
        assert body["error"] == "missing_student_id"
        assert "message" in body
        assert "endpoint" in body

    def test_invalid_student_id_error(self):
        """POST with invalid UUID → 401 invalid_student_id."""
        resp = client.post(
            "/api/tutor/mark",
            json={"question_id": "math_7_f_AC9M7N02_adae12", "student_answer": "2^4 × 3"},
            headers={"X-Student-Id": "not-valid"},
        )
        assert resp.status_code == 401
        body = resp.json()
        assert body["error"] == "invalid_student_id"
        assert "message" in body
        assert "endpoint" in body

    def test_student_answer_too_long_error(self):
        """POST with answer > 1000 chars → 400 student_answer_too_long."""
        resp = client.post(
            "/api/tutor/mark",
            json={"question_id": "math_7_f_AC9M7N02_adae12", "student_answer": "x" * 1001},
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 400
        body = resp.json()
        assert body["error"] == "student_answer_too_long"
        assert "message" in body
        assert "endpoint" in body

    def test_rate_limited_error(self):
        """Exceeding rate limit → 429 rate_limited."""
        payload = {"question_id": "math_7_f_AC9M7N02_adae12", "student_answer": "2^4 × 3"}
        for _ in range(30):
            client.post("/api/tutor/mark", json=payload, headers=STUDENT_HEADERS)

        resp = client.post("/api/tutor/mark", json=payload, headers=STUDENT_HEADERS)
        assert resp.status_code == 429
        body = resp.json()
        assert body["error"] == "rate_limited"
        assert "message" in body
        assert "endpoint" in body
        assert "retry_after" in body

    def test_internal_error_handler(self):
        """Unhandled exception → 500 internal_error with no traceback."""
        # Use raise_server_exceptions=False so the catch-all handler runs
        test_client = TestClient(app, raise_server_exceptions=False)
        with patch("backend.tutor_engine.TutorEngine.mark") as mock_mark:
            mock_mark.side_effect = RuntimeError("Unexpected crash")
            resp = test_client.post(
                "/api/tutor/mark",
                json={"question_id": "math_7_f_AC9M7N02_adae12", "student_answer": "2^4 × 3"},
                headers=STUDENT_HEADERS,
            )
            assert resp.status_code == 500
            body = resp.json()
            assert body["error"] == "internal_error"
            assert body["message"] == "An unexpected error occurred."
            assert "endpoint" in body
            # No traceback in body
            assert "Traceback" not in str(body)
            assert "RuntimeError" not in str(body)

    def test_2xx_responses_not_wrapped(self):
        """Successful responses retain their existing shapes (not wrapped)."""
        # Health endpoint
        resp = client.get("/api/health")
        assert resp.status_code == 200
        body = resp.json()
        assert "status" in body
        assert "error" not in body

        # Mark endpoint (success)
        resp = client.post(
            "/api/tutor/mark",
            json={"question_id": "math_7_f_AC9M7N02_adae12", "student_answer": "2^4 × 3"},
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "is_correct" in body
        # Should NOT be wrapped in an envelope
        assert body.get("error") is None or "error_type" in body

    def test_detailed_validation_error(self):
        """POST with malformed request body -> 422 invalid_request_body with detailed field messages."""
        # 1. Test model-level validator (word count below limit)
        resp = client.post(
            "/api/tutor/writing/assess",
            json={
                "subject": "english",
                "year_level": 7,
                "prompt_type": "persuasive",
                "draft_text": "This is a test essay...",
                "topic_id": "naplan-p-2024"
            },
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 422
        body = resp.json()
        assert body["error"] == "invalid_request_body"
        assert "validation failed" in body["message"]
        assert "at least 50 words" in body["message"]

        # 2. Test field-level validator (invalid prompt_type value)
        resp2 = client.post(
            "/api/tutor/writing/assess",
            json={
                "subject": "english",
                "year_level": 7,
                "prompt_type": "invalid_type",
                "draft_text": "This is a test essay... " * 15,
                "topic_id": "naplan-p-2024"
            },
            headers=STUDENT_HEADERS,
        )
        assert resp2.status_code == 422
        body2 = resp2.json()
        assert body2["error"] == "invalid_request_body"
        assert "prompt_type" in body2["message"]
