"""Quality gates for AC9 maths exercise banks.

Years 7, 8, 9 and 10 are all enforced as hard gates: any structural,
coverage, MCQ, reasoning, multi-part or diagram-rendering issue fails the
suite. (Year 8 was previously report-only while known gaps were closed; it now
passes cleanly and is gated like the others.)
"""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

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
MATH_YEARS = (7, 8, 9, 10)
HARD_GATE_YEARS = {7, 8, 9, 10}

YEAR_RULES = {
    7: {
        "min_topic_count": 5,
        "min_reasoning_key_points": 3,
        "min_reasoning_score": 3,
        # Canonical ExerciseItem contract: multipart items have at least two
        # parts. Larger assessment-policy targets remain advisories below.
        "min_multi_part_count": 2,
        "min_multi_part_marks": 2,
        "recommended_multi_part_count": 3,
        "recommended_multi_part_marks": 3,
    },
    8: {
        "min_topic_count": 5,
        "min_reasoning_key_points": 3,
        "min_reasoning_score": 3,
        "min_multi_part_count": 2,
        "min_multi_part_marks": 2,
        "recommended_multi_part_count": 3,
        "recommended_multi_part_marks": 3,
    },
    9: {
        "min_topic_count": 5,
        "min_reasoning_key_points": 4,
        "min_reasoning_score": 4,
        "min_multi_part_count": 2,
        "min_multi_part_marks": 2,
        "recommended_multi_part_count": 3,
        "recommended_multi_part_marks": 4,
    },
    10: {
        "min_topic_count": 5,
        "min_reasoning_key_points": 4,
        "min_reasoning_score": 4,
        "min_multi_part_count": 2,
        "min_multi_part_marks": 2,
        "recommended_multi_part_count": 3,
        "recommended_multi_part_marks": 4,
    },
}

# Difficulty (pedagogical ladder) and complexity (QCE cognitive demand) are two
# axes that must stay internally coherent. These pairs are contradictory: a tag
# that is simultaneously "stretch" on one axis and "routine" on the other.
VALID_DIFFICULTY = {"foundational", "developing", "extending", "AMC"}
VALID_COMPLEXITY = {"simple_familiar", "complex_familiar", "complex_unfamiliar"}
FORBIDDEN_DIFFICULTY_COMPLEXITY = {
    ("foundational", "complex_familiar"),
    ("foundational", "complex_unfamiliar"),
    ("extending", "simple_familiar"),
    ("AMC", "simple_familiar"),
    ("AMC", "complex_familiar"),
}
# Every year's bank must offer a real difficulty ladder, and no single band may
# swamp the bank (which would defeat adaptive selection).
REQUIRED_DIFFICULTY_LADDER = {"foundational", "developing", "extending"}
MAX_DIFFICULTY_SHARE = 0.85

GEOMETRY_VISUAL_PREFIXES = ("AC9M7M04", "AC9M7M05", "AC9M7SP")
BAD_CONTENT_PATTERNS = (
    re.compile(r"\bTODO\b", re.IGNORECASE),
    re.compile(r"\bTEMPLATE\b", re.IGNORECASE),
    re.compile(r"as an ai", re.IGNORECASE),
    re.compile(r"explain or justify the following", re.IGNORECASE),
    re.compile(r"\{\{[^}]+\}\}"),
)
MIN_CONTENT_DIVERSITY = 0.5
MAX_BOILERPLATE_SHARE = 0.5
MIN_DIVERSITY_SAMPLE = 20
GENERIC_RUBRIC_FILLER = {
    "Uses correct method.",
    "Uses an appropriate method.",
    "Shows working.",
    "Gives the correct answer.",
    "Explains reasoning clearly.",
}


@dataclass(frozen=True)
class MathBankQualityReport:
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


def _part_labels_in_text(value: Any) -> set[str]:
    return {
        match.group(1).lower()
        for match in re.finditer(r"(?:^|[\s\n])([a-e])\)", str(value), re.IGNORECASE)
    }


