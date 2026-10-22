#!/usr/bin/env python3
"""Full AC9 Science exercise-bank audit for Years 7-10.

The existing ``audit_science_banks.py`` is a useful bank-level gate. This
script adds item-level repair output and science-specific checks for curriculum
fit, CER, inquiry practice, data/diagram tasks, factual risk, self-study
readiness, and exam-prep suitability.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pydantic import ValidationError
from core.schema.exercise_schema import ExerciseItem

from core.algorithms.science_complexity import (
    assess_science_complexity,
    complexity_review_queue,
    stratified_complexity_sample,
)

from audit_science_banks import (  # type: ignore
    RISK_ORDER,
    VALID_COMPLEXITY,
    VALID_DIFFICULTY,
    VALID_QTYPES,
    VISUAL_DATA_REP,
    YEAR_PROFILES,
    YearProfile,
    combined_text,
    diagram_structural_issues,
    extension_quality,
    has_specific_steps,
    infer_data_level,
    is_cer_item,
    is_inquiry_item,
    is_representation_question,
    mcq_valid,
    meta,
    norm_text,
    representation_quality,
    strip_choice_prefix,
    template_risk,
    wc,
    year_fit,
)


DEFAULT_DATA_DIR = ROOT / "data"
DEFAULT_CURRICULUM_DIR = DEFAULT_DATA_DIR / "curriculum" / "ac9_science"
DEFAULT_OUT_DIR = ROOT / "audit_output"

CANONICAL_STRANDS = {
    "Science Understanding",
    "Science Inquiry",
    "Science as a Human Endeavour",
}
TOPIC_STRAND_BY_CODE = {
    "U": "Science Understanding",
    "I": "Science Inquiry",
    "H": "Science as a Human Endeavour",
}
PRIORITY_ORDER = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}
PRIORITY_TO_SEVERITY = {"P0": "critical", "P1": "high", "P2": "medium", "P3": "low"}
PASS_STATUS = "pass"

STOP_WORDS = {
    "about", "above", "across", "after", "again", "against", "also", "answer",
    "because", "between", "could", "describe", "different", "during", "each",
    "example", "explain", "following", "given", "identify", "include",
    "including", "information", "investigation", "level", "model", "question",
    "science", "scientific", "student", "students", "their", "there", "these",
    "through", "using", "which", "while", "would",
}

FACT_RISK_PATTERNS: tuple[tuple[re.Pattern[str], str, str], ...] = (
    (
        re.compile(r"\bplants?\b.{0,80}\b(get|gets|obtain|obtains|take|takes)\b.{0,60}\b(food|energy)\b.{0,60}\b(from|in)\b.{0,30}\bsoil\b", re.I),
        "plants_food_from_soil",
        "Plants make sugars by photosynthesis; soil supplies water and minerals, not food energy.",
    ),
    (
        re.compile(r"seasons?.{0,90}(caused by|because of).{0,90}(distance from the sun|closer to the sun)", re.I),
        "seasons_distance",
        "Seasons should be explained mainly by Earth's axial tilt, not Earth-Sun distance.",
    ),
    (
        re.compile(r"\b(energy|mass|matter)\s+is\s+destroyed\b|\bdestroys\s+(energy|mass|matter)\b", re.I),
        "conservation_destroyed",
        "Conservation wording should use transformed, transferred or rearranged, not destroyed.",
    ),
    (
        re.compile(r"moon phases?.{0,90}(caused by|because of|due to).{0,90}earth'?s shadow|earth'?s shadow.{0,90}(causes|creates).{0,90}moon phases?", re.I),
        "moon_phases_shadow",
        "Moon phases are caused by the changing sunlit portion we see, not Earth's shadow except during lunar eclipses.",
    ),
    (
        re.compile(r"\b(indivisible particles|atoms are indivisible)\b", re.I),
        "indivisible_particles",
        "Avoid calling atoms or particles indivisible in a modern Year 7-10 explanation.",
    ),
    (
        re.compile(r"(particles?|atoms?|molecules?).{0,60}\bin solids?\b.{0,50}(do not|don't|does not|never)\s+move|\bsolids?\b.{0,60}(particles?|atoms?|molecules?).{0,50}(do not|don't|does not|never)\s+move", re.I),
        "solid_particles_no_motion",
        "Particles in solids vibrate about fixed positions; they are not motionless.",
    ),
    (
        re.compile(r"diffusion.{0,80}not at all in solids|solids.{0,80}diffusion.{0,80}not at all", re.I),
        "solid_diffusion_impossible",
        "Diffusion in solids is usually extremely slow in this context, not impossible.",
    ),
    (
        re.compile(r"\bheavier objects?\b.{0,80}\b(always|all)\b.{0,40}\bfall faster\b|\bobjects?\b.{0,80}\bfall faster\b.{0,80}\bbecause\b.{0,40}\bheavier\b", re.I),
        "heavier_objects_fall_faster",
        "In the same gravitational field, objects have the same acceleration when air resistance is negligible.",
    ),
    (
        re.compile(r"\bheat\b.{0,50}\b(and|is|are)\b.{0,20}\btemperature\b.{0,40}\b(the same|same thing|identical)\b|\btemperature\b.{0,50}\b(and|is|are)\b.{0,20}\bheat\b.{0,40}\b(the same|same thing|identical)\b", re.I),
        "heat_temperature_same",
        "Heat is energy transfer; temperature is a measure related to average particle kinetic energy.",
    ),
    (
        re.compile(r"\bfood web\b.{0,120}\barrows?\b.{0,80}(from predator to prey|towards the food|to what is eaten)", re.I),
        "food_web_arrow_direction",
        "Food-web arrows should show energy flow from food/prey to consumer/predator.",
    ),
    (
        re.compile(r"\bdominant\b.{0,90}\balways\b.{0,60}(common|more common)|\brecessive\b.{0,90}\balways\b.{0,60}rare", re.I),
        "dominant_common_misconception",
        "Dominant alleles are not necessarily more common, and recessive alleles are not necessarily rare.",
    ),
    (
        re.compile(r"evolution.{0,100}(individuals change|organisms choose|need to adapt)", re.I),
        "evolution_individual_choice",
        "Evolution should be framed as population-level change across generations, not individual choice or need.",
    ),
    (
        re.compile(r"adaptations?.{0,90}(individuals choose|organisms choose|because individuals choose|because organisms choose|need to change)", re.I),
        "adaptation_individual_choice",
        "Adaptations arise through heritable variation and selection across generations, not because individuals choose to change.",
    ),
    (
        re.compile(r"correlation.{0,90}(proves|guarantees|shows that.*causes)|causation.{0,90}proven by correlation", re.I),
        "correlation_causation",
        "Correlation alone does not prove causation.",
    ),
)

GENERIC_RUBRIC_FILLER = {
    "uses evidence.",
    "uses relevant evidence.",
    "explains scientifically.",
    "gives a correct answer.",
    "explains reasoning clearly.",
    "shows working.",
}
RUBRIC_COVERAGE_STOP_WORDS = {
    "about", "answer", "because", "calculate", "claim", "describe", "each",
    "evidence", "explain", "given", "identify", "model", "question", "reasoning",
    "science", "scientific", "show", "state", "student", "using", "what", "which",
}
SAFETY_PROMPT_RE = re.compile(
    r"\b(safety|hazard|risk|precaution|control measure|safe handling|personal protective equipment|ppe)\b",
    re.I,
)
PRACTICAL_SAFETY_CONTEXT_RE = re.compile(
    r"\b(experiment|investigation|practical|laborator(?:y|ies)|lab|fieldwork|apparatus|equipment|"
    r"glassware|beaker|test tube|flask|burner|scalpel|blade|knife|chemical|acid|alkali|"
    r"heating|heated|hot water|electric|organism|microbe|specimen|sample collection|handling)\b",
    re.I,
)
HAZARD_TERMS_RE = re.compile(
    r"\b(burn|hot|heat|flame|fire|cut|sharp|glass|splash|fume|vapou?r|acid|alkali|chemical|"
    r"electric|shock|microbe|bacteria|organism|allerg|fieldwork|sun exposure|trip|slip)\b",
    re.I,
)
SAFETY_CONTROL_RE = re.compile(
    r"\b(goggles|glasses|gloves|tongs|clamp|heatproof|cool(?:ing)?|ventilat|fume hood|"
    r"wash hands|dispose|label|keep away|switch off|insulat|supervis|sterilis|first aid|"
    r"stable surface|cut away|away from (?:the )?body|approved safe temperature)\b",
    re.I,
)
SAFETY_PROCESS_RE = re.compile(
    r"\b(identif(?:y|ies|ied|ying) (?:the )?(?:hazard|risk)|assess(?:es|ed|ing)? (?:the )?risk|"
    r"plan(?:s|ned|ning)? (?:a )?control|apply(?:ies|ied|ing)? (?:a )?control|risk management)\b",
    re.I,
)
CORRECTION_CUE_RE = re.compile(
    r"\b(not|never|incorrect|wrong|false|myth|misconception|rather than|should not|"
    r"do not|does not|cannot|can't|isn't|are not|avoid|reject)\b",
    re.I,
)


@dataclass(frozen=True)
class TopicProfile:
    topic_id: str
    name: str
    strand: str
    keywords: set[str]


@dataclass
class IssueFlag:
    exercise_id: str
    priority: str
    category: str
    code: str
    message: str
    evidence: str = ""
    recommended_fix: str = ""
    confidence: str = "high"


AUDIT_COLUMNS = [
    "id",
    "topic",
    "primary_topic_id",
    "question_type",
    "difficulty",
    "complexity",
    "complexity_calibration",
    "complexity_evidence",
    "complexity_risk_flags",
    "strand",
    "topic_alignment",
    "fact_check",
    "cer_quality",
    "inquiry_quality",
    "safety_quality",
    "data_quality",
    "diagram_quality",
    "self_study",
    "exam_prep",
    "template_risk",
    "main_priority",
    "main_issue",
    "recommended_fix",
]

ISSUE_COLUMNS = [
    "exercise_id",
    "priority",
    "category",
    "code",
    "message",
    "evidence",
    "recommended_fix",
    "confidence",
]

COMPLEXITY_REVIEW_COLUMNS = [
    "exercise_id",
    "primary_topic_id",
    "declared_complexity",
    "status",
    "review_priority",
    "contextual_dimensions",
    "direct_low_demand",
    "evidence",
    "risk_flags",
    "rationale",
    "question_type",
    "question",
    "answer_excerpt",
    "science_metadata",
]


def _complexity_csv_row(row: dict[str, Any]) -> dict[str, Any]:
    ready = dict(row)
    ready["evidence"] = ", ".join(str(item) for item in row.get("evidence") or [])
    ready["risk_flags"] = ", ".join(str(item) for item in row.get("risk_flags") or [])
    ready.setdefault("science_metadata", "")
    return {column: ready.get(column, "") for column in COMPLEXITY_REVIEW_COLUMNS}


def walk_strings(value: Any):
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from walk_strings(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from walk_strings(item)


def keywords_from_text(text: str) -> set[str]:
    words = re.findall(r"[a-z][a-z0-9-]{3,}", text.lower())
    return {word for word in words if word not in STOP_WORDS}


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def safe_rel(path: Path, root: Path = ROOT) -> str:
    resolved = path.resolve()
    try:
        return str(resolved.relative_to(root.resolve()))
    except ValueError:
        return str(resolved)


def strand_from_topic_id(topic_id: str) -> str:
    match = re.fullmatch(r"AC9S\d+(U|H|I)\d+", str(topic_id))
    if not match:
        return ""
    return TOPIC_STRAND_BY_CODE[match.group(1)]


def authored_science_text(ex: dict[str, Any]) -> str:
    """Authoritative text for fact-risk checks, excluding MCQ distractors."""
    parts: list[str] = []
    for key in ["question", "answer", "sample_reasoning", "diagram_description"]:
        parts.append(str(ex.get(key) or ""))
    parts.extend(str(step) for step in ex.get("steps") or [])
    for part in ex.get("sub_parts") or []:
        if isinstance(part, dict):
            parts.append(str(part.get("question") or ""))
            parts.append(str(part.get("answer") or ""))
    return " ".join(parts)


def iter_rubrics(ex: dict[str, Any]):
    """Yield top-level and part-level rubrics with a stable audit path."""
    rubric = ex.get("rubric")
    if isinstance(rubric, dict) and rubric:
        yield "rubric", rubric
    for index, part in enumerate(ex.get("sub_parts") or []):
        if not isinstance(part, dict):
            continue
        rubric = part.get("rubric")
        if isinstance(rubric, dict) and rubric:
            yield f"sub_parts[{part.get('label') or index + 1}].rubric", rubric


def _rubric_token_stem(token: str) -> str:
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
    return {
        _rubric_token_stem(token)
        for token in re.findall(r"[a-z]{4,}", str(value or "").lower())
        if token not in RUBRIC_COVERAGE_STOP_WORDS
    }


def rubric_coverage_numbers(value: Any) -> set[str]:
    return {
        token for token in re.findall(r"\d+(?:\.\d+)?", str(value or ""))
        if float(token) >= 2
    }


def top_level_rubric_covers_subpart(ex: dict[str, Any], part: dict[str, Any]) -> bool:
    """Allow item-level rubrics only when a concrete criterion maps to the part."""
    rubric = ex.get("rubric")
    key_points = rubric.get("key_points") if isinstance(rubric, dict) else None
    if not isinstance(key_points, list) or not key_points:
        return False
    part_text = "\n".join(
        str(part.get(field) or "") for field in ("question", "answer", "steps")
    )
    part_terms = rubric_coverage_tokens(part_text)
    part_numbers = rubric_coverage_numbers(part_text)
    for point in key_points:
        point_text = " ".join(walk_strings(point))
        if part_numbers & rubric_coverage_numbers(point_text):
            return True
        if len(part_terms & rubric_coverage_tokens(point_text)) >= 2:
            return True
    return False


def rubric_is_generic(rubric: dict[str, Any]) -> bool:
    return any(
        str(value).strip().lower() in GENERIC_RUBRIC_FILLER
        for value in walk_strings(rubric)
    )


def misconception_is_explicitly_rejected(text: str, match: re.Match[str]) -> bool:
    """Do not flag a misconception that the authored teaching text rejects."""
    before = text[max(0, match.start() - 120):match.start()]
    after = text[match.end():match.end() + 120]
    return bool(CORRECTION_CUE_RE.search(before) or CORRECTION_CUE_RE.search(after))


def load_topic_profiles(year: int, curriculum_dir: Path = DEFAULT_CURRICULUM_DIR) -> dict[str, TopicProfile]:
    curriculum = load_json(curriculum_dir / f"year{year}.json")
    profiles: dict[str, TopicProfile] = {}
    for topic in curriculum.get("topics", []):
        topic_id = str(topic.get("topic_id") or "")
        text = " ".join(walk_strings(topic))
        profiles[topic_id] = TopicProfile(
            topic_id=topic_id,
            name=str(topic.get("name") or ""),
            strand=strand_from_topic_id(topic_id),
            keywords=keywords_from_text(text),
        )
    return profiles


def add_issue(
    issues: list[IssueFlag],
    qid: str,
    priority: str,
    category: str,
    code: str,
    message: str,
    evidence: str = "",
    recommended_fix: str = "",
    confidence: str = "high",
) -> None:
    issues.append(
        IssueFlag(
            exercise_id=qid or "<missing>",
            priority=priority,
            category=category,
            code=code,
            message=message,
            evidence=evidence[:900],
            recommended_fix=recommended_fix[:900],
            confidence=confidence,
        )
    )


def best_issue(issues: list[IssueFlag], qid: str) -> IssueFlag | None:
    qissues = [issue for issue in issues if issue.exercise_id == qid]
    if not qissues:
        return None
    return sorted(qissues, key=lambda issue: PRIORITY_ORDER[issue.priority])[0]


def topic_alignment_status(ex: dict[str, Any], profiles: dict[str, TopicProfile]) -> tuple[str, str]:
    topic_ids = [str(tid) for tid in ex.get("topic_ids") or []]
    if not topic_ids:
        return "missing_topic", "No topic_ids"
    primary = topic_ids[0]
    profile = profiles.get(primary)
    if not profile:
        return "invalid_topic", f"{primary} is not in the curriculum"

    item_keywords = keywords_from_text(combined_text(ex))
    overlap = sorted(item_keywords & profile.keywords)
    if len(overlap) >= 3:
        return "strong", ", ".join(overlap[:8])
    if len(overlap) >= 1:
        return "thin", ", ".join(overlap[:8])
    return "weak", f"No meaningful keyword overlap with {primary}: {profile.name}"


def fact_check_status(ex: dict[str, Any]) -> tuple[str, list[tuple[str, str]]]:
    text = authored_science_text(ex)
    findings: list[tuple[str, str]] = []
    lowered = text.lower()
    for pattern, code, message in FACT_RISK_PATTERNS:
        match = pattern.search(text)
        if not match:
            continue
        if misconception_is_explicitly_rejected(text, match):
            continue
        if code == "conservation_destroyed" and any(
            phrase in lowered
            for phrase in [
                "not destroyed", "rather than destroyed", "not because energy is destroyed",
                "not because mass is destroyed", "claim is incorrect", "claims incorrectly",
            ]
        ):
            continue
        if code == "correlation_causation" and re.search(
            r"correlation.{0,80}(not enough|does not|cannot|isn't enough).{0,80}prove causation",
            lowered,
        ):
            continue
        findings.append((code, message))
    if findings:
        return "review_needed", findings
    return PASS_STATUS, []


def cer_quality_status(ex: dict[str, Any]) -> tuple[str, str]:
    if not is_cer_item(ex):
        return "not_applicable", ""
    if ex.get("question_type") != "reasoning" and not meta(ex).get("claim_evidence_reasoning"):
        return "adequate", ""
    has_rubric = isinstance(ex.get("rubric"), dict) and bool(ex.get("rubric"))
    sample = str(ex.get("sample_reasoning") or "")
    answer = str(ex.get("answer") or "")
    combined = f"{sample} {answer}".lower()
    if not has_rubric or not sample.strip():
        return "missing_support", "CER item needs rubric and sample_reasoning for self-study and AI marking."
    has_parts = all(term in combined for term in ["claim", "evidence", "reason"])
    has_evidence_link = bool(re.search(r"\b(data|table|graph|observation|result|evidence|shows|because)\b", combined))
    if not has_parts:
        return "thin", "Model answer does not explicitly model claim, evidence and reasoning."
    if not has_evidence_link:
        return "thin", "CER model answer may not point to evidence from the prompt or data."
    claim_match = re.search(r"\bclaim\s*:\s*(.*?)(?=\s+evidence\s*:|\s+reasoning\s*:|$)", combined, re.I | re.S)
    reasoning_match = re.search(r"\breasoning\s*:\s*(.*?)(?=\s+claim\s*:|\s+evidence\s*:|$)", combined, re.I | re.S)
    if claim_match and reasoning_match:
        claim_text = norm_text(claim_match.group(1))
        reasoning_text = norm_text(reasoning_match.group(1))
        if claim_text and reasoning_text and (
            claim_text == reasoning_text
            or claim_text in reasoning_text and wc(reasoning_text) <= wc(claim_text) + 3
        ):
            return "thin", "CER reasoning merely repeats the claim instead of explaining the science link."
    return "strong", ""


def prompt_text(ex: dict[str, Any]) -> str:
    parts = [str(ex.get("question") or "")]
    for part in ex.get("sub_parts") or []:
        if isinstance(part, dict):
            parts.append(str(part.get("question") or ""))
    return " ".join(parts)


def safety_quality_status(ex: dict[str, Any]) -> tuple[str, str]:
    """Check hazard-control completeness only for practical safety tasks.

    Generic uses of ``risk`` or ``hazard`` in policy, health communication,
    bushfire management or Earth science are not laboratory/practical safety
    tasks and must not trigger this gate.
    """
    prompt = prompt_text(ex)
    if not SAFETY_PROMPT_RE.search(prompt) or not PRACTICAL_SAFETY_CONTEXT_RE.search(prompt):
        return "not_applicable", ""
    response_parts = [str(ex.get("answer") or ""), str(ex.get("sample_reasoning") or "")]
    response_parts.extend(str(step) for step in ex.get("steps") or [])
    response_parts.extend(
        str(part.get("answer") or "")
        for part in ex.get("sub_parts") or []
        if isinstance(part, dict)
    )
    response = " ".join(response_parts)
    has_hazard = bool(HAZARD_TERMS_RE.search(prompt) or HAZARD_TERMS_RE.search(response))
    has_control = bool(SAFETY_CONTROL_RE.search(response))
    if ex.get("question_type") == "multiple_choice":
        if has_control or SAFETY_PROCESS_RE.search(response):
            return "adequate", ""
        return "thin", "Safety MCQ should identify a valid risk-management step or concrete control."
    if not has_hazard:
        return "thin", "Safety task should identify the specific hazard or plausible harm."
    if not has_control:
        return "thin", "Safety task should state a concrete control measure, not only 'work safely'."
    return "adequate", ""


def inquiry_quality_status(ex: dict[str, Any], profile: YearProfile) -> tuple[str, str]:
    text = combined_text(ex)
    prompt = prompt_text(ex).lower()
    m = meta(ex)
    topic_ids = [str(tid) for tid in ex.get("topic_ids") or []]
    primary = topic_ids[0] if topic_ids else ""
    is_inquiry = (
        primary.startswith(f"AC9S{profile.year}I")
        or bool(m.get("science_inquiry_skill"))
        or bool(re.search(
            r"\b(investigation|experiment|variable|valid|reliable|fair test|"
            r"sampling|sample size|repeat|anomaly|outlier|line of best fit|controlled study)\b",
            prompt,
        ))
    )
    if not is_inquiry:
        return "not_applicable", ""

    lowered = text.lower()
    communication_terms = (
        "report",
        "communicat",
        "audience",
        "register",
        "formal",
        "precise",
        "summary",
        "conclusion",
        "hypothesis",
        "units",
        "labelled graph",
        "instrument",
        "measurement",
        "measuring",
        "measure",
        "control group",
        "controlled",
        "baseline",
        "comparison",
        "meniscus",
        "resolution",
        "parallax",
    )
    if not any(term in lowered for term in profile.inquiry_gate_terms + communication_terms):
        return "weak", "Inquiry item is not anchored in variables, method, evidence, data, validity or reliability."
    response_parts = [str(ex.get("answer") or ""), str(ex.get("sample_reasoning") or "")]
    response_parts.extend(str(step) for step in ex.get("steps") or [])
    for part in ex.get("sub_parts") or []:
        if isinstance(part, dict):
            response_parts.append(str(part.get("answer") or ""))
    response_lower = " ".join(response_parts).lower()

    asks_variable_system = bool(
        re.search(r"\b(independent and dependent|dependent and independent|iv and dv|independent variable and dependent variable|controlled variables)\b", prompt)
        or re.search(r"\bwhat (?:is|are).{0,40}\bvariable", prompt)
        or re.search(r"\bidentify.{0,40}\bvariables", prompt)
    )
    variables = m.get("variables")
    if asks_variable_system:
        control_subpart_answer = any(
            isinstance(part, dict)
            and re.search(r"\b(controlled variables?|control variables?|variables? that must be controlled|controls?)\b", str(part.get("question") or "").lower())
            and wc(part.get("answer")) >= 3
            for part in ex.get("sub_parts") or []
        )
        asks_controlled = bool(re.search(r"\b(controlled variables?|control variables?|controls?)\b", prompt))
        asks_independent_dependent = bool(
            re.search(r"\b(independent and dependent|dependent and independent|iv and dv|independent variable and dependent variable)\b", prompt)
            or re.search(r"\bidentify.{0,40}\bvariables", prompt)
        )
        has_text_variables = (
            all(term in response_lower for term in ["independent", "dependent"])
            or all(term in response_lower for term in ["iv", "dv"])
        )
        has_text_controls = bool(re.search(r"\b(controlled variables?|control variables?|controls?|kept (?:the )?same|keep (?:the )?same|constant|same)\b", response_lower))
        has_meta_variables = isinstance(variables, dict) and any(
            key in variables for key in ["independent", "dependent", "controlled", "control"]
        )
        has_meta_id = isinstance(variables, dict) and any(key in variables for key in ["independent", "dependent"])
        has_meta_control = isinstance(variables, dict) and any(key in variables for key in ["controlled", "control"])
        if asks_independent_dependent and not (has_text_variables or has_meta_variables or has_meta_id):
            return "thin", "Variable-focused task should identify independent/dependent/control variables."
        if asks_controlled and not (has_text_controls or has_meta_control or control_subpart_answer):
            return "thin", "Variable-focused task should identify controlled variables."

    method_eval_prompt = re.search(
        r"\b(improve|validity|reliability|limitation|assumption|repeatable|repeatability|"
        r"sample size|uncontrolled|controlled variable|fair test|method says|method is|method lacks|"
        r"does not state|doesn't state)\b",
        prompt,
    )
    if profile.year >= 8 and method_eval_prompt:
        if ex.get("question_type") == "multiple_choice":
            return "adequate", ""
        asks_reliability = bool(re.search(r"\b(improve|increase|make|how could|how should).{0,50}\b(reliability|reliable|repeatable|repeatability)\b|\b(reliability|reliable|repeatable|repeatability)\b.{0,50}\b(improve|increase|make)\b", prompt))
        if asks_reliability and not re.search(r"\b(repeat|repeats|repeated|replicate|replication|larger sample|sample size|more trials|average)\b", response_lower):
            return "thin", "Reliability improvement should mention repeats, replication, averaging or larger sample size."
        asks_validity = bool(re.search(r"\b(validity|valid|fair test|uncontrolled|controlled variable|changes? two variables)\b", prompt))
        if asks_validity and re.search(r"\b(changes? two variables|two variables|uncontrolled|controlled variable|fair test)\b", prompt):
            if not re.search(r"\b(control|controlled|keep|kept|constant|same|one variable|only one variable|fair test)\b", response_lower):
                return "thin", "Validity improvement should address the method flaw by controlling variables or changing only one variable."
        if not re.search(r"\b(valid|validity|reliable|reliability|unreliable|repeat|repeats|repeated|repeatable|sample size|control|controlled|controls|accuracy|precision|limitation|confidence)\b", lowered):
            return "thin", "Year 8-10 method-evaluation tasks should address validity, reliability or limitations."

    return "adequate", ""


def data_quality_status(ex: dict[str, Any], data_level: int | None, rep_quality: str) -> tuple[str, str]:
    data_rep = str(meta(ex).get("data_representation") or "")
    if data_level is None and data_rep not in VISUAL_DATA_REP:
        return "not_applicable", ""
    if rep_quality == "not_suitable":
        return "missing_visual_or_data", "Representation is referenced or metadata-tagged but no usable visual/data payload exists."
    if rep_quality == "weak":
        return "thin", "Representation task appears to stop at low-level reading for its difficulty/complexity."

    text = combined_text(ex).lower()
    prompt = prompt_text(ex).lower()
    routine_readoff = (
        ex.get("difficulty") == "foundational"
        or ex.get("complexity") == "simple_familiar"
        or bool(re.search(r"^\s*(which|what|calculate|identify|name|how many|how much)\b", prompt))
    )
    if routine_readoff and rep_quality in {"adequate", "strong"}:
        return "adequate", ""
    if data_rep in {"table", "graph"} and not re.search(r"\b(trend|pattern|increase|decrease|higher|lower|relationship|anomaly|outlier|inconsisten(?:cy|t)|evidence|because|maximum|minimum|range|rate|quickly|slowly|cooling|effective|effectiveness|categor(?:y|ies|ical)|calculate|recovered|recovery|efficiency|compare|arrangement|movement|compressible|gradient|slope|constant speed|equal time|straight line|sloped line)\b", text):
        return "thin", "Data task should make students interpret trend, pattern, anomaly or evidence."
    return "adequate", ""


def diagram_quality_status(ex: dict[str, Any]) -> tuple[str, str]:
    problems = diagram_structural_issues(ex)
    if problems:
        return "structural_issue", "; ".join(problems)

    graph_data = ex.get("graph_data")
    if isinstance(graph_data, dict):
        x_label = str(graph_data.get("x_label") or graph_data.get("xAxisLabel") or "")
        y_label = str(graph_data.get("y_label") or graph_data.get("yAxisLabel") or "")
        if not x_label or not y_label:
            return "semantic_review", "Graph data should include x and y axis labels."
        if not re.search(r"\(.+\)", x_label) or not re.search(r"\(.+\)", y_label):
            return "semantic_review", "Graph axis labels should include units where quantities are graphed."

    dd = ex.get("diagram_data")
    if not isinstance(dd, dict):
        return "not_applicable", ""
    dtype = str(dd.get("type") or "")

    if dtype == "food_web":
        nodes = dd.get("nodes") or (dd.get("food_web") or {}).get("nodes") or []
        links = dd.get("links") or (dd.get("food_web") or {}).get("links") or []
        if not isinstance(nodes, list) or not isinstance(links, list) or not links:
            return "semantic_review", "Food web should include nodes and directional links."
        node_by_id = {str(node.get("id") or ""): node for node in nodes if isinstance(node, dict)}
        producer_terms = re.compile(r"\b(producer|grass|plant|algae|phytoplankton)\b", re.I)
        consumer_terms = re.compile(r"\b(consumer|predator|fox|hawk|snake|rabbit|fish|zooplankton)\b", re.I)
        for link in links:
            if not isinstance(link, dict):
                continue
            source = node_by_id.get(str(link.get("from") or ""))
            target = node_by_id.get(str(link.get("to") or ""))
            source_text = json.dumps(source or {}, ensure_ascii=False)
            target_text = json.dumps(target or {}, ensure_ascii=False)
            if consumer_terms.search(source_text) and producer_terms.search(target_text):
                return "semantic_review", "Food-web arrows appear reversed; arrows should show energy flow from food/prey to consumer."
        labels = " ".join(str(node.get("label") or node.get("id") or "") for node in nodes if isinstance(node, dict)).lower()
        if "producer" not in labels and not re.search(r"\b(grass|plant|algae|phytoplankton)\b", labels):
            return "semantic_review", "Food web should include an identifiable producer."

    if dtype == "particle_model":
        payload = dd.get("particle_model") if isinstance(dd.get("particle_model"), dict) else dd
        text = json.dumps(payload, ensure_ascii=False).lower()
        if not re.search(r"\b(solid|liquid|gas)\b", text):
            return "semantic_review", "Particle model should identify the represented state."
        if not re.search(r"\b(spacing|motion|arrangement|vibration|particles)\b", text):
            return "semantic_review", "Particle model should encode spacing/motion/arrangement information."
        state = str(payload.get("state") or dd.get("state") or "").lower() if isinstance(payload, dict) else ""
        if state == "solid" and re.search(r"\b(far apart|widely spaced|randomly spaced|spread out|fill the container)\b", text):
            return "semantic_review", "Particle model state conflicts with solid particle arrangement."
        if state == "gas" and re.search(r"\b(close together|fixed positions|regular lattice|vibrate in place)\b", text):
            return "semantic_review", "Particle model state conflicts with gas particle arrangement."

    if dtype == "process_flow":
        nodes = dd.get("nodes") or []
        links = dd.get("links") or []
        title = str(dd.get("title") or "").lower()
        is_sequential_flow = bool(dd.get("sequence") or re.search(r"\b(sequence|ordered|step|process flow)\b", title))
        if is_sequential_flow and isinstance(nodes, list) and isinstance(links, list):
            order = {str(node.get("id") or ""): idx for idx, node in enumerate(nodes) if isinstance(node, dict)}
            for link in links:
                if not isinstance(link, dict):
                    continue
                source_idx = order.get(str(link.get("from") or ""))
                target_idx = order.get(str(link.get("to") or ""))
                if source_idx is not None and target_idx is not None and source_idx > target_idx:
                    return "semantic_review", "Process-flow arrows appear to run opposite to the listed process order."

    if dtype == "force_diagram":
        forces = dd.get("forces") or []
        if not isinstance(dd.get("object"), dict) or not isinstance(forces, list) or not forces:
            return "semantic_review", "Force diagram should include an object and at least one force arrow."
        directions = {str(force.get("direction") or "").lower() for force in forces if isinstance(force, dict)}
        if not directions <= {"up", "down", "left", "right"}:
            return "semantic_review", "Force diagram directions should be up, down, left or right."
        if not any(force.get("label") for force in forces if isinstance(force, dict)):
            return "semantic_review", "Force arrows should include labels such as weight, normal, push or friction."
        if not any(force.get("magnitude") is not None for force in forces if isinstance(force, dict)):
            return "semantic_review", "Force arrows should include magnitudes when the question asks for net force or balance."

    if dtype in {"data_table", "simple_bar_chart", "function_graph"}:
        text = json.dumps(dd, ensure_ascii=False).lower()
        if not re.search(r"\b(label|x_label|y_label|headers|rows|title)\b", text):
            return "semantic_review", "Data visual should include labels, headers or a title."
        if dtype == "data_table":
            headers = dd.get("headers")
            rows = dd.get("rows")
            if isinstance(headers, list) and isinstance(rows, list):
                bad_rows = [idx for idx, row in enumerate(rows) if isinstance(row, list) and len(row) != len(headers)]
                if bad_rows:
                    return "structural_issue", "Data-table rows should have the same length as headers."

    return "adequate", ""


def self_study_status(ex: dict[str, Any], profile: YearProfile, cer_status: str, inquiry_status: str) -> tuple[str, str]:
    qt = str(ex.get("question_type") or "")
    if qt != "multiple_choice" and not has_specific_steps(ex, profile):
        return "weak", "Non-MCQ item needs specific teachable steps, not generic prompts."
    if cer_status in {"missing_support", "thin"}:
        return "weak", "CER item needs a stronger model answer/rubric for independent learning."
    if inquiry_status == "weak":
        return "weak", "Inquiry demand is too implicit for self-study."
    return "ready", ""


def exam_prep_status(ex: dict[str, Any], profile: YearProfile, ext_quality: str, data_status: str) -> tuple[str, str]:
    fit = year_fit(ex, profile)
    if fit != "appropriate":
        return "miscalibrated", fit
    if (ex.get("difficulty") == "extending" or ex.get("complexity") == "complex_unfamiliar") and ext_quality in {"weak", "not_suitable"}:
        return "weak_extension", f"extension_quality={ext_quality}"
    if data_status in {"missing_visual_or_data", "thin"} and ex.get("difficulty") != "foundational":
        return "weak_data_interpretation", data_status
    return "ready", ""


def _priority_for_issue(category: str, status: str, *, fact: bool = False) -> str:
    if fact:
        return "P0"
    if status in {"schema", "missing_topic", "invalid_topic", "structural_issue", "missing_visual_or_data"}:
        return "P1"
    if status in {"missing_support", "weak", "thin", "weak_extension", "weak_data_interpretation", "miscalibrated"}:
        return "P2"
    if category in {"curriculum_alignment", "diagram"}:
        return "P2"
    return "P3"


def audit_exercise(
    ex: dict[str, Any],
    profile: YearProfile,
    topic_profiles: dict[str, TopicProfile],
    duplicate_ids: set[str],
    duplicate_questions: set[str] | None = None,
) -> tuple[dict[str, Any], list[IssueFlag]]:
    qid = str(ex.get("id") or "<missing>")
    issues: list[IssueFlag] = []
    m = meta(ex)
    topic_ids = [str(tid) for tid in ex.get("topic_ids") or []]
    primary = topic_ids[0] if topic_ids else ""
    qt = str(ex.get("question_type") or "")
    diff = str(ex.get("difficulty") or "")
    comp = str(ex.get("complexity") or "")

    try:
        ExerciseItem.model_validate(ex)
    except ValidationError as exc:
        first = exc.errors(include_url=False)[0]
        location = ".".join(str(part) for part in first.get("loc", ())) or "item"
        add_issue(
            issues, qid, "P0", "schema", "pydantic_validation",
            f"ExerciseItem validation failed at {location}: {first.get('msg', 'invalid item')}",
            evidence=str(exc),
            recommended_fix="Conform to core.schema.exercise_schema.ExerciseItem.",
        )

    if qid in duplicate_ids:
        add_issue(issues, qid, "P0", "schema", "duplicate_id", "Duplicate exercise id.", recommended_fix="Assign a unique stable id.")
    question_norm = norm_text(ex.get("question"))
    if question_norm and duplicate_questions and question_norm in duplicate_questions:
        add_issue(issues, qid, "P1", "schema", "duplicate_question", "Duplicate question text.", recommended_fix="Rewrite one item so each question assesses a distinct task.")
    if not str(ex.get("question") or "").strip():
        add_issue(issues, qid, "P0", "schema", "missing_question", "Missing question text.", recommended_fix="Add a complete student-facing question.")
    if not str(ex.get("answer") or "").strip():
        add_issue(issues, qid, "P0", "schema", "missing_answer", "Missing model answer.", recommended_fix="Add a concise scientifically correct answer.")
    if ex.get("framework") != "AC9_SCIENCE":
        add_issue(issues, qid, "P1", "schema", "bad_framework", f"framework={ex.get('framework')!r}", recommended_fix="Use framework='AC9_SCIENCE'.")
    if str(ex.get("subject") or "").lower() != "science":
        add_issue(issues, qid, "P1", "schema", "bad_subject", f"subject={ex.get('subject')!r}", recommended_fix="Use subject='science'.")
    if ex.get("year_level") != profile.year:
        add_issue(issues, qid, "P1", "schema", "bad_year_level", f"year_level={ex.get('year_level')!r}", recommended_fix=f"Set year_level={profile.year} or move the item.")
    if qt not in VALID_QTYPES:
        add_issue(issues, qid, "P1", "schema", "bad_question_type", f"question_type={qt!r}", recommended_fix="Use short_answer, multiple_choice, reasoning or multi_part.")
    if diff not in VALID_DIFFICULTY:
        add_issue(issues, qid, "P1", "schema", "bad_difficulty", f"difficulty={diff!r}", recommended_fix="Use foundational, developing or extending.")
    if comp not in VALID_COMPLEXITY:
        add_issue(issues, qid, "P1", "schema", "bad_complexity", f"complexity={comp!r}", recommended_fix="Use simple_familiar, complex_familiar or complex_unfamiliar.")

    complexity_assessment = assess_science_complexity(ex)
    if complexity_assessment.status == "unsupported":
        add_issue(
            issues,
            qid,
            "P2",
            "complexity_calibration",
            "complex_unfamiliar_unsupported",
            complexity_assessment.rationale,
            evidence=", ".join(complexity_assessment.risk_flags),
            recommended_fix=(
                "Review the item against unfamiliar transfer, multiple constraints, evidence synthesis, "
                "data/model interpretation or inquiry evaluation. Retag only after item-level review."
            ),
        )
    elif complexity_assessment.status == "review":
        add_issue(
            issues,
            qid,
            "P3",
            "complexity_calibration",
            "complexity_requires_review",
            complexity_assessment.rationale,
            evidence=", ".join(complexity_assessment.evidence),
            recommended_fix="Confirm the contextual demand or retag after a targeted content review.",
        )
    elif complexity_assessment.status == "review_understated":
        add_issue(
            issues,
            qid,
            "P3",
            "complexity_calibration",
            "complexity_may_be_understated",
            complexity_assessment.rationale,
            evidence=", ".join(complexity_assessment.evidence),
            recommended_fix="Review whether simple_familiar understates the actual task demand.",
        )

    if not isinstance(ex.get("science_metadata"), dict):
        add_issue(issues, qid, "P1", "metadata", "missing_science_metadata", "science_metadata is missing or not an object.", recommended_fix="Add science_metadata with a canonical strand and relevant science flags.")
    if m.get("strand") not in CANONICAL_STRANDS:
        add_issue(issues, qid, "P1", "metadata", "bad_science_strand", f"strand={m.get('strand')!r}", recommended_fix="Use a canonical science strand.")

    if qt == "multiple_choice":
        if not mcq_valid(ex):
            add_issue(issues, qid, "P0", "answer", "mcq_invalid_key", "MCQ choices/correct_choice are invalid.", recommended_fix="Provide choices and a valid A-D correct_choice.")
        else:
            choices = ex.get("choices") or []
            idx = ord(str(ex.get("correct_choice")).upper()) - 65
            answer = norm_text(strip_choice_prefix(ex.get("answer")))
            correct = norm_text(strip_choice_prefix(choices[idx]))
            if answer and answer not in {correct, norm_text(str(ex.get("correct_choice")))} and answer not in correct and correct not in answer:
                add_issue(issues, qid, "P1", "answer", "mcq_answer_mismatch", f"answer={ex.get('answer')!r}; correct={choices[idx]!r}", recommended_fix="Align answer with correct_choice and the choice text.")
    elif qt == "reasoning":
        rubric = ex.get("rubric") if isinstance(ex.get("rubric"), dict) else {}
        key_points = rubric.get("key_points") if isinstance(rubric, dict) else None
        min_points = 4 if profile.year >= 9 else 3
        if not isinstance(key_points, list) or len(key_points) < min_points or int(rubric.get("max_score") or 0) < min_points:
            add_issue(issues, qid, "P1", "rubric", "reasoning_rubric_thin", "Reasoning rubric is missing or too thin.", recommended_fix="Add task-specific key points and a suitable max_score.")
        if not str(ex.get("sample_reasoning") or "").strip():
            add_issue(issues, qid, "P1", "rubric", "reasoning_missing_sample", "Reasoning item lacks sample_reasoning.", recommended_fix="Add a model response for student self-checking and AI marking.")
    elif qt == "multi_part":
        sub_parts = ex.get("sub_parts")
        if not isinstance(sub_parts, list) or len(sub_parts) < 2:
            add_issue(issues, qid, "P1", "schema", "multipart_missing_subparts", "Multi-part item needs at least two sub_parts.", recommended_fix="Add labelled sub_parts with question, answer and marks.")
        else:
            labels: list[str] = []
            uncovered_scored_parts: list[str] = []
            for index, part in enumerate(sub_parts, 1):
                if not isinstance(part, dict):
                    add_issue(issues, qid, "P1", "schema", "multipart_invalid_subpart", f"Sub-part {index} is not an object.", recommended_fix="Use an object with label, question and answer for every sub-part.")
                    continue
                label = str(part.get("label") or "").strip()
                if not label:
                    add_issue(issues, qid, "P1", "schema", "multipart_missing_label", f"Sub-part {index} has no label.", recommended_fix="Add a stable label such as a, b or c.")
                else:
                    labels.append(label.lower())
                if not str(part.get("question") or "").strip() or not str(part.get("answer") or "").strip():
                    add_issue(issues, qid, "P1", "schema", "multipart_subpart_incomplete", f"Sub-part {label or index} needs both question and answer.", recommended_fix="Make every sub-part independently answerable.")
                try:
                    marks = float(part.get("max_score", part.get("marks", 1)) or 0)
                except (TypeError, ValueError):
                    marks = 0.0
                has_part_rubric = isinstance(part.get("rubric"), dict) and bool(part.get("rubric"))
                if marks > 1 and not has_part_rubric and not top_level_rubric_covers_subpart(ex, part):
                    uncovered_scored_parts.append(f"{label or index} ({marks:g} marks)")
            duplicates = sorted(label for label, count in Counter(labels).items() if count > 1)
            if duplicates:
                add_issue(issues, qid, "P0", "schema", "multipart_duplicate_labels", f"Duplicate sub-part labels: {duplicates}.", recommended_fix="Use unique labels so answers and partial credit map to the intended part.")
            if uncovered_scored_parts:
                add_issue(
                    issues, qid, "P2", "rubric", "multipart_part_rubric_missing",
                    "High-mark sub-parts have no traceable rubric criterion: " + ", ".join(uncovered_scored_parts) + ".",
                    recommended_fix="Add task-specific part rubrics or concrete top-level key points that map to every listed part.",
                )

    expected_prefix = f"AC9S{profile.year}"
    for tid in topic_ids:
        if tid not in topic_profiles:
            add_issue(issues, qid, "P1", "curriculum_alignment", "unknown_topic_id", f"{tid} is not in Year {profile.year} curriculum.", recommended_fix="Use a valid AC9 science topic id.")
        elif not tid.startswith(expected_prefix):
            add_issue(issues, qid, "P1", "curriculum_alignment", "wrong_year_topic_id", f"{tid} does not start with {expected_prefix}.", recommended_fix="Use a topic id from the audited year.")

    expected_strand = strand_from_topic_id(primary)
    if expected_strand and m.get("strand") in CANONICAL_STRANDS and m.get("strand") != expected_strand:
        add_issue(issues, qid, "P2", "metadata", "strand_topic_mismatch", f"topic={primary} implies {expected_strand}; metadata={m.get('strand')}", recommended_fix="Align science_metadata.strand with the primary topic.")

    topic_status, topic_evidence = topic_alignment_status(ex, topic_profiles)
    if topic_status in {"missing_topic", "invalid_topic"}:
        add_issue(issues, qid, "P1", "curriculum_alignment", topic_status, topic_evidence, recommended_fix="Repair topic_ids before judging content quality.")
    elif topic_status == "weak":
        add_issue(issues, qid, "P2", "curriculum_alignment", "weak_topic_alignment", topic_evidence, recommended_fix="Rewrite the item so question, answer and steps use the target topic's concepts.")
    elif topic_status == "thin" and diff == "extending":
        add_issue(issues, qid, "P3", "curriculum_alignment", "thin_topic_alignment", topic_evidence, recommended_fix="Strengthen topic-specific wording for an extending item.")

    fact_status, fact_findings = fact_check_status(ex)
    for code, message in fact_findings:
        add_issue(issues, qid, "P0", "factual_accuracy", code, message, recommended_fix="Rewrite the model answer/steps with accurate science wording.", confidence="medium")

    for rubric_path, rubric in iter_rubrics(ex):
        if rubric_is_generic(rubric):
            add_issue(
                issues, qid, "P2", "rubric", "generic_rubric",
                f"Rubric at {rubric_path} contains generic marking filler.",
                recommended_fix="Replace generic wording with task-specific claim, evidence, method or answer criteria.",
            )

    is_cer = is_cer_item(ex)
    is_rep = is_representation_question(ex)
    data_level = infer_data_level(ex, is_rep, is_cer)
    rep_quality = representation_quality(ex, data_level)
    ext_quality = extension_quality(
        ex,
        profile,
        diff == "extending",
        comp == "complex_unfamiliar",
        is_cer,
        is_inquiry_item(ex, combined_text(ex), profile),
        data_level,
    )
    cer_status, cer_evidence = cer_quality_status(ex)
    inquiry_status, inquiry_evidence = inquiry_quality_status(ex, profile)
    safety_status, safety_evidence = safety_quality_status(ex)
    data_status, data_evidence = data_quality_status(ex, data_level, rep_quality)
    diagram_status, diagram_evidence = diagram_quality_status(ex)
    study_status, study_evidence = self_study_status(ex, profile, cer_status, inquiry_status)
    prep_status, prep_evidence = exam_prep_status(ex, profile, ext_quality, data_status)
    tmpl = template_risk(ex)

    status_issues = [
        ("cer", cer_status, cer_evidence, "Strengthen the CER rubric/model answer."),
        ("science_inquiry", inquiry_status, inquiry_evidence, "Add variables, controls, validity/reliability, evidence or method detail."),
        ("safety", safety_status, safety_evidence, "State the specific hazard/harm and a concrete control measure."),
        ("data_representation", data_status, data_evidence, "Add usable data/visuals and require interpretation, not just recall."),
        ("diagram", diagram_status, diagram_evidence, "Fix diagram_data structure and science semantics."),
        ("self_study", study_status, study_evidence, "Add specific steps, rubric or sample reasoning."),
        ("exam_prep", prep_status, prep_evidence, "Retag or increase the cognitive/data/evidence demand."),
    ]
    for category, status, evidence, fix in status_issues:
        if status in {"not_applicable", "adequate", "ready", "strong", PASS_STATUS} or not evidence:
            continue
        add_issue(issues, qid, _priority_for_issue(category, status), category, status, evidence, recommended_fix=fix)

    if tmpl != "none":
        add_issue(issues, qid, "P2" if tmpl == "medium" else "P1", "template", f"template_{tmpl}", "Template-like or placeholder wording detected.", recommended_fix="Rewrite with item-specific science content.")

    top = best_issue(issues, qid)
    row = {
        "id": qid,
        "topic": ex.get("topic") or "",
        "primary_topic_id": primary,
        "question_type": qt,
        "difficulty": diff,
        "complexity": comp,
        "complexity_calibration": complexity_assessment.status,
        "complexity_evidence": ", ".join(complexity_assessment.evidence),
        "complexity_risk_flags": ", ".join(complexity_assessment.risk_flags),
        "strand": m.get("strand") or "",
        "topic_alignment": topic_status,
        "fact_check": fact_status,
        "cer_quality": cer_status,
        "inquiry_quality": inquiry_status,
        "safety_quality": safety_status,
        "data_quality": data_status,
        "diagram_quality": diagram_status,
        "self_study": study_status,
        "exam_prep": prep_status,
        "template_risk": tmpl,
        "main_priority": top.priority if top else "",
        "main_issue": f"{top.category}/{top.code}: {top.message}" if top else "",
        "recommended_fix": top.recommended_fix if top else "",
    }
    return row, issues


def bank_coverage_issues(
    year: int,
    exercises: list[dict[str, Any]],
    topic_profiles: dict[str, TopicProfile],
) -> list[IssueFlag]:
    issues: list[IssueFlag] = []
    linked_counts: Counter[str] = Counter(
        str(topic_id)
        for ex in exercises
        for topic_id in (ex.get("topic_ids") or [])
    )
    difficulty_counts = Counter(str(ex.get("difficulty") or "") for ex in exercises)
    bank_id = f"year{year}_science_bank"
    for topic_id in sorted(topic_profiles):
        count = linked_counts[topic_id]
        if count == 0:
            add_issue(
                issues, bank_id, "P1", "curriculum_alignment", "topic_not_covered",
                f"Curriculum topic {topic_id} has no exercises.",
                recommended_fix=f"Add exercises tagged to {topic_id}.",
            )
        elif count < 3:
            add_issue(
                issues, bank_id, "P2", "curriculum_alignment", "topic_coverage_thin",
                f"Curriculum topic {topic_id} has only {count} linked exercises.",
                recommended_fix=f"Review whether {topic_id} needs broader question coverage.",
                confidence="medium",
            )
    for difficulty in ("foundational", "developing", "extending"):
        if not difficulty_counts[difficulty]:
            add_issue(
                issues, bank_id, "P2", "bank_balance", "difficulty_ladder_incomplete",
                f"The bank has no {difficulty} items.",
                recommended_fix="Provide a complete foundational/developing/extending ladder.",
            )
    return issues


def write_outputs(
    year: int,
    rows: list[dict[str, Any]],
    issues: list[IssueFlag],
    exercises: list[dict[str, Any]],
    out_dir: Path,
    data_file: Path,
    profile: YearProfile,
) -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    prefix = f"year{year}_science_full"
    acceptance_prefix = f"year{year}_science"
    item_path = out_dir / f"{prefix}_item_audit.csv"
    acceptance_item_path = out_dir / f"{acceptance_prefix}_item_audit.csv"
    issue_path = out_dir / f"{prefix}_issue_flags.csv"
    issue_jsonl_path = out_dir / f"{acceptance_prefix}_issue_flags.jsonl"
    hard_errors_path = out_dir / f"{acceptance_prefix}_hard_errors.csv"
    human_review_path = out_dir / f"{acceptance_prefix}_human_review_queue.csv"
    complexity_review_path = out_dir / f"{acceptance_prefix}_complexity_review_queue.csv"
    complexity_sample_path = out_dir / f"{acceptance_prefix}_complexity_stratified_sample.csv"
    checklist_csv = out_dir / f"{prefix}_repair_checklist.csv"
    checklist_md = out_dir / f"{prefix}_repair_checklist.md"
    summary_path = out_dir / f"{prefix}_summary.md"

    with item_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=AUDIT_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    with acceptance_item_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=AUDIT_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)

    issue_rows = [issue.__dict__ for issue in issues]
    issue_rows.sort(key=lambda row: (PRIORITY_ORDER[row["priority"]], row["exercise_id"], row["code"]))
    with issue_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=ISSUE_COLUMNS)
        writer.writeheader()
        writer.writerows(issue_rows)
    with issue_jsonl_path.open("w", encoding="utf-8") as f:
        for row in issue_rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    with hard_errors_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=ISSUE_COLUMNS)
        writer.writeheader()
        writer.writerows(row for row in issue_rows if row["priority"] in {"P0", "P1"})
    with human_review_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=ISSUE_COLUMNS)
        writer.writeheader()
        writer.writerows(row for row in issue_rows if row["priority"] in {"P2", "P3"})

    complexity_review_rows = [_complexity_csv_row(row) for row in complexity_review_queue(exercises)]
    complexity_sample_rows = [
        _complexity_csv_row(row)
        for row in stratified_complexity_sample(exercises, per_topic=2)
    ]
    with complexity_review_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=COMPLEXITY_REVIEW_COLUMNS)
        writer.writeheader()
        writer.writerows(complexity_review_rows)
    with complexity_sample_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=COMPLEXITY_REVIEW_COLUMNS)
        writer.writeheader()
        writer.writerows(complexity_sample_rows)

    checklist_rows = [
        {
            "priority": row["priority"],
            "id": row["exercise_id"],
            "category": row["category"],
            "code": row["code"],
            "message": row["message"],
            "recommended_fix": row["recommended_fix"],
            "confidence": row["confidence"],
        }
        for row in issue_rows
        if row["priority"] in {"P0", "P1", "P2"}
    ]
    with checklist_csv.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["priority", "id", "category", "code", "message", "recommended_fix", "confidence"],
        )
        writer.writeheader()
        writer.writerows(checklist_rows)

    priority_counts = Counter(issue.priority for issue in issues)
    category_counts = Counter(issue.category for issue in issues)
    status_counts = {
        "topic_alignment": Counter(str(row["topic_alignment"]) for row in rows),
        "fact_check": Counter(str(row["fact_check"]) for row in rows),
        "cer_quality": Counter(str(row["cer_quality"]) for row in rows),
        "inquiry_quality": Counter(str(row["inquiry_quality"]) for row in rows),
        "data_quality": Counter(str(row["data_quality"]) for row in rows),
        "diagram_quality": Counter(str(row["diagram_quality"]) for row in rows),
        "self_study": Counter(str(row["self_study"]) for row in rows),
        "exam_prep": Counter(str(row["exam_prep"]) for row in rows),
        "complexity_calibration": Counter(str(row["complexity_calibration"]) for row in rows),
    }

    md_lines = [
        f"# Year {year} Science Full Audit",
        "",
        "## Scope",
        "",
        f"- Data file: `{safe_rel(data_file)}`",
        f"- Items loaded: {len(rows)}",
        f"- Year profile: {profile.label}",
        f"- Complexity review queue: {len(complexity_review_rows)} item(s)",
        f"- Stratified complexity sample: {len(complexity_sample_rows)} item(s)",
        "",
        "## Priority Counts",
        "",
        "| Priority | Meaning | Count |",
        "|---|---|---:|",
        f"| P0 | clear factual/schema/answer blocker | {priority_counts['P0']} |",
        f"| P1 | high-impact quality or marking blocker | {priority_counts['P1']} |",
        f"| P2 | self-study/exam-prep quality repair | {priority_counts['P2']} |",
        f"| P3 | advisory calibration or polish | {priority_counts['P3']} |",
        "",
        "## Category Counts",
        "",
        "| Category | Count |",
        "|---|---:|",
    ]
    if category_counts:
        md_lines.extend(f"| {cat} | {count} |" for cat, count in category_counts.most_common())
    else:
        md_lines.append("| none | 0 |")
    md_lines.extend(["", "## Status Snapshot", "", "| Area | Counts |", "|---|---|"])
    md_lines.extend(f"| {area} | {dict(counts)} |" for area, counts in status_counts.items())
    md_lines.extend(["", "## Repair Checklist", ""])
    if checklist_rows:
        for row in checklist_rows[:120]:
            md_lines.append(
                f"- {row['priority']} `{row['id']}` {row['category']}/{row['code']}: "
                f"{row['message']} Fix: {row['recommended_fix']}"
            )
        if len(checklist_rows) > 120:
            md_lines.append(f"- ... +{len(checklist_rows) - 120} more in CSV")
    else:
        md_lines.append("- No P0-P2 repair items detected.")
    summary_path.write_text("\n".join(md_lines) + "\n", encoding="utf-8")
    checklist_md.write_text("\n".join(md_lines[md_lines.index("## Repair Checklist") :]) + "\n", encoding="utf-8")

    return {
        "year": year,
        "items": len(rows),
        "issues": len(issues),
        "P0": priority_counts["P0"],
        "P1": priority_counts["P1"],
        "P2": priority_counts["P2"],
        "P3": priority_counts["P3"],
        "outputs": {
            "item_audit": safe_rel(item_path),
            "acceptance_item_audit": safe_rel(acceptance_item_path),
            "issue_flags": safe_rel(issue_path),
            "issue_flags_jsonl": safe_rel(issue_jsonl_path),
            "hard_errors": safe_rel(hard_errors_path),
            "human_review_queue": safe_rel(human_review_path),
            "complexity_review_queue": safe_rel(complexity_review_path),
            "complexity_stratified_sample": safe_rel(complexity_sample_path),
            "repair_checklist_csv": safe_rel(checklist_csv),
            "repair_checklist_md": safe_rel(checklist_md),
            "summary": safe_rel(summary_path),
        },
    }


def audit_year(
    year: int,
    *,
    data_dir: Path = DEFAULT_DATA_DIR,
    curriculum_dir: Path = DEFAULT_CURRICULUM_DIR,
    out_dir: Path = DEFAULT_OUT_DIR,
) -> dict[str, Any]:
    profile = YEAR_PROFILES.get(year)
    if profile is None:
        raise ValueError(f"No science audit profile for Year {year}")
    data_file = data_dir / f"exercise_{year}_science.json"
    exercises = load_json(data_file)
    topic_profiles = load_topic_profiles(year, curriculum_dir)
    id_counts = Counter(str(ex.get("id") or "") for ex in exercises)
    duplicate_ids = {qid for qid, count in id_counts.items() if qid and count > 1}
    question_counts = Counter(norm_text(ex.get("question")) for ex in exercises if norm_text(ex.get("question")))
    duplicate_questions = {question for question, count in question_counts.items() if count > 1}

    rows: list[dict[str, Any]] = []
    issues: list[IssueFlag] = []
    for ex in exercises:
        row, ex_issues = audit_exercise(ex, profile, topic_profiles, duplicate_ids, duplicate_questions)
        rows.append(row)
        issues.extend(ex_issues)
    issues.extend(bank_coverage_issues(year, exercises, topic_profiles))

    return write_outputs(year, rows, issues, exercises, out_dir, data_file, profile)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Full AC9 Science bank audit for Years 7-10.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--year", type=int, help="Audit one year level.")
    group.add_argument("--years", nargs="+", type=int, help="Audit selected year levels.")
    group.add_argument("--all", action="store_true", help="Audit Years 7-10.")
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--curriculum-dir", type=Path, default=DEFAULT_CURRICULUM_DIR)
    parser.add_argument("--out", "--out-dir", dest="out_dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--json", action="store_true", help="Print machine-readable summary.")
    parser.add_argument("--fail-on", choices=["none", "P0", "P1", "P2", "P3"], default="none")
    parser.add_argument("--strict", action="store_true", help="Exit 1 when hard errors (P0/P1) are present.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    years = [args.year] if args.year else args.years if args.years else [7, 8, 9, 10]
    results = [
        audit_year(year, data_dir=args.data_dir, curriculum_dir=args.curriculum_dir, out_dir=args.out_dir)
        for year in years
    ]

    if args.json:
        print(json.dumps(results, indent=2))
    else:
        for result in results:
            print(
                "Year {year}: items={items}, issues={issues}, "
                "P0={P0}, P1={P1}, P2={P2}, P3={P3}".format(**result)
            )

    fail_on = "P1" if args.strict else args.fail_on
    if fail_on != "none":
        max_allowed = PRIORITY_ORDER[fail_on]
        for result in results:
            for priority, value in PRIORITY_ORDER.items():
                if value <= max_allowed and result.get(priority, 0):
                    return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
