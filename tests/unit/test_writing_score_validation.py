"""Unit tests for strict writing score parsing and canonical criteria validation.

Enforces invariants from WR-01 and WR-02:
- No clamping, no NaN/Inf/bool, no non-integer floats unless supported.
- Fraction strings require valid integer numerator and denominator matching max_score.
- Criterion identity requires exact number/name consistency, no duplicates, non-empty feedback.
"""
from __future__ import annotations

import math
import pytest

from backend.routers.writing import (
    _parse_score_value,
    validate_and_canonicalise_writing_scores,
)
from core.schema.writing_schema import (
    NAPLAN_PERSUASIVE_CRITERIA,
    ISMG_ANALYTICAL_CRITERIA,
)


# ---------------------------------------------------------------------------
# WR-01: _parse_score_value Parameterized Tests
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    ("raw_input", "max_score", "expected"),
    [
        # Valid integer values
        (0, 4, 0),
        (4, 4, 4),
        (2, 6, 2),
        ("0", 4, 0),
        ("4", 4, 4),
        (" 3 ", 4, 3),
        # Valid integer-valued floats
        (4.0, 4, 4),
        ("4.0", 4, 4),
        ("0.0", 4, 0),
        # Valid fraction strings matching canonical max_score
        ("3/4", 4, 3),
        (" 3 / 4 ", 4, 3),
        ("0/4", 4, 0),
        ("4/4", 4, 4),
        ("6/6", 6, 6),
        ("5/9", 9, 5),
    ],
)
def test_parse_score_value_accepts_valid_inputs(raw_input, max_score, expected):
    assert _parse_score_value(raw_input, max_score) == expected


@pytest.mark.parametrize(
    ("raw_input", "max_score"),
    [
        # Out of range (must NOT clamp)
        (99, 4),
        (-1, 4),
        ("-1", 4),
        ("100", 4),
        (5, 4),
        # Invalid fractions (wrong denominator, div by zero, out of range)
        ("3/0", 4),
        ("3/999", 4),
        ("3/5", 4),
        ("5/4", 4),
        ("-1/4", 4),
        ("3/4/5", 4),
        # Non-integer floats
        (3.5, 4),
        ("3.5", 4),
        ("2.1", 4),
        # Special float / bool / None / empty
        (True, 4),
        (False, 4),
        (None, 4),
        (math.nan, 4),
        (math.inf, 4),
        (-math.inf, 4),
        ("", 4),
        ("   ", 4),
        # Fuzzy text (must NOT fuzzy extract)
        ("score: 3", 4),
        ("3 marks", 4),
        ("3 out of 4", 4),
        ("Grade 4", 4),
    ],
)
def test_parse_score_value_rejects_invalid_inputs(raw_input, max_score):
    assert _parse_score_value(raw_input, max_score) is None


# ---------------------------------------------------------------------------
# WR-02: validate_and_canonicalise_writing_scores Tests
# ---------------------------------------------------------------------------

def _valid_persuasive_scores():
    return [
        {"number": 1, "name": "Audience", "score": 4, "feedback": "Clear sense of audience."},
        {"number": 2, "name": "Text Structure", "score": 3, "feedback": "Well-structured argument."},
        {"number": 3, "name": "Ideas", "score": 4, "feedback": "Compelling ideas presented."},
        {"number": 4, "name": "Persuasive Devices", "score": 3, "feedback": "Effective rhetorical questions."},
        {"number": 5, "name": "Vocabulary", "score": 4, "feedback": "Sophisticated vocabulary choices."},
        {"number": 6, "name": "Cohesion", "score": 3, "feedback": "Smooth transitions throughout."},
        {"number": 7, "name": "Paragraphing", "score": 2, "feedback": "Clear paragraph divisions."},
        {"number": 8, "name": "Sentence Structure", "score": 5, "feedback": "Good variety of sentence forms."},
        {"number": 9, "name": "Punctuation", "score": 4, "feedback": "Accurate punctuation used."},
        {"number": 10, "name": "Spelling", "score": 5, "feedback": "High accuracy in complex words."},
    ]


def test_validate_scores_happy_path():
    raw = _valid_persuasive_scores()
    result = validate_and_canonicalise_writing_scores(raw, year_level=7, prompt_type="persuasive")
    assert len(result) == 10
    assert result[0].criterion_number == 1
    assert result[0].name == "Audience"
    assert result[0].score == 4
    assert result[0].max_score == 6
    assert result[0].feedback == "Clear sense of audience."


