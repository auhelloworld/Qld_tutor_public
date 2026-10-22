"""Unit tests for backend/misconception_predicates.py (Task 12.2).

Each predicate gets a positive case, a negative case, and a malformed-input case.
"""
import pytest

from backend.misconception_predicates import (
    PREDICATE_REGISTRY,
    area_perimeter_swap,
    decimal_place_value_misalignment,
    fraction_addition_added_denominators,
    inequality_flip_forgotten,
    negative_squared,
    square_root_as_half,
)


class TestNegativeSquared:
    def test_positive_case(self):
        """Student gives 9 when correct is -9 (treats (-3)² as -(3²))."""
        assert negative_squared({}, "9", "-9") is True

    def test_negative_case(self):
        """Student gives correct answer."""
        assert negative_squared({}, "-9", "-9") is False

    def test_positive_correct_not_triggered(self):
        """When correct is positive, predicate should not trigger."""
        assert negative_squared({}, "9", "9") is False

    def test_malformed_input(self):
        """Non-numeric input returns False, never raises."""
        assert negative_squared({}, "abc", "-9") is False
        assert negative_squared({}, "", "-9") is False
        assert negative_squared({}, None, "-9") is False


class TestAreaPerimeterSwap:
    def test_positive_case_perimeter_gives_area(self):
        """Student gives area when asked for perimeter."""
        question = {
            "question": "Find the perimeter of the rectangle",
            "diagram_data": {"labels": {"width": "5", "height": "3"}},
        }
        # Perimeter = 2*(5+3) = 16, Area = 5*3 = 15
        assert area_perimeter_swap(question, "15", "16") is True

    def test_negative_case(self):
        """Student gives correct answer."""
        question = {
            "question": "Find the perimeter of the rectangle",
            "diagram_data": {"labels": {"width": "5", "height": "3"}},
        }
        assert area_perimeter_swap(question, "16", "16") is False

    def test_no_keywords(self):
        """Question without area/perimeter keywords."""
        question = {"question": "Calculate the value"}
        assert area_perimeter_swap(question, "15", "16") is False

    def test_malformed_input(self):
        """Non-numeric input returns False."""
        question = {"question": "Find the perimeter"}
        assert area_perimeter_swap(question, "abc", "16") is False


class TestInequalityFlipForgotten:
    def test_positive_case(self):
        """Student gives x > -3 when correct is x < -3."""
        assert inequality_flip_forgotten({}, "x > -3", "x < -3") is True

    def test_negative_case(self):
        """Student gives correct answer."""
        assert inequality_flip_forgotten({}, "x < -3", "x < -3") is False

    def test_different_numbers(self):
        """Different numbers should not trigger."""
        assert inequality_flip_forgotten({}, "x > 5", "x < -3") is False

    def test_malformed_input(self):
        """Non-inequality input returns False."""
        assert inequality_flip_forgotten({}, "hello", "x < -3") is False


class TestFractionAdditionAddedDenominators:
    def test_positive_case(self):
        """Student gives 2/5 for 1/2 + 1/3 (naive addition)."""
        question = {"question": "Calculate 1/2 + 1/3"}
        assert fraction_addition_added_denominators(question, "2/5", "5/6") is True

    def test_negative_case(self):
        """Student gives correct answer."""
        question = {"question": "Calculate 1/2 + 1/3"}
        assert fraction_addition_added_denominators(question, "5/6", "5/6") is False

    def test_no_fractions_in_question(self):
        """Question without fractions."""
        question = {"question": "What is 5 + 3?"}
        assert fraction_addition_added_denominators(question, "2/5", "8") is False

    def test_malformed_input(self):
        """Non-fraction input returns False."""
        question = {"question": "Calculate 1/2 + 1/3"}
        assert fraction_addition_added_denominators(question, "abc", "5/6") is False


class TestDecimalPlaceValueMisalignment:
    def test_negative_case_correct_answer(self):
        """Student gives correct answer."""
        question = {"question": "Calculate 1.5 + 2.35"}
        assert decimal_place_value_misalignment(question, "3.85", "3.85") is False

    def test_no_decimals_in_question(self):
        """Question without decimals."""
        question = {"question": "What is 5 + 3?"}
        assert decimal_place_value_misalignment(question, "9", "8") is False

    def test_malformed_input(self):
        """Non-numeric input returns False."""
        question = {"question": "Calculate 1.5 + 2.35"}
        assert decimal_place_value_misalignment(question, "abc", "3.85") is False


class TestSquareRootAsHalf:
    @pytest.mark.parametrize(
        "question",
        [r"Evaluate $\sqrt{36}$.", "Evaluate √36.", "Find the square root of 36."],
    )
    def test_positive_forms(self, question):
        assert square_root_as_half({"question": question}, "18", "6") is True

    def test_negative_and_malformed(self):
        question = {"question": r"Evaluate $\sqrt{36}$."}
        assert square_root_as_half(question, "6", "6") is False
        assert square_root_as_half(question, "12", "6") is False
        assert square_root_as_half(question, "not-a-number", "6") is False


class TestPredicateRegistry:
    def test_all_predicates_registered(self):
        """All predicates are in the registry."""
        assert len(PREDICATE_REGISTRY) == 26
        expected = [
            "negative_squared",
            "area_perimeter_swap",
            "inequality_flip_forgotten",
            "fraction_addition_added_denominators",
            "decimal_place_value_misalignment",
            "square_root_as_half",
            "missing_grouping_brackets",
            "equation_inverse_one_side_only",
            "linear_pattern_missing_constant",
            "cointerior_treated_as_equal",
            "triangle_missing_angle_no_subtract_from_180",
            "ratio_model_missing_context_interpretation",
            "hcf_lcm_exponents_reversed",
            "prime_factorisation_missing_repeated_factor_or_power",
            "ratio_additive_scaling",
            "xy_swap",
            "short_run_must_match_theory",
            "statistical_conclusion_missing_evidence",
            "stem_leaf_unsorted_or_missing_key",
            "integration_missing_constant",
            "probability_added_instead_of_multiplied",
            "complement_probability_confused",
            "degrees_radians_confused",
            "log_of_sum_split",
            "permutation_combination_confused",
            "opinion_without_textual_evidence",
        ]
        for name in expected:
            assert name in PREDICATE_REGISTRY, f"{name} not in registry"

    def test_all_predicates_callable(self):
        """All registry entries are callable."""
        for name, fn in PREDICATE_REGISTRY.items():
            assert callable(fn), f"{name} is not callable"
