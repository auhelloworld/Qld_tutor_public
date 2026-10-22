"""Integration tests for previously untested tutor endpoints.

Covers:
- POST /api/tutor/explain
- GET /api/tutor/plan
- GET /api/tutor/calibrate-bkt
- GET /api/tutor/recommend
- GET /api/tutor/mistakes
- GET /api/tutor/daily-summary
- POST /api/tutor/set-daily-goal
- GET /api/tutor/worked-example
- GET /api/tutor/lesson-content
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from backend.api import app
from backend.rules import get_engine
from backend.student_identity import create_student_token


VALID_STUDENT_ID = "00000000-0000-4000-8000-000000000000"


def _auth_headers(student_id: str = VALID_STUDENT_ID) -> dict:
    """Create Authorization header with a valid JWT bearer token."""
    token = create_student_token(student_id)
    return {"Authorization": f"Bearer {token}"}


# Alias for tests that check missing auth
STUDENT_HEADERS = _auth_headers()

# A known AC9 topic ID present in the curriculum data
KNOWN_TOPIC_ID = "AC9M7N02"


def _bearer_headers(student_id: str) -> dict:
    token = create_student_token(student_id)
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# POST /api/tutor/explain
# ---------------------------------------------------------------------------


class TestTutorExplain:
    """POST /api/tutor/explain — concept explanation (no student_id required)."""

    def test_explain_known_topic(self, tmp_data_dir):
        client = TestClient(app)
        resp = client.post(
            "/api/tutor/explain",
            json={"concept_id": KNOWN_TOPIC_ID},
        )
        assert resp.status_code == 200
        body = resp.json()
        # Should return either lesson_content or an explanation
        assert "explanation" in body or "has_lesson_content" in body or "resolved" in body

    def test_explain_unknown_topic_returns_not_found_shape(self, tmp_data_dir):
        client = TestClient(app)
        resp = client.post(
            "/api/tutor/explain",
            json={"concept_id": "NONEXISTENT_TOPIC_999"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body.get("resolved") is False or "explanation" in body


# ---------------------------------------------------------------------------
# GET /api/tutor/plan
# ---------------------------------------------------------------------------


class TestTutorPlan:
    """GET /api/tutor/plan — study plan for a topic (requires auth)."""

    def test_plan_requires_auth(self):
        client = TestClient(app)
        resp = client.get("/api/tutor/plan", params={"topic": "fractions"})
        assert resp.status_code == 401
        assert resp.json()["error"] == "missing_student_id"

    def test_plan_no_data_returns_assessment(self, tmp_data_dir):
        client = TestClient(app)
        resp = client.get(
            "/api/tutor/plan",
            params={"topic": KNOWN_TOPIC_ID, "subject": "math"},
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "action" in body
        # With no prior data, should recommend an initial learning action
        assert body["action"] in ("assessment", "concept_reteach", "diagnostic")


# ---------------------------------------------------------------------------
# GET /api/tutor/calibrate-bkt
# ---------------------------------------------------------------------------


class TestCalibrateBkt:
    """GET /api/tutor/calibrate-bkt — BKT parameter calibration."""

    def test_calibrate_requires_auth(self):
        client = TestClient(app)
        resp = client.get("/api/tutor/calibrate-bkt")
        assert resp.status_code == 401

    def test_calibrate_with_no_data(self, tmp_data_dir):
        """No attempt history → returns empty or default result."""
        client = TestClient(app)
        resp = client.get(
            "/api/tutor/calibrate-bkt",
            params={"subject": "math"},
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 200
        body = resp.json()
        # Should return some result even with empty data
        assert isinstance(body, dict)


# ---------------------------------------------------------------------------
# GET /api/tutor/recommend
# ---------------------------------------------------------------------------


class TestTutorRecommend:
    """GET /api/tutor/recommend — recommend next topic."""

    def test_recommend_requires_auth(self):
        client = TestClient(app)
        resp = client.get("/api/tutor/recommend")
        assert resp.status_code == 401

    def test_recommend_returns_topic_or_diagnostic_prompt(self, tmp_data_dir):
        client = TestClient(app)
        resp = client.get(
            "/api/tutor/recommend",
            params={"subject": "math", "year": "year7"},
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "recommendation_type" in body
        assert body["recommendation_type"] in ("forward", "revision", "diagnostic_prompt")


# ---------------------------------------------------------------------------
# GET /api/tutor/mistakes
# ---------------------------------------------------------------------------


class TestTutorMistakes:
    """GET /api/tutor/mistakes — error book / mistakes list."""

    def test_mistakes_requires_auth(self):
        client = TestClient(app)
        resp = client.get("/api/tutor/mistakes")
        assert resp.status_code == 401

    def test_mistakes_empty_for_new_student(self, tmp_data_dir):
        client = TestClient(app)
        resp = client.get(
            "/api/tutor/mistakes",
            params={"subject": "math"},
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "mistakes" in body
        assert body["total"] == 0

    def test_mistakes_with_topic_filter(self, tmp_data_dir):
        client = TestClient(app)
        resp = client.get(
            "/api/tutor/mistakes",
            params={"subject": "math", "topic_id": KNOWN_TOPIC_ID},
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "mistakes" in body

    def test_mistakes_with_sort_mastery(self, tmp_data_dir):
        client = TestClient(app)
        resp = client.get(
            "/api/tutor/mistakes",
            params={"subject": "math", "sort": "mastery"},
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# GET /api/tutor/trap-notebook
# ---------------------------------------------------------------------------


class TestTrapNotebook:
    """GET /api/tutor/trap-notebook — formula and trap review cards."""

    def test_trap_notebook_requires_auth(self):
        client = TestClient(app)
        resp = client.get("/api/tutor/trap-notebook")
        assert resp.status_code == 401

    def test_trap_notebook_empty_for_new_student(self, tmp_data_dir):
        client = TestClient(app)
        resp = client.get(
            "/api/tutor/trap-notebook",
            params={"subject": "math"},
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["entries"] == []
        assert body["total"] == 0

    def test_repeated_mistake_creates_trap_card(self, tmp_data_dir):
        student_id = "11111111-1111-4111-8111-111111111111"
        qid = "math_7_f_AC9M7N02_adae12"
        engine = get_engine(student_id, "math")
        engine.save_log({
            "student_id": student_id,
            "topics": {
                KNOWN_TOPIC_ID: {
                    "accuracy": 0.0,
                    "attempts": [
                        {
                            "question_id": qid,
                            "correct": False,
                            "error_type": "fraction_error",
                            "timestamp": "2026-06-16T10:00:00+00:00",
                            "attempt_type": "answer",
                            "student_answer": "48 = 2 x 24",
                        },
                        {
                            "question_id": qid,
                            "correct": False,
                            "error_type": "fraction_error",
                            "timestamp": "2026-06-17T10:00:00+00:00",
                            "attempt_type": "answer",
                            "student_answer": "48 = 4 x 12",
                            "gap_classification": {
                                "is_classifiable": True,
                                "primary_error_code": "fraction_error",
                                "subtype_codes": ["no_common_denominator"],
                                "recommended_action": "Use prime factors until every factor is prime.",
                                "parent_summary": "The factor tree stopped before all factors were prime.",
                            },
                        },
                    ],
                    "revision": {
                        "next_review_at": "2026-06-18T10:00:00+00:00",
                    },
                },
            },
        })

        client = TestClient(app)
        resp = client.get(
            "/api/tutor/trap-notebook",
            params={"subject": "math"},
            headers=_bearer_headers(student_id),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        entry = body["entries"][0]
        assert entry["source"] == "repeated_mistake"
        assert entry["topic_id"] == KNOWN_TOPIC_ID
        assert entry["question_id"] == qid
        assert entry["attempt_count"] == 2
        assert "prime" in entry["personal_trap"].lower()
        assert entry["worked_example"]["steps"]
        assert entry["next_review_at"] == "2026-06-18T10:00:00+00:00"

    def test_spaced_revision_creates_formula_card(self, tmp_data_dir):
        student_id = "12121212-1212-4121-8121-121212121212"
        engine = get_engine(student_id, "math")
        engine.save_log({
            "student_id": student_id,
            "topics": {
                KNOWN_TOPIC_ID: {
                    "accuracy": 1.0,
                    "attempts": [],
                    "revision": {
                        "next_review_at": "2026-06-19T10:00:00+00:00",
                    },
                },
            },
        })

        client = TestClient(app)
        resp = client.get(
            "/api/tutor/trap-notebook",
            params={"subject": "math"},
            headers=_bearer_headers(student_id),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        entry = body["entries"][0]
        assert entry["source"] == "spaced_revision"
        assert entry["topic_id"] == KNOWN_TOPIC_ID
        assert entry["question_id"] is None
        assert entry["next_review_at"] == "2026-06-19T10:00:00+00:00"


# ---------------------------------------------------------------------------
# GET /api/tutor/daily-summary
# ---------------------------------------------------------------------------


class TestDailySummary:
    """GET /api/tutor/daily-summary — today's learning summary."""

    def test_daily_summary_requires_auth(self):
        client = TestClient(app)
        resp = client.get("/api/tutor/daily-summary")
        assert resp.status_code == 401

    def test_daily_summary_new_student(self, tmp_data_dir):
        client = TestClient(app)
        resp = client.get(
            "/api/tutor/daily-summary",
            params={"subject": "math"},
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["today_attempts"] == 0
        assert body["today_correct"] == 0
        assert body["streak_days"] == 0
        assert "daily_goal" in body
        assert "activity_dates" in body


# ---------------------------------------------------------------------------
# POST /api/tutor/set-daily-goal
# ---------------------------------------------------------------------------


class TestSetDailyGoal:
    """POST /api/tutor/set-daily-goal — update daily goal."""

    def test_set_goal_requires_auth(self):
        client = TestClient(app)
        resp = client.post("/api/tutor/set-daily-goal", json={"daily_goal": 5})
        assert resp.status_code == 401

    def test_set_goal_valid(self, tmp_data_dir):
        client = TestClient(app)
        resp = client.post(
            "/api/tutor/set-daily-goal",
            json={"daily_goal": 15, "subject": "math"},
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 200
        assert resp.json()["daily_goal"] == 15

    def test_set_goal_invalid_value(self, tmp_data_dir):
        client = TestClient(app)
        resp = client.post(
            "/api/tutor/set-daily-goal",
            json={"daily_goal": 0, "subject": "math"},
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 400
        assert resp.json()["error"] == "invalid_goal"

    def test_set_goal_too_high(self, tmp_data_dir):
        client = TestClient(app)
        resp = client.post(
            "/api/tutor/set-daily-goal",
            json={"daily_goal": 999, "subject": "math"},
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# GET /api/tutor/worked-example
# ---------------------------------------------------------------------------


class TestWorkedExample:
    """GET /api/tutor/worked-example — get worked example for a topic."""

    def test_worked_example_known_topic(self, tmp_data_dir):
        client = TestClient(app)
        resp = client.get(
            "/api/tutor/worked-example",
            params={"topic_id": KNOWN_TOPIC_ID},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["topic_id"] == KNOWN_TOPIC_ID
        assert "has_worked_example" in body

    def test_worked_example_unknown_topic_returns_404(self, tmp_data_dir):
        client = TestClient(app)
        resp = client.get(
            "/api/tutor/worked-example",
            params={"topic_id": "NONEXISTENT_TOPIC_999"},
        )
        assert resp.status_code == 404
        assert resp.json()["error"] == "topic_not_found"


# ---------------------------------------------------------------------------
# GET /api/tutor/lesson-content
# ---------------------------------------------------------------------------


class TestLessonContent:
    """GET /api/tutor/lesson-content — get structured lesson for a topic."""

    def test_lesson_content_known_topic(self, tmp_data_dir):
        client = TestClient(app)
        resp = client.get(
            "/api/tutor/lesson-content",
            params={"topic_id": KNOWN_TOPIC_ID},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["topic_id"] == KNOWN_TOPIC_ID
        assert "has_lesson_content" in body

    def test_lesson_content_unknown_topic_returns_404(self, tmp_data_dir):
        client = TestClient(app)
        resp = client.get(
            "/api/tutor/lesson-content",
            params={"topic_id": "NONEXISTENT_TOPIC_999"},
        )
        assert resp.status_code == 404
        assert resp.json()["error"] == "topic_not_found"
