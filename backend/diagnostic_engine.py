"""Diagnostic Engine.

Design §3.3 — diagnostic-and-spaced-repetition spec.
Req 2.*, 3.*, 4.*.

Orchestrates start/respond/status/dismiss for the adaptive diagnostic.
"""
from __future__ import annotations

import hashlib
import math
import uuid
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from backend.answer_grading import grade_answer, grade_multi_part_details
from backend.content_authoring.stimulus_loader import resolve_passage
from backend.subject_registry import is_text_graded
from backend.services.marking import demands_written_reasoning
from backend.diagnostic_pack_builder import DiagnosticPackBuilder
from backend.curriculum_loader import CurriculumLoader
from backend.rules import StudyRuleEngine, get_engine
from core.algorithms.bkt import recompute_accuracy as _recompute_accuracy_core
from backend.services.attempt_outcomes import (
    AttemptOutcome,
    is_scored_learning_attempt,
    persist_outcome,
)


MIN_VALID_SCORED_RESPONSES = 3
MAX_DIAGNOSTIC_RESPONSES = 24
MAX_UNSCORED_RESPONSES = 6
DIAGNOSTIC_COOLDOWN_DAYS = 45
# Scored questions are spread across report areas: 2-3 per area for the six
# Maths/Science areas, 4-5 per area for the three English strands.
TARGET_SCORED_RESPONSES = 12
BANDS = ("foundational", "developing", "extending", "AMC")
BAND_DIFFICULTY = {"foundational": -1.0, "developing": 0.0, "extending": 1.0, "AMC": 2.0}
SECURE_ABILITY = 0.5  # about 70% chance on a year-level (developing) question
START_HERE_ABILITY = -0.5  # about 30% chance
NOT_LEARNED_ANSWER = "I haven't learned this yet"
SCIENCE_SUB_STRANDS = {
    "B": "Biological sciences",
    "C": "Chemical sciences",
    "E": "Earth and space sciences",
    "P": "Physical sciences",
}
_ABILITY_GRID = tuple(step / 10 for step in range(-40, 41))


def area_limits(area_count: int) -> tuple[int, int]:
    """Return the (minimum, maximum) scored questions for each report area."""
    low = max(2, math.ceil(TARGET_SCORED_RESPONSES / max(1, area_count)))
    return low, low + 1


def estimate_ability(responses: list[dict]) -> float:
    """Return the expected ability for one area (N(0, 1) prior, 3PL-style items).

    The diagnostic gives no feedback between items, so nothing is learned
    between answers and their order must not matter (BKT assumes learning
    after each answer). Item difficulty comes from the authored band. MCQ keeps
    a 1-in-4 guess floor; a correct answer marked "guess" is weaker evidence.
    """
    items = []
    for response in responses:
        if not is_scored_learning_attempt(response):
            continue
        correct = bool(response.get("is_correct"))
        floor = 0.25 if response.get("question_type") == "multiple_choice" else 0.02
        if correct and response.get("confidence") == "guess":
            floor = 0.5
        items.append((BAND_DIFFICULTY.get(response.get("difficulty"), 0.0), correct, floor))
    weights = []
    for ability in _ABILITY_GRID:
        weight = math.exp(-ability * ability / 2)
        for difficulty, correct, floor in items:
            p_correct = floor + (1 - floor) / (1 + math.exp(-1.7 * (ability - difficulty)))
            weight *= p_correct if correct else 1 - p_correct
        weights.append(weight)
    return sum(a * w for a, w in zip(_ABILITY_GRID, weights)) / sum(weights)


def area_band(ability: float) -> str:
    """Map an area ability to the three reported placement bands."""
    if ability >= SECURE_ABILITY:
        return "secure"
    return "start_here" if ability < START_HERE_ABILITY else "building"


def _area_of(topic) -> str:
    """Report area of a topic: its strand, with Science Understanding split."""
    sub_strand = SCIENCE_SUB_STRANDS.get(getattr(topic, "sub_strand", None) or "")
    return sub_strand if sub_strand and topic.strand == "Science Understanding" else topic.strand


class DiagnosticTooRecent(Exception):
    """Raised when a diagnostic rerun is attempted during the cooldown."""
    pass


class DiagnosticAlreadyFinalised(Exception):
    """Raised when responding to an already-finalised diagnostic."""
    pass


class DiagnosticRequestConflict(Exception):
    """Raised when a diagnostic request ID is reused with new content."""
    pass


def _utcnow_iso() -> str:
    """Return current UTC time as ISO 8601 string."""
    return datetime.now(timezone.utc).isoformat()


def _parse_iso(s: str) -> datetime:
    """Parse an ISO 8601 string to a timezone-aware datetime."""
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _safe_diagnostic_sub_parts(sub_parts: list[dict] | None) -> list[dict]:
    """Backward-compatible wrapper around the shared safe projection."""
    from backend.services.question_context import student_question_view
    return student_question_view({"sub_parts": sub_parts or []}).get("sub_parts", [])


def _safe_diagnostic_question(exercise: dict) -> dict:
    """Serialize a diagnostic question using the shared answer-free view."""
    from backend.services.question_context import student_question_view
    return student_question_view(exercise)


def _is_supported_diagnostic_question(exercise: dict, include_reasoning: bool = False) -> bool:
    """Return whether the current diagnostic UI can fairly collect the answer.

    Short-answer and multiple-choice are eligible when their required context
    is available. Reasoning and open-text multi-part items require live rubric
    grading; deterministic Mathematics multi-part items can be used without an
    LLM. Declared stimulus tasks are excluded when their source cannot resolve.
    """
    metadata = exercise.get("english_metadata") or {}
    if metadata.get("passage_mode") in {"stimulus", "inline"} and not resolve_passage(exercise):
        return False

    qt = exercise.get("question_type", "short_answer")
    if qt == "short_answer":
        if exercise.get("subject") == "math" and demands_written_reasoning(exercise):
            return include_reasoning
        return True
    if qt == "multiple_choice":
        return True
    if qt == "reasoning":
        return include_reasoning and bool((exercise.get("rubric") or {}).get("key_points"))
    if qt == "multi_part":
        parts = exercise.get("sub_parts") or []
        if not parts or any(not part.get("answer") for part in parts):
            return False
        if exercise.get("subject") == "math":
            needs_semantic_marking = demands_written_reasoning(exercise) or any(
                demands_written_reasoning(part) for part in parts
            )
            return include_reasoning if needs_semantic_marking else True
        return include_reasoning
    return False


