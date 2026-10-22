from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from pathlib import Path
import hashlib
import json as _json
import uuid
from datetime import datetime, timezone

from backend.student_identity import require_student_id
from backend.exam_simulator import _deadline_iso, _safe_exam_question, get_exam_simulator
from backend.rules import get_engine as _get_rule_engine
from backend.services.analytics_scope import storage_subject_for_scope

router = APIRouter(prefix="/api/exam", tags=["exam"])


class ExamStartRequest(BaseModel):
    """Request body for POST /api/exam/start."""
    subject: str = "math"
    year_level: int | None = 7
    unit: int | None = None
    syllabus_subject: str | None = None
    num_questions: int = Field(default=20, ge=1, le=50)
    time_limit_minutes: int = Field(default=45, ge=5, le=180)
    exam_file: str | None = None  # optional: use a specific imported exam file
    sf_ratio: float = Field(default=0.6, ge=0.0, le=1.0)
    cf_ratio: float = Field(default=0.3, ge=0.0, le=1.0)
    cu_ratio: float = Field(default=0.1, ge=0.0, le=1.0)
    exam_type: str = "mixed"
    include_extended: bool = False


class ExamSubmitRequest(BaseModel):
    """Request body for POST /api/exam/submit."""
    subject: str = "math"
    exam_id: str
    responses: dict[str, str]  # question_id -> student_answer


class ExamSaveRequest(BaseModel):
    """Autosave body for POST /api/exam/save."""
    subject: str = "math"
    exam_id: str
    responses: dict[str, str] | None = None
    current_index: int | None = Field(default=None, ge=0, le=200)
    flagged: list[str] | None = None
    revision: int | None = Field(default=None, ge=0)


class ExamSessionRequest(BaseModel):
    """Body for POST /api/exam/resume and /api/exam/discard."""
    subject: str = "math"
    exam_id: str = Field(min_length=1, max_length=100)


_SESSION_ERROR_STATUS = {"exam_not_found": 404, "exam_already_submitted": 409}


def _validate_imported_questions(
    questions: list,
    *,
    subject: str,
    year_level: int | None,
) -> list[dict]:
    """Validate imported exam items with a safe schema (not full bank ExerciseItem).

    Imported papers are often leaner than curriculum-bank items, so we require
    only the fields needed for display + grading, then optionally filter by
    subject/year when those metadata are present.
    """
    valid: list[dict] = []
    storage = storage_subject_for_scope(subject)
    math_aliases = {"math", "mathematics"}
    for raw in questions:
        if not isinstance(raw, dict):
            continue
        qid = str(raw.get("id") or "").strip()
        question = str(raw.get("question") or "").strip()
        if not qid or not question:
            continue
        qtype = str(raw.get("question_type") or "short_answer")
        if qtype == "multiple_choice" and not raw.get("choices"):
            continue
        if qtype == "reasoning" and not (raw.get("rubric") or raw.get("sample_reasoning") or raw.get("answer")):
            continue
        if qtype == "multi_part":
            parts = raw.get("sub_parts") or []
            if not isinstance(parts, list) or not parts:
                continue
        elif raw.get("answer") is None and not raw.get("correct_choice"):
            continue

        item_subject = str(raw.get("subject") or "").lower()
        if item_subject:
            if storage in math_aliases and item_subject in math_aliases:
                pass
            elif item_subject not in {storage, subject.lower()}:
                continue
        if year_level is not None and raw.get("year_level") is not None:
            try:
                if int(raw["year_level"]) != int(year_level):
                    continue
            except (TypeError, ValueError):
                continue
        valid.append(dict(raw))
    return valid


