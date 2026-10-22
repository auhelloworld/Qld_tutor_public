"""Parent-gated exercise bank import / visual review / append API.

Access uses the same parent token as Parent Dashboard (``X-Parent-Token`` after
``PARENT_PASSWORD`` login). No separate BANK_REVIEW_ENABLED flag.
"""

from __future__ import annotations

import json
import logging
import threading
import time
import uuid
import weakref
from copy import deepcopy
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from backend.services.exercise_bank_paths import (
    DEFAULT_DATA_DIR,
    PROJECT_ROOT,
    BankPathError,
    group_exercises_by_bank,
    list_known_bank_files,
    resolve_exercise_bank_filename,
)
from backend.services.exercise_validation import validate_exercise_for_bank_review
from backend.services.atomic_files import atomic_write_bytes, atomic_write_text
from backend.student_identity import get_parent_password, require_parent
from backend.tutor_engine import get_tutor_engine

logger = logging.getLogger(__name__)
router = APIRouter(tags=["bank-review"])

_MAX_ITEMS = 5000
_MAX_BODY_BYTES = 25 * 1024 * 1024
_SESSION_TTL_S = 4 * 3600
_MAX_ACTIVE_SESSIONS = 8
DEFAULT_EXAMS_DIR = PROJECT_ROOT / "data" / "exams"

_sessions_lock = threading.Lock()
_sessions: dict[str, dict[str, Any]] = {}
_write_locks_guard = threading.Lock()
_write_locks: weakref.WeakValueDictionary[str, threading.RLock] = weakref.WeakValueDictionary()


def _write_lock_for(path: Path) -> threading.RLock:
    key = str(path.resolve())
    with _write_locks_guard:
        lock = _write_locks.get(key)
        if lock is None:
            lock = threading.RLock()
            _write_locks[key] = lock
        return lock


def _exams_dir() -> Path:
    return Path(DEFAULT_EXAMS_DIR).resolve()


def _safe_exam_filename(name: str) -> str:
    """Return a basename-only .json exam filename or raise ValueError."""
    raw = str(name or "").strip()
    if not raw:
        raise ValueError("filename is required")
    base = Path(raw).name
    if base != raw.replace("\\", "/").split("/")[-1]:
        raise ValueError("filename must be a basename only")
    if not base.endswith(".json") or base.startswith("."):
        raise ValueError("filename must be a .json file")
    if ".." in base:
        raise ValueError("invalid filename")
    return base


def _safe_bank_filename(name: str) -> str:
    """Return a basename-only production bank filename (exercise_*.json)."""
    raw = str(name or "").strip()
    if not raw:
        raise ValueError("filename is required")
    base = Path(raw).name
    if base != raw.replace("\\", "/").split("/")[-1]:
        raise ValueError("filename must be a basename only")
    if ".." in base or base.startswith("."):
        raise ValueError("invalid filename")
    if not (base.startswith("exercise_") and base.endswith(".json")):
        raise ValueError("filename must be an exercise_*.json bank file")
    return base


def _data_dir() -> Path:
    return Path(DEFAULT_DATA_DIR).resolve()


def _purge_expired_sessions(now: float | None = None) -> None:
    now = time.time() if now is None else now
    expired = [
        sid for sid, sess in _sessions.items()
        if now - float(sess.get("last_access_at", sess.get("created_at", 0))) > _SESSION_TTL_S
    ]
    for sid in expired:
        _sessions.pop(sid, None)


def _get_session(session_id: str) -> dict[str, Any]:
    with _sessions_lock:
        _purge_expired_sessions()
        sess = _sessions.get(session_id)
        if sess is None:
            raise HTTPException(
                status_code=404,
                detail={"error": "session_not_found", "message": "Bank review session not found or expired."},
            )
        sess["last_access_at"] = time.time()
        return sess


def _resolve_passage_for_preview(ex: dict[str, Any]) -> dict[str, Any]:
    """Return a shallow copy with english stimulus resolved for display."""
    out = deepcopy(ex)
    try:
        from backend.content_authoring.stimulus_loader import get_stimulus_text, is_stimulus_id
    except Exception:
        return out
    meta = out.get("english_metadata")
    if isinstance(meta, dict):
        passage = meta.get("passage")
        if isinstance(passage, str) and is_stimulus_id(passage):
            resolved = get_stimulus_text(passage)
            if resolved:
                meta = dict(meta)
                meta["passage"] = resolved
                out["english_metadata"] = meta
                out["resolved_passage"] = resolved
    return out


def _index_entry(ex: dict[str, Any], validation: dict[str, Any], reviewed: bool) -> dict[str, Any]:
    target = None
    target_error = None
    try:
        target = resolve_exercise_bank_filename(ex)
    except BankPathError as exc:
        target_error = str(exc)
    return {
        "id": validation.get("id") or ex.get("id"),
        "question_type": ex.get("question_type", "short_answer"),
        "subject": ex.get("subject"),
        "year_level": ex.get("year_level"),
        "unit": ex.get("unit"),
        "difficulty": ex.get("difficulty"),
        "diagram_type": validation.get("diagram_type"),
        "has_diagram": bool(ex.get("diagram_data") or ex.get("image")),
        "target_file": target,
        "target_error": target_error,
        "valid_for_append": bool(validation.get("valid_for_append")) and target is not None,
        "issue_count": len(validation.get("issues") or []),
        "has_errors": any(i.get("severity") == "error" for i in (validation.get("issues") or [])),
        "reviewed": reviewed,
        "topic_ids": ex.get("topic_ids") or [],
    }


class FlagRequest(BaseModel):
    index: int = Field(ge=0)
    reviewed: bool = True


class AppendRequest(BaseModel):
    mode: Literal["all_valid", "reviewed_only", "ids"] = "all_valid"
    ids: list[str] = Field(default_factory=list)


class MarkRequest(BaseModel):
    index: int = Field(ge=0)
    student_answer: str = Field(default="", max_length=8000)


class SubPartEdit(BaseModel):
    """One multi_part sub-question for bank-review editing."""

    label: str = Field(default="", max_length=32)
    question: str = Field(default="", max_length=8000)
    answer: str = Field(default="", max_length=4000)
    marks: float | int | None = Field(default=None, ge=0, le=100)


