"""Pure subject-metadata to learning-facet mappings.

The exercise schemas intentionally keep authored curriculum metadata separate
from derived learner analytics.  These helpers provide one deterministic place
for translating that metadata into the facets shown on student/parent reports.
Keyword inference is used only when the authored metadata is absent.
"""
from __future__ import annotations

from typing import Any


ENGLISH_FACETS = {
    "comprehension",
    "text_evidence",
    "language_conventions",
    "vocabulary",
    "writing_structure",
}

SCIENCE_FACETS = {
    "conceptual_knowledge",
    "inquiry_design",
    "data_interpretation",
    "scientific_reasoning",
    "science_in_context",
}


def english_learning_facet(exercise: dict[str, Any]) -> str:
    """Map authored English metadata to the reporting facet vocabulary."""
    metadata = exercise.get("english_metadata") or {}
    authored = str(metadata.get("facet") or "").strip().lower()
    authored_map = {
        "comprehension": "comprehension",  # legacy content
        "reading_comprehension": "comprehension",
        "text_evidence": "text_evidence",
        "language_conventions": "language_conventions",
        "spelling_punctuation": "language_conventions",
        "vocabulary": "vocabulary",
        "writing_structure": "writing_structure",
    }
    if authored in authored_map:
        return authored_map[authored]

    # Metadata absent/unknown: retain a conservative curriculum-code fallback.
    topic_str = "".join(exercise.get("topic_ids") or []).upper()
    if any(code in topic_str for code in ("LA03", "LA04", "LA05", "LA06", "LA08")):
        return "language_conventions"
    if any(code in topic_str for code in ("LA07", "LA09")):
        return "vocabulary"
    if any(code in topic_str for code in ("LY03", "LY04", "LY05", "LY06", "LY08")):
        return "text_evidence"
    if any(code in topic_str for code in ("LE05", "LY01")):
        return "writing_structure"
    return "comprehension"


def science_learning_facet(exercise: dict[str, Any]) -> str:
    """Map authored Science metadata to one predictable reporting facet.

    Precedence favours the most explicit authored signal.  Keyword fallback is
    deliberately last and is only used when the Science metadata object has no
    populated fields.
    """
    metadata = exercise.get("science_metadata") or {}
    populated = {key: value for key, value in metadata.items() if value not in (None, "", [], {})}

    if populated:
        if metadata.get("science_as_human_endeavour"):
            return "science_in_context"
        if metadata.get("claim_evidence_reasoning") is True:
            return "scientific_reasoning"
        if metadata.get("variables") or metadata.get("safety_notes") or metadata.get("equipment"):
            return "inquiry_design"
        if metadata.get("data_representation"):
            return "data_interpretation"

        inquiry_skill = str(metadata.get("science_inquiry_skill") or "").lower()
        if inquiry_skill:
            if any(term in inquiry_skill for term in ("data", "represent", "interpret", "analyse", "analyze", "graph", "table")):
                return "data_interpretation"
            if any(term in inquiry_skill for term in ("evidence", "reason", "conclusion", "evaluate", "claim")):
                return "scientific_reasoning"
            return "inquiry_design"

        if metadata.get("science_understanding") or metadata.get("strand") or metadata.get("sub_strand"):
            return "conceptual_knowledge"

    # No authored metadata signal: use a bounded textual fallback.
    question_text = str(exercise.get("question") or "").lower()
    topic_text = str(exercise.get("topic") or "").lower()
    text = f"{question_text} {topic_text}"
    if any(term in text for term in ("society", "community", "technology", "ethical", "human endeavour", "human endeavor")):
        return "science_in_context"
    if any(term in text for term in ("claim", "evidence", "reasoning", "justify", "evaluate", "conclusion")):
        return "scientific_reasoning"
    if any(term in text for term in ("graph", "table", "data", "trend", "pattern", "calculate")):
        return "data_interpretation"
    if any(term in text for term in ("inquiry", "investigate", "experiment", "method", "plan", "variable", "equipment", "safety")):
        return "inquiry_design"
    return "conceptual_knowledge"


__all__ = [
    "ENGLISH_FACETS",
    "SCIENCE_FACETS",
    "english_learning_facet",
    "science_learning_facet",
]
