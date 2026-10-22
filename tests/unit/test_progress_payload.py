from __future__ import annotations

from types import MethodType

from backend.curriculum_loader import CurriculumLoader
from backend.rules import StudyRuleEngine


def _engine_with_log(log: dict) -> StudyRuleEngine:
    engine = object.__new__(StudyRuleEngine)
    engine._loader = CurriculumLoader()
    engine.load_log = MethodType(lambda self, topics=None: log, engine)
    return engine


def test_get_all_progress_include_unattempted_returns_curriculum_gaps():
    loader = CurriculumLoader()
    slice_obj = loader.load_slice("AC9_MATHS", 7)
    scope_topics = slice_obj.topics[:2]
    attempted_topic = scope_topics[0].topic_id
    unattempted_topic = scope_topics[1].topic_id
    engine = _engine_with_log({
        "topics": {
            attempted_topic: {
                "accuracy": 1.0,
                "attempts": [{
                    "attempt_type": "answer",
                    "question_id": "q1",
                    "correct": True,
                    "timestamp": "2026-01-01T00:00:00+00:00",
                }],
            }
        }
    })

    progress = engine.get_all_progress(
        valid_topic_ids={topic.topic_id for topic in scope_topics},
        include_unattempted=True,
        scope_topics=scope_topics,
    )

    by_topic = {item["topic"]: item for item in progress}
    assert by_topic[attempted_topic]["status"] in {"emerging", "developing", "mastered"}
    assert by_topic[attempted_topic]["evidence_count"] == 1
    assert by_topic[unattempted_topic]["status"] == "not_started"
    assert by_topic[unattempted_topic]["bkt_mastery"] is None
    assert by_topic[unattempted_topic]["accuracy"] is None
    assert by_topic[unattempted_topic]["evidence_count"] == 0
    assert by_topic[unattempted_topic]["confidence"] == "none"


def test_get_all_progress_marks_pseudo_diagnostic_only_confidence_low():
    engine = _engine_with_log({
        "topics": {
            "AC9M7N02": {
                "accuracy": 1.0,
                "attempts": [{
                    "attempt_type": "diagnostic",
                    "question_id": "pseudo_AC9M7N02_0",
                    "correct": True,
                    "timestamp": "2026-01-01T00:00:00+00:00",
                    "skill_id": "AC9M7N02/pseudo_0",
                }],
            }
        }
    })

    progress = engine.get_all_progress(valid_topic_ids={"AC9M7N02"})

    assert progress[0]["confidence"] == "low"
    assert progress[0]["direct_attempts_count"] == 0
    assert progress[0]["diagnostic_attempts_count"] == 1
    assert progress[0]["evidence_count"] == 0
    assert progress[0]["scored_evidence_count"] == 1
    assert progress[0]["diagnostic_evidence"] == {
        "direct_questions": 0,
        "inferred_from_strand": True,
        "strand": "Number",
        "confidence": "low",
    }


def test_get_all_progress_counts_errors_only_on_incorrect_attempts():
    engine = _engine_with_log({
        "topics": {
            "AC9M7N02": {
                "accuracy": 0.5,
                "attempts": [
                    {
                        "attempt_type": "answer",
                        "question_id": "q1",
                        "correct": True,
                        "error_type": "concept_gap",
                        "misconception_id": "stale_misconception",
                        "timestamp": "2026-01-01T00:00:00+00:00",
                    },
                    {
                        "attempt_type": "answer",
                        "question_id": "q2",
                        "correct": False,
                        "error_type": "calculation_error",
                        "misconception_id": "active_misconception",
                        "timestamp": "2026-01-01T00:01:00+00:00",
                    },
                ],
            }
        }
    })

    progress = engine.get_all_progress(valid_topic_ids={"AC9M7N02"})

    assert progress[0]["top_errors"] == {"calculation_error": 1}
    assert progress[0]["top_misconceptions"] == {"active_misconception": 1}


def test_progress_summary_counts_direct_events_without_returning_lifetime_keys():
    shared = {
        "attempt_id": "shared-event",
        "attempt_type": "answer",
        "question_id": "q-shared",
        "correct": True,
        "timestamp": "2026-07-30T00:00:00+00:00",
    }
    shown = {
        "attempt_id": "shown-event",
        "attempt_type": "answer",
        "question_id": "q-shown",
        "correct": True,
        "used_show_answer": True,
        "timestamp": "2026-07-30T00:01:00+00:00",
    }
    engine = _engine_with_log({
        "topics": {
            "AC9M7N01": {"accuracy": 1.0, "attempts": [shared, shown]},
            "AC9M7N02": {"accuracy": 1.0, "attempts": [shared]},
        }
    })

    summary = engine.get_progress_summary(valid_topic_ids={"AC9M7N01", "AC9M7N02"})

    assert summary["total_direct_attempts"] == 1
    assert len(summary["topics"]) == 2
    assert all("scored_attempt_keys" not in item for item in summary["topics"])
    by_topic = {item["topic"]: item for item in summary["topics"]}
    assert by_topic["AC9M7N01"]["evidence_count"] == 1
    assert by_topic["AC9M7N01"]["direct_attempts_count"] == 1
