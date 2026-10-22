"""Sidecar stimulus loader for English reading/viewing passages.

Audit Packet 2.1 — separates passage content from exercise questions so
multiple exercises can share a single stimulus without duplicating text.

The sidecar file ``data/english_stimuli.json`` is a structured v2 stimulus
library. Exercises reference a stimulus via ``english_metadata.passage`` when
the value is a valid stimulus_id rather than inline text.

Resolution order for ``resolve_passage(exercise)``:

1. ``english_metadata.passage`` is a stimulus_id present in the sidecar → return
   ``student_display.plain_text`` from the structured stimulus record.
2. ``english_metadata.passage`` is non-empty inline text → return it directly.
3. Question body contains ``**Passage:**`` block → extract and return it.
4. No passage available → return ``None``.
"""
from __future__ import annotations

import json
import logging
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_STIMULI_FILE = _PROJECT_ROOT / "data" / "english_stimuli.json"

# A stimulus_id looks like "ST-xxxxx" or any key present in the sidecar file.
_STIMULUS_ID_RE = re.compile(r"^ST-[A-Za-z0-9_-]+$")

ALLOWED_STIMULUS_TYPES = {
    "literary_extract",
    "poem",
    "poem_pair",
    "paired_text",
    "information_article",
    "historical_source_pair",
    "campaign_poster",
    "museum_panel",
    "infographic",
    "article_with_visual",
    "speech",
    "letter_to_editor",
    "webpage",
}

ALLOWED_NAPLAN_ALIGNMENTS = {
    "reading",
    "writing",
    "conventions_of_language",
    "spelling",
    "grammar",
    "punctuation",
}

ALLOWED_ANALYSIS_TARGETS = {
    "main_idea",
    "inference",
    "text_evidence",
    "audience",
    "purpose",
    "tone",
    "mood",
    "characterisation",
    "setting",
    "symbolism",
    "theme",
    "comparison",
    "persuasive_techniques",
    "evidence_vs_emotional_appeal",
    "salience",
    "vector",
    "contrast",
    "framing",
    "colour",
    "layout",
    "image_text_relationship",
    "source_reliability",
    "data_interpretation",
}

TEXT_REQUIRED_TYPES = {
    "literary_extract",
    "poem",
    "poem_pair",
    "paired_text",
    "information_article",
    "historical_source_pair",
    "campaign_poster",
    "museum_panel",
    "infographic",
    "article_with_visual",
    "speech",
    "letter_to_editor",
    "webpage",
}

VISUAL_REQUIRED_TYPES = {
    "campaign_poster",
    "museum_panel",
    "infographic",
    "article_with_visual",
    "webpage",
}

LAYOUT_REQUIRED_TYPES = VISUAL_REQUIRED_TYPES
DATA_REQUIRED_STIMULUS_TYPES = {"infographic"}
DATA_CONTENT_RE = re.compile(
    r"\b(line graph|bar chart|data table|table of|chart|graph|map of|timeline)\b",
    re.IGNORECASE,
)

FORBIDDEN_RECORD_FIELDS = {
    "answer",
    "answers",
    "expected_answer",
    "expected_response",
    "model_answer",
    "sample_answer",
    "rubric",
    "marking_guide",
    "teacher_notes",
}


class StimulusValidationError(ValueError):
    """Raised when ``english_stimuli.json`` does not match the v2 structure."""


def _is_non_empty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _is_non_empty_list(value: Any) -> bool:
    return isinstance(value, list) and bool(value)


def _validate_element_list(record: dict[str, Any], field: str, item_label: str) -> list[str]:
    errors: list[str] = []
    value = record.get(field)
    if value is None:
        return errors
    if not isinstance(value, list) or not value:
        return [f"{field} must be a non-empty list when present"]
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            errors.append(f"{field}[{index}] must be an object")
            continue
        key = "feature" if field == "layout_features" else "type"
        if field == "texts":
            key = "role"
        if not _is_non_empty_string(item.get(key)):
            errors.append(f"{field}[{index}].{key} is required")
        if not _is_non_empty_string(item.get("content")):
            errors.append(f"{field}[{index}].content is required")
        if field != "data_elements" and not _is_non_empty_string(item.get("effect")):
            errors.append(f"{field}[{index}].effect is required")
    return errors


def _record_requires_data_elements(record: dict[str, Any]) -> bool:
    if record.get("stimulus_type") in DATA_REQUIRED_STIMULUS_TYPES:
        return True
    searchable: list[str] = []
    display = record.get("student_display")
    if isinstance(display, dict):
        searchable.append(str(display.get("plain_text", "")))
    for field in ("visual_elements", "layout_features", "texts"):
        values = record.get(field)
        if isinstance(values, list):
            for item in values:
                if isinstance(item, dict):
                    searchable.extend(str(item.get(key, "")) for key in ("type", "feature", "role", "content"))
    return any(DATA_CONTENT_RE.search(value) for value in searchable)


