"""The misconception library must actually be able to fire.

Fourteen authored misconception records referenced predicate names that were
never implemented. ``MisconceptionLibrary._record_matches`` looks the name up
with ``PREDICATE_REGISTRY.get(...)`` and silently does nothing on a miss, so
those records could never be detected — and with them, thirteen of the twenty
misconception-targeted worked examples were unreachable.

A misconception label is shown to the student as an explanation of *their* error,
so a false match teaches the wrong lesson. The silence cases below matter as much
as the detection cases.
"""
from __future__ import annotations

import pytest

from backend.misconception_predicates import PREDICATE_REGISTRY

# (predicate, question, answer that shows the misconception, correct answer)
DETECTION_CASES = [
    (
        "missing_grouping_brackets",
        "There are 3 bags each holding n + 2 marbles. Write an expression.",
        "3n + 2",
        "3(n + 2)",
    ),
    ("equation_inverse_one_side_only", "Solve 3x + 2 = 11.", "11/3", "3"),
    ("linear_pattern_missing_constant", "Write the rule for the pattern.", "3n", "3n + 1"),
    (
        "cointerior_treated_as_equal",
        "Two parallel lines are cut by a transversal. One co-interior angle is 110. Find the other.",
        "110",
        "70",
    ),
    (
        "triangle_missing_angle_no_subtract_from_180",
        "A triangle has angles 50 and 60. Find the third angle.",
        "110",
        "70",
    ),
    (
        "ratio_model_missing_context_interpretation",
        "Share $60 in the ratio 2:3. How much is the smaller share?",
        "2",
        "$24",
    ),
    ("hcf_lcm_exponents_reversed", "Find the HCF of 12 and 18.", "36", "6"),
    (
        "prime_factorisation_missing_repeated_factor_or_power",
        "Write 24 as a product of prime powers.",
        "2^2 * 3",
        "2^3 * 3",
    ),
    ("ratio_additive_scaling", "Write a ratio equivalent to 2:3.", "4:5", "4:6"),
    ("square_root_as_half", "Evaluate \\sqrt{36}.", "18", "6"),
    ("xy_swap", "Plot the point (2, 3).", "(3, 2)", "(2, 3)"),
    (
        "short_run_must_match_theory",
        "A coin is tossed 10 times and lands heads 7 times. Comment on this experiment.",
        "The coin must be biased",
        "Short-run results vary by chance.",
    ),
    (
        "statistical_conclusion_missing_evidence",
        "Compare the two classes and justify your answer with data.",
        "Class A is better because they worked harder",
        "Class A has a higher median of 72",
    ),
    (
        "stem_leaf_unsorted_or_missing_key",
        "Construct a stem-and-leaf plot for the scores.",
        "6|4 1 9\n7|2 5",
        "6|1 4 9\n7|2 5\nKey: 6|4 = 64",
    ),
]

# Answers that are correct or simply unrelated: nothing may fire on these.
NEUTRAL_CASES = [
    ("Evaluate 12 + 5.", "17", "17"),
    ("What is the median of 3, 5 and 9?", "5", "5"),
    ("Simplify 4x + 3x.", "7x", "7x"),
    ("Find the area of a 5 cm by 3 cm rectangle.", "15", "15"),
    ("Write 2:3 in its simplest form.", "2:3", "2:3"),
    ("Plot the point (4, 4).", "(4, 4)", "(4, 4)"),
]

ODD_INPUTS = ["", "   ", "?", "-", "n/a", "0", "1e999", "x" * 300, "(", "|", "2:0", "5/0"]


def test_every_referenced_predicate_is_registered():
    """A predicate name with no implementation makes its misconception dead."""
    from backend.misconception_library import get_library

    library = get_library()
    missing = {
        signature.pattern
        for record in library.misconceptions.values()
        for signature in record.detection_signatures
        if signature.kind == "predicate" and signature.pattern not in PREDICATE_REGISTRY
    }
    assert not missing, f"unimplemented predicates: {sorted(missing)}"


def test_no_authored_misconception_is_undetectable():
    from backend.misconception_library import get_library

    library = get_library()
    dead = [
        misconception_id
        for misconception_id, record in library.misconceptions.items()
        if not any(
            signature.kind != "predicate" or signature.pattern in PREDICATE_REGISTRY
            for signature in record.detection_signatures
        )
    ]
    assert dead == []


def test_every_targeted_worked_example_has_a_reachable_target():
    """A worked example keyed to an undetectable misconception can never be shown."""
    from backend.misconception_library import get_library

    library = get_library()
    unreachable = [
        misconception_id
        for misconception_id in library.we_by_misconception
        if misconception_id in library.misconceptions
        and not any(
            signature.kind != "predicate" or signature.pattern in PREDICATE_REGISTRY
            for signature in library.misconceptions[misconception_id].detection_signatures
        )
    ]
    assert unreachable == []


@pytest.mark.parametrize("predicate,question,student,correct", DETECTION_CASES)
def test_predicate_detects_its_misconception(predicate, question, student, correct):
    assert PREDICATE_REGISTRY[predicate]({"question": question}, student, correct) is True


@pytest.mark.parametrize("predicate,question,student,correct", DETECTION_CASES)
def test_predicate_is_silent_on_the_correct_answer(predicate, question, student, correct):
    assert PREDICATE_REGISTRY[predicate]({"question": question}, correct, correct) is False


@pytest.mark.parametrize("predicate", sorted(PREDICATE_REGISTRY))
@pytest.mark.parametrize("question,student,correct", NEUTRAL_CASES)
def test_no_predicate_fires_on_an_unrelated_correct_answer(
    predicate, question, student, correct
):
    assert PREDICATE_REGISTRY[predicate]({"question": question}, student, correct) is False


