"""Unit tests for core/schema/misconception_schema.py (Task 12.1).

Tests regex validation, enum validation, extra='forbid' rejection.
"""
import pytest
from pydantic import ValidationError

from core.schema.misconception_schema import (
    DetectionSignature,
    MisconceptionRecord,
    Provenance,
    WorkedExampleRecord,
    WorkedExampleStep,
)


class TestProvenance:
    def test_valid_hand_curated(self):
        p = Provenance(
            source="hand_curated",
            approved_by="seed",
            approved_at="2025-01-15T00:00:00+00:00",
        )
        assert p.source == "hand_curated"
        assert p.mined_from_run_id is None

    def test_valid_ai_mined(self):
        p = Provenance(
            source="ai_mined_human_approved",
            approved_by="reviewer",
            approved_at="2025-01-15T00:00:00+00:00",
            mined_from_run_id="abc123",
        )
        assert p.mined_from_run_id == "abc123"

    def test_invalid_source_rejected(self):
        with pytest.raises(ValidationError):
            Provenance(
                source="unknown_source",
                approved_by="x",
                approved_at="2025-01-15T00:00:00+00:00",
            )

    def test_extra_fields_rejected(self):
        with pytest.raises(ValidationError):
            Provenance(
                source="hand_curated",
                approved_by="x",
                approved_at="2025-01-15T00:00:00+00:00",
                extra_field="bad",
            )


class TestDetectionSignature:
    def test_valid_regex(self):
        sig = DetectionSignature(kind="regex", pattern=r"^\d+$")
        assert sig.kind == "regex"

    def test_invalid_regex_rejected(self):
        with pytest.raises(ValidationError):
            DetectionSignature(kind="regex", pattern="[invalid")

    def test_valid_predicate(self):
        sig = DetectionSignature(kind="predicate", pattern="negative_squared")
        assert sig.pattern == "negative_squared"

    def test_valid_numeric(self):
        sig = DetectionSignature(kind="numeric", pattern='{"op": "abs"}')
        assert sig.kind == "numeric"

    def test_invalid_kind_rejected(self):
        with pytest.raises(ValidationError):
            DetectionSignature(kind="invalid_kind", pattern="x")

    def test_extra_fields_rejected(self):
        with pytest.raises(ValidationError):
            DetectionSignature(kind="regex", pattern="^x$", extra="bad")


class TestMisconceptionRecord:
    def _valid_record(self, **overrides):
        base = {
            "misconception_id": "MC_M7N_test_thing_01",
            "name": "Test misconception",
            "description": "A test description",
            "student_facing_explanation": "A student explanation",
            "topic_ids": ["AC9M7N04"],
            "detection_signatures": [],
            "worked_example_ids": [],
            "provenance": {
                "source": "hand_curated",
                "approved_by": "seed",
                "approved_at": "2025-01-15T00:00:00+00:00",
            },
        }
        base.update(overrides)
        return base

    def test_valid_record(self):
        rec = MisconceptionRecord.model_validate(self._valid_record())
        assert rec.misconception_id == "MC_M7N_test_thing_01"

    def test_invalid_id_pattern_rejected(self):
        with pytest.raises(ValidationError):
            MisconceptionRecord.model_validate(
                self._valid_record(misconception_id="BAD_ID")
            )

    def test_empty_name_rejected(self):
        with pytest.raises(ValidationError):
            MisconceptionRecord.model_validate(self._valid_record(name=""))

    def test_empty_topic_ids_rejected(self):
        with pytest.raises(ValidationError):
            MisconceptionRecord.model_validate(self._valid_record(topic_ids=[]))

    def test_extra_fields_rejected(self):
        with pytest.raises(ValidationError):
            MisconceptionRecord.model_validate(
                self._valid_record(extra_field="bad")
            )


class TestWorkedExampleRecord:
    def _valid_record(self, **overrides):
        base = {
            "worked_example_id": "WE_M7N_test_thing_01",
            "name": "Test example",
            "topic_ids": ["AC9M7N04"],
            "framework": "AC9_MATHS",
            "question": "What is 2+2?",
            "final_answer": "4",
            "steps": [{"step_number": 1, "prose": "Add 2 and 2"}],
            "targets_misconception_ids": [],
            "provenance": {
                "source": "hand_curated",
                "approved_by": "seed",
                "approved_at": "2025-01-15T00:00:00+00:00",
            },
        }
        base.update(overrides)
        return base

    def test_valid_record(self):
        rec = WorkedExampleRecord.model_validate(self._valid_record())
        assert rec.worked_example_id == "WE_M7N_test_thing_01"

    def test_invalid_id_pattern_rejected(self):
        with pytest.raises(ValidationError):
            WorkedExampleRecord.model_validate(
                self._valid_record(worked_example_id="BAD_ID")
            )

    def test_empty_steps_rejected(self):
        with pytest.raises(ValidationError):
            WorkedExampleRecord.model_validate(self._valid_record(steps=[]))

    def test_extra_fields_rejected(self):
        with pytest.raises(ValidationError):
            WorkedExampleRecord.model_validate(
                self._valid_record(extra_field="bad")
            )