def _imported_exam_fingerprint(exam_data: object) -> str:
    """Return a stable identity for the imported paper content."""
    canonical = _json.dumps(
        exam_data,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def _safe_imported_session_questions(session: dict) -> list[dict]:
    """Project a persisted imported session back to its answer-free paper."""
    imported_by_id = {
        str(question.get("id")): question
        for question in session.get("imported_questions", [])
        if isinstance(question, dict) and question.get("id")
    }
    return [
        _safe_exam_question(imported_by_id[question_id])
        for question_id in session.get("paper", [])
        if question_id in imported_by_id
    ]


def _imported_session_response(session: dict, *, title: str) -> dict:
    """Build the common response returned when an imported paper is resumed."""
    questions = _safe_imported_session_questions(session)
    return {
        "exam_id": session["exam_id"],
        "title": title,
        "time_limit_minutes": session.get("time_limit_minutes", 60),
        "total_questions": len(questions),
        "questions": questions,
        "responses": session.get("responses", {}),
        "current_index": session.get("current_index", 0),
        "flagged": session.get("flagged", []),
        "save_revision": session.get("save_revision", 0),
        "started_at": session["started_at"],
        "deadline_at": session.get("deadline_at") or _deadline_iso(
            session["started_at"], session.get("time_limit_minutes", 60)
        ),
        "resumed": True,
        "exam_type": session.get("exam_type", "mixed"),
    }


@router.post("/start")
def exam_start(
    req: ExamStartRequest,
    student_id: str = Depends(require_student_id),
):
    """Start a new timed mock exam. Returns the full paper (questions without answers)."""
    storage_subject = storage_subject_for_scope(req.subject)
    # If an imported exam file is specified, use it directly
    if req.exam_file:
        exams_dir = Path("data/exams").resolve()
        exam_path = (exams_dir / req.exam_file).resolve()
        if (
            not exam_path.exists()
            or exam_path.suffix != ".json"
            or not exam_path.is_relative_to(exams_dir)
        ):
            raise HTTPException(status_code=404, detail={"error": "exam_file_not_found"})
        exam_data = _json.loads(exam_path.read_text())
        time_limit = int(exam_data.get("time_limit_minutes", 60) or 60)
        time_limit = max(5, min(180, time_limit))
        raw_questions = exam_data.get("questions", [])
        questions = _validate_imported_questions(
            raw_questions if isinstance(raw_questions, list) else [],
            subject=req.subject,
            year_level=req.year_level,
        )
        if not questions:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "invalid_exam_file",
                    "message": "No valid questions found for this subject/year in the imported paper.",
                },
            )

        paper_fingerprint = _imported_exam_fingerprint(exam_data)
        title = exam_data.get("title", req.exam_file)
        engine = _get_rule_engine(student_id, storage_subject)
        with engine._lock:
            log = engine._read_log(topics=[])
            # Imported papers must resume the exact persisted paper. A missing
            # fingerprint is intentionally not treated as a match for legacy
            # sessions because filename/scope alone cannot prove identity.
            for session in reversed(log.get("exam_sessions", [])):
                if (
                    not session.get("completed_at")
                    and session.get("student_id") == student_id
                    and session.get("subject") == storage_subject
                    and session.get("year_level") == req.year_level
                    and session.get("unit") == req.unit
                    and session.get("syllabus_subject") == req.syllabus_subject
                    and session.get("imported_from") == req.exam_file
                    and session.get("imported_fingerprint") == paper_fingerprint
                ):
                    resumed_questions = _safe_imported_session_questions(session)
                    if resumed_questions:
                        return _imported_session_response(session, title=title)

            exam_id = str(uuid.uuid4())
            started_at = datetime.now(timezone.utc).isoformat()
            deadline_at = _deadline_iso(started_at, time_limit)
            session = {
                "exam_id": exam_id,
                "student_id": student_id,
                "subject": storage_subject,
                "year_level": req.year_level,
                "unit": req.unit,
                "syllabus_subject": req.syllabus_subject,
                "started_at": started_at,
                "deadline_at": deadline_at,
                "time_limit_minutes": time_limit,
                "completed_at": None,
                "paper": [q["id"] for q in questions],
                "responses": {},
                "current_index": 0,
                "flagged": [],
                "results": None,
                "imported_from": req.exam_file,
                "imported_fingerprint": paper_fingerprint,
                "imported_questions": questions,
                "exam_type": req.exam_type,
            }
            log.setdefault("exam_sessions", []).append(session)
            engine._write_log(log)

        # Imported questions live in their persisted exam session. Do not add
        # them to the shared authored bank: _exercise_for_session resolves the
        # session copy first, and keeping imports globally would grow memory and
        # expose them to unrelated generated-paper selection.
        safe_questions = [_safe_exam_question(q) for q in questions]
        return {
            "exam_id": exam_id,
            "title": title,
            "time_limit_minutes": time_limit,
            "total_questions": len(safe_questions),
            "questions": safe_questions,
            "started_at": started_at,
            "deadline_at": deadline_at,
            "save_revision": 0,
        }

    sim = get_exam_simulator()
    return sim.start(
        student_id=student_id,
        subject=storage_subject,
        year_level=req.year_level,
        unit=req.unit,
        syllabus_subject=req.syllabus_subject,
        num_questions=req.num_questions,
        time_limit_minutes=req.time_limit_minutes,
        sf_ratio=req.sf_ratio,
        cf_ratio=req.cf_ratio,
        cu_ratio=req.cu_ratio,
        exam_type=req.exam_type,
        include_extended=req.include_extended,
    )


