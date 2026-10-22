"""Legacy ingestion schema — transitional shim.

.. deprecated::
    The canonical curriculum schema now lives in
    :mod:`core.schema.curriculum_schema`, and the canonical multi-framework
    ``ExerciseItem`` now lives in :mod:`core.schema.exercise_schema`. This
    module is retained for backward compatibility with the in-flight
    ingestion pipeline at ``backend/ingestion_v2.py``, which still emits the
    legacy four-field exercise shape.

The ``ExerciseItem`` defined here is intentionally the *old* shape:

    {id (optional), topic, question, answer, steps}

It does NOT carry the new ``framework`` / ``topic_ids`` / ``subject`` /
``difficulty`` / ``year_level`` / ``unit`` fields. Code that needs the
multi-framework shape should import from
``core.schema.exercise_schema.ExerciseItem`` instead.

A ``DeprecationWarning`` is emitted at import time to nudge callers to
migrate. The warning is emitted exactly once per process (via the standard
``warnings`` filter) so it does not spam logs in long-running services.
"""

from __future__ import annotations

import warnings

from pydantic import BaseModel, Field
from typing import List

warnings.warn(
    "core.schema.ingestion_schema is deprecated. The canonical curriculum "
    "schema lives in core.schema.curriculum_schema and the canonical "
    "multi-framework ExerciseItem lives in core.schema.exercise_schema. "
    "This module is retained as a transitional shim for the existing "
    "ingestion pipeline (backend/ingestion_v2.py).",
    DeprecationWarning,
    stacklevel=2,
)


# --- Syllabus Schemas ---

class HintLevel(BaseModel):
    level: str = Field(description="The type of hint: 'concept_reminder', 'step_prompt', or 'analogy'.")
    template: str = Field(description="The hint template text for this level.")


class ConceptCard(BaseModel):
    core_rule: str = Field(description="The fundamental rule or principle of this concept.")
    hint_levels: List[HintLevel] = Field(default_factory=list, description="List of structured hint strategies.")


class CurriculumTopic(BaseModel):
    topic: str = Field(description="A snake_case identifier for the topic (e.g., 'fractions', 'linear_equations').")
    skills: List[str] = Field(description="List of skills covered under this topic.")
    concept_card: ConceptCard = Field(description="The core rules and hint strategies for this topic.")
    source_ref: str = Field(default="", description="Verbatim extraction from the raw text for traceability.")


class CurriculumData(BaseModel):
    topics: List[CurriculumTopic] = Field(description="List of extracted curriculum topics.")


# --- Exercise Schemas ---
#
# NOTE: This ``ExerciseItem`` is the LEGACY four-field shape. The canonical
# multi-framework ``ExerciseItem`` (with framework / topic_ids / subject /
# difficulty / year_level / unit) lives in
# ``core.schema.exercise_schema``. New code MUST import from there.

class ExerciseItem(BaseModel):
    """Legacy exercise shape used by ``backend/ingestion_v2.py``.

    .. deprecated::
        Import :class:`core.schema.exercise_schema.ExerciseItem` instead.
    """

    topic: str = Field(description="The snake_case topic this exercise belongs to (e.g., 'fractions').")
    question: str = Field(description="The exact text or LaTeX of the question.")
    answer: str = Field(description="The final expected answer.")
    steps: List[str] = Field(default_factory=list, description="Step-by-step breakdown to solve the question.")


class ExerciseData(BaseModel):
    exercises: List[ExerciseItem] = Field(description="List of extracted exercises from the raw text.")
