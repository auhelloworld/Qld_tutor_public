"""Hand-curated Python predicates referenced by predicate-kind signatures.

Each predicate takes (question_dict, student_answer_str, correct_answer_str) -> bool.
Predicates are registered in PREDICATE_REGISTRY; signatures reference them by name.

Design §3.2 — misconception-library spec.
"""
from __future__ import annotations

import re


def negative_squared(question: dict, student: str, correct: str) -> bool:
    """Detects student treats (-3)² as -(3²), i.e. gives +9 when answer is -9.

    Triggers when the correct answer is negative and the student gives its
    absolute value (positive counterpart).
    """
    try:
        if not student or not correct:
            return False
        s_val = float(str(student).strip())
        c_val = float(str(correct).strip())
        # Student gives abs(correct) when correct is negative
        return c_val < 0 and abs(s_val - abs(c_val)) < 1e-9
    except (ValueError, TypeError, AttributeError):
        return False


def area_perimeter_swap(question: dict, student: str, correct: str) -> bool:
    """Detects student computed area when asked for perimeter (or vice versa).

    Heuristic: if the question text mentions 'perimeter' or 'area', and the
    student answer is a plausible numeric value that differs from correct by
    a ratio consistent with a swap (e.g. for a rectangle with sides a,b:
    perimeter=2(a+b), area=a*b).
    """
    try:
        s_val = float(student.strip())
        c_val = float(correct.strip())
    except (ValueError, TypeError):
        return False

    if c_val == 0 or s_val == 0:
        return False

    q_text = question.get("question", "").lower()
    has_perimeter = "perimeter" in q_text
    has_area = "area" in q_text

    if not (has_perimeter or has_area):
        return False

    # If student answer != correct and both are positive, check if the ratio
    # suggests a swap. Common pattern: area vs perimeter differ significantly.
    if abs(s_val - c_val) < 1e-9:
        return False

    # For rectangles: if asked perimeter (2*(l+w)) but student gives l*w, or vice versa
    # We detect this by checking if the student answer matches a plausible swap.
    # Simple heuristic: student answer is positive, different from correct,
    # and the question mentions geometric keywords.
    labels = question.get("diagram_data", {}).get("labels", {}) if question.get("diagram_data") else {}
    if labels:
        try:
            width = float(labels.get("width", 0))
            height = float(labels.get("height", 0))
            base = float(labels.get("base", 0))
            h = float(labels.get("height", 0))

            if width and height:
                area = width * height
                perimeter = 2 * (width + height)
                if has_perimeter and abs(s_val - area) < 1e-9:
                    return True
                if has_area and abs(s_val - perimeter) < 1e-9:
                    return True
            if base and h:
                area = 0.5 * base * h
                perimeter_approx = base + h + (base**2 + h**2) ** 0.5
                if has_perimeter and abs(s_val - area) < 1e-9:
                    return True
                if has_area and abs(s_val - perimeter_approx) < 1e-9:
                    return True
        except (ValueError, TypeError):
            pass

    return False


def inequality_flip_forgotten(question: dict, student: str, correct: str) -> bool:
    """Detects student forgot to flip inequality sign when multiplying/dividing by negative.

    Pattern: correct answer is e.g. 'x < 3' but student gives 'x > 3' (or vice versa).
    """
    student_s = student.strip().lower().replace(" ", "")
    correct_s = correct.strip().lower().replace(" ", "")

    # Extract inequality patterns like x<3, x>3, x<=3, x>=3
    ineq_pattern = re.compile(r"([a-z])([<>]=?|[≤≥])(-?[\d.]+)")

    s_match = ineq_pattern.search(student_s)
    c_match = ineq_pattern.search(correct_s)

    if not s_match or not c_match:
        return False

    s_var, s_op, s_num = s_match.groups()
    c_var, c_op, c_num = c_match.groups()

    # Same variable and same number, but flipped operator
    if s_var != c_var or s_num != c_num:
        return False

    flip_pairs = {
        ("<", ">"), (">", "<"),
        ("<=", ">="), (">=", "<="),
        ("≤", "≥"), ("≥", "≤"),
    }

    return (s_op, c_op) in flip_pairs


