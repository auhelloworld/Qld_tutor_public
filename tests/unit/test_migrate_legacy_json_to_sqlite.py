from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend._testing import reset_engine_factory_cache
from backend.migrate_legacy_json_to_sqlite import discover_logs, import_file


@pytest.fixture(autouse=True)
def _reset_cache():
    reset_engine_factory_cache()
    yield
    reset_engine_factory_cache()


def _legacy_log(log_root: Path, student_id: str = "legacy-student") -> Path:
    source = log_root / student_id / "math_log.json"
    source.parent.mkdir(parents=True)
    source.write_text(
        json.dumps(
            {
                "student_id": student_id,
                "settings": {"daily_goal": 12},
                "topics": {
                    "AC9M7N01": {
                        "accuracy": 1.0,
                        "attempts": [
                            {
                                "attempt_id": "legacy-a1",
                                "question_id": "legacy-q1",
                                "correct": True,
                                "outcome": "correct",
                                "timestamp": "2026-01-01T00:00:00+00:00",
                                "skill_id": "AC9M7N01/legacy-q1",
                                "response_time_ms": 50,
                                "attempt_type": "answer",
                            }
                        ],
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    return source


def test_runtime_does_not_auto_import_legacy_json(tmp_path, monkeypatch):
    import backend.rules as rules

    log_root = tmp_path / "data" / "logs"
    source = _legacy_log(log_root)
    monkeypatch.setattr(rules, "LOG_ROOT", log_root)

    engine = rules.StudyRuleEngine(student_id="legacy-student", subject="math")

    assert engine.load_log()["topics"] == {}
    assert source.exists()


def test_explicit_import_is_idempotent_and_preserves_source(tmp_path, monkeypatch):
    import backend.rules as rules

    log_root = tmp_path / "data" / "logs"
    source = _legacy_log(log_root)
    monkeypatch.setattr(rules, "LOG_ROOT", log_root)

    first = import_file(source, log_root=log_root)
    second = import_file(source, log_root=log_root)
    engine = rules.StudyRuleEngine(student_id="legacy-student", subject="math")
    data = engine.load_log(topics=["AC9M7N01"])

    assert first.source_attempt_rows == 1
    assert first.inserted_rows == 1
    assert second.inserted_rows == 0
    assert data["topics"]["AC9M7N01"]["attempts"][0]["question_id"] == "legacy-q1"
    assert engine.get_extra_metadata()["settings"]["daily_goal"] == 12
    assert source.exists()


def test_dry_run_validates_without_creating_database(tmp_path):
    log_root = tmp_path / "data" / "logs"
    source = _legacy_log(log_root)

    result = import_file(source, log_root=log_root, dry_run=True)

    assert result.dry_run is True
    assert result.source_attempt_rows == 1
    assert result.inserted_rows == 0
    assert not (log_root.parent / "qld_tutor.db").exists()


def test_discovery_excludes_feature_specific_json_logs(tmp_path):
    log_root = tmp_path / "data" / "logs"
    source = _legacy_log(log_root)
    writing = source.parent / "english_writing_log.json"
    writing.write_text("{}", encoding="utf-8")

    assert discover_logs(log_root) == [source]