class UpdateItemRequest(BaseModel):
    """Patch authoring fields on a session exercise (in-memory until append/save-exam)."""

    index: int = Field(ge=0)
    question: str | None = None
    answer: str | None = None
    steps: list[str] | None = None
    # Rubric key-point labels only (strings). Object-shaped points keep other keys.
    rubric_key_points: list[str] | None = None
    status: Literal["active", "draft"] | None = None
    # Full replacement list when provided (multi_part). Empty list clears sub_parts.
    sub_parts: list[SubPartEdit] | None = None
    difficulty: str | None = None
    # Diagram payload (object). Explicit null clears diagram_data.
    diagram_data: dict[str, Any] | None = None
    clear_diagram: bool = False
    # Image path/URL/data URI. Explicit clear removes the image reference.
    image: str | None = None
    clear_image: bool = False
    # Reasoning sample / worked narrative (empty string clears).
    sample_reasoning: str | None = None
    clear_sample_reasoning: bool = False
    # Diagram description text (accessibility / alt-text for the visual).
    diagram_description: str | None = None
    clear_diagram_description: bool = False


def extract_exercises_from_import_payload(payload: Any) -> tuple[list[Any], str, dict[str, Any]]:
    """Normalise generation / bank / exam / wrapper JSON into an exercise list.

    Supported shapes:
    - ``[ exercise, ... ]``
    - ``{ "exercises": [ ... ] }``
    - ``{ "candidates": [ ... ] }``  (generation batch response)
    - ``{ "items": [ ... ] }``
    - imported mock exam: ``{ "title", "time_limit_minutes", "questions": [ ... ] }``

    Returns ``(items, detected_format, extra_meta)``.
    ``extra_meta`` may include exam title / time limit when format is ``imported_exam``.
    """
    if isinstance(payload, list):
        return payload, "exercise_array", {}
    if not isinstance(payload, dict):
        raise ValueError(
            "Body must be a JSON array of exercises, "
            '{"exercises": [...]}, generation {"candidates": [...]}, '
            '{"items": [...]}, or an imported exam {"questions": [...]}.'
        )
    if isinstance(payload.get("exercises"), list):
        return payload["exercises"], "exercises_wrapper", {}
    if isinstance(payload.get("candidates"), list):
        return payload["candidates"], "generation_candidates", {}
    if isinstance(payload.get("items"), list):
        return payload["items"], "items_wrapper", {}
    if isinstance(payload.get("questions"), list):
        meta = {
            "title": payload.get("title"),
            "time_limit_minutes": payload.get("time_limit_minutes"),
        }
        return payload["questions"], "imported_exam", meta
    raise ValueError(
        "Could not find an exercise list. Use a top-level array, "
        '"exercises", "candidates" (generation), "items", or exam "questions".'
    )


def _enrich_exam_item(
    ex: Any,
    *,
    default_subject: str | None = None,
    default_year_level: int | None = None,
) -> Any:
    """Fill light defaults so preview/mark work; does not invent answers."""
    if not isinstance(ex, dict):
        return ex
    out = dict(ex)
    if default_subject and not out.get("subject"):
        out["subject"] = default_subject
    if default_year_level is not None and out.get("year_level") is None:
        out["year_level"] = default_year_level
    if not out.get("question_type"):
        if out.get("choices") or out.get("correct_choice"):
            out["question_type"] = "multiple_choice"
        elif out.get("sub_parts"):
            out["question_type"] = "multi_part"
        elif out.get("rubric") or out.get("sample_reasoning"):
            out["question_type"] = "reasoning"
        else:
            out["question_type"] = "short_answer"
    # Exam papers are not bank drafts by default
    if "status" not in out:
        out["status"] = "active"
    return out


def _build_session_from_items(
    items: list[Any],
    *,
    source_name: str,
    detected_format: str,
    exam_meta: dict[str, Any] | None = None,
    exam_filename: str | None = None,
    bank_filename: str | None = None,
    source_kind: str | None = None,
) -> dict[str, Any]:
    validations: list[dict[str, Any]] = []
    reviewed: dict[str, bool] = {}
    target_hist: dict[str, int] = {}
    valid_count = 0
    error_count = 0

    for ex in items:
        v = validate_exercise_for_bank_review(ex)
        validations.append(v)
        if v["valid_for_append"]:
            try:
                name = resolve_exercise_bank_filename(ex if isinstance(ex, dict) else {})
                target_hist[name] = target_hist.get(name, 0) + 1
                valid_count += 1
            except BankPathError as exc:
                v["valid_for_append"] = False
                v["issues"].append({
                    "severity": "error",
                    "code": "unmapped_target",
                    "message": str(exc),
                })
                error_count += 1
        else:
            error_count += 1
        if isinstance(ex, dict) and isinstance(ex.get("id"), str):
            reviewed[ex["id"]] = False

    if source_kind is None:
        if detected_format == "imported_exam":
            source_kind = "exam"
        elif detected_format == "production_bank":
            source_kind = "bank_file"
        else:
            source_kind = "bank"
    session_id = str(uuid.uuid4())
    with _sessions_lock:
        _purge_expired_sessions()
        if len(_sessions) >= _MAX_ACTIVE_SESSIONS:
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "bank_review_session_capacity_reached",
                    "message": (
                        "Too many active bank review sessions. Finish an existing "
                        "session or wait for it to expire before importing another file."
                    ),
                    "max_active_sessions": _MAX_ACTIVE_SESSIONS,
                },
            )
        now = time.time()
        _sessions[session_id] = {
            "created_at": now,
            "last_access_at": now,
            "source_name": source_name,
            "source_kind": source_kind,
            "detected_format": detected_format,
            "exam_meta": dict(exam_meta or {}),
            "exam_filename": exam_filename,
            "bank_filename": bank_filename,
            "items": items,
            "validations": validations,
            "reviewed": reviewed,
        }

    draft_count = sum(
        1 for ex in items
        if isinstance(ex, dict) and str(ex.get("status") or "active") == "draft"
    )
    return {
        "session_id": session_id,
        "source_name": source_name,
        "source_kind": source_kind,
        "detected_format": detected_format,
        "exam_filename": exam_filename,
        "bank_filename": bank_filename,
        "exam_meta": dict(exam_meta or {}),
        "total": len(items),
        "valid_for_append": valid_count,
        "with_errors": error_count,
        "draft_status_count": draft_count,
        "target_histogram": target_hist,
    }


