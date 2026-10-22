import time
import logging
import threading
from collections import OrderedDict
from typing import Literal, Any
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from dataclasses import dataclass
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from backend.answer_grading import correct_answer_for_display
from backend.student_identity import require_student_id
from backend.routers.helpers import rate_limit_dependency, get_tutor_engine
from backend.rules import (
    AttemptRequestConflict,
    PROFILE_SUBJECT,
    get_engine,
    save_weekly_reflection,
)
from backend.dialogue_handler import CapReached
from backend.subject_registry import is_known_subject
from backend.services.analytics_scope import (
    curriculum_topics_for_scope,
    topic_in_scope,
    valid_topic_ids_for_scope,
    storage_subject_for_scope,
)
from backend.services.psmt_history import (
    PSMTHistoryRequestConflict,
    append_psmt_history,
    get_psmt_history,
)
from backend.services.request_replay import (
    RequestReplayConflict,
    async_replay_lock,
    replay_lock,
    replay_lookup,
    replay_store,
    request_fingerprint,
)
from backend.services.attempt_outcomes import (
    AttemptOutcome,
    classify_attempt,
    deduplicate_attempts,
    is_error_book_closure_evidence,
    is_scored_learning_attempt,
    physical_attempt_key,
)
from core.schema.dialogue_schema import DialogueRequest

logger = logging.getLogger(__name__)
router = APIRouter(tags=["tutor"])


class ExplainRequest(BaseModel):
    concept_id: str


class MarkRequest(BaseModel):
    request_id: str | None = Field(default=None, min_length=8, max_length=64, pattern=r"^[A-Za-z0-9._:-]+$")
    question_id: str
    student_answer: str = Field(max_length=1000)
    is_speed_round: bool = False
    is_revision: bool = False
    review_source: str | None = Field(default=None, max_length=100)
    review_question_id: str | None = Field(default=None, max_length=200)
    today_task_id: str | None = Field(default=None, max_length=200)
    used_show_answer: bool = False
    support_level: int | None = Field(default=None, ge=0, le=4)
    confidence: Literal["guess", "maybe", "sure"] | None = None
    guided_phase: Literal["guided", "fading", "independent"] | None = None
    first_attempt: bool | None = None
    root_first_attempt: bool | None = None
    correction_completed: bool | None = None
    self_explanation: str | None = Field(default=None, max_length=300)
    # "I don't know": record a scored miss without marking an answer.
    gave_up: bool = False
    # Send the right answer back when this answer is a miss (the last try on a question).
    reveal_answer: bool = False


class AttemptMetadataRequest(BaseModel):
    question_id: str
    attempt_id: str | None = Field(default=None, max_length=100)
    self_explanation: str = Field(min_length=1, max_length=300)

    @field_validator("self_explanation")
    @classmethod
    def require_minimum_explanation_words(cls, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned.split()) < 3:
            raise ValueError("self_explanation_min_words")
        return cleaned


class ReflectRequest(BaseModel):
    question_id: str
    reflection_type: str = Field(..., max_length=100)


class WeeklyReflectionRequest(BaseModel):
    week_start: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    proud_of: str = Field(default="", max_length=500)
    challenge: str = Field(default="", max_length=500)
    next_week_intention: str = Field(default="", max_length=500)

    @field_validator("proud_of", "challenge", "next_week_intention")
    @classmethod
    def clean_reflection_text(cls, value: str) -> str:
        return value.strip()


class FlagReviewRequest(BaseModel):
    question_id: str
    student_answer: str = Field(default="", max_length=1000)


class ShowAnswerRequest(BaseModel):
    question_id: str = Field(min_length=1, max_length=200)


class MistakeResolveRequest(BaseModel):
    request_id: str | None = Field(default=None, min_length=8, max_length=64, pattern=r"^[A-Za-z0-9._:-]+$")
    subject: str = "math"
    question_id: str
    topic_id: str
    resolved: bool = True
    resolution_source: Literal["demonstrated_correction", "manual_dismissal"] = "manual_dismissal"
    year_level: int | None = None
    unit: int | None = None
    syllabus_subject: str | None = None


class MistakeCauseRequest(BaseModel):
    request_id: str | None = Field(default=None, min_length=8, max_length=64, pattern=r"^[A-Za-z0-9._:-]+$")
    subject: str = "math"
    question_id: str
    topic_id: str
    error_cause: Literal[
        "calculation_slip",
        "concept_gap",
        "problem_misreading",
        "logical_stuck",
        "vocabulary_gap",
        "text_misreading",
        "distractor_trap",
        "grammar_confusion",
        "expression_gap",
        "time_pressure",
        "random_guess",
        "other",
        # Legacy Error Book aliases remain readable during migration.
        "method_choice",
        "misread_condition",
    ]
    if_then_strategy: str | None = Field(default=None, max_length=300)
    year_level: int | None = None
    unit: int | None = None
    syllabus_subject: str | None = None

class StudyPlansRequest(BaseModel):
    subject: str = "math"
    topics: list[str] = Field(default_factory=list, max_length=20)


class SuggestRequest(BaseModel):
    topic: str
    mode: str = "retrieve"
    exclude_id: str | None = None
    subject: str | None = None
    year_level: int | None = None
    unit: int | None = None
    syllabus_subject: str | None = None


class PSMTCheckRequest(BaseModel):
    request_id: str | None = Field(default=None, min_length=8, max_length=64, pattern=r"^[A-Za-z0-9._:-]+$")
    subject: str = Field(..., max_length=100)
    section_name: str = Field(..., max_length=100)
    draft_text: str = Field(..., max_length=10000)
    images: list[str] | None = None


@router.post("/api/tutor/explain")
def explain_concept(req: ExplainRequest):
    """Pass-through to ``TutorEngine.explain`` — no student_id required."""
    return get_tutor_engine().explain(req.concept_id)


@router.post("/api/tutor/mark")
async def mark_answer(req: MarkRequest, student_id: str = Depends(rate_limit_dependency("POST", "/api/tutor/mark"))):
    from fastapi.concurrency import run_in_threadpool
    from backend.services.question_context import student_mark_view
    fingerprint = request_fingerprint(req, exclude={"request_id"}) if req.request_id else ""

    async def perform_mark() -> dict:
        result = await run_in_threadpool(
            get_tutor_engine().mark,
            req.question_id,
            req.student_answer,
            student_id=student_id,
            is_speed_round=req.is_speed_round,
            is_revision=req.is_revision,
            review_source=req.review_source,
            review_question_id=req.review_question_id,
            today_task_id=req.today_task_id,
            used_show_answer=req.used_show_answer,
            support_level=req.support_level,
            confidence=req.confidence,
            guided_phase=req.guided_phase,
            first_attempt=req.first_attempt,
            root_first_attempt=req.root_first_attempt,
            correction_completed=req.correction_completed,
            self_explanation=req.self_explanation,
            request_id=req.request_id,
            request_fingerprint=fingerprint,
            gave_up=req.gave_up,
            reveal_answer=req.reveal_answer,
        )
        return student_mark_view(result)

    if not req.request_id:
        return await perform_mark()

    try:
        async with async_replay_lock(student_id, "tutor_mark", req.request_id):
            cached = replay_lookup(student_id, "tutor_mark", req.request_id, fingerprint)
            if cached is not None:
                return cached
            response = await perform_mark()
            # Persistence failures are deliberately retryable, so do not cache
            # the neutral response and prevent a later retry from succeeding.
            if not response.get("retryable"):
                replay_store(student_id, "tutor_mark", req.request_id, fingerprint, response)
            return response
    except (RequestReplayConflict, AttemptRequestConflict) as exc:
        raise HTTPException(
            status_code=409,
            detail={"error": "request_id_conflict", "message": str(exc)},
        )


@router.post("/api/tutor/attempt-metadata")
def update_attempt_metadata(
    req: AttemptMetadataRequest,
    student_id: str = Depends(rate_limit_dependency("POST", "/api/tutor/attempt-metadata")),
):
    """Attach a short post-answer reflection to the matching physical attempt."""
    question = get_tutor_engine().exercises.get(req.question_id)
    if not question or not is_known_subject(question.get("subject")):
        raise HTTPException(status_code=404, detail="question_not_found")
    explanation = req.self_explanation.strip()
    if not explanation:
        raise HTTPException(status_code=422, detail="self_explanation_required")
    engine = get_engine(student_id, question["subject"])
    updated = engine.update_latest_attempt_metadata(
        req.question_id,
        {"self_explanation": explanation},
        attempt_id=req.attempt_id,
        topics=question.get("topic_ids") or [question.get("topic", "unknown")],
    )
    if not updated:
        raise HTTPException(status_code=404, detail="attempt_not_found")
    return {"success": True}


@router.post("/api/tutor/flag-review")
async def flag_review(req: FlagReviewRequest, student_id: str = Depends(require_student_id)):
    """Student-initiated escalation of a graded-incorrect attempt to the parent review queue."""
    from fastapi.concurrency import run_in_threadpool
    return await run_in_threadpool(
        get_tutor_engine().flag_review, req.question_id, req.student_answer, student_id=student_id
    )


@router.post("/api/tutor/reflect")
async def reflect_answer(req: ReflectRequest, student_id: str = Depends(rate_limit_dependency("POST", "/api/tutor/reflect"))):
    from fastapi.concurrency import run_in_threadpool
    return await run_in_threadpool(get_tutor_engine().save_reflection, req.question_id, req.reflection_type, student_id=student_id)


@router.post("/api/tutor/show-answer")
def show_answer(
    req: ShowAnswerRequest,
    student_id: str = Depends(rate_limit_dependency("POST", "/api/tutor/show-answer")),
):
    """Return the right answer for a question the student has already answered.

    Question payloads carry no answer key, so "Show Answer" asks here.
    """
    result = get_tutor_engine().reveal_answer(req.question_id, student_id=student_id)
    error = result.get("error")
    if error == "question_not_found":
        raise HTTPException(status_code=404, detail={"error": error, "message": "Question not found."})
    if error == "answer_needs_an_attempt":
        raise HTTPException(
            status_code=409,
            detail={"error": error, "message": "Answer the question before you ask for the answer."},
        )
    return result


@router.post("/api/tutor/suggest")
async def suggest_practice(req: SuggestRequest, student_id: str = Depends(rate_limit_dependency("POST", "/api/tutor/suggest"))):
    from fastapi.concurrency import run_in_threadpool
    return await run_in_threadpool(
        get_tutor_engine().suggest_practice,
        req.topic,
        req.mode,
        student_id=student_id,
        prior_question_id=req.exclude_id,
        subject=storage_subject_for_scope(req.subject),
        year_level=req.year_level,
        unit=req.unit,
        syllabus_subject=req.syllabus_subject,
    )


