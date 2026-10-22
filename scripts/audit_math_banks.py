#!/usr/bin/env python3
"""Full-bank heuristic audit for Year 7-10 AC9 Mathematics exercise banks.

This is a content-quality audit helper, not the authoritative schema validator.
Run scripts/check_exercises.py after content edits for hard schema validation.

Outputs per-year files:
- audit_output/year{n}_math_question_audit.csv
- audit_output/year{n}_math_issue_flags.csv
- audit_output/year{n}_math_audit_summary.md

Math-specific focus:
- working/steps quality and expected_working_steps metadata
- MCQ answer/choice alignment
- reasoning rubric/sample_reasoning support
- mathematical representation and diagram/table/graph support
- extending difficulty calibration
- AMC/non-routine challenge calibration and year-fit checks
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

if str(Path(__file__).resolve().parents[1]) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pydantic import ValidationError
from core.schema.exercise_schema import ExerciseItem
from audit_math_bank_full import (
    compound_short_answer_needs_review,
    top_level_rubric_covers_subpart,
    verify_maths,
    mcq_answer_matches_choice,
)

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_DIR = ROOT / "data"
DEFAULT_OUT_DIR = ROOT / "audit_output"

VALID_QTYPES = {"short_answer", "multiple_choice", "reasoning", "multi_part"}
VALID_DIFFICULTY = {"foundational", "developing", "extending", "AMC"}
VALID_COMPLEXITY = {"simple_familiar", "complex_familiar", "complex_unfamiliar"}
VALID_CHOICES = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ")


@dataclass(frozen=True)
class YearProfile:
    year: int
    label: str
    topic_prefix: str
    extension_threshold: int
    amc_threshold: int
    overreach_terms: re.Pattern[str] | None
    extension_note: str
    amc_note: str


def _rx(pattern: str) -> re.Pattern[str]:
    return re.compile(pattern, re.IGNORECASE)


YEAR_PROFILES: dict[int, YearProfile] = {
    7: YearProfile(
        year=7,
        label="Year 7 mathematics: number, algebra, measurement, space, statistics and probability foundations",
        topic_prefix="AC9M7",
        extension_threshold=3,
        amc_threshold=4,
        overreach_terms=_rx(r"\b(quadratic formula|sine rule|cosine rule|logarithm|derivative|integral|matrix|complex number|binomial theorem)\b"),
        extension_note="Year 7 extending should require multi-step reasoning, unfamiliar transfer, justification, proof-lite, or structured problem solving.",
        amc_note="Year 7 AMC items should be non-routine but still solvable with Year 7 number/algebra/geometry reasoning, not senior formulas.",
    ),
    8: YearProfile(
        year=8,
        label="Year 8 mathematics: indices, algebra, linear relationships, geometry, measurement, statistics and probability",
        topic_prefix="AC9M8",
        extension_threshold=3,
        amc_threshold=4,
        overreach_terms=_rx(r"\b(derivative|integral|logarithm|quadratic formula|trigonometric identity|matrix|complex number|vectors?|binomial theorem)\b"),
        extension_note="Year 8 extending should require algebraic structure, model interpretation, multi-step geometry, data reasoning, or justification.",
        amc_note="Year 8 AMC items should involve non-routine counting, reverse percentage, algebraic structure, invariants, constraints or strategic geometry.",
    ),
    9: YearProfile(
        year=9,
        label="Year 9 mathematics: real numbers, algebra, quadratics, coordinate geometry, trigonometry, measurement, statistics and probability",
        topic_prefix="AC9M9",
        extension_threshold=3,
        amc_threshold=4,
        overreach_terms=_rx(r"\b(derivative|integral|matrix|complex number|logarithm law|calculus|normal distribution)\b"),
        extension_note="Year 9 extending should require unfamiliar application, equation/model formation, proof/justification, multi-step graph/geometry reasoning or data interpretation.",
        amc_note="Year 9 AMC items should require strategic selection of methods, constraints, proof-lite reasoning, algebraic insight or non-routine counting/probability.",
    ),
    10: YearProfile(
        year=10,
        label="Year 10 mathematics: approximation, algebra, functions, geometry/trigonometry, networks, statistics and probability",
        topic_prefix="AC9M10",
        extension_threshold=3,
        amc_threshold=4,
        overreach_terms=_rx(r"\b(derivative|integral|matrix|complex number|eigen|normal distribution|tangent to a curve by differentiation)\b"),
        extension_note="Year 10 extending should be senior-prep: multi-step modelling, unfamiliar functions/graphs, proof/justification, optimisation-lite or validity critique.",
        amc_note="Year 10 AMC items should be non-routine and strategic without relying on senior calculus or unsupported specialist methods.",
    ),
}

MATH_TERMS_RE = _rx(
    r"\b(fraction|decimal|percent|ratio|rate|index|indices|surd|sqrt|factor|multiple|prime|integer|"
    r"equation|expression|expand|factorise|substitute|linear|quadratic|gradient|intercept|graph|function|"
    r"angle|triangle|polygon|circle|area|volume|surface area|perimeter|Pythagoras|trigonometry|similar|congruent|"
    r"mean|median|mode|range|IQR|quartile|probability|sample space|tree diagram|frequency|scatter|box plot|network)\b"
)

NON_ROUTINE_RE = _rx(
    r"\b(prove|justify|show that|find all|how many|number of ways|must be|cannot|always|never|only|exactly|"
    r"maximum|minimum|least|greatest|smallest|possible|impossible|reverse|working backwards|constraint|invariant|"
    r"without finding|not enough information|compare|strategy|efficient|generalise|derive|explain why)\b"
)

ROUTINE_STEM_RE = _rx(
    r"^\s*(calculate|evaluate|simplify|solve|expand|factorise|find|convert|write|round|state|identify|which|what)\b"
)

LOW_DEMAND_MCQ_RE = _rx(r"^\s*(which|what|calculate|evaluate|identify|select|choose|find)\b")
REP_CONTEXT_RE = _rx(r"\b(graph|table|diagram|plot|axis|axes|coordinate plane|number line|box plot|histogram|scatterplot|tree diagram|sample space|network|figure)\b")
REP_DEPENDENCY_RE = _rx(
    r"\b(?:shown|displayed|pictured|illustrated)\b|"
    r"\b(?:the|this|following|above|below)\s+(?:graph|table|diagram|plot|figure|number line|network)\b|"
    r"\b(?:from|using|refer to|according to)\s+(?:the|this|following|above|below)\s+(?:graph|table|diagram|plot|figure|number line|network)\b"
)
REP_CREATION_RE = _rx(r"\b(?:construct|draw|create|design|sketch|make|complete|fill)\b")
REP_SELF_CONTAINED_RE = _rx(
    r"\b(?:means|defined as|for example|following description|shape has|"
    r"quadrilateral with|figure has|covers (?:it|the figure) up)\b"
)
LATEX_RISK_RE = _rx(
    r"\\frac(?=\s*(?:\$|$|[.,;:]))|"
    r"\\sqrt(?:\s*\[[^\]]+\])?(?=\s*(?:\$|$|[.,;:]))"
)
GENERIC_STEP_RE = _rx(r"identify the topic|link the rule to the context|state any units|compare the options|reject distractors|accepted answer")
GENERIC_RUBRIC_RE = _rx(r"identifies the relevant|uses specific details|explains why the answer is valid|appropriate mathematical techniques|clear conclusion")


def meta(ex: dict[str, Any]) -> dict[str, Any]:
    m = ex.get("math_metadata")
    return m if isinstance(m, dict) else {}


def words(value: Any) -> int:
    return len(re.findall(r"[A-Za-z0-9]+", str(value or "")))


def combined_text(ex: dict[str, Any]) -> str:
    parts: list[str] = []
    for key in ["id", "topic", "question", "answer", "sample_reasoning"]:
        val = ex.get(key)
        if val:
            parts.append(str(val))
    for step in ex.get("steps") or []:
        parts.append(str(step))
    m = meta(ex)
    for key in ["strand", "sub_strand", "skill", "strategy_focus", "common_misconception", "common_misconceptions", "representation_type"]:
        val = m.get(key)
        if val:
            parts.append(str(val))
    for step in m.get("expected_working_steps") or []:
        parts.append(str(step))
    return "\n".join(parts)


def load_curriculum_topics(data_dir: Path, year: int) -> set[str]:
    path = data_dir / "curriculum" / "ac9_maths" / f"year{year}.json"
    if not path.exists():
        return set()
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    topics: set[str] = set()

    def collect(value: Any) -> None:
        if isinstance(value, dict):
            if value.get("topic_id"):
                topics.add(str(value["topic_id"]))
            for child in value.values():
                collect(child)
        elif isinstance(value, list):
            for child in value:
                collect(child)

    collect(payload)
    return topics


def safe_rel(path: Path, root: Path) -> str:
    try:
        return str(path.resolve().relative_to(root.resolve()))
    except ValueError:
        return str(path.resolve())


def rubric_text(ex: dict[str, Any]) -> str:
    rubric = ex.get("rubric") or {}
    if not isinstance(rubric, dict):
        return ""
    return json.dumps(rubric, ensure_ascii=False).lower()


def add_issue(issues: list[dict[str, str]], qid: str, issue_type: str, severity: str, evidence: str, recommended_fix: str) -> None:
    issues.append(
        {
            "id": qid,
            "issue_type": issue_type,
            "severity": severity,
            "evidence": evidence,
            "recommended_fix": recommended_fix,
        }
    )


def risk_max(current: str, new: str) -> str:
    order = {"none": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}
    return new if order[new] > order[current] else current


def mcq_valid(ex: dict[str, Any]) -> bool:
    """Validate the canonical dynamic-choice MCQ contract."""
    choices = ex.get("choices")
    correct = str(ex.get("correct_choice") or "").strip().upper()
    if not isinstance(choices, list) or len(choices) < 2:
        return False
    if correct not in VALID_CHOICES:
        return False
    idx = ord(correct) - ord("A")
    if idx < 0 or idx >= len(choices):
        return False
    if not str(ex.get("answer") or "").strip():
        return False
    return mcq_answer_matches_choice(ex)


def has_specific_working(ex: dict[str, Any]) -> bool:
    steps = ex.get("steps") or []
    expected = meta(ex).get("expected_working_steps") or []
    text = "\n".join(str(s) for s in list(steps) + list(expected))
    if not text.strip():
        return False
    has_math_symbol = bool(re.search(r"\d|=|\\frac|\\sqrt|\^|\+|-|\*|/|%|°|cm|m\b|kg|\$", text))
    generic_hits = len(GENERIC_STEP_RE.findall(text))
    return has_math_symbol and generic_hits < max(2, len(steps) + len(expected))


def representation_quality(ex: dict[str, Any]) -> str:
    representation_parts = [str(ex.get("question") or "")]
    has_visual = bool(
        ex.get("diagram_data")
        or str(ex.get("diagram_description") or "").strip()
        or ex.get("image")
    )
    for part in ex.get("sub_parts") or []:
        if not isinstance(part, dict):
            continue
        representation_parts.append(str(part.get("question") or ""))
        has_visual = has_visual or bool(
            part.get("diagram_data")
            or str(part.get("diagram_description") or "").strip()
            or part.get("image")
        )
    question = "\n".join(representation_parts)
    if not REP_CONTEXT_RE.search(question):
        return "not_applicable"
    if REP_SELF_CONTAINED_RE.search(question):
        return "adequate"
    has_structured_data = bool(re.search(
        r"\|.+\||\\mid|\b(data (?:are|is|below)|values are|coordinates?|points?|vertices?)\b",
        question,
        re.I,
    ))
    rep_type = str(meta(ex).get("representation_type") or "")
    if has_visual or has_structured_data or rep_type:
        if re.search(
            r"\b(explain|interpret|compare|trend|relationship|gradient|intercept|area|probability|justify|model)\b",
            question,
            re.I,
        ):
            return "strong"
        return "adequate"
    if REP_CREATION_RE.search(question):
        return "adequate"
    if re.search(r"\bgraph shows\b", question, re.I):
        return "adequate"
    if "=" in question and len(re.findall(r"\d+(?:\.\d+)?", question)) >= 2:
        return "adequate"
    return "weak" if REP_DEPENDENCY_RE.search(question) else "not_applicable"


def extension_quality(ex: dict[str, Any], profile: YearProfile) -> str:
    is_challenge = ex.get("difficulty") in {"extending", "AMC"} or ex.get("complexity") == "complex_unfamiliar"
    if not is_challenge:
        return "not_applicable"

    qtype = str(ex.get("question_type") or "")
    text = combined_text(ex)
    qtext = str(ex.get("question") or "")
    step_count = len(ex.get("steps") or [])
    expected_count = len(meta(ex).get("expected_working_steps") or [])

    demand = 0
    demand += 2 if NON_ROUTINE_RE.search(text) else 0
    demand += 1 if qtype in {"reasoning", "multi_part"} else 0
    demand += 1 if step_count >= 3 or expected_count >= 3 else 0
    demand += 1 if re.search(r"\b(explain|justify|prove|show|derive|interpret|model|compare|predict|evaluate)\b", qtext, re.I) else 0
    demand += 1 if re.search(r"\b(two|three|both|all|each|in order|sequence|system|constraint|condition|case)\b", text, re.I) else 0
    demand += 1 if words(ex.get("answer")) >= 25 or words(ex.get("sample_reasoning")) >= 40 else 0
    demand += 1 if has_specific_working(ex) else 0

    if qtype == "multiple_choice":
        # MCQ extension must be stricter: obvious one-step MCQs should not be extension.
        if LOW_DEMAND_MCQ_RE.search(qtext) and demand < profile.extension_threshold + 2:
            return "weak" if demand >= profile.extension_threshold else "not_suitable"
        demand -= 1

    if ROUTINE_STEM_RE.search(qtext) and not NON_ROUTINE_RE.search(text) and demand <= profile.extension_threshold:
        return "weak" if demand >= profile.extension_threshold - 1 else "not_suitable"

    if demand >= profile.extension_threshold + 2:
        return "strong"
    if demand >= profile.extension_threshold:
        return "adequate"
    if demand == profile.extension_threshold - 1:
        return "weak"
    return "not_suitable"


def amc_quality(ex: dict[str, Any], profile: YearProfile) -> str:
    if ex.get("difficulty") != "AMC":
        return "not_applicable"
    text = combined_text(ex)
    qtext = str(ex.get("question") or "")
    qtype = str(ex.get("question_type") or "")
    step_count = len(ex.get("steps") or [])
    expected_count = len(meta(ex).get("expected_working_steps") or [])

    demand = 0
    demand += 2 if NON_ROUTINE_RE.search(text) else 0
    demand += 1 if qtype in {"short_answer", "reasoning", "multi_part"} else 0
    demand += 1 if step_count >= 4 or expected_count >= 4 else 0
    demand += 1 if re.search(r"\b(count|ordered pairs|arrangements|possible|integer|whole number|divisor|factor|reverse|percentage|area|perimeter|constraint|prove|only solution|without)\b", text, re.I) else 0
    demand += 1 if re.search(r"\b(find all|how many|must|cannot|exactly|least|greatest|between|minimum|maximum)\b", text, re.I) else 0
    demand += 1 if has_specific_working(ex) else 0

    if profile.overreach_terms and profile.overreach_terms.search(text):
        return "possibly_too_advanced"
    if ex.get("complexity") != "complex_unfamiliar":
        return "weak"
    if ROUTINE_STEM_RE.search(qtext) and not NON_ROUTINE_RE.search(text) and demand < profile.amc_threshold + 1:
        return "not_suitable"
    if demand >= profile.amc_threshold + 2:
        return "strong"
    if demand >= profile.amc_threshold:
        return "adequate"
    if demand == profile.amc_threshold - 1:
        return "weak"
    return "not_suitable"


def year_fit(ex: dict[str, Any], profile: YearProfile) -> str:
    text = "\n".join(
        str(value or "")
        for value in (ex.get("topic"), ex.get("question"), meta(ex).get("skill"))
    )
    text = re.sub(r"\\(?:begin|end)\{matrix\}", "", text, flags=re.I)
    if profile.overreach_terms and profile.overreach_terms.search(text):
        return "possibly_too_advanced"
    if ex.get("difficulty") == "foundational" and ex.get("complexity") == "complex_unfamiliar":
        return "miscalibrated"
    if ex.get("difficulty") in {"extending", "AMC"} and ex.get("complexity") == "simple_familiar":
        return "miscalibrated"
    return "appropriate"


def latex_risk(ex: dict[str, Any]) -> bool:
    text = combined_text(ex)
    # Ignore escaped currency dollars when checking math-mode delimiter balance.
    unescaped_dollars = re.findall(r"(?<!\\)\$", text)
    if len(unescaped_dollars) % 2 != 0:
        return True
    return bool(LATEX_RISK_RE.search(text))


def choose_main_issue(issues: list[dict[str, str]], qid: str) -> tuple[str, str, str]:
    order = {"critical": 4, "high": 3, "medium": 2, "low": 1}
    qissues = [issue for issue in issues if issue["id"] == qid]
    if not qissues:
        return "none", "none", ""
    qissues.sort(key=lambda issue: order[issue["severity"]], reverse=True)
    top = qissues[0]
    return f"{top['issue_type']}: {top['evidence']}", top["severity"], top["recommended_fix"]


def score_from_counts(total: int, bad: int) -> int:
    if total <= 0 or bad <= 0:
        return 5
    ratio = bad / total
    if ratio <= 0.03:
        return 4
    if ratio <= 0.10:
        return 3
    if ratio <= 0.25:
        return 2
    return 1


def audit_bank(data_file: Path, out_dir: Path, profile: YearProfile) -> dict[str, Any]:
    exercises = [
        ex for ex in json.loads(data_file.read_text(encoding="utf-8-sig"))
        if isinstance(ex, dict) and ex.get("status", "active") == "active"
    ]
    valid_topic_ids = load_curriculum_topics(data_file.parent, profile.year)
    out_dir.mkdir(parents=True, exist_ok=True)
    prefix = f"year{profile.year}_math"
    ids = Counter(str(ex.get("id") or "") for ex in exercises)
    rows: list[dict[str, Any]] = []
    issues: list[dict[str, str]] = []

    qtype_counts: Counter[str] = Counter()
    difficulty_counts: Counter[str] = Counter()
    complexity_counts: Counter[str] = Counter()
    strand_counts: Counter[str] = Counter()
    topic_counts: Counter[str] = Counter()
    covered_topic_ids: set[str] = set()

    for ex in exercises:
        qid = str(ex.get("id") or "unknown")
        m = meta(ex)
        qt = str(ex.get("question_type") or "")
        diff = str(ex.get("difficulty") or "")
        comp = str(ex.get("complexity") or "")
        topic_ids = ex.get("topic_ids") or []
        primary_topic = str(topic_ids[0]) if topic_ids else "missing"
        strand = str(m.get("strand") or "")
        skill = str(m.get("skill") or "")
        text = combined_text(ex)
        answer = str(ex.get("answer") or "")
        steps = ex.get("steps") or []
        expected_steps = m.get("expected_working_steps") or []
        has_answer = bool(answer.strip())
        has_steps = isinstance(steps, list) and bool(steps)
        has_rubric = isinstance(ex.get("rubric"), dict) and bool(ex.get("rubric"))
        has_sample = bool(str(ex.get("sample_reasoning") or "").strip())
        has_sub_parts = isinstance(ex.get("sub_parts"), list) and bool(ex.get("sub_parts"))
        correct_choice_valid = mcq_valid(ex)

        qtype_counts[qt] += 1
        difficulty_counts[diff] += 1
        complexity_counts[comp] += 1
        strand_counts[strand or "missing"] += 1
        topic_counts[primary_topic] += 1
        covered_topic_ids.update(str(tid) for tid in topic_ids)

        self_risk = "none"
        exam_risk = "none"
        ai_risk = "none"

        try:
            ExerciseItem.model_validate(ex)
        except ValidationError as exc:
            first = exc.errors(include_url=False)[0]
            location = ".".join(str(part) for part in first.get("loc", ())) or "item"
            add_issue(
                issues, qid, "schema", "critical",
                f"ExerciseItem validation failed at {location}: {first.get('msg', 'invalid value')}",
                "Conform to core.schema.exercise_schema.ExerciseItem.",
            )

        if ids[qid] > 1:
            add_issue(issues, qid, "schema", "critical", "Duplicate id", "Give every question a unique stable id.")
        if not str(ex.get("question") or "").strip():
            add_issue(issues, qid, "schema", "critical", "Missing question", "Add a clear question stem.")
            self_risk = risk_max(self_risk, "critical")
        if not has_answer:
            add_issue(issues, qid, "schema", "critical", "Missing answer", "Add a concise correct answer.")
            self_risk = risk_max(self_risk, "critical")
            exam_risk = risk_max(exam_risk, "critical")
        if str(ex.get("framework") or "") != "AC9_MATHS":
            add_issue(issues, qid, "schema", "high", f"framework={ex.get('framework')!r}", "Math banks should use framework='AC9_MATHS'.")
        if str(ex.get("subject") or "").lower() != "math":
            add_issue(issues, qid, "schema", "high", f"subject={ex.get('subject')!r}", "Math banks should use subject='math'.")
        if ex.get("year_level") != profile.year:
            add_issue(issues, qid, "schema", "high", f"year_level={ex.get('year_level')!r}; expected={profile.year}", "Move the item to the correct bank or fix year_level.")
        if not isinstance(topic_ids, list) or not topic_ids:
            add_issue(issues, qid, "schema", "high", "Missing topic_ids", "Add at least one AC9 mathematics topic id.")
        else:
            bad_topic_ids = [str(tid) for tid in topic_ids if not str(tid).startswith(profile.topic_prefix)]
            if bad_topic_ids:
                add_issue(issues, qid, "curriculum_alignment", "high", f"topic_ids={bad_topic_ids}; expected prefix {profile.topic_prefix}", "Use topic_ids from the audited year level.")
            unknown_topic_ids = [str(tid) for tid in topic_ids if valid_topic_ids and str(tid) not in valid_topic_ids]
            if unknown_topic_ids:
                add_issue(issues, qid, "curriculum_alignment", "high", f"Unknown curriculum topic_ids={unknown_topic_ids}", "Use topic_ids present in the Year curriculum slice.")
        if qt not in VALID_QTYPES:
            add_issue(issues, qid, "schema", "high", f"question_type={qt!r}", "Use short_answer, multiple_choice, reasoning, or multi_part.")
        if diff not in VALID_DIFFICULTY:
            add_issue(issues, qid, "schema", "medium", f"difficulty={diff!r}", "Use foundational/developing/extending/AMC.")
        if comp not in VALID_COMPLEXITY:
            add_issue(issues, qid, "schema", "medium", f"complexity={comp!r}", "Use simple_familiar/complex_familiar/complex_unfamiliar.")

        if not isinstance(m, dict) or not m:
            add_issue(issues, qid, "math_metadata", "high", "Missing math_metadata", "Add strand, sub_strand, skill and expected_working_steps.")
            self_risk = risk_max(self_risk, "high")
        else:
            for key in ["strand", "sub_strand", "skill"]:
                if not str(m.get(key) or "").strip():
                    add_issue(issues, qid, "math_metadata", "medium", f"Missing math_metadata.{key}", f"Add math_metadata.{key}.")
            if profile.year >= 8 and "calculator_allowed" not in m:
                add_issue(issues, qid, "calculator", "low", "Missing calculator_allowed metadata", "State whether calculator use is allowed for this item.")
            if diff in {"developing", "extending", "AMC"} and (not isinstance(expected_steps, list) or not expected_steps):
                add_issue(issues, qid, "steps", "medium", "Missing math_metadata.expected_working_steps", "Add worked mathematical steps used for self-study and marking support.")
                self_risk = risk_max(self_risk, "medium")

        if qt == "multiple_choice":
            if not correct_choice_valid:
                add_issue(issues, qid, "multiple_choice", "critical", "choices/correct_choice/answer are not aligned", "Ensure at least two choices and correct_choice points to the selected option.")
                self_risk = risk_max(self_risk, "critical")
                exam_risk = risk_max(exam_risk, "critical")
            choices = ex.get("choices") or []
            if isinstance(choices, list) and len({str(c).strip() for c in choices}) != len(choices):
                add_issue(issues, qid, "multiple_choice", "high", "Duplicate MCQ choices", "Make all distractors distinct and mathematically meaningful.")
        elif qt == "reasoning":
            if not has_rubric:
                add_issue(issues, qid, "rubric", "high", "Reasoning item missing rubric", "Add key_points and max_score for AI/self-check marking.")
                ai_risk = risk_max(ai_risk, "high")
            if not has_sample:
                add_issue(issues, qid, "sample_reasoning", "high", "Reasoning item missing sample_reasoning", "Add a model reasoning response.")
                ai_risk = risk_max(ai_risk, "high")
            if has_rubric:
                rtext = rubric_text(ex)
                key_points = (ex.get("rubric") or {}).get("key_points") or []
                if not isinstance(key_points, list) or len(key_points) < 3:
                    add_issue(issues, qid, "rubric", "medium", "Reasoning rubric too thin", "Use at least three task-specific mathematical reasoning points.")
                    ai_risk = risk_max(ai_risk, "medium")
                if GENERIC_RUBRIC_RE.search(rtext) and not re.search(r"\d|=|\\frac|\\sqrt|gradient|angle|probability|factor|intercept", rtext):
                    add_issue(issues, qid, "rubric", "medium", "Reasoning rubric appears generic", "Make rubric key_points specific to the mathematics in the item.")
                    ai_risk = risk_max(ai_risk, "medium")
        elif qt == "multi_part":
            if not has_sub_parts:
                add_issue(issues, qid, "multi_part", "critical", "Multi-part item missing sub_parts", "Add labelled sub_parts with separate answers.")
            else:
                labels: list[str] = []
                for idx, part in enumerate(ex.get("sub_parts") or []):
                    if not isinstance(part, dict):
                        add_issue(issues, qid, "multi_part", "high", f"Sub-part {idx + 1} is not an object", "Use an object with label, question and answer.")
                        self_risk = risk_max(self_risk, "high")
                        continue
                    label = str(part.get("label") or "").strip()
                    if label:
                        labels.append(label.lower())
                    if not str(part.get("question") or "").strip() or not str(part.get("answer") or "").strip():
                        add_issue(issues, qid, "multi_part", "high", f"Sub-part {idx + 1} missing question or answer", "Complete all sub_parts.")
                        self_risk = risk_max(self_risk, "high")
                    try:
                        part_max = float(part.get("max_score", part.get("marks", 1)) or 0)
                    except (TypeError, ValueError):
                        part_max = 0.0
                    has_part_rubric = isinstance(part.get("rubric"), dict) and bool(part.get("rubric"))
                    if part_max > 1 and not has_part_rubric and not top_level_rubric_covers_subpart(ex, part):
                        add_issue(
                            issues, qid, "rubric", "medium",
                            f"Sub-part {label or idx + 1} is worth {part_max:g} marks but has no traceable rubric criterion",
                            "Add a task-specific part rubric or a concrete top-level key point that maps to this part.",
                        )
                        ai_risk = risk_max(ai_risk, "medium")
                    part_rubric = part.get("rubric")
                    if isinstance(part_rubric, dict) and part_rubric:
                        part_rubric_text = json.dumps(part_rubric, ensure_ascii=False)
                        if GENERIC_RUBRIC_RE.search(part_rubric_text) and not re.search(
                            r"\d|=|\\frac|\\sqrt|gradient|angle|probability|factor|intercept",
                            part_rubric_text,
                        ):
                            add_issue(
                                issues, qid, "rubric", "medium",
                                f"Sub-part {label or idx + 1} rubric appears generic",
                                "Make each sub-part rubric point specific to that part's mathematics and answer.",
                            )
                            ai_risk = risk_max(ai_risk, "medium")
                duplicate_labels = sorted(label for label, count in Counter(labels).items() if count > 1)
                if duplicate_labels:
                    add_issue(
                        issues, qid, "multi_part", "high",
                        f"Duplicate sub-part labels: {duplicate_labels}",
                        "Use unique labels so answers and partial credit map to the intended part.",
                    )
                    self_risk = risk_max(self_risk, "high")

        if compound_short_answer_needs_review(ex):
            add_issue(
                issues, qid, "answer_completeness", "medium",
                "Short-answer prompt appears to request multiple outputs, but the answer may be incomplete",
                "Check that every requested calculation, conclusion, explanation, prediction, or labelled part is answered.",
            )

        maths_result = verify_maths(ex)
        if maths_result.status == "incorrect" and maths_result.confidence == "high":
            add_issue(
                issues, qid, "maths_correctness", "high",
                f"{maths_result.skill}: {maths_result.evidence}",
                maths_result.recommended_fix or "Recalculate the answer and worked steps.",
            )
            self_risk = risk_max(self_risk, "high")
            exam_risk = risk_max(exam_risk, "high")

        if not has_steps:
            add_issue(issues, qid, "steps", "medium", "Missing visible steps", "Add worked steps for self-study feedback.")
            self_risk = risk_max(self_risk, "medium")
        elif diff in {"extending", "AMC"} and len(steps) < 3 and qt != "multiple_choice":
            add_issue(issues, qid, "steps", "medium", "Challenging item has too few visible steps", "Provide multi-step working that explains the strategy, not just the final calculation.")
            self_risk = risk_max(self_risk, "medium")
        elif not has_specific_working(ex) and qt != "multiple_choice":
            add_issue(issues, qid, "steps", "medium", "Steps look generic or lack mathematical working", "Include concrete operations, equations, substitutions, diagrams or comparisons.")
            self_risk = risk_max(self_risk, "medium")

        if latex_risk(ex):
            add_issue(issues, qid, "latex", "medium", "Possible LaTeX/rendering risk", "Check dollar delimiters and commands such as \\frac{...}{...} and \\sqrt{...}.")
            self_risk = risk_max(self_risk, "medium")

        rep_quality = representation_quality(ex)
        if rep_quality == "weak":
            add_issue(issues, qid, "representation", "high", "Question references a graph/table/diagram but lacks usable representation/data", "Add diagram_data/diagram_description or include enough data in the question.")
            self_risk = risk_max(self_risk, "high")
            exam_risk = risk_max(exam_risk, "high")

        ext_quality = extension_quality(ex, profile)
        if ext_quality == "not_suitable":
            add_issue(issues, qid, "extension", "high", "extension_quality=not_suitable; task demand appears routine", profile.extension_note)
            exam_risk = risk_max(exam_risk, "high")
        elif ext_quality == "weak":
            add_issue(issues, qid, "extension", "medium", "extension_quality=weak; task demand appears routine", profile.extension_note)
            exam_risk = risk_max(exam_risk, "medium")

        amc_q = amc_quality(ex, profile)
        if amc_q == "possibly_too_advanced":
            add_issue(issues, qid, "amc_quality", "high", "AMC item may rely on content beyond this year level", profile.amc_note)
            exam_risk = risk_max(exam_risk, "high")
        elif amc_q == "not_suitable":
            add_issue(issues, qid, "amc_quality", "high", "AMC item appears routine rather than non-routine", profile.amc_note)
            exam_risk = risk_max(exam_risk, "high")
        elif amc_q == "weak":
            add_issue(issues, qid, "amc_quality", "medium", "AMC item is only weakly non-routine", profile.amc_note)
            exam_risk = risk_max(exam_risk, "medium")

        fit = year_fit(ex, profile)
        if fit == "possibly_too_advanced":
            add_issue(issues, qid, "year_fit", "high", "Potentially beyond year-level content", "Retag, scaffold, or replace with year-appropriate reasoning.")
            exam_risk = risk_max(exam_risk, "high")
        elif fit == "miscalibrated":
            add_issue(issues, qid, "year_fit", "medium", "difficulty/complexity combination is miscalibrated", "Retag difficulty/complexity or increase/decrease task demand.")

        main_issue, main_severity, recommended_fix = choose_main_issue(issues, qid)
        rows.append(
            {
                "id": qid,
                "topic_id": primary_topic,
                "topic": ex.get("topic"),
                "question_type": qt,
                "difficulty": diff,
                "complexity": comp,
                "strand": strand,
                "sub_strand": m.get("sub_strand"),
                "skill": skill,
                "is_amc": diff == "AMC",
                "is_extending": diff in {"extending", "AMC"} or comp == "complex_unfamiliar",
                "steps_count": len(steps),
                "expected_steps_count": len(expected_steps) if isinstance(expected_steps, list) else 0,
                "has_specific_working": has_specific_working(ex),
                "representation_quality": rep_quality,
                "extension_quality": ext_quality,
                "amc_quality": amc_q,
                "year_fit": fit,
                "self_study_risk": self_risk,
                "exam_risk": exam_risk,
                "ai_marking_risk": ai_risk,
                "main_issue": main_issue,
                "main_severity": main_severity,
                "recommended_fix": recommended_fix,
            }
        )

    if not valid_topic_ids:
        add_issue(
            issues, "*bank-level*", "curriculum_alignment", "critical",
            f"Missing or empty Year {profile.year} curriculum slice",
            f"Provide data/curriculum/ac9_maths/year{profile.year}.json before auditing coverage.",
        )
    else:
        for topic_id in sorted(valid_topic_ids - covered_topic_ids):
            add_issue(
                issues, "*bank-level*", "curriculum_alignment", "high",
                f"Curriculum topic {topic_id} has no exercises",
                f"Add at least one exercise tagged to {topic_id}.",
            )

    qpath = out_dir / f"{prefix}_question_audit.csv"
    ipath = out_dir / f"{prefix}_issue_flags.csv"
    spath = out_dir / f"{prefix}_audit_summary.md"

    with qpath.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else [])
        writer.writeheader()
        writer.writerows(rows)

    with ipath.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=["id", "issue_type", "severity", "evidence", "recommended_fix"])
        writer.writeheader()
        writer.writerows(issues)

    issue_counts = Counter(issue["issue_type"] for issue in issues)
    severity_counts = Counter(issue["severity"] for issue in issues)
    duplicate_ids = sorted([qid for qid, count in ids.items() if qid and count > 1])
    critical = severity_counts["critical"]
    high = severity_counts["high"]
    medium = severity_counts["medium"]
    low = severity_counts["low"]
    self_bad = sum(1 for row in rows if row["self_study_risk"] in {"medium", "high", "critical"})
    exam_bad = sum(1 for row in rows if row["exam_risk"] in {"medium", "high", "critical"})
    ai_bad = sum(1 for row in rows if row["ai_marking_risk"] in {"medium", "high", "critical"})
    amc_items = [row for row in rows if row["is_amc"]]
    amc_bad = sum(1 for row in amc_items if row["amc_quality"] in {"weak", "not_suitable", "possibly_too_advanced"})
    ext_items = [row for row in rows if row["is_extending"]]
    ext_bad = sum(1 for row in ext_items if row["extension_quality"] in {"weak", "not_suitable"})

    summary_lines = [
        f"# Year {profile.year} Mathematics Audit Summary",
        "",
        f"Profile: {profile.label}",
        "",
        f"Items loaded: {len(exercises)}",
        f"Unique IDs: {len(ids)}",
        f"Duplicate IDs: {len(duplicate_ids)}",
        "",
        "## Distribution",
        f"- Question types: {dict(qtype_counts)}",
        f"- Difficulty: {dict(difficulty_counts)}",
        f"- Complexity: {dict(complexity_counts)}",
        f"- Strands: {dict(strand_counts)}",
        f"- Topics covered: {len(covered_topic_ids & valid_topic_ids)}/{len(valid_topic_ids)}",
        "",
        "## Issues",
        f"- Total issue flags: {len(issues)}",
        f"- Severity: {dict(severity_counts)}",
        f"- Issue types: {dict(issue_counts)}",
        "",
        "## Risk scores",
        f"- Self-study support score: {score_from_counts(len(rows), self_bad)}/5 ({self_bad} medium+ risk items)",
        f"- Exam/extension calibration score: {score_from_counts(len(rows), exam_bad)}/5 ({exam_bad} medium+ risk items)",
        f"- AI marking support score: {score_from_counts(len(rows), ai_bad)}/5 ({ai_bad} medium+ risk items)",
        f"- Extending calibration: {len(ext_items)} challenge items; {ext_bad} weak/not suitable",
        f"- AMC calibration: {len(amc_items)} AMC items; {amc_bad} weak/not suitable/too advanced",
        "",
        "## Outputs",
        f"- Question audit: `{safe_rel(qpath, ROOT)}`",
        f"- Issue flags: `{safe_rel(ipath, ROOT)}`",
    ]
    spath.write_text("\n".join(summary_lines) + "\n", encoding="utf-8")

    return {
        "year": profile.year,
        "loaded_count": len(exercises),
        "unique_ids": len(ids),
        "audit_rows": len(rows),
        "duplicate_ids": duplicate_ids,
        "issues": len(issues),
        "critical": critical,
        "high": high,
        "medium": medium,
        "low": low,
        "self_bad": self_bad,
        "exam_bad": exam_bad,
        "ai_bad": ai_bad,
        "ext_bad": ext_bad,
        "amc_bad": amc_bad,
        "outputs": {
            "question_audit": safe_rel(qpath, ROOT),
            "issue_flags": safe_rel(ipath, ROOT),
            "summary": safe_rel(spath, ROOT),
        },
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit Year 7-10 mathematics exercise banks.")
    parser.add_argument("--years", nargs="+", type=int, default=[7, 8, 9, 10], help="Year levels to audit. Default: 7 8 9 10.")
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR, help="Directory containing exercise_{year}_math.json files.")
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR, help="Directory for audit CSV/Markdown outputs.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON summary.")
    parser.add_argument(
        "--fail-on",
        choices=["none", "critical", "high", "medium", "low"],
        default="none",
        help="Exit non-zero if any issue at or above this severity is found.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    summaries: list[dict[str, Any]] = []
    severity_order = {"none": 5, "low": 1, "medium": 2, "high": 3, "critical": 4}
    fail_threshold = args.fail_on
    should_fail = False

    for year in args.years:
        if year not in YEAR_PROFILES:
            raise SystemExit(f"Unsupported year: {year}. Supported years: {sorted(YEAR_PROFILES)}")
        data_file = args.data_dir / f"exercise_{year}_math.json"
        if not data_file.exists():
            raise SystemExit(f"Missing data file: {data_file}")
        summary = audit_bank(data_file, args.out_dir, YEAR_PROFILES[year])
        summaries.append(summary)
        if fail_threshold != "none":
            for sev in ["critical", "high", "medium", "low"]:
                if severity_order[sev] >= severity_order[fail_threshold] and summary[sev] > 0:
                    should_fail = True
        if not args.json:
            print(
                f"Year {year}: items={summary['loaded_count']}, issues={summary['issues']}, "
                f"critical={summary['critical']}, high={summary['high']}, medium={summary['medium']}, low={summary['low']}, "
                f"ext_bad={summary['ext_bad']}, amc_bad={summary['amc_bad']}"
            )

    if args.json:
        print(json.dumps(summaries, ensure_ascii=False, indent=2))
    return 1 if should_fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
