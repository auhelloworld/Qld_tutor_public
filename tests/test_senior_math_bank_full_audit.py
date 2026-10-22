from __future__ import annotations

import importlib.util
import sys
import csv
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "audit_senior_math_bank_full.py"

spec = importlib.util.spec_from_file_location("audit_senior_math_bank_full", SCRIPT)
audit = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = audit
assert spec.loader is not None
spec.loader.exec_module(audit)


def test_mcq_answer_matching_does_not_match_numeric_substrings() -> None:
    assert audit.answer_matches_choice("15", "A. 5", "A") is False
    assert audit.answer_matches_choice("5", "A. 15", "A") is False


def test_mcq_answer_matching_accepts_letter_and_exact_numeric_value() -> None:
    assert audit.answer_matches_choice("A", "A. 5", "A") is True
    assert audit.answer_matches_choice("5.0", "A. 5", "A") is True


def test_mcq_answer_matching_accepts_substantial_symbolic_choice_text() -> None:
    assert audit.answer_matches_choice(
        "Choice A is correct because the derivative is 8x(x^2+1)^3.",
        "A. 8x(x^2+1)^3",
        "A",
    ) is True


def test_specialist_scalar_vector_result_does_not_need_manual_review() -> None:
    ex = {
        "id": "scalar_vector",
        "topic": "QCAA_SPECIALIST_U1_T3",
        "question": "Find the magnitude of the vector $\\mathbf{a}=(3,4)$.",
        "answer": "5",
        "steps": ["$|\\mathbf{a}|=\\sqrt{3^2+4^2}=5$."],
        "question_type": "short_answer",
        "difficulty": "foundational",
        "complexity": "simple_familiar",
        "math_metadata": {"technology_active": False, "strand": "Vectors", "skill": "magnitude"},
    }
    issues = []
    audit.audit_senior_math_content(ex, issues, course="specialist")
    assert not [issue for issue in issues if issue.code == "specialist_expression_manual_review"]


def test_specialist_vector_expression_still_needs_manual_review() -> None:
    ex = {
        "id": "vector_expression",
        "topic": "QCAA_SPECIALIST_U1_T3",
        "question": "Find the vector projection of $\\mathbf{a}$ onto $\\mathbf{b}$.",
        "answer": "(3, 4)",
        "steps": ["Use the projection formula."],
        "question_type": "short_answer",
        "difficulty": "developing",
        "complexity": "complex_familiar",
        "math_metadata": {"technology_active": False, "strand": "Vectors", "skill": "projection"},
    }
    issues = []
    audit.audit_senior_math_content(ex, issues, course="specialist")
    assert [issue for issue in issues if issue.code == "specialist_expression_manual_review"]


def test_canonical_schema_rejects_unknown_fields() -> None:
    ex = {
        "id": "bad_schema", "topic": "Vectors", "question": "Find the magnitude.",
        "answer": "5", "steps": ["Calculate it."], "framework": "QCAA_SENIOR_MATHS",
        "topic_ids": ["QCAA_SPECIALIST_U1_T3"], "subject": "specialist",
        "difficulty": "foundational", "unit": 1, "question_type": "short_answer",
        "complexity": "simple_familiar", "math_metadata": {
            "technology_active": False, "strand": "Vectors", "skill": "magnitude"
        }, "unexpected_field": True,
    }
    topics = {"QCAA_SPECIALIST_U1_T3": {"unit": 1}}
    issues = audit.audit_item(ex, course="specialist", topics=topics)
    assert any(issue.code == "canonical_schema_invalid" for issue in issues)


def test_non_mcq_is_written_to_maths_review_queue(tmp_path: Path) -> None:
    ex = {
        "id": "needs_review", "topic": "Vectors", "question": "Find the magnitude.",
        "answer": "5", "steps": ["Use Pythagoras."], "framework": "QCAA_SENIOR_MATHS",
        "topic_ids": ["QCAA_SPECIALIST_U1_T3"], "subject": "specialist",
        "difficulty": "foundational", "unit": 1, "question_type": "short_answer",
        "complexity": "simple_familiar", "math_metadata": {
            "technology_active": False, "strand": "Vectors", "skill": "magnitude"
        },
    }
    outputs = audit.write_outputs("specialist", [ex], {"needs_review": []}, [], tmp_path, data_files=[])
    with Path(outputs["maths_review"]).open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    assert rows[0]["maths_verification"] == "human_review_required"


def test_senior_multi_part_checks_labels_generic_rubrics_and_mark_coverage() -> None:
    ex = {
        "id": "senior_multipart_rubric",
        "question_type": "multi_part",
        "sub_parts": [
            {
                "label": "a",
                "question": "Differentiate $f(x)=x^2+3x$.",
                "answer": "$2x+3$",
                "marks": 2,
                "rubric": {"key_points": ["Shows working."]},
            },
            {
                "label": "a",
                "question": "Evaluate the derivative at $x=2$.",
                "answer": "7",
                "marks": 2,
            },
        ],
        "rubric": {"key_points": ["Gives a correct answer."], "max_score": 4},
    }
    issues = []
    audit.audit_question_type(ex, issues)
    codes = {issue.code for issue in issues}
    assert "multipart_duplicate_labels" in codes
    assert "generic_rubric_filler" in codes
    assert "multipart_part_rubric_missing" in codes


def test_senior_multi_part_accepts_traceable_item_level_rubric() -> None:
    ex = {
        "id": "senior_traceable_rubric",
        "question_type": "multi_part",
        "sub_parts": [
            {
                "label": "a",
                "question": "Differentiate $f(x)=x^2+3x$.",
                "answer": "$2x+3$",
                "marks": 2,
            },
            {
                "label": "b",
                "question": "Evaluate the derivative at $x=2$.",
                "answer": "7",
                "marks": 2,
            },
        ],
        "rubric": {
            "key_points": [
                "Differentiates $f(x)=x^2+3x$ to obtain $2x+3$.",
                "Substitutes $x=2$ into $2x+3$ and obtains 7.",
            ],
            "max_score": 4,
        },
    }
    assert audit.top_level_rubric_covers_subpart(ex, ex["sub_parts"][0])
    assert audit.top_level_rubric_covers_subpart(ex, ex["sub_parts"][1])
    issues = []
    audit.audit_question_type(ex, issues)
    assert not [issue for issue in issues if issue.code == "multipart_part_rubric_missing"]


def test_senior_multi_part_non_list_is_reported_without_crashing() -> None:
    issues = []
    audit.audit_question_type(
        {"id": "bad_subparts", "question_type": "multi_part", "sub_parts": "a"},
        issues,
    )
    assert any(issue.code == "multipart_too_short" for issue in issues)
