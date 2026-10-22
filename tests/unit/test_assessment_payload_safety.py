import asyncio
import json

from backend.answer_grading import grade_answer, grade_multi_part_details
from backend.diagnostic_engine import _is_supported_diagnostic_question, _safe_diagnostic_question
from backend.exam_simulator import (
    ExamSimulator,
    _is_supported_generated_exam_question,
    _safe_exam_question,
)
from backend.routers import tutor as tutor_router


FORBIDDEN_FIELDS = {
    "answer",
    "correct_answer",
    "correct_choice",
    "solution",
    "worked_solution",
    "rubric",
    "sample_reasoning",
    "accepted_answer_variants",
    "steps",
}


def _assert_no_forbidden_fields(payload: dict):
    for field in FORBIDDEN_FIELDS:
        assert field not in payload
    for part in payload.get("sub_parts") or []:
        for field in FORBIDDEN_FIELDS:
            assert field not in part


def test_safe_exam_question_removes_answer_bearing_fields():
    raw = {
        "id": "exam-safe-1",
        "question": "Answer both parts.",
        "question_type": "multi_part",
        "difficulty": "developing",
        "complexity": "complex_familiar",
        "topic_ids": ["AC9M7N01"],
        "answer": "secret",
        "rubric": {"key_points": ["secret method"], "max_score": 2},
        "sample_reasoning": "The answer is secret.",
        "sub_parts": [
            {
                "label": "a",
                "question": "Pick the even number.",
                "choices": ["3", "4"],
                "answer": "B",
                "solution": "4 is even.",
                "worked_solution": "Choose B.",
                "marks": 1,
            }
        ],
    }

    safe = _safe_exam_question(raw)

    _assert_no_forbidden_fields(safe)
    assert safe["sub_parts"] == [
        {"label": "a", "question": "Pick the even number.", "marks": 1, "choices": ["3", "4"]}
    ]


def test_safe_diagnostic_question_removes_answer_bearing_fields():
    raw = {
        "id": "diag-safe-1",
        "question": "Explain your reasoning.",
        "question_type": "reasoning",
        "topic_ids": ["AC9M7A01"],
        "difficulty": "extending",
        "answer": "secret",
        "rubric": {"key_points": ["secret point"], "max_score": 3},
        "sample_reasoning": "A full model response.",
        "steps": ["do this", "then that"],
    }

    safe = _safe_diagnostic_question(raw)

    _assert_no_forbidden_fields(safe)
    assert safe["id"] == "diag-safe-1"
    assert safe["question_type"] == "reasoning"


def test_multi_part_choice_text_grades_against_letter_answer():
    exercise = {
        "id": "multi-choice-subpart",
        "subject": "math",
        "question_type": "multi_part",
        "sub_parts": [
            {"label": "a", "question": "Pick 4.", "choices": ["3", "4"], "answer": "B", "marks": 2}
        ],
    }
    student_answer = json.dumps({"a": "4"})

    assert grade_answer(exercise, student_answer) is True
    details = grade_multi_part_details(exercise, student_answer)
    assert details["is_correct"] is True
    assert details["score"] == 2


def test_generated_exam_filter_excludes_reasoning_exact_match_items():
    exercises = {
        "reasoning": {
            "id": "reasoning",
            "subject": "math",
            "year_level": 7,
            "question": "Explain why.",
            "question_type": "reasoning",
            "rubric": {"max_score": 3, "key_points": ["secret"]},
            "sample_reasoning": "Full model response.",
            "answer": "model",
            "topic_ids": ["AC9M7A01"],
        },
        "short": {
            "id": "short",
            "subject": "math",
            "year_level": 7,
            "question": "2 + 2?",
            "question_type": "short_answer",
            "answer": "4",
            "topic_ids": ["AC9M7N01"],
        },
    }

    assert _is_supported_generated_exam_question(exercises["reasoning"]) is False
    assert _is_supported_generated_exam_question(exercises["short"]) is True
    paper = ExamSimulator(exercises)._build_paper(
        subject="math",
        year_level=7,
        num_questions=2,
        sf_ratio=1.0,
        cf_ratio=0.0,
        cu_ratio=0.0,
    )
    assert paper == ["short"]


