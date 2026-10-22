"""Quality gates for QCAA Specialist Mathematics content.

Mirrors ``test_methods_bank_quality.py``:

1.  **Curriculum spine** (``test_specialist_curriculum_spine``) — validates the
    authored ``specialist.json`` slice: 20 topics across 4 units × 5,
    well-formed ``QCAA_SPECIALIST_U<u>_T<t>`` ids, and a usable concept card
    (worked example + lesson content) on every topic. Passes today.

2.  **Exercise bank** (``test_specialist_bank_hard_gates``) — a data-driven
    audit that discovers any ``exercise_specialist*.json`` bank and gates it on
    coverage, MCQ integrity, reasoning/multi-part depth, difficulty/complexity
    coherence, and anti-template signatures. Until the Phase S3 bank lands the
    gate skips, but ``test_specialist_bank_audit_machinery`` proves the auditor
    catches the defects it claims to, using synthetic banks.
"""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from functools import partial
from pathlib import Path
from typing import Any

from tests.unit._bank_audit_helpers import (
    answer_matches_choice as _answer_matches_choice,
    audit_senior_question_type as _shared_audit_question_type,
    audit_senior_template_signatures as _shared_audit_template_signatures,
    load_json as _load_json,
    normalise_alphanum as _normalise_text,
    strip_choice_prefix as _strip_choice_prefix,
)

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
SPECIALIST_CURRICULUM = DATA_DIR / "curriculum" / "qcaa_senior_maths" / "specialist.json"

EXPECTED_UNITS = (1, 2, 3, 4)
TOPICS_PER_UNIT = 5
EXPECTED_TOPIC_IDS = {
    f"QCAA_SPECIALIST_U{u}_T{t}"
    for u in EXPECTED_UNITS
    for t in range(1, TOPICS_PER_UNIT + 1)
}
TOPIC_ID_PATTERN = re.compile(r"^QCAA_SPECIALIST_U([1-4])_T([1-5])$")

VALID_DIFFICULTY = {"foundational", "developing", "extending", "AMC"}
VALID_COMPLEXITY = {"simple_familiar", "complex_familiar", "complex_unfamiliar"}
FORBIDDEN_DIFFICULTY_COMPLEXITY = {
    ("foundational", "complex_familiar"),
    ("foundational", "complex_unfamiliar"),
    ("extending", "simple_familiar"),
    ("AMC", "simple_familiar"),
    ("AMC", "complex_familiar"),
}
REQUIRED_DIFFICULTY_LADDER = {"foundational", "developing", "extending"}
MAX_DIFFICULTY_SHARE = 0.85

# Anti-template signatures (see test_science_bank_quality.py for rationale).
MIN_CONTENT_DIVERSITY = 0.5
MAX_BOILERPLATE_SHARE = 0.5
MIN_DIVERSITY_SAMPLE = 20

# Reasoning / multi-part depth expectations for senior maths.
MIN_REASONING_KEY_POINTS = 3
MIN_REASONING_SCORE = 3
MIN_MULTI_PART_MARKS = 4

BAD_CONTENT_PATTERNS = (
    re.compile(r"\bTODO\b", re.IGNORECASE),
    re.compile(r"\bTEMPLATE\b", re.IGNORECASE),
    re.compile(r"\bTBD\b", re.IGNORECASE),
    re.compile(r"\bFIXME\b", re.IGNORECASE),
    re.compile(r"as an ai", re.IGNORECASE),
    re.compile(r"lorem ipsum", re.IGNORECASE),
    re.compile(r"placeholder", re.IGNORECASE),
    re.compile(r"\{\{[^}]+\}\}"),
)


# ---------------------------------------------------------------------------
# 1. Curriculum spine
# ---------------------------------------------------------------------------


