"""Typed Pydantic v2 response models for TutorEngine LLM outputs.

Design §3.1 — robustness-hardening spec.
"""
from __future__ import annotations

import logging
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator, field_validator

logger = logging.getLogger(__name__)

ErrorTypeCode = Literal[
    "algebra_setup",
    "algorithmic_reasoning_error",
    "answer_format_error",
    "calculation_error",
    "claim_evidence_reasoning_gap",
    "concept_gap",
    "concept_misunderstanding",
    "data_interpretation",
    "decimal_percentage_error",
    "distribution_error",
    "equation_solving_error",
    "evidence_mismatch",
    "exponent_error",
    "expression_clarity",
    "formula_misuse",
    "fraction_error",
    "geometry_reasoning_error",
    "grammar_convention",
    "grammar_syntax",
    "graph_error",
    "incomplete_answer",
    "inference_error",
    "inferential_comprehension",
    "like_terms_error",
    "literal_comprehension",
    "measurement_dimension_error",
    "order_of_ops",
    "probability_error",
    "punctuation",
    "punctuation_mechanics",
    "reading_comprehension",
    "rounding_error",
    "safety_or_method_error",
    "scale_ratio_error",
    "scientific_vocabulary",
    "sign_error",
    "spelling",
    "spelling_mechanics",
    "statistics_error",
    "substitution_error",
    "textual_analysis",
    "unit_error",
    "variable_confusion",
    "visual_misread",
    "vocabulary_precision",
    "vocabulary_register",
    "weak_text_evidence",
    "writing_composition",
]


