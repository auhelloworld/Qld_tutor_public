"""Pydantic v2 models for the Misconception Library (Phase 8).

Design §3.1 — misconception-library spec.
"""
from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

ProvenanceSource = Literal["hand_curated", "ai_mined_human_approved"]
SignatureKind = Literal["regex", "numeric", "predicate"]

MISCONCEPTION_ID_RE = re.compile(r"^MC_[A-Z0-9]+_[a-z0-9_]+_\d{2}$")
WORKED_EXAMPLE_ID_RE = re.compile(r"^WE_[A-Z0-9]+_[a-z0-9_]+_\d{2}$")


class Provenance(BaseModel):
    """Provenance metadata for misconception and worked-example records."""

    model_config = ConfigDict(extra="forbid")

    source: ProvenanceSource
    approved_by: str
    approved_at: str  # ISO 8601 UTC
    mined_from_run_id: str | None = None


class DetectionSignature(BaseModel):
    """A deterministic detection signature for a misconception."""

    model_config = ConfigDict(extra="forbid")

    kind: SignatureKind
    pattern: str
    notes: str | None = None

    @field_validator("pattern")
    @classmethod
    def _validate_pattern_compiles(cls, v: str, info) -> str:
        """Compile regex patterns at validation time; raises if invalid."""
        kind = info.data.get("kind")
        if kind == "regex":
            try:
                re.compile(v, re.IGNORECASE)
            except re.error as e:
                raise ValueError(f"Invalid regex pattern: {e}") from e
        return v


class MisconceptionRecord(BaseModel):
    """A single misconception entry in the library."""

    model_config = ConfigDict(extra="forbid")

    misconception_id: str = Field(pattern=MISCONCEPTION_ID_RE.pattern)
    name: str = Field(min_length=1)
    description: str = Field(min_length=1)
    student_facing_explanation: str = Field(min_length=1)
    topic_ids: list[str] = Field(min_length=1)
    detection_signatures: list[DetectionSignature] = Field(default_factory=list)
    worked_example_ids: list[str] = Field(default_factory=list)
    provenance: Provenance


class WorkedExampleStep(BaseModel):
    """A single step in a worked example."""

    model_config = ConfigDict(extra="forbid")

    step_number: int = Field(ge=1)
    prose: str
    math_latex: str | None = None
    image_path: str | None = None


class WorkedExampleRecord(BaseModel):
    """A structured worked example attached to topics and misconceptions."""

    model_config = ConfigDict(extra="forbid")

    worked_example_id: str = Field(pattern=WORKED_EXAMPLE_ID_RE.pattern)
    name: str
    topic_ids: list[str] = Field(min_length=1)
    framework: str
    question: str
    final_answer: str
    steps: list[WorkedExampleStep] = Field(min_length=1)
    targets_misconception_ids: list[str] = Field(default_factory=list)
    provenance: Provenance
