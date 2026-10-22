"""Unit tests for backend/answer_normalize.py — Task 4 Verification."""
from __future__ import annotations

from fractions import Fraction

import pytest

from backend.answer_normalize import (
    CanonicalAnswerForm,
    normalise,
    signatures,
    are_equivalent,
    are_equivalent_with_metadata,
)


class TestNormaliseInteger:
    def test_integer_7(self):
        result = normalise("7")
        assert result.integer == 7
        assert result.decimal == Fraction(7)

    def test_negative_integer(self):
        result = normalise("-3")
        assert result.integer == -3
        assert result.decimal == Fraction(-3)


class TestNormaliseEnglishWord:
    def test_seven(self):
        result = normalise("seven")
        assert result.integer == 7

    def test_twelve(self):
        result = normalise("twelve")
        assert result.integer == 12

    def test_zero(self):
        result = normalise("zero")
        assert result.integer == 0


class TestNormaliseFraction:
    def test_three_quarters(self):
        result = normalise("3/4")
        assert result.fraction == (3, 4)
        assert result.decimal == Fraction(3, 4)

    def test_reduces_to_lowest_terms(self):
        result = normalise("6/8")
        assert result.fraction == (3, 4)
        assert result.decimal == Fraction(3, 4)


class TestNormaliseSpelledFraction:
    def test_three_over_four(self):
        result = normalise("three over four")
        assert result.fraction == (3, 4)

    def test_one_over_two(self):
        result = normalise("one over two")
        assert result.fraction == (1, 2)


class TestNormaliseDecimal:
    def test_075(self):
        result = normalise("0.75")
        assert result.decimal == Fraction(3, 4)

    def test_negative_decimal(self):
        result = normalise("-1.5")
        assert result.decimal == Fraction(-3, 2)


class TestNormaliseValueWithUnit:
    def test_15_cm_squared_unicode(self):
        result = normalise("15 cm²")
        assert result.value_with_unit == (Fraction(15), "cm^2")

    def test_15_cm_squared_caret(self):
        result = normalise("15 cm^2")
        assert result.value_with_unit == (Fraction(15), "cm^2")

    def test_value_with_simple_unit(self):
        result = normalise("10 km")
        assert result.value_with_unit == (Fraction(10), "km")


class TestNormaliseFallback:
    def test_empty_string(self):
        result = normalise("")
        assert result.text_words == ""

    def test_hello_world(self):
        result = normalise("hello world")
        assert result.text_words == "hello world"

    def test_malformed_input(self):
        result = normalise("abc/xyz")
        assert result.text_words is not None


class TestTotality:
    """Confirm normalise never raises for any input."""

    @pytest.mark.parametrize("inp", [
        "", " ", "abc", "3/0", "///", None, "   7   ", "SEVEN",
        "three over zero", "99999999999999999999", "1.2.3",
    ])
    def test_never_raises(self, inp):
        # Should not raise
        result = normalise(inp)
        assert isinstance(result, CanonicalAnswerForm)


class TestDeterminism:
    """Same input → same output."""

    @pytest.mark.parametrize("inp", ["7", "3/4", "0.75", "seven", "15 cm²", "hello"])
    def test_deterministic(self, inp):
        assert normalise(inp) == normalise(inp)


class TestSignatures:
    def test_fraction_signatures(self):
        sigs = signatures("3/4")
        assert "3/4" in sigs
        assert "0.75" in sigs
        assert "three over four" in sigs

    def test_integer_signatures(self):
        sigs = signatures("7")
        assert "7" in sigs
        assert "seven" in sigs

    def test_decimal_signatures(self):
        sigs = signatures("0.75")
        assert "0.75" in sigs
        assert "3/4" in sigs

    def test_empty_string(self):
        sigs = signatures("")
        assert sigs == set()


class TestCorrectSyntax:
    def test_unicode_symbols(self):
        from backend.answer_normalize import correct_syntax
        assert correct_syntax("√16") == "sqrt(16)"
        assert correct_syntax("√(16)") == "sqrt(16)"
        assert correct_syntax("√(x+2)") == "sqrt(x+2)"
        assert correct_syntax("x²") == "x^2"
        assert correct_syntax("x^2") == "x^2"
        assert correct_syntax("x^(y)") == "x^(y)"
        assert correct_syntax("π") == "pi"
        assert correct_syntax("θ") == "theta"
        assert correct_syntax("2×3") == "2*3"
        assert correct_syntax("6÷2") == "6/2"
        assert correct_syntax("a≤b") == "a<=b"
        assert correct_syntax("a≥b") == "a>=b"
        assert correct_syntax("a≠b") == "a!=b"

    def test_digit_implicit_multiplication(self):
        from backend.answer_normalize import correct_syntax
        assert correct_syntax("6x") == "6*x"
        assert correct_syntax("3(2+1)") == "3*(2+1)"