def _apply_item_edits(ex: dict[str, Any], req: UpdateItemRequest) -> dict[str, Any]:
    """Return a shallow-copied exercise with allowed fields updated."""
    updated = dict(ex)
    if req.question is not None:
        updated["question"] = req.question
    if req.answer is not None:
        updated["answer"] = req.answer
    if req.steps is not None:
        updated["steps"] = [str(s) for s in req.steps]
    if req.status is not None:
        updated["status"] = req.status
    if req.rubric_key_points is not None:
        old_rubric = ex.get("rubric") if isinstance(ex.get("rubric"), dict) else {}
        rubric = dict(old_rubric or {})
        old_points = rubric.get("key_points") if isinstance(rubric.get("key_points"), list) else []
        new_points: list[Any] = []
        for i, text in enumerate(req.rubric_key_points):
            label = str(text).strip()
            if not label:
                continue
            if i < len(old_points) and isinstance(old_points[i], dict):
                row = dict(old_points[i])
                # Prefer "text"; keep other keys (e.g. marks).
                if "text" in row or "label" not in row:
                    row["text"] = label
                else:
                    row["label"] = label
                new_points.append(row)
            else:
                new_points.append(label)
        rubric["key_points"] = new_points
        updated["rubric"] = rubric
    if req.sub_parts is not None:
        old_parts = ex.get("sub_parts") if isinstance(ex.get("sub_parts"), list) else []
        new_parts: list[dict[str, Any]] = []
        for i, part in enumerate(req.sub_parts):
            base: dict[str, Any] = (
                dict(old_parts[i])
                if i < len(old_parts) and isinstance(old_parts[i], dict)
                else {}
            )
            label = str(part.label or "").strip() or (
                str(base.get("label") or "").strip() or chr(ord("a") + min(i, 25))
            )
            question = str(part.question if part.question is not None else base.get("question") or "").strip()
            if not question:
                # Skip empty trailing parts
                continue
            base["label"] = label
            base["question"] = question
            base["answer"] = str(part.answer if part.answer is not None else base.get("answer") or "")
            if part.marks is not None:
                try:
                    marks_val = float(part.marks)
                    base["marks"] = int(marks_val) if marks_val == int(marks_val) else marks_val
                except (TypeError, ValueError):
                    base["marks"] = base.get("marks", 1)
            elif "marks" not in base:
                base["marks"] = 1
            new_parts.append(base)
        updated["sub_parts"] = new_parts
        if new_parts and not updated.get("question_type"):
            updated["question_type"] = "multi_part"
    if req.difficulty is not None:
        updated["difficulty"] = req.difficulty
    if req.clear_diagram:
        updated.pop("diagram_data", None)
    elif req.diagram_data is not None:
        if not isinstance(req.diagram_data, dict):
            raise ValueError("diagram_data must be a JSON object")
        # Shallow copy so session storage is independent of request body
        updated["diagram_data"] = dict(req.diagram_data)
    if req.clear_image:
        updated.pop("image", None)
    elif req.image is not None:
        image = str(req.image).strip()
        if image:
            updated["image"] = image
        else:
            updated.pop("image", None)
    if req.clear_sample_reasoning:
        updated.pop("sample_reasoning", None)
    elif req.sample_reasoning is not None:
        text = str(req.sample_reasoning).strip()
        if text:
            updated["sample_reasoning"] = str(req.sample_reasoning)
        else:
            updated.pop("sample_reasoning", None)
    if req.clear_diagram_description:
        updated.pop("diagram_description", None)
    elif req.diagram_description is not None:
        text = str(req.diagram_description).strip()
        if text:
            updated["diagram_description"] = text
        else:
            updated.pop("diagram_description", None)
    return updated


@router.get("/api/dev/bank-review/status")
def bank_review_status():
    """Whether bank review is available (parent password configured)."""
    configured = get_parent_password() is not None
    return {
        "enabled": configured,
        "auth": "parent",
        "message": (
            None if configured
            else "Configure PARENT_PASSWORD and unlock Parent Dashboard to use bank review."
        ),
    }


@router.get("/api/dev/bank-review/targets")
def bank_review_targets(_parent_id: str = Depends(require_parent)):
    targets = []
    for path in list_known_bank_files(data_dir=_data_dir()):
        count = 0
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, list):
                count = len(data)
        except (OSError, json.JSONDecodeError):
            count = -1
        targets.append({"file": path.name, "path": str(path), "count": count})
    return {"targets": targets, "data_dir": str(_data_dir())}


class LoadBankRequest(BaseModel):
    filename: str


class SaveBankRequest(BaseModel):
    filename: str | None = None
    create_backup: bool = True
    # Kept for API compatibility, but production writes must always validate.
    require_all_valid: bool = True


class _WriteResult:
    """The durable-write facts returned by the Bank Review write boundary."""

    def __init__(self, *, backup_requested: bool, backup_created: bool, backup_path: Path | None):
        self.backup_requested = backup_requested
        self.backup_created = backup_created
        self.backup_path = str(backup_path) if backup_path is not None else None


def _session_items_for_write(
    sess: dict[str, Any],
    *,
    require_bank_target: bool,
) -> list[dict[str, Any]]:
    """Revalidate every session item immediately before a durable write.

    Session validation is intentionally repeated here: edits are held in memory,
    and the write boundary must not trust an earlier validation snapshot. Bank
    files additionally require a resolvable production target; exam papers do
    not need a bank target but still require the canonical exercise schema.
    """
    items: list[dict[str, Any]] = []
    invalid: list[dict[str, str]] = []
    seen_ids: set[str] = set()
    duplicate_ids: list[str] = []

    for index, raw in enumerate(sess.get("items", [])):
        validation = validate_exercise_for_bank_review(raw)
        item_id = str(validation.get("id") or (raw.get("id") if isinstance(raw, dict) else index))
        if not isinstance(raw, dict) or not validation.get("valid_for_append"):
            invalid.append({"index": str(index), "id": item_id})
            continue
        if require_bank_target:
            try:
                resolve_exercise_bank_filename(raw)
            except BankPathError:
                invalid.append({"index": str(index), "id": item_id})
                continue

        normalized_id = str(raw.get("id") or "").strip()
        if normalized_id in seen_ids:
            duplicate_ids.append(normalized_id)
        else:
            seen_ids.add(normalized_id)
        items.append(deepcopy(raw))

    if invalid:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "invalid_items",
                "message": f"{len(invalid)} item(s) are not valid for durable write",
                "items": invalid[:50],
            },
        )
    if duplicate_ids:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "duplicate_ids",
                "message": f"Duplicate exercise ids in session: {duplicate_ids[:10]}",
                "ids": duplicate_ids[:50],
            },
        )
    return items


