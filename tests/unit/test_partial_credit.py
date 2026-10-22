"""Tests for partial-credit multi-part grading (Audit Packet 3.1)."""
from __future__ import annotations

import json

import pytest

from backend.answer_grading import grade_answer, grade_multi_part_details


def _english_multi_part(n_parts: int = 3) -> dict:
    return {
        "id": "mp_en_1",
        "subject": "english",
        "question_type": "multi_part",
        "question": "Read the passage and answer.",
        "answer": "See parts",
        "sub_parts": [
            {"label": chr(97 + i), "question": f"Part {i+1}?", "answer": f"answer{i+1}", "marks": 1}
            for i in range(n_parts)
        ],
    }


def _math_multi_part(n_parts: int = 3) -> dict:
    return {
        "id": "mp_math_1",
        "subject": "math",
        "question_type": "multi_part",
        "question": "Solve.",
        "answer": "See parts",
        "sub_parts": [
            {"label": chr(97 + i), "question": f"Part {i+1}?", "answer": str(i + 1), "marks": 2}
            for i in range(n_parts)
        ],
    }


class TestGradeMultiPartDetails:
    """grade_multi_part_details returns per-part results for partial credit."""

    def test_all_correct_english(self):
        ex = _english_multi_part(3)
        answer = json.dumps({"a": "answer1", "b": "answer2", "c": "answer3"})
        result = grade_multi_part_details(ex, answer)
        assert result["is_correct"] is True
        assert result["score"] == 3
        assert result["max_score"] == 3
        assert all(pr["is_correct"] for pr in result["part_results"])

    def test_partial_credit_english(self):
        ex = _english_multi_part(3)
        answer = json.dumps({"a": "answer1", "b": "wrong", "c": "answer3"})
        result = grade_multi_part_details(ex, answer)
        assert result["is_correct"] is False
        assert result["score"] == 2
        assert result["max_score"] == 3
        assert result["part_results"][0]["is_correct"] is True
        assert result["part_results"][1]["is_correct"] is False
        assert result["part_results"][2]["is_correct"] is True

    def test_none_correct_english(self):
        ex = _english_multi_part(3)
        answer = json.dumps({"a": "wrong1", "b": "wrong2", "c": "wrong3"})
        result = grade_multi_part_details(ex, answer)
        assert result["is_correct"] is False
        assert result["score"] == 0

    def test_partial_credit_math(self):
        ex = _math_multi_part(3)  # marks=2 each, max=6
        answer = json.dumps({"a": "1", "b": "2", "c": "99"})
        result = grade_multi_part_details(ex, answer)
        assert result["is_correct"] is False
        assert result["score"] == 4  # 2+2 correct, 1 wrong
        assert result["max_score"] == 6

    def test_empty_answer(self):
        ex = _english_multi_part(3)
        result = grade_multi_part_details(ex, "")
        assert result["is_correct"] is False
        assert result["score"] == 0
        assert result["max_score"] == 3

    def test_no_sub_parts(self):
        ex = {"id": "x", "subject": "english", "question_type": "multi_part"}
        result = grade_multi_part_details(ex, "anything")
        assert result["part_results"] == []
        assert result["score"] == 0
        assert result["max_score"] == 0

    def test_backward_compat_grade_answer_still_all_or_nothing(self):
        """grade_answer remains all-or-nothing for non-exam paths."""
        ex = _english_multi_part(3)
        # 2/3 correct → grade_answer should be False (all-or-nothing)
        answer = json.dumps({"a": "answer1", "b": "wrong", "c": "answer3"})
        assert grade_answer(ex, answer) is False
        # 3/3 correct → True
        full = json.dumps({"a": "answer1", "b": "answer2", "c": "answer3"})
        assert grade_answer(ex, full) is True
