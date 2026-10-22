"""Open responses must not be force-marked wrong by exact matching.

Exams and diagnostics grade maths deterministically, which is right for a value
answer. It is not right for an item that asks the student to *explain*: there is
no single enumerable correct string, so a sound paraphrase scored zero with no
review path. These items now route through the same review-deferring grader
already used for English/Science open responses, matching the documented rule
that a response which cannot be scored safely is deferred rather than treated as
incorrect.
"""
from __future__ import annotations

from backend.diagnostic_engine import DiagnosticEngine
from backend.exam_simulator import ExamSimulator
from backend.services.marking import demands_written_reasoning

EXPLAIN_ITEM = {
    "id": "explain-item",
    "subject": "math",
    "year_level": 8,
    "topic": "Congruence",
    "topic_ids": ["AC9M8SP01"],
    "question_type": "short_answer",
    "question": "Two triangles have two angles of 50° and 60°. Are they necessarily congruent? Explain.",
    "answer": "No; they are similar (same shape) but may have different sizes",
    "difficulty": "developing",
}

VALUE_ITEM = {
    "id": "value-item",
    "subject": "math",
    "year_level": 8,
    "topic": "Fractions",
    "topic_ids": ["AC9M8N01"],
    "question_type": "short_answer",
    "question": "Convert 0.666... to a simplified fraction.",
    "answer": "2/3",
    "difficulty": "developing",
}

PARAPHRASE = "No — same angles means similar, but the side lengths may differ."


def test_predicate_detects_written_reasoning_demands():
    assert demands_written_reasoning(EXPLAIN_ITEM) is True
    assert demands_written_reasoning(VALUE_ITEM) is False
    # An item with an authored rubric is already graded against criteria.
    assert demands_written_reasoning({**EXPLAIN_ITEM, "rubric": {"key_points": ["a"]}}) is False


def test_exam_defers_a_paraphrased_explanation_instead_of_scoring_zero():
    sim = ExamSimulator({EXPLAIN_ITEM["id"]: EXPLAIN_ITEM})
    score, max_score, is_correct, requires_review, _ = sim._grade_short_answer_text(
        EXPLAIN_ITEM, PARAPHRASE
    )
    assert requires_review is True
    assert is_correct is False
    assert max_score == 1 and score == 0

    # The authored answer still scores without review.
    score, _, is_correct, requires_review, _ = sim._grade_short_answer_text(
        EXPLAIN_ITEM, EXPLAIN_ITEM["answer"]
    )
    assert (is_correct, requires_review, score) == (True, False, 1)

    # A blank response is unanswered, not review-pending.
    _, _, is_correct, requires_review, _ = sim._grade_short_answer_text(EXPLAIN_ITEM, "")
    assert (is_correct, requires_review) == (False, False)


def test_diagnostic_defers_a_paraphrased_explanation():
    diagnostic = DiagnosticEngine({EXPLAIN_ITEM["id"]: EXPLAIN_ITEM})
    result = diagnostic._grade_response(EXPLAIN_ITEM, PARAPHRASE)
    assert result["outcome"] == "pending"
    assert result["error_type"] == "grading_deferred"

    exact = diagnostic._grade_response(EXPLAIN_ITEM, EXPLAIN_ITEM["answer"])
    assert exact["outcome"] == "correct"


def test_value_answers_stay_deterministic():
    diagnostic = DiagnosticEngine({VALUE_ITEM["id"]: VALUE_ITEM})
    assert diagnostic._grade_response(VALUE_ITEM, "2/3")["outcome"] == "correct"
    # A wrong value is still a confirmed error, not a deferral.
    wrong = diagnostic._grade_response(VALUE_ITEM, "9/10")
    assert wrong["outcome"] == "incorrect"
    # Same error type as practice, so the Error Book does not count it as "unknown".
    assert wrong["error_type"] == "incorrect_value"


MULTI_PART_ITEM = {
    "id": "multi-part-explain",
    "subject": "math",
    "year_level": 8,
    "topic": "Probability",
    "topic_ids": ["AC9M8P01"],
    "question_type": "multi_part",
    "question": "A bag has 3 red and 5 blue counters.",
    "answer": "see sub-parts",
    "difficulty": "developing",
    "sub_parts": [
        {"label": "a", "question": "What is P(red)?", "answer": "3/8", "marks": 1},
        {
            "label": "b",
            "question": "Explain why the two outcomes are not equally likely.",
            "answer": "There are more blue counters than red, so blue is more likely.",
            "marks": 2,
        },
    ],
}

VALUE_ONLY_MULTI_PART = {
    **MULTI_PART_ITEM,
    "id": "multi-part-values",
    "sub_parts": [
        {"label": "a", "question": "What is P(red)?", "answer": "3/8", "marks": 1},
        {"label": "b", "question": "What is P(blue)?", "answer": "5/8", "marks": 1},
    ],
}


def test_diagnostic_defers_a_multi_part_item_with_an_explanation_part():
    import json

    diagnostic = DiagnosticEngine({MULTI_PART_ITEM["id"]: MULTI_PART_ITEM})
    paraphrased = diagnostic._grade_response(
        MULTI_PART_ITEM,
        json.dumps({"a": "3/8", "b": "Blue has more counters, so blue is more likely."}),
    )
    assert paraphrased["outcome"] == "pending"
    assert paraphrased["error_type"] == "grading_deferred"

    verbatim = diagnostic._grade_response(
        MULTI_PART_ITEM,
        json.dumps({"a": "3/8", "b": MULTI_PART_ITEM["sub_parts"][1]["answer"]}),
    )
    assert verbatim["outcome"] == "correct"


def test_diagnostic_keeps_value_only_multi_part_deterministic():
    import json

    diagnostic = DiagnosticEngine({VALUE_ONLY_MULTI_PART["id"]: VALUE_ONLY_MULTI_PART})
    both = diagnostic._grade_response(VALUE_ONLY_MULTI_PART, json.dumps({"a": "3/8", "b": "5/8"}))
    assert both["outcome"] == "correct"
    partial = diagnostic._grade_response(VALUE_ONLY_MULTI_PART, json.dumps({"a": "3/8", "b": "1/2"}))
    assert partial["outcome"] == "incorrect"
    assert partial["score"] < partial["max_score"]


def test_diagnostic_multi_part_miss_uses_practice_error_types():
    """A deterministic multi-part miss is typed like practice, not left as unknown."""
    import json

    diagnostic = DiagnosticEngine({VALUE_ONLY_MULTI_PART["id"]: VALUE_ONLY_MULTI_PART})
    partial = diagnostic._grade_response(VALUE_ONLY_MULTI_PART, json.dumps({"a": "3/8", "b": "1/2"}))
    assert partial["outcome"] == "incorrect"
    assert partial["error_type"] == "partial_incorrect"
    parts = {part["label"]: part for part in partial["part_results"]}
    assert parts["a"].get("error_type") is None
    assert parts["b"]["error_type"] == "incorrect_value"