@router.post("/api/tutor/psmt/check")
async def check_psmt(req: PSMTCheckRequest, student_id: str = Depends(require_student_id)):
    """Evaluate a student's PSMT draft section against QCAA ISMG guidelines."""
    from fastapi.concurrency import run_in_threadpool
    if req.images and len(req.images) > 5:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "too_many_psmt_images",
                "message": "Attach no more than 5 images for one PSMT check.",
            },
        )
    if req.images and any(len(image) > 3_000_000 for image in req.images):
        raise HTTPException(
            status_code=400,
            detail={
                "error": "psmt_image_too_large",
                "message": "Each PSMT image must be 2 MB or smaller before upload.",
            },
        )

    fingerprint = request_fingerprint(req, exclude={"request_id"}) if req.request_id else ""

    async def perform_check() -> dict:
        engine = get_tutor_engine()
        result = await run_in_threadpool(
            engine.check_psmt,
            req.subject,
            req.section_name,
            req.draft_text,
            images=req.images,
        )
        feedback = str(result.get("feedback", ""))
        llm_status = result.get("llm_status") or ("live" if engine.client else "mock")
        history_item = await run_in_threadpool(
            append_psmt_history,
            student_id=student_id,
            subject=req.subject,
            section_name=req.section_name,
            draft_text=req.draft_text,
            images=req.images,
            feedback_markdown=feedback,
            structured_feedback=result.get("structured_feedback"),
            llm_status=llm_status,
            request_id=req.request_id,
            request_fingerprint=fingerprint,
        )
        return {**result, "history_item": history_item, "llm_status": llm_status}

    if not req.request_id:
        return await perform_check()

    try:
        async with async_replay_lock(student_id, "psmt_check", req.request_id):
            cached = replay_lookup(student_id, "psmt_check", req.request_id, fingerprint)
            if cached is not None:
                return cached
            response = await perform_check()
            replay_store(student_id, "psmt_check", req.request_id, fingerprint, response)
            return response
    except (RequestReplayConflict, PSMTHistoryRequestConflict) as exc:
        raise HTTPException(
            status_code=409,
            detail={"error": "request_id_conflict", "message": str(exc)},
        )


@router.get("/api/tutor/psmt/history")
async def psmt_history(limit: int = 10, student_id: str = Depends(require_student_id)):
    """Return lightweight PSMT feedback history for parent/student dashboards."""
    from fastapi.concurrency import run_in_threadpool
    return await run_in_threadpool(get_psmt_history, student_id, limit)


# --- Dialogue Endpoint (Task 11.1–11.5) ---


@router.post("/api/tutor/dialogue")
async def post_dialogue(
    req: DialogueRequest,
    student_id: str = Depends(rate_limit_dependency("POST", "/api/tutor/dialogue")),
):
    """Per-question multi-turn dialogue endpoint."""
    from fastapi.concurrency import run_in_threadpool

    async def perform_dialogue() -> dict:
        # Map the cap here so requests with and without request_id both get 429.
        try:
            result = await run_in_threadpool(
                get_tutor_engine().dialogue,
                student_id=student_id,
                question_id=req.question_id,
                student_message=req.student_message,
            )
        except CapReached:
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "dialogue_session_cap_reached",
                    "message": "Per-question dialogue cap reached.",
                    "endpoint": "/api/tutor/dialogue",
                },
                headers={"Retry-After": "0"},
            )
        return result.model_dump(mode="json") if hasattr(result, "model_dump") else result

    if not req.request_id:
        return await perform_dialogue()

    fingerprint = request_fingerprint(req, exclude={"request_id"})
    try:
        async with async_replay_lock(student_id, "tutor_dialogue", req.request_id):
            cached = replay_lookup(student_id, "tutor_dialogue", req.request_id, fingerprint)
            if cached is not None:
                return cached
            response = await perform_dialogue()
            replay_store(student_id, "tutor_dialogue", req.request_id, fingerprint, response)
            return response
    except RequestReplayConflict as exc:
        raise HTTPException(
            status_code=409,
            detail={"error": "request_id_conflict", "message": str(exc)},
        )


# --- Study Plan & Analytics (subject-aware, per-student) ---

@router.get("/api/tutor/plan")
def get_study_plan(topic: str, subject: str = "math", student_id: str = Depends(require_student_id)):
    engine = get_engine(student_id, storage_subject_for_scope(subject))
    return engine.get_study_plan(topic)


@router.post("/api/tutor/plans")
def get_study_plans(req: StudyPlansRequest, student_id: str = Depends(require_student_id)):
    engine = get_engine(student_id, storage_subject_for_scope(req.subject))
    plans = {}
    seen: set[str] = set()
    for topic in req.topics:
        if not topic or topic in seen:
            continue
        seen.add(topic)
        plan = engine.get_study_plan(topic)
        plans[topic] = {"topic": topic, **plan}
    return {"plans": plans}


@router.get("/api/tutor/progress")
def get_progress(
    subject: str = "math",
    year_level: int | None = None,
    unit: int | None = None,
    syllabus_subject: str | None = None,
    include_unattempted: bool = False,
    student_id: str = Depends(require_student_id),
):
    engine = get_engine(student_id, storage_subject_for_scope(subject))
    scope_topics = (
        curriculum_topics_for_scope(subject, year_level, unit, syllabus_subject)
        if include_unattempted
        else None
    )
    valid_topic_ids = (
        {topic.topic_id for topic in scope_topics}
        if scope_topics is not None
        else valid_topic_ids_for_scope(subject, year_level, unit, syllabus_subject)
    )
    return engine.get_all_progress(
        valid_topic_ids=valid_topic_ids,
        include_unattempted=include_unattempted,
        scope_topics=scope_topics,
    )


@router.get("/api/tutor/progress-summary")
def get_progress_summary(
    subject: str = "math",
    year_level: int | None = None,
    unit: int | None = None,
    syllabus_subject: str | None = None,
    include_unattempted: bool = False,
    student_id: str = Depends(require_student_id),
):
    """Return scoped topic progress with a compact direct-attempt total."""
    engine = get_engine(student_id, storage_subject_for_scope(subject))
    scope_topics = (
        curriculum_topics_for_scope(subject, year_level, unit, syllabus_subject)
        if include_unattempted
        else None
    )
    valid_topic_ids = (
        {topic.topic_id for topic in scope_topics}
        if scope_topics is not None
        else valid_topic_ids_for_scope(subject, year_level, unit, syllabus_subject)
    )
    return engine.get_progress_summary(
        valid_topic_ids=valid_topic_ids,
        include_unattempted=include_unattempted,
        scope_topics=scope_topics,
    )


@router.get("/api/tutor/calibrate-bkt")
def calibrate_bkt_params(
    subject: str = "math",
    year_level: int | None = None,
    unit: int | None = None,
    syllabus_subject: str | None = None,
    student_id: str = Depends(require_student_id),
):
    """Calibrate BKT parameters from this student's attempt history.

    Runs a grid search over P(L0) and P(T) to find the values that best
    predict the student's actual performance, then returns the optimal
    parameters with a plain-English explanation.
    """
    from core.algorithms.bkt import calibrate_parameters

    engine = get_engine(student_id, storage_subject_for_scope(subject))
    valid_topic_ids = valid_topic_ids_for_scope(subject, year_level, unit, syllabus_subject)
    log = engine.load_log(topics=valid_topic_ids)
    all_seqs: list[list[dict]] = []

    for topic_id, topic_data in log.get("topics", {}).items():
        if not topic_in_scope(topic_id, valid_topic_ids):
            continue
        answer_attempts = [
            a for a in topic_data.get("attempts", [])
            if a.get("attempt_type", "answer") in ("answer", "diagnostic")
        ]
        if len(answer_attempts) >= 2:
            all_seqs.append(answer_attempts)

    return calibrate_parameters(all_seqs)


@router.get("/api/tutor/recommend")
def recommend_next(subject: str = "math", year: str = "year7", student_id: str = Depends(require_student_id)):
    """Returns the next topic the student should focus on, based on curriculum sequence and BKT mastery."""
    engine = get_engine(student_id, storage_subject_for_scope(subject))
    if str(year).startswith("unit"):
        return {
            "topic": None,
            "topic_id": None,
            "name": None,
            "framework_id": None,
            "subject": storage_subject_for_scope(subject),
            "year_level": None,
            "reason": "Senior unit recommendations are shown through scoped progress and parent next steps for now.",
            "mastery": 0.0,
            "recommendation_type": "senior_scope_unavailable",
        }
    rec = engine.recommend_next_topic(year)
    if rec.get("recommendation_type") == "forward":
        if not engine.has_learning_data():
            # Check if they already dismissed the diagnostic
            year_int = int(year.removeprefix("year")) if year.startswith("year") else int(year)
            status = engine.get_diagnostic_status(year_int)
            if status is None or status.get("diagnostic_dismissed_at") is None:
                return {
                    "topic": None,
                    "topic_id": None,
                    "name": None,
                    "framework_id": None,
                    "subject": subject,
                    "year_level": year_int,
                    "reason": "Complete a diagnostic assessment to calibrate your learning path.",
                    "mastery": 0.0,
                    "recommendation_type": "diagnostic_prompt",
                }
    return rec


@router.get("/api/tutor/today-plan")
def get_today_plan(
    subject: str = "math",
    year: str = "year7",
    syllabus_subject: str | None = None,
    student_id: str = Depends(require_student_id),
):
    """Compose one short, evidence-backed study session for the active scope.

    The planner sets the length: each step stops on evidence. An old
    ``question_target`` query parameter is ignored.
    """
    from backend.services.today_plan import build_today_plan
    from backend.services.today_topics import question_minutes_by_topic

    storage_subject = storage_subject_for_scope(subject)
    engine = get_engine(student_id, storage_subject)
    scope = str(year)
    year_level = None
    unit = None
    if scope.startswith("unit"):
        unit = int(scope.removeprefix("unit"))
    elif scope.startswith("year"):
        year_level = int(scope.removeprefix("year"))
    else:
        raise HTTPException(
            status_code=422,
            detail={"error": "invalid_study_scope", "message": "Use year7–year12 or unit1–unit4."},
        )

    scope_topics = curriculum_topics_for_scope(
        subject,
        year_level=year_level,
        unit=unit,
        syllabus_subject=syllabus_subject,
    ) or []
    valid_topic_ids = {topic.topic_id for topic in scope_topics}
    scope_log = engine.load_log(topics=sorted(valid_topic_ids))
    progress = engine.get_all_progress(
        valid_topic_ids=valid_topic_ids,
        include_unattempted=True,
        scope_topics=scope_topics,
        log_snapshot=scope_log,
    )

    diagnostic_status = None
    if year_level is not None:
        diagnostic_status = engine.get_diagnostic_status(year_level)
        if diagnostic_status and diagnostic_status.get("report_id"):
            report = next(
                (
                    row for row in engine.get_diagnostic_reports()
                    if row.get("report_id") == diagnostic_status.get("report_id")
                ),
                None,
            )
            if report:
                total = len(report.get("pack") or []) or 15
                diagnostic_status = {
                    **diagnostic_status,
                    "question_completed": min(int(report.get("cursor") or 0), total),
                    "question_target": total,
                    "valid_completion": report.get("valid_completion"),
                }

        recommendation = engine.recommend_next_topic(scope, log_snapshot=scope_log)
        if recommendation.get("recommendation_type") == "forward" and not engine.has_learning_data():
            if diagnostic_status is None or diagnostic_status.get("diagnostic_dismissed_at") is None:
                recommendation = {
                    "topic": None,
                    "topic_id": None,
                    "reason": "Complete a diagnostic assessment to calibrate your learning path.",
                    "recommendation_type": "diagnostic_prompt",
                }
    else:
        recommendation = {"recommendation_type": "senior_scope"}

    # The next new topic is needed on review days too. A year and a unit both use
    # teaching order; a topic waits for its prerequisites inside the scope.
    topic_facts = engine.today_topic_facts(
        scope,
        log_snapshot=scope_log,
        unit_topics=scope_topics if unit is not None else None,
    )
    forward_topic = topic_facts.next_topic() if topic_facts else None
    tutor_engine = get_tutor_engine()
    question_minutes = question_minutes_by_topic(
        {topic_id: tutor_engine.exercises_for_topic(topic_id) for topic_id in valid_topic_ids},
        scope,
    )

    mistake_page = engine.query_mistake_states(
        valid_topic_ids=valid_topic_ids,
        status=None,
        limit=100,
    )
    brisbane = ZoneInfo("Australia/Brisbane")
    now_local = datetime.now(brisbane)
    start_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    end_local = start_local + timedelta(days=1)
    task_stats = engine.get_today_plan_attempt_stats(
        start_local.astimezone(timezone.utc).isoformat(),
        end_local.astimezone(timezone.utc).isoformat(),
    )
    due_revision_topics = engine.get_due_revision_topics(
        scope,
        limit=3,
        log_snapshot=scope_log,
        unit_topics=scope_topics if unit is not None else None,
    )
    mistake_rows = list(mistake_page.get("rows") or [])
    return build_today_plan(
        day=now_local.date(),
        subject=subject,
        scope=scope,
        recommendation=recommendation,
        progress=progress,
        mistake_rows=mistake_rows,
        task_stats=task_stats,
        due_revision_topics=due_revision_topics,
        forward_topic=forward_topic,
        diagnostic_status=diagnostic_status,
        syllabus_subject=syllabus_subject,
        now=now_local,
        topic_names={topic.topic_id: topic.name for topic in scope_topics},
        success_criteria=_success_criteria(scope_topics),
        next_review_at=_next_review_at(scope_log, mistake_rows, now_local),
        topic_facts=topic_facts,
        question_minutes=question_minutes,
    )


