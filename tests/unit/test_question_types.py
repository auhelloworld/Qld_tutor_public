"""Unit tests for multiple-choice and reasoning question types.

Tests schema validation, MCQ deterministic grading, and reasoning
rubric-based grading via the TutorEngine.
"""
import json
import uuid
import pytest

from backend.services.marking import mark_mcq
from core.schema.exercise_schema import ExerciseItem
from pydantic import ValidationError


# ───────────────────────────────────────────────────────────────────
# Schema validation tests
# ───────────────────────────────────────────────────────────────────


_BASE = {
    "id": "test_001",
    "topic": "fractions",
    "question": "Test question",
    "answer": "A",
    "framework": "AC9_MATHS",
    "topic_ids": ["AC9M7N04"],
    "subject": "math",
    "difficulty": "foundational",
    "year_level": 7,
}


class TestExerciseSchemaQuestionTypes:
    """Verify that the question_type validators enforce field constraints."""

    def test_short_answer_default(self):
        """Existing exercises default to short_answer without new fields."""
        item = ExerciseItem(**_BASE)
        assert item.question_type == "short_answer"
        assert item.choices is None
        assert item.rubric is None

    def test_mcq_valid(self):
        ex = {
            **_BASE,
            "question_type": "multiple_choice",
            "choices": ["A. 3/4", "B. 2/3", "C. 1/2", "D. 4/5"],
            "correct_choice": "A",
        }
        item = ExerciseItem(**ex)
        assert item.question_type == "multiple_choice"
        assert len(item.choices) == 4
        assert item.correct_choice == "A"

    def test_mcq_missing_choices_rejected(self):
        ex = {
            **_BASE,
            "question_type": "multiple_choice",
            "correct_choice": "A",
        }
        with pytest.raises(ValidationError, match="choices"):
            ExerciseItem(**ex)

    def test_mcq_missing_correct_choice_rejected(self):
        ex = {
            **_BASE,
            "question_type": "multiple_choice",
            "choices": ["A. yes", "B. no"],
        }
        with pytest.raises(ValidationError, match="correct_choice"):
            ExerciseItem(**ex)

    def test_mcq_single_choice_rejected(self):
        ex = {
            **_BASE,
            "question_type": "multiple_choice",
            "choices": ["A. only one"],
            "correct_choice": "A",
        }
        with pytest.raises(ValidationError, match="choices"):
            ExerciseItem(**ex)

    def test_reasoning_valid(self):
        ex = {
            **_BASE,
            "question_type": "reasoning",
            "rubric": {"key_points": ["point 1", "point 2"], "max_score": 2},
            "sample_reasoning": "Model answer text",
        }
        item = ExerciseItem(**ex)
        assert item.question_type == "reasoning"
        assert item.rubric["max_score"] == 2

    def test_reasoning_missing_rubric_rejected(self):
        ex = {
            **_BASE,
            "question_type": "reasoning",
        }
        with pytest.raises(ValidationError, match="rubric"):
            ExerciseItem(**ex)

    def test_reasoning_incomplete_rubric_rejected(self):
        ex = {
            **_BASE,
            "question_type": "reasoning",
            "rubric": {"key_points": ["point 1"]},  # missing max_score
        }
        with pytest.raises(ValidationError, match="max_score"):
            ExerciseItem(**ex)

    def test_short_answer_with_choices_rejected(self):
        ex = {
            **_BASE,
            "question_type": "short_answer",
            "choices": ["A. yes", "B. no"],
        }
        with pytest.raises(ValidationError, match="choices"):
            ExerciseItem(**ex)

    def test_complexity_field(self):
        ex = {
            **_BASE,
            "complexity": "complex_unfamiliar",
        }
        item = ExerciseItem(**ex)
        assert item.complexity == "complex_unfamiliar"

    def test_complexity_invalid_rejected(self):
        ex = {
            **_BASE,
            "complexity": "impossible",
        }
        with pytest.raises(ValidationError):
            ExerciseItem(**ex)


# ───────────────────────────────────────────────────────────────────
# MCQ marking tests
# ───────────────────────────────────────────────────────────────────


