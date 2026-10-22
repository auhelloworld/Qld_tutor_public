"""Unit tests for backend/dialogue_session.py — resolve_active_session.

Covers all four branches per Task 2:
- Empty log → new session
- Recent active session → reuse id
- System-closed last record → new session
- >30min inactive → new session
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from backend.dialogue_session import resolve_active_session, INACTIVITY_TIMEOUT


def _ts(dt: datetime) -> str:
    return dt.isoformat()


def _make_log(topic: str, attempts: list[dict]) -> dict:
    return {"topics": {topic: {"attempts": attempts, "accuracy": 0.0}}}


TOPIC = "fractions"
QID = "math_7_f_AC9M7N02_adae12"
SID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"


class TestResolveActiveSession:
    """resolve_active_session covers all four branches."""

    def test_empty_log_returns_new_session(self):
        """No prior dialogue records → new session."""
        log = {"topics": {}}
        sid, turns, is_new = resolve_active_session(log, TOPIC, QID)
        assert is_new is True
        assert turns == []
        assert len(sid) == 36  # UUID v4 format

    def test_no_dialogue_records_returns_new_session(self):
        """Log has attempts but none are dialogue → new session."""
        log = _make_log(TOPIC, [
            {"attempt_type": "answer", "question_id": QID, "correct": True,
             "timestamp": _ts(datetime.now(timezone.utc))}
        ])
        sid, turns, is_new = resolve_active_session(log, TOPIC, QID)
        assert is_new is True
        assert turns == []

    def test_recent_active_session_reuses_id(self):
        """Recent dialogue record → reuse existing session id."""
        now = datetime.now(timezone.utc)
        attempts = [
            {"attempt_type": "dialogue", "role": "student", "message": "hello",
             "question_id": QID, "dialogue_session_id": SID,
             "timestamp": _ts(now - timedelta(minutes=5))},
            {"attempt_type": "dialogue", "role": "tutor", "message": "hi there",
             "question_id": QID, "dialogue_session_id": SID,
             "timestamp": _ts(now - timedelta(minutes=4))},
        ]
        log = _make_log(TOPIC, attempts)
        sid, turns, is_new = resolve_active_session(log, TOPIC, QID)
        assert is_new is False
        assert sid == SID
        assert len(turns) == 2

    def test_system_closed_last_record_returns_new_session(self):
        """Last dialogue record is system close → new session."""
        now = datetime.now(timezone.utc)
        attempts = [
            {"attempt_type": "dialogue", "role": "student", "message": "hello",
             "question_id": QID, "dialogue_session_id": SID,
             "timestamp": _ts(now - timedelta(minutes=5))},
            {"attempt_type": "dialogue", "role": "system", "message": "session_closed_by_mark",
             "question_id": QID, "dialogue_session_id": SID,
             "timestamp": _ts(now - timedelta(minutes=4))},
        ]
        log = _make_log(TOPIC, attempts)
        sid, turns, is_new = resolve_active_session(log, TOPIC, QID)
        assert is_new is True
        assert turns == []
        assert sid != SID

    def test_inactive_timeout_returns_new_session(self):
        """Last record older than 30 minutes → new session."""
        old_time = datetime.now(timezone.utc) - timedelta(minutes=35)
        attempts = [
            {"attempt_type": "dialogue", "role": "student", "message": "hello",
             "question_id": QID, "dialogue_session_id": SID,
             "timestamp": _ts(old_time)},
        ]
        log = _make_log(TOPIC, attempts)
        sid, turns, is_new = resolve_active_session(log, TOPIC, QID)
        assert is_new is True
        assert turns == []
        assert sid != SID

    def test_different_question_id_returns_new_session(self):
        """Dialogue records for a different question_id → new session for this question."""
        now = datetime.now(timezone.utc)
        attempts = [
            {"attempt_type": "dialogue", "role": "student", "message": "hello",
             "question_id": "other_question", "dialogue_session_id": SID,
             "timestamp": _ts(now - timedelta(minutes=2))},
        ]
        log = _make_log(TOPIC, attempts)
        sid, turns, is_new = resolve_active_session(log, TOPIC, QID)
        assert is_new is True
        assert turns == []

    def test_consecutive_turns_same_session(self):
        """Multiple turns in same session all returned as prior_turns."""
        now = datetime.now(timezone.utc)
        attempts = [
            {"attempt_type": "dialogue", "role": "student", "message": "msg1",
             "question_id": QID, "dialogue_session_id": SID,
             "timestamp": _ts(now - timedelta(minutes=10))},
            {"attempt_type": "dialogue", "role": "tutor", "message": "reply1",
             "question_id": QID, "dialogue_session_id": SID,
             "timestamp": _ts(now - timedelta(minutes=9))},
            {"attempt_type": "dialogue", "role": "student", "message": "msg2",
             "question_id": QID, "dialogue_session_id": SID,
             "timestamp": _ts(now - timedelta(minutes=8))},
            {"attempt_type": "dialogue", "role": "tutor", "message": "reply2",
             "question_id": QID, "dialogue_session_id": SID,
             "timestamp": _ts(now - timedelta(minutes=7))},
        ]
        log = _make_log(TOPIC, attempts)
        sid, turns, is_new = resolve_active_session(log, TOPIC, QID)
        assert is_new is False
        assert sid == SID
        assert len(turns) == 4