def test_specialist_curriculum_spine() -> None:
    """The authored Specialist slice must be a complete, well-formed spine."""
    slice_file = _load_json(SPECIALIST_CURRICULUM)
    assert slice_file.get("framework_id") == "QCAA_SENIOR_MATHS"

    topics = slice_file.get("topics") or []
    topic_ids = [t.get("topic_id") for t in topics]

    assert len(topics) == 20, f"expected 20 topics, found {len(topics)}"
    assert set(topic_ids) == EXPECTED_TOPIC_IDS, (
        f"topic_id set mismatch: missing {sorted(EXPECTED_TOPIC_IDS - set(topic_ids))}, "
        f"unexpected {sorted(set(topic_ids) - EXPECTED_TOPIC_IDS)}"
    )
    assert len(set(topic_ids)) == len(topic_ids), "duplicate topic_ids in specialist.json"

    # 4 units × 5 topics.
    per_unit: Counter[int] = Counter()
    for topic in topics:
        topic_id = topic.get("topic_id", "")
        match = TOPIC_ID_PATTERN.match(str(topic_id))
        assert match, f"malformed topic_id: {topic_id!r}"
        unit = int(match.group(1))
        assert topic.get("unit") == unit, (
            f"{topic_id}: unit field {topic.get('unit')} disagrees with id"
        )
        assert topic.get("syllabus_subject") == "specialist", f"{topic_id}: wrong subject"
        per_unit[unit] += 1
    for unit in EXPECTED_UNITS:
        assert per_unit[unit] == TOPICS_PER_UNIT, (
            f"unit {unit} has {per_unit[unit]} topics, expected {TOPICS_PER_UNIT}"
        )

    # Every topic carries a usable concept card for self-study.
    for topic in topics:
        topic_id = topic["topic_id"]
        card = topic.get("concept_card") or {}
        assert card.get("core_rule"), f"{topic_id}: missing core_rule"
        assert len(card.get("hint_levels") or []) >= 1, f"{topic_id}: no hint_levels"

        worked = card.get("worked_example") or {}
        assert worked.get("question"), f"{topic_id}: worked_example missing question"
        assert worked.get("answer"), f"{topic_id}: worked_example missing answer"
        assert len(worked.get("steps") or []) >= 1, f"{topic_id}: worked_example has no steps"

        lesson = card.get("lesson_content") or {}
        assert len(lesson.get("learning_objectives") or []) >= 1, (
            f"{topic_id}: lesson_content needs >=1 learning objective"
        )
        assert len(lesson.get("explanation_sections") or []) >= 2, (
            f"{topic_id}: lesson_content needs >=2 explanation sections"
        )
        for section in lesson["explanation_sections"]:
            assert section.get("heading"), f"{topic_id}: explanation section missing heading"
            assert section.get("body"), f"{topic_id}: explanation section missing body"


def test_specialist_unit1_curriculum_repair_gates() -> None:
    """Protect Specialist Unit 1 syllabus depth, notation and visual repairs."""
    slice_file = _load_json(SPECIALIST_CURRICULUM)
    unit1 = {
        topic["topic_id"]: topic
        for topic in slice_file["topics"]
        if topic.get("syllabus_subject") == "specialist" and topic.get("unit") == 1
    }
    assert set(unit1) == {f"QCAA_SPECIALIST_U1_T{i}" for i in range(1, 6)}

    lessons = {
        topic_id: topic["concept_card"]["lesson_content"]
        for topic_id, topic in unit1.items()
    }

    t1 = lessons["QCAA_SPECIALIST_U1_T1"]
    assert len(t1.get("additional_worked_examples") or []) >= 5
    headings = [section["heading"] for section in t1["explanation_sections"]]
    assert headings.count("Restrictions and probability models") == 1
    assert "Restricted arrangements and probability models" not in headings
    venn = next(
        section["diagram"]
        for section in t1["explanation_sections"]
        if section["heading"] == "Inclusion-exclusion"
    )
    assert venn.get("set_c_label") == "C"
    assert venn.get("regions", {}).get("abc") == "A∩B∩C"
    t1_questions = " ".join(
        example["question"] for example in t1["additional_worked_examples"]
    ).lower()
    for required in ("balloon", "stand together", "at least two girls", "survey", "probability"):
        assert required in t1_questions

    t2 = lessons["QCAA_SPECIALIST_U1_T2"]
    t2_text = json.dumps(t2, ensure_ascii=False)
    assert "\\mathbb{Q}'" in t2_text
    assert "single valid witness" in t2_text
    t2_questions = " ".join(
        example["question"] for example in t2["additional_worked_examples"]
    ).lower()
    assert "0.\\overline{27}" in t2_questions
    assert "contrapositive" in t2_questions

    t3 = lessons["QCAA_SPECIALIST_U1_T3"]
    t3_text = json.dumps(t3, ensure_ascii=False)
    assert "\\overrightarrow{AB}" in t3_text
    assert "Free vector" in t3_text
    assert "270^" in t3_text and "vertical vector" in t3_text.lower()
    assert len(t3.get("additional_worked_examples") or []) >= 4
    for section in t3["explanation_sections"]:
        diagram = section.get("diagram")
        if not diagram or diagram.get("type") != "construction_diagram":
            continue
        assert diagram.get("segments")
        assert all(segment.get("directed") is True for segment in diagram["segments"])

    t4 = lessons["QCAA_SPECIALIST_U1_T4"]
    core = unit1["QCAA_SPECIALIST_U1_T4"]["concept_card"]["core_rule"]
    assert "parallel/perpendicular tests" not in core
    assert "scalar multiple" in core
    section_formula = next(
        item["definition"]
        for item in t4["key_vocabulary"]
        if item["term"] == "Section formula"
    )
    assert "AP:PB=m:n" in section_formula
    assert "\\frac{n\\mathbf a+m\\mathbf b}{m+n}" in section_formula
    assert any(section["heading"] == "Relative velocity" for section in t4["explanation_sections"])
    incline = next(
        section["diagram"]
        for section in t4["explanation_sections"]
        if section["heading"] == "Force equilibrium on a smooth incline"
    )
    assert incline.get("right_angles")
    projection = next(
        section["diagram"]
        for section in t4["explanation_sections"]
        if section["heading"] == "Projection"
    )
    assert projection.get("right_angles")
    assert any(segment.get("directed") for segment in projection["segments"])
    t4_questions = " ".join(
        example["question"] for example in t4["additional_worked_examples"]
    ).lower()
    for required in ("divides", "relative", "equilibrium", "smooth plane"):
        assert required in t4_questions

    t5 = lessons["QCAA_SPECIALIST_U1_T5"]
    property_table = next(
        section["diagram"]
        for section in t5["explanation_sections"]
        if section["heading"] == "Operations"
    )
    property_names = {row[0] for row in property_table["rows"]}
    assert {"Associative addition", "Associative multiplication"} <= property_names
    t5_questions = " ".join(
        example["question"] for example in t5["additional_worked_examples"]
    )
    for required in ("Find $AB$ and $BA$", "Solve $XA=B$", "Solve $AX+BX=C$", "school event"):
        assert required in t5_questions

    for topic_id, lesson in lessons.items():
        for section in lesson["explanation_sections"]:
            diagram = section.get("diagram")
            if diagram and diagram.get("type") == "data_table":
                assert diagram.get("title"), f"{topic_id}: untitled Unit 1 data table"


