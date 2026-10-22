"""Pure-Python answer normalisation library.

Design §3.3 — robustness-hardening spec.
No I/O, no LLM calls, no network. Deterministic and total.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass
from fractions import Fraction
import sympy as _sp
from sympy.parsing.sympy_parser import convert_xor, parse_expr, standard_transformations


_GREEK_VARIABLE_ALIASES = {
    "α": "alpha",
    "β": "beta",
    "γ": "gamma",
    "δ": "delta",
    "ε": "epsilon",
    "λ": "lambda",
    "μ": "mu",
    "σ": "sigma",
    "τ": "tau",
    "ω": "omega",
    "θ": "theta",
}
_SAFE_VARIABLE_NAMES = frozenset(
    set("abcdefghijklmnopqrstuvwxyz")
    | (set("ABCDEFGHIJKLMNOPQRSTUVWXYZ") - {"E"})
    | {"theta"}
    | set(_GREEK_VARIABLE_ALIASES)
    | set(_GREEK_VARIABLE_ALIASES.values())
)
_SAFE_FACTORIAL = _sp.Function("factorial")
_SAFE_FUNCTIONS = {
    "sqrt": _sp.sqrt,
    "Abs": _sp.Abs,
    "abs": _sp.Abs,
    "sin": _sp.sin,
    "cos": _sp.cos,
    "tan": _sp.tan,
    "asin": _sp.asin,
    "acos": _sp.acos,
    "atan": _sp.atan,
    "log": _sp.log,
    "ln": _sp.log,
    "exp": _sp.exp,
    "factorial": _SAFE_FACTORIAL,
}
_SAFE_CONSTANTS = {
    "pi": _sp.pi,
    "π": _sp.pi,
    "E": _sp.E,
    "∞": _sp.oo,
}
_SAFE_TRANSFORMATIONS = standard_transformations + (convert_xor,)
_SAFE_GLOBALS = {
    "__builtins__": {},
    "Integer": _sp.Integer,
    "Float": _sp.Float,
    "Rational": _sp.Rational,
    "Symbol": _sp.Symbol,
    "Add": _sp.Add,
    "Mul": _sp.Mul,
    "Pow": _sp.Pow,
}


def _validate_parenthesis_depth(expression: str, maximum: int = 24) -> None:
    depth = 0
    for char in expression:
        if char == "(":
            depth += 1
            if depth > maximum:
                raise ValueError("Expression nesting is too deep.")
        elif char == ")":
            depth -= 1
            if depth < 0:
                raise ValueError("Expression has unbalanced parentheses.")
    if depth:
        raise ValueError("Expression has unbalanced parentheses.")


def safe_sympify(expr_str: str):
    """Parse a bounded allowlisted mathematical expression without eager evaluation."""
    s = expr_str.strip()
    if not s:
        raise ValueError("Expression is empty.")
    if len(s) > 256:
        raise ValueError("Expression is too long.")
    if max((len(run) for run in re.findall(r"\d+", s)), default=0) > 64:
        raise ValueError("Numeric literal is too large.")
    _validate_parenthesis_depth(s)
    if len(re.findall(r"[+*/^!%-]|(?<![<>=])-", s)) > 64:
        raise ValueError("Expression has too many operations.")

    # Reject attribute access while retaining established decimal forms such as
    # ``.5`` and ``1.e3``.
    attribute_source = re.sub(
        r"(?:\d(?:\.\d*)?|\.\d+)[eE][+-]?\d+", "0", s
    )
    if re.search(r"[A-Za-z_]\s*\.|\.\s*[A-Za-z_]", attribute_source):
        raise ValueError("Attribute access is not allowed.")
    if re.search(r"(?<![<>=!])=(?!=)", s):
        raise ValueError("Equations must be compared one side at a time.")

    # Bound both exponent spellings before SymPy can evaluate them.  The AST
    # pass below also catches numeric exponents produced by safe transformations.
    for exponent in re.findall(r"(?:\^|\*\*)\s*\(?\s*([+-]?\d+)", s):
        if abs(int(exponent)) > 1000:
            raise ValueError("Exponent is too large.")
    for exponent in re.findall(r"(?:\d(?:\.\d*)?|\.\d+)[eE]([+-]?\d+)", s):
        if abs(int(exponent)) > 1000:
            raise ValueError("Scientific exponent is too large.")
    for operand in re.findall(r"(\d+)\s*!", s):
        if int(operand) > 1000:
            raise ValueError("Factorial operand is too large.")
    for operand in re.findall(r"\bfactorial\s*\(\s*(\d+)\s*\)", s):
        if int(operand) > 1000:
            raise ValueError("Factorial operand is too large.")

    if not re.fullmatch(
        r"[a-zA-Z0-9\s+\-*/()=.,^_<>!%|≤≥≠√πθ²³×÷∞αβγδελμστω]*",
        s,
    ):
        raise ValueError("Expression contains unsafe characters.")

    # Remove scientific-notation fragments before scanning identifiers so the
    # exponent marker in 1e-3 is not mistaken for a variable.
    identifier_source = re.sub(
        r"(?:\d(?:\.\d*)?|\.\d+)[eE][+-]?\d+", "0", s
    )
    identifiers = re.findall(
        r"[A-Za-z_][A-Za-z0-9_]*|[α-ωΩπθ]+", identifier_source
    )
    allowed_identifiers = (
        set(_SAFE_VARIABLE_NAMES)
        | set(_SAFE_FUNCTIONS)
        | set(_SAFE_CONSTANTS)
    )
    for identifier in identifiers:
        if identifier not in allowed_identifiers:
            raise ValueError(f"Unsafe or unsupported identifier: {identifier}")

    safe_locals = {
        name: _sp.Symbol(_GREEK_VARIABLE_ALIASES.get(name, name))
        for name in _SAFE_VARIABLE_NAMES
    }
    safe_locals.update(_SAFE_FUNCTIONS)
    safe_locals.update(_SAFE_CONSTANTS)

    try:
        expression = parse_expr(
            s,
            local_dict=safe_locals,
            global_dict=_SAFE_GLOBALS,
            transformations=_SAFE_TRANSFORMATIONS,
            evaluate=False,
        )
    except (MemoryError, RecursionError):
        raise ValueError("Expression is too complex.") from None
    except Exception as exc:
        raise ValueError("Expression is not valid bounded mathematics.") from exc

    if not isinstance(expression, _sp.Basic):
        raise ValueError("Expression did not produce a symbolic value.")
    nodes = list(_sp.preorder_traversal(expression))
    if len(nodes) > 128:
        raise ValueError("Expression tree is too large.")
    for node in nodes:
        if isinstance(node, _sp.Pow):
            if any(
                descendant.func == _SAFE_FACTORIAL
                for descendant in _sp.preorder_traversal(node.exp)
            ):
                raise ValueError("Factorial results cannot be used as exponents.")
            if node.exp.is_number:
                try:
                    exponent_value = float(node.exp)
                except (TypeError, ValueError, OverflowError):
                    raise ValueError("Exponent must be a bounded finite number.") from None
                if not math.isfinite(exponent_value):
                    raise ValueError("Exponent must be finite.")
                if abs(exponent_value) > 1000:
                    raise ValueError("Exponent is too large.")
        if node.func == _SAFE_FACTORIAL:
            if len(node.args) != 1:
                raise ValueError("Factorial requires one operand.")
            operand = node.args[0]
            if isinstance(operand, _sp.Symbol):
                continue
            if not isinstance(operand, _sp.Integer):
                raise ValueError("Factorial operand must be an integer literal or variable.")
            if int(operand) < 0 or int(operand) > 1000:
                raise ValueError("Factorial operand is out of range.")

    # Activate factorial only after the inert parse tree has passed all bounds;
    # this prevents nested or computed operands from evaluating during parsing.
    expression = expression.replace(
        lambda node: node.func == _SAFE_FACTORIAL,
        lambda node: _sp.factorial(node.args[0]),
    )
    return expression

# ---------------------------------------------------------------------------
# English word → digit mapping (Req 3.5)
# ---------------------------------------------------------------------------

ENGLISH_WORDS: dict[str, str] = {
    "zero": "0",
    "one": "1",
    "two": "2",
    "three": "3",
    "four": "4",
    "five": "5",
    "six": "6",
    "seven": "7",
    "eight": "8",
    "nine": "9",
    "ten": "10",
    "eleven": "11",
    "twelve": "12",
}

# Reverse mapping: digit string → English word
DIGITS_TO_WORDS: dict[str, str] = {v: k for k, v in ENGLISH_WORDS.items()}

# ---------------------------------------------------------------------------
# Unit canonicalisation (Req 3.7)
# ---------------------------------------------------------------------------

UNIT_CANON: dict[str, str] = {
    "cm²": "cm^2",
    "cm^2": "cm^2",
    "m²": "m^2",
    "m^2": "m^2",
    "cm³": "cm^3",
    "cm^3": "cm^3",
    "m³": "m^3",
    "m^3": "m^3",
    "km": "km",
    "mm": "mm",
    "cm": "cm",
    "m": "m",
    "kg": "kg",
    "g": "g",
    "seconds": "s",
    "second": "s",
    "secs": "s",
    "sec": "s",
    "s": "s",
    "minutes": "min",
    "minute": "min",
    "mins": "min",
    "min": "min",
    "hours": "h",
    "hour": "h",
    "hrs": "h",
    "hr": "h",
    "h": "h",
    "days": "d",
    "day": "d",
    "d": "d",
    "weeks": "w",
    "week": "w",
    "years": "y",
    "year": "y",
    "°C": "degC",
    "°c": "degC",
    "°F": "degF",
    "°f": "degF",
    "°": "deg",
    "degrees": "deg",
    "degree": "deg",
    "deg": "deg",
    "K": "K",
    "k": "K",
    "L": "L",
    "l": "L",
    "mL": "mL",
    "ml": "mL",
    "km/h": "km/h",
    "kmh": "km/h",
    "m/s": "m/s",
    "ms": "m/s",
    "%": "%",
    "$": "AUD",
    "AUD": "AUD",
    "aud": "AUD",
}

# ---------------------------------------------------------------------------
# CanonicalAnswerForm (Req 3.2)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CanonicalAnswerForm:
    decimal: Fraction | None = None
    fraction: tuple[int, int] | None = None
    integer: int | None = None
    value_with_unit: tuple[Fraction, str] | None = None
    text_words: str | None = None


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _replace_english_words(text: str) -> str:
    """Replace English number words with their digit equivalents (case-insensitive)."""
    result = text
    for word, digit in ENGLISH_WORDS.items():
        result = re.sub(rf"\b{word}\b", digit, result, flags=re.IGNORECASE)
    return result


_MIXED_NUMBER = re.compile(r"(-?)(\d+)\s+(\d+)\s*/\s*(\d+)")


def _mixed_number_value(text: str) -> Fraction | None:
    """Value of a mixed number such as "7 2/3" (23/3) or "-1 5/7" (-12/7)."""
    match = _MIXED_NUMBER.fullmatch(text.strip())
    if not match or int(match.group(4)) == 0:
        return None
    value = int(match.group(2)) + Fraction(int(match.group(3)), int(match.group(4)))
    return -value if match.group(1) else value


# ---------------------------------------------------------------------------
# normalise (Req 3.3–3.9)
# ---------------------------------------------------------------------------


def normalise(s: str) -> CanonicalAnswerForm:
    """Total, deterministic normaliser. Never raises for any input."""
    try:
        if not isinstance(s, str):
            return CanonicalAnswerForm(text_words="")

        text = s.strip().lower()
        if not text:
            return CanonicalAnswerForm(text_words="")

        # Apply English word substitution
        words_replaced = _replace_english_words(text)

        # Preprocess and clean currency formats (e.g. $27, \$27, \\\$27, -$27)
        # to ensure compatibility between latex-escaped answers in JSON and student input.
        words_replaced = re.sub(r"^([\s\\\$]*)(-?)([\s\\\$]*)(?=\d)", r"\2", words_replaced)

        # Remove thousands separator commas from formatted numbers, e.g. "407,020" -> "407020"
        words_replaced = re.sub(r"\b(\d{1,3})(?:,(\d{3}))+\b", lambda m: m.group(0).replace(",", ""), words_replaced)

        out: dict = {}

        # Try value-with-unit FIRST (longest-match on unit suffix)
        for symbol, canon in sorted(UNIT_CANON.items(), key=lambda x: -len(x[0])):
            if words_replaced.endswith(symbol):
                value_text = words_replaced[: -len(symbol)].strip()
                try:
                    mixed = _mixed_number_value(value_text)
                    if mixed is not None:
                        v = mixed
                    elif "/" in value_text:
                        parts = value_text.split("/")
                        v = Fraction(int(parts[0].strip()), int(parts[1].strip()))
                    else:
                        v = Fraction(value_text)
                    out["value_with_unit"] = (v, canon)
                    break
                except (ValueError, ZeroDivisionError, IndexError):
                    pass

        # Try integer
        if re.fullmatch(r"-?\d+", words_replaced):
            v = int(words_replaced)
            out["integer"] = v
            out["decimal"] = Fraction(v)

        # Try decimal (e.g. "0.75", "-3.14")
        elif re.fullmatch(r"-?\d+\.\d+", words_replaced):
            out["decimal"] = Fraction(words_replaced)

        # Try fraction p/q
        m = re.fullmatch(r"(-?\d+)\s*/\s*(\d+)", words_replaced)
        if m:
            p, q = int(m.group(1)), int(m.group(2))
            if q != 0:
                f = Fraction(p, q)
                out["fraction"] = (f.numerator, f.denominator)
                out.setdefault("decimal", f)

        # Try a mixed number "a b/c" (e.g. "7 2/3" = 23/3)
        mixed = _mixed_number_value(words_replaced)
        if mixed is not None:
            out["fraction"] = (mixed.numerator, mixed.denominator)
            out.setdefault("decimal", mixed)

        # Try "<word> over <word>" (after English word substitution)
        m = re.fullmatch(r"(-?\d+)\s+over\s+(\d+)", words_replaced, re.IGNORECASE)
        if m:
            p, q = int(m.group(1)), int(m.group(2))
            if q != 0:
                f = Fraction(p, q)
                out["fraction"] = (f.numerator, f.denominator)
                out.setdefault("decimal", f)

        # If nothing was parsed, fall back to text_words
        if not out:
            out["text_words"] = text

        return CanonicalAnswerForm(**out)

    except Exception:
        # Totality guarantee: never raise
        return CanonicalAnswerForm(text_words=s.strip().lower() if isinstance(s, str) else "")


# ---------------------------------------------------------------------------
# correct_syntax — fix common math notation for sympy
# ---------------------------------------------------------------------------


def correct_syntax(expr: str) -> str:
    """Fix common math notation issues for sympy parsing.
    
    - 6x → 6*x, 3(2+1) → 3*(2+1), etc.
    - ² → ^2, ³ → ^3
    """
    if not expr:
        return expr
    s = expr.strip()
    # Replace unicode superscripts
    s = s.replace("²", "^2").replace("³", "^3")
    # Replace standard unicode symbols
    s = s.replace("π", "pi").replace("θ", "theta")
    s = s.replace("×", "*").replace("÷", "/")
    s = s.replace("≤", "<=").replace("≥", ">=").replace("≠", "!=")
    
    # Replace square root symbols: e.g. √18 -> sqrt(18), √(18) -> sqrt(18)
    s = re.sub(r"√\((.*?)\)", r"sqrt(\1)", s)
    s = re.sub(r"√([a-zA-Z0-9\.\+\-\*\/]+)", r"sqrt(\1)", s)
    s = s.replace("√", "sqrt")

    # Insert * between digit and letter: 6x → 6*x, 64 k → 64*k
    s = re.sub(r"(\d)\s*([a-zA-Z])", r"\1*\2", s)
    # Insert * between letters split by spaces: a b → a*b (LaTeX keys space their terms)
    s = re.sub(r"([a-zA-Z])\s+(?=[a-zA-Z])", r"\1*", s)
    # Insert * between digit and ( : 3(2+1) → 3*(2+1)
    s = re.sub(r"(\d)\s*\(", r"\1*(", s)
    # Insert * between ) and digit: )5 → )*5
    s = re.sub(r"\)\s*(\d)", r")*\1", s)
    # Insert * between ) and ( : )(" → )*("
    s = re.sub(r"\)\s*\(", r")*(", s)
    return s



_SYMBOLIC_FUNCTIONS = {
    "abs", "cos", "exp", "ln", "log", "sin", "sqrt", "tan",
}

# LaTeX commands in answer keys, mapped to what a student can type (the maths
# keyboard inserts the Unicode symbols).
# debt: recurring decimals (\overline), reversed inequalities ("1 >= x") and
# products typed without spaces ("xy/2") are still not matched locally; they go
# to the LLM. Upgrade path: SymPy relational comparison and single-letter
# symbol splitting in safe_sympify.
_LATEX_SYMBOLS = {
    "leqslant": "≤", "leq": "≤", "le": "≤", "geqslant": "≥", "geq": "≥", "ge": "≥",
    "neq": "≠", "ne": "≠", "lt": "<", "gt": ">", "approx": "≈", "pm": "±",
    "angle": "∠", "triangle": "△", "pi": "π", "theta": "θ", "alpha": "α", "beta": "β",
    "infty": "∞", "circ": "°", "degree": "°", "lbrace": "{", "rbrace": "}",
}
_LATEX_SYMBOL = re.compile(
    r"\\(" + "|".join(sorted(_LATEX_SYMBOLS, key=len, reverse=True)) + r")(?![A-Za-z])"
)
_LATEX_TEXT = re.compile(r"\\(?:text|textrm|mathrm|mbox|operatorname)\s*\{([^{}]*)\}")
_LATEX_MIXED_NUMBER = re.compile(r"(?<![\w.^}])(\d+)\s*\\frac\s*\{(\d+)\}\s*\{(\d+)\}")
_LATEX_EXPONENT = re.compile(r"\^\s*\{([^{}]+)\}")
_LATEX_SQRT = re.compile(r"\\sqrt\s*\{([^{}]+)\}")
_LATEX_FRACTION = re.compile(r"\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}")


def _plain_exponent(match: re.Match) -> str:
    power = match.group(1).strip()
    return f"^{power}" if re.fullmatch(r"-?\d+|[A-Za-z]", power) else f"^({power})"


def strip_latex_math(value: str) -> str:
    """Turn an answer-only LaTeX string into the plain text a student would type.

    Example: "$7\\frac{2}{3}$" -> "7 2/3", "x \\leq 1" -> "x ≤ 1", "$46\\text{ m}$" -> "46 m".
    Prose is left alone apart from the same symbol mapping.
    """
    if not isinstance(value, str):
        return ""
    text = value.strip()
    # Outer $...$ (escaped \$ is a dollar sign), also "$28$ cm" and "$35^{\circ}$."
    dollars = [match.start() for match in re.finditer(r"(?<!\\)\$", text)]
    if len(dollars) == 2 and dollars[0] == 0:
        suffix = text[dollars[1] + 1:].strip().rstrip(".").strip()
        if "\\" not in suffix:
            text = f"{text[1:dollars[1]].strip()} {suffix}".strip()
    elif len(text) >= 4 and (
        (text.startswith(r"\(") and text.endswith(r"\)"))
        or (text.startswith(r"\[") and text.endswith(r"\]"))
    ):
        text = text[2:-2].strip()
    text = text.replace(r"\left", "").replace(r"\right", "")
    text = re.sub(r"\\[dt]frac(?![A-Za-z])", r"\\frac", text)
    # Symbols before \text{}: "86^\circ\text{F}" must not become "\circF".
    text = _LATEX_SYMBOL.sub(lambda match: _LATEX_SYMBOLS[match.group(1)], text)
    text = _LATEX_TEXT.sub(r"\1", text).replace("{}", "")
    text = text.replace(r"\{", "{").replace(r"\}", "}")
    text = re.sub(r"\^\s*(?:\{\s*°\s*\}|°)", "°", text)
    text = text.replace(r"\%", "%")
    text = text.replace(r"\times", "*").replace(r"\cdot", "*").replace(r"\div", "/")
    # Thin spaces: "10\,000" is a thousands group; elsewhere they are spaces.
    text = re.sub(r"(?<=\d)\\,(?=\d{3}(?!\d))", "", text)
    text = re.sub(r"\\[,;: ]", " ", text).replace(r"\!", "")
    text = _LATEX_MIXED_NUMBER.sub(r"\1 \2/\3", text)
    previous = None
    while previous != text:  # innermost groups first, e.g. \frac{4^{7}}{5}
        previous = text
        text = _LATEX_EXPONENT.sub(_plain_exponent, text)
        text = _LATEX_SQRT.sub(r"sqrt(\1)", text)
        text = _LATEX_FRACTION.sub(r"((\1)/(\2))", text)
    text = re.sub(r"^≈\s*", "", text.strip())
    return text.replace("{", "(").replace("}", ")").strip()


def _symbolic_candidate(value: str) -> str | None:
    """Return a tightly constrained SymPy candidate, or None for open/prose text."""
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text or len(text) > 256:
        return None

    # A complete outer maths delimiter is safe to remove. Embedded maths in a
    # prose sentence is deliberately not treated as a closed symbolic answer.
    if "$" in text:
        if text.count("$") != 2 or not (text.startswith("$") and text.endswith("$")):
            return None
        text = text[1:-1].strip()
    if not text or any(token in text for token in ("<", ">", "≤", "≥", "≠", "≈", ",", ";", ":")):
        return None

    text = text.replace(r"\left", "").replace(r"\right", "")
    text = text.replace(r"\times", "*").replace(r"\cdot", "*").replace(r"\div", "/")
    text = re.sub(r"\\sqrt\s*\{([^{}]+)\}", r"sqrt(\1)", text)
    fraction_pattern = re.compile(r"\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}")
    while fraction_pattern.search(text):
        text = fraction_pattern.sub(r"((\1)/(\2))", text)
    text = text.replace("{", "(").replace("}", ")")
    if "\\" in text:
        return None

    # Reject natural-language and units. Single-letter variables and a small
    # explicit function set are the only alphabetic tokens accepted.
    for token in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", text):
        if len(token) > 1 and token.lower() not in _SYMBOLIC_FUNCTIONS:
            return None
    if text.count("=") > 1:
        return None

    text = correct_syntax(text).replace("^", "**")
    return text if text.strip() else None


def _symbolic_expression(text: str):
    return safe_sympify(text)


def _is_nonzero_constant(expression) -> bool:
    simplified = _sp.simplify(expression)
    return not simplified.free_symbols and simplified.is_zero is False


def symbolic_mismatch_kind(student_answer: str, correct_answer: str) -> str:
    """Classify only demonstrably different closed symbolic maths answers.

    Returns an empty string whenever parsing, domain assumptions or answer shape
    are uncertain. This keeps the offline marker one-way safe: it may identify a
    proven mismatch, but it never converts open/prose or relational work into a
    deterministic wrong verdict.
    """
    try:
        student = _symbolic_candidate(student_answer)
        correct = _symbolic_candidate(correct_answer)
        if student is None or correct is None:
            return ""

        student_has_eq = "=" in student
        correct_has_eq = "=" in correct
        if student_has_eq or correct_has_eq:
            if not (student_has_eq and correct_has_eq):
                return ""
            student_left, student_right = student.split("=", 1)
            correct_left, correct_right = correct.split("=", 1)
            s_zero = _sp.expand(
                _symbolic_expression(student_left) - _symbolic_expression(student_right)
            )
            c_zero = _sp.expand(
                _symbolic_expression(correct_left) - _symbolic_expression(correct_right)
            )
            if _sp.simplify(s_zero - c_zero) == 0:
                return ""
            if c_zero != 0:
                ratio = _sp.cancel(s_zero / c_zero)
                if _is_nonzero_constant(ratio):
                    return ""
            symbols = tuple(sorted(s_zero.free_symbols | c_zero.free_symbols, key=str))
            if symbols and s_zero.is_rational_function(*symbols) and c_zero.is_rational_function(*symbols):
                return "equation"
            return ""

        s_expr = _symbolic_expression(student)
        c_expr = _symbolic_expression(correct)
        difference = _sp.simplify(s_expr - c_expr)
        if difference == 0:
            return ""

        # School logarithm identities are interpreted over their usual positive
        # real domain. Expanding both sides first avoids false negatives caused
        # by SymPy's default complex-domain conservatism.
        has_logs = bool(s_expr.atoms(_sp.log) or c_expr.atoms(_sp.log))
        if has_logs:
            log_difference = _sp.simplify(
                _sp.expand_log(s_expr, force=True) - _sp.expand_log(c_expr, force=True)
            )
            if log_difference == 0:
                return ""
            if log_difference.is_zero is False or log_difference.equals(0) is False:
                return "different"
            return ""

        symbols = tuple(sorted(s_expr.free_symbols | c_expr.free_symbols, key=str))
        if not symbols or not (
            s_expr.is_rational_function(*symbols) and c_expr.is_rational_function(*symbols)
        ):
            return ""

        exact_difference = _sp.cancel(s_expr - c_expr)
        if exact_difference == 0:
            return ""
        if _is_nonzero_constant(exact_difference):
            return "constant_term"
        if c_expr != 0:
            ratio = _sp.cancel(s_expr / c_expr)
            if _is_nonzero_constant(ratio):
                return "scaled"
        return "different"
    except Exception:
        return ""

# ---------------------------------------------------------------------------
# signatures (Req 3.10)
# ---------------------------------------------------------------------------


def signatures(answer: str) -> set[str]:
    """Build a set of string representations that the answer could appear as in text.

    Returns string forms suitable for searching in hint text.
    """
    try:
        if not isinstance(answer, str):
            return set()

        raw = answer.strip()
        if not raw:
            return set()

        sigs: set[str] = set()

        # Strip outer $...$ math delimiters if present — the answer data
        # may include LaTeX formatting that should not affect redaction matching.
        stripped = raw
        if stripped.startswith('$') and stripped.endswith('$') and len(stripped) > 2:
            stripped = stripped[1:-1].strip()

        form = normalise(stripped)

        # Always include the raw answer and its stripped form (without $)
        sigs.add(raw)
        sigs.add(stripped)
        # Also add the lowercased forms
        sigs.add(raw.lower())
        sigs.add(stripped.lower())

        # Integer form
        if form.integer is not None:
            sigs.add(str(form.integer))
            # English word form for small integers
            digit_str = str(form.integer)
            if digit_str in DIGITS_TO_WORDS:
                sigs.add(DIGITS_TO_WORDS[digit_str])

        # Decimal form
        if form.decimal is not None:
            # Add decimal string representation
            dec_float = float(form.decimal)
            # Only add if it's a "nice" decimal (not too many digits)
            dec_str = f"{dec_float:g}"
            sigs.add(dec_str)

            # Add fraction form from decimal
            f = form.decimal
            if f.denominator != 1:
                sigs.add(f"{f.numerator}/{f.denominator}")
                # Add English word form for spelled fractions
                num_str = str(f.numerator)
                den_str = str(f.denominator)
                if num_str in DIGITS_TO_WORDS and den_str in DIGITS_TO_WORDS:
                    sigs.add(f"{DIGITS_TO_WORDS[num_str]} over {DIGITS_TO_WORDS[den_str]}")

        # Fraction form
        if form.fraction is not None:
            p, q = form.fraction
            sigs.add(f"{p}/{q}")
            # Decimal equivalent
            dec_float = float(Fraction(p, q))
            sigs.add(f"{dec_float:g}")
            # English word form
            p_str, q_str = str(p), str(q)
            if p_str in DIGITS_TO_WORDS and q_str in DIGITS_TO_WORDS:
                sigs.add(f"{DIGITS_TO_WORDS[p_str]} over {DIGITS_TO_WORDS[q_str]}")

        # Value with unit
        if form.value_with_unit is not None:
            val, unit = form.value_with_unit
            val_str = str(int(val)) if val == int(val) else f"{float(val):g}"
            sigs.add(f"{val_str} {unit}")
            # Also add the unicode superscript form
            unit_display = unit.replace("^2", "²").replace("^3", "³")
            if unit_display != unit:
                sigs.add(f"{val_str} {unit_display}")

        return sigs

    except Exception:
        # Totality: never raise
        return {answer.strip()} if isinstance(answer, str) and answer.strip() else set()


def _numeric_value_and_unit(answer: str) -> tuple[Fraction, str | None] | None:
    """Return a numeric value and optional unit from a normalised answer."""
    form = normalise(answer)
    if form.value_with_unit is not None:
        value, unit = form.value_with_unit
        return value, unit
    if form.decimal is not None:
        return form.decimal, None
    if form.integer is not None:
        return Fraction(form.integer), None
    return None


def are_equivalent_with_metadata(
    student_answer: str,
    correct_answer: str,
    *,
    answer_tolerance: dict | None = None,
    alternative_answers: list[str] | None = None,
) -> bool:
    """Compare maths answers, including item-specific tolerances and alternatives."""
    if are_equivalent(student_answer, correct_answer):
        return True

    for alternative in alternative_answers or []:
        if isinstance(alternative, str) and alternative.strip():
            if are_equivalent(student_answer, alternative):
                return True
            if student_answer.strip().lower() == alternative.strip().lower():
                return True

    if not isinstance(answer_tolerance, dict):
        return False

    student_value = _numeric_value_and_unit(student_answer)
    correct_value = _numeric_value_and_unit(correct_answer)
    if student_value is None or correct_value is None:
        return False

    s_value, s_unit = student_value
    c_value, c_unit = correct_value
    if s_unit is not None and c_unit is not None and s_unit != c_unit:
        return False

    try:
        diff = abs(float(s_value - c_value))
        absolute = answer_tolerance.get("absolute")
        relative = answer_tolerance.get("relative")
        if absolute is not None and diff <= float(absolute):
            return True
        if relative is not None:
            scale = abs(float(c_value))
            limit = float(relative) * scale if scale > 1e-12 else float(relative)
            if diff <= limit:
                return True
    except (TypeError, ValueError, OverflowError):
        return False

    return False


# Text answers compare without spaces and with typed forms of maths symbols.
_TEXT_EQUIVALENTS = str.maketrans({" ": None, "×": "x", "−": "-", "≤": "<=", "≥": ">=", "≠": "!="})


def are_equivalent(student_answer: str, correct_answer: str) -> bool:
    """Determine if a student's answer is equivalent to the correct answer.

    Supports numeric, units, text, algebraic expressions, and equations.
    """
    if not student_answer or not isinstance(student_answer, str):
        return False
    if not correct_answer or not isinstance(correct_answer, str):
        return False

    s_clean = strip_latex_math(student_answer)
    c_clean = strip_latex_math(correct_answer)
    if not s_clean or not c_clean:
        return False

    # 1. Normalise both forms
    student_form = normalise(s_clean)
    correct_form = normalise(c_clean)

    # Helper function for floating point tolerance (2% relative tolerance)
    # The tolerance is for rounded decimals. Exact forms (integers, fractions,
    # mixed numbers) must be equal: 9 1/3 is not 9 1/2.
    uses_decimal = bool(re.search(r"\d\.|\.\d", f"{s_clean} {c_clean}"))

    def _is_non_integer(f: Fraction) -> bool:
        return f.denominator != 1

    def _is_close(s_val: Fraction, c_val: Fraction) -> bool:
        if s_val == c_val:
            return True
        if not uses_decimal:
            return False
        if not (_is_non_integer(s_val) or _is_non_integer(c_val)):
            return False
        try:
            s_float = float(s_val)
            c_float = float(c_val)
            if abs(c_float) > 1e-9:
                return abs(s_float - c_float) <= 0.02 * abs(c_float)
            else:
                return abs(s_float - c_float) <= 0.02
        except Exception:
            return False

    # 2. Compare value with units if both have units
    if student_form.value_with_unit is not None and correct_form.value_with_unit is not None:
        s_val, s_unit = student_form.value_with_unit
        c_val, c_unit = correct_form.value_with_unit
        if s_unit == c_unit and _is_close(s_val, c_val):
            return True

    # 3. Compare number-only to value-with-unit (allow optional units)
    elif student_form.value_with_unit is not None and correct_form.decimal is not None:
        student_val, _ = student_form.value_with_unit
        if _is_close(student_val, correct_form.decimal):
            return True
    elif correct_form.value_with_unit is not None and student_form.decimal is not None:
        correct_val, _ = correct_form.value_with_unit
        if _is_close(student_form.decimal, correct_val):
            return True

    # 4. Compare decimals (covers integers and fractions too)
    elif student_form.decimal is not None and correct_form.decimal is not None:
        if _is_close(student_form.decimal, correct_form.decimal):
            return True

    # 5. Compare text words (with normalised spacing and ×/x, ≤/<= equivalence)
    elif student_form.text_words is not None and correct_form.text_words is not None:
        s_raw = student_form.text_words.strip()
        c_raw = correct_form.text_words.strip()
        s_text = s_raw.translate(_TEXT_EQUIVALENTS)
        c_text = c_raw.translate(_TEXT_EQUIVALENTS)
        if s_text == c_text:
            return True
        # Handle 'and'-separated multi-values (e.g. "4 and -7" vs "-7 and 4")
        elif re.search(r'\band\b', s_raw) and re.search(r'\band\b', c_raw):
            s_parts = sorted(p.strip() for p in s_raw.lower().replace('x', '*').split('and') if p.strip())
            c_parts = sorted(p.strip() for p in c_raw.lower().replace('x', '*').split('and') if p.strip())
            if s_parts == c_parts:
                return True

    # 6. Equation equivalence check (e.g. "C = 3 + 2d" vs "C = 2d + 3" or "3 + 2d = C")
    # Also handles student writing just the RHS expression "3 + 2d"
    s_lower = s_clean.lower()
    c_lower = c_clean.lower()
    
    if '=' in s_lower or '=' in c_lower:
        # standard orientation check: both have '='
        if '=' in s_lower and '=' in c_lower:
            s_parts = s_lower.split('=')
            c_parts = c_lower.split('=')
            if len(s_parts) == 2 and len(c_parts) == 2:
                s_l, s_r = s_parts[0].strip(), s_parts[1].strip()
                c_l, c_r = c_parts[0].strip(), c_parts[1].strip()
                
                # Check direct match LHS=LHS, RHS=RHS
                try:
                    l_match = (s_l == c_l) or (_sp.simplify(safe_sympify(correct_syntax(s_l)) - safe_sympify(correct_syntax(c_l))) == 0)
                    r_match = (s_r == c_r) or (_sp.simplify(safe_sympify(correct_syntax(s_r)) - safe_sympify(correct_syntax(c_r))) == 0)
                    if l_match and r_match:
                        return True
                except Exception:
                    pass
                    
                # Check swapped match LHS=RHS, RHS=LHS
                try:
                    l_match_swap = (s_l == c_r) or (_sp.simplify(safe_sympify(correct_syntax(s_l)) - safe_sympify(correct_syntax(c_r))) == 0)
                    r_match_swap = (s_r == c_l) or (_sp.simplify(safe_sympify(correct_syntax(s_r)) - safe_sympify(correct_syntax(c_l))) == 0)
                    if l_match_swap and r_match_swap:
                        return True
                except Exception:
                    pass
                # Check algebraic equivalence: (s_l - s_r) == +/- (c_l - c_r).
                # Only for equations with a variable: every true number
                # sentence has a zero difference.
                try:
                    s_diff = safe_sympify(correct_syntax(s_l)) - safe_sympify(correct_syntax(s_r))
                    c_diff = safe_sympify(correct_syntax(c_l)) - safe_sympify(correct_syntax(c_r))
                    if c_diff.free_symbols and (
                        _sp.simplify(s_diff - c_diff) == 0 or _sp.simplify(s_diff + c_diff) == 0
                    ):
                        return True
                except Exception:
                    pass
                    
        # student omitted LHS/RHS (e.g. student wrote "3+2d" instead of "C = 3+2d" or "3+2d = C")
        elif '=' not in s_lower and '=' in c_lower:
            c_parts = c_lower.split('=')
            if len(c_parts) == 2:
                c_l = c_parts[0].strip()
                c_r = c_parts[1].strip()
                s_nospace = s_lower.replace(' ', '')
                if s_nospace in (c_l.replace(' ', ''), c_r.replace(' ', '')):
                    return True
                try:
                    s_sym = safe_sympify(correct_syntax(s_lower))
                    if _sp.simplify(s_sym - safe_sympify(correct_syntax(c_r))) == 0:
                        return True
                    if _sp.simplify(s_sym - safe_sympify(correct_syntax(c_l))) == 0:
                        return True
                except Exception:
                    pass
        
        # student wrote full equation but correct is just expression (e.g. student wrote "C = 3+2d" or "3+2d = C" instead of "3+2d")
        elif '=' in s_lower and '=' not in c_lower:
            s_parts = s_lower.split('=')
            if len(s_parts) == 2:
                s_l = s_parts[0].strip()
                s_r = s_parts[1].strip()
                c_nospace = c_lower.replace(' ', '')
                if c_nospace in (s_l.replace(' ', ''), s_r.replace(' ', '')):
                    return True
                try:
                    c_sym = safe_sympify(correct_syntax(c_lower))
                    if _sp.simplify(safe_sympify(correct_syntax(s_r)) - c_sym) == 0:
                        return True
                    if _sp.simplify(safe_sympify(correct_syntax(s_l)) - c_sym) == 0:
                        return True
                except Exception:
                    pass

    # 7. Compare expressions with sympy (e.g. "2a+7b" vs "7b+2a", "sqrt(4)" vs "2")
    try:
        s_expr = safe_sympify(correct_syntax(s_clean))
        c_expr = safe_sympify(correct_syntax(c_clean))
        if _sp.simplify(s_expr - c_expr) == 0:
            return True
    except Exception:
        pass

    return False


def are_equivalent_text(student: str, correct: str) -> bool:
    """Lightweight English text equivalence check — runs BEFORE LLM.

    Handles case-insensitivity, whitespace normalization, trailing punctuation,
    and Oxford comma tolerance. Strictly rejects spelling errors — no edit
    distance tolerance. A spelling test requires character-level precision.
    """
    if not student or not correct:
        return False
    if not isinstance(student, str) or not isinstance(correct, str):
        return False

    s = student.strip().lower()
    c = correct.strip().lower()

    # Normalize smart quotes and apostrophes to standard straight ones
    s = s.replace('“', '"').replace('”', '"').replace('‘', "'").replace('’', "'")
    c = c.replace('“', '"').replace('”', '"').replace('‘', "'").replace('’', "'")

    if not s or not c:
        return False

    # 1. Exact match (case-insensitive)
    if s == c:
        return True

    # 2. Whitespace normalized
    s_norm = re.sub(r'\s+', ' ', s)
    c_norm = re.sub(r'\s+', ' ', c)
    if s_norm == c_norm:
        return True

    # 3. Ignore trailing punctuation
    s_np = s_norm.rstrip(".,;:!?\"')")
    c_np = c_norm.rstrip(".,;:!?\"')")
    if s_np == c_np:
        return True

    # 4. Oxford comma tolerance
    s_ox = s_np.replace(', and', ' and')
    c_ox = c_np.replace(', and', ' and')
    if s_ox == c_ox:
        return True

    return False


def are_equivalent_text_strict(student: str, correct: str) -> bool:
    """Strict English text equivalence for punctuation exercises.

    Same as are_equivalent_text but does NOT strip trailing punctuation.
    This ensures students can't get a punctuation exercise correct by
    omitting the period — the period IS part of what's being tested.
    Oxford comma tolerance is retained (not the punctuation being tested).
    """
    if not student or not correct:
        return False
    if not isinstance(student, str) or not isinstance(correct, str):
        return False

    s = student.strip().lower()
    c = correct.strip().lower()

    # Normalize smart quotes and apostrophes to standard straight ones
    s = s.replace('“', '"').replace('”', '"').replace('‘', "'").replace('’', "'")
    c = c.replace('“', '"').replace('”', '"').replace('‘', "'").replace('’', "'")

    if not s or not c:
        return False

    # 1. Exact match (case-insensitive)
    if s == c:
        return True

    # 2. Whitespace normalized
    s_norm = re.sub(r'\s+', ' ', s)
    c_norm = re.sub(r'\s+', ' ', c)
    if s_norm == c_norm:
        return True

    # 3. Oxford comma tolerance (but NO trailing punctuation strip)
    s_ox = s_norm.replace(', and', ' and')
    c_ox = c_norm.replace(', and', ' and')
    if s_ox == c_ox:
        return True

    return False


async def are_equivalent_async(student_answer: str, correct_answer: str) -> bool:
    """Asynchronously evaluate equivalence using thread pool to protect async endpoints."""
    from fastapi.concurrency import run_in_threadpool
    return await run_in_threadpool(are_equivalent, student_answer, correct_answer)


async def normalise_async(s: str) -> CanonicalAnswerForm:
    """Asynchronously normalise using thread pool to protect async endpoints."""
    from fastapi.concurrency import run_in_threadpool
    return await run_in_threadpool(normalise, s)


async def safe_sympify_async(expr_str: str):
    """Asynchronously sympify using thread pool to protect async endpoints."""
    from fastapi.concurrency import run_in_threadpool
    return await run_in_threadpool(safe_sympify, expr_str)
