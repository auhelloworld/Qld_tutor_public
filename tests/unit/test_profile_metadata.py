"""Regression tests for settings shared in the all-subject profile row."""

from __future__ import annotations

import pytest

from backend.routers.student import SaveProfileRequest, save_profile
from backend.routers.tutor import get_daily_summary, set_daily_goal
from backend.rules import PROFILE_SUBJECT, get_engine


@pytest.fixture(autouse=True)
def isolate_rule_engine_storage(tmp_path, monkeypatch):
    """Keep profile metadata and cached engines isolated from runtime data."""
    from backend import rules
    from backend._testing import reset_engine_factory_cache

    monkeypatch.setattr(rules, "LOG_ROOT", tmp_path / "logs")
    reset_engine_factory_cache()
    yield
    reset_engine_factory_cache()


def test_display_name_sync_preserves_all_subject_daily_goal():
    student_id = "profile-metadata-regression"

    set_daily_goal({"daily_goal": 35}, student_id=student_id)
    save_profile(SaveProfileRequest(display_name="Student One"), student_id=student_id)

    summary = get_daily_summary(student_id=student_id)
    profile_engine = get_engine(student_id, PROFILE_SUBJECT)
    with profile_engine._lock:
        profile = profile_engine._read_log(topics=[])

    assert summary["daily_goal"] == 35
    assert profile["settings"]["daily_goal"] == 35
    assert profile["display_name"] == "Student One"
