from backend.services.question_context import (
    authorised_review_view,
    diagram_to_text,
    llm_question_context,
    student_question_view,
)


def _question():
    return {
        "id": "q-context",
        "question": "How does the writer position the reader?",
        "question_type": "multi_part",
        "topic_ids": ["AC9E9LY03"],
        "subject": "english",
        "difficulty": "extending",
        "answer": "A protected answer",
        "correct_choice": "B",
        "sample_reasoning": "Protected reasoning",
        "alternative_answers": ["protected variant"],
        "rubric": {"key_points": ["evidence"], "max_score": 2},
        "english_metadata": {
            "facet": "text_evidence",
            "passage": "The streetlights flickered as the crowd fell silent.",
            "accepted_answer_variants": ["protected metadata variant"],
        },
        "diagram_data": {
            "type": "force_diagram",
            "forces": [
                {"label": "push", "magnitude": 12, "direction": "right"},
                {"label": "friction", "magnitude": 8, "direction": "left"},
            ],
        },
        "sub_parts": [
            {
                "label": "a",
                "question": "Identify one detail.",
                "answer": "streetlights",
                "marks": 1,
                "diagram_data": {"type": "box_plot", "minimum": 1, "q1": 2, "median": 3, "q3": 4, "maximum": 5},
            }
        ],
    }


def test_student_view_contains_context_but_no_answer_fields():
    view = student_question_view(_question())
    assert view["passage"].startswith("The streetlights")
    assert view["diagram_data"]["type"] == "force_diagram"
    assert view["sub_parts"][0]["diagram_data"]["type"] == "box_plot"
    protected = {"answer", "correct_choice", "sample_reasoning", "alternative_answers", "rubric", "steps"}
    assert protected.isdisjoint(view)
    assert "answer" not in view["sub_parts"][0]
    assert "accepted_answer_variants" not in view.get("english_metadata", {})


def test_student_view_includes_safe_math_metadata():
    view = student_question_view({
        "id": "q-math-meta",
        "question": "Simplify.",
        "subject": "methods",
        "question_type": "short_answer",
        "answer": "protected",
        "math_metadata": {
            "calculator_allowed": False,
            "technology_active": False,
            "expected_working_steps": ["expand", "collect"],
            "skill": "simplify_surds",
            "common_misconceptions": ["forget perfect square factor"],
        },
    })
    assert view["math_metadata"]["calculator_allowed"] is False
    assert view["math_metadata"]["technology_active"] is False
    assert view["math_metadata"]["expected_working_steps"] == ["expand", "collect"]
    assert view["math_metadata"]["skill"] == "simplify_surds"
    assert "common_misconceptions" not in view["math_metadata"]
    assert "answer" not in view


def test_authorised_review_view_adds_marking_context():
    view = authorised_review_view(_question())
    assert view["answer"] == "A protected answer"
    assert view["sample_reasoning"] == "Protected reasoning"
    assert view["sub_parts"][0]["answer"] == "streetlights"


def test_llm_context_contains_stimulus_and_delimiters():
    context = llm_question_context(_question())
    assert "[UNTRUSTED_STIMULUS_BEGIN]" in context
    assert "The streetlights flickered" in context
    assert "Focus" not in context
    assert "Part" not in context or "Sub-parts" in context
    assert "Force diagram" in context


def test_generic_diagram_fallbacks_are_descriptive():
    assert "Box plot" in diagram_to_text({"type": "box_plot", "minimum": 1, "q1": 2, "median": 3, "q3": 4, "maximum": 5})
    assert "Tree" in diagram_to_text({"type": "tree_diagram", "nodes": ["A", "B"]})
