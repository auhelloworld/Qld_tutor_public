"""Focused regression tests for the authored-text LaTeX linter."""

from __future__ import annotations

import pytest

from scripts.check_exercises import lint_exercise_text


pytestmark = pytest.mark.unit


def _has_left_right_mismatch(messages: list[str]) -> bool:
    return any("mismatched \\left and \\right" in message for message in messages)


def test_arrow_command_is_not_counted_as_right_delimiter():
    messages = lint_exercise_text({"question": r"Transpose: $\rightarrow$"})

    assert not _has_left_right_mismatch(messages)


def test_unmatched_left_delimiter_still_fails_strictly():
    messages = lint_exercise_text({"question": r"Evaluate $\left(x + 1$"})

    assert _has_left_right_mismatch(messages)
