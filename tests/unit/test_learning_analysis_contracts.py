from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import MethodType

from backend.rules import MASTERY_MIN_EVIDENCE, StudyRuleEngine


def _attempt(index: int, *, days_old: int = 0, used_show_answer: bool = False) -> dict:
    return {
        "attempt_id": f"attempt-{index}",
        "attempt_type": "answer",
        "question_id": f"q-{index}",
        "question_type": "short_answer",
        "student_answer": "x",
        "correct": True,
        "used_show_answer": used_show_answer,
        "support_level": 4 if used_show_answer else 0,
        "timestamp": (
            datetime.now(timezone.utc) - timedelta(days=days_old, minutes=index)
        ).isoformat(),
    }


def _engine_with_topic(attempts: list[dict]) -> StudyRuleEngine:
    engine = object.__new__(StudyRuleEngine)
    engine.load_log = MethodType(
        lambda self, topics=None: {
            "topics": {"TOPIC": {"attempts": attempts, "accuracy": 1.0}}
        },
        engine,
    )
    return engine


def test_study_plan_uses_independent_evidence_floor():
    engine = _engine_with_topic([_attempt(0)])

    plan = engine.get_study_plan("TOPIC")

    assert plan["action"] == "daily_practice"
    assert plan["evidence_count"] == 1
    assert plan["status"] == "promising"
    assert "more question" in plan["message"]


def test_study_plan_does_not_treat_revealed_answers_as_evidence():
    engine = _engine_with_topic([
        _attempt(index, used_show_answer=True)
        for index in range(MASTERY_MIN_EVIDENCE)
    ])

    plan = engine.get_study_plan("TOPIC")

    assert plan["action"] == "assessment"
    assert plan["evidence_count"] == 0
    assert plan["status"] == "not_started"
    assert plan["bkt_mastery"] is None


def test_old_established_topic_is_refreshed_without_rewinding_sequence():
    attempts = [_attempt(index, days_old=45) for index in range(5)]
    engine = _engine_with_topic(attempts)
    log = {"topics": {"TOPIC": {"attempts": attempts}}}

    plan = engine.get_study_plan("TOPIC")

    assert plan["action"] == "weekly_revision"
    assert plan["bkt_mastery"] < 0.8
    assert plan["established_mastery"] >= 0.8
    assert "was established" in plan["message"]
    assert engine._is_mastered(log, "TOPIC") is True


def test_activity_reader_returns_only_daily_summary_fields(tmp_path, monkeypatch):
    from backend import rules
    from backend._testing import reset_engine_factory_cache

    monkeypatch.setattr(rules, "LOG_ROOT", tmp_path / "logs")
    reset_engine_factory_cache()
    engine = StudyRuleEngine(student_id="activity-student", subject="math")
    attempt = {
        **_attempt(0),
        "student_answer": "sensitive long answer",
        "part_results": [{"label": "a", "is_correct": True, "feedback": "large payload"}],
    }
    engine.save_log({
        "student_id": "activity-student",
        "topics": {"TOPIC": {"attempts": [attempt], "accuracy": 1.0}},
        "settings": {"daily_goal": 12},
    })

    records = engine.get_answer_activity_records()

    assert records == [{
        "question_id": "q-0",
        "correct": True,
        "timestamp": attempt["timestamp"],
        "used_show_answer": False,
        "support_level": 0,
        "outcome": "correct",
        "is_speed_round": False,
    }]
    assert engine.get_extra_metadata()["settings"]["daily_goal"] == 12
    reset_engine_factory_cache()