def fraction_addition_added_denominators(question: dict, student: str, correct: str) -> bool:
    """Detects student added numerators AND denominators: 1/2 + 1/3 = 2/5 instead of 5/6.

    Pattern: student answer is a fraction where num = sum of numerators and
    denom = sum of denominators from the question's addends.
    """
    # Try to parse student answer as a fraction
    student_s = student.strip().replace(" ", "")
    frac_pattern = re.compile(r"^(-?\d+)/(\d+)$")

    s_match = frac_pattern.match(student_s)
    if not s_match:
        return False

    s_num = int(s_match.group(1))
    s_den = int(s_match.group(2))

    # Look for fraction addition in the question text
    q_text = question.get("question", "")
    # Find patterns like a/b + c/d or a/b + c/d + ...
    fracs = re.findall(r"(\d+)/(\d+)", q_text)

    if len(fracs) < 2:
        return False

    # Check if student naively added numerators and denominators
    naive_num = sum(int(f[0]) for f in fracs)
    naive_den = sum(int(f[1]) for f in fracs)

    if naive_den == 0:
        return False

    # Check if student's answer matches the naive sum (possibly simplified)
    # Cross-multiply to compare: s_num/s_den == naive_num/naive_den
    return s_num * naive_den == naive_num * s_den


def decimal_place_value_misalignment(question: dict, student: str, correct: str) -> bool:
    """Detects decimal addition with misaligned decimal points.

    Pattern: student adds decimals by ignoring decimal point alignment,
    e.g. 1.5 + 2.35 = 3.85 (correct) vs 3.50 (misaligned) or similar errors
    where digits are summed column-by-column without alignment.
    """
    try:
        s_val = float(student.strip())
        c_val = float(correct.strip())
    except (ValueError, TypeError):
        return False

    if abs(s_val - c_val) < 1e-9:
        return False

    # Look for decimal addition in the question
    q_text = question.get("question", "")
    decimals = re.findall(r"\d+\.\d+", q_text)

    if len(decimals) < 2:
        return False

    # Check if the error is consistent with misalignment
    # Common misalignment: treating 1.5 + 2.35 as 1.5 + 2.35 but aligning
    # the last digits instead of decimal points, giving wrong answer
    # Heuristic: student answer differs from correct by a factor of 10 or
    # the difference is consistent with a single-digit shift
    diff = abs(s_val - c_val)
    if diff < 1e-9:
        return False

    # Check for common misalignment patterns
    for decimal_str in decimals:
        decimal_val = float(decimal_str)
        # If shifting one operand by a factor of 10 produces the student's error
        if abs(s_val - (c_val + decimal_val * 9)) < 1e-9:
            return True
        if abs(s_val - (c_val - decimal_val * 0.9)) < 1e-9:
            return True

    # Simple heuristic: if the answer is off by a power of 10 of one of the operands
    for decimal_str in decimals:
        decimal_val = float(decimal_str)
        if decimal_val != 0:
            ratio = diff / decimal_val
            if abs(ratio - 0.9) < 0.01 or abs(ratio - 9.0) < 0.1:
                return True

    return False


def square_root_as_half(question: dict, student: str, correct: str) -> bool:
    """Detect treating a square root as division by two."""
    try:
        student_value = float(str(student).strip())
        correct_value = float(str(correct).strip())
    except (TypeError, ValueError, AttributeError):
        return False
    if abs(student_value - correct_value) < 1e-9:
        return False

    text = str(question.get("question") or "")
    patterns = (
        r"\\sqrt\s*\{\s*(-?\d+(?:\.\d+)?)\s*\}",
        r"√\s*(-?\d+(?:\.\d+)?)",
        r"square\s+root\s+of\s+(-?\d+(?:\.\d+)?)",
    )
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            radicand = float(match.group(1))
            return abs(student_value - radicand / 2.0) < 1e-9
    return False


def missing_grouping_brackets(question: dict, student: str, correct: str) -> bool:
    """Student omits brackets: e.g. writes 3n + 2 instead of 3(n + 2)."""
    try:
        from backend.answer_normalize import safe_sympify, correct_syntax, strip_latex_math

        s = strip_latex_math(str(student).strip())
        c = strip_latex_math(str(correct).strip())
        if not s or not c:
            return False
        s_expr = safe_sympify(correct_syntax(s))
        c_expr = safe_sympify(correct_syntax(c))
        if s_expr == c_expr:
            return False
        # The correct answer must contain brackets (grouping)
        if "(" not in c and ")" not in c:
            return False
        return True
    except Exception:
        return False


