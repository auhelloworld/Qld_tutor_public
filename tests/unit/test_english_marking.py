"""Verification gate for Task 0.3 — English subject-aware marking routing.

Tests that mark_short_answer routes english questions to are_equivalent_text()
and non-english questions to are_equivalent().
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from backend._testing import reset_engine_factory_cache


@pytest.fixture(autouse=True)
def _isolate(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    reset_engine_factory_cache()
    monkeypatch.setattr("backend.rules.LOG_ROOT", tmp_path / "logs")
    yield
    reset_engine_factory_cache()


@pytest.fixture
def tutor():
    import backend.tutor_engine as te
    te._tutor_engine = None
    engine = te.get_tutor_engine()
    return engine


STUDENT_ID = "test-english-student"


class TestEnglishShortAnswerRouting:
    """English short_answer questions must use are_equivalent_text, not are_equivalent."""

    def test_english_spelling_answer_routed_to_text_equivalence(self, tutor):
        """An English short_answer with correct spelling (case diff) should be marked correct."""
        tutor.exercises["eng_spell_001"] = {
            "id": "eng_spell_001",
            "topic": "spelling rules and word origins",
            "question": "Correct the misspelled word: *The student was **definately** excited.*",
            "answer": "definitely",
            "framework": "AC9_ENGLISH",
            "topic_ids": ["AC9E7LA08"],
            "subject": "english",
            "difficulty": "foundational",
            "year_level": 7,
            "question_type": "short_answer",
        }

        # Case difference: are_equivalent_text should normalize and accept
        result = tutor.mark("eng_spell_001", "Definitely", student_id=STUDENT_ID)
        assert result["is_correct"] is True, (
            f"Expected correct for 'Definitely' vs 'definitely', got {result}"
        )

    def test_english_spelling_mismatch_rejected(self, tutor):
        """A misspelling must NOT be accepted."""
        tutor.exercises["eng_spell_002"] = {
            "id": "eng_spell_002",
            "topic": "spelling rules and word origins",
            "question": "Correct the misspelled word: *It was an **unecessary** risk.*",
            "answer": "unnecessary",
            "framework": "AC9_ENGLISH",
            "topic_ids": ["AC9E7LA08"],
            "subject": "english",
            "difficulty": "foundational",
            "year_level": 7,
            "question_type": "short_answer",
        }

        # Student still spells it wrong
        result = tutor.mark("eng_spell_002", "unecessary", student_id=STUDENT_ID)
        assert result["is_correct"] is False, (
            f"Expected incorrect for misspelling 'unecessary', got {result}"
        )

    def test_english_sentence_rewrite_accepted(self, tutor):
        """A sentence rewrite with Oxford comma variation should be accepted."""
        tutor.exercises["eng_rewrite_001"] = {
            "id": "eng_rewrite_001",
            "topic": "punctuation including colons and brackets",
            "question": "Rewrite with correct punctuation: *the three items we need are flour sugar and eggs*",
            "answer": "The three items we need are: flour, sugar, and eggs.",
            "framework": "AC9_ENGLISH",
            "topic_ids": ["AC9E7LA09"],
            "subject": "english",
            "difficulty": "developing",
            "year_level": 7,
            "question_type": "short_answer",
        }

        # Without trailing period, without Oxford comma — should be accepted
        result = tutor.mark(
            "eng_rewrite_001",
            "The three items we need are: flour, sugar and eggs",
            student_id=STUDENT_ID,
        )
        assert result["is_correct"] is True, (
            f"Expected correct for Oxford comma variant, got {result}"
        )


class TestMathShortAnswerStillWorks:
    """Math short_answer questions must continue to use are_equivalent."""

    def test_math_numeric_answer_still_works(self, tutor):
        """Existing math short_answer with numeric equivalence must still work."""
        tutor.exercises["math_sa_001"] = {
            "id": "math_sa_001",
            "topic": "fractions",
            "question": "What is 3/4 as a decimal?",
            "answer": "0.75",
            "framework": "AC9_MATHS",
            "topic_ids": ["AC9M7N02"],
            "subject": "math",
            "difficulty": "foundational",
            "year_level": 7,
            "question_type": "short_answer",
        }

        result = tutor.mark("math_sa_001", "0.75", student_id=STUDENT_ID)
        assert result["is_correct"] is True

    def test_math_units_optional(self, tutor):
        """Math unit-optional equivalence must still work."""
        tutor.exercises["math_sa_002"] = {
            "id": "math_sa_002",
            "topic": "area",
            "question": "Calculate the area.",
            "answer": "60 cm²",
            "framework": "AC9_MATHS",
            "topic_ids": ["AC9M7A01"],
            "subject": "math",
            "difficulty": "foundational",
            "year_level": 7,
            "question_type": "short_answer",
        }

        # Student omits units — are_equivalent allows this for math
        result = tutor.mark("math_sa_002", "60", student_id=STUDENT_ID)
        assert result["is_correct"] is True


class TestEnglishMultiPartRouting:
    """English multi_part questions must use are_equivalent_text per part."""

    def test_english_multi_part_text_equivalence(self, tutor):
        """Each sub_part of an English multi_part must use text equivalence."""
        tutor.exercises["eng_mp_001"] = {
            "id": "eng_mp_001",
            "topic": "interaction skills for discussion",
            "question": "Answer both parts about the dialogue.",
            "answer": "a) respectful b) Zara",
            "framework": "AC9_ENGLISH",
            "topic_ids": ["AC9E7LY02"],
            "subject": "english",
            "difficulty": "developing",
            "year_level": 7,
            "question_type": "multi_part",
            "sub_parts": [
                {
                    "label": "a",
                    "question": "What tone does Maya use?",
                    "answer": "respectful",
                    "marks": 1,
                },
                {
                    "label": "b",
                    "question": "Which character demonstrates the best negotiation?",
                    "answer": "Zara",
                    "marks": 1,
                },
            ],
        }

        # Case-difference on part (a) — should be accepted via are_equivalent_text
        result = tutor.mark(
            "eng_mp_001",
            '{"a": "Respectful", "b": "Zara"}',
            student_id=STUDENT_ID,
        )
        assert result["is_correct"] is True, (
            f"Expected correct for case-diff multi_part, got {result}"
        )

    def test_english_multi_part_spelling_mismatch_rejected(self, tutor):
        """A misspelling in a multi_part English answer must be rejected."""
        tutor.exercises["eng_mp_002"] = {
            "id": "eng_mp_002",
            "topic": "interaction skills for discussion",
            "question": "Answer both parts.",
            "answer": "a) respectful b) Zara",
            "framework": "AC9_ENGLISH",
            "topic_ids": ["AC9E7LY02"],
            "subject": "english",
            "difficulty": "developing",
            "year_level": 7,
            "question_type": "multi_part",
            "sub_parts": [
                {"label": "a", "question": "Tone?", "answer": "respectful", "marks": 1},
                {"label": "b", "question": "Character?", "answer": "Zara", "marks": 1},
            ],
        }

        # Part (a) is misspelled — should be rejected
        result = tutor.mark(
            "eng_mp_002",
            '{"a": "respectfull", "b": "Zara"}',
            student_id=STUDENT_ID,
        )
        assert result["is_correct"] is False, (
            f"Expected incorrect for misspelling in multi_part, got {result}"
        )