def _write_json_with_verified_backup(
    path: Path,
    payload: Any,
    *,
    create_backup: bool,
) -> _WriteResult:
    """Write JSON atomically, refusing replacement when a requested backup fails."""
    with _write_lock_for(path):
        return _write_json_with_verified_backup_locked(
            path,
            payload,
            create_backup=create_backup,
        )


def _write_json_with_verified_backup_locked(
    path: Path,
    payload: Any,
    *,
    create_backup: bool,
) -> _WriteResult:
    try:
        serialized = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": "serialize_failed", "message": "Unable to serialize the reviewed content."},
        ) from exc

    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_file() and not create_backup:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "backup_required",
                "message": "Replacing an existing production file requires a verified backup.",
                "backup_requested": False,
                "backup_created": False,
                "backup_path": None,
            },
        )
    backup_path = path.with_suffix(path.suffix + ".bak")
    backup_created = False
    if create_backup and path.is_file():
        try:
            original = path.read_bytes()
            atomic_write_bytes(backup_path, original)
            if backup_path.read_bytes() != original:
                raise OSError("backup verification failed")
            backup_created = True
        except OSError as exc:
            raise HTTPException(
                status_code=500,
                detail={
                    "error": "backup_failed",
                    "message": "The production file was not replaced because its backup could not be verified.",
                    "backup_requested": True,
                    "backup_created": False,
                    "backup_path": str(backup_path),
                },
            ) from exc

    try:
        atomic_write_text(path, serialized)
    except OSError as exc:
        raise HTTPException(
            status_code=500,
            detail={
                "error": "write_failed",
                "message": "The production file was not replaced.",
                "backup_requested": bool(create_backup),
                "backup_created": backup_created,
                "backup_path": str(backup_path) if backup_created else None,
            },
        ) from exc

    return _WriteResult(
        backup_requested=bool(create_backup),
        backup_created=backup_created,
        backup_path=backup_path if backup_created else None,
    )


@router.post("/api/dev/bank-review/load-bank")
def bank_review_load_bank(
    req: LoadBankRequest,
    _parent_id: str = Depends(require_parent),
):
    """Load a production ``data/exercise_*.json`` bank into a review session.

    Edits stay in-session until ``save-bank`` overwrites that file (or Append
    adds new ids elsewhere).
    """
    try:
        filename = _safe_bank_filename(req.filename)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_filename", "message": str(exc)},
        ) from exc

    data_dir = _data_dir()
    bank_path = (data_dir / filename).resolve()
    if not bank_path.is_file() or not bank_path.is_relative_to(data_dir):
        raise HTTPException(
            status_code=404,
            detail={"error": "bank_file_not_found", "message": f"{filename} not found under data/"},
        )
    try:
        payload = json.loads(bank_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_json", "message": f"Failed to read {filename}: {exc}"},
        ) from exc

    if not isinstance(payload, list):
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_bank_shape", "message": f"{filename} must be a JSON array of exercises"},
        )
    if len(payload) > _MAX_ITEMS:
        raise HTTPException(
            status_code=400,
            detail={"error": "too_many_items", "message": f"At most {_MAX_ITEMS} exercises per bank load."},
        )

    return _build_session_from_items(
        payload,
        source_name=filename,
        detected_format="production_bank",
        bank_filename=filename,
        source_kind="bank_file",
    )


@router.post("/api/dev/bank-review/session/{session_id}/save-bank")
def bank_review_save_bank(
    session_id: str,
    req: SaveBankRequest,
    _parent_id: str = Depends(require_parent),
):
    """Overwrite a production bank file with the current session items.

    Writes the full session list as a JSON array to ``data/<filename>``.
    Creates ``.bak`` when the target already exists (default).
    Reloads tutor exercises when the write succeeds.
    """
    sess = _get_session(session_id)
    try:
        filename = _safe_bank_filename(
            req.filename or sess.get("bank_filename") or sess.get("source_name")
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "invalid_filename",
                "message": str(exc) + " — open a bank via load-bank or pass filename.",
            },
        ) from exc

    if not req.require_all_valid:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "strict_validation_required",
                "message": "Production bank writes always require every session item to be valid.",
            },
        )

    items_out = _session_items_for_write(sess, require_bank_target=True)

    data_dir = _data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    bank_path = (data_dir / filename).resolve()
    if not bank_path.is_relative_to(data_dir):
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_path", "message": "Refusing to write outside data/"},
        )

    write_result = _write_json_with_verified_backup(
        bank_path,
        items_out,
        create_backup=req.create_backup,
    )

    with _sessions_lock:
        sess["bank_filename"] = filename
        sess["source_kind"] = "bank_file"
        sess["detected_format"] = "production_bank"
        sess["source_name"] = filename

    try:
        reload_stats = get_tutor_engine().reload_exercises()
    except Exception as exc:
        logger.exception("Failed to reload exercises after save-bank")
        raise HTTPException(
            status_code=500,
            detail={
                "error": "reload_failed",
                "message": "The bank file was written, but the tutor cache could not be reloaded.",
                "filename": filename,
                "path": str(bank_path),
                "backup_requested": write_result.backup_requested,
                "backup_created": write_result.backup_created,
                "backup_path": write_result.backup_path,
                "reload_succeeded": False,
            },
        ) from exc

    return {
        "ok": True,
        "filename": filename,
        "path": str(bank_path),
        "num_items": len(items_out),
        # ``backup`` remains for existing clients; it now reports actual creation.
        "backup": write_result.backup_created,
        "backup_requested": write_result.backup_requested,
        "backup_created": write_result.backup_created,
        "backup_path": write_result.backup_path,
        "reload_succeeded": True,
        "reload": reload_stats,
    }


