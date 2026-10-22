"""Shared attempt outcome and physical-identity helpers.

The tutoring runtime historically stored uncertain, blank, and dismissed work with
``correct=False``.  These helpers preserve the legacy fields while deriving a
single trustworthy interpretation for learning analytics, review queues, BKT,
and mistake aggregation.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime
from enum import Enum
from typing import Iterable, Mapping, MutableMapping


class AttemptOutcome(str, Enum):
    CORRECT = "correct"
    INCORRECT = "incorrect"
    PENDING = "pending"
    UNANSWERED = "unanswered"
    DISMISSED = "dismissed"


_PENDING_ERROR_TYPES = {
    "parent_review_pending",
    "grading_deferred",
    "llm_unavailable",
    "llm_error",
    "marking_unavailable",
    "review_pending",
    "unscored",
}
_UNANSWERED_ERROR_TYPES = {
    "unanswered",
    "not_answered",
    "empty_response",
    "in_progress",
    "exam_unanswered",
}
_DISMISSED_ERROR_TYPES = {
    "dismissed",
    "manual_dismissed",
    "parent_dismissed",
}
# The student chose "I don't know": a scored miss with no answer to repair.
DONT_KNOW_ERROR_TYPE = "dont_know"


def _normalise_outcome(value: object) -> AttemptOutcome | None:
    if isinstance(value, AttemptOutcome):
        return value
    if isinstance(value, str):
        try:
            return AttemptOutcome(value.strip().lower())
        except ValueError:
            return None
    return None


def classify_part_result(part: Mapping[str, object]) -> AttemptOutcome:
    """Classify one persisted multi-part result."""
    explicit = _normalise_outcome(part.get("outcome"))
    if explicit is not None:
        return explicit

    error_type = str(part.get("error_type") or "").strip().lower()
    if error_type in _PENDING_ERROR_TYPES or bool(part.get("grading_deferred")):
        return AttemptOutcome.PENDING
    if error_type in _DISMISSED_ERROR_TYPES or bool(part.get("dismissed")):
        return AttemptOutcome.DISMISSED
    if error_type in _UNANSWERED_ERROR_TYPES:
        return AttemptOutcome.UNANSWERED

    if "student_answer" in part and not str(part.get("student_answer") or "").strip():
        return AttemptOutcome.UNANSWERED
    return AttemptOutcome.CORRECT if bool(part.get("is_correct", part.get("correct", False))) else AttemptOutcome.INCORRECT


def classify_attempt(attempt: Mapping[str, object]) -> AttemptOutcome:
    """Derive the semantic outcome of an attempt without mutating it.

    Explicit new-format ``outcome`` values win.  Legacy error markers, deferred
    flags, blank submitted answers, and per-part states are then interpreted in
    that order.  Missing ``student_answer`` is not treated as blank because old
    imported/diagnostic rows did not always persist it.
    """
    explicit = _normalise_outcome(attempt.get("outcome"))
    if explicit is not None:
        return explicit

    error_type = str(attempt.get("error_type") or "").strip().lower()
    if error_type in _PENDING_ERROR_TYPES or bool(attempt.get("grading_deferred")):
        return AttemptOutcome.PENDING
    if error_type in _DISMISSED_ERROR_TYPES or bool(attempt.get("dismissed")):
        return AttemptOutcome.DISMISSED
    if error_type in _UNANSWERED_ERROR_TYPES:
        return AttemptOutcome.UNANSWERED

    part_results = attempt.get("part_results")
    if isinstance(part_results, list) and part_results:
        outcomes = [
            classify_part_result(part)
            for part in part_results
            if isinstance(part, Mapping)
        ]
        if outcomes:
            if AttemptOutcome.PENDING in outcomes:
                return AttemptOutcome.PENDING
            if AttemptOutcome.UNANSWERED in outcomes:
                return AttemptOutcome.UNANSWERED
            if AttemptOutcome.INCORRECT in outcomes:
                return AttemptOutcome.INCORRECT
            if all(outcome == AttemptOutcome.DISMISSED for outcome in outcomes):
                return AttemptOutcome.DISMISSED
            if all(outcome in {AttemptOutcome.CORRECT, AttemptOutcome.DISMISSED} for outcome in outcomes):
                return AttemptOutcome.CORRECT

    if "student_answer" in attempt and not str(attempt.get("student_answer") or "").strip():
        return AttemptOutcome.UNANSWERED

    correct_value = attempt.get("correct", attempt.get("is_correct", False))
    return AttemptOutcome.CORRECT if bool(correct_value) else AttemptOutcome.INCORRECT


def is_scored_learning_attempt(attempt: Mapping[str, object]) -> bool:
    """Return True only for a real, scored answer/diagnostic observation."""
    if str(attempt.get("attempt_type") or "answer") not in {"answer", "diagnostic"}:
        return False
    if bool(attempt.get("is_speed_round")):
        return False
    return classify_attempt(attempt) in {AttemptOutcome.CORRECT, AttemptOutcome.INCORRECT}


def is_independent_learning_attempt(attempt: Mapping[str, object]) -> bool:
    """Return True only for explicit, unaided learning evidence.

    Independent-only claims must not infer support level zero for legacy rows:
    old records may omit ``support_level`` entirely, so their provenance is
    unknown.  Show Answer is independently disqualifying even if a malformed or
    legacy row also reports level zero.
    """
    if not is_scored_learning_attempt(attempt):
        return False
    if bool(attempt.get("used_show_answer")):
        return False
    if "support_level" not in attempt or attempt.get("support_level") is None:
        return False
    try:
        return float(attempt.get("support_level")) == 0.0
    except (TypeError, ValueError):
        return False


def counts_as_right(attempt: Mapping[str, object]) -> bool:
    """A right answer that counts as evidence.

    A right answer that the student marked "guess" does not count as right:
    not for mastery, Today steps, or Error Book steps.
    """
    return (
        classify_attempt(attempt) is AttemptOutcome.CORRECT
        and attempt.get("confidence") != "guess"
    )


def is_error_book_closure_evidence(attempt: Mapping[str, object], source_question_id: str) -> bool:
    """A right first try, with no help and no guess, on a fair new question for this mistake."""
    return (
        attempt.get("review_source") == "error_book"
        and str(attempt.get("review_question_id") or "") == str(source_question_id)
        and is_scored_learning_attempt(attempt)
        and counts_as_right(attempt)
        and is_independent_learning_attempt(attempt)
        # A right answer after "Not right yet" is practice, not transfer.
        and attempt.get("first_attempt") is not False
        and bool((attempt.get("review_match") or {}).get("eligible"))
    )


def _timestamp_bucket(value: object) -> str:
    """Normalise legacy fan-out timestamps to one-second resolution."""
    text = str(value or "")
    if not text:
        return ""
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed.replace(microsecond=0).isoformat()
    except (TypeError, ValueError):
        return text


def physical_attempt_key(attempt: Mapping[str, object]) -> str:
    """Return a stable physical-attempt identity for new and legacy rows."""
    attempt_id = str(attempt.get("attempt_id") or "").strip()
    if attempt_id:
        return f"id:{attempt_id}"

    legacy_payload = {
        "question_id": str(attempt.get("question_id") or ""),
        "timestamp": _timestamp_bucket(attempt.get("timestamp")),
        "student_answer": str(attempt.get("student_answer") or "").strip(),
        "attempt_type": str(attempt.get("attempt_type") or "answer"),
        "question_type": str(attempt.get("question_type") or ""),
    }
    digest = hashlib.sha256(
        json.dumps(legacy_payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    return f"legacy:{digest}"


def part_review_key(attempt: Mapping[str, object], part_label: str | None = None) -> str:
    """Return the stable review identity for a whole attempt or one subpart."""
    suffix = str(part_label or "").strip().lower() or "whole"
    return f"{physical_attempt_key(attempt)}::{suffix}"


def _preferred_copy(current: Mapping[str, object], candidate: Mapping[str, object]) -> Mapping[str, object]:
    """Prefer the primary/richer copy when one physical event was fanned out."""
    try:
        current_weight = float(current.get("weight", 1.0))
    except (TypeError, ValueError):
        current_weight = 1.0
    try:
        candidate_weight = float(candidate.get("weight", 1.0))
    except (TypeError, ValueError):
        candidate_weight = 1.0
    if candidate_weight != current_weight:
        return candidate if candidate_weight > current_weight else current
    if len(candidate) != len(current):
        return candidate if len(candidate) > len(current) else current
    return candidate if str(candidate.get("timestamp") or "") >= str(current.get("timestamp") or "") else current


def deduplicate_attempts(attempts: Iterable[Mapping[str, object]]) -> list[dict]:
    """Collapse topic fan-out copies while preserving first-seen event order."""
    order: list[str] = []
    selected: dict[str, Mapping[str, object]] = {}
    for attempt in attempts:
        key = physical_attempt_key(attempt)
        if key not in selected:
            order.append(key)
            selected[key] = attempt
        else:
            selected[key] = _preferred_copy(selected[key], attempt)
    return [dict(selected[key]) for key in order]


def persist_outcome(record: MutableMapping[str, object]) -> AttemptOutcome:
    """Derive and store ``outcome`` on a mutable record."""
    outcome = classify_attempt(record)
    record["outcome"] = outcome.value
    return outcome


def part_error_entries(attempt: Mapping[str, object]) -> list[dict]:
    """Return the wrong sub-part answers recorded on one multi-part attempt.

    Progressive multi-part answers update one attempt in place, so a later fix
    replaces a wrong part in ``part_results``. ``part_error_history`` keeps
    the earlier wrong parts; parts that are still wrong come from
    ``part_results``. Each label and answer pair appears once, oldest first.
    """
    history = attempt.get("part_error_history")
    current = attempt.get("part_results")
    candidates = [
        *(history if isinstance(history, list) else []),
        *(
            part
            for part in (current if isinstance(current, list) else [])
            if isinstance(part, Mapping)
            and classify_part_result(part) is AttemptOutcome.INCORRECT
        ),
    ]
    entries: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for part in candidates:
        if not isinstance(part, Mapping):
            continue
        label = str(part.get("label") or "").strip()
        answer = str(part.get("student_answer") or "").strip()
        key = (label.lower(), answer)
        if not label or not answer or key in seen:
            continue
        seen.add(key)
        entries.append({
            "label": label,
            "student_answer": answer,
            "error_type": part.get("error_type"),
            "recorded_at": part.get("recorded_at"),
        })
    return entries


def part_error_snapshot(attempt: Mapping[str, object]) -> dict | None:
    """Return an incorrect view of a multi-part attempt with wrong parts.

    The view is only for the Error Book. It applies when the whole attempt is
    not incorrect (other parts are blank or pending, or the wrong part was fixed
    later) but a part was judged wrong. Its answer shows only the wrong parts.
    Mastery evidence still uses the real attempt outcome.
    """
    if (
        str(attempt.get("attempt_type") or "answer") not in {"answer", "diagnostic"}
        or bool(attempt.get("is_speed_round"))
        or attempt.get("error_book_eligible") is False
        or classify_attempt(attempt) in {AttemptOutcome.INCORRECT, AttemptOutcome.DISMISSED}
    ):
        return None
    wrong_parts = part_error_entries(attempt)
    if not wrong_parts:
        return None
    latest_answers: dict[str, str] = {}
    for entry in wrong_parts:
        latest_answers[entry["label"]] = entry["student_answer"]
    recorded = [str(entry["recorded_at"]) for entry in wrong_parts if entry.get("recorded_at")]
    return {
        **attempt,
        "outcome": AttemptOutcome.INCORRECT.value,
        "correct": False,
        "error_type": "partial_incorrect",
        "student_answer": json.dumps(latest_answers, ensure_ascii=False),
        "updated_at": max(recorded) if recorded else attempt.get("updated_at"),
    }


def confirmed_error_view(attempt: Mapping[str, object]) -> dict | None:
    """Return the attempt as confirmed Error Book evidence, or ``None``.

    An "I don't know" answer is a miss, but it has no error to repair, so it is
    not Error Book evidence.
    """
    if is_dont_know_attempt(attempt):
        return None
    if is_scored_learning_attempt(attempt) and classify_attempt(attempt) is AttemptOutcome.INCORRECT:
        return dict(attempt)
    return part_error_snapshot(attempt)


def is_dont_know_attempt(attempt: Mapping[str, object]) -> bool:
    """True for an answer the student gave up on with "I don't know"."""
    return str(attempt.get("error_type") or "").strip().lower() == DONT_KNOW_ERROR_TYPE
