"""Subject-aware grading gates for exam and diagnostic paths."""

from __future__ import annotations

from backend.answer_grading import correct_answer_for_display, grade_answer
from backend.diagnostic_engine import DiagnosticEngine
from backend.exam_simulator import ExamSimulator


def _english_short_answer(answer: str = "the cat sat") -> dict:
    return {
        "id": "eng_sa_001",
        "subject": "english",
        "year_level": 7,
        "question_type": "short_answer",
        "question": "Rewrite the sentence.",
        "answer": answer,
        "framework": "AC9_ENGLISH",
        "topic_ids": ["AC9E7LA06"],
    }


def _math_short_answer(answer: str = "60 cm²") -> dict:
    return {
        "id": "math_sa_001",
        "subject": "math",
        "year_level": 7,
        "question_type": "short_answer",
        "question": "Find the area.",
        "answer": answer,
        "framework": "AC9_MATHS",
        "topic_ids": ["AC9M7M01"],
    }


def test_grade_answer_uses_text_equivalence_for_english_short_answer():
    question = _english_short_answer("The cat sat")

    assert grade_answer(question, "  the   cat sat ") is True
    assert grade_answer(question, "the catsat") is False


def test_grade_answer_preserves_math_equivalence_for_non_english():
    question = _math_short_answer("60 cm²")

    assert grade_answer(question, "60") is True


def test_grade_answer_uses_text_equivalence_for_english_multi_part():
    question = {
        "id": "eng_mp_001",
        "subject": "english",
        "year_level": 7,
        "question_type": "multi_part",
        "question": "Answer both parts.",
        "answer": "a) respectful b) Zara",
        "framework": "AC9_ENGLISH",
        "topic_ids": ["AC9E7LY02"],
        "sub_parts": [
            {"label": "a", "question": "Tone?", "answer": "respectful"},
            {"label": "b", "question": "Character?", "answer": "Zara"},
        ],
    }

    assert grade_answer(question, '{"a": "Respectful", "b": "Zara"}') is True
    assert grade_answer(question, '{"a": "respectfull", "b": "Zara"}') is False


def test_correct_answer_for_display_uses_mcq_choice_text_not_answer_field():
    question = {
        "id": "eng_mcq_001",
        "subject": "english",
        "year_level": 7,
        "question_type": "multiple_choice",
        "question": "Which option is best?",
        "answer": "However",
        "correct_choice": "C",
        "choices": ["A) Also", "B) Because", "C) However", "D) Although"],
        "framework": "AC9_ENGLISH",
        "topic_ids": ["AC9E7LY06"],
    }

    assert grade_answer(question, "C") is True
    assert grade_answer(question, "However") is True
    assert correct_answer_for_display(question) == "C) However"


def test_exam_simulator_uses_subject_aware_grading_and_mcq_display():
    exercises = {
        "eng_sa_001": _english_short_answer("The cat sat"),
        "eng_mcq_001": {
            "id": "eng_mcq_001",
            "subject": "english",
            "year_level": 7,
            "question_type": "multiple_choice",
            "question": "Choose the transition.",
            "answer": "However",
            "correct_choice": "C",
            "choices": ["A) Also", "B) Because", "C) However", "D) Although"],
            "framework": "AC9_ENGLISH",
            "topic_ids": ["AC9E7LY06"],
        },
        "math_sa_001": _math_short_answer("60 cm²"),
    }
    sim = ExamSimulator(exercises=exercises)

    assert sim._check_answer(exercises["eng_sa_001"], "the cat sat") is True
    assert sim._check_answer(exercises["eng_sa_001"], "the catsat") is False
    assert sim._check_answer(exercises["math_sa_001"], "60") is True

    report = sim._grade_paper(
        {
            "exam_id": "exam-1",
            "paper": ["eng_mcq_001"],
            "responses": {"eng_mcq_001": "C"},
            "started_at": "2026-01-01T00:00:00+00:00",
            "completed_at": "2026-01-01T00:45:00+00:00",
            "time_limit_minutes": 45,
        }
    )

    assert report["correct"] == 1
    assert report["results_per_question"][0]["correct_answer"] == "C) However"


def test_diagnostic_engine_uses_subject_aware_grading_without_changing_math():
    exercises = {
        "eng_sa_001": _english_short_answer("The cat sat"),
        "math_sa_001": _math_short_answer("60 cm²"),
    }
    engine = DiagnosticEngine(exercises=exercises)

    assert engine._grade_answer(exercises["eng_sa_001"], "the cat sat")[0] is True
    assert engine._grade_answer(exercises["eng_sa_001"], "the catsat")[0] is False
    assert engine._grade_answer(exercises["math_sa_001"], "60")[0] is True


def test_exam_simulator_blueprint_filtering():
    exercises = {
        # Language Conventions candidate
        "lc_001": {
            "id": "lc_001",
            "subject": "english",
            "year_level": 7,
            "question_type": "short_answer",
            "question": "Punctuation question.",
            "answer": "abc",
            "framework": "AC9_ENGLISH",
            "topic_ids": ["AC9E7LA09"],  # Punctuation
        },
        # Reading comprehension candidate
        "rc_001": {
            "id": "rc_001",
            "subject": "english",
            "year_level": 7,
            "question_type": "short_answer",
            "question": "Reading question.",
            "answer": "xyz",
            "framework": "AC9_ENGLISH",
            "topic_ids": ["AC9E7LY05"],  # Reading Meaning
        },
    }
    sim = ExamSimulator(exercises=exercises)

    # 1. Test language_conventions blueprint
    paper_lc = sim._build_paper(
        subject="english",
        year_level=7,
        num_questions=10,
        exam_type="language_conventions",
    )
    assert "lc_001" in paper_lc
    assert "rc_001" not in paper_lc

    # 2. Test reading blueprint
    paper_rc = sim._build_paper(
        subject="english",
        year_level=7,
        num_questions=10,
        exam_type="reading",
    )
    assert "rc_001" in paper_rc
    assert "lc_001" not in paper_rc