class DiagnosticEngine:
    """Orchestrates the diagnostic assessment flow."""

    def __init__(self, exercises: dict, loader: CurriculumLoader | None = None):
        self.exercises = exercises
        self.loader = loader or CurriculumLoader()
        self.builder = DiagnosticPackBuilder(self.loader, exercises)
        # Cache (subject, year_level) → (pools, sorted_strands). The exercise bank
        # is static for the engine's lifetime, so pools need only be built once
        # rather than on every respond() call (Audit D4). Callers read but never
        # mutate the returned pools.
        self._pools_cache: dict = {}

    def start(
        self, *, student_id: str, subject: str, year_level: int, area: str | None = None
    ) -> dict:
        """Start or resume a diagnostic run for (student_id, subject, year_level).

        ``area`` starts a short retest of one report area. It needs a completed
        valid diagnostic, skips the cooldown, and only replaces that area.
        """
        engine = get_engine(student_id, subject)
        with engine._lock:
            log = engine._read_log(topics=[])
            status_key = f"{subject}::{year_level}"
            status = log.get("diagnostic_status", {}).get(status_key) or {}
            retest_unavailable = {
                "error": "area_retest_unavailable",
                "message": "Complete a full diagnostic before retesting one area.",
            }
            if area is None:
                self._enforce_cooldown(log, subject, year_level)
            elif area not in self._placement_view(
                status, self._find_report(log, str(status.get("report_id") or ""))
            )["areas"]:
                return retest_unavailable

            # Resume the matching unfinished run (full run or area retest).
            for report in log.get("diagnostic_reports", []):
                if (
                    report.get("completed_at") is None
                    and report.get("subject") == subject
                    and report.get("year_level") == year_level
                    and report.get("area_scope") == area
                    and (area is not None or report.get("report_id") == status.get("report_id"))
                    and report.get("cursor", 0) < len(report.get("pack", []))
                ):
                    return self._question_payload(report)

            # Gather adaptive pools and areas using a stable capability snapshot
            # for this session. Pool caches include this snapshot so a temporary
            # LLM/review-mode change cannot leak unsuitable items across sessions.
            capabilities = self._grading_capabilities(student_id)
            pools, areas = self._get_pools_and_strands(
                subject, year_level, capabilities=capabilities
            )
            if not areas or (area is not None and area not in areas):
                return retest_unavailable if area is not None else {
                    "error": "no_exercises_available",
                    "message": "No exercises available for this subject and year level.",
                }

            # Full reruns rotate the area order. The item offset is seeded by the
            # student, so first diagnostics do not all share the same items.
            completed_runs = self._diagnostic_rotation_offset(log, subject, year_level)
            limits = area_limits(len(areas))
            report_id = str(uuid.uuid4())
            now_iso = _utcnow_iso()
            report = {
                "report_id": report_id,
                "subject": subject,
                "year_level": year_level,
                "started_at": now_iso,
                "completed_at": None,
                "pack": [],
                "cursor": 0,
                "responses": [],
                "strand_order": [area] if area else self._rotated_strand_order(areas, completed_runs),
                "area_scope": area,
                "area_limits": list(limits),
                "selection_offset": self._selection_offset(
                    student_id, subject, year_level, completed_runs
                ),
                "grading_capabilities": capabilities,
                "valid_completion": False,
                "grading_warnings": [],
                "coverage": self._coverage_summary(subject, pools, capabilities),
            }

            # Prefer questions the student has not already seen in practice or a
            # previous diagnostic. Fall back to seen items only when needed.
            prior_seen_qids = self._prior_seen_question_ids(log)
            prior_seen_qids.update(engine.get_attempted_question_ids())
            first_qid = self._next_question(
                report, pools, report["strand_order"], prior_seen_qids
            )
            if first_qid is None:
                return {
                    "error": "no_exercises_available",
                    "message": "No exercises available for the first area.",
                }
            estimated = len(report["strand_order"]) * limits[0]
            report["pack"] = [first_qid] + ["dummy_qid"] * (estimated - 1)

            log.setdefault("diagnostic_reports", []).append(report)
            if area is None:
                log.setdefault("diagnostic_status", {})[status_key] = {
                    "report_id": report_id,
                    "completed_at": None,
                    "first_interaction_at": now_iso,
                    "diagnostic_dismissed_at": None,
                    # Kept so the next result can show the change per area.
                    "previous_areas": status.get("areas") or status.get("previous_areas"),
                }
            engine._write_log(log)
            return self._question_payload(report)

    def _question_payload(self, report: dict) -> dict:
        """Return the current question of a report with area progress."""
        question_id = report["pack"][report["cursor"]]
        question = self.exercises.get(question_id, {"id": question_id})
        order = report.get("strand_order") or []
        area = self._exercise_area(report["subject"], question)
        return {
            "report_id": report["report_id"],
            "question": _safe_diagnostic_question(question),
            "progress": {
                "current": report["cursor"] + 1,
                "total": len(report["pack"]),
                "area_current": order.index(area) + 1 if area in order else 1,
                "area_total": len(order),
            },
            "coverage": report.get("coverage"),
        }

    def respond(
        self,
        *,
        student_id: str,
        report_id: str,
        question_id: str,
        student_answer: str,
        request_id: str | None = None,
        request_fingerprint: str | None = None,
        not_learned: bool = False,
        confidence: str | None = None,
    ) -> dict:
        """Record a response and dynamically decide the next question based on performance."""
        subject = self._find_report_subject(student_id, report_id)
        if subject is None:
            subject = "math"
        engine = get_engine(student_id, subject)

        with engine._lock:
            log = engine._read_log(topics=[])
            report = self._find_report(log, report_id)
            if report is None:
                return {"error": "report_not_found", "message": "Diagnostic report not found."}

            if request_id:
                expected_fingerprint = str(request_fingerprint or "")
                for prior_response in report.get("responses", []):
                    if prior_response.get("request_id") != request_id:
                        continue
                    if str(prior_response.get("request_fingerprint") or "") != expected_fingerprint:
                        raise DiagnosticRequestConflict(
                            "request_id was already used for different diagnostic content"
                        )
                    stored_response = prior_response.get("mutation_response")
                    if isinstance(stored_response, dict):
                        return stored_response
                    raise DiagnosticRequestConflict(
                        "diagnostic request has no replayable response"
                    )

            if report.get("completed_at") is not None:
                raise DiagnosticAlreadyFinalised()

            # Validate submitted question_id matches current pack position
            cursor = report.get("cursor", 0)
            pack = report.get("pack", [])
            if cursor >= len(pack) or pack[cursor] != question_id:
                return {"error": "invalid_question", "message": "Question does not match expected sequence."}

            # Grade once and preserve the complete scored/unscored result. This
            # same record drives adaptive branching, finalisation and display.
            # "Not learned yet" is honest incorrect evidence, not a guess.
            exercise = self.exercises.get(question_id, {})
            if not_learned:
                student_answer = NOT_LEARNED_ANSWER
                grading = {
                    "is_correct": False,
                    "outcome": AttemptOutcome.INCORRECT.value,
                    "error_type": "not_yet_learned",
                    "score": 0,
                    "max_score": 1,
                }
            else:
                grading = self._grade_response(
                    exercise, student_answer, student_id=student_id
                )
            is_correct = bool(grading.get("is_correct"))
            grading_deferred = grading.get("outcome") == AttemptOutcome.PENDING.value

            # Determine topic_id from exercise
            topic_ids = exercise.get("topic_ids", [])
            topic_id = topic_ids[0] if topic_ids else "unknown"

            # Build response record
            now_iso = _utcnow_iso()
            response_record = {
                "attempt_id": str(uuid.uuid4()),
                "question_id": question_id,
                "topic_id": topic_id,
                "area": self._exercise_area(report["subject"], exercise),
                "difficulty": exercise.get("difficulty") if exercise.get("difficulty") in BANDS else "developing",
                "is_correct": is_correct,
                "student_answer": student_answer[:5000],
                "error_type": grading.get("error_type"),
                "grading_deferred": grading_deferred,
                "outcome": grading.get("outcome"),
                "score": grading.get("score"),
                "max_score": grading.get("max_score"),
                "part_results": grading.get("part_results"),
                "llm_adjudicated": bool(grading.get("llm_adjudicated", False)),
                "timestamp": now_iso,
                # Carry the question type so scoring applies the MCQ guess floor
                # and practice BKT applies the matching guess/slip parameters.
                "question_type": exercise.get("question_type", "short_answer"),
                "attempt_type": "diagnostic",
            }
            if not_learned:
                response_record["not_learned"] = True
            if confidence:
                response_record["confidence"] = confidence
            if exercise.get("year_level") not in (None, report["year_level"]):
                response_record["prior_year"] = True
            if request_id:
                response_record["request_id"] = request_id
                response_record["request_fingerprint"] = str(request_fingerprint or "")
            persist_outcome(response_record)

            report["responses"].append(response_record)
            report["cursor"] += 1

            # Determine the next question adaptively
            pools, available_areas = self._get_pools_and_strands(
                report["subject"],
                report["year_level"],
                capabilities=report.get("grading_capabilities"),
            )
            order = [area for area in report.get("strand_order") or [] if area in available_areas]
            if not report.get("area_scope"):
                order.extend(area for area in available_areas if area not in order)
            report["strand_order"] = order
            report.setdefault("selection_offset", 0)

            cap_reason = self._session_cap_reason(report)
            if cap_reason:
                report["termination_reason"] = cap_reason
                next_qid = None
            else:
                prior_seen_qids = self._prior_seen_question_ids(
                    log, exclude_report_id=report_id
                )
                prior_seen_qids.update(engine.get_attempted_question_ids())
                next_qid = self._next_question(report, pools, order, prior_seen_qids)

            if next_qid is None:
                # All areas completed: truncate the pack to finish.
                report["pack"] = report["pack"][:report["cursor"]]
            else:
                low = (report.get("area_limits") or area_limits(len(order)))[0]
                scored_per_area = defaultdict(int)
                for response in report["responses"]:
                    if is_scored_learning_attempt(response) and not response.get("prior_year"):
                        scored_per_area[response.get("area")] += 1
                remaining = max(1, sum(max(0, low - scored_per_area[area]) for area in order))
                report["pack"] = report["pack"][:report["cursor"]] + [next_qid] + ["dummy_qid"] * (remaining - 1)

            # Check if pack is complete. Build the replay payload before writing the
            # report so request metadata and business progression commit together.
            completed = report["cursor"] >= len(report["pack"])
            if completed:
                self._finalise(engine, log, report)
                status_key = f'{report["subject"]}::{report["year_level"]}'
                status = log.get("diagnostic_status", {}).get(status_key)
                payload = {
                    "completed": True,
                    **self._placement_view(status, report),
                    "report_id": report_id,
                    "area_scope": report.get("area_scope"),
                    "is_correct": is_correct,
                    "response_outcome": response_record.get("outcome"),
                    "grading_deferred": grading_deferred,
                    "llm_adjudicated": response_record.get("llm_adjudicated", False),
                    "valid_completion": bool(report.get("valid_completion")),
                    "scored_responses": report.get("scored_responses", 0),
                    "unscored_responses": report.get("unscored_responses", 0),
                    "coverage": report.get("coverage"),
                }
                payload.update(self._retake_metadata(status))
                if report.get("grading_warnings"):
                    payload["grading_warnings"] = report["grading_warnings"]
            else:
                payload = {
                    "completed": False,
                    **self._question_payload(report),
                    "is_correct": is_correct,
                    "response_outcome": response_record.get("outcome"),
                    "grading_deferred": grading_deferred,
                    "llm_adjudicated": response_record.get("llm_adjudicated", False),
                }
                payload.pop("coverage", None)

            if request_id:
                response_record["mutation_response"] = payload
            engine._write_log(log)
            if completed:
                engine.refresh_mistake_states(
                    response.get("question_id")
                    for response in report.get("responses", [])
                    if is_scored_learning_attempt(response)
                )
                try:
                    from backend.api import invalidate_mistakes_cache
                    invalidate_mistakes_cache(student_id)
                except ImportError:
                    pass
            return payload

    def status(
        self, *, student_id: str, subject: str, year_level: int
    ) -> dict:
        """Return the diagnostic status for (subject, year_level)."""
        engine = get_engine(student_id, subject)
        status = engine.get_diagnostic_status(year_level)
        reports = engine.get_diagnostic_reports()
        if status is None:
            return {
                "completed": False,
                "report_id": None,
                "completed_at": None,
                "in_progress": False,
                "current": 0,
                "total": 0,
                "retake_available": True,
                "next_eligible_at": None,
            }
        rid = status.get("report_id")
        in_progress = rid is not None and status.get("completed_at") is None
        current = 0
        total = 0
        report_record = None
        if in_progress:
            for report in reports:
                if report.get("report_id") == rid:
                    report_record = report
                    current = report.get("cursor", 0)
                    total = len(report.get("pack", []))
                    break
        elif rid is not None:
            for report in reports:
                if report.get("report_id") == rid:
                    report_record = report
                    total = len(report.get("pack", []))
                    current = min(report.get("cursor", 0), total)
                    break
        return {
            "completed": status.get("completed_at") is not None,
            "report_id": rid,
            "completed_at": status.get("completed_at"),
            "in_progress": in_progress,
            **self._retake_metadata(status),
            "current": current,
            "total": total,
            "started_at": report_record.get("started_at") if report_record else None,
            **self._placement_view(status, report_record),
            "responses_count": len(report_record.get("responses", [])) if report_record else 0,
            "scored_responses": report_record.get("scored_responses", 0) if report_record else 0,
            "unscored_responses": report_record.get("unscored_responses", 0) if report_record else 0,
            "valid_completion": report_record.get("valid_completion") if report_record else None,
            "grading_warnings": report_record.get("grading_warnings", []) if report_record else [],
            "coverage": (
                (report_record.get("coverage") if report_record else None)
                or self._coverage_summary(
                    subject,
                    self._get_pools_and_strands(
                        subject,
                        year_level,
                        capabilities=self._grading_capabilities(student_id),
                    )[0],
                    self._grading_capabilities(student_id),
                )
            ),
        }

    def dismiss(
        self, *, student_id: str, subject: str, year_level: int
    ) -> dict:
        """Dismiss the diagnostic prompt for (subject, year_level)."""
        engine = get_engine(student_id, subject)
        with engine._lock:
            log = engine._read_log(topics=[])
            status_key = f"{subject}::{year_level}"
            status = log.setdefault("diagnostic_status", {}).get(status_key)
            now_iso = _utcnow_iso()
            if status is None:
                log["diagnostic_status"][status_key] = {
                    "report_id": None,
                    "completed_at": None,
                    "first_interaction_at": now_iso,
                    "diagnostic_dismissed_at": now_iso,
                }
            else:
                status["diagnostic_dismissed_at"] = now_iso
            engine._write_log(log)
        return {"dismissed": True}

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _retake_metadata(status: dict | None) -> dict:
        """Return whether a new diagnostic can start and the next eligible time."""
        if status is None:
            return {"retake_available": True, "next_eligible_at": None}

        completed_at = status.get("completed_at")
        if completed_at is None:
            return {"retake_available": False, "next_eligible_at": None}
        if status.get("valid_completion") is False:
            return {"retake_available": True, "next_eligible_at": None}

        completed_dt = _parse_iso(completed_at)
        next_eligible = completed_dt + timedelta(days=DIAGNOSTIC_COOLDOWN_DAYS)
        return {
            "retake_available": datetime.now(timezone.utc) >= next_eligible,
            "next_eligible_at": next_eligible.isoformat(),
        }

    def _enforce_cooldown(self, log: dict, subject: str, year_level: int) -> None:
        """Raise DiagnosticTooRecent while a valid completion is cooling down."""
        import os
        if os.getenv("DIAGNOSTIC_COOLDOWN_BYPASS") == "true":
            return

        status_key = f"{subject}::{year_level}"
        status = log.get("diagnostic_status", {}).get(status_key)
        metadata = self._retake_metadata(status)
        if status is not None and status.get("completed_at") and not metadata["retake_available"]:
            raise DiagnosticTooRecent()

    def _find_report(self, log: dict, report_id: str) -> dict | None:
        """Find a diagnostic report by report_id."""
        for report in log.get("diagnostic_reports", []):
            if report.get("report_id") == report_id:
                return report
        return None

    def _find_report_subject(self, student_id: str, report_id: str) -> str | None:
        """Find which subject a report belongs to by checking logs."""
        for subject in ("math", "english", "science"):
            try:
                engine = get_engine(student_id, subject)
                for report in engine.get_diagnostic_reports():
                    if report.get("report_id") == report_id:
                        return subject
            except Exception:
                continue
        return None

    def _grade_response(
        self, exercise: dict, student_answer: str, student_id: str | None = None
    ) -> dict:
        """Return one explicit scored/unscored diagnostic result."""
        if not exercise or not exercise.get("id"):
            return {
                "is_correct": False,
                "outcome": AttemptOutcome.PENDING.value,
                "error_type": "grading_deferred",
                "score": None,
                "max_score": None,
            }
        if not student_answer.strip():
            return {
                "is_correct": False,
                "outcome": AttemptOutcome.UNANSWERED.value,
                "error_type": "unanswered",
                "score": 0,
                "max_score": None,
            }

        question_type = exercise.get("question_type", "short_answer")
        if question_type == "multi_part":
            # Value-only Mathematics parts stay deterministic. Any root/sub-part
            # that explicitly demands written reasoning uses the semantic/review
            # path so a sound paraphrase is never forced into an incorrect mark.
            # A sub-part whose authored answer is a word or phrase (no maths
            # signal) is graded the same way: exact text matching would fail a
            # correct paraphrase such as "a trapezium" for "Trapezium", so it
            # must not be force-marked by the deterministic scorer.
            from backend.services.answer_adjudication import has_math_signal

            sub_parts = exercise.get("sub_parts") or []
            math_written_reasoning = exercise.get("subject") == "math" and (
                demands_written_reasoning(exercise)
                or any(demands_written_reasoning(part) for part in sub_parts)
                or any(
                    not part.get("choices")
                    and str(part.get("answer") or "").strip()
                    and not has_math_signal(str(part.get("answer") or ""))
                    for part in sub_parts
                )
            )
            if exercise.get("subject") == "math" and not math_written_reasoning:
                detail = grade_multi_part_details(exercise, student_answer)
                # Match practice multi-part typing (marking.py): a wrong value part
                # is incorrect_value and an incorrect root is partial_incorrect.
                for part in detail.get("part_results") or []:
                    if part.get("outcome") == AttemptOutcome.INCORRECT.value:
                        part["error_type"] = "incorrect_value"
                if (
                    not detail.get("is_correct")
                    and not detail.get("error_type")
                    and detail.get("outcome") == AttemptOutcome.INCORRECT.value
                ):
                    detail["error_type"] = "partial_incorrect"
            else:
                try:
                    from backend.routers.helpers import get_tutor_engine
                    detail = get_tutor_engine()._mark_multi_part(
                        exercise, student_answer, student_id=student_id
                    )
                except Exception:
                    detail = {"outcome": AttemptOutcome.PENDING.value, "error_type": "parent_review_pending"}
            outcome = str(detail.get("outcome") or "").lower()
            if detail.get("error_type") == "parent_review_pending" or outcome == AttemptOutcome.PENDING.value:
                outcome = AttemptOutcome.PENDING.value
            elif outcome == AttemptOutcome.UNANSWERED.value:
                outcome = AttemptOutcome.UNANSWERED.value
            elif outcome not in {AttemptOutcome.CORRECT.value, AttemptOutcome.INCORRECT.value}:
                outcome = AttemptOutcome.CORRECT.value if detail.get("is_correct") else AttemptOutcome.INCORRECT.value
            if outcome == AttemptOutcome.CORRECT.value:
                error_type = None
            elif outcome == AttemptOutcome.PENDING.value:
                error_type = "grading_deferred"
            elif outcome == AttemptOutcome.UNANSWERED.value:
                error_type = "unanswered"
            else:
                error_type = detail.get("error_type") or None
            return {
                "is_correct": outcome == AttemptOutcome.CORRECT.value,
                "outcome": outcome,
                "error_type": error_type,
                "score": detail.get("score"),
                "max_score": detail.get("max_score"),
                "part_results": detail.get("part_results"),
            }

        if question_type == "reasoning":
            try:
                from backend.routers.helpers import get_tutor_engine
                mark = get_tutor_engine()._mark_reasoning(
                    exercise, student_answer, student_id=student_id
                )
            except Exception:
                mark = {"error_type": "parent_review_pending"}
            if mark.get("error_type") == "parent_review_pending":
                return {
                    "is_correct": False,
                    "outcome": AttemptOutcome.PENDING.value,
                    "error_type": "grading_deferred",
                    "score": mark.get("score"),
                    "max_score": mark.get("max_score"),
                }
            is_correct = bool(mark.get("is_correct"))
            return {
                "is_correct": is_correct,
                "outcome": AttemptOutcome.CORRECT.value if is_correct else AttemptOutcome.INCORRECT.value,
                # Preserve mark-provided types (e.g. reasoning_incomplete); never invent concept_gap.
                "error_type": None if is_correct else mark.get("error_type") or None,
                "score": mark.get("score"),
                "max_score": mark.get("max_score"),
            }

        if (
            is_text_graded(exercise.get("subject"))
            or (exercise.get("subject") == "math" and demands_written_reasoning(exercise))
        ) and question_type == "short_answer":
            is_correct, deferred = self._grade_text_short_answer_correct(
                exercise, student_answer, student_id=student_id
            )
            return {
                "is_correct": is_correct,
                "outcome": (
                    AttemptOutcome.PENDING.value if deferred
                    else AttemptOutcome.CORRECT.value if is_correct
                    else AttemptOutcome.INCORRECT.value
                ),
                "error_type": "grading_deferred" if deferred else None,
                "score": 1 if is_correct else 0,
                "max_score": 1,
            }

        is_correct = grade_answer(exercise, student_answer)
        llm_adjudicated = False
        grading_deferred = False
        if not is_correct:
            from backend.services.answer_adjudication import (
                adjudicate_equivalence,
                deterministic_rejection_is_conclusive,
                is_adjudicable,
            )

            if is_adjudicable(exercise) and not deterministic_rejection_is_conclusive(
                exercise, student_answer
            ):
                adjudication = adjudicate_equivalence(
                    exercise, student_answer, student_id=student_id
                )
                if adjudication == "confirmed":
                    is_correct = True
                    llm_adjudicated = True
                elif adjudication == "unavailable":
                    grading_deferred = True

        if grading_deferred:
            return {
                "is_correct": False,
                "outcome": AttemptOutcome.PENDING.value,
                "error_type": "grading_deferred",
                "score": 0,
                "max_score": 1,
                "llm_adjudicated": False,
            }

        # Use the same error types as practice marking for the same miss:
        # MCQ -> incorrect_choice; a deterministic value miss -> incorrect_value.
        # An untyped miss is counted as "unknown" in the Error Book summary.
        # Never invent a diagnosis such as concept_gap. An explicitly
        # adjudicated upgrade is a resolved correct response and has no error type.
        if is_correct:
            error_type = None
        elif question_type == "multiple_choice":
            error_type = "incorrect_choice"
        else:
            error_type = "incorrect_value"
        return {
            "is_correct": is_correct,
            "outcome": AttemptOutcome.CORRECT.value if is_correct else AttemptOutcome.INCORRECT.value,
            "error_type": error_type,
            "score": 1 if is_correct else 0,
            "max_score": 1,
            "llm_adjudicated": bool(llm_adjudicated),
        }

    def _grade_answer(
        self, exercise: dict, student_answer: str, student_id: str | None = None
    ) -> tuple[bool, bool]:
        """Grade a response.

        Returns ``(is_correct, grading_deferred)``.

        Short-answer/MCQ/multi-part use the deterministic, subject-aware helper.
        Reasoning and open English/Science short-answers use the tutor LLM path.
        When auto-grading cannot confirm a mark, ``grading_deferred=True`` so the
        item is excluded from BKT rather than counted as incorrect.
        """
        result = self._grade_response(exercise, student_answer, student_id=student_id)
        return (
            bool(result.get("is_correct")),
            result.get("outcome") == AttemptOutcome.PENDING.value,
        )

    def _grade_text_short_answer_correct(
        self, exercise: dict, student_answer: str, student_id: str | None = None
    ) -> tuple[bool, bool]:
        """Correct/incorrect signal for an open text (English/Science) short-answer.

        Uses the tutor marking path (local exact/variant match first, then LLM).
        When the open item cannot be auto-graded, return deferred rather than a
        silent wrong mark that would steer CAT and depress BKT.
        """
        if not student_answer.strip():
            return False, False
        try:
            from backend.routers.helpers import get_tutor_engine
            mark = get_tutor_engine()._mark_short_answer(exercise, student_answer, student_id=student_id)
        except Exception:
            local = grade_answer(exercise, student_answer)
            return (local, False) if local else (False, True)
        if mark.get("error_type") == "parent_review_pending":
            # Local exact/variant match can still confirm correct; otherwise defer.
            local = grade_answer(exercise, student_answer)
            if local:
                return True, False
            return False, True
        return bool(mark.get("is_correct")), False

    def _grade_reasoning_correct(
        self, exercise: dict, student_answer: str, student_id: str | None = None
    ) -> tuple[bool, bool]:
        """Return (is_correct, grading_deferred) for a reasoning item via rubric marking."""
        if not student_answer.strip():
            return False, False
        try:
            from backend.routers.helpers import get_tutor_engine
            mark = get_tutor_engine()._mark_reasoning(exercise, student_answer, student_id=student_id)
        except Exception:
            return False, True
        if mark.get("error_type") == "parent_review_pending":
            return False, True
        return bool(mark.get("is_correct")), False

    def _complete_finalisation_metadata(self, report: dict, log: dict, areas: dict) -> None:
        """Store the run result and the current per-area placement.

        A full run replaces the placement and starts the cooldown when valid.
        An area retest replaces only its own area and never moves the cooldown.
        """
        subject, year_level = report["subject"], report["year_level"]
        area_scope = report.get("area_scope")
        scored = [r for r in report.get("responses", []) if is_scored_learning_attempt(r)]
        unscored = [r for r in report.get("responses", []) if not is_scored_learning_attempt(r)]
        pending_count = sum(1 for r in unscored if r.get("outcome") == AttemptOutcome.PENDING.value)
        unanswered_count = sum(1 for r in unscored if r.get("outcome") == AttemptOutcome.UNANSWERED.value)
        valid_completion = (
            area_scope in areas if area_scope else len(scored) >= MIN_VALID_SCORED_RESPONSES
        )
        warnings: list[str] = []
        if pending_count:
            warnings.append(
                f"{pending_count} response(s) could not be scored and were excluded from the results."
            )
        if unanswered_count:
            warnings.append(
                f"{unanswered_count} unanswered response(s) were marked not scored."
            )
        termination_reason = report.get("termination_reason")
        if termination_reason == "unscored_cap":
            warnings.append(
                f"The diagnostic stopped after {MAX_UNSCORED_RESPONSES} responses could not be scored. "
                "This prevents an open-ended session; try again when semantic marking is available."
            )
        elif termination_reason == "response_cap":
            warnings.append(
                f"The diagnostic reached its {MAX_DIAGNOSTIC_RESPONSES}-question safety limit and stopped."
            )
        if not valid_completion:
            warnings.append(
                "No scored answers were available, so this area result did not change."
                if area_scope
                else f"Only {len(scored)} scored response(s) were available. At least "
                f"{MIN_VALID_SCORED_RESPONSES} are required for a valid diagnostic completion; "
                "no cooldown has been started."
            )

        now_iso = _utcnow_iso()
        report.update({
            "completed_at": now_iso,
            "scored_responses": len(scored),
            "unscored_responses": len(unscored),
            "valid_completion": valid_completion,
            "grading_warnings": warnings,
            "areas": areas,
        })

        status_key = f"{subject}::{year_level}"
        status = log.setdefault("diagnostic_status", {}).setdefault(status_key, {})
        if area_scope:
            if not valid_completion:
                return
            main_report = self._find_report(log, str(status.get("report_id") or ""))
            merged = dict(self._placement_view(status, main_report)["areas"])
            previous = (merged.get(area_scope) or {}).get("band")
            merged[area_scope] = {**areas[area_scope], "previous_band": previous}
        else:
            status.update({
                "completed_at": now_iso,
                "report_id": report["report_id"],
                "valid_completion": valid_completion,
                "scored_responses": len(scored),
            })
            if not valid_completion:
                return
            previous_areas = status.get("previous_areas") or {}
            merged = {
                name: {**result, "previous_band": (previous_areas.get(name) or {}).get("band")}
                for name, result in areas.items()
            }
        status["areas"] = merged
        status.update(self._placement(subject, year_level, merged))

    def _slice(self, subject: str, year_level: int | None):
        try:
            return self.loader.load_slice(self._framework_id_for_subject(subject), int(year_level))
        except Exception:
            return None

    def _topic_areas(self, subject: str, year_level: int | None) -> dict[str, str]:
        slice_obj = self._slice(subject, year_level) if year_level is not None else None
        return {topic.topic_id: _area_of(topic) for topic in slice_obj.topics} if slice_obj else {}

    def _exercise_area(self, subject: str, exercise: dict) -> str | None:
        """Area of an exercise in its own year (same rule as pool building)."""
        topic_areas = self._topic_areas(subject, exercise.get("year_level"))
        return next(
            (topic_areas[tid] for tid in sorted(exercise.get("topic_ids") or []) if tid in topic_areas),
            None,
        )

    def _area_results(self, report: dict) -> dict[str, dict]:
        """Estimate each area from its scored answers and choose a start topic."""
        subject, year_level = report["subject"], report["year_level"]
        topic_areas = self._topic_areas(subject, year_level)
        slice_obj = self._slice(subject, year_level)
        sequence = list(getattr(getattr(slice_obj, "sequence", None), "sequence", None) or topic_areas)
        rank = {topic_id: index for index, topic_id in enumerate(sequence)}
        grouped: dict[str, list[dict]] = defaultdict(list)
        prior_checks: dict[str, dict] = {}
        for response in report.get("responses", []):
            if not is_scored_learning_attempt(response):
                continue
            area = response.get("area") or topic_areas.get(response.get("topic_id"))
            if not area:
                continue
            if response.get("prior_year"):
                prior_checks[area] = {
                    "year": year_level - 1,
                    "topic_id": response.get("topic_id"),
                    "correct": bool(response.get("is_correct")),
                }
                continue
            if response.get("difficulty") not in BANDS:
                # Reports created before area placement did not store difficulty.
                exercise = self.exercises.get(response.get("question_id")) or {}
                response = {**response, "difficulty": exercise.get("difficulty", "developing")}
            grouped[area].append(response)

        results: dict[str, dict] = {}
        for area, responses in grouped.items():
            ability = estimate_ability(responses)
            band = area_band(ability)
            misses = sorted(
                (r for r in responses if not r.get("is_correct")),
                key=lambda r: rank.get(r.get("topic_id"), len(rank)),
            )
            confident = [r for r in misses if r.get("confidence") == "sure" and not r.get("not_learned")]
            start_topic = None
            if band != "secure":
                candidates = confident or misses
                start_topic = candidates[0]["topic_id"] if candidates else next(
                    (topic_id for topic_id in sequence if topic_areas.get(topic_id) == area), None
                )
            notes: list[str] = []
            for response in confident:
                metadata = (self.exercises.get(response.get("question_id")) or {}).get("math_metadata") or {}
                for note in metadata.get("common_misconceptions") or []:
                    if str(note)[:200] not in notes:
                        notes.append(str(note)[:200])
            results[area] = {
                "band": band,
                "ability": round(ability, 2),
                "questions": len(responses),
                "correct": sum(1 for r in responses if r.get("is_correct")),
                # "Not learned yet" answers count as incorrect; report them apart
                # so a not-taught topic does not look like a mistake.
                "not_learned": sum(1 for r in responses if r.get("not_learned")),
                "start_topic": start_topic,
                "confident_errors": sorted({r["topic_id"] for r in confident}),
                "misconception_notes": notes[:3],
            }
            if area in prior_checks:
                results[area]["prior_year_check"] = prior_checks[area]
        return results

    def _placement(self, subject: str, year_level: int, areas: dict) -> dict:
        """Topics that forward recommendations should start with and defer."""
        rank = {"start_here": 0, "building": 1}
        weak = sorted(
            (result for result in areas.values() if result.get("band") in rank and result.get("start_topic")),
            key=lambda result: (rank[result["band"]], result.get("ability", 0.0)),
        )
        secure = {name for name, result in areas.items() if result.get("band") == "secure"}
        topic_areas = self._topic_areas(subject, year_level)
        slice_obj = self._slice(subject, year_level)
        sequence = list(getattr(getattr(slice_obj, "sequence", None), "sequence", None) or topic_areas)
        return {
            "start_topics": [result["start_topic"] for result in weak],
            "secure_topics": [topic_id for topic_id in sequence if topic_areas.get(topic_id) in secure],
        }

    def _placement_view(self, status: dict | None, report: dict | None = None) -> dict:
        """Current per-area placement for display, empty when not valid."""
        if not status or status.get("valid_completion") is False:
            return {"areas": {}, "start_topics": []}
        if status.get("areas") is None and report and report.get("completed_at"):
            # Diagnostics finished before area placement: derive it read-only.
            areas = self._area_results(report)
            placement = self._placement(report["subject"], report["year_level"], areas)
            return {"areas": areas, "start_topics": placement["start_topics"]}
        return {"areas": status.get("areas") or {}, "start_topics": status.get("start_topics") or []}

    def _finalise(self, engine, log: dict, report: dict) -> dict:
        """Write direct attempts, then store the per-area placement.

        Only directly answered current-year topics receive history rows. Untested
        topics get no inferred rows, and diagnostic misses do not open Error Book
        entries: a placement miss usually means "not learned yet", not a mistake.
        """
        topic_areas = self._topic_areas(report["subject"], report["year_level"])
        by_topic: dict[str, list[dict]] = defaultdict(list)
        for response in report.get("responses", []):
            if (
                is_scored_learning_attempt(response)
                and not response.get("prior_year")
                and response.get("topic_id") in topic_areas
            ):
                by_topic[response["topic_id"]].append(response)

        for topic_id, tested_responses in by_topic.items():
            topic_data = log.setdefault("topics", {}).setdefault(
                topic_id, {"attempts": [], "accuracy": 0.0}
            )
            for r in tested_responses:
                topic_data["attempts"].append(
                    {
                        "attempt_id": r.get("attempt_id") or str(uuid.uuid4()),
                        "attempt_type": "diagnostic",
                        "support_level": 0,
                        "question_id": r["question_id"],
                        "correct": r["is_correct"],
                        "outcome": r.get("outcome"),
                        "error_type": r.get("error_type"),
                        "score": r.get("score"),
                        "max_score": r.get("max_score"),
                        "part_results": r.get("part_results"),
                        "student_answer": r.get("student_answer", ""),
                        "timestamp": r["timestamp"],
                        "skill_id": f"{topic_id}/{r['question_id']}",
                        "response_time_ms": 0,
                        "question_type": r.get("question_type", "short_answer"),
                        "error_book_eligible": False,
                        "diagnostic_evidence": {
                            "direct_questions": len(tested_responses),
                            "inferred_from_strand": False,
                            "strand": topic_areas[topic_id],
                        },
                    }
                )
            self._recompute_accuracy(topic_data)
            self._maybe_seed_revision(topic_data)

        self._complete_finalisation_metadata(report, log, self._area_results(report))
        return report

    @staticmethod
    def _maybe_seed_revision(topic_data: dict) -> None:
        """Seed spaced repetition for a directly tested topic that is mastered."""
        try:
            from backend.spaced_repetition import SpacedRepetitionScheduler

            if StudyRuleEngine.mastery_established(topic_data.get("attempts", [])):
                SpacedRepetitionScheduler.maybe_initialise(
                    topic_data,
                    now=datetime.now(timezone.utc),
                )
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Adaptive Branching (CAT) helpers
    # ------------------------------------------------------------------

    def _grading_capabilities(self, student_id: str | None = None) -> dict[str, bool]:
        """Snapshot grading availability for one diagnostic session."""
        parent_review_mode = False
        if student_id:
            try:
                from backend.tutor_engine import get_pu_mode
                parent_review_mode = bool(get_pu_mode(student_id))
            except Exception:
                parent_review_mode = False
        reasoning_supported = self._reasoning_supported() and not parent_review_mode
        return {
            "reasoning_supported": reasoning_supported,
            "parent_review_mode": parent_review_mode,
        }

    def _get_pools_and_strands(
        self,
        subject: str,
        year_level: int,
        capabilities: dict | None = None,
    ) -> tuple[dict, list[str]]:
        """Group live diagnostic candidates by report area and difficulty.

        Areas are returned in curriculum order (Number first for Maths).
        """
        capabilities = capabilities or self._grading_capabilities()
        include_reasoning = bool(capabilities.get("reasoning_supported"))
        parent_review_mode = bool(capabilities.get("parent_review_mode"))
        cache_key = (subject, year_level, include_reasoning, parent_review_mode)
        cached = self._pools_cache.get(cache_key)
        if cached is not None:
            return cached
        fw_id = self._framework_id_for_subject(subject)
        try:
            framework = self.loader.load_slice(fw_id, year_level)
        except Exception:
            return {}, []

        topic_to_area = {topic.topic_id: _area_of(topic) for topic in framework.topics}

        # Use the deterministic pack builder as the live priority order, while
        # retaining eligible backfill so sparse areas can still complete.
        pack_order = self.builder.build(subject=subject, year_level=year_level)
        pack_rank = {question_id: index for index, question_id in enumerate(pack_order)}

        # Gather exercises for this subject & year level. AMC stays its own band
        # so a run of correct answers can still climb above syllabus level.
        pools = defaultdict(
            lambda: {"foundational": [], "developing": [], "extending": [], "AMC": []}
        )
        for ex in self.exercises.values():
            if ex.get("subject") != subject or ex.get("year_level") != year_level:
                continue
            if not _is_supported_diagnostic_question(ex, include_reasoning):
                continue
            area = next(
                (topic_to_area[tid] for tid in sorted(ex.get("topic_ids", [])) if tid in topic_to_area),
                None,
            )
            if not area:
                continue
            diff = ex.get("difficulty", "developing")
            if diff not in BANDS:
                diff = "developing"
            pools[area][diff].append(ex)

        # Sort for determinism
        for area in pools:
            for diff in pools[area]:
                pools[area][diff].sort(
                    key=lambda ex: (pack_rank.get(ex["id"], len(pack_rank) + 1), ex["id"])
                )

        sequence = getattr(getattr(framework, "sequence", None), "sequence", None) or list(topic_to_area)
        ordered_areas: list[str] = []
        for topic_id in sequence:
            area = topic_to_area.get(topic_id)
            if area in pools and area not in ordered_areas:
                ordered_areas.append(area)
        ordered_areas.extend(sorted(area for area in pools if area not in ordered_areas))
        result = (pools, ordered_areas)
        self._pools_cache[cache_key] = result
        return result

    def _next_question(
        self,
        report: dict,
        pools: dict,
        areas: list[str],
        prior_seen_qids: set[str] | None = None,
    ) -> str | None:
        """Return the next question ID, area by area, or None when finished.

        Each area runs a one-band staircase on scored answers only (pending
        grades do not move it): correct goes one band harder, incorrect one band
        easier. An area stops at its maximum, or at its minimum when the last
        two scored answers agree. A failed Year 8-10 area then gets one
        previous-year check, which is reported separately.
        """
        responses = report.get("responses", [])
        topic_areas = self._topic_areas(report.get("subject", "math"), report.get("year_level"))
        used = {r["question_id"] for r in responses}
        seen = set(prior_seen_qids or ())
        offset = int(report.get("selection_offset") or 0)
        low, high = report.get("area_limits") or area_limits(len(areas))
        for area in areas:
            in_area = [r for r in responses if (r.get("area") or topic_areas.get(r.get("topic_id"))) == area]
            scored = [r for r in in_area if not r.get("prior_year") and is_scored_learning_attempt(r)]
            done = len(scored) >= high or (
                len(scored) >= low and scored[-1].get("is_correct") == scored[-2].get("is_correct")
            )
            if not done:
                found = self._pick(
                    pools.get(area) or {}, self._next_band(scored), used, seen,
                    {r.get("topic_id") for r in in_area}, offset,
                )
                if found:
                    return found["id"]
                continue  # No item left: the area finishes early.
            if (
                report.get("year_level", 7) > 7
                and not any(r.get("prior_year") for r in in_area)
                and area_band(estimate_ability(scored)) == "start_here"
            ):
                prior_pools, _ = self._get_pools_and_strands(
                    report["subject"], report["year_level"] - 1,
                    capabilities=report.get("grading_capabilities"),
                )
                found = self._pick(prior_pools.get(area) or {}, "developing", used, seen, set(), offset)
                if found:
                    return found["id"]
        return None

    @staticmethod
    def _next_band(scored: list[dict]) -> str:
        if not scored:
            return "developing"
        last = scored[-1]
        index = BANDS.index(last["difficulty"]) if last.get("difficulty") in BANDS else 1
        return BANDS[min(index + 1, len(BANDS) - 1)] if last.get("is_correct") else BANDS[max(index - 1, 0)]

    @classmethod
    def _pick(
        cls,
        area_pools: dict,
        target: str,
        used: set[str],
        seen: set[str],
        avoid_topics: set,
        offset: int,
    ) -> dict | None:
        """Nearest band to the target first; in a band prefer a new topic, then unseen."""
        target_index = BANDS.index(target)
        for band in sorted(BANDS, key=lambda b: (abs(BANDS.index(b) - target_index), BANDS.index(b))):
            pool = area_pools.get(band) or []
            for excluded, avoid in ((used | seen, avoid_topics), (used, avoid_topics), (used | seen, ()), (used, ())):
                found = cls._first_unused(pool, excluded, offset, avoid)
                if found is not None:
                    return found
        return None

    @staticmethod
    def _selection_offset(student_id: str, subject: str, year_level: int, completed_runs: int) -> int:
        """Stable per-student item offset, so first runs do not share one form."""
        digest = hashlib.sha256(f"{student_id}:{subject}:{year_level}:{completed_runs}".encode()).digest()
        return int.from_bytes(digest[:4], "big")

    @staticmethod
    def _first_unused(
        pool: list[dict], used_qids: set[str], selection_offset: int = 0, avoid_topics=()
    ) -> dict | None:
        if not pool:
            return None
        start = selection_offset % len(pool)
        for index in range(len(pool)):
            ex = pool[(start + index) % len(pool)]
            if ex["id"] not in used_qids and (ex.get("topic_ids") or [None])[0] not in avoid_topics:
                return ex
        return None

    @staticmethod
    def _diagnostic_rotation_offset(
        log: dict, subject: str, year_level: int
    ) -> int:
        """Use completed full runs as a stable cross-diagnostic rotation offset."""
        return sum(
            1
            for report in log.get("diagnostic_reports", [])
            if report.get("subject") == subject
            and report.get("year_level") == year_level
            and report.get("completed_at") is not None
            and not report.get("area_scope")
        )

    @staticmethod
    def _rotated_strand_order(strands: list[str], offset: int) -> list[str]:
        """Return a rotated copy without mutating the cached strand list."""
        if not strands:
            return []
        start = offset % len(strands)
        return [*strands[start:], *strands[:start]]

    @staticmethod
    def _prior_seen_question_ids(
        log: dict, *, exclude_report_id: str | None = None
    ) -> set[str]:
        seen: set[str] = set()
        for topic_data in log.get("topics", {}).values():
            for attempt in topic_data.get("attempts", []):
                question_id = str(attempt.get("question_id") or "")
                if question_id and not question_id.startswith("pseudo_"):
                    seen.add(question_id)
        for report in log.get("diagnostic_reports", []):
            if report.get("report_id") == exclude_report_id:
                continue
            for response in report.get("responses", []):
                question_id = str(response.get("question_id") or "")
                if question_id:
                    seen.add(question_id)
        return seen

    @staticmethod
    def _session_cap_reason(report: dict) -> str | None:
        responses = report.get("responses", [])
        if len(responses) >= MAX_DIAGNOSTIC_RESPONSES:
            return "response_cap"
        unscored = sum(
            1 for response in responses if not is_scored_learning_attempt(response)
        )
        if unscored >= MAX_UNSCORED_RESPONSES:
            return "unscored_cap"
        return None

    @staticmethod
    def _coverage_summary(subject: str, pools: dict, capabilities: dict) -> dict:
        bands = [
            band
            for band in ("foundational", "developing", "extending", "AMC")
            if any(strand_pools.get(band) for strand_pools in pools.values())
        ]
        missing_core = [band for band in ("developing", "extending") if band not in bands]
        reduced = bool(missing_core)
        message = None
        if reduced:
            capability_note = (
                " Semantic marking is unavailable, so open responses are excluded."
                if not capabilities.get("reasoning_supported")
                else ""
            )
            message = (
                "This diagnostic has reduced coverage and may not measure the full grade-level ceiling."
                + capability_note
            )
        return {
            "reduced": reduced,
            "available_difficulty_bands": bands,
            "missing_difficulty_bands": missing_core,
            "message": message,
            "subject": subject,
            "area_count": len(pools),
            "estimated_questions": len(pools) * area_limits(len(pools))[0],
        }

    def _framework_id_for_subject(self, subject: str) -> str:
        """Retrieve AC9 framework ID for subject."""
        subject_map = {
            "math": "AC9_MATHS",
            "english": "AC9_ENGLISH",
            "science": "AC9_SCIENCE",
        }
        return subject_map.get(subject, "AC9_MATHS")

    def _reasoning_supported(self) -> bool:
        """Reasoning items are only diagnostic-eligible when an LLM can grade them."""
        try:
            from backend.routers.helpers import get_tutor_engine
            from backend.tutor_engine import _llm_health
            if get_tutor_engine().client is None:
                return False
            if _llm_health.last_failure is not None:
                success_after_failure = (
                    _llm_health.last_success is not None
                    and _llm_health.last_success >= _llm_health.last_failure
                )
                if not success_after_failure and time.monotonic() - _llm_health.last_failure < 300:
                    return False
            return True
        except Exception:
            return False

    @staticmethod
    def _recompute_accuracy(topic_data: dict) -> None:
        """Recompute accuracy from confirmed scored records only."""
        scored = [
            attempt for attempt in topic_data.get("attempts", [])
            if is_scored_learning_attempt(attempt)
        ]
        scratch = {"attempts": scored, "accuracy": 0.0}
        _recompute_accuracy_core(scratch)
        topic_data["accuracy"] = scratch["accuracy"]


