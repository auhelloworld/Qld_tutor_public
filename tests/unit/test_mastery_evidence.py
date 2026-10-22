"""Mastery must rest on real, independent evidence.

Three pedagogical contracts are covered here:

1. One rule decides "mastered" everywhere (curriculum ticks through progress
   status, Today and the next topic, prerequisites, revision scheduling): at
   least 4 first answers on the student's own, and 3 right in the last 4. A
   right answer that the student marked "guess" is not a right answer here.
   Time does not remove mastery; the revision schedule handles freshness.
2. An answer the student revealed before submitting is not evidence of recall,
   so it must not count toward any of those decisions either.
3. BKT treats a right answer marked "guess" as weak evidence.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from backend.rules import MASTERY_MIN_EVIDENCE, StudyRuleEngine, get_engine
from core.algorithms.bkt import calculate_bkt



@pytest.fixture(autouse=True)
def isolate_rule_engine_storage(tmp_path, monkeypatch):
    """Keep every engine created in this module away from runtime student data."""
    from backend._testing import reset_engine_factory_cache

    monkeypatch.setattr("backend.rules.LOG_ROOT", tmp_path / "logs")
    reset_engine_factory_cache()
    yield
    reset_engine_factory_cache()
STUDENT = "b7f1c2d3-4e5a-4b6c-8d7e-9f0a1b2c3d4e"
TOPIC = "AC9M7N01"


def _attempt(*, correct=True, revealed=False, index=0):
    return {
        "question_id": f"q{index}",
        "correct": correct,
        "attempt_type": "answer",
        "support_level": 0,
        "question_type": "short_answer",
        "student_answer": "4",
        "skill_id": f"{TOPIC}/q{index}",
        # Deterministic, distinct timestamps: the attempts table is append-only and
        # keyed by (student, subject, topic, question_id, timestamp).
        "timestamp": f"2026-07-30T0{index % 10}:00:00+00:00",
        **({"used_show_answer": True} if revealed else {}),
    }


def test_current_bkt_settings_keep_an_aged_single_answer_below_threshold():
    """Recency is part of the current BKT setting and is tested deterministically."""
    posterior = calculate_bkt(
        [_attempt()],
        recency_ref_time=datetime.fromisoformat("2026-08-02T00:00:00+00:00"),
    )
    assert posterior == pytest.approx(0.756, abs=0.001)
    assert posterior < 0.8


@pytest.mark.parametrize("count", [1, MASTERY_MIN_EVIDENCE - 1])
def test_thin_evidence_is_not_mastery_for_sequencing(count):
    engine = get_engine(STUDENT, "math")
    log = {"topics": {TOPIC: {"attempts": [_attempt(index=i) for i in range(count)]}}}
    assert engine._is_mastered(log, TOPIC) is False


def test_sufficient_evidence_is_mastery_for_sequencing():
    engine = get_engine(STUDENT, "math")
    log = {
        "topics": {
            TOPIC: {"attempts": [_attempt(index=i) for i in range(MASTERY_MIN_EVIDENCE)]}
        }
    }
    assert engine._is_mastered(log, TOPIC) is True


def test_revealed_answers_are_not_mastery_evidence():
    assert StudyRuleEngine._is_direct_mastery_attempt(_attempt()) is True
    assert StudyRuleEngine._is_direct_mastery_attempt(_attempt(revealed=True)) is False


def test_revealed_answers_cannot_establish_mastery_or_unlock_sequence():
    engine = get_engine(STUDENT, "math")
    revealed_only = {
        "topics": {
            TOPIC: {
                "attempts": [
                    _attempt(index=i, revealed=True)
                    for i in range(MASTERY_MIN_EVIDENCE + 2)
                ]
            }
        }
    }
    assert engine._is_mastered(revealed_only, TOPIC) is False


def _answer(question_id: str, correct: bool, minute: int, **extra) -> dict:
    return {
        "question_id": question_id,
        "correct": correct,
        "outcome": "correct" if correct else "incorrect",
        "attempt_type": "answer",
        "support_level": 0,
        "question_type": "short_answer",
        "student_answer": "4" if correct else "5",
        "skill_id": f"{TOPIC}/{question_id}",
        "timestamp": f"2026-07-30T01:{minute:02d}:00+00:00",
        **extra,
    }


def _corrected_retries() -> list[dict]:
    """Every first answer is wrong; each question is then answered again, right, with no help."""
    attempts = []
    for index in range(3):
        attempts.append(_answer(f"q{index}", False, index * 2, first_attempt=True))
        attempts.append(_answer(f"q{index}", True, index * 2 + 1, first_attempt=False))
    return attempts


def test_a_corrected_retry_is_not_mastery_evidence():
    engine = get_engine(STUDENT, "math")
    log = {"topics": {TOPIC: {"attempts": _corrected_retries()}}}

    assert engine._is_mastered(log, TOPIC) is False
    assert len(engine._independent_attempts_for_mastery(log["topics"][TOPIC]["attempts"])) == 3


def test_a_later_answer_to_a_question_already_answered_is_not_new_evidence():
    """Example: the Error Book asks the same question again on another day."""
    engine = get_engine(STUDENT, "math")
    first_tries = [_answer(f"q{index}", False, index) for index in range(3)]
    same_questions_again = [_answer(f"q{index}", True, 10 + index, first_attempt=True) for index in range(3)]
    log = {"topics": {TOPIC: {"attempts": first_tries + same_questions_again}}}

    assert engine._is_mastered(log, TOPIC) is False


def test_an_answer_after_a_revealed_answer_is_not_a_first_answer():
    engine = get_engine(STUDENT, "math")
    attempts = []
    for index in range(3):
        attempts.append(_answer(f"q{index}", False, index * 2, used_show_answer=True))
        attempts.append(_answer(f"q{index}", True, index * 2 + 1))
    log = {"topics": {TOPIC: {"attempts": attempts}}}

    assert engine._is_mastered(log, TOPIC) is False


def test_progress_status_uses_only_first_answers_as_independent_evidence():
    engine = get_engine(STUDENT, "math")

    item = engine._progress_item(TOPIC, {"attempts": _corrected_retries()})

    assert item["status"] != "mastered"
    assert item["independent_evidence_count"] == 3
    assert item["independent_accuracy"] == 0
    # Supported work still shows: the corrections count toward the supported trajectory.
    assert item["supported_evidence_count"] == 6


def test_study_plan_asks_for_more_evidence_before_declaring_mastery(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.rules.LOG_ROOT", tmp_path / "logs")
    from backend._testing import reset_engine_factory_cache

    reset_engine_factory_cache()
    engine = StudyRuleEngine(student_id=STUDENT, subject="math")

    recent_anchor = datetime.now(timezone.utc)
    established_attempts = []
    for index in range(MASTERY_MIN_EVIDENCE):
        attempt = _attempt(index=index)
        attempt["timestamp"] = (
            recent_anchor - timedelta(minutes=MASTERY_MIN_EVIDENCE - index)
        ).isoformat()
        established_attempts.append(attempt)
    log = {
        "student_id": STUDENT,
        "topics": {TOPIC: {"accuracy": 1.0, "attempts": established_attempts[:1]}},
        "diagnostic_status": {},
    }
    engine._write_log(log)
    thin = engine.get_study_plan(TOPIC)
    assert thin["action"] != "maintenance"
    assert "mastered" not in thin["message"].lower()
    assert thin["evidence_count"] == 1

    log["topics"][TOPIC]["attempts"] = established_attempts
    engine._write_log(log)
    established = engine.get_study_plan(TOPIC)
    assert established["action"] == "maintenance"
    assert established["evidence_count"] == MASTERY_MIN_EVIDENCE

    reset_engine_factory_cache()


def _first_answers(pattern: str, *, start: datetime | None = None) -> list[dict]:
    """One first answer per letter: R right, W wrong, G right but marked "guess"."""
    start = start or datetime.now(timezone.utc) - timedelta(minutes=len(pattern))
    return [
        {
            **_answer(
                f"q{index}",
                letter != "W",
                0,
                **({"confidence": "guess"} if letter == "G" else {}),
            ),
            "timestamp": (start + timedelta(minutes=index)).isoformat(),
        }
        for index, letter in enumerate(pattern)
    ]


@pytest.mark.parametrize(
    ("pattern", "mastered"),
    [
        ("RRR", False),  # 3 first answers are not enough
        ("RRW", False),
        ("WWWR", False),  # one right after 3 wrong
        ("WWRWWR", False),
        ("WRWRWR", False),  # right and wrong in turn
        ("WWWRR", False),
        ("RRRRRWRW", False),  # BKT stays high, but 2 of the last 4 are wrong
        ("RRRR", True),
        ("RRRW", True),  # one slip after 3 right keeps mastery
        ("RRWR", True),
        ("WWWRRR", True),  # 3 right in a row after early mistakes
        ("RRRG", True),
        ("RRGG", False),  # a right answer marked "guess" is not a right answer here
        ("GGGG", False),
    ],
)
def test_one_mastery_rule_for_the_curriculum_and_progress_status(pattern, mastered):
    """Today's "3 of 4 right on your own" rule, with at least 4 first answers."""
    engine = get_engine(STUDENT, "math")
    attempts = _first_answers(pattern)

    assert engine._is_mastered({"topics": {TOPIC: {"attempts": attempts}}}, TOPIC) is mastered
    status = engine._progress_item(TOPIC, {"attempts": attempts})["status"]
    assert (status == "mastered") is mastered


