"""Unit tests for core/schema/tutor_schema.py — Task 1 verification."""
import pytest
from pydantic import ValidationError

from core.schema.tutor_schema import (
    ErrorPatternResult,
    HintResult,
    MarkResult,
    VariationResult,
)


# --- Extra-field ignoring (extra="ignore") ---


class TestExtraFieldIgnoring:
    def test_mark_result_ignores_extra(self):
        res = MarkResult(is_correct=True, feedback="ok", extra_field="x")
        assert not hasattr(res, "extra_field")

    def test_hint_result_ignores_extra(self):
        res = HintResult(hint_text="try again", extra_field="x")
        assert not hasattr(res, "extra_field")

    def test_variation_result_ignores_extra(self):
        res = VariationResult(question="q", answer="a", extra_field="x")
        assert not hasattr(res, "extra_field")

    def test_error_pattern_result_ignores_extra(self):
        res = ErrorPatternResult(pattern_found=True, analysis="x", extra_field="x")
        assert not hasattr(res, "extra_field")


# --- MarkResult cross-field validator ---


class TestMarkResultValidator:
    def test_correct_with_error_type_coerced(self):
        result = MarkResult(
            is_correct=True,
            error_type="calculation_error",
            feedback="x",
        )
        assert result.is_correct is True
        assert result.error_type is None

    def test_incorrect_with_error_type_succeeds(self):
        result = MarkResult(
            is_correct=False,
            error_type="calculation_error",
            feedback="x",
        )
        assert result.error_type == "calculation_error"

    def test_correct_with_none_error_type_succeeds(self):
        result = MarkResult(is_correct=True, error_type=None, feedback="x")
        assert result.is_correct is True
        assert result.error_type is None


# --- Fallback classmethods ---


class TestFallbacks:
    def test_mark_result_fallback(self):
        fb = MarkResult.fallback()
        assert isinstance(fb, MarkResult)
        assert fb.is_correct is False
        assert fb.error_type is None
        assert "unable to grade" in fb.feedback.lower() or "try again" in fb.feedback.lower()

    def test_hint_result_fallback(self):
        fb = HintResult.fallback()
        assert isinstance(fb, HintResult)
        assert fb.redaction_applied is False
        assert len(fb.hint_text) > 0

    def test_variation_result_fallback(self):
        fb = VariationResult.fallback()
        assert isinstance(fb, VariationResult)
        assert fb.verified is False
        assert fb.steps == []

    def test_error_pattern_result_fallback(self):
        fb = ErrorPatternResult.fallback()
        assert isinstance(fb, ErrorPatternResult)
        assert fb.pattern_found is False
        assert fb.analysis == ""


class TestErrorTypeCoercion:
    def test_invalid_error_type_coerced_to_none(self):
        result = MarkResult(
            is_correct=False,
            error_type="some_invalid_hallucinated_code",
            feedback="Your calculation is incorrect.",
        )
        assert result.is_correct is False
        assert result.error_type is None
        assert result.feedback == "Your calculation is incorrect."
