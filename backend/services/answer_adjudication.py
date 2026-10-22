"""One-way LLM adjudication for exam and diagnostic marking.

Exams and diagnostics grade maths values deterministically first, which is the right
baseline: the same answer must always earn the same mark, a paper or diagnostic
must not become harsher because a provider was slow, and marking must keep working
offline. After a deterministic miss, an optional second opinion can only upgrade an
explicitly confirmed equivalent answer.

The cost of deterministic-only marking is false negatives. An authored answer such as
``'Estimate $80$; actual $80.36$; error $0.36$.'`` cannot be matched by any
normaliser, so a student who answers correctly loses the mark with no review path
— in the one setting where the mark matters most.

This module keeps the deterministic verdict authoritative and adds a strictly
one-way second opinion:

* it is only consulted **after** deterministic marking has said "wrong";
* it can only ever turn "wrong" into "right", never the reverse, so marking can
  never become harsher than it is today;
* any absence of a verdict — no provider, an error, a timeout, a deferral —
  leaves the deterministic result untouched;
* it is limited to non-open short answers. Open and explain-style items already
  have their own review-deferring path, and MCQ/multi-part comparisons are exact.

Because an upgrade depends on a model, an adjudicated mark is flagged so it can be
audited rather than silently trusted.
"""
from __future__ import annotations

import logging
import os
import re
import time
from typing import Literal

from backend.services.marking import demands_written_reasoning, is_text_graded

LOG = logging.getLogger(__name__)

_TRUTHY = {"1", "true", "yes", "on"}
_MATH_SIGNAL_RE = re.compile(
    r"(?:\d|[=+\-*/^%√π]|\\(?:frac|sqrt)|"
    r"\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|half|third|quarter)\b)",
    re.IGNORECASE,
)

def has_math_signal(text: str | None) -> bool:
    """True when a string carries a number, maths operator or number word.

    Distinguishes a closed mathematical answer from a word/phrase answer such as
    ``"Trapezium"``. A word answer is not evidence that a numeric comparison
    failed, so callers must not treat one as a conclusive miss.
    """
    return bool(_MATH_SIGNAL_RE.search(text or ""))


def adjudication_enabled() -> bool:
    """Whether a locally-rejected answer may be sent for a second opinion.

    Defaults to enabled: today's behaviour marks demonstrably correct answers
    wrong, which is a worse failure than depending on a provider for an upgrade.
    Set ``EXAM_LLM_ADJUDICATION=false`` to keep exams and diagnostics fully
    deterministic, including after a local rejection.
    """
    raw = os.getenv("EXAM_LLM_ADJUDICATION")
    if raw is None:
        return True
    return raw.strip().lower() in _TRUTHY


def is_adjudicable(exercise: dict) -> bool:
    """True for the item shapes where a second opinion is meaningful and safe."""
    if exercise.get("question_type") != "short_answer":
        return False
    if is_text_graded(exercise.get("subject")):
        return False  # already routed through the open-response path
    if demands_written_reasoning(exercise):
        return False  # no single enumerable answer; belongs in review
    return True


AdjudicationOutcome = Literal["confirmed", "rejected", "unavailable", "disabled"]


def deterministic_rejection_is_conclusive(exercise: dict, student_answer: str) -> bool:
    """Whether local grading proved a closed maths answer is different.

    Simple numeric/unit values and demonstrably different symbolic expressions
    are authoritative. Compound or prose-shaped value answers remain
    inconclusive so an unavailable adjudicator cannot silently create a false
    negative.
    """
    if not is_adjudicable(exercise) or not isinstance(student_answer, str):
        return True

    from backend.answer_normalize import normalise, symbolic_mismatch_kind

    accepted = [exercise.get("answer", ""), *(exercise.get("alternative_answers") or [])]
    accepted = [value for value in accepted if isinstance(value, str) and value.strip()]
    if not accepted:
        return False

    # A student answer with no maths signal (no digit, operator or number word)
    # is only a *conclusive* miss when every accepted form is itself a
    # mathematical value. When any accepted key is a word or phrase — e.g. the
    # geometry answer "Trapezium" — a word answer such as "a trapezium" is a
    # plausible equivalent, so it must stay eligible for the one-way second
    # opinion instead of being force-failed by exact text matching. Expressions,
    # numbers, units and number words remain eligible because their formatting
    # may be recoverable.
    if not has_math_signal(student_answer):
        return all(has_math_signal(value) for value in accepted)

    student = normalise(student_answer)
    student_is_value = student.decimal is not None or student.value_with_unit is not None
    for correct_answer in accepted:
        correct = normalise(correct_answer)
        correct_is_value = correct.decimal is not None or correct.value_with_unit is not None
        if student_is_value and correct_is_value:
            continue
        if symbolic_mismatch_kind(student_answer, correct_answer):
            continue
        return False
    return True


def adjudicate_equivalence(
    exercise: dict,
    student_answer: str,
    *,
    student_id: str | None = None,
    deadline: float | None = None,
) -> AdjudicationOutcome:
    """Return an explicit second-opinion outcome without collapsing failures.

    ``unavailable`` lets Diagnostic defer an inconclusive response, while exam
    callers can preserve their existing deterministic fallback. ``disabled``
    honours the operator's explicit fully-deterministic configuration.
    """
    if not adjudication_enabled():
        return "disabled"
    if not is_adjudicable(exercise) or not isinstance(student_answer, str) or not student_answer.strip():
        return "unavailable"
    if deterministic_rejection_is_conclusive(exercise, student_answer):
        return "rejected"
    if deadline is not None and time.monotonic() >= deadline:
        return "unavailable"

    try:
        from backend.routers.helpers import get_tutor_engine

        engine = get_tutor_engine()
        if not getattr(engine, "client", None):
            return "unavailable"
        result = engine._mark_short_answer(
            exercise,
            student_answer,
            student_id=student_id,
            deadline=deadline,
        )
    except Exception as exc:  # pragma: no cover - provider/runtime failures
        LOG.warning("Equivalence adjudication unavailable: %s", exc)
        return "unavailable"

    if not isinstance(result, dict) or result.get("error_type") == "parent_review_pending":
        return "unavailable"
    return "confirmed" if result.get("is_correct") else "rejected"


def confirms_equivalence(
    exercise: dict,
    student_answer: str,
    *,
    student_id: str | None = None,
    deadline: float | None = None,
) -> bool:
    """Return True only when a second opinion confirms equivalence."""
    return adjudicate_equivalence(
        exercise, student_answer, student_id=student_id, deadline=deadline
    ) == "confirmed"


def grade_with_adjudication(
    exercise: dict,
    student_answer: str,
    *,
    student_id: str | None = None,
    deterministic_result: bool | None = None,
    deadline: float | None = None,
) -> tuple[bool, bool]:
    """Grade deterministically, then allow a one-way upgrade.

    Returns ``(is_correct, adjudicated)`` where ``adjudicated`` records that the
    mark was changed by a model rather than by the deterministic rules.
    """
    from backend.answer_grading import grade_answer

    if deterministic_result is None:
        deterministic_result = grade_answer(exercise, student_answer)
    if deterministic_result:
        return True, False
    if confirms_equivalence(exercise, student_answer, student_id=student_id, deadline=deadline):
        LOG.info(
            "Adjudicated upgrade for %s: deterministic marking rejected the answer",
            exercise.get("id"),
        )
        return True, True
    return False, False
