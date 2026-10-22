"""Unit tests for ``backend/rules.py`` — study plan rules, recommend walk, BKT.

Task 6.1 verification: each of the four ``get_study_plan`` rules at trigger
boundary; ``recommend_next_topic`` walk; BKT against three reference sequences.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

from backend._testing import reset_engine_factory_cache
from backend.rules import StudyRuleEngine, get_engine


@pytest.fixture(autouse=True)
def _isolate(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    global _attempt_suffix
    _attempt_suffix = 0
    reset_engine_factory_cache()
    monkeypatch.setattr("backend.rules.LOG_ROOT", tmp_path / "logs")
    yield
    reset_engine_factory_cache()


def _engine(tmp_path=None) -> StudyRuleEngine:
    return get_engine("test-student", "math")


def _seed_attempts(engine: StudyRuleEngine, topic: str, attempts: list[dict]):
    """Seed raw attempts into the engine's log for a topic."""
    log = engine.load_log()
    answer_attempts = [a for a in attempts if a.get("attempt_type", "answer") == "answer"]
    correct_count = sum(1 for a in answer_attempts if a["correct"])
    accuracy = round(correct_count / len(answer_attempts), 2) if answer_attempts else 0.0
    log["topics"][topic] = {"attempts": attempts, "accuracy": accuracy}
    engine.save_log(log)


_attempt_suffix: int = 0


def _make_attempt(correct: bool, error_type=None, attempt_type="answer"):
    global _attempt_suffix
    _attempt_suffix += 1
    return {
        # Each attempt is a different question: only the first answer to a
        # question counts as independent evidence.
        "question_id": f"q{_attempt_suffix}",
        "correct": correct,
        "error_type": error_type,
        "attempt_type": attempt_type,
        "support_level": 0,
        "timestamp": datetime.now(timezone.utc).replace(microsecond=_attempt_suffix).isoformat(),
    }


def test_update_latest_incorrect_attempt_metadata_invalidates_mistakes_cache(monkeypatch):
    engine = _engine()
    _seed_attempts(
        engine,
        "fractions",
        [
            {
                **_make_attempt(False, error_type="concept_gap"),
                "question_id": "q-cache",
                "student_answer": "wrong",
            }
        ],
    )
    invalidated: list[str] = []
    monkeypatch.setattr(
        "backend.api.invalidate_mistakes_cache",
        lambda student_id: invalidated.append(student_id),
    )

    updated = engine.update_latest_incorrect_attempt_metadata(
        "q-cache",
        {"gap_classification": {"recommended_action": "Review the key rule."}},
    )

    assert updated is True
    assert invalidated == [engine.student_id]


def test_save_reflection_invalidates_mistakes_cache(monkeypatch):
    engine = _engine()
    _seed_attempts(
        engine,
        "fractions",
        [{**_make_attempt(False, error_type="concept_gap"), "student_answer": "wrong"}],
    )
    invalidated: list[str] = []
    monkeypatch.setattr(
        "backend.api.invalidate_mistakes_cache",
        lambda student_id: invalidated.append(student_id),
    )

    saved = engine.save_reflection(["fractions"], "q1", "concept_gap")

    assert saved is True
    assert invalidated == [engine.student_id]


def test_parent_review_attempt_invalidates_mistakes_cache(monkeypatch):
    engine = _engine()
    _seed_attempts(
        engine,
        "fractions",
        [
            {
                **_make_attempt(False, error_type="parent_review_pending"),
                "question_id": "q-review",
                "student_answer": "needs parent",
            }
        ],
    )
    invalidated: list[str] = []
    monkeypatch.setattr(
        "backend.api.invalidate_mistakes_cache",
        lambda student_id: invalidated.append(student_id),
    )

    updated = engine.review_attempt(
        topic="fractions",
        question_id="q-review",
        student_answer="needs parent",
        correct=False,
    )

    assert updated is True
    assert invalidated == [engine.student_id]


# ---------------------------------------------------------------------------
# Rule 1: 3 consecutive errors → concept_reteach
# ---------------------------------------------------------------------------


