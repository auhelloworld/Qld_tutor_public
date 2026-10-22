"""Writing Assessment endpoint — POST /api/tutor/writing/assess.

Independent endpoint to avoid blocking the main tutor interactive loop.
Writing scoring takes 5-10s vs 1-2s for mark. Timeout: 60s, t=0.1.

Supports differentiated rubrics by prompt type (persuasive / narrative / analytical)
and year level (NAPLAN Y7-10 / QCAA ISMG Y11-12).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import tempfile
import threading
import time
import uuid
import weakref
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from backend.student_identity import require_student_id
from backend.student_lifecycle import student_write_guard
from backend.routers.helpers import rate_limit_dependency, get_tutor_engine
from core.schema.writing_schema import (
    WritingAssessmentRequest,
    WritingAssessmentResponse,
    CriterionScore,
    Highlight,
    NAPLAN_CRITERIA_MAP,
    ISMG_CRITERIA_MAP,
    get_remediation_links,
    get_criteria_for_prompt,
)
from core.prompt_templates.writing_prompts import (
    NAPLAN_PROMPT_MAP,
    ATAR_PROMPT_MAP,
    _SOURCE_TEXT_BLOCK,
    _WRITER_STATEMENT_BLOCK,
    _PRECHECK_BLOCK,
    _TOPIC_BLOCK,
    _TOPIC_CONTEXT_BLOCK,
    _SCHOOL_TASK_CONTEXT_BLOCK,
    _CONTENT_BOUNDARY_INSTRUCTION,
)
from core.algorithms.text_precheck import precheck_text
from backend.services.marking import sanitize_prompt_content
from backend.services.request_replay import (
    RequestReplayConflict,
    replay_lookup,
    replay_store,
    request_fingerprint,
    replay_lock,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tutor/writing", tags=["writing"])

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_LOG_ROOT = _PROJECT_ROOT / "data" / "logs"
_TOPICS_FILE = _PROJECT_ROOT / "data" / "writing_topics.json"
_WRITING_ACTIVE_HISTORY_LIMIT = 500
_WRITING_ARCHIVE_FILENAME = "english_writing_archive.jsonl"


def _count_sentence_fragments(text: str) -> int:
    """Count only non-empty fragments separated by sentence punctuation."""
    return sum(1 for fragment in re.split(r"[.!?]+", text) if fragment.strip())


def read_writing_history(student_id: str, *, limit: int = 200) -> dict[str, Any]:
    """Read the bounded active Writing Hub history for one authenticated student.

    The student endpoint and parent summary use the same reader so they agree on
    archive/truncation semantics. Callers decide which fields are safe to expose;
    this function intentionally returns the complete internal entry only to trusted
    server-side callers.
    """
    student_dir = _LOG_ROOT / student_id
    log_path = student_dir / "english_writing_log.json"
    if not log_path.exists():
        return {
            "student_id": student_id,
            "assessments": [],
            "total_assessments": 0,
            "truncated": False,
        }
    try:
        data = json.loads(log_path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.error("Failed to load writing log for %s: %s", student_id, exc)
        return {
            "student_id": student_id,
            "assessments": [],
            "total_assessments": 0,
            "truncated": False,
        }
    all_assessments = data.get("assessments", [])
    if not isinstance(all_assessments, list):
        all_assessments = []
    try:
        archived_count = max(0, int(data.get("archived_assessments", 0)))
    except (TypeError, ValueError):
        archived_count = 0
    safe_limit = max(1, min(int(limit), 500))
    total = archived_count + len(all_assessments)
    truncated = total > safe_limit
    # The active file contains the latest bounded window in chronological order.
    window = all_assessments[-safe_limit:] if len(all_assessments) > safe_limit else all_assessments
    return {
        "student_id": student_id,
        "assessments": window,
        "total_assessments": total,
        "truncated": truncated,
    }


# Per-student RLock/WeakValueDictionary — identical pattern to psmt_history.py.
_WRITING_LOCKS: weakref.WeakValueDictionary[str, threading.RLock] = weakref.WeakValueDictionary()
_WRITING_LOCKS_GUARD = threading.Lock()


def _writing_lock_for(student_id: str) -> threading.RLock:
    with _WRITING_LOCKS_GUARD:
        lock = _WRITING_LOCKS.get(student_id)
        if lock is None:
            lock = threading.RLock()
            _WRITING_LOCKS[student_id] = lock
        return lock


# A durable history lookup handles retries after completion/restart. This weak
# in-process lock additionally prevents concurrent requests with the same key
# from both calling the provider before either result has been persisted.
_WRITING_REQUEST_LOCKS: weakref.WeakValueDictionary[str, asyncio.Lock] = weakref.WeakValueDictionary()
_WRITING_REQUEST_LOCKS_GUARD = threading.Lock()


class _WritingRequestIdConflict(ValueError):
    pass


class _WritingClientDisconnected(RuntimeError):
    pass


def _writing_request_lock_for(student_id: str, request_id: str) -> asyncio.Lock:
    key = f"{student_id}:{request_id}"
    with _WRITING_REQUEST_LOCKS_GUARD:
        lock = _WRITING_REQUEST_LOCKS.get(key)
        if lock is None:
            lock = asyncio.Lock()
            _WRITING_REQUEST_LOCKS[key] = lock
        return lock


def _writing_request_fingerprint(req: WritingAssessmentRequest) -> str:
    payload = req.model_dump(
        mode="json",
        exclude={"assessment_request_id", "time_taken_seconds"},
    )
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _persisted_writing_response(
    student_id: str,
    req: WritingAssessmentRequest,
) -> dict[str, Any] | None:
    request_id = req.assessment_request_id
    if not request_id:
        return None
    log_path = _LOG_ROOT / student_id / "english_writing_log.json"
    lock = _writing_lock_for(student_id)
    with lock:
        if not log_path.exists():
            return None
        try:
            data = json.loads(log_path.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("Failed to read Writing idempotency record for %s: %s", student_id, exc)
            return None
        assessments = data.get("assessments", [])
        if not isinstance(assessments, list):
            return None
        fingerprint = _writing_request_fingerprint(req)
        for entry in reversed(assessments):
            if not isinstance(entry, dict) or entry.get("assessment_request_id") != request_id:
                continue
            stored_fingerprint = entry.get("assessment_request_fingerprint")
            if stored_fingerprint and stored_fingerprint != fingerprint:
                raise _WritingRequestIdConflict(
                    "assessment_request_id was already used for different Writing content"
                )
            stored_response = entry.get("assessment_response")
            if isinstance(stored_response, dict):
                replay = dict(stored_response)
                replay["portfolio_saved"] = True
                replay["assessment_request_id"] = request_id
                return replay
            return None
    return None


def _append_writing_archive(archive_path: Path, assessments: list[dict]) -> None:
    """Append older assessments to a durable JSONL archive."""
    if not assessments:
        return
    with archive_path.open("a", encoding="utf-8") as archive:
        for assessment in assessments:
            archive.write(json.dumps(assessment, ensure_ascii=False, separators=(",", ":")))
            archive.write("\n")
        archive.flush()
        os.fsync(archive.fileno())


def _find_archived_assessment(archive_path: Path, timestamp: str) -> dict | None:
    """Find one archived assessment without loading the complete archive."""
    if not archive_path.exists():
        return None
    try:
        with archive_path.open("r", encoding="utf-8") as archive:
            for line in archive:
                try:
                    assessment = json.loads(line)
                except (TypeError, json.JSONDecodeError):
                    continue
                if isinstance(assessment, dict) and assessment.get("timestamp") == timestamp:
                    return assessment
    except OSError as exc:
        logger.warning("Failed to read writing archive %s: %s", archive_path, exc)
    return None


def _parse_score_value(raw_score: Any, max_score: int) -> int | None:
    """Parse an exact integer rubric mark without clamping or zero-padding.

    Accepts:
      - integer or integer-valued float within [0, max_score]
      - string of integer or integer-valued float within [0, max_score]
      - fraction string 'N/D' where D == max_score and 0 <= N <= max_score

    Rejects:
      - bool, None, NaN, Infinity
      - non-integer numbers (e.g. 3.5)
      - out-of-range numbers (e.g. 99, -1)
      - fractions where denominator != max_score (e.g. 3/0, 3/5, 3/999)
      - arbitrary prose (e.g. 'score: 3')
    """
    if raw_score is None or isinstance(raw_score, bool):
        return None
    if isinstance(raw_score, (int, float)):
        import math
        if not math.isfinite(raw_score):
            return None
        if isinstance(raw_score, float) and not raw_score.is_integer():
            return None
        int_val = int(raw_score)
        if 0 <= int_val <= max_score:
            return int_val
        return None
    if isinstance(raw_score, str):
        text = raw_score.strip()
        if not text:
            return None
        # Check fraction first: "N / D"
        if "/" in text:
            fraction_match = re.fullmatch(r"(-?\d+(?:\.0+)?)\s*/\s*(\d+(?:\.0+)?)", text)
            if fraction_match:
                num_str, denom_str = fraction_match.group(1), fraction_match.group(2)
                try:
                    num_val = float(num_str)
                    denom_val = float(denom_str)
                except (ValueError, OverflowError):
                    return None
                if not num_val.is_integer() or not denom_val.is_integer():
                    return None
                num_int = int(num_val)
                denom_int = int(denom_val)
                if denom_int <= 0 or denom_int != max_score:
                    return None
                if 0 <= num_int <= max_score:
                    return num_int
                return None
            return None
        # Integer or integer float string: "4", "4.0", "-1"
        int_match = re.fullmatch(r"(-?\d+(?:\.\d+)?)", text)
        if int_match:
            try:
                num_val = float(int_match.group(1))
            except (ValueError, OverflowError):
                return None
            import math
            if not math.isfinite(num_val) or not num_val.is_integer():
                return None
            int_val = int(num_val)
            if 0 <= int_val <= max_score:
                return int_val
            return None
        return None
    return None


@router.get("/topics")
async def get_writing_topics(year_level: int | None = None):
    """Fetch writing topics from JSON file, optionally filtered by year level."""
    try:
        if not _TOPICS_FILE.exists():
            return []
        topics = json.loads(_TOPICS_FILE.read_text(encoding="utf-8"))
        topics = [
            t for t in topics
            if not t.get("disabled") and t.get("status", "active") != "draft"
        ]
        if year_level:
            return [t for t in topics if year_level in t.get("yearLevels", [])]
        return topics
    except Exception as exc:
        logger.error("Failed to load writing topics: %s", exc)
        return []


@router.get("/history")
async def get_writing_history(
    student_id: str = Depends(require_student_id),
    limit: int = Query(default=200, ge=1, le=500),
):
    """Fetch writing history for the authenticated student."""
    return read_writing_history(student_id, limit=limit)


# ---------------------------------------------------------------------------
# Linked writing revision loop (Audit Packet 4.1)
# ---------------------------------------------------------------------------


class RevisionCompareRequest(BaseModel):
    """Request body for the writing revision comparison endpoint."""
    original_timestamp: str  # ISO timestamp of the original assessment
    revised_text: str = Field(min_length=1, max_length=10000)


@router.post("/compare")
def revision_compare(
    req: RevisionCompareRequest,
    student_id: str = Depends(require_student_id),
):
    """Compare a revised draft against the original assessment.

    Returns per-criterion score deltas and overall improvement without
    requiring a new LLM assessment. Uses the original criterion scores
    from the writing log as baseline.
    """
    student_dir = _LOG_ROOT / student_id
    log_path = student_dir / "english_writing_log.json"
    if not log_path.exists():
        raise HTTPException(
            status_code=404,
            detail={"error": "no_writing_history",
                    "message": "No writing history found for this student."},
        )

    try:
        log_data = json.loads(log_path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.error("Failed to load writing log for %s: %s", student_id, exc)
        raise HTTPException(status_code=500, detail="Failed to read writing log.")

    # Find the original assessment by timestamp. Recent entries stay in the
    # bounded active file; older entries are searched lazily in JSONL archive.
    original = None
    for a in log_data.get("assessments", []):
        if a.get("timestamp") == req.original_timestamp:
            original = a
            break
    if original is None:
        original = _find_archived_assessment(
            student_dir / _WRITING_ARCHIVE_FILENAME,
            req.original_timestamp,
        )

    if not original:
        raise HTTPException(
            status_code=404,
            detail={"error": "original_not_found",
                    "message": f"No assessment found with timestamp {req.original_timestamp}"},
        )

    # Simple text-level comparison metrics
    import re as _re
    original_text_words = len(original.get("draft_text", "").split()) if original.get("draft_text") else original.get("word_count", 0)
    revised_words = len(req.revised_text.split())

    original_lower = set(_re.findall(r"[a-z']+", (original.get("draft_text") or "").lower()))
    revised_lower = set(_re.findall(r"[a-z']+", req.revised_text.lower()))
    new_words = revised_lower - original_lower
    removed_words = original_lower - revised_lower

    # Sentence count comparison
    original_sentences = _count_sentence_fragments(original.get("draft_text", ""))
    revised_sentences = _count_sentence_fragments(req.revised_text)

    # Paragraph count comparison
    original_paragraphs = len([p for p in (original.get("draft_text") or "").split("\n\n") if p.strip()]) if original.get("draft_text") else 0
    revised_paragraphs = len([p for p in req.revised_text.split("\n\n") if p.strip()])

    original_insufficient = bool(original.get("insufficient_evidence"))
    original_criterion_scores = [] if original_insufficient else original.get("criterion_scores", [])
    original_score = None if original_insufficient else original.get("total_score", 0)
    original_max_score = None if original_insufficient else original.get("max_total_score", 0)

    return {
        "original_timestamp": req.original_timestamp,
        "original_score": original_score,
        "original_max_score": original_max_score,
        "original_scored": not original_insufficient,
        "original_insufficient_evidence": original_insufficient,
        "original_word_count": original_text_words,
        "revised_word_count": revised_words,
        "word_count_change": revised_words - original_text_words,
        "new_vocabulary": sorted(new_words)[:10],
        "removed_vocabulary": sorted(removed_words)[:10],
        "sentence_count": {"original": original_sentences, "revised": revised_sentences},
        "paragraph_count": {"original": original_paragraphs, "revised": revised_paragraphs},
        "original_criterion_scores": original_criterion_scores,
        "feedback": (
            "Text-only comparison: the original draft did not receive criterion scores because it did not contain enough evidence for a fair assessment. "
            "This comparison does not create a baseline score. Add the missing development and run Assess again for a full formative assessment."
            if original_insufficient
            else "Text-only comparison: word count, sentences, paragraphs, and vocabulary versus the original submission. This does not re-score the draft. Run Assess again after revising to update criterion scores and overall feedback."
        ),
    }


def _assessment_type_for_prompt(year_level: int, prompt_type: str) -> str:
    """Return rubric/prompt key for a request prompt type.

    Years 7-10 keep NAPLAN ``narrative``. Years 11-12 use QCAA-style
    ``creative`` for imaginative/narrative tasks while accepting the existing
    frontend ``narrative`` value for backward compatibility.
    """
    if year_level >= 11 and prompt_type == "narrative":
        return "creative"
    return prompt_type


def _format_topic_context(req: WritingAssessmentRequest) -> str:
    if not req.topic_context:
        return ""

    ctx = req.topic_context
    fields: list[tuple[str, Any]] = [
        ("Topic title", sanitize_prompt_content(ctx.topic_title)),
        ("Context", sanitize_prompt_content(ctx.context)),
        ("Target audience", sanitize_prompt_content(ctx.target_audience)),
        ("Mode/form", sanitize_prompt_content(ctx.mode)),
        ("Prescribed text", sanitize_prompt_content(ctx.prescribed_text)),
        ("Word limit", f"{ctx.word_limit.min}-{ctx.word_limit.max} words" if ctx.word_limit else None),
        ("Stimulus/source text", sanitize_prompt_content(ctx.stimulus_text)),
    ]

    if ctx.task_conditions:
        conditions = ctx.task_conditions
        condition_bits = [
            sanitize_prompt_content(conditions.label),
            f"planning: {conditions.planningMinutes} min" if conditions.planningMinutes is not None else None,
            f"writing: {conditions.writingMinutes} min" if conditions.writingMinutes is not None else None,
            sanitize_prompt_content(conditions.conditionsNote),
        ]
        fields.append(("Task conditions", "; ".join(bit for bit in condition_bits if bit)))

    if ctx.official_source:
        source_bits = [
            sanitize_prompt_content(ctx.official_source.label),
            sanitize_prompt_content(ctx.official_source.url),
            sanitize_prompt_content(ctx.official_source.note),
        ]
        fields.append(("Official/source note", "; ".join(bit for bit in source_bits if bit)))

    if ctx.writing_tips:
        fields.append((
            "Writing tips",
            "\n".join(
                f"- {sanitize_prompt_content(tip)}"
                for tip in ctx.writing_tips[:8]
                if tip
            ),
        ))

    lines = [f"{label}: {value}" for label, value in fields if value]
    if not lines:
        return ""
    return _TOPIC_CONTEXT_BLOCK.format(topic_context="\n".join(lines))


def _build_prompt(req: WritingAssessmentRequest) -> str:
    """Build the LLM prompt based on year level and prompt type."""
    age_range = {7: "12-13", 8: "13-14", 9: "14-15", 10: "15-16",
                 11: "16-17", 12: "17-18"}.get(req.year_level, "12-13")
    is_senior = req.year_level >= 11

    topic_prompt = sanitize_prompt_content(req.topic_prompt)
    draft_text = sanitize_prompt_content(req.draft_text)
    source_text = sanitize_prompt_content(req.source_text)
    writer_statement = sanitize_prompt_content(req.writer_statement)
    task_sheet_text = sanitize_prompt_content(req.task_sheet_text)
    school_ismg_text = sanitize_prompt_content(req.school_ismg_text)

    # Topic block
    topic_block = ""
    if topic_prompt:
        topic_block = _TOPIC_BLOCK.format(topic_prompt=topic_prompt)
    topic_context_block = _format_topic_context(req)

    # Precheck findings must be derived from sanitized draft content.
    precheck = precheck_text(draft_text)
    precheck_block = ""
    if precheck.get("summary"):
        precheck_block = _PRECHECK_BLOCK.format(
            precheck_summary=sanitize_prompt_content(precheck["summary"]),
        )

    # Source text block
    source_block = ""
    if source_text.strip():
        source_block = _SOURCE_TEXT_BLOCK.format(source_text=source_text)

    # Writer statement block
    writer_block = ""
    if writer_statement.strip():
        writer_block = _WRITER_STATEMENT_BLOCK.format(writer_statement=writer_statement)

    school_task_block = ""
    if is_senior and (task_sheet_text.strip() or school_ismg_text.strip()):
        school_task_block = _SCHOOL_TASK_CONTEXT_BLOCK.format(
            task_sheet_text=task_sheet_text.strip() or "Not provided.",
            school_ismg_text=school_ismg_text.strip() or "Not provided.",
        )

    if is_senior:
        prompt_key = _assessment_type_for_prompt(req.year_level, req.prompt_type)
        template = ATAR_PROMPT_MAP.get(prompt_key, ATAR_PROMPT_MAP["analytical"])
        return template.format(
            topic_block=topic_block + topic_context_block,
            draft_text=draft_text,
            source_block=source_block,
            writer_block=writer_block,
            school_task_block=school_task_block,
            content_boundary=_CONTENT_BOUNDARY_INSTRUCTION,
        )

    template = NAPLAN_PROMPT_MAP.get(req.prompt_type, NAPLAN_PROMPT_MAP["narrative"])
    return template.format(
        topic_block=topic_block + topic_context_block,
        year_level=req.year_level,
        age_range=age_range,
        draft_text=draft_text,
        precheck_block=precheck_block,
        source_block=source_block,
        content_boundary=_CONTENT_BOUNDARY_INSTRUCTION,
    )


_ITEM_KEY_ALIASES = {
    "criterionNumber": "criterion_number",
    "criterion_number": "criterion_number",
    "number": "criterion_number",
    "criterion": "name",
    "criterion_name": "name",
    "mark": "score",
    "marks": "score",
    "points": "score",
    "max": "max_score",
    "maximum": "max_score",
    "maxScore": "max_score",
    "comment": "feedback",
    "comments": "feedback",
    "reason": "feedback",
}

_CANONICAL_NAME_ALIASES: dict[str, list[str]] = {
    # TEEL
    "point / thesis": ["point", "thesis", "point/thesis", "point / thesis", "point and thesis"],
    "evidence / integration": ["evidence", "integration", "evidence/integration", "evidence / integration", "evidence and integration"],
    "explanation / analysis": ["explanation", "analysis", "explanation/analysis", "explanation / analysis", "explanation and analysis"],
    "structure / mechanics": ["structure", "mechanics", "structure/mechanics", "structure / mechanics", "structure and mechanics"],
    # ISMG
    "knowledge application": ["knowledge application", "knowledge and application", "knowledge & application"],
    "organisation and development": ["organisation and development", "organization and development", "organisation & development", "organization & development", "organisation", "organization"],
    "textual features": ["textual features", "textual feature"],
    # NAPLAN
    "audience": ["audience"],
    "text structure": ["text structure", "text structures"],
    "ideas": ["ideas", "idea"],
    "persuasive devices": ["persuasive devices", "persuasive device"],
    "character and setting": ["character and setting", "character & setting", "characters and setting", "character and settings", "characters and settings"],
    "vocabulary": ["vocabulary"],
    "cohesion": ["cohesion"],
    "paragraphing": ["paragraphing", "paragraphs"],
    "sentence structure": ["sentence structure", "sentence structures"],
    "punctuation": ["punctuation"],
    "spelling": ["spelling"],
    # Informative
    "purpose and audience": ["purpose and audience", "purpose & audience"],
    "ideas and explanation": ["ideas and explanation", "ideas & explanation"],
    "language and cohesion": ["language and cohesion", "language & cohesion"],
}


def validate_and_canonicalise_writing_scores(
    raw_scores: Any,
    year_level: int,
    prompt_type: str,
) -> list[CriterionScore]:
    """Validate raw criterion scores against canonical rubric, rejecting invalid inputs.

    Enforces:
    1. Exactly one score for each canonical criterion.
    2. Criterion identity (number and name, when both provided, must agree).
    3. Exact integer score within [0, canonical max_score] (no clamping).
    4. Non-empty feedback string.
    5. No extra, missing, or duplicate criteria.
    """
    if not isinstance(raw_scores, list):
        raise ValueError("criterion_scores must be a list")

    canonical = get_criteria_for_prompt(year_level, prompt_type)
    canonical_by_number: dict[int, dict[str, Any]] = {int(c["number"]): c for c in canonical}

    canonical_by_name: dict[str, int] = {}
    for c in canonical:
        c_num = int(c["number"])
        c_name = str(c["name"]).strip().casefold()
        canonical_by_name[c_name] = c_num
        for alias in _CANONICAL_NAME_ALIASES.get(c_name, []):
            canonical_by_name[alias.casefold()] = c_num

    if len(raw_scores) != len(canonical):
        raise ValueError(f"expected {len(canonical)} criteria, got {len(raw_scores)}")

    seen_numbers: set[int] = set()
    resolved_items: dict[int, tuple[int, str]] = {}

    for item in raw_scores:
        if not isinstance(item, dict):
            raise ValueError("each criterion item must be an object")

        mapped = {}
        for k, v in item.items():
            mapped[_ITEM_KEY_ALIASES.get(k, k)] = v

        raw_num = mapped.get("criterion_number")
        canonical_num_from_num: int | None = None
        if raw_num is not None:
            try:
                num_val = int(raw_num)
                if num_val not in canonical_by_number:
                    raise ValueError(f"unknown criterion number: {raw_num}")
                canonical_num_from_num = num_val
            except (TypeError, ValueError) as exc:
                raise ValueError(f"invalid criterion number: {raw_num}") from exc

        raw_name = mapped.get("name")
        canonical_num_from_name: int | None = None
        if raw_name is not None:
            if not isinstance(raw_name, str) or not raw_name.strip():
                raise ValueError("invalid criterion name")
            name_key = raw_name.strip().casefold()
            generic_match = re.fullmatch(r"crit(?:erion)?\.?\s*(\d+)", name_key)
            if generic_match:
                gen_num = int(generic_match.group(1))
                if gen_num in canonical_by_number:
                    canonical_num_from_name = gen_num
                else:
                    raise ValueError(f"unknown criterion number in name: {raw_name}")
            elif name_key in canonical_by_name:
                canonical_num_from_name = canonical_by_name[name_key]
            else:
                raise ValueError(f"unknown criterion name: {raw_name}")

        if canonical_num_from_num is not None and canonical_num_from_name is not None:
            if canonical_num_from_num != canonical_num_from_name:
                raise ValueError(
                    f"criterion number {canonical_num_from_num} conflicts with name '{raw_name}' (criterion {canonical_num_from_name})"
                )
            resolved_num = canonical_num_from_num
        elif canonical_num_from_num is not None:
            resolved_num = canonical_num_from_num
        elif canonical_num_from_name is not None:
            resolved_num = canonical_num_from_name
        else:
            raise ValueError("criterion item must provide a valid criterion number or name")

        if resolved_num in seen_numbers:
            raise ValueError(f"duplicate criterion number: {resolved_num}")
        seen_numbers.add(resolved_num)

        canonical_criterion = canonical_by_number[resolved_num]
        parsed_score = _parse_score_value(mapped.get("score"), canonical_criterion["max_score"])
        if parsed_score is None:
            raise ValueError(f"criterion {resolved_num} has an invalid score: {mapped.get('score')}")

        feedback = mapped.get("feedback")
        if not isinstance(feedback, str) or not feedback.strip():
            raise ValueError(f"criterion {resolved_num} has empty or invalid feedback")

        resolved_items[resolved_num] = (parsed_score, feedback.strip())

    if set(canonical_by_number.keys()) != seen_numbers:
        missing = sorted(set(canonical_by_number.keys()) - seen_numbers)
        raise ValueError(f"missing canonical criteria: {missing}")

    result: list[CriterionScore] = []
    for c in canonical:
        num = int(c["number"])
        score, fb = resolved_items[num]
        result.append(
            CriterionScore(
                criterion_number=num,
                domain=c.get("domain", "ISMG"),
                name=c["name"],
                score=score,
                max_score=c["max_score"],
                feedback=fb[:1000],
            )
        )
    return result


def align_and_validate_scores(
    raw_scores: list[dict],
    year_level: int,
    prompt_type: str,
    *,
    require_complete: bool = False,
) -> list[CriterionScore]:
    """Align valid assessor items to canonical criteria."""
    if require_complete:
        return validate_and_canonicalise_writing_scores(raw_scores, year_level, prompt_type)

    canonical = get_criteria_for_prompt(year_level, prompt_type)
    canonical_by_number: dict[int, dict[str, Any]] = {int(c["number"]): c for c in canonical}
    canonical_by_name: dict[str, int] = {}
    for c in canonical:
        c_num = int(c["number"])
        c_name = str(c["name"]).strip().casefold()
        canonical_by_name[c_name] = c_num
        for alias in _CANONICAL_NAME_ALIASES.get(c_name, []):
            canonical_by_name[alias.casefold()] = c_num

    seen_numbers: set[int] = set()
    aligned_scores: list[CriterionScore] = []

    for raw_item in raw_scores:
        if not isinstance(raw_item, dict):
            continue
        mapped = {_ITEM_KEY_ALIASES.get(k, k): v for k, v in raw_item.items()}

        raw_num = mapped.get("criterion_number")
        canonical_num_from_num = None
        if raw_num is not None:
            try:
                num_val = int(raw_num)
                if num_val in canonical_by_number:
                    canonical_num_from_num = num_val
            except (TypeError, ValueError):
                pass

        raw_name = mapped.get("name")
        canonical_num_from_name = None
        if isinstance(raw_name, str) and raw_name.strip():
            name_key = raw_name.strip().casefold()
            generic_match = re.fullmatch(r"crit(?:erion)?\.?\s*(\d+)", name_key)
            if generic_match:
                gen_num = int(generic_match.group(1))
                if gen_num in canonical_by_number:
                    canonical_num_from_name = gen_num
            elif name_key in canonical_by_name:
                canonical_num_from_name = canonical_by_name[name_key]

        if canonical_num_from_num is not None and canonical_num_from_name is not None:
            if canonical_num_from_num != canonical_num_from_name:
                continue
            resolved_num = canonical_num_from_num
        elif canonical_num_from_num is not None:
            resolved_num = canonical_num_from_num
        elif canonical_num_from_name is not None:
            resolved_num = canonical_num_from_name
        else:
            continue

        if resolved_num in seen_numbers:
            continue
        seen_numbers.add(resolved_num)

        canonical_criterion = canonical_by_number[resolved_num]
        parsed_score = _parse_score_value(mapped.get("score"), canonical_criterion["max_score"])
        if parsed_score is None:
            continue

        feedback = mapped.get("feedback")
        if not isinstance(feedback, str) or not feedback.strip():
            continue

        aligned_scores.append(
            CriterionScore(
                criterion_number=resolved_num,
                domain=canonical_criterion.get("domain", "ISMG"),
                name=canonical_criterion["name"],
                score=parsed_score,
                max_score=canonical_criterion["max_score"],
                feedback=feedback.strip()[:1000],
            )
        )
    return aligned_scores


def _missing_criterion_numbers(
    raw_scores: Any,
    year_level: int,
    prompt_type: str,
) -> list[int]:
    """Return canonical criteria numbers that are missing or invalid."""
    try:
        validate_and_canonicalise_writing_scores(raw_scores, year_level, prompt_type)
        return []
    except Exception:
        canonical = get_criteria_for_prompt(year_level, prompt_type)
        canonical_numbers = {int(item["number"]) for item in canonical}
        if not isinstance(raw_scores, list):
            return sorted(canonical_numbers)

        valid_numbers: set[int] = set()
        canonical_by_number = {int(item["number"]): item for item in canonical}
        canonical_by_name: dict[str, int] = {}
        for c in canonical:
            c_num = int(c["number"])
            c_name = str(c["name"]).strip().casefold()
            canonical_by_name[c_name] = c_num
            for alias in _CANONICAL_NAME_ALIASES.get(c_name, []):
                canonical_by_name[alias.casefold()] = c_num

        duplicate_numbers: set[int] = set()
        for item in raw_scores:
            if not isinstance(item, dict):
                continue
            mapped = {_ITEM_KEY_ALIASES.get(k, k): v for k, v in item.items()}
            raw_num = mapped.get("criterion_number")
            num_from_num = None
            if raw_num is not None:
                try:
                    n = int(raw_num)
                    if n in canonical_by_number:
                        num_from_num = n
                except (TypeError, ValueError):
                    pass
            raw_name = mapped.get("name")
            num_from_name = None
            if isinstance(raw_name, str) and raw_name.strip():
                name_key = raw_name.strip().casefold()
                generic_match = re.fullmatch(r"crit(?:erion)?\.?\s*(\d+)", name_key)
                if generic_match:
                    gen_num = int(generic_match.group(1))
                    if gen_num in canonical_by_number:
                        num_from_name = gen_num
                elif name_key in canonical_by_name:
                    num_from_name = canonical_by_name[name_key]

            if num_from_num is not None and num_from_name is not None:
                if num_from_num != num_from_name:
                    continue  # conflict
                res_num = num_from_num
            elif num_from_num is not None:
                res_num = num_from_num
            elif num_from_name is not None:
                res_num = num_from_name
            else:
                continue

            if res_num in valid_numbers or res_num in duplicate_numbers:
                valid_numbers.discard(res_num)
                duplicate_numbers.add(res_num)
                continue

            criterion = canonical_by_number[res_num]
            score = _parse_score_value(mapped.get("score"), criterion["max_score"])
            feedback = mapped.get("feedback")
            if score is not None and isinstance(feedback, str) and feedback.strip():
                valid_numbers.add(res_num)

        return sorted(canonical_numbers - valid_numbers)


_SENIOR_REMEDIATION_BY_PROMPT: dict[str, dict[int, list[str]]] = {
    "analytical": {
        1: ["QCAA_ENGLISH_U4_T1", "QCAA_ENGLISH_U3_T1"],
        2: ["QCAA_ENGLISH_U4_T1"],
        3: ["QCAA_ENGLISH_U3_T3"],
    },
    "persuasive": {
        1: ["QCAA_ENGLISH_U3_T1"],
        2: ["QCAA_ENGLISH_U3_T2"],
        3: ["QCAA_ENGLISH_U3_T3"],
    },
    "narrative": {
        1: ["QCAA_ENGLISH_U4_T2"],
        2: ["QCAA_ENGLISH_U4_T2"],
        3: ["QCAA_ENGLISH_U3_T3"],
    },
}


def _get_senior_writing_remediation_links(
    aligned_scores: list[CriterionScore],
    prompt_type: str,
) -> list[str]:
    """Map senior ISMG weak criteria to QCAA senior English writing-skill topics."""
    criterion_map = _SENIOR_REMEDIATION_BY_PROMPT.get(
        prompt_type,
        _SENIOR_REMEDIATION_BY_PROMPT["analytical"],
    )
    scored = [
        (cs.score / cs.max_score if cs.max_score else 0, cs)
        for cs in aligned_scores
    ]
    weak = [item for item in scored if item[0] < 0.6]
    targets = sorted(weak or scored, key=lambda item: item[0])[:2]

    links: list[str] = []
    for _, criterion in targets:
        for topic_id in criterion_map.get(criterion.criterion_number, []):
            if topic_id not in links:
                links.append(topic_id)
    return links


def clean_and_locate_highlights(
    raw_highlights: list[dict],
    draft_text: str,
    year_level: int,
    prompt_type: str,
) -> list[Highlight]:
    """Clean highlights and locate their exact character offsets in the draft text.

    LLMs often hallucinate start/end indices. This function finds the actual
    snippet matching draft_text, adjusting offsets to keep the frontend happy.
    """
    clean_highlights = []
    lower_draft = draft_text.lower()
    allowed_criteria = {c["number"] for c in get_criteria_for_prompt(year_level, prompt_type)}
    # Track already-located spans so a repeated snippet maps to its next
    # unused occurrence rather than always the first (Audit W3).
    claimed: list[tuple[int, int]] = []

    def _overlaps(start: int, end: int) -> bool:
        return any(start < c_end and c_start < end for c_start, c_end in claimed)

    def _find_unclaimed(needle: str) -> int:
        if not needle:
            return -1
        pos = lower_draft.find(needle)
        while pos != -1:
            if not _overlaps(pos, pos + len(needle)):
                return pos
            pos = lower_draft.find(needle, pos + 1)
        return -1

    for h in raw_highlights:
        if not isinstance(h, dict):
            continue

        criterion_number = h.get("criterion_number")
        text_snippet = h.get("text_snippet")
        issue_type = h.get("issue_type") or "style_suggestion"
        suggestion = h.get("suggestion")

        if not criterion_number or not text_snippet or not suggestion:
            continue

        try:
            crit_num = int(criterion_number)
            if crit_num not in allowed_criteria:
                continue
        except (ValueError, TypeError):
            continue

        snippet_str = str(text_snippet).strip()
        suggestion_str = str(suggestion).strip()
        if not snippet_str or not suggestion_str:
            continue

        start_index = end_index = -1
        exact_snippet = ""

        idx = _find_unclaimed(snippet_str.lower())
        if idx != -1:
            exact_snippet = draft_text[idx : idx + len(snippet_str)]
            start_index = idx
            end_index = idx + len(snippet_str)
        else:
            stripped_snippet = snippet_str.strip('"\' ')
            idx = _find_unclaimed(stripped_snippet.lower()) if stripped_snippet else -1
            if idx != -1:
                exact_snippet = draft_text[idx : idx + len(stripped_snippet)]
                start_index = idx
                end_index = idx + len(stripped_snippet)
            else:
                import re
                words = [w for w in re.split(r'\W+', snippet_str) if w]
                pattern = None
                if len(words) >= 2:
                    pattern = r'\b' + r'\b\W+\b'.join(re.escape(w) for w in words) + r'\b'
                elif len(words) == 1:
                    pattern = r'\b' + re.escape(words[0]) + r'\b'
                if pattern:
                    for match in re.finditer(pattern, draft_text, re.IGNORECASE):
                        if not _overlaps(match.start(), match.end()):
                            exact_snippet = match.group(0)
                            start_index = match.start()
                            end_index = match.end()
                            break
                if start_index == -1:
                    continue

        try:
            clean_highlights.append(
                Highlight(
                    criterion_number=crit_num,
                    text_snippet=exact_snippet,
                    start_index=start_index,
                    end_index=end_index,
                    issue_type=str(issue_type)[:100],
                    suggestion=suggestion_str[:500],
                )
            )
            claimed.append((start_index, end_index))
        except Exception:
            pass

    return clean_highlights


def _fallback_strength(aligned_scores: list[CriterionScore]) -> str:
    best = max(aligned_scores, key=lambda cs: (cs.score / cs.max_score) if cs.max_score else 0, default=None)
    if best and best.score > 0:
        return f"Your strongest area is {best.name.lower()}; keep using this as a base for revision."
    return "You have a draft to work with, which gives us a starting point for targeted revision."


def _fallback_next_step(aligned_scores: list[CriterionScore]) -> dict[str, str]:
    weakest = min(aligned_scores, key=lambda cs: (cs.score / cs.max_score) if cs.max_score else 0, default=None)
    goal = f"Improve {weakest.name.lower()}" if weakest else "Revise one priority skill"
    return {
        "priority_goal": goal,
        "why_it_matters": "Focused revision helps you improve the clarity, control, and impact of your writing.",
        "recommendation": "Choose one paragraph and revise it using the criterion feedback before changing the whole draft.",
    }


def _fallback_revision_plan(aligned_scores: list[CriterionScore]) -> list[dict[str, Any]]:
    weakest = sorted(
        aligned_scores,
        key=lambda cs: (cs.score / cs.max_score) if cs.max_score else 0,
    )[:3]
    if not weakest:
        return [{
            "priority": 1,
            "target": "Revise one paragraph",
            "why": "Focused paragraph revision is the fastest way to make the draft clearer.",
            "how": "Choose one paragraph, check that it has one main idea, and add a specific example or detail.",
            "example_revision": None,
            "success_criteria": ["The paragraph has one clear main idea.", "It includes a specific detail or example.", "The sentence punctuation is controlled."],
        }]
    return [
        {
            "priority": idx,
            "target": f"Improve {cs.name.lower()}",
            "why": cs.feedback or "This criterion is limiting the overall effectiveness of the draft.",
            "how": "Revise one paragraph with this criterion in mind before making whole-draft changes.",
            "example_revision": None,
            "success_criteria": [
                f"A stronger revision clearly improves {cs.name.lower()}.",
                "The change is visible in one specific paragraph or sentence.",
            ],
        }
        for idx, cs in enumerate(weakest, start=1)
    ]


def _fallback_paragraph_feedback() -> dict[str, str]:
    return {
        "strongest_paragraph": "Look for the paragraph with the clearest main idea and use it as a model.",
        "paragraph_to_revise_first": "Start with the paragraph that feels least developed or least connected to the prompt.",
        "sentence_level_improvement": "Choose one long or unclear sentence and split it into clearer parts.",
    }


def _parse_revision_plan(raw_items: Any, aligned_scores: list[CriterionScore]):
    from core.schema.writing_schema import RevisionPlanItem

    items = []
    if isinstance(raw_items, list):
        for idx, item in enumerate(raw_items[:3], start=1):
            if not isinstance(item, dict):
                continue
            target = str(item.get("target") or item.get("priority_goal") or "").strip()
            why = str(item.get("why") or item.get("why_it_matters") or "").strip()
            how = str(item.get("how") or item.get("recommendation") or "").strip()
            raw_success = item.get("success_criteria") or item.get("revision_success_criteria") or []
            if isinstance(raw_success, str):
                raw_success = [raw_success]
            if not isinstance(raw_success, list):
                raw_success = []
            if not target or not how:
                continue
            try:
                items.append(
                    RevisionPlanItem(
                        priority=int(item.get("priority") or idx),
                        target=target,
                        why=why or "This change will make the draft clearer and more effective.",
                        how=how,
                        example_revision=(
                            str(item.get("example_revision")).strip()
                            if item.get("example_revision") else None
                        ),
                        success_criteria=[
                            str(sc).strip()[:200]
                            for sc in raw_success
                            if str(sc).strip()
                        ][:3],
                    )
                )
            except Exception:
                pass
    if not items:
        items = [RevisionPlanItem(**item) for item in _fallback_revision_plan(aligned_scores)]
    return items


def _parse_paragraph_feedback(raw_feedback: Any):
    from core.schema.writing_schema import ParagraphFeedback

    if isinstance(raw_feedback, dict):
        strongest = str(raw_feedback.get("strongest_paragraph") or "").strip()
        revise = str(raw_feedback.get("paragraph_to_revise_first") or "").strip()
        sentence = str(raw_feedback.get("sentence_level_improvement") or "").strip()
        if strongest or revise or sentence:
            return ParagraphFeedback(
                strongest_paragraph=strongest,
                paragraph_to_revise_first=revise,
                sentence_level_improvement=sentence,
            )
    return ParagraphFeedback(**_fallback_paragraph_feedback())


def _parse_source_use_feedback(raw_feedback: Any, req: WritingAssessmentRequest):
    if req.prompt_type != "analytical":
        return None
    from core.schema.writing_schema import SourceUseFeedback

    likely_uses_evidence = _draft_likely_uses_source_evidence(req.draft_text, req.source_text)
    if isinstance(raw_feedback, dict):
        uses_source_evidence = bool(raw_feedback.get("uses_source_evidence")) or likely_uses_evidence
        missing = str(raw_feedback.get("missing_or_misread_evidence") or "").strip()[:500]
        tip = str(raw_feedback.get("quote_integration_tip") or "").strip()[:500]
        if not uses_source_evidence:
            missing = missing or "The draft does not yet use a precise quotation, paraphrase, or source detail to support the analysis."
            tip = tip or "Embed one short source detail, then explain how its language or idea supports your point."
        return SourceUseFeedback(
            uses_source_evidence=uses_source_evidence,
            best_evidence_used=str(raw_feedback.get("best_evidence_used") or "").strip()[:500],
            missing_or_misread_evidence=missing,
            quote_integration_tip=tip,
        )
    return SourceUseFeedback(
        uses_source_evidence=likely_uses_evidence,
        best_evidence_used="",
        missing_or_misread_evidence=(
            "" if likely_uses_evidence
            else "The draft does not yet use a precise quotation, paraphrase, or source detail to support the analysis."
        ),
        quote_integration_tip="Introduce short evidence, then explain how it supports your point rather than dropping it into the paragraph.",
    )


def _draft_likely_uses_source_evidence(draft_text: str, source_text: str) -> bool:
    """True only when draft evidence overlaps the supplied stimulus.

    Quotation marks alone are not enough — invented quotes must fail.
    """
    import re as _re
    import unicodedata

    def _norm(text: str) -> str:
        folded = unicodedata.normalize("NFKC", text or "").lower()
        return _re.sub(r"\s+", " ", folded).strip()

    draft = _norm(draft_text)
    source = _norm(source_text)
    if not draft or not source:
        return False

    # Quoted spans must appear (approximately) in the source.
    quoted_spans = _re.findall(r'"([^"]{4,})"|“([^”]{4,})”|\'([^\']{4,})\'', draft_text)
    for groups in quoted_spans:
        span = next((g for g in groups if g), "").strip()
        if not span:
            continue
        span_n = _norm(span)
        if len(span_n) >= 6 and span_n in source:
            return True
        # Soft match: most content words from the quote appear in source order-ish.
        span_terms = [t for t in _re.findall(r"[a-z]{4,}", span_n)]
        if span_terms and sum(1 for t in span_terms if t in source) >= max(2, int(0.6 * len(span_terms))):
            return True

    # Paraphrase path: shared content terms (not mere punctuation).
    stop = {
        "there", "their", "which", "would", "could", "about", "through", "because",
        "these", "those", "where", "while", "after", "before", "other", "being",
    }
    source_terms = {token for token in _re.findall(r"[a-z]{5,}", source) if token not in stop}
    draft_terms = {token for token in _re.findall(r"[a-z]{5,}", draft) if token not in stop}
    return len(source_terms & draft_terms) >= 3


def _apply_source_evidence_warning(
    aligned_scores: list[CriterionScore],
    source_use_feedback: Any,
    req: WritingAssessmentRequest,
) -> None:
    if req.prompt_type != "analytical" or not source_use_feedback:
        return
    if getattr(source_use_feedback, "uses_source_evidence", False):
        return
    warning = (
        " Evidence is a priority: this draft does not yet use a precise quotation, "
        "paraphrase, or source detail to support the analysis."
    )
    for cs in aligned_scores:
        name = cs.name.lower()
        if cs.criterion_number in {1, 2} or "evidence" in name or "knowledge" in name:
            if "does not yet use a precise" not in cs.feedback:
                cs.feedback = (cs.feedback.rstrip() + warning)[:1000]
            return


# Quoted spans in criterion feedback: straight or curly double quotes, curly
# single quotes, and straight single quotes that are not apostrophes. An
# apostrophe inside a quote (didn't) is allowed when a letter follows it.
_FEEDBACK_QUOTE_RE = re.compile(
    r'"([^"\n]+)"'
    r"|“([^”\n]+)”"
    r"|‘((?:[^’\n]|’(?=[A-Za-z]))+)’"
    r"|(?<![A-Za-z0-9])'((?:[^'\n]|'(?=[A-Za-z]))+?)'(?![A-Za-z0-9])"
)
_QUOTE_ELLIPSIS_RE = re.compile(r"\[?(?:\.\.\.|…)\]?")
# Text just before a quote that marks suggested new wording, not draft evidence.
_SUGGESTION_CUE_RE = re.compile(
    r"(?:\b(?:try|instead|such as|e\.g\.?|for example|for instance|like|consider|rewrite|"
    r"replace|change|to|with|as|write|say|add|use|using)|->|→)\s*[:,]?\s*$",
    re.IGNORECASE,
)


def _quote_match_text(text: str) -> str:
    """Lower-case, straight-quote, single-space form used to match quotes."""
    text = text.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    return " ".join(text.lower().split())


def _flag_unverified_quotes(
    aligned_scores: list[CriterionScore],
    req: WritingAssessmentRequest,
) -> None:
    """Record feedback quotes that are not in the draft or the task texts.

    The prompt tells the model to quote only exact draft or source words. A
    quote of four or more words that is in none of the supplied texts cannot
    be checked by the student, so the UI warns about it.
    """
    context = req.topic_context
    texts = [
        req.draft_text, req.source_text, req.writer_statement, req.topic_prompt or "",
        req.task_sheet_text, req.school_ismg_text,
    ]
    if context is not None:
        texts += [
            context.stimulus_text or "", context.context or "",
            context.prescribed_text or "", context.topic_title or "",
        ]
    haystack = "\n".join(_quote_match_text(text) for text in texts if text)
    for cs in aligned_scores:
        flagged: list[str] = []
        for match in _FEEDBACK_QUOTE_RE.finditer(cs.feedback):
            quote = next(group for group in match.groups() if group is not None).strip()
            if len(quote.split()) < 4:
                continue  # Short terms are often rubric or craft words, not draft evidence.
            if _SUGGESTION_CUE_RE.search(cs.feedback[max(0, match.start() - 30):match.start()]):
                continue
            parts = [
                _quote_match_text(part).strip(" .,;:!?'\"")
                for part in _QUOTE_ELLIPSIS_RE.split(quote)
            ]
            parts = [part for part in parts if part]
            if parts and not all(part in haystack for part in parts) and quote[:300] not in flagged:
                flagged.append(quote[:300])
        cs.unverified_quotes = flagged[:3]


def _build_writing_skill_drills(aligned_scores: list[CriterionScore], prompt_type: str):
    from core.schema.writing_schema import WritingSkillDrill

    weakest = sorted(
        aligned_scores,
        key=lambda cs: (cs.score / cs.max_score) if cs.max_score else 0,
    )[:3]
    drills = []
    for cs in weakest:
        drill_prompt, practice_tip = _drill_for_criterion(cs.name, prompt_type)
        drills.append(WritingSkillDrill(
            criterion_number=cs.criterion_number,
            skill=cs.name,
            drill_prompt=drill_prompt,
            practice_tip=practice_tip,
        ))
    return drills


def _drill_for_criterion(criterion_name: str, prompt_type: str) -> tuple[str, str]:
    name = criterion_name.lower()
    if "cohesion" in name:
        return (
            "Revise one paragraph by adding two meaningful links that show cause, contrast, sequence, or emphasis.",
            "Avoid decorative transitions. Each link should clarify the relationship between two ideas.",
        )
    if "evidence" in name or "knowledge" in name or "analysis" in name:
        return (
            "Choose one claim, embed one short quotation or precise detail, then add two sentences explaining its effect.",
            "Use the pattern: point -> evidence -> effect -> link to the prompt.",
        )
    if "character" in name or "setting" in name:
        return (
            "Rewrite one story moment using action, dialogue, and one sensory detail to reveal character or setting.",
            "Show the reader what changes in the scene instead of naming the emotion directly.",
        )
    if "persuasive" in name or (prompt_type == "persuasive" and "device" in name):
        return (
            "Revise one argument by adding a rhetorical question, a concrete example, and a sentence explaining why the audience should care.",
            "Persuasive devices work best when they support a reason, not when they are added as decoration.",
        )
    if "vocabulary" in name or "textual features" in name or "language" in name:
        return (
            "Replace five vague words with precise choices, then vary one sentence opening to improve rhythm and control.",
            "Keep the meaning clear first; ambitious vocabulary only helps when it is accurate.",
        )
    if "paragraph" in name or "structure" in name or "organisation" in name:
        return (
            "Rebuild one paragraph so it has one main idea, supporting evidence/detail, explanation, and a final link.",
            "If the paragraph changes topic halfway through, split it or add a clearer topic sentence.",
        )
    if "punctuation" in name or "sentence" in name or "spelling" in name or "mechanics" in name:
        return (
            "Choose three long or error-prone sentences, split or punctuate them, then reread for one spelling pattern to fix.",
            "Small sentence-control edits can lift clarity without rewriting the whole draft.",
        )
    if prompt_type == "expository":
        return (
            "Add one definition, one concrete example, and one cause/effect explanation to a body section.",
            "Expository writing improves when the reader can see how and why the facts matter.",
        )
    return (
        f"Revise one paragraph to make {criterion_name.lower()} visible in the draft.",
        "Make one specific change, then check whether a reader could point to it in the paragraph.",
    )


def _parse_task_alignment_warnings(raw_items: Any, req: WritingAssessmentRequest) -> list[str]:
    if req.year_level < 11 and not req.task_sheet_text.strip() and not req.school_ismg_text.strip():
        return []
    warnings: list[str] = []
    if isinstance(raw_items, list):
        for item in raw_items[:5]:
            text = str(item).strip()
            if text:
                warnings.append(text[:300])
    elif isinstance(raw_items, str) and raw_items.strip():
        warnings.append(raw_items.strip()[:300])
    if req.year_level >= 11 and (req.task_sheet_text.strip() or req.school_ismg_text.strip()) and not warnings:
        warnings.append(
            "Check your draft against the pasted school task sheet/ISMG for required genre, audience, conditions, and criteria before submitting officially."
        )
    return warnings


def _topic_min_word_count(req: WritingAssessmentRequest) -> int | None:
    """Return the authored task evidence floor, if there is one.

    An authored topic's own word limit wins, so a client cannot lower the
    floor. Custom tasks fall back to the word limit sent with the request.
    """
    topic = _get_topic_metadata(req.topic_id)
    topic_limit = topic.get("wordLimit") if isinstance(topic, dict) else None
    raw_min = topic_limit.get("min") if isinstance(topic_limit, dict) else None
    context = req.topic_context
    if raw_min is None and context is not None:
        word_limit = getattr(context, "word_limit", None)
        if isinstance(word_limit, dict):
            raw_min = word_limit.get("min")
        else:
            raw_min = getattr(word_limit, "min", None)
    try:
        return int(raw_min) if raw_min is not None else None
    except (TypeError, ValueError):
        return None


def _insufficient_evidence_response(
    req: WritingAssessmentRequest,
    *,
    llm_status: str,
    source: str | None = None,
) -> dict[str, Any]:
    """Build a non-scored response for drafts below the task evidence floor."""
    from core.schema.writing_schema import NextLearningStep

    word_count = len((req.draft_text or "").split())
    topic_min = _topic_min_word_count(req) or (80 if req.year_level >= 11 else 50)
    guidance = (
        f"This draft has about {word_count} words, but the task asks for at least "
        f"{topic_min}. Expand your ideas with more evidence and explanation before scoring."
    )
    criteria = get_criteria_for_prompt(req.year_level, req.prompt_type)
    max_total = sum(c["max_score"] for c in criteria) or 1
    response = {
        "is_senior": req.year_level >= 11,
        "total_score": 0,
        "max_total_score": max_total,
        "estimated_band": None,
        "criterion_scores": [],
        "highlights": [],
        "remediation_links": [],
        "overall_feedback": guidance,
        "strengths": [],
        "next_learning_steps": [
            NextLearningStep(
                priority_goal=f"Write at least {topic_min} words for this task",
                why_it_matters=(
                    "Scoring against the full rubric needs enough developed text "
                    "to judge structure, evidence, and language control."
                ),
                recommendation=(
                    f"Expand this draft from about {word_count} words to at least "
                    f"{topic_min}, adding one more paragraph with a clear point and support."
                ),
            ).model_dump(),
            NextLearningStep(
                priority_goal="Develop one body paragraph with evidence",
                why_it_matters="Short drafts often lack the explanation markers the rubric rewards.",
                recommendation=(
                    "Add one more developed paragraph with a clear point, evidence or detail, "
                    "and a sentence that explains why it matters."
                ),
            ).model_dump(),
        ],
        "revision_plan": [],
        "paragraph_feedback": None,
        "source_use_feedback": None,
        "writing_skill_drills": [],
        "task_alignment_warnings": [guidance],
        "writer_statement_feedback": "",
        "cognitive_verb_scores": [],
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "revision_of": req.revision_of,
        "llm_status": llm_status,
        "insufficient_evidence": True,
    }
    if source:
        response["source"] = source
    return response


def _assemble_writing_response(
    req: WritingAssessmentRequest,
    result: dict[str, Any],
    *,
    llm_status: str,
    source: str | None = None,
) -> dict:
    """Turn a parsed assessment dict into the full, validated API response.

    Shared by the live LLM path (`writing_assess`) and the bring-your-own-LLM
    import path (`import_external_result`) so both produce identical,
    rubric-aligned output. Does NOT persist — the caller saves the log.
    """
    topic_min = _topic_min_word_count(req)
    if topic_min is not None and len((req.draft_text or "").split()) < topic_min:
        return _insufficient_evidence_response(
            req,
            llm_status=llm_status,
            source=source,
        )

    from core.schema.writing_schema import CognitiveVerbScore, NextLearningStep

    is_senior = req.year_level >= 11

    aligned_scores = align_and_validate_scores(
        result.get("criterion_scores", []),
        req.year_level,
        req.prompt_type,
        require_complete=True,
    )

    criteria = get_criteria_for_prompt(req.year_level, req.prompt_type)
    max_total = sum(c["max_score"] for c in criteria)
    total_score = min(sum(cs.score for cs in aligned_scores), max_total)

    highlights = clean_and_locate_highlights(
        result.get("highlights", []),
        req.draft_text,
        req.year_level,
        req.prompt_type,
    )

    cognitive_verb_scores = []
    for cvs in result.get("cognitive_verb_scores", []):
        if isinstance(cvs, dict) and "verb" in cvs and "score" in cvs:
            try:
                score = _parse_score_value(cvs.get("score"), 5)
                if score is None:
                    score = 0
                criterion_numbers = cvs.get("criterion_numbers", [])
                if not isinstance(criterion_numbers, list):
                    criterion_numbers = []
                cognitive_verb_scores.append(
                    CognitiveVerbScore(
                        verb=cvs["verb"],
                        score=score,
                        feedback=(cvs.get("feedback", "").strip() or "Demonstrated at this level."),
                        criterion_numbers=[int(n) for n in criterion_numbers],
                    )
                )
            except Exception:
                pass

    strengths = [s.strip() for s in result.get("strengths", []) if isinstance(s, str) and s.strip()]
    if not strengths:
        strengths.append(_fallback_strength(aligned_scores))

    next_learning_steps = []
    for step in result.get("next_learning_steps", []):
        if isinstance(step, dict) and step.get("priority_goal"):
            try:
                next_learning_steps.append(
                    NextLearningStep(
                        priority_goal=step.get("priority_goal", "").strip(),
                        why_it_matters=step.get("why_it_matters", "").strip() or "This skill is key to improving the clarity and impact of your writing.",
                        recommendation=step.get("recommendation", "").strip() or "Practice writing sentences focused on this goal.",
                    )
                )
            except Exception:
                pass
    if not next_learning_steps:
        next_learning_steps.append(NextLearningStep(**_fallback_next_step(aligned_scores)))

    overall_feedback = result.get("overall_feedback")
    if not isinstance(overall_feedback, str):
        overall_feedback = ""
    overall_feedback = overall_feedback.strip()
    if not overall_feedback:
        overall_feedback = (
            "Assessment feedback was limited, but your criterion scores still show where to focus next. "
            "Start with the highest-priority next learning step and revise one paragraph at a time."
        )

    revision_plan = _parse_revision_plan(result.get("revision_plan"), aligned_scores)
    paragraph_feedback = _parse_paragraph_feedback(result.get("paragraph_feedback"))
    source_use_feedback = _parse_source_use_feedback(result.get("source_use_feedback"), req)
    _apply_source_evidence_warning(aligned_scores, source_use_feedback, req)
    _flag_unverified_quotes(aligned_scores, req)
    writing_skill_drills = _build_writing_skill_drills(aligned_scores, req.prompt_type)
    task_alignment_warnings = _parse_task_alignment_warnings(result.get("task_alignment_warnings"), req)

    writer_statement_feedback = result.get("writer_statement_feedback")
    if not isinstance(writer_statement_feedback, str):
        writer_statement_feedback = ""

    if is_senior:
        remediation = _get_senior_writing_remediation_links(aligned_scores, req.prompt_type)
        response_obj = WritingAssessmentResponse(
            is_senior=True,
            total_score=total_score,
            max_total_score=max_total,
            estimated_band=None,
            criterion_scores=aligned_scores,
            highlights=highlights,
            remediation_links=remediation,
            overall_feedback=overall_feedback,
            strengths=strengths,
            next_learning_steps=next_learning_steps,
            revision_plan=revision_plan,
            paragraph_feedback=paragraph_feedback,
            source_use_feedback=source_use_feedback,
            writing_skill_drills=writing_skill_drills,
            task_alignment_warnings=task_alignment_warnings,
            writer_statement_feedback=writer_statement_feedback,
            cognitive_verb_scores=cognitive_verb_scores,
        )
    else:
        remediation = get_remediation_links(aligned_scores, year_level=req.year_level)
        response_obj = WritingAssessmentResponse(
            is_senior=False,
            total_score=total_score,
            max_total_score=max_total,
            estimated_band=None,
            criterion_scores=aligned_scores,
            highlights=highlights,
            remediation_links=remediation,
            overall_feedback=overall_feedback,
            strengths=strengths,
            next_learning_steps=next_learning_steps,
            revision_plan=revision_plan,
            paragraph_feedback=paragraph_feedback,
            source_use_feedback=source_use_feedback,
            writing_skill_drills=writing_skill_drills,
            task_alignment_warnings=task_alignment_warnings,
            writer_statement_feedback="",
            cognitive_verb_scores=[],
        )

    response = response_obj.model_dump()
    response["timestamp"] = datetime.now(timezone.utc).isoformat()
    response["revision_of"] = req.revision_of
    response["llm_status"] = llm_status
    if source:
        response["source"] = source
    return response


async def _request_is_disconnected(request: Request) -> bool:
    try:
        return await request.is_disconnected()
    except RuntimeError:
        return False


def _writing_total_timeout() -> float:
    # Keep the server deadline below the browser's fixed 190-second wait.
    return min(180.0, max(1.0, float(os.getenv("WRITING_TOTAL_TIMEOUT", "180"))))


def _writing_provider_timeout() -> float:
    return max(1.0, float(os.getenv("WRITING_TIMEOUT", "120")))


def _remaining_writing_time(deadline: float) -> float:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("Writing assessment exceeded its end-to-end deadline")
    return remaining


async def _assess_live_writing(
    req: WritingAssessmentRequest,
    student_id: str,
    request: Request,
    engine: Any,
) -> dict[str, Any]:
    prompt = _build_prompt(req)
    call_id = str(uuid.uuid4())[:8]
    start = time.monotonic()
    deadline = start + _writing_total_timeout()
    try:
        from backend.tutor_engine import _record_llm_health

        initial_timeout = min(_writing_provider_timeout(), _remaining_writing_time(deadline))
        raw = await run_in_threadpool(
            _call_llm_writing,
            engine,
            prompt,
            timeout=initial_timeout,
        )
        retry_reason = ""
        try:
            result = _parse_writing_response(raw)
        except Exception as parse_exc:
            logger.warning(
                "Writing assessment JSON parse failed (%s).",
                type(parse_exc).__name__,
            )
            result = None
            retry_reason = "unparseable JSON"

        if result is not None:
            initial_missing = _missing_criterion_numbers(
                result.get("criterion_scores"),
                req.year_level,
                req.prompt_type,
            )
            if initial_missing:
                retry_reason = "missing criteria " + ", ".join(
                    str(number) for number in initial_missing
                )

        if retry_reason:
            if await _request_is_disconnected(request):
                raise _WritingClientDisconnected(
                    "client disconnected before compact Writing re-assessment"
                )
            logger.warning(
                "Writing assessment response was incomplete (%s); attempting one compact re-assessment.",
                retry_reason,
            )
            retry_timeout = min(_writing_provider_timeout(), _remaining_writing_time(deadline))
            result = await run_in_threadpool(
                _compact_reassess_writing,
                engine,
                prompt,
                req,
                timeout=retry_timeout,
            )

        missing_criteria = _missing_criterion_numbers(
            result.get("criterion_scores"),
            req.year_level,
            req.prompt_type,
        )
        if missing_criteria:
            logger.error(
                "Writing assessment response omitted canonical criteria: %s",
                missing_criteria,
            )
            raise ValueError(
                "Writing assessor response was incomplete; missing criteria "
                + ", ".join(str(number) for number in missing_criteria)
            )

        _remaining_writing_time(deadline)
        if await _request_is_disconnected(request):
            raise _WritingClientDisconnected(
                "client disconnected before Writing assessment persistence"
            )

        response = _assemble_writing_response(req, result, llm_status="live")
        if req.assessment_request_id:
            response["assessment_request_id"] = req.assessment_request_id
        if await _request_is_disconnected(request):
            raise _WritingClientDisconnected(
                "client disconnected before Writing assessment persistence"
            )
        _record_llm_health("success", call_id, (time.monotonic() - start) * 1000)
    except _WritingClientDisconnected as exc:
        try:
            from backend.tutor_engine import _record_llm_health
            _record_llm_health(
                "failure",
                call_id,
                (time.monotonic() - start) * 1000,
                exc_class=type(exc).__name__,
            )
        except Exception:
            pass
        logger.info("Writing assessment stopped without saving: %s", exc)
        raise HTTPException(
            status_code=499,
            detail={
                "error": "writing_request_cancelled",
                "message": "The Writing assessment request was cancelled before it could be saved.",
            },
        )
    except Exception as exc:
        try:
            from backend.tutor_engine import _record_llm_health
            _record_llm_health(
                "failure",
                call_id,
                (time.monotonic() - start) * 1000,
                exc_class=type(exc).__name__,
            )
        except Exception:
            pass
        logger.error("Writing assessment LLM call failed: %s", exc)
        raise HTTPException(
            status_code=503,
            detail={
                "error": "writing_assessment_failed",
                "message": (
                    "Unable to assess writing right now. Your draft is still saved in the editor "
                    "— wait a moment, then try assessing it again."
                ),
            },
        )

    try:
        response["portfolio_saved"] = await run_in_threadpool(
            _save_writing_log,
            student_id,
            req,
            response,
        )
    except _WritingRequestIdConflict as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "writing_request_id_conflict",
                "message": str(exc),
            },
        )
    return response


@router.post("/assess")
async def writing_assess(
    req: WritingAssessmentRequest,
    request: Request,
    student_id: str = Depends(rate_limit_dependency("POST", "/api/tutor/writing/assess")),
):
    """Assess a student's writing draft against a differentiated rubric."""
    engine = get_tutor_engine()
    is_senior = req.year_level >= 11

    # Task-specific word floor: guidance without a pseudo-score when too short.
    topic_min = _topic_min_word_count(req)
    if topic_min is not None and len((req.draft_text or "").split()) < topic_min:
        response = _insufficient_evidence_response(req, llm_status="skipped")
        if req.assessment_request_id:
            response["assessment_request_id"] = req.assessment_request_id
        return response

    if not engine.client:
        precheck = precheck_text(req.draft_text)
        response = _mock_assessment(req, is_senior, precheck)
        response["timestamp"] = datetime.now(timezone.utc).isoformat()
        response["revision_of"] = req.revision_of
        response["llm_status"] = "mock"
        if req.assessment_request_id:
            response["assessment_request_id"] = req.assessment_request_id
        response["portfolio_saved"] = await run_in_threadpool(
            _save_writing_log,
            student_id,
            req,
            response,
        )
        return response

    request_id = req.assessment_request_id
    if not request_id:
        return await _assess_live_writing(req, student_id, request, engine)

    request_lock = _writing_request_lock_for(student_id, request_id)
    async with request_lock:
        try:
            persisted = await run_in_threadpool(_persisted_writing_response, student_id, req)
        except _WritingRequestIdConflict as exc:
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "writing_request_id_conflict",
                    "message": str(exc),
                },
            )
        if persisted is not None:
            return persisted
        return await _assess_live_writing(req, student_id, request, engine)


