from __future__ import annotations

import csv
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import audit_math_bank_full as full
import audit_math_banks as heuristic


def _year7_items() -> dict[str, dict]:
    payload = json.loads((ROOT / "data" / "exercise_7_math.json").read_text(encoding="utf-8"))
    return {item["id"]: item for item in payload}


def test_place_value_constraint_verifier_accepts_corrected_optima() -> None:
    items = _year7_items()
    expected = {
        "math_7_d_AC9M7N03_4e2412": "903000",
        "math_7_amc_AC9M7N03_8831d7": "13131",
    }
    for item_id, correct in expected.items():
        result = full.verify_maths(items[item_id])
        assert result.status == "verified"
        assert result.confidence == "high"
        assert result.computed_answer == correct


def test_corrected_compound_items_use_multi_part_contracts() -> None:
    items = _year7_items()
    for item_id in (
        "math_7_e_AC9M7N02_ca25b9",
        "math_7_amc_AC9M7N04_75e35f",
    ):
        item = items[item_id]
        assert item["question_type"] == "multi_part"
        assert len(item.get("sub_parts") or []) >= 3
        assert not full.compound_short_answer_needs_review(item)


def test_multi_part_verifier_checks_each_sub_part_answer() -> None:
    item = {
        "question_type": "multi_part",
        "question": "Calculate each value.",
        "answer": "a) 7; b) 11",
        "math_metadata": {"skill": "integer_operations"},
        "sub_parts": [
            {"label": "a", "question": "Calculate 3 + 4.", "answer": "7"},
            {"label": "b", "question": "Calculate 5 + 6.", "answer": "12"},
        ],
    }
    result = full.verify_maths(item)
    assert result.status == "likely_issue"
    assert result.skill.startswith("sub_part:b/")
    assert "Sub-part b" in result.evidence


def test_full_auditor_flags_duplicate_labels_and_nested_template_text() -> None:
    item = json.loads(json.dumps(_year7_items()["math_7_e_AC9M7N02_ca25b9"]))
    item["sub_parts"][1]["label"] = item["sub_parts"][0]["label"].upper()
    item["sub_parts"][0]["rubric"] = {"key_points": ["TODO: replace criterion"]}
    issues = full.audit_schema(item, 7, set(item["topic_ids"]))
    assert any(issue.code == "multi_part_duplicate_labels" for issue in issues)
    assert any(
        issue.code == "template_text" and "sub_parts" in issue.message
        for issue in issues
    )


def test_multi_part_rubric_coverage_requires_traceable_part_evidence() -> None:
    item = {
        "id": "rubric_coverage",
        "question_type": "multi_part",
        "question": "Complete each calculation.",
        "answer": "a) 7; b) 144",
        "steps": ["Calculate each result."],
        "framework": "AC9_MATHS",
        "topic_ids": ["AC9M7N02"],
        "subject": "math",
        "difficulty": "developing",
        "year_level": 7,
        "complexity": "complex_familiar",
        "math_metadata": {"strand": "Number", "sub_strand": "Integers", "skill": "integer_operations"},
        "rubric": {"key_points": ["Calculates 3 + 4 = 7.", "Identifies 144 as the square number."], "max_score": 3},
        "sample_reasoning": "Evaluate each expression.",
        "sub_parts": [
            {"label": "a", "question": "Calculate 3 + 4.", "answer": "7", "marks": 1},
            {"label": "b", "question": "Find the square number 144.", "answer": "144", "marks": 2},
        ],
    }
    assert full.top_level_rubric_covers_subpart(item, item["sub_parts"][1])
    assert not any(
        issue.code == "multi_part_part_rubric_missing"
        for issue in full.audit_schema(item, 7, {"AC9M7N02"})
    )

    item["rubric"] = {"key_points": ["Shows clear working."], "max_score": 3}
    assert not full.top_level_rubric_covers_subpart(item, item["sub_parts"][1])
    assert any(
        issue.code == "multi_part_part_rubric_missing"
        for issue in full.audit_schema(item, 7, {"AC9M7N02"})
    )


def test_full_auditor_excludes_draft_items() -> None:
    path = ROOT / "data" / "exercise_7_math.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    expected_active_ids = {
        item["id"]
        for item in payload
        if item.get("status", "active") == "active"
    }
    active = full.load_exercises(path)
    active_ids = {item["id"] for item in active}
    assert active_ids == expected_active_ids
    assert all(item.get("status", "active") == "active" for item in active)
    assert "math_7_hq_model_06" not in active_ids
    assert "math_7_graph_P01_002" not in active_ids


