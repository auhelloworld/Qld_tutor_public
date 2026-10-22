from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from backend.answer_grading import answer_markdown, correct_answer_for_display
from backend.student_identity import (
    create_parent_token,
    ensure_parent_student_access,
    get_parent_password,
    require_parent,
    require_student_id,
)
from backend.rate_limiter import RATE_LIMIT_DEFAULTS, _RATE_LIMITER
from backend.rules import get_engine
from backend.routers.helpers import get_tutor_engine
from backend.services.analytics_scope import topic_in_scope, valid_topic_ids_for_scope, storage_subject_for_scope
from backend.services.attempt_outcomes import deduplicate_attempts, is_scored_learning_attempt

router = APIRouter(prefix="/api/parent", tags=["parent"])


class ParentLoginRequest(BaseModel):
    password: str = Field(..., min_length=1, max_length=256)


@router.post("/login")
def parent_login(
    req: ParentLoginRequest,
    request: Request,
    caller_id: str = Depends(require_student_id),
):
    """Validate the parent password server-side and mint a short-lived parent token.

    The password is checked against the server-only PARENT_PASSWORD env var and is
    never shipped to the client bundle. The returned token is bound to the
    active student and must be sent for every Parent Dashboard data/action route.
    """
    import hmac

    client_host = request.client.host if request.client else "unknown"
    # Key login throttling by client address, not student ID: student tokens
    # are intentionally easy to mint, so including only/basing on their UUID
    # would let a password attacker rotate identities to evade the limit.
    rate_key = f"parent-login:{client_host}"
    endpoint_key = "POST /api/parent/login"
    limit = RATE_LIMIT_DEFAULTS[endpoint_key]
    if not _RATE_LIMITER.admit(rate_key, endpoint_key, limit):
        retry = _RATE_LIMITER.retry_after_seconds(rate_key, endpoint_key)
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limited",
                "message": f"Too many login attempts. Retry after {retry}s.",
                "retry_after": retry,
            },
            headers={"Retry-After": str(retry)},
        )

    configured_password = get_parent_password()
    if configured_password is None:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "parent_password_not_configured",
                "message": "Parent access is disabled until PARENT_PASSWORD is configured.",
            },
        )
    if not hmac.compare_digest(req.password, configured_password):
        raise HTTPException(
            status_code=401,
            detail={"error": "invalid_parent_password", "message": "Incorrect parent password."},
        )
    return {"token": create_parent_token(caller_id)}


class ParentReviewRequest(BaseModel):
    student_id: str
    subject: str = "math"
    topic: str
    question_id: str
    student_answer: str
    correct: bool
    attempt_id: str | None = None
    exam_id: str | None = None
    part_label: str | None = None


@router.get("/review-queue")
def parent_review_queue(
    student_id: str,
    subject: str = "math",
    year_level: int | None = None,
    unit: int | None = None,
    syllabus_subject: str | None = None,
    caller_id: str = Depends(require_student_id),
    parent_student_id: str = Depends(require_parent),
):
    """List pending reviews for the parent-authorized active student and scope."""
    ensure_parent_student_access(caller_id, parent_student_id, student_id)
    engine = get_engine(student_id, storage_subject_for_scope(subject))
    pending = engine.get_pending_reviews()
    valid_topic_ids = valid_topic_ids_for_scope(
        subject,
        year_level=year_level,
        unit=unit,
        syllabus_subject=syllabus_subject,
    )
    if valid_topic_ids is not None:
        pending = [
            review for review in pending
            if topic_in_scope(str(review.get("topic") or ""), valid_topic_ids)
        ]
    exam_sessions = engine.get_exam_sessions()
    exercises = get_tutor_engine().exercises
    enriched = []
    for r in pending:
        qid = r["question_id"]
        exam_id = r.get("exam_id")
        ex = None
        if exam_id:
            matching_session = next(
                (
                    session
                    for session in exam_sessions
                    if session.get("exam_id") == exam_id
                ),
                None,
            )
            for q in (matching_session or {}).get("imported_questions", []):
                if q.get("id") == qid:
                    ex = q
                    break
        if ex is None:
            ex = exercises.get(qid)
        if not ex:
            # Fallback: search in imported_questions in exam_sessions
            for session in exam_sessions:
                for q in session.get("imported_questions", []):
                    if q.get("id") == qid:
                        ex = q
                        break
                if ex:
                    break
        if not ex:
            ex = {}
        part_label = str(r.get("part_label") or "").strip().lower()
        matching_part = next(
            (
                part for part in (ex.get("sub_parts") or [])
                if str(part.get("label") or "").strip().lower() == part_label
            ),
            None,
        )
        from backend.services.question_context import authorised_review_view
        review_view = authorised_review_view(ex)
        enriched.append({
            **review_view,
            **r,
            "question": (
                f"{ex.get('question', '')}\nPart {str(matching_part.get('label')).upper()}: {matching_part.get('question', '')}"
                if matching_part
                else ex.get("question", "")
            ),
            "correct_answer": (
                answer_markdown(matching_part.get("answer", ""))
                if matching_part
                else correct_answer_for_display(ex)
            ),
        })
    return {"pending": enriched}


