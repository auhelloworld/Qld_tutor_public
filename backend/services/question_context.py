"""Safe question projections and complete LLM context helpers.

Student-facing projections deliberately whitelist only answer-free fields.
Authorised review projections add marking fields for parent/teacher review.
"""
from __future__ import annotations

import json
from typing import Any

from backend.content_authoring.stimulus_loader import resolve_passage

_STUDENT_FIELDS = (
    "id", "question", "question_type", "topic", "topic_ids", "subject",
    "framework", "year_level", "unit", "difficulty", "complexity", "choices",
    "diagram_data", "diagram_description", "image",
)
_REVIEW_FIELDS = (
    "answer", "correct_choice", "rubric", "sample_reasoning",
    "alternative_answers", "answer_tolerance", "partial_credit", "steps",
)
_PART_STUDENT_FIELDS = (
    "label", "question", "marks", "max_score", "choices", "diagram_data",
    "diagram_description", "image",
)
_PART_REVIEW_FIELDS = (
    "answer", "rubric", "partial_credit", "answer_tolerance",
    "alternative_answers", "steps",
)


def _copy_fields(source: dict, names: tuple[str, ...]) -> dict:
    return {name: source[name] for name in names if source.get(name) is not None}


def _student_part_view(part: dict) -> dict:
    return _copy_fields(part, _PART_STUDENT_FIELDS)


def student_question_view(question: dict) -> dict:
    """Return an answer-free, render-complete student projection."""
    result = _copy_fields(question, _STUDENT_FIELDS)
    passage = question.get("resolved_passage") or resolve_passage(question)
    if passage:
        result["passage"] = passage
    if question.get("sub_parts"):
        result["sub_parts"] = [
            _student_part_view(part)
            for part in question.get("sub_parts") or []
            if isinstance(part, dict)
        ]
    # Safe metadata only. Never expose accepted answer variants or solution data.
    math_meta = question.get("math_metadata") or {}
    if isinstance(math_meta, dict):
        safe_math = {
            key: math_meta[key]
            for key in (
                "strand", "sub_strand", "skill", "calculator_allowed",
                "expected_working_steps", "prerequisite_skills",
                "strategy_focus", "representation_type", "technology_active",
                "assessment_objective", "unit_topic", "formula_reference",
            )
            if math_meta.get(key) is not None
        }
        # common_misconceptions can name solution pitfalls; keep out of student view.
        if safe_math:
            result["math_metadata"] = safe_math
    english_meta = question.get("english_metadata") or {}
    safe_english = {
        key: english_meta[key]
        for key in ("facet", "passage_mode", "grammar_focus", "writing_skill")
        if english_meta.get(key) is not None
    }
    if safe_english:
        result["english_metadata"] = safe_english
    science_meta = question.get("science_metadata") or {}
    safe_science = {
        key: science_meta[key]
        for key in (
            "strand", "sub_strand", "science_understanding",
            "science_inquiry_skill", "science_as_human_endeavour",
            "practical_context", "safety_notes", "equipment",
            "data_representation", "variables", "claim_evidence_reasoning",
        )
        if science_meta.get(key) is not None
    }
    if safe_science:
        result["science_metadata"] = safe_science
    return result


def authorised_review_view(question: dict) -> dict:
    """Return a complete projection for authenticated marking/review surfaces."""
    result = student_question_view(question)
    result.update(_copy_fields(question, _REVIEW_FIELDS))
    if question.get("sub_parts"):
        review_parts = []
        for part in question.get("sub_parts") or []:
            if not isinstance(part, dict):
                continue
            item = _student_part_view(part)
            item.update(_copy_fields(part, _PART_REVIEW_FIELDS))
            review_parts.append(item)
        result["sub_parts"] = review_parts
    return result


def diagram_to_text(diagram: dict | None) -> str:
    """Produce a conservative textual description for common structured visuals."""
    if not isinstance(diagram, dict) or not diagram:
        return ""
    dtype = str(diagram.get("type") or "diagram").replace("_", " ")
    if dtype in {"force diagram", "force_diagram"}:
        forces = diagram.get("forces") or []
        details = ", ".join(
            f"{f.get('label') or 'force'} {f.get('magnitude', '')} {f.get('direction', '')}".strip()
            for f in forces if isinstance(f, dict)
        )
        return f"Force diagram: {details}."
    if dtype in {"box plot", "box_plot"}:
        values = [diagram.get(k) for k in ("minimum", "q1", "median", "q3", "maximum")]
        return f"Box plot five-number summary: {values}."
    if dtype in {"tree diagram", "tree_diagram", "construction tree", "construction_tree"}:
        return f"{dtype.title()}: {json.dumps(diagram, ensure_ascii=False, sort_keys=True)}"
    return f"{dtype.title()}: {json.dumps(diagram, ensure_ascii=False, sort_keys=True)}"


def llm_question_context(question: dict) -> str:
    """Serialize complete source context for grading, hints and dialogue.

    Stimulus and question content are explicitly delimited as untrusted source
    material so embedded instructions cannot override the system message.
    """
    view = authorised_review_view(question)
    lines = ["<<<QUESTION_CONTEXT_BEGIN>>>"]
    if view.get("passage"):
        lines.extend(["[UNTRUSTED_STIMULUS_BEGIN]", str(view["passage"]), "[UNTRUSTED_STIMULUS_END]"])
    lines.append(f"Question: {view.get('question', '')}")
    if view.get("diagram_data"):
        lines.append(diagram_to_text(view.get("diagram_data")))
    if view.get("diagram_description"):
        lines.append(f"Diagram description: {view['diagram_description']}")
    if view.get("sub_parts"):
        lines.append("Sub-parts:")
        for part in view["sub_parts"]:
            lines.append(
                f"- ({part.get('label', '')}) {part.get('question', '')} "
                f"[{part.get('marks', part.get('max_score', 1))} mark(s)]"
            )
            if part.get("diagram_data"):
                lines.append(f"  {diagram_to_text(part.get('diagram_data'))}")
    lines.append("<<<QUESTION_CONTEXT_END>>>")
    return "\n".join(lines)


__all__ = [
    "student_question_view", "authorised_review_view", "llm_question_context",
    "diagram_to_text",
]


_MARK_STUDENT_FIELDS = (
    "is_correct", "outcome", "attempt_id", "feedback", "score", "max_score",
    "question_type", "key_points_met", "key_points_missed", "key_points",
    "error_type", "error_pattern", "deterministic", "misconception_id",
    "misconception_name", "misconception_explanation", "next_step",
    "new_misconception", "review_resolution_eligible", "review_match",
    # Set only after a final miss ("I don't know", or a last try that was asked to reveal).
    "correct_answer", "solution_steps",
    "quest_award", "error",
)
_PART_MARK_STUDENT_FIELDS = (
    "label", "is_correct", "outcome", "student_answer", "marks", "score",
    "max_score", "error_type", "feedback", "next_step",
)


def solution_steps(question: dict) -> list[str]:
    """The question's own worked steps, without blank steps. They contain the answer."""
    return [str(step).strip() for step in question.get("steps") or [] if str(step).strip()]


def student_mark_view(result: dict) -> dict:
    """Return feedback needed by the learner without authored answers or internals."""
    safe = _copy_fields(result, _MARK_STUDENT_FIELDS)
    part_results = result.get("part_results")
    if isinstance(part_results, list):
        safe["part_results"] = [
            _copy_fields(part, _PART_MARK_STUDENT_FIELDS)
            for part in part_results
            if isinstance(part, dict)
        ]
    return safe
