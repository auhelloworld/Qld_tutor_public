"""Evidence-readiness gate for new English and Science misconceptions.

The production misconception library must not be expanded from a generic list of
plausible errors.  This module aggregates only confirmed, scored, deduplicated
student errors and reports whether a small subject-specific authoring batch is
supported by enough repeated evidence across different questions.
"""
from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping

from backend.sqlite_utils import connect_sqlite
from backend.services.attempt_outcomes import (
    AttemptOutcome,
    classify_attempt,
    deduplicate_attempts,
    is_dont_know_attempt,
    is_scored_learning_attempt,
    physical_attempt_key,
)


DEFAULT_SUBJECTS = ("english", "science")
_GENERIC_ERROR_TYPES = {
    "incorrect_choice",
    "incorrect_value",
    "incomplete_answer",
    "reasoning_incomplete",
    "concept_gap",
    "parent_review_rejected",
    "partial_credit",
    "unknown",
    "",
}


@dataclass(frozen=True)
class MisconceptionEvidenceCandidate:
    subject: str
    primary_topic_id: str
    evidence_code: str
    evidence_kind: str
    error_count: int
    distinct_questions: int
    distinct_students: int
    confidence: float
    ready_for_authoring: bool
    question_ids: tuple[str, ...]
    example_answers: tuple[str, ...]

    def as_dict(self) -> dict[str, Any]:
        return {
            "subject": self.subject,
            "primary_topic_id": self.primary_topic_id,
            "evidence_code": self.evidence_code,
            "evidence_kind": self.evidence_kind,
            "error_count": self.error_count,
            "distinct_questions": self.distinct_questions,
            "distinct_students": self.distinct_students,
            "confidence": self.confidence,
            "ready_for_authoring": self.ready_for_authoring,
            "question_ids": list(self.question_ids),
            "example_answers": list(self.example_answers),
        }


@dataclass(frozen=True)
class MisconceptionEvidenceReport:
    subjects: tuple[str, ...]
    candidates: tuple[MisconceptionEvidenceCandidate, ...]
    readiness: dict[str, bool]
    confirmed_errors: dict[str, int]
    reason: dict[str, str]

    @property
    def all_ready(self) -> bool:
        return all(self.readiness.get(subject, False) for subject in self.subjects)

    def as_dict(self) -> dict[str, Any]:
        return {
            "subjects": list(self.subjects),
            "readiness": dict(self.readiness),
            "confirmed_errors": dict(self.confirmed_errors),
            "reason": dict(self.reason),
            "all_ready": self.all_ready,
            "candidates": [candidate.as_dict() for candidate in self.candidates],
        }


def _primary_topic(question: Mapping[str, Any] | None, fallback_topic: str) -> str:
    if question:
        for topic_id in question.get("topic_ids") or []:
            if isinstance(topic_id, str) and topic_id.strip():
                return topic_id.strip()
    return fallback_topic


def _specificity(evidence_kind: str, evidence_code: str) -> float:
    if evidence_kind == "misconception_id":
        return 0.80
    if evidence_code not in _GENERIC_ERROR_TYPES:
        return 0.62
    return 0.30


