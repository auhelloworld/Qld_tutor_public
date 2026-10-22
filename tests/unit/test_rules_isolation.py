"""Verification gate for Task 5 — per-student engine isolation.

Tests:
- get_engine(s1, "math") is get_engine(s1, "math") — same instance.
- get_engine(s1, "math") is not get_engine(s2, "math") — distinct.
- get_engine(s1, "math") is not get_engine(s1, "english") — distinct.
- After construction, SQLite exists and no legacy JSON is created.
- backend.rules.rule_engine raises AttributeError.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from backend._testing import reset_engine_factory_cache


@pytest.fixture(autouse=True)
def _isolate(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Reset engine cache and redirect LOG_ROOT to tmp_path for isolation."""
    reset_engine_factory_cache()
    monkeypatch.setattr("backend.rules.LOG_ROOT", tmp_path / "logs")
    yield
    reset_engine_factory_cache()


def test_same_student_same_subject_returns_same_instance(tmp_path):
    from backend.rules import get_engine

    e1 = get_engine("student-aaa", "math")
    e2 = get_engine("student-aaa", "math")
    assert e1 is e2


def test_different_students_return_distinct_instances(tmp_path):
    from backend.rules import get_engine

    e1 = get_engine("student-aaa", "math")
    e2 = get_engine("student-bbb", "math")
    assert e1 is not e2


def test_same_student_different_subjects_return_distinct_instances(tmp_path):
    from backend.rules import get_engine

    e1 = get_engine("student-aaa", "math")
    e2 = get_engine("student-aaa", "english")
    assert e1 is not e2


def test_sqlite_created_without_legacy_log_on_construction(tmp_path, monkeypatch):
    from backend.rules import get_engine, LOG_ROOT

    engine = get_engine("student-xyz", "math")
    assert engine._db_path.exists()
    assert engine.load_log()["topics"] == {}
    assert not (LOG_ROOT / "student-xyz" / "math_log.json").exists()


def test_module_level_rule_engine_does_not_exist():
    import backend.rules

    with pytest.raises(AttributeError):
        _ = backend.rules.rule_engine

def test_unsafe_subject_cannot_escape_legacy_log_directory(tmp_path, monkeypatch):
    import backend.rules as rules

    rules._ENGINES.clear()
    monkeypatch.setattr(rules, "LOG_ROOT", tmp_path / "logs")
    with pytest.raises(ValueError, match="unsafe storage subject"):
        rules.get_engine("safe-student", "../outside/math")
    assert not (tmp_path / "logs" / "outside" / "math_log.json").exists()
    assert not (tmp_path / "outside" / "math_log.json").exists()