def _save_writing_log(student_id: str, req: WritingAssessmentRequest, response: dict) -> bool | None:
    """Persist writing assessment to data/logs/{student_id}/english_writing_log.json.

    Returns:
        True  — entry persisted (live or external assessment).
        False — persistence attempted but failed.
        None  — intentionally skipped (mock/unavailable/insufficient).
    """
    # Do not pollute portfolio averages with mock/unavailable placeholder scores.
    if response.get("llm_status") in {"mock", "unavailable"} or response.get("insufficient_evidence"):
        return None

    student_dir = _LOG_ROOT / student_id
    log_path = student_dir / "english_writing_log.json"

    topic_meta = _get_topic_metadata(req.topic_id)
    topic_context = req.topic_context.model_dump(exclude_none=True) if req.topic_context else {}
    entry = {
        "timestamp": response.get("timestamp") or datetime.now(timezone.utc).isoformat(),
        "assessment_request_id": req.assessment_request_id,
        "assessment_request_fingerprint": (
            _writing_request_fingerprint(req) if req.assessment_request_id else None
        ),
        "assessment_response": (
            {**response, "portfolio_saved": True} if req.assessment_request_id else None
        ),
        "year_level": req.year_level,
        "prompt_type": req.prompt_type,
        "topic_id": req.topic_id,
        "topic_title": topic_context.get("topic_title") or (topic_meta.get("title") if topic_meta else None),
        "topic_description": topic_meta.get("description") if topic_meta else None,
        "topic_prompt": req.topic_prompt or (topic_meta.get("prompt") if topic_meta else None),
        "topic_source_text": req.source_text or topic_context.get("stimulus_text") or (topic_meta.get("stimulusText") if topic_meta else None),
        "topic_word_limit": topic_context.get("word_limit") or (topic_meta.get("wordLimit") if topic_meta else None),
        "topic_guiding_questions": topic_meta.get("guidingQuestions") if topic_meta else None,
        "topic_think_about": topic_meta.get("thinkAbout") if topic_meta else None,
        "topic_writing_tips": topic_context.get("writing_tips") or (topic_meta.get("writingTips") if topic_meta else None),
        "topic_target_audience": topic_context.get("target_audience") or (topic_meta.get("targetAudience") if topic_meta else None),
        "topic_context": topic_context.get("context") or (topic_meta.get("context") if topic_meta else None),
        "topic_prescribed_text": topic_context.get("prescribed_text") or (topic_meta.get("prescribedText") if topic_meta else None),
        "topic_mode": topic_context.get("mode") or (topic_meta.get("mode") if topic_meta else None),
        "topic_task_conditions": topic_context.get("task_conditions") or (topic_meta.get("taskConditions") if topic_meta else None),
        "topic_official_source": topic_context.get("official_source") or (topic_meta.get("officialSource") if topic_meta else None),
        "topic_rubric_profile": topic_meta.get("rubricProfile") if topic_meta else None,
        "word_count": len(req.draft_text.split()),
        "draft_text": req.draft_text,
        "total_score": response.get("total_score", 0),
        "max_total_score": response.get("max_total_score", 0),
        "estimated_band": response.get("estimated_band"),
        "time_taken_seconds": req.time_taken_seconds,
        "has_source_text": bool(req.source_text.strip()),
        "has_writer_statement": bool(req.writer_statement.strip()),
        "criterion_scores": response.get("criterion_scores", []),
        "remediation_links": response.get("remediation_links", []),
        "strengths": response.get("strengths", []),
        "next_learning_steps": response.get("next_learning_steps", []),
        "revision_plan": response.get("revision_plan", []),
        "paragraph_feedback": response.get("paragraph_feedback"),
        "source_use_feedback": response.get("source_use_feedback"),
        "writing_skill_drills": response.get("writing_skill_drills", []),
        "task_alignment_warnings": response.get("task_alignment_warnings", []),
        "cognitive_verb_scores": response.get("cognitive_verb_scores", []),
        "writer_statement_feedback": response.get("writer_statement_feedback", ""),
        "revision_of": req.revision_of,
        "source": response.get("source"),
        "llm_status": response.get("llm_status"),
        "insufficient_evidence": bool(response.get("insufficient_evidence")),
    }

    lock = _writing_lock_for(student_id)
    try:
        with student_write_guard(student_id, _LOG_ROOT), lock:
            student_dir.mkdir(parents=True, exist_ok=True)

            if log_path.exists():
                existing = json.loads(log_path.read_text(encoding="utf-8"))
            else:
                existing = {"student_id": student_id, "assessments": []}

            assessments = existing.setdefault("assessments", [])
            if not isinstance(assessments, list):
                raise ValueError("Writing log assessments must be a list")
            if req.assessment_request_id:
                fingerprint = entry["assessment_request_fingerprint"]
                for prior in assessments:
                    if not isinstance(prior, dict):
                        continue
                    if prior.get("assessment_request_id") != req.assessment_request_id:
                        continue
                    prior_fingerprint = prior.get("assessment_request_fingerprint")
                    if prior_fingerprint and prior_fingerprint != fingerprint:
                        raise _WritingRequestIdConflict(
                            "assessment_request_id was already used for different Writing content"
                        )
                    return True
            assessments.append(entry)

            active_limit = max(1, int(_WRITING_ACTIVE_HISTORY_LIMIT))
            overflow_count = max(0, len(assessments) - active_limit)
            if overflow_count:
                archived = assessments[:overflow_count]
                _append_writing_archive(
                    student_dir / _WRITING_ARCHIVE_FILENAME,
                    archived,
                )
                existing["assessments"] = assessments[overflow_count:]
                try:
                    prior_archived = max(0, int(existing.get("archived_assessments", 0)))
                except (TypeError, ValueError):
                    prior_archived = 0
                existing["archived_assessments"] = prior_archived + overflow_count

            content = json.dumps(existing, indent=2, ensure_ascii=False) + "\n"
            fd, tmp_path = tempfile.mkstemp(dir=str(student_dir), suffix=".tmp")
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    f.write(content)
                    f.flush()
                    os.fsync(f.fileno())
                os.replace(tmp_path, str(log_path))
            except BaseException:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
                raise
        return True
    except _WritingRequestIdConflict:
        raise
    except Exception as exc:
        logger.warning("Failed to save writing log for %s: %s", student_id, exc)
        return False


