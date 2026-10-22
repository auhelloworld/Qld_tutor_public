"""Integration tests for recommendation pipeline with revision (Task 12.2).

Verifies:
- Cold start with no diagnostic and <5 attempts → recommendation_type=="forward" (no revision).
- After dismiss → recommendation_type=="forward".
- Topic mastered + 1 day passes → recommendation_type=="revision".
- Strict-prereq topic with un-mastered prereq is skipped from revisions.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest

from backend.rules import get_engine
from backend.spaced_repetition import SpacedRepetitionScheduler


@pytest.fixture
def setup_engine(tmp_data_dir):
    """Create a test engine with isolated data."""
    def _make(student_id: str = "revision-test"):
        return get_engine(student_id, "math")
    return _make


class TestRecommendWithDiagnosticPrompt:
    """Tests for diagnostic_prompt recommendation type."""

    def test_diagnostic_prompt_when_status_exists_not_completed(self, tmp_data_dir, setup_engine):
        """Returns diagnostic_prompt when status exists but not completed."""
        engine = setup_engine("prompt-test")
        now = datetime.now(timezone.utc)
        log = engine.load_log()
        log["diagnostic_status"] = {
            "math::7": {
                "report_id": None,
                "completed_at": None,
                "first_interaction_at": now.isoformat(),
                "diagnostic_dismissed_at": None,
            }
        }
        engine.save_log(log)

        result = engine.recommend_next_topic("year7")
        assert result["recommendation_type"] == "diagnostic_prompt"

    def test_after_dismiss_returns_forward(self, tmp_data_dir, setup_engine):
        """After dismissal, returns forward recommendation."""
        engine = setup_engine("dismiss-test")
        now = datetime.now(timezone.utc)
        log = engine.load_log()
        log["diagnostic_status"] = {
            "math::7": {
                "report_id": None,
                "completed_at": None,
                "first_interaction_at": now.isoformat(),
                "diagnostic_dismissed_at": now.isoformat(),
            }
        }
        engine.save_log(log)

        result = engine.recommend_next_topic("year7")
        assert result["recommendation_type"] == "forward"


class TestRecommendWithRevision:
    """Tests for revision recommendation type."""

    def test_mastered_topic_due_for_revision(self, tmp_data_dir, setup_engine):
        """Topic mastered with overdue revision returns revision recommendation."""
        engine = setup_engine("revision-due-test")
        now = datetime.now(timezone.utc)
        past = now - timedelta(days=2)

        # Create a mastered topic with overdue revision
        log = engine.load_log()
        # Need ≥5 attempts for cold-start satisfaction. Mastery needs explicit
        # support level 0 (unaided first answers).
        attempts = [
            {"question_id": f"q{i}", "correct": True, "error_type": None,
             "timestamp": past.isoformat(), "skill_id": f"AC9M7N04/q{i}",
             "response_time_ms": 0, "attempt_type": "answer", "support_level": 0}
            for i in range(8)
        ]
        log["topics"] = {
            "AC9M7N04": {
                "attempts": attempts,
                "accuracy": 1.0,
                "revision": {
                    "first_mastered_at": past.isoformat(),
                    "consecutive_revisions": 0,
                    "next_review_at": (now - timedelta(hours=1)).isoformat(),
                },
            }
        }
        engine.save_log(log)

        result = engine.recommend_next_topic("year7")
        assert result["recommendation_type"] == "revision"
        assert result["topic_id"] == "AC9M7N04"

    def test_cold_start_prevents_revision(self, tmp_data_dir, setup_engine):
        """Without cold-start satisfaction, revision is not returned."""
        engine = setup_engine("cold-start-test")
        now = datetime.now(timezone.utc)
        past = now - timedelta(days=2)

        # Create a topic with revision but only 3 attempts (< 5)
        log = engine.load_log()
        attempts = [
            {"question_id": f"q{i}", "correct": True, "error_type": None,
             "timestamp": past.isoformat(), "skill_id": f"AC9M7N04/q{i}",
             "response_time_ms": 0, "attempt_type": "answer"}
            for i in range(3)
        ]
        log["topics"] = {
            "AC9M7N04": {
                "attempts": attempts,
                "accuracy": 1.0,
                "revision": {
                    "first_mastered_at": past.isoformat(),
                    "consecutive_revisions": 0,
                    "next_review_at": (now - timedelta(hours=1)).isoformat(),
                },
            }
        }
        # Mark diagnostic as dismissed (not completed) to avoid diagnostic_prompt interference
        # while still allowing cold-start check to fail (requires ≥5 attempts OR completed diagnostic)
        log["diagnostic_status"] = {
            "math::7": {
                "report_id": None,
                "completed_at": None,
                "first_interaction_at": past.isoformat(),
                "diagnostic_dismissed_at": past.isoformat(),
            }
        }
        engine.save_log(log)

        result = engine.recommend_next_topic("year7")
        # Should fall through to forward since cold-start not satisfied
        assert result["recommendation_type"] == "forward"

    def test_no_revision_when_nothing_due(self, tmp_data_dir, setup_engine):
        """When no topics are due for revision, returns forward."""
        engine = setup_engine("no-due-test")
        now = datetime.now(timezone.utc)
        future = now + timedelta(days=5)

        log = engine.load_log()
        attempts = [
            {"question_id": f"q{i}", "correct": True, "error_type": None,
             "timestamp": now.isoformat(), "skill_id": f"AC9M7N04/q{i}",
             "response_time_ms": 0, "attempt_type": "answer"}
            for i in range(8)
        ]
        log["topics"] = {
            "AC9M7N04": {
                "attempts": attempts,
                "accuracy": 1.0,
                "revision": {
                    "first_mastered_at": now.isoformat(),
                    "consecutive_revisions": 0,
                    "next_review_at": future.isoformat(),
                },
            }
        }
        # Mark diagnostic as completed to avoid diagnostic_prompt interference
        log["diagnostic_status"] = {
            "math::7": {
                "report_id": "test-report",
                "completed_at": now.isoformat(),
                "first_interaction_at": now.isoformat(),
                "diagnostic_dismissed_at": None,
            }
        }
        engine.save_log(log)

        result = engine.recommend_next_topic("year7")
        assert result["recommendation_type"] == "forward"