@router.post("/review")
def parent_review_submit(
    req: ParentReviewRequest,
    caller_id: str = Depends(require_student_id),
    parent_student_id: str = Depends(require_parent),
):
    """Approve or reject a pending review (requires parent authorization)."""
    ensure_parent_student_access(caller_id, parent_student_id, req.student_id)
    subject = storage_subject_for_scope(req.subject)
    engine = get_engine(req.student_id, subject)
    from backend.exam_simulator import get_exam_simulator

    simulator = get_exam_simulator()
    effective_exam_id = req.exam_id
    if not effective_exam_id and req.attempt_id:
        # Older clients may omit exam_id even though the queued attempt already
        # carries it. Recover the exact value before deciding persistence order.
        matching_exam_ids = {
            str(item.get("exam_id"))
            for item in engine.get_pending_reviews()
            if item.get("exam_id")
            and str(item.get("attempt_id") or "") == str(req.attempt_id)
            and str(item.get("question_id") or "") == str(req.question_id)
        }
        if len(matching_exam_ids) == 1:
            effective_exam_id = matching_exam_ids.pop()

    review_kwargs = {
        "topic": req.topic,
        "question_id": req.question_id,
        "student_answer": req.student_answer,
        "correct": req.correct,
        "attempt_id": req.attempt_id,
        "part_label": req.part_label,
        "exam_id": effective_exam_id,
    }

    # Reconciliation is always attempted first. For ordinary tutor reviews it
    # is a read-only no-op. For legacy exam rows, a durable reconciliation marker
    # makes the same decision replayable if attempt persistence then fails.
    with engine._lock:
        exam_reconciled = simulator.reconcile_parent_review(
            student_id=req.student_id,
            subject=subject,
            exam_id=effective_exam_id,
            question_id=req.question_id,
            attempt_id=req.attempt_id,
            correct=req.correct,
            part_label=req.part_label,
            student_answer=req.student_answer,
        )
        if exam_reconciled:
            ok = engine.review_attempt(
                **review_kwargs,
                allow_idempotent=True,
            )
        else:
            pending_exam_candidate = simulator.has_pending_parent_review_candidate(
                student_id=req.student_id,
                subject=subject,
                exam_id=effective_exam_id,
                question_id=req.question_id,
                attempt_id=req.attempt_id,
                part_label=req.part_label,
                student_answer=req.student_answer,
            )
            if effective_exam_id or pending_exam_candidate:
                return {
                    "ok": False,
                    "exam_reconciled": False,
                    "message": (
                        "Exam review could not be reconciled; no review decision "
                        "was consumed."
                    ),
                }
            exam_reconciled = None
            ok = engine.review_attempt(**review_kwargs)

    return {
        "ok": ok,
        "exam_reconciled": exam_reconciled,
        "message": "Review saved." if ok else "Review not found (already processed).",
    }


@router.get("/pu-mode")
def get_pu_mode_status(
    caller_id: str = Depends(require_student_id),
    parent_student_id: str = Depends(require_parent),
):
    from backend.tutor_engine import get_pu_mode
    ensure_parent_student_access(caller_id, parent_student_id)
    return {"pu_mode": get_pu_mode(caller_id)}


@router.post("/pu-mode")
def set_pu_mode_status(
    req: dict,
    caller_id: str = Depends(require_student_id),
    parent_student_id: str = Depends(require_parent),
):
    from backend.tutor_engine import set_pu_mode
    enabled = bool(req.get("enabled", False))
    ensure_parent_student_access(caller_id, parent_student_id)
    # Persist per active student so the setting follows them across profile switches.
    set_pu_mode(enabled, student_id=caller_id)
    return {"pu_mode": enabled}


