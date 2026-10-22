"""Tests for Task 11 — _call_llm_safe graceful LLM failure.

Verifies that each public method returns its documented typed fallback
rather than raising when the LLM client throws.
"""
from __future__ import annotations

import pytest
from unittest.mock import patch, MagicMock

from backend.tutor_engine import get_tutor_engine, _llm_health, _record_llm_health
from core.schema.tutor_schema import MarkResult, HintResult, VariationResult, ErrorPatternResult


VALID_STUDENT_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"


@pytest.mark.usefixtures("tutor_engine_mock_mode")
class TestCallLlmSafeMockMode:
    """In mock mode (no API key), _call_llm_safe returns the fallback."""

    def test_mark_returns_fallback_in_mock_mode(self):
        engine = get_tutor_engine()
        assert engine.client is None  # mock mode
        result = engine.mark("math_7_f_AC9M7N02_adae12", "3/4", student_id=VALID_STUDENT_ID)
        # Should return a valid dict (from MarkResult)
        assert isinstance(result, dict)
        assert "is_correct" in result
        assert "feedback" in result


class TestCallLlmSafeExceptionHandling:
    """When the LLM client raises, _call_llm_safe returns the fallback."""

    def test_mark_returns_fallback_on_exception(self):
        engine = get_tutor_engine()
        # Temporarily give it a mock client that raises
        original_client = engine.client
        try:
            mock_client = MagicMock()
            mock_client.chat.completions.create.side_effect = RuntimeError("API down")
            engine.client = mock_client

            # Use a text answer that can't be resolved locally (forces LLM path)
            result = engine.mark("math_7_f_AC9M7N02_adae12", "three quarters of a whole", student_id=VALID_STUDENT_ID)
            assert isinstance(result, dict)
            assert result["is_correct"] is False
            assert "feedback" in result
        finally:
            engine.client = original_client



class TestLLMHealthState:
    """Tests for _LLMHealthState tracking."""

    def test_record_success(self):
        _llm_health.last_success = None
        _llm_health.last_failure = None
        _record_llm_health("success", "test-id", 100.0)
        assert _llm_health.last_success is not None

    def test_record_failure(self):
        _llm_health.last_failure = None
        _record_llm_health("failure", "test-id", 200.0, exc_class="RuntimeError")
        assert _llm_health.last_failure is not None
        assert _llm_health.failure_exception == "RuntimeError"
