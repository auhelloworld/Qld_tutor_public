"""Quality gates for AC9 Science exercise banks.

The auditor is **data-driven**: it discovers every ``exercise_{year}_science.json``
bank that has a matching AC9 science curriculum (years 7-10) and audits each one.
Whenever a new year's bank is authored it is picked up and gated automatically —
no edit to this file is needed. A year can be parked in ``REPORT_ONLY_YEARS``
while known gaps are being closed; everything else is a hard gate.

Senior QCAA science (biology/chemistry/physics/psychology) uses a different
curriculum shape and is intentionally out of scope here until senior banks exist.
"""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic import ValidationError
from core.schema.exercise_schema import ExerciseItem
from core.algorithms.science_complexity import assess_science_complexity
from scripts.check_exercises import SUPPORTED_DIAGRAM_TYPES
from tests.unit._bank_audit_helpers import (
    answer_matches_choice as _answer_matches_choice,
    load_json as _load_json,
    normalise_alphanum as _normalise_text,
    strip_choice_prefix as _strip_choice_prefix,
    walk_strings as _walk_strings,
)


REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
SCIENCE_CURRICULUM_DIR = DATA_DIR / "curriculum" / "ac9_science"

# Years parked as report-only while a freshly authored bank is being cleaned up.
# Everything discovered and not listed here is enforced as a hard gate.
REPORT_ONLY_YEARS: set[int] = set()

CANONICAL_STRANDS = {
    "Science Understanding",
    "Science Inquiry",
    "Science as a Human Endeavour",
}
VISUAL_REPRESENTATIONS = {"table", "graph", "diagram"}

# Difficulty (pedagogical ladder) and complexity (QCE cognitive demand) must stay
# internally coherent; these pairs contradict each other.
VALID_DIFFICULTY = {"foundational", "developing", "extending"}
VALID_COMPLEXITY = {"simple_familiar", "complex_familiar", "complex_unfamiliar"}
FORBIDDEN_DIFFICULTY_COMPLEXITY = {
    ("foundational", "complex_familiar"),
    ("foundational", "complex_unfamiliar"),
    ("extending", "simple_familiar"),
}
REQUIRED_DIFFICULTY_LADDER = {"foundational", "developing", "extending"}
MAX_DIFFICULTY_SHARE = 0.85

# Template-generation signatures. A combinatorial generator (scenario × stem ×
# concept) betrays itself through low content diversity and reused boilerplate.
# Thresholds are set far from a legitimately authored bank: Year 7 sits at
# ~100% choice-set/answer diversity and 0 canned verdicts, whereas the
# machine-generated Year 8 draft sat at 16-37% diversity with a single
# distractor reused in 100% of MCQs and a canned CER verdict in 99% of items.
MIN_CONTENT_DIVERSITY = 0.5      # distinct / total floor for choices & free-text answers
MAX_BOILERPLATE_SHARE = 0.5      # a single distractor / hollow answer must not dominate
MIN_DIVERSITY_SAMPLE = 20        # only judge diversity when there are enough items
HOLLOW_ANSWER_PATTERNS = (
    re.compile(r"a cer response should", re.IGNORECASE),
    re.compile(r"give a concise exam answer", re.IGNORECASE),
    re.compile(r"should evaluate the claim using", re.IGNORECASE),
    re.compile(r"state one observation that would", re.IGNORECASE),
)

BAD_CONTENT_PATTERNS = (
    re.compile(r"\bTODO\b", re.IGNORECASE),
    re.compile(r"\bTEMPLATE\b", re.IGNORECASE),
    re.compile(r"\bTBD\b", re.IGNORECASE),
    re.compile(r"as an ai", re.IGNORECASE),
    re.compile(r"lorem ipsum", re.IGNORECASE),
    re.compile(r"\{\{[^}]+\}\}"),
)
GENERIC_RUBRIC_FILLER = {
    "Uses evidence.",
    "Uses relevant evidence.",
    "Explains scientifically.",
    "Gives a correct answer.",
    "Explains reasoning clearly.",
}
CER_PROMPT_RE = re.compile(r"\b(CER|claim|evidence|reasoning)\b", re.IGNORECASE)