# English facets need repeated direct evidence before a facet can be described as
# the student's strongest area. A single response remains an early signal only.
_MIN_RELIABLE_ENGLISH_FACET_ATTEMPTS = 2

_ENGLISH_ERROR_FACET_MAP = {
    "spelling_mechanics": "spelling_punctuation",
    "punctuation_mechanics": "spelling_punctuation",
    "grammar_syntax": "language_conventions",
    "grammar_convention": "language_conventions",
    "punctuation": "spelling_punctuation",
    "spelling": "spelling_punctuation",
    "vocabulary_register": "vocabulary",
    "vocabulary_precision": "vocabulary",
    "literal_comprehension": "reading_comprehension",
    "inferential_comprehension": "reading_comprehension",
    "inference_error": "reading_comprehension",
    "textual_analysis": "text_evidence",
    "weak_text_evidence": "text_evidence",
    "writing_composition": "writing_structure",
}


def _parent_writing_history_entry(entry: dict) -> dict:
    """Project one writing record without returning the student's draft or source."""
    criterion_scores = []
    for criterion in entry.get("criterion_scores") or []:
        if not isinstance(criterion, dict):
            continue
        criterion_scores.append({
            key: criterion.get(key)
            for key in ("criterion_number", "name", "score", "max_score")
            if key in criterion
        })
    return {
        "timestamp": entry.get("timestamp", ""),
        "year_level": entry.get("year_level"),
        "prompt_type": entry.get("prompt_type", ""),
        "topic_title": entry.get("topic_title"),
        "word_count": entry.get("word_count", 0),
        "total_score": entry.get("total_score", 0),
        "max_total_score": entry.get("max_total_score", 0),
        "estimated_band": entry.get("estimated_band"),
        "time_taken_seconds": entry.get("time_taken_seconds"),
        "has_source_text": bool(entry.get("has_source_text")),
        "has_writer_statement": bool(entry.get("has_writer_statement")),
        "criterion_scores": criterion_scores,
        "revision_of": entry.get("revision_of"),
        "llm_status": entry.get("llm_status"),
        "insufficient_evidence": bool(entry.get("insufficient_evidence")),
        "is_senior": bool(entry.get("year_level", 0) and int(entry.get("year_level", 0)) >= 11),
    }


# Parent English weekly summary (Audit Packet 2.3)
# ---------------------------------------------------------------------------


@router.get("/writing-history")
def parent_writing_history(
    year_level: int | None = None,
    unit: int | None = None,
    syllabus_subject: str | None = None,
    caller_id: str = Depends(require_student_id),
    parent_student_id: str = Depends(require_parent),
):
    """Return parent-safe Writing Hub history for the active student scope."""
    ensure_parent_student_access(caller_id, parent_student_id)
    from backend.routers.writing import read_writing_history

    history = read_writing_history(caller_id)
    scoped_entries = []
    for entry in history.get("assessments", []):
        try:
            entry_year = int(entry.get("year_level"))
        except (TypeError, ValueError):
            continue
        if year_level is not None and entry_year != year_level:
            continue
        # Writing history stores school year rather than QCAA unit. A unit
        # scope therefore selects senior writing without pretending that the
        # log can distinguish courses it did not persist.
        if unit is not None and year_level is None and entry_year < 11:
            continue
        scoped_entries.append(_parent_writing_history_entry(entry))

    return {
        "student_id": caller_id,
        "assessments": scoped_entries,
        "total_assessments": len(scoped_entries),
        "truncated": bool(history.get("truncated")),
        "scope": {
            "year_level": year_level,
            "unit": unit,
            "syllabus_subject": syllabus_subject,
        },
    }