class TestRule1ConceptReteach:
    def test_exactly_3_consecutive_errors_triggers(self):
        engine = _engine()
        attempts = [_make_attempt(False) for _ in range(3)]
        _seed_attempts(engine, "fractions", attempts)
        plan = engine.get_study_plan("fractions")
        assert plan["action"] == "concept_reteach"

    def test_2_consecutive_errors_does_not_trigger(self):
        engine = _engine()
        attempts = [_make_attempt(True)] + [_make_attempt(False) for _ in range(2)]
        _seed_attempts(engine, "fractions", attempts)
        plan = engine.get_study_plan("fractions")
        assert plan["action"] != "concept_reteach"

    def test_3_errors_broken_by_correct_does_not_trigger(self):
        engine = _engine()
        attempts = [_make_attempt(False), _make_attempt(False), _make_attempt(True), _make_attempt(False)]
        _seed_attempts(engine, "fractions", attempts)
        plan = engine.get_study_plan("fractions")
        assert plan["action"] != "concept_reteach"


# ---------------------------------------------------------------------------
# Rule 2: >40% calculation errors over ≥3 attempts → drill_practice
# ---------------------------------------------------------------------------


class TestRule2DrillPractice:
    def test_over_40_percent_calc_errors_triggers(self):
        engine = _engine()
        # 2 calc errors out of 4 = 50% > 40%
        attempts = [
            _make_attempt(True),  # break consecutive errors
            _make_attempt(False, error_type="calculation_error"),
            _make_attempt(False, error_type="calculation_error"),
            _make_attempt(True),
        ]
        _seed_attempts(engine, "fractions", attempts)
        plan = engine.get_study_plan("fractions")
        assert plan["action"] == "drill_practice"

    def test_exactly_40_percent_does_not_trigger(self):
        engine = _engine()
        # 2 calc errors out of 5 = 40% — not > 40%
        attempts = [
            _make_attempt(True),
            _make_attempt(False, error_type="calculation_error"),
            _make_attempt(False, error_type="calculation_error"),
            _make_attempt(True),
            _make_attempt(True),
        ]
        _seed_attempts(engine, "fractions", attempts)
        plan = engine.get_study_plan("fractions")
        assert plan["action"] != "drill_practice"

    def test_fewer_than_3_attempts_does_not_trigger(self):
        engine = _engine()
        attempts = [
            _make_attempt(True),
            _make_attempt(False, error_type="calculation_error"),
        ]
        _seed_attempts(engine, "fractions", attempts)
        plan = engine.get_study_plan("fractions")
        # With only 2 attempts, rule 2 can't fire (needs ≥3)
        assert plan["action"] != "drill_practice"


# ---------------------------------------------------------------------------
# Rule 3: concept_gap in last 3 → explain_prioritized
# ---------------------------------------------------------------------------


class TestRule3ExplainPrioritized:
    def test_concept_gap_in_recent_triggers(self):
        engine = _engine()
        attempts = [
            _make_attempt(True),
            _make_attempt(True),
            _make_attempt(True),
            _make_attempt(False, error_type="concept_gap"),
        ]
        _seed_attempts(engine, "fractions", attempts)
        plan = engine.get_study_plan("fractions")
        assert plan["action"] == "explain_prioritized"

    def test_concept_gap_outside_last_3_does_not_trigger(self):
        engine = _engine()
        attempts = [
            _make_attempt(False, error_type="concept_gap"),
            _make_attempt(True),
            _make_attempt(True),
            _make_attempt(True),
        ]
        _seed_attempts(engine, "fractions", attempts)
        plan = engine.get_study_plan("fractions")
        assert plan["action"] != "explain_prioritized"


# ---------------------------------------------------------------------------
# Rule 4: Accuracy bands
# ---------------------------------------------------------------------------


class TestRule4AccuracyBands:
    def test_accuracy_below_50_daily_practice(self):
        engine = _engine()
        # 2 correct out of 5 = 40% < 50%, but avoid 3 consecutive errors
        attempts = [
            _make_attempt(False),
            _make_attempt(True),
            _make_attempt(False),
            _make_attempt(True),
            _make_attempt(False),
        ]
        _seed_attempts(engine, "fractions", attempts)
        plan = engine.get_study_plan("fractions")
        assert plan["action"] == "daily_practice"

    def test_accuracy_between_50_and_80_weekly_revision(self):
        engine = _engine()
        # 3 correct out of 5 = 60%
        attempts = [_make_attempt(True) for _ in range(3)] + [_make_attempt(False) for _ in range(2)]
        _seed_attempts(engine, "fractions", attempts)
        plan = engine.get_study_plan("fractions")
        assert plan["action"] == "weekly_revision"

    def test_accuracy_above_80_maintenance(self):
        engine = _engine()
        # 9 correct out of 10 = 90%
        attempts = [_make_attempt(True) for _ in range(9)] + [_make_attempt(False)]
        _seed_attempts(engine, "fractions", attempts)
        plan = engine.get_study_plan("fractions")
        assert plan["action"] == "maintenance"


