"""Unit tests for TutorEngine._parse_llm_json — Task 2 verification."""
import pytest

from core.schema.tutor_schema import MarkResult, ErrorPatternResult
from backend.tutor_engine import TutorEngine


@pytest.fixture
def engine(monkeypatch):
    """Create a TutorEngine in mock mode (no API keys)."""
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    return TutorEngine()


@pytest.fixture
def fallback():
    return MarkResult.fallback()


class TestParseLlmJson:
    def test_valid_json_returns_typed_instance(self, engine, fallback):
        raw = '{"is_correct": true, "feedback": "Good"}'
        result = engine._parse_llm_json(raw, MarkResult, fallback)
        assert isinstance(result, MarkResult)
        assert result.is_correct is True
        assert result.feedback == "Good"

    def test_valid_json_wrapped_in_fences(self, engine, fallback):
        raw = '```json\n{"is_correct": false, "error_type": "concept_gap", "feedback": "Try again"}\n```'
        result = engine._parse_llm_json(raw, MarkResult, fallback)
        assert isinstance(result, MarkResult)
        assert result.is_correct is False
        assert result.error_type == "concept_gap"
        assert result.feedback == "Try again"

    def test_invalid_json_returns_fallback(self, engine, fallback):
        raw = "not json at all"
        result = engine._parse_llm_json(raw, MarkResult, fallback)
        assert result is fallback

    def test_schema_mismatched_json_returns_fallback(self, engine, fallback):
        raw = '{"wrong_field": true}'
        result = engine._parse_llm_json(raw, MarkResult, fallback)
        assert result is fallback

    def test_none_returns_fallback(self, engine, fallback):
        result = engine._parse_llm_json(None, MarkResult, fallback)
        assert result is fallback

    def test_empty_string_returns_fallback(self, engine, fallback):
        result = engine._parse_llm_json("", MarkResult, fallback)
        assert result is fallback

    def test_truncated_json_mid_string_repaired(self, engine, fallback):
        raw = '{"is_correct": true, "feedback": "This is a very long feedback message that got cut'
        result = engine._parse_llm_json(raw, MarkResult, fallback)
        assert isinstance(result, MarkResult)
        assert result.is_correct is True
        assert result.feedback == "This is a very long feedback message that got cut"

    def test_truncated_json_mid_key_backtracked(self, engine, fallback):
        raw = '{"is_correct": false, "feedback": "Retry", "error_type": "concept_gap", "next_'
        result = engine._parse_llm_json(raw, MarkResult, fallback)
        assert isinstance(result, MarkResult)
        assert result.is_correct is False
        assert result.error_type == "concept_gap"
        assert result.feedback == "Retry"

    def test_truncated_json_trailing_comma_handled(self, engine, fallback):
        raw = '{"is_correct": true, "feedback": "Good", "error_type": null, '
        result = engine._parse_llm_json(raw, MarkResult, fallback)
        assert isinstance(result, MarkResult)
        assert result.is_correct is True
        assert result.error_type is None
        assert result.feedback == "Good"

    def test_json_after_explanatory_text_with_braces_is_extracted(self, engine, fallback):
        raw = (
            "I compared the response with the marking guide {not json}.\n"
            '{"is_correct": false, "error_type": "concept_gap", "feedback": "Review the key idea."}'
        )
        result = engine._parse_llm_json(raw, MarkResult, fallback)
        assert isinstance(result, MarkResult)
        assert result.is_correct is False
        assert result.error_type == "concept_gap"
        assert result.feedback == "Review the key idea."

    def test_first_valid_json_must_match_schema(self, engine, fallback):
        raw = (
            '{"note": "internal scratch object"}\n'
            '{"is_correct": true, "feedback": "Accepted."}'
        )
        result = engine._parse_llm_json(raw, MarkResult, fallback)
        assert isinstance(result, MarkResult)
        assert result.is_correct is True
        assert result.feedback == "Accepted."

    def test_parse_json_with_think_tag(self, engine, fallback):
        raw = (
            "<think>\n"
            "Analyzing student answer.\n"
            "This answer is correct.\n"
            "I should structure the JSON like {'is_correct': true}.\n"
            "</think>\n"
            '{"is_correct": true, "feedback": "Good job."}'
        )
        result = engine._parse_llm_json(raw, MarkResult, fallback)
        assert isinstance(result, MarkResult)
        assert result.is_correct is True
        assert result.feedback == "Good job."

    def test_parse_json_with_raw_newlines_inside_strings(self, engine, fallback):
        raw = (
            '{\n'
            '  "is_correct": false,\n'
            '  "feedback": "Let\'s check the steps:\n'
            '1. Simplify the surds...\n'
            '2. Solve the quadratic."\n'
            '}'
        )
        result = engine._parse_llm_json(raw, MarkResult, fallback)
        assert isinstance(result, MarkResult)
        assert result.is_correct is False
        assert "Simplify the surds..." in result.feedback
        assert "\n1. Simplify" in result.feedback

    def test_parse_error_pattern_with_raw_newlines(self, engine):
        raw = (
            '{\n'
            '  "pattern_found": true,\n'
            '  "analysis": "The student makes mistakes: \n'
            '- In expanding place values \n'
            '- In decimal conversion."\n'
            '}'
        )
        fallback = ErrorPatternResult.fallback()
        result = engine._parse_llm_json(raw, ErrorPatternResult, fallback)
        assert isinstance(result, ErrorPatternResult)
        assert result.pattern_found is True
        assert "place values" in result.analysis
        assert "\n- In expanding" in result.analysis

    def test_unescaped_latex_sqrt_and_percent_parse(self, engine, fallback):
        """Models often emit single-backslash LaTeX; must not JSONDecodeError."""
        raw = (
            r'{"is_correct": false, "error_type": "formula_misuse", '
            r'"feedback": "Use $\sqrt{x}$ and check $15\%$.", "next_step": null}'
        )
        result = engine._parse_llm_json(raw, MarkResult, fallback)
        assert result is not fallback
        assert result.is_correct is False
        assert result.error_type == "formula_misuse"
        assert r"\sqrt{x}" in result.feedback
        assert r"15\%" in result.feedback

    def test_unescaped_latex_frac_not_corrupted(self, engine, fallback):
        """\\frac must not become form-feed + 'rac'."""
        raw = (
            r'{"is_correct": false, "error_type": "fraction_error", '
            r'"feedback": "Try $\frac{a}{b}$ instead.", "next_step": null}'
        )
        result = engine._parse_llm_json(raw, MarkResult, fallback)
        assert result is not fallback
        assert r"\frac{a}{b}" in result.feedback
        assert "\x0c" not in result.feedback

    def test_unescaped_latex_le_ge_circ(self, engine, fallback):
        raw = (
            r'{"is_correct": true, "error_type": null, '
            r'"feedback": "Good: $x\le 3$ and $\theta=90\circ$.", "next_step": null}'
        )
        result = engine._parse_llm_json(raw, MarkResult, fallback)
        assert result is not fallback
        assert result.is_correct is True
        assert r"\le" in result.feedback
        assert r"\circ" in result.feedback

    def test_already_escaped_latex_unchanged(self, engine, fallback):
        raw = '{"is_correct": true, "feedback": "Nice: $\\\\sqrt{x}$.", "error_type": null}'
        result = engine._parse_llm_json(raw, MarkResult, fallback)
        assert result is not fallback
        assert r"\sqrt{x}" in result.feedback

    def test_long_mark_result_with_mixed_latex(self, engine, fallback):
        """Mirrors live failures: long feedback + several LaTeX commands."""
        feedback = (
            "You expanded incorrectly. For $(x+1)^2$ use $\\times$ carefully; "
            "the middle term is not zero. Also simplify $\\frac{2}{4}$ and "
            "compare with $\\sqrt{4}$. Remember $50\\%$ means half."
        )
        # Build the broken form providers often emit (single backslash in JSON).
        broken = (
            '{"is_correct": false, "error_type": "distribution_error", '
            '"feedback": "' + feedback.replace("\\\\", "\\") + '", '
            '"next_step": "What is the coefficient of x after expansion?"}'
        )
        result = engine._parse_llm_json(broken, MarkResult, fallback)
        assert result is not fallback
        assert result.is_correct is False
        assert result.error_type == "distribution_error"
        assert "middle term" in result.feedback

    def test_pythonish_single_quoted_reasoning_result(self, engine):
        """Short single-quoted dicts (~100 chars) should parse as ReasoningResult."""
        from core.schema.tutor_schema import ReasoningResult

        raw = (
            "{'score': 2, 'max_score': 4, 'feedback': 'Partial credit.', "
            "'key_points': [{'text': 'names integers', 'met': True}]}"
        )
        fallback = ReasoningResult.fallback(max_score=4)
        result = engine._parse_llm_json(raw, ReasoningResult, fallback)
        assert result is not fallback
        assert result.score == 2
        assert result.max_score == 4
        assert len(result.key_points) == 1
        assert result.key_points[0].met is True