class TestAreEquivalent:
    def test_algebraic_expression_equivalence(self):
        assert are_equivalent("2a + 7b", "7b + 2a")
        assert are_equivalent("x^2 + 2x + 1", "(x+1)^2")
        assert are_equivalent(".5", "0.5")
        assert are_equivalent("1.e3", "1000")
        assert are_equivalent("α + 1", "alpha + 1")
        assert are_equivalent("2A + 3", "3 + 2A")
        assert not are_equivalent("2a + 7b", "2a + 8b")

    def test_equation_equivalence(self):
        # Swapped term order in RHS formula
        assert are_equivalent("C = 2d + 3", "C = 3 + 2d")
        assert are_equivalent("C = 3 + 2*d", "C = 3 + 2d")
        # Swapped LHS and RHS
        assert are_equivalent("3 + 2d = C", "C = 3 + 2d")
        assert are_equivalent("2*d + 3 = C", "C = 3 + 2d")
        # Student omitted LHS or RHS
        assert are_equivalent("3 + 2d", "C = 3 + 2d")
        assert are_equivalent("2d + 3", "C = 3 + 2d")
        assert are_equivalent("3 + 2d", "3 + 2d = C")
        # Student wrote equation, correct is expression
        assert are_equivalent("C = 3 + 2d", "3 + 2d")
        assert are_equivalent("3 + 2d = C", "3 + 2d")
        # Non-equivalent cases
        assert not are_equivalent("C = 2d + 4", "C = 3 + 2d")
        assert not are_equivalent("P = 3 + 2d", "C = 3 + 2d")
        assert not are_equivalent("C = 3 + 2d", "3 + 4d")

    def test_numerical_and_unit_equivalence(self):
        assert are_equivalent("15 cm²", "15 cm^2")
        assert are_equivalent("15", "15 cm^2")  # allow optional unit
        assert are_equivalent("1.5", "3/2")
        assert are_equivalent("1.5 L", "1.5 L")
        assert are_equivalent("10", "10 hours")
        assert are_equivalent("10 h", "10 hours")
        assert are_equivalent("10 hr", "10")
        assert are_equivalent("120 seconds", "120 s")

    def test_rounding_tolerance_for_decimals(self):
        # Decimals within 2% tolerance are equivalent
        assert are_equivalent("3.14", "3.14159")
        assert are_equivalent("3.14159", "3.14")
        assert are_equivalent("1.33", "4/3")
        assert are_equivalent("1.3333333333333333", "4/3")
        assert are_equivalent("9.9", "10")  # 1% difference, is_non_integer(9.9) is True
        
        # Outside 2% tolerance are not equivalent
        assert not are_equivalent("1.3", "4/3")  # ~2.5% difference
        assert not are_equivalent("3.3", "3.14159")  # ~5% difference

        # Integers must match exactly (no tolerance applied when both are integers)
        assert not are_equivalent("4", "5")
        assert not are_equivalent("14", "15")

    def test_currency_and_latex_escapes(self):
        # Escaped dollar signs in database, standard dollars and plain integers are equivalent
        assert are_equivalent("27", "\\\\\\$27")
        assert are_equivalent("$27", "\\\\\\$27")
        assert are_equivalent("\\$27", "\\\\\\$27")
        assert are_equivalent("27", "$27")
        assert are_equivalent("-$27", "-27")
        assert are_equivalent("$-27", "-27")
        assert are_equivalent("$27 cm", "27 cm")

    def test_item_specific_absolute_tolerance(self):
        tolerance = {"type": "numeric", "absolute": 0.5}
        assert are_equivalent_with_metadata("12 m", "12.4 m", answer_tolerance=tolerance)
        assert not are_equivalent_with_metadata("11 m", "12.4 m", answer_tolerance=tolerance)

    def test_item_specific_relative_tolerance(self):
        tolerance = {"type": "numeric", "relative": 0.01}
        assert are_equivalent_with_metadata("99.2", "100", answer_tolerance=tolerance)
        assert not are_equivalent_with_metadata("98.0", "100", answer_tolerance=tolerance)

    def test_math_alternative_answers(self):
        assert are_equivalent_with_metadata(
            "0.375",
            "3/8",
            alternative_answers=["three eighths", "0.375"],
        )

    def test_thousands_separator_commas_are_equivalent(self):
        assert are_equivalent("407,020", "407020")
        assert are_equivalent("407020", "407,020")
        assert are_equivalent("1,000,000", "1000000")
        assert are_equivalent("12,345.67", "12345.67")
        assert are_equivalent("407,020 m", "407020 m")
        assert not are_equivalent("1,2,3", "1,2,345")


