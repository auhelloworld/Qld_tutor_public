"""Curriculum scope helpers for analytics endpoints.

The analytics pages often need to filter stored attempts by the active
subject/year or senior unit. This module keeps that curriculum-aware filtering
logic in one small place so route handlers can opt in without changing their
storage model.
"""

from __future__ import annotations

from backend.curriculum_frameworks import iter_frameworks
from backend.curriculum_loader import CurriculumLoader, get_shared_loader
from core.schema.curriculum_schema import SubjectTopic


JUNIOR_FRAMEWORKS: dict[str, str] = {
    "math": "AC9_MATHS",
    "english": "AC9_ENGLISH",
    "science": "AC9_SCIENCE",
}

SENIOR_FRAMEWORKS: dict[str, str] = {
    "senior_math": "QCAA_SENIOR_MATHS",
    "senior_english": "QCAA_SENIOR_ENGLISH",
    "senior_science": "QCAA_SENIOR_SCIENCE",
}

SENIOR_FAMILY_BY_BASE_SUBJECT: dict[str, str] = {
    "math": "senior_math",
    "mathematics": "senior_math",
    "english": "senior_english",
    "science": "senior_science",
}


def storage_subject_for_scope(subject: str | None) -> str:
    """Return the log/exercise-bank subject key for junior or senior UI subjects.

    Delegates to the central subject registry (``backend.subject_registry``)
    so the mapping for every course lives in one place.
    """
    from backend.subject_registry import storage_subject_for_scope as _resolve

    return _resolve(subject)


def _senior_framework_for_scope(subject: str, syllabus_subject: str | None) -> tuple[str | None, str | None]:
    """Resolve a senior curriculum framework from either senior_* or base+syllabus scope."""
    normalised_subject = subject.strip().lower()
    inferred_syllabus_subject = syllabus_subject.strip().lower() if syllabus_subject else None
    senior_framework = SENIOR_FRAMEWORKS.get(normalised_subject)

    candidate = None
    if normalised_subject.startswith("senior_"):
        candidate = normalised_subject.removeprefix("senior_")
    elif inferred_syllabus_subject:
        candidate = inferred_syllabus_subject
        family_subject = SENIOR_FAMILY_BY_BASE_SUBJECT.get(normalised_subject)
        if family_subject:
            senior_framework = SENIOR_FRAMEWORKS.get(family_subject)

    if candidate:
        for framework in iter_frameworks():
            if framework.jurisdiction != "QCAA-Senior":
                continue
            if senior_framework is not None and framework.framework_id != senior_framework:
                continue
            if candidate in framework.supported_subjects:
                return framework.framework_id, candidate

    return senior_framework, inferred_syllabus_subject


def valid_topic_ids_for_scope(
    subject: str,
    year_level: int | None = None,
    unit: int | None = None,
    syllabus_subject: str | None = None,
    loader: CurriculumLoader | None = None,
) -> set[str] | None:
    """Return valid topic IDs for an analytics scope.

    ``None`` means "do not filter" and is used when the caller has not provided
    enough scope information. An empty set means the scope was explicit but no
    curriculum slice exists yet.
    """

    topics = curriculum_topics_for_scope(
        subject,
        year_level=year_level,
        unit=unit,
        syllabus_subject=syllabus_subject,
        loader=loader,
    )
    if topics is None:
        return None
    return {topic.topic_id for topic in topics}


def curriculum_topics_for_scope(
    subject: str,
    year_level: int | None = None,
    unit: int | None = None,
    syllabus_subject: str | None = None,
    loader: CurriculumLoader | None = None,
) -> list[SubjectTopic] | None:
    """Return ordered curriculum topics for an explicit analytics scope."""

    normalised_subject = subject.strip().lower()
    loader = loader or get_shared_loader()

    # Senior UI subjects are stored in logs/exercise banks as base subjects
    # (english/math/science), but curriculum filtering must still use the
    # QCAA senior framework. Also support base subject + unit + syllabus_subject
    # because API clients normalise senior_* picker values before backend calls.
    senior_framework, inferred_syllabus_subject = _senior_framework_for_scope(
        normalised_subject,
        syllabus_subject,
    )
    if unit is not None or normalised_subject.startswith("senior_"):
        if senior_framework is None or inferred_syllabus_subject is None:
            return [] if unit is not None else None
        try:
            slice_obj = loader.load_slice(senior_framework, inferred_syllabus_subject)
        except FileNotFoundError:
            return []
        if unit is None:
            return list(slice_obj.topics)
        return [
            topic
            for topic in slice_obj.topics
            if getattr(topic, "unit", None) == unit
        ]

    junior_framework = JUNIOR_FRAMEWORKS.get(normalised_subject)
    if junior_framework is not None:
        if year_level is None:
            return None
        try:
            slice_obj = loader.load_slice(junior_framework, year_level)
        except FileNotFoundError:
            return []
        return list(slice_obj.topics)

    return None


def topic_in_scope(topic_id: str, valid_topic_ids: set[str] | None) -> bool:
    """Return whether ``topic_id`` passes a precomputed analytics scope."""

    return valid_topic_ids is None or topic_id in valid_topic_ids


__all__ = [
    "curriculum_topics_for_scope",
    "valid_topic_ids_for_scope",
    "topic_in_scope",
    "storage_subject_for_scope",
]