def test_specialist_unit2_curriculum_repair_gates() -> None:
    """Protect Specialist Unit 2 syllabus boundaries, proof depth and applications."""
    slice_file = _load_json(SPECIALIST_CURRICULUM)
    unit2 = {
        topic["topic_id"]: topic
        for topic in slice_file["topics"]
        if topic.get("syllabus_subject") == "specialist" and topic.get("unit") == 2
    }
    assert set(unit2) == {f"QCAA_SPECIALIST_U2_T{i}" for i in range(1, 6)}
    lessons = {
        topic_id: topic["concept_card"]["lesson_content"]
        for topic_id, topic in unit2.items()
    }

    t1_topic = unit2["QCAA_SPECIALIST_U2_T1"]
    t1 = lessons["QCAA_SPECIALIST_U2_T1"]
    assert "modulus_argument" not in t1_topic["skills"]
    assert all(section["heading"] != "Modulus and argument" for section in t1["explanation_sections"])
    assert "Cartesian form" in t1_topic["concept_card"]["worked_example"]["question"]
    assert all("principal argument" not in objective.lower() for objective in t1["learning_objectives"])
    for section in t1["explanation_sections"]:
        diagram = section.get("diagram")
        if diagram and diagram.get("type") == "construction_diagram":
            assert diagram.get("axes") is True
            assert all(segment.get("directed") is True for segment in diagram.get("segments") or [])

    t2 = lessons["QCAA_SPECIALIST_U2_T2"]
    assert "polar form" in unit2["QCAA_SPECIALIST_U2_T2"]["concept_card"]["worked_example"]["question"].lower()
    assert len(t2.get("additional_worked_examples") or []) >= 8
    t2_headings = {section["heading"] for section in t2["explanation_sections"]}
    assert {"Angular sectors and half-planes", "Strict half-plane inequalities", "Apollonius loci"} <= t2_headings
    polar = next(section["diagram"] for section in t2["explanation_sections"] if section["heading"] == "Polar form")
    assert polar.get("axes") is True and polar.get("angle_arcs")
    open_disc = next(section["diagram"] for section in t2["explanation_sections"] if section["heading"] == "Subsets of the Argand plane")
    assert open_disc["circles"][0].get("dashed") is True
    assert open_disc["circles"][0].get("fill")
    t2_questions = " ".join(example["question"] for example in t2["additional_worked_examples"]).lower()
    for required in ("principal argument", "|z-3i|<4", "operatorname{re}(z)>\\operatorname{im}(z)", "|z-1|=2|z-i|", "completing the square", "quadratic formula"):
        assert required.replace(" ", "") in t2_questions.replace(" ", "")

    t3 = lessons["QCAA_SPECIALIST_U2_T3"]
    assert unit2["QCAA_SPECIALIST_U2_T3"]["concept_card"]["worked_example"]["question"].startswith("Prove")
    t3_headings = {section["heading"] for section in t3["explanation_sections"]}
    assert {
        "Semicircle and same-segment corollaries",
        "Tangent-radius theorem and converse",
        "Alternate segment theorem",
        "Cyclic quadrilateral theorem and converse",
    } <= t3_headings
    assert len(t3.get("additional_worked_examples") or []) >= 4
    t3_questions = " ".join(example["question"] for example in t3["additional_worked_examples"]).lower()
    for required in ("diameter", "if and only if", "parallelogram law"):
        assert required in t3_questions
    alternate = next(section["diagram"] for section in t3["explanation_sections"] if section["heading"] == "Alternate segment theorem")
    assert alternate.get("right_angles") and alternate.get("angle_arcs")

    t4 = lessons["QCAA_SPECIALIST_U2_T4"]
    t4_headings = {section["heading"] for section in t4["explanation_sections"]}
    assert {"Cosecant graph", "Cotangent graph"} <= t4_headings
    transforms = next(section["diagram"] for section in t4["explanation_sections"] if section["heading"] == "Absolute value and graph transforms")
    assert len(transforms.get("functions") or []) == 4
    assert len(t4.get("additional_worked_examples") or []) >= 9
    t4_questions = " ".join(example["question"] for example in t4["additional_worked_examples"]).lower()
    for required in ("sin75", "product identity", "cos4x", "solve $3", "tide model", "f(x)=x-1"):
        assert required in t4_questions
    asymptote = next(item["definition"] for item in t4["key_vocabulary"] if item["term"] == "Asymptote")
    assert "never meets" not in asymptote

    t5 = lessons["QCAA_SPECIALIST_U2_T5"]
    t5_headings = {section["heading"] for section in t5["explanation_sections"]}
    assert {"Polygons and area scale", "Two reflections form a rotation"} <= t5_headings
    polygon = next(section["diagram"] for section in t5["explanation_sections"] if section["heading"] == "Polygons and area scale")
    assert len(polygon.get("polygons") or []) == 2
    assert len(t5.get("additional_worked_examples") or []) >= 6
    t5_questions = " ".join(example["question"] for example in t5["additional_worked_examples"]).lower()
    for required in ("translate", "triangle", "composite matrix", "original point", "followed by reflection in"):
        assert required in t5_questions
    composition_body = next(section["body"] for section in t5["explanation_sections"] if section["heading"] == "Applying and composing")
    assert "2(\\beta-\\alpha)" in composition_body

    diagrams = [
        section["diagram"]
        for lesson in lessons.values()
        for section in lesson["explanation_sections"]
        if section.get("diagram")
    ]
    assert len(diagrams) == 20
    assert all(diagram.get("title") for diagram in diagrams)