# Per-year thresholds. Reasoning expectations rise in Years 9-10 (mirrors the
# maths gate). Anything not listed falls back to ``_DEFAULT_RULES``.
_DEFAULT_RULES = {
    "min_topic_linked": 8,
    "min_topic_primary": 3,
    "min_she_primary": 8,
    "min_she_total": 40,
    "min_reasoning_key_points": 3,
    "min_reasoning_score": 3,
    "min_multi_part_count": 3,
    "min_multi_part_marks": 4,
}
YEAR_RULES: dict[int, dict[str, int]] = {
    7: {**_DEFAULT_RULES},
    8: {**_DEFAULT_RULES},
    9: {**_DEFAULT_RULES, "min_reasoning_key_points": 4, "min_reasoning_score": 4},
    10: {**_DEFAULT_RULES, "min_reasoning_key_points": 4, "min_reasoning_score": 4},
}


def _rules_for(year: int) -> dict[str, int]:
    return YEAR_RULES.get(year, _DEFAULT_RULES)


def _discover_years() -> list[int]:
    """Years with BOTH an exercise bank and an AC9 science curriculum."""
    years: list[int] = []
    for path in sorted(DATA_DIR.glob("exercise_*_science.json")):
        match = re.fullmatch(r"exercise_(\d+)_science\.json", path.name)
        if not match:
            continue
        year = int(match.group(1))
        if (SCIENCE_CURRICULUM_DIR / f"year{year}.json").exists():
            years.append(year)
    return years


@dataclass(frozen=True)
class ScienceBankQualityReport:
    year: int
    issues: dict[str, list[str]]
    advisories: dict[str, list[str]] = field(default_factory=dict)

    @property
    def has_issues(self) -> bool:
        return any(self.issues.values())

    def _fmt(self, mapping: dict[str, list[str]]) -> str:
        return ", ".join(
            f"{code}={len(items)}"
            for code, items in sorted(mapping.items())
            if items
        )

    def summary(self) -> str:
        if not self.has_issues:
            base = f"Year {self.year}: OK"
        else:
            base = f"Year {self.year}: {self._fmt(self.issues)}"
        advisories = self._fmt(self.advisories)
        return base + (f"  [advisory: {advisories}]" if advisories else "")

    def details(self, *, limit: int = 8) -> str:
        lines = [self.summary()]
        for code, items in sorted(self.issues.items()):
            if not items:
                continue
            shown = ", ".join(items[:limit])
            suffix = "" if len(items) <= limit else f", ... +{len(items) - limit}"
            lines.append(f"  {code}: {shown}{suffix}")
        return "\n".join(lines)


def _curriculum_topics(year: int) -> dict[str, dict[str, Any]]:
    curriculum = _load_json(SCIENCE_CURRICULUM_DIR / f"year{year}.json")
    return {topic["topic_id"]: topic for topic in curriculum.get("topics", [])}