@router.post("/api/dev/bank-review/import")
async def bank_review_import(
    request: Request,
    _parent_id: str = Depends(require_parent),
):
    body = await request.body()
    if len(body) > _MAX_BODY_BYTES:
        raise HTTPException(
            status_code=413,
            detail={"error": "payload_too_large", "message": f"Import exceeds {_MAX_BODY_BYTES} bytes."},
        )
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_json", "message": f"Invalid JSON: {exc}"},
        ) from exc

    source_name = "upload.json"
    exam_filename: str | None = None
    default_subject: str | None = None
    default_year_level: int | None = None
    if isinstance(payload, dict):
        if payload.get("source_name"):
            source_name = str(payload.get("source_name"))
        if payload.get("exam_filename"):
            try:
                exam_filename = _safe_exam_filename(str(payload.get("exam_filename")))
            except ValueError:
                exam_filename = None
        if payload.get("default_subject"):
            default_subject = str(payload.get("default_subject")).strip() or None
        if payload.get("default_year_level") is not None:
            try:
                default_year_level = int(payload["default_year_level"])
            except (TypeError, ValueError):
                default_year_level = None

    try:
        items, detected_format, exam_meta = extract_exercises_from_import_payload(payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_shape", "message": str(exc)},
        ) from exc

    if len(items) > _MAX_ITEMS:
        raise HTTPException(
            status_code=400,
            detail={"error": "too_many_items", "message": f"At most {_MAX_ITEMS} exercises per import."},
        )

    if detected_format == "imported_exam":
        items = [
            _enrich_exam_item(
                ex,
                default_subject=default_subject,
                default_year_level=default_year_level,
            )
            for ex in items
        ]
        if not source_name or source_name == "upload.json":
            title = exam_meta.get("title")
            source_name = str(title or exam_filename or "imported_exam.json")

    return _build_session_from_items(
        items,
        source_name=source_name,
        detected_format=detected_format,
        exam_meta=exam_meta if detected_format == "imported_exam" else None,
        exam_filename=exam_filename if detected_format == "imported_exam" else None,
    )


class ImportExamFileRequest(BaseModel):
    filename: str
    default_subject: str | None = None
    default_year_level: int | None = None


class SaveExamRequest(BaseModel):
    filename: str | None = None
    title: str | None = None
    time_limit_minutes: int | None = Field(default=None, ge=5, le=180)
    create_backup: bool = True


@router.get("/api/dev/bank-review/exams")
def bank_review_list_exams(_parent_id: str = Depends(require_parent)):
    """List mock-exam JSON papers under data/exams/ for review."""
    exams_dir = _exams_dir()
    papers: list[dict[str, Any]] = []
    if exams_dir.is_dir():
        for path in sorted(exams_dir.glob("*.json")):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                papers.append({
                    "filename": path.name,
                    "title": path.stem,
                    "time_limit_minutes": None,
                    "num_questions": -1,
                    "error": "unreadable",
                })
                continue
            if not isinstance(data, dict):
                papers.append({
                    "filename": path.name,
                    "title": path.stem,
                    "time_limit_minutes": None,
                    "num_questions": -1,
                    "error": "not_object",
                })
                continue
            qs = data.get("questions") if isinstance(data.get("questions"), list) else []
            papers.append({
                "filename": path.name,
                "title": data.get("title") or path.stem,
                "time_limit_minutes": data.get("time_limit_minutes"),
                "num_questions": len(qs),
            })
    return {"exams_dir": str(exams_dir), "papers": papers}


@router.post("/api/dev/bank-review/import-exam")
def bank_review_import_exam(
    req: ImportExamFileRequest,
    _parent_id: str = Depends(require_parent),
):
    """Load a data/exams/*.json paper into a bank-review session for QA + edit."""
    try:
        filename = _safe_exam_filename(req.filename)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_filename", "message": str(exc)},
        ) from exc

    exams_dir = _exams_dir()
    exam_path = (exams_dir / filename).resolve()
    if not exam_path.is_file() or not exam_path.is_relative_to(exams_dir):
        raise HTTPException(
            status_code=404,
            detail={"error": "exam_file_not_found", "message": f"{filename} not found under data/exams/"},
        )
    try:
        payload = json.loads(exam_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_json", "message": f"Failed to read {filename}: {exc}"},
        ) from exc

    try:
        items, detected_format, exam_meta = extract_exercises_from_import_payload(payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_shape", "message": str(exc)},
        ) from exc

    if detected_format != "imported_exam":
        raise HTTPException(
            status_code=400,
            detail={
                "error": "not_exam_shape",
                "message": 'Exam files must be { "title", "questions": [...] }.',
            },
        )
    if len(items) > _MAX_ITEMS:
        raise HTTPException(
            status_code=400,
            detail={"error": "too_many_items", "message": f"At most {_MAX_ITEMS} exercises per import."},
        )

    items = [
        _enrich_exam_item(
            ex,
            default_subject=req.default_subject,
            default_year_level=req.default_year_level,
        )
        for ex in items
    ]
    title = exam_meta.get("title") or filename
    return _build_session_from_items(
        items,
        source_name=str(title),
        detected_format="imported_exam",
        exam_meta=exam_meta,
        exam_filename=filename,
    )


