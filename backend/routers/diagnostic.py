from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from backend.diagnostic_engine import (
    DIAGNOSTIC_COOLDOWN_DAYS,
    DiagnosticAlreadyFinalised,
    DiagnosticRequestConflict,
    DiagnosticTooRecent,
    get_diagnostic_engine,
)
from backend.routers.helpers import rate_limit_dependency
from backend.services.request_replay import (
    RequestReplayConflict,
    async_replay_lock,
    replay_lookup,
    replay_store,
    request_fingerprint,
)

router = APIRouter(prefix="/api/diagnostic", tags=["diagnostic"])
DiagnosticSubject = Literal["math", "english", "science"]


class DiagnosticStartRequest(BaseModel):
    """Request body for POST /api/diagnostic/start."""

    model_config = {"extra": "forbid"}
    subject: DiagnosticSubject
    year_level: int = Field(ge=7, le=10)
    # Retest one report area of a completed diagnostic (no cooldown).
    area: str | None = Field(default=None, min_length=1, max_length=64)


class DiagnosticRespondRequest(BaseModel):
    """Request body for POST /api/diagnostic/respond."""

    model_config = {"extra": "forbid"}
    request_id: str | None = Field(default=None, min_length=8, max_length=64, pattern=r"^[A-Za-z0-9._:-]+$")
    report_id: str
    question_id: str
    student_answer: str = Field(default="", max_length=5000)
    not_learned: bool = False
    confidence: Literal["guess", "maybe", "sure"] | None = None


class DiagnosticDismissRequest(BaseModel):
    """Request body for POST /api/diagnostic/dismiss."""

    model_config = {"extra": "forbid"}
    subject: DiagnosticSubject
    year_level: int = Field(ge=7, le=10)


@router.post("/start")
def diagnostic_start(
    req: DiagnosticStartRequest,
    student_id: str = Depends(rate_limit_dependency("POST", "/api/diagnostic/start")),
):
    """Start a new diagnostic run."""
    try:
        return get_diagnostic_engine().start(
            student_id=student_id,
            subject=req.subject,
            year_level=req.year_level,
            area=req.area,
        )
    except DiagnosticTooRecent:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "diagnostic_too_recent",
                "message": f"A diagnostic was completed within the last {DIAGNOSTIC_COOLDOWN_DAYS} days. Please wait before retaking.",
                "endpoint": "/api/diagnostic/start",
            },
        )


@router.post("/respond")
async def diagnostic_respond(
    req: DiagnosticRespondRequest,
    student_id: str = Depends(rate_limit_dependency("POST", "/api/diagnostic/respond")),
):
    """Submit a response to the current diagnostic question."""
    from fastapi.concurrency import run_in_threadpool
    fingerprint = request_fingerprint(req, exclude={"request_id"}) if req.request_id else ""

    async def perform_response() -> dict:
        return await run_in_threadpool(
            get_diagnostic_engine().respond,
            student_id=student_id,
            report_id=req.report_id,
            question_id=req.question_id,
            student_answer=req.student_answer,
            request_id=req.request_id,
            request_fingerprint=fingerprint,
            not_learned=req.not_learned,
            confidence=req.confidence,
        )

    try:
        if not req.request_id:
            return await perform_response()
        async with async_replay_lock(student_id, "diagnostic_respond", req.request_id):
            cached = replay_lookup(student_id, "diagnostic_respond", req.request_id, fingerprint)
            if cached is not None:
                return cached
            response = await perform_response()
            replay_store(student_id, "diagnostic_respond", req.request_id, fingerprint, response)
            return response
    except (RequestReplayConflict, DiagnosticRequestConflict) as exc:
        raise HTTPException(
            status_code=409,
            detail={"error": "request_id_conflict", "message": str(exc)},
        )
    except DiagnosticAlreadyFinalised:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "diagnostic_already_finalised",
                "message": "This diagnostic has already been completed.",
                "endpoint": "/api/diagnostic/respond",
            },
        )


@router.get("/status")
def diagnostic_status(
    subject: DiagnosticSubject,
    year_level: int = Query(ge=7, le=10),
    student_id: str = Depends(rate_limit_dependency("GET", "/api/diagnostic/status")),
):
    """Get the diagnostic status for a supported subject/year pair."""
    return get_diagnostic_engine().status(
        student_id=student_id,
        subject=subject,
        year_level=year_level,
    )


@router.post("/dismiss")
def diagnostic_dismiss(
    req: DiagnosticDismissRequest,
    student_id: str = Depends(rate_limit_dependency("POST", "/api/diagnostic/dismiss")),
):
    """Dismiss the diagnostic prompt for a supported subject/year pair."""
    return get_diagnostic_engine().dismiss(
        student_id=student_id,
        subject=req.subject,
        year_level=req.year_level,
    )