class TestMCQMarking:
    """Test the deterministic MCQ grading in TutorEngine."""

    @pytest.fixture(autouse=True)
    def _setup(self):
        from backend._testing import reset_tutor_engine
        reset_tutor_engine()
        from backend.tutor_engine import get_tutor_engine
        self.engine = get_tutor_engine()
        self.student_id = str(uuid.uuid4())

    def test_mcq_correct_letter(self):
        result = self.engine.mark("math_7_mc_AC9M7N01_7477da", "B", student_id=self.student_id)
        assert result["is_correct"] is True
        assert result["question_type"] == "multiple_choice"

    def test_mcq_correct_full_text(self):
        result = self.engine.mark("math_7_mc_AC9M7N01_7477da", "B. 12", student_id=self.student_id)
        assert result["is_correct"] is True

    def test_mcq_correct_lowercase(self):
        result = self.engine.mark("math_7_mc_AC9M7N01_7477da", "b", student_id=self.student_id)
        assert result["is_correct"] is True

    def test_mcq_incorrect(self):
        result = self.engine.mark("math_7_mc_AC9M7N01_7477da", "A", student_id=self.student_id)
        assert result["is_correct"] is False
        assert result["error_type"] == "incorrect_choice"
        assert "try again" in result["feedback"].lower()

    def test_mcq_no_llm_call(self):
        """MCQ should never invoke LLM — runs instantly."""
        import time
        start = time.monotonic()
        self.engine.mark("math_7_mc_AC9M7N01_7477da", "A", student_id=self.student_id)
        elapsed = time.monotonic() - start
        # Should be sub-100ms since no LLM call
        assert elapsed < 1.0

    def test_authored_mcq_feedback_explains_correct_answer_and_selected_distractor(self):
        question = {
            "correct_choice": "C",
            "choices": ["A) Simile", "B) Personification", "C) Metaphor", "D) Alliteration"],
            "rubric": {
                "correct_explanation": (
                    "The phrase directly equates the reef with a cathedral without using like or as."
                ),
                "distractor_feedback": {
                    "A": "A simile requires like or as, which the phrase does not use.",
                    "B": "The phrase does not give the reef a specific human action or emotion.",
                    "D": "The phrase does not depend on repeated initial consonant sounds."
                },
            },
        }

        correct = mark_mcq(question, "C")
        incorrect = mark_mcq(question, "A")

        assert correct["is_correct"] is True
        assert "directly equates" in correct["feedback"]
        assert incorrect["is_correct"] is False
        assert incorrect["selected_choice"] == "A"
        assert "requires like or as" in incorrect["feedback"]

    def test_legacy_mcq_rubric_still_provides_targeted_retry_guidance(self):
        question = {
            "correct_choice": "B",
            "choices": ["A) Background only", "B) Active source of meaning", "C) Comic relief"],
            "steps": ["Locate the setting details in the passage."],
            "rubric": {
                "key_points": [
                    "Correct choice B: the setting actively shapes the character's decision.",
                    "If incorrect, feedback should direct the student to compare the setting details with the character's final action",
                ]
            },
        }

        result = mark_mcq(question, "C")

        assert result["is_correct"] is False
        assert "compare the setting details" in result["feedback"].lower()


# ───────────────────────────────────────────────────────────────────
# Reasoning marking tests (mock LLM mode)
# ───────────────────────────────────────────────────────────────────


class TestReasoningMarking:
    """Test reasoning grading (uses mock LLM fallback)."""

    @pytest.fixture(autouse=True)
    def _setup(self):
        from backend._testing import reset_tutor_engine
        reset_tutor_engine()
        from backend.tutor_engine import get_tutor_engine
        self.engine = get_tutor_engine()
        self.student_id = str(uuid.uuid4())

    def test_reasoning_returns_score(self):
        result = self.engine.mark(
            "math_7_rs_AC9M7N04_01bdf1",
            "Tom is wrong. You need a common denominator. 1/3 + 1/4 = 7/12.",
            student_id=self.student_id,
        )
        assert "score" in result
        assert "max_score" in result
        assert result["question_type"] == "reasoning"
        assert result["max_score"] == 4

    def test_reasoning_has_key_points(self):
        result = self.engine.mark(
            "math_7_rs_AC9M7N04_01bdf1",
            "I don't know",
            student_id=self.student_id,
        )
        assert "key_points_met" in result
        assert "key_points_missed" in result

    def test_reasoning_fallback_does_not_expose_rubric_answers(self):
        question_id = "math_7_rs_AC9M7A01_886001"
        result = self.engine.mark(
            question_id,
            "I don't know",
            student_id=self.student_id,
        )
        serialized = json.dumps({
            "key_points": result.get("key_points", []),
            "key_points_missed": result.get("key_points_missed", []),
        })

        assert "4.50" not in serialized
        assert "2.20" not in serialized
        assert "flag fall" not in serialized.lower()

    def test_reasoning_threshold_is_80_percent(self):
        """Verify the REASONING_CORRECT_THRESHOLD constant."""
        assert self.engine.REASONING_CORRECT_THRESHOLD == 0.80


# ───────────────────────────────────────────────────────────────────
# Exercise data integrity tests
# ───────────────────────────────────────────────────────────────────


class TestExerciseDataIntegrity:
    """Verify the new exercises in exercise_7_math.json are loadable."""

    @pytest.fixture(autouse=True)
    def _load(self):
        from pathlib import Path
        data_path = Path(__file__).parent.parent.parent / "data" / "exercise_7_math.json"
        with open(data_path, encoding="utf-8") as f:
            self.exercises = json.load(f)

    def test_total_count(self):
        assert len(self.exercises) >= 8

    def test_mcq_count(self):
        mcq = [e for e in self.exercises if e.get("question_type") == "multiple_choice"]
        assert len(mcq) >= 5

    def test_reasoning_count(self):
        rs = [e for e in self.exercises if e.get("question_type") == "reasoning"]
        assert len(rs) >= 5

    def test_all_mcq_have_choices(self):
        for e in self.exercises:
            if e.get("question_type") == "multiple_choice":
                assert e.get("choices") is not None
                assert len(e["choices"]) >= 2
                assert e.get("correct_choice") is not None

    def test_all_reasoning_have_rubric(self):
        for e in self.exercises:
            if e.get("question_type") == "reasoning":
                assert e.get("rubric") is not None
                assert "key_points" in e["rubric"]
                assert "max_score" in e["rubric"]