def _next_review_at(log: dict, mistake_rows: list[dict], now: datetime) -> str | None:
    """Earliest future topic review or mistake check in this scope."""
    def parse(value: object) -> datetime | None:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)

    candidates = [
        str(topic.get("revision", {}).get("next_review_at"))
        for topic in (log.get("topics") or {}).values()
        if isinstance(topic, dict) and topic.get("revision", {}).get("next_review_at")
    ] + [
        str(row["consolidation_due_at"])
        for row in mistake_rows
        if row.get("consolidation_due_at") and not row.get("resolved")
    ]
    upcoming = [(when, value) for value in candidates if (when := parse(value)) and when > now]
    return min(upcoming)[1] if upcoming else None


def _success_criteria(topics) -> dict[str, str]:
    """First "I can" statement of each topic's lesson, for the day's goal."""
    criteria: dict[str, str] = {}
    for topic in topics:
        card = getattr(topic, "concept_card", None)
        lesson = getattr(card, "lesson_content", None) if card else None
        if lesson is None:
            continue
        statement = next(iter(lesson.success_criteria or lesson.learning_objectives or []), None)
        if statement:
            criteria[topic.topic_id] = statement
    return criteria


# --- Mistakes / Error Book Endpoint ---

_MISTAKES_CACHE = OrderedDict()
_MISTAKES_CACHE_LOCK = threading.Lock()
_MISTAKES_CACHE_GENERATION = 0
MISTAKES_CACHE_TTL = 60  # seconds
MISTAKES_CACHE_MAX_ENTRIES = 256
MISTAKES_CACHE_MAX_ITEMS_PER_ENTRY = 200


def _prune_mistakes_cache(now: float) -> None:
    """Remove expired entries and enforce a hard process-wide size bound.

    Caller must hold ``_MISTAKES_CACHE_LOCK``.
    """
    expired = [key for key, value in _MISTAKES_CACHE.items() if now >= value[0]]
    for key in expired:
        _MISTAKES_CACHE.pop(key, None)
    while len(_MISTAKES_CACHE) > MISTAKES_CACHE_MAX_ENTRIES:
        _MISTAKES_CACHE.popitem(last=False)


def _store_mistakes_cache(
    cache_key: str,
    generation: int,
    expires_at: float,
    result: dict,
    now: float,
) -> bool:
    """Store a computed result only if no invalidation occurred meanwhile."""
    with _MISTAKES_CACHE_LOCK:
        if generation != _MISTAKES_CACHE_GENERATION:
            return False
        _MISTAKES_CACHE[cache_key] = (expires_at, result)
        _MISTAKES_CACHE.move_to_end(cache_key)
        _prune_mistakes_cache(now)
        return True


def invalidate_mistakes_cache(student_id: str):
    """Invalidate one student's entries and advance the process cache generation."""
    global _MISTAKES_CACHE_GENERATION
    with _MISTAKES_CACHE_LOCK:
        _MISTAKES_CACHE_GENERATION += 1
        # Match student_id: to avoid partial matches on prefixes of other student IDs
        keys_to_del = [k for k in _MISTAKES_CACHE if k.startswith(f"{student_id}:")]
        for k in keys_to_del:
            _MISTAKES_CACHE.pop(k, None)


def _infer_scope_from_topic_id(topic_id: str) -> tuple[int | None, int | None, str | None]:
    """Helper to infer year_level, unit, and syllabus_subject from canonical topic_id."""
    import re as _re
    # Match AC9 Maths, English, Science (e.g. AC9M7N01 -> year_level = 7)
    m_ac9 = _re.match(r"^AC9[MES](\d+)", topic_id)
    if m_ac9:
        return int(m_ac9.group(1)), None, None

    # Match QCAA Senior (e.g. QCAA_METHODS_U1_T1 -> unit = 1, syllabus_subject = "methods")
    m_qcaa = _re.match(r"^QCAA_([A-Z_]+)_U([1-4])", topic_id)
    if m_qcaa:
        syllabus = m_qcaa.group(1).lower()
        unit = int(m_qcaa.group(2))
        return None, unit, syllabus

    return None, None, None


def _mistake_review_key(
    subject: str,
    topic_id: str,
    question_id: str,
    year_level: int | None = None,
    unit: int | None = None,
    syllabus_subject: str | None = None,
) -> str:
    # If year_level and unit are not specified, try to infer them from topic_id
    if year_level is None and unit is None:
        year_level, unit, syllabus_subject = _infer_scope_from_topic_id(topic_id)

    if year_level is not None:
        scope = f"year{year_level}"
    elif unit is not None:
        scope = f"{syllabus_subject or 'senior'}::unit{unit}"
    else:
        scope = "all"
    return f"{subject}::{scope}::{topic_id}::{question_id}"


# ---------------------------------------------------------------------------
# Error taxonomy lookup (lazy, subject-aware cache)
# ---------------------------------------------------------------------------
_ERROR_TAXONOMY_CACHE: dict[str, dict[str, dict]] = {}
_ERROR_TAXONOMY_CACHE_LOCK = threading.Lock()


def _get_error_taxonomy(subject: str = "math") -> dict[str, dict]:
    """Load and cache one subject taxonomy with observable failure fallback."""
    subject = storage_subject_for_scope(subject)
    with _ERROR_TAXONOMY_CACHE_LOCK:
        cached = _ERROR_TAXONOMY_CACHE.get(subject)
        if cached is not None:
            return cached

        import json as _json
        from pathlib import Path

        data_dir = Path(__file__).resolve().parent.parent.parent / "data"
        taxonomy_path = data_dir / f"error_taxonomy_{subject}.json"
        if not taxonomy_path.exists():
            taxonomy_path = data_dir / "error_taxonomy_math.json"

        result: dict[str, dict] = {}
        if taxonomy_path.exists():
            try:
                with open(taxonomy_path, "r", encoding="utf-8") as f:
                    data = _json.load(f)
                for et in data.get("error_types", []):
                    result[et["code"]] = {
                        "label": et.get("label") or str(et["code"]).replace("_", " ").title(),
                        "description": et.get("description"),
                        "severity": et.get("default_severity", "medium"),
                        "tip": (et.get("recommended_actions") or [""])[0],
                    }
            except (OSError, _json.JSONDecodeError, TypeError, KeyError) as exc:
                logger.warning("Failed to load error taxonomy %s: %s", taxonomy_path, exc)

        _ERROR_TAXONOMY_CACHE[subject] = result
        return result


@router.get("/api/tutor/error-taxonomy")
def get_error_taxonomy(subject: str = "math"):
    """Return subject-specific Error Book taxonomy options for the frontend."""
    taxonomy = _get_error_taxonomy(subject)
    return {
        "subject": subject,
        "error_types": [
            {
                "code": code,
                "label": meta.get("label") or code.replace("_", " ").title(),
                "description": meta.get("description"),
                "severity": meta.get("severity"),
                "tip": meta.get("tip"),
            }
            for code, meta in taxonomy.items()
        ],
    }


