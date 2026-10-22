import logging
from fastapi import APIRouter, HTTPException, Query, Request, Response

from backend.curriculum_loader import get_shared_loader
from backend.curriculum_frameworks import get_framework_for_topic_id
from backend.misconception_library import get_library
from backend.routers.helpers import get_tutor_engine
from backend.services.analytics_scope import storage_subject_for_scope

logger = logging.getLogger(__name__)
router = APIRouter(tags=["curriculum"])

_curriculum_loader = get_shared_loader()
_CURRICULUM_CACHE_CONTROL = "private, max-age=0, must-revalidate"


@router.get("/api/curriculum")
def get_curriculum(
    request: Request,
    subject: str | None = Query(default=None, max_length=64),
    scope: str | None = Query(default=None, max_length=32),
):
    """Return the full curriculum or one subject/year-or-unit scope."""
    if (subject is None) != (scope is None):
        raise HTTPException(
            status_code=400,
            detail={
                "error": "curriculum_scope_incomplete",
                "message": "Both subject and scope are required for scoped curriculum.",
            },
        )
    try:
        if subject is not None and scope is not None:
            body, etag = _curriculum_loader.scoped_view_payload(subject, scope)
        else:
            body, etag = _curriculum_loader.unified_view_payload()
        headers = {
            "Cache-Control": _CURRICULUM_CACHE_CONTROL,
            "ETag": etag,
        }
        if request.headers.get("if-none-match") == etag:
            return Response(status_code=304, headers=headers)
        return Response(
            content=body,
            media_type="application/json",
            headers=headers,
        )
    except KeyError:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "curriculum_scope_not_found",
                "message": f"No curriculum is available for {subject}/{scope}.",
            },
        )
    except (ValueError, OSError) as exc:
        logger.error("Failed to load curriculum view: %s", exc)
        raise HTTPException(
            status_code=500,
            detail={
                "error": "curriculum_load_failed",
                "message": "Failed to load curriculum data. A slice file may be corrupted.",
                "endpoint": "/api/curriculum",
            },
        )


@router.get("/api/exercises")
def get_exercises(
    topic: str | None = None,
    subject: str | None = None,
    year_level: int | None = None,
    unit: int | None = None,
    syllabus_subject: str | None = None,
):
    """Return the exercise pool for one ``topic``, optionally narrowed by
    ``subject``, ``year_level``, ``unit``, and ``syllabus_subject``.

    Exercises are sorted easy → hard:
    foundational → developing → extending, then by complexity
    (simple_familiar → complex_familiar → complex_unfamiliar).

    ``topic`` is required: an unfiltered response would serialise the whole
    authored bank. Items do not carry the topic concept card; single-question
    endpoints (for example ``/api/tutor/suggest``) still attach it.

    Uses the in-memory TutorEngine.exercises cache — no disk I/O.
    """
    if not topic:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "exercise_topic_required",
                "message": "A topic is required to list exercises.",
            },
        )
    engine = get_tutor_engine()
    canonical_topic = get_framework_for_topic_id(topic) is not None

    # Canonical topic requests are the normal practice path. Start from the
    # pre-built topic index instead of scanning all authored exercises.
    filtered = (
        list(engine.exercises_for_topic(topic))
        if canonical_topic
        else list(engine.exercises.values())
    )
    if subject:
        storage_subject = storage_subject_for_scope(subject)
        filtered = [ex for ex in filtered if ex.get("subject") == storage_subject]
    if year_level is not None:
        filtered = [ex for ex in filtered if ex.get("year_level") == year_level]
    if unit is not None:
        filtered = [ex for ex in filtered if ex.get("unit") == unit]
    if syllabus_subject:
        target_syllabus = syllabus_subject.strip().lower()
        filtered = [
            ex for ex in filtered
            if str(ex.get("syllabus_subject") or ex.get("course") or ex.get("subject") or "").strip().lower() == target_syllabus
        ]

    from backend.services.question_context import student_question_view

    if canonical_topic:
        result = filtered
    else:
        # Backward-compatible human-readable topic mode.
        result = [ex for ex in filtered if ex.get("topic") == topic]

    all_exercises = [student_question_view(ex) for ex in result]

    _diff_order = {"foundational": 0, "developing": 1, "extending": 2, "AMC": 3}
    _comp_order = {"simple_familiar": 0, "complex_familiar": 1, "complex_unfamiliar": 2}

    def _sort_key(ex):
        return (
            _diff_order.get(ex.get("difficulty", "developing"), 1),
            _comp_order.get(ex.get("complexity", "simple_familiar"), 0),
        )

    all_exercises.sort(key=_sort_key)
    return all_exercises


@router.get("/api/content/availability")
def content_availability():
    """Return cached authored exercise counts by subject/year and subject/unit."""
    engine = get_tutor_engine()
    return engine.content_availability()


@router.get("/api/misconceptions/list")
def list_misconceptions(subject: str | None = None, topic_id: str | None = None):
    """Return misconception records, optionally filtered by subject or topic_id."""
    lib = get_library()

    if topic_id:
        return [r.model_dump() for r in lib.by_topic_id.get(topic_id, [])]

    if subject:
        return lib.list_for_subject(subject)

    return [rec.model_dump() for rec in lib.misconceptions.values()]


@router.get("/api/worked_examples/list")
def list_worked_examples(subject: str | None = None, topic_id: str | None = None):
    """Return worked-example records, optionally filtered by subject or topic_id."""
    lib = get_library()

    if topic_id:
        return [r.model_dump() for r in lib.we_by_topic_id.get(topic_id, [])]

    if subject:
        return lib.list_worked_examples_for_subject(subject)

    return [rec.model_dump() for rec in lib.worked_examples.values()]