def test_specialist_unit3_curriculum_repair_gates() -> None:
    """Protect Specialist Unit 3 correctness, worked depth and visual repairs."""
    slice_file = _load_json(SPECIALIST_CURRICULUM)
    unit3 = {
        topic["topic_id"]: topic
        for topic in slice_file["topics"]
        if topic.get("syllabus_subject") == "specialist" and topic.get("unit") == 3
    }
    assert set(unit3) == {f"QCAA_SPECIALIST_U3_T{i}" for i in range(1, 6)}
    lessons = {
        topic_id: topic["concept_card"]["lesson_content"]
        for topic_id, topic in unit3.items()
    }

    t1 = lessons["QCAA_SPECIALIST_U3_T1"]
    assert any(section["heading"] == "Modulus and argument identities" for section in t1["explanation_sections"])
    assert len(t1.get("additional_worked_examples") or []) >= 7
    t1_text = json.dumps(t1, ensure_ascii=False)
    assert "$p(1)=-1$" in t1_text
    assert "$p(1)=-2$" not in t1_text
    t1_questions = " ".join(example["question"] for example in t1["additional_worked_examples"]).lower()
    for required in ("negative integer power", "fourth roots of unity", "w^3", "z^4", "complex coefficients"):
        assert required in t1_questions
    roots = next(section["diagram"] for section in t1["explanation_sections"] if section["heading"] == "Roots of unity")
    assert roots.get("circles") and len(roots.get("segments") or []) == 4
    assert all(segment.get("directed") is True for segment in roots["segments"])

    t2 = lessons["QCAA_SPECIALIST_U3_T2"]
    t2_headings = {section["heading"] for section in t2["explanation_sections"]}
    assert "Sigma notation and indexing" in t2_headings
    structure = next(section["diagram"] for section in t2["explanation_sections"] if section["heading"] == "The two steps")
    assert structure.get("title")
    de_moivre = next(section["body"] for section in t2["explanation_sections"] if section["heading"] == "De Moivre by induction")
    assert "r^{k+1}" in de_moivre
    t2_questions = " ".join(example["question"] for example in t2["additional_worked_examples"]).lower()
    for required in ("sigma notation", "6$ divides", "positive integer", "cos4", "positive odd"):
        assert required in t2_questions

    t3 = lessons["QCAA_SPECIALIST_U3_T3"]
    three_d = next(section["diagram"] for section in t3["explanation_sections"] if section["heading"] == "Three-dimensional vectors")
    assert three_d.get("polygons") and three_d.get("angle_arcs")
    cross = next(section["diagram"] for section in t3["explanation_sections"] if section["heading"] == "Cross product")
    assert cross.get("polygons") and cross.get("right_angles")
    assert all(segment.get("directed") is True for segment in cross.get("segments") or [])
    line_table = next(section["diagram"] for section in t3["explanation_sections"] if section["heading"] == "Equations of lines")
    assert line_table.get("title")
    t3_text = json.dumps(t3, ensure_ascii=False)
    assert "AP:PB=m:n" in t3_text
    assert "scalar triple product" not in t3_text.lower()
    assert len(t3.get("additional_worked_examples") or []) >= 12
    t3_questions = " ".join(example["question"] for example in t3["additional_worked_examples"]).lower()
    for required in ("altitude angle", "divided internally", "scalar and vector projections", "line through", "eliminate the parameter", "parallelogram and triangle", "sphere", "plane through", "relative to", "forces", "right-angled"):
        assert required in t3_questions

    t4 = lessons["QCAA_SPECIALIST_U3_T4"]
    derivative = next(section["diagram"] for section in t4["explanation_sections"] if section["heading"] == "The derivative ladder")
    assert derivative.get("title") and derivative.get("vectors")
    assert any(fn.get("expr") == "-0.6*x+1.69" for fn in derivative.get("functions") or [])
    circle = next(section["diagram"] for section in t4["explanation_sections"] if section["heading"] == "Paths in the plane")
    assert circle.get("equal_scale") is True
    assert {"QCAA_METHODS_U3_T2", "QCAA_METHODS_U3_T4"} <= set(t4.get("prerequisite_topics") or [])
    assert len(t4.get("additional_worked_examples") or []) >= 9
    t4_questions = " ".join(example["question"] for example in t4["additional_worked_examples"]).lower()
    for required in ("2+3", "1+4", "cosh", "paths cross", "moves on a line", "a(t)", "projectile", "uniform circular"):
        assert required in t4_questions

    t5_topic = unit3["QCAA_SPECIALIST_U3_T5"]
    t5 = lessons["QCAA_SPECIALIST_U3_T5"]
    assert "Gaussian elimination" in t5_topic["concept_card"]["worked_example"]["question"]
    assert any(section["heading"] == "Geometric meaning of the three solution cases" for section in t5["explanation_sections"])
    dominance = next(section["diagram"] for section in t5["explanation_sections"] if section["heading"] == "Dominance matrices")
    assert len(dominance["headers"]) == 6
    leslie = next(section["diagram"] for section in t5["explanation_sections"] if section["heading"] == "Leslie matrices")
    assert len(leslie["headers"]) == 4
    assert len(t5.get("additional_worked_examples") or []) >= 7
    t5_questions = " ".join(example["question"] for example in t5["additional_worked_examples"]).lower()
    for required in ("calculate $a^2$", "determinant and inverse", "three matrix equations", "no solution", "infinitely many", "adult, student and child", "three-age population"):
        assert required in t5_questions

    diagrams = [
        section["diagram"]
        for lesson in lessons.values()
        for section in lesson["explanation_sections"]
        if section.get("diagram")
    ]
    assert len(diagrams) == 15
    assert all(diagram.get("title") for diagram in diagrams)


