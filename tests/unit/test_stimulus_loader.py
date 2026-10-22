"""Tests for the sidecar stimulus loader (Audit Packet 2.1)."""
from __future__ import annotations

import json
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

from backend.content_authoring.stimulus_loader import (
    extract_inline_passage,
    enrich_exercise,
    get_stimulus_record,
    get_stimulus_text,
    is_stimulus_id,
    reload_stimuli,
    resolve_passage,
    StimulusValidationError,
)


class TestStimulusIdDetection:
    def test_valid_ids(self):
        assert is_stimulus_id("ST-reading01")
        assert is_stimulus_id("ST-naplan_2024")
        assert is_stimulus_id("ST-A1B2C3")

    def test_invalid_ids(self):
        assert not is_stimulus_id("Some passage text here")
        assert not is_stimulus_id("")
        assert not is_stimulus_id("ST-")  # empty suffix


class TestExtractInlinePassage:
    def test_extracts_passage_block(self):
        question = (
            "**Passage:**\n"
            "The old house stood at the end of the lane.\n"
            "Its windows were dark and shuttered.\n\n"
            "**Question:**\n"
            "What mood does the description create?"
        )
        result = extract_inline_passage(question)
        assert "old house" in result
        assert "shuttered" in result
        assert "Question" not in result

    def test_returns_none_when_no_passage(self):
        assert extract_inline_passage("What is 2+2?") is None