def _answer_has_part_label(answer: Any, label: str) -> bool:
    return bool(
        re.search(
            rf"(?:^|[\s;,\n]){re.escape(label)}\s*[\):]",
            str(answer),
            re.IGNORECASE,
        )
    )


def _math_curriculum_topics(year: int) -> set[str]:
    curriculum = _load_json(DATA_DIR / "curriculum" / "ac9_maths" / f"year{year}.json")
    return {topic["topic_id"] for topic in curriculum.get("topics", [])}


def _audit_year(year: int) -> MathBankQualityReport:
    raw_exercises = _load_json(DATA_DIR / f"exercise_{year}_math.json")
    exercises = [
        ex for ex in raw_exercises
        if isinstance(ex, dict) and ex.get("status", "active") == "active"
    ]
    curriculum_topics = _math_curriculum_topics(year)
    rules = YEAR_RULES[year]

    issues: dict[str, list[str]] = defaultdict(list)
    advisories: dict[str, list[str]] = defaultdict(list)
    ids = Counter(str(ex.get("id", "")) for ex in exercises)
    questions = Counter()
    question_fingerprints: dict[str, set[str]] = defaultdict(set)
    topic_counts: Counter[str] = Counter()
    difficulty_counts: Counter[str] = Counter()

    for ex in exercises:
        ex_id = str(ex.get("id", "unknown"))
        question = str(ex.get("question", ""))
        answer = str(ex.get("answer", ""))
        question_key = _duplicate_key(question)
        if question_key:
            questions[question_key] += 1
            question_fingerprints[question_key].add(_duplicate_fingerprint(ex))
        topic_ids = [str(tid) for tid in ex.get("topic_ids") or []]

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

        searchable = json.dumps(ex, ensure_ascii=False)
        for pattern in BAD_CONTENT_PATTERNS:
            if pattern.search(searchable):
                issues["template_or_meta_text"].append(ex_id)
                break

        for topic_id in topic_ids:
            topic_counts[topic_id] += 1
            if topic_id not in curriculum_topics:
                issues["unknown_topic_id"].append(f"{ex_id}:{topic_id}")

        question_type = ex.get("question_type")
        if question_type == "multiple_choice":
            _audit_multiple_choice(ex, issues, advisories)
        elif question_type == "short_answer" and year == 7:
            _audit_short_answer(ex, issues)
        elif question_type == "reasoning":
            _audit_reasoning(ex, issues, rules)
        elif question_type == "multi_part":
            _audit_multi_part(ex, issues, rules, advisories)
        _audit_rubric_quality(ex, issues, advisories)

        _audit_diagram(ex, issues)
        if year == 7 and _needs_geometry_visual(ex) and not _has_visual_resource(ex):
            issues["geometry_space_missing_diagram"].append(ex_id)

    for ex_id, count in ids.items():
        if count > 1:
            issues["duplicate_id"].append(ex_id)
    for question, count in questions.items():
        if question and count > 1:
            if len(question_fingerprints[question]) == 1:
                issues["duplicate_question"].append(question[:80])
            else:
                # Same stem with different parameters, answers, steps, or
                # representations is a review signal, not an exact duplicate.
                advisories["duplicate_question_variant"].append(question[:80])
    for topic_id in sorted(curriculum_topics):
        if topic_counts[topic_id] < rules["min_topic_count"]:
            issues["topic_under_minimum"].append(f"{topic_id}:{topic_counts[topic_id]}")

    _audit_difficulty_distribution(difficulty_counts, len(exercises), issues)
    _audit_template_signatures(exercises, issues)

    return MathBankQualityReport(
        year=year,
        issues=dict(issues),
        advisories=dict(advisories),
    )