def equation_inverse_one_side_only(question: dict, student: str, correct: str) -> bool:
    """Student applies inverse to one side only, e.g. divides RHS by coefficient."""
    try:
        from backend.answer_normalize import safe_sympify, correct_syntax, strip_latex_math

        s = strip_latex_math(str(student).strip())
        c = strip_latex_math(str(correct).strip())
        if not s or not c:
            return False
        s_val = float(safe_sympify(correct_syntax(s)))
        c_val = float(safe_sympify(correct_syntax(c)))
        if abs(s_val - c_val) < 1e-9:
            return False
        # Look for equation in question text
        q_text = question.get("question", "")
        eq_match = re.search(r"(-?\d+(?:\.\d+)?)\s*[a-z]\s*([+\-])\s*(-?\d+(?:\.\d+)?)\s*=\s*(-?\d+(?:\.\d+)?)", q_text)
        if not eq_match:
            return False
        coeff = float(eq_match.group(1))
        rhs = float(eq_match.group(4))
        if coeff == 0:
            return False
        # Student divides RHS by coefficient without subtracting constant
        if abs(s_val - rhs / coeff) < 1e-9:
            return True
        return False
    except Exception:
        return False


def linear_pattern_missing_constant(question: dict, student: str, correct: str) -> bool:
    """Student gives correct coefficient but missing/wrong constant in a linear rule."""
    try:
        from backend.answer_normalize import safe_sympify, correct_syntax, strip_latex_math
        import sympy as sp

        s = strip_latex_math(str(student).strip())
        c = strip_latex_math(str(correct).strip())
        if not s or not c:
            return False
        s_expr = safe_sympify(correct_syntax(s))
        c_expr = safe_sympify(correct_syntax(c))
        if s_expr == c_expr:
            return False
        # Both must be linear in the same variable
        symbols = list(c_expr.free_symbols)
        if not symbols:
            return False
        var = symbols[0]
        s_symbols = list(s_expr.free_symbols)
        if not s_symbols or s_symbols[0] != var:
            return False
        # Check that leading coefficient matches but constant differs
        c_poly = sp.Poly(c_expr, var)
        s_poly = sp.Poly(s_expr, var)
        if c_poly.degree() != 1 or s_poly.degree() != 1:
            return False
        c_lead = c_poly.nth(1)
        s_lead = s_poly.nth(1)
        c_const = c_poly.nth(0)
        s_const = s_poly.nth(0)
        return c_lead == s_lead and c_const != s_const
    except Exception:
        return False


def cointerior_treated_as_equal(question: dict, student: str, correct: str) -> bool:
    """Student gives the known co-interior angle instead of 180 minus the angle."""
    try:
        s_val = float(str(student).strip())
        c_val = float(str(correct).strip())
        if abs(s_val - c_val) < 1e-9:
            return False
        # Co-interior angles sum to 180
        if abs(s_val + c_val - 180) < 1e-9:
            return True
        return False
    except (ValueError, TypeError):
        return False


def triangle_missing_angle_no_subtract_from_180(question: dict, student: str, correct: str) -> bool:
    """Student gives sum of known angles instead of subtracting from 180.

    Must NOT fire when student simply repeats one of the given angles (that's
    a different error: copying a known angle rather than computing the missing one).
    """
    try:
        s_val = float(str(student).strip())
        c_val = float(str(correct).strip())
        if abs(s_val - c_val) < 1e-9:
            return False
        # The correct angle should be 180 - sum_of_known
        # so sum_of_known = 180 - c_val, and the student gave sum_of_known
        sum_of_known = 180 - c_val
        if abs(s_val - sum_of_known) < 1e-9:
            # Check that s_val is NOT one of the given angles in the question
            q_text = question.get("question", "")
            given_angles = [float(x) for x in re.findall(r"\b(\d+(?:\.\d+)?)\b", q_text)
                           if 0 < float(x) < 180]
            # If the student answer equals any single given angle, it's a repeat, not this error
            for angle in given_angles:
                if abs(s_val - angle) < 1e-9:
                    return False
            return True
        return False
    except (ValueError, TypeError):
        return False


