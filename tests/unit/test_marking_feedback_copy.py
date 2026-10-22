"""Deterministic marking feedback must not name UI controls.

The frontend decides which help controls exist (for example, an Exit Ticket
hides "Explain my answer"). When the backend also wrote "Click Explain my
answer", the practice view showed the instruction twice and the Exit Ticket
pointed students to a control that was not there.
"""
from __future__ import annotations

from unittest.mock import patch

import pytest

from backend.tutor_engine import TutorEngine


@pytest.fixture(scope="module")
def offline_engine():
    with patch.dict(
        "os.environ",
        {"GEMINI_API_KEY": "", "OPENAI_API_KEY": "", "LLM_API_KEY": ""},
    ):
        engine = TutorEngine()
    assert not engine.client, "this suite must run in mock mode"
    return engine


def _mark(engine, key, student, question="Simplify."):
    return engine._mark_short_answer(
        {
            "id": "item",
            "question": question,
            "answer": key,
            "subject": "math",
            "question_type": "short_answer",
            "steps": [],
        },
        student,
    )


@pytest.mark.parametrize(
    "key,student",
    [
        ("36", "99999"),  # numeric mismatch with no specific diagnosis
        ("$8x+26$", "8x+27"),  # symbolic constant-term mismatch
        ("$8x+26$", "16x+52"),  # symbolic scaled mismatch
        ("$8x+26$", "7x+26"),  # symbolic different expression
        ("$x=5$", "x=6"),  # equation not satisfied
    ],
)
def test_deterministic_feedback_does_not_reference_ui_controls(offline_engine, key, student):
    result = _mark(offline_engine, key, student)
    assert result["is_correct"] is False
    assert result.get("deterministic") is True
    assert "explain my answer" not in result["feedback"].lower()
    assert "click" not in result["feedback"].lower()
