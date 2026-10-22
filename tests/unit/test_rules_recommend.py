"""Verification gate for Task 8 — ``backend/rules.py`` recommend_next_topic.

Covers the gates listed at the bottom of Task 8 in
``.kiro/specs/curriculum-framework-foundation/tasks.md``:

1. Empty log → returns the first Topic_Id from the AC9_MATHS Year 7 sequence.
2. Mark every Topic_Id mastered → returns ``topic_id=null``.

Also exercises the additive return-shape contract from Design §3.10:
``topic`` (legacy), ``topic_id``, ``name``, ``framework_id``, ``mastery``,
``recommendation_type``.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.rules import StudyRuleEngine, get_engine, LOG_ROOT
from backend._testing import reset_engine_factory_cache


# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _isolate_engine_cache(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Reset the engine factory cache before each test and redirect LOG_ROOT to tmp_path."""
    reset_engine_factory_cache()
    monkeypatch.setattr("backend.rules.LOG_ROOT", tmp_path / "logs")
    yield
    reset_engine_factory_cache()


def _make_engine(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> StudyRuleEngine:
    """Build a StudyRuleEngine using the factory with an isolated log directory."""
    return get_engine("test-student", "math")


def _seed_mastered_attempts(engine: StudyRuleEngine, topic_ids: list[str]) -> None:
    """Write 5 correct attempts for every topic in ``topic_ids``."""
    log = engine.load_log()
    for topic_id in topic_ids:
        log["topics"][topic_id] = {
            "attempts": [
                {
                    "question_id": f"seed_{topic_id}_{i}",
                    "correct": True,
                    "error_type": None,
                    "skill_id": f"{topic_id}/seed",
                    "response_time_ms": 0,
                    "attempt_type": "answer",
                    "support_level": 0,
                }
                for i in range(5)
            ],
            "accuracy": 1.0,
        }
    engine.save_log(log)


# ---------------------------------------------------------------------------
# Gate 1: empty log → first sequence Topic_Id
# ---------------------------------------------------------------------------


def test_recommend_next_topic_empty_log_returns_first_sequence_entry(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = _make_engine(tmp_path, monkeypatch)
    slice_obj = engine._loader.load_slice("AC9_MATHS", 7)
    expected_first = slice_obj.sequence.sequence[0]

    result = engine.recommend_next_topic("year7")

    # Canonical fields per Req 9.7.
    assert result["topic_id"] == expected_first
    assert result["framework_id"] == "AC9_MATHS"
    # Unattempted topic uses BKT prior (0.1), not 0.0 ("known unlearned").
    assert result["mastery"] == 0.1
    assert result["recommendation_type"] == "forward"

    # Backward-compat legacy keys (Design §3.10 additive shape).
    assert result["topic"] == expected_first
    assert "reason" in result

    # Name comes from the slice's matching topic.
    name_for_first = next(
        t.name for t in slice_obj.topics if t.topic_id == expected_first
    )
    assert result["name"] == name_for_first


# ---------------------------------------------------------------------------
# Gate 2: every Topic_Id mastered → topic_id=null
# ---------------------------------------------------------------------------


def test_recommend_next_topic_returns_null_when_all_mastered(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = _make_engine(tmp_path, monkeypatch)
    slice_obj = engine._loader.load_slice("AC9_MATHS", 7)

    _seed_mastered_attempts(engine, list(slice_obj.sequence.sequence))

    result = engine.recommend_next_topic("year7")

    assert result["topic"] is None
    assert result["topic_id"] is None
    assert result["name"] is None
    assert result["framework_id"] == "AC9_MATHS"
    assert result["mastery"] == 1.0
    assert result["recommendation_type"] == "forward"
    # Year 7 < 10, so a year-progression suggestion is included
    assert result["suggestion"] == "advance_to_year8"
    assert "Year 8" in result["reason"] or "year8" in result.get("suggestion", "")


# ---------------------------------------------------------------------------
# Additional: missing framework slice degrades gracefully
# ---------------------------------------------------------------------------


def test_recommend_next_topic_empty_slice_returns_all_mastered(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Year 9 slice exists but has zero topics — engine returns all-mastered with advance suggestion."""
    engine = _make_engine(tmp_path, monkeypatch)

    original_load_slice = engine._loader.load_slice
    def mock_load_slice(framework_id: str, year_int: int | str):
        if str(year_int) == "9":
            from core.schema.curriculum_schema import FrameworkSliceFile
            return FrameworkSliceFile(
                framework_id="AC9_MATHS",
                sequence={"is_strict": False, "prerequisites": {}, "sequence": []},
                topics=[]
            )
        return original_load_slice(framework_id, year_int)
    monkeypatch.setattr(engine._loader, "load_slice", mock_load_slice)

    result = engine.recommend_next_topic("year9")

    assert result["topic_id"] is None
    assert result["framework_id"] == "AC9_MATHS"
    assert "mastered" in result["reason"].lower()
    assert result["recommendation_type"] == "forward"
    assert result["suggestion"] == "advance_to_year10"


# ---------------------------------------------------------------------------
# Additional: unrelated public API still works (smoke; Phase 0 contract)
# ---------------------------------------------------------------------------


def test_calculate_bkt_empty_attempts_returns_prior(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = _make_engine(tmp_path, monkeypatch)
    # No scored evidence → prior P(L0)=0.1, not zero (unattempted ≠ unlearned).
    assert engine.calculate_bkt([]) == 0.1


def test_pseudo_inferred_attempts_do_not_satisfy_mastery_or_skip_topic(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Strand-inferred pseudo rows must not count as direct mastery for recommendations."""
    engine = _make_engine(tmp_path, monkeypatch)
    slice_obj = engine._loader.load_slice("AC9_MATHS", 7)
    first_topic = slice_obj.sequence.sequence[0]

    # Seed only inferred pseudo-correct evidence (and enough other attempts
    # so cold-start / diagnostic prompt thresholds do not redirect the test).
    log = engine.load_log()
    filler_topics = list(slice_obj.sequence.sequence[1:4])
    for tid in filler_topics:
        log["topics"][tid] = {
            "attempts": [
                {
                    "question_id": f"filler_{tid}_{i}",
                    "correct": True,
                    "error_type": None,
                    "attempt_type": "answer",
                }
                for i in range(4)
            ],
            "accuracy": 1.0,
        }
    log["topics"][first_topic] = {
        "attempts": [
            {
                "question_id": f"pseudo_{first_topic}_0",
                "correct": True,
                "error_type": None,
                "attempt_type": "diagnostic",
                "diagnostic_evidence": {
                    "direct_questions": 0,
                    "inferred_from_strand": True,
                    "strand": "Number",
                    "confidence": "low",
                },
            }
        ],
        "accuracy": 1.0,
    }
    # Mark diagnostic dismissed so recommend does not return diagnostic_prompt.
    log["diagnostic_status"] = {
        "math::7": {
            "report_id": None,
            "completed_at": None,
            "first_interaction_at": "2026-01-01T00:00:00+00:00",
            "diagnostic_dismissed_at": "2026-01-01T00:00:00+00:00",
        }
    }
    engine.save_log(log)

    assert engine._is_mastered(engine.load_log(), first_topic) is False

    result = engine.recommend_next_topic("year7")
    # First topic still needs direct practice; inferred-only evidence must not skip it.
    assert result["topic_id"] == first_topic
    # Direct mastery filters out strand-inferred rows → prior only.
    assert result["mastery"] == 0.1
    assert result["recommendation_type"] == "forward"


def test_forward_recommendation_follows_diagnostic_placement(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A valid diagnostic puts its start topics first and secure areas last."""
    engine = _make_engine(tmp_path, monkeypatch)
    sequence = engine._loader.load_slice("AC9_MATHS", 7).sequence
    first = sequence.sequence[0]
    start = next(t for t in sequence.sequence[3:] if not sequence.prerequisites.get(t))
    log = engine.load_log()
    log["diagnostic_status"] = {
        "math::7": {
            "report_id": "placement",
            "completed_at": "2026-01-01T00:00:00+00:00",
            "valid_completion": True,
            "first_interaction_at": "2026-01-01T00:00:00+00:00",
            "diagnostic_dismissed_at": None,
            "start_topics": [start],
            "secure_topics": [first],
        }
    }
    engine.save_log(log)

    result = engine.recommend_next_topic("year7")
    assert result["topic_id"] == start
    assert "diagnostic" in result["reason"].lower()


def test_forward_recommendation_teaches_an_open_prerequisite_first(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A start topic waits for its prerequisites, unless the diagnostic found them secure."""
    engine = _make_engine(tmp_path, monkeypatch)
    sequence = engine._loader.load_slice("AC9_MATHS", 7).sequence
    start = next(t for t in sequence.sequence if sequence.prerequisites.get(t))
    prerequisites = list(sequence.prerequisites[start])

    def place(secure: list[str]) -> str:
        log = engine.load_log()
        log["diagnostic_status"] = {
            "math::7": {
                "report_id": "placement",
                "completed_at": "2026-01-01T00:00:00+00:00",
                "valid_completion": True,
                "first_interaction_at": "2026-01-01T00:00:00+00:00",
                "diagnostic_dismissed_at": None,
                "start_topics": [start],
                "secure_topics": secure,
            }
        }
        engine.save_log(log)
        return engine.recommend_next_topic("year7")["topic_id"]

    first_without_prerequisites = next(t for t in sequence.sequence if not sequence.prerequisites.get(t))
    assert place([]) == first_without_prerequisites
    assert place(prerequisites) == start


def test_get_study_plan_returns_assessment_for_unknown_topic(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = _make_engine(tmp_path, monkeypatch)
    plan = engine.get_study_plan("AC9M7N04")
    assert plan["action"] == "assessment"


def test_diagnostic_prompt_triggered_by_attempts_range(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Diagnostic prompts are triggered for students with 3 to 9 attempts, but not 0-2 or >=10."""
    engine = _make_engine(tmp_path, monkeypatch)
    slice_obj = engine._loader.load_slice("AC9_MATHS", 7)
    first_topic = slice_obj.sequence.sequence[0]

    # Case A: 2 attempts -> Should NOT trigger diagnostic prompt, returns forward recommendation
    log = engine.load_log()
    log["topics"][first_topic] = {
        "attempts": [
            {
                "question_id": f"q_{i}",
                "correct": True,
                "error_type": None,
                "attempt_type": "answer",
            }
            for i in range(2)
        ]
    }
    engine.save_log(log)
    res_2 = engine.recommend_next_topic("year7")
    assert res_2["recommendation_type"] == "forward"

    # Case B: 3 attempts -> Should trigger diagnostic prompt
    log = engine.load_log()
    log["topics"][first_topic]["attempts"].append({
        "question_id": "q_2",
        "correct": True,
        "error_type": None,
        "attempt_type": "answer",
    })
    engine.save_log(log)
    res_3 = engine.recommend_next_topic("year7")
    assert res_3["recommendation_type"] == "diagnostic_prompt"

    # Case C: 9 attempts -> Should trigger diagnostic prompt
    log = engine.load_log()
    log["topics"][first_topic]["attempts"].extend([
        {
            "question_id": f"q_{i}",
            "correct": True,
            "error_type": None,
            "attempt_type": "answer",
        }
        for i in range(3, 9)
    ])
    engine.save_log(log)
    res_9 = engine.recommend_next_topic("year7")
    assert res_9["recommendation_type"] == "diagnostic_prompt"

    # Case D: 10 attempts -> Should NOT trigger diagnostic prompt, returns forward/revision
    log = engine.load_log()
    log["topics"][first_topic]["attempts"].append({
        "question_id": "q_9",
        "correct": True,
        "error_type": None,
        "attempt_type": "answer",
    })
    engine.save_log(log)
    res_10 = engine.recommend_next_topic("year7")
    assert res_10["recommendation_type"] in ("forward", "revision")


# ---------------------------------------------------------------------------
# Forward topic: computed apart from revision, and not undone by time decay
# ---------------------------------------------------------------------------


def _seed_old_mastery(engine: StudyRuleEngine, topic_id: str, days_ago: int, *, due_revision: bool) -> None:
    from datetime import datetime, timedelta, timezone

    when = datetime.now(timezone.utc) - timedelta(days=days_ago)
    log = engine.load_log()
    topic = {
        "attempts": [
            {
                "question_id": f"old_{topic_id}_{i}",
                "correct": True,
                "error_type": None,
                "attempt_type": "answer",
                "support_level": 0,
                "timestamp": (when + timedelta(minutes=i)).isoformat(),
            }
            for i in range(6)
        ],
        "accuracy": 1.0,
    }
    if due_revision:
        topic["revision"] = {
            "first_mastered_at": when.isoformat(),
            "consecutive_revisions": 1,
            "next_review_at": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
        }
    log["topics"][topic_id] = topic
    log["diagnostic_status"] = {
        "math::7": {
            "report_id": None,
            "completed_at": None,
            "first_interaction_at": "2026-01-01T00:00:00+00:00",
            "diagnostic_dismissed_at": "2026-01-01T00:00:00+00:00",
        }
    }
    engine.save_log(log)


def test_forward_topic_is_available_when_a_revision_is_due(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = _make_engine(tmp_path, monkeypatch)
    sequence = engine._loader.load_slice("AC9_MATHS", 7).sequence.sequence
    _seed_old_mastery(engine, sequence[0], days_ago=3, due_revision=True)

    assert engine.recommend_next_topic("year7")["recommendation_type"] == "revision"
    facts = engine.today_topic_facts("year7", log_snapshot=engine.load_log())
    assert facts.next_topic() == sequence[1]


def test_old_mastery_does_not_send_the_student_back_to_a_topic(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Freshness is the revision schedule's job; decay must not reopen a mastered topic."""
    engine = _make_engine(tmp_path, monkeypatch)
    sequence = engine._loader.load_slice("AC9_MATHS", 7).sequence.sequence
    _seed_old_mastery(engine, sequence[0], days_ago=60, due_revision=False)

    assert engine.today_topic_facts("year7", log_snapshot=engine.load_log()).next_topic() == sequence[1]
    assert engine.recommend_next_topic("year7")["topic_id"] == sequence[1]
