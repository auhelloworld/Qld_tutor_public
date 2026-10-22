"""Cross-feature lifecycle coordination for per-student filesystem state."""
from __future__ import annotations

import sqlite3
import threading
import weakref
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from backend.sqlite_utils import connect_sqlite


class StudentDeletedError(RuntimeError):
    """Raised when a write targets a permanently deleted student UUID."""


_LOCKS: weakref.WeakValueDictionary[str, threading.RLock] = weakref.WeakValueDictionary()
_LOCKS_GUARD = threading.Lock()


def _lock_for(student_id: str) -> threading.RLock:
    with _LOCKS_GUARD:
        lock = _LOCKS.get(student_id)
        if lock is None:
            lock = threading.RLock()
            _LOCKS[student_id] = lock
        return lock


@contextmanager
def student_lifecycle_lock(student_id: str) -> Iterator[None]:
    """Serialize profile deletion with every per-student filesystem writer."""
    with _lock_for(student_id):
        yield


def student_is_deleted(student_id: str, logs_root: Path) -> bool:
    """Read the durable deletion tombstone without creating a database."""
    db_path = Path(logs_root).parent / "qld_tutor.db"
    if not db_path.is_file():
        return False
    try:
        conn = connect_sqlite(f"file:{db_path}?mode=ro", uri=True)
        try:
            row = conn.execute(
                "SELECT 1 FROM deleted_students WHERE student_id = ? LIMIT 1",
                (student_id,),
            ).fetchone()
            return row is not None
        finally:
            conn.close()
    except sqlite3.OperationalError as exc:
        # Databases created before the tombstone migration have no such table;
        # their next regular rules connection will install it. Other failures
        # fail closed so a lock or I/O error cannot resurrect a deleted profile.
        if "no such table" in str(exc).lower():
            return False
        raise
    except sqlite3.Error:
        raise


@contextmanager
def student_write_guard(student_id: str, logs_root: Path) -> Iterator[None]:
    """Allow one filesystem write only while the profile is active."""
    with student_lifecycle_lock(student_id):
        if student_is_deleted(student_id, logs_root):
            raise StudentDeletedError(f"Student profile {student_id} has been deleted")
        yield