def ratio_model_missing_context_interpretation(question: dict, student: str, correct: str) -> bool:
    """Student gives ratio part number instead of the actual share value."""
    try:
        s = str(student).strip()
        c = str(correct).strip()
        if not s or not c:
            return False
        # Strip currency/unit symbols for numeric comparison
        s_clean = re.sub(r"[$ £€]", "", s).strip()
        c_clean = re.sub(r"[$ £€]", "", c).strip()
        s_val = float(s_clean)
        c_val = float(c_clean)
        if abs(s_val - c_val) < 1e-9:
            return False
        # Look for ratio in question
        q_text = question.get("question", "")
        ratio_match = re.search(r"(\d+)\s*:\s*(\d+)", q_text)
        if not ratio_match:
            return False
        parts = [int(ratio_match.group(1)), int(ratio_match.group(2))]
        # Student gave just the ratio part number itself
        if s_val in [float(p) for p in parts]:
            return True
        return False
    except (ValueError, TypeError):
        return False


def hcf_lcm_exponents_reversed(question: dict, student: str, correct: str) -> bool:
    """Student gives the LCM when asked for HCF, or vice versa."""
    try:
        import math
        s_float = float(str(student).strip())
        c_float = float(str(correct).strip())
        if not math.isfinite(s_float) or not math.isfinite(c_float):
            return False
        s_val = int(s_float)
        c_val = int(c_float)
        if s_val == c_val:
            return False
        # Extract numbers from the question
        q_text = question.get("question", "")
        nums = [int(x) for x in re.findall(r"\b(\d+)\b", q_text) if int(x) > 1]
        if len(nums) < 2:
            return False
        a, b = nums[0], nums[1]
        hcf = math.gcd(a, b)
        lcm = a * b // hcf
        # If asked for HCF but student gives LCM, or vice versa
        if c_val == hcf and s_val == lcm:
            return True
        if c_val == lcm and s_val == hcf:
            return True
        return False
    except (ValueError, TypeError, ZeroDivisionError, OverflowError):
        return False


def prime_factorisation_missing_repeated_factor_or_power(question: dict, student: str, correct: str) -> bool:
    """Student's prime factorisation is missing a repeated factor or has wrong exponent."""
    try:
        s = str(student).strip()
        c = str(correct).strip()
        if not s or not c:
            return False
        if s == c:
            return False

        def parse_factorisation(text):
            """Parse expressions like 2^3 * 3 or 2^2 * 3 into {prime: exponent}."""
            factors = {}
            # Match terms like 2^3, 3^1, 5, etc.
            for match in re.finditer(r"(\d+)\s*\^\s*(\d+)", text):
                base, exp = int(match.group(1)), int(match.group(2))
                factors[base] = exp
            # Match standalone primes (no exponent means exponent=1)
            # Remove already-matched terms
            remaining = re.sub(r"\d+\s*\^\s*\d+", "", text)
            for match in re.finditer(r"\b(\d+)\b", remaining):
                base = int(match.group(1))
                if base > 1:
                    factors.setdefault(base, 1)
            return factors

        s_factors = parse_factorisation(s)
        c_factors = parse_factorisation(c)
        if not s_factors or not c_factors:
            return False
        # Same primes but different exponents
        if set(s_factors.keys()) == set(c_factors.keys()):
            return s_factors != c_factors
        # Student missing a prime or has extra
        if set(s_factors.keys()).issubset(set(c_factors.keys())):
            return True
        return False
    except Exception:
        return False


def ratio_additive_scaling(question: dict, student: str, correct: str) -> bool:
    """Student adds a constant to each ratio part instead of multiplying."""
    try:
        s = str(student).strip()
        c = str(correct).strip()
        if not s or not c:
            return False
        # Parse ratios like a:b
        s_match = re.match(r"(-?\d+(?:\.\d+)?)\s*:\s*(-?\d+(?:\.\d+)?)", s)
        c_match = re.match(r"(-?\d+(?:\.\d+)?)\s*:\s*(-?\d+(?:\.\d+)?)", c)
        if not s_match or not c_match:
            return False
        s_a, s_b = float(s_match.group(1)), float(s_match.group(2))
        c_a, c_b = float(c_match.group(1)), float(c_match.group(2))
        if abs(s_a - c_a) < 1e-9 and abs(s_b - c_b) < 1e-9:
            return False
        # Check the question for the original ratio
        q_text = question.get("question", "")
        orig_match = re.search(r"(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)", q_text)
        if not orig_match:
            return False
        orig_a, orig_b = float(orig_match.group(1)), float(orig_match.group(2))
        # Additive scaling: student added a constant k to both parts
        diff_a = s_a - orig_a
        diff_b = s_b - orig_b
        if abs(diff_a - diff_b) < 1e-9 and abs(diff_a) > 0:
            # Confirm the correct answer uses multiplicative scaling
            if orig_a != 0 and abs(c_a / orig_a - c_b / orig_b) < 1e-9:
                return True
        return False
    except (ValueError, TypeError, ZeroDivisionError):
        return False