def _audit_year(year: int) -> ScienceBankQualityReport:
    exercises = _load_json(DATA_DIR / f"exercise_{year}_science.json")
    topics = _curriculum_topics(year)
    rules = _rules_for(year)

    issues: dict[str, list[str]] = defaultdict(list)
    advisories: dict[str, list[str]] = defaultdict(list)
    ids = Counter(str(ex.get("id", "")) for ex in exercises)
    questions = Counter(str(ex.get("question", "")) for ex in exercises)
    linked_counts: Counter[str] = Counter()
    primary_counts: Counter[str] = Counter()
    she_total = 0
    difficulty_counts: Counter[str] = Counter()

    for ex in exercises:
        ex_id = str(ex.get("id", "unknown"))
        question = str(ex.get("question", ""))
        answer = str(ex.get("answer", ""))
        topic_ids = [str(tid) for tid in ex.get("topic_ids") or []]
        primary = topic_ids[0] if topic_ids else ""

        try:
            ExerciseItem.model_validate(ex)
        except ValidationError as exc:
            issues["canonical_schema_validation"].append(
                f"{ex_id}:{exc.errors(include_url=False)[0].get('msg', 'invalid item')}"
            )
        if primary:
            primary_counts[primary] += 1

        if len(question.strip()) < 5:
            issues["empty_question"].append(ex_id)
        if not answer.strip():
            issues["empty_answer"].append(ex_id)

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

        complexity_assessment = assess_science_complexity(ex)
        if complexity_assessment.status == "unsupported":
            advisories["complex_unfamiliar_unsupported"].append(ex_id)
        elif complexity_assessment.status == "review":
            advisories["complexity_requires_review"].append(ex_id)
        elif complexity_assessment.status == "review_understated":
            advisories["complexity_may_be_understated"].append(ex_id)

        searchable = json.dumps(ex, ensure_ascii=False)
        for pattern in BAD_CONTENT_PATTERNS:
            if pattern.search(searchable):
                issues["template_or_meta_text"].append(ex_id)
                break

        for topic_id in topic_ids:
            linked_counts[topic_id] += 1
            if topic_id not in topics:
                issues["unknown_topic_id"].append(f"{ex_id}:{topic_id}")

        if primary.startswith(f"AC9S{year}H"):
            she_total += 1

        if ex.get("framework") != "AC9_SCIENCE":
            issues["bad_framework"].append(ex_id)
        if ex.get("subject") != "science":
            issues["bad_subject"].append(ex_id)
        if ex.get("year_level") != year:
            issues["bad_year_level"].append(ex_id)

        metadata = ex.get("science_metadata") or {}
        if metadata.get("strand") not in CANONICAL_STRANDS:
            issues["science_metadata_bad_strand"].append(ex_id)
        if (
            metadata.get("data_representation") in VISUAL_REPRESENTATIONS
            and not (ex.get("diagram_data") or ex.get("image"))
        ):
            issues["science_representation_missing_visual"].append(ex_id)

        _audit_question_type(ex, issues, advisories, rules)
        _audit_rubric_quality(ex, issues, advisories)
        _audit_diagram(ex, issues)

    for ex_id, count in ids.items():
        if count > 1:
            issues["duplicate_id"].append(ex_id)
    for question, count in questions.items():
        if question and count > 1:
            issues["duplicate_question"].append(question[:80])

    for topic_id in sorted(topics):
        if linked_counts[topic_id] < rules["min_topic_linked"]:
            issues["topic_linked_under_minimum"].append(f"{topic_id}:{linked_counts[topic_id]}")
        if primary_counts[topic_id] < rules["min_topic_primary"]:
            issues["topic_primary_under_minimum"].append(f"{topic_id}:{primary_counts[topic_id]}")
        if topic_id.startswith(f"AC9S{year}H") and primary_counts[topic_id] < rules["min_she_primary"]:
            issues["she_primary_under_minimum"].append(f"{topic_id}:{primary_counts[topic_id]}")

    if she_total < rules["min_she_total"]:
        issues["she_total_under_minimum"].append(str(she_total))

    missing_ladder = REQUIRED_DIFFICULTY_LADDER - set(difficulty_counts)
    if missing_ladder:
        issues["difficulty_ladder_incomplete"].append(",".join(sorted(missing_ladder)))
    total = len(exercises)
    if total:
        for band, count in difficulty_counts.items():
            if count / total > MAX_DIFFICULTY_SHARE:
                issues["difficulty_band_dominates"].append(f"{band}:{count}/{total}")

    _audit_template_signatures(exercises, issues)

    return ScienceBankQualityReport(
        year=year,
        issues=dict(issues),
        advisories=dict(advisories),
    )