class TestDefectsFoundByIndependentAudit:
    """Cases an independent adversarial review found after the first implementation.

    All three were mislabels or false verdicts, which teach the wrong lesson and
    cost more trust than giving no feedback at all.
    """

    PROBABILITY_QUESTION = {
        "question": "You roll a die 5 times and get three 6s. Comment on whether the die must be biased."
    }
    TRIANGLE_QUESTION = {
        "question": "A triangle has angles of 50 and 60 degrees. Find the missing angle."
    }

    @pytest.mark.parametrize(
        "answer",
        [
            "We can't conclude the die is biased from just 5 rolls",
            "It is wrong to say the die must be biased",
            "The die is not necessarily biased from this evidence alone",
            "Small samples vary by chance",
            "It might just be chance",
            "Only 5 rolls is too few to tell",
        ],
    )
    def test_refuting_the_claim_is_not_the_misconception(self, answer):
        """A correct answer rejects the claim using the same vocabulary."""
        assert (
            PREDICATE_REGISTRY["short_run_must_match_theory"](
                self.PROBABILITY_QUESTION, answer, ""
            )
            is False
        )

    @pytest.mark.parametrize(
        "answer",
        [
            "The die must be biased",
            "The die is biased",
            "This is wrong, it should be exactly 1 in 6",
            "The result is impossible",
        ],
    )
    def test_asserting_the_claim_still_detects(self, answer):
        assert (
            PREDICATE_REGISTRY["short_run_must_match_theory"](
                self.PROBABILITY_QUESTION, answer, ""
            )
            is True
        )

    @pytest.mark.parametrize("answer", ["50", "60"])
    def test_repeating_a_given_angle_is_a_different_mistake(self, answer):
        """Labelling this "you forgot to subtract from 180" explains the wrong error."""
        assert (
            PREDICATE_REGISTRY["triangle_missing_angle_no_subtract_from_180"](
                self.TRIANGLE_QUESTION, answer, "70"
            )
            is False
        )

    def test_adding_the_known_angles_still_detects(self):
        assert (
            PREDICATE_REGISTRY["triangle_missing_angle_no_subtract_from_180"](
                self.TRIANGLE_QUESTION, "110", "70"
            )
            is True
        )

    @pytest.mark.parametrize(
        "student,correct",
        [
            ("log(x) + log(y)", "log(x*y)"),
            ("log(x*y)", "log(x)+log(y)"),
            ("2*log(x)", "log(x**2)"),
            ("log(x)-log(y)", "log(x/y)"),
        ],
    )
    def test_real_valued_identities_are_never_declared_wrong(self, student, correct):
        """Sympy works over the complex plane, so a negative sample point made the
        log product rule look false. Sample points are positive for this reason.
        """
        from backend.answer_normalize import symbolic_mismatch_kind

        assert symbolic_mismatch_kind(student, correct) == ""

    def test_genuinely_different_logs_are_still_caught(self):
        from backend.answer_normalize import symbolic_mismatch_kind

        assert symbolic_mismatch_kind("log(x+y)", "log(x)+log(y)") != ""


@pytest.mark.parametrize("predicate", sorted(PREDICATE_REGISTRY))
def test_predicates_tolerate_malformed_input(predicate):
    """Detection runs on live student text, so it must never raise."""
    function = PREDICATE_REGISTRY[predicate]
    for student in ODD_INPUTS:
        for correct in ODD_INPUTS:
            result = function({"question": "Evaluate the expression."}, student, correct)
            assert result in (True, False)


class TestLastMisconceptionIsAttachedForWorkedExamples:
    """``_handle_show_worked_example`` prefers a worked example targeting the
    student's actual misconception, but it reads ``_last_misconception_id`` from
    the question and nothing was setting it, so the targeting never fired.
    """

    QUESTION_ID = "q-42"

    def _log(self, attempts):
        return {"topics": {"AC9M7N01": {"attempts": attempts}}}

    def _attempt(self, misconception_id, timestamp, question_id=None):
        return {
            "question_id": question_id or self.QUESTION_ID,
            "misconception_id": misconception_id,
            "timestamp": timestamp,
        }

    def test_latest_misconception_for_the_question_is_attached(self):
        from backend.dialogue_handler import _with_last_misconception

        log = self._log(
            [
                self._attempt("MC_OLD", "2026-07-01T00:00:00+00:00"),
                self._attempt("MC_NEW", "2026-07-30T00:00:00+00:00"),
            ]
        )
        annotated = _with_last_misconception({"id": self.QUESTION_ID}, log, self.QUESTION_ID)
        assert annotated["_last_misconception_id"] == "MC_NEW"

    def test_other_questions_misconceptions_are_ignored(self):
        from backend.dialogue_handler import _with_last_misconception

        log = self._log([self._attempt("MC_ELSEWHERE", "2026-07-30T00:00:00+00:00", "other")])
        annotated = _with_last_misconception({"id": self.QUESTION_ID}, log, self.QUESTION_ID)
        assert "_last_misconception_id" not in annotated

    def test_returns_the_question_unchanged_when_there_is_nothing_to_attach(self):
        from backend.dialogue_handler import _with_last_misconception

        question = {"id": self.QUESTION_ID}
        assert _with_last_misconception(question, {"topics": {}}, self.QUESTION_ID) is question

    def test_the_shared_exercise_bank_entry_is_not_mutated(self):
        from backend.dialogue_handler import _with_last_misconception

        question = {"id": self.QUESTION_ID}
        log = self._log([self._attempt("MC_NEW", "2026-07-30T00:00:00+00:00")])
        annotated = _with_last_misconception(question, log, self.QUESTION_ID)
        assert annotated is not question
        assert "_last_misconception_id" not in question