def test_a_right_answer_marked_guess_is_weak_bkt_evidence():
    """Same idea as the diagnostic: a guessed right answer uses a guess rate of 0.5."""
    assert calculate_bkt(_first_answers("R"), apply_recency=False) == pytest.approx(0.861, abs=0.001)
    assert calculate_bkt(_first_answers("G"), apply_recency=False) == pytest.approx(0.294, abs=0.001)
    # A wrong answer marked "guess" is the same evidence as any wrong answer.
    wrong_guess = [{**_first_answers("W")[0], "confidence": "guess"}]
    assert calculate_bkt(wrong_guess, apply_recency=False) == calculate_bkt(
        _first_answers("W"), apply_recency=False
    )


def test_mastery_does_not_fade_with_time():
    """The current estimate fades with time; mastery stays until answers show otherwise."""
    engine = get_engine(STUDENT, "math")
    attempts = _first_answers("RRRR", start=datetime.now(timezone.utc) - timedelta(days=60))

    item = engine._progress_item(TOPIC, {"attempts": attempts})

    assert item["bkt_mastery"] < 0.5
    assert item["status"] == "mastered"
    assert engine._is_mastered({"topics": {TOPIC: {"attempts": attempts}}}, TOPIC) is True


def test_study_plan_calls_a_topic_secure_only_under_the_mastery_rule():
    engine = StudyRuleEngine(student_id=STUDENT, subject="math")
    engine._write_log({
        "student_id": STUDENT,
        "topics": {TOPIC: {"accuracy": 0.85, "attempts": _first_answers("RRRRRRRRRRWRW")}},
        "diagnostic_status": {},
    })

    plan = engine.get_study_plan(TOPIC)

    assert plan["status"] != "mastered"
    assert plan["action"] != "maintenance"


