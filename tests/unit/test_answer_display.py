"""Correct answers are shown as Markdown with maths: bare LaTeX gets ``$`` signs."""

import pytest

from backend.answer_grading import answer_markdown, correct_answer_for_display
from backend.tutor_engine import _revealed_answer


@pytest.mark.parametrize("raw,shown", [
    ("3\\frac{21}{25}", "$3\\frac{21}{25}$"),
    ("c = \\sqrt{106}", "$c = \\sqrt{106}$"),
    ("10 v^{4}", "$10 v^{4}$"),
    # Point names are capital letters, not words.
    ("\\angle BCD = 42 ^{\\circ}", "$\\angle BCD = 42 ^{\\circ}$"),
    ("0.7 \\text{ g/cm}^3", "$0.7 \\text{ g/cm}^3$"),
    # A choice label stays outside the maths.
    ("A) cm^3", "A) $cm^3$"),
])
def test_bare_maths_answers_become_maths(raw, shown):
    assert answer_markdown(raw) == shown


@pytest.mark.parametrize("text", [
    "15",
    "7 and 8",
    "9.9 m",
    "$\\sqrt{20}$ and $\\pi$ are irrational",
    # A sentence keeps its spaces; it is not put in maths mode.
    "Separate to y dy = x dx, integrate to y^2=x^2+9.",
    "",
])
def test_other_answers_do_not_change(text):
    assert answer_markdown(text) == text


def test_display_answers_and_revealed_parts_use_maths():
    assert correct_answer_for_display({"question_type": "short_answer", "answer": "\\frac{3}{4}"}) == "$\\frac{3}{4}$"
    question = {
        "question_type": "multi_part",
        "sub_parts": [
            {"label": "a", "answer": "2\\frac{2}{3}"},
            {"label": "b", "answer": "12"},
        ],
    }
    assert _revealed_answer(question) == "Part (a): $2\\frac{2}{3}$\nPart (b): 12"