@router.post("/api/dev/bank-review/session/{session_id}/save-exam")
def bank_review_save_exam(
    session_id: str,
    req: SaveExamRequest,
    _parent_id: str = Depends(require_parent),
):
    """Write the session items back as an imported exam paper under data/exams/.

    Prefer this over Append when reviewing mock exams. Overwrites the target
    filename (optional .bak). Does not touch data/exercise_*.json.
    """
    sess = _get_session(session_id)
    try:
        filename = _safe_exam_filename(
            req.filename
            or sess.get("exam_filename")
            or f"{Path(str(sess.get('source_name') or 'reviewed_exam')).stem}.json"
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_filename", "message": str(exc)},
        ) from exc

    exams_dir = _exams_dir()
    exams_dir.mkdir(parents=True, exist_ok=True)
    exam_path = (exams_dir / filename).resolve()
    if not exam_path.is_relative_to(exams_dir):
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_path", "message": "Refusing to write outside data/exams/"},
        )

    meta = dict(sess.get("exam_meta") or {})
    title = req.title if req.title is not None else meta.get("title") or Path(filename).stem
    time_limit = req.time_limit_minutes
    if time_limit is None:
        try:
            time_limit = int(meta.get("time_limit_minutes") or 60)
        except (TypeError, ValueError):
            time_limit = 60
    time_limit = max(5, min(180, int(time_limit)))

    questions = _session_items_for_write(sess, require_bank_target=False)
    paper = {
        "title": title,
        "time_limit_minutes": time_limit,
        "questions": questions,
    }

    write_result = _write_json_with_verified_backup(
        exam_path,
        paper,
        create_backup=req.create_backup,
    )

    with _sessions_lock:
        sess["exam_filename"] = filename
        sess["exam_meta"] = {"title": title, "time_limit_minutes": time_limit}
        sess["source_kind"] = "exam"
        sess["detected_format"] = "imported_exam"
        sess["source_name"] = str(title)

    return {
        "ok": True,
        "filename": filename,
        "path": str(exam_path),
        "title": title,
        "time_limit_minutes": time_limit,
        "num_questions": len(questions),
        # ``backup`` remains for existing clients; it now reports actual creation.
        "backup": write_result.backup_created,
        "backup_requested": write_result.backup_requested,
        "backup_created": write_result.backup_created,
        "backup_path": write_result.backup_path,
    }


@router.delete("/api/dev/bank-review/session/{session_id}")
def bank_review_close_session(session_id: str, _parent_id: str = Depends(require_parent)):
    """Close/discard a bank review session, freeing a slot."""
    with _sessions_lock:
        if session_id in _sessions:
            _sessions.pop(session_id)
            return {"status": "closed", "session_id": session_id}
        raise HTTPException(status_code=404, detail="Session not found or already expired.")


@router.get("/api/dev/bank-review/session/{session_id}")
def bank_review_session(session_id: str, _parent_id: str = Depends(require_parent)):
    sess = _get_session(session_id)
    items = sess["items"]
    validations = sess["validations"]
    reviewed_map = sess["reviewed"]
    index = []
    for ex, v in zip(items, validations):
        rid = v.get("id") or (ex.get("id") if isinstance(ex, dict) else None)
        index.append(_index_entry(
            ex if isinstance(ex, dict) else {},
            v,
            bool(reviewed_map.get(str(rid), False)) if rid else False,
        ))
    return {
        "session_id": session_id,
        "source_name": sess["source_name"],
        "source_kind": sess.get("source_kind") or "bank",
        "detected_format": sess.get("detected_format"),
        "exam_filename": sess.get("exam_filename"),
        "bank_filename": sess.get("bank_filename"),
        "exam_meta": sess.get("exam_meta") or {},
        "total": len(index),
        "items": index,
    }


@router.get("/api/dev/bank-review/session/{session_id}/item")
def bank_review_item(
    session_id: str,
    index: int = 0,
    _parent_id: str = Depends(require_parent),
):
    sess = _get_session(session_id)
    items = sess["items"]
    if index < 0 or index >= len(items):
        raise HTTPException(
            status_code=400,
            detail={"error": "index_out_of_range", "message": f"index must be 0..{len(items) - 1}"},
        )
    ex = items[index]
    v = sess["validations"][index]
    if not isinstance(ex, dict):
        raise HTTPException(status_code=400, detail={"error": "invalid_item", "message": "item is not an object"})
    preview = _resolve_passage_for_preview(ex)
    rid = v.get("id") or ex.get("id")
    return {
        "index": index,
        "total": len(items),
        "meta": _index_entry(ex, v, bool(sess["reviewed"].get(str(rid), False)) if rid else False),
        "exercise": preview,
        "issues": v.get("issues") or [],
        "valid_for_append": bool(v.get("valid_for_append")),
    }


@router.delete("/api/dev/bank-review/session/{session_id}/item")
def bank_review_delete_item(
    session_id: str,
    index: int = 0,
    _parent_id: str = Depends(require_parent),
):
    """Remove one item from the in-memory review session.

    This deliberately does not write a bank/exam file. The caller must use
    Save bank / Save exam (or export/append) to persist the edited session.
    """
    sess = _get_session(session_id)
    with _sessions_lock:
        items = sess["items"]
        if index < 0 or index >= len(items):
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "index_out_of_range",
                    "message": f"index must be 0..{len(items) - 1}",
                },
            )

        deleted = items.pop(index)
        sess["validations"].pop(index)
        deleted_id = str(deleted.get("id")) if isinstance(deleted, dict) and deleted.get("id") else None
        if deleted_id and not any(
            isinstance(item, dict) and str(item.get("id")) == deleted_id
            for item in items
        ):
            sess["reviewed"].pop(deleted_id, None)

        total = len(items)
        next_index = min(index, total - 1) if total else None

    return {
        "ok": True,
        "deleted_id": deleted_id,
        "deleted_index": index,
        "total": total,
        "next_index": next_index,
    }


@router.post("/api/dev/bank-review/session/{session_id}/flag")
def bank_review_flag(
    session_id: str,
    req: FlagRequest,
    _parent_id: str = Depends(require_parent),
):
    sess = _get_session(session_id)
    items = sess["items"]
    if req.index < 0 or req.index >= len(items):
        raise HTTPException(status_code=400, detail={"error": "index_out_of_range", "message": "bad index"})
    ex = items[req.index]
    if not isinstance(ex, dict) or not ex.get("id"):
        raise HTTPException(status_code=400, detail={"error": "missing_id", "message": "item has no id"})
    with _sessions_lock:
        sess["reviewed"][str(ex["id"])] = bool(req.reviewed)
    return {"id": ex["id"], "reviewed": bool(req.reviewed)}


