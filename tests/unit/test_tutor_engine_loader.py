from __future__ import annotations

import json

from backend.tutor_engine import TutorEngine, _runtime_exercise_validation_error


_REAL_LOAD_EXERCISES_FROM_DISK = TutorEngine._load_exercises_from_disk


def _valid_exercise() -> dict:
    return {
        "id": "runtime_valid_001",
        "topic": "AC9M7N04",
        "question": "Simplify 18/24.",
        "answer": "3/4",
        "steps": ["Divide by the greatest common factor."],
        "framework": "AC9_MATHS",
        "topic_ids": ["AC9M7N04"],
        "subject": "math",
        "difficulty": "developing",
        "year_level": 7,
        "question_type": "short_answer",
        "complexity": "simple_familiar",
    }


def test_runtime_loader_accepts_a_canonical_active_record():
    assert _runtime_exercise_validation_error(_valid_exercise()) is None


def test_runtime_loader_reports_malformed_active_record():
    malformed = {
        **_valid_exercise(),
        "question_type": "multiple_choice",
        "choices": ["A"],
        "correct_choice": "A",
    }

    error = _runtime_exercise_validation_error(malformed)

    assert error is not None
    assert "choices" in error


def test_runtime_loader_quarantines_all_invalid_active_records_and_reports_ids(tmp_path):
    malformed = {
        **_valid_exercise(),
        "id": "runtime_invalid_mc",
        "question_type": "multiple_choice",
        "choices": ["A"],
        "correct_choice": "A",
    }
    missing_id = _valid_exercise()
    missing_id.pop("id")
    records = [
        _valid_exercise(),
        malformed,
        missing_id,
        "not-an-object",
        {"status": "draft", "question": "Unvalidated draft"},
    ]
    bank_path = tmp_path / "exercise_runtime.json"
    bank_path.write_text(json.dumps(records), encoding="utf-8")

    engine = object.__new__(TutorEngine)
    engine._data_dir = tmp_path
    stats = _REAL_LOAD_EXERCISES_FROM_DISK(engine)

    assert list(engine.exercises) == ["runtime_valid_001"]
    expected_ids = [
        "runtime_invalid_mc",
        "exercise_runtime.json#2",
        "exercise_runtime.json#3",
    ]
    assert engine.runtime_validation_report() == {
        "skipped_invalid_count": 3,
        "skipped_invalid_ids": expected_ids,
        "invalid_bank_file_count": 0,
        "invalid_bank_files": [],
    }
    assert stats["skipped_invalid_count"] == 3
    assert stats["runtime_validation"]["skipped_invalid_ids"] == expected_ids
    assert engine.content_availability()["runtime_validation"] == stats["runtime_validation"]


def test_runtime_loader_reports_an_unreadable_bank_file(tmp_path, caplog):
    (tmp_path / "exercise_broken.json").write_text("[{not valid json", encoding="utf-8")
    (tmp_path / "exercise_wrong_shape.json").write_text('{"items": []}', encoding="utf-8")

    engine = object.__new__(TutorEngine)
    engine._data_dir = tmp_path
    stats = _REAL_LOAD_EXERCISES_FROM_DISK(engine)

    report = engine.runtime_validation_report()
    assert report["invalid_bank_file_count"] == 2
    assert report["invalid_bank_files"] == [
        "exercise_broken.json",
        "exercise_wrong_shape.json",
    ]
    assert stats["invalid_bank_file_count"] == 2
    assert "Unable to load exercise bank exercise_broken.json" in caplog.text
    assert "root is not a JSON array" in caplog.text