def test_representation_check_distinguishes_context_from_missing_asset() -> None:
    self_contained = {
        "question": "A map scale is 1:50 000. Two towns are 8 cm apart. Find the distance.",
        "math_metadata": {},
    }
    missing = {
        "question": "Using the graph shown below, find the intercept.",
        "math_metadata": {},
    }
    creation = {
        "question": "Construct a stem-and-leaf plot for 12, 15, 18 and 19.",
        "math_metadata": {},
    }
    assert heuristic.representation_quality(self_contained) == "not_applicable"
    assert heuristic.representation_quality(missing) == "weak"
    assert heuristic.representation_quality(creation) == "adequate"


def test_matrix_latex_environment_is_not_year_level_overreach() -> None:
    item = {
        "topic": "Views of objects",
        "question": r"Read the grid $\begin{matrix}1&2\\3&4\end{matrix}$.",
        "difficulty": "developing",
        "complexity": "complex_familiar",
        "math_metadata": {"skill": "views_and_elevations"},
    }
    assert heuristic.year_fit(item, heuristic.YEAR_PROFILES[7]) == "appropriate"


def test_spinner_initials_are_recognised_as_colour_outcomes() -> None:
    item = _year7_items()["math_7_graph_P01_001"]
    assert not any(
        issue.code == "diagram_sample_spinner_no_colours"
        for issue in full.verify_diagram(item)
    )


def test_full_auditor_uses_canonical_exercise_schema() -> None:
    item = _year7_items()["math_7_f_AC9M7N02_adae12"].copy()
    item["topic_ids"] = ["AC9M7N02", "AC9M7N02"]
    item["unexpected_field"] = "not allowed"
    issues = full.audit_schema(item, 7, {"AC9M7N02"})
    assert any(issue.code == "canonical_schema_validation" for issue in issues)


def test_maths_review_queue_contains_unverified_items(tmp_path: Path) -> None:
    rows = [
        full.AuditRow(id="verified", maths_verification="verified"),
        full.AuditRow(id="unsupported", maths_verification="unsupported"),
        full.AuditRow(id="inconclusive", maths_verification="inconclusive"),
    ]
    path = tmp_path / "maths_review.csv"
    full.write_maths_review_queue(rows, path)
    with path.open(encoding="utf-8-sig") as handle:
        written = list(csv.DictReader(handle))
    assert {row["id"] for row in written} == {"unsupported", "inconclusive"}


def test_strict_fails_on_definite_content_errors(monkeypatch, tmp_path: Path) -> None:
    stats = {
        "total_items": 1,
        "total_issues": 1,
        "hard_errors_count": 0,
        "hard_critical": 0,
        "hard_high": 0,
        "hard_medium": 0,
        "hard_low": 0,
        "content_errors_count": 1,
        "review_needed_count": 0,
        "advisory_count": 0,
        "maths_verified": 0,
        "maths_incorrect": 1,
        "maths_likely_issue": 0,
        "maths_inconclusive": 0,
        "maths_unsupported": 0,
        "maths_unverified": 0,
        "ext_evaluated": 0,
        "ext_routine": 0,
        "ext_weak": 0,
        "ext_adequate": 0,
        "ext_strong": 0,
        "diagram_count": 0,
        "diagram_hard_errors": 0,
    }
    monkeypatch.setattr(full, "audit_year", lambda *_args, **_kwargs: stats)
    assert full.main(["--year", "7", "--strict", "--out", str(tmp_path)]) == 1


def test_safe_rel_accepts_relative_output_paths() -> None:
    result = heuristic.safe_rel(Path("audit_output") / "nested" / "report.csv", ROOT)
    assert result.endswith(str(Path("audit_output") / "nested" / "report.csv"))


def test_latex_risk_accepts_valid_shorthand_and_indexed_roots() -> None:
    valid_items = [
        {"question": r"For a fair coin, $P(H)=\frac12$.", "math_metadata": {}},
        {"question": r"The side length is $\sqrt[3]{343}=7$.", "math_metadata": {}},
        {"question": r"Compute $\frac{3}{8}+\frac{1}{4}$.", "math_metadata": {}},
    ]
    assert all(not heuristic.latex_risk(item) for item in valid_items)


def test_latex_risk_flags_dangling_commands() -> None:
    invalid_items = [
        {"question": r"Compute $\frac$.", "math_metadata": {}},
        {"question": r"Find $\sqrt$.", "math_metadata": {}},
    ]
    assert all(heuristic.latex_risk(item) for item in invalid_items)
