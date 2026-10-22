from backend.services.marking import (
    _reasoning_self_check_feedback,
    _student_rubric_point_view,
    _subject_marking_guidance,
)
from core.prompt_templates.tutor_prompts import (
    ENGLISH_MARKING_GUIDANCE,
    MARK_PROMPT,
    MARK_REASONING_PROMPT,
    SCIENCE_MARKING_GUIDANCE,
)


def test_subject_marking_guidance_selects_english_and_science():
    assert _subject_marking_guidance("english") == ENGLISH_MARKING_GUIDANCE
    assert _subject_marking_guidance("science") == SCIENCE_MARKING_GUIDANCE


def test_marking_prompts_include_subject_guidance_slot():
    assert "{subject_guidance}" in MARK_PROMPT
    assert "{subject_guidance}" in MARK_REASONING_PROMPT


def test_no_llm_reasoning_feedback_gives_self_checklist():
    feedback = _reasoning_self_check_feedback(
        [{"label": "Evidence selection"}, {"label": "Explanation"}],
        "english",
    )

    assert "saved for parent review" in feedback
    assert "claim, evidence, and explanation" in feedback
    assert "Use of relevant evidence" in feedback
    assert "Explanation of the relationship" in feedback


def test_no_llm_reasoning_feedback_uses_string_rubric_points():
    feedback = _reasoning_self_check_feedback(
        [
            "State that the conjugate root is $2-\\sqrt3$.",
            "Explain that rational coefficients force irrational surd terms to cancel.",
        ],
        "methods",
    )

    assert "working, reasoning, and conclusion" in feedback
    assert "Identification of key information" in feedback
    assert "Explanation of the relationship" in feedback
    assert "2-\\sqrt3" not in feedback
    assert "rational coefficients force irrational surd terms to cancel" not in feedback


def test_no_llm_reasoning_feedback_uses_description_from_dict_points():
    feedback = _reasoning_self_check_feedback(
        [{"description": "Use relevant data to support the claim."}],
        "science",
    )

    assert "claim, evidence, and reasoning" in feedback
    assert "Use of relevant evidence" in feedback
    assert "Use relevant data to support the claim." not in feedback


def _attainment(**overrides):
    return {
        "label": "formula setup",
        "met": False,
        "reported_met": False,
        "prerequisite_blocked": False,
        "marks_awarded": 0,
        "marks_available": 1,
        "from_model": True,
        "why_missed": "The relationship was not connected to the method.",
        "how_to_fix": "Which relationship should you define before beginning the calculation?",
        **overrides,
    }


def test_student_rubric_point_preserves_safe_skill_feedback():
    point = _student_rubric_point_view(
        _attainment(),
        authored_text="Uses the correct equation and explains the setup.",
        question={"subject": "math", "answer": "42", "sample_reasoning": "Apply the equation and simplify."},
    )

    assert point["text"] == "Formula setup"
    assert point["met"] is False
    assert point["why_missed"] == "The relationship was not connected to the method."
    assert point["how_to_fix"].startswith("Which relationship")


def test_student_rubric_point_replaces_answer_bearing_model_text():
    point = _student_rubric_point_view(
        _attainment(
            label="The final value is 42",
            why_missed="You did not state that the final value is 42.",
            how_to_fix="Write 42 as the final value.",
        ),
        authored_text="Calculates the final value 42 and states the conclusion.",
        question={"subject": "math", "answer": "42", "sample_reasoning": "The final value is 42."},
    )

    rendered = " ".join(str(value) for value in point.values())
    assert "42" not in rendered
    assert point["text"] == "Interpretation of the result"
    assert "did not yet demonstrate" in point["why_missed"]
    assert point["how_to_fix"]