@router.get("/api/tutor/mistakes")
def get_mistakes(
    subject: str = "math",
    topic_id: str | None = None,
    error_type: str | None = None,
    status: Literal["active", "resolved"] | None = None,
    sort: str = "recent",
    year_level: int | None = None,
    unit: int | None = None,
    syllabus_subject: str | None = None,
    limit: int | None = None,
    offset: int = 0,
    student_id: str = Depends(require_student_id),
):
    """Return the student's incorrect attempts with question details.

    Optional filters: topic_id, error_type.
    Sort options: recent (default), mastery (BKT-priority).
    Optional pagination: ``limit``/``offset`` bound the returned slice (the
    response still reports the full ``total`` and a ``has_more`` flag). When
    ``limit`` is omitted the full list is returned (backward compatible).
    Each entry includes misconception name/explanation, linked worked example,
    error taxonomy tip/severity, attempt count, and the learner's reusable
    reflection and action strategy.
    """
    def recommended_review_action(stage: str) -> str:
        return {
            "needs_understanding": "Name the cause and write an if–then plan before retrying.",
            "needs_retry": "Redo the original question without hints and apply your if–then plan.",
            "needs_transfer": "Use the same plan on a fresh question to prove transfer.",
            "needs_consolidation": "Recall your plan and explanation, then complete the spaced check.",
            "closed": "No action due; this mistake is closed with independent evidence.",
            "dismissed": "Reopen this mistake when you are ready to build mastery evidence.",
        }.get(stage, "Review the error and choose the next independent step.")
    now = time.time()
    storage_subject = storage_subject_for_scope(subject)
    cache_key = f"{student_id}:{storage_subject}:{subject}:{year_level or ''}:{unit or ''}:{syllabus_subject or ''}:{topic_id or ''}:{error_type or ''}:{status or ''}:{sort}:{limit if limit is not None else ''}:{offset}"
    with _MISTAKES_CACHE_LOCK:
        _prune_mistakes_cache(now)
        cache_generation = _MISTAKES_CACHE_GENERATION
        cached = _MISTAKES_CACHE.get(cache_key)
        if cached and now < cached[0]:
            _MISTAKES_CACHE.move_to_end(cache_key)
            return cached[1]

    engine = get_engine(student_id, storage_subject)
    valid_topic_ids = valid_topic_ids_for_scope(subject, year_level, unit, syllabus_subject)
    state_query = getattr(engine, "query_mistake_states", None)
    if callable(state_query):
        state_page = state_query(
            valid_topic_ids=valid_topic_ids,
            topic_id=topic_id,
            error_type=error_type,
            status=status,
            limit=limit if sort != "mastery" else None,
            offset=offset if sort != "mastery" else 0,
        )
        state_rows = list(state_page["rows"])
        total = int(state_page["total"])
        if sort == "mastery":
            progress = engine.get_all_progress(valid_topic_ids=valid_topic_ids)
            bkt_map = {
                item["topic"]: item.get("bkt_mastery", 0.0)
                for item in progress
            }
            state_rows.sort(
                key=lambda row: (
                    bkt_map.get(row["topic_id"], 0.5),
                    str(row.get("last_incorrect_at") or ""),
                )
            )
            if offset:
                state_rows = state_rows[offset:]
            if limit is not None:
                state_rows = state_rows[:limit]

        exercises = get_tutor_engine().exercises
        metadata = engine.get_extra_metadata()
        exam_sessions = metadata.get("exam_sessions", [])
        from backend.misconception_library import get_library
        try:
            m_lib = get_library()
        except Exception:
            m_lib = None
        taxonomy = _get_error_taxonomy(storage_subject)
        mistakes = []
        for row in state_rows:
            attempt = row["attempt"]
            qid = str(row["question_id"])
            display_topic_id = topic_id or str(row["topic_id"])
            ex = exercises.get(qid)
            if not ex:
                for session in exam_sessions:
                    ex = next(
                        (
                            question
                            for question in session.get("imported_questions", [])
                            if question.get("id") == qid
                        ),
                        None,
                    )
                    if ex:
                        break
            if not ex:
                continue

            mis_id = attempt.get("misconception_id")
            mis_name = None
            mis_explanation = None
            worked_example_name = None
            worked_example_id = None
            if mis_id and m_lib:
                misconception = m_lib.misconceptions.get(mis_id)
                if misconception:
                    mis_name = misconception.name
                    mis_explanation = misconception.student_facing_explanation
                worked_example = m_lib.we_by_misconception.get(mis_id)
                if worked_example:
                    worked_example_name = worked_example[0].name
                    worked_example_id = worked_example[0].worked_example_id

            err_code = row.get("error_type")
            tax_entry = taxonomy.get(err_code, {}) if err_code else {}
            closure_stage = row.get("closure_stage") or "needs_understanding"
            is_resolved = bool(row.get("resolved")) or closure_stage in {
                "closed", "dismissed"
            }
            resolution_source = row.get("resolution_source")
            item_status = (
                "dismissed" if is_resolved and resolution_source == "manual_dismissal"
                else "corrected" if is_resolved and resolution_source == "demonstrated_correction"
                else "resolved" if is_resolved
                else "active"
            )
            inferred_year, inferred_unit, inferred_syllabus = _infer_scope_from_topic_id(
                display_topic_id
            )
            from backend.services.question_context import solution_steps, student_question_view
            mistakes.append({
                **student_question_view(ex),
                "question_id": qid,
                "attempt_id": attempt.get("attempt_id"),
                "outcome": AttemptOutcome.INCORRECT.value,
                "topic_id": display_topic_id,
                "subject": storage_subject,
                "year_level": year_level if year_level is not None else inferred_year,
                "unit": unit if unit is not None else inferred_unit,
                "syllabus_subject": syllabus_subject if syllabus_subject is not None else inferred_syllabus,
                "source": "diagnostic" if attempt.get("attempt_type", "answer") == "diagnostic" else "practice",
                "status": item_status,
                "resolved": is_resolved,
                "resolved_at": row.get("resolved_at"),
                "review_count": int(row.get("review_count") or 0),
                "resolution_source": resolution_source,
                "closure_stage": closure_stage,
                "error_cause": row.get("error_cause") or attempt.get("error_cause") or attempt.get("reflection_type"),
                "cause_recorded_at": row.get("cause_recorded_at"),
                "retry_correct_at": row.get("retry_correct_at"),
                "transfer_correct_at": row.get("transfer_correct_at"),
                "consolidation_due_at": row.get("consolidation_due_at"),
                "closed_at": row.get("closed_at"),
                "last_incorrect_at": row.get("last_incorrect_at") or "",
                "last_correct_after_error_at": row.get("last_correct_after_error_at"),
                "question": ex.get("question", ""),
                "correct_answer": correct_answer_for_display(ex),
                "solution_steps": solution_steps(ex),
                "student_answer": attempt.get("student_answer", ""),
                "error_type": err_code,
                "error_severity": tax_entry.get("severity"),
                "error_tip": tax_entry.get("tip"),
                "attempt_count": int(row.get("attempt_count") or 1),
                "misconception_id": mis_id,
                "misconception_name": mis_name,
                "misconception_explanation": mis_explanation,
                "worked_example_name": worked_example_name,
                "worked_example_id": worked_example_id,
                "timestamp": row.get("last_incorrect_at") or "",
                "question_type": ex.get("question_type", "short_answer"),
                "reflection_type": attempt.get("reflection_type"),
                "self_explanation": attempt.get("self_explanation"),
                "if_then_strategy": attempt.get("if_then_strategy"),
                "recommended_review_action": recommended_review_action(closure_stage),
                "choices": ex.get("choices"),
                "sub_parts": ex.get("sub_parts"),
            })

        return {
            "mistakes": mistakes,
            "total": total,
            "returned": len(mistakes),
            "offset": offset,
            "has_more": offset + len(mistakes) < total,
            "summary": state_page["summary"],
        }

    log = engine.load_log(topics=valid_topic_ids)
    exercises = get_tutor_engine().exercises
    mistake_reviews = log.get("mistake_reviews", {})

    # Load misconception library for enrichment
    from backend.misconception_library import get_library
    try:
        m_lib = get_library()
    except Exception:
        m_lib = None

    # Load error taxonomy for severity/tip enrichment
    taxonomy = _get_error_taxonomy(storage_subject)

    # Pre-compute physical attempt counts so cross-tagged topic copies count once.
    attempt_keys_by_question: dict[str, set[str]] = {}
    scoped_attempts = deduplicate_attempts(
        attempt
        for scoped_topic_id, scoped_topic_data in log.get("topics", {}).items()
        if topic_in_scope(scoped_topic_id, valid_topic_ids)
        for attempt in scoped_topic_data.get("attempts", [])
    )
    for attempt in scoped_attempts:
        if not is_scored_learning_attempt(attempt):
            continue
        question_id = str(attempt.get("question_id") or "")
        if not question_id or question_id.startswith("pseudo_"):
            continue
        attempt_keys_by_question.setdefault(question_id, set()).add(
            physical_attempt_key(attempt)
        )
    attempt_counts = {
        question_id: len(keys)
        for question_id, keys in attempt_keys_by_question.items()
    }

    mistakes = []
    seen_questions: set[str] = set()

    for t_id, topic_data in log.get("topics", {}).items():
        if not topic_in_scope(t_id, valid_topic_ids):
            continue
        if topic_id and t_id != topic_id:
            continue
        # Sort attempts newest first so dedup keeps the most recent incorrect attempt per question.
        # Speed-round attempts are excluded: timed-fluency slips should not pollute the Error Book.
        sorted_attempts = sorted(
            [a for a in topic_data.get("attempts", []) if not a.get("is_speed_round")],
            key=lambda a: a.get("timestamp", ""),
            reverse=True,
        )
        newest_incorrect_by_question: dict[str, dict] = {}
        for candidate in sorted_attempts:
            candidate_qid = str(candidate.get("question_id") or "")
            if (
                candidate_qid
                and not candidate_qid.startswith("pseudo_")
                and candidate.get("attempt_type", "answer") in ("answer", "diagnostic")
                and is_scored_learning_attempt(candidate)
                and classify_attempt(candidate) is AttemptOutcome.INCORRECT
            ):
                newest_incorrect_by_question.setdefault(candidate_qid, candidate)

        for attempt in sorted_attempts:
            attempt_type = attempt.get("attempt_type", "answer")
            if attempt_type not in ("answer", "diagnostic"):
                continue
            # Pending, deferred, blank, and dismissed work is not a confirmed mistake.
            if not is_scored_learning_attempt(attempt):
                continue
            qid = attempt.get("question_id", "")
            if str(qid).startswith("pseudo_"):
                continue
            if qid in seen_questions:
                continue
            seen_questions.add(qid)

            fixed_by_later_correct_at = None
            if attempt.get("correct") and not attempt.get("used_show_answer"):
                older_incorrect = newest_incorrect_by_question.get(str(qid))
                if not older_incorrect:
                    continue
                fixed_by_later_correct_at = attempt.get("timestamp", "")
                attempt = older_incorrect
            if classify_attempt(attempt) is not AttemptOutcome.INCORRECT:
                continue
            if error_type and attempt.get("error_type") != error_type:
                continue
            attempt_type = attempt.get("attempt_type", "answer")
            ex = exercises.get(qid)
            if not ex:
                # Fallback: search in imported_questions in exam_sessions
                for session in log.get("exam_sessions", []):
                    for q in session.get("imported_questions", []):
                        if q.get("id") == qid:
                            ex = q
                            break
                    if ex:
                        break
            if not ex:
                continue

            mis_id = attempt.get("misconception_id")
            mis_name = None
            mis_explanation = None
            we_name = None
            we_id = None

            if mis_id and m_lib:
                mc = m_lib.misconceptions.get(mis_id)
                if mc:
                    mis_name = mc.name
                    mis_explanation = mc.student_facing_explanation
                we = m_lib.we_by_misconception.get(mis_id)
                if we:
                    we_name = we[0].name
                    we_id = we[0].worked_example_id

            # Error taxonomy enrichment
            err_code = attempt.get("error_type")
            tax_entry = taxonomy.get(err_code, {}) if err_code else {}
            review_key = _mistake_review_key(
                subject,
                t_id,
                qid,
                year_level=year_level,
                unit=unit,
                syllabus_subject=syllabus_subject,
            )
            review_state = mistake_reviews.get(review_key, {})
            fixed_by_later_correct = bool(fixed_by_later_correct_at)
            closure_stage = review_state.get("closure_stage") or (
                "needs_transfer" if fixed_by_later_correct
                else "needs_retry" if attempt.get("error_cause") or attempt.get("reflection_type")
                else "needs_understanding"
            )
            is_resolved = bool(review_state.get("resolved")) or closure_stage in {
                "closed", "dismissed"
            }
            resolution_source = review_state.get("resolution_source")
            item_status = (
                "dismissed" if is_resolved and resolution_source == "manual_dismissal"
                else "corrected" if is_resolved and resolution_source == "demonstrated_correction"
                else "resolved" if is_resolved
                else "active"
            )
            inferred_year, inferred_unit, inferred_syllabus = _infer_scope_from_topic_id(t_id)

            from backend.services.question_context import solution_steps, student_question_view
            mistakes.append({
                **student_question_view(ex),
                "question_id": qid,
                "attempt_id": attempt.get("attempt_id"),
                "outcome": AttemptOutcome.INCORRECT.value,
                "topic_id": t_id,
                "subject": storage_subject,
                "year_level": year_level if year_level is not None else inferred_year,
                "unit": unit if unit is not None else inferred_unit,
                "syllabus_subject": syllabus_subject if syllabus_subject is not None else inferred_syllabus,
                "source": "diagnostic" if attempt_type == "diagnostic" else "practice",
                "status": item_status,
                "resolved": is_resolved,
                "resolved_at": review_state.get("resolved_at"),
                "review_count": review_state.get("review_count", 0),
                "resolution_source": resolution_source,
                "closure_stage": closure_stage,
                "error_cause": attempt.get("error_cause") or attempt.get("reflection_type"),
                "cause_recorded_at": attempt.get("cause_recorded_at"),
                "retry_correct_at": fixed_by_later_correct_at,
                "transfer_correct_at": review_state.get("transfer_correct_at"),
                "consolidation_due_at": review_state.get("consolidation_due_at"),
                "closed_at": review_state.get("closed_at"),
                "last_incorrect_at": attempt.get("timestamp", ""),
                "last_correct_after_error_at": fixed_by_later_correct_at,
                "question": ex.get("question", ""),
                "correct_answer": correct_answer_for_display(ex),
                "solution_steps": solution_steps(ex),
                "student_answer": attempt.get("student_answer", ""),
                "error_type": err_code,
                "error_severity": tax_entry.get("severity"),
                "error_tip": tax_entry.get("tip"),
                "attempt_count": attempt_counts.get(qid, 1),
                "misconception_id": mis_id,
                "misconception_name": mis_name,
                "misconception_explanation": mis_explanation,
                "worked_example_name": we_name,
                "worked_example_id": we_id,
                "timestamp": attempt.get("timestamp", ""),
                "question_type": ex.get("question_type", "short_answer"),
                "reflection_type": attempt.get("reflection_type"),
                "self_explanation": attempt.get("self_explanation"),
                "if_then_strategy": attempt.get("if_then_strategy"),
                "recommended_review_action": recommended_review_action(closure_stage),
                "choices": ex.get("choices"),
                "sub_parts": ex.get("sub_parts"),
            })

    summary_rows = list(mistakes)

    def _mistake_bucket(item: dict) -> str:
        stage = str(item.get("closure_stage") or "")
        source = str(item.get("resolution_source") or "")
        if stage == "closed" or (item.get("resolved") and source == "demonstrated_correction"):
            return "closed"
        if stage == "dismissed" or item.get("status") == "dismissed" or (item.get("resolved") and source == "manual_dismissal"):
            return "dismissed"
        if item.get("resolved") or item.get("status") in {"resolved", "corrected"}:
            return "resolved"
        return "active"

    def _is_resolved_mistake(item: dict) -> bool:
        return _mistake_bucket(item) != "active"

    topic_progress: dict[str, dict[str, int]] = {}
    error_type_counts: dict[str, int] = {}
    for item in summary_rows:
        topic_stats = topic_progress.setdefault(
            item["topic_id"], {"total": 0, "overcome": 0, "reviews": 0}
        )
        topic_stats["total"] += 1
        topic_stats["overcome"] += int(_mistake_bucket(item) == "closed")
        topic_stats["reviews"] += int(item.get("review_count") or 0)
        error_code = str(item.get("error_type") or "unknown")
        error_type_counts[error_code] = error_type_counts.get(error_code, 0) + 1
    resolved_total = sum(int(_is_resolved_mistake(item)) for item in summary_rows)
    closed_total = sum(int(_mistake_bucket(item) == "closed") for item in summary_rows)
    dismissed_total = sum(int(_mistake_bucket(item) == "dismissed") for item in summary_rows)
    summary = {
        "total": len(summary_rows),
        "active": len(summary_rows) - resolved_total,
        "resolved": resolved_total,
        "closed": closed_total,
        "dismissed": dismissed_total,
        "reviews": sum(int(item.get("review_count") or 0) for item in summary_rows),
        "topic_counts": {
            topic: values["total"] for topic, values in topic_progress.items()
        },
        "error_type_counts": error_type_counts,
        "topic_progress": topic_progress,
    }
    if status == "active":
        mistakes = [item for item in mistakes if not _is_resolved_mistake(item)]
    elif status == "resolved":
        mistakes = [item for item in mistakes if _is_resolved_mistake(item)]

    if sort == "mastery":
        # Sort by BKT mastery (lowest first = weakest topics first)
        progress = engine.get_all_progress(valid_topic_ids=valid_topic_ids)
        bkt_map = {
            item["topic"]: item.get("bkt_mastery", 0.0)
            for item in progress
        }

        mistakes.sort(key=lambda m: bkt_map.get(m["topic_id"], 0.5))
    else:
        mistakes.sort(key=lambda m: m["timestamp"], reverse=True)

    total = len(mistakes)
    if offset:
        mistakes = mistakes[offset:]
    if limit is not None:
        mistakes = mistakes[:limit]

    result = {
        "mistakes": mistakes,
        "total": total,
        "returned": len(mistakes),
        "offset": offset,
        "has_more": offset + len(mistakes) < total,
        "summary": summary,
    }

    if result["returned"] <= MISTAKES_CACHE_MAX_ITEMS_PER_ENTRY:
        _store_mistakes_cache(
            cache_key,
            cache_generation,
            now + MISTAKES_CACHE_TTL,
            result,
            now,
        )

    return result


