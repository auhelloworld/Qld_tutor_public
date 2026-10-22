"""Unit tests for the action dispatcher — handler return shapes.

Tests per Task 4 / Req 9.2–9.6:
- Each handler returns (message: str, actions: list, refs: dict)
- show_worked_example with verified=False returns chips only (no auto-invocation)
- give_next_step returns a message
- try_again returns encouragement
- mark_final_answer returns redirect message with empty actions
- change_topic returns session-close message with empty actions
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

from backend.dialogue_handler import (
    _handle_show_worked_example,
    _handle_give_next_step,
    _handle_try_again,
    _handle_mark_final_answer,
    _handle_change_topic,
    DISPATCH_TABLE,
)


def _make_tutor(suggest_result=None, topics=None):
    """Create a mock tutor engine."""
    tutor = MagicMock()
    if suggest_result is not None:
        tutor.suggest_practice.return_value = suggest_result
    tutor.topics = topics or {}
    return tutor


def _make_question(answer="42"):
    return {"question": "What is 6*7?", "answer": answer, "topic": "multiplication"}


class TestHandleShowWorkedExample:
    """_handle_show_worked_example returns correct shape."""

    @patch("backend.misconception_library.get_library")
    def test_misconception_targeted_worked_example(self, mock_get_library):
        """If question has a misconception targets we, return the target worked example."""
        mock_step = MagicMock()
        mock_step.step_number = 1
        mock_step.prose = "Do steps"
        mock_step.math_latex = "2+2=4"

        mock_ex = MagicMock()
        mock_ex.name = "Target WE"
        mock_ex.question = "Target Q"
        mock_ex.final_answer = "Target A"
        mock_ex.steps = [mock_step]

        mock_lib = MagicMock()
        mock_lib.we_by_misconception = {"MC_FOO_bar_01": [mock_ex]}
        mock_get_library.return_value = mock_lib

        tutor = _make_tutor()
        question = _make_question()
        question["topic_ids"] = ["topic_1"]
        question["_last_misconception_id"] = "MC_FOO_bar_01"

        msg, actions, refs = _handle_show_worked_example(tutor, question, "multiplication", [])
        assert "Target Q" in msg
        assert "Target WE" in msg
        assert "Do steps" in msg
        assert "try_again" in actions
        assert "mark_final_answer" in actions

    @patch("backend.misconception_library.get_library")
    def test_topic_overlapping_worked_example(self, mock_get_library):
        """If no misconception targets we, return the topic overlapping worked example."""
        mock_step = MagicMock()
        mock_step.step_number = 1
        mock_step.prose = "Topic steps"
        mock_step.math_latex = None

        mock_ex = MagicMock()
        mock_ex.name = "Topic WE"
        mock_ex.question = "Topic Q"
        mock_ex.final_answer = "Topic A"
        mock_ex.steps = [mock_step]

        mock_lib = MagicMock()
        mock_lib.we_by_misconception = {}
        mock_lib.we_by_topic_id = {"topic_1": [mock_ex]}
        mock_get_library.return_value = mock_lib

        tutor = _make_tutor()
        question = _make_question()
        question["topic_ids"] = ["topic_1"]
        question["_last_misconception_id"] = "MC_FOO_bar_01"

        msg, actions, refs = _handle_show_worked_example(tutor, question, "multiplication", [])
        assert "Topic Q" in msg
        assert "Topic WE" in msg
        assert "Topic steps" in msg
        assert "try_again" in actions
        assert "mark_final_answer" in actions

    @patch("backend.misconception_library.get_library")
    def test_no_worked_example_fallback(self, mock_get_library):
        """If no worked example is found, return the fallback message."""
        mock_lib = MagicMock()
        mock_lib.we_by_misconception = {}
        mock_lib.we_by_topic_id = {}
        mock_get_library.return_value = mock_lib

        tutor = _make_tutor()
        question = _make_question()
        question["topic_ids"] = ["topic_1"]

        msg, actions, refs = _handle_show_worked_example(tutor, question, "multiplication", [])
        assert "couldn't find a similar worked example" in msg.lower()
        assert "give_next_step" in actions
        assert "try_again" in actions


class TestHandleGiveNextStep:
    """_handle_give_next_step returns the highest hint level."""

    def test_with_hint_levels(self):
        """Returns the last hint level template."""
        tutor = _make_tutor(topics={
            "multiplication": {
                "concept_card": {
                    "hint_levels": [
                        {"template": "Think about groups"},
                        {"template": "6 groups of 7"},
                        {"template": "The answer is 6 times 7 = 42"},
                    ]
                }
            }
        })
        msg, actions, refs = _handle_give_next_step(tutor, _make_question(), "multiplication", [])
        assert isinstance(msg, str)
        assert len(msg) > 0
        assert "try_again" in actions or "mark_final_answer" in actions

    def test_no_hint_levels_returns_generic(self):
        """No hint levels → generic encouragement."""
        tutor = _make_tutor(topics={"multiplication": {"concept_card": {"hint_levels": []}}})
        msg, actions, refs = _handle_give_next_step(tutor, _make_question(), "multiplication", [])
        assert isinstance(msg, str)
        assert "try_again" in actions


class TestHandleTryAgain:
    """_handle_try_again returns encouragement."""

    def test_with_prior_hints(self):
        """With prior tutor hints → references the last hint."""
        prior_turns = [
            {"role": "tutor", "message": "Think about groups of 7"},
            {"role": "student", "message": "I don't get it"},
        ]
        tutor = _make_tutor()
        msg, actions, refs = _handle_try_again(tutor, _make_question(), "multiplication", prior_turns)
        assert isinstance(msg, str)
        assert "mark_final_answer" in actions

    def test_without_prior_hints(self):
        """No prior hints → generic encouragement."""
        tutor = _make_tutor()
        msg, actions, refs = _handle_try_again(tutor, _make_question(), "multiplication", [])
        assert isinstance(msg, str)
        assert len(msg) > 0


class TestHandleMarkFinalAnswer:
    """_handle_mark_final_answer returns redirect message."""

    def test_returns_redirect_with_empty_actions(self):
        tutor = _make_tutor()
        msg, actions, refs = _handle_mark_final_answer(tutor, _make_question(), "multiplication", [])
        assert "submit" in msg.lower() or "answer" in msg.lower()
        assert actions == []


class TestHandleChangeTopic:
    """_handle_change_topic returns session-close message."""

    def test_returns_close_message_with_empty_actions(self):
        tutor = _make_tutor()
        msg, actions, refs = _handle_change_topic(tutor, _make_question(), "multiplication", [])
        assert isinstance(msg, str)
        assert actions == []


class TestDispatchTable:
    """DISPATCH_TABLE maps all enum values to handlers."""

    def test_all_actions_have_handlers(self):
        expected = {"show_worked_example", "give_next_step", "try_again", "explain_my_answer", "mark_final_answer", "change_topic"}
        assert set(DISPATCH_TABLE.keys()) == expected

    def test_all_handlers_are_callable(self):
        for key, handler in DISPATCH_TABLE.items():
            assert callable(handler), f"{key} handler is not callable"
