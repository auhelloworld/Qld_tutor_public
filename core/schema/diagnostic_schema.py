"""Pydantic v2 schemas for diagnostic and spaced-repetition data.

Design §3.1 — diagnostic-and-spaced-repetition spec.
Req 2.3, 2.4, 3.1, 5.5, 7.4.
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class DiagnosticResponse(BaseModel):
    """A single response within a diagnostic run."""

    model_config = ConfigDict(extra="forbid")

    question_id: str
    topic_id: str
    is_correct: bool
    student_answer: str = Field(max_length=500)
    error_type: str | None = None
    timestamp: str


class DiagnosticReportRecord(BaseModel):
    """Persisted record of a full diagnostic run."""

    model_config = ConfigDict(extra="forbid")

    report_id: str
    subject: str
    year_level: int
    started_at: str
    completed_at: str | None = None
    pack: list[str]  # ordered list of question_ids
    cursor: int = 0
    responses: list[DiagnosticResponse] = Field(default_factory=list)
    derived_bkt: dict[str, float] = Field(default_factory=dict)


class DiagnosticStatusEntry(BaseModel):
    """Status of a diagnostic for a (subject, year_level) pair."""

    model_config = ConfigDict(extra="forbid")

    completed_at: str | None = None
    report_id: str | None = None
    diagnostic_dismissed_at: str | None = None
    first_interaction_at: str


class RevisionRecord(BaseModel):
    """Spaced-repetition schedule for a single topic."""

    model_config = ConfigDict(extra="forbid")

    next_review_at: str
    consecutive_revisions: int = 0
    first_mastered_at: str
