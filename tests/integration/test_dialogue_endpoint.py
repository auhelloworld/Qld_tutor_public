"""Integration tests for POST /api/tutor/dialogue endpoint.

Covers Task 16.1:
- 200 with valid body
- 401 missing_student_id / invalid_student_id
- 400 student_message_too_long for >1000 chars
- 422 invalid_request_body for missing field
- 429 rate_limited after 60 calls in 60s
- 429 dialogue_session_cap_reached after 30 turns same session
"""
from __future__ import annotations

from fastapi.testclient import TestClient
import pytest

from backend.api import app
from backend.rate_limiter import _RATE_LIMITER
from backend.student_identity import create_student_token


VALID_STUDENT_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"


def _auth_headers(student_id: str = VALID_STUDENT_ID) -> dict:
    token = create_student_token(student_id)
    return {"Authorization": f"Bearer {token}"}


STUDENT_HEADERS = _auth_headers()


class TestDialogueEndpointValidation:
    """POST /api/tutor/dialogue validation and error responses."""

    def setup_method(self):
        _RATE_LIMITER._buckets.clear()

    def test_valid_request_returns_200(self, tmp_data_dir):
        """Valid body + student ID → 200 with expected response shape."""
        client = TestClient(app)
        resp = client.post(
            "/api/tutor/dialogue",
            json={"question_id": "math_7_f_AC9M7N02_adae12", "student_message": "I'm stuck on this"},
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "tutor_message" in body
        assert "suggested_actions" in body
        assert "dialogue_session_id" in body
        assert isinstance(body["suggested_actions"], list)
        assert len(body["suggested_actions"]) >= 1

    def test_missing_student_id_returns_400(self):
        """No X-Student-Id header → 401 missing_student_id."""
        client = TestClient(app)
        resp = client.post(
            "/api/tutor/dialogue",
            json={"question_id": "math_7_f_AC9M7N02_adae12", "student_message": "hello"},
        )
        assert resp.status_code == 401
        body = resp.json()
        assert body["error"] == "missing_student_id"

    def test_invalid_student_id_returns_400(self):
        """Invalid UUID in X-Student-Id → 401 invalid_student_id."""
        client = TestClient(app)
        resp = client.post(
            "/api/tutor/dialogue",
            json={"question_id": "math_7_f_AC9M7N02_adae12", "student_message": "hello"},
            headers={"X-Student-Id": "not-a-valid-uuid"},
        )
        assert resp.status_code == 401
        body = resp.json()
        assert body["error"] == "invalid_student_id"

    def test_student_message_too_long_returns_400(self):
        """student_message > 1000 chars → 400 student_message_too_long."""
        client = TestClient(app)
        resp = client.post(
            "/api/tutor/dialogue",
            json={"question_id": "math_7_f_AC9M7N02_adae12", "student_message": "x" * 1001},
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 400
        body = resp.json()
        assert body["error"] == "student_message_too_long"

    def test_missing_field_returns_422(self):
        """Missing required field → 422 invalid_request_body."""
        client = TestClient(app)
        resp = client.post(
            "/api/tutor/dialogue",
            json={"question_id": "math_7_f_AC9M7N02_adae12"},  # missing student_message
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 422
        body = resp.json()
        assert body["error"] == "invalid_request_body"

    def test_empty_body_returns_422(self):
        """Empty JSON body → 422 invalid_request_body."""
        client = TestClient(app)
        resp = client.post(
            "/api/tutor/dialogue",
            json={},
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 422
        body = resp.json()
        assert body["error"] == "invalid_request_body"

    def test_nonexistent_question_returns_200_with_change_topic(self, tmp_data_dir):
        """Unknown question_id → 200 with change_topic suggestion."""
        client = TestClient(app)
        resp = client.post(
            "/api/tutor/dialogue",
            json={"question_id": "nonexistent_q_999", "student_message": "hello"},
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "change_topic" in body["suggested_actions"]


class TestDialogueRateLimit:
    """Rate limiting on the dialogue endpoint."""

    def setup_method(self):
        _RATE_LIMITER._buckets.clear()

    def test_rate_limited_after_60_calls(self, tmp_data_dir):
        """After 60 calls in 60s → 429 rate_limited."""
        client = TestClient(app)
        # Use a nonexistent question_id to avoid session cap issues
        # (nonexistent questions return 200 with change_topic, no session accumulation)
        for i in range(60):
            resp = client.post(
                "/api/tutor/dialogue",
                json={"question_id": f"nonexistent_q_{i}", "student_message": f"msg {i}"},
                headers=STUDENT_HEADERS,
            )
            # Should be 200 for the first 60 (nonexistent question returns 200 with change_topic)
            assert resp.status_code == 200, f"Request {i+1} failed with {resp.status_code}: {resp.json()}"

        # 61st request should be rate limited
        resp = client.post(
            "/api/tutor/dialogue",
            json={"question_id": "nonexistent_q_61", "student_message": "one more"},
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 429
        body = resp.json()
        assert body["error"] == "rate_limited"


class TestDialogueSessionCap:
    """Turn cap enforcement on the dialogue endpoint."""

    def setup_method(self):
        _RATE_LIMITER._buckets.clear()

    @pytest.mark.parametrize("with_request_id", [False, True], ids=["no_request_id", "request_id"])
    def test_cap_reached_after_30_turns(self, tmp_data_dir, with_request_id):
        """After 30 non-system turns in same session → 429 dialogue_session_cap_reached.

        Both the plain path and the request_id replay path must map the cap to 429.
        """
        # Use a unique student ID to avoid pollution from other tests
        cap_student_id = "d1d2d3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
        cap_headers = _auth_headers(cap_student_id)
        client = TestClient(app)

        def body(message: str, call: int) -> dict:
            payload = {"question_id": "math_7_f_AC9M7N02_adae12", "student_message": message}
            if with_request_id:
                payload["request_id"] = f"cap-test-{call}"
            return payload

        # Each dialogue call appends 2 records (student + tutor), so 15 calls = 30 records
        # The 15th call reads 28 records (from 14 prior calls), proceeds, writes 2 more = 30
        # The 16th call reads 30 records and hits the cap
        for i in range(15):
            resp = client.post(
                "/api/tutor/dialogue",
                json=body(f"turn {i}", i),
                headers=cap_headers,
            )
            assert resp.status_code == 200, f"Turn {i+1} failed: {resp.json()}"

        # 16th call should hit the cap (30 records already exist)
        resp = client.post(
            "/api/tutor/dialogue",
            json=body("one more", 15),
            headers=cap_headers,
        )
        assert resp.status_code == 429
        body = resp.json()
        assert body["error"] == "dialogue_session_cap_reached"
