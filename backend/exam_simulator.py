"""Mock Exam Simulator.

Builds a timed exam paper from the exercise pool, tracks responses,
and produces a post-exam report with per-strand analysis.

Exam structure mirrors QCE Year 7 Maths assessment:
- Section A: Multiple Choice (if available, else short_answer)
- Section B: Short Response
- Section C: Extended Response / Reasoning (if available)

Default: 20 questions, 45 minutes.
"""
from __future__ import annotations

import json
import logging
import os
import random
import time
import uuid
from collections.abc import Iterable
from datetime import datetime, timedelta, timezone
from functools import lru_cache

from backend.answer_grading import correct_answer_for_display, grade_answer, grade_multi_part_details
from backend.subject_registry import is_text_graded
from backend.services.marking import demands_written_reasoning
from backend.curriculum_loader import CurriculumLoader, get_shared_loader
from backend.rules import get_engine
from backend.services.attempt_outcomes import AttemptOutcome, classify_part_result
from core.algorithms.reasoning_rubric import normalise_reasoning_rubric

logger = logging.getLogger(__name__)

# Grace window for network latency after the immutable deadline.
LATE_SUBMIT_GRACE_SECONDS = 15
# The whole paper shares one monotonic budget. Provider calls receive only the
# remaining portion so a serial paper cannot exceed the advertised server limit.
DEFAULT_EXAM_GRADING_TIMEOUT_SECONDS = 180.0


def _exam_grading_timeout_seconds() -> float:
    try:
        return max(1.0, float(os.getenv("EXAM_GRADING_TIMEOUT_SECONDS", str(DEFAULT_EXAM_GRADING_TIMEOUT_SECONDS))))
    except (TypeError, ValueError):
        return DEFAULT_EXAM_GRADING_TIMEOUT_SECONDS
# remain in one household's metadata forever. Imported papers are never covered
# by this cleanup because their source file provides a separate durable identity.
ABANDONED_GENERATED_SESSION_RETENTION_DAYS = 30
ABANDONED_GENERATED_SESSION_RETENTION = timedelta(days=ABANDONED_GENERATED_SESSION_RETENTION_DAYS)


def _prune_abandoned_generated_sessions(
    sessions: list[dict],
    *,
    now: datetime | None = None,
) -> list[dict]:
    """Return sessions retained under the conservative generated-paper TTL.

    Only incomplete generated sessions with a valid, sufficiently old
    ``started_at`` are removed. Completed sessions, imported-paper sessions,
    malformed timestamps, and future-dated timestamps are retained so cleanup
    cannot destroy a result or make uncertain legacy metadata disappear.
    """
    current = now or datetime.now(timezone.utc)
    retained: list[dict] = []
    for session in sessions:
        if not isinstance(session, dict):
            retained.append(session)
            continue
        if session.get("completed_at") or session.get("imported_from"):
            retained.append(session)
            continue
        started = _parse_iso(session.get("started_at"))
        if started is None or current - started <= ABANDONED_GENERATED_SESSION_RETENTION:
            retained.append(session)
            continue
        # This is an incomplete generated session older than the household
        # retention period. It contains no completed result to preserve.
    return retained


SUPPORTED_EXAM_TYPES_BY_SUBJECT = {
    "math": {
        "mixed",
        "naplan_numeracy", "fluency_check", "challenge_amc",
    },
    "mathematics": {
        "mixed",
        "naplan_numeracy", "fluency_check", "challenge_amc",
    },
    "english": {"mixed", "naplan_literacy", "reading", "language_conventions", "extended_response"},
    "science": {"mixed", "inquiry", "data_interpretation", "extended_response", "practical_reasoning"},
    # QCAA senior maths courses. Paper 1 = technology-free, Paper 2 =
    # technology-active (mirrors the external assessment structure), filtered
    # via ``math_metadata.technology_active``.
    "methods": {"mixed", "paper_1", "paper_2"},
    "general": {"mixed", "paper_1", "paper_2"},
    "specialist": {"mixed", "paper_1", "paper_2"},
    "essential": {"mixed", "paper_1", "paper_2"},
}


def _normalise_subject(subject: str | None) -> str:
    return (subject or "math").strip().lower()


def _exam_family(subject: str | None) -> str:
    """Map a storage subject to its exam family (math/english/science) using
    the central registry, so new senior courses inherit the right blueprints."""
    from backend.subject_registry import SUBJECTS

    info = SUBJECTS.get(_normalise_subject(subject))
    if info is None:
        return "math"
    if info.framework_id in ("AC9_ENGLISH", "QCAA_SENIOR_ENGLISH"):
        return "english"
    if info.framework_id in ("AC9_SCIENCE", "QCAA_SENIOR_SCIENCE"):
        return "science"
    return "math"


def _supported_exam_types(subject_key: str) -> set:
    """Supported exam types for a subject, falling back to its family's set so
    a newly added course (e.g. chemistry) gets sensible presets for free."""
    if subject_key in SUPPORTED_EXAM_TYPES_BY_SUBJECT:
        return SUPPORTED_EXAM_TYPES_BY_SUBJECT[subject_key]
    return SUPPORTED_EXAM_TYPES_BY_SUBJECT.get(_exam_family(subject_key), {"mixed"})


def validate_exam_type_for_subject(subject: str, exam_type: str | None) -> tuple[str, dict | None]:
    """Return a subject-safe exam type, falling back to mixed with a warning."""
    subject_key = _normalise_subject(subject)
    requested = (exam_type or "mixed").strip().lower()
    supported = _supported_exam_types(subject_key)
    if requested in supported:
        return requested, None
    return "mixed", {
        "code": "unsupported_exam_type",
        "message": f"{requested.replace('_', ' ').title()} is not available for {subject_key.title()} yet, so a mixed practice set was generated.",
        "requested_exam_type": requested,
        "fallback_exam_type": "mixed",
    }


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _deadline_iso(started_at: str, time_limit_minutes: int | float) -> str:
    started = _parse_iso(started_at) or datetime.now(timezone.utc)
    try:
        minutes = max(0, int(time_limit_minutes))
    except (TypeError, ValueError):
        minutes = 45
    return (started + timedelta(minutes=minutes)).isoformat()


def _safe_sub_parts(sub_parts: list[dict] | None) -> list[dict]:
    """Backward-compatible wrapper around the shared safe projection."""
    from backend.services.question_context import student_question_view
    return student_question_view({"sub_parts": sub_parts or []}).get("sub_parts", [])


def _safe_exam_question(exercise: dict) -> dict:
    """Serialize an active exam question using the shared answer-free view."""
    from backend.services.question_context import student_question_view
    return student_question_view(exercise)


def _is_blank_exam_response(response: object) -> bool:
    """True when the student gave no answer (a multi-part answer may be a JSON map of blanks)."""
    text = str(response or "").strip()
    if not text:
        return True
    if text.startswith("{"):
        try:
            parsed = json.loads(text)
        except ValueError:
            return False
        if isinstance(parsed, dict):
            return all(not str(value or "").strip() for value in parsed.values())
    return False


def _is_supported_generated_exam_question(exercise: dict, include_extended: bool = False) -> bool:
    """Return whether generated exams can include/grade this item.

    short_answer and multiple_choice are always deterministically gradable.
    reasoning items are rubric-graded at submit, so they are only included when
    the exam explicitly opts into extended response (``include_extended``).
    """
    question_type = exercise.get("question_type", "short_answer")
    if question_type in {"short_answer", "multiple_choice"}:
        return True
    if question_type == "reasoning":
        return include_extended
    if question_type == "multi_part":
        parts = exercise.get("sub_parts") or []
        return bool(parts) and all(
            isinstance(part, dict)
            and part.get("label")
            and part.get("question")
            and part.get("answer") is not None
            and not part.get("rubric")
            and not part.get("sample_reasoning")
            for part in parts
        )
    return False