# Grammar-in-context remediation (Audit Packet 2.1)
# ---------------------------------------------------------------------------


class GrammarRemediationRequest(BaseModel):
    criterion_scores: list[dict] = Field(min_length=1)
    draft_text: str = Field(default="", max_length=10000)
    year_level: int = Field(default=7, ge=7, le=12)
    prompt_type: str = Field(default="persuasive")


_CRITERION_TO_TAXONOMY: dict[str, tuple[str, str, str, str]] = {
    "Spelling": ("spelling_mechanics", "phonetic_spelling_slip", "spelling_punctuation", "spelling"),
    "Punctuation": ("punctuation_mechanics", "comma_splice_runon", "spelling_punctuation", "punctuation"),
    "Sentence Structure": ("grammar_syntax", "sentence_fragment", "language_conventions", "sentence_grammar"),
    "Paragraphing": ("writing_composition", "PEEL_structure_incomplete", "writing_structure", "paragraph_structure"),
    "Cohesion": ("writing_composition", "coherence_linking_missing", "language_conventions", "cohesion_transitions"),
    "Vocabulary": ("vocabulary_register", "expression_imprecision", "vocabulary", "word_choice"),
    "Structure / Mechanics": ("grammar_syntax", "sentence_fragment", "language_conventions", "sentence_grammar"),
    "Language and Cohesion": ("writing_composition", "coherence_linking_missing", "language_conventions", "cohesion_transitions"),
    "Textual features": ("vocabulary_register", "expression_imprecision", "vocabulary", "word_choice"),
}


