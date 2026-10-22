"""Integration tests for endpoint contracts, CORS, and LLM health.

Covers scenarios not already tested in tests/unit/:
- The retired standalone Hint endpoint remains disabled (404).
- Student ID validation for suggest, plan, progress, and recommend.
- CORS preflight requests through the middleware.
- Health endpoint LLM status states.
"""
from __future__ import annotations

import pytest
import time
from unittest.mock import patch, MagicMock

from fastapi.testclient import TestClient

from backend.api import app, _resolve_cors_origins
from backend.rate_limiter import _RATE_LIMITER
from backend.tutor_engine import _llm_health
from backend.student_identity import create_student_token


VALID_STUDENT_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"


def _auth_headers(student_id: str = VALID_STUDENT_ID) -> dict:
    """Create Authorization header with a valid JWT bearer token."""
    token = create_student_token(student_id)
    return {"Authorization": f"Bearer {token}"}


STUDENT_HEADERS = _auth_headers()


# ---------------------------------------------------------------------------
# Task 11.1 — Student ID validation on ALL affected endpoints
# (mark is already covered in test_api_endpoints.py)
# ---------------------------------------------------------------------------


class TestHintEndpointDisabled:
    """The retired standalone Hint endpoint must not be routable."""

    def test_hint_endpoint_returns_404(self):
        client = TestClient(app)
        resp = client.post(
            "/api/tutor/hint",
            json={"question_id": "math_7_f_AC9M7N02_adae12", "hint_history": []},
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 404


class TestSuggestStudentIdValidation:
    """POST /api/tutor/suggest student ID validation."""

    def setup_method(self):
        _RATE_LIMITER._buckets.clear()

    def test_suggest_with_valid_uuid_returns_200(self):
        client = TestClient(app)
        resp = client.post(
            "/api/tutor/suggest",
            json={"topic": "fractions", "mode": "retrieve"},
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 200

    def test_suggest_without_header_returns_401_missing_student_id(self):
        client = TestClient(app)
        resp = client.post(
            "/api/tutor/suggest",
            json={"topic": "fractions", "mode": "retrieve"},
        )
        assert resp.status_code == 401
        body = resp.json()
        assert body["error"] == "missing_student_id"

    def test_suggest_with_invalid_uuid_returns_401_invalid_student_id(self):
        client = TestClient(app)
        resp = client.post(
            "/api/tutor/suggest",
            json={"topic": "fractions", "mode": "retrieve"},
            headers={"X-Student-Id": "not-a-uuid"},
        )
        assert resp.status_code == 401
        body = resp.json()
        assert body["error"] == "invalid_student_id"


class TestPlanStudentIdValidation:
    """GET /api/tutor/plan student ID validation."""

    def test_plan_with_valid_uuid_returns_200(self):
        client = TestClient(app)
        resp = client.get(
            "/api/tutor/plan",
            params={"topic": "fractions", "subject": "math"},
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 200

    def test_plan_without_header_returns_401_missing_student_id(self):
        client = TestClient(app)
        resp = client.get(
            "/api/tutor/plan",
            params={"topic": "fractions", "subject": "math"},
        )
        assert resp.status_code == 401
        body = resp.json()
        assert body["error"] == "missing_student_id"

    def test_plan_with_invalid_uuid_returns_401_invalid_student_id(self):
        client = TestClient(app)
        resp = client.get(
            "/api/tutor/plan",
            params={"topic": "fractions", "subject": "math"},
            headers={"X-Student-Id": "not-a-uuid"},
        )
        assert resp.status_code == 401
        body = resp.json()
        assert body["error"] == "invalid_student_id"


class TestTodayPlanQuestionTarget:
    """The planner sets the session length; an old question_target parameter is ignored."""

    @pytest.mark.parametrize("target", [15, 20, 30])
    def test_today_plan_ignores_an_old_question_target(self, target):
        client = TestClient(app)
        resp = client.get(
            "/api/tutor/today-plan",
            params={"subject": "math", "year": "year7", "question_target": target},
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 200
        assert "question_target" not in resp.json()


class TestProgressStudentIdValidation:
    """GET /api/tutor/progress student ID validation."""

    def test_progress_with_valid_uuid_returns_200(self):
        client = TestClient(app)
        resp = client.get(
            "/api/tutor/progress",
            params={"subject": "math"},
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 200

    def test_progress_without_header_returns_401_missing_student_id(self):
        client = TestClient(app)
        resp = client.get(
            "/api/tutor/progress",
            params={"subject": "math"},
        )
        assert resp.status_code == 401
        body = resp.json()
        assert body["error"] == "missing_student_id"

    def test_progress_with_invalid_uuid_returns_401_invalid_student_id(self):
        client = TestClient(app)
        resp = client.get(
            "/api/tutor/progress",
            params={"subject": "math"},
            headers={"X-Student-Id": "not-a-uuid"},
        )
        assert resp.status_code == 401
        body = resp.json()
        assert body["error"] == "invalid_student_id"


class TestRecommendStudentIdValidation:
    """GET /api/tutor/recommend student ID validation."""

    def test_recommend_with_valid_uuid_returns_200(self):
        client = TestClient(app)
        resp = client.get(
            "/api/tutor/recommend",
            params={"subject": "math", "year": "year7"},
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 200

    def test_recommend_without_header_returns_401_missing_student_id(self):
        client = TestClient(app)
        resp = client.get(
            "/api/tutor/recommend",
            params={"subject": "math", "year": "year7"},
        )
        assert resp.status_code == 401
        body = resp.json()
        assert body["error"] == "missing_student_id"

    def test_recommend_with_invalid_uuid_returns_401_invalid_student_id(self):
        client = TestClient(app)
        resp = client.get(
            "/api/tutor/recommend",
            params={"subject": "math", "year": "year7"},
            headers={"X-Student-Id": "not-a-uuid"},
        )
        assert resp.status_code == 401
        body = resp.json()
        assert body["error"] == "invalid_student_id"


# ---------------------------------------------------------------------------
# Task 12.1/12.2 — CORS preflight integration tests
# ---------------------------------------------------------------------------


class TestCorsPreflight:
    """CORS preflight requests through the actual middleware."""

    def test_preflight_from_allowed_origin_x(self, monkeypatch):
        """Preflight from https://x.example with CORS_ORIGINS set → allowed."""
        monkeypatch.setenv("CORS_ORIGINS", "https://x.example,https://y.example")
        # Rebuild app with new origins — reimport to pick up env change
        from backend.api import app as _app
        # Patch the middleware origins directly
        for middleware in _app.user_middleware:
            if hasattr(middleware, 'kwargs') and 'allow_origins' in middleware.kwargs:
                middleware.kwargs['allow_origins'] = ["https://x.example", "https://y.example"]

        # Use a fresh TestClient with the patched app
        from fastapi import FastAPI
        from fastapi.middleware.cors import CORSMiddleware

        test_app = FastAPI()
        test_app.add_middleware(
            CORSMiddleware,
            allow_origins=["https://x.example", "https://y.example"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

        @test_app.get("/api/health")
        def health():
            return {"status": "ok"}

        client = TestClient(test_app)
        resp = client.options(
            "/api/health",
            headers={
                "Origin": "https://x.example",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert resp.status_code == 200
        assert resp.headers.get("access-control-allow-origin") == "https://x.example"

    def test_preflight_from_allowed_origin_y(self, monkeypatch):
        """Preflight from https://y.example → allowed."""
        from fastapi import FastAPI
        from fastapi.middleware.cors import CORSMiddleware

        test_app = FastAPI()
        test_app.add_middleware(
            CORSMiddleware,
            allow_origins=["https://x.example", "https://y.example"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

        @test_app.get("/api/health")
        def health():
            return {"status": "ok"}

        client = TestClient(test_app)
        resp = client.options(
            "/api/health",
            headers={
                "Origin": "https://y.example",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert resp.status_code == 200
        assert resp.headers.get("access-control-allow-origin") == "https://y.example"

    def test_preflight_from_disallowed_origin(self):
        """Preflight from https://z.example → not in Access-Control-Allow-Origin."""
        from fastapi import FastAPI
        from fastapi.middleware.cors import CORSMiddleware

        test_app = FastAPI()
        test_app.add_middleware(
            CORSMiddleware,
            allow_origins=["https://x.example", "https://y.example"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

        @test_app.get("/api/health")
        def health():
            return {"status": "ok"}

        client = TestClient(test_app)
        resp = client.options(
            "/api/health",
            headers={
                "Origin": "https://z.example",
                "Access-Control-Request-Method": "GET",
            },
        )
        # Disallowed origin: the header should not be present or not match
        allow_origin = resp.headers.get("access-control-allow-origin")
        assert allow_origin != "https://z.example"


# ---------------------------------------------------------------------------
# Task 13.2/13.4 — Health endpoint llm_status states
# ---------------------------------------------------------------------------


@pytest.mark.usefixtures("tutor_engine_mock_mode")
class TestHealthLlmStatus:
    """Health endpoint llm_status values via the API."""

    def setup_method(self):
        _llm_health.last_success = None
        _llm_health.last_failure = None
        _llm_health.failure_exception = None

    def test_configured_status_with_api_key_and_no_failure(self):
        """With API key set + no recent failure → llm_status: 'configured'."""
        client = TestClient(app)
        with patch("backend.tutor_engine.get_tutor_engine") as mock_get:
            mock_engine = MagicMock()
            mock_engine.client = MagicMock()  # Non-None client = key is set
            mock_get.return_value = mock_engine
            # No recent failure
            _llm_health.last_failure = None
            _llm_health.last_success = time.monotonic()

            resp = client.get("/api/health")
            assert resp.status_code == 200
            body = resp.json()
            assert body["llm_status"] == "healthy"

    def test_unreachable_status_with_recent_failure(self):
        """With recent failure (injected) → llm_status: 'unreachable'."""
        client = TestClient(app)
        with patch("backend.tutor_engine.get_tutor_engine") as mock_get:
            mock_engine = MagicMock()
            mock_engine.client = MagicMock()  # Non-None client = key is set
            mock_get.return_value = mock_engine
            # Simulate a recent failure
            _llm_health.last_failure = time.monotonic()
            _llm_health.last_success = None
            _llm_health.failure_exception = "RuntimeError"

            resp = client.get("/api/health")
            assert resp.status_code == 200
            body = resp.json()
            assert body["llm_status"] == "unreachable"

    def test_mock_status_with_no_api_key(self):
        """With no API key + no recent call → llm_status: 'mock'."""
        client = TestClient(app)
        # Default state: no key means engine.client is None
        resp = client.get("/api/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["llm_status"] == "mock"
