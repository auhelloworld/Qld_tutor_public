"""Unit tests for select_actions — action selection rules.

Tests per Task 5 / Req 6.3–6.8:
- stuck + no prior show_worked_example → includes show_worked_example
- student_count >= 3 + no prior give_next_step → includes give_next_step
- references_student_working → includes try_again
- references_candidate_final_answer → includes mark_final_answer
- empty result → no actions forced (pre-attempt UX leaves the student to think)
- cap at 4 entries
"""
from __future__ import annotations

from backend.dialogue_handler import select_actions


def _make_turns(student_count: int = 0, prior_actions: list[str] | None = None) -> list[dict]:
    """Build a list of prior turns with the given student count and action invocations."""
    turns = []
    for i in range(student_count):
        turns.append({"role": "student", "message": f"msg {i}"})
        turns.append({"role": "tutor", "message": f"reply {i}"})
    if prior_actions:
        for action in prior_actions:
            turns.append({"role": "student", "message": action})
            turns.append({"role": "tutor", "message": f"handled {action}"})
    return turns


class TestSelectActions:
    """select_actions deterministic rules."""

    def test_stuck_adds_show_worked_example(self):
        """Stuck + no prior show_worked_example → includes show_worked_example."""
        result = select_actions(
            stuck=True,
            prior_turns=_make_turns(student_count=1),
            references_student_working=False,
            references_candidate_final_answer=False,
        )
        assert "show_worked_example" in result

    def test_stuck_but_already_shown_does_not_repeat(self):
        """Stuck but show_worked_example already used → not included."""
        result = select_actions(
            stuck=True,
            prior_turns=_make_turns(student_count=1, prior_actions=["show_worked_example"]),
            references_student_working=False,
            references_candidate_final_answer=False,
        )
        assert "show_worked_example" not in result

    def test_student_count_ge_3_adds_give_next_step(self):
        """3+ student turns + no prior give_next_step → includes give_next_step."""
        result = select_actions(
            stuck=False,
            prior_turns=_make_turns(student_count=3),
            references_student_working=False,
            references_candidate_final_answer=False,
        )
        assert "give_next_step" in result

    def test_student_count_lt_3_no_give_next_step(self):
        """<3 student turns → give_next_step not included (unless other rules)."""
        result = select_actions(
            stuck=False,
            prior_turns=_make_turns(student_count=2),
            references_student_working=False,
            references_candidate_final_answer=False,
        )
        assert "give_next_step" not in result

    def test_give_next_step_already_used_not_repeated(self):
        """give_next_step already used → not included again."""
        result = select_actions(
            stuck=False,
            prior_turns=_make_turns(student_count=4, prior_actions=["give_next_step"]),
            references_student_working=False,
            references_candidate_final_answer=False,
        )
        assert "give_next_step" not in result

    def test_references_student_working_adds_try_again(self):
        """references_student_working → includes try_again."""
        result = select_actions(
            stuck=False,
            prior_turns=_make_turns(student_count=1),
            references_student_working=True,
            references_candidate_final_answer=False,
        )
        assert "try_again" in result

    def test_references_candidate_final_answer_adds_mark(self):
        """references_candidate_final_answer → includes mark_final_answer."""
        result = select_actions(
            stuck=False,
            prior_turns=_make_turns(student_count=1),
            references_student_working=False,
            references_candidate_final_answer=True,
        )
        assert "mark_final_answer" in result

    def test_empty_result_fallback(self):
        """No rules triggered → no actions forced.

        The pre-attempt UX deliberately avoids pushing default action chips when
        nothing is helpful (see test_dialogue_pre_attempt). The student is left
        to think/answer rather than being nudged toward chips.
        """
        result = select_actions(
            stuck=False,
            prior_turns=_make_turns(student_count=0),
            references_student_working=False,
            references_candidate_final_answer=False,
        )
        assert result == []

    def test_cap_at_4(self):
        """Output capped at 4 entries even if all rules fire."""
        result = select_actions(
            stuck=True,
            prior_turns=_make_turns(student_count=5),
            references_student_working=True,
            references_candidate_final_answer=True,
        )
        assert len(result) <= 4

    def test_all_rules_fire(self):
        """When all conditions met, result contains up to 4 distinct actions."""
        result = select_actions(
            stuck=True,
            prior_turns=_make_turns(student_count=4),
            references_student_working=True,
            references_candidate_final_answer=True,
        )
        assert "show_worked_example" in result
        assert "give_next_step" in result
        assert "try_again" in result
        assert "mark_final_answer" in result
        assert len(result) == 4

    def test_result_contains_only_valid_enum_values(self):
        """All returned values are valid SuggestedAction enum values."""
        valid = {"show_worked_example", "give_next_step", "try_again", "mark_final_answer", "change_topic"}
        result = select_actions(
            stuck=True,
            prior_turns=_make_turns(student_count=5),
            references_student_working=True,
            references_candidate_final_answer=True,
        )
        for action in result:
            assert action in valid
