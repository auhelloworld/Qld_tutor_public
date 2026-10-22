"""Tests for Task 10 — Rate limiter.

Verifies:
- 31st POST /api/tutor/mark for the same student in <60s → 429.
- Per-student and per-endpoint buckets are independent.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from backend.api import app
from backend.rate_limiter import _RateLimiter, _RATE_LIMITER
from backend.student_identity import create_student_token


client = TestClient(app)

VALID_STUDENT_A = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"


def _auth_headers(student_id: str) -> dict:
    token = create_student_token(student_id)
    return {"Authorization": f"Bearer {token}"}


class TestRateLimiterUnit:
    """Unit tests for the _RateLimiter class itself."""

    def test_admit_within_limit(self):
        limiter = _RateLimiter()
        for _ in range(5):
            assert limiter.admit("student1", "endpoint", 5) is True

    def test_deny_over_limit(self):
        limiter = _RateLimiter()
        for _ in range(5):
            limiter.admit("student1", "endpoint", 5)
        assert limiter.admit("student1", "endpoint", 5) is False

    def test_different_students_independent(self):
        limiter = _RateLimiter()
        for _ in range(5):
            limiter.admit("student1", "endpoint", 5)
        # student2 should still be admitted
        assert limiter.admit("student2", "endpoint", 5) is True

    def test_different_endpoints_independent(self):
        limiter = _RateLimiter()
        for _ in range(5):
            limiter.admit("student1", "endpoint_a", 5)
        # Same student, different endpoint should still be admitted
        assert limiter.admit("student1", "endpoint_b", 5) is True

    def test_retry_after_returns_positive_int(self):
        limiter = _RateLimiter()
        for _ in range(5):
            limiter.admit("student1", "endpoint", 5)
        retry = limiter.retry_after_seconds("student1", "endpoint")
        assert isinstance(retry, int)
        assert retry >= 1


class TestRateLimitIntegration:
    """Integration tests for rate limiting on API endpoints."""

    def setup_method(self):
        """Reset the global rate limiter buckets before each test."""
        _RATE_LIMITER._buckets.clear()

    def test_mark_rate_limit_at_31(self):
        """31st POST /api/tutor/mark for the same student → 429."""
        headers = _auth_headers(VALID_STUDENT_A)
        payload = {"question_id": "math_7_f_AC9M7N02_adae12", "student_answer": "2^4 × 3"}

        for _ in range(30):
            client.post("/api/tutor/mark", json=payload, headers=headers)

        resp = client.post("/api/tutor/mark", json=payload, headers=headers)
        assert resp.status_code == 429
        body = resp.json()
        assert body["error"] == "rate_limited"

    def test_suggest_rate_limit_at_121(self):
        """121st POST /api/tutor/suggest for the same student → 429."""
        headers = _auth_headers(VALID_STUDENT_A)
        payload = {"topic": "fractions", "mode": "retrieve"}

        for _ in range(120):
            client.post("/api/tutor/suggest", json=payload, headers=headers)

        resp = client.post("/api/tutor/suggest", json=payload, headers=headers)
        assert resp.status_code == 429
        body = resp.json()
        assert body["error"] == "rate_limited"