_WRITING_SKILL_FACET_BY_CRITERION: dict[str, tuple[str, str]] = {
    "Audience": ("text_evidence", "Shape the response for the named audience and purpose."),
    "Text Structure": ("writing_structure", "Plan the opening, body, and conclusion before revising."),
    "Ideas": ("writing_structure", "Choose one underdeveloped idea and add precise evidence or detail."),
    "Persuasive Devices": ("text_evidence", "Add one purposeful persuasive move and explain its effect."),
    "Character and Setting": ("writing_structure", "Add a concrete detail that develops character or setting."),
    "Point / Thesis": ("text_evidence", "Rewrite the thesis so it directly answers the prompt."),
    "Evidence / Integration": ("text_evidence", "Add one short quote or example, then explain its effect."),
    "Explanation / Analysis": ("text_evidence", "Explain how the evidence supports the point, not just what it says."),
    "Purpose and Audience": ("text_evidence", "Clarify what the reader needs to understand and why."),
    "Knowledge application": ("text_evidence", "Connect one idea more clearly to the task, text, or representation."),
    "Organisation and development": ("writing_structure", "Strengthen paragraph sequencing and development."),
}


def _writing_skill_drill_response(weakest: dict[str, Any]) -> dict[str, Any]:
    name = str(weakest.get("name") or "Writing skill").strip() or "Writing skill"
    facet, tip = _WRITING_SKILL_FACET_BY_CRITERION.get(
        name,
        ("writing_structure", "Revise one paragraph against this criterion before editing sentences."),
    )
    return {
        "weakest_criterion": name,
        "error_code": None,
        "subtype_code": None,
        "facet": facet,
        "drills": [],
        "revision_task": (
            f"Your weakest area is **{name.lower()}**. This is a writing-skill target, "
            "not a grammar drill.\n\n"
            f"Micro-drill: {tip}"
        ),
        "grammar_focus": None,
        "writing_skill_drills": [
            {
                "criterion_number": int(weakest.get("criterion_number") or weakest.get("number") or 1),
                "skill": name,
                "drill_prompt": tip,
                "practice_tip": "Revise a small section first, then reread it against the original task context.",
            }
        ],
    }


