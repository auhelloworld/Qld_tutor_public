"""Today topic facts: what to learn next, prerequisites, and time per question."""

import pytest

from backend.services.today_topics import (
    build_topic_facts,
    default_question_minutes,
    question_minutes_by_topic,
)


def _facts(**overrides):
    kwargs = dict(
        order=["T1", "T2", "T3", "T4"],
        mastered=[],
        prerequisites={"T2": ["T1"], "T3": ["T2", "OUTSIDE"]},
    )
    kwargs.update(overrides)
    return build_topic_facts(**kwargs)


def test_only_prerequisites_inside_the_scope_count():
    facts = _facts()

    assert facts.prerequisites["T3"] == ("T2",)
    assert facts.missing_prerequisites("T3") == ["T2"]
    assert facts.missing_prerequisites("T1") == []


def test_next_topic_is_the_first_open_topic_with_its_prerequisites_met():
    assert _facts().next_topic() == "T1"
    assert _facts(mastered=["T1"]).next_topic() == "T2"
    # T1 is open, so T2 must wait; T4 does not need T1.
    assert _facts().next_topic(exclude=["T1"]) == "T4"


def test_a_secure_diagnostic_topic_counts_as_a_met_prerequisite():
    facts = _facts(order=["T2", "T1"], satisfied=["T1"])

    assert facts.missing_prerequisites("T2") == []
    assert facts.next_topic() == "T2"


def test_next_topic_falls_back_to_the_first_open_topic():
    # A cycle: no topic has its prerequisites met.
    facts = _facts(order=["A", "B"], prerequisites={"A": ["B"], "B": ["A"]})

    assert facts.next_topic() == "A"
    assert build_topic_facts(
        order=["A", "B"], mastered=[], prerequisites={"A": ["B"], "B": ["A"]}, strict=True,
    ).next_topic() is None


def test_no_topic_when_every_topic_is_mastered():
    assert _facts(mastered=["T1", "T2", "T3", "T4"]).next_topic() is None


@pytest.mark.parametrize("scope,minutes", [("year7", 2.0), ("year8", 2.0), ("year9", 2.5), ("year10", 2.5), ("unit3", 4.0)])
def test_default_minutes_per_question_grow_with_the_stage(scope, minutes):
    assert default_question_minutes(scope) == minutes


def test_minutes_per_question_come_from_the_question_types_of_each_topic():
    questions = {
        "T1": [{"question_type": "multiple_choice"}, {"question_type": "short_answer"}],
        "T2": [{"question_type": "reasoning"}],
        "T3": [],
    }

    assert question_minutes_by_topic(questions, "year7") == {"T1": 1.5, "T2": 4.0}
    assert question_minutes_by_topic(questions, "unit1") == {"T1": 3.0, "T2": 7.0}
