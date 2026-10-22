"""Unit tests for backend.content_authoring.concept_card_helper."""
from __future__ import annotations

import argparse

import pytest

from backend.content_authoring.concept_card_helper import (
    check_quality,
    validate_topic_id,
)
from core.schema.curriculum_schema import ConceptCard, HintLevel


# ---------------------------------------------------------------------------
# validate_topic_id
# ---------------------------------------------------------------------------


class TestValidateTopicId:
    def test_valid_year7(self):
        assert validate_topic_id("AC9M7N04") == "AC9M7N04"

    def test_valid_year10(self):
        assert validate_topic_id("AC9M10SP02") == "AC9M10SP02"

    def test_valid_year8_algebra(self):
        assert validate_topic_id("AC9M8A03") == "AC9M8A03"

    def test_rejects_path_traversal(self):
        with pytest.raises(argparse.ArgumentTypeError, match="must match"):
            validate_topic_id("../../../etc/passwd")

    def test_rejects_english_code(self):
        with pytest.raises(argparse.ArgumentTypeError, match="must match"):
            validate_topic_id("AC9E7LA01")

    def test_rejects_empty(self):
        with pytest.raises(argparse.ArgumentTypeError, match="must match"):
            validate_topic_id("")

    def test_rejects_garbage(self):
        with pytest.raises(argparse.ArgumentTypeError, match="must match"):
            validate_topic_id("fractions")

    def test_rejects_year_out_of_range(self):
        with pytest.raises(argparse.ArgumentTypeError, match="must match"):
            validate_topic_id("AC9M11N01")


# ---------------------------------------------------------------------------
# check_quality
# ---------------------------------------------------------------------------


def _make_card(
    core_rule: str = "A valid rule statement that is at least thirty characters long.",
    levels: list[tuple[str, str]] | None = None,
    include_worked_example: bool = True,
) -> ConceptCard:
    if levels is None:
        levels = [
            ("concept_reminder", "What is the rule here?"),
            ("step_prompt", "What would you do with <numerator> next?"),
            ("analogy", "Think of it like sharing pizza slices equally."),
        ]
    from core.schema.curriculum_schema import ConceptCardWorkedExample, WorkedExampleStep
    worked_example = None
    if include_worked_example:
        worked_example = ConceptCardWorkedExample(
            question="Simplify 12/18",
            answer="2/3",
            steps=[
                WorkedExampleStep(step=1, instruction="Find the GCD of 12 and 18", result="GCD = 6"),
                WorkedExampleStep(step=2, instruction="Divide both by 6", result="12÷6=2, 18÷6=3"),
            ],
            explanation="Dividing by the GCD gives the simplest form.",
        )
    return ConceptCard(
        core_rule=core_rule,
        hint_levels=[HintLevel(level=lv, template=t) for lv, t in levels],
        worked_example=worked_example,
    )


class TestCheckQuality:
    def test_valid_card_no_warnings(self):
        card = _make_card()
        assert check_quality(card) == []

    def test_core_rule_too_short(self):
        card = _make_card(core_rule="Too short.")
        warnings = check_quality(card)
        assert any("too short" in w for w in warnings)

    def test_core_rule_too_long(self):
        card = _make_card(core_rule="x" * 250)
        warnings = check_quality(card)
        assert any("too long" in w for w in warnings)

    def test_missing_analogy_level(self):
        card = _make_card(levels=[
            ("concept_reminder", "What is the rule?"),
            ("step_prompt", "What next?"),
        ])
        warnings = check_quality(card)
        assert any("'analogy'" in w for w in warnings)

    def test_missing_step_prompt_level(self):
        card = _make_card(levels=[
            ("concept_reminder", "What is the rule?"),
            ("analogy", "Like pizza slices."),
        ])
        warnings = check_quality(card)
        assert any("'step_prompt'" in w for w in warnings)

    def test_numeric_literal_in_hint(self):
        card = _make_card(levels=[
            ("concept_reminder", "Remember that 18 divided by 6 is the key."),
            ("step_prompt", "What next?"),
            ("analogy", "Like pizza."),
        ])
        warnings = check_quality(card)
        assert any("multi-digit numeric literal" in w for w in warnings)

    def test_single_digit_ok(self):
        """Single digits (e.g. 'step 1') should not trigger the warning."""
        card = _make_card(levels=[
            ("concept_reminder", "Step 1: recall the rule."),
            ("step_prompt", "What is step 2?"),
            ("analogy", "Like 3 pizza slices shared among friends."),
        ])
        warnings = check_quality(card)
        assert not any("numeric literal" in w for w in warnings)

    def test_circular_rule_warning(self):
        card = _make_card(core_rule="This topic is about understanding fractions and their equivalence in maths.")
        warnings = check_quality(card)
        assert any("This topic" in w for w in warnings)

    def test_missing_worked_example_warning(self):
        card = _make_card(include_worked_example=False)
        warnings = check_quality(card)
        assert any("worked_example is missing" in w for w in warnings)

    def test_worked_example_present_no_warning(self):
        from core.schema.curriculum_schema import ConceptCardWorkedExample, WorkedExampleStep
        card = ConceptCard(
            core_rule="A valid rule statement that is at least thirty characters long.",
            hint_levels=[
                HintLevel(level="concept_reminder", template="What is the rule?"),
                HintLevel(level="step_prompt", template="What would you do with <x> next?"),
                HintLevel(level="analogy", template="Think of it like sharing pizza."),
            ],
            worked_example=ConceptCardWorkedExample(
                question="Simplify 12/18",
                answer="2/3",
                steps=[
                    WorkedExampleStep(step=1, instruction="Find the GCD of 12 and 18", result="GCD = 6"),
                    WorkedExampleStep(step=2, instruction="Divide both by 6", result="12÷6=2, 18÷6=3"),
                ],
                explanation="Dividing by the GCD gives the simplest form.",
            ),
        )
        warnings = check_quality(card)
        assert not any("worked_example" in w for w in warnings)