@router.post("/grammar-remediation")
def grammar_remediation(
    req: GrammarRemediationRequest,
    student_id: str = Depends(require_student_id),
):
    """Recommend targeted grammar/punctuation drills based on writing weaknesses.

    Maps the weakest language-control criterion to the English error taxonomy,
    finds 2-3 matching exercises from the bank, and returns a sentence-level
    revision task using the student's own draft.
    """
    engine = get_tutor_engine()

    weak_criteria = sorted(
        req.criterion_scores,
        key=lambda c: (c.get("score", 0) / max(c.get("max_score", 1), 1)),
    )

    language_criteria = [
        c for c in weak_criteria
        if c.get("name") in _CRITERION_TO_TAXONOMY
    ]
    if not language_criteria and weak_criteria:
        return _writing_skill_drill_response(weak_criteria[0])

    if not language_criteria:
        return {
            "weakest_criterion": None,
            "error_code": None,
            "subtype_code": None,
            "facet": None,
            "drills": [],
            "revision_task": "Great work — no grammar weaknesses detected. Try a new writing prompt.",
            "grammar_focus": None,
        }

    weakest = language_criteria[0]
    name = weakest.get("name", "")
    mapping = _CRITERION_TO_TAXONOMY.get(name)
    if not mapping:
        mapping = ("grammar_syntax", "sentence_fragment", "language_conventions", "sentence_grammar")

    error_code, subtype_code, facet, grammar_focus = mapping

    _ = req.year_level
    drills = []
    for ex in engine.exercises.values():
        if ex.get("subject") != "english":
            continue
        if ex.get("year_level") != req.year_level:
            continue
        meta = ex.get("english_metadata") or {}
        if meta.get("facet") != facet:
            continue
        ex_gf = meta.get("grammar_focus")
        if ex_gf and grammar_focus not in str(ex_gf).lower():
            continue
        drills.append({
            "id": ex.get("id"),
            "question": ex.get("question", "")[:200],
            "topic_ids": ex.get("topic_ids", []),
            "facet": facet,
            "grammar_focus": ex_gf,
        })
        if len(drills) >= 3:
            break

    if not drills:
        for ex in engine.exercises.values():
            if ex.get("subject") != "english":
                continue
            if ex.get("year_level") != req.year_level:
                continue
            meta = ex.get("english_metadata") or {}
            if meta.get("facet") == facet:
                drills.append({
                    "id": ex.get("id"),
                    "question": ex.get("question", "")[:200],
                    "topic_ids": ex.get("topic_ids", []),
                    "facet": facet,
                    "grammar_focus": meta.get("grammar_focus"),
                })
                if len(drills) >= 3:
                    break

    sentence_revision = ""
    if req.draft_text.strip():
        sentences = [s.strip() for s in req.draft_text.replace("?", ".").replace("!", ".").split(".") if s.strip()]
        if sentences:
            import random
            import re as _re
            sentence_revision = sentences[random.randint(0, len(sentences) - 1)]

    focus_descriptions = {
        "spelling": "spelling accuracy",
        "punctuation": "correct punctuation",
        "sentence_grammar": "grammatical sentence structure",
        "paragraph_structure": "paragraph organisation",
        "cohesion_transitions": "linking words and transitions",
        "word_choice": "precise vocabulary",
    }
    focus_label = focus_descriptions.get(grammar_focus, "grammar and language")

    if sentence_revision:
        revision_task = (
            f"Your weakest area is **{name.lower()}**. "
            f"Focus on improving {focus_label}.\n\n"
            f"Try revising this sentence for better {focus_label}:\n\n"
            f"**{sentence_revision}**"
        )
    else:
        revision_task = (
            f"Your weakest area is **{name.lower()}**. "
            f"Focus on improving {focus_label}.\n\n"
            f"Complete the recommended drills below, then revise one sentence "
            f"from your draft for better {focus_label}."
        )

    return {
        "weakest_criterion": name,
        "error_code": error_code,
        "subtype_code": subtype_code,
        "facet": facet,
        "drills": drills,
        "revision_task": revision_task,
        "grammar_focus": grammar_focus,
    }


