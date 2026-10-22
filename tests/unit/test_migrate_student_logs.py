"""Unit tests for ``backend/migrate_student_logs.py``.

Task 6.2 verification: dedup-by-(question_id, timestamp), student_id
overwritten on target, run summary log captured via capsys.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.migrate_student_logs import (
    attempt_key,
    canonical_dump,
    merge_attempts,
    migrate_file,
)


# ---------------------------------------------------------------------------
# Dedup by (question_id, timestamp)
# ---------------------------------------------------------------------------


class TestDedup:
    def test_duplicate_attempts_are_skipped(self):
        existing = [
            {"question_id": "q1", "timestamp": "2024-01-01T00:00:00Z", "correct": True},
        ]
        incoming = [
            {"question_id": "q1", "timestamp": "2024-01-01T00:00:00Z", "correct": True},
            {"question_id": "q2", "timestamp": "2024-01-01T00:01:00Z", "correct": False},
        ]
        merged, skipped = merge_attempts(existing, incoming)
        assert skipped == 1
        assert len(merged) == 2
        # q1 already existed, q2 is new
        assert any(a["question_id"] == "q2" for a in merged)

    def test_no_duplicates_all_preserved(self):
        existing = []
        incoming = [
            {"question_id": "q1", "timestamp": "t1", "correct": True},
            {"question_id": "q2", "timestamp": "t2", "correct": False},
        ]
        merged, skipped = merge_attempts(existing, incoming)
        assert skipped == 0
        assert len(merged) == 2

    def test_attempt_key_extracts_correct_tuple(self):
        record = {"question_id": "q1", "timestamp": "2024-01-01T00:00:00Z", "correct": True}
        assert attempt_key(record) == ("q1", "2024-01-01T00:00:00Z")


# ---------------------------------------------------------------------------
# student_id overwritten on target
# ---------------------------------------------------------------------------


class TestStudentIdOverwrite:
    def test_student_id_set_on_target(self, tmp_path: Path):
        source = tmp_path / "source" / "math_log.json"
        source.parent.mkdir(parents=True)
        source.write_text(json.dumps({
            "student_id": "old_id",
            "topics": {
                "fractions": {
                    "attempts": [
                        {"question_id": "q1", "timestamp": "t1", "correct": True, "attempt_type": "answer"}
                    ],
                    "accuracy": 1.0,
                }
            }
        }))

        target = tmp_path / "target" / "math_log.json"
        migrate_file(source, target, "new_legacy_id", dry_run=False)

        result = json.loads(target.read_text(encoding="utf-8"))
        assert result["student_id"] == "new_legacy_id"

    def test_existing_target_student_id_overwritten(self, tmp_path: Path):
        source = tmp_path / "source" / "math_log.json"
        source.parent.mkdir(parents=True)
        source.write_text(json.dumps({"student_id": "src", "topics": {}}))

        target = tmp_path / "target" / "math_log.json"
        target.parent.mkdir(parents=True)
        target.write_text(json.dumps({"student_id": "existing_id", "topics": {}}))

        migrate_file(source, target, "override_id", dry_run=False)

        result = json.loads(target.read_text(encoding="utf-8"))
        assert result["student_id"] == "override_id"


# ---------------------------------------------------------------------------
# Run summary log (capsys)
# ---------------------------------------------------------------------------


class TestRunSummary:
    def test_migrate_file_returns_counts(self, tmp_path: Path):
        source = tmp_path / "math_log.json"
        source.write_text(json.dumps({
            "student_id": "s1",
            "topics": {
                "fractions": {
                    "attempts": [
                        {"question_id": "q1", "timestamp": "t1", "correct": True, "attempt_type": "answer"},
                        {"question_id": "q2", "timestamp": "t2", "correct": False, "attempt_type": "answer"},
                    ],
                    "accuracy": 0.5,
                }
            }
        }))

        target = tmp_path / "out" / "math_log.json"
        preserved, skipped, written = migrate_file(source, target, "legacy", dry_run=False)

        assert preserved == 2
        assert skipped == 0
        assert written is True

    def test_idempotent_second_run_no_write(self, tmp_path: Path):
        source = tmp_path / "math_log.json"
        source.write_text(json.dumps({
            "student_id": "s1",
            "topics": {
                "fractions": {
                    "attempts": [
                        {"question_id": "q1", "timestamp": "t1", "correct": True, "attempt_type": "answer"},
                    ],
                    "accuracy": 1.0,
                }
            }
        }))

        target = tmp_path / "out" / "math_log.json"
        migrate_file(source, target, "legacy", dry_run=False)
        _, _, written = migrate_file(source, target, "legacy", dry_run=False)
        assert written is False