def test_specialist_unit4_curriculum_repair_gates() -> None:
    """Protect Specialist Unit 4 calculus, modelling and inference depth."""
    slice_file = _load_json(SPECIALIST_CURRICULUM)
    unit4 = {
        topic["topic_id"]: topic
        for topic in slice_file["topics"]
        if topic.get("syllabus_subject") == "specialist" and topic.get("unit") == 4
    }
    assert set(unit4) == {f"QCAA_SPECIALIST_U4_T{i}" for i in range(1, 6)}
    lessons = {
        topic_id: topic["concept_card"]["lesson_content"]
        for topic_id, topic in unit4.items()
    }

    t1 = lessons["QCAA_SPECIALIST_U4_T1"]
    assert {"QCAA_METHODS_U3_T4", "QCAA_METHODS_U4_T1"} <= set(t1.get("prerequisite_topics") or [])
    assert len(t1.get("additional_worked_examples") or []) >= 7
    chooser = next(section["diagram"] for section in t1["explanation_sections"] if section["heading"] == "Substitution")
    assert chooser.get("title")
    t1_questions = " ".join(example["question"] for example in t1["additional_worked_examples"]).lower()
    assert any(section["heading"] == "Inverse trigonometric functions" for section in t1["explanation_sections"])
    for required in ("tan^2x", "cot^2x", "6x", "cos^{-1}", "principal ranges", "partial fractions", "xe^x"):
        assert required in t1_questions

    t2 = lessons["QCAA_SPECIALIST_U4_T2"]
    assert len(t2.get("additional_worked_examples") or []) >= 7
    t2_questions = " ".join(example["question"] for example in t2["additional_worked_examples"]).lower()
    for required in ("about the $x$-axis", "about the $y$-axis", "simpson", "90th percentile", "survived 2 hours", "sec^2x"):
        assert required in t2_questions
    assert all(
        section["diagram"].get("title")
        for section in t2["explanation_sections"]
        if section.get("diagram")
    )

    t3 = lessons["QCAA_SPECIALIST_U4_T3"]
    assert {"QCAA_METHODS_U3_T1", "QCAA_METHODS_U3_T2", "QCAA_METHODS_U3_T3"} <= set(t3.get("prerequisite_topics") or [])
    slope = next(section["diagram"] for section in t3["explanation_sections"] if section["heading"] == "Slope fields")
    assert slope.get("type") == "slope_field"
    assert slope.get("equilibria") == [0, 4]
    assert len(t3.get("additional_worked_examples") or []) >= 10
    t3_questions = " ".join(example["question"] for example in t3["additional_worked_examples"]).lower()
    for required in ("surface area", "x^2+xy+y^2", "cone", "square pyramid", "equilibrium solution", "1-p/1000", "cools", "half-life"):
        assert required in t3_questions

    t4 = lessons["QCAA_SPECIALIST_U4_T4"]
    assert "QCAA_SPECIALIST_U3_T4" in (t4.get("prerequisite_topics") or [])
    incline = next(section["diagram"] for section in t4["explanation_sections"] if section["heading"] == "Vertical motion, resistance and inclines")
    assert incline.get("right_angles") and incline.get("angle_arcs")
    directed_labels = {segment.get("label") for segment in incline.get("segments") or [] if segment.get("directed")}
    assert {"mg", "mg sin θ", "mg cos θ", "R"} <= directed_labels
    assert len(t4.get("additional_worked_examples") or []) >= 8
    t4_questions = " ".join(example["question"] for example in t4["additional_worked_examples"]).lower()
    for required in ("impulse", "non-constant force", "a=4x", "show that", "projected vertically", "terminal speed", "smooth $30"):
        assert required in t4_questions

    t5 = lessons["QCAA_SPECIALIST_U4_T5"]
    assert {"QCAA_METHODS_U4_T3", "QCAA_METHODS_U4_T4", "QCAA_METHODS_U4_T5"} <= set(t5.get("prerequisite_topics") or [])
    assert any(section["heading"] == "Repeated sampling and sample size" for section in t5["explanation_sections"])
    coverage = next(section["diagram"] for section in t5["explanation_sections"] if section["heading"] == "Confidence intervals for a mean")
    assert coverage.get("type") == "confidence_intervals"
    assert len(coverage.get("intervals") or []) >= 5
    assert len(t5.get("additional_worked_examples") or []) >= 7
    t5_questions = " ".join(example["question"] for example in t5["additional_worked_examples"]).lower()
    for required in ("normal population", "non-normal population", "standardised statistic", "90% and 99%", "repeated-sampling", "individual normal values"):
        assert required in t5_questions

    diagrams = [
        section["diagram"]
        for lesson in lessons.values()
        for section in lesson["explanation_sections"]
        if section.get("diagram")
    ]
    assert len(diagrams) == 17
    assert all(diagram.get("title") for diagram in diagrams)