@router.post("/api/tutor/mistakes/cause")
def record_mistake_cause(
    req: MistakeCauseRequest,
    student_id: str = Depends(require_student_id),
):
    """Record the learner's diagnosis of an error before retrying it."""
    request_id = req.request_id
    fingerprint = request_fingerprint(req, exclude={"request_id"}) if request_id else None

    def process() -> dict[str, Any]:
        storage_subject = storage_subject_for_scope(req.subject)
        engine = get_engine(student_id, storage_subject)
        recorded_at = datetime.now(timezone.utc).isoformat()
        strategy = (req.if_then_strategy or "").strip()
        updated = engine.update_latest_incorrect_attempt_metadata(
            req.question_id,
            {
                "error_cause": req.error_cause,
                "reflection_type": req.error_cause,
                "cause_recorded_at": recorded_at,
                **({"if_then_strategy": strategy} if strategy else {}),
            },
            topics=[req.topic_id],
        )
        if not updated:
            raise HTTPException(
                status_code=404,
                detail={"error": "mistake_not_found", "message": "No confirmed incorrect attempt was found."},
            )
        invalidate_mistakes_cache(student_id)
        state = engine.get_mistake_state(req.question_id) or {}
        return {
            "question_id": req.question_id,
            "topic_id": req.topic_id,
            "error_cause": req.error_cause,
            "if_then_strategy": strategy or None,
            "cause_recorded_at": state.get("cause_recorded_at") or recorded_at,
            "closure_stage": state.get("closure_stage") or "needs_retry",
        }

    if not request_id:
        return process()

    try:
        with replay_lock(student_id, "mistake_cause", request_id):
            cached = replay_lookup(student_id, "mistake_cause", request_id, fingerprint or "")
            if cached is not None:
                return cached
            response = process()
            replay_store(
                student_id,
                "mistake_cause",
                request_id,
                fingerprint or "",
                response,
            )
            return response
    except RequestReplayConflict as exc:
        raise HTTPException(
            status_code=409,
            detail={"error": "mistake_cause_request_id_conflict", "message": str(exc)},
        )


@router.post("/api/tutor/mistakes/resolve")
def resolve_mistake_review(
    req: MistakeResolveRequest,
    student_id: str = Depends(require_student_id),
):
    """Advance an Error Book item using verified correction evidence."""
    request_id = req.request_id
    fingerprint = request_fingerprint(req, exclude={"request_id"}) if request_id else None

    def process() -> dict[str, Any]:
        storage_subject = storage_subject_for_scope(req.subject)
        engine = get_engine(student_id, storage_subject)
        review_key = _mistake_review_key(
            storage_subject,
            req.topic_id,
            req.question_id,
            year_level=req.year_level,
            unit=req.unit,
            syllabus_subject=req.syllabus_subject,
        )
        now = datetime.now(timezone.utc)
        with engine._lock:
            log = engine._read_log(topics=[])
            reviews = log.setdefault("mistake_reviews", {})
            existing_review = reviews.get(review_key, {})
            if request_id and str(existing_review.get("request_id") or "") == str(request_id):
                stored_fingerprint = str(existing_review.get("request_fingerprint") or "")
                incoming_fingerprint = str(fingerprint or "")
                if (
                    stored_fingerprint
                    and incoming_fingerprint
                    and stored_fingerprint != incoming_fingerprint
                ):
                    raise RequestReplayConflict(
                        "request_id was already used for different mistake resolve content"
                    )
                stored_response = existing_review.get("request_response")
                if isinstance(stored_response, dict):
                    # The review JSON is written before the derived SQLite state.
                    # A retry after that small write gap repairs the derived row
                    # without applying the transition or count a second time.
                    closure_updater = getattr(engine, "set_mistake_closure_state", None)
                    if callable(closure_updater):
                        closure_updater(
                            req.question_id,
                            closure_stage=str(
                                existing_review.get("closure_stage")
                                or stored_response.get("closure_stage")
                                or "needs_understanding"
                            ),
                            resolved=bool(
                                existing_review.get("resolved", stored_response.get("resolved"))
                            ),
                            resolved_at=existing_review.get("resolved_at"),
                            review_count=int(
                                existing_review.get(
                                    "review_count", stored_response.get("review_count") or 0
                                )
                            ),
                            resolution_source=(
                                existing_review.get("resolution_source")
                                or stored_response.get("resolution_source")
                            ),
                            transfer_correct_at=(
                                existing_review.get("transfer_correct_at")
                                or stored_response.get("transfer_correct_at")
                            ),
                            consolidation_due_at=(
                                existing_review.get("consolidation_due_at")
                                or stored_response.get("consolidation_due_at")
                            ),
                            closed_at=(
                                existing_review.get("closed_at")
                                or stored_response.get("closed_at")
                            ),
                        )
                    invalidate_mistakes_cache(student_id)
                    return stored_response
            state_reader = getattr(engine, "get_mistake_state", None)
            state = state_reader(req.question_id) if callable(state_reader) else None
            state = state or {}
            review_count = max(
                int(existing_review.get("review_count", 0)),
                int(state.get("review_count", 0)),
            )
            closure_stage = str(state.get("closure_stage") or "needs_understanding")
            resolved = False
            resolved_at = None
            transfer_correct_at = state.get("transfer_correct_at")
            consolidation_due_at = state.get("consolidation_due_at")
            closed_at = None
            resolution_source = None

            if req.resolved and req.resolution_source == "demonstrated_correction":
                if closure_stage not in {"needs_transfer", "needs_consolidation"}:
                    raise HTTPException(
                        status_code=409,
                        detail={
                            "error": "mistake_stage_prerequisite",
                            "message": (
                                "Record the error cause and redo the original question "
                                "before attempting transfer or consolidation."
                            ),
                            "closure_stage": closure_stage,
                        },
                    )
                correction_attempts = deduplicate_attempts(
                    attempt
                    for attempt in engine.get_error_book_review_attempts(req.question_id)
                    if is_error_book_closure_evidence(attempt, req.question_id)
                )
                correction_times = sorted(
                    parsed
                    for parsed in (
                        _parse_attempt_datetime(attempt.get("timestamp"))
                        for attempt in correction_attempts
                    )
                    if parsed is not None
                )
                if not correction_times:
                    raise HTTPException(
                        status_code=409,
                        detail={
                            "error": "matched_correction_required",
                            "message": (
                                "Complete a correctly scored, transfer-safe Error Book variation "
                                "before advancing this mistake."
                            ),
                        },
                    )

                if closure_stage == "needs_consolidation":
                    transfer_time = _parse_attempt_datetime(transfer_correct_at)
                    due_time = _parse_attempt_datetime(consolidation_due_at)
                    if due_time is not None and now < due_time:
                        raise HTTPException(
                            status_code=409,
                            detail={
                                "error": "consolidation_not_due",
                                "message": "The spaced consolidation check is not due yet.",
                                "consolidation_due_at": consolidation_due_at,
                            },
                        )
                    fresh = [
                        value for value in correction_times
                        if (transfer_time is None or value > transfer_time)
                        and (due_time is None or value >= due_time)
                    ]
                    if not fresh:
                        raise HTTPException(
                            status_code=409,
                            detail={
                                "error": "fresh_consolidation_required",
                                "message": "Complete a new transfer-safe question after the due time to close this mistake.",
                            },
                        )
                    closure_stage = "closed"
                    resolved = True
                    resolved_at = now.isoformat()
                    closed_at = fresh[-1].isoformat()
                    resolution_source = "demonstrated_correction"
                    review_count += 1
                else:
                    retry_time = _parse_attempt_datetime(state.get("retry_correct_at"))
                    fresh = [
                        value for value in correction_times
                        if retry_time is not None and value > retry_time
                    ]
                    if not fresh:
                        raise HTTPException(
                            status_code=409,
                            detail={
                                "error": "fresh_transfer_required",
                                "message": (
                                    "Complete a new, unaided transfer-safe question "
                                    "after independently redoing the original."
                                ),
                            },
                        )
                    transfer_time = fresh[-1]
                    transfer_correct_at = transfer_time.isoformat()
                    consolidation_due_at = (transfer_time + timedelta(days=3)).isoformat()
                    closure_stage = "needs_consolidation"
                    resolution_source = "demonstrated_correction"
                    review_count += 1
            elif req.resolved:
                closure_stage = "dismissed"
                resolved = True
                resolved_at = existing_review.get("resolved_at") or now.isoformat()
                closed_at = None
                resolution_source = "manual_dismissal"
                if not bool(existing_review.get("resolved")):
                    review_count += 1
            else:
                if state.get("fixed_by_later_correct"):
                    closure_stage = "needs_transfer"
                elif state.get("error_cause"):
                    closure_stage = "needs_retry"
                else:
                    closure_stage = "needs_understanding"

            response = {
                "question_id": req.question_id,
                "topic_id": req.topic_id,
                "status": "resolved" if resolved else "active",
                "resolved": resolved,
                "review_count": review_count,
                "resolution_source": resolution_source,
                "closure_stage": closure_stage,
                "transfer_correct_at": transfer_correct_at,
                "consolidation_due_at": consolidation_due_at,
                "closed_at": closed_at,
            }
            review_record = {
                "resolved": resolved,
                "resolved_at": resolved_at,
                "review_count": review_count,
                "resolution_source": resolution_source,
                "closure_stage": closure_stage,
                "transfer_correct_at": transfer_correct_at,
                "consolidation_due_at": consolidation_due_at,
                "closed_at": closed_at,
            }
            if request_id:
                review_record.update({
                    "request_id": str(request_id),
                    "request_fingerprint": str(fingerprint or ""),
                    "request_response": response,
                })
            reviews[review_key] = review_record
            engine._write_log(log)
            closure_updater = getattr(engine, "set_mistake_closure_state", None)
            if callable(closure_updater):
                closure_updater(
                    req.question_id,
                    closure_stage=closure_stage,
                    resolved=resolved,
                    resolved_at=resolved_at,
                    review_count=review_count,
                    resolution_source=resolution_source,
                    transfer_correct_at=transfer_correct_at,
                    consolidation_due_at=consolidation_due_at,
                    closed_at=closed_at,
                )
            else:
                review_updater = getattr(engine, "update_mistake_review_state", None)
                if callable(review_updater):
                    review_updater(
                        req.question_id,
                        resolved=resolved,
                        resolved_at=resolved_at,
                        review_count=review_count,
                        resolution_source=resolution_source,
                    )

        invalidate_mistakes_cache(student_id)
        return response

    if not request_id:
        return process()

    try:
        with replay_lock(student_id, "mistake_resolve", request_id):
            cached = replay_lookup(student_id, "mistake_resolve", request_id, fingerprint or "")
            if cached is not None:
                return cached
            response = process()
            replay_store(
                student_id,
                "mistake_resolve",
                request_id,
                fingerprint or "",
                response,
            )
            return response
    except RequestReplayConflict as exc:
        raise HTTPException(
            status_code=409,
            detail={"error": "mistake_resolve_request_id_conflict", "message": str(exc)},
        )