# ---------------------------------------------------------------------------
# Singleton factory
# ---------------------------------------------------------------------------

import threading as _threading


_diagnostic_engine: DiagnosticEngine | None = None
_diagnostic_engine_lock = _threading.Lock()


def invalidate_diagnostic_engine(bank_generation: int | None = None) -> bool:
    """Release a cached engine that was built from a stale exercise bank."""
    global _diagnostic_engine
    with _diagnostic_engine_lock:
        cached = _diagnostic_engine
        if cached is None:
            return False
        if (
            bank_generation is not None
            and getattr(cached, "_bank_generation", None) == bank_generation
        ):
            return False
        _diagnostic_engine = None
        return True


def get_diagnostic_engine() -> DiagnosticEngine:
    """Return the singleton built from the current atomic exercise snapshot."""
    global _diagnostic_engine
    from backend.tutor_engine import get_tutor_engine

    tutor = get_tutor_engine()
    generation, exercises = tutor.exercise_bank_snapshot()
    cached = _diagnostic_engine
    if cached is None or getattr(cached, "_bank_generation", None) != generation:
        with _diagnostic_engine_lock:
            # The bank may have reloaded while this caller waited for the lock.
            generation, exercises = tutor.exercise_bank_snapshot()
            cached = _diagnostic_engine
            if cached is None or getattr(cached, "_bank_generation", None) != generation:
                cached = DiagnosticEngine(
                    exercises=exercises,
                    loader=tutor._loader,
                )
                cached._bank_generation = generation
                _diagnostic_engine = cached
    return _diagnostic_engine
