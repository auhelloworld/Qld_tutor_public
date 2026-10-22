import pytest

from backend.services.attempt_outcomes import (
    AttemptOutcome,
    classify_attempt,
    classify_part_result,
    deduplicate_attempts,
    is_independent_learning_attempt,
    is_scored_learning_attempt,
    part_review_key,
    physical_attempt_key,
)


def test_shared_outcome_fixtures_are_classified(outcome_attempts):
    assert classify_attempt(outcome_attempts["correct"]) is AttemptOutcome.CORRECT
    assert classify_attempt(outcome_attempts["incorrect"]) is AttemptOutcome.INCORRECT
    assert classify_attempt(outcome_attempts["pending"]) is AttemptOutcome.PENDING
    assert classify_attempt(outcome_attempts["deferred"]) is AttemptOutcome.PENDING
    assert classify_attempt(outcome_attempts["unanswered"]) is AttemptOutcome.UNANSWERED


def test_only_confirmed_correct_or_incorrect_work_is_scored(outcome_attempts):
    assert is_scored_learning_attempt(outcome_attempts["correct"])
    assert is_scored_learning_attempt(outcome_attempts["incorrect"])
    assert not is_scored_learning_attempt(outcome_attempts["pending"])
    assert not is_scored_learning_attempt(outcome_attempts["deferred"])
    assert not is_scored_learning_attempt(outcome_attempts["unanswered"])


def test_multi_part_pending_and_unanswered_are_not_whole_question_failures():
    pending = {
        "attempt_type": "answer",
        "correct": False,
        "student_answer": '{"a":"done","b":"explanation"}',
        "part_results": [
            {"label": "a", "student_answer": "done", "is_correct": True},
            {
                "label": "b",
                "student_answer": "explanation",
                "is_correct": False,
                "error_type": "parent_review_pending",
            },
        ],
    }
    unanswered = {
        **pending,
        "part_results": [
            {"label": "a", "student_answer": "done", "is_correct": True},
            {"label": "b", "student_answer": "", "is_correct": False},
        ],
    }

    assert classify_attempt(pending) is AttemptOutcome.PENDING
    assert classify_attempt(unanswered) is AttemptOutcome.UNANSWERED
    assert classify_part_result(unanswered["part_results"][1]) is AttemptOutcome.UNANSWERED
    assert not is_scored_learning_attempt(pending)
    assert not is_scored_learning_attempt(unanswered)


def test_legacy_cross_tagged_rows_share_a_compatibility_identity(cross_tagged_attempt_log):
    rows = [
        attempt
        for topic in cross_tagged_attempt_log["topics"].values()
        for attempt in topic["attempts"]
    ]
    assert physical_attempt_key(rows[0]) == physical_attempt_key(rows[1])
    assert len(deduplicate_attempts(rows)) == 1


def test_new_attempt_id_is_the_primary_identity(attempt_factory):
    first = attempt_factory(attempt_id="attempt-123", timestamp="2026-07-10T08:00:00+00:00")
    copy = attempt_factory(attempt_id="attempt-123", timestamp="2026-07-10T08:00:02+00:00", weight=0.3)
    assert physical_attempt_key(first) == physical_attempt_key(copy) == "id:attempt-123"
    assert part_review_key(first, "B") == "id:attempt-123::b"
    assert len(deduplicate_attempts([copy, first])) == 1
    assert deduplicate_attempts([copy, first])[0]["weight"] == 1.0


def test_dismissed_is_not_learning_evidence(attempt_factory):
    dismissed = attempt_factory(error_type="manual_dismissed", outcome="dismissed")
    assert classify_attempt(dismissed) is AttemptOutcome.DISMISSED
    assert not is_scored_learning_attempt(dismissed)


@pytest.mark.parametrize("support_level", [1, 2, 3, 4])
def test_supported_or_revealed_attempts_are_not_independent(support_level):
    attempt = {
        "attempt_type": "answer",
        "question_id": "q-supported",
        "correct": True,
        "support_level": support_level,
    }
    if support_level == 4:
        attempt["used_show_answer"] = True
    assert not is_independent_learning_attempt(attempt)


def test_explicit_support_zero_is_independent_only_without_reveal():
    attempt = {
        "attempt_type": "answer",
        "question_id": "q-independent",
        "correct": True,
        "support_level": 0,
    }
    assert is_independent_learning_attempt(attempt)
    assert not is_independent_learning_attempt({**attempt, "used_show_answer": True})


def test_missing_legacy_support_metadata_is_unknown_not_independent():
    assert not is_independent_learning_attempt({
        "attempt_type": "answer",
        "question_id": "q-legacy",
        "correct": True,
    })


def test_independent_predicate_requires_a_scored_outcome():
    assert not is_independent_learning_attempt({
        "attempt_type": "answer",
        "question_id": "q-pending",
        "correct": False,
        "outcome": "pending",
        "support_level": 0,
    })