def _audit_difficulty_distribution(
    difficulty_counts: Counter[str],
    total: int,
    issues: dict[str, list[str]],
) -> None:
    missing_ladder = REQUIRED_DIFFICULTY_LADDER - set(difficulty_counts)
    if missing_ladder:
        issues["difficulty_ladder_incomplete"].append(",".join(sorted(missing_ladder)))
    if total:
        for band, count in difficulty_counts.items():
            if count / total > MAX_DIFFICULTY_SHARE:
                issues["difficulty_band_dominates"].append(f"{band}:{count}/{total}")


def _audit_multiple_choice(
    ex: dict[str, Any],
    issues: dict[str, list[str]],
    advisories: dict[str, list[str]],
) -> None:
    ex_id = str(ex.get("id", "unknown"))
    choices = ex.get("choices") or []
    correct_choice = ex.get("correct_choice")
    if not isinstance(choices, list) or len(choices) < 2 or not correct_choice:
        issues["mc_missing_choices_or_key"].append(ex_id)
        return
    choice_keys = {str(choice).strip().casefold() for choice in choices}
    if len(choices) != len(choice_keys):
        issues["mc_duplicate_choices"].append(ex_id)

    # Visible A./B. prefixes are a presentation convention, not part of the
    # canonical schema. Keep the signal as an advisory so symbol-only or
    # dynamically labelled options remain valid MCQs.
    visible_labels = []
    for idx, choice in enumerate(choices):
        match = re.match(r"^\s*([A-Z])\s*[\).:-]", str(choice), re.IGNORECASE)
        if not match:
            advisories["mc_choice_label_missing"].append(f"{ex_id}:{idx}")
            continue
        visible_labels.append(match.group(1).upper())
    expected_labels = [chr(ord("A") + i) for i in range(len(choices))]
    if visible_labels and visible_labels != expected_labels:
        advisories["mc_choice_label_order"].append(ex_id)

    if not isinstance(correct_choice, str) or len(correct_choice.strip()) != 1:
        issues["mc_invalid_key"].append(ex_id)
        return
    key = correct_choice.strip().upper()
    index = ord(key) - ord("A")
    if not ("A" <= key <= "Z") or index < 0 or index >= len(choices):
        issues["mc_invalid_key"].append(ex_id)
        return
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


def _audit_short_answer(
    ex: dict[str, Any],
    issues: dict[str, list[str]],
) -> None:
    ex_id = str(ex.get("id", "unknown"))
    question_part_labels = _part_labels_in_text(ex.get("question", ""))
    if not question_part_labels:
        return
    missing = sorted(
        label
        for label in question_part_labels
        if not _answer_has_part_label(ex.get("answer", ""), label)
    )
    if missing:
        issues["short_answer_missing_part_answers"].append(
            f"{ex_id}:{','.join(missing)}"
        )


def _audit_reasoning(
    ex: dict[str, Any],
    issues: dict[str, list[str]],
    rules: dict[str, int],
) -> None:
    ex_id = str(ex.get("id", "unknown"))
    rubric = ex.get("rubric") or {}
    key_points = rubric.get("key_points") or []
    if (
        len(key_points) < rules["min_reasoning_key_points"]
        or int(rubric.get("max_score") or 0) < rules["min_reasoning_score"]
    ):
        issues["reasoning_weak_rubric"].append(ex_id)
    if not str(ex.get("sample_reasoning", "")).strip():
        issues["reasoning_missing_sample"].append(ex_id)


