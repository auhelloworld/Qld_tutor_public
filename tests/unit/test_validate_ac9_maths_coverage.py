"""Unit tests for backend.content_authoring.validate_ac9_maths_coverage."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.content_authoring.validate_ac9_maths_coverage import (
    _check_year,
    _load_slice,
    CORE_RULE_LEN_MIN,
    CORE_RULE_LEN_MAX,
    EXERCISES_PER_TOPIC_MIN,
)


# ---------------------------------------------------------------------------
# _load_slice
# ---------------------------------------------------------------------------


class TestLoadSlice:
    def test_year7_loads_successfully(self):
        """Year 7 slice exists and validates."""
        slice_file, err = _load_slice(7)
        assert err is None
        assert slice_file is not None
        assert len(slice_file.topics) == 30

    def test_year8_loads_successfully(self):
        """Year 8 slice exists and validates."""
        slice_file, err = _load_slice(8)
        assert err is None
        assert slice_file is not None
        assert len(slice_file.topics) == 27

    def test_year9_loads_successfully(self):
        """Year 9 slice exists and validates."""
        slice_file, err = _load_slice(9)
        assert err is None
        assert slice_file is not None
        assert len(slice_file.topics) == 23

    def test_nonexistent_year_returns_error(self):
        """Year 11 doesn't exist."""
        slice_file, err = _load_slice(11)
        assert slice_file is None
        assert "does not exist" in err


# ---------------------------------------------------------------------------
# _check_year — gap detection
# ---------------------------------------------------------------------------


class TestCheckYear:
    def test_year7_reports_concept_card_gaps(self, monkeypatch):
        """Year 7 currently has empty concept_cards — should report gaps."""
        from backend.content_authoring import validate_ac9_maths_coverage
        original_load = validate_ac9_maths_coverage._load_slice

        def mock_load_slice(year: int):
            slice_file, err = original_load(year)
            if slice_file:
                for topic in slice_file.topics:
                    topic.concept_card.core_rule = ""
                    topic.concept_card.hint_levels = []
                    topic.concept_card.worked_example = None
            return slice_file, err

        monkeypatch.setattr(validate_ac9_maths_coverage, "_load_slice", mock_load_slice)
        gaps = _check_year(7, {}, [])
        # Every topic should have a core_rule gap
        core_rule_gaps = [g for g in gaps if "core_rule" in g]
        assert len(core_rule_gaps) >= 30  # one per topic

    def test_year7_reports_exercise_gaps(self):
        """With no exercises passed, every topic should report exercise gaps."""
        gaps = _check_year(7, {}, [])
        exercise_gaps = [g for g in gaps if "exercises" in g]
        # Most topics have 0 exercises when we pass an empty dict
        assert len(exercise_gaps) >= 20

    def test_year9_empty_slice_reports_zero_topics(self, monkeypatch):
        """Year 9 is an empty shell — should report that."""
        from backend.content_authoring import validate_ac9_maths_coverage
        from core.schema.curriculum_schema import FrameworkSliceFile

        def mock_load_slice(year: int):
            return FrameworkSliceFile(
                framework_id="AC9_MATHS",
                sequence={"is_strict": False, "prerequisites": {}, "sequence": []},
                topics=[]
            ), None

        monkeypatch.setattr(validate_ac9_maths_coverage, "_load_slice", mock_load_slice)
        gaps = _check_year(9, {}, [])
        assert any("0 topics" in g for g in gaps)

    def test_year7_reports_misconception_gaps(self):
        """With no misconceptions passed, should report strand gaps."""
        gaps = _check_year(7, {}, [])
        misc_gaps = [g for g in gaps if "misconception" in g.lower()]
        assert len(misc_gaps) >= 1

    def test_summary_line_present(self):
        """Every year check includes a topic coverage summary line."""
        gaps = _check_year(7, {}, [])
        summary = [g for g in gaps if "topic coverage:" in g]
        assert len(summary) == 1
        assert "0/30" in summary[0]  # zero topics meet quota currently


class TestLoadExercises:
    def test_load_exercises_returns_no_errors_on_production_data(self):
        """Production database has zero validation errors."""
        from backend.content_authoring.validate_ac9_maths_coverage import _load_exercises
        by_topic, errors = _load_exercises()
        assert len(errors) == 0
        assert len(by_topic) > 0
