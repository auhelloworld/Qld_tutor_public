"""The misconception a student actually made must reach their worked example.

Three separately-built pieces have to line up for this to work:

1. ``mark`` detects a misconception and records it on the attempt;
2. the dialogue handler attaches it to the question as ``_last_misconception_id``;
3. ``_handle_show_worked_example`` prefers a worked example targeting it.

Step 2 was missing, so every student received a generic topic-level example
instead of one addressing their own error. This exercises the whole chain through
the same entry points the browser uses.
"""

from unittest.mock import patch

import pytest

from backend.tutor_engine import TutorEngine

TOPIC = "AC9M7N01"
# Authored pair: treating a square root as halving, with a worked example that
# targets exactly that misconception.
MISCONCEPTION_ID = "MC_M7N_square_root_halving_01"


@pytest.fixture
def engine():
    with patch.dict(
        "os.environ",
        {"GEMINI_API_KEY": "", "OPENAI_API_KEY": "", "LLM_API_KEY": ""},
    ):
        eng = TutorEngine()
    eng.exercises["sqrt_item"] = {
        "id": "sqrt_item",
        "question": "Evaluate $\\sqrt{36}$.",
        "answer": "6",
        "steps": [],
        "topic": TOPIC,
        "topic_ids": [TOPIC],
        "subject": "math",
        "framework": "AC9_MATHS",
        "year_level": 7,
        "difficulty": "developing",
        "question_type": "short_answer",
    }
    return eng


@pytest.fixture
def student(request, tmp_path):
    """A student id unique to this test.

    Attempts persist in a store shared for the whole test session, so reusing one
    id would let an earlier test's misconception leak into a later one.
    """
    student_id = f"misconception-chain-{request.node.name}"
    return student_id, tmp_path / "logs"


def test_the_authored_pair_exists():
    """Guards the fixture: this test is meaningless if the content moved."""
    from backend.misconception_library import get_library

    library = get_library()
    assert MISCONCEPTION_ID in library.misconceptions
    assert library.we_by_misconception.get(MISCONCEPTION_ID), "no targeted worked example"


def test_wrong_answer_records_the_misconception(engine, student):
    student_id, log_root = student
    with patch("backend.rules.LOG_ROOT", log_root):
        result = engine.mark("sqrt_item", "18", student_id=student_id)
    assert result["is_correct"] is False
    # Halving 36 instead of taking its root.
    assert result.get("misconception_id") == MISCONCEPTION_ID
    assert result.get("misconception_explanation")


def test_worked_example_targets_the_students_own_misconception(engine, student):
    student_id, log_root = student
    with patch("backend.rules.LOG_ROOT", log_root):
        engine.mark("sqrt_item", "18", student_id=student_id)
        response = engine.dialogue(
            student_id=student_id,
            question_id="sqrt_item",
            student_message="show_worked_example",
        )
    message = response.tutor_message
    assert "worked example" in message.lower()
    # The targeted branch says so explicitly; the generic fallback says
    # "worked example for this topic".
    assert "targeting your misconception" in message.lower(), message


def test_without_a_recorded_misconception_the_generic_example_is_used(engine, student):
    """No misconception history means nothing to target, so no false claim."""
    student_id, log_root = student
    with patch("backend.rules.LOG_ROOT", log_root):
        result = engine.mark("sqrt_item", "6", student_id=student_id)
        assert result["is_correct"] is True
        assert not result.get("misconception_id")
        response = engine.dialogue(
            student_id=student_id,
            question_id="sqrt_item",
            student_message="show_worked_example",
        )
    assert "targeting your misconception" not in response.tutor_message.lower()
