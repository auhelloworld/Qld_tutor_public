"""Tests for the full AC9 Science exercise-bank audit."""

from __future__ import annotations

import sys
import csv
import json
import shutil
import subprocess
import uuid
from copy import deepcopy
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from audit_science_bank_full import (  # type: ignore
    audit_exercise,
    audit_year,
    bank_coverage_issues,
    cer_quality_status,
    data_quality_status,
    diagram_quality_status,
    fact_check_status,
    infer_data_level,
    inquiry_quality_status,
    keywords_from_text,
    load_topic_profiles,
    norm_text,
    representation_quality,
    safety_quality_status,
    topic_alignment_status,
)
from audit_science_banks import (  # type: ignore
    VALID_DIAGRAM_TYPES,
    YEAR_PROFILES,
    audit_bank as audit_heuristic_bank,
    diagram_structural_issues as heuristic_diagram_structural_issues,
)
from scripts.check_exercises import SUPPORTED_DIAGRAM_TYPES


@pytest.fixture
def tmp_path():
    path = ROOT / "test_tmp_science_audit" / uuid.uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)


def base_science_exercise(**overrides):
    ex = {
        "id": "science_7_test_001",
        "topic": "Ecosystems and food webs",
        "question": "Use the food web evidence to explain why grass is a producer.",
        "answer": "Claim: Grass is a producer. Evidence: It is eaten by consumers in the food web. Reasoning: Producers make food using sunlight and pass energy to consumers.",
        "steps": [
            "Identify the producer in the food web.",
            "Use evidence from the arrows to show energy flow.",
            "Explain that producers make food and consumers gain energy from them.",
        ],
        "framework": "AC9_SCIENCE",
        "topic_ids": ["AC9S7U02"],
        "subject": "science",
        "difficulty": "developing",
        "year_level": 7,
        "question_type": "reasoning",
        "complexity": "complex_familiar",
        "rubric": {
            "key_points": ["States a claim", "Uses food-web evidence", "Links reasoning to energy flow"],
            "max_score": 3,
        },
        "sample_reasoning": "Claim: Grass is a producer. Evidence: Arrows show energy moving from grass to consumers. Reasoning: Producers make food and begin energy flow in a food web.",
        "science_metadata": {
            "strand": "Science Understanding",
            "sub_strand": "Biological sciences",
            "claim_evidence_reasoning": True,
        },
    }
    ex.update(overrides)
    return ex


def audit_one(ex, *, year=7, duplicate_ids=None, duplicate_questions=None):
    return audit_exercise(
        ex,
        YEAR_PROFILES[year],
        load_topic_profiles(year),
        duplicate_ids or set(),
        duplicate_questions or set(),
    )


def issue_codes(issues):
    return {issue.code for issue in issues}


def write_bank(tmp_path, items, year=7):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    path = data_dir / f"exercise_{year}_science.json"
    path.write_text(json.dumps(items, indent=2), encoding="utf-8")
    return data_dir