# ---------------------------------------------------------------------------
# 2. Exercise-bank auditor
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SpecialistBankQualityReport:
    name: str
    issues: dict[str, list[str]]

    @property
    def has_issues(self) -> bool:
        return any(self.issues.values())

    def summary(self) -> str:
        if not self.has_issues:
            return f"{self.name}: OK"
        counts = ", ".join(
            f"{code}={len(items)}"
            for code, items in sorted(self.issues.items())
            if items
        )
        return f"{self.name}: {counts}"

    def details(self, *, limit: int = 20) -> str:
        lines = [self.summary()]
        for code, items in sorted(self.issues.items()):
            if not items:
                continue
            shown = ", ".join(items[:limit])
            suffix = "" if len(items) <= limit else f", ... +{len(items) - limit}"
            lines.append(f"  {code}: {shown}{suffix}")
        return "\n".join(lines)


def _audit_bank(items: list[dict[str, Any]], *, name: str = "bank") -> SpecialistBankQualityReport:
    issues: dict[str, list[str]] = defaultdict(list)
    ids = Counter(str(ex.get("id", "")) for ex in items)
    questions = Counter(str(ex.get("question", "")) for ex in items)
    linked_counts: Counter[str] = Counter()
    difficulty_counts: Counter[str] = Counter()

    for ex in items:
        ex_id = str(ex.get("id", "unknown"))
        question = str(ex.get("question", ""))
        answer = str(ex.get("answer", ""))
        topic_ids = [str(tid) for tid in ex.get("topic_ids") or []]

        if len(question.strip()) < 5:
            issues["empty_question"].append(ex_id)
        if not answer.strip() and ex.get("question_type") != "multi_part":
            issues["empty_answer"].append(ex_id)

        # Framework / subject / unit routing for senior Specialist.
        if ex.get("framework") != "QCAA_SENIOR_MATHS":
            issues["bad_framework"].append(ex_id)
        if ex.get("subject") != "specialist":
            issues["bad_subject"].append(ex_id)
        if ex.get("unit") not in EXPECTED_UNITS:
            issues["bad_unit"].append(f"{ex_id}:{ex.get('unit')}")
        if ex.get("year_level") is not None:
            issues["senior_has_year_level"].append(ex_id)

        for topic_id in topic_ids:
            linked_counts[topic_id] += 1
            if topic_id not in EXPECTED_TOPIC_IDS:
                issues["unknown_topic_id"].append(f"{ex_id}:{topic_id}")

        difficulty = ex.get("difficulty")
        complexity = ex.get("complexity")
        if difficulty in VALID_DIFFICULTY:
            difficulty_counts[difficulty] += 1
        else:
            issues["invalid_difficulty"].append(f"{ex_id}:{difficulty}")
        if complexity not in VALID_COMPLEXITY:
            issues["missing_or_invalid_complexity"].append(f"{ex_id}:{complexity}")
        if (str(difficulty), str(complexity)) in FORBIDDEN_DIFFICULTY_COMPLEXITY:
            issues["difficulty_complexity_conflict"].append(
                f"{ex_id}:{difficulty}+{complexity}"
            )

        # technology_active tagging supports Paper 1 / Paper 2 balance.
        meta = ex.get("math_metadata") or {}
        if meta.get("technology_active") is None:
            issues["missing_technology_active"].append(ex_id)

        searchable = json.dumps(ex, ensure_ascii=False)
        for pattern in BAD_CONTENT_PATTERNS:
            if pattern.search(searchable):
                issues["template_or_meta_text"].append(ex_id)
                break

        _audit_question_type(ex, issues)

    for ex_id, count in ids.items():
        if count > 1:
            issues["duplicate_id"].append(ex_id)
    for question, count in questions.items():
        if question and count > 1:
            issues["duplicate_question"].append(question[:80])

    # Coverage: every curriculum topic of a unit the bank touches must be
    # exercised (keeps a partial U3-U4-first bank green while enforcing full
    # coverage of whatever units are present).
    units_present = {
        int(m.group(1))
        for ex in items
        for tid in (str(t) for t in ex.get("topic_ids") or [])
        if (m := TOPIC_ID_PATTERN.match(tid))
    }
    for topic_id in sorted(EXPECTED_TOPIC_IDS):
        unit = int(TOPIC_ID_PATTERN.match(topic_id).group(1))
        if unit in units_present and linked_counts[topic_id] == 0:
            issues["topic_not_covered"].append(topic_id)

    # Difficulty ladder + no single band dominating.
    missing_ladder = REQUIRED_DIFFICULTY_LADDER - set(difficulty_counts)
    if missing_ladder:
        issues["difficulty_ladder_incomplete"].append(",".join(sorted(missing_ladder)))
    total = len(items)
    if total:
        for band, count in difficulty_counts.items():
            if count / total > MAX_DIFFICULTY_SHARE:
                issues["difficulty_band_dominates"].append(f"{band}:{count}/{total}")

    _audit_template_signatures(items, issues)

    return SpecialistBankQualityReport(name=name, issues=dict(issues))


