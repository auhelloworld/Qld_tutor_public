"""Shared SQLite connection policy for runtime and maintenance code."""
from __future__ import annotations

import os
import sqlite3
from os import PathLike
from typing import Any


def _busy_timeout_ms() -> int:
    """Return a bounded busy timeout configurable through the environment."""
    raw = os.getenv("SQLITE_BUSY_TIMEOUT_MS", "30000")
    try:
        value = int(raw)
    except (TypeError, ValueError):
        value = 30_000
    return max(1_000, min(value, 120_000))


SQLITE_BUSY_TIMEOUT_MS = _busy_timeout_ms()


def connect_sqlite(
    database: str | bytes | PathLike[str] | PathLike[bytes],
    *,
    uri: bool = False,
    **kwargs: Any,
) -> sqlite3.Connection:
    """Open SQLite with one explicit busy-wait policy on every connection.

    SQLite permits only one writer even in WAL mode.  The standard library's
    five-second default is too short for occasional concurrent FastAPI writes,
    so all callers share a bounded timeout and the equivalent connection-local
    PRAGMA.  Callers remain responsible for closing the returned connection.
    """
    timeout_seconds = SQLITE_BUSY_TIMEOUT_MS / 1_000
    kwargs.setdefault("timeout", timeout_seconds)
    conn = sqlite3.connect(database, uri=uri, **kwargs)
    conn.execute(f"PRAGMA busy_timeout = {SQLITE_BUSY_TIMEOUT_MS}")
    return conn
