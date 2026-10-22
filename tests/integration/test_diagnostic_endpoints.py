"""Integration tests for diagnostic endpoints (Task 12.1).

Tests the full adaptive flow + cooldown + dismiss via the FastAPI test client.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from backend.api import app
from backend.rules import get_engine
from backend.student_identity import create_student_token


@pytest.fixture
def client(tmp_data_dir, tutor_engine_mock_mode):
    """FastAPI test client with isolated data directory."""
    # Reset diagnostic engine singleton
    import backend.diagnostic_engine as de
    de._diagnostic_engine = None
    yield TestClient(app)
    de._diagnostic_engine = None


def _auth_headers(student_id: str) -> dict:
    """Create Authorization header with a valid JWT bearer token."""
    token = create_student_token(student_id)
    return {"Authorization": f"Bearer {token}"}


STUDENT_HEADERS = _auth_headers("00000000-0000-4000-8000-000000000001")


class TestDiagnosticStartEndpoint:
    """Tests for POST /api/diagnostic/start."""

    def test_start_returns_first_question(self, client):
        """Starting a diagnostic returns a question and report_id."""
        resp = client.post(
            "/api/diagnostic/start",
            json={"subject": "math", "year_level": 7},
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "report_id" in data
        assert "question" in data
        assert "progress" in data

    def test_start_requires_student_id(self, client):
        """Starting without X-Student-Id returns 400."""
        resp = client.post(
            "/api/diagnostic/start",
            json={"subject": "math", "year_level": 7},
        )
        assert resp.status_code == 401

    def test_start_cooldown_409(self, client, tmp_data_dir):
        """Starting within 45-day cooldown returns 409."""
        student_id = "00000000-0000-4000-8000-000000000002"
        engine = get_engine(student_id, "math")
        now = datetime.now(timezone.utc)
        recent = (now - timedelta(days=30)).isoformat()
        log = engine.load_log()
        log["diagnostic_status"] = {
            "math::7": {
                "report_id": "old",
                "completed_at": recent,
                "first_interaction_at": recent,
                "diagnostic_dismissed_at": None,
            }
        }
        log["diagnostic_reports"] = [{
            "report_id": "old",
            "subject": "math",
            "year_level": 7,
            "started_at": recent,
            "completed_at": recent,
            "pack": [],
            "cursor": 0,
            "responses": [],
            "derived_bkt": {},
        }]
        engine.save_log(log)

        resp = client.post(
            "/api/diagnostic/start",
            json={"subject": "math", "year_level": 7},
            headers=_auth_headers(student_id),
        )
        assert resp.status_code == 409
        assert resp.json()["error"] == "diagnostic_too_recent"

    def test_start_extra_fields_rejected(self, client):
        """Extra fields in request body are rejected (extra='forbid')."""
        resp = client.post(
            "/api/diagnostic/start",
            json={"subject": "math", "year_level": 7, "extra_field": "bad"},
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 422


class TestDiagnosticRespondEndpoint:
    """Tests for POST /api/diagnostic/respond."""

    def test_respond_advances_progress(self, client):
        """Responding advances the diagnostic progress."""
        # Start
        start_resp = client.post(
            "/api/diagnostic/start",
            json={"subject": "math", "year_level": 7},
            headers=STUDENT_HEADERS,
        )
        data = start_resp.json()
        report_id = data["report_id"]
        question_id = data["question"]["id"]

        # Respond
        resp = client.post(
            "/api/diagnostic/respond",
            json={
                "report_id": report_id,
                "question_id": question_id,
                "student_answer": "2^4 × 3",
            },
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 200

    def test_respond_finalised_409(self, client, tmp_data_dir):
        """Responding to a finalised report returns 409."""
        student_id = "00000000-0000-4000-8000-000000000003"
        engine = get_engine(student_id, "math")
        log = engine.load_log()
        log["diagnostic_reports"] = [{
            "report_id": "done",
            "subject": "math",
            "year_level": 7,
            "started_at": "2026-01-01T00:00:00+00:00",
            "completed_at": "2026-01-01T01:00:00+00:00",
            "pack": ["math_7_f_AC9M7N02_adae12"],
            "cursor": 1,
            "responses": [],
            "derived_bkt": {},
        }]
        log["diagnostic_status"] = {
            "math::7": {
                "report_id": "done",
                "completed_at": "2026-01-01T01:00:00+00:00",
                "first_interaction_at": "2026-01-01T00:00:00+00:00",
                "diagnostic_dismissed_at": None,
            }
        }
        engine.save_log(log)

        resp = client.post(
            "/api/diagnostic/respond",
            json={
                "report_id": "done",
                "question_id": "math_7_f_AC9M7N02_adae12",
                "student_answer": "test",
            },
            headers=_auth_headers(student_id),
        )
        assert resp.status_code == 409
        assert resp.json()["error"] == "diagnostic_already_finalised"


class TestDiagnosticStatusEndpoint:
    """Tests for GET /api/diagnostic/status."""

    def test_status_no_diagnostic(self, client):
        """Status returns not completed when no diagnostic exists."""
        resp = client.get(
            "/api/diagnostic/status?subject=math&year_level=7",
            headers=_auth_headers("00000000-0000-4000-8000-000000000004"),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["completed"] is False

    def test_status_completed_reports_areas_for_legacy_reports(self, client, tmp_data_dir):
        """A report finished before area placement still reloads with area results."""
        student_id = "00000000-0000-4000-8000-000000000006"
        engine = get_engine(student_id, "math")
        completed_at = "2026-01-01T01:00:00+00:00"
        log = engine.load_log()
        log["diagnostic_reports"] = [{
            "report_id": "done-with-bkt",
            "subject": "math",
            "year_level": 7,
            "started_at": "2026-01-01T00:00:00+00:00",
            "completed_at": completed_at,
            "pack": ["math_7_f_AC9M7N02_adae12"],
            "cursor": 1,
            "responses": [{
                "question_id": "math_7_f_AC9M7N02_adae12",
                "topic_id": "AC9M7N02",
                "is_correct": True,
                "student_answer": "48",
                "error_type": None,
                "timestamp": completed_at,
            }],
            "derived_bkt": {"AC9M7N02": 0.82},
        }]
        log["diagnostic_status"] = {
            "math::7": {
                "report_id": "done-with-bkt",
                "completed_at": completed_at,
                "first_interaction_at": "2026-01-01T00:00:00+00:00",
                "diagnostic_dismissed_at": None,
            }
        }
        engine.save_log(log)

        resp = client.get(
            "/api/diagnostic/status?subject=math&year_level=7",
            headers=_auth_headers(student_id),
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["completed"] is True
        assert data["report_id"] == "done-with-bkt"
        assert data["areas"]["Number"]["questions"] == 1
        assert data["areas"]["Number"]["correct"] == 1
        assert "derived_bkt" not in data
        assert data["responses_count"] == 1
        assert data["current"] == 1
        assert data["total"] == 1

    def test_status_requires_student_id(self, client):
        """Status without X-Student-Id returns 400."""
        resp = client.get("/api/diagnostic/status?subject=math&year_level=7")
        assert resp.status_code == 401


class TestDiagnosticDismissEndpoint:
    """Tests for POST /api/diagnostic/dismiss."""

    def test_dismiss_succeeds(self, client):
        """Dismissing returns success."""
        resp = client.post(
            "/api/diagnostic/dismiss",
            json={"subject": "math", "year_level": 7},
            headers=_auth_headers("00000000-0000-4000-8000-000000000005"),
        )
        assert resp.status_code == 200
        assert resp.json()["dismissed"] is True

    def test_dismiss_requires_student_id(self, client):
        """Dismiss without X-Student-Id returns 400."""
        resp = client.post(
            "/api/diagnostic/dismiss",
            json={"subject": "math", "year_level": 7},
        )
        assert resp.status_code == 401

def test_diagnostic_scope_validation_rejects_path_subject_and_out_of_range_year(client):
    headers = _auth_headers("00000000-0000-4000-8000-000000000009")
    status = client.get(
        "/api/diagnostic/status",
        params={"subject": "../outside/math", "year_level": 7},
        headers=headers,
    )
    start = client.post(
        "/api/diagnostic/start",
        json={"subject": "math", "year_level": 11},
        headers=headers,
    )
    dismiss = client.post(
        "/api/diagnostic/dismiss",
        json={"subject": "chemistry", "year_level": 7},
        headers=headers,
    )

    assert status.status_code == 422
    assert start.status_code == 422
    assert dismiss.status_code == 422