class TestResolvePassage:
    def setup_method(self):
        reload_stimuli()

    def teardown_method(self):
        reload_stimuli()

    @staticmethod
    def _structured_sidecar() -> dict:
        return {
            "schema_version": 2,
            "subject": "english",
            "year_level": 7,
            "description": "Structured Year 7 English reading/viewing stimuli.",
            "stimuli": {
                "ST-cat01": {
                    "id": "ST-cat01",
                    "title": "The Cat",
                    "stimulus_type": "literary_extract",
                    "year_level": 7,
                    "curriculum_links": ["AC9E7LY05"],
                    "naplan_alignment": ["reading"],
                    "purpose": "Engage readers through a simple narrative moment.",
                    "student_display": {
                        "render_mode": "plain_text",
                        "plain_text": "The cat sat on the mat.",
                    },
                    "texts": [
                        {
                            "role": "extract",
                            "content": "The cat sat on the mat.",
                            "effect": "Establishes a clear action for comprehension.",
                        }
                    ],
                    "analysis_targets": ["main_idea", "text_evidence"],
                    "accessibility": {"alt_text": "Short passage about a cat sitting on a mat."},
                }
            },
        }

    def test_inline_passage_in_metadata(self):
        exercise = {
            "id": "test_1",
            "english_metadata": {"passage": "The cat sat on the mat."},
            "question": "What did the cat do?",
        }
        assert resolve_passage(exercise) == "The cat sat on the mat."

    def test_sidecar_resolution_uses_structured_plain_text(self, tmp_path):
        sidecar = self._structured_sidecar()
        sidecar_path = tmp_path / "english_stimuli.json"
        sidecar_path.write_text(json.dumps(sidecar), encoding="utf-8")

        with patch(
            "backend.content_authoring.stimulus_loader._STIMULI_FILE",
            sidecar_path,
        ):
            reload_stimuli()
            exercise = {
                "id": "test_2",
                "english_metadata": {"passage": "ST-cat01"},
                "question": "What happened?",
            }
            assert resolve_passage(exercise) == "The cat sat on the mat."

    def test_get_stimulus_record_returns_structured_record(self, tmp_path):
        sidecar = self._structured_sidecar()
        sidecar_path = tmp_path / "english_stimuli.json"
        sidecar_path.write_text(json.dumps(sidecar), encoding="utf-8")

        with patch(
            "backend.content_authoring.stimulus_loader._STIMULI_FILE",
            sidecar_path,
        ):
            reload_stimuli()
            record = get_stimulus_record("ST-cat01")
            assert record is not None
            assert record["title"] == "The Cat"
            assert get_stimulus_text("ST-cat01") == "The cat sat on the mat."

    def test_old_string_sidecar_records_are_invalid(self, tmp_path):
        sidecar = {
            "schema_version": 2,
            "subject": "english",
            "year_level": 7,
            "stimuli": {"ST-cat01": "The cat sat on the mat."},
        }
        sidecar_path = tmp_path / "english_stimuli.json"
        sidecar_path.write_text(json.dumps(sidecar), encoding="utf-8")

        with patch(
            "backend.content_authoring.stimulus_loader._STIMULI_FILE",
            sidecar_path,
        ):
            reload_stimuli()
            with pytest.raises(StimulusValidationError, match="must be an object"):
                get_stimulus_text("ST-cat01")

    def test_missing_student_display_plain_text_is_invalid(self, tmp_path):
        sidecar = self._structured_sidecar()
        del sidecar["stimuli"]["ST-cat01"]["student_display"]
        sidecar_path = tmp_path / "english_stimuli.json"
        sidecar_path.write_text(json.dumps(sidecar), encoding="utf-8")

        with patch(
            "backend.content_authoring.stimulus_loader._STIMULI_FILE",
            sidecar_path,
        ):
            reload_stimuli()
            with pytest.raises(StimulusValidationError, match="student_display"):
                get_stimulus_text("ST-cat01")

    def test_data_descriptions_require_data_elements(self, tmp_path):
        sidecar = self._structured_sidecar()
        record = sidecar["stimuli"]["ST-cat01"]
        record["stimulus_type"] = "campaign_poster"
        record["student_display"]["plain_text"] = "The poster includes a line graph of habitat loss."
        record["visual_elements"] = [
            {
                "type": "photograph_description",
                "content": "A cat beside a highlighted conservation area.",
                "effect": "Creates emotional appeal.",
            }
        ]
        record["layout_features"] = [
            {
                "feature": "salience",
                "content": "The graph is placed beside the call-to-action.",
                "effect": "Connects evidence to action.",
            }
        ]
        sidecar_path = tmp_path / "english_stimuli.json"
        sidecar_path.write_text(json.dumps(sidecar), encoding="utf-8")

        with patch(
            "backend.content_authoring.stimulus_loader._STIMULI_FILE",
            sidecar_path,
        ):
            reload_stimuli()
            with pytest.raises(StimulusValidationError, match="data_elements"):
                get_stimulus_text("ST-cat01")

    def test_fallback_to_question_body(self):
        exercise = {
            "id": "test_3",
            "english_metadata": {},
            "question": (
                "**Passage:**\n"
                "Dogs are loyal companions.\n\n"
                "**Question:**\n"
                "Why are dogs valued?"
            ),
        }
        result = resolve_passage(exercise)
        assert "loyal companions" in result

    def test_embedded_micro_text_suppresses_legacy_sidecar_reference(self):
        exercise = {
            "id": "test_embedded_micro_text",
            "english_metadata": {
                "passage": "ST-EN-Y10-04",
                "passage_mode": "stimulus",
            },
            "question": (
                "Use this micro-text for a Year 10 analysis: "
                "The narrator says, 'I will not call fear wisdom.'"
            ),
        }
        assert resolve_passage(exercise) is None

    def test_returns_none_when_no_passage(self):
        exercise = {
            "id": "test_4",
            "english_metadata": {},
            "question": "What is the plural of 'mouse'?",
        }
        assert resolve_passage(exercise) is None


class TestEnrichExercise:
    def test_injects_resolved_passage(self):
        exercise = {
            "id": "test_5",
            "english_metadata": {"passage": "Inline passage."},
            "question": "Q?",
        }
        enriched = enrich_exercise(exercise)
        assert enriched["resolved_passage"] == "Inline passage."
        # Original not mutated
        assert "resolved_passage" not in exercise