def validate_stimulus_record(stimulus_id: str, record: Any) -> list[str]:
    """Return validation errors for a single v2 stimulus record."""
    errors: list[str] = []
    if not isinstance(record, dict):
        return [f"{stimulus_id} must be an object, not {type(record).__name__}"]

    forbidden = sorted(FORBIDDEN_RECORD_FIELDS & set(record))
    if forbidden:
        errors.append(f"{stimulus_id} contains forbidden answer/rubric fields: {forbidden}")

    required_strings = ("id", "title", "stimulus_type", "purpose")
    for field in required_strings:
        if not _is_non_empty_string(record.get(field)):
            errors.append(f"{stimulus_id}.{field} is required")

    if record.get("id") != stimulus_id:
        errors.append(f"{stimulus_id}.id must match the stimulus key")

    if record.get("stimulus_type") not in ALLOWED_STIMULUS_TYPES:
        errors.append(f"{stimulus_id}.stimulus_type is not allowed: {record.get('stimulus_type')!r}")

    if record.get("year_level") not in {7, 8, 9, 10}:
        errors.append(f"{stimulus_id}.year_level must be 7, 8, 9 or 10")

    if not _is_non_empty_list(record.get("curriculum_links")):
        errors.append(f"{stimulus_id}.curriculum_links must be a non-empty list")
    elif not all(_is_non_empty_string(item) for item in record["curriculum_links"]):
        errors.append(f"{stimulus_id}.curriculum_links must contain strings")

    naplan_alignment = record.get("naplan_alignment")
    if not _is_non_empty_list(naplan_alignment):
        errors.append(f"{stimulus_id}.naplan_alignment must be a non-empty list")
    else:
        invalid = sorted(set(naplan_alignment) - ALLOWED_NAPLAN_ALIGNMENTS)
        if invalid:
            errors.append(f"{stimulus_id}.naplan_alignment has invalid values: {invalid}")

    analysis_targets = record.get("analysis_targets")
    if not _is_non_empty_list(analysis_targets):
        errors.append(f"{stimulus_id}.analysis_targets must be a non-empty list")
    else:
        invalid = sorted(set(analysis_targets) - ALLOWED_ANALYSIS_TARGETS)
        if invalid:
            errors.append(f"{stimulus_id}.analysis_targets has invalid values: {invalid}")

    display = record.get("student_display")
    if not isinstance(display, dict):
        errors.append(f"{stimulus_id}.student_display must be an object")
    elif not _is_non_empty_string(display.get("plain_text")):
        errors.append(f"{stimulus_id}.student_display.plain_text is required")

    accessibility = record.get("accessibility")
    if not isinstance(accessibility, dict):
        errors.append(f"{stimulus_id}.accessibility must be an object")
    elif not _is_non_empty_string(accessibility.get("alt_text")):
        errors.append(f"{stimulus_id}.accessibility.alt_text is required")

    stimulus_type = record.get("stimulus_type")
    if stimulus_type in TEXT_REQUIRED_TYPES and not _is_non_empty_list(record.get("texts")):
        errors.append(f"{stimulus_id}.texts is required for {stimulus_type}")
    if stimulus_type in VISUAL_REQUIRED_TYPES and not _is_non_empty_list(record.get("visual_elements")):
        errors.append(f"{stimulus_id}.visual_elements is required for {stimulus_type}")
    if stimulus_type in LAYOUT_REQUIRED_TYPES and not _is_non_empty_list(record.get("layout_features")):
        errors.append(f"{stimulus_id}.layout_features is required for {stimulus_type}")
    if _record_requires_data_elements(record) and not _is_non_empty_list(record.get("data_elements")):
        errors.append(f"{stimulus_id}.data_elements is required when chart, graph, map, table, or timeline content is present")

    for field, label in (
        ("texts", "text"),
        ("visual_elements", "visual element"),
        ("data_elements", "data element"),
        ("layout_features", "layout feature"),
    ):
        errors.extend(f"{stimulus_id}.{msg}" for msg in _validate_element_list(record, field, label))

    return errors


def validate_stimulus_library(raw: Any) -> dict[str, dict[str, Any]]:
    """Validate and return the v2 stimulus map.

    The old string-valued sidecar format is intentionally rejected.
    """
    errors: list[str] = []
    if not isinstance(raw, dict):
        raise StimulusValidationError("english_stimuli.json must contain a top-level object")

    if raw.get("schema_version") != 2:
        errors.append("schema_version must be 2")
    if raw.get("subject") != "english":
        errors.append("subject must be 'english'")
    declared_year = raw.get("year_level")
    declared_years = raw.get("year_levels")
    if declared_year is not None and declared_year not in {7, 8, 9, 10}:
        errors.append("year_level must be 7, 8, 9 or 10 when present")
    if declared_years is not None:
        if not isinstance(declared_years, list) or not declared_years:
            errors.append("year_levels must be a non-empty list when present")
        elif set(declared_years) - {7, 8, 9, 10}:
            errors.append("year_levels may only contain 7, 8, 9 and/or 10")
    if declared_year is None and declared_years is None:
        errors.append("year_level or year_levels is required")

    stimuli = raw.get("stimuli")
    if not isinstance(stimuli, dict) or not stimuli:
        errors.append("stimuli must be a non-empty object")
        stimuli = {}

    validated: dict[str, dict[str, Any]] = {}
    for stimulus_id, record in stimuli.items():
        key = str(stimulus_id)
        record_errors = validate_stimulus_record(key, record)
        if record_errors:
            errors.extend(record_errors)
        elif isinstance(record, dict):
            validated[key] = record

    if errors:
        raise StimulusValidationError("; ".join(errors))
    return validated