def analyse_misconception_evidence(
    logs: Iterable[tuple[str, str, Mapping[str, Any]]],
    exercises: Mapping[str, Mapping[str, Any]],
    *,
    subjects: Iterable[str] = DEFAULT_SUBJECTS,
    min_errors: int = 5,
    min_distinct_questions: int = 3,
    min_confidence: float = 0.72,
) -> MisconceptionEvidenceReport:
    """Aggregate trustworthy misconception candidates from loaded logs.

    ``logs`` entries are ``(student_id, storage_subject, log_payload)``.  The
    thresholds are suitable for this single-student product: repetition across
    different questions matters more than repetition across different students.
    """
    subject_set = {str(subject).lower() for subject in subjects}
    buckets: dict[tuple[str, str, str, str], dict[str, Any]] = defaultdict(
        lambda: {
            "errors": 0,
            "questions": set(),
            "students": set(),
            "answers": [],
        }
    )
    confirmed_errors: dict[str, int] = {subject: 0 for subject in subject_set}

    for student_id, storage_subject, log in logs:
        storage_subject = str(storage_subject).lower()
        raw_attempts = [
            (str(topic_id), attempt)
            for topic_id, topic_data in log.get("topics", {}).items()
            if isinstance(topic_data, Mapping)
            for attempt in topic_data.get("attempts", [])
            if isinstance(attempt, Mapping)
        ]
        topic_by_attempt_key = {
            physical_attempt_key(attempt): topic_id
            for topic_id, attempt in raw_attempts
        }
        physical_attempts = deduplicate_attempts(
            attempt for _, attempt in raw_attempts
        )
        for attempt in physical_attempts:
            if not is_scored_learning_attempt(attempt):
                continue
            if classify_attempt(attempt) is not AttemptOutcome.INCORRECT:
                continue
            # "I don't know" has no wrong answer, so it is no misconception.
            if is_dont_know_attempt(attempt):
                continue

            question_id = str(attempt.get("question_id") or "")
            question = exercises.get(question_id)
            subject = str((question or {}).get("subject") or storage_subject).lower()
            if subject not in subject_set:
                continue

            confirmed_errors[subject] = confirmed_errors.get(subject, 0) + 1
            fallback_topic = topic_by_attempt_key.get(
                physical_attempt_key(attempt),
                "",
            )
            primary_topic_id = _primary_topic(question, fallback_topic)

            misconception_id = str(attempt.get("misconception_id") or "").strip()
            error_type = str(attempt.get("error_type") or "").strip()
            if misconception_id:
                evidence_kind = "misconception_id"
                evidence_code = misconception_id
            else:
                evidence_kind = "error_type"
                evidence_code = error_type or "unknown"

            key = (subject, primary_topic_id, evidence_kind, evidence_code)
            bucket = buckets[key]
            bucket["errors"] += 1
            if question_id:
                bucket["questions"].add(question_id)
            bucket["students"].add(str(student_id))
            answer = str(attempt.get("student_answer") or "").strip()
            if answer and answer not in bucket["answers"] and len(bucket["answers"]) < 5:
                bucket["answers"].append(answer[:240])

    candidates: list[MisconceptionEvidenceCandidate] = []
    for (subject, topic_id, evidence_kind, evidence_code), bucket in buckets.items():
        error_count = int(bucket["errors"])
        distinct_questions = len(bucket["questions"])
        distinct_students = len(bucket["students"])
        confidence = _specificity(evidence_kind, evidence_code)
        confidence += min(0.10, distinct_questions * 0.025)
        confidence += min(0.05, max(0, error_count - 1) * 0.01)
        confidence += min(0.03, max(0, distinct_students - 1) * 0.01)
        confidence = round(min(confidence, 0.95), 2)
        ready = bool(
            error_count >= min_errors
            and distinct_questions >= min_distinct_questions
            and confidence >= min_confidence
            and (
                evidence_kind == "misconception_id"
                or evidence_code not in _GENERIC_ERROR_TYPES
            )
        )
        candidates.append(
            MisconceptionEvidenceCandidate(
                subject=subject,
                primary_topic_id=topic_id,
                evidence_code=evidence_code,
                evidence_kind=evidence_kind,
                error_count=error_count,
                distinct_questions=distinct_questions,
                distinct_students=distinct_students,
                confidence=confidence,
                ready_for_authoring=ready,
                question_ids=tuple(sorted(bucket["questions"])),
                example_answers=tuple(bucket["answers"]),
            )
        )

    candidates.sort(
        key=lambda candidate: (
            candidate.subject,
            -int(candidate.ready_for_authoring),
            -candidate.confidence,
            -candidate.error_count,
            candidate.primary_topic_id,
            candidate.evidence_code,
        )
    )

    readiness: dict[str, bool] = {}
    reason: dict[str, str] = {}
    for subject in sorted(subject_set):
        ready_candidates = [
            candidate
            for candidate in candidates
            if candidate.subject == subject and candidate.ready_for_authoring
        ]
        readiness[subject] = bool(ready_candidates)
        if ready_candidates:
            reason[subject] = (
                f"{len(ready_candidates)} repeated high-confidence candidate(s) are ready "
                "for a small reviewed authoring batch."
            )
        elif confirmed_errors.get(subject, 0) == 0:
            reason[subject] = "No confirmed scored errors are available."
        else:
            reason[subject] = (
                "Confirmed errors exist, but none repeat across enough different questions "
                "with a sufficiently specific error or misconception signal."
            )

    return MisconceptionEvidenceReport(
        subjects=tuple(sorted(subject_set)),
        candidates=tuple(candidates),
        readiness=readiness,
        confirmed_errors=confirmed_errors,
        reason=reason,
    )


def load_log_records(
    logs_root: Path,
    *,
    subjects: Iterable[str] = DEFAULT_SUBJECTS,
) -> list[tuple[str, str, Mapping[str, Any]]]:
    """Load StudyRuleEngine records from SQLite without scanning legacy JSON."""
    subject_set = {str(subject).lower() for subject in subjects}
    db_path = logs_root.parent / "qld_tutor.db"
    if not db_path.is_file() or not subject_set:
        return []
    placeholders = ",".join("?" for _ in subject_set)
    try:
        conn = connect_sqlite(f"file:{db_path}?mode=ro", uri=True)
        try:
            rows = conn.execute(
                f"""
                SELECT student_id, subject, topic, extra
                FROM attempts
                WHERE subject IN ({placeholders})
                ORDER BY student_id, subject, id
                """,
                tuple(sorted(subject_set)),
            ).fetchall()
        finally:
            conn.close()
    except sqlite3.Error:
        return []

    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    for student_id, subject, topic, raw in rows:
        try:
            attempt = json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            continue
        if not isinstance(attempt, dict):
            continue
        key = (str(student_id), str(subject))
        payload = grouped.setdefault(
            key, {"student_id": str(student_id), "topics": {}}
        )
        payload["topics"].setdefault(
            str(topic), {"attempts": [], "accuracy": 0.0}
        )["attempts"].append(attempt)
    return [
        (student_id, subject, payload)
        for (student_id, subject), payload in sorted(grouped.items())
    ]
