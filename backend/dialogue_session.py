"""Dialogue session lifecycle resolution.

Design §3.2 — tutoring-dialogue spec.
Resolves session identity for a (student_id, question_id) request.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

# --- Constants (Task 2.1) ---

INACTIVITY_TIMEOUT = timedelta(minutes=30)


# --- Public API (Task 2.2) ---


def resolve_active_session(
    log: dict, topic: str, question_id: str
) -> tuple[str, list[dict], bool]:
    """Inspect the per-student log and decide which dialogue session this request belongs to.

    Returns (dialogue_session_id, prior_turns_for_session, is_new_session).
    Caller must hold the Phase 2 per-(student_id, subject) lock.
    """
    candidates = [
        a
        for a in log.get("topics", {}).get(topic, {}).get("dialogue_sessions", [])
        if a.get("question_id") == question_id
    ]

    # Fallback for existing data where dialogue turns were stored in attempts
    if not candidates:
        all_attempts = log.get("topics", {}).get(topic, {}).get("attempts", [])
        candidates = [
            a for a in all_attempts
            if a.get("attempt_type") == "dialogue" and a.get("question_id") == question_id
        ]

    if not candidates:
        return _new_session_id(), [], True

    last = candidates[-1]

    # If last record is a system close marker, start a new session
    if last.get("role") == "system":
        return _new_session_id(), [], True

    # Check inactivity timeout
    last_ts_str = last.get("timestamp", "")
    try:
        last_ts = datetime.fromisoformat(last_ts_str.replace("Z", "+00:00"))
        if datetime.now(timezone.utc) - last_ts >= INACTIVITY_TIMEOUT:
            return _new_session_id(), [], True
    except (ValueError, TypeError):
        pass

    # Reuse existing session
    sid = last["dialogue_session_id"]
    session_turns = [a for a in candidates if a.get("dialogue_session_id") == sid]
    return sid, session_turns, False


# --- Internal helpers (Task 2.3) ---


def _new_session_id() -> str:
    """Generate a fresh UUID v4 session identifier."""
    return str(uuid.uuid4())
