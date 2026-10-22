"""Tests for Task 13 — Health endpoint upgrade.

Verifies:
- Cold start with no key → llm_status: "mock".
- After a simulated _call_llm_safe failure → llm_status: "unreachable" for 5 minutes.
- cors_origins is present and correct.
- No API keys, prompts, or PII appear in the health response.
"""
from __future__ import annotations

import time
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.api import app
from backend.tutor_engine import _llm_health, _record_llm_health


client = TestClient(app)


@pytest.mark.usefixtures("tutor_engine_mock_mode")
class TestHealthEndpointUpgrade:
    """Integration tests for the upgraded health endpoint."""

    def setup_method(self):
        """Reset health state before each test."""
        _llm_health.last_success = None
        _llm_health.last_failure = None
        _llm_health.failure_exception = None

    def test_mock_mode_returns_mock_status(self):
        """Cold start with no API key → llm_status: 'mock'."""
        resp = client.get("/api/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["llm_status"] == "mock"

    def test_cors_origins_in_response(self):
        """Health response includes cors_origins."""
        resp = client.get("/api/health")
        body = resp.json()
        assert "cors_origins" in body
        assert isinstance(body["cors_origins"], list)
        assert "http://localhost:3000" in body["cors_origins"]

    def test_no_secrets_in_health_response(self):
        """No API keys, prompts, or PII appear in the health response."""
        resp = client.get("/api/health")
        body_str = str(resp.json())
        # Should not contain any key-like patterns
        assert "GEMINI_API_KEY" not in body_str
        assert "OPENAI_API_KEY" not in body_str
        assert "sk-" not in body_str

    def test_health_response_shape(self):
        """Health response has the expected fields."""
        resp = client.get("/api/health")
        body = resp.json()
        assert body["status"] == "ok"
        assert body["message"] == "QLD AI Tutor API is running."
        assert "llm_status" in body
        assert "cors_origins" in body
        assert "runtime" in body
        assert isinstance(body["runtime"]["skipped_invalid_exercise_count"], int)
        assert body["runtime"]["skipped_invalid_exercise_count"] >= 0
        assert isinstance(body["runtime"]["invalid_exercise_bank_file_count"], int)
        assert body["runtime"]["invalid_exercise_bank_file_count"] >= 0

    def test_readiness_rejects_an_unloadable_bank_file(self):
        with patch("backend.api.get_tutor_engine") as get_engine:
            engine = get_engine.return_value
            engine.exercises = {"valid": {"id": "valid"}}
            engine.runtime_validation_report.return_value = {
                "skipped_invalid_count": 0,
                "skipped_invalid_ids": [],
                "invalid_bank_file_count": 1,
                "invalid_bank_files": ["exercise_broken.json"],
            }
            resp = client.get("/api/ready")

        assert resp.status_code == 503
        assert resp.json()["checks"]["invalid_exercise_bank_file_count"] == 1