# ---------------------------------------------------------------------------
# recommend_next_topic walk
# ---------------------------------------------------------------------------


class TestRecommendNextTopicWalk:
    def test_walks_sequence_returns_first_unmastered(self, frozen_time):
        # Keep the authored attempt timestamps recent. Without this, the test
        # changes outcome as wall-clock time advances because production BKT
        # intentionally applies recency decay.
        frozen_time.move_to("2026-06-09 12:01:00")
        engine = _engine()
        slice_obj = engine._loader.load_slice("AC9_MATHS", 7)
        first_topic = slice_obj.sequence.sequence[0]
        second_topic = slice_obj.sequence.sequence[1]

        # Master the first topic
        log = engine.load_log()
        log["topics"][first_topic] = {
            "attempts": [_make_attempt(True) for _ in range(10)],
            "accuracy": 1.0,
        }
        engine.save_log(log)

        result = engine.recommend_next_topic("year7")
        assert result["topic_id"] == second_topic

    def test_empty_log_returns_first_topic(self):
        engine = _engine()
        slice_obj = engine._loader.load_slice("AC9_MATHS", 7)
        first_topic = slice_obj.sequence.sequence[0]

        result = engine.recommend_next_topic("year7")
        assert result["topic_id"] == first_topic


# ---------------------------------------------------------------------------
# BKT reference sequences
# ---------------------------------------------------------------------------


class TestCalculateBKT:
    def test_empty_sequence_returns_prior(self):
        engine = _engine()
        assert engine.calculate_bkt([]) == 0.1

    def test_three_correct_answers(self):
        engine = _engine()
        attempts = [_make_attempt(True) for _ in range(3)]
        result = engine.calculate_bkt(attempts, apply_recency=False)
        # Hand-computed: P(L0)=0.3, P(T)=0.1, P(G)=0.2, P(S)=0.1
        # After 3 correct: mastery should be > 0.5
        assert result > 0.5
        assert result < 1.0

    def test_two_correct_one_incorrect(self):
        engine = _engine()
        attempts = [_make_attempt(True), _make_attempt(True), _make_attempt(False)]
        result = engine.calculate_bkt(attempts, apply_recency=False)
        # After 2 correct then 1 incorrect, mastery should be moderate
        assert result > 0.3
        assert result < 0.9

    def test_hint_records_ignored_by_bkt(self):
        engine = _engine()
        attempts = [
            _make_attempt(True),
            _make_attempt(False, attempt_type="hint"),
            _make_attempt(True),
        ]
        # BKT should only consider answer-type records
        result_with_hints = engine.calculate_bkt(attempts, apply_recency=False)
        result_without_hints = engine.calculate_bkt([
            _make_attempt(True),
            _make_attempt(True),
        ], apply_recency=False)
        assert result_with_hints == result_without_hints

    def test_calculation_slip_recalibration(self):
        engine = _engine()
        # Student with high mastery: two correct answers, then one incorrect answer
        attempts_standard = [
            _make_attempt(True),
            _make_attempt(True),
            _make_attempt(False)
        ]
        # Student with calculation_slip reflection type
        attempts_with_slip = [
            _make_attempt(True),
            _make_attempt(True),
            {**_make_attempt(False), "reflection_type": "calculation_slip"}
        ]

        bkt_standard = engine.calculate_bkt(attempts_standard, apply_recency=False)
        bkt_with_slip = engine.calculate_bkt(attempts_with_slip, apply_recency=False)

        # When reflection is calculation_slip, BKT mastery should drop less
        # and be significantly higher than the standard drop
        assert bkt_with_slip > bkt_standard


def test_error_book_review_links_are_materialized_and_indexed():
    from backend.sqlite_utils import connect_sqlite

    engine = _engine()
    attempt = {
        **_make_attempt(True),
        "question_id": "variation-q",
        "review_source": "error_book",
        "review_question_id": "source-q",
        "student_answer": "corrected",
    }
    _seed_attempts(engine, "fractions", [attempt])

    linked = engine.get_error_book_review_attempts("source-q")
    assert [row["question_id"] for row in linked] == ["variation-q"]

    conn = connect_sqlite(str(engine._db_path))
    try:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(attempts)")}
        indexes = {row[1] for row in conn.execute("PRAGMA index_list(attempts)")}
    finally:
        conn.close()
    assert {"review_question_id", "error_book_source"} <= columns
    assert {"idx_attempts_review_question", "idx_attempts_error_book_source"} <= indexes