@router.get("/api/dev/bank-review/session/{session_id}/export")
def bank_review_export(
    session_id: str,
    activate: bool = False,
    _parent_id: str = Depends(require_parent),
):
    """Export the current session exercises as a bank-ready JSON array.

    If ``activate=true``, every item is exported with ``status: "active"``
    (session memory is also updated so a subsequent Append writes active rows).
    """
    sess = _get_session(session_id)
    items: list[Any] = []
    with _sessions_lock:
        raw_items = list(sess["items"])
        if activate:
            new_items = []
            new_validations = []
            for ex in raw_items:
                if isinstance(ex, dict):
                    updated = dict(ex)
                    updated["status"] = "active"
                    new_items.append(updated)
                    new_validations.append(validate_exercise_for_bank_review(updated))
                else:
                    new_items.append(ex)
                    new_validations.append(validate_exercise_for_bank_review(ex))
            sess["items"] = new_items
            sess["validations"] = new_validations
            raw_items = new_items
        items = [deepcopy(ex) if isinstance(ex, dict) else ex for ex in raw_items]

    return {
        "source_name": sess.get("source_name"),
        "total": len(items),
        "activated": bool(activate),
        "exercises": items,
    }


class BulkStatusRequest(BaseModel):
    status: Literal["active", "draft"] = "active"
    mode: Literal["all", "valid_only"] = "all"


@router.post("/api/dev/bank-review/session/{session_id}/bulk-status")
def bank_review_bulk_status(
    session_id: str,
    req: BulkStatusRequest,
    _parent_id: str = Depends(require_parent),
):
    """Set status on all (or valid-only) session items — e.g. draft → active before append."""
    sess = _get_session(session_id)
    changed = 0
    with _sessions_lock:
        for i, ex in enumerate(sess["items"]):
            if not isinstance(ex, dict):
                continue
            if req.mode == "valid_only" and not sess["validations"][i].get("valid_for_append"):
                continue
            updated = dict(ex)
            updated["status"] = req.status
            v = validate_exercise_for_bank_review(updated)
            if v["valid_for_append"]:
                try:
                    resolve_exercise_bank_filename(updated)
                except BankPathError as exc:
                    v["valid_for_append"] = False
                    v["issues"].append({
                        "severity": "error",
                        "code": "unmapped_target",
                        "message": str(exc),
                    })
            sess["items"][i] = updated
            sess["validations"][i] = v
            changed += 1
    return {"changed": changed, "status": req.status, "mode": req.mode}


@router.post("/api/dev/bank-review/session/{session_id}/update")
def bank_review_update_item(
    session_id: str,
    req: UpdateItemRequest,
    _parent_id: str = Depends(require_parent),
):
    """Edit one stable session item and revalidate it before committing."""
    if (
        req.question is None
        and req.answer is None
        and req.steps is None
        and req.rubric_key_points is None
        and req.status is None
        and req.sub_parts is None
        and req.difficulty is None
        and req.diagram_data is None
        and not req.clear_diagram
        and req.image is None
        and not req.clear_image
        and req.sample_reasoning is None
        and not req.clear_sample_reasoning
        and req.diagram_description is None
        and not req.clear_diagram_description
    ):
        raise HTTPException(
            status_code=400,
            detail={
                "error": "empty_update",
                "message": "Provide at least one editable authoring field.",
            },
        )

    sess = _get_session(session_id)
    with _sessions_lock:
        items = sess["items"]
        if req.index < 0 or req.index >= len(items):
            raise HTTPException(
                status_code=400,
                detail={"error": "index_out_of_range", "message": f"index must be 0..{len(items) - 1}"},
            )
        target_ref = items[req.index]
        if not isinstance(target_ref, dict):
            raise HTTPException(status_code=400, detail={"error": "invalid_item", "message": "item is not an object"})
        target_id = str(target_ref.get("id") or "").strip() or None
        source = deepcopy(target_ref)

    try:
        updated = _apply_item_edits(source, req)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_update", "message": str(exc)},
        ) from exc
    validation = validate_exercise_for_bank_review(updated)
    if validation["valid_for_append"]:
        try:
            resolve_exercise_bank_filename(updated)
        except BankPathError as exc:
            validation["valid_for_append"] = False
            validation["issues"].append({
                "severity": "error",
                "code": "unmapped_target",
                "message": str(exc),
            })

    with _sessions_lock:
        if _sessions.get(session_id) is not sess:
            raise HTTPException(
                status_code=404,
                detail={"error": "session_not_found", "message": "Bank review session not found or expired."},
            )
        current_items = sess["items"]
        current_index = next(
            (
                index
                for index, item in enumerate(current_items)
                if isinstance(item, dict)
                and (
                    (target_id is not None and str(item.get("id") or "").strip() == target_id)
                    or (target_id is None and item is target_ref)
                )
            ),
            None,
        )
        if current_index is None:
            raise HTTPException(
                status_code=409,
                detail={"error": "stale_item", "message": "The item was removed while the edit was being validated."},
            )
        sess["items"][current_index] = updated
        sess["validations"][current_index] = validation
        rid = validation.get("id") or updated.get("id")
        reviewed = bool(sess["reviewed"].get(str(rid), False)) if rid else False
        total = len(current_items)
        sess["last_access_at"] = time.time()

    preview = _resolve_passage_for_preview(updated)
    return {
        "index": current_index,
        "total": total,
        "meta": _index_entry(updated, validation, reviewed),
        "exercise": preview,
        "issues": validation.get("issues") or [],
        "valid_for_append": bool(validation.get("valid_for_append")),
    }


@router.post("/api/dev/bank-review/session/{session_id}/mark")
def bank_review_mark(
    session_id: str,
    req: MarkRequest,
    request: Request,
    _parent_id: str = Depends(require_parent),
):
    """Run the live marking pipeline on a session exercise without writing student logs.

    Uses the imported payload (so not-yet-appended banks can be graded). Same
    graders as practice: MCQ / short answer / reasoning / multi-part.
    """
    sess = _get_session(session_id)
    items = sess["items"]
    if req.index < 0 or req.index >= len(items):
        raise HTTPException(
            status_code=400,
            detail={"error": "index_out_of_range", "message": f"index must be 0..{len(items) - 1}"},
        )
    ex = items[req.index]
    if not isinstance(ex, dict):
        raise HTTPException(status_code=400, detail={"error": "invalid_item", "message": "item is not an object"})

    # Prefer a stable student id when present (LLM health / pu-mode), but do not persist.
    student_id = (
        request.headers.get("X-Student-Id")
        or request.headers.get("Authorization")
        or "bank-review-local"
    )
    if isinstance(student_id, str) and student_id.lower().startswith("bearer "):
        student_id = student_id[7:].strip() or "bank-review-local"

    engine = get_tutor_engine()
    result = engine.mark_question_ephemeral(
        ex,
        req.student_answer,
        student_id=student_id if isinstance(student_id, str) else "bank-review-local",
    )
    return result


