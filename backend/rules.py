import json
import logging
import threading
import sqlite3
import uuid
import weakref
from collections import OrderedDict
from pathlib import Path
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)


def _set_wal_journal_mode(conn: sqlite3.Connection) -> None:
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
    except sqlite3.OperationalError:
        pass


# Marker key added by ``StudyRuleEngine._read_log(topics=...)``. A log read with a
# topic filter is a partial view and must never be persisted as subject-level
# metadata.
PARTIAL_SCOPE_KEY = "__partial_topic_scope__"

from backend.curriculum_loader import CurriculumLoader, get_shared_loader
from backend.subject_registry import is_known_subject
from backend.student_identity import UUID_V4_PATTERN
from backend.sqlite_utils import connect_sqlite
from backend.student_lifecycle import student_is_deleted as _student_is_deleted
from backend.student_lifecycle import student_lifecycle_lock
from backend.spaced_repetition import SpacedRepetitionScheduler, MASTERY_THRESHOLD
from backend.services.today_topics import TopicFacts, build_topic_facts
from core.algorithms.bkt import calculate_bkt as _bkt_core, recompute_accuracy as _recompute_accuracy_core
from backend.services.attempt_outcomes import (
    AttemptOutcome,
    classify_attempt,
    confirmed_error_view,
    counts_as_right,
    deduplicate_attempts,
    is_error_book_closure_evidence,
    is_independent_learning_attempt,
    is_scored_learning_attempt,
    part_error_entries,
    part_error_snapshot,
    part_review_key,
    persist_outcome,
    physical_attempt_key,
)

project_root = Path(__file__).resolve().parents[1]
LOG_ROOT = project_root / "data" / "logs"
# 2: a right answer that the student marked "guess" no longer moves a mistake on.
MISTAKE_STATE_DERIVATION_VERSION = 2


class AttemptRequestConflict(ValueError):
    """Raised when a tutor-mark request ID is reused with new content."""


def _contains_parent_review_pending(value: object) -> bool:
    """Return whether persisted attempt data explicitly requests parent review."""
    if isinstance(value, dict):
        if str(value.get("error_type") or "").strip().lower() == "parent_review_pending":
            return True
        return any(_contains_parent_review_pending(item) for item in value.values())
    if isinstance(value, list):
        return any(_contains_parent_review_pending(item) for item in value)
    return False


def _attempt_index_values(attempt: dict) -> tuple[str, int, int]:
    """Derive denormalised columns used by hot attempt queries."""
    return (
        classify_attempt(attempt).value,
        1 if bool(attempt.get("is_speed_round")) else 0,
        1 if _contains_parent_review_pending(attempt) else 0,
    )


def _attempt_link_values(attempt: dict) -> tuple[str | None, str | None]:
    """Return denormalised Error Book linkage fields for indexed lookup."""
    review_question_id = str(attempt.get("review_question_id") or "").strip() or None
    error_book_source = str(attempt.get("error_book_source") or "").strip() or None
    return review_question_id, error_book_source


def _attempt_insert_values(
    student_id: str, subject: str, topic: str, attempt: dict
) -> tuple[object, ...]:
    outcome, is_speed_round, review_pending = _attempt_index_values(attempt)
    return (
        student_id,
        subject,
        topic,
        attempt.get("question_id") or "",
        1 if attempt.get("correct") else 0,
        attempt.get("error_type"),
        attempt.get("timestamp") or "",
        attempt.get("skill_id") or f"{topic}/{attempt.get('question_id')}",
        attempt.get("response_time_ms", 0),
        attempt.get("attempt_type", "answer"),
        attempt.get("student_answer"),
        attempt.get("misconception_id"),
        outcome,
        is_speed_round,
        review_pending,
        *_attempt_link_values(attempt),
        json.dumps(attempt),
    )

def _backfill_attempt_index_columns(conn: sqlite3.Connection) -> None:
    """Populate structured query columns for rows created by legacy schemas."""
    rows = conn.execute("SELECT id, extra FROM attempts").fetchall()
    updates: list[tuple[object, ...]] = []
    for row_id, raw in rows:
        try:
            attempt = json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            continue
        if not isinstance(attempt, dict):
            continue
        outcome, is_speed_round, review_pending = _attempt_index_values(attempt)
        review_question_id, error_book_source = _attempt_link_values(attempt)
        updates.append((
            outcome,
            is_speed_round,
            review_pending,
            review_question_id,
            error_book_source,
            int(row_id),
        ))
    if updates:
        conn.executemany(
            """
            UPDATE attempts
            SET outcome = ?, is_speed_round = ?, review_pending = ?,
                review_question_id = ?, error_book_source = ?
            WHERE id = ?
            """,
            updates,
        )

SUBJECT_FRAMEWORKS = {
    "math": "AC9_MATHS",
    "mathematics": "AC9_MATHS",
    "english": "AC9_ENGLISH",
    "science": "AC9_SCIENCE",
}


# ---------------------------------------------------------------------------
# Shared SQLite schema DDL — single source of truth (Design §3.5; Req 9.1)
# ---------------------------------------------------------------------------

_SCHEMA_DDL = [
    """
    CREATE TABLE IF NOT EXISTS attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        topic TEXT NOT NULL,
        question_id TEXT NOT NULL,
        correct INTEGER NOT NULL,
        error_type TEXT,
        timestamp TEXT NOT NULL,
        skill_id TEXT NOT NULL,
        response_time_ms INTEGER NOT NULL,
        attempt_type TEXT NOT NULL,
        student_answer TEXT,
        misconception_id TEXT,
        outcome TEXT NOT NULL DEFAULT '',
        is_speed_round INTEGER NOT NULL DEFAULT 0,
        review_pending INTEGER NOT NULL DEFAULT 0,
        review_question_id TEXT,
        error_book_source TEXT,
        extra TEXT NOT NULL
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS attempt_request_results (
        student_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        request_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        attempt_id TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (student_id, subject, request_id)
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_attempt_request_results_attempt
    ON attempt_request_results(student_id, subject, attempt_id);
    """,
    "CREATE INDEX IF NOT EXISTS idx_attempts_student_subject ON attempts(student_id, subject);",
    "CREATE INDEX IF NOT EXISTS idx_attempts_outcomes ON attempts(student_id, subject, attempt_type, question_id);",
    """CREATE INDEX IF NOT EXISTS idx_attempts_scored_question_ids_covering
       ON attempts(student_id, subject, question_id, attempt_type, outcome, is_speed_round)
       WHERE attempt_type IN ('answer', 'diagnostic')
         AND outcome IN ('correct', 'incorrect')
         AND is_speed_round = 0 AND question_id != '';""",
    "CREATE INDEX IF NOT EXISTS idx_attempts_parent_review ON attempts(student_id, subject, review_pending, id);",
    "CREATE INDEX IF NOT EXISTS idx_attempts_topic_order ON attempts(student_id, subject, topic, id);",
    "CREATE INDEX IF NOT EXISTS idx_attempts_activity ON attempts(student_id, subject, attempt_type, timestamp);",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_attempts_unique ON attempts(student_id, subject, topic, question_id, timestamp);",
    """
    CREATE TABLE IF NOT EXISTS topic_metadata (
        student_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        topic TEXT NOT NULL,
        accuracy REAL NOT NULL,
        metadata TEXT NOT NULL,
        PRIMARY KEY (student_id, subject, topic)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS diagnostic_status (
        student_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        year_level INTEGER NOT NULL,
        status_data TEXT NOT NULL,
        PRIMARY KEY (student_id, subject, year_level)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS student_subject_metadata (
        student_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        metadata TEXT NOT NULL,
        PRIMARY KEY (student_id, subject)
    );
    """,
    f"""
    CREATE TABLE IF NOT EXISTS mistake_state (
        student_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        question_id TEXT NOT NULL,
        topic_id TEXT NOT NULL,
        error_type TEXT,
        last_incorrect_at TEXT NOT NULL,
        last_correct_after_error_at TEXT,
        fixed_by_later_correct INTEGER NOT NULL DEFAULT 0,
        attempt_count INTEGER NOT NULL,
        attempt_data TEXT NOT NULL,
        resolved INTEGER NOT NULL DEFAULT 0,
        resolved_at TEXT,
        review_count INTEGER NOT NULL DEFAULT 0,
        resolution_source TEXT,
        closure_stage TEXT NOT NULL DEFAULT 'needs_understanding',
        error_cause TEXT,
        cause_recorded_at TEXT,
        retry_correct_at TEXT,
        transfer_correct_at TEXT,
        consolidation_due_at TEXT,
        closed_at TEXT,
        derivation_version INTEGER NOT NULL DEFAULT {MISTAKE_STATE_DERIVATION_VERSION},
        updated_at TEXT NOT NULL,
        PRIMARY KEY (student_id, subject, question_id)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS mistake_state_topics (
        student_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        question_id TEXT NOT NULL,
        topic_id TEXT NOT NULL,
        PRIMARY KEY (student_id, subject, question_id, topic_id)
    );
    """,
    "CREATE INDEX IF NOT EXISTS idx_mistake_state_recent ON mistake_state(student_id, subject, last_incorrect_at DESC, question_id);",
    "CREATE INDEX IF NOT EXISTS idx_mistake_state_error ON mistake_state(student_id, subject, error_type, last_incorrect_at DESC);",
    "CREATE INDEX IF NOT EXISTS idx_mistake_topics_scope ON mistake_state_topics(student_id, subject, topic_id, question_id);",
    "CREATE INDEX IF NOT EXISTS idx_attempts_question_order ON attempts(student_id, subject, question_id, id);",
    "CREATE INDEX IF NOT EXISTS idx_attempts_review_question ON attempts(student_id, subject, review_question_id, id);",
    "CREATE INDEX IF NOT EXISTS idx_attempts_error_book_source ON attempts(student_id, subject, error_book_source, id);",
    "CREATE INDEX IF NOT EXISTS idx_attempts_student_timestamp ON attempts(student_id, timestamp, id);",
    """
    CREATE TABLE IF NOT EXISTS weekly_reflections (
        student_id TEXT NOT NULL,
        week_start TEXT NOT NULL,
        proud_of TEXT NOT NULL DEFAULT '',
        challenge TEXT NOT NULL DEFAULT '',
        next_week_intention TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (student_id, week_start)
    );
    """,
    "CREATE INDEX IF NOT EXISTS idx_weekly_reflections_student_week ON weekly_reflections(student_id, week_start DESC);",
    """
    CREATE TABLE IF NOT EXISTS deleted_students (
        student_id TEXT PRIMARY KEY,
        deleted_at TEXT NOT NULL
    );
    """,
    """
    CREATE TRIGGER IF NOT EXISTS prevent_deleted_attempt_insert
    BEFORE INSERT ON attempts
    WHEN EXISTS (SELECT 1 FROM deleted_students WHERE student_id = NEW.student_id)
    BEGIN SELECT RAISE(ABORT, 'student profile deleted'); END;
    """,
    """
    CREATE TRIGGER IF NOT EXISTS prevent_deleted_topic_metadata_insert
    BEFORE INSERT ON topic_metadata
    WHEN EXISTS (SELECT 1 FROM deleted_students WHERE student_id = NEW.student_id)
    BEGIN SELECT RAISE(ABORT, 'student profile deleted'); END;
    """,
    """
    CREATE TRIGGER IF NOT EXISTS prevent_deleted_diagnostic_insert
    BEFORE INSERT ON diagnostic_status
    WHEN EXISTS (SELECT 1 FROM deleted_students WHERE student_id = NEW.student_id)
    BEGIN SELECT RAISE(ABORT, 'student profile deleted'); END;
    """,
    """
    CREATE TRIGGER IF NOT EXISTS prevent_deleted_student_metadata_insert
    BEFORE INSERT ON student_subject_metadata
    WHEN EXISTS (SELECT 1 FROM deleted_students WHERE student_id = NEW.student_id)
    BEGIN SELECT RAISE(ABORT, 'student profile deleted'); END;
    """,
    """
    CREATE TRIGGER IF NOT EXISTS prevent_deleted_mistake_state_insert
    BEFORE INSERT ON mistake_state
    WHEN EXISTS (SELECT 1 FROM deleted_students WHERE student_id = NEW.student_id)
    BEGIN SELECT RAISE(ABORT, 'student profile deleted'); END;
    """,
    """
    CREATE TRIGGER IF NOT EXISTS prevent_deleted_mistake_topic_insert
    BEFORE INSERT ON mistake_state_topics
    WHEN EXISTS (SELECT 1 FROM deleted_students WHERE student_id = NEW.student_id)
    BEGIN SELECT RAISE(ABORT, 'student profile deleted'); END;
    """,
    """
    CREATE TRIGGER IF NOT EXISTS prevent_deleted_weekly_reflection_insert
    BEFORE INSERT ON weekly_reflections
    WHEN EXISTS (SELECT 1 FROM deleted_students WHERE student_id = NEW.student_id)
    BEGIN SELECT RAISE(ABORT, 'student profile deleted'); END;
    """,
]


def _ensure_schema(conn: sqlite3.Connection) -> None:
    """Execute all DDL statements to ensure the schema exists (idempotent)."""
    for stmt in _SCHEMA_DDL:
        conn.execute(stmt)


# ---------------------------------------------------------------------------
# Lock registry — per-(student_id, subject) threading.Lock instances
# (Design §3.5, §4.1; Req 9.1, 9.4, 9.5)
# ---------------------------------------------------------------------------


class _LockRegistry:
    def __init__(self):
        self._guard = threading.Lock()
        # Engines keep their lock strongly referenced while in use. Weak values
        # let locks disappear after the bounded engine cache evicts the last
        # engine for a student/subject, instead of retaining every anonymous ID
        # seen for the lifetime of the process.
        self._locks: weakref.WeakValueDictionary[
            tuple[str, str], threading.RLock
        ] = weakref.WeakValueDictionary()

    def get(self, student_id: str, subject: str) -> threading.RLock:
        key = (student_id, subject)
        with self._guard:
            lock = self._locks.get(key)
            if lock is None:
                # Keep a strong local reference until the caller receives it;
                # otherwise a weak-only newly inserted lock can disappear
                # between assignment and lookup.
                lock = threading.RLock()
                self._locks[key] = lock
            return lock

    def discard_student(self, student_id: str) -> None:
        with self._guard:
            for key in [key for key in self._locks if key[0] == student_id]:
                self._locks.pop(key, None)

    def clear(self):
        with self._guard:
            self._locks.clear()


_LOCKS = _LockRegistry()


# ---------------------------------------------------------------------------
# One-time DB schema initialisation cache.
# Schema creation and the legacy 'extra' column migration are idempotent and the
# runtime schema never changes, so each DB path only needs initialising once per
# process. This removes repeated PRAGMA/ALTER/CREATE work from the read/write hot
# path. (reset via backend._testing.reset_engine_factory_cache for tests.)
# ---------------------------------------------------------------------------
_INITIALIZED_DBS: set[str] = set()
_DB_INIT_GUARD = threading.Lock()


# ---------------------------------------------------------------------------
# Engine factory — keyed by (student_id, subject)
# (Design §3.5; Req 5.1, 5.2)
# ---------------------------------------------------------------------------

_ENGINES: OrderedDict = OrderedDict()
_ENGINES_GUARD = threading.Lock()
_ENGINES_MAXSIZE = 128

# Sentinel subject key used to store student profile metadata (display name etc.)
# The one rule for "mastered" (StudyRuleEngine.mastery_established): at least
# MASTERY_MIN_EVIDENCE first answers on the student's own, and
# MASTERY_WINDOW_CORRECT right in the last MASTERY_MIN_EVIDENCE of them. This is
# the "3 of 4 right on your own" rule of Today's new-topic step. BKT alone is
# not enough: one right short answer already puts it above 0.8.
MASTERY_MIN_EVIDENCE = 4
MASTERY_WINDOW_CORRECT = 3

PROFILE_SUBJECT = "_profile"


def runtime_db_path() -> Path:
    """Return the active SQLite path using the current (test-patchable) LOG_ROOT."""
    return LOG_ROOT.parent / "qld_tutor.db"


def is_student_deleted(student_id: str) -> bool:
    """Return whether a durable profile-deletion tombstone exists."""
    return _student_is_deleted(student_id, LOG_ROOT)


def get_engine(student_id: str, subject: str) -> "StudyRuleEngine":
    """Factory: returns a rule engine for a validated storage subject."""
    safe_subject = str(subject).strip().lower()
    if safe_subject != PROFILE_SUBJECT and not is_known_subject(safe_subject):
        raise ValueError(f"Unknown or unsafe storage subject: {subject!r}")
    key = (student_id, safe_subject)
    with _ENGINES_GUARD:
        if key in _ENGINES:
            _ENGINES.move_to_end(key)
            return _ENGINES[key]
        if len(_ENGINES) >= _ENGINES_MAXSIZE:
            _ENGINES.popitem(last=False)
        _ENGINES[key] = StudyRuleEngine(student_id=student_id, subject=safe_subject)
        return _ENGINES[key]


# ---------------------------------------------------------------------------
# StudyRuleEngine — per-student, per-subject rule engine
# ---------------------------------------------------------------------------


