"""Unit tests for exercise bank path mapping."""

from pathlib import Path

import pytest

from backend.services.exercise_bank_paths import (
    BankPathError,
    group_exercises_by_bank,
    normalise_storage_subject,
    resolve_exercise_bank_filename,
    resolve_exercise_bank_path,
)


@pytest.mark.parametrize(
    "subject,year,expected",
    [
        ("math", 7, "exercise_7_math.json"),
        ("english", 8, "exercise_8_english.json"),
        ("science", 9, "exercise_9_science.json"),
        ("math", 10, "exercise_10_math.json"),
        ("mathematics", 7, "exercise_7_math.json"),
    ],
)
def test_junior_bank_filenames(subject, year, expected):
    assert resolve_exercise_bank_filename({
        "id": "x",
        "subject": subject,
        "year_level": year,
    }) == expected


@pytest.mark.parametrize(
    "subject,unit,expected",
    [
        ("methods", 1, "exercise_methods_u1_u2.json"),
        ("methods", 2, "exercise_methods_u1_u2.json"),
        ("methods", 3, "exercise_methods_u3_u4.json"),
        ("methods", 4, "exercise_methods_u3_u4.json"),
        ("general", 1, "exercise_general_u1_u2.json"),
        ("essential", 4, "exercise_essential_u3_u4.json"),
        ("specialist", 1, "exercise_specialist_u1_u2.json"),
        ("specialist", 4, "exercise_specialist_u3_u4.json"),
        ("chemistry", 1, "exercise_chemistry_u1_u2.json"),
        ("earth_environmental_science", 3, "exercise_earth_environmental_science_u3_u4.json"),
        ("english", 1, "exercise_english_u1_u2.json"),
        ("literature_extension", 4, "exercise_literature_extension_u3_u4.json"),
    ],
)
def test_senior_unit_bank_filenames(subject, unit, expected):
    assert resolve_exercise_bank_filename({
        "id": "x",
        "subject": subject,
        "unit": unit,
    }) == expected


def test_resolve_path_joins_data_dir(tmp_path: Path):
    path = resolve_exercise_bank_path(
        {"subject": "math", "year_level": 7},
        data_dir=tmp_path,
    )
    assert path == tmp_path / "exercise_7_math.json"


def test_unknown_subject_raises():
    with pytest.raises(BankPathError, match="unsupported subject"):
        resolve_exercise_bank_filename({"subject": "not_registered", "unit": 1})


def test_missing_year_raises():
    with pytest.raises(BankPathError, match="year_level"):
        resolve_exercise_bank_filename({"subject": "math"})


def test_group_exercises_by_bank():
    items = [
        {"id": "a", "subject": "math", "year_level": 7},
        {"id": "b", "subject": "methods", "unit": 1},
        {"id": "c", "subject": "unknown"},
    ]
    grouped, unmapped = group_exercises_by_bank(items)
    assert set(grouped) == {"exercise_7_math.json", "exercise_methods_u1_u2.json"}
    assert len(grouped["exercise_7_math.json"]) == 1
    assert len(unmapped) == 1
    assert unmapped[0]["id"] == "c"


def test_normalise_storage_subject():
    assert normalise_storage_subject("Mathematics") == "math"
    assert normalise_storage_subject("methods") == "methods"