def _parse_attempt_datetime(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        parsed = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    except ValueError:
        return None


def _default_next_review_at(ts: str | None) -> str:
    parsed = _parse_attempt_datetime(ts) or datetime.now(timezone.utc)
    return (parsed + timedelta(days=1)).isoformat()


def _first_topic_exercise(exercises: dict, topic_id: str) -> dict | None:
    for ex in exercises.values():
        if topic_id in (ex.get("topic_ids") or []):
            return ex
    return None


def _worked_example_payload(ex: dict | None, card: dict) -> dict | None:
    worked = card.get("worked_example") if card else None
    if isinstance(worked, dict):
        steps = []
        for step in worked.get("steps") or []:
            if isinstance(step, dict):
                text = " ".join(
                    str(part).strip()
                    for part in (step.get("instruction"), step.get("result"))
                    if part
                ).strip()
                if text:
                    steps.append(text)
            elif step:
                steps.append(str(step))
        return {
            "question": worked.get("question") or (ex or {}).get("question", ""),
            "steps": steps[:4],
            "answer": worked.get("answer") or worked.get("final_answer") or correct_answer_for_display(ex or {}),
        }

    if not ex:
        return None

    steps = [str(step) for step in (ex.get("steps") or [])[:4]]
    if not steps and ex.get("sample_reasoning"):
        steps = [str(ex["sample_reasoning"])]
    return {
        "question": ex.get("question", ""),
        "steps": steps,
        "answer": correct_answer_for_display(ex),
    }


def _personal_trap(attempt: dict, tax_entry: dict) -> str:
    gap = attempt.get("gap_classification")
    if isinstance(gap, dict):
        for key in ("parent_summary", "recommended_action", "evidence"):
            value = gap.get(key)
            if value:
                return str(value)
    if tax_entry.get("tip"):
        return str(tax_entry["tip"])
    if attempt.get("student_answer"):
        return f"Old answer to compare against: {attempt['student_answer']}"
    return "Review the first step where the working no longer matches the question."


def _key_rule(topic_id: str, card: dict, attempt: dict | None, tax_entry: dict) -> str:
    if card.get("core_rule"):
        return str(card["core_rule"])
    gap = (attempt or {}).get("gap_classification")
    if isinstance(gap, dict) and gap.get("recommended_action"):
        return str(gap["recommended_action"])
    if tax_entry.get("tip"):
        return str(tax_entry["tip"])
    return f"Revisit the core rule for {topic_id} and test it on one similar example."


@router.get("/api/tutor/trap-notebook")
def get_trap_notebook(
    subject: str = "math",
    topic_id: str | None = None,
    year_level: int | None = None,
    unit: int | None = None,
    syllabus_subject: str | None = None,
    student_id: str = Depends(require_student_id),
):
    """Return formula/rule review cards derived from repeated mistakes and spaced revision."""
    storage_subject = storage_subject_for_scope(subject)
    engine = get_engine(student_id, storage_subject)
    valid_topic_ids = valid_topic_ids_for_scope(subject, year_level, unit, syllabus_subject)
    topic_scope = [topic_id] if topic_id else valid_topic_ids
    log = engine.load_log(topics=topic_scope)
    exercises = get_tutor_engine().exercises
    taxonomy = _get_error_taxonomy(storage_subject)

    attempt_keys_by_question: dict[str, set[str]] = {}
    latest_by_question: dict[str, tuple[str, dict]] = {}
    for t_id, t_data in log.get("topics", {}).items():
        if not topic_in_scope(t_id, valid_topic_ids):
            continue
        if topic_id and t_id != topic_id:
            continue
        for att in t_data.get("attempts", []):
            if not is_scored_learning_attempt(att):
                continue
            qid = att.get("question_id", "")
            if str(qid).startswith("pseudo_"):
                continue
            if qid:
                attempt_keys_by_question.setdefault(qid, set()).add(physical_attempt_key(att))
                current = latest_by_question.get(qid)
                if current is None or att.get("timestamp", "") > current[1].get("timestamp", ""):
                    latest_by_question[qid] = (t_id, att)

    attempt_counts = {
        question_id: len(keys)
        for question_id, keys in attempt_keys_by_question.items()
    }

    entries = []
    seen_topics: set[str] = set()

    for qid, (t_id, attempt) in latest_by_question.items():
        if classify_attempt(attempt) is not AttemptOutcome.INCORRECT:
            continue
        if attempt_counts.get(qid, 0) < 2 and not isinstance(attempt.get("gap_classification"), dict):
            continue
        ex = exercises.get(qid)
        if not ex:
            continue
        err_code = attempt.get("error_type")
        tax_entry = taxonomy.get(err_code, {}) if err_code else {}
        card = get_tutor_engine().get_concept_card_dict(t_id)
        revision = log.get("topics", {}).get(t_id, {}).get("revision", {})
        entries.append({
            "id": f"trap::{t_id}::{qid}",
            "source": "repeated_mistake",
            "topic_id": t_id,
            "question_id": qid,
            "question": ex.get("question", ""),
            "key_rule": _key_rule(t_id, card, attempt, tax_entry),
            "personal_trap": _personal_trap(attempt, tax_entry),
            "worked_example": _worked_example_payload(ex, card),
            "next_review_at": revision.get("next_review_at") or _default_next_review_at(attempt.get("timestamp")),
            "timestamp": attempt.get("timestamp", ""),
            "attempt_count": attempt_counts.get(qid, 1),
            "error_type": err_code,
            "gap_classification": attempt.get("gap_classification"),
        })
        seen_topics.add(t_id)

    for t_id, t_data in log.get("topics", {}).items():
        if not topic_in_scope(t_id, valid_topic_ids):
            continue
        if topic_id and t_id != topic_id:
            continue
        revision = t_data.get("revision") or {}
        next_review_at = revision.get("next_review_at")
        if not next_review_at or t_id in seen_topics:
            continue
        card = get_tutor_engine().get_concept_card_dict(t_id)
        ex = _first_topic_exercise(exercises, t_id)
        entries.append({
            "id": f"revision::{t_id}",
            "source": "spaced_revision",
            "topic_id": t_id,
            "question_id": None,
            "question": (ex or {}).get("question", ""),
            "key_rule": _key_rule(t_id, card, None, {}),
            "personal_trap": "This topic is on your spaced review schedule.",
            "worked_example": _worked_example_payload(ex, card),
            "next_review_at": next_review_at,
            "timestamp": next_review_at,
            "attempt_count": 0,
            "error_type": None,
            "gap_classification": None,
        })

    entries.sort(key=lambda item: item.get("next_review_at") or "")
    return {"entries": entries, "total": len(entries)}


@router.get("/api/tutor/daily-summary")
def get_daily_summary(
    subject: str = "math",
    year_level: int | None = None,
    unit: int | None = None,
    syllabus_subject: str | None = None,
    student_id: str = Depends(require_student_id),
):
    """Return today's learning summary: attempts, correct, streak, goal progress."""

    # Scope parameters remain accepted for API compatibility, but this endpoint
    # is deliberately the household-wide habit/quest summary. Subject-scoped
    # learning evidence is served by progress and derived-analytics endpoints.
    _ = (subject, year_level, unit, syllabus_subject)
    today_str = date.today().isoformat()
    freeze_applied = False
    freeze_tokens = 0
    all_dates: set[str] = set()
    today_attempts = 0
    today_correct = 0
    today_independent_attempts = 0
    today_independent_correct = 0
    streak = 0
    daily_goal = 20
    wallet: dict = {}

    try:
        from backend.services.quests import (
            DEFAULT_DAILY_STAR_CAP,
            collect_cross_subject_stats,
            wallet_public,
        )

        cross = collect_cross_subject_stats(student_id)
        today_attempts = int(cross.get("today_attempts") or 0)
        today_correct = int(cross.get("today_correct") or 0)
        today_independent_attempts = int(cross.get("today_independent_attempts") or 0)
        today_independent_correct = int(cross.get("today_independent_correct") or 0)
        streak = int(cross.get("streak_days") or 0)
        freeze_applied = bool(cross.get("freeze_applied"))
        freeze_tokens = int(cross.get("freeze_tokens") or 0)
        all_dates = set(cross.get("activity_dates") or set())
        daily_goal = int(cross.get("daily_goal") or 20)
        try:
            wallet = wallet_public(student_id)
        except Exception:
            logger.warning("Daily summary wallet unavailable for student=%s", student_id, exc_info=True)
    except Exception:
        # Do not silently change metric scope during a service failure. A safe
        # global zero/empty summary is less misleading than returning one
        # subject while labelling it as the household-wide streak.
        logger.warning("Cross-subject daily summary unavailable for student=%s", student_id, exc_info=True)

    # Activity dates for the last 14 days (for parent weekly calendar)
    freeze_dates = set(wallet.get("freeze_dates") or []) if wallet else set()

    recent_dates = []
    for i in range(13, -1, -1):
        d = (date.today() - timedelta(days=i)).isoformat()
        recent_dates.append({
            "date": d,
            "active": d in all_dates,
            "frozen": d in freeze_dates and d not in all_dates,
        })

    # Streak encouragement message
    if freeze_applied:
        streak_msg = f"🛡️ Freeze used — streak saved at {streak} day{'s' if streak != 1 else ''}!"
    elif streak == 0:
        streak_msg = "Start today to build your streak!"
    elif streak < 3:
        streak_msg = f"{streak} day{'s' if streak > 1 else ''} streak — keep it going!"
    elif streak < 7:
        streak_msg = f"🔥 {streak} days strong — {7 - streak} more for a full week!"
    elif streak < 14:
        streak_msg = f"🔥 {streak} day streak — incredible consistency!"
    else:
        streak_msg = f"🌟 {streak} day streak — champion habit!"

    return {
        "scope": "all_subjects",
        "today_attempts": today_attempts,
        "today_correct": today_correct,
        "today_accuracy": round(today_correct / today_attempts * 100, 1) if today_attempts > 0 else 0,
        "today_independent_attempts": today_independent_attempts,
        "today_independent_correct": today_independent_correct,
        "today_independent_accuracy": (
            round(today_independent_correct / today_independent_attempts * 100, 1)
            if today_independent_attempts > 0
            else None
        ),
        "daily_goal": daily_goal,
        "goal_progress": min(today_attempts / daily_goal, 1.0) if daily_goal > 0 else 1.0,
        "goal_met": today_attempts >= daily_goal,
        "streak_days": streak,
        "streak_message": streak_msg,
        "streak_freeze_applied": freeze_applied,
        "freeze_tokens": freeze_tokens or int(wallet.get("freeze_tokens") or 0),
        "quest_stars": int(wallet.get("stars") or 0),
        "quest_level": int(wallet.get("level") or 1),
        "quest_daily_stars": int(wallet.get("daily_stars_earned") or 0),
        "quest_daily_cap": int(wallet.get("daily_star_cap") or DEFAULT_DAILY_STAR_CAP),
        "quest_enabled": bool(wallet.get("enabled", True)) if wallet else True,
        "activity_dates": recent_dates,
        "date": today_str,
    }


@router.post("/api/tutor/set-daily-goal")
def set_daily_goal(
    body: dict,
    student_id: str = Depends(require_student_id),
):
    """Set the daily question goal for this student."""
    goal = body.get("daily_goal", 20)
    if not isinstance(goal, int) or goal < 1 or goal > 100:
        raise HTTPException(status_code=400, detail={"error": "invalid_goal", "message": "daily_goal must be 1-100"})

    # The daily summary is explicitly all-subject, so its goal must have one
    # authoritative household value rather than a picker-dependent subject max.
    _ = body.get("subject")  # accepted for backward-compatible clients
    engine = get_engine(student_id, PROFILE_SUBJECT)
    with engine._lock:
        log = engine._read_log(topics=[])
        log.setdefault("settings", {})["daily_goal"] = goal
        engine._write_log(log)

    return {"scope": "all_subjects", "daily_goal": goal, "message": "All-subject goal updated."}


@router.get("/api/tutor/worked-example")
def get_worked_example(topic_id: str):
    """Return the concept card worked example for a topic.

    Used by the frontend to proactively show worked examples before practice
    or after consecutive errors.
    """
    card = get_tutor_engine().get_concept_card_dict(topic_id)
    if not card:
        raise HTTPException(status_code=404, detail={"error": "topic_not_found", "message": f"No concept card for {topic_id}"})

    we = card.get("worked_example")
    return {
        "topic_id": topic_id,
        "core_rule": card.get("core_rule", ""),
        "worked_example": we,
        "has_worked_example": we is not None,
    }


# --- Lesson Content Endpoint ---

@router.get("/api/tutor/lesson-content")
def get_lesson_content(topic_id: str):
    """Return structured lesson content for a topic, if available."""
    from backend.tutor_engine import NotFound as _NotFound

    engine = get_tutor_engine()
    result = engine._resolve_topic_identifier(topic_id)
    if isinstance(result, _NotFound):
        raise HTTPException(status_code=404, detail={"error": "topic_not_found", "message": f"No topic found for {topic_id}"})

    card = getattr(result.topic, "concept_card", None)
    if card and card.lesson_content:
        we = card.worked_example
        return {
            "has_lesson_content": True,
            "topic_id": topic_id,
            "core_rule": card.core_rule or "",
            "lesson_content": card.lesson_content.model_dump(mode="json"),
            "worked_example": we.model_dump(mode="json") if we else None,
        }
    return {"has_lesson_content": False, "topic_id": topic_id}


# --- Speed Round Endpoints ---

class SpeedRoundStartRequest(BaseModel):
    subject: str = "math"
    year_level: int = 7
    topic: str | None = None
    num_questions: int = 10
    time_limit_seconds: int = 120  # 2 min default
    challenge_mode: bool = False


class SpeedRoundSubmitRequest(BaseModel):
    session_id: str
    responses: dict[str, str]


@dataclass
class SpeedRoundSession:
    session_id: str
    student_id: str
    subject: str
    topic: str | None
    questions: list[dict]
    start_time: float
    time_limit_seconds: int
    challenge_mode: bool = False
    completed: bool = False
    processing: bool = False
    submission_fingerprint: str | None = None


_speed_round_sessions: dict[str, SpeedRoundSession] = {}
_SPEED_ROUND_SESSIONS_LOCK = threading.RLock()
_SPEED_ROUND_SESSION_TTL = 3600  # 1 hour
_SPEED_ROUND_MAX_SESSIONS = 100

_CHALLENGE_STRATEGY_PROMPTS = {
    "draw_diagram": "Sketch the situation first. Label only the information you actually need.",
    "work_backwards": "Start from the target value and reverse the operations one at a time.",
    "systematic_listing": "List cases in a table or grid so you do not double-count or miss an outcome.",
    "parity": "Check odd/even behaviour before calculating. It may remove half the cases.",
    "invariants": "Look for what stays unchanged while the problem changes.",
    "estimation": "Estimate first so your final answer has a reasonableness check.",
    "algebraic_representation": "Define a variable, write the relationship, then solve or test the rule.",
}


def _challenge_strategy_for_question(question: dict) -> str:
    """Classify a Year 7 extension question by the main problem-solving strategy."""
    text = f"{question.get('question', '')} {question.get('topic', '')}".lower()
    topic_ids = question.get("topic_ids", [])

    if question.get("diagram_data") or any(tid.startswith(("AC9M7M", "AC9M7SP")) for tid in topic_ids):
        if any(word in text for word in ("diagram", "shape", "triangle", "circle", "rectangle", "coordinate", "map", "net")):
            return "draw_diagram"
    if any(word in text for word in ("what was", "original", "reverse", "before", "work backwards")):
        return "work_backwards"
    if any(word in text for word in ("sample space", "list", "arrangement", "outcomes", "coin", "die", "spinner")):
        return "systematic_listing"
    if any(word in text for word in ("odd", "even", "parity")):
        return "parity"
    if any(word in text for word in ("unchanged", "same", "invariant", "constant")):
        return "invariants"
    if any(word in text for word in ("estimate", "approximately", "round", "better value", "reasonable")):
        return "estimation"
    if any(word in text for word in ("formula", "rule", "equation", "expression", "variable", "pattern", "linear")):
        return "algebraic_representation"
    if question.get("difficulty") == "AMC":
        return "systematic_listing"
    return "estimation"


def _challenge_metadata(question: dict) -> dict:
    strategy = _challenge_strategy_for_question(question)
    return {
        "challenge_strategy": strategy,
        "strategy_prompt": _CHALLENGE_STRATEGY_PROMPTS[strategy],
        "post_challenge_reflection_prompt": "What made this hard, and which strategy helped most?",
        "is_extension": question.get("difficulty") in {"AMC", "extending"},
    }


def _cleanup_speed_round_sessions():
    """Expire abandoned sessions and enforce a hard process-wide cap."""
    now = time.time()
    with _SPEED_ROUND_SESSIONS_LOCK:
        expired = [
            sid for sid, session in _speed_round_sessions.items()
            if (now - session.start_time) > _SPEED_ROUND_SESSION_TTL
        ]
        for sid in expired:
            del _speed_round_sessions[sid]

        overflow = len(_speed_round_sessions) - _SPEED_ROUND_MAX_SESSIONS
        if overflow > 0:
            oldest = sorted(
                _speed_round_sessions.items(), key=lambda item: item[1].start_time
            )
            for sid, _ in oldest[:overflow]:
                del _speed_round_sessions[sid]


@router.post("/api/speed-round/start")
def speed_round_start(
    req: SpeedRoundStartRequest,
    student_id: str = Depends(require_student_id),
):
    """Start a speed round session — returns questions without answers."""
    import uuid
    import random

    _cleanup_speed_round_sessions()  # Prevent unbounded memory growth

    engine = get_tutor_engine()
    indexed_pool = engine.exercises_for_year(req.subject, req.year_level)
    all_ex = list(indexed_pool) if isinstance(indexed_pool, list) else [
        exercise for exercise in engine.exercises.values()
        if exercise.get("subject", "math") == req.subject
        and exercise.get("year_level", req.year_level) == req.year_level
    ]

    if req.topic:
        pool = [ex for ex in all_ex if ex.get("topic") == req.topic or req.topic in ex.get("topic_ids", [])]
    else:
        pool = list(all_ex)

    if req.challenge_mode:
        challenge_pool = [
            ex for ex in pool
            if ex.get("difficulty") in {"AMC", "extending"}
            or ex.get("complexity") == "complex_unfamiliar"
        ]
        if challenge_pool:
            pool = challenge_pool

    if not pool:
        raise HTTPException(status_code=404, detail={"error": "no_questions", "message": "No questions available."})

    selected = random.sample(pool, min(req.num_questions, len(pool)))

    safe = []
    for q in selected:
        sq = {
            "id": q["id"],
            "question": q["question"],
            "question_type": q.get("question_type", "short_answer"),
            "topic_ids": q.get("topic_ids", []),
            "difficulty": q.get("difficulty"),
            **(_challenge_metadata(q) if req.challenge_mode else {}),
        }
        if q.get("question_type") == "multiple_choice":
            sq["choices"] = q.get("choices", [])
        if q.get("question_type") == "multi_part":
            sq["sub_parts"] = [
                {k: v for k, v in part.items() if k != "answer"}
                for part in q.get("sub_parts", [])
            ]
        safe.append(sq)

    session_id = str(uuid.uuid4())
    with _SPEED_ROUND_SESSIONS_LOCK:
        _speed_round_sessions[session_id] = SpeedRoundSession(
            session_id=session_id,
            student_id=student_id,
            subject=req.subject,
            topic=req.topic,
            questions=selected,
            start_time=time.time(),
            time_limit_seconds=req.time_limit_seconds,
            challenge_mode=req.challenge_mode,
        )
        _cleanup_speed_round_sessions()

    strategy_counts = {}
    if req.challenge_mode:
        for q in selected:
            strategy = _challenge_strategy_for_question(q)
            strategy_counts[strategy] = strategy_counts.get(strategy, 0) + 1

    return {
        "session_id": session_id,
        "questions": safe,
        "time_limit_seconds": req.time_limit_seconds,
        "total": len(safe),
        "challenge_mode": req.challenge_mode,
        "strategy_counts": strategy_counts,
    }


@router.post("/api/speed-round/submit")
def speed_round_submit(
    req: SpeedRoundSubmitRequest,
    student_id: str = Depends(require_student_id),
):
    """Submit speed-round answers once, while allowing safe retry after failure."""
    _cleanup_speed_round_sessions()
    submission_fingerprint = request_fingerprint({
        "session_id": req.session_id,
        "responses": req.responses,
    })
    with _SPEED_ROUND_SESSIONS_LOCK:
        session = _speed_round_sessions.get(req.session_id)
        if not session or session.completed:
            raise HTTPException(status_code=404, detail={"error": "session_not_found", "message": "Speed round session not found or already completed."})
        if session.student_id != student_id:
            raise HTTPException(status_code=403, detail={"error": "forbidden", "message": "Session belongs to another student."})
        if session.processing:
            raise HTTPException(status_code=409, detail={"error": "submission_in_progress", "message": "This speed round submission is already being processed."})
        if session.submission_fingerprint and session.submission_fingerprint != submission_fingerprint:
            raise HTTPException(status_code=409, detail={"error": "submission_conflict", "message": "Retry the same speed round answers after a failed submission."})

        session.submission_fingerprint = submission_fingerprint
        session.processing = True
        elapsed = time.time() - session.start_time
        timed_out = elapsed > session.time_limit_seconds

    results = []
    correct_count = 0
    try:
        tutor = get_tutor_engine()
        for q in session.questions:
            ans = req.responses.get(q["id"], "")
            mark_fingerprint = request_fingerprint({
                "session_id": session.session_id,
                "question_id": q["id"],
                "student_answer": ans,
            })
            result = tutor.mark(
                q["id"],
                ans,
                student_id=student_id,
                is_speed_round=True,
                request_id=f"speed-round:{session.session_id}:{q['id']}",
                request_fingerprint=mark_fingerprint,
            )
            if result.get("retryable"):
                raise RuntimeError("speed-round attempt persistence is temporarily unavailable")
            results.append({
                "question_id": q["id"],
                "question": q["question"],
                "is_correct": result.get("is_correct", False),
                "student_answer": ans,
                "correct_answer": correct_answer_for_display(q),
                **(_challenge_metadata(q) if session.challenge_mode else {}),
            })
            if result.get("is_correct"):
                correct_count += 1
    except Exception as exc:
        with _SPEED_ROUND_SESSIONS_LOCK:
            session.processing = False
        logger.exception("Speed round submission failed for session %s", session.session_id)
        raise HTTPException(
            status_code=503,
            detail={
                "error": "speed_round_submission_failed",
                "message": "The speed round could not be saved completely. Retry the same answers.",
                "retryable": True,
            },
        ) from exc

    with _SPEED_ROUND_SESSIONS_LOCK:
        session.processing = False
        session.completed = True

    return {
        "session_id": session.session_id,
        "total": len(session.questions),
        "correct": correct_count,
        "score": f"{correct_count}/{len(session.questions)}",
        "accuracy": round(correct_count / len(session.questions) * 100, 1) if session.questions else 0,
        "elapsed_seconds": round(elapsed, 1),
        "timed_out": timed_out,
        "time_limit_seconds": session.time_limit_seconds,
        "results": results,
    }


@router.get("/api/speed-round/history")
def speed_round_history(student_id: str = Depends(require_student_id)):
    """Return past speed round sessions for this student."""
    _cleanup_speed_round_sessions()
    with _SPEED_ROUND_SESSIONS_LOCK:
        sessions = [s for s in _speed_round_sessions.values() if s.student_id == student_id and s.completed]
    return {"sessions": [{"session_id": s.session_id, "topic": s.topic, "subject": s.subject} for s in sessions], "total": len(sessions)}


@router.get("/api/tutor/parent-next-steps")
def get_parent_next_steps(
    subject: str = "math",
    year: str = "year7",
    year_level: int | None = None,
    unit: int | None = None,
    syllabus_subject: str | None = None,
    student_id: str = Depends(require_student_id),
):
    """Return parent-friendly diagnostic summary and next-step actions."""
    from backend.services.derived_analytics import derive_parent_next_steps
    return derive_parent_next_steps(
        student_id,
        storage_subject_for_scope(subject),
        year,
        year_level=year_level,
        unit=unit,
        syllabus_subject=syllabus_subject,
    )


@router.get("/api/tutor/weekly-learning-summary")
def get_weekly_learning_summary(
    days: int = 7,
    student_id: str = Depends(require_student_id),
):
    """Return one trustworthy cross-subject learning summary for student and parent views."""
    if days < 1 or days > 31:
        raise HTTPException(
            status_code=422,
            detail={"error": "invalid_days", "message": "days must be between 1 and 31."},
        )
    from backend.services.derived_analytics import derive_weekly_learning_summary
    return derive_weekly_learning_summary(student_id, days=days)


@router.get("/api/tutor/weekly-report")
def get_student_weekly_report(
    week_start: str | None = None,
    student_id: str = Depends(require_student_id),
):
    """Return one fixed Brisbane calendar-week report and saved student reflection."""
    from backend.services.derived_analytics import derive_student_weekly_report
    try:
        return derive_student_weekly_report(student_id, week_start=week_start)
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail={"error": "invalid_week_start", "message": str(exc)},
        ) from exc


