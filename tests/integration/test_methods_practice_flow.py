"""Phase 5 regression tests: a student can actually practise Methods.

Covers the runtime bugs found when first using the Methods banks:
  1. suggest_practice returned no questions because its syllabus_subject filter
     was not lenient (Methods items carry subject="methods" but no
     syllabus_subject/course field), so only one fallback question showed and
     "next" failed.
  2. mark() rejected subject="methods" with error_type="subject_unresolved".
  3. _subject_for_topic resolved Methods topics to "senior_math" instead of the
     course subject "methods", so per-question history did not match where
     mark() logs attempts.
"""

import json
from unittest.mock import patch

import pytest

from backend.tutor_engine import TutorEngine, _subject_for_topic


def _methods_exercises():
    return [
        {
            "id": f"methods_u2t1_{i:02d}",
            "question": f"Evaluate 2^{i+3}",
            "answer": str(2 ** (i + 3)),
            "steps": [],
            "topic": "QCAA_METHODS_U2_T1",
            "topic_ids": ["QCAA_METHODS_U2_T1"],
            "subject": "methods",
            "framework": "QCAA_SENIOR_MATHS",
            "unit": 2,
            "difficulty": "developing",
            "question_type": "short_answer",
            "math_metadata": {"technology_active": False},
        }
        for i in range(1, 6)
    ]


@pytest.fixture
def methods_engine():
    with patch.dict("os.environ", {"GEMINI_API_KEY": "", "OPENAI_API_KEY": ""}):
        engine = TutorEngine()
    for ex in _methods_exercises():
        engine.exercises[ex["id"]] = ex
    return engine


def test_subject_for_topic_resolves_methods_course():
    assert _subject_for_topic("QCAA_METHODS_U2_T1") == "methods"
    assert _subject_for_topic("QCAA_METHODS_U4_T3") == "methods"


def test_suggest_practice_returns_methods_questions(methods_engine, tmp_path):
    """Lenient syllabus_subject filter: a Methods topic yields all its items."""
    log_dir = tmp_path / "logs" / "stud"
    log_dir.mkdir(parents=True)
    (log_dir / "methods_log.json").write_text(json.dumps({"student_id": "stud", "topics": {}}))

    with patch("backend.rules.LOG_ROOT", tmp_path / "logs"):
        res = methods_engine.suggest_practice(
            "QCAA_METHODS_U2_T1",
            "retrieve",
            student_id="stud",
            subject="methods",
            unit=2,
            syllabus_subject="methods",
        )

    assert res.get("error") is None
    assert res.get("total", 0) >= 5
    assert res.get("question") is not None
    assert res["question"]["topic_ids"] == ["QCAA_METHODS_U2_T1"]


def test_mark_accepts_methods_subject(methods_engine, tmp_path):
    """mark() must grade a Methods item, not reject it as subject_unresolved."""
    log_dir = tmp_path / "logs" / "stud2"
    log_dir.mkdir(parents=True)
    (log_dir / "methods_log.json").write_text(json.dumps({"student_id": "stud2", "topics": {}}))

    with patch("backend.rules.LOG_ROOT", tmp_path / "logs"):
        correct = methods_engine.mark("methods_u2t1_02", "32", student_id="stud2")
        wrong = methods_engine.mark("methods_u2t1_02", "30", student_id="stud2")

    assert correct.get("error_type") != "subject_unresolved"
    assert correct.get("is_correct") is True
    assert wrong.get("is_correct") is False