def test_validate_scores_number_only():
    raw = [
        {"number": item["number"], "score": item["score"], "feedback": item["feedback"]}
        for item in _valid_persuasive_scores()
    ]
    result = validate_and_canonicalise_writing_scores(raw, year_level=7, prompt_type="persuasive")
    assert len(result) == 10
    assert result[0].name == "Audience"


def test_validate_scores_name_only():
    raw = [
        {"name": item["name"], "score": item["score"], "feedback": item["feedback"]}
        for item in _valid_persuasive_scores()
    ]
    result = validate_and_canonicalise_writing_scores(raw, year_level=7, prompt_type="persuasive")
    assert len(result) == 10
    assert result[0].criterion_number == 1


def test_validate_scores_alias_keys():
    raw = [
        {"criterionNumber": 1, "criterion": "Audience", "mark": "4/6", "comment": "Good."},
        {"criterionNumber": 2, "criterion": "Text Structure", "mark": 3, "comment": "Good."},
        {"criterionNumber": 3, "criterion": "Ideas", "mark": 4, "comment": "Good."},
        {"criterionNumber": 4, "criterion": "Persuasive Devices", "mark": 3, "comment": "Good."},
        {"criterionNumber": 5, "criterion": "Vocabulary", "mark": 4, "comment": "Good."},
        {"criterionNumber": 6, "criterion": "Cohesion", "mark": 3, "comment": "Good."},
        {"criterionNumber": 7, "criterion": "Paragraphing", "mark": 2, "comment": "Good."},
        {"criterionNumber": 8, "criterion": "Sentence Structure", "mark": 5, "comment": "Good."},
        {"criterionNumber": 9, "criterion": "Punctuation", "mark": 4, "comment": "Good."},
        {"criterionNumber": 10, "criterion": "Spelling", "mark": 5, "comment": "Good."},
    ]
    result = validate_and_canonicalise_writing_scores(raw, year_level=7, prompt_type="persuasive")
    assert len(result) == 10
    assert result[0].score == 4


def test_validate_scores_rejects_number_name_conflict():
    raw = _valid_persuasive_scores()
    # Criterion number 1 is Audience, but name is Spelling (which is 10)
    raw[0]["name"] = "Spelling"
    with pytest.raises(ValueError, match="conflict|mismatch"):
        validate_and_canonicalise_writing_scores(raw, year_level=7, prompt_type="persuasive")


def test_validate_scores_rejects_duplicate_criterion():
    raw = _valid_persuasive_scores()
    # Append a duplicate criterion 1
    raw.append({"number": 1, "name": "Audience", "score": 2, "feedback": "Duplicate item."})
    with pytest.raises(ValueError, match="duplicate|expected 10"):
        validate_and_canonicalise_writing_scores(raw, year_level=7, prompt_type="persuasive")


def test_validate_scores_rejects_missing_criterion():
    raw = _valid_persuasive_scores()[:-1]  # drop criterion 10
    with pytest.raises(ValueError, match="missing|expected 10"):
        validate_and_canonicalise_writing_scores(raw, year_level=7, prompt_type="persuasive")


def test_validate_scores_rejects_empty_feedback():
    raw = _valid_persuasive_scores()
    raw[0]["feedback"] = "   "
    with pytest.raises(ValueError, match="feedback"):
        validate_and_canonicalise_writing_scores(raw, year_level=7, prompt_type="persuasive")


def test_validate_scores_rejects_out_of_bounds_score():
    raw = _valid_persuasive_scores()
    raw[0]["score"] = 99  # max is 6
    with pytest.raises(ValueError, match="invalid score"):
        validate_and_canonicalise_writing_scores(raw, year_level=7, prompt_type="persuasive")


def test_validate_scores_senior_ismg():
    raw = [
        {"number": 1, "name": "Knowledge application", "score": 8, "feedback": "Deep analysis."},
        {"number": 2, "name": "Organisation and development", "score": 7, "feedback": "Clear flow."},
        {"number": 3, "name": "Textual features", "score": 7, "feedback": "Sophisticated style."},
    ]
    result = validate_and_canonicalise_writing_scores(raw, year_level=11, prompt_type="analytical")
    assert len(result) == 3
    assert result[0].domain == "ISMG"
    assert result[0].max_score == 9