@router.post("/api/tutor/weekly-report/reflection")
def upsert_student_weekly_reflection(
    request: WeeklyReflectionRequest,
    student_id: str = Depends(require_student_id),
):
    """Save a student-authored reflection for an available calendar week."""
    from backend.services.derived_analytics import weekly_report_window
    try:
        selected_start, *_ = weekly_report_window(request.week_start)
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail={"error": "invalid_week_start", "message": str(exc)},
        ) from exc
    reflection = save_weekly_reflection(
        student_id,
        selected_start.isoformat(),
        proud_of=request.proud_of,
        challenge=request.challenge,
        next_week_intention=request.next_week_intention,
    )
    return {"week_start": selected_start.isoformat(), **reflection}


@router.get("/api/tutor/learning-facets")
def get_learning_facets(
    subject: str = "math",
    year_level: int | None = None,
    unit: int | None = None,
    syllabus_subject: str | None = None,
    student_id: str = Depends(require_student_id),
):
    """Return student learning facets derived from logs and exercise metadata."""
    from backend.services.derived_analytics import derive_learning_facets
    return derive_learning_facets(
        student_id,
        storage_subject_for_scope(subject),
        year_level=year_level,
        unit=unit,
        syllabus_subject=syllabus_subject,
    )


@router.get("/api/tutor/advanced-lesson")
def get_advanced_lesson(
    topic_id: str,
    subject: str = "math",
    year: str = "year7",
):
    """Return optional advanced lesson extensions for a curriculum topic (Feature E)."""
    import json
    from pathlib import Path
    
    # Map subject/year to filename, sanitizing inputs
    subject_clean = "".join(c for c in subject if c.isalnum() or c == "_").lower()
    if subject_clean == "math":
        subject_clean = "maths"
    year_clean = "".join(c for c in year if c.isalnum() or c == "_").lower()
    
    file_path = Path(__file__).resolve().parents[2] / "data" / "advanced_lesson_extensions" / f"ac9_{subject_clean}_{year_clean}.json"
    
    if not file_path.exists():
        return {}
        
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get(topic_id, {})
    except Exception as exc:
        # Fallback
        return {}