def _get_topic_metadata(topic_id: str | None) -> dict[str, Any] | None:
    """Return persisted topic metadata so portfolio rewrites can restore context."""
    if not topic_id or not _TOPICS_FILE.exists():
        return None
    try:
        topics = json.loads(_TOPICS_FILE.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("Failed to load topic metadata for writing log: %s", exc)
        return None
    for topic in topics:
        if isinstance(topic, dict) and topic.get("id") == topic_id:
            return topic
    return None


def _repair_truncated_json(raw: str) -> str:
    """Attempt to repair truncated JSON strings by completing strings and matching braces/brackets, or backtracking to the last comma."""
    if not raw:
        return ""
    in_string = False
    escape = False
    stack = []
    commas = []
    for i, char in enumerate(raw):
        if in_string:
            if escape:
                escape = False
            elif char == '\\':
                escape = True
            elif char == '"':
                in_string = False
        else:
            if char == '"':
                in_string = True
            elif char == '{':
                stack.append('{')
            elif char == '[':
                stack.append('[')
            elif char == '}':
                if stack and stack[-1] == '{':
                    stack.pop()
            elif char == ']':
                if stack and stack[-1] == '[':
                    stack.pop()
            elif char == ',':
                commas.append((i, list(stack)))
    candidate = raw
    if in_string:
        if candidate.endswith('\\'):
            candidate = candidate[:-1]
        candidate += '"'
    closed_stack = list(stack)
    for s in reversed(closed_stack):
        if s == '{':
            candidate += '}'
        elif s == '[':
            candidate += ']'
    try:
        json.loads(candidate)
        return candidate
    except json.JSONDecodeError:
        pass
    if commas:
        for comma_idx, stack_at_comma in reversed(commas):
            truncated = raw[:comma_idx].strip()
            for s in reversed(stack_at_comma):
                if s == '{':
                    truncated += '}'
                elif s == '[':
                    truncated += ']'
            try:
                json.loads(truncated)
                return truncated
            except json.JSONDecodeError:
                pass
    return raw


def _call_llm_writing(engine, prompt: str, *, timeout: float | None = None) -> str:
    """Synchronous LLM call with configurable timeout (default 120s), t=0.1."""
    return engine._call_llm(
        prompt,
        temp=0.1,
        system_message=(
            "You are a writing assessor. Output one complete strict JSON object only, with no preamble or trailing text. "
            "Completeness is more important than detail: emit every canonical criterion before optional fields. "
            "Use exactly one concise sentence (maximum 240 characters) for each criterion feedback. "
            "Keep the entire JSON under 12000 characters: at most 4 highlights, exactly 2 short strengths, "
            "at most 2 next learning steps, and at most 2 revision-plan items."
        ),
        response_format={"type": "json_object"},
        max_tokens=int(os.getenv("WRITING_MAX_TOKENS", "6000")),
        raise_on_error=True,
        timeout=min(_writing_provider_timeout(), timeout) if timeout is not None else _writing_provider_timeout(),
    )


def _compact_reassess_writing(
    engine,
    original_prompt: str,
    req: WritingAssessmentRequest,
    *,
    timeout: float | None = None,
) -> dict[str, Any]:
    """Re-assess once with a bounded schema after malformed or incomplete output."""
    criteria = [
        {
            "criterion_number": int(item["number"]),
            "name": str(item["name"]),
            "max_score": int(item["max_score"]),
        }
        for item in get_criteria_for_prompt(req.year_level, req.prompt_type)
    ]
    prompt_context = original_prompt.rsplit("## Output Format", 1)[0].rstrip()
    compact_prompt = (
        prompt_context
        + "\n\n## Compact Re-assessment Output Contract\n"
        + "The prior response was malformed or incomplete. Re-assess the same draft and output "
        + "one complete JSON object only. Completeness takes priority over detail.\n"
        + "CANONICAL_CRITERIA: "
        + json.dumps(criteria, ensure_ascii=False, separators=(",", ":"))
        + "\nRequired JSON fields:\n"
        + '- "criterion_scores": exactly one object for every canonical criterion, in numerical order. '
        + "Each object must contain criterion_number, integer score within max_score, and feedback "
        + "of one sentence no longer than 180 characters.\n"
        + '- "overall_feedback": one or two short sentences, at most 300 characters.\n'
        + '- "strengths": exactly two short strings.\n'
        + '- "next_learning_steps": exactly one object with short priority_goal, why_it_matters, '
        + "and recommendation strings.\n"
        + "Do not output highlights, revision_plan, paragraph_feedback, markdown, commentary, "
        + "or any other fields. Finish all criterion_scores before writing the other fields."
    )
    configured_tokens = int(os.getenv("WRITING_MAX_TOKENS", "6000"))
    retry_raw = engine._call_llm(
        compact_prompt,
        response_format={"type": "json_object"},
        temp=0.0,
        system_message=(
            "You are a writing assessor recovering from an incomplete response. "
            "Output only the compact JSON requested. Include every canonical criterion exactly once."
        ),
        max_tokens=max(1600, min(configured_tokens, 3000)),
        raise_on_error=True,
        timeout=min(_writing_provider_timeout(), timeout) if timeout is not None else _writing_provider_timeout(),
    )
    return _parse_writing_response(retry_raw)


def _parse_writing_response(raw: str) -> dict[str, Any]:
    """Parse and validate LLM response, recovering from common errors."""
    text = (raw or "").strip()
    # Strip DeepSeek `<think>...</think>` tags and reasoning content
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL | re.IGNORECASE).strip()
    if not text:
        raise ValueError("empty LLM response")

    data = None
    last_err = None

    # Step 1: Look for fenced code blocks
    fenced = re.findall(r"```(?:json)?\s*(\{.*?\})\s*```", text, flags=re.IGNORECASE | re.DOTALL)
    for candidate in fenced:
        candidate_stripped = candidate.strip()
        normalised = re.sub(r',\s*([\]}])', r'\1', candidate_stripped)
        try:
            data = json.loads(normalised)
            break
        except json.JSONDecodeError:
            try:
                repaired = _repair_truncated_json(normalised)
                data = json.loads(repaired)
                break
            except json.JSONDecodeError:
                pass

    if data is None:
        # Step 2: Search for any '{' in the text and try to extract JSON containing target keys
        indices = [i for i, char in enumerate(text) if char == "{"]

        for start_idx in indices:
            subtext = text[start_idx:]
            end_idx = subtext.rfind("}")
            if end_idx != -1:
                candidate = subtext[:end_idx + 1]
            else:
                candidate = subtext
                if candidate.endswith("```"):
                    candidate = candidate[:-3].strip()

            normalised = re.sub(r',\s*([\]}])', r'\1', candidate)
            try:
                parsed = json.loads(normalised)
                if isinstance(parsed, dict) and ("criterion_scores" in parsed or "criteria_scores" in parsed or "criterionScores" in parsed or "scores" in parsed):
                    data = parsed
                    break
            except json.JSONDecodeError as e:
                last_err = e
                try:
                    repaired = _repair_truncated_json(normalised)
                    parsed = json.loads(repaired)
                    if isinstance(parsed, dict) and ("criterion_scores" in parsed or "criteria_scores" in parsed or "criterionScores" in parsed or "scores" in parsed):
                        data = parsed
                        break
                except json.JSONDecodeError as err:
                    last_err = err

    # Step 3: If no valid dictionary found, raise error
    if data is None:
        logger.error("Failed to parse JSON even after repair. Raw text length: %d", len(text))
        if last_err:
            raise last_err
        raise ValueError("No valid JSON object found in response")

    top_level_aliases = {
        "criteria_scores": "criterion_scores",
        "criterionScores": "criterion_scores",
        "scores": "criterion_scores",
        "rubric_scores": "criterion_scores",
        "overall": "overall_feedback",
        "overallComment": "overall_feedback",
        "strengths_list": "strengths",
        "next_steps": "next_steps",
        "revision_actions": "next_steps",
    }
    for source, target in top_level_aliases.items():
        if target not in data and source in data:
            data[target] = data[source]

    if "criterion_scores" not in data:
        raise ValueError("LLM response missing 'criterion_scores'")

    scores = data["criterion_scores"]
    if not isinstance(scores, list):
        raise ValueError(f"Expected list for criterion_scores, got {type(scores)}")

    for cs in scores:
        if not isinstance(cs, dict):
            continue
        item_aliases = {
            "criterionNumber": "criterion_number",
            "number": "criterion_number",
            "criterion": "name",
            "criterion_name": "name",
            "mark": "score",
            "marks": "score",
            "points": "score",
            "max": "max_score",
            "maximum": "max_score",
            "maxScore": "max_score",
            "comment": "feedback",
            "comments": "feedback",
            "reason": "feedback",
        }
        for source, target in item_aliases.items():
            if target not in cs and source in cs:
                cs[target] = cs[source]

    return data