def _question_skeleton(question: str) -> str:
    """Normalise a question to its template skeleton: strip digits so that a
    parameterised generator collapses to one shared skeleton, while genuinely
    distinct hand-authored stems stay distinct."""
    s = re.sub(r"\d+", "#", str(question))
    return re.sub(r"\s+", " ", s).strip().lower()


_audit_question_type = partial(
    _shared_audit_question_type,
    min_reasoning_key_points=MIN_REASONING_KEY_POINTS,
    min_reasoning_score=MIN_REASONING_SCORE,
    min_multi_part_marks=MIN_MULTI_PART_MARKS,
)
_audit_template_signatures = partial(
    _shared_audit_template_signatures,
    question_skeleton=_question_skeleton,
    min_diversity_sample=MIN_DIVERSITY_SAMPLE,
    min_content_diversity=MIN_CONTENT_DIVERSITY,
    max_boilerplate_share=MAX_BOILERPLATE_SHARE,
)


def _discover_specialist_banks() -> list[Path]:
    return sorted(DATA_DIR.glob("exercise_specialist*.json"))


def test_specialist_bank_hard_gates() -> None:
    banks = _discover_specialist_banks()
    if not banks:
        pytest.skip("no specialist exercise bank yet (Phase S3)")
    failing = [
        report.details()
        for report in (
            _audit_bank(_load_json(path), name=path.name) for path in banks
        )
        if report.has_issues
    ]
    assert not failing, "\n\n".join(failing)


# ---------------------------------------------------------------------------
# 3. Auditor self-check
# ---------------------------------------------------------------------------