def xy_swap(question: dict, student: str, correct: str) -> bool:
    """Student swaps x and y coordinates, e.g. gives (3, 2) instead of (2, 3)."""
    try:
        s = str(student).strip()
        c = str(correct).strip()
        if not s or not c:
            return False
        # Parse coordinate pairs
        s_match = re.match(r"\(?\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)?", s)
        c_match = re.match(r"\(?\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)?", c)
        if not s_match or not c_match:
            return False
        s_x, s_y = float(s_match.group(1)), float(s_match.group(2))
        c_x, c_y = float(c_match.group(1)), float(c_match.group(2))
        if abs(s_x - c_x) < 1e-9 and abs(s_y - c_y) < 1e-9:
            return False
        # Check if student swapped x and y
        return abs(s_x - c_y) < 1e-9 and abs(s_y - c_x) < 1e-9
    except (ValueError, TypeError):
        return False


def short_run_must_match_theory(question: dict, student: str, correct: str) -> bool:
    """Student asserts short-run results must match theory (e.g. 'coin must be biased').

    Critical: must NOT fire on answers that REFUTE the claim. Negation words
    or refutation framing anywhere in the answer exclude the match, because a
    student who says "We can't conclude the die is biased" is giving the correct
    reasoning, even though the word 'biased' appears.
    """
    try:
        s = str(student).strip()
        if not s:
            return False
        text = s.lower()

        # Refutation/qualification framing: if ANY of these appear, the student
        # is rejecting the misconception, not asserting it.
        refutation_patterns = [
            r"\bcan'?t\b", r"\bcannot\b", r"\bnot\s+necessarily\b",
            r"\bnot\b", r"\bnever\b", r"\bno\b",
            r"\bdoesn'?t\b", r"\bdon'?t\b", r"\bisn'?t\b", r"\baren'?t\b", r"\bwon'?t\b",
            r"\bunlikely\b", r"\btoo few\b", r"\btoo small\b",
            r"\bjust\b", r"\bmight\b", r"\bmaybe\b", r"\bpossibly\b", r"\bcould be\b",
            r"\bchance\b", r"\brandom\b", r"\bvary\b", r"\bvariation\b",
            r"\binsufficient\b", r"\bsmall\s+sample\b",
            r"\bfew\s+rolls?\b", r"\bfew\s+trials?\b",
            r"\bwrong\s+to\s+say\b", r"\bincorrect\s+to\b",
            r"\bconclude\b",
        ]
        for pat in refutation_patterns:
            if re.search(pat, text):
                return False

        # Positive assertion patterns: student claims the result proves something
        assertion_patterns = [
            r"\b(must\s+be|is)\s+(biased|unfair|loaded|rigged|weighted)",
            r"\bshould\s+be\s+exactly\b",
            r"\b(impossible|must\s+always)\b",
            r"\b(this|it|the\s+result)\s+is\s+(wrong|incorrect)\b",
            r"\bbiased\b",
        ]
        for pat in assertion_patterns:
            if re.search(pat, text):
                return True

        return False
    except Exception:
        return False