# ---------------------------------------------------------------------------
# Bring-your-own-LLM portable assessment (Audit F-BYO)
# ---------------------------------------------------------------------------


class ExternalResultRequest(WritingAssessmentRequest):
    """A normal assessment request plus the reply pasted back from an external LLM."""
    external_text: str = Field(min_length=1, max_length=20000)


def _build_readable_prompt(req: WritingAssessmentRequest) -> str:
    """A human-readable (non-JSON) variant of the assessment prompt.

    Designed to be pasted into an external chat assistant (Gemini/Claude web)
    when no server LLM is configured. It carries the same rubric and context as
    the structured prompt but asks for prose feedback instead of strict JSON.
    """
    is_senior = req.year_level >= 11
    criteria = get_criteria_for_prompt(req.year_level, req.prompt_type)
    crit_lines = "\n".join(
        f"- {c['name']} (score out of {c['max_score']})" for c in criteria
    )
    framing = (
        "QCAA-style formative criteria modelled on the English General ISMG (this is not official QCAA marking)"
        if is_senior
        else "NAPLAN-style formative writing criteria"
    )

    parts = [
        f"You are an experienced Australian English writing coach. Give formative feedback on a "
        f"Year {req.year_level} student's {req.prompt_type} writing using {framing}.",
        "",
        "Assess each of these criteria. For each, give a score and 1-2 sentences of specific, "
        "evidence-based feedback that quotes the student's draft:",
        crit_lines,
        "",
        "Then provide: a 2-3 sentence overall comment; two genuine strengths; the 2-3 highest-priority "
        "revision actions (say what to change and how, with one short sentence-level example each); and "
        "name the single paragraph to revise first.",
        "",
        "Important: do NOT rewrite the student's draft for them. Calibrate expectations to the year level "
        "(a strong Year 7 response is only average for Year 10). Use Australian English. This is formative "
        "practice feedback, not an official result.",
    ]
    if req.topic_prompt:
        parts += ["", "TASK / PROMPT:", req.topic_prompt]
    if req.source_text.strip():
        parts += ["", "SOURCE TEXT:", req.source_text]
    if req.writer_statement.strip():
        parts += ["", "WRITER'S STATEMENT:", req.writer_statement]
    if is_senior and (req.task_sheet_text.strip() or req.school_ismg_text.strip()):
        parts += [
            "",
            "SCHOOL TASK SHEET / ISMG (use as the highest-priority context):",
            (req.task_sheet_text.strip() or "Not provided.") + "\n" + (req.school_ismg_text.strip() or ""),
        ]
    parts += ["", "STUDENT DRAFT:", req.draft_text]
    return "\n".join(parts)