def _audit_multi_part(
    ex: dict[str, Any],
    issues: dict[str, list[str]],
    rules: dict[str, int],
    advisories: dict[str, list[str]] | None = None,
) -> None:
    ex_id = str(ex.get("id", "unknown"))
    sub_parts = ex.get("sub_parts") or []
    if len(sub_parts) < rules["min_multi_part_count"]:
        issues["multipart_too_short"].append(ex_id)

    def part_score(part: Any) -> float:
        if not isinstance(part, dict):
            return 0.0
        raw_score = part.get("max_score")
        if raw_score is None:
            raw_score = part.get("marks", 1)
        try:
            return float(raw_score)
        except (TypeError, ValueError):
            return 0.0

    total_marks = sum(part_score(part) for part in sub_parts)
    if total_marks < rules["min_multi_part_marks"]:
        issues["multipart_low_marks"].append(ex_id)
    if advisories is not None:
        if len(sub_parts) < rules["recommended_multi_part_count"]:
            advisories["multipart_below_recommended_parts"].append(
                f"{ex_id}:{len(sub_parts)}"
            )
        if total_marks < rules["recommended_multi_part_marks"]:
            advisories["multipart_below_recommended_marks"].append(
                f"{ex_id}:{total_marks:g}"
            )
    for idx, part in enumerate(sub_parts):
        if not isinstance(part, dict) or not all(
            part.get(key) for key in ("label", "question", "answer")
        ):
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
    for rubric in rubrics:
        if any(str(text).strip() in GENERIC_RUBRIC_FILLER for text in _walk_strings(rubric)):
            issues["generic_rubric_filler"].append(ex_id)
            break
    if (
        ex.get("difficulty") in {"extending", "AMC"}
        and ex.get("question_type") in {"short_answer", "reasoning", "multi_part"}
        and not re.search(
            r"\b(justify|explain|prove|model|compare|interpret|reason|strategy|derive|investigate|evaluate)\b",
            str(ex.get("question", "")),
            re.IGNORECASE,
        )
    ):
        advisories["extension_prompt_may_be_low_rigor"].append(ex_id)


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
    if diagram_type == "data_table" and not (diagram.get("headers") or diagram.get("rows")):
        issues["diagram_empty_table"].append(ex_id)
    if diagram_type == "number_line" and diagram.get("max", 1) <= diagram.get("min", 0):
        issues["diagram_bad_number_line_range"].append(ex_id)
    if diagram_type == "function_graph" and not (diagram.get("functions") or diagram.get("points")):
        issues["diagram_empty_function_graph"].append(ex_id)


def _image_reference_exists(value: Any) -> bool:
    """Check local image references without rejecting URLs or identifiers."""
    reference = str(value or "").strip()
    if not reference:
        return False
    if reference.startswith(("http://", "https://", "data:")):
        return True
    # A non-path identifier can still be resolved by the frontend asset layer;
    # only path-like references are required to exist on disk in this gate.
    if "/" not in reference and "\\" not in reference and not Path(reference).suffix:
        return True
    relative = reference.lstrip("/")
    candidates = (
        REPO_ROOT / relative,
        REPO_ROOT / "frontend" / "public" / relative,
    )
    return any(path.is_file() and path.stat().st_size > 0 for path in candidates)


def _has_visual_resource(ex: dict[str, Any]) -> bool:
    if ex.get("diagram_data") or str(ex.get("diagram_description") or "").strip():
        return True
    if _image_reference_exists(ex.get("image")):
        return True
    for part in ex.get("sub_parts") or []:
        if not isinstance(part, dict):
            continue
        if part.get("diagram_data") or str(part.get("diagram_description") or "").strip():
            return True
        if _image_reference_exists(part.get("image")):
            return True
    return False


def _needs_geometry_visual(ex: dict[str, Any]) -> bool:
    topic_ids = [str(topic_id) for topic_id in ex.get("topic_ids") or []]
    if not any(topic_id.startswith(GEOMETRY_VISUAL_PREFIXES) for topic_id in topic_ids):
        return False

    # Geometry topics contain many self-contained symbolic questions.  A visual
    # is required only when the stem explicitly refers to an external display;
    # merely belonging to a geometry topic is not enough.
    question = str(ex.get("question", ""))
    return bool(re.search(
        r"\b(?:shown|provided|displayed)\s+(?:in|on|below)\s+(?:the\s+)?(?:table|diagram|figure|grid)\b"
        r"|\b(?:table|diagram|figure|grid)\s+(?:below|above|provided)\b",
        question,
        re.IGNORECASE,
    ))