def _atomic_append_to_bank(
    bank_path: Path,
    new_items: list[dict[str, Any]],
) -> dict[str, Any]:
    """Append valid items with a per-file locked read/merge/atomic-replace."""
    if not new_items:
        return {
            "file": bank_path.name,
            "added": 0,
            "skipped_duplicate": [],
            "added_ids": [],
            "backup_requested": False,
            "backup_created": False,
            "backup_path": None,
        }

    invalid = []
    for index, item in enumerate(new_items):
        validation = validate_exercise_for_bank_review(item)
        if not validation.get("valid_for_append"):
            invalid.append({"index": str(index), "id": str(validation.get("id") or index)})
    if invalid:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "invalid_items",
                "message": f"{len(invalid)} selected item(s) failed durable-boundary validation.",
                "items": invalid[:50],
            },
        )

    with _write_lock_for(bank_path):
        existing: list[Any] = []
        if bank_path.exists():
            try:
                loaded = json.loads(bank_path.read_text(encoding="utf-8"))
                if not isinstance(loaded, list):
                    raise HTTPException(
                        status_code=500,
                        detail={"error": "invalid_bank_shape", "message": f"{bank_path.name} is not a JSON array"},
                    )
                existing = loaded
            except json.JSONDecodeError as exc:
                raise HTTPException(
                    status_code=500,
                    detail={"error": "bank_json_error", "message": f"Failed to parse {bank_path.name}: {exc}"},
                ) from exc

        existing_ids = {
            str(item.get("id"))
            for item in existing
            if isinstance(item, dict) and item.get("id") is not None
        }
        added: list[dict[str, Any]] = []
        skipped: list[str] = []
        for item in new_items:
            iid = str(item.get("id"))
            if iid in existing_ids:
                skipped.append(iid)
                continue
            existing.append(deepcopy(item))
            existing_ids.add(iid)
            added.append(item)

        if not added:
            return {
                "file": bank_path.name,
                "added": 0,
                "skipped_duplicate": skipped,
                "added_ids": [],
                "backup_requested": False,
                "backup_created": False,
                "backup_path": None,
            }

        write_result = _write_json_with_verified_backup(
            bank_path,
            existing,
            create_backup=True,
        )
        return {
            "file": bank_path.name,
            "added": len(added),
            "skipped_duplicate": skipped,
            "added_ids": [str(item.get("id")) for item in added],
            "backup_requested": write_result.backup_requested,
            "backup_created": write_result.backup_created,
            "backup_path": write_result.backup_path,
        }


@router.post("/api/dev/bank-review/session/{session_id}/append")
def bank_review_append(
    session_id: str,
    req: AppendRequest,
    _parent_id: str = Depends(require_parent),
):
    sess = _get_session(session_id)
    with _sessions_lock:
        items = deepcopy(sess["items"])
        reviewed_map = dict(sess["reviewed"])

    selected: list[dict[str, Any]] = []
    blocked_invalid: list[str] = []
    blocked_unmapped: list[str] = []
    id_set = {str(item_id) for item_id in req.ids} if req.mode == "ids" else None

    for index, ex in enumerate(items):
        if not isinstance(ex, dict):
            blocked_invalid.append(str(index))
            continue
        validation = validate_exercise_for_bank_review(ex)
        eid = str(ex.get("id") or validation.get("id") or "")
        if not eid:
            blocked_invalid.append(str(index))
            continue
        if req.mode == "reviewed_only" and not reviewed_map.get(eid, False):
            continue
        if req.mode == "ids" and eid not in (id_set or set()):
            continue
        if not validation.get("valid_for_append"):
            blocked_invalid.append(eid)
            continue
        try:
            resolve_exercise_bank_filename(ex)
        except BankPathError:
            blocked_unmapped.append(eid)
            continue
        selected.append(ex)

    grouped, unmapped = group_exercises_by_bank(selected)
    for item in unmapped:
        if item.get("id"):
            blocked_unmapped.append(str(item["id"]))

    file_reports: list[dict[str, Any]] = []
    total_added = 0
    all_skipped: list[str] = []
    for filename, group in grouped.items():
        path = _data_dir() / filename
        try:
            report = _atomic_append_to_bank(path, group)
        except HTTPException as exc:
            detail = (
                dict(exc.detail)
                if isinstance(exc.detail, dict)
                else {"error": "append_failed", "message": str(exc.detail)}
            )
            detail["files_written"] = file_reports
            detail["per_file_atomic"] = True
            raise HTTPException(status_code=exc.status_code, detail=detail) from exc
        file_reports.append(report)
        total_added += int(report["added"])
        all_skipped.extend(report.get("skipped_duplicate") or [])

    reload_stats: dict[str, Any] = {}
    if total_added > 0:
        try:
            reload_stats = get_tutor_engine().reload_exercises()
        except Exception as exc:
            logger.exception("Failed to reload exercises after append")
            raise HTTPException(
                status_code=500,
                detail={
                    "error": "reload_failed",
                    "message": "Bank file changes were written, but the tutor cache could not be reloaded.",
                    "added_total": total_added,
                    "files_written": file_reports,
                    "backup_created": any(
                        bool(report.get("backup_created")) for report in file_reports
                    ),
                    "backup_paths": [
                        report["backup_path"]
                        for report in file_reports
                        if report.get("backup_path")
                    ],
                    "reload_succeeded": False,
                    "per_file_atomic": True,
                },
            ) from exc

    return {
        "added_total": total_added,
        "files": file_reports,
        "skipped_duplicate": all_skipped,
        "blocked_invalid": blocked_invalid,
        "blocked_unmapped": blocked_unmapped,
        "selected_count": len(selected),
        "backup_created": any(
            bool(report.get("backup_created")) for report in file_reports
        ),
        "backup_paths": [
            report["backup_path"]
            for report in file_reports
            if report.get("backup_path")
        ],
        "reload_succeeded": True,
        "reload": reload_stats,
    }