def read_csv(path):
    with path.open(newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def read_jsonl(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


@pytest.mark.parametrize(
    ("override", "expected_code"),
    [
        ({"question": ""}, "missing_question"),
        ({"answer": ""}, "missing_answer"),
        ({"framework": "AC9_MATHS"}, "bad_framework"),
        ({"subject": "math"}, "bad_subject"),
        ({"year_level": 8}, "bad_year_level"),
        ({"question_type": "essay"}, "bad_question_type"),
        ({"difficulty": "hard"}, "bad_difficulty"),
        ({"complexity": "weird"}, "bad_complexity"),
        ({"science_metadata": None}, "missing_science_metadata"),
        ({"topic_ids": ["AC9S7X99"]}, "unknown_topic_id"),
    ],
)
def test_schema_structure_gates_flag_core_errors(override, expected_code):
    _row, issues = audit_one(base_science_exercise(**override))
    assert expected_code in issue_codes(issues)


def test_schema_structure_gates_duplicate_id_and_question():
    ex = base_science_exercise(id="dup")
    _row, issues = audit_one(
        ex,
        duplicate_ids={"dup"},
        duplicate_questions={norm_text(ex["question"])},
    )
    codes = issue_codes(issues)
    assert "duplicate_id" in codes
    assert "duplicate_question" in codes


def test_full_auditor_uses_canonical_exercise_schema():
    ex = base_science_exercise(unexpected_field="not allowed")
    _row, issues = audit_one(ex)
    assert "pydantic_validation" in issue_codes(issues)


def test_full_bank_coverage_flags_missing_curriculum_topics():
    profiles = {
        "AC9S7U02": object(),
        "AC9S7I01": object(),
    }
    issues = bank_coverage_issues(7, [base_science_exercise()], profiles)
    assert any(issue.code == "topic_not_covered" and "AC9S7I01" in issue.message for issue in issues)


def test_heuristic_auditor_uses_schema_real_curriculum_and_fact_gate(tmp_path):
    data_dir = tmp_path / "heuristic_data"
    curriculum_dir = data_dir / "curriculum" / "ac9_science"
    out_dir = tmp_path / "heuristic_out"
    curriculum_dir.mkdir(parents=True)
    item = base_science_exercise(
        answer="Claim: energy is destroyed when the lamp heats up.",
        sample_reasoning="Energy is destroyed.",
        unexpected_field="not allowed",
    )
    data_file = data_dir / "exercise_7_science.json"
    data_file.write_text(json.dumps([item]), encoding="utf-8")
    (curriculum_dir / "year7.json").write_text(
        json.dumps(
            {
                "topics": [
                    {"topic_id": "AC9S7U02"},
                    {"topic_id": "AC9S7I01"},
                ]
            }
        ),
        encoding="utf-8",
    )
    result = audit_heuristic_bank(data_file, out_dir, YEAR_PROFILES[7], curriculum_dir)
    issue_rows = read_csv(out_dir / "year7_science_issue_flags.csv")
    assert result["critical"] >= 1
    assert any(row["issue_type"] == "factual_risk" for row in issue_rows)
    assert any(row["issue_type"] == "curriculum_alignment" and "AC9S7I01" in row["evidence"] for row in issue_rows)


def test_heuristic_diagram_types_follow_canonical_renderer_contract():
    assert VALID_DIAGRAM_TYPES == set(SUPPORTED_DIAGRAM_TYPES)
    assert heuristic_diagram_structural_issues(
        {"diagram_data": {"type": "venn_diagram", "sets": []}}
    ) == []


def test_schema_structure_gates_mcq_answer_mismatch():
    ex = base_science_exercise(
        question_type="multiple_choice",
        question="Which statement is correct about producers?",
        choices=["They make food using sunlight.", "They eat consumers.", "They are all predators.", "They destroy energy."],
        correct_choice="A",
        answer="They eat consumers.",
        difficulty="developing",
        complexity="complex_familiar",
    )
    _row, issues = audit_one(ex)
    assert "mcq_answer_mismatch" in issue_codes(issues)


def test_schema_structure_gates_multipart_missing_subparts():
    ex = base_science_exercise(question_type="multi_part", sub_parts=[])
    _row, issues = audit_one(ex)
    assert "multipart_missing_subparts" in issue_codes(issues)


def test_schema_structure_gates_reasoning_missing_rubric_and_sample():
    ex = base_science_exercise(rubric=None, sample_reasoning="")
    _row, issues = audit_one(ex)
    codes = issue_codes(issues)
    assert "reasoning_rubric_thin" in codes
    assert "reasoning_missing_sample" in codes


def test_full_audit_output_workflow_writes_acceptance_files(tmp_path):
    data_dir = write_bank(tmp_path, [base_science_exercise()])
    out_dir = tmp_path / "audit"
    result = audit_year(7, data_dir=data_dir, out_dir=out_dir)

    assert result["items"] == 1
    for filename in [
        "year7_science_full_summary.md",
        "year7_science_item_audit.csv",
        "year7_science_issue_flags.jsonl",
        "year7_science_hard_errors.csv",
        "year7_science_human_review_queue.csv",
    ]:
        assert (out_dir / filename).exists(), filename


def test_strict_mode_duplicate_id_exits_1(tmp_path):
    item = base_science_exercise(id="dup")
    other = deepcopy(item)
    data_dir = write_bank(tmp_path, [item, other])
    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts" / "audit_science_bank_full.py"),
            "--year",
            "7",
            "--data-dir",
            str(data_dir),
            "--out",
            str(tmp_path / "out"),
            "--strict",
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    assert result.returncode == 1


def test_strict_mode_clean_mini_bank_exits_0(tmp_path):
    data_dir = write_bank(tmp_path, [base_science_exercise()])
    curriculum_dir = tmp_path / "curriculum"
    curriculum_dir.mkdir()
    (curriculum_dir / "year7.json").write_text(
        json.dumps({"topics": [{"topic_id": "AC9S7U02", "name": "Ecosystems and food webs"}]}),
        encoding="utf-8",
    )
    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts" / "audit_science_bank_full.py"),
            "--year",
            "7",
            "--data-dir",
            str(data_dir),
            "--curriculum-dir",
            str(curriculum_dir),
            "--out",
            str(tmp_path / "out"),
            "--strict",
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_keywords_drop_generic_words():
    assert "photosynthesis" in keywords_from_text("Explain photosynthesis using the following information.")
    assert "explain" not in keywords_from_text("Explain photosynthesis using the following information.")


def test_fact_check_flags_science_misconception():
    status, findings = fact_check_status(
        base_science_exercise(answer="Seasons are caused by Earth being closer to the Sun.")
    )
    assert status == "review_needed"
    assert any(code == "seasons_distance" for code, _message in findings)


@pytest.mark.parametrize(
    ("answer", "expected_code"),
    [
        ("Plants get their food from soil through their roots.", "plants_food_from_soil"),
        ("Energy is destroyed when a light bulb gets hot.", "conservation_destroyed"),
        ("Moon phases are caused by Earth's shadow falling on the Moon each month.", "moon_phases_shadow"),
        ("Particles in solids do not move at all.", "solid_particles_no_motion"),
        ("Heavier objects always fall faster because they have more mass.", "heavier_objects_fall_faster"),
        ("Heat and temperature are the same thing.", "heat_temperature_same"),
        ("Adaptations occur because individuals choose to change when they need to.", "adaptation_individual_choice"),
    ],
)
def test_fact_check_flags_common_misconceptions(answer, expected_code):
    status, findings = fact_check_status(base_science_exercise(answer=answer, sample_reasoning=answer))
    assert status == "review_needed"
    assert expected_code in {code for code, _message in findings}


def test_fact_check_ignores_mcq_distractor_misconceptions():
    status, findings = fact_check_status(
        base_science_exercise(
            question_type="multiple_choice",
            answer="Energy is transformed into heat rather than useful light.",
            choices=[
                "Energy is destroyed.",
                "Energy is transformed into heat rather than useful light.",
                "Energy is created from nothing.",
                "Light has no energy.",
            ],
            correct_choice="B",
        )
    )
    assert status == "pass"
    assert findings == []


def test_fact_check_allows_correlation_not_enough_wording():
    status, findings = fact_check_status(
        base_science_exercise(
            question="Why is correlation between two climate variables not enough on its own to prove causation?",
            answer="A third factor or coincidence could explain the link.",
        )
    )
    assert status == "pass"
    assert findings == []


@pytest.mark.parametrize(
    "steps",
    [
        ["Energy is transferred to heat and sound, not because energy is destroyed."],
        ["The option 'organisms choose their own traits' is incorrect because adaptation occurs across generations."],
    ],
)
def test_fact_check_allows_explicit_correction_of_a_misconception(steps):
    status, findings = fact_check_status(base_science_exercise(steps=steps))
    assert status == "pass"
    assert findings == []


def test_multi_part_audit_checks_labels_rubric_coverage_and_nested_template_text():
    ex = base_science_exercise(
        question_type="multi_part",
        question="Complete the two investigation checks.",
        answer="a) 20 C; b) repeat the trials.",
        rubric={
            "key_points": [
                "States that the starting temperature is 20 C.",
                "Explains that repeated trials improve reliability.",
            ],
            "max_score": 3,
        },
        sub_parts=[
            {"label": "a", "question": "State the starting temperature.", "answer": "20 C", "marks": 1},
            {"label": "b", "question": "How can reliability be improved?", "answer": "Repeat the trials.", "marks": 2},
        ],
    )
    _row, issues = audit_one(ex)
    assert "multipart_part_rubric_missing" not in issue_codes(issues)

    ex["sub_parts"][1]["label"] = "A"
    ex["sub_parts"][0]["rubric"] = {"key_points": ["TODO: replace criterion"]}
    _row, issues = audit_one(ex)
    assert "multipart_duplicate_labels" in issue_codes(issues)
    assert "template_high" in issue_codes(issues)


def test_safety_quality_requires_specific_hazard_and_control():
    incomplete = base_science_exercise(
        question="Identify one safety risk when heating a beaker and state a suitable control.",
        answer="Work safely.",
        steps=["Use care."],
        topic_ids=["AC9S8I03"],
        year_level=8,
        science_metadata={"strand": "Science Inquiry", "sub_strand": "Science Inquiry"},
    )
    status, evidence = safety_quality_status(incomplete)
    assert status == "thin"
    assert "hazard" in evidence

    complete = base_science_exercise(
        question="Identify one safety risk when heating a beaker and state a suitable control.",
        answer="Hot glass can burn skin, so use tongs and allow the beaker to cool before handling.",
        topic_ids=["AC9S8I03"],
        year_level=8,
        science_metadata={"strand": "Science Inquiry", "sub_strand": "Science Inquiry"},
    )
    assert safety_quality_status(complete) == ("adequate", "")


def test_safety_quality_ignores_non_practical_risk_and_hazard_language():
    public_risk = base_science_exercise(
        question="Why is communicating health risk clearly better than using vague words?",
        answer="Numbers help people judge the actual likelihood.",
        topic_ids=["AC9S8H04"],
        year_level=8,
        science_metadata={"strand": "Science as a Human Endeavour", "sub_strand": "Science as a Human Endeavour"},
    )
    geological_hazard = base_science_exercise(
        question="Describe the main hazard at a transform plate boundary.",
        answer="Stress release along faults causes earthquakes.",
        topic_ids=["AC9S8U03"],
        year_level=8,
        science_metadata={"strand": "Science Understanding", "sub_strand": "Earth and space sciences"},
    )
    assert safety_quality_status(public_risk) == ("not_applicable", "")
    assert safety_quality_status(geological_hazard) == ("not_applicable", "")


def test_safety_quality_accepts_generic_process_and_concrete_control_mcqs():
    process = base_science_exercise(
        question="A hazard in an experiment is best managed by first:",
        answer="identify the risk and plan a control",
        question_type="multiple_choice",
        choices=["ignore it", "identify the risk and plan a control", "work faster", "remove the results"],
        correct_choice="B",
        topic_ids=["AC9S8I02"],
        year_level=8,
        science_metadata={"strand": "Science Inquiry", "sub_strand": "Science Inquiry"},
    )
    scalpel = base_science_exercise(
        question="A safety control for using a sharp scalpel is to:",
        answer="cut away from the body on a stable surface",
        question_type="multiple_choice",
        choices=["cut towards the hand", "cut away from the body on a stable surface", "hold it in the air", "work without supervision"],
        correct_choice="B",
        topic_ids=["AC9S8I02"],
        year_level=8,
        science_metadata={"strand": "Science Inquiry", "sub_strand": "Science Inquiry"},
    )
    assert safety_quality_status(process) == ("adequate", "")
    assert safety_quality_status(scalpel) == ("adequate", "")


def test_cer_quality_requires_explicit_model_answer():
    status, evidence = cer_quality_status(
        base_science_exercise(
            answer="Grass is a producer because it begins energy flow.",
            sample_reasoning="The answer is supported by the pattern.",
        )
    )
    assert status == "thin"
    assert "claim" in evidence.lower()


@pytest.mark.parametrize(
    "sample",
    [
        "Evidence: Arrows show grass is eaten. Reasoning: Producers begin energy flow.",
        "Claim: Grass is a producer. Reasoning: Producers begin energy flow.",
        "Claim: Grass is a producer. Evidence: Arrows show grass is eaten.",
    ],
)
def test_cer_quality_flags_missing_claim_evidence_or_reasoning(sample):
    status, evidence = cer_quality_status(base_science_exercise(answer=sample, sample_reasoning=sample))
    assert status == "thin"
    assert "claim" in evidence.lower() or "evidence" in evidence.lower() or "reason" in evidence.lower()


def test_cer_quality_flags_reasoning_that_repeats_claim():
    sample = "Claim: Grass is a producer. Evidence: Arrows show grass is eaten by consumers. Reasoning: Grass is a producer."
    status, evidence = cer_quality_status(base_science_exercise(answer=sample, sample_reasoning=sample))
    assert status == "thin"
    assert "repeats" in evidence


def test_cer_quality_clear_claim_evidence_reasoning_passes():
    sample = (
        "Claim: Grass is a producer. Evidence: The food web arrows show energy moving from grass to consumers. "
        "Reasoning: Producers make sugars by photosynthesis, so they introduce energy into the food web."
    )
    status, evidence = cer_quality_status(base_science_exercise(answer=sample, sample_reasoning=sample))
    assert status == "strong"
    assert evidence == ""


def test_topic_alignment_uses_curriculum_profile():
    profiles = load_topic_profiles(7)
    status, evidence = topic_alignment_status(base_science_exercise(), profiles)
    assert status in {"strong", "thin"}
    assert evidence


def test_audit_exercise_emits_prioritised_science_issues():
    profiles = load_topic_profiles(7)
    ex = base_science_exercise(
        id="science_7_bad_001",
        answer="Seasons are caused by Earth being closer to the Sun.",
        sample_reasoning="The answer is supported by the pattern.",
    )
    row, issues = audit_exercise(ex, YEAR_PROFILES[7], profiles, duplicate_ids=set())
    assert row["main_priority"] == "P0"
    codes = {issue.code for issue in issues}
    assert "seasons_distance" in codes
    assert any(issue.category == "cer" for issue in issues)


def test_limitation_language_does_not_force_variable_metadata():
    ex = base_science_exercise(
        question="Explain why equatorial regions have less seasonal temperature variation than polar regions.",
        answer="Equatorial regions receive more direct sunlight throughout the year. Include one limitation or assumption.",
        steps=["Compare sunlight angle at the equator and poles.", "State a limitation of the simple model."],
        topic_ids=["AC9S7U03"],
        science_metadata={"strand": "Science Understanding", "sub_strand": "Earth and space sciences"},
    )
    status, evidence = inquiry_quality_status(ex, YEAR_PROFILES[7])
    assert status == "not_applicable"
    assert evidence == ""


def test_foundational_table_readoff_is_adequate_data_quality():
    ex = base_science_exercise(
        question="Which organism from the table is the apex predator?",
        answer="Python",
        difficulty="foundational",
        complexity="simple_familiar",
        science_metadata={"strand": "Science Understanding", "data_representation": "table"},
        diagram_data={
            "type": "data_table",
            "headers": ["Organism", "Predators"],
            "rows": [["Python", "None"], ["Rat", "Python"]],
        },
    )
    level = infer_data_level(ex, True, False)
    status, evidence = data_quality_status(ex, level, representation_quality(ex, level))
    assert status == "adequate"
    assert evidence == ""


def test_data_representation_table_row_length_mismatch_flagged():
    ex = base_science_exercise(
        science_metadata={"strand": "Science Understanding", "sub_strand": "Biological sciences", "data_representation": "table"},
        diagram_data={
            "type": "data_table",
            "headers": ["Organism", "Role"],
            "rows": [["Grass", "Producer"], ["Rabbit"]],
        },
    )
    status, evidence = diagram_quality_status(ex)
    assert status == "structural_issue"
    assert "same length" in evidence


def test_data_representation_graph_or_table_without_data_flagged():
    ex = base_science_exercise(
        question="Using the graph, describe the trend.",
        science_metadata={"strand": "Science Understanding", "sub_strand": "Biological sciences", "data_representation": "graph"},
        diagram_data=None,
    )
    level = infer_data_level(ex, True, False)
    status, evidence = data_quality_status(ex, level, representation_quality(ex, level))
    assert status == "missing_visual_or_data"
    assert "no usable" in evidence


def test_data_representation_graph_data_missing_axis_units_flagged():
    ex = base_science_exercise(
        graph_data={"x_label": "Time", "y_label": "Temperature", "points": [{"x": 0, "y": 20}]},
    )
    status, evidence = diagram_quality_status(ex)
    assert status == "semantic_review"
    assert "units" in evidence


@pytest.mark.parametrize(
    "diagram_data",
    [
        {
            "type": "food_web",
            "nodes": [{"id": "rabbit", "label": "Rabbit consumer"}, {"id": "grass", "label": "Grass producer"}],
            "links": [{"from": "rabbit", "to": "grass"}],
        },
        {
            "type": "food_web",
            "nodes": [{"id": "fox", "label": "Fox"}, {"id": "rabbit", "label": "Rabbit"}],
            "links": [{"from": "rabbit", "to": "fox"}],
        },
    ],
)
def test_food_web_reversed_arrows_or_missing_producer_flagged_for_review(diagram_data):
    ex = base_science_exercise(diagram_data=diagram_data)
    status, evidence = diagram_quality_status(ex)
    assert status == "semantic_review"
    assert "Food web" in evidence or "Food-web" in evidence


def test_process_flow_order_mismatch_flagged_for_review():
    ex = base_science_exercise(
        diagram_data={
            "type": "process_flow",
            "sequence": True,
            "nodes": [{"id": "solid", "label": "Solid"}, {"id": "liquid", "label": "Liquid"}, {"id": "gas", "label": "Gas"}],
            "links": [{"from": "gas", "to": "liquid"}, {"from": "liquid", "to": "solid"}],
        }
    )
    status, evidence = diagram_quality_status(ex)
    assert status == "semantic_review"
    assert "opposite" in evidence


def test_particle_model_inconsistent_with_state_flagged_for_review():
    ex = base_science_exercise(
        diagram_data={
            "type": "particle_model",
            "state": "solid",
            "particles": 16,
            "description": "Particles are far apart and randomly spaced, filling the container.",
        }
    )
    status, evidence = diagram_quality_status(ex)
    assert status == "semantic_review"
    assert "solid" in evidence


def test_year7_application_mcq_not_flagged_as_weak_extension():
    profiles = load_topic_profiles(7)
    ex = base_science_exercise(
        id="science_7_inquiry_mc_010",
        question_type="multiple_choice",
        question="Students are counting weed species on a school oval using a 1m x 1m quadrat. Instead of throwing the quadrat randomly, a student places it only on patches where weeds are clearly visible. How does this affect the investigation?",
        answer="(B) It introduces bias, overestimating the total weed population.",
        choices=[
            "A. It makes the data more accurate because they definitely count weeds.",
            "B. It introduces bias, overestimating the total weed population.",
            "C. It introduces random error, which can be fixed by doing it once more.",
            "D. It introduces bias, underestimating the total weed population.",
        ],
        correct_choice="B",
        difficulty="extending",
        complexity="complex_unfamiliar",
        topic_ids=["AC9S7U02", "AC9S7I05"],
        science_metadata={"strand": "Science Understanding", "sub_strand": "Evaluating"},
    )
    row, issues = audit_exercise(ex, YEAR_PROFILES[7], profiles, duplicate_ids=set())
    assert row["exam_prep"] == "ready"
    assert not [issue for issue in issues if issue.category == "exam_prep"]


def test_extension_routine_recall_labelled_extending_goes_to_review():
    ex = base_science_exercise(
        question_type="multiple_choice",
        question="A producer is:",
        answer="an organism that makes its own food",
        choices=["an organism that makes its own food", "a predator", "a decomposer", "a consumer"],
        correct_choice="A",
        difficulty="extending",
        complexity="complex_unfamiliar",
    )
    row, issues = audit_one(ex)
    assert row["exam_prep"] in {"weak_extension", "miscalibrated"}
    assert any(issue.category == "exam_prep" for issue in issues)


def test_extension_unfamiliar_data_interpretation_labelled_extending_is_adequate():
    ex = base_science_exercise(
        question="Using the table, evaluate which water sample gives the strongest evidence of ecosystem stress and justify your conclusion.",
        answer="Sample C gives the strongest evidence because dissolved oxygen decreases while algal cover and nitrate concentration increase, showing a linked pattern of nutrient pollution and ecosystem stress.",
        steps=["Compare all three variables.", "Identify the strongest combined pattern.", "Justify the conclusion using evidence."],
        difficulty="extending",
        complexity="complex_unfamiliar",
        topic_ids=["AC9S7I04"],
        science_metadata={"strand": "Science Inquiry", "sub_strand": "Science Inquiry", "data_representation": "table"},
        diagram_data={
            "type": "data_table",
            "headers": ["Sample", "Nitrate (mg/L)", "Dissolved oxygen (mg/L)", "Algal cover (%)"],
            "rows": [["A", "1", "8", "5"], ["B", "4", "6", "20"], ["C", "9", "3", "70"]],
        },
    )
    row, issues = audit_one(ex)
    assert row["exam_prep"] == "ready"
    assert not [issue for issue in issues if issue.category == "exam_prep"]


def test_extension_investigation_validity_evaluation_is_exam_prep_ready():
    ex = base_science_exercise(
        question="A student changes both light intensity and water volume while testing plant growth. Evaluate the validity of the method.",
        answer="The method is not valid because two variables change at once, so the cause of any growth difference cannot be attributed to light. Keep water volume the same and change only light intensity.",
        steps=["Identify the validity flaw.", "Explain why changing two variables prevents causal attribution.", "Fix the method by controlling water volume."],
        difficulty="extending",
        complexity="complex_unfamiliar",
        topic_ids=["AC9S7I02"],
        science_metadata={"strand": "Science Inquiry", "sub_strand": "Science Inquiry"},
    )
    row, issues = audit_one(ex)
    assert row["exam_prep"] == "ready"
    assert not [issue for issue in issues if issue.category == "exam_prep"]


def test_extension_application_mcq_with_plausible_distractors_not_overflagged():
    ex = base_science_exercise(
        question_type="multiple_choice",
        question="Students sample insects in a garden using randomly placed quadrats. Which conclusion is best supported if the shaded area has many more insects in every quadrat?",
        answer="Shade is associated with higher insect abundance in this garden.",
        choices=[
            "Shade is associated with higher insect abundance in this garden.",
            "Shade proves every insect species prefers darkness.",
            "The result is invalid because quadrats can never be used for animals.",
            "The sunny area must have no food web.",
        ],
        correct_choice="A",
        difficulty="extending",
        complexity="complex_unfamiliar",
        topic_ids=["AC9S7I05"],
        science_metadata={"strand": "Science Inquiry", "sub_strand": "Science Inquiry"},
    )
    row, issues = audit_one(ex)
    assert row["exam_prep"] == "ready"
    assert not [issue for issue in issues if issue.category == "exam_prep"]


def test_review_queue_routes_review_and_hard_error_items(tmp_path):
    weak_extension = base_science_exercise(
        id="weak_ext",
        question_type="multiple_choice",
        question="A producer is:",
        answer="an organism that makes its own food",
        choices=["an organism that makes its own food", "a predator", "a decomposer", "a consumer"],
        correct_choice="A",
        difficulty="extending",
        complexity="complex_unfamiliar",
    )
    fact_error = base_science_exercise(
        id="fact_error",
        question="Explain plant nutrition.",
        answer="Plants get their food from soil.",
        sample_reasoning="Plants get their food from soil.",
    )
    schema_error = base_science_exercise(id="schema_error", framework="WRONG")
    data_dir = write_bank(tmp_path, [weak_extension, fact_error, schema_error])
    out_dir = tmp_path / "audit"
    audit_year(7, data_dir=data_dir, out_dir=out_dir)

    hard_rows = read_csv(out_dir / "year7_science_hard_errors.csv")
    review_rows = read_csv(out_dir / "year7_science_human_review_queue.csv")
    jsonl_rows = read_jsonl(out_dir / "year7_science_issue_flags.jsonl")

    assert any(row["exercise_id"] == "weak_ext" and row["code"] == "weak_extension" for row in review_rows)
    assert not any(row["exercise_id"] == "weak_ext" for row in hard_rows)
    assert any(row["exercise_id"] == "fact_error" and row["category"] == "factual_accuracy" for row in jsonl_rows)
    assert any(row["exercise_id"] == "schema_error" and row["category"] == "schema" for row in hard_rows)


def test_year8_cer_understanding_item_not_misread_as_inquiry_method():
    ex = base_science_exercise(
        question="A student claims: 'Animal cells must have a thin cell wall.' Evaluate using Claim-Evidence-Reasoning.",
        answer="Claim: The claim is wrong. Evidence: Animal cells have a cell membrane but no cell wall. Reasoning: Cell walls are rigid plant structures, so animal-cell flexibility comes from the membrane.",
        steps=["State the claim is wrong.", "Use cell-structure evidence.", "Explain the membrane versus wall distinction."],
        topic_ids=["AC9S8U01"],
        year_level=8,
        science_metadata={"strand": "Science Understanding", "sub_strand": "Biological sciences", "claim_evidence_reasoning": True},
    )
    status, evidence = inquiry_quality_status(ex, YEAR_PROFILES[8])
    assert status == "not_applicable"
    assert evidence == ""


def test_year8_control_group_item_is_valid_inquiry():
    ex = base_science_exercise(
        question="Explain why a control group improves an investigation into whether fertiliser increases plant growth.",
        answer="The control group receives no fertiliser and provides a baseline for comparison while other conditions are controlled.",
        steps=["Define the control group.", "Use it as a baseline.", "Compare treated plants with the control group."],
        topic_ids=["AC9S8I02"],
        year_level=8,
        science_metadata={"strand": "Science Inquiry", "sub_strand": "Science Inquiry"},
    )
    assert inquiry_quality_status(ex, YEAR_PROFILES[8]) == ("adequate", "")


def test_year8_rock_sample_is_not_misread_as_inquiry():
    ex = base_science_exercise(
        question="A geologist examines a rock sample with large interlocking crystals. Explain how it formed.",
        answer="It cooled slowly underground, allowing large crystals to grow.",
        steps=["Identify the crystal texture.", "Link large crystals to slow cooling underground."],
        topic_ids=["AC9S8U04"],
        year_level=8,
        science_metadata={"strand": "Science Understanding", "sub_strand": "Earth and space sciences"},
    )
    assert inquiry_quality_status(ex, YEAR_PROFILES[8]) == ("not_applicable", "")


def test_year8_scientific_register_task_is_valid_i08_inquiry():
    ex = base_science_exercise(
        question="Rewrite this casual sentence for a formal report and explain your changes: 'The mixture went mad and bubbled heaps real quick.'",
        answer="A formal version is: 'The mixture reacted vigorously, producing rapid bubbling within a few seconds.' The changes replace slang with precise scientific language.",
        steps=["Rewrite using precise, objective wording.", "Explain how the changes improve formal report style."],
        topic_ids=["AC9S8I08"],
        year_level=8,
        science_metadata={"strand": "Science Inquiry", "sub_strand": "Science Inquiry"},
    )
    status, evidence = inquiry_quality_status(ex, YEAR_PROFILES[8])
    assert status == "adequate"
    assert evidence == ""


def test_year8_controlled_variable_definition_is_not_overflagged():
    ex = base_science_exercise(
        question="A 'controlled variable' is one that is:",
        answer="kept the same so it does not affect the results",
        steps=["Identify that a controlled variable is kept constant."],
        question_type="multiple_choice",
        topic_ids=["AC9S8I02"],
        year_level=8,
        science_metadata={"strand": "Science Inquiry", "sub_strand": "Science Inquiry"},
    )
    status, evidence = inquiry_quality_status(ex, YEAR_PROFILES[8])
    assert status == "adequate"
    assert evidence == ""


def test_year8_iv_dv_controls_and_repeats_are_enough_for_fair_test_item():
    ex = base_science_exercise(
        question="A student tests how the amount of salt affects how long an ice cube takes to melt.",
        answer="a) IV: amount of salt; DV: melting time. b) Ice cube size and starting temperature. c) Repeat each amount of salt and average the melting times.",
        steps=["Identify the IV and DV.", "Name controlled variables.", "Use repeats to improve reliability."],
        question_type="multi_part",
        topic_ids=["AC9S8I02"],
        year_level=8,
        sub_parts=[
            {"label": "a", "question": "State the IV and DV.", "answer": "IV: amount of salt; DV: melting time.", "marks": 2},
            {"label": "b", "question": "Give two controlled variables.", "answer": "Ice cube size and starting temperature.", "marks": 2},
            {"label": "c", "question": "State one way to improve reliability.", "answer": "Repeat each amount and average the times.", "marks": 1},
        ],
        science_metadata={"strand": "Science Inquiry", "sub_strand": "Science Inquiry"},
    )
    status, evidence = inquiry_quality_status(ex, YEAR_PROFILES[8])
    assert status == "adequate"
    assert evidence == ""


def test_inquiry_fair_test_with_iv_dv_controls_and_repeats_passes():
    ex = base_science_exercise(
        question="Plan a fair test: identify the independent variable, dependent variable, controlled variables and how repeats will be used.",
        answer="IV: light intensity. DV: plant growth. Controlled variables: plant species, soil amount and water volume. Repeat each light level with several plants and average the growth.",
        steps=["Name the IV and DV.", "Keep plant species, soil and water constant.", "Repeat trials and average results."],
        question_type="short_answer",
        topic_ids=["AC9S8I02"],
        year_level=8,
        science_metadata={"strand": "Science Inquiry", "sub_strand": "Science Inquiry"},
    )
    status, evidence = inquiry_quality_status(ex, YEAR_PROFILES[8])
    assert status == "adequate"
    assert evidence == ""


def test_inquiry_variable_question_missing_controlled_variables_is_thin():
    ex = base_science_exercise(
        question="Identify the independent variable, dependent variable and controlled variables in this fair test.",
        answer="The independent variable is light intensity and the dependent variable is plant growth.",
        steps=["Identify IV and DV."],
        topic_ids=["AC9S8I02"],
        year_level=8,
        science_metadata={"strand": "Science Inquiry", "sub_strand": "Science Inquiry"},
    )
    status, evidence = inquiry_quality_status(ex, YEAR_PROFILES[8])
    assert status == "thin"
    assert "controlled" in evidence


def test_inquiry_reliability_improvement_requires_repeats_or_sample_size():
    ex = base_science_exercise(
        question="How could the student improve the reliability of the investigation?",
        answer="Use a more accurate thermometer and write the results neatly.",
        steps=["Suggest better equipment."],
        topic_ids=["AC9S9I02"],
        year_level=9,
        science_metadata={"strand": "Science Inquiry", "sub_strand": "Science Inquiry"},
    )
    status, evidence = inquiry_quality_status(ex, YEAR_PROFILES[9])
    assert status == "thin"
    assert "Reliability" in evidence


def test_inquiry_validity_improvement_must_match_method_flaw():
    ex = base_science_exercise(
        question="The method changes two variables at once. How should validity be improved?",
        answer="Repeat the investigation three times and average the results.",
        steps=["Repeat and average."],
        topic_ids=["AC9S9I02"],
        year_level=9,
        science_metadata={"strand": "Science Inquiry", "sub_strand": "Science Inquiry"},
    )
    status, evidence = inquiry_quality_status(ex, YEAR_PROFILES[9])
    assert status == "thin"
    assert "Validity" in evidence


def test_inquiry_safety_risk_item_does_not_require_iv_dv():
    ex = base_science_exercise(
        question="Identify one safety risk when heating a beaker and state a suitable control.",
        answer="Hot glass can burn skin, so use tongs and safety glasses and allow the beaker to cool before handling.",
        steps=["Name the risk.", "State the safety control."],
        topic_ids=["AC9S8I03"],
        year_level=8,
        science_metadata={"strand": "Science Inquiry", "sub_strand": "Science Inquiry"},
    )
    status, evidence = inquiry_quality_status(ex, YEAR_PROFILES[8])
    assert status == "adequate"
    assert evidence == ""


def test_year9_evidence_mcq_does_not_need_cer_rubric():
    ex = base_science_exercise(
        question="An evidence-based argument supports its claim with:",
        answer="relevant data and reasoning",
        question_type="multiple_choice",
        choices=["opinion", "relevant data and reasoning", "a slogan", "a guess"],
        correct_choice="B",
        topic_ids=["AC9S9I07"],
        year_level=9,
        science_metadata={"strand": "Science Inquiry", "sub_strand": "Science Inquiry"},
    )
    status, evidence = cer_quality_status(ex)
    assert status == "adequate"
    assert evidence == ""


def test_year9_measurement_resolution_item_is_valid_inquiry():
    ex = base_science_exercise(
        question="A student must measure a small volume of acid, its temperature, and the mass of a solid catalyst.",
        answer="Use a pipette or burette, thermometer, and electronic balance. Read the meniscus at eye level. Instrument resolution matters because coarse instruments can hide small real changes.",
        steps=["Match each measurement to a suitable instrument.", "Use meniscus technique.", "Explain why resolution matters."],
        question_type="multi_part",
        topic_ids=["AC9S9I03"],
        year_level=9,
        science_metadata={"strand": "Science Inquiry", "sub_strand": "Science Inquiry"},
    )
    status, evidence = inquiry_quality_status(ex, YEAR_PROFILES[9])
    assert status == "adequate"
    assert evidence == ""


def test_year9_cooling_rate_data_interpretation_is_adequate():
    ex = base_science_exercise(
        question="Using the cooling data, describe how the rate of cooling changes over time.",
        answer="The liquid cools quickly at first and then more slowly, so the rate of cooling decreases over time.",
        steps=["Compare the first and last temperature changes.", "State that the cooling rate decreases."],
        topic_ids=["AC9S9I04"],
        year_level=9,
        difficulty="developing",
        complexity="complex_familiar",
        science_metadata={"strand": "Science Inquiry", "sub_strand": "Science Inquiry", "data_representation": "table"},
        diagram_data={
            "type": "data_table",
            "headers": ["Time (min)", "Temperature (C)"],
            "rows": [["0", "80"], ["2", "66"], ["4", "56"], ["6", "49"], ["8", "44"]],
        },
    )
    level = infer_data_level(ex, True, False)
    status, evidence = data_quality_status(ex, level, representation_quality(ex, level))
    assert status == "adequate"
    assert evidence == ""
