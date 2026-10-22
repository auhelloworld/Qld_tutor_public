"""Topic facts for Today plans: what to learn next, prerequisites, and time per question."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field


@dataclass(frozen=True)
class TopicFacts:
    """Topics of one Today scope (a year or a senior unit) in teaching order.

    ``prerequisites`` keeps only prerequisites inside the scope: work from an
    earlier year or unit is not a gate. ``satisfied`` holds topics that a
    diagnostic found secure; they count as met prerequisites. A ``strict``
    sequence has no fallback when no topic has its prerequisites met.
    """

    order: tuple[str, ...]
    mastered: frozenset[str] = frozenset()
    prerequisites: Mapping[str, tuple[str, ...]] = field(default_factory=dict)
    satisfied: frozenset[str] = frozenset()
    strict: bool = False

    def missing_prerequisites(self, topic_id: str) -> list[str]:
        """Prerequisites of ``topic_id`` in this scope that are not met yet."""
        return [
            prerequisite
            for prerequisite in self.prerequisites.get(topic_id, ())
            if prerequisite not in self.mastered and prerequisite not in self.satisfied
        ]

    def next_topic(self, *, exclude: Iterable[str] = ()) -> str | None:
        """The topic to learn next: not mastered, and its prerequisites are met.

        A topic that is not mastered blocks only the topics that need it. When
        no topic has its prerequisites met, the first topic that is not mastered
        is used (not for a strict sequence), so the student always has a topic.
        """
        skip = set(exclude)
        first_open = None
        for topic_id in self.order:
            if topic_id in self.mastered or topic_id in skip:
                continue
            if first_open is None:
                first_open = topic_id
            if not self.missing_prerequisites(topic_id):
                return topic_id
        return None if self.strict else first_open


def build_topic_facts(
    *,
    order: Iterable[str],
    mastered: Iterable[str],
    prerequisites: Mapping[str, Iterable[str]],
    satisfied: Iterable[str] = (),
    strict: bool = False,
) -> TopicFacts:
    """Facts for the topics in ``order``. Prerequisites outside the scope are dropped."""
    ordered = tuple(dict.fromkeys(order))
    in_scope = set(ordered)
    scoped_prerequisites = {}
    for topic_id in ordered:
        needed = tuple(
            prerequisite
            for prerequisite in prerequisites.get(topic_id, ())
            if prerequisite in in_scope and prerequisite != topic_id
        )
        if needed:
            scoped_prerequisites[topic_id] = needed
    return TopicFacts(
        order=ordered,
        mastered=frozenset(topic for topic in mastered if topic in in_scope),
        prerequisites=scoped_prerequisites,
        satisfied=frozenset(topic for topic in satisfied if topic in in_scope),
        strict=strict,
    )


# debt: these are estimates by question type and study stage, not measured times.
# Upgrade path: record how long each answer takes and use the median per topic.
QUESTION_MINUTES = {
    "years7_8": {"multiple_choice": 1.0, "short_answer": 2.0, "multi_part": 4.0, "reasoning": 4.0},
    "years9_10": {"multiple_choice": 1.5, "short_answer": 2.5, "multi_part": 5.0, "reasoning": 5.0},
    "senior": {"multiple_choice": 2.0, "short_answer": 4.0, "multi_part": 7.0, "reasoning": 7.0},
}
_DEFAULT_MINUTES = {"years7_8": 2.0, "years9_10": 2.5, "senior": 4.0}


def study_stage(scope: str) -> str:
    """``years7_8``, ``years9_10`` or ``senior`` for a ``yearN`` or ``unitN`` scope."""
    if scope.startswith("unit"):
        return "senior"
    year = scope.removeprefix("year")
    return "years9_10" if year.isdigit() and int(year) >= 9 else "years7_8"


def default_question_minutes(scope: str) -> float:
    """Minutes for one question when the topic's question types are not known."""
    return _DEFAULT_MINUTES[study_stage(scope)]


def question_minutes_by_topic(
    questions_by_topic: Mapping[str, Iterable[Mapping]],
    scope: str,
) -> dict[str, float]:
    """Mean minutes per question for each topic, from the types of its questions."""
    stage = study_stage(scope)
    table = QUESTION_MINUTES[stage]
    default = _DEFAULT_MINUTES[stage]
    minutes: dict[str, float] = {}
    for topic_id, questions in questions_by_topic.items():
        values = [table.get(str(question.get("question_type") or ""), default) for question in questions]
        if values:
            minutes[topic_id] = round(sum(values) / len(values), 1)
    return minutes