def _clean_item(idx: int, topic_id: str, *, qtype: str = "short_answer", **overrides) -> dict[str, Any]:
    unit = int(TOPIC_ID_PATTERN.match(topic_id).group(1))
    stems = [
        f"Evaluate the expression in question {idx} for {topic_id}.",
        f"Find the exact value requested in problem {idx} ({topic_id}).",
        f"Determine the result for item {idx} drawn from {topic_id}.",
        f"Solve the {topic_id} task numbered {idx} and state the value.",
    ]
    item: dict[str, Any] = {
        "id": f"specialist_clean_{idx:03d}",
        "topic": "specialist practice",
        "question": stems[idx % len(stems)],
        "answer": f"Answer {idx}",
        "steps": ["step one", "step two"],
        "framework": "QCAA_SENIOR_MATHS",
        "topic_ids": [topic_id],
        "subject": "specialist",
        "difficulty": "developing",
        "unit": unit,
        "year_level": None,
        "question_type": qtype,
        "complexity": "complex_familiar",
        "math_metadata": {"technology_active": idx % 2 == 0},
    }
    item.update(overrides)
    return item


def _clean_bank() -> list[dict[str, Any]]:
    bank: list[dict[str, Any]] = []
    idx = 0
    ladder = ["foundational", "developing", "extending"]
    complexity_for = {
        "foundational": "simple_familiar",
        "developing": "complex_familiar",
        "extending": "complex_unfamiliar",
    }
    for topic_id in sorted(EXPECTED_TOPIC_IDS):
        for d in ladder:
            idx += 1
            bank.append(_clean_item(idx, topic_id, difficulty=d, complexity=complexity_for[d]))
    return bank


def test_specialist_bank_audit_machinery() -> None:
    """A clean synthetic bank passes; deliberately broken items get flagged."""
    clean_report = _audit_bank(_clean_bank(), name="clean")
    assert not clean_report.has_issues, clean_report.details()

    broken = _clean_bank()
    broken[0]["framework"] = "AC9_MATHS"
    broken[0]["subject"] = "math"
    broken[0]["unit"] = 7
    broken[0]["year_level"] = 11
    broken[1]["topic_ids"] = ["QCAA_SPECIALIST_U9_T9"]
    broken[2]["difficulty"] = "foundational"
    broken[2]["complexity"] = "complex_unfamiliar"
    broken[3]["difficulty"] = "impossible"
    broken[4]["math_metadata"] = {}
    broken[5]["question"] = "TODO: write this question"
    broken[6]["question_type"] = "multiple_choice"
    broken[6]["choices"] = ["1", "2", "3"]
    broken[6]["correct_choice"] = "Z"
    broken[7]["question_type"] = "reasoning"
    broken[7]["rubric"] = {"key_points": ["x"], "max_score": 1}
    broken[7]["sample_reasoning"] = ""
    broken[8]["question"] = ""
    broken[9]["id"] = broken[8]["id"]

    report = _audit_bank(broken, name="broken")
    for expected_code in (
        "bad_framework",
        "bad_subject",
        "bad_unit",
        "senior_has_year_level",
        "unknown_topic_id",
        "difficulty_complexity_conflict",
        "invalid_difficulty",
        "missing_technology_active",
        "template_or_meta_text",
        "mc_invalid_key",
        "reasoning_weak_rubric",
        "reasoning_missing_sample",
        "empty_question",
        "duplicate_id",
    ):
        assert report.issues.get(expected_code), (
            f"auditor failed to flag {expected_code}; report: {report.summary()}"
        )


def test_specialist_bank_auditor_flags_uncovered_topic() -> None:
    bank = [ex for ex in _clean_bank() if ex["topic_ids"] != ["QCAA_SPECIALIST_U4_T5"]]
    report = _audit_bank(bank, name="missing_topic")
    assert "QCAA_SPECIALIST_U4_T5" in report.issues.get("topic_not_covered", [])


def test_specialist_bank_auditor_flags_templated_mcq() -> None:
    bank: list[dict[str, Any]] = []
    for idx in range(MIN_DIVERSITY_SAMPLE + 4):
        bank.append(
            _clean_item(
                idx,
                "QCAA_SPECIALIST_U1_T1",
                qtype="multiple_choice",
                choices=["A) right", "B) canned", "C) canned", "D) canned"],
                correct_choice="A",
                answer="A) right",
            )
        )
    report = _audit_bank(bank, name="templated_mcq")
    assert report.issues.get("templated_low_choiceset_diversity")
    assert report.issues.get("templated_boilerplate_distractor")


def test_specialist_bank_auditor_flags_templated_short_answer() -> None:
    bank = [
        _clean_item(idx, "QCAA_SPECIALIST_U1_T1",
                    question=f"Differentiate y = {idx}x and state the result.",
                    answer=str(idx))
        for idx in range(MIN_DIVERSITY_SAMPLE + 4)
    ]
    report = _audit_bank(bank, name="templated_short")
    assert report.issues.get("templated_dominant_question_stem"), report.summary()