def _parse_external_assessment(text: str) -> dict[str, Any] | None:
    """Parse a reply pasted from an external LLM into the assessment dict.

    Tolerant of prose wrapped around the JSON: tries the standard parser first
    (which strips ``` fences), then falls back to extracting the first balanced
    ``{ ... }`` block. Returns None if no valid assessment JSON can be found.
    """
    if not text or not text.strip():
        return None
    try:
        return _parse_writing_response(text)
    except Exception:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return _parse_writing_response(text[start:end + 1])
        except Exception:
            return None
    return None


@router.post("/export-prompt")
def export_writing_prompt(
    req: WritingAssessmentRequest,
    student_id: str = Depends(require_student_id),
):
    """Return a ready-to-run assessment prompt for an external LLM.

    No LLM call and no persistence — this just hands back the same self-contained
    prompt the server would have used (structured, for re-import) plus a
    human-readable variant for chat assistants.
    """
    return {
        "structured_prompt": _build_prompt(req),
        "readable_prompt": _build_readable_prompt(req),
        "schema_hint": (
            "Paste the assistant's full reply back into the app. If you used the structured prompt, "
            "include the entire JSON object (with the outer { } braces)."
        ),
    }


@router.post("/import-result")
def import_external_result(
    req: ExternalResultRequest,
    student_id: str = Depends(require_student_id),
):
    """Turn an external LLM reply into one complete, replayable assessment."""
    request_id = req.assessment_request_id
    fingerprint = request_fingerprint(req, exclude={"assessment_request_id"}) if request_id else None

    def process() -> dict[str, Any]:
        parsed = _parse_external_assessment(req.external_text)
        if parsed is None:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "unparseable_external_result",
                    "message": (
                        "Could not read the assessment. Paste the assistant's full reply including the "
                        "outer { } braces, or use Readable mode and enter the scores yourself."
                    ),
                },
            )

        topic_min = _topic_min_word_count(req)
        below_evidence_floor = (
            topic_min is not None
            and len((req.draft_text or "").split()) < topic_min
        )
        if not below_evidence_floor:
            missing = _missing_criterion_numbers(
                parsed.get("criterion_scores"),
                req.year_level,
                req.prompt_type,
            )
            if missing:
                raise HTTPException(
                    status_code=422,
                    detail={
                        "error": "incomplete_external_result",
                        "missing_criteria": missing,
                        "message": (
                            "The external assessment must include a valid score and non-empty feedback "
                            "for every rubric criterion."
                        ),
                    },
                )

        response = _assemble_writing_response(
            req,
            parsed,
            llm_status="external",
            source="external_llm",
        )
        if request_id:
            response["assessment_request_id"] = request_id
        response["portfolio_saved"] = _save_writing_log(student_id, req, response)
        return response

    if not request_id:
        return process()

    try:
        with replay_lock(student_id, "writing_byo", request_id):
            cached = replay_lookup(student_id, "writing_byo", request_id, fingerprint or "")
            if cached is not None:
                return cached
            response = process()
            # Store durable replay for successfully saved portfolio assessments OR
            # non-scored terminal guidance (evidence floor).
            if (
                response.get("portfolio_saved") is True
                or response.get("insufficient_evidence") is True
            ) and response.get("llm_status") == "external":
                replay_store(
                    student_id,
                    "writing_byo",
                    request_id,
                    fingerprint or "",
                    response,
                )
            return response
    except RequestReplayConflict as exc:
        raise HTTPException(
            status_code=409,
            detail={"error": "writing_request_id_conflict", "message": str(exc)},
        )


def _mock_assessment(req: WritingAssessmentRequest, is_senior: bool, precheck: dict[str, Any] | None = None) -> dict:
    """Return a mock assessment when no LLM is configured.

    Criterion scoring genuinely needs an LLM, so scores stay at 0, but the
    deterministic ``precheck`` findings (spelling, punctuation, sentence
    control, register) are surfaced as real, actionable feedback so the Writing
    Lab is useful offline instead of a dead screen.
    """
    from core.schema.writing_schema import get_criteria_for_prompt

    criteria = get_criteria_for_prompt(req.year_level, req.prompt_type)
    max_total = sum(c["max_score"] for c in criteria)

    dummy_criteria = []
    for c in criteria:
        dummy_criteria.append({
            "criterion_number": c["number"],
            "domain": c.get("domain", "ISMG"),
            "name": c["name"],
            "score": 0,
            "max_score": c["max_score"],
            "feedback": "Detailed criterion scoring needs an AI connection; the mechanical pre-check below still applies.",
        })

    pc = precheck or {}
    word_count = len(req.draft_text.split())
    sentence_count = int(pc.get("sentence_count") or 0)

    # Build actionable mechanical findings from the deterministic pre-check.
    issues: list[tuple[str, str]] = []  # (goal, recommendation)
    if pc.get("missing_capitalization"):
        n = len(pc["missing_capitalization"])
        issues.append(("Fix sentence capitalisation", f"{n} sentence(s) don't start with a capital letter — capitalise the first word of each."))
    if pc.get("no_end_punctuation"):
        n = len(pc["no_end_punctuation"])
        issues.append(("Add end punctuation", f"{n} sentence(s) are missing a full stop, question mark, or exclamation mark."))
    if pc.get("long_sentences"):
        n = len(pc["long_sentences"])
        issues.append(("Split very long sentences", f"{n} sentence(s) run over 30 words — break them up for clarity and control."))
    if pc.get("possible_run_ons"):
        n = len(pc["possible_run_ons"])
        issues.append(("Check for run-on sentences", f"{n} sentence(s) may be run-ons — check joining words like 'and', 'but', 'so'."))
    if pc.get("american_spellings"):
        n = len(pc["american_spellings"])
        samples = ", ".join(f"{w}→{s}" for w, s, _ in pc["american_spellings"][:3])
        issues.append(("Use Australian spelling", f"{n} American spelling(s) detected ({samples})."))
    if pc.get("informal_register"):
        uniq = sorted(set(pc["informal_register"]))[:4]
        issues.append(("Lift the register", f"Informal words detected (e.g. {', '.join(uniq)}) — replace with more precise vocabulary."))

    overall_bits = [f"Local draft pre-check: {word_count} words across {sentence_count} sentence(s)."]
    flesch = pc.get("flesch_score")
    if flesch is not None:
        overall_bits.append(f"Readability score ≈ {flesch}.")
    if not issues:
        overall_bits.append("No obvious spelling, punctuation, or sentence-control issues were flagged. Use Assess with your own AI for full formative feedback on ideas, structure and evidence.")
    else:
        overall_bits.append("Address the mechanical items below, then use Assess with your own AI for full formative feedback on ideas, structure and evidence.")
    overall_feedback = " ".join(overall_bits)

    if issues:
        strengths = [f"Produced a {word_count}-word draft across {sentence_count} sentence(s) to build on."]
        next_learning_steps = [
            {
                "priority_goal": goal,
                "why_it_matters": "Clear mechanics let a marker focus on your ideas and analysis.",
                "recommendation": rec,
            }
            for goal, rec in issues[:3]
        ]
        revision_plan = [
            {
                "priority": idx,
                "target": goal,
                "why": rec,
                "how": "Find each flagged sentence in your draft and revise it, then reread the paragraph aloud.",
                "example_revision": None,
            }
            for idx, (goal, rec) in enumerate(issues[:3], start=1)
        ]
    else:
        strengths = [
            f"Produced a {word_count}-word draft across {sentence_count} sentence(s).",
            "No mechanical spelling/punctuation issues were detected by the pre-check.",
        ]
        next_learning_steps = [
            {
                "priority_goal": "Get full formative feedback",
                "why_it_matters": "The local pre-check cannot judge ideas, structure or evidence.",
                "recommendation": "Use Assess with your own AI, or continue editing and request assessment later.",
            }
        ]
        revision_plan = [
            {
                "priority": 1,
                "target": "Check ideas, structure and evidence",
                "why": "Mechanics look clean; the local pre-check cannot assess these higher-level writing skills.",
                "how": "Use Assess with your own AI, then revise one priority paragraph at a time from the returned feedback.",
                "example_revision": None,
            }
        ]

    return {
        "is_senior": is_senior,
        "total_score": 0,
        "max_total_score": max_total,
        "estimated_band": None,
        "criterion_scores": dummy_criteria,
        "highlights": [],
        "remediation_links": [],
        "overall_feedback": overall_feedback,
        "strengths": strengths,
        "next_learning_steps": next_learning_steps,
        "revision_plan": revision_plan,
        "paragraph_feedback": {
            "strongest_paragraph": "No paragraph-level judgement was made by the local pre-check.",
            "paragraph_to_revise_first": "Start with the paragraph containing the most pre-check flags above.",
            "sentence_level_improvement": "Fix any flagged capitalisation, end punctuation, and over-long sentences first.",
        },
        "source_use_feedback": None,
        "writing_skill_drills": [],
        "task_alignment_warnings": [],
        "writer_statement_feedback": "",
        "cognitive_verb_scores": [],
    }