@router.get("/list-papers")
def list_exam_papers():
    """List available imported exam papers from data/exams/."""
    exams_dir = Path("data/exams")
    papers = []
    if exams_dir.exists():
        for f in sorted(exams_dir.glob("*.json")):
            try:
                data = _json.loads(f.read_text())
                papers.append({
                    "filename": f.name,
                    "title": data.get("title", f.stem),
                    "time_limit_minutes": data.get("time_limit_minutes", 60),
                    "num_questions": len(data.get("questions", [])),
                })
            except Exception:
                continue
    return papers


@router.get("/active")
def exam_active(
    subject: str = "math",
    year_level: int | None = None,
    unit: int | None = None,
    syllabus_subject: str | None = None,
    student_id: str = Depends(require_student_id),
):
    """Return the newest unsubmitted exam in this scope, so it can be resumed or discarded."""
    sim = get_exam_simulator()
    return {
        "active": sim.get_active(
            student_id=student_id,
            subject=storage_subject_for_scope(subject),
            year_level=year_level,
            unit=unit,
            syllabus_subject=syllabus_subject,
        )
    }


@router.post("/resume")
def exam_resume(
    req: ExamSessionRequest,
    student_id: str = Depends(require_student_id),
):
    """Continue an unsubmitted exam with its stored paper, answers and deadline."""
    result = get_exam_simulator().resume(
        student_id=student_id,
        subject=storage_subject_for_scope(req.subject),
        exam_id=req.exam_id,
    )
    if result.get("error"):
        raise HTTPException(status_code=_SESSION_ERROR_STATUS.get(result["error"], 400), detail=result)
    return result


@router.post("/discard")
def exam_discard(
    req: ExamSessionRequest,
    student_id: str = Depends(require_student_id),
):
    """Delete an unsubmitted exam and its saved answers. Submitted exams stay."""
    result = get_exam_simulator().discard(
        student_id=student_id,
        subject=storage_subject_for_scope(req.subject),
        exam_id=req.exam_id,
    )
    if result.get("error"):
        raise HTTPException(status_code=_SESSION_ERROR_STATUS.get(result["error"], 400), detail=result)
    return result


@router.post("/save")
def exam_save(
    req: ExamSaveRequest,
    student_id: str = Depends(require_student_id),
):
    """Autosave in-progress exam answers, navigation index, and flags."""
    sim = get_exam_simulator()
    result = sim.save(
        student_id=student_id,
        subject=storage_subject_for_scope(req.subject),
        exam_id=req.exam_id,
        responses=req.responses,
        current_index=req.current_index,
        flagged=req.flagged,
        revision=req.revision,
    )
    if result.get("error"):
        status = 404 if result["error"] == "exam_not_found" else 400
        raise HTTPException(status_code=status, detail=result)
    return result


@router.post("/submit")
async def exam_submit(
    req: ExamSubmitRequest,
    student_id: str = Depends(require_student_id),
):
    """Submit all exam answers and receive the graded report."""
    from fastapi.concurrency import run_in_threadpool
    sim = get_exam_simulator()
    storage_subject = storage_subject_for_scope(req.subject)
    result = await run_in_threadpool(
        sim.submit,
        student_id=student_id,
        subject=storage_subject,
        exam_id=req.exam_id,
        responses=req.responses,
    )
    if result.get("error"):
        status = {
            "exam_not_found": 404,
            "exam_already_submitted": 409,
            "exam_evidence_sync_failed": 503,
            "exam_submission_persist_failed": 503,
        }.get(result["error"], 400)
        raise HTTPException(status_code=status, detail=result)
    return await run_in_threadpool(
        sim.with_question_views,
        student_id=student_id,
        subject=storage_subject,
        exam_id=req.exam_id,
        results=result,
    )


@router.get("/history")
def exam_history(
    subject: str = "math",
    year_level: int | None = None,
    unit: int | None = None,
    syllabus_subject: str | None = None,
    student_id: str = Depends(require_student_id),
):
    """Return summaries of past exam sessions."""
    sim = get_exam_simulator()
    return sim.get_history(
        student_id=student_id,
        subject=storage_subject_for_scope(subject),
        year_level=year_level,
        unit=unit,
        syllabus_subject=syllabus_subject,
    )
