"""Exam and diagnostic marking may be upgraded by a model, never downgraded.

Deterministic marking is the right default for an assessment: the same answer must
always earn the same mark, and marking has to keep working offline. Its cost is
false negatives — an authored answer holding several values cannot be matched by
any normaliser, so a correct response lost the mark in the setting where it counts
most, with no review path.

Every test here is about the guarantee that makes the second opinion safe: it can
only ever turn "wrong" into "right".
"""
from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from backend.services.answer_adjudication import (
    adjudication_enabled,
    confirms_equivalence,
    grade_with_adjudication,
    is_adjudicable,
)

MULTI_VALUE_ITEM = {
    "id": "item",
    "question": "Estimate the product, then find the actual value and the error.",
    "answer": "Estimate $80$; actual $80.36$; error $0.36$.",
    "subject": "math",
    "question_type": "short_answer",
    "steps": [],
}

# A geometry item whose authored key is a word, not a value. A student writing
# "a trapezium" is correct, so the answer must stay eligible for a second
# opinion instead of being force-failed by exact text matching.
WORD_ANSWER_ITEM = {
    "id": "word-item",
    "question": "Name the quadrilateral with exactly one pair of parallel sides.",
    "answer": "Trapezium",
    "subject": "math",
    "question_type": "short_answer",
    "steps": [],
}


class _Engine:
    """Stand-in for the tutor engine's marking entry point."""

    def __init__(self, result, *, client=True):
        self._result = result
        self.client = client
        self.calls = 0

    def _mark_short_answer(self, *args, **kwargs):
        self.calls += 1
        if isinstance(self._result, Exception):
            raise self._result
        return self._result

    def _mark_multi_part(self, *args, **kwargs):
        self.calls += 1
        if isinstance(self._result, Exception):
            raise self._result
        return {
            "is_correct": True,
            "outcome": "correct",
            "score": 1,
            "max_score": 1,
            "part_results": [],
            "feedback": "ok",
        }


def _with_engine(engine):
    return patch("backend.routers.helpers.get_tutor_engine", lambda: engine)


class TestScope:
    def test_a_multi_value_maths_short_answer_is_adjudicable(self):
        assert is_adjudicable(MULTI_VALUE_ITEM) is True

    @pytest.mark.parametrize(
        "override,why",
        [
            ({"question": "Explain why this method works."}, "open prompt"),
            ({"subject": "english"}, "text-graded subject"),
            ({"question_type": "multiple_choice"}, "exact choice comparison"),
            ({"question_type": "multi_part"}, "graded per part"),
            ({"question_type": "reasoning"}, "rubric graded"),
        ],
    )
    def test_items_with_their_own_path_are_excluded(self, override, why):
        assert is_adjudicable({**MULTI_VALUE_ITEM, **override}) is False, why