@router.get("/english-summary")
def parent_english_summary(
    student_id: str,
    year_level: int | None = None,
    unit: int | None = None,
    syllabus_subject: str | None = None,
    caller_id: str = Depends(require_student_id),
    parent_student_id: str = Depends(require_parent),
):
    """Generate a parent-friendly English weekly summary.

    Aggregates the last 7 days of English practice, writing history,
    and error classifications. Returns one concrete next action for parents.
    """
    ensure_parent_student_access(caller_id, parent_student_id, student_id)

    import os
    import json as _json
    from datetime import datetime, timedelta, timezone
    from collections import Counter

    tutor = get_tutor_engine()
    valid_topic_ids = valid_topic_ids_for_scope("english", year_level, unit, syllabus_subject)

    # Load English practice attempts
    try:
        engine = get_engine(student_id, "english")
        log_data = engine.load_log(topics=valid_topic_ids)
    except Exception as exc:
        return {
            "student_id": student_id,
            "summary_available": False,
            "reason": f"Unable to load English practice data: {exc}",
        }

    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    # Resolve project root once (used by writing-history and taxonomy loads below).
    import backend.tutor_engine as _te
    project_root_path = __import__("pathlib").Path(_te.__file__).resolve().parent.parent
    recent_attempts = []
    errors_by_code: Counter = Counter()
    facet_counts: Counter = Counter()
    facet_correct: Counter = Counter()
    facets_touched: set[str] = set()
    topics_touched: set[str] = set()

    scoped_attempts = deduplicate_attempts(
        attempt
        for topic_id, topic_data in log_data.get("topics", {}).items()
        if topic_in_scope(topic_id, valid_topic_ids)
        for attempt in topic_data.get("attempts", [])
    )
    for attempt in scoped_attempts:
        if attempt.get("attempt_type") != "answer" or not is_scored_learning_attempt(attempt):
            continue
        timestamp = attempt.get("timestamp", "")
        if not timestamp:
            continue
        try:
            attempted_at = datetime.fromisoformat(timestamp)
            if attempted_at.tzinfo is None:
                attempted_at = attempted_at.replace(tzinfo=timezone.utc)
            if attempted_at < cutoff:
                continue
        except (ValueError, TypeError):
            continue

        question_id = attempt.get("question_id", "")
        exercise = tutor.exercises.get(question_id, {})
        facet = (exercise.get("english_metadata") or {}).get("facet")
        if facet:
            facets_touched.add(facet)
            facet_counts[facet] += 1
            if attempt.get("correct"):
                facet_correct[facet] += 1
        for exercise_topic_id in exercise.get("topic_ids", []):
            topics_touched.add(exercise_topic_id)

        recent_attempts.append(attempt)
        if not attempt.get("correct"):
            gap = attempt.get("gap_classification") or {}
            code = gap.get("primary_error_code")
            if code:
                errors_by_code[code] += 1

    # Load writing history for the last 7 days through the shared reader.
    writing_entries = []
    try:
        from backend.routers.writing import read_writing_history

        history = read_writing_history(student_id)
        for assessment in history.get("assessments", []):
            try:
                if year_level is not None and int(assessment.get("year_level")) != year_level:
                    continue
                t = datetime.fromisoformat(assessment.get("timestamp", ""))
                if t.tzinfo is None:
                    t = t.replace(tzinfo=timezone.utc)
                if t >= cutoff:
                    writing_entries.append(assessment)
            except (ValueError, TypeError):
                pass
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning("Failed to load writing history: %s", exc)

    # Build summary
    total_attempts = len(recent_attempts)
    correct_count = sum(1 for a in recent_attempts if a.get("correct"))
    accuracy = round(correct_count / max(total_attempts, 1) * 100)

    most_practised_facet = facet_counts.most_common(1)[0][0] if facet_counts else None
    reliable_facets = {
        facet: count
        for facet, count in facet_counts.items()
        if count >= _MIN_RELIABLE_ENGLISH_FACET_ATTEMPTS
    }
    strongest_facet = max(
        reliable_facets,
        key=lambda facet: (
            facet_correct[facet] / facet_counts[facet],
            facet_counts[facet],
        ),
        default=None,
    )
    strongest_facet_accuracy = (
        round(facet_correct[strongest_facet] / facet_counts[strongest_facet] * 100)
        if strongest_facet else None
    )

    facet_labels = {
        "reading_comprehension": "Reading Comprehension",
        "text_evidence": "Using Evidence",
        "language_conventions": "Grammar and Language",
        "vocabulary": "Vocabulary",
        "writing_structure": "Writing Structure",
        "spelling_punctuation": "Spelling and Punctuation",
    }

    # Determine the target gap from specific error evidence first. If there is
    # no attributable error, use the weakest repeated facet; otherwise do not
    # manufacture a gap from a single unproven facet.
    top_error = errors_by_code.most_common(1)
    target_skill = None
    target_action = None
    target_gap_facet = None
    if top_error:
        error_code = top_error[0][0]
        taxonomy_path = project_root_path / "data" / "error_taxonomy_english.json"
        try:
            taxonomy = _json.loads(taxonomy_path.read_text(encoding="utf-8"))
            for entry in taxonomy.get("error_types", []):
                if entry.get("code") == error_code:
                    actions = entry.get("recommended_actions", [])
                    target_skill = entry.get("label", error_code)
                    target_action = actions[0] if actions else "Practise related skills."
                    break
        except Exception:
            target_skill = error_code.replace("_", " ").title()
            target_action = "Review the concept card and try related practice questions."
        mapped_facet = _ENGLISH_ERROR_FACET_MAP.get(error_code)
        if mapped_facet and facet_counts.get(mapped_facet, 0):
            target_gap_facet = mapped_facet

    if target_gap_facet is None and reliable_facets:
        target_gap_facet = min(
            reliable_facets,
            key=lambda facet: (
                facet_correct[facet] / facet_counts[facet],
                -facet_counts[facet],
            ),
        )

    # Example response: most recent correct answer text
    example_response = None
    for att in reversed(recent_attempts):
        if att.get("correct") and att.get("student_answer"):
            answer_text = att.get("student_answer", "")
            if len(answer_text) > 20:
                example_response = answer_text[:200]
                break

    # Parent discussion prompt and home activity follow the target gap, never
    # the strongest area. A neutral label is explicit when evidence is thin.
    discussion_prompts = {
        "reading_comprehension": "Ask your child to summarise what they read today in one sentence.",
        "text_evidence": "Ask your child to point to one specific word or phrase that supports their answer.",
        "language_conventions": "Ask your child to explain why they used a particular punctuation mark or grammar rule.",
        "vocabulary": "Ask your child to teach you one new word they learned and use it in a sentence.",
        "writing_structure": "Ask your child to explain their paragraph structure — where is the main point?",
        "spelling_punctuation": "Ask your child to spell five words they found tricky this week.",
    }
    general_discussion = (
        "General enrichment (no reliable target gap yet): ask your child to show you one English question "
        "and explain one piece of evidence for their answer."
    )
    discussion_prompt = discussion_prompts.get(target_gap_facet, general_discussion)

    # 5-minute home activity
    activities = {
        "reading_comprehension": "Read a short paragraph together and take turns summarising it in your own words.",
        "text_evidence": "Pick a sentence from a book and ask your child to find one word that carries the most meaning.",
        "language_conventions": "Write three sentences together — make one with a comma splice, and have your child fix it.",
        "vocabulary": "Play 'Word of the Day': each person picks a new word and uses it in three sentences.",
        "writing_structure": "Write a mini paragraph together about your child's favourite topic — topic sentence, evidence, explanation, link.",
        "spelling_punctuation": "Dictate five words to your child and check the spelling together.",
    }
    general_activity = (
        "General enrichment (no reliable target gap yet): read a short paragraph together and take turns "
        "summarising it in your own words."
    )
    home_activity = activities.get(target_gap_facet, general_activity)

    return {
        "student_id": student_id,
        "summary_available": True,
        "period_days": 7,
        "total_attempts": total_attempts,
        "correct_count": correct_count,
        "accuracy": accuracy,
        "writing_submissions": len(writing_entries),
        "strongest_facet": strongest_facet,
        "strongest_facet_label": facet_labels.get(strongest_facet) if strongest_facet else None,
        "strongest_facet_accuracy": strongest_facet_accuracy,
        "most_practised_facet": most_practised_facet,
        "most_practised_facet_label": facet_labels.get(most_practised_facet or "", "English Practice"),
        "facets_practised": sorted(facets_touched),
        "target_skill": target_skill or "Practice consistency",
        "target_action": target_action or "Keep practising regularly — consistency is the strongest predictor of improvement.",
        "target_gap_facet": target_gap_facet,
        "target_gap_facet_label": facet_labels.get(target_gap_facet or "", "General enrichment"),
        "target_gap_evidence_count": facet_counts.get(target_gap_facet, 0) if target_gap_facet else 0,
        "example_response": example_response,
        "discussion_prompt": discussion_prompt,
        "home_activity": home_activity,
        "recent_error_pattern": top_error[0][0] if top_error else None,
        "error_count": top_error[0][1] if top_error else 0,
    }
