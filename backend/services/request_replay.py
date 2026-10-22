"""Durable idempotency records for authenticated student mutations.

The replay store is deliberately small and filesystem-backed because the project
already keeps per-student durable state in ``data/logs``.  A request ID is scoped
by operation and student, and a fingerprint mismatch is rejected rather than
silently replaying a response for different input.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import tempfile
import threading
import weakref
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, AsyncIterator

from backend import rules
from backend.student_lifecycle import student_write_guard

_REPLAY_FILENAME = "mutation_request_replays.json"
_MAX_RECORDS = 256

_SYNC_LOCKS: weakref.WeakValueDictionary[str, threading.RLock] = weakref.WeakValueDictionary()
_SYNC_LOCKS_GUARD = threading.Lock()
_ASYNC_LOCKS: weakref.WeakValueDictionary[str, asyncio.Lock] = weakref.WeakValueDictionary()
_ASYNC_LOCKS_GUARD = threading.Lock()


class RequestReplayConflict(ValueError):
    """Raised when one request ID is reused with a different payload."""


def request_fingerprint(payload: Any, *, exclude: set[str] | None = None) -> str:
    """Return a stable SHA-256 fingerprint for a request body.

    Pydantic models are accepted directly for convenience.  ``exclude`` only
    removes top-level keys, which is sufficient for request/idempotency fields.
    """
    if hasattr(payload, "model_dump"):
        payload = payload.model_dump(mode="json")
    if isinstance(payload, dict):
        payload = {
            key: value
            for key, value in payload.items()
            if key not in (exclude or set())
        }
    canonical = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _lock_key(student_id: str, operation: str, request_id: str) -> str:
    return f"{student_id}:{operation}:{request_id}"


def _sync_lock_for(key: str) -> threading.RLock:
    with _SYNC_LOCKS_GUARD:
        lock = _SYNC_LOCKS.get(key)
        if lock is None:
            lock = threading.RLock()
            _SYNC_LOCKS[key] = lock
        return lock


def _async_lock_for(key: str) -> asyncio.Lock:
    with _ASYNC_LOCKS_GUARD:
        lock = _ASYNC_LOCKS.get(key)
        if lock is None:
            lock = asyncio.Lock()
            _ASYNC_LOCKS[key] = lock
        return lock


@contextmanager
def replay_lock(student_id: str, operation: str, request_id: str) -> Iterator[None]:
    """Serialize same-key synchronous callers in one process."""
    key = _lock_key(str(student_id), str(operation), str(request_id))
    with _sync_lock_for(key):
        yield


@asynccontextmanager
async def async_replay_lock(
    student_id: str,
    operation: str,
    request_id: str,
) -> AsyncIterator[None]:
    """Serialize same-key async callers in one process without blocking the loop."""
    key = _lock_key(str(student_id), str(operation), str(request_id))
    async with _async_lock_for(key):
        yield


# Explicit aliases make the intended use at route call sites easy to discover.
request_replay_lock = replay_lock
async_request_replay_lock = async_replay_lock


def _replay_path(student_id: str) -> Path:
    return Path(rules.LOG_ROOT) / str(student_id) / _REPLAY_FILENAME


def _read_records(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, TypeError, ValueError):
        return []
    if isinstance(data, dict) and isinstance(data.get("records"), list):
        raw_records = data["records"]
    elif isinstance(data, list):
        # Tolerate a simple list written by an early development build.
        raw_records = data
    else:
        return []
    return [record for record in raw_records if isinstance(record, dict)][-_MAX_RECORDS:]


def _json_clone(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        value = value.model_dump(mode="json")
    return json.loads(json.dumps(value, ensure_ascii=False, default=str))


def replay_lookup(
    student_id: str,
    operation: str,
    request_id: str,
    fingerprint: str,
) -> dict[str, Any] | None:
    """Return a previously stored response, or ``None`` for a new request."""
    path = _replay_path(student_id)
    with _sync_lock_for(_lock_key(str(student_id), str(operation), str(request_id))):
        with student_write_guard(str(student_id), Path(rules.LOG_ROOT)):
            for record in reversed(_read_records(path)):
                if (
                    str(record.get("operation")) != str(operation)
                    or str(record.get("request_id")) != str(request_id)
                ):
                    continue
                stored = str(record.get("fingerprint") or "")
                if stored and stored != fingerprint:
                    raise RequestReplayConflict(
                        f"request_id was already used for different {operation} content"
                    )
                response = record.get("response")
                return _json_clone(response) if response is not None else None
    return None


def replay_store(
    student_id: str,
    operation: str,
    request_id: str,
    fingerprint: str,
    response: Any,
) -> None:
    """Persist a successful mutation response using an atomic bounded write."""
    path = _replay_path(student_id)
    key = _lock_key(str(student_id), str(operation), str(request_id))
    with _sync_lock_for(key):
        with student_write_guard(str(student_id), Path(rules.LOG_ROOT)):
            path.parent.mkdir(parents=True, exist_ok=True)
            records = _read_records(path)
            for record in records:
                if (
                    str(record.get("operation")) == str(operation)
                    and str(record.get("request_id")) == str(request_id)
                ):
                    stored = str(record.get("fingerprint") or "")
                    if stored and stored != fingerprint:
                        raise RequestReplayConflict(
                            f"request_id was already used for different {operation} content"
                        )
                    return
            records.append({
                "operation": str(operation),
                "request_id": str(request_id),
                "fingerprint": fingerprint,
                "stored_at": datetime.now(timezone.utc).isoformat(),
                "response": _json_clone(response),
            })
            records = records[-_MAX_RECORDS:]
            content = json.dumps(
                {"version": 1, "records": records},
                ensure_ascii=False,
                indent=2,
            ) + "\n"
            fd, temp_name = tempfile.mkstemp(
                dir=str(path.parent),
                prefix=f".{path.name}.",
                suffix=".tmp",
            )
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as handle:
                    handle.write(content)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temp_name, path)
            except BaseException:
                try:
                    os.unlink(temp_name)
                except OSError:
                    pass
                raise