def test_the_revision_schedule_starts_with_mastery():
    engine = get_engine(STUDENT, "math")

    def answer_right(index: int) -> None:
        engine.log_attempt(
            topic=TOPIC,
            question_id=f"q{index}",
            is_correct=True,
            question_type="short_answer",
            topic_ids=[TOPIC],
            student_answer="4",
            support_level=0,
        )

    def has_revision() -> bool:
        return "revision" in engine.load_log(topics=[TOPIC])["topics"].get(TOPIC, {})

    for index in range(3):
        answer_right(index)
    assert has_revision() is False

    answer_right(3)
    assert has_revision() is True


def _due_revision_log(pattern: str) -> dict:
    due = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    return {
        "topics": {
            TOPIC: {
                "attempts": _first_answers(pattern, start=datetime.now(timezone.utc) - timedelta(days=3)),
                "revision": {"first_mastered_at": due, "consecutive_revisions": 1, "next_review_at": due},
            }
        },
        "diagnostic_status": {},
    }


def test_a_topic_is_due_for_revision_only_while_it_is_mastered():
    engine = get_engine(STUDENT, "math")

    assert engine.get_due_revision_topics("year7", log_snapshot=_due_revision_log("RRRRRR")) == [TOPIC]
    # 2 of the last 4 are wrong: the student learns the topic again; it is not a revision.
    assert engine.get_due_revision_topics("year7", log_snapshot=_due_revision_log("RRRRRWRW")) == []


def _diagnostic_rows(count: int) -> list[dict]:
    now = datetime.now(timezone.utc)
    return [
        {
            "attempt_type": "diagnostic",
            "support_level": 0,
            "question_id": f"d{index}",
            "correct": True,
            "outcome": "correct",
            "student_answer": "4",
            "question_type": "short_answer",
            "timestamp": (now - timedelta(minutes=count - index)).isoformat(),
            "diagnostic_evidence": {
                "direct_questions": count,
                "inferred_from_strand": False,
                "strand": "Number",
            },
        }
        for index in range(count)
    ]


def test_the_diagnostic_starts_revision_under_the_same_rule():
    from backend.diagnostic_engine import DiagnosticEngine

    three = {"attempts": _diagnostic_rows(3)}
    four = {"attempts": _diagnostic_rows(4)}
    DiagnosticEngine._maybe_seed_revision(three)
    DiagnosticEngine._maybe_seed_revision(four)

    assert "revision" not in three
    assert "revision" in four


def _dismissed_diagnostic() -> dict:
    return {
        "math::7": {
            "report_id": None,
            "completed_at": None,
            "first_interaction_at": "2026-01-01T00:00:00+00:00",
            "diagnostic_dismissed_at": "2026-01-01T00:00:00+00:00",
        }
    }


def test_the_next_topic_reason_counts_the_right_answers_still_needed():
    engine = StudyRuleEngine(student_id=STUDENT, subject="math")
    first_topic = engine._loader.load_slice("AC9_MATHS", 7).sequence.sequence[0]
    engine._write_log({
        "student_id": STUDENT,
        "topics": {first_topic: {"accuracy": 0.75, "attempts": _first_answers("RRRRRWRW")}},
        "diagnostic_status": _dismissed_diagnostic(),
    })

    result = engine.recommend_next_topic("year7")

    assert result["topic_id"] == first_topic
    # The last 4 are R W R W: 2 more right answers give 3 of the last 4.
    assert "2 more will confirm it" in result["reason"]


def test_the_recommended_revision_needs_the_topic_to_be_mastered():
    engine = StudyRuleEngine(student_id=STUDENT, subject="math")
    log = _due_revision_log("RRRRRWRW")
    log["diagnostic_status"] = _dismissed_diagnostic()
    engine._write_log({"student_id": STUDENT, **log})

    assert engine.recommend_next_topic("year7")["recommendation_type"] != "revision"