class MinedMisconception(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str = ""
    description: str = ""
    student_facing_explanation: str = ""


class MarkResult(BaseModel):
    model_config = ConfigDict(extra="ignore")

    is_correct: bool
    error_type: ErrorTypeCode | None = None
    feedback: str
    next_step: str | None = None
    error_pattern: str | None = None
    misconception_id: str | None = None
    new_misconception: MinedMisconception | None = None

    @model_validator(mode="before")
    @classmethod
    def _apply_field_aliases(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        def _is_bool_like(value: Any) -> bool:
            if isinstance(value, bool):
                return True
            if isinstance(value, (int, float)) and value in (0, 1):
                return True
            if isinstance(value, str):
                return value.strip().lower() in {
                    "true", "false", "yes", "no", "1", "0", "correct", "incorrect",
                }
            return False

        aliases = {
            "isCorrect": "is_correct",
            "comment": "feedback",
            "comments": "feedback",
            "reason": "feedback",
            "explanation": "feedback",
            "message": "feedback",
            "error": "error_type",
            "errorType": "error_type",
            "error_code": "error_type",
            "nextStep": "next_step",
            "next_hint": "next_step",
            "suggestion": "next_step",
        }
        normalised = dict(data)
        for source, target in aliases.items():
            if target not in normalised and source in normalised:
                normalised[target] = normalised[source]
        for source in ("correct", "correctness"):
            if "is_correct" not in normalised and source in normalised and _is_bool_like(normalised[source]):
                normalised["is_correct"] = normalised[source]
        return normalised

    @field_validator("is_correct", mode="before")
    @classmethod
    def _coerce_is_correct(cls, v: Any) -> bool:
        """Coerce common LLM string/numeral outputs for is_correct to bool.

        Unparseable values raise so the mark path degrades to
        ``parent_review_pending`` rather than silently marking the student wrong.
        """
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            v_clean = v.strip().lower()
            if v_clean in ("true", "yes", "1", "correct"):
                return True
            if v_clean in ("false", "no", "0", "incorrect"):
                return False
            raise ValueError(f"unparseable is_correct value: {v!r}")
        if isinstance(v, (int, float)) and v in (0, 1):
            return bool(v)
        raise ValueError(f"unparseable is_correct value: {v!r}")

    @field_validator("error_type", mode="before")
    @classmethod
    def _coerce_invalid_error_type(cls, v: Any) -> Any:
        if v is None:
            return None
        v_str = str(v).strip()
        if v_str.lower() in ("none", "null", "", "none_detected", "false", "no"):
            return None
        valid_codes = {
            "algebra_setup", "algorithmic_reasoning_error", "answer_format_error", "calculation_error",
            "claim_evidence_reasoning_gap", "concept_gap", "concept_misunderstanding", "data_interpretation",
            "decimal_percentage_error", "distribution_error", "equation_solving_error", "evidence_mismatch",
            "exponent_error", "expression_clarity", "formula_misuse", "fraction_error",
            "geometry_reasoning_error", "grammar_convention", "grammar_syntax", "graph_error",
            "incomplete_answer", "inference_error", "inferential_comprehension", "like_terms_error",
            "literal_comprehension", "measurement_dimension_error", "order_of_ops", "probability_error",
            "punctuation", "punctuation_mechanics", "reading_comprehension", "rounding_error",
            "safety_or_method_error", "scale_ratio_error", "scientific_vocabulary", "sign_error",
            "spelling", "spelling_mechanics", "statistics_error", "substitution_error",
            "textual_analysis", "unit_error", "variable_confusion", "visual_misread",
            "vocabulary_precision", "vocabulary_register", "weak_text_evidence", "writing_composition"
        }
        if v_str in valid_codes:
            return v_str
        logger.warning("Unrecognized LLM error_type %r received. Coercing to None for safety.", v)
        return None

    @field_validator("next_step", mode="before")
    @classmethod
    def _coerce_invalid_next_step(cls, v: Any) -> Any:
        if v is None:
            return None
        if isinstance(v, str):
            v_clean = v.strip().lower()
            if v_clean in ("none", "null", "", "false", "no"):
                return None
        return v

    @field_validator("new_misconception", mode="before")
    @classmethod
    def _coerce_invalid_misconception(cls, v: Any) -> Any:
        if v is None:
            return None
        if isinstance(v, str):
            v_clean = v.strip().lower()
            if v_clean in ("none", "null", "", "false", "no"):
                return None
        return v

    @model_validator(mode="after")
    def _check_error_type_consistency(self) -> "MarkResult":
        if self.is_correct and self.error_type is not None:
            self.error_type = None
        return self

    @classmethod
    def fallback(cls) -> "MarkResult":
        return cls(
            is_correct=False,
            error_type=None,
            feedback="Sorry, the AI tutor is temporarily unable to grade your answer. Please try again.",
            next_step=None,
            new_misconception=None,
        )


class HintResult(BaseModel):
    model_config = ConfigDict(extra="ignore")

    hint_text: str
    redaction_applied: bool = False

    @model_validator(mode="before")
    @classmethod
    def _apply_field_aliases(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        normalised = dict(data)
        for source in ("hint", "message", "text"):
            if "hint_text" not in normalised and source in normalised:
                normalised["hint_text"] = normalised[source]
        return normalised

    @classmethod
    def fallback(cls) -> "HintResult":
        return cls(
            hint_text="I'm having trouble generating a hint right now. Try re-reading the question and thinking about what formula or rule applies.",
            redaction_applied=False,
        )


class VariationResult(BaseModel):
    model_config = ConfigDict(extra="ignore")

    question: str
    answer: str
    steps: list[str] = Field(default_factory=list)
    verified: bool = False

    @classmethod
    def fallback(cls) -> "VariationResult":
        return cls(
            question="(Variation unavailable — please use a textbook question instead.)",
            answer="",
            steps=[],
            verified=False,
        )


class ErrorPatternResult(BaseModel):
    model_config = ConfigDict(extra="ignore")

    pattern_found: bool
    analysis: str

    @classmethod
    def fallback(cls) -> "ErrorPatternResult":
        return cls(
            pattern_found=False,
            analysis="",
        )


class PSMTCriterionScores(BaseModel):
    """Complete formative PSMT criterion evidence returned by the provider."""

    model_config = ConfigDict(extra="forbid")

    formulate: int | None
    solve: int | None
    evaluate_verify: int | None
    communicate: int | None

    @model_validator(mode="before")
    @classmethod
    def _normalise_keys(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        aliases = {
            "evaluate and verify": "evaluate_verify",
            "evaluate_and_verify": "evaluate_verify",
            "evaluate-verify": "evaluate_verify",
        }
        normalised = {}
        for key, value in data.items():
            cleaned = str(key).strip().lower()
            normalised[aliases.get(cleaned, cleaned)] = value
        return normalised

    @field_validator("formulate", "solve", "evaluate_verify", "communicate", mode="before")
    @classmethod
    def _validate_score(cls, value: Any) -> int | None:
        if value is None:
            return None
        if isinstance(value, str) and value.strip().lower() in {"null", "none", "n/a", "na", ""}:
            return None
        if isinstance(value, bool):
            raise ValueError("PSMT criterion score must be an integer from 1 to 5 or null")
        if isinstance(value, float) and not value.is_integer():
            raise ValueError("PSMT criterion score must be an integer from 1 to 5 or null")
        try:
            score = int(value)
        except (TypeError, ValueError) as exc:
            raise ValueError("PSMT criterion score must be an integer from 1 to 5 or null") from exc
        if not 1 <= score <= 5:
            raise ValueError("PSMT criterion score must be between 1 and 5")
        return score


class PSMTResult(BaseModel):
    model_config = ConfigDict(extra="ignore")

    mentor_feedback_markdown: str = Field(min_length=1, max_length=3000)
    criterion_scores: PSMTCriterionScores
    readiness_level: Literal["ready", "developing", "needs_attention"]
    top_gaps: list[str] = Field(default_factory=list, max_length=3)
    next_revision_actions: list[str] = Field(default_factory=list, max_length=3)
    safety_flags: list[str] = Field(default_factory=list, max_length=3)

    @model_validator(mode="before")
    @classmethod
    def _apply_field_aliases(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        aliases = {
            "feedback": "mentor_feedback_markdown",
            "mentor_feedback": "mentor_feedback_markdown",
            "mentorFeedbackMarkdown": "mentor_feedback_markdown",
            "scores": "criterion_scores",
            "criteria_scores": "criterion_scores",
            "criterionScores": "criterion_scores",
            "readiness": "readiness_level",
            "readinessLevel": "readiness_level",
            "gaps": "top_gaps",
            "topGaps": "top_gaps",
            "actions": "next_revision_actions",
            "next_actions": "next_revision_actions",
            "nextRevisionActions": "next_revision_actions",
            "flags": "safety_flags",
            "safetyFlags": "safety_flags",
        }
        normalised = dict(data)
        for source, target in aliases.items():
            if target not in normalised and source in normalised:
                normalised[target] = normalised[source]
        return normalised

    @classmethod
    def fallback(cls, markdown: str | None = None) -> "PSMTResult":
        return cls(
            mentor_feedback_markdown=markdown
            or "### [MOCK MODE]\n\nPSMT evaluation is unavailable without an LLM API key. Your draft has been saved locally.",
            criterion_scores={
                "formulate": None,
                "solve": None,
                "evaluate_verify": None,
                "communicate": None,
            },
            readiness_level="developing",
            top_gaps=[],
            next_revision_actions=[],
            safety_flags=[],
        )


class KeyPointResult(BaseModel):
    """A single rubric key point with grading detail."""
    model_config = ConfigDict(extra="ignore")

    text: str = "criterion"
    met: bool = False
    why_missed: str | None = None
    how_to_fix: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _apply_field_aliases(cls, data: Any) -> Any:
        if isinstance(data, str):
            # Model sometimes emits bare criterion labels.
            return {"text": data, "met": False}
        if not isinstance(data, dict):
            return data
        aliases = {
            "point": "text",
            "key_point": "text",
            "criterion": "text",
            "label": "text",
            "is_met": "met",
            "achieved": "met",
            "covered": "met",
            "missed_reason": "why_missed",
            "fix": "how_to_fix",
        }
        normalised = dict(data)
        for source, target in aliases.items():
            if target not in normalised and source in normalised:
                normalised[target] = normalised[source]
        if not normalised.get("text"):
            normalised["text"] = "criterion"
        if "met" not in normalised:
            normalised["met"] = False
        return normalised

    @field_validator("met", mode="before")
    @classmethod
    def _coerce_met(cls, v: Any) -> bool:
        if isinstance(v, bool):
            return v
        if isinstance(v, (int, float)) and v in (0, 1):
            return bool(v)
        if isinstance(v, str):
            cleaned = v.strip().lower()
            if cleaned in ("true", "yes", "1", "met", "achieved", "correct"):
                return True
            if cleaned in ("false", "no", "0", "unmet", "missed", "incorrect"):
                return False
        return False

    @field_validator("why_missed", "how_to_fix", mode="before")
    @classmethod
    def _coerce_invalid_text_fields(cls, v: Any) -> Any:
        if v is None:
            return None
        if isinstance(v, str):
            v_clean = v.strip().lower()
            if v_clean in ("none", "null", "", "false", "no"):
                return None
        return v


class ReasoningResult(BaseModel):
    model_config = ConfigDict(extra="ignore")

    score: int
    max_score: int
    feedback: str
    key_points: list[KeyPointResult] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _apply_field_aliases(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        aliases = {
            "marks": "score",
            "mark": "score",
            "total": "max_score",
            "max": "max_score",
            "max_marks": "max_score",
            "maxScore": "max_score",
            "comment": "feedback",
            "comments": "feedback",
            "reason": "feedback",
            "explanation": "feedback",
            "keyPoints": "key_points",
            "criteria": "key_points",
            "rubric_points": "key_points",
        }
        normalised = dict(data)
        for source, target in aliases.items():
            if target not in normalised and source in normalised:
                normalised[target] = normalised[source]
        # "points" is ambiguous: list → key_points, scalar → score.
        if "points" in normalised:
            points_val = normalised["points"]
            if isinstance(points_val, list) and "key_points" not in normalised:
                normalised["key_points"] = points_val
            elif "score" not in normalised and not isinstance(points_val, (list, dict)):
                normalised["score"] = points_val
        # Ensure required score fields have defaults so partial JSON can validate.
        if "score" not in normalised:
            normalised["score"] = 0
        if "max_score" not in normalised:
            normalised["max_score"] = 0
        if "feedback" not in normalised or normalised.get("feedback") in (None, ""):
            if isinstance(normalised.get("feedback"), str) and not normalised["feedback"]:
                normalised["feedback"] = "Marked."
            elif "feedback" not in normalised:
                normalised["feedback"] = "Marked."
        return normalised

    @field_validator("score", "max_score", mode="before")
    @classmethod
    def _coerce_int_score(cls, v: Any) -> int:
        """Coerce common LLM string outputs for score fields to int.

        Accepts ints, floats, numeric strings (``"3"``, ``"3.0"``), and
        fraction strings such as ``"2/3"`` / ``"3/4"`` (numerator used).
        """
        import re

        if isinstance(v, bool):
            return int(v)
        if isinstance(v, int):
            return v
        if isinstance(v, float):
            return int(v)
        if isinstance(v, str):
            text = v.strip()
            fraction = re.fullmatch(r"(-?\d+(?:\.\d+)?)\s*/\s*\d+(?:\.\d+)?", text)
            if fraction:
                return int(float(fraction.group(1)))
            try:
                return int(float(text))
            except (ValueError, TypeError):
                number = re.search(r"-?\d+(?:\.\d+)?", text)
                if number:
                    try:
                        return int(float(number.group(0)))
                    except (ValueError, TypeError):
                        pass
        logger.warning("Unrecognized score value %r; defaulting to 0.", v)
        return 0

    @property
    def key_points_met(self) -> list[str]:
        return [kp.text for kp in self.key_points if kp.met]

    @property
    def key_points_missed(self) -> list[str]:
        return [kp.text for kp in self.key_points if not kp.met]

    @classmethod
    def fallback(cls, max_score: int = 3, key_points: list[str] | None = None) -> "ReasoningResult":
        return cls(
            score=0,
            max_score=max_score,
            feedback="Sorry, the AI tutor is temporarily unable to grade your reasoning response. Please try again.",
            key_points=[],
        )