def _duplicate_key(question: str) -> str:
    """Normalise a stem for duplicate detection."""
    unwrapped = re.sub(r"(?<!\\)\$\s*(-?\d[\d,]*(?:\.\d+)?)\s*\$", r"\1", question)
    return re.sub(r"\s+", " ", unwrapped).strip()


def _duplicate_fingerprint(ex: dict[str, Any]) -> str:
    """Fingerprint an item's content while ignoring identity metadata.

    A repeated stem with different parameters, answers, steps, sub-parts, or
    media is a review signal rather than an exact duplicate.
    """
    def normalise(value: Any, *, root: bool = False) -> Any:
        if isinstance(value, dict):
            return {
                key: normalise(child)
                for key, child in sorted(value.items())
                if not (root and key in {"id", "status"})
            }
        if isinstance(value, list):
            return [normalise(child) for child in value]
        if isinstance(value, str):
            return _duplicate_key(value).casefold()
        return value

    payload = normalise(ex, root=True)
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)


def _question_skeleton(question: str) -> str:
    skeleton = re.sub(r"\d+(?:\.\d+)?", "#", str(question).lower())
    skeleton = re.sub(r"\$[^$]*\$", "MATH", skeleton)
    return re.sub(r"\s+", " ", skeleton).strip()


def _audit_template_signatures(
    exercises: list[dict[str, Any]],
    issues: dict[str, list[str]],
) -> None:
    by_type: dict[Any, list[dict[str, Any]]] = defaultdict(list)
    for ex in exercises:
        by_type[ex.get("question_type")].append(ex)

    mcq = by_type.get("multiple_choice", [])
    if len(mcq) >= MIN_DIVERSITY_SAMPLE:
        choice_sets = {
            tuple(sorted(str(choice) for choice in ex.get("choices") or []))
            for ex in mcq
        }
        if len(choice_sets) / len(mcq) < MIN_CONTENT_DIVERSITY:
            issues["templated_low_choiceset_diversity"].append(
                f"{len(choice_sets)}/{len(mcq)}"
            )
        distractors: Counter[str] = Counter()
        for ex in mcq:
            key = str(ex.get("correct_choice") or "").upper()
            for idx, choice in enumerate(ex.get("choices") or []):
                if chr(ord("A") + idx) != key:
                    distractors[str(choice)] += 1
        if distractors:
            _, top_count = distractors.most_common(1)[0]
            if top_count / len(mcq) > MAX_BOILERPLATE_SHARE:
                issues["templated_boilerplate_distractor"].append(
                    f"{top_count}/{len(mcq)}"
                )

    for question_type in ("short_answer", "multi_part"):
        items = by_type.get(question_type, [])
        if len(items) >= MIN_DIVERSITY_SAMPLE:
            skeletons = Counter(
                _question_skeleton(str(ex.get("question", ""))) for ex in items
            )
            _, top_count = skeletons.most_common(1)[0]
            if top_count / len(items) > MAX_BOILERPLATE_SHARE:
                issues["templated_dominant_question_stem"].append(
                    f"{question_type}:{top_count}/{len(items)}"
                )


def test_math_bank_quality_report_all_years() -> None:
    """The auditor runs for every maths year and returns well-formed reports.

    Guards the audit machinery itself: every year must produce a report whose
    ``issues`` is a mapping of known issue codes to lists of string offenders.
    """
    reports = [_audit_year(year) for year in MATH_YEARS]
    assert [report.year for report in reports] == list(MATH_YEARS)
    for report in reports:
        for mapping in (report.issues, report.advisories):
            assert isinstance(mapping, dict)
            for code, offenders in mapping.items():
                assert isinstance(code, str) and code, report.summary()
                assert isinstance(offenders, list), report.summary()
                assert all(isinstance(item, str) for item in offenders), report.summary()


def test_math_bank_hard_gates() -> None:
    reports = [_audit_year(year) for year in MATH_YEARS]
    hard_failures = [
        report.details()
        for report in reports
        if report.year in HARD_GATE_YEARS and report.has_issues
    ]
    assert not hard_failures, "\n\n".join(hard_failures)


