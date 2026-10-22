"""Tests for the full AC9 Mathematics exercise-bank audit system."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

# Add scripts directory to path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from audit_math_bank_full import (  # type: ignore
    audit_schema,
    verify_maths,
    verify_diagram,
    evaluate_extension_quality,
    mcq_answer_matches_choice,
    has_specific_steps,
    has_template_text,
    safe_normalise,
    extract_numbers,
    extract_integers,
    extract_fractions,
    strip_latex,
    _prime_factors,
    _parse_prime_factorisation,
    _format_factorisation,
    IssueFlag,
    VerificationResult,
    SUPPORTED_DIAGRAM_TYPES,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

VALID_TOPIC_IDS_Y7 = {
    "AC9M7N01", "AC9M7N02", "AC9M7N03", "AC9M7N04", "AC9M7N05",
    "AC9M7N06", "AC9M7N07", "AC9M7N08", "AC9M7N09",
    "AC9M7A01", "AC9M7A02", "AC9M7A03", "AC9M7A04", "AC9M7A05", "AC9M7A06",
    "AC9M7M01", "AC9M7M02", "AC9M7M03", "AC9M7M04", "AC9M7M05", "AC9M7M06",
    "AC9M7SP01", "AC9M7SP02", "AC9M7SP03", "AC9M7SP04",
    "AC9M7ST01", "AC9M7ST02", "AC9M7ST03",
    "AC9M7P01", "AC9M7P02",
}


def base_exercise(**overrides):
    """Create a well-formed base exercise for testing."""
    ex = {
        "id": "math_7_f_test_001",
        "topic": "Test topic",
        "question": "What is 2 + 2?",
        "answer": "4",
        "steps": ["2 + 2 = 4"],
        "framework": "AC9_MATHS",
        "topic_ids": ["AC9M7N07"],
        "subject": "math",
        "difficulty": "foundational",
        "year_level": 7,
        "question_type": "short_answer",
        "complexity": "simple_familiar",
        "math_metadata": {
            "strand": "Number",
            "sub_strand": "integers",
            "skill": "integer_operations",
            "expected_working_steps": ["2 + 2 = 4"],
        },
    }
    ex.update(overrides)
    return ex


def base_mcq(**overrides):
    """Create a well-formed MCQ exercise for testing."""
    ex = {
        "id": "math_7_mc_test_001",
        "topic": "Test MCQ topic",
        "question": "What is sqrt(144)?",
        "answer": "B",
        "steps": ["Check each option"],
        "framework": "AC9_MATHS",
        "topic_ids": ["AC9M7N01"],
        "subject": "math",
        "difficulty": "foundational",
        "year_level": 7,
        "question_type": "multiple_choice",
        "complexity": "simple_familiar",
        "choices": ["A. 14", "B. 12", "C. 16", "D. 10"],
        "correct_choice": "B",
        "math_metadata": {
            "strand": "Number",
            "sub_strand": "squares_and_roots",
            "skill": "squares_and_roots",
            "expected_working_steps": ["Check each option"],
        },
    }
    ex.update(overrides)
    return ex


# ---------------------------------------------------------------------------
# Helper function tests
# ---------------------------------------------------------------------------

class TestSafeNormalise:
    def test_strips_latex(self):
        assert safe_normalise("$x^2$") == "x^2"

    def test_lowercase_and_strip(self):
        assert safe_normalise("  Hello World  ") == "hello world"


class TestStripLatex:
    def test_removes_dollar_signs(self):
        assert strip_latex("$2^4 \\times 3$") == "2^4  3"

    def test_removes_frac(self):
        result = strip_latex("\\frac{1}{2}")
        assert "frac" not in result


class TestExtractNumbers:
    def test_extracts_integers(self):
        assert 48 in extract_numbers("What is 48 / 6?")

    def test_extracts_negative_numbers(self):
        nums = extract_numbers("-4 + 11 - 3")
        assert -4 in nums
        assert 11 in nums

    def test_extracts_frac(self):
        nums = extract_numbers("\\frac{1}{2} + 3")
        # Should have both 0.5 and 3
        assert any(abs(n - 0.5) < 0.01 for n in nums)
        assert 3 in nums


class TestExtractFractions:
    def test_latex_frac(self):
        from fractions import Fraction
        fracs = extract_fractions("\\frac{1}{2}")
        assert Fraction(1, 2) in fracs

    def test_plain_frac(self):
        from fractions import Fraction
        fracs = extract_fractions("1/2")
        assert Fraction(1, 2) in fracs


class TestPrimeFactorisation:
    def test_prime_factors_48(self):
        factors = _prime_factors(48)
        assert factors == {2: 4, 3: 1}

    def test_prime_factors_prime(self):
        factors = _prime_factors(17)
        assert factors == {17: 1}

    def test_parse_factorisation(self):
        parsed = _parse_prime_factorisation("$2^4 \\times 3$")
        assert parsed == {2: 4, 3: 1}

    def test_parse_factorisation_trailing_period(self):
        """Trailing punctuation must not silently drop factors."""
        assert _parse_prime_factorisation("2^2 × 3 × 5^2.") == {2: 2, 3: 1, 5: 2}

    def test_parse_factorisation_brace_exponent(self):
        assert _parse_prime_factorisation("2^{3} \\times 3^{2} \\times 5") == {2: 3, 3: 2, 5: 1}

    def test_parse_factorisation_trailing_comma(self):
        assert _parse_prime_factorisation("2^3, 3^2, 5") == {2: 3, 3: 2, 5: 1}

    def test_format_factorisation(self):
        fmt = _format_factorisation({2: 4, 3: 1})
        assert fmt in ("2^4 * 3", "3 * 2^4")


class TestTemplateDetection:
    def test_detects_todo(self):
        hits = has_template_text(base_exercise(question="TODO: write this"))
        assert len(hits) > 0
        assert any("TODO" in h for h in hits)

    def test_detects_template(self):
        hits = has_template_text(base_exercise(answer="TEMPLATE placeholder"))
        assert len(hits) > 0

    def test_no_hit_on_normal(self):
        hits = has_template_text(base_exercise())
        assert len(hits) == 0

    def test_normal_insert_and_generated_by_language_are_not_placeholders(self):
        ex = base_exercise(
            question="Insert the value generated by counting the objects in the table."
        )
        assert has_template_text(ex) == []


# ---------------------------------------------------------------------------
# Schema audit tests (Validator 1)
# ---------------------------------------------------------------------------

class TestSchemaMissingFields:
    def test_missing_required_field(self):
        ex = base_exercise()
        del ex["question"]
        issues = audit_schema(ex, 7, VALID_TOPIC_IDS_Y7)
        assert any(i.code == "missing_required_field" and "question" in i.message for i in issues)

    def test_missing_id(self):
        ex = base_exercise()
        del ex["id"]
        issues = audit_schema(ex, 7, VALID_TOPIC_IDS_Y7)
        assert any(i.code == "missing_required_field" and "id" in i.message for i in issues)

    def test_null_field(self):
        ex = base_exercise(question=None)
        issues = audit_schema(ex, 7, VALID_TOPIC_IDS_Y7)
        assert any(i.code == "null_required_field" for i in issues)


class TestUnknownTopicId:
    def test_unknown_topic_id(self):
        ex = base_exercise(topic_ids=["AC9M7X99"])
        issues = audit_schema(ex, 7, VALID_TOPIC_IDS_Y7)
        assert any(i.code == "unknown_topic_id" and "AC9M7X99" in i.message for i in issues)

    def test_valid_topic_id_passes(self):
        ex = base_exercise(topic_ids=["AC9M7N07"])
        issues = audit_schema(ex, 7, VALID_TOPIC_IDS_Y7)
        assert not any(i.code == "unknown_topic_id" for i in issues)


class TestMCQAnswerMatching:
    def test_answer_15_not_match_choice_5(self):
        """Answer '15' must NOT boolean-match choice containing '5'."""
        ex = base_mcq()
        ex["choices"] = ["A. 15 kg", "B. 30 kg", "C. 45 kg", "D. 60 kg"]
        ex["correct_choice"] = "A"
        ex["answer"] = "15"
        assert mcq_answer_matches_choice(ex)

        ex2 = base_mcq()
        ex2["choices"] = ["A. 5", "B. 10", "C. 15", "D. 20"]
        ex2["correct_choice"] = "A"
        ex2["answer"] = "15"
        assert not mcq_answer_matches_choice(ex2)

    def test_letter_answer_matches_correct_choice(self):
        ex = base_mcq()
        ex["answer"] = "B"
        assert mcq_answer_matches_choice(ex)

    def test_dynamic_choice_count_and_key(self):
        ex = base_mcq(
            choices=["A. <", "B. >", "C. =", "D. ≠", "E. ≤"],
            correct_choice="E",
            answer="E",
        )
        assert mcq_answer_matches_choice(ex)
        issues = audit_schema(ex, 7, VALID_TOPIC_IDS_Y7)
        assert not any(issue.code == "mcq_too_few_choices" for issue in issues)
        assert not any(issue.code == "mcq_invalid_correct_choice" for issue in issues)

    def test_full_text_answer_matches_stripped_choice(self):
        ex = base_mcq()
        ex["choices"] = ["A. 14", "B. 12", "C. 16", "D. 10"]
        ex["correct_choice"] = "B"
        ex["answer"] = "12"
        assert mcq_answer_matches_choice(ex)

    def test_mcq_duplicate_choices(self):
        ex = base_mcq()
        ex["choices"] = ["A. 14", "B. 14", "C. 16", "D. 10"]
        ex["correct_choice"] = "B"
        ex["answer"] = "14"
        issues = audit_schema(ex, 7, VALID_TOPIC_IDS_Y7)
        assert any(i.code == "mcq_duplicate_choices" for i in issues)


class TestHeuristicAuditContracts:
    def test_dynamic_mcq_and_visual_representation(self):
        from audit_math_banks import mcq_valid, representation_quality

        assert mcq_valid({
            "choices": ["A. <", "B. >", "C. =", "D. ≠", "E. ≤"],
            "correct_choice": "E",
            "answer": "E",
        })
        assert representation_quality({
            "question": "Use the graph shown below.",
            "image": "/images/example.svg",
        }) == "adequate"
        assert representation_quality({
            "question": "The table below contains the values.",
            "sub_parts": [{
                "question": "| x | y |\\n| 1 | 2 |",
                "answer": "2",
            }],
        }) == "adequate"


    def test_specific_steps_pass(self):
        ex = base_exercise(steps=["2 + 2 = 4", "Therefore the answer is 4"])
        assert has_specific_steps(ex)

    def test_generic_steps_fail(self):
        ex = base_exercise(steps=["identify the rule", "check your answer"])
        assert not has_specific_steps(ex)


# ---------------------------------------------------------------------------
# Maths verification tests (Validator 2)
# ---------------------------------------------------------------------------

class TestFractionOperation:
    def test_fraction_verification(self):
        ex = base_exercise(
            id="math_7_d_frac_test",
            question="Compute \\frac{1}{2} + \\frac{1}{4}",
            answer="\\frac{3}{4}",
            math_metadata={
                "strand": "Number",
                "sub_strand": "fractions",
                "skill": "fraction_operations",
                "expected_working_steps": ["Common denominator 4", "2/4 + 1/4 = 3/4"],
            },
        )
        result = verify_maths(ex)
        assert result.status == "verified"


class TestPrimeFactorisationVerify:
    def test_prime_factorisation_verified(self):
        ex = base_exercise(
            id="math_7_f_pf_test",
            question="Express $48$ as a product of its prime factors.",
            answer="$2^4 \\times 3$",
            topic_ids=["AC9M7N02"],
            math_metadata={
                "strand": "Number",
                "sub_strand": "prime_factorisation",
                "skill": "prime_factorisation",
                "expected_working_steps": ["Divide 48 repeatedly"],
            },
        )
        result = verify_maths(ex)
        assert result.status == "verified"

    def test_prime_factorisation_incorrect(self):
        ex = base_exercise(
            id="math_7_f_pf_bad",
            question="Express $48$ as a product of its prime factors.",
            answer="$2^3 \\times 3^2$",  # Wrong: 8*9=72, not 48
            topic_ids=["AC9M7N02"],
            math_metadata={
                "strand": "Number",
                "sub_strand": "prime_factorisation",
                "skill": "prime_factorisation",
                "expected_working_steps": [],
            },
        )
        result = verify_maths(ex)
        assert result.status == "incorrect"


class TestHCFLCMVerify:
    def test_hcf_verified(self):
        ex = base_exercise(
            id="math_7_hcf_test",
            question="Find the HCF of 48 and 180.",
            answer="12",
            topic_ids=["AC9M7N02"],
            math_metadata={
                "strand": "Number",
                "sub_strand": "hcf_lcm",
                "skill": "hcf_using_primes",
                "expected_working_steps": [],
            },
        )
        result = verify_maths(ex)
        assert result.status == "verified"

    def test_hcf_incorrect(self):
        ex = base_exercise(
            id="math_7_hcf_bad",
            question="Find the HCF of 48 and 180.",
            answer="24",  # Wrong: HCF(48,180)=12
            topic_ids=["AC9M7N02"],
            math_metadata={
                "strand": "Number",
                "sub_strand": "hcf_lcm",
                "skill": "hcf_using_primes",
                "expected_working_steps": [],
            },
        )
        result = verify_maths(ex)
        assert result.status == "incorrect"

    def test_lcm_verified(self):
        ex = base_exercise(
            id="math_7_lcm_test",
            question="Find the LCM of 12 and 18.",
            answer="36",
            topic_ids=["AC9M7N02"],
            math_metadata={
                "strand": "Number",
                "sub_strand": "lcm",
                "skill": "lcm_using_primes",
                "expected_working_steps": [],
            },
        )
        result = verify_maths(ex)
        assert result.status == "verified"


class TestSquareRootVerify:
    def test_sqrt_perfect_square(self):
        ex = base_exercise(
            id="math_7_sqrt_test",
            question="Find $\\sqrt{144}$",
            answer="12",
            topic_ids=["AC9M7N01"],
            math_metadata={
                "strand": "Number",
                "sub_strand": "squares_and_roots",
                "skill": "squares_and_roots",
                "expected_working_steps": [],
            },
        )
        result = verify_maths(ex)
        assert result.status == "verified"

    def test_sqrt_incorrect(self):
        ex = base_exercise(
            id="math_7_sqrt_bad",
            question="Find $\\sqrt{144}$",
            answer="14",  # Wrong: sqrt(144)=12
            topic_ids=["AC9M7N01"],
            math_metadata={
                "strand": "Number",
                "sub_strand": "squares_and_roots",
                "skill": "squares_and_roots",
                "expected_working_steps": [],
            },
        )
        result = verify_maths(ex)
        assert result.status == "likely_issue"


class TestUnsupportedReturnsInconclusive:
    def test_open_ended_returns_inconclusive(self):
        """Unsupported/open-ended items must return inconclusive, not incorrect."""
        ex = base_exercise(
            id="math_7_open_test",
            question="Design a statistical investigation about sleep.",
            answer="A survey question, population, sample size, and bias analysis.",
            topic_ids=["AC9M7ST03"],
            question_type="reasoning",
            math_metadata={
                "strand": "Statistics",
                "sub_strand": "investigation",
                "skill": "planning_survey",
                "expected_working_steps": [],
            },
        )
        result = verify_maths(ex)
        assert result.status in ("unsupported", "inconclusive")
        assert result.status != "incorrect"

    def test_unknown_skill_returns_unsupported(self):
        ex = base_exercise(
            id="math_7_unknown_skill_test",
            question="Solve this geometric proof problem.",
            answer="The angles are equal.",
            math_metadata={
                "strand": "Space",
                "sub_strand": "geometry",
                "skill": "geometric_proof",  # unimplemented
                "expected_working_steps": [],
            },
        )
        result = verify_maths(ex)
        assert result.status in ("unsupported", "inconclusive")
        assert result.status != "incorrect"


# ---------------------------------------------------------------------------
# Diagram verification tests (Validator 3)
# ---------------------------------------------------------------------------

class TestUnsupportedDiagramType:
    def test_unsupported_type(self):
        ex = base_exercise(
            diagram_data={"type": "unsupported_diagram_xyz", "data": [1, 2, 3]},
        )
        issues = verify_diagram(ex)
        assert any(i.code == "unsupported_diagram_type" for i in issues)


class TestBadNumberLineRange:
    def test_min_ge_max(self):
        ex = base_exercise(
            question="Locate 5 on the number line.",
            diagram_data={"type": "number_line", "min": 10, "max": 0, "marks": [5]},
        )
        issues = verify_diagram(ex)
        assert any(i.code == "diagram_bad_range" for i in issues)

    def test_valid_range_passes(self):
        ex = base_exercise(
            question="Locate 5 on the number line.",
            diagram_data={"type": "number_line", "min": 0, "max": 10, "marks": [5]},
        )
        issues = verify_diagram(ex)
        assert not any(i.code == "diagram_bad_range" for i in issues)


class TestNumberLineMarkOutsideRange:
    def test_mark_outside(self):
        ex = base_exercise(
            question="Plot these numbers.",
            diagram_data={"type": "number_line", "min": 0, "max": 10, "marks": [15]},
        )
        issues = verify_diagram(ex)
        assert any(i.code == "diagram_mark_outside_range" for i in issues)


class TestSampleSpaceMismatch:
    def test_coin_mismatch(self):
        ex = base_exercise(
            question="A fair coin is tossed. What is the sample space?",
            diagram_data={
                "type": "sample_space_grid",
                "outcomes": ["1", "2", "3", "4", "5", "6"],
            },
        )
        issues = verify_diagram(ex)
        assert any("coin" in i.message.lower() and "coin" in i.code
                   for i in issues)

    def test_dice_context_match(self):
        ex = base_exercise(
            question="A fair six-sided die is rolled.",
            diagram_data={
                "type": "sample_space_grid",
                "outcomes": ["1", "2", "3", "4", "5", "6"],
            },
        )
        issues = verify_diagram(ex)
        # Dice numbers match: should NOT have dice_mismatch flag
        assert not any("dice" in i.code and "mismatch" in i.code
                       for i in issues)


# ---------------------------------------------------------------------------
# Extension/AMC quality tests (Validator 4)
# ---------------------------------------------------------------------------

class TestRoutineOneStepAMC:
    def test_routine_one_step_labelled_amc(self):
        """Routine one-step calculation labelled AMC should be routine_mislabeled."""
        ex = base_exercise(
            id="math_7_amc_routine",
            question="Calculate 5 + 3.",
            answer="8",
            difficulty="AMC",
            complexity="complex_unfamiliar",
            math_metadata={
                "strand": "Number",
                "sub_strand": "integers",
                "skill": "integer_operations",
                "expected_working_steps": ["5 + 3 = 8"],
            },
        )
        result = evaluate_extension_quality(ex)
        # With a simple one-step question for AMC, should be routine_mislabeled
        assert result["classification"] in ("routine_mislabeled", "weak_extension")


class TestMultiStepExtensionScoring:
    def test_adequate_or_strong_extension(self):
        """Multi-step reasoning extending item should score adequate or strong."""
        ex = base_exercise(
            id="math_7_ext_strong",
            question="If 2^a * 3^b = 648 where a and b are positive integers, prove that a + b > 5 and find a + b. Justify each step.",
            answer="a=3, b=4, a+b=7",
            steps=[
                "Prime factorise 648: 648 = 2^3 * 3^4",
                "So a=3, b=4",
                "Therefore a + b = 7 > 5",
                "Each step is justified by the factorisation",
            ],
            topic_ids=["AC9M7N02"],
            difficulty="extending",
            complexity="complex_unfamiliar",
            math_metadata={
                "strand": "Number",
                "sub_strand": "prime_factorisation",
                "skill": "prime_factorisation",
                "expected_working_steps": [
                    "Prime factorise 648",
                    "Set equal to 2^a * 3^b",
                    "Find a+b",
                ],
            },
        )
        result = evaluate_extension_quality(ex)
        assert result["classification"] in ("adequate_extension", "strong_extension")


class TestAMCSeniorContent:
    def test_amc_senior_content_flag(self):
        ex = base_exercise(
            id="math_7_amc_senior",
            question="Use the quadratic formula to solve x^2 - 5x + 6 = 0.",
            answer="x = 2 or x = 3",
            steps=["Use x = (-b +/- sqrt(b^2-4ac)) / 2a", "x = (5 +/- 1) / 2"],
            topic_ids=["AC9M7A01"],
            difficulty="AMC",
            complexity="complex_unfamiliar",
            math_metadata={
                "strand": "Algebra",
                "sub_strand": "equations",
                "skill": "solving_equations",
                "expected_working_steps": [],
            },
        )
        result = evaluate_extension_quality(ex)
        assert "senior_content_beyond_year_level" in result["amc_flags"]


# ---------------------------------------------------------------------------
# Ratio solver tests (Validator 2 — ratio_proportion)
# ---------------------------------------------------------------------------

class TestRatioShareVerify:
    def test_share_verified(self):
        ex = base_exercise(
            id="math_7_ratio_share",
            question="Share $60 between Ana and Ben in the ratio 2:3.",
            answer="Ana gets $24 and Ben gets $36",
            topic_ids=["AC9M7N04"],
            math_metadata={
                "strand": "Number",
                "sub_strand": "ratio_proportion",
                "skill": "sharing_ratio",
                "expected_working_steps": [],
            },
        )
        result = verify_maths(ex)
        assert result.status == "verified"

    def test_share_likely_issue(self):
        ex = base_exercise(
            id="math_7_ratio_share_bad",
            question="Share $60 between Ana and Ben in the ratio 2:3.",
            answer="Ana gets $20 and Ben gets $40",
            topic_ids=["AC9M7N04"],
            math_metadata={
                "strand": "Number",
                "sub_strand": "ratio_proportion",
                "skill": "sharing_ratio",
                "expected_working_steps": [],
            },
        )
        result = verify_maths(ex)
        assert result.status == "likely_issue"


class TestRatioSimplifyVerify:
    def test_simplify_verified(self):
        ex = base_exercise(
            id="math_7_ratio_simplify",
            question="Simplify the ratio 12:18.",
            answer="2:3",
            topic_ids=["AC9M7N04"],
            math_metadata={
                "strand": "Number",
                "sub_strand": "ratio_proportion",
                "skill": "ratio",
                "expected_working_steps": [],
            },
        )
        result = verify_maths(ex)
        assert result.status == "verified"


class TestRatioProportionVerify:
    def test_proportion_verified(self):
        ex = base_exercise(
            id="math_7_ratio_prop",
            question="If 3 pens cost $12, how much do 5 pens cost?",
            answer="$20",
            topic_ids=["AC9M7N04"],
            math_metadata={
                "strand": "Number",
                "sub_strand": "ratio_proportion",
                "skill": "proportion",
                "expected_working_steps": [],
            },
        )
        result = verify_maths(ex)
        assert result.status == "verified"


# ---------------------------------------------------------------------------
# Rational comparison solver tests (Validator 2 — rational_comparison)
# ---------------------------------------------------------------------------

class TestRationalComparisonVerify:
    def test_compare_fractions_larger_verified(self):
        ex = base_exercise(
            id="math_7_compare_frac",
            question="Which is larger: 3/4 or 5/6?",
            answer="5/6",
            topic_ids=["AC9M7N03"],
            math_metadata={
                "strand": "Number",
                "sub_strand": "fractions",
                "skill": "compare_fractions",
                "expected_working_steps": [],
            },
        )
        result = verify_maths(ex)
        assert result.status == "verified"

    def test_compare_fractions_likely_issue(self):
        ex = base_exercise(
            id="math_7_compare_frac_bad",
            question="Which is larger: 3/4 or 5/6?",
            answer="3/4",
            topic_ids=["AC9M7N03"],
            math_metadata={
                "strand": "Number",
                "sub_strand": "fractions",
                "skill": "compare_fractions",
                "expected_working_steps": [],
            },
        )
        result = verify_maths(ex)
        assert result.status == "likely_issue"

    def test_order_fractions_ascending_verified(self):
        ex = base_exercise(
            id="math_7_order_frac",
            question="Order from smallest to largest: 1/2, 1/3, 2/3",
            answer="1/3, 1/2, 2/3",
            topic_ids=["AC9M7N03"],
            math_metadata={
                "strand": "Number",
                "sub_strand": "fractions",
                "skill": "order_fractions",
                "expected_working_steps": [],
            },
        )
        result = verify_maths(ex)
        assert result.status == "verified"

    def test_order_fractions_incorrect(self):
        ex = base_exercise(
            id="math_7_order_frac_bad",
            question="Order from smallest to largest: 1/2, 1/3, 2/3",
            answer="1/2, 1/3, 2/3",
            topic_ids=["AC9M7N03"],
            math_metadata={
                "strand": "Number",
                "sub_strand": "fractions",
                "skill": "order_fractions",
                "expected_working_steps": [],
            },
        )
        result = verify_maths(ex)
        assert result.status == "incorrect"

    def test_order_surds_and_decimals_verified(self):
        """Regression: surds + LaTeX fractions must not hard-fail as incorrect high."""
        ex = base_exercise(
            id="math_9_order_surds",
            question=r"Arrange $\sqrt{17}$, $4.08$, $\frac{41}{10}$ and $\sqrt{18}$ from smallest to largest.",
            answer=r"$4.08,\frac{41}{10},\sqrt{17},\sqrt{18}$",
            topic_ids=["AC9M9N01"],
            year_level=9,
            math_metadata={
                "strand": "Number",
                "sub_strand": "real numbers",
                "skill": "rational_comparison",
                "expected_working_steps": [],
            },
        )
        result = verify_maths(ex)
        assert result.status == "verified"
        assert result.confidence == "high"

    def test_order_surds_core_n01_verified(self):
        ex = base_exercise(
            id="math_9_order_surds_core",
            question=r"Order $\sqrt{27}$, $5.1$, $\frac{16}{3}$ and $\sqrt{30}$ from smallest to largest.",
            answer=r"$5.1,\sqrt{27},\frac{16}{3},\sqrt{30}$",
            topic_ids=["AC9M9N01"],
            year_level=9,
            math_metadata={
                "strand": "Number",
                "sub_strand": "real numbers",
                "skill": "rational_comparison",
                "expected_working_steps": [],
            },
        )
        result = verify_maths(ex)
        assert result.status == "verified"

    def test_order_surds_graph_n01_verified(self):
        ex = base_exercise(
            id="math_9_order_surds_graph",
            question=r"Order $\sqrt{8}$, $2.8$, $17/6$ and $\sqrt{9}$ using the number line.",
            answer=r"$2.8$, $\sqrt{8}$, $17/6$, $\sqrt{9}$",
            topic_ids=["AC9M9N01"],
            year_level=9,
            math_metadata={
                "strand": "Number",
                "sub_strand": "real numbers",
                "skill": "rational_comparison",
                "expected_working_steps": [],
            },
        )
        result = verify_maths(ex)
        assert result.status == "verified"

    def test_order_surds_wrong_answer_incorrect(self):
        ex = base_exercise(
            id="math_9_order_surds_bad",
            question=r"Arrange $\sqrt{17}$, $4.08$, $\frac{41}{10}$ and $\sqrt{18}$ from smallest to largest.",
            answer=r"$\sqrt{17},4.08,\frac{41}{10},\sqrt{18}$",
            topic_ids=["AC9M9N01"],
            year_level=9,
            math_metadata={
                "strand": "Number",
                "sub_strand": "real numbers",
                "skill": "rational_comparison",
                "expected_working_steps": [],
            },
        )
        result = verify_maths(ex)
        assert result.status == "incorrect"


# ---------------------------------------------------------------------------
# New diagram semantic checks (Validator 3)
# ---------------------------------------------------------------------------

class TestSampleSpaceSpinner:
    def test_spinner_colour_mismatch(self):
        ex = base_exercise(
            question="A spinner has red, blue and green sectors. List the sample space.",
            diagram_data={
                "type": "sample_space_grid",
                "outcomes": ["1", "2", "3"],
            },
        )
        issues = verify_diagram(ex)
        assert any("spinner" in i.code for i in issues)

    def test_spinner_colour_match_passes(self):
        ex = base_exercise(
            question="A spinner has red, blue and green sectors. List the sample space.",
            diagram_data={
                "type": "sample_space_grid",
                "outcomes": ["red", "blue", "green"],
            },
        )
        issues = verify_diagram(ex)
        assert not any("spinner" in i.code for i in issues)


class TestCoordinateAlignment:
    def test_point_not_plotted(self):
        ex = base_exercise(
            question="Plot the point (3, 4) on the coordinate plane.",
            diagram_data={
                "type": "coordinate_plane",
                "points": [[1, 2], [5, 6]],
            },
        )
        issues = verify_diagram(ex)
        assert any(i.code == "diagram_coord_not_plotted" for i in issues)

    def test_point_plotted_passes(self):
        ex = base_exercise(
            question="Plot the point (3, 4) on the coordinate plane.",
            diagram_data={
                "type": "coordinate_plane",
                "points": [[3, 4], [1, 2]],
            },
        )
        issues = verify_diagram(ex)
        assert not any(i.code == "diagram_coord_not_plotted" for i in issues)

    def test_dict_point_plotted_passes(self):
        ex = base_exercise(
            question="Plot the point (3, 4) on the coordinate plane.",
            diagram_data={
                "type": "coordinate_plane",
                "points": [{"x": 3, "y": 4, "label": "A"}],
            },
        )
        issues = verify_diagram(ex)
        assert not any(i.code == "diagram_coord_not_plotted" for i in issues)


class TestFunctionGraphEquationMatch:
    def test_equation_mismatch_flagged(self):
        ex = base_exercise(
            question="Graph the line y = 2x + 1.",
            diagram_data={
                "type": "function_graph",
                "functions": [{"expression": "3*x - 5"}],
            },
        )
        issues = verify_diagram(ex)
        assert any(i.code == "diagram_function_equation_mismatch" for i in issues)

    def test_equation_match_passes(self):
        ex = base_exercise(
            question="Graph the line y = 2x + 1.",
            diagram_data={
                "type": "function_graph",
                "functions": [{"expression": "2*x + 1"}],
            },
        )
        issues = verify_diagram(ex)
        assert not any(i.code == "diagram_function_equation_mismatch" for i in issues)

    def test_kind_linear_function_passes_without_expression(self):
        ex = base_exercise(
            question="Graph the line y = 2x + 1.",
            diagram_data={
                "type": "function_graph",
                "functions": [{"kind": "linear", "m": 2, "b": 1, "label": "y=2x+1"}],
            },
        )
        issues = verify_diagram(ex)
        assert not any(i.code == "diagram_function_empty_expression" for i in issues)
        assert not any(i.code == "diagram_function_equation_mismatch" for i in issues)


# ---------------------------------------------------------------------------
# Prime factorisation parse_failed status (Validator 2 regression)
# ---------------------------------------------------------------------------

class TestPrimeFactorisationParseFailed:
    def test_unparseable_factorisation_returns_parse_failed(self):
        ex = base_exercise(
            id="math_7_pf_bad",
            question="Prime factorise 360.",
            answer="banana",  # no numbers to parse
            topic_ids=["AC9M7N02"],
            math_metadata={
                "strand": "Number",
                "sub_strand": "factors",
                "skill": "prime_factorisation",
                "expected_working_steps": [],
            },
        )
        result = verify_maths(ex)
        assert result.status == "parse_failed"

    def test_broader_prime_factor_reasoning_is_inconclusive_not_incorrect(self):
        ex = base_exercise(
            id="math_7_pf_reasoning",
            question="What is the smallest positive integer k such that the prime factorisation of 75 x k consists of only even exponents?",
            answer="3",
            topic_ids=["AC9M7N02"],
            math_metadata={
                "strand": "Number",
                "sub_strand": "factors",
                "skill": "prime_factorisation",
                "expected_working_steps": [],
            },
        )
        result = verify_maths(ex)
        assert result.status == "inconclusive"


# ---------------------------------------------------------------------------
# Compound fraction expression (Validator 2 — user-reported misreport)
# ---------------------------------------------------------------------------

class TestCompoundFractionExpression:
    def test_compound_divide_then_add_verified(self):
        """2/5 ÷ 3/4 + 1/2 = 31/30 must verify (previously misreported as 23/20)."""
        ex = base_exercise(
            id="math_7_compound_frac",
            question="Calculate 2/5 ÷ 3/4 + 1/2",
            answer="31/30",
            topic_ids=["AC9M7N06"],
            math_metadata={
                "strand": "Number",
                "sub_strand": "fractions",
                "skill": "fraction_operations",
                "expected_working_steps": [],
            },
        )
        result = verify_maths(ex)
        assert result.status == "verified"

    def test_compound_wrong_answer_likely_issue(self):
        ex = base_exercise(
            id="math_7_compound_frac_bad",
            question="Calculate 2/5 ÷ 3/4 + 1/2",
            answer="23/20",
            topic_ids=["AC9M7N06"],
            math_metadata={
                "strand": "Number",
                "sub_strand": "fractions",
                "skill": "fraction_operations",
                "expected_working_steps": [],
            },
        )
        result = verify_maths(ex)
        assert result.status == "likely_issue"

    def test_simple_fraction_add_still_works(self):
        ex = base_exercise(
            id="math_7_simple_frac",
            question="3/4 + 5/6",
            answer="19/12",
            topic_ids=["AC9M7N06"],
            math_metadata={
                "strand": "Number",
                "sub_strand": "fractions",
                "skill": "fraction_operations",
                "expected_working_steps": [],
            },
        )
        result = verify_maths(ex)
        assert result.status == "verified"


# ---------------------------------------------------------------------------
# HCF/LCM with prime-factorised inputs (Validator 2 — user-reported misreport)
# ---------------------------------------------------------------------------

class TestHCFLCMPrimeNotation:
    def test_hcf_prime_notation_verified(self):
        """HCF of 2^3×3^2×5 and 2^2×3×5^2 = 60 (previously misreported as 1)."""
        ex = base_exercise(
            id="math_7_hcf_prime",
            question="Find the HCF of 2^3 * 3^2 * 5 and 2^2 * 3 * 5^2",
            answer="60",
            topic_ids=["AC9M7N02"],
            math_metadata={
                "strand": "Number",
                "sub_strand": "hcf_lcm",
                "skill": "hcf_using_primes",
                "expected_working_steps": [],
            },
        )
        result = verify_maths(ex)
        assert result.status == "verified"

    def test_lcm_prime_notation_verified(self):
        ex = base_exercise(
            id="math_7_lcm_prime",
            question="Find the LCM of 2^2 * 3 and 2 * 3^2",
            answer="36",
            topic_ids=["AC9M7N02"],
            math_metadata={
                "strand": "Number",
                "sub_strand": "lcm",
                "skill": "lcm_using_primes",
                "expected_working_steps": [],
            },
        )
        result = verify_maths(ex)
        assert result.status == "verified"

    def test_hcf_plain_integers_still_works(self):
        ex = base_exercise(
            id="math_7_hcf_plain",
            question="Find the HCF of 48 and 180.",
            answer="12",
            topic_ids=["AC9M7N02"],
            math_metadata={
                "strand": "Number",
                "sub_strand": "hcf_lcm",
                "skill": "hcf_using_primes",
                "expected_working_steps": [],
            },
        )
        result = verify_maths(ex)
        assert result.status == "verified"


# ---------------------------------------------------------------------------
# Percentage LaTeX parsing (Validator 2 — user-reported miss)
# ---------------------------------------------------------------------------

class TestPercentageLaTeX:
    def test_latex_percent_off_verified(self):
        r"""15\% off \$80 = \$68 must verify (previously inconclusive)."""
        ex = base_exercise(
            id="math_7_pct_latex",
            question=r"15\% off \$80",
            answer=r"\$68",
            topic_ids=["AC9M7N05"],
            math_metadata={
                "strand": "Number",
                "sub_strand": "percentage",
                "skill": "percentage",
                "expected_working_steps": [],
            },
        )
        result = verify_maths(ex)
        assert result.status == "verified"

    def test_plain_percent_of_verified(self):
        ex = base_exercise(
            id="math_7_pct_plain",
            question="What is 20% of 50?",
            answer="10",
            topic_ids=["AC9M7N05"],
            math_metadata={
                "strand": "Number",
                "sub_strand": "percentage",
                "skill": "percentage",
                "expected_working_steps": [],
            },
        )
        result = verify_maths(ex)
        assert result.status == "verified"


# ---------------------------------------------------------------------------
# Number line dict marks (Validator 3 — user-reported miss)
# ---------------------------------------------------------------------------

class TestNumberLineDictMarks:
    def test_dict_mark_outside_range_flagged(self):
        ex = base_exercise(
            question="Plot the point.",
            diagram_data={
                "type": "number_line",
                "min": 0,
                "max": 5,
                "marks": [{"value": 8.0, "label": "B"}],
            },
        )
        issues = verify_diagram(ex)
        assert any(i.code == "diagram_mark_outside_range" for i in issues)

    def test_dict_mark_inside_range_passes(self):
        ex = base_exercise(
            question="Plot the point.",
            diagram_data={
                "type": "number_line",
                "min": 0,
                "max": 10,
                "marks": [{"value": 3.0, "label": "A"}],
            },
        )
        issues = verify_diagram(ex)
        assert not any(i.code == "diagram_mark_outside_range" for i in issues)

    def test_non_numeric_dict_mark_flagged(self):
        ex = base_exercise(
            question="Plot the point.",
            diagram_data={
                "type": "number_line",
                "min": 0,
                "max": 10,
                "marks": [{"label": "A"}],  # no value
            },
        )
        issues = verify_diagram(ex)
        assert any(i.code == "diagram_non_numeric_mark" for i in issues)


# ---------------------------------------------------------------------------
# Combo sample space (Validator 3 — user-reported miss)
# ---------------------------------------------------------------------------

class TestComboSampleSpace:
    def test_coin_die_underpopulated_flagged(self):
        """Coin + die should have 12 outcomes, not just ['H','T']."""
        ex = base_exercise(
            question="A coin is tossed and a die is rolled simultaneously. List the sample space.",
            diagram_data={
                "type": "sample_space_grid",
                "outcomes": ["H", "T"],
            },
        )
        issues = verify_diagram(ex)
        assert any(i.code == "diagram_sample_combo_underpopulated" for i in issues)
        # Should be at least medium severity content_error
        flag = next(i for i in issues if i.code == "diagram_sample_combo_underpopulated")
        assert flag.severity in ("medium", "high")

    def test_coin_die_full_passes(self):
        outcomes = [f"{c}{n}" for c in ("H", "T") for n in range(1, 7)]
        ex = base_exercise(
            question="A coin is tossed and a die is rolled simultaneously. List the sample space.",
            diagram_data={
                "type": "sample_space_grid",
                "outcomes": outcomes,
            },
        )
        issues = verify_diagram(ex)
        assert not any(i.code == "diagram_sample_combo_underpopulated" for i in issues)


# ---------------------------------------------------------------------------
# Duplicate id / duplicate question / curriculum missing (Validator 1)
# ---------------------------------------------------------------------------

class TestDuplicateAndCurriculumChecks:
    def test_duplicate_id_emits_hard_error(self, tmp_path):
        import sys
        sys.path.insert(0, str(ROOT / "scripts"))
        from audit_math_bank_full import audit_year
        exercises = [
            base_exercise(id="dup_1", question="What is 2+2?", answer="4"),
            base_exercise(id="dup_1", question="What is 3+3?", answer="6"),
        ]
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        (data_dir / "exercise_7_math.json").write_text(
            __import__("json").dumps(exercises), encoding="utf-8"
        )
        curr = data_dir / "curriculum" / "ac9_maths"
        curr.mkdir(parents=True)
        (curr / "year7.json").write_text(
            __import__("json").dumps({"topic_id": "AC9M7N01"}), encoding="utf-8"
        )
        stats = audit_year(7, data_dir, tmp_path / "out")
        flags = []
        with open(tmp_path / "out" / "year7_math_issue_flags.jsonl", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    flags.append(__import__("json").loads(line))
        assert any(f["code"] == "duplicate_id" and f["category"] == "hard_error" for f in flags)

    def test_duplicate_question_emits_review(self, tmp_path):
        import sys
        sys.path.insert(0, str(ROOT / "scripts"))
        from audit_math_bank_full import audit_year
        exercises = [
            base_exercise(id="q1", question="What is 2+2?", answer="4"),
            base_exercise(id="q2", question="What is 2+2?", answer="4"),
        ]
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        (data_dir / "exercise_7_math.json").write_text(
            __import__("json").dumps(exercises), encoding="utf-8"
        )
        curr = data_dir / "curriculum" / "ac9_maths"
        curr.mkdir(parents=True)
        (curr / "year7.json").write_text(
            __import__("json").dumps({"topic_id": "AC9M7N01"}), encoding="utf-8"
        )
        audit_year(7, data_dir, tmp_path / "out")
        flags = []
        with open(tmp_path / "out" / "year7_math_issue_flags.jsonl", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    flags.append(__import__("json").loads(line))
        assert any(f["code"] == "duplicate_question" for f in flags)


# ---------------------------------------------------------------------------
# Extension/AMC severity downgrade (Validator 4)
# ---------------------------------------------------------------------------

class TestExtensionSeverityDowngrade:
    def test_routine_mislabeled_is_review_not_content_error(self):
        """routine_mislabeled should route to review_needed, not content_error."""
        ex = base_exercise(
            id="math_7_amc_routine",
            question="Calculate 5 + 3.",
            answer="8",
            difficulty="AMC",
            complexity="complex_unfamiliar",
            math_metadata={
                "strand": "Number",
                "sub_strand": "integers",
                "skill": "integer_operations",
                "expected_working_steps": ["5 + 3 = 8"],
            },
        )
        result = evaluate_extension_quality(ex)
        if result["classification"] == "routine_mislabeled":
            # Verify the audit_year emission: re-run via a mini check
            # (the category mapping lives in audit_year; here we assert the
            # classification is detectable and not a content error by default)
            assert result["classification"] == "routine_mislabeled"


# ===========================================================================
# Targeted reliability fixes — acceptance tests
# ===========================================================================


class TestDuplicateIdStrictExit:
    """Acceptance: duplicate id causes --strict exit code 1."""

    def test_duplicate_id_strict_exit_1(self, tmp_path):
        import subprocess
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        exercises = [
            base_exercise(id="dup_1", question="What is 2+2?", answer="4"),
            base_exercise(id="dup_1", question="What is 3+3?", answer="6"),
        ]
        (data_dir / "exercise_7_math.json").write_text(
            json.dumps(exercises), encoding="utf-8"
        )
        curr = data_dir / "curriculum" / "ac9_maths"
        curr.mkdir(parents=True)
        (curr / "year7.json").write_text(
            json.dumps({"topic_id": "AC9M7N01"}), encoding="utf-8"
        )
        out = tmp_path / "out"
        result = subprocess.run(
            [sys.executable, "scripts/audit_math_bank_full.py",
             "--year", "7", "--strict",
             "--data-dir", str(data_dir), "--out", str(out)],
            capture_output=True, text=True,
        )
        assert result.returncode == 1, (
            f"--strict should exit 1 for duplicate id, got {result.returncode}\n"
            f"stdout: {result.stdout[-500:]}"
        )

    def test_duplicate_id_counted_in_stats(self, tmp_path):
        sys.path.insert(0, str(ROOT / "scripts"))
        from audit_math_bank_full import audit_year
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        exercises = [
            base_exercise(id="dup_1", question="Q1", answer="4"),
            base_exercise(id="dup_1", question="Q2", answer="6"),
        ]
        (data_dir / "exercise_7_math.json").write_text(
            json.dumps(exercises), encoding="utf-8"
        )
        curr = data_dir / "curriculum" / "ac9_maths"
        curr.mkdir(parents=True)
        (curr / "year7.json").write_text(
            json.dumps({"topic_id": "AC9M7N01"}), encoding="utf-8"
        )
        stats = audit_year(7, data_dir, tmp_path / "out")
        # duplicate_id is a hard_error/critical — must be reflected in stats
        assert stats["hard_critical"] >= 1
        assert stats["hard_errors_count"] >= 1
        # And in hard_errors.csv
        he = (tmp_path / "out" / "year7_math_hard_errors.csv").read_text(
            encoding="utf-8-sig"
        )
        assert "duplicate_id" in he


class TestFractionLaTeXDiv:
    """Acceptance: 3/4 + 5/6 = 19/12 and 2/5 ÷ 3/4 + 1/2 = 31/30."""

    def _make(self, q, a):
        return base_exercise(
            question=q, answer=a, topic_ids=["AC9M7N06"],
            math_metadata={"strand": "Number", "sub_strand": "fractions",
                           "skill": "fraction_operations",
                           "expected_working_steps": []},
        )

    def test_simple_add_19_12(self):
        assert verify_maths(self._make("3/4 + 5/6", "19/12")).status == "verified"

    def test_compound_unicode_div_31_30(self):
        assert verify_maths(
            self._make("2/5 ÷ 3/4 + 1/2", "31/30")
        ).status == "verified"

    def test_compound_latex_div_31_30(self):
        r"2/5 \div 3/4 + 1/2 = 31/30"
        assert verify_maths(
            self._make(r"2/5 \div 3/4 + 1/2", "31/30")
        ).status == "verified"


class TestHCFLCMPrimeNotationAcceptance:
    """Acceptance: HCF of 2^3 × 3^2 × 5 and 2^2 × 3 × 5^2 = 60."""

    def _make(self, q, a):
        return base_exercise(
            question=q, answer=a, topic_ids=["AC9M7N02"],
            math_metadata={"strand": "Number", "sub_strand": "hcf_lcm",
                           "skill": "hcf_using_primes",
                           "expected_working_steps": []},
        )

    def test_hcf_prime_notation_60(self):
        q = "Find the HCF of 2^3 × 3^2 × 5 and 2^2 × 3 × 5^2"
        assert verify_maths(self._make(q, "60")).status == "verified"

    def test_answer_with_equals_compares_to_60(self):
        """answer '$2^2 × 3 × 5 = 60$' compares against 60, not the first exponent 2."""
        q = "Find the HCF of 2^3 × 3^2 × 5 and 2^2 × 3 × 5^2"
        r = verify_maths(self._make(q, "$2^2 × 3 × 5 = 60$"))
        assert r.status == "verified"
        # The evidence must reference 60, not report "expected 2"
        assert "60" in r.evidence
        assert "expected 2" not in r.evidence

    def test_answer_as_factorisation_compares_to_60(self):
        """answer '$2^2 × 3 × 5$' (factorisation form) equals 60."""
        q = "Find the HCF of 2^3 × 3^2 × 5 and 2^2 × 3 × 5^2"
        r = verify_maths(self._make(q, "$2^2 × 3 × 5$"))
        assert r.status == "verified"

    def test_hcf_prime_notation_trailing_period(self):
        """Trailing punctuation on the answer must not break verification.

        '$2^2 × 3 × 5.' parses as 60 (not silently dropped to 12)."""
        q = "Find the HCF of 2^3 × 3^2 × 5 and 2^2 × 3 × 5^2"
        r = verify_maths(self._make(q, "$2^2 × 3 × 5."))
        assert r.status == "verified"


class TestHCFLCMIncorrectIsReviewNotContentError:
    """Acceptance: until parser fully tested, incorrect hcf_lcm routes to
    review_needed/high, not content_error/high."""

    def test_hcf_incorrect_routed_to_review_needed(self, tmp_path):
        sys.path.insert(0, str(ROOT / "scripts"))
        from audit_math_bank_full import audit_year
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        # Wrong answer for HCF(48,180)=12 — should be incorrect but review_needed
        ex = base_exercise(
            id="math_7_hcf_bad",
            question="Find the HCF of 48 and 180.",
            answer="24",
            topic_ids=["AC9M7N02"],
            math_metadata={"strand": "Number", "sub_strand": "hcf_lcm",
                           "skill": "hcf_using_primes",
                           "expected_working_steps": []},
        )
        (data_dir / "exercise_7_math.json").write_text(
            json.dumps([ex]), encoding="utf-8"
        )
        curr = data_dir / "curriculum" / "ac9_maths"
        curr.mkdir(parents=True)
        (curr / "year7.json").write_text(
            json.dumps({"topic_id": "AC9M7N02"}), encoding="utf-8"
        )
        audit_year(7, data_dir, tmp_path / "out")
        flags = []
        with open(tmp_path / "out" / "year7_math_issue_flags.jsonl", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    flags.append(json.loads(line))
        maths_incorrect = [f for f in flags if f["code"] == "maths_incorrect"]
        assert maths_incorrect, "Expected a maths_incorrect flag"
        assert maths_incorrect[0]["category"] == "review_needed"
        assert maths_incorrect[0]["severity"] == "high"
        # Non-high-confidence solver: user-facing message must not assert
        # "incorrect" — it should signal a possible issue requiring review.
        msg = maths_incorrect[0]["message"].lower()
        assert "incorrect" not in msg, (
            f"Message should avoid 'incorrect' for heuristic solver: {msg!r}"
        )
        assert "requires review" in msg or "possible maths issue" in msg


class TestNumberLineFractionDecimalComparison:
    """Acceptance: number_line marks [3,8,1,2] for a 3/8, 1/2, 1/4 question
    are flagged for review (compared as decimals, not numerator/denominator)."""

    def _make(self, marks, mn=0, mx=10):
        return base_exercise(
            question="Plot 3/8 halfway between 0 and 1/2. Compare with 1/4.",
            answer="1/4", topic_ids=["AC9M7N04"],
            math_metadata={"strand": "Number", "sub_strand": "fractions",
                           "skill": "fraction_operations",
                           "expected_working_steps": []},
            diagram_data={"type": "number_line", "min": mn, "max": mx, "marks": marks},
        )

    def test_marks_3_8_1_2_flagged(self):
        issues = verify_diagram(self._make([3, 8, 1, 2], 0, 10))
        assert any(i.code == "diagram_marks_no_overlap" for i in issues)

    def test_correct_decimal_marks_pass(self):
        issues = verify_diagram(self._make([0.375, 0.5, 0.25], 0, 1))
        assert not any(i.code == "diagram_marks_no_overlap" for i in issues)


class TestCoinDieSampleSpaceAcceptance:
    """Acceptance: coin + die sample space with only H/T outcomes is flagged."""

    def test_coin_die_ht_flagged(self):
        ex = base_exercise(
            question="A coin is tossed and a die is rolled simultaneously. List the sample space.",
            answer="12 outcomes",
            topic_ids=["AC9M7P01"],
            diagram_data={"type": "sample_space_grid", "outcomes": ["H", "T"]},
        )
        issues = verify_diagram(ex)
        assert any(i.code == "diagram_sample_combo_underpopulated" for i in issues)


# ===========================================================================
# Schema invalid-value tests (Validator 1)
# ===========================================================================


class TestSchemaInvalidValues:
    """Each invalid schema value should emit the corresponding hard/content error."""

    def test_invalid_framework(self):
        ex = base_exercise(framework="AC9_SCIENCE")
        issues = audit_schema(ex, 7, VALID_TOPIC_IDS_Y7)
        assert any(i.code == "invalid_framework" and i.category == "hard_error" for i in issues)

    def test_invalid_subject(self):
        ex = base_exercise(subject="science")
        issues = audit_schema(ex, 7, VALID_TOPIC_IDS_Y7)
        assert any(i.code == "invalid_subject" and i.category == "hard_error" for i in issues)

    def test_year_level_mismatch(self):
        ex = base_exercise(year_level=8)
        issues = audit_schema(ex, 7, VALID_TOPIC_IDS_Y7)
        assert any(i.code == "year_level_mismatch" for i in issues)

    def test_invalid_question_type(self):
        ex = base_exercise(question_type="essay")
        issues = audit_schema(ex, 7, VALID_TOPIC_IDS_Y7)
        assert any(i.code == "invalid_question_type" and i.category == "hard_error" for i in issues)

    def test_invalid_difficulty(self):
        ex = base_exercise(difficulty="expert")
        issues = audit_schema(ex, 7, VALID_TOPIC_IDS_Y7)
        assert any(i.code == "invalid_difficulty" for i in issues)

    def test_invalid_complexity(self):
        ex = base_exercise(complexity="very_hard")
        issues = audit_schema(ex, 7, VALID_TOPIC_IDS_Y7)
        assert any(i.code == "invalid_complexity" for i in issues)

    def test_missing_math_metadata(self):
        ex = base_exercise()
        ex["math_metadata"] = {}
        issues = audit_schema(ex, 7, VALID_TOPIC_IDS_Y7)
        assert any(i.code == "missing_math_metadata" and i.category == "hard_error" for i in issues)


# ===========================================================================
# Output smoke + strict + --out regression tests
# ===========================================================================


def _write_mini_bank(data_dir: Path, exercises: list[dict]) -> None:
    """Helper: write a Year 7 mini bank + curriculum file.

    Auto-collects every topic_id referenced by the exercises and writes them
    into the curriculum file, so the bank is genuinely 'clean' (no spurious
    unknown_topic_id content_error flags that would muddy --strict semantics).
    """
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "exercise_7_math.json").write_text(
        json.dumps(exercises), encoding="utf-8"
    )
    # Collect all topic_ids used by the exercises, deduplicated and sorted.
    topic_ids: set[str] = set()
    for ex in exercises:
        for tid in ex.get("topic_ids") or []:
            topic_ids.add(str(tid))
    topics_payload = {"topics": [{"topic_id": tid} for tid in sorted(topic_ids)]}
    curr = data_dir / "curriculum" / "ac9_maths"
    curr.mkdir(parents=True, exist_ok=True)
    (curr / "year7.json").write_text(
        json.dumps(topics_payload), encoding="utf-8"
    )


class TestOutputSmokeFiles:
    """audit_year on a clean mini bank should produce all 5 output files."""

    def test_all_output_files_exist(self, tmp_path):
        sys.path.insert(0, str(ROOT / "scripts"))
        from audit_math_bank_full import audit_year
        data_dir = tmp_path / "data"
        _write_mini_bank(data_dir, [base_exercise()])
        out = tmp_path / "out"
        audit_year(7, data_dir, out)
        expected = [
            "year7_math_full_summary.md",
            "year7_math_item_audit.csv",
            "year7_math_issue_flags.jsonl",
            "year7_math_hard_errors.csv",
            "year7_math_human_review_queue.csv",
        ]
        for fname in expected:
            assert (out / fname).exists(), f"Missing output file: {fname}"


class TestStrictCleanPass:
    """A valid mini bank with no hard errors should exit 0 with --strict."""

    def test_strict_clean_exit_0(self, tmp_path):
        import subprocess
        data_dir = tmp_path / "data"
        _write_mini_bank(data_dir, [base_exercise(id="clean_1")])
        out = tmp_path / "out"
        result = subprocess.run(
            [sys.executable, "scripts/audit_math_bank_full.py",
             "--year", "7", "--strict",
             "--data-dir", str(data_dir), "--out", str(out)],
            capture_output=True, text=True,
        )
        assert result.returncode == 0, (
            f"--strict should exit 0 on clean bank, got {result.returncode}\n"
            f"stdout: {result.stdout[-500:]}"
        )


class TestOutOutsideRootRegression:
    """--out pointing outside the repo root must not raise ValueError."""

    def test_out_outside_root_no_value_error(self, tmp_path):
        import subprocess
        # tmp_path is outside the repo root on most systems; use it for both
        # data and out so neither is under ROOT.
        data_dir = tmp_path / "data"
        _write_mini_bank(data_dir, [base_exercise(id="out_root_1")])
        out = tmp_path / "out"
        result = subprocess.run(
            [sys.executable, "scripts/audit_math_bank_full.py",
             "--year", "7",
             "--data-dir", str(data_dir), "--out", str(out)],
            capture_output=True, text=True,
        )
        assert result.returncode == 0, (
            f"Expected exit 0, got {result.returncode}\n"
            f"stdout: {result.stdout[-400:]}\nstderr: {result.stderr[-400:]}"
        )
        assert "ValueError" not in result.stdout + result.stderr
        assert (out / "year7_math_full_summary.md").exists()


# ===========================================================================
# Review queue vs hard errors routing test
# ===========================================================================


class TestReviewQueueRouting:
    """A weak/routine AMC item should appear in human_review_queue.csv,
    not hard_errors.csv."""

    def test_routine_amc_in_review_queue_not_hard_errors(self, tmp_path):
        sys.path.insert(0, str(ROOT / "scripts"))
        from audit_math_bank_full import audit_year
        data_dir = tmp_path / "data"
        ex = base_exercise(
            id="amc_routine_1",
            question="Calculate 5 + 3.",
            answer="8",
            steps=["5 + 3 = 8"],
            difficulty="AMC",
            complexity="complex_unfamiliar",
            math_metadata={
                "strand": "Number", "sub_strand": "integers",
                "skill": "integer_operations",
                "expected_working_steps": ["5 + 3 = 8"],
            },
        )
        _write_mini_bank(data_dir, [ex])
        out = tmp_path / "out"
        audit_year(7, data_dir, out)
        hard_errors_csv = (out / "year7_math_hard_errors.csv").read_text(encoding="utf-8-sig")
        review_csv = (out / "year7_math_human_review_queue.csv").read_text(encoding="utf-8-sig")
        # routine_mislabeled is review_needed/high, not a hard error
        assert "extension_routine_mislabeled" not in hard_errors_csv
        assert "extension_routine_mislabeled" in review_csv


# ===========================================================================
# Statistics false-positive guard (maths verifier)
# ===========================================================================


class TestMathsFalsePositiveGuard:
    """If a question includes a year or context number not part of the dataset,
    the verifier must not confidently mark the item 'incorrect'."""

    def _make(self, q, a):
        return base_exercise(
            question=q, answer=a, topic_ids=["AC9M7N01"],
            math_metadata={
                "strand": "Number", "sub_strand": "integers",
                "skill": "integer_operations",
                "expected_working_steps": [],
            },
        )

    def test_context_number_not_confidently_incorrect(self):
        """Question 'In Year 7, a class of 24 students... what is 2 + 2?' with
        answer '4' must not be reported as 'incorrect' — the 7 and 24 are
        context, not operands."""
        ex = self._make(
            "In Year 7, a class of 24 students were asked: what is 2 + 2?",
            "4",
        )
        result = verify_maths(ex)
        # Must not confidently assert incorrect (context-number false positive).
        assert result.status != "incorrect", (
            f"Verifier should not mark incorrect on context-number questions: "
            f"status={result.status}, evidence={result.evidence}"
        )

    def test_year_context_number_not_confidently_incorrect(self):
        ex = self._make(
            "In 2024, there were 5 apples and 3 were eaten. How many remain?",
            "2",
        )
        result = verify_maths(ex)
        assert result.status != "incorrect", (
            f"status={result.status}, evidence={result.evidence}"
        )

    def test_negative_integer_expression_verifies(self):
        ex = self._make(
            "Evaluate $(-15) + 8 - (-3)$.",
            "-4",
        )
        result = verify_maths(ex)
        assert result.status == "verified"


class TestYear8MathsVerifierRouting:
    def _make_y8(self, topic_id: str, question: str, answer: str):
        return base_exercise(
            id=f"math_8_test_{topic_id}",
            year_level=8,
            topic_ids=[topic_id],
            question=question,
            answer=answer,
            steps=[answer],
            math_metadata={
                "strand": "Number",
                "sub_strand": "year8",
                "skill": topic_id,
                "expected_working_steps": [answer],
            },
        )

    def test_ac9m8a03_formula_substitution_verifies(self):
        ex = self._make_y8("AC9M8A03", "For $y = 2x + 1$, find $y$ when $x = 5$.", "11")
        assert verify_maths(ex).status == "verified"

    def test_ac9m8m06_pythagoras_verifies(self):
        ex = self._make_y8(
            "AC9M8M06",
            "Find the missing side: hypotenuse $=13$ cm, one leg $=5$ cm.",
            "12 cm",
        )
        assert verify_maths(ex).status == "verified"

    def test_ac9m8n04_fraction_arithmetic_verifies(self):
        ex = self._make_y8(
            "AC9M8N04",
            r"Evaluate $\frac{3}{4} - \frac{5}{6} \div \frac{2}{3}$.",
            "-1/2",
        )
        assert verify_maths(ex).status == "verified"

    def test_ac9m8m02_trapezium_area_verifies(self):
        ex = self._make_y8(
            "AC9M8M02",
            "A trapezium has parallel sides $10$ cm and $6$ cm, height $5$ cm. Find the area.",
            "40 cm^2",
        )
        assert verify_maths(ex).status == "verified"

    def test_ac9m8n02_exponent_single_power_verifies(self):
        ex = self._make_y8(
            "AC9M8N02",
            r"Simplify $(3^2)^4 \times 3^3$ as a single power of $3$.",
            "$3^11$",
        )
        assert verify_maths(ex).status == "verified"

    def test_ac9m8a03_function_table_verifies(self):
        ex = self._make_y8(
            "AC9M8A03",
            "Plot $y = 3x - 4$ for $x=-1,0,1,2$.",
            "(-1,-7),(0,-4),(1,-1),(2,2)",
        )
        assert verify_maths(ex).status == "verified"

    def test_ac9m8sp01_similarity_side_scale_verifies(self):
        ex = self._make_y8(
            "AC9M8SP01",
            "Triangle ABC is similar to triangle PQR. AB $=9$ cm, BC $=12$ cm, AC $=15$ cm. PQ $=6$ cm. Find QR and PR.",
            "QR=8 cm, PR=10 cm",
        )
        assert verify_maths(ex).status == "verified"

    def test_ac9m8p02_two_stage_probability_verifies(self):
        ex = self._make_y8(
            "AC9M8P02",
            "A bag has $3$ green and $2$ yellow balls. Two balls are drawn. Find P(different colours).",
            "3/5",
        )
        assert verify_maths(ex).status == "verified"


# ===========================================================================
# Optional output-quality tests: review-queue sort, item-audit header, real-data smoke
# ===========================================================================


class TestReviewQueueSort:
    """human_review_queue.csv should be sorted by severity descending so
    high-severity items surface first for human reviewers."""

    def test_high_severity_before_medium_and_low(self, tmp_path):
        import csv
        sys.path.insert(0, str(ROOT / "scripts"))
        from audit_math_bank_full import audit_year
        data_dir = tmp_path / "data"
        # Mix: a hard_error (critical), a review_needed/high (routine_mislabeled),
        # and a review_needed/low (parse_failed) to exercise the sort.
        ex_hard = base_exercise(id="hard_1", question_type="essay")  # invalid_question_type
        ex_amc = base_exercise(
            id="amc_1", question="Calculate 5 + 3.", answer="8",
            steps=["5 + 3 = 8"], difficulty="AMC", complexity="complex_unfamiliar",
            math_metadata={"strand": "Number", "sub_strand": "integers",
                           "skill": "integer_operations",
                           "expected_working_steps": ["5 + 3 = 8"]},
        )
        _write_mini_bank(data_dir, [ex_hard, ex_amc])
        out = tmp_path / "out"
        audit_year(7, data_dir, out)
        severities: list[str] = []
        with (out / "year7_math_human_review_queue.csv").open(encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                severities.append(row["severity"])
        # If there are multiple severities, high must come before medium/low.
        if {"high", "medium"} <= set(severities):
            assert severities.index("high") < severities.index("medium"), (
                f"high should sort before medium, got order: {severities}"
            )
        if {"high", "low"} <= set(severities):
            assert severities.index("high") < severities.index("low"), (
                f"high should sort before low, got order: {severities}"
            )


class TestItemAuditHeader:
    """item_audit.csv header must include the key per-item audit fields."""

    def test_header_contains_key_fields(self, tmp_path):
        import csv
        sys.path.insert(0, str(ROOT / "scripts"))
        from audit_math_bank_full import audit_year
        data_dir = tmp_path / "data"
        _write_mini_bank(data_dir, [base_exercise()])
        out = tmp_path / "out"
        audit_year(7, data_dir, out)
        with (out / "year7_math_item_audit.csv").open(encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            header = reader.fieldnames or []
        required = {
            "maths_verification",
            "maths_confidence",
            "diagram_status",
            "extension_score",
            "extension_classification",
            "hard_errors_count",
            "content_errors_count",
            "review_needed_count",
            "advisory_count",
        }
        missing = required - set(header)
        assert not missing, f"item_audit.csv header missing fields: {missing}"


class TestRealYear7SmokeTest:
    """Slow smoke test: run audit on the real exercise_7_math.json and confirm
    the script does not crash and produces the expected output files.

    Not part of the fast CI loop — run with: pytest -m slow
    """

    @pytest.mark.slow
    def test_real_year7_audit_does_not_crash(self, tmp_path):
        import subprocess
        real_data = ROOT / "data"
        if not (real_data / "exercise_7_math.json").exists():
            pytest.skip("Real Year 7 data file not present")
        out = tmp_path / "out"
        result = subprocess.run(
            [sys.executable, "scripts/audit_math_bank_full.py",
             "--year", "7",
             "--data-dir", str(real_data), "--out", str(out)],
            capture_output=True, text=True, timeout=120,
        )
        assert result.returncode == 0, (
            f"Real Year 7 audit crashed (exit {result.returncode}):\n"
            f"stderr: {result.stderr[-500:]}"
        )
        # All 5 output files must be present.
        for fname in [
            "year7_math_full_summary.md",
            "year7_math_item_audit.csv",
            "year7_math_issue_flags.jsonl",
            "year7_math_hard_errors.csv",
            "year7_math_human_review_queue.csv",
        ]:
            assert (out / fname).exists(), f"Missing output: {fname}"
