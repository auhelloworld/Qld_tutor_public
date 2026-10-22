"""Typed Pydantic v2 models for the per-question dialogue system.

Design §3.1 — tutoring-dialogue spec.
"""
from __future__ import annotations

from typing import Literal

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# --- Type literals (Task 1.1) ---

DialogueRole = Literal["student", "tutor", "system"]

SuggestedAction = Literal[
    "show_worked_example",
    "give_next_step",
    "try_again",
    "explain_my_answer",
    "mark_final_answer",
    "change_topic",
]


# --- Request / Response models (Tasks 1.2, 1.3) ---


class DialogueRequest(BaseModel):
    """Incoming request body for POST /api/tutor/dialogue."""

    model_config = ConfigDict(extra="forbid")

    request_id: str | None = Field(default=None, min_length=8, max_length=64, pattern=r"^[A-Za-z0-9._:-]+$")
    question_id: str = Field(min_length=1, max_length=200)
    student_message: str = Field(min_length=1, max_length=1000)


class DialogueResponse(BaseModel):
    """Outgoing response body for POST /api/tutor/dialogue."""

    model_config = ConfigDict(extra="forbid")

    tutor_message: str
    suggested_actions: list[SuggestedAction] = Field(default_factory=list, max_length=4)
    dialogue_session_id: str
    redaction_applied: bool = False


# --- Internal LLM result models (Tasks 1.4, 1.5) ---


from core.schema.tutor_schema import MinedMisconception


def _coerce_llm_bool(v: Any, *, default: bool = False) -> bool:
    """Coerce common provider bool shapes; unknown values fall back to *default*."""
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)) and v in (0, 1):
        return bool(v)
    if isinstance(v, str):
        v_clean = v.strip().lower()
        if v_clean in ("true", "yes", "1", "correct"):
            return True
        if v_clean in ("false", "no", "0", "incorrect", "none", "null", ""):
            return False
    return default


class DialogueLLMResult(BaseModel):
    """Parsed LLM response inside the dialogue handler."""

    # Providers often add extra keys (confidence, suggested_actions, etc.).
    # Ignore them so a useful tutor_message is not discarded.
    model_config = ConfigDict(extra="ignore")

    tutor_message: str
    references_student_working: bool = False
    references_candidate_final_answer: bool = False
    new_misconception: MinedMisconception | None = None

    @model_validator(mode="before")
    @classmethod
    def _apply_field_aliases(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        aliases = {
            "message": "tutor_message",
            "reply": "tutor_message",
            "response": "tutor_message",
            "text": "tutor_message",
            "references_working": "references_student_working",
            "references_answer": "references_candidate_final_answer",
        }
        normalised = dict(data)
        for source, target in aliases.items():
            if target not in normalised and source in normalised:
                normalised[target] = normalised[source]
                normalised.pop(source, None)
        return normalised

    @field_validator("references_student_working", "references_candidate_final_answer", mode="before")
    @classmethod
    def _coerce_bool_flags(cls, v: Any) -> bool:
        return _coerce_llm_bool(v, default=False)

    @field_validator("new_misconception", mode="before")
    @classmethod
    def _coerce_invalid_misconception(cls, v: Any) -> Any:
        if v is None:
            return None
        if isinstance(v, str) and v.strip().lower() in ("none", "null", "", "false", "no"):
            return None
        return v

    @classmethod
    def fallback(cls) -> "DialogueLLMResult":
        return cls(
            tutor_message="Let's try the next step together.",
            references_student_working=False,
            references_candidate_final_answer=False,
            new_misconception=None,
        )


class StuckClassifierResult(BaseModel):
    """Result of the stuck-classification LLM call."""

    model_config = ConfigDict(extra="ignore")

    stuck: bool

    @model_validator(mode="before")
    @classmethod
    def _apply_field_aliases(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        normalised = dict(data)
        for source in ("is_stuck", "needs_help", "confused"):
            if "stuck" not in normalised and source in normalised:
                normalised["stuck"] = normalised[source]
                normalised.pop(source, None)
        return normalised

    @field_validator("stuck", mode="before")
    @classmethod
    def _coerce_stuck(cls, v: Any) -> bool:
        return _coerce_llm_bool(v, default=False)

    @classmethod
    def fallback(cls) -> "StuckClassifierResult":
        return cls(stuck=False)