class TestLatexAnswerKeys:
    """Typed answers must match LaTeX answer keys the same way they match plain keys."""

    @pytest.mark.parametrize(("student", "key"), [
        # Escaped percent
        ("42%", r"42\%"),
        ("42", r"42\%"),
        ("85.7%", r"$85.7\%$"),
        # Inequalities, typed or from the maths keyboard
        ("x<=1", r"x \leq 1"),
        ("x ≤ 1", r"x \leq 1"),
        ("x>=-4", r"x \geq - 4"),
        ("x ≥ -4", r"x \ge - 4"),
        ("y>=3x-6", r"y \geq 3 x - 6"),
        ("x ≠ 2", r"x \neq 2"),
        # Mixed numbers
        ("7 2/3", r"7\frac{2}{3}"),
        ("23/3", r"7\frac{2}{3}"),
        ("-1 5/7", r"- 1\frac{5}{7}"),
        ("-12/7", r"-1\frac{5}{7}"),
        ("2 1/2", r"2\dfrac{1}{2}"),
        ("62.5%", r"62\frac{1}{2}\%"),
        # Spaces in algebraic terms
        ("64k^2", r"64 k^{2}"),
        ("64k²", r"64 k^{2}"),
        ("4n/5", r"\frac{4 n}{5}"),
        ("-14vw-4v^2w", r"- 14 v w - 4 v^{2} w"),
        ("5(10x^3-3)", r"5 \left( 10 x^{3} - 3\right)"),
        ("4^7/5", r"\frac{4^{7}}{5}"),
        ("x*y/2", r"\frac{x y}{2}"),
        ("2π", r"2\pi"),
        # Units written with \text and thin spaces
        ("46", r"$46\text{ m}$"),
        ("46 m", r"$46\text{ m}$"),
        ("33 cm^2", r"$33\text{ cm}^2$"),
        ("28", "$28$ cm"),
        ("2400 m^2", r"$2400\,\text{m}^2$"),
        ("10000", r"$10\,000$"),
        # Degrees
        ("65", r"$65^\circ$"),
        ("65°", r"65^{\circ}"),
        ("-9°C", r"$-9^\circ\text{C}$"),
        # A leading approximately-equal sign
        ("16.7%", r"$\approx 16.7\%$"),
        # Angle names and sets
        ("∠PXQ", r"\angle PXQ"),
        ("{1, 2, 3}", r"\left\lbrace{}1, 2, 3\right\rbrace{}"),
    ])
    def test_typed_answer_matches_latex_key(self, student, key):
        assert are_equivalent_with_metadata(student, key)

    @pytest.mark.parametrize(("student", "key"), [
        ("43%", r"42\%"),
        ("x<1", r"x \leq 1"),
        ("x>=1", r"x \leq 1"),
        # 7 2/3 is not 7 x 2/3, and 2 1/2 is not 2 x 1/2.
        ("14/3", r"7\frac{2}{3}"),
        ("1", r"2\frac{1}{2}"),
        ("72/3", r"7\frac{2}{3}"),
        ("64k^3", r"64 k^{2}"),
        ("46 cm", r"$46\text{ m}$"),
        ("66", r"$65^\circ$"),
        ("65°F", r"65^{\circ}"),
        # Exact fractions must be equal; the 2% tolerance is for decimals only.
        ("9 1/3", r"9\frac{1}{2}"),
        ("48/10", r"4\frac{8}{9}"),
        ("38", r"37\frac{1}{2}\%"),
        ("28/3", "19/2"),
    ])
    def test_wrong_answer_still_does_not_match(self, student, key):
        assert not are_equivalent_with_metadata(student, key)

    def test_decimal_rounding_of_a_fraction_key_is_still_accepted(self):
        assert are_equivalent("9.33", "28/3")
        assert are_equivalent("7.67", r"7\frac{2}{3}")

    def test_numeric_equations_compare_their_sides(self):
        # Any two true number sentences have a zero difference; that is not equivalence.
        assert not are_equivalent("0.6*150=90", "117/180=0.65")
        assert not are_equivalent(r"$1.5^2=2.25$.", r"$\frac{5}{12}\times\frac{4}{11}=\frac{5}{33}$.")
        assert are_equivalent("0.65", r"$117/180=0.65$.")
        assert are_equivalent("117/180 = 0.65", "117/180=0.65")

    def test_strip_latex_math_gives_typeable_text(self):
        from backend.answer_normalize import strip_latex_math
        assert strip_latex_math(r"42\%") == "42%"
        assert strip_latex_math(r"x \leq 1") == "x ≤ 1"
        assert strip_latex_math(r"7\frac{2}{3}") == "7 2/3"
        assert strip_latex_math(r"$46\text{ m}$") == "46 m"
        assert strip_latex_math(r"65^{\circ}") == "65°"

    def test_normalise_mixed_numbers_and_degrees(self):
        assert normalise("7 2/3").fraction == (23, 3)
        assert normalise("-1 5/7").decimal == Fraction(-12, 7)
        assert normalise("62 1/2%").value_with_unit == (Fraction(125, 2), "%")
        assert normalise("65°").value_with_unit == (Fraction(65), "deg")

    def test_correct_syntax_multiplies_across_spaces(self):
        from backend.answer_normalize import correct_syntax
        assert correct_syntax("64 k^2") == "64*k^2"
        assert correct_syntax("2 a b") == "2*a*b"
        assert correct_syntax("5 (x+1)") == "5*(x+1)"