class TestCanBeDisabled:
    def test_enabled_by_default(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("EXAM_LLM_ADJUDICATION", None)
            assert adjudication_enabled() is True

    @pytest.mark.parametrize("value", ["false", "0", "no", "off", "FALSE"])
    def test_can_be_switched_off_for_fully_deterministic_marking(self, value):
        with patch.dict(os.environ, {"EXAM_LLM_ADJUDICATION": value}):
            assert adjudication_enabled() is False

    def test_disabled_means_no_provider_call_at_all(self):
        engine = _Engine({"is_correct": True})
        with patch.dict(os.environ, {"EXAM_LLM_ADJUDICATION": "false"}), _with_engine(engine):
            assert confirms_equivalence(MULTI_VALUE_ITEM, "80, 80.36, 0.36") is False
        assert engine.calls == 0


class TestMarkingCanOnlyBeUpgraded:
    def test_a_deterministically_correct_answer_never_reaches_the_model(self):
        engine = _Engine({"is_correct": False})
        with _with_engine(engine):
            correct, adjudicated = grade_with_adjudication(
                MULTI_VALUE_ITEM, "anything", deterministic_result=True
            )
        assert (correct, adjudicated) == (True, False)
        assert engine.calls == 0, "a correct mark must not be put at risk"

    def test_a_confirmed_equivalent_answer_is_upgraded_and_flagged(self):
        with _with_engine(_Engine({"is_correct": True})):
            assert grade_with_adjudication(
                MULTI_VALUE_ITEM, "80, 80.36, 0.36", deterministic_result=False
            ) == (True, True)

    @pytest.mark.parametrize(
        "result,why",
        [
            ({"is_correct": False}, "model denies equivalence"),
            (
                {"is_correct": False, "error_type": "parent_review_pending"},
                "a deferral is not a confirmation",
            ),
            (
                {"is_correct": True, "error_type": "parent_review_pending"},
                "a deferral is not a confirmation even if is_correct is set",
            ),
            (None, "unusable response"),
            ("not a dict", "unusable response"),
        ],
    )
    def test_anything_short_of_confirmation_keeps_the_deterministic_verdict(
        self, result, why
    ):
        with _with_engine(_Engine(result)):
            assert grade_with_adjudication(
                MULTI_VALUE_ITEM, "80, 80.36, 0.36", deterministic_result=False
            ) == (False, False), why

    def test_a_provider_failure_keeps_the_deterministic_verdict(self):
        with _with_engine(_Engine(RuntimeError("provider down"))):
            assert grade_with_adjudication(
                MULTI_VALUE_ITEM, "80, 80.36, 0.36", deterministic_result=False
            ) == (False, False)

    def test_offline_keeps_the_deterministic_verdict(self):
        engine = _Engine({"is_correct": True}, client=None)
        with _with_engine(engine):
            assert grade_with_adjudication(
                MULTI_VALUE_ITEM, "80, 80.36, 0.36", deterministic_result=False
            ) == (False, False)
        assert engine.calls == 0

    @pytest.mark.parametrize("answer", ["", "   ", None, 5])
    def test_an_empty_or_non_string_answer_is_never_upgraded(self, answer):
        with _with_engine(_Engine({"is_correct": True})):
            assert confirms_equivalence(MULTI_VALUE_ITEM, answer) is False


class TestExamAndDiagnosticWiring:
    def test_exam_uses_the_one_way_helper(self):
        from backend.exam_simulator import ExamSimulator

        assert hasattr(ExamSimulator, "_check_answer_with_adjudication")

    def test_exam_still_exposes_the_purely_deterministic_check(self):
        """The deterministic path must remain available and unchanged."""
        from backend.exam_simulator import ExamSimulator

        assert hasattr(ExamSimulator, "_check_answer")

    def test_diagnostic_local_correct_answer_does_not_call_llm(self):
        """A deterministic correct value is trusted without a second opinion."""
        from backend.diagnostic_engine import DiagnosticEngine

        item = {
            **MULTI_VALUE_ITEM,
            "id": "diagnostic-value-correct",
            "question": "Calculate 12 × 5.",
            "answer": "60",
        }
        engine = _Engine({"is_correct": False})
        diagnostic = DiagnosticEngine({item["id"]: item})

        with _with_engine(engine):
            result = diagnostic._grade_response(item, "60", student_id="student-1")

        assert result["outcome"] == "correct"
        assert result["llm_adjudicated"] is False
        assert engine.calls == 0, "a correct mark must not be put at risk"

    def test_diagnostic_confirmed_equivalence_is_upgraded_and_flagged(self):
        """A locally rejected, explicitly confirmed value becomes scored correct."""
        from backend.diagnostic_engine import DiagnosticEngine

        item = {
            **MULTI_VALUE_ITEM,
            "id": "diagnostic-value-upgrade",
        }
        engine = _Engine({"is_correct": True})
        diagnostic = DiagnosticEngine({item["id"]: item})

        with patch.dict(os.environ, {"EXAM_LLM_ADJUDICATION": "true"}), _with_engine(engine):
            result = diagnostic._grade_response(
                item, "80, 80.36, 0.36", student_id="student-1"
            )

        assert result["outcome"] == "correct"
        assert result["is_correct"] is True
        assert result["score"] == 1
        assert result["llm_adjudicated"] is True
        assert engine.calls == 1

    @pytest.mark.parametrize(
        "mark_result,expected_outcome",
        [
            ({"is_correct": False}, "incorrect"),
            ({"is_correct": True, "error_type": "parent_review_pending"}, "pending"),
        ],
    )
    def test_diagnostic_uncertain_adjudication_uses_safe_outcome(
        self, mark_result, expected_outcome
    ):
        """A denial scores wrong; an unavailable verdict stays unscored."""
        from backend.diagnostic_engine import DiagnosticEngine

        item = {**MULTI_VALUE_ITEM, "id": "diagnostic-value-uncertain"}
        diagnostic = DiagnosticEngine({item["id"]: item})

        with patch.dict(os.environ, {"EXAM_LLM_ADJUDICATION": "true"}), _with_engine(
            _Engine(mark_result)
        ):
            result = diagnostic._grade_response(
                item, "80, 70, 10", student_id="student-1"
            )

        assert result["outcome"] == expected_outcome
        assert result["is_correct"] is False
        assert result["score"] == 0
        assert result["llm_adjudicated"] is False
        assert (result["error_type"] == "grading_deferred") is (expected_outcome == "pending")

    def test_diagnostic_provider_failure_defers_an_inconclusive_value_answer(self):
        """Provider failures cannot turn an inconclusive compound answer into a miss."""
        from backend.diagnostic_engine import DiagnosticEngine

        item = {**MULTI_VALUE_ITEM, "id": "diagnostic-value-provider-failure"}
        diagnostic = DiagnosticEngine({item["id"]: item})

        with patch.dict(os.environ, {"EXAM_LLM_ADJUDICATION": "true"}), _with_engine(
            _Engine(RuntimeError("provider down"))
        ):
            result = diagnostic._grade_response(
                item, "80, 80.36, 0.36", student_id="student-1"
            )

        assert result["outcome"] == "pending"
        assert result["is_correct"] is False
        assert result["llm_adjudicated"] is False
        assert result["error_type"] == "grading_deferred"


    def test_diagnostic_obvious_numeric_mismatch_never_reaches_the_model(self):
        from backend.diagnostic_engine import DiagnosticEngine

        item = {
            **MULTI_VALUE_ITEM,
            "id": "diagnostic-obvious-mismatch",
            "question": "Calculate 12 × 5.",
            "answer": "60",
        }
        llm = _Engine({"is_correct": True})
        diagnostic = DiagnosticEngine({item["id"]: item})

        with patch.dict(os.environ, {"EXAM_LLM_ADJUDICATION": "true"}), _with_engine(llm):
            result = diagnostic._grade_response(item, "30", student_id="student-1")

        assert result["outcome"] == "incorrect"
        assert result["llm_adjudicated"] is False
        assert llm.calls == 0

class TestWordAnswerKeysAreNotConclusivelyRejected:
    """A word answer key must not be failed by exact text matching.

    Regression: ``deterministic_rejection_is_conclusive`` used to treat any
    student answer with no maths signal as a proven miss. When the authored key
    is itself a word (e.g. "Trapezium"), the correct word answer "a trapezium"
    was marked wrong with no second opinion — the reported "missing article" bug.
    """

    def test_has_math_signal_distinguishes_words_from_values(self):
        from backend.services.answer_adjudication import has_math_signal

        assert has_math_signal("2") is True
        assert has_math_signal("x=3") is True
        assert has_math_signal("half") is True
        assert has_math_signal("Trapezium") is False
        assert has_math_signal("a trapezium") is False

    @pytest.mark.parametrize(
        "authored,student,conclusive",
        [
            # word key + word answer -> NOT conclusive, so a model may upgrade
            ("Trapezium", "a trapezium", False),
            ("Trapezium", "Kite", False),
            ("\\angle PXQ", "angle PXQ", False),
            # numeric / symbolic keys stay authoritative
            ("5", "2", True),
            ("x=3", "x=4", True),
            ("5", "five", True),
            # a key with any mathematical alternative stays authoritative
            ("Trapezium", "a trapezium", False),
        ],
    )
    def test_conclusive_rejection_depends_on_the_authored_key(
        self, authored, student, conclusive
    ):
        from backend.services.answer_adjudication import (
            deterministic_rejection_is_conclusive,
        )

        item = {**WORD_ANSWER_ITEM, "answer": authored}
        assert deterministic_rejection_is_conclusive(item, student) is conclusive

    def test_word_answer_can_be_upgraded_by_a_second_opinion(self):
        with _with_engine(_Engine({"is_correct": True})):
            assert grade_with_adjudication(
                WORD_ANSWER_ITEM, "a trapezium", deterministic_result=False
            ) == (True, True)

    def test_word_answer_is_still_rejected_when_the_model_denies_it(self):
        with _with_engine(_Engine({"is_correct": False})):
            assert grade_with_adjudication(
                WORD_ANSWER_ITEM, "Kite", deterministic_result=False
            ) == (False, False)

    def test_numeric_item_still_skips_the_model(self):
        """A demonstrably different numeric answer must not reach the provider."""
        item = {**MULTI_VALUE_ITEM, "answer": "60", "question": "Calculate 12 × 5."}
        engine = _Engine({"is_correct": True})
        with patch.dict(os.environ, {"EXAM_LLM_ADJUDICATION": "true"}), _with_engine(engine):
            assert confirms_equivalence(item, "30") is False
        assert engine.calls == 0

class TestMathsMultiPartWithWordParts:
    """A maths multi-part with a word sub-part must not be force-scored.

    Regression: diagnostic routed a value-only maths multi-part through the
    fully deterministic ``grade_multi_part_details``. A sub-part whose key is a
    word ("Rainforest Fruit Trees") was therefore failed for "a Rainforest Fruit
    Tree" with no model and no review deferral.
    """

    @staticmethod
    def _multi_part(answer_a: str):
        return {
            "id": "mp-word",
            "question": "Classify each item.",
            "answer": "",
            "subject": "math",
            "question_type": "multi_part",
            "sub_parts": [
                {"label": "a", "question": "Name it.", "answer": answer_a, "marks": 1},
                {"label": "b", "question": "How many?", "answer": "$7$", "marks": 1},
            ],
        }

    def test_word_sub_part_routes_to_the_model(self):
        from backend.diagnostic_engine import DiagnosticEngine

        item = self._multi_part("Trapezium")
        engine = _Engine({"is_correct": True})
        diagnostic = DiagnosticEngine({item["id"]: item})

        with _with_engine(engine):
            diagnostic._grade_response(
                item, '{"a": "a trapezium", "b": "7"}', student_id="student-1"
            )

        assert engine.calls == 1, "a word sub-part must reach the marking path"

    def test_value_only_sub_parts_stay_deterministic(self):
        from backend.diagnostic_engine import DiagnosticEngine

        item = self._multi_part("$7$")
        engine = _Engine({"is_correct": True})
        diagnostic = DiagnosticEngine({item["id"]: item})

        with _with_engine(engine):
            diagnostic._grade_response(
                item, '{"a": "7", "b": "7"}', student_id="student-1"
            )

        assert engine.calls == 0, "a value-only maths multi-part must not call the model"