# ---------------------------------------------------------------------------
# English evidence-check endpoint (Audit Packet 2.2)
# ---------------------------------------------------------------------------


class EvidenceCheckRequest(BaseModel):
    """Request body for the reading evidence check endpoint."""
    exercise_id: str
    student_answer: str = Field(max_length=2000)


@router.post("/api/tutor/english/evidence-check")
def evidence_check(
    req: EvidenceCheckRequest,
    student_id: str = Depends(require_student_id),
):
    """Check whether a student's reading answer cites evidence from the passage.

    Returns an evidence-quality score and feedback without requiring an LLM call.
    This supports the ``text_evidence`` facet of Year 7 English.
    """
    from backend.content_authoring.stimulus_loader import resolve_passage

    engine = get_tutor_engine()
    exercise = engine.exercises.get(req.exercise_id)
    if not exercise:
        raise HTTPException(status_code=404, detail="Exercise not found")

    passage = resolve_passage(exercise)
    if not passage:
        return {
            "exercise_id": req.exercise_id,
            "has_passage": False,
            "evidence_score": None,
            "feedback": "No passage available for this exercise; evidence check skipped.",
            "matched_phrases": [],
        }

    # Tokenise passage into normalised word set (lower-case, strip punctuation)
    import re as _re
    passage_words = set(_re.findall(r"[a-z']+", passage.lower()))
    answer_words = _re.findall(r"[a-z']+", req.student_answer.lower())

    if not answer_words:
        return {
            "exercise_id": req.exercise_id,
            "has_passage": True,
            "evidence_score": 0,
            "feedback": "Your answer is empty. Try to include specific words or phrases from the passage.",
            "matched_phrases": [],
        }

    # Content words (exclude very short / stop words)
    _stop = {
        "the", "a", "an", "is", "it", "of", "in", "to", "and", "that", "was",
        "for", "on", "are", "with", "they", "be", "at", "this", "from", "or",
        "had", "not", "but", "by", "as", "do", "if", "so", "no", "can",
    }
    content_words = [w for w in answer_words if len(w) > 2 and w not in _stop]

    matched = [w for w in content_words if w in passage_words]
    match_ratio = len(matched) / max(len(content_words), 1)

    # Phrase-level match (bigrams/trigrams from answer found in passage)
    passage_lower = passage.lower()
    matched_phrases: list[str] = []
    for n in (3, 2):
        for i in range(len(answer_words) - n + 1):
            phrase = " ".join(answer_words[i : i + n])
            if len(phrase) > 6 and phrase in passage_lower and phrase not in matched_phrases:
                matched_phrases.append(phrase)

    # Score: 0-3 scale
    evidence_score = 0
    if match_ratio > 0.15 or matched_phrases:
        evidence_score = 1
    if match_ratio > 0.30 or len(matched_phrases) >= 2:
        evidence_score = 2
    if match_ratio > 0.45 and matched_phrases:
        evidence_score = 3

    feedback_map = {
        0: "Your answer doesn't reference specific details from the passage. Try quoting a word or phrase.",
        1: "Your answer includes some words from the passage. Try adding a direct quote to strengthen your evidence.",
        2: "Good use of passage evidence. You've referenced specific details.",
        3: "Excellent! Your answer is well-supported by specific passage evidence.",
    }

    return {
        "exercise_id": req.exercise_id,
        "has_passage": True,
        "evidence_score": evidence_score,
        "feedback": feedback_map[evidence_score],
        "matched_phrases": matched_phrases[:5],
        "word_match_ratio": round(match_ratio, 3),
    }
