from __future__ import annotations

import json
import logging
import re
import threading
import weakref
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend import rules
from backend.student_lifecycle import student_write_guard
from backend.services.atomic_files import atomic_write_text

logger = logging.getLogger(__name__)


class PSMTHistoryRequestConflict(ValueError):
    """Raised when a PSMT request ID is reused for different content."""


# Callers hold a strong local reference for the duration of each operation, so
# weak values retain per-student exclusion without leaking one lock per ID.
_LOCKS: weakref.WeakValueDictionary[str, threading.RLock] = weakref.WeakValueDictionary()
_LOCKS_GUARD = threading.Lock()


def _lock_for(student_id: str) -> threading.RLock:
    with _LOCKS_GUARD:
        lock = _LOCKS.get(student_id)
        if lock is None:
            lock = threading.RLock()
            _LOCKS[student_id] = lock
        return lock


def _history_path(student_id: str) -> Path:
    return rules.LOG_ROOT / student_id / "psmt_feedback_log.json"


def _is_available_history_item(item: dict[str, Any]) -> bool:
    """Exclude known placeholder feedback from readiness/history projections."""
    status = str(item.get("llm_status") or "").strip().lower()
    if status in {"mock", "unavailable"}:
        return False
    excerpt = str(item.get("feedback_excerpt") or "").strip().lower()
    unavailable_markers = (
        "feedback temporarily unavailable",
        "[mock mode]",
        "evaluation is unavailable without an llm api key",
    )
    return not any(marker in excerpt for marker in unavailable_markers)

def _read_items(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Failed to read PSMT history %s: %s", path, exc)
        return []
    if isinstance(data, list):
        return [
            item for item in data
            if isinstance(item, dict) and _is_available_history_item(item)
        ]
    if isinstance(data, dict) and isinstance(data.get("items"), list):
        return [
            item for item in data["items"]
            if isinstance(item, dict) and _is_available_history_item(item)
        ]
    return []


def _write_items(path: Path, items: list[dict[str, Any]]) -> None:
    atomic_write_text(
        path,
        json.dumps(items[-50:], indent=2, ensure_ascii=False),
    )


def _bullets_after_heading(markdown: str, heading_keywords: tuple[str, ...], limit: int = 3) -> list[str]:
    lines = markdown.splitlines()
    collecting = False
    bullets: list[str] = []
    for line in lines:
        stripped = line.strip()
        lower = stripped.lower()
        if stripped.startswith("#"):
            collecting = any(keyword in lower for keyword in heading_keywords)
            continue
        if collecting and re.match(r"^[-*]\s+", stripped):
            bullets.append(re.sub(r"^[-*]\s+", "", stripped).strip())
            if len(bullets) >= limit:
                break
    return bullets


def _infer_readiness(feedback_markdown: str) -> str:
    lower = feedback_markdown.lower()
    if any(term in lower for term in ("excellent", "ready", "strong", "high standard")):
        return "ready"
    if any(term in lower for term in ("major gap", "missing", "not yet", "limited")):
        return "needs_attention"
    return "developing"


def _excerpt(markdown: str, limit: int = 360) -> str:
    text = re.sub(r"\s+", " ", markdown).strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "..."


def append_psmt_history(
    *,
    student_id: str,
    subject: str,
    section_name: str,
    draft_text: str,
    images: list[str] | None,
    feedback_markdown: str,
    structured_feedback: dict[str, Any] | None = None,
    llm_status: str,
    request_id: str | None = None,
    request_fingerprint: str | None = None,
) -> dict[str, Any] | None:
    """Append live PSMT metadata with optional business-level request deduplication."""
    if str(llm_status).strip().lower() != "live":
        return None
    structured_feedback = structured_feedback or {}
    item = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "llm_status": "live",
        "subject": subject,
        "section_name": section_name,
        "draft_length": len(draft_text or ""),
        "image_count": len(images or []),
        "readiness_level": structured_feedback.get("readiness_level") or _infer_readiness(feedback_markdown),
        "criterion_scores": structured_feedback.get("criterion_scores") or {},
        "top_gaps": structured_feedback.get("top_gaps") or _bullets_after_heading(feedback_markdown, ("gap", "improve", "needs")),
        "next_revision_actions": structured_feedback.get("next_revision_actions") or _bullets_after_heading(feedback_markdown, ("next", "revision", "action")),
        "safety_flags": structured_feedback.get("safety_flags") or [],
        "feedback_excerpt": _excerpt(feedback_markdown),
    }
    if request_id:
        item["request_id"] = str(request_id)
        item["request_fingerprint"] = str(request_fingerprint or "")

    path = _history_path(student_id)
    with student_write_guard(student_id, rules.LOG_ROOT):
        with _lock_for(student_id):
            items = _read_items(path)
            if request_id:
                incoming_fingerprint = str(request_fingerprint or "")
                for existing in items:
                    if str(existing.get("request_id") or "") != str(request_id):
                        continue
                    stored_fingerprint = str(existing.get("request_fingerprint") or "")
                    if (
                        stored_fingerprint
                        and incoming_fingerprint
                        and stored_fingerprint != incoming_fingerprint
                    ):
                        raise PSMTHistoryRequestConflict(
                            "request_id was already used for different PSMT content"
                        )
                    return existing
            items.append(item)
            _write_items(path, items)
    return item


def get_psmt_history(student_id: str, limit: int = 10) -> dict[str, Any]:
    path = _history_path(student_id)
    with _lock_for(student_id):
        items = _read_items(path)
    items = sorted(items, key=lambda item: item.get("timestamp", ""), reverse=True)
    return {"items": items[:limit], "latest": items[0] if items else None, "total": len(items)}