class StudyRuleEngine:
    def __init__(self, *, student_id: str, subject: str):
        safe_subject = str(subject).strip().lower()
        if safe_subject != PROFILE_SUBJECT and not is_known_subject(safe_subject):
            raise ValueError(f"Unknown or unsafe storage subject: {subject!r}")
        self.student_id = student_id
        self.subject = safe_subject
        self._lock = _LOCKS.get(student_id, safe_subject)
        # Shared process-wide loader: a private loader per engine duplicated every
        # parsed curriculum slice across the bounded engine cache.
        self._loader = get_shared_loader()
        self._ensure_db(self._db_path)
        self._refresh_outdated_mistake_states()

    @property
    def _db_path(self) -> Path:
        return runtime_db_path()

    @staticmethod
    def _ensure_db(db_path: Path):
        """Ensure the SQLite database file and tables are initialised with correct schema.

        Runs the full schema/migration work only once per DB path per process
        (cached in ``_INITIALIZED_DBS``); subsequent calls return immediately.
        Schema changes and legacy attempt-column backfills are idempotent.
        """
        key = str(db_path)
        if key in _INITIALIZED_DBS:
            return
        with _DB_INIT_GUARD:
            if key in _INITIALIZED_DBS:
                return
            if not db_path.exists():
                db_path.parent.mkdir(parents=True, exist_ok=True)

            conn = connect_sqlite(str(db_path))
            try:
                _set_wal_journal_mode(conn)
                columns = {
                    str(row[1])
                    for row in conn.execute("PRAGMA table_info(attempts)").fetchall()
                }
                needs_attempt_backfill = False
                if columns:
                    additions = {
                        "extra": "TEXT NOT NULL DEFAULT '{}'",
                        "outcome": "TEXT NOT NULL DEFAULT ''",
                        "is_speed_round": "INTEGER NOT NULL DEFAULT 0",
                        "review_pending": "INTEGER NOT NULL DEFAULT 0",
                        "review_question_id": "TEXT",
                        "error_book_source": "TEXT",
                    }
                    for name, declaration in additions.items():
                        if name not in columns:
                            conn.execute(
                                f"ALTER TABLE attempts ADD COLUMN {name} {declaration}"
                            )
                            needs_attempt_backfill = True
                _ensure_schema(conn)
                mistake_columns = {
                    str(row[1])
                    for row in conn.execute("PRAGMA table_info(mistake_state)").fetchall()
                }
                if mistake_columns:
                    mistake_additions = {
                        "closure_stage": "TEXT NOT NULL DEFAULT 'needs_understanding'",
                        "error_cause": "TEXT",
                        "cause_recorded_at": "TEXT",
                        "retry_correct_at": "TEXT",
                        "transfer_correct_at": "TEXT",
                        "consolidation_due_at": "TEXT",
                        "closed_at": "TEXT",
                        "derivation_version": "INTEGER NOT NULL DEFAULT 0",
                    }
                    for name, declaration in mistake_additions.items():
                        if name not in mistake_columns:
                            conn.execute(
                                f"ALTER TABLE mistake_state ADD COLUMN {name} {declaration}"
                            )
                    conn.execute(
                        """
                        UPDATE mistake_state
                        SET closure_stage = CASE
                            WHEN resolved = 1 AND resolution_source = 'manual_dismissal' THEN 'dismissed'
                            WHEN resolved = 1 THEN 'closed'
                            WHEN fixed_by_later_correct = 1 THEN 'needs_transfer'
                            WHEN COALESCE(json_extract(attempt_data, '$.error_cause'),
                                          json_extract(attempt_data, '$.reflection_type'), '') != ''
                                THEN 'needs_retry'
                            ELSE 'needs_understanding'
                        END
                        WHERE closure_stage IS NULL OR closure_stage = ''
                        """
                    )
                    conn.execute(
                        "CREATE INDEX IF NOT EXISTS idx_mistake_state_closure "
                        "ON mistake_state(student_id, subject, closure_stage, last_incorrect_at DESC)"
                    )
                    conn.execute(
                        "CREATE INDEX IF NOT EXISTS idx_mistake_state_student_closed "
                        "ON mistake_state(student_id, closure_stage, closed_at)"
                    )
                if needs_attempt_backfill:
                    _backfill_attempt_index_columns(conn)
                conn.commit()
            finally:
                conn.close()

            _INITIALIZED_DBS.add(key)

    def _refresh_outdated_mistake_states(self) -> None:
        """Rebuild this learner/scope's rows when derivation semantics change."""
        with self._lock:
            conn = connect_sqlite(str(self._db_path))
            try:
                _set_wal_journal_mode(conn)
                question_ids = [
                    str(row[0])
                    for row in conn.execute(
                        """
                        SELECT question_id
                        FROM mistake_state
                        WHERE student_id = ? AND subject = ?
                          AND COALESCE(derivation_version, 0) < ?
                        ORDER BY question_id
                        """,
                        (
                            self.student_id,
                            self.subject,
                            MISTAKE_STATE_DERIVATION_VERSION,
                        ),
                    ).fetchall()
                ]
                if not question_ids:
                    return
                with conn:
                    for question_id in question_ids:
                        self._refresh_mistake_state_for_question(conn, question_id)
                logger.info(
                    "Refreshed %d outdated mistake-state row(s) for %s/%s",
                    len(question_ids),
                    self.student_id,
                    self.subject,
                )
            finally:
                conn.close()

    # ------------------------------------------------------------------
    # Storage I/O helpers (SQLite-only runtime)
    # ------------------------------------------------------------------

    def _read_log(self, topics: list[str] | tuple[str, ...] | set[str] | None = None) -> dict:
        """Read the log from the SQLite database.

        ``topics`` optionally restricts the attempt/topic-metadata rows that are
        materialised. Callers that only inspect one topic (dialogue state,
        single-topic evidence) avoid decoding the student's entire attempt
        history, which otherwise grows without bound. ``diagnostic_status`` and
        subject-level metadata are always included because they are small and
        callers rely on them being present.
        """
        db_path = self._db_path
        student_id = self.student_id
        subject = self.subject
        topic_filter = sorted({str(t) for t in topics}) if topics is not None else None

        self._ensure_db(db_path)

        data = {
            "student_id": student_id,
            "topics": {},
            "diagnostic_status": {}
        }

        conn = connect_sqlite(str(db_path))
        try:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            # 1. Retrieve attempts
            if topic_filter is not None:
                if topic_filter:
                    placeholders = ",".join("?" for _ in topic_filter)
                    cursor.execute(
                        f"""
                        SELECT topic, extra
                        FROM attempts
                        WHERE student_id = ? AND subject = ? AND topic IN ({placeholders})
                        ORDER BY id ASC
                        """,
                        (student_id, subject, *topic_filter),
                    )
                else:
                    cursor.execute("SELECT topic, extra FROM attempts WHERE 0")
            else:
                cursor.execute(
                    """
                    SELECT topic, extra
                    FROM attempts
                    WHERE student_id = ? AND subject = ?
                    ORDER BY id ASC
                    """,
                    (student_id, subject)
                )
            attempts_by_topic = {}
            for row in cursor.fetchall():
                topic = row["topic"]
                if topic not in attempts_by_topic:
                    attempts_by_topic[topic] = []

                try:
                    att = json.loads(row["extra"])
                    attempts_by_topic[topic].append(att)
                except Exception:
                    logger.warning("Failed to parse attempt extra JSON for topic=%s", topic)

            # 2. Retrieve topic_metadata
            if topic_filter is not None:
                if topic_filter:
                    placeholders = ",".join("?" for _ in topic_filter)
                    cursor.execute(
                        f"SELECT topic, accuracy, metadata FROM topic_metadata "
                        f"WHERE student_id = ? AND subject = ? AND topic IN ({placeholders})",
                        (student_id, subject, *topic_filter),
                    )
                else:
                    cursor.execute("SELECT topic, accuracy, metadata FROM topic_metadata WHERE 0")
            else:
                cursor.execute(
                    "SELECT topic, accuracy, metadata FROM topic_metadata WHERE student_id = ? AND subject = ?",
                    (student_id, subject)
                )
            for row in cursor.fetchall():
                topic = row["topic"]
                accuracy = row["accuracy"]
                try:
                    meta_dict = json.loads(row["metadata"])
                except Exception:
                    logger.warning("Failed to parse topic metadata JSON for topic=%s", topic)
                    meta_dict = {}

                data["topics"][topic] = {
                    "attempts": attempts_by_topic.get(topic, []),
                    "accuracy": accuracy,
                    **meta_dict
                }

            # Fallback for topics with attempts but no metadata
            for topic, attempts in attempts_by_topic.items():
                if topic not in data["topics"]:
                    data["topics"][topic] = {
                        "attempts": attempts,
                        "accuracy": 0.0
                    }

            # 3. Retrieve diagnostic_status
            cursor.execute(
                "SELECT year_level, status_data FROM diagnostic_status WHERE student_id = ? AND subject = ?",
                (student_id, subject)
            )
            for row in cursor.fetchall():
                year_level = row["year_level"]
                key = f"{subject}::{year_level}"
                try:
                    status_dict = json.loads(row["status_data"])
                except Exception:
                    logger.warning("Failed to parse diagnostic_status JSON for year=%s", year_level)
                    status_dict = {}
                data["diagnostic_status"][key] = status_dict

            # 4. Retrieve extra metadata
            cursor.execute(
                "SELECT metadata FROM student_subject_metadata WHERE student_id = ? AND subject = ?",
                (student_id, subject)
            )
            row = cursor.fetchone()
            if row:
                try:
                    extra_meta = json.loads(row["metadata"])
                    for k, v in extra_meta.items():
                        if k not in ("student_id", "topics", "diagnostic_status"):
                            data[k] = v
                except Exception:
                    logger.warning("Failed to parse student_subject_metadata JSON for student=%s", student_id)
        finally:
            conn.close()

        if topic_filter is not None:
            data[PARTIAL_SCOPE_KEY] = topic_filter

        return data

    def _write_log(self, data: dict) -> None:
        """Write the log to SQLite."""
        db_path = self._db_path
        student_id = self.student_id
        subject = self.subject

        self._ensure_db(db_path)

        remaining_keys = {}
        for k, v in data.items():
            if k not in ("student_id", "topics", "diagnostic_status", PARTIAL_SCOPE_KEY):
                remaining_keys[k] = v

        conn = connect_sqlite(str(db_path))
        try:
            _set_wal_journal_mode(conn)
            with conn:
                # --- Incremental attempt insertion ---
                # Only INSERT new records (uniqueness enforced by UNIQUE index)
                # instead of DELETE+reINSERT all attempts for the topic.

                topics = data.get("topics", {})
                for topic, t_data in topics.items():
                    attempts = t_data.get("attempts", [])
                    # Batch the append-only attempt rows in one statement: the
                    # UNIQUE index makes re-inserting history a no-op, so this
                    # is behaviour-identical to the previous per-row loop but
                    # avoids one Python/SQLite round trip per historical row.
                    if attempts:
                        conn.executemany(
                            """
                            INSERT OR IGNORE INTO attempts (
                                student_id, subject, topic, question_id, correct,
                                error_type, timestamp, skill_id, response_time_ms,
                                attempt_type, student_answer, misconception_id,
                                outcome, is_speed_round, review_pending,
                                review_question_id, error_book_source, extra
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            [
                                _attempt_insert_values(student_id, subject, topic, att)
                                for att in attempts
                            ],
                        )

                    meta_to_serialize = {
                        k: v for k, v in t_data.items()
                        if k not in ("attempts", "accuracy")
                    }
                    accuracy = t_data.get("accuracy", 0.0)
                    conn.execute(
                        """
                        INSERT OR REPLACE INTO topic_metadata (
                            student_id, subject, topic, accuracy, metadata
                        ) VALUES (?, ?, ?, ?, ?)
                        """,
                        (
                            student_id,
                            subject,
                            topic,
                            accuracy,
                            json.dumps(meta_to_serialize)
                        )
                    )

                diag_status = data.get("diagnostic_status", {})
                for key, val in diag_status.items():
                    try:
                        subj_part, year_part = key.split("::")
                        year_level = int(year_part)
                    except (ValueError, IndexError):
                        year_level = 0

                    conn.execute(
                        """
                        INSERT OR REPLACE INTO diagnostic_status (
                            student_id, subject, year_level, status_data
                        ) VALUES (?, ?, ?, ?)
                        """,
                        (
                            student_id,
                            subject,
                            year_level,
                            json.dumps(val)
                        )
                    )

                conn.execute(
                    """
                    INSERT OR REPLACE INTO student_subject_metadata (
                        student_id, subject, metadata
                    ) VALUES (?, ?, ?)
                    """,
                    (
                        student_id,
                        subject,
                        json.dumps(remaining_keys)
                    )
                )
        finally:
            conn.close()

    def _persist_new_attempts(
        self,
        data: dict,
        new_records: list[tuple[str, dict]],
        *,
        request_id: str | None = None,
        request_fingerprint: str | None = None,
        request_response: dict | None = None,
    ) -> None:
        """Hot-path persistence for ``log_attempt``.

        Inserts only the newly appended attempt rows and upserts the affected
        topics' metadata. This is
        behaviour-preserving versus :meth:`_write_log` because the ``attempts``
        table is append-only with ``INSERT OR IGNORE`` (re-inserting historical
        rows is a no-op), and ``topic_metadata`` is upserted per topic. Sections
        not touched by these calls (``diagnostic_status``, extra metadata) remain
        as previously persisted. Turns the write from O(total history) into
        O(new rows) on the most frequent operations.
        """
        if not new_records:
            return

        db_path = self._db_path
        self._ensure_db(db_path)
        student_id = self.student_id
        subject = self.subject
        topics = data.get("topics", {})

        conn = connect_sqlite(str(db_path))
        try:
            _set_wal_journal_mode(conn)
            with conn:
                seen_topics: set[str] = set()
                for topic, att in new_records:
                    seen_topics.add(topic)
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO attempts (
                            student_id, subject, topic, question_id, correct,
                            error_type, timestamp, skill_id, response_time_ms,
                            attempt_type, student_answer, misconception_id,
                            outcome, is_speed_round, review_pending,
                            review_question_id, error_book_source, extra
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        _attempt_insert_values(student_id, subject, topic, att),
                    )

                for topic in seen_topics:
                    t_data = topics.get(topic, {})
                    meta_to_serialize = {
                        k: v for k, v in t_data.items()
                        if k not in ("attempts", "accuracy")
                    }
                    conn.execute(
                        """
                        INSERT OR REPLACE INTO topic_metadata (
                            student_id, subject, topic, accuracy, metadata
                        ) VALUES (?, ?, ?, ?, ?)
                        """,
                        (
                            student_id,
                            subject,
                            topic,
                            t_data.get("accuracy", 0.0),
                            json.dumps(meta_to_serialize),
                        ),
                    )

                for question_id in {
                    str(attempt.get("question_id") or "")
                    for _, attempt in new_records
                    if attempt.get("attempt_type", "answer") in ("answer", "diagnostic")
                }:
                    if question_id and not question_id.startswith("pseudo_"):
                        self._refresh_mistake_state_for_question(conn, question_id)

                if request_id and request_response is not None:
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO attempt_request_results (
                            student_id, subject, request_id, fingerprint,
                            attempt_id, response_json, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            student_id,
                            subject,
                            str(request_id),
                            str(request_fingerprint or ""),
                            str(request_response.get("attempt_id") or ""),
                            json.dumps(request_response, ensure_ascii=False, default=str),
                            datetime.now(timezone.utc).isoformat(),
                        ),
                    )
        finally:
            conn.close()

    def _persist_updated_attempts(
        self,
        data: dict,
        updated_records: list[tuple[str, dict]],
        *,
        request_id: str | None = None,
        request_fingerprint: str | None = None,
        request_response: dict | None = None,
    ) -> None:
        """Persist in-place attempt snapshots, including progressive multi-part work."""
        if not updated_records:
            return

        conn = connect_sqlite(str(self._db_path))
        try:
            _set_wal_journal_mode(conn)
            with conn:
                seen_topics: set[str] = set()
                for topic, att in updated_records:
                    seen_topics.add(topic)
                    conn.execute(
                        """
                        UPDATE attempts
                        SET correct = ?, error_type = ?, skill_id = ?,
                            response_time_ms = ?, student_answer = ?,
                            misconception_id = ?, outcome = ?, is_speed_round = ?,
                            review_pending = ?, review_question_id = ?,
                            error_book_source = ?, extra = ?
                        WHERE student_id = ? AND subject = ? AND topic = ?
                          AND question_id = ? AND timestamp = ?
                        """,
                        (
                            1 if att.get("correct") else 0,
                            att.get("error_type"),
                            att.get("skill_id") or f"{topic}/{att.get('question_id')}",
                            att.get("response_time_ms", 0),
                            att.get("student_answer"),
                            att.get("misconception_id"),
                            *_attempt_index_values(att),
                            *_attempt_link_values(att),
                            json.dumps(att),
                            self.student_id,
                            self.subject,
                            topic,
                            att.get("question_id") or "",
                            att.get("timestamp") or "",
                        ),
                    )

                for topic in seen_topics:
                    topic_data = data.get("topics", {}).get(topic, {})
                    metadata = {
                        key: value
                        for key, value in topic_data.items()
                        if key not in ("attempts", "accuracy")
                    }
                    conn.execute(
                        """
                        INSERT OR REPLACE INTO topic_metadata (
                            student_id, subject, topic, accuracy, metadata
                        ) VALUES (?, ?, ?, ?, ?)
                        """,
                        (
                            self.student_id,
                            self.subject,
                            topic,
                            topic_data.get("accuracy", 0.0),
                            json.dumps(metadata),
                        ),
                    )

                for question_id in {
                    str(attempt.get("question_id") or "")
                    for _, attempt in updated_records
                    if attempt.get("attempt_type", "answer") in ("answer", "diagnostic")
                }:
                    if question_id and not question_id.startswith("pseudo_"):
                        self._refresh_mistake_state_for_question(conn, question_id)

                if request_id and request_response is not None:
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO attempt_request_results (
                            student_id, subject, request_id, fingerprint,
                            attempt_id, response_json, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            self.student_id,
                            self.subject,
                            str(request_id),
                            str(request_fingerprint or ""),
                            str(request_response.get("attempt_id") or ""),
                            json.dumps(request_response, ensure_ascii=False, default=str),
                            datetime.now(timezone.utc).isoformat(),
                        ),
                    )
        finally:
            conn.close()

    def get_attempt_request_result(self, request_id: str) -> dict | None:
        """Return a previously committed tutor-mark result for one request ID."""
        if not request_id:
            return None
        self._ensure_db(self._db_path)
        conn = connect_sqlite(str(self._db_path))
        try:
            row = conn.execute(
                """
                SELECT fingerprint, response_json
                FROM attempt_request_results
                WHERE student_id = ? AND subject = ? AND request_id = ?
                """,
                (self.student_id, self.subject, str(request_id)),
            ).fetchone()
            if not row:
                return None
            try:
                response = json.loads(row[1])
            except (TypeError, json.JSONDecodeError):
                return None
            if not isinstance(response, dict):
                return None
            return {"fingerprint": str(row[0] or ""), "response": response}
        finally:
            conn.close()

    def get_attempt_outcomes(self) -> list[tuple[str, bool]]:
        """Return compact question outcomes without materialising attempt JSON."""
        self._ensure_db(self._db_path)
        conn = connect_sqlite(str(self._db_path))
        try:
            rows = conn.execute(
                """
                SELECT question_id, correct
                FROM attempts
                WHERE student_id = ? AND subject = ? AND attempt_type = 'answer'
                  AND question_id != ''
                """,
                (self.student_id, self.subject),
            ).fetchall()
            return [(str(question_id), bool(correct)) for question_id, correct in rows]
        finally:
            conn.close()

    def get_answer_activity_records(self) -> list[dict]:
        """Return compact answer activity and provenance for daily analytics.

        Support level is deliberately nullable: legacy rows without explicit
        support metadata are unknown and must not be promoted to independent
        evidence by downstream consumers.
        """
        self._ensure_db(self._db_path)

        def read_rows() -> list[tuple]:
            conn = connect_sqlite(str(self._db_path))
            try:
                return conn.execute(
                    """
                    SELECT question_id, correct, timestamp,
                           COALESCE(json_extract(extra, '$.used_show_answer'), 0),
                           json_extract(extra, '$.support_level'),
                           outcome, is_speed_round
                    FROM attempts
                    WHERE student_id = ? AND subject = ? AND attempt_type = 'answer'
                      AND question_id != '' AND timestamp != ''
                    ORDER BY timestamp ASC
                    """,
                    (self.student_id, self.subject),
                ).fetchall()
            finally:
                conn.close()

        rows = read_rows()

        def normalise_support_level(value: object) -> int | None:
            if value is None:
                return None
            try:
                numeric = float(value)
            except (TypeError, ValueError):
                return None
            if not numeric.is_integer() or not 0 <= numeric <= 4:
                return None
            return int(numeric)

        return [
            {
                "question_id": str(question_id),
                "correct": bool(correct),
                "timestamp": str(timestamp),
                "used_show_answer": bool(used_show_answer),
                "support_level": normalise_support_level(support_level),
                "outcome": str(outcome or ""),
                "is_speed_round": bool(is_speed_round),
            }
            for (
                question_id,
                correct,
                timestamp,
                used_show_answer,
                support_level,
                outcome,
                is_speed_round,
            ) in rows
        ]

    def get_extra_metadata(self) -> dict:
        """Load subject-level metadata without reading or decoding attempts."""
        self._ensure_db(self._db_path)
        conn = connect_sqlite(str(self._db_path))
        try:
            row = conn.execute(
                """
                SELECT metadata FROM student_subject_metadata
                WHERE student_id = ? AND subject = ?
                """,
                (self.student_id, self.subject),
            ).fetchone()
            if not row:
                return {}
            parsed = json.loads(row[0])
            return parsed if isinstance(parsed, dict) else {}
        except (json.JSONDecodeError, sqlite3.Error):
            return {}
        finally:
            conn.close()

    # Backward-compat aliases used by tests and recommend_next_topic
    def load_log(self, topics: list[str] | tuple[str, ...] | set[str] | None = None) -> dict:
        """Public read accessor (no lock required for read-only callers).

        ``topics`` restricts the materialised attempt rows; see :meth:`_read_log`.
        """
        try:
            return self._read_log(topics=topics)
        except (FileNotFoundError, json.JSONDecodeError, sqlite3.Error):
            return {"student_id": self.student_id, "topics": {}}

    def get_attempts_for_question(
        self,
        question_id: str,
        attempt_types: list[str] | tuple[str, ...] | set[str] | None = None,
        limit: int | None = None,
    ) -> list[dict]:
        """Return one question's attempts in chronological order."""
        self._ensure_db(self._db_path)
        params: list[object] = [self.student_id, self.subject, str(question_id)]
        where = "student_id = ? AND subject = ? AND question_id = ?"
        if attempt_types is not None:
            types = sorted({str(value) for value in attempt_types})
            if not types:
                return []
            where += f" AND attempt_type IN ({','.join('?' for _ in types)})"
            params.extend(types)
        sql = f"SELECT extra FROM attempts WHERE {where} ORDER BY id DESC"
        if limit is not None:
            sql += " LIMIT ?"
            params.append(max(0, int(limit)))
        conn = connect_sqlite(str(self._db_path))
        try:
            rows = conn.execute(sql, params).fetchall()
        finally:
            conn.close()
        attempts: list[dict] = []
        for (raw,) in reversed(rows):
            try:
                attempt = json.loads(raw)
            except (TypeError, json.JSONDecodeError):
                continue
            if isinstance(attempt, dict):
                attempts.append(attempt)
        return attempts

    def get_topics_for_question(self, question_id: str) -> list[str]:
        """Return every persisted topic fan-out for a question."""
        self._ensure_db(self._db_path)
        conn = connect_sqlite(str(self._db_path))
        try:
            rows = conn.execute(
                """
                SELECT DISTINCT topic FROM attempts
                WHERE student_id = ? AND subject = ? AND question_id = ?
                ORDER BY topic
                """,
                (self.student_id, self.subject, str(question_id)),
            ).fetchall()
            return [str(row[0]) for row in rows]
        finally:
            conn.close()

    def get_error_book_review_attempts(self, source_question_id: str) -> list[dict]:
        """Return attempts linked to an Error Book source question."""
        self._ensure_db(self._db_path)
        conn = connect_sqlite(str(self._db_path))
        try:
            rows = conn.execute(
                """
                SELECT extra FROM attempts
                WHERE student_id = ? AND subject = ?
                  AND (
                    question_id = ?
                    OR review_question_id = ?
                    OR error_book_source = ?
                  )
                ORDER BY id ASC
                """,
                (
                    self.student_id, self.subject, source_question_id,
                    source_question_id, source_question_id,
                ),
            ).fetchall()
        finally:
            conn.close()
        attempts: list[dict] = []
        for (raw,) in rows:
            try:
                attempt = json.loads(raw)
            except (TypeError, json.JSONDecodeError):
                continue
            if isinstance(attempt, dict):
                attempts.append(attempt)
        return attempts

    def get_topic_attempts(self, topic: str) -> list[dict]:
        """Return one topic's attempts without loading subject metadata."""
        self._ensure_db(self._db_path)
        conn = connect_sqlite(str(self._db_path))
        try:
            rows = conn.execute(
                """
                SELECT extra FROM attempts
                WHERE student_id = ? AND subject = ? AND topic = ?
                ORDER BY id ASC
                """,
                (self.student_id, self.subject, str(topic)),
            ).fetchall()
        finally:
            conn.close()
        attempts: list[dict] = []
        for (raw,) in rows:
            try:
                attempt = json.loads(raw)
            except (TypeError, json.JSONDecodeError):
                continue
            if isinstance(attempt, dict):
                attempts.append(attempt)
        return attempts

    def get_attempted_question_ids(self) -> set[str]:
        """Return IDs with confirmed scored, non-speed-round learning evidence."""
        self._ensure_db(self._db_path)
        conn = connect_sqlite(str(self._db_path))
        try:
            rows = conn.execute(
                """
                SELECT DISTINCT question_id FROM attempts
                WHERE student_id = ? AND subject = ?
                  AND attempt_type IN ('answer', 'diagnostic')
                  AND outcome IN ('correct', 'incorrect')
                  AND is_speed_round = 0
                  AND question_id != ''
                """,
                (self.student_id, self.subject),
            ).fetchall()
            return {str(question_id) for (question_id,) in rows}
        finally:
            conn.close()

    def has_learning_data(self) -> bool:
        """Return whether this student/subject has any persisted attempt."""
        self._ensure_db(self._db_path)
        conn = connect_sqlite(str(self._db_path))
        try:
            return conn.execute(
                "SELECT 1 FROM attempts WHERE student_id = ? AND subject = ? LIMIT 1",
                (self.student_id, self.subject),
            ).fetchone() is not None
        finally:
            conn.close()

    def get_diagnostic_status(self, year_level: int) -> dict | None:
        """Return one diagnostic status row without materialising attempts."""
        self._ensure_db(self._db_path)
        conn = connect_sqlite(str(self._db_path))
        try:
            row = conn.execute(
                """
                SELECT status_data FROM diagnostic_status
                WHERE student_id = ? AND subject = ? AND year_level = ?
                """,
                (self.student_id, self.subject, int(year_level)),
            ).fetchone()
        finally:
            conn.close()
        if not row:
            return None
        try:
            value = json.loads(row[0])
        except (TypeError, json.JSONDecodeError):
            return None
        return value if isinstance(value, dict) else None

    def get_exam_sessions(self) -> list[dict]:
        """Return exam-session metadata without loading attempts."""
        sessions = self.get_extra_metadata().get("exam_sessions", [])
        return [session for session in sessions if isinstance(session, dict)]

    def get_diagnostic_reports(self) -> list[dict]:
        """Return diagnostic-report metadata without loading attempts."""
        reports = self.get_extra_metadata().get("diagnostic_reports", [])
        return [report for report in reports if isinstance(report, dict)]

    def save_log(self, data: dict):
        """Public write accessor (for test seeding)."""
        self._write_log(data)
        self.refresh_mistake_states(
            attempt.get("question_id")
            for topic_data in data.get("topics", {}).values()
            for attempt in topic_data.get("attempts", [])
            if attempt.get("attempt_type", "answer") in ("answer", "diagnostic")
        )

    @staticmethod
    def _derive_mistake_state(
        records: list[tuple[str, dict]],
    ) -> tuple[dict, list[str]] | None:
        """Derive the current Error Book row from one question's history.

        Topic fan-out copies are collapsed by physical attempt identity. Pending,
        unanswered, dismissed, pseudo, and speed-round rows are ignored, except
        that a multi-part part judged wrong stays as an incorrect snapshot. A
        reveal-assisted correct answer does not independently repair an older
        mistake, while a later independent correct answer exposes that older
        incorrect snapshot as fixed.
        """
        enriched: list[dict] = []
        topics_by_attempt: dict[str, set[str]] = {}
        for topic_id, raw_attempt in records:
            question_id = str(raw_attempt.get("question_id") or "")
            if not question_id or question_id.startswith("pseudo_"):
                continue
            # Diagnostic placement misses (often "not learned yet") are not
            # mistakes. Their correct answers may still repair a practice miss.
            if (
                raw_attempt.get("error_book_eligible") is False
                and classify_attempt(raw_attempt) is AttemptOutcome.INCORRECT
            ):
                continue
            attempt = dict(raw_attempt)
            attempt["__mistake_topic_id"] = str(topic_id)
            key = physical_attempt_key(attempt)
            topics_by_attempt.setdefault(key, set()).add(str(topic_id))
            enriched.append(attempt)

        scored: list[dict] = []
        for attempt in deduplicate_attempts(enriched):
            snapshot = part_error_snapshot(attempt)
            if snapshot is not None:
                # Multi-part work updates one attempt in place. Its wrong parts
                # stay as an incorrect snapshot, and a later fix is dated by
                # the update that made the whole attempt correct.
                scored.append(snapshot)
                if classify_attempt(attempt) is AttemptOutcome.CORRECT:
                    attempt["timestamp"] = max(
                        str(attempt.get("timestamp") or ""),
                        str(attempt.get("updated_at") or ""),
                    )
            if is_scored_learning_attempt(attempt):
                scored.append(attempt)
        scored.sort(
            key=lambda attempt: (
                str(attempt.get("timestamp") or ""),
                str(attempt.get("updated_at") or ""),
            )
        )
        if not scored:
            return None

        selected: dict | None = None
        fixed_at: str | None = None
        for index in range(len(scored) - 1, -1, -1):
            attempt = scored[index]
            outcome = classify_attempt(attempt)
            if outcome is AttemptOutcome.CORRECT:
                if not (is_independent_learning_attempt(attempt) and counts_as_right(attempt)):
                    continue
                selected = next(
                    (
                        older
                        for older in reversed(scored[:index])
                        if classify_attempt(older) is AttemptOutcome.INCORRECT
                    ),
                    None,
                )
                if selected is not None:
                    fixed_at = str(attempt.get("timestamp") or "")
                break
            if outcome is AttemptOutcome.INCORRECT:
                selected = attempt
                break

        if selected is None:
            return None

        selected_key = physical_attempt_key(selected)
        topic_ids = sorted(topics_by_attempt.get(selected_key) or [])
        primary_topic = str(selected.pop("__mistake_topic_id", ""))
        # Keep reusable learner language available when a later failed retry
        # becomes the retained incorrect snapshot. This enriches only the
        # materialized view; the original physical attempts remain unchanged.
        for metadata_key in ("if_then_strategy", "self_explanation"):
            if selected.get(metadata_key):
                continue
            inherited = next(
                (
                    attempt.get(metadata_key)
                    for attempt in reversed(scored)
                    if attempt.get(metadata_key)
                ),
                None,
            )
            if inherited:
                selected[metadata_key] = inherited
        if primary_topic:
            topic_ids = [primary_topic, *[topic for topic in topic_ids if topic != primary_topic]]
        selected.pop("__mistake_topic_id", None)
        error_cause = selected.get("error_cause") or selected.get("reflection_type")
        cause_recorded_at = str(selected.get("cause_recorded_at") or "")
        # A correction made before the learner identified the cause cannot skip
        # the understanding/retry stages. Legacy reflections without a timestamp
        # remain compatible; new cause records always carry cause_recorded_at.
        if fixed_at and (
            not error_cause
            or (cause_recorded_at and fixed_at <= cause_recorded_at)
        ):
            fixed_at = None
        closure_stage = (
            "needs_transfer"
            if fixed_at
            else "needs_retry"
            if error_cause
            else "needs_understanding"
        )
        return (
            {
                "topic_id": primary_topic or (topic_ids[0] if topic_ids else ""),
                "error_type": selected.get("error_type"),
                "last_incorrect_at": str(selected.get("timestamp") or ""),
                "last_correct_after_error_at": fixed_at,
                "fixed_by_later_correct": bool(fixed_at),
                "attempt_count": len(scored),
                "attempt_data": selected,
                "closure_stage": closure_stage,
                "error_cause": error_cause,
                "cause_recorded_at": selected.get("cause_recorded_at"),
                "retry_correct_at": fixed_at,
            },
            topic_ids,
        )

    def _rebuild_versioned_closure_state(
        self,
        conn: sqlite3.Connection,
        question_id: str,
        state: dict,
        existing: dict,
    ) -> dict:
        """Reconcile persisted closure fields against current raw evidence."""
        rebuilt = {
            "closure_stage": state["closure_stage"],
            "resolved": False,
            "resolved_at": None,
            "resolution_source": None,
            "transfer_correct_at": None,
            "consolidation_due_at": None,
            "closed_at": None,
        }
        if (
            existing.get("resolution_source") == "manual_dismissal"
            or existing.get("closure_stage") == "dismissed"
        ):
            rebuilt.update({
                "closure_stage": "dismissed",
                "resolved": True,
                "resolved_at": existing.get("resolved_at"),
                "resolution_source": "manual_dismissal",
            })
            return rebuilt

        if (
            state["closure_stage"] != "needs_transfer"
            or existing.get("closure_stage") not in {"needs_consolidation", "closed"}
        ):
            return rebuilt

        def parse_timestamp(value: object) -> datetime | None:
            if not value:
                return None
            try:
                parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            except (TypeError, ValueError):
                return None
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)

        attempts: list[dict] = []
        for (raw_extra,) in conn.execute(
            "SELECT extra FROM attempts WHERE student_id = ? AND subject = ?",
            (self.student_id, self.subject),
        ).fetchall():
            try:
                attempt = json.loads(raw_extra)
            except (TypeError, json.JSONDecodeError):
                continue
            if isinstance(attempt, dict):
                attempts.append(attempt)
        eligible_times = sorted(
            timestamp
            for timestamp in (
                parse_timestamp(attempt.get("timestamp"))
                for attempt in deduplicate_attempts(attempts)
                if is_error_book_closure_evidence(attempt, question_id)
            )
            if timestamp is not None
        )
        retry_time = parse_timestamp(state.get("retry_correct_at"))
        transfer_time = parse_timestamp(existing.get("transfer_correct_at"))
        if (
            retry_time is None
            or transfer_time is None
            or transfer_time <= retry_time
            or transfer_time not in eligible_times
        ):
            return rebuilt

        due_time = transfer_time + timedelta(days=3)
        rebuilt.update({
            "closure_stage": "needs_consolidation",
            "resolution_source": "demonstrated_correction",
            "transfer_correct_at": transfer_time.isoformat(),
            "consolidation_due_at": due_time.isoformat(),
        })
        if existing.get("closure_stage") != "closed":
            return rebuilt

        closed_time = parse_timestamp(existing.get("closed_at"))
        if (
            closed_time is None
            or closed_time <= transfer_time
            or closed_time < due_time
            or closed_time not in eligible_times
        ):
            return rebuilt
        rebuilt.update({
            "closure_stage": "closed",
            "resolved": True,
            "resolved_at": existing.get("resolved_at") or closed_time.isoformat(),
            "closed_at": closed_time.isoformat(),
        })
        return rebuilt

    def _refresh_mistake_state_for_question(
        self, conn: sqlite3.Connection, question_id: str
    ) -> None:
        """Recompute one materialized mistake row inside the caller transaction."""
        rows = conn.execute(
            """
            SELECT topic, extra
            FROM attempts
            WHERE student_id = ? AND subject = ? AND question_id = ?
            ORDER BY id ASC
            """,
            (self.student_id, self.subject, question_id),
        ).fetchall()
        records: list[tuple[str, dict]] = []
        for topic_id, raw_extra in rows:
            try:
                attempt = json.loads(raw_extra)
            except (TypeError, json.JSONDecodeError):
                continue
            if isinstance(attempt, dict):
                records.append((str(topic_id), attempt))

        derived = self._derive_mistake_state(records)
        if derived is None:
            legacy_row = conn.execute(
                """
                SELECT topic_id, resolution_source, resolved, resolved_at,
                       review_count, error_cause, cause_recorded_at, attempt_data,
                       derivation_version
                FROM mistake_state
                WHERE student_id = ? AND subject = ? AND question_id = ?
                """,
                (self.student_id, self.subject, question_id),
            ).fetchone()
            if legacy_row and not records and int(legacy_row[8] or 0) < MISTAKE_STATE_DERIVATION_VERSION:
                (
                    legacy_topic,
                    legacy_source,
                    legacy_resolved,
                    legacy_resolved_at,
                    legacy_review_count,
                    legacy_error_cause,
                    legacy_cause_recorded_at,
                    legacy_attempt_data,
                    _legacy_version,
                ) = legacy_row
                try:
                    legacy_attempt = json.loads(legacy_attempt_data)
                except (TypeError, json.JSONDecodeError):
                    legacy_attempt = {}
                if not isinstance(legacy_attempt, dict):
                    legacy_attempt = {}
                error_cause = (
                    legacy_error_cause
                    or legacy_attempt.get("error_cause")
                    or legacy_attempt.get("reflection_type")
                )
                manual_dismissal = legacy_source == "manual_dismissal"
                conn.execute(
                    """
                    UPDATE mistake_state
                    SET last_correct_after_error_at = NULL,
                        fixed_by_later_correct = 0,
                        resolved = ?, resolved_at = ?,
                        resolution_source = ?, closure_stage = ?,
                        error_cause = ?, cause_recorded_at = ?,
                        retry_correct_at = NULL, transfer_correct_at = NULL,
                        consolidation_due_at = NULL, closed_at = NULL,
                        derivation_version = ?, updated_at = ?
                    WHERE student_id = ? AND subject = ? AND question_id = ?
                    """,
                    (
                        1 if manual_dismissal and legacy_resolved else 0,
                        legacy_resolved_at if manual_dismissal else None,
                        "manual_dismissal" if manual_dismissal else None,
                        (
                            "dismissed"
                            if manual_dismissal
                            else "needs_retry"
                            if error_cause
                            else "needs_understanding"
                        ),
                        error_cause,
                        legacy_cause_recorded_at,
                        MISTAKE_STATE_DERIVATION_VERSION,
                        datetime.now(timezone.utc).isoformat(),
                        self.student_id,
                        self.subject,
                        question_id,
                    ),
                )
                if legacy_topic:
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO mistake_state_topics
                            (student_id, subject, question_id, topic_id)
                        VALUES (?, ?, ?, ?)
                        """,
                        (
                            self.student_id,
                            self.subject,
                            question_id,
                            str(legacy_topic),
                        ),
                    )
                return
            conn.execute(
                "DELETE FROM mistake_state_topics WHERE student_id = ? AND subject = ? AND question_id = ?",
                (self.student_id, self.subject, question_id),
            )
            conn.execute(
                "DELETE FROM mistake_state WHERE student_id = ? AND subject = ? AND question_id = ?",
                (self.student_id, self.subject, question_id),
            )
            return

        state, topic_ids = derived
        existing_row = conn.execute(
            """
            SELECT last_incorrect_at, resolved, resolved_at, review_count,
                   resolution_source, closure_stage, error_cause,
                   cause_recorded_at, retry_correct_at, transfer_correct_at,
                   consolidation_due_at, closed_at, derivation_version
            FROM mistake_state
            WHERE student_id = ? AND subject = ? AND question_id = ?
            """,
            (self.student_id, self.subject, question_id),
        ).fetchone()
        existing = None
        if existing_row:
            keys = (
                "last_incorrect_at", "resolved", "resolved_at", "review_count",
                "resolution_source", "closure_stage", "error_cause",
                "cause_recorded_at", "retry_correct_at", "transfer_correct_at",
                "consolidation_due_at", "closed_at", "derivation_version",
            )
            existing = dict(zip(keys, existing_row))

        new_error = bool(
            existing
            and state["last_incorrect_at"]
            and state["last_incorrect_at"] > str(existing.get("last_incorrect_at") or "")
        )
        outdated_derivation = bool(
            existing
            and int(existing.get("derivation_version") or 0)
            < MISTAKE_STATE_DERIVATION_VERSION
        )
        if existing and not new_error:
            review_count = int(existing.get("review_count") or 0)
            error_cause = state["error_cause"] or existing.get("error_cause")
            cause_recorded_at = state["cause_recorded_at"] or existing.get("cause_recorded_at")
            if outdated_derivation:
                rebuilt = self._rebuild_versioned_closure_state(
                    conn,
                    question_id,
                    state,
                    existing,
                )
                closure_stage = rebuilt["closure_stage"]
                resolved = rebuilt["resolved"]
                resolved_at = rebuilt["resolved_at"]
                resolution_source = rebuilt["resolution_source"]
                retry_correct_at = state["retry_correct_at"]
                transfer_correct_at = rebuilt["transfer_correct_at"]
                consolidation_due_at = rebuilt["consolidation_due_at"]
                closed_at = rebuilt["closed_at"]
            else:
                closure_stage = str(existing.get("closure_stage") or state["closure_stage"])
                if closure_stage in {"needs_understanding", "needs_retry", "needs_transfer"}:
                    # Re-derive early stages so a correction recorded before the
                    # cause cannot leave a stale needs_transfer state behind.
                    closure_stage = state["closure_stage"]
                resolved = bool(existing.get("resolved"))
                resolved_at = existing.get("resolved_at")
                resolution_source = existing.get("resolution_source")
                retry_correct_at = state["retry_correct_at"] or existing.get("retry_correct_at")
                transfer_correct_at = existing.get("transfer_correct_at")
                consolidation_due_at = existing.get("consolidation_due_at")
                closed_at = existing.get("closed_at")
        else:
            closure_stage = state["closure_stage"]
            resolved = False
            resolved_at = None
            review_count = int((existing or {}).get("review_count") or 0)
            resolution_source = None
            error_cause = state["error_cause"]
            cause_recorded_at = state["cause_recorded_at"]
            retry_correct_at = state["retry_correct_at"]
            transfer_correct_at = None
            consolidation_due_at = None
            closed_at = None

        conn.execute(
            """
            INSERT INTO mistake_state (
                student_id, subject, question_id, topic_id, error_type,
                last_incorrect_at, last_correct_after_error_at,
                fixed_by_later_correct, attempt_count, attempt_data,
                resolved, resolved_at, review_count, resolution_source,
                closure_stage, error_cause, cause_recorded_at, retry_correct_at,
                transfer_correct_at, consolidation_due_at, closed_at,
                derivation_version, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(student_id, subject, question_id) DO UPDATE SET
                topic_id = excluded.topic_id,
                error_type = excluded.error_type,
                last_incorrect_at = excluded.last_incorrect_at,
                last_correct_after_error_at = excluded.last_correct_after_error_at,
                fixed_by_later_correct = excluded.fixed_by_later_correct,
                attempt_count = excluded.attempt_count,
                attempt_data = excluded.attempt_data,
                resolved = excluded.resolved,
                resolved_at = excluded.resolved_at,
                review_count = excluded.review_count,
                resolution_source = excluded.resolution_source,
                closure_stage = excluded.closure_stage,
                error_cause = excluded.error_cause,
                cause_recorded_at = excluded.cause_recorded_at,
                retry_correct_at = excluded.retry_correct_at,
                transfer_correct_at = excluded.transfer_correct_at,
                consolidation_due_at = excluded.consolidation_due_at,
                closed_at = excluded.closed_at,
                derivation_version = excluded.derivation_version,
                updated_at = excluded.updated_at
            """,
            (
                self.student_id,
                self.subject,
                question_id,
                state["topic_id"],
                state["error_type"],
                state["last_incorrect_at"],
                state["last_correct_after_error_at"],
                1 if state["fixed_by_later_correct"] else 0,
                state["attempt_count"],
                json.dumps(state["attempt_data"]),
                1 if resolved else 0,
                resolved_at,
                review_count,
                resolution_source,
                closure_stage,
                error_cause,
                cause_recorded_at,
                retry_correct_at,
                transfer_correct_at,
                consolidation_due_at,
                closed_at,
                MISTAKE_STATE_DERIVATION_VERSION,
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        conn.execute(
            "DELETE FROM mistake_state_topics WHERE student_id = ? AND subject = ? AND question_id = ?",
            (self.student_id, self.subject, question_id),
        )
        conn.executemany(
            """
            INSERT INTO mistake_state_topics (student_id, subject, question_id, topic_id)
            VALUES (?, ?, ?, ?)
            """,
            [
                (self.student_id, self.subject, question_id, topic_id)
                for topic_id in topic_ids
            ],
        )

    def refresh_mistake_states(self, question_ids) -> None:
        """Refresh selected question states without scanning unrelated history."""
        unique_ids = sorted(
            {
                str(question_id)
                for question_id in question_ids
                if str(question_id) and not str(question_id).startswith("pseudo_")
            }
        )
        if not unique_ids:
            return
        self._ensure_db(self._db_path)
        conn = connect_sqlite(str(self._db_path))
        try:
            _set_wal_journal_mode(conn)
            with conn:
                for question_id in unique_ids:
                    self._refresh_mistake_state_for_question(conn, question_id)
        finally:
            conn.close()

    def query_mistake_states(
        self,
        *,
        valid_topic_ids: list[str] | tuple[str, ...] | set[str] | None = None,
        topic_id: str | None = None,
        error_type: str | None = None,
        status: str | None = None,
        limit: int | None = None,
        offset: int = 0,
    ) -> dict:
        """Return a materialized Error Book page plus scope-wide aggregates.

        ``status`` filters page rows only. Summary counts deliberately cover both
        active and resolved rows in the selected curriculum/topic/error scope so
        the frontend can render stable tabs and statistics without loading every
        mistake object.
        """
        empty_summary = {
            "total": 0,
            "active": 0,
            "resolved": 0,
            "closed": 0,
            "dismissed": 0,
            "reviews": 0,
            "topic_counts": {},
            "error_type_counts": {},
            "topic_progress": {},
        }
        allowed_topics = (
            sorted({str(value) for value in valid_topic_ids})
            if valid_topic_ids is not None
            else None
        )
        if topic_id and allowed_topics is not None and topic_id not in allowed_topics:
            return {"rows": [], "total": 0, "summary": empty_summary}
        if allowed_topics == []:
            return {"rows": [], "total": 0, "summary": empty_summary}
        if status not in (None, "active", "resolved"):
            raise ValueError(f"Unsupported mistake status filter: {status!r}")

        base_conditions = ["ms.student_id = ?", "ms.subject = ?"]
        base_params: list[object] = [self.student_id, self.subject]
        if topic_id:
            base_conditions.append(
                "EXISTS (SELECT 1 FROM mistake_state_topics mst "
                "WHERE mst.student_id = ms.student_id AND mst.subject = ms.subject "
                "AND mst.question_id = ms.question_id AND mst.topic_id = ?)"
            )
            base_params.append(topic_id)
        elif allowed_topics is not None:
            placeholders = ",".join("?" for _ in allowed_topics)
            base_conditions.append(
                "EXISTS (SELECT 1 FROM mistake_state_topics mst "
                "WHERE mst.student_id = ms.student_id AND mst.subject = ms.subject "
                "AND mst.question_id = ms.question_id "
                f"AND mst.topic_id IN ({placeholders}))"
            )
            base_params.extend(allowed_topics)
        if error_type:
            base_conditions.append("ms.error_type = ?")
            base_params.append(error_type)

        base_where = " AND ".join(base_conditions)
        closed_sql = (
            "(ms.closure_stage = 'closed' OR "
            "(ms.resolved = 1 AND ms.resolution_source = 'demonstrated_correction'))"
        )
        dismissed_sql = (
            "(ms.closure_stage = 'dismissed' OR "
            "(ms.resolved = 1 AND ms.resolution_source = 'manual_dismissal'))"
        )
        resolved_sql = (
            f"({closed_sql} OR {dismissed_sql} OR "
            "(ms.resolved = 1 AND COALESCE(ms.resolution_source, '') = ''))"
        )
        page_conditions = list(base_conditions)
        page_params = list(base_params)
        if status == "active":
            page_conditions.append(f"NOT {resolved_sql}")
        elif status == "resolved":
            page_conditions.append(resolved_sql)
        page_where = " AND ".join(page_conditions)

        self._ensure_db(self._db_path)
        conn = connect_sqlite(str(self._db_path))
        conn.row_factory = sqlite3.Row
        try:
            aggregate = conn.execute(
                f"""
                SELECT COUNT(*) AS total,
                       COALESCE(SUM(CASE WHEN {resolved_sql} THEN 0 ELSE 1 END), 0) AS active,
                       COALESCE(SUM(CASE WHEN {resolved_sql} THEN 1 ELSE 0 END), 0) AS resolved,
                       COALESCE(SUM(CASE WHEN {closed_sql} THEN 1 ELSE 0 END), 0) AS closed,
                       COALESCE(SUM(CASE WHEN {dismissed_sql} THEN 1 ELSE 0 END), 0) AS dismissed,
                       COALESCE(SUM(ms.review_count), 0) AS reviews
                FROM mistake_state ms
                WHERE {base_where}
                """,
                base_params,
            ).fetchone()
            if topic_id:
                topic_rows = [(
                    topic_id,
                    int(aggregate["total"]),
                    int(aggregate["closed"]),
                    int(aggregate["reviews"]),
                )]
            else:
                topic_rows = conn.execute(
                    f"""
                    SELECT ms.topic_id, COUNT(*) AS total,
                           COALESCE(SUM(CASE WHEN {closed_sql} THEN 1 ELSE 0 END), 0) AS overcome,
                           COALESCE(SUM(ms.review_count), 0) AS reviews
                    FROM mistake_state ms
                    WHERE {base_where}
                    GROUP BY ms.topic_id
                    """,
                    base_params,
                ).fetchall()
            error_rows = conn.execute(
                f"""
                SELECT COALESCE(ms.error_type, 'unknown') AS error_type,
                       COUNT(*) AS total
                FROM mistake_state ms
                WHERE {base_where}
                GROUP BY COALESCE(ms.error_type, 'unknown')
                """,
                base_params,
            ).fetchall()

            total = int(
                conn.execute(
                    f"SELECT COUNT(*) FROM mistake_state ms WHERE {page_where}",
                    page_params,
                ).fetchone()[0]
            )
            sql = (
                "SELECT ms.* FROM mistake_state ms "
                f"WHERE {page_where} "
                "ORDER BY ms.last_incorrect_at DESC, ms.question_id ASC"
            )
            query_params = list(page_params)
            if limit is not None:
                sql += " LIMIT ? OFFSET ?"
                query_params.extend([max(0, int(limit)), max(0, int(offset))])
            elif offset:
                sql += " LIMIT -1 OFFSET ?"
                query_params.append(max(0, int(offset)))
            raw_rows = conn.execute(sql, query_params).fetchall()
        finally:
            conn.close()

        parsed_rows: list[dict] = []
        for raw_row in raw_rows:
            row = dict(raw_row)
            try:
                row["attempt"] = json.loads(row.pop("attempt_data"))
            except (TypeError, json.JSONDecodeError):
                continue
            row["fixed_by_later_correct"] = bool(row["fixed_by_later_correct"])
            row["resolved"] = bool(row["resolved"])
            parsed_rows.append(row)

        topic_progress = {
            str(row[0]): {
                "total": int(row[1]),
                "overcome": int(row[2]),
                "reviews": int(row[3]),
            }
            for row in topic_rows
        }
        summary = {
            "total": int(aggregate["total"]),
            "active": int(aggregate["active"]),
            "resolved": int(aggregate["resolved"]),
            "closed": int(aggregate["closed"]),
            "dismissed": int(aggregate["dismissed"]),
            "reviews": int(aggregate["reviews"]),
            "topic_counts": {
                topic: values["total"] for topic, values in topic_progress.items()
            },
            "error_type_counts": {
                str(row["error_type"]): int(row["total"])
                for row in error_rows
            },
            "topic_progress": topic_progress,
        }
        return {"rows": parsed_rows, "total": total, "summary": summary}

    def update_mistake_review_state(
        self,
        question_id: str,
        *,
        resolved: bool,
        resolved_at: str | None,
        review_count: int,
        resolution_source: str | None,
    ) -> None:
        """Update manual review columns without rebuilding attempt-derived state."""
        self._ensure_db(self._db_path)
        conn = connect_sqlite(str(self._db_path))
        try:
            _set_wal_journal_mode(conn)
            with conn:
                conn.execute(
                    """
                    UPDATE mistake_state
                    SET resolved = ?, resolved_at = ?, review_count = ?,
                        resolution_source = ?, updated_at = ?
                    WHERE student_id = ? AND subject = ? AND question_id = ?
                    """,
                    (
                        1 if resolved else 0,
                        resolved_at,
                        int(review_count),
                        resolution_source if resolved else None,
                        datetime.now(timezone.utc).isoformat(),
                        self.student_id,
                        self.subject,
                        question_id,
                    ),
                )
        finally:
            conn.close()

    def get_mistake_state(self, question_id: str) -> dict | None:
        """Return one materialized Error Book state without loading history."""
        self._ensure_db(self._db_path)
        conn = connect_sqlite(str(self._db_path))
        conn.row_factory = sqlite3.Row
        try:
            row = conn.execute(
                """
                SELECT * FROM mistake_state
                WHERE student_id = ? AND subject = ? AND question_id = ?
                """,
                (self.student_id, self.subject, str(question_id)),
            ).fetchone()
        finally:
            conn.close()
        if row is None:
            return None
        result = dict(row)
        try:
            result["attempt"] = json.loads(result.pop("attempt_data"))
        except (TypeError, json.JSONDecodeError):
            result["attempt"] = {}
        result["resolved"] = bool(result.get("resolved"))
        result["fixed_by_later_correct"] = bool(result.get("fixed_by_later_correct"))
        return result

    def set_mistake_closure_state(
        self,
        question_id: str,
        *,
        closure_stage: str,
        resolved: bool,
        resolved_at: str | None,
        review_count: int,
        resolution_source: str | None,
        transfer_correct_at: str | None = None,
        consolidation_due_at: str | None = None,
        closed_at: str | None = None,
    ) -> None:
        """Persist a verified closure transition without rebuilding attempt evidence."""
        self._ensure_db(self._db_path)
        conn = connect_sqlite(str(self._db_path))
        try:
            _set_wal_journal_mode(conn)
            with conn:
                conn.execute(
                    """
                    UPDATE mistake_state
                    SET closure_stage = ?, resolved = ?, resolved_at = ?,
                        review_count = ?, resolution_source = ?,
                        transfer_correct_at = COALESCE(?, transfer_correct_at),
                        consolidation_due_at = COALESCE(?, consolidation_due_at),
                        closed_at = ?, derivation_version = ?, updated_at = ?
                    WHERE student_id = ? AND subject = ? AND question_id = ?
                    """,
                    (
                        closure_stage,
                        1 if resolved else 0,
                        resolved_at,
                        int(review_count),
                        resolution_source,
                        transfer_correct_at,
                        consolidation_due_at,
                        closed_at,
                        MISTAKE_STATE_DERIVATION_VERSION,
                        datetime.now(timezone.utc).isoformat(),
                        self.student_id,
                        self.subject,
                        str(question_id),
                    ),
                )
        finally:
            conn.close()

    def get_today_plan_attempt_stats(self, start_at: str, end_at: str) -> dict[str, dict]:
        """Return unique-question evidence per Today task.

        Only answers that carry a validated ``today_task_id`` count. Repeated
        submissions of the same question count once across the whole plan, with
        the earliest task owning that evidence. ``supported_correct`` accepts a
        correct answer that was not revealed (support 0–3), while
        ``independent_correct`` requires an explicit support level of 0 on the
        first response. A right answer that the student marked "guess" counts
        for neither. ``topics`` lists every topic row of the question, so a
        task that rotates topics can track each one.
        """
        self._ensure_db(self._db_path)
        conn = connect_sqlite(str(self._db_path))
        try:
            rows = conn.execute(
                """
                SELECT json_extract(extra, '$.today_task_id') AS task_id,
                       question_id, topic, outcome, timestamp,
                       json_extract(extra, '$.support_level') AS support_level,
                       COALESCE(json_extract(extra, '$.used_show_answer'), 0) AS used_show_answer,
                       COALESCE(json_extract(extra, '$.first_attempt'), 1) AS first_attempt,
                       json_extract(extra, '$.guided_phase') AS guided_phase,
                       json_extract(extra, '$.confidence') AS confidence
                FROM attempts
                WHERE student_id = ? AND subject = ?
                  AND timestamp >= ? AND timestamp < ?
                  AND COALESCE(json_extract(extra, '$.today_task_id'), '') != ''
                  AND attempt_type = 'answer'
                  AND outcome IN ('correct', 'incorrect')
                  AND is_speed_round = 0
                ORDER BY timestamp ASC, id ASC
                """,
                (self.student_id, self.subject, start_at, end_at),
            ).fetchall()
        finally:
            conn.close()

        evidence: dict[str, dict[str, dict]] = {}
        owner_by_question: dict[str, str] = {}
        for (
            task_id,
            question_id,
            topic,
            outcome,
            timestamp,
            support_level,
            used_show_answer,
            first_attempt,
            guided_phase,
            confidence,
        ) in rows:
            if not task_id or not question_id:
                continue
            task_key = str(task_id)
            question_key = str(question_id)
            # One physical question can be surfaced by more than one Today task.
            # Its earliest task owns completion/first-try credit for the whole
            # plan; later answers may improve that owner's supported evidence but
            # must not increment another task's volume.
            owner_task_id = owner_by_question.setdefault(question_key, task_key)
            support = (
                max(0, min(4, int(support_level)))
                if support_level is not None
                else None
            )
            revealed = bool(used_show_answer) or support == 4
            right = str(outcome) == "correct" and confidence != "guess"
            task_questions = evidence.setdefault(owner_task_id, {})
            question = task_questions.setdefault(
                question_key,
                {
                    "first_right": right,
                    "first_support_level": support,
                    "first_used_show_answer": revealed,
                    "first_attempt": bool(first_attempt),
                    "first_guided": guided_phase == "guided",
                    "topics": [],
                    "supported_correct": False,
                },
            )
            if topic and str(topic) not in question["topics"]:
                question["topics"].append(str(topic))
            if right and not revealed:
                question["supported_correct"] = True

        stats: dict[str, dict] = {}
        for task_id, questions in evidence.items():
            stats[task_id] = {
                "attempted": len(questions),
                "attempted_question_ids": sorted(questions),
                # Rows arrive in timestamp order, so dict order is the order
                # of each question's first answer. Quality gates read this
                # order, so extra answers cannot replace an earlier miss.
                "ordered_evidence": [
                    {
                        "question_id": question_id,
                        "topics": question["topics"],
                        "supported_correct": bool(question["supported_correct"]),
                        "independent_correct": (
                            question["first_right"]
                            and question["first_support_level"] == 0
                            and not question["first_used_show_answer"]
                            and question["first_attempt"]
                        ),
                        # The practice page sends "guided" for a new topic with help open.
                        "guided": question["first_guided"],
                    }
                    for question_id, question in questions.items()
                ],
            }
        return stats

    def save_reflection(self, topic_ids: list[str], question_id: str, reflection_type: str) -> bool:
        """Saves a metacognitive reflection tag for the last attempt of a question."""
        with self._lock:
            data = self._read_log(topics=topic_ids)
            updated = False
            latest_timestamp = None
            target_topic = None

            for t_id in topic_ids:
                if t_id in data.get("topics", {}):

                    attempts = data["topics"][t_id].get("attempts", [])
                    for att in reversed(attempts):
                        if att.get("question_id") == question_id:
                            att["reflection_type"] = reflection_type
                            ts = att.get("timestamp", "")
                            if not latest_timestamp or ts > latest_timestamp:
                                latest_timestamp = ts
                                target_topic = t_id
                            updated = True
                            break

            if updated:
                self._write_log(data)

                # Explicitly update SQLite row as _write_log does INSERT OR IGNORE
                if latest_timestamp and target_topic:
                    conn = connect_sqlite(str(self._db_path))
                    try:
                        _set_wal_journal_mode(conn)
                        with conn:
                            # Retrieve the updated attempt from data
                            target_att = None
                            for att in data["topics"][target_topic].get("attempts", []):
                                if att.get("question_id") == question_id and att.get("timestamp") == latest_timestamp:
                                    target_att = att
                                    break
                            if target_att:
                                conn.execute(
                                    """
                                    UPDATE attempts
                                    SET extra = ?
                                    WHERE student_id = ? AND subject = ? AND topic = ? AND question_id = ? AND timestamp = ?
                                    """,
                                    (
                                        json.dumps(target_att),
                                        self.student_id,
                                        self.subject,
                                        target_topic,
                                        question_id,
                                        latest_timestamp
                                    )
                                )
                    except sqlite3.Error as e:
                        logger.error("Failed to update reflection in SQLite: %s", e)
                    finally:
                        conn.close()
                self.refresh_mistake_states([question_id])
                try:
                    from backend.api import invalidate_mistakes_cache
                    invalidate_mistakes_cache(self.student_id)
                except ImportError:
                    pass
                return True
            return False

    def update_latest_attempt_metadata(
        self,
        question_id: str,
        updates: dict,
        *,
        attempt_id: str | None = None,
        topics: list[str] | tuple[str, ...] | set[str] | None = None,
    ) -> bool:
        """Merge metadata into every topic copy of the latest physical answer.

        ``attempt_id`` avoids ambiguity after a post-answer prompt. The timestamp
        fallback keeps the helper compatible with older clients and attempt rows.
        Support can only increase when metadata is merged.
        """
        with self._lock:
            data = self._read_log(topics=topics)
            candidates = [
                att
                for topic_data in data.get("topics", {}).values()
                for att in topic_data.get("attempts", [])
                if att.get("question_id") == question_id
                and att.get("attempt_type") == "answer"
                and (not attempt_id or att.get("attempt_id") == attempt_id)
            ]
            if not candidates:
                return False
            target = max(candidates, key=lambda att: str(att.get("timestamp") or ""))
            target_attempt_id = target.get("attempt_id")
            target_timestamp = target.get("timestamp")
            updated_records: list[tuple[str, dict]] = []
            for topic_id, topic_data in data.get("topics", {}).items():
                for att in topic_data.get("attempts", []):
                    same_physical = (
                        target_attempt_id and att.get("attempt_id") == target_attempt_id
                    ) or (
                        not target_attempt_id
                        and att.get("question_id") == question_id
                        and att.get("timestamp") == target_timestamp
                    )
                    if not same_physical:
                        continue
                    merged = dict(updates)
                    if "support_level" in merged:
                        existing_support = int(att.get("support_level") or (4 if att.get("used_show_answer") else 0))
                        merged["support_level"] = max(
                            existing_support,
                            max(0, min(4, int(merged["support_level"] or 0))),
                        )
                    att.update(merged)
                    updated_records.append((topic_id, att))
            if not updated_records:
                return False
            self._write_log(data)
            self._persist_updated_attempts(data, updated_records)
            self.refresh_mistake_states([question_id])
            try:
                from backend.api import invalidate_mistakes_cache
                invalidate_mistakes_cache(self.student_id)
            except ImportError:
                pass
            return True

    def update_latest_incorrect_attempt_metadata(
        self,
        question_id: str,
        updates: dict,
        *,
        topics: list[str] | tuple[str, ...] | set[str] | None = None,
    ) -> bool:
        """Merge metadata into the latest incorrect answer attempt for a question.

        A multi-part attempt with a part judged wrong also counts (see
        ``confirmed_error_view``), so its Error Book cause can be recorded.
        Updates both the JSON log and the SQLite ``attempts.extra`` snapshot.
        ``topics`` keeps interactive dialogue updates independent of lifetime
        history size while remaining optional for backward-compatible callers.
        """
        with self._lock:
            data = self._read_log(topics=topics)
            latest_timestamp = None

            for topic_data in data.get("topics", {}).values():
                for att in topic_data.get("attempts", []):
                    if (
                        att.get("question_id") == question_id
                        and att.get("attempt_type") == "answer"
                        and confirmed_error_view(att) is not None
                    ):
                        ts = att.get("timestamp", "")
                        if not latest_timestamp or ts > latest_timestamp:
                            latest_timestamp = ts

            if not latest_timestamp:
                return False

            updated_attempts: list[tuple[str, dict]] = []
            for topic_id, topic_data in data.get("topics", {}).items():
                for att in topic_data.get("attempts", []):
                    if (
                        att.get("question_id") == question_id
                        and att.get("attempt_type") == "answer"
                        and confirmed_error_view(att) is not None
                        and att.get("timestamp") == latest_timestamp
                    ):
                        att.update(updates)
                        updated_attempts.append((topic_id, att))

            if not updated_attempts:
                return False

            self._write_log(data)

            conn = connect_sqlite(str(self._db_path))
            try:
                _set_wal_journal_mode(conn)
                with conn:
                    for topic_id, att in updated_attempts:
                        conn.execute(
                            """
                            UPDATE attempts
                            SET correct = ?, error_type = ?, outcome = ?,
                                is_speed_round = ?, review_pending = ?,
                                review_question_id = ?, error_book_source = ?, extra = ?
                            WHERE student_id = ? AND subject = ? AND topic = ?
                              AND question_id = ? AND timestamp = ?
                            """,
                            (
                                1 if att.get("correct") else 0,
                                att.get("error_type"),
                                *_attempt_index_values(att),
                                *_attempt_link_values(att),
                                json.dumps(att),
                                self.student_id,
                                self.subject,
                                topic_id,
                                question_id,
                                latest_timestamp,
                            ),
                        )
            except sqlite3.Error as exc:
                logger.error("Failed to update attempt metadata in SQLite: %s", exc)
            finally:
                conn.close()

            self.refresh_mistake_states([question_id])
            try:
                from backend.api import invalidate_mistakes_cache
                invalidate_mistakes_cache(self.student_id)
            except ImportError:
                pass

            return True

    # ------------------------------------------------------------------
    # Mutators (locked)
    # ------------------------------------------------------------------

    def log_attempt(
        self,
        topic: str,
        question_id: str,
        is_correct: bool,
        error_type: str = None,
        skill_id: str = None,
        response_time_ms: int = 0,
        is_revision: bool = False,
        misconception_id: str | None = None,
        student_answer: str | None = None,
        topic_ids: list[str] | None = None,
        question_type: str | None = None,
        difficulty: str | None = None,
        is_speed_round: bool = False,
        part_results: list[dict] | None = None,
        outcome: str | AttemptOutcome | None = None,
        score: float | int | None = None,
        max_score: float | int | None = None,
        point_attainment: list[dict] | None = None,
        attempt_id: str | None = None,
        review_source: str | None = None,
        review_question_id: str | None = None,
        exam_id: str | None = None,
        today_task_id: str | None = None,
        review_match: dict | None = None,
        used_show_answer: bool = False,
        support_level: int | None = None,
        confidence: str | None = None,
        guided_phase: str | None = None,
        first_attempt: bool | None = None,
        correction_completed: bool | None = None,
        self_explanation: str | None = None,
        request_id: str | None = None,
        request_fingerprint: str | None = None,
        request_response: dict | None = None,
        error_book_eligible: bool | None = None,
    ) -> str:
        """Record or update one physical answer across its topic evidence rows.

        ``attempt_id`` is shared by every topic fan-out copy.  Progressive
        multi-part submissions reuse that ID, replacing the current evidence
        snapshot instead of appending a fresh whole-question failure.
        ``error_book_eligible=False`` keeps a miss out of the Error Book.
        """
        if not topic_ids:
            topic_ids = [topic]

        shared_attempt_id = attempt_id or str(uuid.uuid4())

        with self._lock:
            # Stamp inside the lock so the recorded time matches the persisted
            # order. Taking it beforehand let a thread that computed an earlier
            # timestamp be inserted after a later one, so the stored history could
            # read out of chronological order (which recency weighting and the
            # "latest attempt" lookups both assume).
            now = datetime.now(timezone.utc)
            now_iso = now.isoformat()
            # Only the fanned-out topics are read/mutated/persisted here, so scope
            # the read instead of materialising the student's whole history.
            data = self._read_log(topics=topic_ids)
            new_records: list[tuple[str, dict]] = []
            updated_records: list[tuple[str, dict]] = []
            # Progressive multi-part answers update this attempt in place, so a
            # later fix would replace a wrong part. Keep every wrong part for
            # the Error Book, merged across all topic copies.
            part_error_history: list[dict] = []
            if part_results is not None:
                prior_history = [
                    entry
                    for t_id in topic_ids
                    for att in data["topics"].get(t_id, {}).get("attempts", [])
                    if att.get("attempt_id") == shared_attempt_id
                    for entry in att.get("part_error_history") or []
                ]
                part_error_history = [
                    {**entry, "recorded_at": entry.get("recorded_at") or now_iso}
                    for entry in part_error_entries(
                        {"part_error_history": prior_history, "part_results": part_results}
                    )
                ]

            for idx, t_id in enumerate(topic_ids):
                if t_id not in data["topics"]:
                    data["topics"][t_id] = {"attempts": [], "accuracy": 0.0}

                topic_data = data["topics"][t_id]
                weight = 1.0 if idx == 0 else 0.3
                existing = next(
                    (
                        att for att in topic_data.get("attempts", [])
                        if att.get("attempt_id") == shared_attempt_id
                    ),
                    None,
                )

                attempt_record = existing if existing is not None else {
                    "attempt_id": shared_attempt_id,
                    "question_id": question_id,
                    "timestamp": now_iso,
                    "attempt_type": "answer",
                }
                attempt_record.update({
                    "attempt_id": shared_attempt_id,
                    "question_id": question_id,
                    "correct": bool(is_correct),
                    "error_type": error_type,
                    "skill_id": skill_id or f"{t_id}/{question_id}",
                    "response_time_ms": response_time_ms,
                    "attempt_type": "answer",
                    "student_answer": student_answer,
                    "weight": weight,
                    "question_type": question_type,
                    "updated_at": now_iso,
                })

                if part_results is not None:
                    attempt_record["part_results"] = part_results
                if part_error_history:
                    attempt_record["part_error_history"] = part_error_history
                if difficulty:
                    # BKT weighs evidence by difficulty: a correct answer on a
                    # harder item is stronger evidence of knowing, and a wrong
                    # answer on an easy item is stronger evidence of not knowing.
                    attempt_record["difficulty"] = difficulty
                if score is not None:
                    attempt_record["score"] = score
                if max_score is not None:
                    attempt_record["max_score"] = max_score
                if point_attainment is not None:
                    attempt_record["point_attainment"] = point_attainment
                if is_speed_round:
                    attempt_record["is_speed_round"] = True
                else:
                    attempt_record.pop("is_speed_round", None)
                if is_revision:
                    attempt_record["is_revision"] = True
                preserve_error_book = (
                    attempt_record.get("review_source") == "error_book"
                    and review_source not in (None, "error_book")
                )
                if review_source and not preserve_error_book:
                    # Error Book closure provenance must survive Today metadata on
                    # progressive/multi-part updates of the same physical attempt.
                    attempt_record["review_source"] = review_source
                if review_question_id and not preserve_error_book:
                    attempt_record["review_question_id"] = review_question_id
                if exam_id is not None:
                    attempt_record["exam_id"] = str(exam_id)
                if today_task_id:
                    attempt_record["today_task_id"] = today_task_id
                if review_match is not None:
                    attempt_record["review_match"] = review_match

                requested_support = 4 if used_show_answer else int(support_level or 0)
                requested_support = max(0, min(4, requested_support))
                prior_support = int(attempt_record.get("support_level") or (4 if attempt_record.get("used_show_answer") else 0))
                attempt_record["support_level"] = max(prior_support, requested_support)
                if used_show_answer or attempt_record["support_level"] == 4:
                    attempt_record["used_show_answer"] = True
                if confidence is not None:
                    attempt_record["confidence"] = confidence
                if guided_phase is not None:
                    attempt_record["guided_phase"] = guided_phase
                if first_attempt is not None:
                    if today_task_id:
                        # A client may downgrade first-attempt evidence, but it
                        # cannot promote a retry. Derive the upper bound from
                        # persisted Today attempts for this question across all
                        # tasks and preserve False across progressive multi-part
                        # updates.
                        prior_today_answer = any(
                            prior.get("attempt_type") == "answer"
                            and prior.get("question_id") == question_id
                            and (
                                prior.get("today_task_id")
                                or prior.get("review_source") == "today_plan"
                            )
                            and prior.get("attempt_id") != shared_attempt_id
                            for topic_state in data.get("topics", {}).values()
                            for prior in topic_state.get("attempts", [])
                        )
                        prior_first = (
                            bool(attempt_record.get("first_attempt", True))
                            if existing is not None
                            else True
                        )
                        attempt_record["first_attempt"] = bool(
                            first_attempt and prior_first and not prior_today_answer
                        )
                    else:
                        attempt_record["first_attempt"] = bool(first_attempt)
                if correction_completed is not None:
                    attempt_record["correction_completed"] = bool(
                        attempt_record.get("correction_completed") or correction_completed
                    )
                if self_explanation:
                    attempt_record["self_explanation"] = str(self_explanation).strip()[:300]
                if misconception_id is not None:
                    attempt_record["misconception_id"] = misconception_id
                if error_book_eligible is False:
                    attempt_record["error_book_eligible"] = False

                if outcome is not None:
                    attempt_record["outcome"] = (
                        outcome.value if isinstance(outcome, AttemptOutcome) else str(outcome)
                    )
                persisted_outcome = persist_outcome(attempt_record)
                if misconception_id is None and persisted_outcome is not AttemptOutcome.INCORRECT:
                    attempt_record.pop("misconception_id", None)

                if existing is None:
                    topic_data["attempts"].append(attempt_record)
                    new_records.append((t_id, attempt_record))
                else:
                    updated_records.append((t_id, attempt_record))

                self._recompute_accuracy(topic_data)

                # Only scored **direct** observations may initialise or move a
                # revision schedule. Pending/blank work and strand-inferred
                # diagnostic rows leave the due date untouched.
                if not is_speed_round and is_scored_learning_attempt(attempt_record):
                    if self._is_direct_mastery_attempt(attempt_record):
                        direct_attempts = self._direct_attempts_for_mastery(
                            topic_data["attempts"]
                        )
                        bkt = self.calculate_bkt(direct_attempts)
                        if self.mastery_established(topic_data["attempts"]):
                            # Keep support-sensitive BKT, but start the
                            # forgetting-curve schedule only when the topic
                            # meets the one mastery rule.
                            SpacedRepetitionScheduler.maybe_initialise(
                                topic_data, now=now
                            )
                        if is_revision:
                            SpacedRepetitionScheduler.on_revision_response(
                                topic_data,
                                is_correct=classify_attempt(attempt_record)
                                is AttemptOutcome.CORRECT,
                                current_bkt=bkt,
                                now=now,
                                support_level=attempt_record.get("support_level", 4 if attempt_record.get("used_show_answer") else 0),
                            )
                    elif is_revision:
                        # Revision flag on a non-direct row: still advance schedule
                        # using direct mastery so demotion/promotion stays consistent.
                        direct_attempts = self._direct_attempts_for_mastery(
                            topic_data["attempts"]
                        )
                        bkt = self.calculate_bkt(direct_attempts)
                        SpacedRepetitionScheduler.on_revision_response(
                            topic_data,
                            is_correct=classify_attempt(attempt_record)
                            is AttemptOutcome.CORRECT,
                            current_bkt=bkt,
                            now=now,
                            support_level=attempt_record.get("support_level", 4 if attempt_record.get("used_show_answer") else 0),
                        )

            if new_records:
                self._persist_new_attempts(
                    data,
                    new_records,
                    request_id=request_id,
                    request_fingerprint=request_fingerprint,
                    request_response=request_response,
                )
            if updated_records:
                self._persist_updated_attempts(
                    data,
                    updated_records,
                    request_id=request_id,
                    request_fingerprint=request_fingerprint,
                    request_response=request_response,
                )
            try:
                from backend.api import invalidate_mistakes_cache
                invalidate_mistakes_cache(self.student_id)
            except ImportError:
                pass

        return shared_attempt_id

    # ------------------------------------------------------------------
    # Parent review
    # ------------------------------------------------------------------

    @staticmethod
    def _refresh_multi_part_summary(attempt: dict) -> None:
        """Recalculate whole-question fields after a part review decision."""
        parts = [part for part in attempt.get("part_results", []) if isinstance(part, dict)]
        if not parts:
            persist_outcome(attempt)
            return

        score = 0.0
        max_score = 0.0
        for part in parts:
            try:
                part_max = float(part.get("max_score", part.get("marks", 1)) or 0)
            except (TypeError, ValueError):
                part_max = 0.0
            try:
                part_score = float(part.get("score", part_max if part.get("is_correct") else 0) or 0)
            except (TypeError, ValueError):
                part_score = 0.0
            max_score += max(0.0, part_max)
            score += max(0.0, min(part_score, part_max))

        attempt["score"] = int(score) if score.is_integer() else score
        attempt["max_score"] = int(max_score) if max_score.is_integer() else max_score
        attempt.pop("outcome", None)
        attempt["error_type"] = None
        overall = persist_outcome(attempt)
        attempt["correct"] = overall is AttemptOutcome.CORRECT
        attempt["error_type"] = {
            AttemptOutcome.CORRECT: None,
            AttemptOutcome.INCORRECT: "partial_incorrect",
            AttemptOutcome.PENDING: "parent_review_pending",
            AttemptOutcome.UNANSWERED: "unanswered",
            AttemptOutcome.DISMISSED: "manual_dismissed",
        }[overall]

    def review_attempt(
        self,
        topic: str,
        question_id: str,
        student_answer: str,
        correct: bool,
        attempt_id: str | None = None,
        part_label: str | None = None,
        exam_id: str | None = None,
        allow_idempotent: bool = False,
    ) -> bool:
        """Adjudicate every topic copy of one pending physical attempt atomically.

        ``allow_idempotent`` is intentionally opt-in for the parent/exam recovery
        path. Existing callers retain the historical ``False`` result when a
        decision was already consumed.
        """
        with self._lock:
            data = self._read_log(topics=self.get_topics_for_question(question_id))
            candidates: list[tuple[str, dict]] = []
            idempotent_matches: list[bool] = []
            expected_outcome = (
                AttemptOutcome.CORRECT if correct else AttemptOutcome.INCORRECT
            )
            for topic_id, topic_data in data.get("topics", {}).items():
                for attempt in topic_data.get("attempts", []):
                    if attempt.get("question_id") != question_id:
                        continue
                    if attempt_id and attempt.get("attempt_id") != attempt_id:
                        continue
                    if exam_id is not None and str(attempt.get("exam_id") or "") != str(exam_id):
                        continue
                    if not attempt_id and student_answer and part_label is None:
                        if str(attempt.get("student_answer") or "").strip() != student_answer.strip():
                            continue

                    if part_label:
                        matching_part = next(
                            (
                                part
                                for part in attempt.get("part_results", [])
                                if str(part.get("label") or "").strip().lower()
                                == part_label.strip().lower()
                            ),
                            None,
                        )
                        if matching_part is None:
                            if allow_idempotent and attempt_id:
                                idempotent_matches.append(False)
                            continue
                        target_outcome = classify_attempt({
                            "part_results": [matching_part],
                            "student_answer": attempt.get("student_answer", "x"),
                        })
                    else:
                        target_outcome = classify_attempt(attempt)

                    if target_outcome is AttemptOutcome.PENDING:
                        candidates.append((topic_id, attempt))
                    elif allow_idempotent and attempt_id:
                        idempotent_matches.append(target_outcome is expected_outcome)

            if not candidates:
                return bool(idempotent_matches) and all(idempotent_matches)

            if attempt_id:
                target_key = f"id:{attempt_id}"
            else:
                # Prefer the requested topic, otherwise the newest pending event.
                ordered = sorted(
                    candidates,
                    key=lambda item: (
                        item[0] == topic,
                        str(item[1].get("timestamp") or ""),
                    ),
                    reverse=True,
                )
                target_key = physical_attempt_key(ordered[0][1])

            updated: list[tuple[str, dict]] = []
            for topic_id, attempt in candidates:
                if physical_attempt_key(attempt) != target_key:
                    continue

                if part_label:
                    matching_part = next(
                        (
                            part for part in attempt.get("part_results", [])
                            if str(part.get("label") or "").strip().lower()
                            == part_label.strip().lower()
                        ),
                        None,
                    )
                    if matching_part is None or classify_attempt({
                        "part_results": [matching_part],
                        "student_answer": attempt.get("student_answer", "x"),
                    }) is not AttemptOutcome.PENDING:
                        continue
                    try:
                        part_max = float(matching_part.get("max_score", matching_part.get("marks", 1)) or 0)
                    except (TypeError, ValueError):
                        part_max = 0.0
                    matching_part["is_correct"] = bool(correct)
                    matching_part["score"] = part_max if correct else 0
                    matching_part["max_score"] = part_max
                    matching_part["outcome"] = (
                        AttemptOutcome.CORRECT.value if correct else AttemptOutcome.INCORRECT.value
                    )
                    matching_part["error_type"] = None if correct else "parent_review_rejected"
                    self._refresh_multi_part_summary(attempt)
                else:
                    attempt["correct"] = bool(correct)
                    attempt["error_type"] = None if correct else "parent_review_rejected"
                    attempt["outcome"] = (
                        AttemptOutcome.CORRECT.value if correct else AttemptOutcome.INCORRECT.value
                    )
                    if attempt.get("max_score") is not None:
                        attempt["score"] = attempt.get("max_score") if correct else 0

                updated.append((topic_id, attempt))
                self._recompute_accuracy(data["topics"][topic_id])

            if not updated:
                return False

            self._persist_updated_attempts(data, updated)
            try:
                from backend.api import invalidate_mistakes_cache
                invalidate_mistakes_cache(self.student_id)
            except Exception:
                pass
            return True

    def flag_attempt_for_review(self, question_id: str, student_answer: str | None = None) -> bool:
        """Move every fan-out copy of the newest confirmed wrong event to review."""
        with self._lock:
            data = self._read_log(topics=self.get_topics_for_question(question_id))
            candidates: list[tuple[str, dict]] = []
            for topic_id, topic_data in data.get("topics", {}).items():
                for attempt in topic_data.get("attempts", []):
                    if attempt.get("question_id") != question_id:
                        continue
                    if attempt.get("attempt_type", "answer") not in ("answer", "diagnostic"):
                        continue
                    if student_answer is not None and str(attempt.get("student_answer") or "").strip() != student_answer.strip():
                        continue
                    if classify_attempt(attempt) is AttemptOutcome.PENDING:
                        return True
                    if classify_attempt(attempt) is AttemptOutcome.INCORRECT:
                        candidates.append((topic_id, attempt))

            if not candidates:
                return False
            target = max(candidates, key=lambda item: str(item[1].get("timestamp") or ""))[1]
            target_key = physical_attempt_key(target)
            updated: list[tuple[str, dict]] = []
            for topic_id, attempt in candidates:
                if physical_attempt_key(attempt) != target_key:
                    continue
                attempt["correct"] = False
                attempt["error_type"] = "parent_review_pending"
                attempt["outcome"] = AttemptOutcome.PENDING.value
                updated.append((topic_id, attempt))
                self._recompute_accuracy(data["topics"][topic_id])

            self._persist_updated_attempts(data, updated)
            try:
                from backend.api import invalidate_mistakes_cache
                invalidate_mistakes_cache(self.student_id)
            except Exception:
                pass
            return True

    def get_pending_reviews(self, data: dict | None = None) -> list[dict]:
        """Return one queue item per pending physical attempt or pending subpart."""
        if data is None:
            self._ensure_db(self._db_path)
            conn = connect_sqlite(str(self._db_path))
            try:
                rows = conn.execute(
                    """
                    SELECT topic, extra FROM attempts
                    WHERE student_id = ? AND subject = ?
                      AND review_pending = 1
                    ORDER BY id ASC
                    """,
                    (self.student_id, self.subject),
                ).fetchall()
            finally:
                conn.close()
            data = {"topics": {}}
            for topic, raw in rows:
                try:
                    attempt = json.loads(raw)
                except (TypeError, json.JSONDecodeError):
                    continue
                if isinstance(attempt, dict):
                    data["topics"].setdefault(str(topic), {"attempts": []})["attempts"].append(attempt)
        copies: dict[str, tuple[str, dict]] = {}
        for topic, topic_data in data.get("topics", {}).items():
            for attempt in topic_data.get("attempts", []):
                if classify_attempt(attempt) is not AttemptOutcome.PENDING:
                    continue
                key = physical_attempt_key(attempt)
                existing = copies.get(key)
                try:
                    weight = float(attempt.get("weight", 1.0))
                except (TypeError, ValueError):
                    weight = 1.0
                try:
                    existing_weight = float(existing[1].get("weight", 1.0)) if existing else -1.0
                except (TypeError, ValueError):
                    existing_weight = -1.0
                if existing is None or weight > existing_weight:
                    copies[key] = (topic, attempt)

        pending: list[dict] = []
        for topic, attempt in copies.values():
            base = {
                "attempt_id": attempt.get("attempt_id"),
                "exam_id": attempt.get("exam_id"),
                "topic": topic,
                "question_id": attempt.get("question_id"),
                "timestamp": attempt.get("timestamp"),
                "attempt_type": attempt.get("attempt_type"),
                "outcome": AttemptOutcome.PENDING.value,
            }
            pending_parts = [
                part for part in attempt.get("part_results", [])
                if isinstance(part, dict)
                and classify_attempt({
                    "part_results": [part],
                    "student_answer": attempt.get("student_answer", "x"),
                }) is AttemptOutcome.PENDING
            ]
            if pending_parts:
                for part in pending_parts:
                    label = str(part.get("label") or "").strip()
                    pending.append({
                        **base,
                        "review_key": part_review_key(attempt, label),
                        "part_label": label,
                        "student_answer": part.get("student_answer", ""),
                        "score": part.get("score"),
                        "max_score": part.get("max_score", part.get("marks")),
                    })
            else:
                pending.append({
                    **base,
                    "review_key": part_review_key(attempt),
                    "part_label": None,
                    "student_answer": attempt.get("student_answer"),
                    "score": attempt.get("score"),
                    "max_score": attempt.get("max_score"),
                })
        pending.sort(key=lambda item: str(item.get("timestamp") or ""), reverse=True)
        return pending

    # ------------------------------------------------------------------
    # Accuracy / BKT helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _recompute_accuracy(topic_data: dict) -> None:
        """Recompute accuracy from confirmed scored observations only."""
        scored = [
            attempt for attempt in topic_data.get("attempts", [])
            if is_scored_learning_attempt(attempt)
        ]
        scratch = {"attempts": scored, "accuracy": 0.0}
        _recompute_accuracy_core(scratch)
        topic_data["accuracy"] = scratch["accuracy"]

    def calculate_bkt(self, attempts: list, **kwargs) -> float:
        """Run BKT over confirmed scored observations only."""
        scored = [attempt for attempt in attempts if is_scored_learning_attempt(attempt)]
        kwargs.pop("filter_attempt_types", None)
        return _bkt_core(scored, filter_attempt_types=False, **kwargs)

    @staticmethod
    def _is_direct_mastery_attempt(attempt: dict) -> bool:
        """True when an attempt may inform BKT and recommendation confidence.

        Strand-inferred diagnostic pseudo-rows and revealed answers are excluded.
        Support levels 1–3 may still inform the BKT trajectory, but they are not
        sufficient to establish mastery: every consequential mastery gate also
        applies the explicit independent-evidence floor below.
        """
        if not is_scored_learning_attempt(attempt):
            return False
        if attempt.get("used_show_answer") or int(attempt.get("support_level") or 0) >= 4:
            return False
        question_id = str(attempt.get("question_id") or "")
        if question_id.startswith("pseudo_"):
            return False
        evidence = attempt.get("diagnostic_evidence")
        if isinstance(evidence, dict) and evidence.get("inferred_from_strand"):
            return False
        return True

    @staticmethod
    def _direct_attempts_for_mastery(attempts: list) -> list:
        """Filter to direct, non-revealed scored attempts used by BKT."""
        return [a for a in attempts if StudyRuleEngine._is_direct_mastery_attempt(a)]

    @staticmethod
    def _independent_attempts_for_mastery(attempts: list) -> list:
        """Return the first answer to each question when it had no help.

        A later answer to a question the student already answered (a retry
        after feedback, or the same question on another day) can show recall
        of that question, so it is not new evidence of the skill. An answer
        after a revealed answer is not a first answer. Support level 0 must be
        explicit.
        """
        seen_questions: set[str] = set()
        first_answers: list = []
        for attempt in attempts:
            if not is_scored_learning_attempt(attempt):
                continue
            question_id = str(attempt.get("question_id") or "")
            if question_id:
                if question_id in seen_questions:
                    continue
                seen_questions.add(question_id)
            first_answers.append(attempt)
        return [
            attempt
            for attempt in first_answers
            if StudyRuleEngine._is_direct_mastery_attempt(attempt)
            and is_independent_learning_attempt(attempt)
            and attempt.get("first_attempt") is not False
        ]

    @staticmethod
    def mastery_established(attempts: list) -> bool:
        """The one rule for "mastered" on a topic.

        Curriculum ticks (through progress status), Today and the next topic,
        prerequisites, the study plan and revision scheduling all use it:

        - at least MASTERY_MIN_EVIDENCE first answers on the student's own;
        - MASTERY_WINDOW_CORRECT right in the last MASTERY_MIN_EVIDENCE of them.
          A right answer that the student marked "guess" does not count;
        - BKT at the mastery threshold on direct and on independent answers.
          This still matters for multiple choice, where guessing is easy.

        Time decay does not apply: freshness is the revision schedule's job.
        """
        evidence = deduplicate_attempts(attempts)
        independent = StudyRuleEngine._independent_attempts_for_mastery(evidence)
        if StudyRuleEngine._right_answers_to_mastery(independent) > 0:
            return False
        direct = StudyRuleEngine._direct_attempts_for_mastery(evidence)
        return all(
            _bkt_core(rows, filter_attempt_types=False, apply_recency=False) >= MASTERY_THRESHOLD
            for rows in (direct, independent)
        )

    @staticmethod
    def _right_answers_to_mastery(independent: list) -> int:
        """How many more right first answers the mastery rule needs (BKT aside)."""
        results = [counts_as_right(attempt) for attempt in independent]
        more = 0
        while (
            len(results) < MASTERY_MIN_EVIDENCE
            or sum(results[-MASTERY_MIN_EVIDENCE:]) < MASTERY_WINDOW_CORRECT
        ):
            results.append(True)
            more += 1
        return more

    def _persist_adaptive_difficulty(
        self,
        topic: str,
        level: str,
        *,
        at_attempt_count: int | None = None,
    ) -> None:
        """Update the per-topic adaptive difficulty level in persistent storage.

        ``at_attempt_count`` records how many scored learning attempts were present
        when the level last changed, so retrieve calls without new answers cannot
        keep promoting/demoting on the same streak.
        """
        with self._lock:
            data = self._read_log(topics=[topic])
            topic_data = data.setdefault("topics", {}).setdefault(topic, {})
            topic_data["adaptive_difficulty"] = level
            if at_attempt_count is not None:
                topic_data["adaptive_difficulty_at_attempt_count"] = int(at_attempt_count)
            self._write_log(data)

    # ------------------------------------------------------------------
    # Study plan & progress
    # ------------------------------------------------------------------

    def get_study_plan(self, topic: str) -> dict:
        """Return a direct-evidence plan with freshness kept separate from attainment."""
        data = self.load_log(topics=[topic])
        topic_data = data["topics"].get(topic)

        if not topic_data or not topic_data.get("attempts"):
            return {
                "action": "assessment",
                "message": "Not enough data. Please complete more exercises to determine a study plan.",
                "bkt_mastery": None,
                "established_mastery": None,
                "evidence_count": 0,
                "confidence": "none",
                "status": "not_started",
            }

        attempts = topic_data["attempts"]
        direct_attempts = self._direct_attempts_for_mastery(attempts)
        independent_attempts = self._independent_attempts_for_mastery(attempts)
        answer_attempts = [
            attempt for attempt in independent_attempts
            if attempt.get("attempt_type", "answer") == "answer"
        ]
        evidence_count = len(independent_attempts)
        diagnostic_attempts = [
            attempt for attempt in independent_attempts
            if attempt.get("attempt_type") == "diagnostic"
        ]

        if not direct_attempts:
            return {
                "action": "assessment",
                "message": "Complete an independent question so the tutor can build a reliable study plan.",
                "bkt_mastery": None,
                "established_mastery": None,
                "evidence_count": 0,
                "supported_evidence_count": 0,
                "confidence": "none",
                "status": "not_started",
            }

        bkt_mastery = self.calculate_bkt(direct_attempts)
        established_mastery = self.calculate_bkt(direct_attempts, apply_recency=False)
        independent_bkt_mastery = (
            self.calculate_bkt(independent_attempts)
            if independent_attempts
            else None
        )
        independent_established_mastery = (
            self.calculate_bkt(independent_attempts, apply_recency=False)
            if independent_attempts
            else None
        )
        accuracy = (
            sum(1 for attempt in independent_attempts if attempt.get("correct"))
            / evidence_count
            if evidence_count
            else None
        )
        confidence = self._progress_confidence(
            evidence_count,
            evidence_count,
            diagnostic_attempts,
        )
        mastered = self.mastery_established(attempts)
        status = self._progress_status(bkt_mastery, evidence_count, mastered)
        plan_meta = {
            "bkt_mastery": bkt_mastery,
            "established_mastery": established_mastery,
            "independent_bkt_mastery": independent_bkt_mastery,
            "independent_established_mastery": independent_established_mastery,
            "evidence_count": evidence_count,
            "supported_evidence_count": len(direct_attempts),
            "confidence": confidence,
            "status": status,
        }

        if not independent_attempts:
            return {
                "action": "daily_practice",
                "message": (
                    "Supported work shows progress. Complete one question without "
                    "hints or a revealed answer to establish independent evidence."
                ),
                "trigger": "supported progress without independent evidence",
                **plan_meta,
            }

        # Rule 1: recent consecutive independent errors.
        consecutive_errors = 0
        for attempt in reversed(answer_attempts):
            if not attempt.get("correct"):
                consecutive_errors += 1
            else:
                break
        if consecutive_errors >= 3:
            return {
                "action": "concept_reteach",
                "message": "You've missed several questions in a row. Let's step back and review the core concepts.",
                "trigger": "consecutive_errors >= 3",
                **plan_meta,
            }

        # Rule 2: high calculation-error rate in independent answers.
        calc_errors = sum(1 for attempt in answer_attempts if attempt.get("error_type") == "calculation_error")
        if len(answer_attempts) >= 3 and (calc_errors / len(answer_attempts)) > 0.4:
            return {
                "action": "drill_practice",
                "message": "I noticed some calculation mistakes. Let's do a quick drill to improve accuracy without new concepts.",
                "trigger": "calculation_error > 40%",
                **plan_meta,
            }

        # Rule 3: recent independent concept gaps.
        recent_errors = [
            attempt.get("error_type")
            for attempt in answer_attempts[-3:]
            if not attempt.get("correct")
        ]
        if "concept_gap" in recent_errors:
            return {
                "action": "explain_prioritized",
                "message": "It seems there might be a gap in understanding this specific rule. Let me explain it first.",
                "trigger": "concept_gap detected recently",
                **plan_meta,
            }

        if accuracy < 0.5:
            return {
                "action": "daily_practice",
                "message": f"Independent accuracy is {accuracy*100:.0f}%. Use daily practice to build a solid foundation.",
                "trigger": "independent accuracy < 50%",
                **plan_meta,
            }
        if accuracy <= 0.8:
            return {
                "action": "weekly_revision",
                "message": f"Independent accuracy is {accuracy*100:.0f}%. Schedule weekly revision to keep building consistency.",
                "trigger": "50% <= independent accuracy <= 80%",
                **plan_meta,
            }
        if evidence_count < MASTERY_MIN_EVIDENCE:
            remaining = MASTERY_MIN_EVIDENCE - evidence_count
            return {
                "action": "daily_practice",
                "message": (
                    f"Independent accuracy is {accuracy*100:.0f}% so far. That is a strong start — "
                    f"try {remaining} more question{'s' if remaining != 1 else ''} "
                    "so we can be confident it has stuck."
                ),
                "trigger": f"accuracy > 80% with fewer than {MASTERY_MIN_EVIDENCE} independent scored answers",
                **plan_meta,
            }
        if (
            mastered
            and independent_bkt_mastery is not None
            and independent_bkt_mastery < MASTERY_THRESHOLD
        ):
            return {
                "action": "weekly_revision",
                "message": (
                    f"Historical independent accuracy is {accuracy*100:.0f}%, so this topic was established. "
                    "It has not been practised recently; use a short retrieval set to refresh it."
                ),
                "trigger": "established independent mastery with low current freshness",
                **plan_meta,
            }
        if not mastered:
            return {
                "action": "weekly_revision",
                "message": (
                    f"Independent accuracy is {accuracy*100:.0f}%, but the evidence pattern is not yet stable enough "
                    "to call this topic secure. Use another mixed practice set."
                ),
                "trigger": "accuracy > 80% but the mastery rule is not met",
                **plan_meta,
            }
        return {
            "action": "maintenance",
            "message": f"Independent accuracy is {accuracy*100:.0f}%. This topic is secure; use occasional maintenance.",
            "trigger": "mastery rule met and current independent BKT >= 80%",
            **plan_meta,
        }

    # ------------------------------------------------------------------
    # Curriculum-driven recommendations (Design §3.10; Req 9.6, 9.7, 6.10)
    # ------------------------------------------------------------------

    def _is_mastered(self, log: dict, topic_id: str) -> bool:
        """Return whether the topic is mastered (see ``mastery_established``).

        Pure time decay must not send an established learner back through the
        forward curriculum; spaced-revision due dates handle freshness.
        """
        attempts = log.get("topics", {}).get(topic_id, {}).get("attempts", [])
        return self.mastery_established(attempts)

    def _placement_order(self, log: dict, slice_obj, year_int: int) -> tuple[list[str], list[str], set[str]]:
        """Teaching order of a year after its diagnostic: start topics first, secure topics last.

        Returns the order, the start topics and the secure ("deferred") topics.
        Nothing is skipped.
        """
        sequence = slice_obj.sequence
        topic_ids = {t.topic_id for t in slice_obj.topics}
        placement = log.get("diagnostic_status", {}).get(f"{self.subject}::{year_int}") or {}
        start_topics = [t for t in placement.get("start_topics") or [] if t in topic_ids]
        deferred = set(placement.get("secure_topics") or []) - set(start_topics)
        ordered_topics = [
            *start_topics,
            *(t for t in sequence.sequence if t not in start_topics and t not in deferred),
            *(t for t in sequence.sequence if t in deferred),
        ]
        return ordered_topics, start_topics, deferred

    def _topic_facts(
        self,
        log: dict,
        ordered_topics: list[str],
        sequence,
        *,
        satisfied: set[str] | frozenset[str] = frozenset(),
    ) -> TopicFacts:
        return build_topic_facts(
            order=ordered_topics,
            mastered=[t for t in ordered_topics if self._is_mastered(log, t)],
            prerequisites=sequence.prerequisites,
            satisfied=satisfied,
            strict=sequence.is_strict,
        )

    def today_topic_facts(
        self,
        scope: str,
        *,
        log_snapshot: dict,
        unit_topics: list | None = None,
    ) -> TopicFacts | None:
        """Topics of a Today scope in teaching order, with mastery and prerequisites.

        A senior unit gives ``unit_topics`` (its curriculum topics). A year uses
        its diagnostic placement, and a topic found secure counts as a met
        prerequisite. Only prerequisites inside the scope count.
        """
        if unit_topics is not None:
            if not unit_topics:
                return None
            try:
                slice_obj = self._loader.load_slice(
                    unit_topics[0].framework, unit_topics[0].syllabus_subject
                )
            except (KeyError, FileNotFoundError):
                return None
            return self._topic_facts(
                log_snapshot, [topic.topic_id for topic in unit_topics], slice_obj.sequence
            )
        framework_id = SUBJECT_FRAMEWORKS.get(self.subject, "AC9_MATHS")
        year_str = str(scope)
        year_int = int(year_str.removeprefix("year")) if year_str.startswith("year") else int(year_str)
        try:
            slice_obj = self._loader.load_slice(framework_id, year_int)
        except FileNotFoundError:
            return None
        ordered_topics, _start, deferred = self._placement_order(log_snapshot, slice_obj, year_int)
        return self._topic_facts(log_snapshot, ordered_topics, slice_obj.sequence, satisfied=deferred)

    def recommend_next_topic(
        self,
        year: str = "year7",
        framework_id: str | None = None,
        *,
        log_snapshot: dict | None = None,
    ) -> dict:
        """Return the next Topic_Id the student should focus on.

        Priority: revision > diagnostic_prompt > forward (Req 6.1, 7.1).
        Mastery used for sequencing is based on direct evidence only.
        """
        framework_id = framework_id or SUBJECT_FRAMEWORKS.get(self.subject, "AC9_MATHS")

        # Translate "year7" -> 7.
        year_str = str(year)
        year_int = int(year_str.removeprefix("year")) if year_str.startswith("year") else int(year_str)

        try:
            slice_obj = self._loader.load_slice(framework_id, year_int)
        except FileNotFoundError:
            return {
                "topic": None,
                "topic_id": None,
                "name": None,
                "framework_id": framework_id,
                "reason": f"No curriculum data for {framework_id} year {year_int}.",
                "mastery": 0.0,
                "recommendation_type": "forward",
            }

        topic_scope = [topic.topic_id for topic in slice_obj.topics]
        log = log_snapshot if log_snapshot is not None else self.load_log(topics=topic_scope)

        # Phase 7: revision-first (Req 6.1, 6.2, 6.5)
        # Revision takes priority over diagnostic prompts to maintain learning momentum
        if self._cold_start_satisfied(log, self.subject):
            revision_topic = self._find_due_revision(log, slice_obj)
            if revision_topic is not None:
                topic_obj = next(
                    (t for t in slice_obj.topics if t.topic_id == revision_topic),
                    None,
                )
                topic_name = topic_obj.name if topic_obj else revision_topic
                attempts = log.get("topics", {}).get(revision_topic, {}).get("attempts", [])
                bkt = self.calculate_bkt(self._direct_attempts_for_mastery(attempts))
                # Calculate days since last practice for spacing awareness
                rev_data = log.get("topics", {}).get(revision_topic, {}).get("revision", {})
                days_since = None
                if rev_data.get("last_reviewed_at"):
                    try:
                        last_dt = datetime.fromisoformat(rev_data["last_reviewed_at"])
                        if last_dt.tzinfo is None:
                            last_dt = last_dt.replace(tzinfo=timezone.utc)
                        days_since = max(1, (datetime.now(timezone.utc) - last_dt).days)
                    except (ValueError, TypeError):
                        pass
                reason_text = (
                    f"Spaced revision — last practised {days_since} day{'s' if days_since != 1 else ''} ago."
                    if days_since
                    else "Due for revision — keep your mastery fresh."
                )
                return {
                    "topic": revision_topic,
                    "topic_id": revision_topic,
                    "name": topic_name,
                    "framework_id": framework_id,
                    "reason": reason_text,
                    "mastery": bkt,
                    "recommendation_type": "revision",
                    "days_since_last": days_since,
                }

        # Phase 7: pre-diagnostic prompt (Req 7.1–7.4)
        # Diagnostic prompts come after revision but before forward recommendations
        prompt = self._maybe_diagnostic_prompt(log, self.subject, year_int)
        if prompt is not None:
            return prompt

        return self._forward_recommendation(log, slice_obj, framework_id, year_int)

    def _forward_recommendation(self, log: dict, slice_obj, framework_id: str, year_int: int) -> dict:
        """First topic in teaching order that direct evidence has not established.

        A valid diagnostic puts its start topics first and topics in secure areas
        last; nothing is skipped. A topic waits for its prerequisites in this
        year (a secure topic counts as met), so an open topic blocks only the
        topics that need it. Time decay does not reopen an established topic:
        the revision schedule keeps it fresh.
        """
        ordered_topics, start_topics, deferred = self._placement_order(log, slice_obj, year_int)
        topics_by_id = {t.topic_id: t for t in slice_obj.topics}
        # Skipping a topic is the most consequential recommendation the tutor
        # makes. BKT may use supported work, but progression requires both a
        # strong unaided pattern and the full independent evidence floor.
        topic_id = self._topic_facts(
            log, ordered_topics, slice_obj.sequence, satisfied=deferred
        ).next_topic()

        if topic_id is not None:
            attempts = log.get("topics", {}).get(topic_id, {}).get("attempts", [])
            direct_attempts = self._direct_attempts_for_mastery(attempts)
            independent_attempts = self._independent_attempts_for_mastery(attempts)
            bkt = self.calculate_bkt(direct_attempts)
            independent_bkt = self.calculate_bkt(independent_attempts)

            topic = topics_by_id.get(topic_id)
            topic_name = topic.name if topic is not None else topic_id

            if not direct_attempts:
                revealed = [
                    att for att in attempts
                    if att.get("used_show_answer") and is_scored_learning_attempt(att)
                ]
                if revealed:
                    reason = (
                        "No independent evidence yet — answers you revealed do not "
                        "count, so let's work through this one together."
                    )
                else:
                    reason = "Not started yet — this is your next learning objective."
            elif not independent_attempts:
                reason = (
                    "Supported work shows progress, but there is no unaided evidence "
                    "yet — complete a short independent check next."
                )
            elif bkt >= MASTERY_THRESHOLD and independent_bkt >= MASTERY_THRESHOLD:
                # Both patterns are strong but the mastery rule is not met yet:
                # encourage confirmation, not mastery.
                remaining = max(1, self._right_answers_to_mastery(independent_attempts))
                reason = (
                    f"Looking strong at {independent_bkt * 100:.0f}% from "
                    f"{len(independent_attempts)} independent answer"
                    f"{'s' if len(independent_attempts) != 1 else ''} — "
                    f"{remaining} more will confirm it."
                )
            elif bkt >= MASTERY_THRESHOLD:
                reason = (
                    f"Supported progress is strong, but the unaided evidence is at "
                    f"{independent_bkt * 100:.0f}% — use another independent check before moving on."
                )
            else:
                reason = (
                    f"Mastery at {bkt * 100:.0f}% — keep practising independently to reach "
                    f"{MASTERY_THRESHOLD * 100:.0f}%."
                )
            if topic_id in start_topics:
                reason = f"Your diagnostic suggests starting here. {reason}"

            return {
                "topic": topic_id,
                "topic_id": topic_id,
                "name": topic_name,
                "framework_id": framework_id,
                "reason": reason,
                "mastery": bkt,
                "recommendation_type": "forward",
            }

        # All topics in this year mastered — suggest advancing if not Year 10
        result = {
            "topic": None,
            "topic_id": None,
            "name": None,
            "framework_id": framework_id,
            "reason": "All topics mastered.",
            "mastery": 1.0,
            "recommendation_type": "forward",
        }
        if year_int < 10:
            next_year = year_int + 1
            result["reason"] = (
                f"All Year {year_int} topics mastered! "
                f"Consider advancing to Year {next_year}."
            )
            result["suggestion"] = f"advance_to_year{next_year}"
        return result

    # ------------------------------------------------------------------
    # Phase 7 recommendation helpers
    # ------------------------------------------------------------------

    def _maybe_diagnostic_prompt(
        self, log: dict, subject: str, year_level: int
    ) -> dict | None:
        """Return a diagnostic_prompt recommendation if conditions are met (Req 7.1–7.4)."""
        status_key = f"{subject}::{year_level}"
        status = log.get("diagnostic_status", {}).get(status_key)

        if status is None:
            # No diagnostic interaction yet — prompt students with some attempts
            # but not enough data for accurate BKT calibration (Req 7.1).
            # Brand new students (0-2 attempts) should start with forward recommendations;
            # students with 3-9 attempts benefit from diagnostic calibration.
            total_attempts = 0
            for topic_id, topic_data in log.get("topics", {}).items():
                attempts = topic_data.get("attempts", [])
                answer_attempts = [
                    a for a in attempts
                    if a.get("attempt_type", "answer") in ("answer", "diagnostic")
                ]
                total_attempts += len(answer_attempts)
            
            # Only prompt if student has 3-9 total attempts
            # (enough to show engagement, but not enough for accurate BKT)
            if total_attempts < 3 or total_attempts >= 10:
                return None
            
            # Student with some attempts — return diagnostic prompt
            return {
                "topic": None,
                "topic_id": None,
                "name": None,
                "framework_id": None,
                "subject": subject,
                "year_level": year_level,
                "reason": "Complete a diagnostic assessment to calibrate your learning path.",
                "mastery": 0.0,
                "recommendation_type": "diagnostic_prompt",
            }

        # Already completed → no prompt
        if status.get("completed_at") is not None:
            return None

        # Already dismissed → no prompt
        if status.get("diagnostic_dismissed_at") is not None:
            return None

        # Check 60-day window
        first_interaction = status.get("first_interaction_at")
        if first_interaction:
            first_dt = datetime.fromisoformat(
                first_interaction.replace("Z", "+00:00")
            )
            if first_dt.tzinfo is None:
                first_dt = first_dt.replace(tzinfo=timezone.utc)
            now = datetime.now(timezone.utc)
            if (now - first_dt) > timedelta(days=60):
                return None

        return {
            "topic": None,
            "topic_id": None,
            "name": None,
            "framework_id": None,
            "subject": subject,
            "year_level": year_level,
            "reason": "Complete a diagnostic assessment to calibrate your learning path.",
            "mastery": 0.0,
            "recommendation_type": "diagnostic_prompt",
        }

    def get_due_revision_topics(
        self,
        year: str = "year7",
        framework_id: str | None = None,
        *,
        limit: int = 3,
        log_snapshot: dict | None = None,
        unit_topics: list | None = None,
    ) -> list[str]:
        """Return up to ``limit`` due topics in oldest-due-first order.

        A senior unit gives ``unit_topics`` (its curriculum topics). The QCAA
        syllabus slice of these topics applies, and only these topics can be due.
        """
        if unit_topics is not None:
            if not unit_topics:
                return []
            try:
                slice_obj = self._loader.load_slice(
                    unit_topics[0].framework, unit_topics[0].syllabus_subject
                )
            except (KeyError, FileNotFoundError):
                return []
            topic_scope = [topic.topic_id for topic in unit_topics]
        else:
            framework_id = framework_id or SUBJECT_FRAMEWORKS.get(self.subject, "AC9_MATHS")
            year_str = str(year)
            year_int = int(year_str.removeprefix("year")) if year_str.startswith("year") else int(year_str)
            try:
                slice_obj = self._loader.load_slice(framework_id, year_int)
            except FileNotFoundError:
                return []
            topic_scope = [topic.topic_id for topic in slice_obj.topics]

        log = log_snapshot if log_snapshot is not None else self.load_log(topics=topic_scope)
        if not self._cold_start_satisfied(log, self.subject):
            return []

        in_scope = set(topic_scope)
        due = SpacedRepetitionScheduler.find_all_due(
            log,
            now=datetime.now(timezone.utc),
            framework_slice=slice_obj,
            is_mastered_fn=self.mastery_established,
        )
        return [topic_id for topic_id in due if topic_id in in_scope][: max(0, int(limit))]

    def _find_due_revision(self, log: dict, slice_obj) -> str | None:
        """Find the topic with the oldest overdue revision (Req 6.1, 6.2).

        A due topic, and each strict prerequisite, must still be mastered
        (``mastery_established``). That rule has no time decay on purpose:
        decay is what revision exists to catch, so a topic scheduled 30 or 60
        days out must not drop out of the queue before its own review date.
        """
        return SpacedRepetitionScheduler.find_due(
            log,
            now=datetime.now(timezone.utc),
            framework_slice=slice_obj,
            is_mastered_fn=self.mastery_established,
        )

    def _cold_start_satisfied(self, log: dict, subject: str) -> bool:
        """Return True if cold-start conditions are met for revision (Req 6.5).

        True if: (a) diagnostic for this subject is finalised, OR
                 (b) at least one topic has ≥5 attempts.
        """
        # Check if any diagnostic is completed for this subject
        for key, status in log.get("diagnostic_status", {}).items():
            if key.startswith(f"{subject}::") and status.get("completed_at"):
                return True

        # Check if any topic has ≥5 answer-type attempts
        for topic_id, topic_data in log.get("topics", {}).items():
            attempts = topic_data.get("attempts", [])
            answer_attempts = [
                a for a in attempts
                if a.get("attempt_type", "answer") in ("answer", "diagnostic")
            ]
            if len(answer_attempts) >= 5:
                return True

        return False

    @staticmethod
    def _progress_status(bkt: float | None, evidence_count: int, mastered: bool) -> str:
        """``mastered`` comes from the one mastery rule; other bands use the current BKT."""
        if evidence_count == 0 or bkt is None:
            return "not_started"
        if mastered:
            return "mastered"
        if bkt < 0.5:
            return "emerging"
        if bkt < 0.8:
            return "developing"
        return "promising"

    @staticmethod
    def _progress_confidence(
        evidence_count: int,
        direct_attempts_count: int,
        diagnostic_attempts: list[dict],
    ) -> str:
        if evidence_count == 0:
            return "none"
        diagnostic_only = diagnostic_attempts and direct_attempts_count == 0
        pseudo_only = diagnostic_only and all(
            str(att.get("question_id", "")).startswith("pseudo_")
            or "/pseudo_" in str(att.get("skill_id", ""))
            for att in diagnostic_attempts
        )
        if pseudo_only or direct_attempts_count < 2:
            return "low"
        if direct_attempts_count >= 5:
            return "high"
        return "medium"

    @staticmethod
    def _progress_diagnostic_evidence(
        diagnostic_attempts: list[dict],
        strand: str,
    ) -> dict | None:
        if not diagnostic_attempts:
            return None
        direct_attempts = [
            att for att in diagnostic_attempts
            if not str(att.get("question_id", "")).startswith("pseudo_")
        ]
        explicit = [
            att.get("diagnostic_evidence")
            for att in diagnostic_attempts
            if isinstance(att.get("diagnostic_evidence"), dict)
        ]
        inferred_from_strand = not direct_attempts
        direct_questions = len({
            att.get("question_id")
            for att in direct_attempts
            if att.get("question_id")
        })
        if explicit:
            inferred_from_strand = all(
                bool(item.get("inferred_from_strand"))
                for item in explicit
            )
            direct_questions = max(
                int(item.get("direct_questions") or 0)
                for item in explicit
            )
            strand = str(explicit[0].get("strand") or strand)
        return {
            "direct_questions": direct_questions,
            "inferred_from_strand": inferred_from_strand,
            "strand": strand,
            "confidence": "low" if inferred_from_strand else "medium",
        }

    def _progress_item(self, topic: str, details: dict, topic_obj=None) -> dict:
        attempts = details.get("attempts", [])
        evidence_attempts = deduplicate_attempts(
            attempt for attempt in attempts
            if is_scored_learning_attempt(attempt) and not attempt.get("is_speed_round")
        )
        direct_attempts = self._direct_attempts_for_mastery(evidence_attempts)
        independent_attempts = self._independent_attempts_for_mastery(evidence_attempts)
        diagnostic_attempts = [
            att for att in evidence_attempts
            if att.get("attempt_type") == "diagnostic"
        ]
        evidence_count = len(direct_attempts)
        accuracy = (
            sum(1 for attempt in direct_attempts if attempt.get("correct")) / evidence_count
            if evidence_count
            else None
        )
        independent_accuracy = (
            sum(1 for attempt in independent_attempts if attempt.get("correct"))
            / len(independent_attempts)
            if independent_attempts
            else None
        )
        bkt = self.calculate_bkt(direct_attempts) if evidence_count else None
        independent_bkt = (
            self.calculate_bkt(independent_attempts)
            if independent_attempts
            else None
        )
        last_attempt_at = max(
            (att.get("timestamp", "") for att in evidence_attempts),
            default=None,
        )

        error_counts = {}
        misconception_counts = {}
        for att in evidence_attempts:
            if att.get("correct"):
                continue
            err = att.get("error_type")
            if err:
                error_counts[err] = error_counts.get(err, 0) + 1
            mid = att.get("misconception_id")
            if mid:
                misconception_counts[mid] = misconception_counts.get(mid, 0) + 1

        t_obj = topic_obj if topic_obj is not None else self._loader.load_topic(topic)
        strand = "Other"
        if t_obj:
            if hasattr(t_obj, "strand"):
                strand = t_obj.strand
            elif hasattr(t_obj, "syllabus_subject"):
                strand = t_obj.syllabus_subject.capitalize()

        confidence = self._progress_confidence(
            len(evidence_attempts),
            len(direct_attempts),
            diagnostic_attempts,
        )
        status = self._progress_status(
            bkt,
            evidence_count,
            self.mastery_established(attempts),
        )

        return {
            "topic": topic,
            "strand": strand,
            "attempts_count": len(attempts),
            "accuracy": accuracy,
            "independent_accuracy": independent_accuracy,
            "bkt_mastery": bkt,
            "independent_bkt_mastery": independent_bkt,
            "top_errors": error_counts,
            "top_misconceptions": misconception_counts,
            "status": status,
            "mastery_label": "promising_early_signal" if status == "promising" else status,
            "evidence_count": evidence_count,
            "supported_evidence_count": len(direct_attempts),
            "independent_evidence_count": len(independent_attempts),
            "scored_evidence_count": len(evidence_attempts),
            "scored_attempt_keys": [physical_attempt_key(attempt) for attempt in direct_attempts],
            "direct_attempts_count": len(direct_attempts),
            "diagnostic_attempts_count": len(diagnostic_attempts),
            "confidence": confidence,
            "diagnostic_evidence": self._progress_diagnostic_evidence(
                diagnostic_attempts,
                strand,
            ),
            "last_attempt_at": last_attempt_at,
        }

    def get_all_progress(
        self,
        valid_topic_ids: set[str] | None = None,
        include_unattempted: bool = False,
        scope_topics: list | None = None,
        *,
        log_snapshot: dict | None = None,
    ) -> list:
        """Return topic progress, materialising only the requested scope."""
        topic_filter = sorted(valid_topic_ids) if valid_topic_ids is not None else None
        data = log_snapshot if log_snapshot is not None else self.load_log(topics=topic_filter)
        progress = []
        seen_topics = set()
        for topic, details in data["topics"].items():
            if valid_topic_ids is not None and topic not in valid_topic_ids:
                continue
            progress.append(self._progress_item(topic, details))
            seen_topics.add(topic)

        if include_unattempted and scope_topics is not None:
            for topic_obj in scope_topics:
                topic_id = topic_obj.topic_id
                if topic_id in seen_topics:
                    continue
                progress.append(
                    self._progress_item(
                        topic_id,
                        {"attempts": [], "accuracy": 0.0},
                        topic_obj,
                    )
                )
        return progress

    def get_progress_summary(
        self,
        valid_topic_ids: set[str] | None = None,
        include_unattempted: bool = False,
        scope_topics: list | None = None,
    ) -> dict:
        """Return dashboard progress plus an exact direct-event total.

        Physical attempt keys are used only inside the server to collapse
        cross-tagged copies, then removed so response size does not grow by one
        opaque key for every lifetime attempt.
        """
        topics = self.get_all_progress(
            valid_topic_ids=valid_topic_ids,
            include_unattempted=include_unattempted,
            scope_topics=scope_topics,
        )
        direct_keys: set[str] = set()
        for item in topics:
            direct_keys.update(item.pop("scored_attempt_keys", []))
        return {
            "topics": topics,
            "total_direct_attempts": len(direct_keys),
        }


# =============================================================================
# Student profile & management (multi-student, cross-subject)
# =============================================================================


def _get_db_connection() -> sqlite3.Connection:
    """Open a connection to the active SQLite database, ensuring tables exist."""
    db_path = runtime_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = connect_sqlite(str(db_path))
    _set_wal_journal_mode(conn)
    conn.row_factory = sqlite3.Row
    _ensure_schema(conn)
    conn.commit()
    return conn


def save_display_name(student_id: str, display_name: str) -> None:
    """Persist a display name without discarding other profile settings."""
    engine = get_engine(student_id, PROFILE_SUBJECT)
    with engine._lock:
        profile = engine._read_log(topics=[])
        profile["display_name"] = display_name
        engine._write_log(profile)


def initialize_runtime_database() -> None:
    """Apply idempotent runtime schema migrations before business requests."""
    StudyRuleEngine._ensure_db(runtime_db_path())


def get_weekly_learning_records(
    student_id: str,
    window_start: str,
    window_end: str,
) -> tuple[list[dict], list[tuple[str, str, str]]]:
    """Read only attempts and mistake closures inside one UTC report window."""
    initialize_runtime_database()
    conn = connect_sqlite(str(runtime_db_path()))
    try:
        attempt_rows = conn.execute(
            """
            SELECT subject, topic, extra
            FROM attempts
            WHERE student_id = ? AND timestamp >= ? AND timestamp < ?
            ORDER BY id ASC
            """,
            (student_id, window_start, window_end),
        ).fetchall()
        closure_rows = conn.execute(
            """
            SELECT subject, question_id, closed_at
            FROM mistake_state
            WHERE student_id = ? AND closure_stage = 'closed'
              AND closed_at >= ? AND closed_at < ?
            ORDER BY closed_at ASC, question_id ASC
            """,
            (student_id, window_start, window_end),
        ).fetchall()
    finally:
        conn.close()

    attempts: list[dict] = []
    for subject, topic, raw in attempt_rows:
        if not is_known_subject(str(subject)):
            continue
        try:
            attempt = json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            logger.warning(
                "Failed to parse weekly attempt JSON for student=%s subject=%s topic=%s",
                student_id,
                subject,
                topic,
            )
            continue
        if isinstance(attempt, dict):
            attempts.append({
                **attempt,
                "_summary_subject": str(subject),
                "_summary_topic": str(topic),
            })

    closures = [
        (str(subject), str(question_id), str(closed_at))
        for subject, question_id, closed_at in closure_rows
        if closed_at and is_known_subject(str(subject))
    ]
    return attempts, closures


def get_weekly_reflection(student_id: str, week_start: str) -> dict | None:
    """Return the student's saved reflection for one ISO Monday, if present."""
    conn = _get_db_connection()
    try:
        row = conn.execute(
            """
            SELECT proud_of, challenge, next_week_intention, updated_at
            FROM weekly_reflections
            WHERE student_id = ? AND week_start = ?
            """,
            (student_id, week_start),
        ).fetchone()
        if row is None:
            return None
        return {
            "proud_of": str(row["proud_of"] or ""),
            "challenge": str(row["challenge"] or ""),
            "next_week_intention": str(row["next_week_intention"] or ""),
            "updated_at": str(row["updated_at"]),
        }
    finally:
        conn.close()


def save_weekly_reflection(
    student_id: str,
    week_start: str,
    *,
    proud_of: str,
    challenge: str,
    next_week_intention: str,
) -> dict:
    """Upsert one student-authored weekly reflection."""
    updated_at = datetime.now(timezone.utc).isoformat()
    values = {
        "proud_of": proud_of.strip(),
        "challenge": challenge.strip(),
        "next_week_intention": next_week_intention.strip(),
        "updated_at": updated_at,
    }
    conn = _get_db_connection()
    try:
        conn.execute(
            """
            INSERT INTO weekly_reflections (
                student_id, week_start, proud_of, challenge,
                next_week_intention, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(student_id, week_start) DO UPDATE SET
                proud_of = excluded.proud_of,
                challenge = excluded.challenge,
                next_week_intention = excluded.next_week_intention,
                updated_at = excluded.updated_at
            """,
            (
                student_id,
                week_start,
                values["proud_of"],
                values["challenge"],
                values["next_week_intention"],
                updated_at,
            ),
        )
        conn.commit()
        return values
    finally:
        conn.close()


def get_student_list() -> list[dict]:
    """Return every known student with display name and active subjects."""
    conn = _get_db_connection()
    try:
        cursor = conn.cursor()

        # Gather distinct student_ids from all data tables
        cursor.execute("""
            SELECT DISTINCT student_id FROM attempts
            UNION
            SELECT DISTINCT student_id FROM topic_metadata
            UNION
            SELECT DISTINCT student_id FROM diagnostic_status
            UNION
            SELECT DISTINCT student_id FROM student_subject_metadata
            UNION
            SELECT DISTINCT student_id FROM weekly_reflections
            ORDER BY student_id
        """)
        all_ids = [row["student_id"] for row in cursor.fetchall()]

        # Get display names
        cursor.execute(
            "SELECT student_id, metadata FROM student_subject_metadata WHERE subject = ?",
            (PROFILE_SUBJECT,)
        )
        name_map: dict[str, str | None] = {}
        for row in cursor.fetchall():
            try:
                meta = json.loads(row["metadata"])
                name_map[row["student_id"]] = meta.get("display_name")
            except Exception:
                logger.warning("Failed to parse student metadata JSON for student=%s", row["student_id"])
                name_map[row["student_id"]] = None

        # Get active subjects per student
        cursor.execute("""
            SELECT DISTINCT student_id, subject FROM attempts
            UNION
            SELECT DISTINCT student_id, subject FROM topic_metadata
            UNION
            SELECT DISTINCT student_id, subject FROM diagnostic_status
            UNION
            SELECT DISTINCT student_id, subject FROM student_subject_metadata
            ORDER BY student_id
        """)
        subject_map: dict[str, list[str]] = {}
        for row in cursor.fetchall():
            sid = row["student_id"]
            subj = row["subject"]
            if subj == PROFILE_SUBJECT:
                continue
            subject_map.setdefault(sid, []).append(subj)

        result = []
        for sid in all_ids:
            subs = subject_map.get(sid, [])
            result.append({
                "student_id": sid,
                "display_name": name_map.get(sid),
                "subjects": subs,
            })
        return result
    finally:
        conn.close()


def delete_student_data(student_id: str) -> None:
    """Remove all persisted data for one validated student UUID."""
    if not UUID_V4_PATTERN.fullmatch(student_id):
        raise ValueError("Deletion target must be a valid student UUID v4")

    log_root = LOG_ROOT.resolve()
    student_dir = (log_root / student_id).resolve()
    if student_dir.parent != log_root:
        raise ValueError("Student deletion path escaped the log root")

    with student_lifecycle_lock(student_id):
        conn = _get_db_connection()
        try:
            # The tombstone and deletes share one writer transaction. A
            # concurrent DB writer either commits first and is deleted, or its
            # later INSERT is rejected by the schema triggers above.
            conn.execute(
                "INSERT OR REPLACE INTO deleted_students (student_id, deleted_at) VALUES (?, ?)",
                (student_id, datetime.now(timezone.utc).isoformat()),
            )
            conn.execute("DELETE FROM mistake_state_topics WHERE student_id = ?", (student_id,))
            conn.execute("DELETE FROM mistake_state WHERE student_id = ?", (student_id,))
            conn.execute("DELETE FROM attempts WHERE student_id = ?", (student_id,))
            conn.execute("DELETE FROM topic_metadata WHERE student_id = ?", (student_id,))
            conn.execute("DELETE FROM diagnostic_status WHERE student_id = ?", (student_id,))
            conn.execute("DELETE FROM weekly_reflections WHERE student_id = ?", (student_id,))
            conn.execute("DELETE FROM student_subject_metadata WHERE student_id = ?", (student_id,))
            conn.commit()
        finally:
            conn.close()

        cleanup_errors: list[Exception] = []
        try:
            try:
                from backend.routers.auth import remove_credentials_for_student
                remove_credentials_for_student(student_id)
            except Exception as exc:
                cleanup_errors.append(exc)
                logger.exception("Failed to remove credentials for deleted student %s", student_id)

            try:
                if student_dir.exists() and student_dir.is_dir():
                    import shutil
                    shutil.rmtree(student_dir)
            except Exception as exc:
                cleanup_errors.append(exc)
                logger.exception("Failed to remove files for deleted student %s", student_id)
        finally:
            # Runtime invalidation must happen even when credential or filesystem
            # cleanup fails after the irreversible database commit.
            with _ENGINES_GUARD:
                keys_to_delete = [k for k in list(_ENGINES.keys()) if k[0] == student_id]
                for key in keys_to_delete:
                    del _ENGINES[key]
            _LOCKS.discard_student(student_id)

            invalidators = []
            try:
                from backend.routers.tutor import invalidate_mistakes_cache
                invalidators.append(invalidate_mistakes_cache)
            except Exception as exc:
                cleanup_errors.append(exc)
            try:
                from backend.tutor_engine import invalidate_error_pattern_state
                invalidators.append(invalidate_error_pattern_state)
            except Exception as exc:
                cleanup_errors.append(exc)
            for invalidate in invalidators:
                try:
                    invalidate(student_id)
                except Exception as exc:
                    cleanup_errors.append(exc)
                    logger.exception("Failed runtime invalidation for student %s", student_id)
            try:
                from backend.rate_limiter import _RATE_LIMITER
                _RATE_LIMITER.discard_student(student_id)
            except Exception as exc:
                cleanup_errors.append(exc)
                logger.exception("Failed rate-limit cleanup for student %s", student_id)

        if cleanup_errors:
            raise RuntimeError(
                "Student data was deleted, but ancillary cleanup was incomplete"
            ) from cleanup_errors[0]
