"""Quality gates for QCAA Mathematical Methods content.

Two layers run here:

1.  **Curriculum spine** (``test_methods_curriculum_spine``) — validates the
    authored ``methods.json`` slice: 20 topics across 4 units × 5, well-formed
    ``QCAA_METHODS_U<u>_T<t>`` ids, and a usable concept card (worked example +
    lesson content) on every topic. This passes today and protects the
    self-study spine built in Phase 2.

2.  **Exercise bank** (``test_methods_bank_hard_gates``) — a data-driven audit
    modelled on ``test_science_bank_quality.py``. It discovers any
    ``exercise_methods*.json`` bank and gates it on coverage, MCQ integrity,
    reasoning/multi-part depth, difficulty/complexity coherence, and
    anti-template signatures. Until the Phase 4 bank lands the gate skips, but
    ``test_methods_bank_audit_machinery`` proves the auditor actually catches
    the defects it claims to, using synthetic banks.
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
METHODS_CURRICULUM = DATA_DIR / "curriculum" / "qcaa_senior_maths" / "methods.json"

EXPECTED_UNITS = (1, 2, 3, 4)
TOPICS_PER_UNIT = 5
EXPECTED_TOPIC_IDS = {
    f"QCAA_METHODS_U{u}_T{t}"
    for u in EXPECTED_UNITS
    for t in range(1, TOPICS_PER_UNIT + 1)
}
TOPIC_ID_PATTERN = re.compile(r"^QCAA_METHODS_U([1-4])_T([1-5])$")

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


def test_methods_curriculum_spine() -> None:
    """The authored Methods slice must be a complete, well-formed self-study spine."""
    slice_file = _load_json(METHODS_CURRICULUM)
    assert slice_file.get("framework_id") == "QCAA_SENIOR_MATHS"

    topics = slice_file.get("topics") or []
    topic_ids = [t.get("topic_id") for t in topics]

    assert len(topics) == 20, f"expected 20 topics, found {len(topics)}"
    assert set(topic_ids) == EXPECTED_TOPIC_IDS, (
        f"topic_id set mismatch: missing {sorted(EXPECTED_TOPIC_IDS - set(topic_ids))}, "
        f"unexpected {sorted(set(topic_ids) - EXPECTED_TOPIC_IDS)}"
    )
    assert len(set(topic_ids)) == len(topic_ids), "duplicate topic_ids in methods.json"

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
        assert topic.get("syllabus_subject") == "methods", f"{topic_id}: wrong subject"
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


def test_methods_unit2_curriculum_repair_gates() -> None:
    """Protect the full Unit 2 syllabus, self-study and boundary repairs."""
    slice_file = _load_json(METHODS_CURRICULUM)
    unit2 = {
        topic["topic_id"]: topic
        for topic in slice_file["topics"]
        if topic.get("syllabus_subject") == "methods" and topic.get("unit") == 2
    }
    assert set(unit2) == {f"QCAA_METHODS_U2_T{i}" for i in range(1, 6)}

    lessons = {
        topic_id: topic["concept_card"]["lesson_content"]
        for topic_id, topic in unit2.items()
    }
    assert lessons["QCAA_METHODS_U2_T1"]["prerequisite_topics"] == ["QCAA_METHODS_U1_T3"]
    assert slice_file["sequence"]["prerequisites"]["QCAA_METHODS_U2_T1"] == ["QCAA_METHODS_U1_T3"]
    for topic_id, lesson in lessons.items():
        assert lesson.get("prerequisite_topics") is not None, f"{topic_id}: missing prerequisites"

    t1 = lessons["QCAA_METHODS_U2_T1"]
    assert len(t1.get("additional_worked_examples") or []) >= 3
    assert sum("number $e$" in section["heading"].lower() for section in t1["explanation_sections"]) <= 1

    t2 = lessons["QCAA_METHODS_U2_T2"]
    assert len(t2.get("additional_worked_examples") or []) >= 3
    inverse_graph = t2["explanation_sections"][0]["diagram"]
    assert inverse_graph.get("equal_scale") is True
    assert inverse_graph["x_max"] - inverse_graph["x_min"] == inverse_graph["y_max"] - inverse_graph["y_min"]
    transformed_log = next(
        section for section in t2["explanation_sections"]
        if section["heading"] == "Transformed logarithmic functions"
    )["diagram"]
    assert any(abs(point.get("x", 0) - 1.25) < 1e-9 and point.get("y") == 0 for point in transformed_log["points"])

    t3 = lessons["QCAA_METHODS_U2_T3"]
    assert len(t3.get("additional_worked_examples") or []) >= 3
    assert sum(bool(section.get("diagram")) for section in t3["explanation_sections"]) >= 2

    t4 = lessons["QCAA_METHODS_U2_T4"]
    t4_text = json.dumps(t4, ensure_ascii=False).lower()
    assert "acceleration" not in t4_text
    assert "second derivative" not in t4_text
    assert len(t4.get("additional_worked_examples") or []) >= 3
    quartic = next(
        section for section in t4["explanation_sections"]
        if section["heading"] == "Global extrema and end behaviour"
    )["diagram"]
    assert sum(point.get("label") == "global min" for point in quartic["points"]) == 2

    t5 = lessons["QCAA_METHODS_U2_T5"]
    rule_table = next(
        section for section in t5["explanation_sections"]
        if section["heading"] == "Product and quotient rules"
    )["diagram"]
    assert rule_table.get("title") == "Choosing and applying differentiation rules"


def test_methods_unit3_curriculum_repair_gates() -> None:
    """Protect Unit 3 syllabus boundaries, worked depth and diagram repairs."""
    slice_file = _load_json(METHODS_CURRICULUM)
    unit3 = {
        topic["topic_id"]: topic
        for topic in slice_file["topics"]
        if topic.get("syllabus_subject") == "methods" and topic.get("unit") == 3
    }
    assert set(unit3) == {f"QCAA_METHODS_U3_T{i}" for i in range(1, 6)}
    assert unit3["QCAA_METHODS_U3_T2"]["name"] == (
        "Differentiation of trigonometric functions and differentiation rules"
    )

    lessons = {
        topic_id: topic["concept_card"]["lesson_content"]
        for topic_id, topic in unit3.items()
    }
    expected_prerequisites = {
        "QCAA_METHODS_U3_T1": ["QCAA_METHODS_U2_T2", "QCAA_METHODS_U2_T5"],
        "QCAA_METHODS_U3_T2": ["QCAA_METHODS_U3_T1"],
        "QCAA_METHODS_U3_T3": ["QCAA_METHODS_U3_T2"],
        "QCAA_METHODS_U3_T4": ["QCAA_METHODS_U3_T2"],
        "QCAA_METHODS_U3_T5": ["QCAA_METHODS_U1_T5"],
    }
    for topic_id, prerequisites in expected_prerequisites.items():
        assert lessons[topic_id]["prerequisite_topics"] == prerequisites
        assert slice_file["sequence"]["prerequisites"][topic_id] == prerequisites
    assert slice_file["sequence"]["prerequisites"]["QCAA_METHODS_U4_T1"] == [
        "QCAA_METHODS_U3_T4"
    ]

    t1 = lessons["QCAA_METHODS_U3_T1"]
    assert len(t1.get("additional_worked_examples") or []) >= 3
    limit_section = next(
        section for section in t1["explanation_sections"]
        if section["heading"] == "Why the base $e$ is special"
    )
    assert limit_section["diagram"]["type"] == "data_table"
    inverse_graph = next(
        section for section in t1["explanation_sections"]
        if section["heading"] == "The logarithm graph and inverse relationship"
    )["diagram"]
    assert inverse_graph.get("equal_scale") is True
    assert inverse_graph["x_max"] - inverse_graph["x_min"] == inverse_graph["y_max"] - inverse_graph["y_min"]
    assert any("x<-3" in example.get("answer", "") for example in t1["additional_worked_examples"])

    t2 = lessons["QCAA_METHODS_U3_T2"]
    t2_text = json.dumps(t2, ensure_ascii=False).lower()
    assert "sec^{2}" not in t2_text and "sec^2" not in t2_text
    assert len(t2.get("additional_worked_examples") or []) >= 4
    assert any(section["heading"] == "Cosine and the minus sign" for section in t2["explanation_sections"])
    assert any("tide" in example.get("question", "").lower() for example in t2["additional_worked_examples"])

    t3 = lessons["QCAA_METHODS_U3_T3"]
    assert len(t3.get("additional_worked_examples") or []) >= 3
    assert sum(bool(section.get("diagram")) for section in t3["explanation_sections"]) >= 3
    assert any("acceleration" in example.get("question", "").lower() for example in t3["additional_worked_examples"])
    assert any("key features" in example.get("question", "").lower() for example in t3["additional_worked_examples"])

    t4 = lessons["QCAA_METHODS_U3_T4"]
    t4_text = json.dumps(t4, ensure_ascii=False).lower()
    for forbidden in ("unit 4 preview", "signed area", "fundamental theorem", "f(b)-f(a)"):
        assert forbidden not in t4_text
    assert all("definite" not in section["heading"].lower() for section in t4["explanation_sections"])
    assert len(t4.get("additional_worked_examples") or []) >= 3
    reverse_chain = next(
        section for section in t4["explanation_sections"]
        if section["heading"] == "Integrating a linear inner function"
    )
    assert reverse_chain["diagram"]["title"] == "Reverse-chain antiderivatives"

    t5 = lessons["QCAA_METHODS_U3_T5"]
    assert len(t5.get("additional_worked_examples") or []) >= 5
    assert any(section["heading"] == "Relative-frequency point estimates" for section in t5["explanation_sections"])
    binomial = next(
        section for section in t5["explanation_sections"]
        if section["heading"] == "The binomial distribution"
    )["diagram"]
    assert binomial["type"] == "simple_bar_chart"
    assert any("at most 2" in example.get("question", "").lower() for example in t5["additional_worked_examples"])
    assert any("bernoulli" in example.get("question", "").lower() for example in t5["additional_worked_examples"])


def test_methods_unit4_curriculum_repair_gates() -> None:
    """Protect Unit 4 syllabus boundaries, statistical accuracy and diagram depth."""
    slice_file = _load_json(METHODS_CURRICULUM)
    unit4 = {
        topic["topic_id"]: topic
        for topic in slice_file["topics"]
        if topic.get("syllabus_subject") == "methods" and topic.get("unit") == 4
    }
    assert set(unit4) == {f"QCAA_METHODS_U4_T{i}" for i in range(1, 6)}

    lessons = {
        topic_id: topic["concept_card"]["lesson_content"]
        for topic_id, topic in unit4.items()
    }
    expected_prerequisites = {
        "QCAA_METHODS_U4_T1": ["QCAA_METHODS_U3_T4"],
        "QCAA_METHODS_U4_T2": ["QCAA_METHODS_U1_T4"],
        "QCAA_METHODS_U4_T3": ["QCAA_METHODS_U4_T1", "QCAA_METHODS_U3_T5"],
        "QCAA_METHODS_U4_T4": ["QCAA_METHODS_U3_T5"],
        "QCAA_METHODS_U4_T5": ["QCAA_METHODS_U4_T4"],
    }
    for topic_id, prerequisites in expected_prerequisites.items():
        assert lessons[topic_id]["prerequisite_topics"] == prerequisites
        assert slice_file["sequence"]["prerequisites"][topic_id] == prerequisites

    t1_topic = unit4["QCAA_METHODS_U4_T1"]
    t1 = lessons["QCAA_METHODS_U4_T1"]
    assert "substitution" not in t1_topic["skills"]
    assert "integrate_exp_log_trig" not in t1_topic["skills"]
    assert len(t1.get("additional_worked_examples") or []) >= 4
    riemann = next(section for section in t1["explanation_sections"] if section["heading"] == "Riemann sums and the definite integral")
    assert riemann["diagram"]["type"] == "data_table"
    area_graph = next(section for section in t1["explanation_sections"] if section["heading"] == "Area between curves")["diagram"]
    assert area_graph["shaded"][0].get("to_fn") == 1
    assert any("total distance" in example["question"].lower() for example in t1["additional_worked_examples"])

    t2 = lessons["QCAA_METHODS_U4_T2"]
    assert len(t2.get("additional_worked_examples") or []) >= 4
    modelling = next(section for section in t2["explanation_sections"] if "three-dimensional" in section["heading"].lower())
    assert modelling["diagram"]["type"] == "right_triangle"
    assert any("bearing" in example["question"].lower() for example in t2["additional_worked_examples"])
    assert any("platform" in example["question"].lower() for example in t2["additional_worked_examples"])

    t3_topic = unit4["QCAA_METHODS_U4_T3"]
    t3 = lessons["QCAA_METHODS_U4_T3"]
    assert "empirical_rule" not in t3_topic["skills"]
    assert "empirical rule" not in json.dumps(t3, ensure_ascii=False).lower()
    assert len(t3.get("additional_worked_examples") or []) >= 5
    pdf = next(section for section in t3["explanation_sections"] if section["heading"] == "PDFs, CDFs and continuous moments")["diagram"]
    assert "0<=x<=1" in pdf["functions"][0]["expression"]
    assert any(section["heading"] == "Cumulative distribution function" for section in t3["explanation_sections"])
    assert any("var" in example["question"].lower() for example in t3["additional_worked_examples"])

    t4_topic = unit4["QCAA_METHODS_U4_T4"]
    t4 = lessons["QCAA_METHODS_U4_T4"]
    worked_text = json.dumps(t4_topic["concept_card"]["worked_example"], ensure_ascii=False).lower()
    assert "population" in worked_text and "estimated standard error" in worked_text
    repeated = next(section for section in t4["explanation_sections"] if section["heading"] == "Repeated sampling and standardisation")
    assert repeated["diagram"]["type"] == "simple_bar_chart"
    assert len(t4.get("additional_worked_examples") or []) >= 3
    assert any("standardised sample proportion" in example["question"].lower() for example in t4["additional_worked_examples"])

    t5 = lessons["QCAA_METHODS_U4_T5"]
    assert len(t5.get("additional_worked_examples") or []) >= 3
    conditions = next(section for section in t5["explanation_sections"] if section["heading"] == "Interval estimates and conditions")
    assert conditions["diagram"]["type"] == "data_table"
    repeated_ci = next(section for section in t5["explanation_sections"] if section["heading"] == "Confidence, sample size and variation")
    assert repeated_ci["diagram"]["type"] == "confidence_intervals"
    assert any("90%" in example["question"] and "99%" in example["question"] for example in t5["additional_worked_examples"])


# ---------------------------------------------------------------------------
# 2. Exercise-bank auditor
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class MethodsBankQualityReport:
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


def _audit_bank(items: list[dict[str, Any]], *, name: str = "bank") -> MethodsBankQualityReport:
    issues: dict[str, list[str]] = defaultdict(list)
    ids = Counter(str(ex.get("id", "")) for ex in items)
    questions = Counter(str(ex.get("question", "")) for ex in items)
    linked_counts: Counter[str] = Counter()
    difficulty_counts: Counter[str] = Counter()
    tech_active_present = 0

    for ex in items:
        ex_id = str(ex.get("id", "unknown"))
        question = str(ex.get("question", ""))
        answer = str(ex.get("answer", ""))
        topic_ids = [str(tid) for tid in ex.get("topic_ids") or []]

        if len(question.strip()) < 5:
            issues["empty_question"].append(ex_id)
        if not answer.strip() and ex.get("question_type") != "multi_part":
            issues["empty_answer"].append(ex_id)

        # Framework / subject / unit routing for senior Methods.
        if ex.get("framework") != "QCAA_SENIOR_MATHS":
            issues["bad_framework"].append(ex_id)
        if ex.get("subject") != "methods":
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
        else:
            tech_active_present += 1

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

    # Coverage: every curriculum topic of a unit that the bank touches must be
    # exercised. This keeps a partial bank (e.g. Units 3-4 authored first)
    # green while still demanding full coverage of whatever units are present.
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

    return MethodsBankQualityReport(name=name, issues=dict(issues))


def _question_skeleton(question: str) -> str:
    """Normalise a question to its template skeleton: strip digits so that a
    parameterised generator ('Differentiate y=3x^2' / '...5x^2 ...') collapses
    to a single shared skeleton, while genuinely distinct hand-authored stems
    stay distinct. This is the meaningful anti-template signal for maths, where
    legitimately different questions often share a short numeric answer."""
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


def _discover_methods_banks() -> list[Path]:
    return sorted(DATA_DIR.glob("exercise_methods*.json"))


def test_methods_bank_hard_gates() -> None:
    banks = _discover_methods_banks()
    if not banks:
        pytest.skip("no methods exercise bank yet (Phase 4)")
    failing = [
        report.details()
        for report in (
            _audit_bank(_load_json(path), name=path.name) for path in banks
        )
        if report.has_issues
    ]
    assert not failing, "\n\n".join(failing)


# ---------------------------------------------------------------------------
# 3. Auditor self-check — prove the gate catches defects before a real bank exists
# ---------------------------------------------------------------------------


def _clean_item(idx: int, topic_id: str, *, qtype: str = "short_answer", **overrides) -> dict[str, Any]:
    unit = int(TOPIC_ID_PATTERN.match(topic_id).group(1))
    # Vary the stem so the bank does not look like one reused template.
    stems = [
        f"Evaluate the expression in question {idx} for {topic_id}.",
        f"Find the exact value requested in problem {idx} ({topic_id}).",
        f"Determine the result for item {idx} drawn from {topic_id}.",
        f"Solve the {topic_id} task numbered {idx} and state the value.",
    ]
    item: dict[str, Any] = {
        "id": f"methods_clean_{idx:03d}",
        "topic": "methods practice",
        "question": stems[idx % len(stems)],
        "answer": f"Answer {idx}",
        "steps": ["step one", "step two"],
        "framework": "QCAA_SENIOR_MATHS",
        "topic_ids": [topic_id],
        "subject": "methods",
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
    """A small but structurally clean bank covering all 20 topics with a ladder."""
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
            bank.append(
                _clean_item(
                    idx,
                    topic_id,
                    difficulty=d,
                    complexity=complexity_for[d],
                )
            )
    return bank


def test_methods_bank_audit_machinery() -> None:
    """A clean synthetic bank passes; deliberately broken items get flagged."""
    clean = _clean_bank()
    clean_report = _audit_bank(clean, name="clean")
    assert not clean_report.has_issues, clean_report.details()

    # Now inject specific defects and confirm each is caught.
    broken = _clean_bank()
    # 1. wrong framework / subject / unit + year_level present
    broken[0]["framework"] = "AC9_MATHS"
    broken[0]["subject"] = "math"
    broken[0]["unit"] = 7
    broken[0]["year_level"] = 11
    # 2. unknown topic id
    broken[1]["topic_ids"] = ["QCAA_METHODS_U9_T9"]
    # 3. difficulty/complexity conflict
    broken[2]["difficulty"] = "foundational"
    broken[2]["complexity"] = "complex_unfamiliar"
    # 4. invalid difficulty
    broken[3]["difficulty"] = "impossible"
    # 5. missing technology_active flag
    broken[4]["math_metadata"] = {}
    # 6. template/meta text
    broken[5]["question"] = "TODO: write this question"
    # 7. broken MCQ (key out of range)
    broken[6]["question_type"] = "multiple_choice"
    broken[6]["choices"] = ["1", "2", "3"]
    broken[6]["correct_choice"] = "Z"
    # 8. weak reasoning rubric
    broken[7]["question_type"] = "reasoning"
    broken[7]["rubric"] = {"key_points": ["x"], "max_score": 1}
    broken[7]["sample_reasoning"] = ""
    # 9. empty question
    broken[8]["question"] = ""
    # 10. duplicate id
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


def test_methods_bank_auditor_flags_uncovered_topic() -> None:
    """Dropping every item for one topic must raise topic_not_covered."""
    bank = [ex for ex in _clean_bank() if ex["topic_ids"] != ["QCAA_METHODS_U4_T5"]]
    report = _audit_bank(bank, name="missing_topic")
    assert "QCAA_METHODS_U4_T5" in report.issues.get("topic_not_covered", [])


def test_methods_bank_auditor_flags_templated_mcq() -> None:
    """A bank of MCQs reusing one distractor set must trip the template gate."""
    bank: list[dict[str, Any]] = []
    for idx in range(MIN_DIVERSITY_SAMPLE + 4):
        bank.append(
            _clean_item(
                idx,
                "QCAA_METHODS_U1_T1",
                qtype="multiple_choice",
                choices=["A) right", "B) canned", "C) canned", "D) canned"],
                correct_choice="A",
                answer="A) right",
            )
        )
    report = _audit_bank(bank, name="templated_mcq")
    assert report.issues.get("templated_low_choiceset_diversity")
    assert report.issues.get("templated_boilerplate_distractor")


def test_methods_bank_auditor_flags_templated_short_answer() -> None:
    """A bank of short-answers built from one reused parameterised stem must
    trip the dominant-question-stem gate, even though the numbers differ."""
    bank = [
        _clean_item(idx, "QCAA_METHODS_U1_T1",
                    question=f"Differentiate y = {idx}x and state the result.",
                    answer=str(idx))
        for idx in range(MIN_DIVERSITY_SAMPLE + 4)
    ]
    report = _audit_bank(bank, name="templated_short")
    assert report.issues.get("templated_dominant_question_stem"), report.summary()
