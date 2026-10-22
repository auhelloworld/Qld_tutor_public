#!/usr/bin/env python3
"""Full quality audit for QCAA Senior Mathematical Methods and Specialist banks.

This is intentionally separate from ``audit_math_bank_full.py`` because the
senior banks use QCAA course/unit routing, Paper 1/Paper 2 technology tags, and
course-specific reasoning expectations rather than AC9 year-level metadata.

Usage:
  python scripts/audit_senior_math_bank_full.py --course methods
  python scripts/audit_senior_math_bank_full.py --course specialist --strict
  python scripts/audit_senior_math_bank_full.py --all --out audit_output
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

if str(Path(__file__).resolve().parents[1]) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pydantic import ValidationError
from core.schema.exercise_schema import ExerciseItem


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_DIR = ROOT / "data"
DEFAULT_OUT_DIR = ROOT / "audit_output"

COURSES = {
    "methods": {
        "label": "Mathematical Methods",
        "topic_prefix": "QCAA_METHODS",
        "bank_glob": "exercise_methods*.json",
        "curriculum": "methods.json",
        "min_items_per_topic": 20,
        "min_reasoning_points": 3,
    },
    "specialist": {
        "label": "Specialist Mathematics",
        "topic_prefix": "QCAA_SPECIALIST",
        "bank_glob": "exercise_specialist*.json",
        "curriculum": "specialist.json",
        "min_items_per_topic": 12,
        "min_reasoning_points": 3,
    },
}

VALID_QTYPES = {"short_answer", "multiple_choice", "reasoning", "multi_part"}
VALID_DIFFICULTY = {"foundational", "developing", "extending", "AMC"}
VALID_COMPLEXITY = {"simple_familiar", "complex_familiar", "complex_unfamiliar"}
VALID_UNITS = {1, 2, 3, 4}
VALID_CHOICES = {"A", "B", "C", "D"}
PRIORITY_ORDER = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}

FORBIDDEN_DIFFICULTY_COMPLEXITY = {
    ("foundational", "complex_familiar"),
    ("foundational", "complex_unfamiliar"),
    ("extending", "simple_familiar"),
    ("AMC", "simple_familiar"),
    ("AMC", "complex_familiar"),
}

BAD_CONTENT_RE = re.compile(
    r"\b(TODO|TEMPLATE|TBD|FIXME|PLACEHOLDER|lorem ipsum|as an ai|\{\{[^}]+\}\})\b",
    re.I,
)
GENERIC_STEP_RE = re.compile(
    r"^\s*(state the formula|apply the formula|solve the problem|check your answer|"
    r"write the answer|use technology|simplify|calculate)\s*\.?\s*$",
    re.I,
)
EXACT_PROMPT_RE = re.compile(r"\b(exact|surd|simplify|rationalise|prove|show that|derive)\b", re.I)
DECIMAL_ANSWER_RE = re.compile(r"(?<![A-Za-z])[-+]?\d+\.\d+(?![A-Za-z])")
REASONING_VERB_RE = re.compile(r"\b(explain|justify|prove|show|derive|interpret|model|compare|evaluate|analyse|investigate)\b", re.I)
CALCULUS_RE = re.compile(r"\b(derivative|differentiat|integral|integrat|anti-derivative|rate of change|kinematics|normal|confidence interval|sampling)\b", re.I)
SENIOR_DEMAND_RE = re.compile(
    r"\b(maximum|minimum|optimis|area enclosed|between the curves|without replacement|gradient at|"
    r"momentarily at rest|margin of error|confidence interval|normal variable|binomial|"
    r"product rule|quotient rule|chain rule|antiderivative|integral|derivative|differentiat|"
    r"modelled|bounded by|conservative|sample size|inflection|solve)\b",
    re.I,
)
SPECIALIST_EXPRESSION_RE = re.compile(r"\b(complex|argand|matrix|matrices|vector|vectors?|induction|proof|differential equation)\b", re.I)
SPECIALIST_SCALAR_PROMPT_RE = re.compile(
    r"\b(magnitude|determinant|det\b|modulus|component|row sum|dominance score|first-age-class population)\b",
    re.I,
)
SCALAR_EXACT_ANSWER_RE = re.compile(
    r"^\s*(?:[-+]?\d+(?:\.\d+)?|sqrt\(\d+\)|\\sqrt\{\d+\}|[-+]?\d+\s*/\s*[-+]?\d+|\\frac\{[-+]?\d+\}\{[-+]?\d+\})\s*$",
    re.I,
)
GENERIC_RUBRIC_FILLER = {
    "show working.",
    "shows working.",
    "correct answer.",
    "gives a correct answer.",
    "uses correct method.",
    "explains reasoning clearly.",
}
RUBRIC_COVERAGE_STOP_WORDS = {
    "answer", "calculate", "correct", "determine", "equation", "explain",
    "given", "method", "part", "question", "result", "senior", "show",
    "solution", "student", "using", "value", "working",
}


@dataclass(frozen=True)
class Issue:
    exercise_id: str
    priority: str
    category: str
    code: str
    message: str
    evidence: str = ""
    recommended_fix: str = ""
    confidence: str = "high"


def load_json(path: Path) -> Any:
    raw = path.read_text(encoding="utf-8")
    if raw.startswith("\ufeff"):
        raw = raw[1:]
    return json.loads(raw)


def meta(ex: dict[str, Any]) -> dict[str, Any]:
    value = ex.get("math_metadata")
    return value if isinstance(value, dict) else {}


def norm_text(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value).lower())


def strip_choice_prefix(value: Any) -> str:
    return re.sub(r"^\s*[A-D]\s*[\).:-]\s*", "", str(value).strip())


def numeric_values(value: Any) -> list[float]:
    text = strip_choice_prefix(value)
    text = text.replace("$", " ").replace(",", "")
    values: list[float] = []
    for match in re.finditer(r"\\(?:d?frac)\{(-?\d+(?:\.\d+)?)\}\{(-?\d+(?:\.\d+)?)\}", text):
        try:
            denominator = float(match.group(2))
            if denominator != 0:
                values.append(float(match.group(1)) / denominator)
        except ValueError:
            pass
    cleaned = re.sub(r"\\(?:d?frac)\{[^}]+\}\{[^}]+\}", " ", text)
    for match in re.finditer(r"(?<![A-Za-z])[-+]?\d+(?:\.\d+)?(?![A-Za-z])", cleaned):
        try:
            values.append(float(match.group(0)))
        except ValueError:
            pass
    return values


def is_numeric_normalised(value: str) -> bool:
    return bool(value) and bool(re.fullmatch(r"[-+]?\d+(?:\.\d+)?", value))


def is_scalar_exact_answer(value: Any) -> bool:
    text = str(value).strip().replace("$", "")
    return bool(SCALAR_EXACT_ANSWER_RE.fullmatch(text))


def walk_strings(value: Any):
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from walk_strings(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from walk_strings(item)


def rubric_token_stem(token: str) -> str:
    """Normalise simple inflections for conservative rubric matching."""
    if token.endswith("ility") and len(token) > 7:
        return f"{token[:-5]}le"
    if token.endswith("ies") and len(token) > 5:
        return f"{token[:-3]}y"
    if token.endswith("ing") and len(token) > 7:
        return token[:-3]
    if token.endswith("ed") and len(token) > 6:
        return token[:-2]
    if token.endswith("es") and len(token) > 5:
        return token[:-2]
    if token.endswith("s") and not token.endswith("ss") and len(token) > 4:
        return token[:-1]
    return token


def rubric_coverage_tokens(value: Any) -> set[str]:
    plain = re.sub(r"\\[A-Za-z]+", " ", str(value or "")).lower()
    return {
        rubric_token_stem(token)
        for token in re.findall(r"[a-z]{4,}", plain)
        if token not in RUBRIC_COVERAGE_STOP_WORDS
    }


def rubric_coverage_numbers(value: Any) -> set[str]:
    return {
        token for token in re.findall(r"\d+(?:\.\d+)?", str(value or ""))
        if float(token) >= 2
    }


def rubric_is_generic(rubric: Any) -> bool:
    return isinstance(rubric, dict) and any(
        value.strip().lower() in GENERIC_RUBRIC_FILLER
        for value in walk_strings(rubric)
    )


def top_level_rubric_covers_subpart(ex: dict[str, Any], part: dict[str, Any]) -> bool:
    """Accept a root rubric only when a concrete criterion maps to this part."""
    rubric = ex.get("rubric")
    if not isinstance(rubric, dict) or rubric_is_generic(rubric):
        return False
    key_points = rubric.get("key_points")
    if not isinstance(key_points, list) or not key_points:
        return False

    part_context = "\n".join(
        str(part.get(field) or "") for field in ("question", "answer", "steps")
    )
    part_terms = rubric_coverage_tokens(part_context)
    part_numbers = rubric_coverage_numbers(part_context)
    for key_point in key_points:
        key_point_text = " ".join(walk_strings(key_point))
        if part_numbers & rubric_coverage_numbers(key_point_text):
            return True
        if len(part_terms & rubric_coverage_tokens(key_point_text)) >= 2:
            return True
    return False


def answer_matches_choice(answer: Any, choice: Any, key: str) -> bool:
    answer_s = str(answer).strip()
    if answer_s.upper() == key:
        return True
    if re.search(rf"\bchoice\s+{re.escape(key)}\b", answer_s, flags=re.I):
        return True
    answer_norm = norm_text(answer_s)
    stripped_choice = strip_choice_prefix(choice).rstrip(".")
    choice_norm = norm_text(stripped_choice)
    if not choice_norm:
        return False
    if answer_norm == choice_norm:
        return True
    if f"choice{key.lower()}iscorrect" in answer_norm or f"{key.lower()}iscorrect" in answer_norm:
        return True

    answer_numbers = numeric_values(answer_s)
    choice_numbers = numeric_values(stripped_choice)
    if len(answer_numbers) == 1 and len(choice_numbers) == 1:
        if abs(answer_numbers[0] - choice_numbers[0]) < 1e-9:
            return True
        return False

    # Allow explanatory answers to contain a substantial symbolic choice text,
    # but never use digit-only substrings: "15" must not match choice "5".
    if not is_numeric_normalised(choice_norm) and len(choice_norm) >= 3 and choice_norm in answer_norm:
        return True
    if not is_numeric_normalised(answer_norm) and len(answer_norm) >= 3 and answer_norm in choice_norm:
        return True
    return False


def load_curriculum(data_dir: Path, course: str) -> dict[str, dict[str, Any]]:
    cfg = COURSES[course]
    path = data_dir / "curriculum" / "qcaa_senior_maths" / str(cfg["curriculum"])
    data = load_json(path)
    topics = data.get("topics") or []
    return {str(topic.get("topic_id")): topic for topic in topics if topic.get("topic_id")}


def discover_banks(data_dir: Path, course: str) -> list[Path]:
    return sorted(data_dir.glob(str(COURSES[course]["bank_glob"])))


def load_bank_files(data_dir: Path, course: str) -> tuple[list[dict[str, Any]], list[Path]]:
    items: list[dict[str, Any]] = []
    paths = discover_banks(data_dir, course)
    for path in paths:
        loaded = load_json(path)
        if not isinstance(loaded, list):
            raise ValueError(f"{path} does not contain a JSON list")
        for item in loaded:
            if isinstance(item, dict):
                item = dict(item)
                item["_source_file"] = path.name
                items.append(item)
    return items, paths


def add_issue(
    issues: list[Issue],
    ex_id: str,
    priority: str,
    category: str,
    code: str,
    message: str,
    *,
    evidence: str = "",
    recommended_fix: str = "",
    confidence: str = "high",
) -> None:
    issues.append(Issue(ex_id, priority, category, code, message, evidence, recommended_fix, confidence))


def audit_item(ex: dict[str, Any], *, course: str, topics: dict[str, dict[str, Any]]) -> list[Issue]:
    issues: list[Issue] = []
    ex_id = str(ex.get("id") or "unknown")
    cfg = COURSES[course]

    # Keep this auditor tied to the runtime contract. Hand-written field checks
    # below provide friendlier messages, but cannot replace cross-field and
    # extra-field validation in the canonical model.
    try:
        ExerciseItem.model_validate({k: v for k, v in ex.items() if not k.startswith("_")})
    except ValidationError as exc:
        first = exc.errors()[0]
        location = ".".join(str(part) for part in first.get("loc", ())) or "item"
        add_issue(
            issues, ex_id, "P0", "schema", "canonical_schema_invalid",
            f"ExerciseItem validation failed at {location}: {first.get('msg', 'invalid value')}",
            evidence=f"{len(exc.errors())} canonical schema error(s).",
            recommended_fix="Conform the item to core.schema.exercise_schema.ExerciseItem.",
        )

    required = [
        "id", "topic", "question", "answer", "steps", "framework", "topic_ids",
        "subject", "difficulty", "unit", "question_type", "complexity", "math_metadata",
    ]
    for field in required:
        if field not in ex or ex.get(field) is None:
            add_issue(issues, ex_id, "P0", "schema", "missing_required_field", f"Missing required field: {field}.", recommended_fix=f"Add {field}.")

    if ex.get("framework") != "QCAA_SENIOR_MATHS":
        add_issue(issues, ex_id, "P0", "schema", "bad_framework", f"framework={ex.get('framework')!r}", recommended_fix="Set framework to QCAA_SENIOR_MATHS.")
    if ex.get("subject") != course:
        add_issue(issues, ex_id, "P0", "schema", "bad_subject", f"subject={ex.get('subject')!r}; expected {course}.", recommended_fix=f"Set subject to {course}.")
    if ex.get("year_level") is not None:
        add_issue(issues, ex_id, "P1", "schema", "senior_has_year_level", "Senior QCAA item should use unit, not year_level.", recommended_fix="Remove year_level or set it to null.")
    if ex.get("unit") not in VALID_UNITS:
        add_issue(issues, ex_id, "P0", "schema", "bad_unit", f"unit={ex.get('unit')!r}", recommended_fix="Use unit 1, 2, 3 or 4.")

    topic_ids = ex.get("topic_ids") or []
    if not isinstance(topic_ids, list) or not topic_ids:
        add_issue(issues, ex_id, "P0", "schema", "missing_topic_ids", "topic_ids is missing or empty.", recommended_fix="Add one valid senior maths topic id.")
    else:
        for topic_id in topic_ids:
            tid = str(topic_id)
            if tid not in topics:
                add_issue(issues, ex_id, "P1", "schema", "unknown_topic_id", f"{tid} is not in {course} curriculum.", recommended_fix="Use a valid topic id from the course curriculum.")
            if not tid.startswith(str(cfg["topic_prefix"])):
                add_issue(issues, ex_id, "P1", "schema", "topic_course_mismatch", f"{tid} does not match {cfg['topic_prefix']}.", recommended_fix="Move item to the correct course bank or correct topic_ids.")
            match = re.match(r"^QCAA_[A-Z]+_U([1-4])_T([1-5])$", tid)
            if match and ex.get("unit") in VALID_UNITS and int(match.group(1)) != ex.get("unit"):
                add_issue(issues, ex_id, "P1", "schema", "unit_topic_mismatch", f"unit={ex.get('unit')}, topic_id={tid}.", recommended_fix="Align unit field with topic_id.")

    qtype = str(ex.get("question_type") or "")
    if qtype not in VALID_QTYPES:
        add_issue(issues, ex_id, "P0", "schema", "bad_question_type", f"question_type={qtype!r}", recommended_fix="Use short_answer, multiple_choice, reasoning or multi_part.")

    difficulty = str(ex.get("difficulty") or "")
    complexity = str(ex.get("complexity") or "")
    if difficulty not in VALID_DIFFICULTY:
        add_issue(issues, ex_id, "P1", "schema", "bad_difficulty", f"difficulty={difficulty!r}", recommended_fix="Use foundational, developing, extending or AMC.")
    if complexity not in VALID_COMPLEXITY:
        add_issue(issues, ex_id, "P1", "schema", "bad_complexity", f"complexity={complexity!r}", recommended_fix="Use simple_familiar, complex_familiar or complex_unfamiliar.")
    if (difficulty, complexity) in FORBIDDEN_DIFFICULTY_COMPLEXITY:
        add_issue(issues, ex_id, "P2", "calibration", "difficulty_complexity_conflict", f"{difficulty}+{complexity}", recommended_fix="Align difficulty and complexity.")

    m = meta(ex)
    if not m:
        add_issue(issues, ex_id, "P1", "metadata", "missing_math_metadata", "math_metadata is missing or empty.", recommended_fix="Add technology_active, strand and skill.")
    else:
        if m.get("technology_active") is None:
            add_issue(issues, ex_id, "P1", "metadata", "missing_technology_active", "math_metadata.technology_active is missing.", recommended_fix="Set false for Paper 1 style or true for Paper 2 style.")
        elif not isinstance(m.get("technology_active"), bool):
            add_issue(issues, ex_id, "P1", "metadata", "bad_technology_active", f"technology_active={m.get('technology_active')!r}", recommended_fix="Use boolean true/false.")
        for key in ("strand", "skill"):
            if not str(m.get(key) or "").strip():
                add_issue(issues, ex_id, "P2", "metadata", f"missing_{key}", f"math_metadata.{key} is missing.", recommended_fix=f"Add math_metadata.{key}.")
        if course == "methods" and not str(m.get("assessment_objective") or "").strip():
            add_issue(issues, ex_id, "P3", "metadata", "missing_assessment_objective", "Methods item lacks assessment_objective metadata.", recommended_fix="Add apply, analyse, interpret, justify, model, or solve as appropriate.", confidence="medium")

    question = str(ex.get("question") or "")
    answer = str(ex.get("answer") or "")
    searchable = json.dumps(ex, ensure_ascii=False)
    if len(question.strip()) < 8:
        add_issue(issues, ex_id, "P0", "content", "empty_question", "Question text is empty or too short.", recommended_fix="Write a complete task stem.")
    if not answer.strip() and qtype != "multi_part":
        add_issue(issues, ex_id, "P0", "content", "empty_answer", "Answer is empty.", recommended_fix="Add the expected answer.")
    if BAD_CONTENT_RE.search(searchable):
        add_issue(issues, ex_id, "P0", "content", "template_or_meta_text", "Template/TODO/placeholder text found.", recommended_fix="Replace with authored content.")

    audit_question_type(ex, issues)
    audit_steps_and_reasoning(ex, issues, course=course)
    audit_senior_math_content(ex, issues, course=course)
    return issues


def audit_question_type(ex: dict[str, Any], issues: list[Issue]) -> None:
    ex_id = str(ex.get("id") or "unknown")
    qtype = str(ex.get("question_type") or "")
    if qtype == "multiple_choice":
        choices = ex.get("choices") or []
        key = str(ex.get("correct_choice") or "").upper()
        if len(choices) < 2:
            add_issue(issues, ex_id, "P1", "answer_key", "mcq_choice_count", f"choices={len(choices)}", recommended_fix="Provide at least two choices and a valid key.")
            return
        if len(choices) != 4:
            add_issue(issues, ex_id, "P3", "answer_key", "mcq_choice_count", f"choices={len(choices)}", recommended_fix="Use four choices A-D where possible for consistent MCQ routing.", confidence="medium")
            return
        if key not in VALID_CHOICES:
            add_issue(issues, ex_id, "P1", "answer_key", "mcq_bad_key", f"correct_choice={key!r}", recommended_fix="Set correct_choice to A, B, C or D.")
            return
        if len(set(map(str, choices))) != len(choices):
            add_issue(issues, ex_id, "P1", "answer_key", "mcq_duplicate_choices", "Duplicate MCQ choices.", recommended_fix="Make distractors distinct.")
        idx = ord(key) - ord("A")
        if not answer_matches_choice(ex.get("answer"), choices[idx], key):
            add_issue(issues, ex_id, "P1", "answer_key", "mcq_answer_mismatch", f"answer={ex.get('answer')!r}; correct={choices[idx]!r}", recommended_fix="Make answer match correct_choice or selected choice text.")
    elif qtype == "reasoning":
        rubric = ex.get("rubric") if isinstance(ex.get("rubric"), dict) else {}
        key_points = rubric.get("key_points") if isinstance(rubric.get("key_points"), list) else []
        if len(key_points) < 3 or int(rubric.get("max_score") or 0) < 3:
            add_issue(issues, ex_id, "P1", "rubric", "reasoning_weak_rubric", "Reasoning item needs at least 3 key_points and max_score >= 3.", recommended_fix="Add senior maths reasoning criteria: method, correctness, interpretation/justification.")
        if rubric_is_generic(rubric):
            add_issue(issues, ex_id, "P2", "rubric", "generic_rubric_filler", "Reasoning rubric contains generic filler rather than a task-specific marking criterion.", recommended_fix="Replace generic points with criteria tied to the required method, result, reasoning or interpretation.")
        if not str(ex.get("sample_reasoning") or "").strip():
            add_issue(issues, ex_id, "P1", "rubric", "reasoning_missing_sample", "Reasoning item lacks sample_reasoning.", recommended_fix="Add a model justification/proof/interpretation.")
    elif qtype == "multi_part":
        sub_parts = ex.get("sub_parts")
        if not isinstance(sub_parts, list):
            add_issue(issues, ex_id, "P1", "multipart", "multipart_too_short", "multi_part item has no valid sub_parts list.", recommended_fix="Add at least two labelled parts.")
            return
        if len(sub_parts) < 2:
            add_issue(issues, ex_id, "P1", "multipart", "multipart_too_short", "multi_part item has fewer than two sub_parts.", recommended_fix="Add at least two labelled parts.")
        total_marks = 0
        labels: list[str] = []
        uncovered_scored_parts: list[str] = []
        for idx, part in enumerate(sub_parts):
            if not isinstance(part, dict):
                add_issue(issues, ex_id, "P1", "multipart", "multipart_subpart_incomplete", f"sub_part {idx} incomplete.", recommended_fix="Each sub_part needs label, question and answer.")
                continue
            label = str(part.get("label") or "").strip()
            if not label:
                add_issue(issues, ex_id, "P1", "multipart", "multipart_missing_label", f"sub_part {idx + 1} has no label.", recommended_fix="Give each sub_part a stable unique label such as a, b or c.")
            else:
                labels.append(label.lower())
            if not all(part.get(k) for k in ("label", "question", "answer")):
                add_issue(issues, ex_id, "P1", "multipart", "multipart_subpart_incomplete", f"sub_part {label or idx + 1} incomplete.", recommended_fix="Each sub_part needs label, question and answer.")
            try:
                marks = float(part.get("max_score", part.get("marks", 1)) or 0)
            except Exception:
                marks = 0.0
                add_issue(issues, ex_id, "P2", "multipart", "multipart_bad_marks", f"sub_part {label or idx + 1} marks={part.get('marks')!r}", recommended_fix="Use a positive numeric mark value.")
            else:
                if marks <= 0:
                    add_issue(issues, ex_id, "P2", "multipart", "multipart_bad_marks", f"sub_part {label or idx + 1} marks={part.get('marks')!r}", recommended_fix="Use a positive numeric mark value.")
            total_marks += max(marks, 0)
            part_rubric = part.get("rubric")
            if rubric_is_generic(part_rubric):
                add_issue(issues, ex_id, "P2", "rubric", "generic_rubric_filler", f"sub_part {label or idx + 1} rubric contains generic filler rather than a task-specific criterion.", recommended_fix="Replace generic points with criteria tied to this sub-part's method, result or interpretation.")
            has_part_rubric = isinstance(part_rubric, dict) and bool(part_rubric) and not rubric_is_generic(part_rubric)
            if marks > 1 and not has_part_rubric and not top_level_rubric_covers_subpart(ex, part):
                uncovered_scored_parts.append(f"{label or idx + 1} ({marks:g} marks)")
        duplicate_labels = sorted(label for label, count in Counter(labels).items() if count > 1)
        if duplicate_labels:
            add_issue(issues, ex_id, "P1", "multipart", "multipart_duplicate_labels", f"Multi-part item has duplicate labels: {duplicate_labels}.", recommended_fix="Use a unique label for every sub-part so answers and partial credit map safely.")
        if rubric_is_generic(ex.get("rubric")):
            add_issue(issues, ex_id, "P2", "rubric", "generic_rubric_filler", "Item-level rubric contains generic filler rather than a task-specific marking criterion.", recommended_fix="Replace generic points with criteria tied to the relevant sub-parts.")
        if uncovered_scored_parts:
            add_issue(issues, ex_id, "P2", "rubric", "multipart_part_rubric_missing", "High-mark sub-parts have no traceable rubric criterion: " + ", ".join(uncovered_scored_parts) + ".", recommended_fix="Add task-specific part rubrics or concrete item-level key points that map to every listed sub-part.")
        if total_marks < 4:
            add_issue(issues, ex_id, "P2", "multipart", "multipart_low_marks", f"total_marks={total_marks}", recommended_fix="Senior multi-part tasks should usually total at least 4 marks.")


def audit_steps_and_reasoning(ex: dict[str, Any], issues: list[Issue], *, course: str) -> None:
    ex_id = str(ex.get("id") or "unknown")
    qtype = str(ex.get("question_type") or "")
    steps = ex.get("steps") or []
    if not isinstance(steps, list) or not steps:
        if qtype == "multiple_choice":
            return
        if qtype == "reasoning":
            rubric = ex.get("rubric") if isinstance(ex.get("rubric"), dict) else {}
            key_points = rubric.get("key_points") if isinstance(rubric.get("key_points"), list) else []
            if str(ex.get("sample_reasoning") or "").strip() and key_points:
                return
        add_issue(issues, ex_id, "P1", "working", "missing_steps", "No worked steps are provided.", recommended_fix="Add concise worked steps, or for reasoning items provide strong sample_reasoning and rubric.")
        return
    if qtype != "multiple_choice":
        generic = sum(1 for step in steps if GENERIC_STEP_RE.search(str(step)))
        mathy = sum(1 for step in steps if re.search(r"\d|=|\\frac|\\sqrt|\\int|\\frac\{d|\\binom|\\vec|matrix|therefore|hence", str(step), re.I))
        if generic >= max(1, len(steps) // 2) and mathy == 0:
            add_issue(issues, ex_id, "P2", "working", "generic_steps", "Steps look generic and do not show senior mathematical working.", recommended_fix="Show substitutions, transformations, graph/probability reasoning, proof logic, or interpretation.")
    text = " ".join([str(ex.get("question") or ""), str(ex.get("answer") or ""), " ".join(map(str, steps))])
    if (
        str(ex.get("difficulty")) == "extending"
        and str(ex.get("question_type") or "") == "reasoning"
        and not REASONING_VERB_RE.search(text)
        and not SENIOR_DEMAND_RE.search(text)
    ):
        add_issue(issues, ex_id, "P3", "demand", "extending_low_reasoning_signal", "Extending item has little explicit reasoning/evaluation signal.", recommended_fix="Add justify, interpret, compare, derive, evaluate, prove or modelling demand.", confidence="medium")


def audit_senior_math_content(ex: dict[str, Any], issues: list[Issue], *, course: str) -> None:
    ex_id = str(ex.get("id") or "unknown")
    qtype = str(ex.get("question_type") or "")
    text = " ".join(
        [str(ex.get("topic") or ""), str(ex.get("question") or ""), str(ex.get("answer") or "")]
        + [str(step) for step in ex.get("steps") or []]
    )
    answer = str(ex.get("answer") or "")
    if EXACT_PROMPT_RE.search(text) and DECIMAL_ANSWER_RE.search(answer) and not re.search(r"\b(approx|decimal|nearest|calculator|technology)\b", text, re.I):
        add_issue(issues, ex_id, "P2", "math_quality", "exact_answer_as_decimal", "Task asks for exact/surd/proof-style work but answer appears decimal.", recommended_fix="Use exact form unless the task explicitly asks for approximation.")
    if (
        course == "methods"
        and CALCULUS_RE.search(text)
        and qtype == "short_answer"
        and len(ex.get("steps") or []) < 2
        and str(ex.get("difficulty")) == "extending"
        and str(ex.get("complexity")) == "complex_unfamiliar"
    ):
        add_issue(issues, ex_id, "P3", "math_quality", "calculus_steps_thin", "Calculus/statistics short-answer has thin worked support.", recommended_fix="Include derivative/integral/probability setup and interpretation.", confidence="medium")
    if course == "specialist" and SPECIALIST_EXPRESSION_RE.search(text):
        scalar_specialist_result = (
            qtype == "short_answer"
            and is_scalar_exact_answer(answer)
            and SPECIALIST_SCALAR_PROMPT_RE.search(str(ex.get("question") or ""))
        )
        proof_like_short_answer = qtype == "short_answer" and re.search(r"\b(prove|proof|induction|show that)\b", text, re.I)
        expression_like_answer = bool(re.search(r"\b(?:cis|arg|Re|Im)\b|[ij]\b|\\begin\{pmatrix\}|,|\([^)]+,[^)]+\)", answer, re.I))
        if qtype == "short_answer" and not scalar_specialist_result and (
            proof_like_short_answer
            or expression_like_answer
            or re.search(r"\b(matrix|matrices|complex|argand|vector|induction|proof)\b", text, re.I)
        ):
            add_issue(issues, ex_id, "P3", "math_quality", "specialist_expression_manual_review", "Specialist complex/vector/matrix/proof expression may need manual marking support.", recommended_fix="Use MCQ for unsupported expressions or ensure reasoning rubric/model answer is strong.", confidence="medium")


def bank_level_issues(items: list[dict[str, Any]], *, course: str, topics: dict[str, dict[str, Any]]) -> list[Issue]:
    issues: list[Issue] = []
    if not items:
        add_issue(issues, "__bank__", "P0", "bank", "empty_bank", "No exercises found.", recommended_fix="Add senior maths exercise files.")
        return issues

    ids = Counter(str(ex.get("id") or "") for ex in items)
    for ex_id, count in ids.items():
        if ex_id and count > 1:
            add_issue(issues, ex_id, "P0", "bank", "duplicate_id", f"id appears {count} times.", recommended_fix="Make exercise ids unique.")

    linked = Counter(tid for ex in items for tid in (ex.get("topic_ids") or []))
    for topic_id in sorted(topics):
        count = linked[topic_id]
        if count == 0:
            add_issue(issues, "__bank__", "P1", "coverage", "topic_not_covered", f"{topic_id} has no exercises.", recommended_fix="Add items for every topic in the course.")
        elif count < int(COURSES[course]["min_items_per_topic"]):
            add_issue(issues, "__bank__", "P3", "coverage", "topic_low_count", f"{topic_id} has {count} items.", recommended_fix=f"Target at least {COURSES[course]['min_items_per_topic']} items per topic.", confidence="medium")

    qtypes = Counter(str(ex.get("question_type") or "") for ex in items)
    if not qtypes.get("reasoning"):
        add_issue(issues, "__bank__", "P2", "balance", "missing_reasoning_tasks", "No reasoning items found.", recommended_fix="Add proof/justify/model/interpret items.")
    if not qtypes.get("multi_part"):
        add_issue(issues, "__bank__", "P2", "balance", "missing_multipart_tasks", "No multi_part items found.", recommended_fix="Add QCAA-style scaffolded multi-part tasks.")
    if (qtypes.get("multiple_choice", 0) + qtypes.get("short_answer", 0)) / len(items) > 0.85:
        add_issue(issues, "__bank__", "P2", "balance", "mcq_short_answer_dominant", "MCQ/short_answer items exceed 85% of bank.", recommended_fix="Increase reasoning and multi-part assessment-style tasks.")

    diff = Counter(str(ex.get("difficulty") or "") for ex in items)
    missing_diff = {"foundational", "developing", "extending"} - set(diff)
    if missing_diff:
        add_issue(issues, "__bank__", "P2", "balance", "difficulty_ladder_incomplete", ", ".join(sorted(missing_diff)), recommended_fix="Include foundational, developing and extending tasks.")
    for band, count in diff.items():
        if count / len(items) > 0.85:
            add_issue(issues, "__bank__", "P3", "balance", "difficulty_band_dominant", f"{band}: {count}/{len(items)}", recommended_fix="Broaden the difficulty ladder.", confidence="medium")

    tech = Counter(meta(ex).get("technology_active") for ex in items)
    if tech.get(True, 0) == 0:
        add_issue(issues, "__bank__", "P2", "paper_balance", "missing_technology_active_tasks", "No Paper 2 / technology-active tasks found.", recommended_fix="Add technology-active modelling/graphing/statistics items.")
    if tech.get(False, 0) == 0:
        add_issue(issues, "__bank__", "P2", "paper_balance", "missing_technology_free_tasks", "No Paper 1 / technology-free tasks found.", recommended_fix="Add technology-free exact/algebraic/proof tasks.")

    by_topic_qtype: dict[str, Counter[str]] = defaultdict(Counter)
    for ex in items:
        for tid in ex.get("topic_ids") or []:
            by_topic_qtype[str(tid)][str(ex.get("question_type") or "")] += 1
    for topic_id, counts in by_topic_qtype.items():
        if counts and counts.get("multiple_choice", 0) / sum(counts.values()) > 0.75:
            add_issue(issues, "__bank__", "P3", "balance", "topic_mcq_dominant", f"{topic_id}: {counts.get('multiple_choice')}/{sum(counts.values())}", recommended_fix="Add short_answer/reasoning/multi_part items for the topic.", confidence="medium")

    return issues


def item_row(ex: dict[str, Any], issues: list[Issue]) -> dict[str, Any]:
    by_priority = Counter(issue.priority for issue in issues)
    m = meta(ex)
    verification = maths_verification_status(ex, issues)
    return {
        "id": ex.get("id") or "",
        "source_file": ex.get("_source_file") or "",
        "course": ex.get("subject") or "",
        "unit": ex.get("unit") or "",
        "topic_id": ",".join(str(t) for t in ex.get("topic_ids") or []),
        "topic": ex.get("topic") or "",
        "question_type": ex.get("question_type") or "",
        "difficulty": ex.get("difficulty") or "",
        "complexity": ex.get("complexity") or "",
        "technology_active": m.get("technology_active"),
        "assessment_objective": m.get("assessment_objective") or "",
        "strand": m.get("strand") or "",
        "skill": m.get("skill") or "",
        "maths_verification": verification,
        "P0": by_priority.get("P0", 0),
        "P1": by_priority.get("P1", 0),
        "P2": by_priority.get("P2", 0),
        "P3": by_priority.get("P3", 0),
        "main_priority": min((i.priority for i in issues), key=lambda p: PRIORITY_ORDER[p], default=""),
        "main_issue": next((f"{i.category}/{i.code}: {i.message}" for i in issues), ""),
    }


def maths_verification_status(ex: dict[str, Any], issues: list[Issue]) -> str:
    """State what this audit actually established about mathematical correctness.

    MCQs receive a deterministic key/answer consistency check. Other senior
    responses span calculus, statistics, vectors, matrices and proof, for which
    this script has no general symbolic verifier; they must remain explicit in
    the human maths queue rather than disappearing behind a clean schema run.
    """
    codes = {issue.code for issue in issues}
    if "mcq_answer_mismatch" in codes or "mcq_bad_key" in codes:
        return "key_inconsistent"
    if ex.get("question_type") == "multiple_choice":
        return "key_consistent"
    return "human_review_required"


def write_outputs(course: str, items: list[dict[str, Any]], issues_by_id: dict[str, list[Issue]], all_issues: list[Issue], out_dir: Path, *, data_files: list[Path]) -> dict[str, str]:
    out_dir.mkdir(parents=True, exist_ok=True)
    prefix = f"{course}_senior_math"
    item_path = out_dir / f"{prefix}_full_item_audit.csv"
    flags_path = out_dir / f"{prefix}_full_issue_flags.csv"
    jsonl_path = out_dir / f"{prefix}_issue_flags.jsonl"
    checklist_csv = out_dir / f"{prefix}_full_repair_checklist.csv"
    checklist_md = out_dir / f"{prefix}_full_repair_checklist.md"
    summary_path = out_dir / f"{prefix}_full_summary.md"
    maths_review_path = out_dir / f"{prefix}_maths_review_queue.csv"

    rows = [item_row(ex, issues_by_id.get(str(ex.get("id") or ""), [])) for ex in items]
    with item_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else ["id"])
        writer.writeheader()
        writer.writerows(rows)

    review_rows = [row for row in rows if row["maths_verification"] != "key_consistent"]
    with maths_review_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else ["id"])
        writer.writeheader()
        writer.writerows(review_rows)

    flag_fields = ["exercise_id", "priority", "category", "code", "message", "evidence", "recommended_fix", "confidence"]
    with flags_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=flag_fields)
        writer.writeheader()
        for issue in all_issues:
            writer.writerow(issue.__dict__)
    with jsonl_path.open("w", encoding="utf-8") as f:
        for issue in all_issues:
            f.write(json.dumps(issue.__dict__, ensure_ascii=False) + "\n")
    with checklist_csv.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=flag_fields)
        writer.writeheader()
        for issue in sorted(all_issues, key=lambda i: (PRIORITY_ORDER[i.priority], i.category, i.code, i.exercise_id)):
            writer.writerow(issue.__dict__)

    counts = Counter(issue.priority for issue in all_issues)
    code_counts = Counter((issue.priority, issue.code) for issue in all_issues)
    qtypes = Counter(str(ex.get("question_type") or "") for ex in items)
    difficulties = Counter(str(ex.get("difficulty") or "") for ex in items)
    tech = Counter(str(meta(ex).get("technology_active")) for ex in items)
    with checklist_md.open("w", encoding="utf-8") as f:
        f.write(f"# {COURSES[course]['label']} Senior Maths Repair Checklist\n\n")
        for issue in sorted(all_issues, key=lambda i: (PRIORITY_ORDER[i.priority], i.category, i.code, i.exercise_id)):
            f.write(f"- {issue.priority} `{issue.exercise_id}` {issue.category}/{issue.code}: {issue.message} Fix: {issue.recommended_fix}\n")
    with summary_path.open("w", encoding="utf-8") as f:
        f.write(f"# {COURSES[course]['label']} Senior Maths Full Audit\n\n")
        f.write("## Scope\n\n")
        f.write(f"- Data files: {', '.join(path.name for path in data_files)}\n")
        f.write(f"- Items loaded: {len(items)}\n\n")
        f.write("## Priority Counts\n\n")
        f.write("| Priority | Count |\n|---|---:|\n")
        for priority in ("P0", "P1", "P2", "P3"):
            f.write(f"| {priority} | {counts.get(priority, 0)} |\n")
        f.write("\n## Bank Profile\n\n")
        f.write(f"- Question types: {dict(qtypes)}\n")
        f.write(f"- Difficulty: {dict(difficulties)}\n")
        f.write(f"- technology_active: {dict(tech)}\n\n")
        verification_counts = Counter(row["maths_verification"] for row in rows)
        f.write("## Mathematical Verification Scope\n\n")
        f.write(f"- Status counts: {dict(verification_counts)}\n")
        f.write(f"- Human maths review queue: {len(review_rows)} items\n")
        f.write("- `key_consistent` checks only MCQ answer/key consistency; it does not independently prove the mathematics.\n")
        f.write("- Non-MCQ answers require qualified human review or a separately validated symbolic/numeric checker.\n\n")
        f.write("## Issue Code Counts\n\n")
        f.write("| Priority | Code | Count |\n|---|---|---:|\n")
        for (priority, code), count in sorted(code_counts.items(), key=lambda kv: (PRIORITY_ORDER[kv[0][0]], kv[0][1])):
            f.write(f"| {priority} | `{code}` | {count} |\n")

    return {
        "item_audit": str(item_path),
        "issue_flags": str(flags_path),
        "issue_flags_jsonl": str(jsonl_path),
        "repair_checklist_csv": str(checklist_csv),
        "repair_checklist_md": str(checklist_md),
        "summary": str(summary_path),
        "maths_review": str(maths_review_path),
    }


def audit_course(course: str, *, data_dir: Path, out_dir: Path) -> dict[str, Any]:
    topics = load_curriculum(data_dir, course)
    items, paths = load_bank_files(data_dir, course)
    issues_by_id: dict[str, list[Issue]] = defaultdict(list)
    all_issues: list[Issue] = []
    for ex in items:
        item_issues = audit_item(ex, course=course, topics=topics)
        issues_by_id[str(ex.get("id") or "")].extend(item_issues)
        all_issues.extend(item_issues)
    bank_issues = bank_level_issues(items, course=course, topics=topics)
    all_issues.extend(bank_issues)
    outputs = write_outputs(course, items, issues_by_id, all_issues, out_dir, data_files=paths)
    counts = Counter(issue.priority for issue in all_issues)
    return {
        "course": course,
        "items": len(items),
        "issues": len(all_issues),
        "P0": counts.get("P0", 0),
        "P1": counts.get("P1", 0),
        "P2": counts.get("P2", 0),
        "P3": counts.get("P3", 0),
        "outputs": outputs,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--course", choices=sorted(COURSES))
    group.add_argument("--all", action="store_true")
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT_DIR / "senior_math_full_audit")
    parser.add_argument("--json", action="store_true", help="Print machine-readable summary.")
    parser.add_argument("--fail-on", choices=["P0", "P1", "P2", "P3"], default=None)
    parser.add_argument("--strict", action="store_true", help="Fail on any P0/P1 blocker; use --fail-on P2 for an empty repair queue.")
    args = parser.parse_args(argv)

    courses = sorted(COURSES) if args.all else [args.course]
    summaries = [audit_course(course, data_dir=args.data_dir, out_dir=args.out) for course in courses]

    if args.json:
        print(json.dumps(summaries, indent=2))
    else:
        for summary in summaries:
            print(
                f"{summary['course']}: items={summary['items']} issues={summary['issues']} "
                f"P0={summary['P0']} P1={summary['P1']} P2={summary['P2']} P3={summary['P3']}"
            )
            for name, path in summary["outputs"].items():
                print(f"  {name}: {path}")

    fail_on = "P1" if args.strict else args.fail_on
    if fail_on:
        allowed = PRIORITY_ORDER[fail_on]
        if any(summary[p] for summary in summaries for p, value in PRIORITY_ORDER.items() if value <= allowed):
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