def statistical_conclusion_missing_evidence(question: dict, student: str, correct: str) -> bool:
    """Student makes a conclusion without citing statistical evidence (median, range, etc.)."""
    try:
        s = str(student).strip()
        if not s:
            return False
        text = s.lower()
        # If student answer equals correct, no fire
        if text == str(correct).strip().lower():
            return False
        # Evidence keywords that would make the conclusion supported
        evidence_words = [
            r"\bmedian\b", r"\bmean\b", r"\brange\b", r"\bmode\b",
            r"\boutlier\b", r"\bquartile\b", r"\biq[r]\b", r"\bspread\b",
            r"\bfrequen\w*\b", r"\bpercentage\b", r"\b\d+\s*%",
            r"\bdata\s+show", r"\bthe\s+data\b",
            r"\b\d+(\.\d+)?\s*(marks?|points?|score|cm|mm|kg|m)\b",
        ]
        has_evidence = any(re.search(pat, text) for pat in evidence_words)
        if has_evidence:
            return False
        # Must contain a conclusion/claim
        conclusion_patterns = [
            r"\b(better|worse|higher|lower|faster|slower|more|less|best|worst)\b",
            r"\b(because|since|so)\b",
        ]
        has_conclusion = any(re.search(pat, text) for pat in conclusion_patterns)
        return has_conclusion
    except Exception:
        return False


def stem_leaf_unsorted_or_missing_key(question: dict, student: str, correct: str) -> bool:
    """Stem-and-leaf display has unsorted leaves or is missing a place-value key."""
    try:
        s = str(student).strip()
        c = str(correct).strip()
        if not s or not c:
            return False
        if s == c:
            return False
        # Must look like a stem-and-leaf plot (contains | separator)
        if "|" not in s:
            return False
        # Check for missing key
        has_key = bool(re.search(r"key|=", s, re.IGNORECASE))
        correct_has_key = bool(re.search(r"key|=", c, re.IGNORECASE))

        # Check for unsorted leaves
        leaves_unsorted = False
        for line in s.split("\n"):
            if "|" in line:
                leaf_part = line.split("|", 1)[1].strip()
                leaves = re.findall(r"\d+", leaf_part)
                if leaves:
                    int_leaves = [int(x) for x in leaves]
                    if int_leaves != sorted(int_leaves):
                        leaves_unsorted = True
                        break

        if leaves_unsorted:
            return True
        if correct_has_key and not has_key:
            return True
        return False
    except Exception:
        return False


def integration_missing_constant(question: dict, student: str, correct: str) -> bool:
    """Student gives correct antiderivative but omits +C or +c."""
    try:
        s = str(student).strip()
        c = str(correct).strip()
        if not s or not c:
            return False
        if s.lower() == c.lower():
            return False
        # The correct answer must contain a constant of integration
        has_constant_correct = bool(re.search(r"[+\-]\s*[Cc]\b", c))
        has_constant_student = bool(re.search(r"[+\-]\s*[Cc]\b", s))
        if not has_constant_correct:
            return False
        if has_constant_student:
            return False
        # Strip the constant from correct and compare expressions
        c_stripped = re.sub(r"\s*[+\-]\s*[Cc]\b", "", c).strip()
        # Compare the rest symbolically if possible
        try:
            from backend.answer_normalize import safe_sympify, correct_syntax, strip_latex_math
            s_expr = safe_sympify(correct_syntax(strip_latex_math(s)))
            c_expr = safe_sympify(correct_syntax(strip_latex_math(c_stripped)))
            import sympy as sp
            if sp.simplify(s_expr - c_expr) == 0:
                return True
        except Exception:
            # Fallback: simple string comparison
            s_norm = re.sub(r"\s+", "", s.lower())
            c_norm = re.sub(r"\s+", "", c_stripped.lower())
            if s_norm == c_norm:
                return True
        return False
    except Exception:
        return False


def probability_added_instead_of_multiplied(question: dict, student: str, correct: str) -> bool:
    """Student adds probabilities of independent events instead of multiplying."""
    try:
        s_val = float(str(student).strip())
        c_val = float(str(correct).strip())
        if abs(s_val - c_val) < 1e-9:
            return False
        # Extract probabilities from the question
        q_text = question.get("question", "")
        probs = [float(x) for x in re.findall(r"0?\.\d+", q_text) if 0 < float(x) < 1]
        if len(probs) < 2:
            return False
        # Check if student added the two probabilities and correct is their product
        for i in range(len(probs)):
            for j in range(i + 1, len(probs)):
                added = probs[i] + probs[j]
                multiplied = probs[i] * probs[j]
                if abs(s_val - added) < 1e-9 and abs(c_val - multiplied) < 1e-9:
                    return True
                # Reverse: correct is sum, student is product (less common)
                if abs(s_val - multiplied) < 1e-9 and abs(c_val - added) < 1e-9:
                    return True
        return False
    except (ValueError, TypeError):
        return False