class ExamSimulator:
    """Builds and manages mock exam sessions."""

    def __init__(self, exercises: dict, loader: CurriculumLoader | None = None):
        self.exercises = exercises
        self.loader = loader or get_shared_loader()
        self._scope_index: dict[tuple[str, int | None, int | None, str | None], list[dict]] = {}
        for exercise in exercises.values():
            subject = exercise.get("subject")
            if not subject:
                continue
            syllabus = (
                exercise.get("syllabus_subject")
                or exercise.get("course")
                or subject
            )
            key = (
                str(subject),
                exercise.get("year_level"),
                exercise.get("unit"),
                str(syllabus).strip().lower(),
            )
            self._scope_index.setdefault(key, []).append(exercise)

    def start(
        self,
        *,
        student_id: str,
        subject: str = "math",
        year_level: int | None = 7,
        unit: int | None = None,
        syllabus_subject: str | None = None,
        num_questions: int = 20,
        time_limit_minutes: int = 45,
        sf_ratio: float = 0.6,
        cf_ratio: float = 0.3,
        cu_ratio: float = 0.1,
        exam_type: str = "mixed",
        include_extended: bool = False,
    ) -> dict:
        """Create a new exam session, or resume an existing incomplete one."""
        exam_type, exam_type_warning = validate_exam_type_for_subject(subject, exam_type)
        # Extended-response exam types always include rubric-graded reasoning items.
        # (challenge_amc is the maths "hard" paper and benefits most from reasoning.)
        include_extended = include_extended or exam_type in {
            "extended_response", "practical_reasoning", "challenge_amc",
        }
        engine = get_engine(student_id, subject)
        with engine._lock:
            log = engine._read_log(topics=[])
            sessions = list(log.get("exam_sessions", []))
            retained_sessions = _prune_abandoned_generated_sessions(sessions)
            if len(retained_sessions) != len(sessions):
                log["exam_sessions"] = retained_sessions
                engine._write_log(log)
            sessions = retained_sessions

        # Resume existing incomplete exam
        for session in sessions:
            if (
                not session.get("completed_at")
                and not session.get("imported_from")
                and session.get("student_id") == student_id
                and session.get("subject", subject) == subject
                and session.get("year_level") == year_level
                and session.get("unit") == unit
                and session.get("syllabus_subject") == syllabus_subject
                and session.get("exam_type", "mixed") == exam_type
                and int(session.get("requested_questions", len(session.get("paper", [])))) == int(num_questions)
                and int(session.get("time_limit_minutes", 45)) == int(time_limit_minutes)
                and abs(float(session.get("sf_ratio", 0.6)) - float(sf_ratio)) < 0.0001
                and abs(float(session.get("cf_ratio", 0.3)) - float(cf_ratio)) < 0.0001
                and abs(float(session.get("cu_ratio", 0.1)) - float(cu_ratio)) < 0.0001
            ):
                return self._resume_payload(session)

        paper = self._build_paper(
            subject=subject,
            year_level=year_level,
            unit=unit,
            syllabus_subject=syllabus_subject,
            num_questions=num_questions,
            sf_ratio=sf_ratio,
            cf_ratio=cf_ratio,
            cu_ratio=cu_ratio,
            student_id=student_id,
            exam_type=exam_type,
            include_extended=include_extended,
        )

        if not paper:
            scope_label = (
                f"Unit {unit}"
                if unit is not None
                else f"Year {year_level}" if year_level is not None else "the selected course"
            )
            return {
                "error": "insufficient_exercises",
                "message": f"Not enough exercises to build a practice set for {subject} {scope_label}.",
            }

        exam_id = str(uuid.uuid4())
        now_iso = _utcnow_iso()
        deadline_at = _deadline_iso(now_iso, time_limit_minutes)

        session = {
            "exam_id": exam_id,
            "student_id": student_id,
            "subject": subject,
            "year_level": year_level,
            "unit": unit,
            "syllabus_subject": syllabus_subject,
            "started_at": now_iso,
            "deadline_at": deadline_at,
            "time_limit_minutes": time_limit_minutes,
            "requested_questions": num_questions,
            "sf_ratio": sf_ratio,
            "cf_ratio": cf_ratio,
            "cu_ratio": cu_ratio,
            "completed_at": None,
            "paper": paper,
            "responses": {},  # question_id -> student_answer
            "current_index": 0,
            "flagged": [],
            "results": None,
            "exam_type": exam_type,
        }
        if exam_type_warning:
            session["exam_type_warning"] = exam_type_warning

        # Persist to student log
        engine = get_engine(student_id, subject)
        with engine._lock:
            log = engine._read_log(topics=[])
            log.setdefault("exam_sessions", []).append(session)
            engine._write_log(log)

        # Return paper (questions without answers)
        questions = []
        for qid in paper:
            ex = self._exercise_for_session(session, qid)
            if not ex:
                continue
            questions.append(_safe_exam_question(ex))

        return {
            "exam_id": exam_id,
            "time_limit_minutes": time_limit_minutes,
            "total_questions": len(questions),
            "requested_questions": num_questions,
            "questions": questions,
            "started_at": now_iso,
            "deadline_at": deadline_at,
            "save_revision": 0,
            "exam_type": exam_type,
            "warning": exam_type_warning,
        }

    def _resume_payload(self, session: dict) -> dict:
        """Return the answer-free paper that continues one incomplete session.

        The paper order, answers and the server deadline come from the stored
        session, so a resume never changes the questions or adds time.
        """
        questions = []
        for qid in session.get("paper", []):
            ex = self._exercise_for_session(session, qid)
            if not ex:
                continue
            questions.append(_safe_exam_question(ex))
        return {
            "exam_id": session["exam_id"],
            "time_limit_minutes": session.get("time_limit_minutes", 45),
            "total_questions": len(questions),
            "questions": questions,
            "responses": session.get("responses", {}),
            "started_at": session["started_at"],
            "deadline_at": session.get("deadline_at") or _deadline_iso(
                session["started_at"], session.get("time_limit_minutes", 45)
            ),
            "current_index": session.get("current_index", 0),
            "flagged": session.get("flagged", []),
            "save_revision": session.get("save_revision", 0),
            "resumed": True,
            "exam_type": session.get("exam_type", "mixed"),
        }

    def get_active(
        self,
        *,
        student_id: str,
        subject: str = "math",
        year_level: int | None = None,
        unit: int | None = None,
        syllabus_subject: str | None = None,
    ) -> dict | None:
        """Return a summary of the newest unsubmitted session in this scope.

        Sessions that ``start`` would prune as abandoned are not offered.
        """
        sessions = _prune_abandoned_generated_sessions(get_engine(student_id, subject).get_exam_sessions())
        candidates = [
            session
            for session in sessions
            if isinstance(session, dict)
            and not session.get("completed_at")
            and session.get("exam_id")
            and session.get("started_at")
            and (year_level is None or session.get("year_level") == year_level)
            and (unit is None or session.get("unit") == unit)
            and (syllabus_subject is None or session.get("syllabus_subject") == syllabus_subject)
        ]
        if not candidates:
            return None
        session = max(candidates, key=lambda item: str(item.get("started_at") or ""))
        responses = session.get("responses") if isinstance(session.get("responses"), dict) else {}
        deadline_at = session.get("deadline_at") or _deadline_iso(
            session["started_at"], session.get("time_limit_minutes", 45)
        )
        deadline = _parse_iso(deadline_at)
        remaining = (deadline - datetime.now(timezone.utc)).total_seconds() if deadline else 0
        return {
            "exam_id": session["exam_id"],
            "started_at": session["started_at"],
            "deadline_at": deadline_at,
            "remaining_seconds": max(0, int(remaining)),
            "time_limit_minutes": session.get("time_limit_minutes", 45),
            "total_questions": len(session.get("paper") or []),
            "answered_count": sum(1 for value in responses.values() if str(value or "").strip()),
            "exam_type": session.get("exam_type", "mixed"),
            "imported_from": session.get("imported_from"),
        }

    def resume(self, *, student_id: str, subject: str = "math", exam_id: str) -> dict:
        """Continue one unsubmitted session by ID (generated or imported paper)."""
        session = next(
            (
                item
                for item in get_engine(student_id, subject).get_exam_sessions()
                if item.get("exam_id") == exam_id
            ),
            None,
        )
        if not session:
            return {"error": "exam_not_found", "message": f"No exam with id {exam_id}"}
        if session.get("completed_at"):
            return {"error": "exam_already_submitted", "message": "This exam has already been submitted."}
        payload = self._resume_payload(session)
        if session.get("imported_from"):
            payload["title"] = session["imported_from"]
        return payload

    def discard(self, *, student_id: str, subject: str = "math", exam_id: str) -> dict:
        """Delete one unsubmitted session at the student's request.

        No learning evidence exists before submit, so only the saved answers go.
        A submitted session is never removed.
        """
        engine = get_engine(student_id, subject)
        with engine._lock:
            log = engine._read_log(topics=[])
            session = self._find_session(log, exam_id)
            if not session:
                return {"error": "exam_not_found", "message": f"No exam with id {exam_id}"}
            if session.get("completed_at"):
                return {"error": "exam_already_submitted", "message": "This exam has already been submitted."}
            log["exam_sessions"] = [
                item for item in log.get("exam_sessions", []) if item is not session
            ]
            engine._write_log(log)
        return {"ok": True, "exam_id": exam_id}

    def save(
        self,
        *,
        student_id: str,
        subject: str = "math",
        exam_id: str,
        responses: dict[str, str] | None = None,
        current_index: int | None = None,
        flagged: list[str] | None = None,
        revision: int | None = None,
    ) -> dict:
        """Autosave in-progress answers without grading or changing the deadline."""
        engine = get_engine(student_id, subject)
        with engine._lock:
            log = engine._read_log(topics=[])
            session = self._find_session(log, exam_id)
            if not session:
                return {"error": "exam_not_found", "message": f"No exam with id {exam_id}"}
            if session.get("completed_at"):
                return {"error": "exam_already_submitted", "message": "This exam has already been submitted."}

            current_revision = session.get("save_revision")
            if revision is None and current_revision is not None:
                # A pre-deployment browser can still finish an untouched legacy
                # session, but once revisioned writes begin it must not overwrite
                # a newer bundle with an unversioned request.
                return {
                    "ok": True,
                    "exam_id": exam_id,
                    "stale": True,
                    "save_revision": int(current_revision),
                    "response_count": len(session.get("responses") or {}),
                }
            if revision is not None and current_revision is not None:
                current_revision = int(current_revision)
                if revision < current_revision:
                    return {
                        "ok": True,
                        "exam_id": exam_id,
                        "stale": True,
                        "save_revision": current_revision,
                        "response_count": len(session.get("responses") or {}),
                    }
                if revision == current_revision:
                    return {
                        "ok": True,
                        "exam_id": exam_id,
                        "duplicate": True,
                        "save_revision": current_revision,
                        "response_count": len(session.get("responses") or {}),
                    }

            if responses is not None:
                existing = dict(session.get("responses") or {})
                existing.update({str(k): str(v) for k, v in responses.items()})
                session["responses"] = existing
            if current_index is not None:
                session["current_index"] = max(0, int(current_index))
            if flagged is not None:
                session["flagged"] = [str(item) for item in flagged]

            if revision is not None:
                session["save_revision"] = int(revision)

            # Never rewrite started_at / deadline_at.
            if not session.get("deadline_at"):
                session["deadline_at"] = _deadline_iso(
                    session.get("started_at") or _utcnow_iso(),
                    session.get("time_limit_minutes", 45),
                )
            session["updated_at"] = _utcnow_iso()
            engine._write_log(log)
            return {
                "ok": True,
                "exam_id": exam_id,
                "saved_at": session["updated_at"],
                "deadline_at": session["deadline_at"],
                "save_revision": session.get("save_revision", 0),
                "response_count": len(session.get("responses") or {}),
            }

    def submit(
        self,
        *,
        student_id: str,
        subject: str = "math",
        exam_id: str,
        responses: dict[str, str],
    ) -> dict:
        """Submit an exam and durably synchronise its learning evidence.

        The graded session is staged before attempts are written. If an attempt
        write fails, a later submit replays the persisted result with the same
        attempt IDs instead of grading again or creating duplicate evidence.
        """
        engine = get_engine(student_id, subject)

        def result_entries_by_index(active_session: dict) -> dict[int, dict]:
            entries_by_index: dict[int, dict] = {}
            used_entries: set[int] = set()
            results = active_session.get("results")
            entries = (
                results.get("results_per_question", [])
                if isinstance(results, dict)
                else []
            )
            for question_index, qid in enumerate(active_session.get("paper", [])):
                result_entry = next(
                    (
                        entry
                        for entry in entries
                        if isinstance(entry, dict)
                        and id(entry) not in used_entries
                        and entry.get("question_id") == qid
                    ),
                    None,
                )
                if result_entry is not None:
                    used_entries.add(id(result_entry))
                    entries_by_index[question_index] = result_entry
            return entries_by_index

        def sync_attempts(active_session: dict) -> None:
            persisted_responses = active_session.get("responses")
            persisted_responses = (
                persisted_responses if isinstance(persisted_responses, dict) else {}
            )
            entries_by_index = result_entries_by_index(active_session)
            for question_index, qid in enumerate(active_session.get("paper", [])):
                ex = self._exercise_for_session(active_session, qid)
                result_entry = entries_by_index.get(question_index)
                if not ex or result_entry is None:
                    continue
                topic_ids = ex.get("topic_ids", [])
                if not topic_ids:
                    continue
                is_correct = bool(result_entry.get("is_correct"))
                requires_review = bool(result_entry.get("requires_review"))
                # A blank answer is "not answered": it scores 0 in the exam but
                # is not a concept error (no Error Book row, no BKT evidence).
                unanswered = not is_correct and not requires_review and (
                    bool(result_entry.get("unanswered"))
                    or _is_blank_exam_response(persisted_responses.get(qid, ""))
                )
                outcome = (
                    AttemptOutcome.PENDING
                    if requires_review
                    else AttemptOutcome.CORRECT
                    if is_correct
                    else AttemptOutcome.UNANSWERED
                    if unanswered
                    else AttemptOutcome.INCORRECT
                )
                engine.log_attempt(
                    topic=topic_ids[0],
                    question_id=qid,
                    is_correct=is_correct,
                    error_type=None
                    if is_correct
                    else (
                        "parent_review_pending"
                        if requires_review
                        else "exam_unanswered"
                        if unanswered
                        else "exam_error"
                    ),
                    student_answer=str(persisted_responses.get(qid, "")),
                    topic_ids=topic_ids,
                    question_type=ex.get("question_type", "short_answer"),
                    part_results=result_entry.get("part_results"),
                    outcome=outcome,
                    score=result_entry.get("score"),
                    max_score=result_entry.get("max_score"),
                    attempt_id=result_entry.get("attempt_id"),
                    exam_id=active_session["exam_id"],
                )

        def persist_sync_status(status: str) -> dict | None:
            # Re-read after log_attempt: writing the pre-sync snapshot would
            # overwrite topic metadata recomputed by those attempt writes.
            current_log = engine._read_log(topics=[])
            current_session = self._find_session(current_log, exam_id)
            if not current_session:
                return None
            current_session["evidence_sync_status"] = status
            current_session["evidence_sync_updated_at"] = _utcnow_iso()
            engine._write_log(current_log)
            return current_session

        def sync_failure() -> dict:
            return {
                "error": "exam_evidence_sync_failed",
                "message": (
                    "The exam result was saved, but learning evidence is still "
                    "syncing. Retry submission."
                ),
                "exam_id": exam_id,
                "retryable": True,
            }

        def submission_failure() -> dict:
            return {
                "error": "exam_submission_persist_failed",
                "message": "The exam submission could not be saved. Retry submission.",
                "exam_id": exam_id,
                "retryable": True,
            }

        def finish_sync(fallback_results: dict) -> dict:
            try:
                synced_session = persist_sync_status("complete")
            except Exception:
                logger.exception("Failed to persist completed exam evidence state")
                return sync_failure()
            if synced_session is None:
                logger.error("Exam session disappeared while completing evidence sync: %s", exam_id)
                return sync_failure()
            synced_results = synced_session.get("results")
            return synced_results if isinstance(synced_results, dict) else fallback_results

        with engine._lock:
            log = engine._read_log(topics=[])
            session = self._find_session(log, exam_id)
            if not session:
                return {"error": "exam_not_found", "message": f"No exam with id {exam_id}"}

            if session.get("completed_at"):
                sync_status = session.get("evidence_sync_status")
                persisted_results = session.get("results")
                # New staged submissions are idempotent even if the successful
                # HTTP response was lost after the complete marker committed.
                if sync_status == "complete" and isinstance(persisted_results, dict):
                    return persisted_results
                # Legacy completed sessions predate the staged-sync marker and
                # remain final; replaying them could duplicate unknown evidence.
                if sync_status not in {"pending", "failed"}:
                    return {
                        "error": "exam_already_submitted",
                        "message": "This exam has already been submitted.",
                    }
                if not isinstance(persisted_results, dict):
                    return {
                        "error": "exam_already_submitted",
                        "message": "This exam has already been submitted.",
                    }
                try:
                    sync_attempts(session)
                except Exception:
                    logger.exception("Failed to replay exam learning evidence")
                    try:
                        persist_sync_status("failed")
                    except Exception:
                        logger.exception("Failed to persist exam evidence failure state")
                    return sync_failure()
                return finish_sync(session["results"])

            deadline_at = session.get("deadline_at") or _deadline_iso(
                session.get("started_at") or _utcnow_iso(),
                session.get("time_limit_minutes", 45),
            )
            session["deadline_at"] = deadline_at
            now = datetime.now(timezone.utc)
            deadline = _parse_iso(deadline_at)
            submitted_late = False
            if deadline is not None and now > deadline + timedelta(seconds=LATE_SUBMIT_GRACE_SECONDS):
                # Reject manipulated late payloads; grade last autosaved answers instead.
                submitted_late = True
                responses = dict(session.get("responses") or {})

            session["responses"] = responses
            session["completed_at"] = _utcnow_iso()
            session["submitted_late"] = submitted_late

            results = self._grade_paper(session)
            results["submitted_late"] = submitted_late

            for result_entry in result_entries_by_index(
                {**session, "results": results}
            ).values():
                result_entry["attempt_id"] = str(uuid.uuid4())

            session["results"] = results
            session["evidence_sync_status"] = "pending"
            session["evidence_sync_updated_at"] = _utcnow_iso()

            # Commit the fixed result and attempt identities before writing any
            # evidence, making every subsequent write safely replayable.
            try:
                engine._write_log(log)
            except Exception:
                logger.exception("Failed to persist staged exam submission")
                return submission_failure()

            try:
                sync_attempts(session)
            except Exception:
                logger.exception("Failed to record exam learning evidence")
                try:
                    persist_sync_status("failed")
                except Exception:
                    logger.exception("Failed to persist exam evidence failure state")
                return sync_failure()

            return finish_sync(results)

    @staticmethod
    def _clean_score(value: float) -> int | float:
        """Keep persisted exam scores compact without losing fractional marks."""
        return int(value) if float(value).is_integer() else value

    @classmethod
    def _refresh_exam_result_entry_from_parts(cls, entry: dict) -> None:
        """Recompute one multi-part result after a parent decision."""
        parts = [part for part in entry.get("part_results", []) if isinstance(part, dict)]
        if not parts:
            return

        score = 0.0
        max_score = 0.0
        outcomes = []
        for part in parts:
            try:
                part_max = max(0.0, float(part.get("max_score", part.get("marks", 1)) or 0))
            except (TypeError, ValueError):
                part_max = 0.0
            try:
                part_score = float(part.get("score", 0) or 0)
            except (TypeError, ValueError):
                part_score = 0.0
            max_score += part_max
            score += max(0.0, min(part_score, part_max))
            outcomes.append(classify_part_result(part))

        entry["score"] = cls._clean_score(score)
        entry["max_score"] = cls._clean_score(max_score)
        entry["is_correct"] = bool(outcomes) and all(
            outcome is AttemptOutcome.CORRECT for outcome in outcomes
        )
        if AttemptOutcome.PENDING in outcomes:
            entry["requires_review"] = True
        else:
            entry.pop("requires_review", None)

    def _recompute_exam_result_summary(self, session: dict) -> None:
        """Rebuild aggregate exam fields from the current per-question states."""
        results = session.get("results")
        if not isinstance(results, dict):
            return

        entries = [
            entry
            for entry in results.get("results_per_question", [])
            if isinstance(entry, dict)
        ]
        total_questions = len(session.get("paper") or entries)
        pending_count = 0
        correct_count = 0
        total_score = 0.0
        total_max_score = 0.0
        strand_stats: dict[str, dict[str, int]] = {}
        weak_topics: list[str] = []
        topic_names = self._topic_names(
            str(topic_id)
            for entry in entries
            for topic_id in entry.get("topic_ids", [])
        )

        for entry in entries:
            if entry.get("requires_review"):
                pending_count += 1
                continue

            try:
                score = float(entry.get("score", 0) or 0)
            except (TypeError, ValueError):
                score = 0.0
            try:
                max_score = float(entry.get("max_score", 0) or 0)
            except (TypeError, ValueError):
                max_score = 0.0
            total_score += score
            total_max_score += max_score
            is_correct = bool(entry.get("is_correct"))
            if is_correct:
                correct_count += 1
            else:
                weak_topics.extend(
                    str(topic_id)
                    for topic_id in entry.get("topic_ids", [])
                    if topic_id
                )

            for topic_id in entry.get("topic_ids", []):
                strand = self._report_area(str(topic_id), topic_names)
                stats = strand_stats.setdefault(strand, {"correct": 0, "total": 0})
                stats["total"] += 1
                if is_correct:
                    stats["correct"] += 1

        results["total_questions"] = total_questions
        results["correct"] = correct_count
        results["total_score"] = self._clean_score(total_score)
        results["total_max_score"] = self._clean_score(total_max_score)
        results["pending_count"] = pending_count
        results["scored_questions"] = total_questions - pending_count
        results["provisional"] = pending_count > 0
        results["grading_status"] = (
            "timed_out" if results.get("grading_timed_out")
            else "pending" if pending_count == total_questions and total_questions > 0
            else "complete_with_pending" if pending_count > 0
            else "complete"
        )
        results["percentage"] = round(
            total_score / total_max_score * 100, 1
        ) if total_max_score > 0 else 0
        results["strand_breakdown"] = [
            {
                "strand": strand,
                "correct": stats["correct"],
                "total": stats["total"],
                "percentage": round(stats["correct"] / stats["total"] * 100, 1)
                if stats["total"]
                else 0,
            }
            for strand, stats in sorted(strand_stats.items())
        ]
        results["weak_topics"] = list(dict.fromkeys(weak_topics))
        results["topic_names"] = topic_names

    def has_pending_parent_review_candidate(
        self,
        *,
        student_id: str,
        subject: str,
        exam_id: str | None,
        question_id: str,
        attempt_id: str | None,
        part_label: str | None = None,
        student_answer: str | None = None,
    ) -> bool:
        """Return whether an exam still has a plausible pending review target.

        This conservative preflight lets the parent route distinguish an
        ordinary tutor review from an ambiguous legacy exam review. Ambiguous
        exam candidates must not be consumed from the attempt queue.
        """
        engine = get_engine(student_id, subject)
        with engine._lock:
            log = engine._read_log(topics=[])
            sessions = [
                session
                for session in log.get("exam_sessions", [])
                if isinstance(session, dict)
            ]
            if exam_id:
                session = self._find_session(log, str(exam_id))
                sessions = [session] if isinstance(session, dict) else []

            requested_subject = str(subject).strip().lower()
            expected_answer = str(student_answer or "").strip()
            requested_part = str(part_label or "").strip().lower()
            for session in sessions:
                stored_student_id = session.get("student_id")
                if stored_student_id and str(stored_student_id) != str(student_id):
                    continue
                if str(session.get("subject") or "").strip().lower() != requested_subject:
                    continue
                results = session.get("results")
                entries = (
                    results.get("results_per_question", [])
                    if isinstance(results, dict)
                    else []
                )
                responses = session.get("responses")
                responses = responses if isinstance(responses, dict) else {}
                for entry in entries:
                    if (
                        not isinstance(entry, dict)
                        or str(entry.get("question_id") or "") != str(question_id)
                    ):
                        continue
                    stored_attempt_id = str(entry.get("attempt_id") or "")
                    if attempt_id and stored_attempt_id and stored_attempt_id != str(attempt_id):
                        continue
                    if requested_part:
                        target = next(
                            (
                                part
                                for part in entry.get("part_results", [])
                                if isinstance(part, dict)
                                and str(part.get("label") or "").strip().lower()
                                == requested_part
                            ),
                            None,
                        )
                        if (
                            target is None
                            or classify_part_result(target) is not AttemptOutcome.PENDING
                        ):
                            continue
                        saved_answers = [target.get("student_answer")]
                    else:
                        parts = [
                            part
                            for part in entry.get("part_results", [])
                            if isinstance(part, dict)
                        ]
                        if any(
                            classify_part_result(part) is AttemptOutcome.PENDING
                            for part in parts
                        ) or not entry.get("requires_review"):
                            continue
                        saved_answers = [
                            entry.get("student_answer"),
                            responses.get(str(question_id)),
                        ]
                    if attempt_id and stored_attempt_id == str(attempt_id):
                        return True
                    if expected_answer and expected_answer in {
                        str(value).strip()
                        for value in saved_answers
                        if value is not None
                    }:
                        return True
            return False

    def reconcile_parent_review(
        self,
        *,
        student_id: str,
        subject: str,
        exam_id: str | None,
        question_id: str,
        attempt_id: str | None,
        correct: bool,
        part_label: str | None = None,
        student_answer: str | None = None,
    ) -> bool:
        """Apply one parent decision to an exact or conservatively matched result.

        Persisted ``attempt_id`` metadata is authoritative. Legacy result rows
        without that metadata may be matched by subject, question, saved response,
        and pending part/root state. Without an ``exam_id`` only one uniquely
        newest completed candidate is accepted; timestamp ties are a safe no-op.
        """
        engine = get_engine(student_id, subject)
        with engine._lock:
            log = engine._read_log(topics=[])
            sessions = [
                session
                for session in log.get("exam_sessions", [])
                if isinstance(session, dict)
            ]
            if exam_id:
                session = self._find_session(log, str(exam_id))
                sessions = [session] if isinstance(session, dict) else []

            requested_subject = str(subject).strip().lower()
            eligible_sessions: list[dict] = []
            for session in sessions:
                stored_student_id = session.get("student_id")
                if stored_student_id and str(stored_student_id) != str(student_id):
                    continue
                if str(session.get("subject") or "").strip().lower() != requested_subject:
                    continue
                eligible_sessions.append(session)

            review_marker = {
                "question_id": str(question_id),
                "attempt_id": str(attempt_id or ""),
                "part_label": str(part_label or "").strip().lower(),
                "student_answer": str(student_answer or "").strip(),
                "correct": bool(correct),
            }
            marker_matches: list[dict] = []
            for session in eligible_sessions:
                results = session.get("results")
                entries = (
                    results.get("results_per_question", [])
                    if isinstance(results, dict)
                    else []
                )
                for entry in entries:
                    if (
                        not isinstance(entry, dict)
                        or str(entry.get("question_id") or "") != str(question_id)
                    ):
                        continue
                    marker_target = entry
                    if part_label:
                        marker_target = next(
                            (
                                part
                                for part in entry.get("part_results", [])
                                if isinstance(part, dict)
                                and str(part.get("label") or "").strip().lower()
                                == str(part_label).strip().lower()
                            ),
                            None,
                        )
                    if (
                        isinstance(marker_target, dict)
                        and marker_target.get("review_reconciliation") == review_marker
                    ):
                        marker_matches.append(marker_target)
            if marker_matches:
                return len(marker_matches) == 1

            def pending_target(entry: dict) -> tuple[bool, dict | None]:
                if str(entry.get("question_id") or "") != str(question_id):
                    return False, None
                if part_label:
                    matching_part = next(
                        (
                            part
                            for part in entry.get("part_results", [])
                            if isinstance(part, dict)
                            and str(part.get("label") or "").strip().lower()
                            == str(part_label).strip().lower()
                        ),
                        None,
                    )
                    return (
                        matching_part is not None
                        and classify_part_result(matching_part) is AttemptOutcome.PENDING,
                        matching_part,
                    )
                parts = [
                    part
                    for part in entry.get("part_results", [])
                    if isinstance(part, dict)
                ]
                if any(classify_part_result(part) is AttemptOutcome.PENDING for part in parts):
                    return False, None
                return bool(entry.get("requires_review")), None

            def resolved_target_matches_decision(entry: dict) -> bool:
                """Recognise an exact replay after the exam side was persisted."""
                if str(entry.get("question_id") or "") != str(question_id):
                    return False
                expected = (
                    AttemptOutcome.CORRECT if correct else AttemptOutcome.INCORRECT
                )
                if part_label:
                    matching_part = next(
                        (
                            part
                            for part in entry.get("part_results", [])
                            if isinstance(part, dict)
                            and str(part.get("label") or "").strip().lower()
                            == str(part_label).strip().lower()
                        ),
                        None,
                    )
                    return (
                        matching_part is not None
                        and classify_part_result(matching_part) is expected
                    )
                parts = [
                    part
                    for part in entry.get("part_results", [])
                    if isinstance(part, dict)
                ]
                if entry.get("requires_review") or any(
                    classify_part_result(part) is AttemptOutcome.PENDING
                    for part in parts
                ):
                    return False
                return bool(entry.get("is_correct")) is bool(correct)

            matches: list[tuple[dict, dict, dict | None]] = []
            if attempt_id:
                exact_entries: list[dict] = []
                for session in eligible_sessions:
                    results = session.get("results")
                    entries = (
                        results.get("results_per_question", [])
                        if isinstance(results, dict)
                        else []
                    )
                    for entry in entries:
                        if (
                            not isinstance(entry, dict)
                            or str(entry.get("question_id") or "") != str(question_id)
                            or str(entry.get("attempt_id") or "") != str(attempt_id)
                        ):
                            continue
                        exact_entries.append(entry)
                        is_pending, matching_part = pending_target(entry)
                        if is_pending:
                            matches.append((session, entry, matching_part))
                if len(exact_entries) > 1 or len(matches) > 1:
                    return False
                if not matches and exact_entries:
                    return resolved_target_matches_decision(exact_entries[0])

            if not matches:
                expected_answer = str(student_answer or "").strip()
                if not expected_answer:
                    return False
                legacy_matches: list[tuple[dict, dict, dict | None]] = []
                for session in eligible_sessions:
                    if not session.get("completed_at"):
                        continue
                    results = session.get("results")
                    entries = (
                        results.get("results_per_question", [])
                        if isinstance(results, dict)
                        else []
                    )
                    responses = session.get("responses")
                    responses = responses if isinstance(responses, dict) else {}
                    for entry in entries:
                        if not isinstance(entry, dict) or entry.get("attempt_id"):
                            continue
                        is_pending, matching_part = pending_target(entry)
                        if not is_pending:
                            continue
                        if matching_part is not None:
                            saved_answers = [matching_part.get("student_answer")]
                        else:
                            saved_answers = [
                                entry.get("student_answer"),
                                responses.get(str(question_id)),
                            ]
                        if expected_answer not in {
                            str(value).strip()
                            for value in saved_answers
                            if value is not None
                        }:
                            continue
                        legacy_matches.append((session, entry, matching_part))

                if exam_id:
                    if len(legacy_matches) != 1:
                        return False
                    matches = legacy_matches
                else:
                    dated_matches: list[
                        tuple[datetime, tuple[dict, dict, dict | None]]
                    ] = []
                    for candidate in legacy_matches:
                        try:
                            completed = datetime.fromisoformat(
                                str(candidate[0].get("completed_at")).replace("Z", "+00:00")
                            )
                            if completed.tzinfo is None:
                                completed = completed.replace(tzinfo=timezone.utc)
                            dated_matches.append(
                                (completed.astimezone(timezone.utc), candidate)
                            )
                        except (TypeError, ValueError):
                            continue
                    if not dated_matches:
                        return False
                    newest_at = max(item[0] for item in dated_matches)
                    newest = [item[1] for item in dated_matches if item[0] == newest_at]
                    if len(newest) != 1:
                        return False
                    matches = newest

            if len(matches) != 1:
                return False
            session, entry, matching_part = matches[0]

            if part_label:
                if matching_part is None:
                    return False
                try:
                    part_max = max(
                        0.0,
                        float(
                            matching_part.get(
                                "max_score", matching_part.get("marks", 1)
                            )
                            or 0
                        ),
                    )
                except (TypeError, ValueError):
                    part_max = 0.0
                matching_part["is_correct"] = bool(correct)
                matching_part["score"] = self._clean_score(part_max if correct else 0)
                matching_part["max_score"] = self._clean_score(part_max)
                matching_part["outcome"] = (
                    AttemptOutcome.CORRECT.value
                    if correct
                    else AttemptOutcome.INCORRECT.value
                )
                matching_part["error_type"] = (
                    None if correct else "parent_review_rejected"
                )
                matching_part["review_reconciliation"] = review_marker
                self._refresh_exam_result_entry_from_parts(entry)
            else:
                entry["is_correct"] = bool(correct)
                entry["score"] = entry.get("max_score", 1) if correct else 0
                entry["error_type"] = None if correct else "parent_review_rejected"
                entry.pop("requires_review", None)
                entry["review_reconciliation"] = review_marker

            self._recompute_exam_result_summary(session)
            engine._write_log(log)
            return True

    def get_history(
        self,
        *,
        student_id: str,
        subject: str = "math",
        year_level: int | None = None,
        unit: int | None = None,
        syllabus_subject: str | None = None,
    ) -> list[dict]:
        """Return summary of past exam sessions."""
        engine = get_engine(student_id, subject)
        sessions = engine.get_exam_sessions()
        summaries = []
        for s in sessions:
            if not s.get("completed_at"):
                continue
            if year_level is not None and s.get("year_level") != year_level:
                continue
            if unit is not None and s.get("unit") != unit:
                continue
            if syllabus_subject is not None and s.get("syllabus_subject") != syllabus_subject:
                continue
            r = s.get("results") or {}
            provisional = bool(r.get("provisional")) or any(
                item.get("requires_review")
                for item in r.get("results_per_question", [])
                if isinstance(item, dict)
            )
            summaries.append({
                "exam_id": s["exam_id"],
                "subject": s.get("subject", subject),
                "year_level": s.get("year_level"),
                "unit": s.get("unit"),
                "syllabus_subject": s.get("syllabus_subject"),
                "exam_type": s.get("exam_type", "mixed"),
                "provisional": provisional,
                "started_at": s["started_at"],
                "completed_at": s["completed_at"],
                "total_questions": r.get("total_questions", 0),
                "correct": r.get("correct", 0),
                "percentage": r.get("percentage", 0),
                "time_limit_minutes": s.get("time_limit_minutes", 45),
            })
        summaries.sort(key=lambda item: item.get("completed_at") or item.get("started_at") or "", reverse=True)
        return summaries

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _filter_candidates_by_exam_type(self, candidates: list[dict], *, subject: str, exam_type: str) -> list[dict]:
        """Apply subject-aware focus filters while preserving legacy topic fallbacks."""
        if exam_type == "mixed":
            return candidates

        subject_key = _normalise_subject(subject)

        if subject_key in {"math", "mathematics"}:
            if exam_type == "naplan_numeracy":
                return self._math_blueprint_naplan(candidates)
            if exam_type == "fluency_check":
                return self._math_blueprint_fluency(candidates)
            if exam_type == "challenge_amc":
                return self._math_blueprint_challenge(candidates)

        if subject_key in {"methods", "general", "specialist", "essential"}:
            if exam_type == "paper_1":
                return self._methods_blueprint_paper(candidates, technology_active=False)
            if exam_type == "paper_2":
                return self._methods_blueprint_paper(candidates, technology_active=True)

        family = _exam_family(subject_key)

        if family == "english":
            if exam_type == "naplan_literacy":
                return self._english_blueprint_naplan(candidates)
            if exam_type == "language_conventions":
                language_topics = {"AC9E7LY08", "AC9E7LA05", "AC9E7LA06", "AC9E7LA08", "AC9E7LA09"}
                return [
                    ex for ex in candidates
                    if self._english_facet(ex) in {"language_conventions", "spelling_punctuation"}
                    or any(tid in language_topics for tid in ex.get("topic_ids", []))
                ]
            if exam_type == "reading":
                reading_topics = {
                    "AC9E7LY05", "AC9E7LY03", "AC9E7LY04", "AC9E7LE05", "AC9E7LE06",
                    "AC9E7LE02", "AC9E7LA02", "AC9E7LA03", "AC9E7LA04",
                }
                return [
                    ex for ex in candidates
                    if self._english_facet(ex) in {"reading_comprehension", "text_evidence", "vocabulary"}
                    or any(tid in reading_topics for tid in ex.get("topic_ids", []))
                ]
            if exam_type == "extended_response":
                return [
                    ex for ex in candidates
                    if self._english_facet(ex) == "writing_structure"
                    or ex.get("question_type") in {"reasoning", "multi_part"}
                ]

        if family == "science":
            if exam_type == "inquiry":
                return [
                    ex for ex in candidates
                    if bool((ex.get("science_metadata") or {}).get("science_inquiry_skill"))
                    or any("H" in tid for tid in ex.get("topic_ids", []))
                ]
            if exam_type == "data_interpretation":
                return [
                    ex for ex in candidates
                    if (ex.get("science_metadata") or {}).get("data_representation") in {"table", "graph", "diagram"}
                    or any(word in ex.get("question", "").lower() for word in ("graph", "table", "data", "diagram"))
                ]
            if exam_type in {"extended_response", "practical_reasoning"}:
                return [
                    ex for ex in candidates
                    if ex.get("question_type") in {"reasoning", "multi_part"}
                    or bool((ex.get("science_metadata") or {}).get("practical_context"))
                    or bool((ex.get("science_metadata") or {}).get("claim_evidence_reasoning"))
                ]

        return []

    # ── Math Blueprint Selection Methods ──────────────────────────────

    def _math_blueprint_naplan(self, candidates: list[dict]) -> list[dict]:
        """NAPLAN-style numeracy: short items, visual/data stimuli where available, broad coverage."""
        result = []
        for ex in candidates:
            qtype = ex.get("question_type", "short_answer")
            if qtype in {"short_answer", "multiple_choice"}:
                result.append(ex)
            elif qtype == "multi_part":
                parts = ex.get("sub_parts") or []
                if len(parts) <= 2:
                    result.append(ex)
        return result

    def _math_blueprint_fluency(self, candidates: list[dict]) -> list[dict]:
        """Fluency check: foundational and developing items, short_answer and MCQ."""
        return [
            ex for ex in candidates
            if ex.get("difficulty") in {"foundational", "developing"}
            and ex.get("question_type") in {"short_answer", "multiple_choice"}
        ]

    def _math_blueprint_challenge(self, candidates: list[dict]) -> list[dict]:
        """Challenge/AMC: AMC difficulty and complex-unfamiliar extending items."""
        return [
            ex for ex in candidates
            if ex.get("difficulty") in {"AMC", "extending"}
            or ex.get("complexity") == "complex_unfamiliar"
        ]

    def _methods_blueprint_paper(self, candidates: list[dict], *, technology_active: bool) -> list[dict]:
        """QCAA senior maths external-assessment papers.

        Paper 1 is technology-free and Paper 2 is technology-active; items are
        tagged via ``math_metadata.technology_active``. Items without the flag
        are excluded (the Methods banks always set it).
        """
        return [
            ex for ex in candidates
            if (ex.get("math_metadata") or {}).get("technology_active") is technology_active
        ]

    def _english_blueprint_naplan(self, candidates: list[dict]) -> list[dict]:
        """NAPLAN-style literacy: reading plus conventions, using short response formats."""
        naplan_facets = {
            "reading_comprehension",
            "text_evidence",
            "vocabulary",
            "language_conventions",
            "spelling_punctuation",
        }
        return [
            ex for ex in candidates
            if self._english_facet(ex) in naplan_facets
            and ex.get("question_type", "short_answer") in {"short_answer", "multiple_choice"}
        ]

    @staticmethod
    def _english_facet(exercise: dict) -> str | None:
        metadata = exercise.get("english_metadata") or {}
        facet = metadata.get("facet")
        return facet if isinstance(facet, str) else None

    def _build_paper(
        self,
        subject: str,
        year_level: int | None,
        num_questions: int,
        unit: int | None = None,
        syllabus_subject: str | None = None,
        sf_ratio: float = 0.6,
        cf_ratio: float = 0.3,
        cu_ratio: float = 0.1,
        student_id: str | None = None,
        exam_type: str = "mixed",
        include_extended: bool = False,
    ) -> list[str]:
        """Select questions for the exam paper with balanced coverage and difficulty, prioritizing unseen or incorrect questions."""
        target_syllabus = (syllabus_subject or subject).strip().lower()
        candidates = list(self._scope_index.get(
            (subject, year_level, unit, target_syllabus), []
        ))

        # Filter by subject-aware exam/practice-set focus. Keep a mixed fallback
        # so sparse pools remain usable for all subject/year combinations.
        focused_candidates = self._filter_candidates_by_exam_type(
            candidates,
            subject=subject,
            exam_type=exam_type,
        )
        if focused_candidates:
            candidates = focused_candidates

        candidates = [
            ex for ex in candidates
            if _is_supported_generated_exam_question(ex, include_extended)
        ]

        if not candidates:
            return []

        # Find questions the student has previously seen (correct or incorrect)
        correct_ids: set[str] = set()
        incorrect_ids: set[str] = set()
        prior_exam_ids: set[str] = set()
        if student_id:
            engine = get_engine(student_id, subject)
            outcomes = engine.get_attempt_outcomes()
            metadata = engine.get_extra_metadata()
            for qid, correct in outcomes:
                if correct:
                    correct_ids.add(qid)
                else:
                    incorrect_ids.add(qid)
            for sess in metadata.get("exam_sessions", []):
                res = sess.get("results") or {}
                for r in res.get("results_per_question", []):
                    qid = r.get("question_id", "")
                    if qid:
                        prior_exam_ids.add(qid)
                        if r.get("is_correct"):
                            correct_ids.add(qid)
                        else:
                            incorrect_ids.add(qid)

        # Divide candidates by complexity and attempt history
        sf_unseen, sf_incorrect, sf_correct = [], [], []
        cf_unseen, cf_incorrect, cf_correct = [], [], []
        cu_unseen, cu_incorrect, cu_correct = [], [], []

        def complexity_key(ex):
            """Sort within complexity buckets: AMC > extending > developing > foundational."""
            diff = ex.get("difficulty", "developing")
            return {"foundational": 0, "developing": 1, "extending": 2, "AMC": 3}.get(diff, 1)

        for ex in candidates:
            eid = ex["id"]
            comp = ex.get("complexity")
            if eid in correct_ids:
                bucket = "correct"
            elif eid in incorrect_ids:
                bucket = "incorrect"
            else:
                bucket = "unseen"

            if comp == "complex_familiar":
                {"correct": cf_correct, "incorrect": cf_incorrect, "unseen": cf_unseen}[bucket].append(ex)
            elif comp == "complex_unfamiliar":
                {"correct": cu_correct, "incorrect": cu_incorrect, "unseen": cu_unseen}[bucket].append(ex)
            else:
                {"correct": sf_correct, "incorrect": sf_incorrect, "unseen": sf_unseen}[bucket].append(ex)

        # Sort pools by difficulty within each bucket (harder first so exams maintain challenge)
        for pool in [sf_unseen, sf_incorrect, sf_correct,
                     cf_unseen, cf_incorrect, cf_correct,
                     cu_unseen, cu_incorrect, cu_correct]:
            pool.sort(key=complexity_key)

        # Compute target counts — ensure they always sum to num_questions
        sf_target = max(0, round(num_questions * sf_ratio))
        cf_target = max(0, round(num_questions * cf_ratio))
        over = (sf_target + cf_target) - num_questions
        if over > 0:
            cf_target = max(0, cf_target - over)
        cu_target = num_questions - sf_target - cf_target

        def draw_from_pools(unseen_pool, incorrect_pool, correct_pool, count):
            """Draw from unseen first, then incorrect, then correct pools.

            Within each pool, harder questions are weighted higher so the exam
            maintains appropriate challenge at the student's level.
            """
            # Reduce repeats: skip questions that appeared in prior exams if possible
            un_available = [ex for ex in unseen_pool if ex["id"] not in prior_exam_ids]
            inc_available = [ex for ex in incorrect_pool if ex["id"] not in prior_exam_ids]
            cor_available = [ex for ex in correct_pool if ex["id"] not in prior_exam_ids]
            # Fall back to including prior-exam questions if needed
            if not un_available:
                un_available = list(unseen_pool)
            if not inc_available:
                inc_available = list(incorrect_pool)
            if not cor_available:
                cor_available = list(correct_pool)

            def weighted_sample(pool, n):
                """Pick n items from pool, weighted by difficulty (AMC > extending > developing > foundational) without replacement."""
                if len(pool) <= n:
                    return list(pool)
                available = list(pool)
                chosen = []
                for _ in range(n):
                    weights = [1 + complexity_key(ex) for ex in available]
                    item = random.choices(available, weights=weights, k=1)[0]
                    chosen.append(item)
                    available.remove(item)
                return chosen

            selected = []
            seen_ids: set[str] = set()
            remaining = count
            for pool in [un_available, inc_available, cor_available]:
                if remaining <= 0:
                    break
                # Dedup within this draw
                pool = [ex for ex in pool if ex["id"] not in seen_ids]
                if not pool:
                    continue
                if len(pool) >= remaining:
                    chosen = weighted_sample(pool, remaining)
                    selected.extend(chosen)
                    seen_ids.update(ex["id"] for ex in chosen)
                    remaining = 0
                else:
                    selected.extend(pool)
                    seen_ids.update(ex["id"] for ex in pool)
                    remaining -= len(pool)
            return selected

        selected_sf = draw_from_pools(sf_unseen, sf_incorrect, sf_correct, sf_target)
        selected_cf = draw_from_pools(cf_unseen, cf_incorrect, cf_correct, cf_target)
        selected_cu = draw_from_pools(cu_unseen, cu_incorrect, cu_correct, cu_target)

        selected = selected_sf + selected_cf + selected_cu

        # Strand balance: ensure minimum representation across strands
        # If any major strand (N,A,M,SP,ST,P) is missing, try to swap in at least 1
        strands_present: set[str] = set()
        for ex in selected:
            for tid in ex.get("topic_ids", []):
                strand = self._strand_from_topic_id(tid)
                if strand != "Other":
                    strands_present.add(strand)

        desired_strands = {"Number", "Algebra", "Measurement", "Space", "Statistics", "Probability"}
        missing_strands = desired_strands - strands_present
        if missing_strands:
            selected_ids = {ex["id"] for ex in selected}
            # Try to swap in one question per missing strand from the available pools
            for strand in missing_strands:
                candidate = None
                for pool in [cu_unseen, cu_incorrect, cf_unseen, cf_incorrect,
                            sf_unseen, sf_incorrect, cu_correct, cf_correct, sf_correct]:
                    for ex in pool:
                        if ex["id"] in selected_ids:
                            continue
                        for tid in ex.get("topic_ids", []):
                            if self._strand_from_topic_id(tid) == strand:
                                candidate = ex
                                break
                        if candidate:
                            break
                    if candidate:
                        break
                if candidate and len(selected) > 0:
                    # Replace a question from the most-represented strand to keep balance
                    strand_counts = {}
                    question_strands = []
                    for ex in selected:
                        q_strand = "Other"
                        for tid in ex.get("topic_ids", []):
                            s = self._strand_from_topic_id(tid)
                            if s != "Other":
                                q_strand = s
                                break
                        question_strands.append(q_strand)
                        strand_counts[q_strand] = strand_counts.get(q_strand, 0) + 1
                    
                    valid_strands = {s: c for s, c in strand_counts.items() if s != "Other"}
                    if not valid_strands:
                        valid_strands = strand_counts
                    
                    if valid_strands:
                        most_represented = max(valid_strands, key=valid_strands.get)
                        replace_idx = -1
                        for idx, q_strand in enumerate(question_strands):
                            if q_strand == most_represented:
                                replace_idx = idx
                                break
                        
                        if replace_idx != -1:
                            old_ex = selected[replace_idx]
                            selected[replace_idx] = candidate
                            selected_ids.discard(old_ex.get("id", ""))
                            selected_ids.add(candidate["id"])
                        else:
                            old_ex = selected[-1]
                            selected[-1] = candidate
                            selected_ids.discard(old_ex.get("id", ""))
                            selected_ids.add(candidate["id"])
                    else:
                        old_ex = selected[-1]
                        selected[-1] = candidate
                        selected_ids.discard(old_ex.get("id", ""))
                        selected_ids.add(candidate["id"])

        # English facet balance: ensure coverage across all facets for mixed exams
        if _normalise_subject(subject) == "english" and exam_type == "mixed":
            all_english_facets = {
                "reading_comprehension", "text_evidence", "language_conventions",
                "vocabulary", "writing_structure", "spelling_punctuation",
            }
            facets_present: set[str] = set()
            for ex in selected:
                f = self._english_facet(ex)
                if f:
                    facets_present.add(f)
            missing_facets = all_english_facets - facets_present
            if missing_facets:
                selected_ids = {ex["id"] for ex in selected}
                for facet in missing_facets:
                    candidate = None
                    for pool in [cu_unseen, cu_incorrect, cf_unseen, cf_incorrect,
                                sf_unseen, sf_incorrect, cu_correct, cf_correct, sf_correct]:
                        for ex in pool:
                            if ex["id"] in selected_ids:
                                continue
                            if self._english_facet(ex) == facet:
                                candidate = ex
                                break
                        if candidate:
                            break
                    if candidate and len(selected) > 0:
                        # Replace the most over-represented facet's last exercise
                        facet_counts: dict[str, int] = {}
                        for ex in selected:
                            f = self._english_facet(ex) or "unknown"
                            facet_counts[f] = facet_counts.get(f, 0) + 1
                        most_over = max(facet_counts, key=facet_counts.get)
                        # Find last exercise with over-represented facet
                        replace_idx = -1
                        for idx in range(len(selected) - 1, -1, -1):
                            if (self._english_facet(selected[idx]) or "unknown") == most_over:
                                replace_idx = idx
                                break
                        if replace_idx != -1 and facet_counts.get(most_over, 0) > 1:
                            old_ex = selected[replace_idx]
                            selected[replace_idx] = candidate
                            selected_ids.discard(old_ex.get("id", ""))
                            selected_ids.add(candidate["id"])

        # Fill gaps if pool sizes were insufficient
        selected_ids = {ex["id"] for ex in selected}
        remaining_candidates = [
            ex for ex in candidates
            if ex["id"] not in selected_ids and ex["id"] not in prior_exam_ids
        ]
        if not remaining_candidates:
            remaining_candidates = [
                ex for ex in candidates if ex["id"] not in selected_ids
            ]
        needed = num_questions - len(selected)
        if needed > 0 and remaining_candidates:
            extra = random.sample(remaining_candidates, min(needed, len(remaining_candidates)))
            selected.extend(extra)

        # Sort: MCQ first, then short_answer, then reasoning
        type_order = {"multiple_choice": 0, "short_answer": 1, "reasoning": 2}
        selected.sort(key=lambda e: type_order.get(e.get("question_type", "short_answer"), 1))

        return [ex["id"] for ex in selected]

    def _grade_paper(self, session: dict) -> dict:
        """Grade all responses and produce the report."""
        paper = session["paper"]
        responses = session["responses"]
        # student_id is needed for the LLM/marking path of english/science
        # short-answers and reasoning items; it is stored on the session.
        student_id = session.get("student_id")
        results_per_question = []
        correct_count = 0
        total_score = 0
        total_max_score = 0
        strand_stats: dict[str, dict] = {}
        grading_deadline = time.monotonic() + _exam_grading_timeout_seconds()
        grading_timed_out = False
        topic_names = self._topic_names(
            topic_id
            for qid in paper
            for topic_id in (self._exercise_for_session(session, qid) or {}).get("topic_ids", [])
        )

        for qid in paper:
            ex = self._exercise_for_session(session, qid)
            if not ex:
                continue

            student_answer = responses.get(qid, "")
            qtype = ex.get("question_type", "short_answer")
            requires_review = False
            review_feedback = None
            extra: dict = {}

            open_response = qtype == "short_answer" and (
                is_text_graded(ex.get("subject"))
                or demands_written_reasoning(ex)
            )

            # Open semantic responses share the same paper deadline. Once the
            # budget is exhausted they become neutral pending review, never a
            # forced incorrect mark.
            if _is_blank_exam_response(student_answer):
                # Not answered: 0 marks, but no review and no error evidence.
                if qtype == "multi_part":
                    score, max_score, is_correct, requires_review, review_feedback, part_results = (
                        self._grade_multi_part(ex, "")
                    )
                    extra["part_results"] = part_results
                elif qtype == "reasoning":
                    score, max_score, is_correct, requires_review, review_feedback = self._grade_reasoning(ex, "")
                else:
                    score, max_score, is_correct, requires_review, review_feedback = 0, 1, False, False, None
                extra["unanswered"] = True
            elif time.monotonic() >= grading_deadline:
                grading_timed_out = True
                if qtype == "reasoning":
                    max_score = normalise_reasoning_rubric(ex.get("rubric") or {}).get("max_score") or 1
                    score, max_score, is_correct, requires_review, review_feedback = (
                        0, max_score, False, True,
                        "Extended response saved for review because the exam marking time limit was reached.",
                    )
                elif qtype == "multi_part":
                    fallback_max = sum(float(part.get("marks") or 1) for part in (ex.get("sub_parts") or [])) or 1
                    score, max_score, is_correct, requires_review, review_feedback, part_results = (
                        0, fallback_max, False, True,
                        "Multi-part response saved for review because the exam marking time limit was reached.",
                        [],
                    )
                    extra["part_results"] = part_results
                elif open_response:
                    score, max_score, is_correct, requires_review, review_feedback = (
                        0, 1, False, True,
                        "Short response saved for review because the exam marking time limit was reached.",
                    )
                else:
                    det_correct = self._check_answer(ex, student_answer)
                    if det_correct:
                        score, max_score, is_correct = 1, 1, True
                    else:
                        from backend.services.answer_adjudication import deterministic_rejection_is_conclusive
                        if deterministic_rejection_is_conclusive(ex, student_answer):
                            score, max_score, is_correct = 0, 1, False
                        else:
                            score, max_score, is_correct, requires_review, review_feedback = (
                                0, 1, False, True,
                                "Response saved for review because adjudication was unavailable within the exam time budget.",
                            )
            elif qtype == "reasoning":
                score, max_score, is_correct, requires_review, review_feedback = self._grade_reasoning(
                    ex,
                    student_answer,
                    student_id=student_id,
                    deadline=grading_deadline,
                )
            elif qtype == "multi_part":
                score, max_score, is_correct, requires_review, review_feedback, part_results = (
                    self._grade_multi_part(
                        ex,
                        student_answer,
                        student_id=student_id,
                        deadline=grading_deadline,
                    )
                )
                extra["part_results"] = part_results
            else:
                if open_response:
                    score, max_score, is_correct, requires_review, review_feedback = (
                        self._grade_short_answer_text(
                            ex,
                            student_answer,
                            student_id=student_id,
                            deadline=grading_deadline,
                        )
                    )
                else:
                    is_correct, adjudicated = self._check_answer_with_adjudication(
                        ex,
                        student_answer,
                        student_id=student_id,
                        deadline=grading_deadline,
                    )
                    score = 1 if is_correct else 0
                    max_score = 1
                    if adjudicated:
                        extra["llm_adjudicated"] = True
                    elif not is_correct and time.monotonic() >= grading_deadline:
                        from backend.services.answer_adjudication import deterministic_rejection_is_conclusive
                        if not deterministic_rejection_is_conclusive(ex, student_answer):
                            requires_review = True
                            review_feedback = "Response saved for review because adjudication was unavailable within the exam time budget."

            if time.monotonic() >= grading_deadline:
                grading_timed_out = True

            result_entry = {
                "question_id": qid,
                "question": ex["question"],
                "correct_answer": correct_answer_for_display(ex),
                "student_answer": student_answer,
                "is_correct": is_correct,
                "topic_ids": ex.get("topic_ids", []),
                "difficulty": ex.get("difficulty", "developing"),
                "score": score,
                "max_score": max_score,
                **extra,
            }
            if requires_review:
                result_entry["requires_review"] = True
            if review_feedback:
                result_entry["feedback"] = review_feedback

            if not requires_review:
                if is_correct:
                    correct_count += 1

                # Track per-strand only for resolved marks.
                for tid in ex.get("topic_ids", []):
                    strand = self._report_area(tid, topic_names)
                    if strand not in strand_stats:
                        strand_stats[strand] = {"correct": 0, "total": 0}
                    strand_stats[strand]["total"] += 1
                    if is_correct:
                        strand_stats[strand]["correct"] += 1

                total_score += result_entry["score"]
                total_max_score += result_entry["max_score"]

            results_per_question.append(result_entry)

        total = len(paper)
        percentage = round((total_score / total_max_score * 100) if total_max_score > 0 else 0, 1)
        pending_count = sum(1 for r in results_per_question if r.get("requires_review"))
        scored_questions = total - pending_count
        provisional = pending_count > 0
        grading_status = (
            "timed_out" if grading_timed_out
            else "pending" if pending_count == total and total > 0
            else "complete_with_pending" if pending_count > 0
            else "complete"
        )

        # Strand breakdown
        strand_breakdown = []
        for strand, stats in sorted(strand_stats.items()):
            pct = round(stats["correct"] / stats["total"] * 100, 1) if stats["total"] > 0 else 0
            strand_breakdown.append({
                "strand": strand,
                "correct": stats["correct"],
                "total": stats["total"],
                "percentage": pct,
            })

        # Weak topics (got wrong)
        weak_topics = list({
            tid
            for r in results_per_question
            if not r["is_correct"] and not r.get("requires_review")
            for tid in r["topic_ids"]
        })

        return {
            "exam_id": session["exam_id"],
            "total_questions": total,
            "correct": correct_count,
            "percentage": percentage,
            "total_score": total_score,
            "total_max_score": total_max_score,
            "pending_count": pending_count,
            "scored_questions": scored_questions,
            "provisional": provisional,
            "grading_status": grading_status,
            "grading_timed_out": grading_timed_out,
            "grading_warning": (
                "Some responses could not be auto-marked within the exam time budget and were saved for review."
                if grading_timed_out else None
            ),
            "strand_breakdown": strand_breakdown,
            "weak_topics": weak_topics,
            "topic_names": topic_names,
            "results_per_question": results_per_question,
            "started_at": session["started_at"],
            "deadline_at": session.get("deadline_at"),
            "completed_at": session["completed_at"],
            "time_limit_minutes": session.get("time_limit_minutes", 45),
        }

    def _check_answer(self, exercise: dict, student_answer: str) -> bool:
        """Simple answer checking (deterministic, no LLM)."""
        return grade_answer(exercise, student_answer)

    def _check_answer_with_adjudication(
        self,
        exercise: dict,
        student_answer: str,
        student_id: str | None = None,
        deadline: float | None = None,
    ) -> tuple[bool, bool]:
        """Deterministic marking, with a strictly one-way second opinion.

        The deterministic verdict stays authoritative: a model can only turn a
        rejected answer into a correct one, never the reverse, and any failure or
        absent provider leaves the deterministic result unchanged. This exists
        because an answer key holding several values cannot be matched by any
        normaliser, so a correct response would otherwise lose the mark in the one
        setting where it counts most.
        """
        from backend.services.answer_adjudication import grade_with_adjudication

        return grade_with_adjudication(
            exercise,
            student_answer,
            student_id=student_id,
            deterministic_result=self._check_answer(exercise, student_answer),
            deadline=deadline,
        )

    def _grade_short_answer_text(
        self,
        ex: dict,
        student_answer: str,
        student_id: str | None = None,
        deadline: float | None = None,
    ):
        """Grade an open text (English/Science) short-answer via the tutor marking path.

        Open text short-answers have no single enumerable 'correct' string, so
        exact-match grading produces false negatives. Route them through
        ``_mark_short_answer`` (local exact/variant match first, then LLM, then
        review-deferral) and defer to review rather than force-marking wrong.
        Returns ``(score, max_score, is_correct, requires_review, feedback)``.
        """
        if not student_answer.strip():
            return 0, 1, False, False, None
        try:
            from backend.routers.helpers import get_tutor_engine
            mark = get_tutor_engine()._mark_short_answer(
                ex,
                student_answer,
                student_id=student_id,
                deadline=deadline,
            )
        except Exception:
            logger.exception("Short-answer grading failed for %s", ex.get("id"))
            return 0, 1, False, True, "Short response saved for review (auto-grading unavailable)."
        if mark.get("error_type") == "parent_review_pending":
            return 0, 1, False, True, mark.get("feedback")
        is_correct = bool(mark.get("is_correct"))
        return (1 if is_correct else 0), 1, is_correct, False, mark.get("feedback")

    def _grade_reasoning(
        self,
        ex: dict,
        student_answer: str,
        student_id: str | None = None,
        deadline: float | None = None,
    ):
        """Rubric-grade an extended-response item.

        Returns ``(score, max_score, is_correct, requires_review, feedback)``.
        Blank answers score 0. Items without a rubric, or when the LLM is
        unavailable (mock/PU mode), are deferred to parent/teacher review rather
        than being force-graded by string equality (the old, broken behaviour).
        ``student_id`` is threaded through so the per-student parent-review
        preference is honoured (Audit SH1).
        """
        rubric = ex.get("rubric") or {}
        contract = normalise_reasoning_rubric(rubric)
        key_points = contract["key_points"]
        max_score = contract["max_score"]

        if not student_answer.strip():
            return 0, max_score or 1, False, False, None
        if not contract["valid"]:
            return 0, max_score or 1, False, True, "Extended response saved for parent review."
        try:
            from backend.routers.helpers import get_tutor_engine
            mark = get_tutor_engine()._mark_reasoning(
                ex,
                student_answer,
                student_id=student_id,
                deadline=deadline,
            )
        except Exception:
            logger.exception("Reasoning grading failed for %s", ex.get("id"))
            return 0, max_score, False, True, "Extended response saved for review (auto-grading unavailable)."

        if mark.get("error_type") == "parent_review_pending":
            pending_max = float(mark.get("max_score") or max_score)
            return 0, self._clean_score(pending_max), False, True, mark.get("feedback")
        return (
            self._clean_score(float(mark.get("score") or 0)),
            self._clean_score(float(mark.get("max_score") or max_score)),
            bool(mark.get("is_correct")),
            False,
            mark.get("feedback"),
        )

    def _grade_multi_part(
        self,
        ex: dict,
        student_answer: str,
        student_id: str | None = None,
        deadline: float | None = None,
    ):
        """Grade multi-part items via the tutor path (local + LLM + review).

        Open English/Science parts must not be force-failed by string equality.
        Returns ``(score, max_score, is_correct, requires_review, feedback, part_results)``.
        """
        sub_parts = ex.get("sub_parts") or []
        fallback_max = sum(float(part.get("marks") or 1) for part in sub_parts) or 1.0

        if not student_answer.strip():
            details = grade_multi_part_details(ex, student_answer)
            return (
                details["score"],
                details["max_score"] or fallback_max,
                False,
                False,
                None,
                details["part_results"],
            )

        try:
            from backend.routers.helpers import get_tutor_engine
            mark = get_tutor_engine()._mark_multi_part(
                ex,
                student_answer,
                student_id=student_id,
                deadline=deadline,
            )
        except Exception:
            logger.exception("Multi-part grading failed for %s", ex.get("id"))
            details = grade_multi_part_details(ex, student_answer)
            # Prefer review over a hard wrong mark when auto-grading fails mid-exam.
            return (
                0,
                details["max_score"] or fallback_max,
                False,
                True,
                "Multi-part response saved for review (auto-grading unavailable).",
                details["part_results"],
            )

        part_results = mark.get("part_results") or []
        try:
            max_score_value = float(mark.get("max_score"))
        except (TypeError, ValueError):
            max_score_value = fallback_max
        max_score = max_score_value if max_score_value > 0 else fallback_max
        if mark.get("error_type") == "parent_review_pending":
            return 0, self._clean_score(max_score), False, True, mark.get("feedback"), part_results

        try:
            score_value = float(mark.get("score") or 0)
        except (TypeError, ValueError):
            score_value = 0.0
        return (
            self._clean_score(score_value),
            self._clean_score(max_score),
            bool(mark.get("is_correct")),
            False,
            mark.get("feedback"),
            part_results,
        )

    def _exercise_for_session(self, session: dict, question_id: str) -> dict | None:
        """Return a question from imported session payload or the global bank."""
        imported = session.get("imported_questions") or []
        for ex in imported:
            if isinstance(ex, dict) and ex.get("id") == question_id:
                return ex
        return self.exercises.get(question_id)

    def with_question_views(
        self,
        *,
        student_id: str,
        subject: str,
        exam_id: str,
        results: dict,
    ) -> dict:
        """Return a copy of submitted results with review material per question.

        After submission the review needs the same stimulus, table, image and
        choices that the student saw, plus the worked steps. These are added to
        the response only, so stored results stay compact.
        """
        session = next(
            (
                item
                for item in get_engine(student_id, subject).get_exam_sessions()
                if item.get("exam_id") == exam_id
            ),
            {},
        )
        entries = []
        for entry in results.get("results_per_question", []):
            exercise = (
                self._exercise_for_session(session, str(entry.get("question_id") or ""))
                if isinstance(entry, dict)
                else None
            )
            if not exercise:
                entries.append(entry)
                continue
            review = {**entry, "question_view": _safe_exam_question(exercise)}
            steps = [str(step) for step in exercise.get("steps") or [] if step]
            if steps:
                review["solution_steps"] = steps
            entries.append(review)
        return {**results, "results_per_question": entries}

    def _topic_names(self, topic_ids: Iterable[str]) -> dict[str, str]:
        """Map topic IDs to curriculum names. Unknown IDs are left out."""
        names: dict[str, str] = {}
        for topic_id in dict.fromkeys(str(item) for item in topic_ids if item):
            try:
                topic = self.loader.load_topic(topic_id)
            except (OSError, ValueError):
                # A display label must never block exam marking.
                logger.warning("Could not load curriculum topic %s", topic_id, exc_info=True)
                continue
            if topic is not None and topic.name:
                names[topic_id] = topic.name
        return names

    def _report_area(self, topic_id: str, topic_names: dict[str, str]) -> str:
        """Group AC9 topics by strand and senior topics by curriculum topic name."""
        strand = self._strand_from_topic_id(topic_id)
        if strand != "Other":
            return strand
        return topic_names.get(topic_id, "Other")

    @staticmethod
    @lru_cache(maxsize=128)
    def _strand_from_topic_id(topic_id: str) -> str:
        """Extract strand name from an AC9 topic ID using regex-based lookup."""
        import re

        strand_map = {
            "N": "Number",
            "A": "Algebra",
            "SP": "Space",
            "ST": "Statistics",
            "P": "Probability",
            "M": "Measurement",
            "U": "Understanding",
            "H": "Human endeavour",
            "I": "Inquiry",
            "LA": "Language",
            "LY": "Literacy",
            "LT": "Literature",
        }

        # Match letter code after year 7–9 (one digit) or year 10 (two digits).
        # e.g. AC9M7SP01 → SP, AC9M10N01 → N, AC9S10I03 → I
        match = re.search(r"AC9[A-Z](?:10|[7-9])([A-Z]+)\d+", topic_id)
        if not match:
            return "Other"

        code = match.group(1)
        # Try longest prefix first (e.g. "SP" before "S")
        for prefix in sorted(strand_map.keys(), key=len, reverse=True):
            if code.startswith(prefix):
                return strand_map[prefix]
        return "Other"

    def _find_session(self, log: dict, exam_id: str) -> dict | None:
        """Find an exam session by ID."""
        for session in log.get("exam_sessions", []):
            if session["exam_id"] == exam_id:
                return session
        return None


