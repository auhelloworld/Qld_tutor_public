"""Unit tests for backend/answer_redact.py — Task 5 Verification."""
from __future__ import annotations

import pytest

from backend.answer_redact import REDACTION_TOKEN, redact


class TestRedactDigitForm:
    def test_answer_is_7(self):
        result, applied = redact("The answer is 7", "7")
        assert REDACTION_TOKEN in result
        assert applied is True
        assert "7" not in result.replace(REDACTION_TOKEN, "")

    def test_no_leak(self):
        result, applied = redact("Think about the formula", "7")
        assert result == "Think about the formula"
        assert applied is False


class TestRedactFractionForm:
    def test_fraction_in_text(self):
        result, applied = redact("So x = 3/4", "3/4")
        assert REDACTION_TOKEN in result
        assert applied is True

    def test_cross_form_decimal(self):
        """Redact decimal form when answer is a fraction."""
        result, applied = redact("The result is 0.75", "3/4")
        assert REDACTION_TOKEN in result
        assert applied is True


class TestRedactWordForm:
    def test_english_word_seven(self):
        result, applied = redact("The answer is seven apples", "7")
        assert REDACTION_TOKEN in result
        assert applied is True

    def test_spelled_fraction(self):
        result, applied = redact("Think of three over four", "3/4")
        assert REDACTION_TOKEN in result
        assert applied is True


class TestIdempotence:
    """redact(redact(t, a), a) == redact(t, a)"""

    @pytest.mark.parametrize("text,answer", [
        ("The answer is 7", "7"),
        ("So x = 3/4", "3/4"),
        ("The result is 0.75", "3/4"),
        ("Think about the formula", "7"),
        ("It equals seven", "7"),
    ])
    def test_idempotent(self, text, answer):
        first_pass, _ = redact(text, answer)
        second_pass, _ = redact(first_pass, answer)
        assert second_pass == first_pass


class TestLeftMonotonicity:
    """Redaction in T1 survives in T1 + T2."""

    def test_left_monotone(self):
        t1 = "The answer is 7."
        t2 = " Now think about it."
        combined = t1 + t2

        redacted_t1, _ = redact(t1, "7")
        redacted_combined, _ = redact(combined, "7")

        # The redaction that happened in T1 should also appear in the combined text
        # (the prefix of the combined redaction should match the redacted T1)
        assert REDACTION_TOKEN in redacted_combined
        # The redacted portion from T1 should be present in the combined result
        assert redacted_combined.startswith(redacted_t1.rstrip(".") or redacted_t1[:10])


class TestEdgeCases:
    def test_empty_text(self):
        result, applied = redact("", "7")
        assert result == ""
        assert applied is False

    def test_empty_answer(self):
        result, applied = redact("The answer is 7", "")
        assert result == "The answer is 7"
        assert applied is False

    def test_redaction_token_not_leaking(self):
        """The REDACTION_TOKEN itself should not contain answer signatures."""
        # Verify the token doesn't contain digits or fraction-like patterns
        assert not any(c.isdigit() for c in REDACTION_TOKEN)