def complement_probability_confused(question: dict, student: str, correct: str) -> bool:
    """Student gives 1 - correct_answer (the complement probability)."""
    try:
        s_val = float(str(student).strip())
        c_val = float(str(correct).strip())
        if abs(s_val - c_val) < 1e-9:
            return False
        # Both must be valid probabilities in [0, 1]
        if not (0 <= s_val <= 1 and 0 <= c_val <= 1):
            return False
        # Exclude 0.5 since it equals its own complement
        if abs(c_val - 0.5) < 1e-9:
            return False
        # Check if they sum to 1
        return abs(s_val + c_val - 1.0) < 1e-9
    except (ValueError, TypeError):
        return False


def degrees_radians_confused(question: dict, student: str, correct: str) -> bool:
    """Student gives the angle in the wrong unit (degrees vs radians)."""
    try:
        import math
        s_val = float(str(student).strip())
        c_val = float(str(correct).strip())
        if abs(s_val - c_val) < 1e-9:
            return False
        if c_val == 0:
            return False
        # Check if student's value equals correct * (180/pi) or correct * (pi/180)
        ratio_deg_to_rad = math.pi / 180.0
        ratio_rad_to_deg = 180.0 / math.pi
        if abs(s_val - c_val * ratio_rad_to_deg) < 1e-3:
            return True
        if abs(s_val - c_val * ratio_deg_to_rad) < 1e-3:
            return True
        return False
    except (ValueError, TypeError):
        return False


def log_of_sum_split(question: dict, student: str, correct: str) -> bool:
    """Student rewrites log(a + b) as log(a) + log(b)."""
    try:
        from backend.answer_normalize import safe_sympify, correct_syntax, strip_latex_math
        import sympy as sp

        s = strip_latex_math(str(student).strip())
        c = strip_latex_math(str(correct).strip())
        if not s or not c:
            return False
        s_expr = safe_sympify(correct_syntax(s))
        c_expr = safe_sympify(correct_syntax(c))
        if sp.simplify(s_expr - c_expr) == 0:
            return False
        # Check if correct is log(sum) and student is sum of logs
        # Look for log atoms in both
        s_logs = s_expr.atoms(sp.log)
        c_logs = c_expr.atoms(sp.log)
        if not s_logs and not c_logs:
            return False
        # Use force=True expansion to check if the student wrongly split
        # Student: log(x) + log(y), Correct: log(x+y)
        # expanded_correct would give log(x+y) since it's already a single log
        # The student's expression should NOT equal the correct under log rules
        s_expanded = sp.expand_log(s_expr, force=True)
        c_expanded = sp.expand_log(c_expr, force=True)
        if sp.simplify(s_expanded - c_expanded) == 0:
            return False
        # Check if the correct answer has a log of a sum
        for log_term in c_logs:
            arg = log_term.args[0]
            if arg.is_Add:
                # Correct is log(a+b), check if student gave log(a) + log(b)
                terms = arg.as_ordered_terms()
                sum_of_logs = sum(sp.log(t) for t in terms)
                if sp.simplify(s_expr - sum_of_logs) == 0:
                    return True
        # Also check the reverse: correct is log(x+y), student is log(x) + log(y)
        # by checking if student has multiple log terms that sum
        if len(s_logs) >= 2 and len(c_logs) == 1:
            c_arg = list(c_logs)[0].args[0]
            if c_arg.is_Add:
                return True
        return False
    except Exception:
        return False


def permutation_combination_confused(question: dict, student: str, correct: str) -> bool:
    """Student uses nPr instead of nCr or vice versa."""
    try:
        import math as _math
        s_float = float(str(student).strip())
        c_float = float(str(correct).strip())
        if not _math.isfinite(s_float) or not _math.isfinite(c_float):
            return False
        s_val = int(s_float)
        c_val = int(c_float)
        if s_val == c_val:
            return False
        # Extract n and r from the question
        q_text = question.get("question", "")
        nums = [int(x) for x in re.findall(r"\b(\d+)\b", q_text) if 1 < int(x) < 100]
        if len(nums) < 2:
            return False
        # Try all pairs
        for i in range(len(nums)):
            for j in range(len(nums)):
                if i == j:
                    continue
                n, r = nums[i], nums[j]
                if r > n or r < 1:
                    continue
                try:
                    perm = _math.perm(n, r)
                    comb = _math.comb(n, r)
                    # Student gave perm when correct is comb, or vice versa
                    if c_val == comb and s_val == perm:
                        return True
                    if c_val == perm and s_val == comb:
                        return True
                except (ValueError, OverflowError):
                    continue
        return False
    except (ValueError, TypeError, OverflowError):
        return False


