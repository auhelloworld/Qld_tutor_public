"""Verification gate for are_equivalent_text — English text equivalence.
Covers the 7 test cases from the v5 spec §2.4.

- Exact case-insensitive match
- Whitespace normalization
- Trailing punctuation tolerance
- Oxford comma tolerance
- Spelling error rejection (zero character tolerance)
- Empty input handling
"""

from __future__ import annotations

import pytest
from backend.answer_normalize import are_equivalent_text


class TestExactMatch:
    def test_case_insensitive_exact(self):
        assert are_equivalent_text("definitely", "definitely") is True

    def test_case_difference(self):
        assert are_equivalent_text("Definitely", "definitely") is True

    def test_completely_different(self):
        assert are_equivalent_text("hello", "world") is False


class TestWhitespaceNormalization:
    def test_extra_spaces_student(self):
        assert are_equivalent_text("  the cat  sat  ", "the cat sat") is True

    def test_extra_spaces_both(self):
        assert are_equivalent_text("  hello world  ", "hello   world") is True

    def test_tabs_and_newlines(self):
        assert are_equivalent_text("the\tcat\nsat", "the cat sat") is True


class TestTrailingPunctuation:
    def test_trailing_period(self):
        assert are_equivalent_text(
            "The three items are: flour, sugar, and eggs.",
            "The three items are: flour, sugar, and eggs"
        ) is True

    def test_trailing_exclamation(self):
        assert are_equivalent_text("That's amazing!", "That's amazing") is True

    def test_trailing_question(self):
        assert are_equivalent_text("What time is it?", "What time is it") is True


class TestOxfordComma:
    def test_oxford_comma_in_student(self):
        assert are_equivalent_text(
            "flour, sugar, and eggs",
            "flour, sugar and eggs"
        ) is True

    def test_oxford_comma_in_correct(self):
        assert are_equivalent_text(
            "flour, sugar and eggs",
            "flour, sugar, and eggs"
        ) is True

    def test_no_oxford_either_side(self):
        assert are_equivalent_text(
            "flour, sugar and eggs",
            "flour, sugar and eggs"
        ) is True

    def test_oxford_comma_with_trailing_period(self):
        """Student writes complete sentence with Oxford comma and period."""
        assert are_equivalent_text(
            "flour, sugar, and eggs.",
            "flour, sugar and eggs"
        ) is True

    def test_trailing_period_with_oxford_comma_in_correct(self):
        """Correct answer has Oxford comma and period, student does not."""
        assert are_equivalent_text(
            "flour, sugar and eggs",
            "flour, sugar, and eggs."
        ) is True


class TestSpellingRejection:
    def test_definately_rejected(self):
        """CRITICAL: edit distance 1 from 'definitely' — must NOT match."""
        assert are_equivalent_text("definately", "definitely") is False

    def test_unecessary_rejected(self):
        """edit distance 1 from 'unnecessary'."""
        assert are_equivalent_text("unecessary", "unnecessary") is False

    def test_embaras_rejected(self):
        """edit distance 2 from 'embarrass'."""
        assert are_equivalent_text("embaras", "embarrass") is False

    def test_disapear_rejected(self):
        """edit distance 1 from 'disappear'."""
        assert are_equivalent_text("disapear", "disappear") is False

    def test_space_removal_does_not_create_false_positive(self):
        """'the cat sat' must NOT match 'the catsat'."""
        assert are_equivalent_text("the cat sat", "the catsat") is False


class TestEmptyInput:
    def test_empty_student(self):
        assert are_equivalent_text("", "anything") is False

    def test_empty_correct(self):
        assert are_equivalent_text("anything", "") is False

    def test_both_empty(self):
        assert are_equivalent_text("", "") is False

    def test_none_student(self):
        assert are_equivalent_text(None, "anything") is False

    def test_none_correct(self):
        assert are_equivalent_text("anything", None) is False
