"""QW7 regression tests — extended-response (reasoning) handling in exams.

Verifies:
- Reasoning items are gated into generated papers only when include_extended is set.
- Reasoning items are NOT mis-graded as 'incorrect' by string equality
  (the old, broken behaviour for imported QCAA papers); instead they are
  rubric-graded, or deferred to review when the LLM is unavailable.
"""
from __future__ import annotations

from unittest.mock import MagicMock

import backend.exam_simulator
from backend.exam_simulator import ExamSimulator, _is_supported_generated_exam_question


REASONING_EX = {
    "id": "reason_1",
    "subject": "math",
    "year_level": 7,
    "complexity": "complex_unfamiliar",
    "difficulty": "extending",
    "question_type": "reasoning",
    "question": "Tom says 1/3 + 1/4 = 2/7. Is he correct? Justify.",
    "answer": "Wrong; correct is 7/12.",
    "sample_reasoning": "Find common denominator 12; 4/12 + 3/12 = 7/12, not 2/7.",
    "rubric": {"max_score": 3, "key_points": [
        {"text": "identify error"}, {"text": "common denominator"}, {"text": "correct calc"},
    ]},
    "topic_ids": ["AC9M7N04"],
}


def test_reasoning_gated_by_include_extended():
    assert _is_supported_generated_exam_question(REASONING_EX, include_extended=False) is False
    assert _is_supported_generated_exam_question(REASONING_EX, include_extended=True) is True
    # short answer / mcq always supported
    assert _is_supported_generated_exam_question({"question_type": "short_answer"}) is True
    assert _is_supported_generated_exam_question({"question_type": "multiple_choice"}) is True


def test_reasoning_not_string_equality_graded(monkeypatch):
    """In mock mode (no LLM), a genuine extended response must be deferred to
    review — never auto-marked incorrect by comparing to the model answer."""
    sim = ExamSimulator(exercises={"reason_1": REASONING_EX})

    # Force the reasoning marker into mock/PU behaviour (parent_review_pending).
    fake_engine = MagicMock()
    fake_engine._mark_reasoning.return_value = {
        "is_correct": False,
        "error_type": "parent_review_pending",
        "feedback": "Saved for review.",
        "score": 0,
        "max_score": 3,
    }
    import backend.routers.helpers as helpers
    monkeypatch.setattr(helpers, "get_tutor_engine", lambda: fake_engine)

    score, max_score, is_correct, requires_review, feedback = sim._grade_reasoning(
        REASONING_EX, "A genuine multi-sentence justification that differs in wording."
    )
    assert requires_review is True
    assert is_correct is False
    assert max_score == 3


def test_reasoning_blank_scores_zero_without_review():
    sim = ExamSimulator(exercises={"reason_1": REASONING_EX})
    score, max_score, is_correct, requires_review, feedback = sim._grade_reasoning(REASONING_EX, "   ")
    assert score == 0
    assert is_correct is False
    assert requires_review is False


def test_reasoning_without_rubric_defers_to_review():
    """Imported extended-response items often lack a machine rubric → must be
    routed to review, not force-graded."""
    sim = ExamSimulator(exercises={})
    no_rubric = {**REASONING_EX, "rubric": {}}
    score, max_score, is_correct, requires_review, feedback = sim._grade_reasoning(
        no_rubric, "Some thoughtful extended response."
    )
    assert requires_review is True
    assert is_correct is False


MULTI_PART_ENGLISH = {
    "id": "mp_en_1",
    "subject": "english",
    "year_level": 7,
    "question_type": "multi_part",
    "question": "Answer both parts about the metaphor.",
    "topic_ids": ["AC9E7LE02"],
    "sub_parts": [
        {
            "label": "a",
            "question": "What is the effect of the metaphor?",
            "answer": "It builds tension.",
            "marks": 1,
        },
        {
            "label": "b",
            "question": "Quote one supporting phrase.",
            "answer": "heart of stone",
            "marks": 1,
        },
    ],
}


def test_exam_multi_part_open_text_defers_to_review_when_llm_pending(monkeypatch):
    """P0: open English multi-part must not be string-failed; pending → review."""
    sim = ExamSimulator(exercises={"mp_en_1": MULTI_PART_ENGLISH})
    fake_engine = MagicMock()
    fake_engine._mark_multi_part.return_value = {
        "is_correct": False,
        "error_type": "parent_review_pending",
        "feedback": "Saved for review.",
        "score": 0,
        "max_score": 2,
        "part_results": [
            {"label": "a", "is_correct": False, "error_type": "parent_review_pending", "marks": 1},
            {"label": "b", "is_correct": False, "error_type": "parent_review_pending", "marks": 1},
        ],
    }
    import backend.routers.helpers as helpers
    monkeypatch.setattr(helpers, "get_tutor_engine", lambda: fake_engine)

    score, max_score, is_correct, requires_review, feedback, part_results = sim._grade_multi_part(
        MULTI_PART_ENGLISH,
        '{"a":"It makes the reader uneasy.","b":"heart of stone"}',
    )
    assert requires_review is True
    assert is_correct is False
    assert score == 0
    assert max_score == 2
    assert len(part_results) == 2
    fake_engine._mark_multi_part.assert_called_once()


def test_exam_multi_part_blank_scores_zero_without_review():
    sim = ExamSimulator(exercises={"mp_en_1": MULTI_PART_ENGLISH})
    score, max_score, is_correct, requires_review, feedback, part_results = sim._grade_multi_part(
        MULTI_PART_ENGLISH, "   "
    )
    assert score == 0
    assert is_correct is False
    assert requires_review is False