def test_generated_exam_filter_requires_gradable_multi_part_subparts():
    assert _is_supported_generated_exam_question({
        "question_type": "multi_part",
        "sub_parts": [{"label": "a", "question": "Part A", "answer": "4"}],
    }) is True
    assert _is_supported_generated_exam_question({
        "question_type": "multi_part",
        "sub_parts": [{"label": "a", "question": "Part A"}],
    }) is False


def test_diagnostic_filter_allows_short_answer_and_mcq():
    # short_answer and multiple_choice are both deterministically gradable and
    # renderable, so the diagnostic accepts both (QW2). multi_part stays excluded.
    assert _is_supported_diagnostic_question({"question_type": "short_answer"}) is True
    assert _is_supported_diagnostic_question({"question_type": "multiple_choice"}) is True
    assert _is_supported_diagnostic_question({"question_type": "multi_part"}) is False
    # reasoning is excluded unless reasoning grading is enabled (LLM available)...
    reasoning_item = {"question_type": "reasoning", "rubric": {"key_points": ["a"], "max_score": 1}}
    assert _is_supported_diagnostic_question(reasoning_item) is False
    assert _is_supported_diagnostic_question(reasoning_item, include_reasoning=True) is True
    # ...and even then only with a machine rubric.
    assert _is_supported_diagnostic_question({"question_type": "reasoning"}, include_reasoning=True) is False


def test_exam_report_percentage_uses_marks_and_preserves_full_question_text():
    long_question = "This is a long multi-part question. " * 10
    exercises = {
        "multi": {
            "id": "multi",
            "subject": "math",
            "question": long_question,
            "question_type": "multi_part",
            "topic_ids": ["AC9M7N01"],
            "difficulty": "developing",
            "sub_parts": [
                {"label": "a", "question": "2 + 2?", "answer": "4", "marks": 2},
                {"label": "b", "question": "3 + 3?", "answer": "6", "marks": 1},
            ],
        },
        "short": {
            "id": "short",
            "subject": "math",
            "question": "1 + 1?",
            "question_type": "short_answer",
            "topic_ids": ["AC9M7N01"],
            "difficulty": "developing",
            "answer": "2",
        },
    }
    sim = ExamSimulator(exercises)

    report = sim._grade_paper({
        "exam_id": "exam-marks",
        "paper": ["multi", "short"],
        "responses": {
            "multi": json.dumps({"a": "4", "b": "5"}),
            "short": "2",
        },
        "started_at": "2026-01-01T00:00:00+00:00",
        "completed_at": "2026-01-01T00:45:00+00:00",
    })

    assert report["total_score"] == 3
    assert report["total_max_score"] == 4
    assert report["percentage"] == 75
    assert report["results_per_question"][0]["question"] == long_question
    assert report["results_per_question"][0]["part_results"][0]["marks"] == 2


def test_tutor_mark_route_removes_answer_bearing_part_fields(monkeypatch):
    class FakeTutor:
        def mark(self, *_args, **_kwargs):
            return {
                "is_correct": False,
                "outcome": "unanswered",
                "feedback": "Part (a) was checked; part (b) is unanswered.",
                "question_type": "multi_part",
                "internal_trace": "must not leave the service",
                "part_results": [
                    {
                        "label": "a",
                        "is_correct": True,
                        "outcome": "correct",
                        "student_answer": "4",
                        "correct_answer": "4",
                        "score": 1,
                        "max_score": 1,
                        "point_attainment": [{"text": "secret rubric"}],
                    },
                    {
                        "label": "b",
                        "is_correct": False,
                        "outcome": "unanswered",
                        "student_answer": "",
                        "correct_answer": "42",
                        "rubric_source": "authored secret",
                    },
                ],
            }

    monkeypatch.setattr(tutor_router, "get_tutor_engine", lambda: FakeTutor())
    request = tutor_router.MarkRequest(question_id="multi-1", student_answer='{"a":"4"}')

    response = asyncio.run(tutor_router.mark_answer(request, student_id="11111111-1111-4111-8111-111111111111"))

    assert response["feedback"].startswith("Part (a)")
    assert response["part_results"][0]["student_answer"] == "4"
    assert response["part_results"][1]["outcome"] == "unanswered"
    assert "internal_trace" not in response
    for part in response["part_results"]:
        assert "correct_answer" not in part
        assert "point_attainment" not in part
        assert "rubric_source" not in part