def _audit_template_signatures(
    exercises: list[dict[str, Any]],
    issues: dict[str, list[str]],
) -> None:
    """Flag banks that look machine-generated from a fixed template."""
    by_type: dict[Any, list[dict[str, Any]]] = defaultdict(list)
    for ex in exercises:
        by_type[ex.get("question_type")].append(ex)

    mcq = by_type.get("multiple_choice", [])
    if len(mcq) >= MIN_DIVERSITY_SAMPLE:
        choice_sets = {tuple(sorted(str(c) for c in ex.get("choices") or [])) for ex in mcq}
        if len(choice_sets) / len(mcq) < MIN_CONTENT_DIVERSITY:
            issues["templated_low_choiceset_diversity"].append(f"{len(choice_sets)}/{len(mcq)}")
        distractors: Counter[str] = Counter()
        for ex in mcq:
            key = str(ex.get("correct_choice") or "").upper()
            for idx, choice in enumerate(ex.get("choices") or []):
                if chr(ord("A") + idx) != key:
                    distractors[str(choice)] += 1
        if distractors:
            _, top_count = distractors.most_common(1)[0]
            if top_count / len(mcq) > MAX_BOILERPLATE_SHARE:
                issues["templated_boilerplate_distractor"].append(f"{top_count}/{len(mcq)}")

    for qtype, field in (("short_answer", "answer"), ("multi_part", "answer"), ("reasoning", "sample_reasoning")):
        items = by_type.get(qtype, [])
        if len(items) >= MIN_DIVERSITY_SAMPLE:
            distinct = len({str(ex.get(field, "")) for ex in items})
            if distinct / len(items) < MIN_CONTENT_DIVERSITY:
                issues["templated_low_answer_diversity"].append(f"{qtype}:{distinct}/{len(items)}")

    reasoning = by_type.get("reasoning", [])
    if len(reasoning) >= MIN_DIVERSITY_SAMPLE:
        hollow = sum(
            1 for ex in reasoning
            if any(p.search(str(ex.get("answer", ""))) for p in HOLLOW_ANSWER_PATTERNS)
        )
        if hollow / len(reasoning) > MAX_BOILERPLATE_SHARE:
            issues["templated_hollow_reasoning_answers"].append(f"{hollow}/{len(reasoning)}")


def _audit_question_type(
    ex: dict[str, Any],
    issues: dict[str, list[str]],
    advisories: dict[str, list[str]],
    rules: dict[str, int],
) -> None:
    ex_id = str(ex.get("id", "unknown"))
    question_type = ex.get("question_type")
    if question_type == "multiple_choice":
        choices = ex.get("choices") or []
        key = str(ex.get("correct_choice") or "").upper()
        if len(choices) < 2 or len(key) != 1:
            issues["mc_missing_choices_or_key"].append(ex_id)
            return
        index = ord(key) - ord("A")
        if index < 0 or index >= len(choices):
            issues["mc_invalid_key"].append(ex_id)
            return
        if len(choices) != len(set(map(str, choices))):
            issues["mc_duplicate_choices"].append(ex_id)
        if not _answer_matches_choice(ex.get("answer", ""), choices[index], key):
            issues["mc_answer_mismatch"].append(ex_id)
        rubric = ex.get("rubric") if isinstance(ex.get("rubric"), dict) else {}
        feedback = rubric.get("distractor_feedback")
        expected_wrong = {chr(ord("A") + i) for i in range(len(choices))} - {key}
        if (
            not str(rubric.get("correct_explanation") or "").strip()
            or not isinstance(feedback, dict)
            or {str(option).upper() for option in feedback} != expected_wrong
        ):
            advisories["mc_missing_explanation_feedback"].append(ex_id)
    elif question_type == "reasoning":
        rubric = ex.get("rubric") or {}
        key_points = rubric.get("key_points") or []
        if (
            len(key_points) < rules["min_reasoning_key_points"]
            or int(rubric.get("max_score") or 0) < rules["min_reasoning_score"]
        ):
            issues["reasoning_weak_rubric"].append(ex_id)
        if not str(ex.get("sample_reasoning", "")).strip():
            issues["reasoning_missing_sample"].append(ex_id)
    elif question_type == "multi_part":
        sub_parts = ex.get("sub_parts") or []
        if len(sub_parts) < rules["min_multi_part_count"]:
            issues["multipart_too_short"].append(ex_id)
        total_marks = sum(int(part.get("marks", 1) or 1) for part in sub_parts)
        if total_marks < rules["min_multi_part_marks"]:
            issues["multipart_low_marks"].append(ex_id)
        for idx, part in enumerate(sub_parts):
            if not all(part.get(key) for key in ("label", "question", "answer")):
                issues["multipart_subpart_incomplete"].append(f"{ex_id}:{idx}")