# Singleton
import threading as _threading


_exam_simulator: ExamSimulator | None = None
_exam_simulator_lock = _threading.Lock()


def invalidate_exam_simulator(bank_generation: int | None = None) -> bool:
    """Release a cached simulator that was built from a stale exercise bank."""
    global _exam_simulator
    with _exam_simulator_lock:
        cached = _exam_simulator
        if cached is None:
            return False
        if (
            bank_generation is not None
            and getattr(cached, "_bank_generation", None) == bank_generation
        ):
            return False
        _exam_simulator = None
        return True


def get_exam_simulator() -> ExamSimulator:
    """Return the singleton built from the current atomic exercise snapshot.

    The tutor bank contains both year-level AC9 items and unit-scoped senior
    items. Sharing the current generation avoids parsing a second corpus while
    ensuring a hot reload cannot leave the scope index pinned to an old bank.
    """
    global _exam_simulator
    from backend.tutor_engine import get_tutor_engine

    tutor = get_tutor_engine()
    generation, exercises = tutor.exercise_bank_snapshot()
    cached = _exam_simulator
    if cached is None or getattr(cached, "_bank_generation", None) != generation:
        with _exam_simulator_lock:
            # The bank may have reloaded while this caller waited for the lock.
            generation, exercises = tutor.exercise_bank_snapshot()
            cached = _exam_simulator
            if cached is None or getattr(cached, "_bank_generation", None) != generation:
                cached = ExamSimulator(exercises, loader=tutor._loader)
                cached._bank_generation = generation
                _exam_simulator = cached
    return _exam_simulator