@lru_cache(maxsize=1)
def _load_stimuli() -> dict[str, dict[str, Any]]:
    """Load and validate the structured stimulus map."""
    if not _STIMULI_FILE.exists():
        return {}
    try:
        raw = json.loads(_STIMULI_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("Failed to load english_stimuli.json: %s", exc)
        return {}
    return validate_stimulus_library(raw)


def reload_stimuli() -> None:
    """Clear the cached stimulus map so the next call re-reads the file."""
    _load_stimuli.cache_clear()


def is_stimulus_id(value: str) -> bool:
    """Return True when *value* looks like a stimulus_id reference."""
    return bool(_STIMULUS_ID_RE.match(value.strip()))


def get_stimulus_record(stimulus_id: str) -> dict[str, Any] | None:
    """Look up a structured stimulus record by stimulus_id."""
    stimuli = _load_stimuli()
    return stimuli.get(stimulus_id.strip())


def get_stimulus_text(stimulus_id: str) -> str | None:
    """Return ``student_display.plain_text`` for a stimulus_id."""
    record = get_stimulus_record(stimulus_id)
    if not record:
        return None
    display = record.get("student_display")
    if not isinstance(display, dict) or not _is_non_empty_string(display.get("plain_text")):
        raise StimulusValidationError(
            f"Stimulus {stimulus_id!r} exists but has no student_display.plain_text"
        )
    return display["plain_text"].strip()


_PASSAGE_BLOCK_RE = re.compile(
    r"\*\*Passage:\*\*\s*\n(.*?)(?:\n\*\*Question:\*\*|\Z)",
    re.DOTALL,
)
_EMBEDDED_MICRO_TEXT_RE = re.compile(
    r"(?:\*\*Micro-?text:\*\*|\buse\s+(?:this|the)\s+micro-?text\b|"
    r"\buse\s+evidence\s+from\s*:|\bexplain\s+its\s+effect\s*:)",
    re.IGNORECASE,
)


def extract_inline_passage(question: str) -> str | None:
    """Extract the ``**Passage:**`` block from a question string."""
    m = _PASSAGE_BLOCK_RE.search(question)
    if m:
        return m.group(1).strip()
    return None


def resolve_passage(exercise: dict[str, Any]) -> str | None:
    """Resolve the full passage text for an exercise.

    Resolution order:
    1. A question that already embeds a labelled or explicit micro-text keeps that
       material in the question body and suppresses any legacy sidecar reference.
    2. ``english_metadata.stimulus_id`` is a stimulus_id → sidecar lookup.
    3. ``english_metadata.passage`` is a stimulus_id → sidecar lookup.
    4. ``english_metadata.passage`` is inline text → return directly.
    5. ``**Passage:**`` block in question body → extract and return.
    6. No passage → ``None``.
    """
    question = str(exercise.get("question") or "")
    if _EMBEDDED_MICRO_TEXT_RE.search(question):
        return None

    meta = exercise.get("english_metadata") or {}
    stimulus_value = meta.get("stimulus_id")
    passage_value = stimulus_value or meta.get("passage")
    if isinstance(passage_value, str) and passage_value.strip():
        text = passage_value.strip()
        if is_stimulus_id(text):
            resolved = get_stimulus_text(text)
            if resolved:
                return resolved
            logger.warning(
                "Exercise %s references stimulus_id %r not found in sidecar",
                exercise.get("id", "?"),
                text,
            )
            # Fall through to inline extraction
        else:
            return text

    return extract_inline_passage(question)


def enrich_exercise(exercise: dict[str, Any]) -> dict[str, Any]:
    """Return a shallow copy of *exercise* with ``resolved_passage`` injected.

    This is a convenience for rendering or grading paths that need the passage
    text without parsing the question body each time.
    """
    result = dict(exercise)
    passage = resolve_passage(exercise)
    if passage:
        result["resolved_passage"] = passage
    return result


__all__ = [
    "enrich_exercise",
    "extract_inline_passage",
    "get_stimulus_record",
    "get_stimulus_text",
    "is_stimulus_id",
    "reload_stimuli",
    "resolve_passage",
    "StimulusValidationError",
    "validate_stimulus_library",
    "validate_stimulus_record",
]