def test_math_auditor_flags_template_generic_rubric_and_missing_mc_feedback() -> None:
    issues: dict[str, list[str]] = defaultdict(list)
    advisories: dict[str, list[str]] = defaultdict(list)

    templated_mc = [
        {
            "id": f"mc_{idx}",
            "question_type": "multiple_choice",
            "question": f"What is {idx} + 1?",
            "answer": "A",
            "choices": ["A) correct", "B) common error", "C) common error", "D) common error"],
            "correct_choice": "A",
        }
        for idx in range(MIN_DIVERSITY_SAMPLE + 2)
    ]
    _audit_template_signatures(templated_mc, issues)
    assert issues["templated_low_choiceset_diversity"]
    assert issues["templated_boilerplate_distractor"]

    _audit_multiple_choice(templated_mc[0], issues, advisories)
    assert advisories["mc_missing_explanation_feedback"]

    generic_rubric_item = {
        "id": "generic_rubric",
        "question_type": "reasoning",
        "difficulty": "developing",
        "question": "Explain the strategy.",
        "rubric": {"key_points": ["Shows working."], "max_score": 3},
    }
    _audit_rubric_quality(generic_rubric_item, issues, advisories)
    assert issues["generic_rubric_filler"]

    part_rubric_item = {
        "id": "generic_part_rubric",
        "question_type": "multi_part",
        "difficulty": "developing",
        "question": "Calculate both values.",
        "sub_parts": [
            {"label": "a", "question": "2 + 2", "answer": "4", "rubric": {"key_points": ["Shows working."]}},
            {"label": "b", "question": "3 + 3", "answer": "6"},
        ],
    }
    _audit_rubric_quality(part_rubric_item, issues, advisories)
    assert "generic_part_rubric" in issues["generic_rubric_filler"]

def test_geometry_visual_gate_requires_explicit_visual_reference() -> None:
    assert not _needs_geometry_visual({
        "topic_ids": ["AC9M7M05"],
        "question": "A triangle has angles 50 degrees and 60 degrees. Find the third angle.",
    })
    assert _needs_geometry_visual({
        "topic_ids": ["AC9M7SP02"],
        "question": "A quadrilateral has the properties shown in the table. Classify it.",
    })
    assert not _needs_geometry_visual({
        "topic_ids": ["AC9M7SP02"],
        "question": "A quadrilateral has four equal sides. Name the shape.",
    })


def test_geometry_visual_gate_accepts_media_description_and_existing_image() -> None:
    assert _has_visual_resource({"diagram_description": "A labelled quadrilateral."})
    assert _has_visual_resource({"image": "labelled_quadrilateral_diagram"})
    assert not _has_visual_resource({"image": "/images/missing.svg"})


def test_dynamic_mcq_symbol_answer_uses_letter_key() -> None:
    issues: dict[str, list[str]] = defaultdict(list)
    advisories: dict[str, list[str]] = defaultdict(list)
    item = {
        "id": "symbol_mcq",
        "question_type": "multiple_choice",
        "answer": "C",
        "correct_choice": "C",
        "choices": ["A) <", "B) >", "C) ="],
    }
    _audit_multiple_choice(item, issues, advisories)
    assert not issues["mc_answer_mismatch"]


def test_two_part_multipart_is_canonical_but_policy_advisory() -> None:
    issues: dict[str, list[str]] = defaultdict(list)
    advisories: dict[str, list[str]] = defaultdict(list)
    item = {
        "id": "two_part",
        "sub_parts": [
            {"label": "a", "question": "2 + 2", "answer": "4", "marks": 1},
            {"label": "b", "question": "3 + 3", "answer": "6", "marks": 1},
        ],
    }
    _audit_multi_part(item, issues, YEAR_RULES[7], advisories)
    assert not issues["multipart_too_short"]
    assert not issues["multipart_low_marks"]
    assert advisories["multipart_below_recommended_parts"]
    assert advisories["multipart_below_recommended_marks"]
