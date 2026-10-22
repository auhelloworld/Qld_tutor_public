#!/usr/bin/env python3
"""Explicit one-time import of legacy per-student JSON logs into SQLite.

Runtime requests never inspect JSON logs. Operators upgrading an installation
that still has ``data/logs/<student_id>/<subject>_log.json`` files must run this
command before starting the new version::

    backend/venv/bin/python -m backend.migrate_legacy_json_to_sqlite --dry-run
    backend/venv/bin/python -m backend.migrate_legacy_json_to_sqlite

The import is idempotent because the runtime SQLite schema enforces the same
attempt identity used by :class:`backend.rules.StudyRuleEngine`.
"""
from __future__ import annotations

import argparse
import json
import logging
from dataclasses import dataclass
from pathlib import Path

import backend.rules as rules
from backend.subject_registry import is_known_subject

LOG = logging.getLogger("migrate_legacy_json_to_sqlite")
DEFAULT_LOG_ROOT = Path(__file__).resolve().parents[1] / "data" / "logs"


@dataclass(frozen=True)
class ImportResult:
    source: Path
    student_id: str
    subject: str
    source_attempt_rows: int
    inserted_rows: int
    dry_run: bool


def _identity(source: Path, payload: dict, log_root: Path) -> tuple[str, str]:
    subject = source.stem.removesuffix("_log").strip().lower()
    if not is_known_subject(subject):
        raise ValueError(f"Unsupported legacy subject {subject!r}")
    student_id = str(payload.get("student_id") or "").strip()
    if not student_id and source.parent != log_root:
        student_id = source.parent.name.strip()
    if not student_id:
        raise ValueError("Legacy log has no student_id")
    return student_id, subject


def _attempt_count(payload: dict) -> int:
    return sum(
        len(topic_data.get("attempts", []))
        for topic_data in payload.get("topics", {}).values()
        if isinstance(topic_data, dict)
    )


def import_file(source: Path, *, log_root: Path, dry_run: bool = False) -> ImportResult:
    """Validate and import one legacy log, returning row-count evidence."""
    payload = json.loads(source.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Legacy log root must be a JSON object")
    student_id, subject = _identity(source, payload, log_root)
    payload = dict(payload)
    payload["student_id"] = student_id
    source_rows = _attempt_count(payload)
    if dry_run:
        return ImportResult(source, student_id, subject, source_rows, 0, True)

    previous_root = rules.LOG_ROOT
    rules.LOG_ROOT = log_root
    try:
        engine = rules.StudyRuleEngine(student_id=student_id, subject=subject)
        conn = rules.connect_sqlite(str(engine._db_path))
        try:
            before = conn.execute(
                "SELECT COUNT(*) FROM attempts WHERE student_id = ? AND subject = ?",
                (student_id, subject),
            ).fetchone()[0]
        finally:
            conn.close()
        engine.save_log(payload)
        conn = rules.connect_sqlite(str(engine._db_path))
        try:
            after = conn.execute(
                "SELECT COUNT(*) FROM attempts WHERE student_id = ? AND subject = ?",
                (student_id, subject),
            ).fetchone()[0]
        finally:
            conn.close()
    finally:
        rules.LOG_ROOT = previous_root

    return ImportResult(source, student_id, subject, source_rows, after - before, False)


def discover_logs(log_root: Path) -> list[Path]:
    """Return only recognised StudyRuleEngine logs, excluding Writing/PSMT JSON."""
    candidates = [path for path in log_root.rglob("*_log.json") if path.is_file()]
    return sorted(
        path
        for path in candidates
        if is_known_subject(path.stem.removesuffix("_log").strip().lower())
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Import legacy per-student JSON learning logs into qld_tutor.db."
    )
    parser.add_argument("--logs-root", type=Path, default=DEFAULT_LOG_ROOT)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    args = parse_args()
    log_root = args.logs_root.resolve()
    files = discover_logs(log_root) if log_root.exists() else []
    if not files:
        LOG.info("No legacy StudyRuleEngine JSON logs found at %s", log_root)
        return 0

    imported = 0
    inserted = 0
    failures = 0
    for source in files:
        try:
            result = import_file(source, log_root=log_root, dry_run=args.dry_run)
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            failures += 1
            LOG.error("FAILED %s: %s", source, exc)
            continue
        imported += 1
        inserted += result.inserted_rows
        LOG.info(
            "%s student=%s subject=%s source_rows=%d inserted=%d%s",
            source,
            result.student_id,
            result.subject,
            result.source_attempt_rows,
            result.inserted_rows,
            " dry-run" if result.dry_run else "",
        )

    LOG.info(
        "Summary: files=%d imported=%d inserted_rows=%d failures=%d",
        len(files),
        imported,
        inserted,
        failures,
    )
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