def opinion_without_textual_evidence(question: dict, student: str, correct: str) -> bool:
    """Student gives opinion about a text without citing any textual evidence.

    Must NOT fire when the student quotes from the text or names a technique.
    """
    try:
        s = str(student).strip()
        if not s:
            return False
        text = s.lower()
        # If student answer matches correct, don't fire
        if text == str(correct).strip().lower():
            return False
        # Evidence indicators: quotation marks, named techniques, specific textual refs
        evidence_patterns = [
            r'["\u201c\u201d]',  # quotation marks
            r"'[^']{2,}'",  # single-quoted text of 2+ chars
            r"\b(simile|metaphor|personification|alliteration|imagery|repetition|symbolism|irony|hyperbole|onomatopoeia)\b",
            r"\b(the\s+(?:writer|author|poet|narrator)\s+(?:uses?|shows?|creates?|describes?|suggests?))\b",
            r"\b(in\s+(?:line|paragraph|stanza|chapter|scene)\s+\d+)\b",
            r"\b(when\s+(?:she|he|the\s+\w+)\s+(?:says?|writes?|describes?))\b",
            r'"\w',  # opening quote followed by word
        ]
        has_evidence = any(re.search(pat, text) for pat in evidence_patterns)
        if has_evidence:
            return False
        # Must contain an opinion/judgement cue
        opinion_patterns = [
            r"\b(i\s+think|i\s+feel|i\s+believe|in\s+my\s+opinion|i\s+liked?|i\s+disliked?|it\s+is|she\s+is|he\s+is)\b",
            r"\b(boring|exciting|great|good|bad|terrible|amazing|interesting|stupid|dull|lovely|brilliant)\b",
        ]
        has_opinion = any(re.search(pat, text) for pat in opinion_patterns)
        return has_opinion
    except Exception:
        return False


PREDICATE_REGISTRY: dict[str, callable] = {
    "negative_squared": negative_squared,
    "area_perimeter_swap": area_perimeter_swap,
    "inequality_flip_forgotten": inequality_flip_forgotten,
    "fraction_addition_added_denominators": fraction_addition_added_denominators,
    "decimal_place_value_misalignment": decimal_place_value_misalignment,
    "square_root_as_half": square_root_as_half,
    "missing_grouping_brackets": missing_grouping_brackets,
    "equation_inverse_one_side_only": equation_inverse_one_side_only,
    "linear_pattern_missing_constant": linear_pattern_missing_constant,
    "cointerior_treated_as_equal": cointerior_treated_as_equal,
    "triangle_missing_angle_no_subtract_from_180": triangle_missing_angle_no_subtract_from_180,
    "ratio_model_missing_context_interpretation": ratio_model_missing_context_interpretation,
    "hcf_lcm_exponents_reversed": hcf_lcm_exponents_reversed,
    "prime_factorisation_missing_repeated_factor_or_power": prime_factorisation_missing_repeated_factor_or_power,
    "ratio_additive_scaling": ratio_additive_scaling,
    "xy_swap": xy_swap,
    "short_run_must_match_theory": short_run_must_match_theory,
    "statistical_conclusion_missing_evidence": statistical_conclusion_missing_evidence,
    "stem_leaf_unsorted_or_missing_key": stem_leaf_unsorted_or_missing_key,
    "integration_missing_constant": integration_missing_constant,
    "probability_added_instead_of_multiplied": probability_added_instead_of_multiplied,
    "complement_probability_confused": complement_probability_confused,
    "degrees_radians_confused": degrees_radians_confused,
    "log_of_sum_split": log_of_sum_split,
    "permutation_combination_confused": permutation_combination_confused,
    "opinion_without_textual_evidence": opinion_without_textual_evidence,
}