def _audit_rubric_quality(
    ex: dict[str, Any],
    issues: dict[str, list[str]],
    advisories: dict[str, list[str]],
) -> None:
    ex_id = str(ex.get("id", "unknown"))
    rubrics = [ex.get("rubric") if isinstance(ex.get("rubric"), dict) else {}]
    rubrics.extend(
        part.get("rubric")
        for part in (ex.get("sub_parts") or [])
        if isinstance(part, dict) and isinstance(part.get("rubric"), dict)
    )
    rubric_text = " ".join(
        text for rubric in rubrics for text in _walk_strings(rubric)
    )
    for rubric in rubrics:
        if any(str(text).strip() in GENERIC_RUBRIC_FILLER for text in _walk_strings(rubric)):
            issues["generic_rubric_filler"].append(ex_id)
            break
    if (
        ex.get("question_type") in {"reasoning", "multi_part"}
        and CER_PROMPT_RE.search(str(ex.get("question", "")))
    ):
        lowered = rubric_text.lower()
        if not all(term in lowered for term in ("claim", "evidence", "reason")):
            advisories["cer_rubric_missing_claim_evidence_reasoning"].append(ex_id)


def _audit_diagram(ex: dict[str, Any], issues: dict[str, list[str]]) -> None:
    ex_id = str(ex.get("id", "unknown"))
    diagram = ex.get("diagram_data")
    if not diagram:
        return
    if not isinstance(diagram, dict) or not diagram.get("type"):
        issues["diagram_missing_type"].append(ex_id)
        return
    diagram_type = str(diagram["type"])
    if diagram_type not in SUPPORTED_DIAGRAM_TYPES:
        issues["unsupported_diagram_type"].append(f"{ex_id}:{diagram_type}")
    if diagram_type == "data_table" and not (
        isinstance(diagram.get("headers"), list)
        and diagram.get("headers")
        and isinstance(diagram.get("rows"), list)
        and diagram.get("rows")
    ):
        issues["diagram_bad_data_table_shape"].append(ex_id)


def test_science_bank_quality_report_well_formed() -> None:
    """Guards the audit machinery: every discovered year yields a clean report shape."""
    years = _discover_years()
    assert years, "no AC9 science exercise banks discovered"
    for report in (_audit_year(year) for year in years):
        for mapping in (report.issues, report.advisories):
            assert isinstance(mapping, dict)
            for code, offenders in mapping.items():
                assert isinstance(code, str) and code, report.summary()
                assert isinstance(offenders, list), report.summary()
                assert all(isinstance(item, str) for item in offenders), report.summary()


def test_science_bank_hard_gates() -> None:
    failing = [
        report.details(limit=20)
        for report in (_audit_year(year) for year in _discover_years())
        if report.year not in REPORT_ONLY_YEARS and report.has_issues
    ]
    assert not failing, "\n\n".join(failing)


def test_science_auditor_flags_generic_rubric_mc_feedback_and_cer_gaps() -> None:
    issues: dict[str, list[str]] = defaultdict(list)
    advisories: dict[str, list[str]] = defaultdict(list)
    rules = _rules_for(7)

    mc_item = {
        "id": "science_mc_feedback_gap",
        "question_type": "multiple_choice",
        "question": "Which observation best supports the claim?",
        "answer": "A",
        "choices": ["A) correct observation", "B) misconception", "C) misconception", "D) misconception"],
        "correct_choice": "A",
    }
    _audit_question_type(mc_item, issues, advisories, rules)
    assert advisories["mc_missing_explanation_feedback"]

    generic_rubric_item = {
        "id": "science_generic_rubric",
        "question_type": "reasoning",
        "question": "Use claim, evidence and reasoning to explain the pattern.",
        "rubric": {"key_points": ["Uses evidence."], "max_score": 3},
        "sample_reasoning": "The pattern is explained by the evidence.",
    }
    _audit_rubric_quality(generic_rubric_item, issues, advisories)
    assert issues["generic_rubric_filler"]
    assert advisories["cer_rubric_missing_claim_evidence_reasoning"]

    part_rubric_item = {
        "id": "science_generic_part_rubric",
        "question_type": "multi_part",
        "question": "Complete both observations.",
        "sub_parts": [
            {
                "label": "a",
                "question": "Describe the first observation.",
                "answer": "The temperature rises.",
                "rubric": {"key_points": ["Uses evidence."]},
            },
            {"label": "b", "question": "Describe the second observation.", "answer": "The temperature falls."},
        ],
    }
    _audit_rubric_quality(part_rubric_item, issues, advisories)
    assert "science_generic_part_rubric" in issues["generic_rubric_filler"]
