"""Algebra can be marked without an LLM — but only when the difference is proven.

Without a provider, ``_mark_short_answer`` could only decide answers where both
the student's response and the key were numeric. An algebraic answer such as
``8x+27`` for ``8x+26`` was returned as ``parent_review_pending``: the student got
no verdict and no explanation, no mistake reached the Error Book, and because
deferred rows are unscored, mastery could only ever rise.

The safety property matters more than the coverage: telling a student their
correct answer is wrong destroys trust faster than any other marking failure, so
every uncertain case must still defer.
"""
from __future__ import annotations

from unittest.mock import patch

import pytest

from backend.answer_normalize import symbolic_mismatch_kind
from backend.tutor_engine import TutorEngine


@pytest.fixture(scope="module")
def offline_engine():
    with patch.dict(
        "os.environ",
        {"GEMINI_API_KEY": "", "OPENAI_API_KEY": "", "LLM_API_KEY": ""},
    ):
        engine = TutorEngine()
    assert not engine.client, "this suite must run in mock mode"
    return engine


def _mark(engine, key, student, question="Expand and simplify."):
    question_dict = {
        "id": "item",
        "question": question,
        "answer": key,
        "subject": "math",
        "question_type": "short_answer",
        "steps": [],
    }
    return engine._mark_short_answer(question_dict, student)


class TestNeverMarksACorrectAnswerWrong:
    @pytest.mark.parametrize(
        "student,key,why",
        [
            ("8x+26", "$8x+26$", "identical"),
            ("26+8x", "$8x+26$", "terms reordered"),
            ("2(4x+13)", "$8x+26$", "equivalent factorised form"),
            ("x^2+7x+12", "$(x+3)(x+4)$", "equivalent expanded form"),
            ("x=5", "$x=5$", "same equation"),
            ("2x=10", "$x=5$", "proportional equation"),
            ("3x=15", "$x=5$", "proportional equation"),
            ("1/(x-2)", r"$\frac{1}{x-2}$", "same rational expression"),
        ],
    )
    def test_equivalent_answers_get_no_wrong_verdict(self, student, key, why):
        assert symbolic_mismatch_kind(student, key) == "", why

    @pytest.mark.parametrize(
        "student,key,why",
        [
            ("6<x", "$x > 6$", "inequality rearranged — relationals are not compared"),
            ("x>6", "$x > 6$", "same inequality"),
            ("x is greater than 6", "$x > 6$", "prose student answer"),
            ("eight x plus twenty six", "$8x+26$", "written-out answer"),
            ("8x+26", "Expand to get $8x+26$ and check", "prose in the key"),
            ("18 cm^2", "Exact area is $18$; rounded is $17.9$.", "multi-value key"),
            ("", "$8x+26$", "empty answer"),
        ],
    )
    def test_uncertain_cases_defer_instead_of_failing(self, student, key, why):
        assert symbolic_mismatch_kind(student, key) == "", why

    def test_an_open_prompt_is_never_decided_symbolically(self, offline_engine):
        # Provably different algebra, but the prompt asks for justification, so the
        # response is more than a value and must go to review.
        result = _mark(
            offline_engine,
            "$8x+26$",
            "8x+27",
            question="Simplify the expression and justify your answer.",
        )
        assert result["error_type"] == "parent_review_pending"
        assert not result.get("deterministic")

    def test_the_same_answer_is_decided_when_the_prompt_only_wants_a_value(
        self, offline_engine
    ):
        result = _mark(offline_engine, "$8x+26$", "8x+27", question="Simplify.")
        assert result["error_type"] == "incorrect_value"


class TestProvablyWrongAlgebraIsMarked:
    @pytest.mark.parametrize(
        "student,key,kind",
        [
            ("8x+27", "$8x+26$", "constant_term"),
            ("3(x-5)", "$3(x-4)$", "constant_term"),
            ("16x+52", "$8x+26$", "scaled"),
            ("7x+26", "$8x+26$", "different"),
            ("(x+3)(x+5)", "$(x+3)(x+4)$", "different"),
            ("x=6", "$x=5$", "equation"),
            ("x=-5", "$x=5$", "equation"),
        ],
    )
    def test_kind_is_classified(self, student, key, kind):
        assert symbolic_mismatch_kind(student, key) == kind

    def test_student_gets_a_verdict_and_targeted_feedback(self, offline_engine):
        result = _mark(offline_engine, "$8x+26$", "8x+27")
        assert result["is_correct"] is False
        assert result["error_type"] == "incorrect_value"
        assert result["deterministic"] is True
        # Points at the actual mistake rather than restating that it is wrong.
        assert "constant" in result["feedback"].lower()

    def test_scaled_answers_are_told_what_to_look_for(self, offline_engine):
        result = _mark(offline_engine, "$8x+26$", "16x+52")
        assert "multiple" in result["feedback"].lower()

    def test_equation_feedback_asks_for_substitution(self, offline_engine):
        result = _mark(offline_engine, "$x=5$", "x=6", question="Solve for x.")
        assert "substitute" in result["feedback"].lower()

    def test_verdict_counts_as_evidence_rather_than_being_deferred(self, offline_engine):
        """A deferred row is unscored, so mastery could only ever rise."""
        from core.algorithms.bkt import _UNSCORED_ERROR_TYPES

        result = _mark(offline_engine, "$8x+26$", "8x+27")
        assert result["error_type"] not in _UNSCORED_ERROR_TYPES


class TestCorrectAnswersStillPass:
    @pytest.mark.parametrize(
        "student,key",
        [
            ("8x+26", "$8x+26$"),
            ("26+8x", "$8x+26$"),
            ("2(4x+13)", "$8x+26$"),
            ("x^2+7x+12", "$(x+3)(x+4)$"),
            ("x=5", "$x=5$"),
        ],
    )
    def test_marked_correct(self, offline_engine, student, key):
        result = _mark(offline_engine, key, student)
        assert result["is_correct"] is True
