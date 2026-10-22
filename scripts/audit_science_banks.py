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


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pydantic import ValidationError
from core.algorithms.science_complexity import assess_science_complexity
from core.schema.exercise_schema import ExerciseItem
from scripts.check_exercises import SUPPORTED_DIAGRAM_TYPES

DEFAULT_DATA_DIR = ROOT / "data"
DEFAULT_CURRICULUM_DIR = DEFAULT_DATA_DIR / "curriculum" / "ac9_science"
DEFAULT_OUT_DIR = ROOT / "audit_output"

RISK_ORDER = {"none": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}
VALID_QTYPES = {"short_answer", "multiple_choice", "reasoning", "multi_part"}
VALID_DIFFICULTY = {"foundational", "developing", "extending"}
VALID_COMPLEXITY = {"simple_familiar", "complex_familiar", "complex_unfamiliar"}
VISUAL_DATA_REP = {"table", "graph", "diagram"}
VALID_DIAGRAM_TYPES = set(SUPPORTED_DIAGRAM_TYPES)

QUESTION_COLUMNS = [
    "id",
    "topic",
    "topic_ids",
    "question_type",
    "difficulty",
    "complexity",
    "complexity_calibration",
    "complexity_evidence",
    "strand",
    "sub_strand",
    "data_representation",
    "has_answer",
    "has_steps",
    "step_count",
    "has_rubric",
    "has_sample_reasoning",
    "has_sub_parts",
    "has_choices",
    "correct_choice_valid",
    "has_diagram_data",
    "diagram_type",
    "is_cer",
    "is_inquiry",
    "is_representation_question",
    "is_extending",
    "is_complex_unfamiliar",
    "self_study_risk",
    "exam_prep_risk",
    "ai_marking_risk",
    "representation_quality",
    "extension_quality",
    "year_fit",
    "template_risk",
    "main_issue",
    "fix_priority",
    "recommended_fix",
]
ISSUE_COLUMNS = ["id", "issue_type", "severity", "evidence", "recommended_fix"]

GENERIC_STEP_PATTERNS = [
    r"read the question",
    r"identify the key",
    r"think about",
    r"check your answer",
    r"use the information",
    r"look for clues",
    r"apply the concept",
]
CER_RE = re.compile(r"\b(CER|claim|evidence|reasoning)\b", re.I)
LOW_DEMAND_MCQ_RE = re.compile(r"^\s*(which|what|where|when|who)\b", re.I)
REP_VISIBLE_CONTEXT = re.compile(
    r"\b(from|in|using|use|based on|according to|shown|provided|presented|below|above|following|given|see)\b"
    r".{0,90}\b(table|graph|chart|diagram|food web|particle model|key|bar chart|line graph|scatter plot|plot|data)\b|"
    r"\b(table|graph|chart|diagram|food web|particle model|key|bar chart|line graph|scatter plot|plot|data)\b"
    r".{0,90}\b(shown|provided|presented|below|above|following|given)\b",
    re.I,
)
FACT_RISK_PATTERNS = [
    (
        re.compile(r"moon(?:'s)?\s+\d+(?:\.\d+)?-day orbit|moon orbits earth (?:roughly )?every 29\.5", re.I),
        "Moon orbit wording may confuse the 27.3-day sidereal orbit with the 29.5-day phase cycle.",
    ),
    (
        re.compile(r"seasons?.{0,80}(caused by|because of).{0,80}(distance from the sun|closer to the sun)", re.I),
        "Seasons should be explained mainly by axial tilt, not Earth-Sun distance.",
    ),
    (
        re.compile(r"\bindivisible particles\b", re.I),
        "Particle theory should not call atoms, molecules or ions indivisible.",
    ),
    (
        re.compile(r"diffusion.{0,80}not at all in solids|solids.{0,80}diffusion.{0,80}not at all", re.I),
        "Diffusion in solids is usually extremely slow in classroom contexts, not impossible.",
    ),
    (
        re.compile(r"\benergy is destroyed\b|\bmass is destroyed\b|\bmatter is destroyed\b", re.I),
        "Conservation language should say transformed/transferred or rearranged, not destroyed.",
    ),
]
CORRECTION_CUE_RE = re.compile(
    r"\b(not|never|incorrect|wrong|false|myth|misconception|rather than|should not|"
    r"do not|does not|cannot|can't|isn't|are not|avoid|reject)\b",
    re.I,
)


@dataclass(frozen=True)
class YearProfile:
    year: int
    label: str
    science_terms: re.Pattern[str]
    inquiry_terms: re.Pattern[str]
    extension_terms: re.Pattern[str]
    inquiry_gate_terms: tuple[str, ...]
    overreach_terms: re.Pattern[str] | None
    extension_adequate_demand: int
    representation_note: str
    extension_note: str


def _rx(words: str) -> re.Pattern[str]:
    return re.compile(words, re.I)


YEAR_PROFILES: dict[int, YearProfile] = {
    7: YearProfile(
        year=7,
        label="Year 7: classification, food webs, Earth-Sun-Moon, forces, particles, mixtures, fair tests and simple evidence",
        science_terms=_rx(
            r"\b(classif|dichotomous|organism|species|food web|producer|consumer|decomposer|ecosystem|"
            r"moon|earth|sun|season|tide|eclipse|force|friction|gravity|lever|particle|solid|liquid|gas|"
            r"mixture|solution|separat|filter|evaporat|distil|crystall|chromatography|hypothesis|variable|"
            r"fair test|measure|repeat|table|graph|trend|anomaly|evidence|claim|reasoning|model|ethical|"
            r"cultural|communication|audience|source)\b"
        ),
        inquiry_terms=_rx(
            r"\b(question|hypothesis|predict|prediction|variable|fair test|method|investigation|safe|risk|ethical|"
            r"measure|repeat|table|graph|trend|pattern|anomaly|outlier|evidence|conclusion|communicat|audience)\b"
        ),
        extension_terms=_rx(
            r"\b(explain|justify|predict|compare|construct|classif\w*|grouping|trait|observable|use the key|evaluate|"
            r"fair test|variable|evidence|reasoning|trend|anomaly|model|food web|particle model|effect|impact|ethical|audience|source)\b"
        ),
        inquiry_gate_terms=(
            "hypothesis",
            "predict",
            "prediction",
            "operational",
            "variable",
            "fair test",
            "safe",
            "risk",
            "measure",
            "equipment",
            "instrument",
            "volume",
            "mass",
            "temperature",
            "repeat",
            "table",
            "graph",
            "trend",
            "anomaly",
            "evidence",
            "conclusion",
            "audience",
            "data",
            "method",
            "processing",
            "analysing",
            "planning",
            "conducting",
        ),
        overreach_terms=_rx(
            r"\b(endocrine|homeostasis|radioactive|half-life|isotope|newton'?s second law|periodic table|"
            r"reaction rate|allele|genotype|phenotype|natural selection|big bang|redshift)\b"
        ),
        extension_adequate_demand=1,
        representation_note="Accept simple read-off for foundational fluency; developing/extending items should add comparison, trend, because-statement or evidence explanation.",
        extension_note="Year 7 challenge should be modest: unfamiliar classification, simple prediction, data/model explanation, CER or fair-test reasoning.",
    ),
    8: YearProfile(
        year=8,
        label="Year 8: cells/body systems, rocks/tectonics, energy, chemical classification/reactions, method and data evaluation",
        science_terms=_rx(
            r"\b(cell|organ|tissue|system|digest|respir|circul|rock|igneous|sedimentary|metamorphic|plate|tectonic|"
            r"earthquake|volcano|energy|transfer|transform|heat|light|sound|chemical|physical|reaction|element|compound|"
            r"mixture|particle|variable|valid|reliable|method|evidence|trend|anomaly|model|table|graph)\b"
        ),
        inquiry_terms=_rx(
            r"\b(variable|fair test|method|investigation|risk|ethical|measure|accuracy|precision|repeat|replicate|"
            r"table|graph|trend|pattern|anomaly|outlier|valid|reliable|evidence|conclusion|communicat|model)\b"
        ),
        extension_terms=_rx(
            r"\b(explain|justify|evaluate|compare|predict|model|evidence|valid|reliable|limitation|assumption|"
            r"mechanism|system|interaction|trend|anomaly|method|risk|ethical)\b"
        ),
        inquiry_gate_terms=(
            "variable",
            "operational",
            "fair test",
            "method",
            "risk",
            "ethical",
            "measure",
            "equipment",
            "instrument",
            "meniscus",
            "volume",
            "mass",
            "temperature",
            "repeat",
            "table",
            "graph",
            "trend",
            "anomaly",
            "valid",
            "reliable",
            "evidence",
            "conclusion",
            "data",
            "model",
        ),
        overreach_terms=_rx(r"\b(allele|genotype|phenotype|half-life|redshift|hubble|equilibrium constant)\b"),
        extension_adequate_demand=2,
        representation_note="Year 8 representation tasks should move beyond label/value reading into pattern, process, system or model explanation.",
        extension_note="Year 8 challenge should use a system/process explanation, evidence comparison, method critique or model-based prediction.",
    ),
    9: YearProfile(
        year=9,
        label="Year 9: homeostasis, reproduction, carbon cycle, energy transfer, atoms/radioactivity, reactions, stronger inquiry evaluation",
        science_terms=_rx(
            r"\b(homeostasis|hormone|receptor|effector|feedback|carbon|energy|particle|wave|atom|isotope|radioactive|"
            r"reaction|mass|ecosystem|validity|reliability|variable|control|enzyme|fertilisation|puberty|greenhouse|"
            r"conservation|efficiency|evidence|trend|anomaly|model)\b"
        ),
        inquiry_terms=_rx(
            r"\b(variable|independent variable|dependent variable|controlled variable|control variable|reliable|reliability|"
            r"valid|validity|fair test|method|experiment|investigation|sample size|repeat|replicate|accuracy|precision|"
            r"conclusion|hypothesis|evidence|trend|anomaly|uncertainty|limitation)\b"
        ),
        extension_terms=_rx(
            r"\b(justify|evaluate|critique|compare|explain why|mechanism|limitation|assumption|alternative|design an investigation|"
            r"predict|model|evidence|validity|reliability|uncertainty|trade-off|analyse|analysis)\b"
        ),
        inquiry_gate_terms=(
            "variable",
            "valid",
            "reliable",
            "method",
            "repeat",
            "sample",
            "control",
            "conclusion",
            "evidence",
            "data",
            "hypothesis",
            "prediction",
            "precision",
            "accuracy",
            "anomaly",
            "outlier",
            "trend",
            "assumption",
            "report",
            "results",
        ),
        overreach_terms=None,
        extension_adequate_demand=2,
        representation_note="Year 9 representation tasks should usually explain trends/mechanisms or evaluate reliability/validity, not only read values.",
        extension_note="Year 9 extending items should require unfamiliar application, evidence interpretation, mechanism explanation, model comparison or investigation critique.",
    ),
    10: YearProfile(
        year=10,
        label="Year 10: genetics, evolution, cosmology, climate systems, Newtonian forces, periodic table and reaction rates",
        science_terms=_rx(
            r"\b(gene|allele|genotype|phenotype|inherit|punnett|evolution|natural selection|mutation|big bang|redshift|"
            r"hubble|climate|greenhouse|feedback|newton|force|acceleration|periodic|electron|ion|reaction rate|collision|"
            r"catalyst|validity|reliability|uncertainty|evidence|model|trend|anomaly|limitation)\b"
        ),
        inquiry_terms=_rx(
            r"\b(variable|valid|validity|reliable|reliability|method|experiment|investigation|sample size|repeat|replicate|"
            r"accuracy|precision|uncertainty|error|control|conclusion|hypothesis|evidence|trend|anomaly|limitation|assumption)\b"
        ),
        extension_terms=_rx(
            r"\b(justify|evaluate|critique|analyse|analysis|compare|explain why|mechanism|limitation|assumption|alternative|"
            r"design an investigation|predict|model|evidence|validity|reliability|uncertainty|trade-off|quantitative|causal)\b"
        ),
        inquiry_gate_terms=(
            "variable",
            "valid",
            "reliable",
            "method",
            "repeat",
            "sample",
            "control",
            "conclusion",
            "evidence",
            "uncertainty",
            "error",
            "limitation",
            "assumption",
            "trend",
            "pattern",
            "homologous",
            "analogous",
            "fossil",
            "ancestry",
            "common ancestor",
            "correlation",
            "source",
            "bias",
            "credible",
            "peer-reviewed",
            "conflict of interest",
            "model",
            "data",
        ),
        overreach_terms=None,
        extension_adequate_demand=2,
        representation_note="Year 10 representation tasks should support exam-style explanation, causal modelling, uncertainty/limitations or quantitative interpretation.",
        extension_note="Year 10 extending items should be senior-prep: multi-step unfamiliar application, causal mechanism, quantitative evidence or validity/reliability critique.",
    ),
}


def words(value: Any) -> list[str]:
    return re.findall(r"[A-Za-z0-9%]+(?:[-'][A-Za-z0-9%]+)?", str(value or ""))


def wc(value: Any) -> int:
    return len(words(value))


def norm_text(value: Any) -> str:
    text = str(value or "").lower()
    text = re.sub(r"[^a-z0-9.<>%\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def load_curriculum_topic_ids(curriculum_dir: Path, year: int) -> set[str]:
    path = curriculum_dir / f"year{year}.json"
    if not path.exists():
        return set()
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    return {
        str(topic.get("topic_id"))
        for topic in payload.get("topics", [])
        if isinstance(topic, dict) and topic.get("topic_id")
    }


def safe_rel(path: Path, root: Path) -> str:
    resolved = path.resolve()
    try:
        return str(resolved.relative_to(root.resolve()))
    except ValueError:
        return str(resolved)


def strip_choice_prefix(value: Any) -> str:
    return re.sub(r"^\s*\(?[A-Ea-e]\)?\s*[\).:-]?\s*", "", str(value or "").strip())


def risk_max(*vals: str) -> str:
    return max(vals, key=lambda val: RISK_ORDER[val])


def meta(ex: dict[str, Any]) -> dict[str, Any]:
    value = ex.get("science_metadata") or {}
    return value if isinstance(value, dict) else {}


def combined_text(ex: dict[str, Any]) -> str:
    parts: list[str] = []
    for key in ["question", "answer", "sample_reasoning", "diagram_description"]:
        parts.append(str(ex.get(key) or ""))
    parts.extend(str(step) for step in ex.get("steps") or [])
    parts.extend(str(choice) for choice in ex.get("choices") or [])
    parts.append(json.dumps(ex.get("rubric") or {}, ensure_ascii=False))
    parts.append(json.dumps(meta(ex), ensure_ascii=False))
    for part in ex.get("sub_parts") or []:
        if isinstance(part, dict):
            parts.append(json.dumps(part, ensure_ascii=False))
    return " ".join(parts)


def instructional_text(ex: dict[str, Any]) -> str:
    """Text that represents authored teaching/answer content, excluding MCQ distractors."""
    parts: list[str] = []
    for key in ["question", "answer", "sample_reasoning", "diagram_description"]:
        parts.append(str(ex.get(key) or ""))
    parts.extend(str(step) for step in ex.get("steps") or [])
    for part in ex.get("sub_parts") or []:
        if isinstance(part, dict):
            parts.append(str(part.get("question") or ""))
            parts.append(str(part.get("answer") or ""))
    return " ".join(parts)


def misconception_is_explicitly_rejected(text: str, match: re.Match[str]) -> bool:
    """Avoid flagging a misconception which the authored text explicitly rejects."""
    before = text[max(0, match.start() - 120):match.start()]
    after = text[match.end():match.end() + 120]
    return bool(CORRECTION_CUE_RE.search(before) or CORRECTION_CUE_RE.search(after))


def add_issue(
    issues: list[dict[str, str]],
    qid: str,
    issue_type: str,
    severity: str,
    evidence: str,
    recommended_fix: str,
) -> None:
    issues.append(
        {
            "id": qid or "<missing>",
            "issue_type": issue_type,
            "severity": severity,
            "evidence": evidence[:800],
            "recommended_fix": recommended_fix[:800],
        }
    )


def mcq_valid(ex: dict[str, Any]) -> bool:
    choices = ex.get("choices")
    correct = str(ex.get("correct_choice") or "").strip().upper()
    if not isinstance(choices, list) or len(choices) < 2 or not correct:
        return False
    idx = ord(correct) - ord("A")
    return 0 <= idx < len(choices)


def has_specific_steps(ex: dict[str, Any], profile: YearProfile) -> bool:
    steps = ex.get("steps") or []
    if not isinstance(steps, list) or not steps:
        return False
    text = " ".join(str(step) for step in steps).lower()
    if wc(text) < max(10, len(steps) * 4):
        return False
    generic_hits = sum(1 for pattern in GENERIC_STEP_PATTERNS if re.search(pattern, text))
    return not (generic_hits >= 2 and not (profile.science_terms.search(text) or profile.inquiry_terms.search(text)))


def is_cer_item(ex: dict[str, Any]) -> bool:
    m = meta(ex)
    return bool(m.get("claim_evidence_reasoning") or CER_RE.search(str(ex.get("question") or "")))


def is_inquiry_item(ex: dict[str, Any], text: str, profile: YearProfile) -> bool:
    """Return True for genuine inquiry-skill demand, not merely the Inquiry strand.

    Science Inquiry is a curriculum strand, but not every item in that strand
    asks students to design/evaluate investigations, variables, validity,
    reliability or evidence. Keeping this conservative prevents routine graph,
    model or communication items from receiving extension credit simply because
    their metadata strand is "Science Inquiry".
    """
    m = meta(ex)
    prompt_parts = [str(ex.get("question") or "")]
    for part in ex.get("sub_parts") or []:
        if isinstance(part, dict):
            prompt_parts.append(str(part.get("question") or ""))
    qtext = " ".join(prompt_parts).lower()
    topic_ids = [str(tid) for tid in ex.get("topic_ids") or []]
    return (
        bool(m.get("science_inquiry_skill"))
        or any(tid.startswith(f"AC9S{profile.year}I") for tid in topic_ids)
        or any(
            term in qtext
            for term in [
                "investigation",
                "experiment",
                "method",
                "variable",
                "validity",
                "reliability",
                "fair test",
                "sample size",
                "control variable",
                "repeat trial",
                "replicate",
                "anomaly",
                "outlier",
                "uncertainty",
            ]
        )
    )


def is_representation_question(ex: dict[str, Any]) -> bool:
    data_rep = str(meta(ex).get("data_representation") or "")
    qtext = str(ex.get("question") or "")
    if ex.get("diagram_data") or ex.get("diagram_description"):
        return True
    if data_rep in VISUAL_DATA_REP:
        return True
    # A science "model" can be conceptual/explanatory rather than visual. Only
    # treat it as a representation task when the question clearly refers to a
    # shown/provided/labelled visual or a concrete model type.
    if data_rep == "model":
        return bool(REP_VISIBLE_CONTEXT.search(qtext))
    return bool(REP_VISIBLE_CONTEXT.search(qtext))


def infer_data_level(ex: dict[str, Any], is_rep: bool, is_cer: bool) -> int | None:
    if not is_rep:
        return None
    data_rep = str(meta(ex).get("data_representation") or "")
    has_visual = bool(ex.get("diagram_data") or ex.get("diagram_description"))
    if data_rep in VISUAL_DATA_REP and not has_visual:
        return 0
    text = combined_text(ex).lower()
    if re.search(r"\b(valid|reliab|uncertain|limitation|sample size|repeat|error|accuracy|precision|control variable|anomal(?:y|ies)|outlier|bias)\b", text):
        return 5
    if is_cer or re.search(r"\b(evidence|supported|justify|justifies|claim|reasoning)\b", text):
        return 4
    if re.search(r"\b(explain|why|because|therefore|causes?|mechanism|link|appropriate|proportional|constant rate|counteracts?|model shows|pattern means)\b", text):
        return 3
    if re.search(r"\b(trend|compare|increas\w*|decreas\w*|higher|lower|highest|lowest|larger|smaller|more than|less than|pattern|relationship|rising|falling|level off|approach(?:es|ing)?)\b", text):
        return 2
    return 1


def representation_quality(ex: dict[str, Any], data_level: int | None) -> str:
    if data_level is None:
        return "not_applicable"
    if data_level == 0:
        return "not_suitable"
    if data_level == 1:
        if ex.get("difficulty") == "foundational" or ex.get("complexity") == "simple_familiar":
            return "adequate"
        return "weak"
    if data_level in {2, 3}:
        return "adequate"
    return "strong"


def extension_quality(
    ex: dict[str, Any],
    profile: YearProfile,
    is_ext: bool,
    is_complex: bool,
    is_cer: bool,
    is_inquiry: bool,
    data_level: int | None,
) -> str:
    if not (is_ext or is_complex):
        return "not_applicable"
    text = combined_text(ex).lower()
    qtext = str(ex.get("question") or "").lower()

    if ex.get("question_type") == "multiple_choice":
        # MCQ extension should be stricter than short-answer extension. A long
        # answer key or a broad keyword such as "evidence" is not enough; the
        # stem should require interpretation, prediction, evidence evaluation,
        # mechanism reasoning, limitation/validity judgement or a genuinely
        # unfamiliar scenario.
        demand = 0
        demand += 1 if profile.extension_terms.search(qtext) else 0
        demand += 1 if data_level is not None and data_level >= 3 else 0
        demand += 1 if is_cer else 0
        demand += 1 if re.search(r"\b(why|best explanation|best reason|evaluate|predict|justify|compare|limitation|valid|reliable|uncertain|bias|confound|anomaly|trend|mechanism|model|random\w*|representative|sampling|overestimating|underestimating|filtration|flocculation|settle|separation)\b", qtext) else 0
        demand += 1 if re.search(r"\b(a student|students|a researcher|a farmer|a class|a trial|a study|scenario|given|shown|provided|school oval|water treatment|using the table|using the graph)\b", qtext) else 0
        demand += 1 if re.search(r"\b(because|therefore|so that|as a result|would most likely|best supports|least supports)\b", qtext) else 0
        if LOW_DEMAND_MCQ_RE.search(qtext) and demand < profile.extension_adequate_demand + 1:
            return "weak" if demand else "not_suitable"
        if demand >= profile.extension_adequate_demand + 2:
            return "strong"
        if demand >= profile.extension_adequate_demand + 1:
            return "adequate"
        if demand >= profile.extension_adequate_demand:
            return "weak"
        return "not_suitable"

    demand = 0
    demand += 1 if profile.extension_terms.search(text) else 0
    demand += 1 if is_cer else 0
    demand += 1 if is_inquiry else 0
    demand += 1 if data_level is not None and data_level >= 3 else 0
    demand += 1 if ex.get("question_type") in {"reasoning", "multi_part"} else 0
    demand += 1 if wc(ex.get("answer")) >= 30 or wc(ex.get("sample_reasoning")) >= 45 else 0
    if demand >= profile.extension_adequate_demand + 2:
        return "strong"
    if demand >= profile.extension_adequate_demand:
        return "adequate"
    if demand == profile.extension_adequate_demand - 1:
        return "weak"
    return "not_suitable"


def diagram_structural_issues(ex: dict[str, Any]) -> list[str]:
    dd = ex.get("diagram_data")
    if not dd:
        return []
    if not isinstance(dd, dict):
        return ["diagram_data is not an object"]
    dtype = dd.get("type")
    problems: list[str] = []
    if not dtype:
        problems.append("diagram_data missing type")
    elif dtype not in VALID_DIAGRAM_TYPES:
        problems.append(f"unsupported diagram_data.type={dtype}")
    if dtype == "food_web" and not (dd.get("food_web") or (dd.get("nodes") and dd.get("links"))):
        problems.append("food_web diagram missing nodes/links payload")
    if dtype == "particle_model" and not (dd.get("particle_model") or dd.get("state") or dd.get("particles")):
        problems.append("particle_model diagram missing particle payload")
    if dtype == "force_diagram" and not (dd.get("object") and dd.get("forces")):
        problems.append("force_diagram missing object/forces payload")
    if dtype == "data_table" and not (dd.get("headers") and dd.get("rows")):
        problems.append("data_table missing headers or rows")
    if dtype == "simple_bar_chart":
        payload = dd.get("simple_bar_chart") or {}
        if not (payload.get("data") or dd.get("bars")):
            problems.append("simple_bar_chart missing data")
    return problems


def template_risk(ex: dict[str, Any]) -> str:
    text = combined_text(ex).lower()
    if re.search(r"\b(todo|template|tbd)\b", text) or "lorem ipsum" in text or "{{" in text or "as an ai" in text:
        return "high"
    if (
        "because the scientific concept explains why the observed pattern or answer is valid" in text
        or re.search(r"linked to [a-z ]+ because the scientific concept", text)
    ):
        return "medium"
    return "none"


def year_fit(ex: dict[str, Any], profile: YearProfile) -> str:
    text = instructional_text(ex)
    if profile.overreach_terms and profile.overreach_terms.search(text):
        return "possibly_too_advanced"
    if ex.get("question_type") == "multiple_choice" and ex.get("difficulty") == "extending":
        lower = text.lower()
        if LOW_DEMAND_MCQ_RE.search(str(ex.get("question") or "")) and not any(
            term in lower for term in ["because", "explain", "evidence", "predict", "fair test", "trend", "model", "valid", "reliable"]
        ):
            return "routine_mcq_over_tagged"
    return "appropriate"


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


def audit_bank(
    data_file: Path,
    out_dir: Path,
    profile: YearProfile,
    curriculum_dir: Path | None = None,
) -> dict[str, Any]:
    exercises = json.loads(data_file.read_text(encoding="utf-8-sig"))
    curriculum_dir = curriculum_dir or (data_file.parent / "curriculum" / "ac9_science")
    valid_topic_ids = load_curriculum_topic_ids(curriculum_dir, profile.year)
    out_dir.mkdir(parents=True, exist_ok=True)
    prefix = f"year{profile.year}_science"
    ids = Counter(str(ex.get("id") or "") for ex in exercises)
    rows: list[dict[str, Any]] = []
    issues: list[dict[str, str]] = []
    qtype_counts: Counter[str] = Counter()
    difficulty_counts: Counter[str] = Counter()
    strand_counts: Counter[str] = Counter()
    key_counts: Counter[str] = Counter()
    topic_counts: Counter[str] = Counter()

    for ex in exercises:
        qid = str(ex.get("id") or "unknown")
        m = meta(ex)
        qt = str(ex.get("question_type") or "")
        diff = str(ex.get("difficulty") or "")
        comp = str(ex.get("complexity") or "")
        strand = str(m.get("strand") or "")
        data_rep = str(m.get("data_representation") or "")
        text = combined_text(ex)
        answer = str(ex.get("answer") or "")
        steps = ex.get("steps") or []
        has_answer = bool(answer.strip())
        has_steps = isinstance(steps, list) and bool(steps)
        has_rubric = isinstance(ex.get("rubric"), dict) and bool(ex.get("rubric"))
        has_sample = bool(str(ex.get("sample_reasoning") or "").strip())
        has_sub_parts = isinstance(ex.get("sub_parts"), list) and bool(ex.get("sub_parts"))
        has_choices = isinstance(ex.get("choices"), list) and bool(ex.get("choices"))
        correct_choice_valid = mcq_valid(ex)
        dd = ex.get("diagram_data")
        has_diagram = isinstance(dd, dict) and bool(dd)
        diagram_type = dd.get("type") if isinstance(dd, dict) else ""
        is_cer = is_cer_item(ex)
        is_inquiry = is_inquiry_item(ex, text, profile)
        is_rep = is_representation_question(ex)
        is_ext = diff == "extending"
        is_complex = comp == "complex_unfamiliar"
        data_level = infer_data_level(ex, is_rep, is_cer)
        rep_quality = representation_quality(ex, data_level)
        ext_quality = extension_quality(ex, profile, is_ext, is_complex, is_cer, is_inquiry, data_level)
        complexity_assessment = assess_science_complexity(ex)
        fit = year_fit(ex, profile)
        tmpl = template_risk(ex)
        self_risk = "none"
        exam_risk = "none"
        ai_risk = "none"

        qtype_counts[qt] += 1
        difficulty_counts[diff] += 1
        strand_counts[strand or "missing"] += 1
        for topic_id in ex.get("topic_ids") or []:
            topic_counts[str(topic_id)] += 1
        if correct_choice_valid:
            key_counts[str(ex.get("correct_choice")).upper()] += 1

        try:
            ExerciseItem.model_validate(ex)
        except ValidationError as exc:
            first = exc.errors(include_url=False)[0]
            location = ".".join(str(part) for part in first.get("loc", ())) or "item"
            add_issue(
                issues, qid, "schema", "critical",
                f"ExerciseItem validation failed at {location}: {first.get('msg', 'invalid item')}",
                "Conform to core.schema.exercise_schema.ExerciseItem.",
            )

        if ids[qid] > 1:
            add_issue(issues, qid, "schema", "critical", "Duplicate id", "Give every question a unique stable id.")
        if not has_answer:
            add_issue(issues, qid, "schema", "critical", "Missing answer", "Add a concise correct answer.")
            self_risk = risk_max(self_risk, "critical")
            exam_risk = risk_max(exam_risk, "critical")
        if str(ex.get("framework") or "") != "AC9_SCIENCE":
            add_issue(issues, qid, "schema", "high", f"framework={ex.get('framework')!r}", "Science banks should use framework='AC9_SCIENCE'.")
        if str(ex.get("subject") or "").lower() != "science":
            add_issue(issues, qid, "schema", "high", f"subject={ex.get('subject')!r}", "Science banks should use subject='science'.")
        if ex.get("year_level") != profile.year:
            add_issue(issues, qid, "schema", "high", f"year_level={ex.get('year_level')!r}; expected={profile.year}", "Move the item to the correct bank or fix year_level.")
        topic_ids = ex.get("topic_ids") or []
        if not isinstance(topic_ids, list) or not topic_ids:
            add_issue(issues, qid, "schema", "high", "Missing topic_ids", "Add at least one AC9 science topic id.")
        else:
            expected_prefix = f"AC9S{profile.year}"
            bad_topic_ids = [str(tid) for tid in topic_ids if not str(tid).startswith(expected_prefix)]
            if bad_topic_ids:
                add_issue(issues, qid, "curriculum_alignment", "high", f"topic_ids={bad_topic_ids}; expected prefix {expected_prefix}", "Use topic_ids from the audited year level.")
            unknown_topic_ids = [str(tid) for tid in topic_ids if valid_topic_ids and str(tid) not in valid_topic_ids]
            if unknown_topic_ids:
                add_issue(issues, qid, "curriculum_alignment", "high", f"Unknown curriculum topic_ids={unknown_topic_ids}", "Use topic_ids present in the Year curriculum slice.")
        if qt not in VALID_QTYPES:
            add_issue(issues, qid, "schema", "high", f"question_type={qt!r}", "Use short_answer, multiple_choice, reasoning, or multi_part.")
        if diff not in VALID_DIFFICULTY:
            add_issue(issues, qid, "schema", "medium", f"difficulty={diff!r}", "Use foundational/developing/extending.")
        if comp not in VALID_COMPLEXITY:
            add_issue(issues, qid, "schema", "medium", f"complexity={comp!r}", "Use simple_familiar/complex_familiar/complex_unfamiliar.")
        if diff == "foundational" and comp == "complex_unfamiliar":
            add_issue(issues, qid, "schema", "medium", "foundational item marked complex_unfamiliar", "Retag complexity or raise the question demand.")
        if diff == "extending" and comp == "simple_familiar":
            add_issue(issues, qid, "schema", "medium", "extending item marked simple_familiar", "Retag complexity or make the task genuinely extending.")

        if complexity_assessment.status == "unsupported":
            add_issue(
                issues, qid, "complexity_calibration", "medium",
                complexity_assessment.rationale,
                "Add clearer unfamiliarity, transfer, multi-step reasoning or retag complexity.",
            )
        elif complexity_assessment.status in {"review", "review_understated"}:
            add_issue(
                issues, qid, "complexity_calibration", "low",
                complexity_assessment.rationale,
                "Review the declared complexity against the task demand.",
            )

        authored_text = instructional_text(ex)
        for pattern, evidence in FACT_RISK_PATTERNS:
            match = pattern.search(authored_text)
            if match:
                lower_authored = authored_text.lower()
                if misconception_is_explicitly_rejected(authored_text, match):
                    continue
                if "destroyed" in evidence.lower() and re.search(
                    r"\b(?:not destroyed|not because (?:energy|mass|matter) is destroyed|rather than destroy(?:ed|ing)|claim (?:is )?(?:wrong|incorrect|false)|claims? incorrectly)\b",
                    lower_authored,
                ):
                    continue
                add_issue(issues, qid, "factual_risk", "high", evidence, "Rewrite with accurate science wording for the year level.")
                self_risk = risk_max(self_risk, "high")
                exam_risk = risk_max(exam_risk, "high")

        if qt == "multiple_choice":
            if not correct_choice_valid:
                add_issue(issues, qid, "multiple_choice", "critical", f"choices={ex.get('choices')!r}, correct_choice={ex.get('correct_choice')!r}", "Provide valid choices and a correct_choice letter.")
                ai_risk = risk_max(ai_risk, "critical")
            else:
                choices = ex.get("choices") or []
                if len({norm_text(choice) for choice in choices}) != len(choices):
                    add_issue(issues, qid, "multiple_choice", "medium", "Duplicate choices", "Rewrite distractors so each choice is distinct.")
                idx = ord(str(ex.get("correct_choice")).upper()) - 65
                correct_text = str(choices[idx])
                ans_norm = norm_text(strip_choice_prefix(answer))
                correct_norm = norm_text(strip_choice_prefix(correct_text))
                if ans_norm and ans_norm not in {correct_norm, norm_text(str(ex.get("correct_choice")))}:
                    if ans_norm not in correct_norm and correct_norm not in ans_norm:
                        add_issue(issues, qid, "answer", "medium", f"answer={answer!r}; correct choice text={correct_text!r}", "Align answer with the correct choice text.")
        elif qt == "reasoning":
            if not has_rubric:
                add_issue(issues, qid, "rubric", "high", "Reasoning item missing rubric", "Add a task-specific rubric.")
                ai_risk = risk_max(ai_risk, "high")
            if not has_sample:
                add_issue(issues, qid, "sample_reasoning", "high", "Reasoning item missing sample_reasoning", "Add a model answer.")
                ai_risk = risk_max(ai_risk, "high")
            if has_rubric:
                rubric = ex.get("rubric") or {}
                key_points = rubric.get("key_points") or []
                min_score = 4 if profile.year >= 9 else 3
                if not isinstance(key_points, list) or len(key_points) < 3 or not isinstance(rubric.get("max_score"), int) or rubric.get("max_score") < min_score:
                    add_issue(issues, qid, "rubric", "medium", "Reasoning rubric too thin for this year level", "Use enough task-specific points and an appropriate max_score.")
                    ai_risk = risk_max(ai_risk, "medium")
        elif qt == "multi_part":
            if not has_sub_parts:
                add_issue(issues, qid, "multi_part", "critical", "Multi-part item missing sub_parts", "Add sub_parts with separate question and answer fields.")
            else:
                for idx, part in enumerate(ex.get("sub_parts") or []):
                    if not isinstance(part, dict) or not part.get("question") or not part.get("answer"):
                        add_issue(issues, qid, "multi_part", "high", f"sub_parts[{idx}] missing question or answer", "Make each sub-part independently answerable.")

        if qt != "multiple_choice" and not has_specific_steps(ex, profile):
            add_issue(issues, qid, "steps", "medium", "Steps are missing, very short or generic", "Add teachable steps using the specific concept, evidence or data.")
            self_risk = risk_max(self_risk, "medium")

        if is_cer:
            sample = str(ex.get("sample_reasoning") or "").lower()
            rubric_text = json.dumps(ex.get("rubric") or {}, ensure_ascii=False).lower()
            sample_has_cer_terms = all(term in sample for term in ["claim", "evidence", "reasoning"])
            rubric_has_cer_terms = all(term in rubric_text for term in ["claim", "evidence", "reasoning"])
            if has_sample and not sample_has_cer_terms:
                add_issue(issues, qid, "cer", "medium", "CER sample does not explicitly model claim/evidence/reasoning", "Write the model answer with Claim, Evidence and Reasoning labels.")
                ai_risk = risk_max(ai_risk, "medium")
            if has_rubric and not (rubric_has_cer_terms or sample_has_cer_terms):
                add_issue(issues, qid, "cer", "medium", "CER rubric does not explicitly assess all CER parts", "Mention claim, evidence and reasoning in the rubric key points.")
                ai_risk = risk_max(ai_risk, "medium")

        if is_inquiry:
            lower = text.lower()
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
                "meniscus",
                "resolution",
                "parallax",
            )
            if not any(term in lower for term in profile.inquiry_gate_terms + communication_terms):
                add_issue(issues, qid, "science_inquiry", "medium", "Inquiry item may not assess the year-level inquiry skills", "Anchor the task in the profile's inquiry expectations.")

        if strand == "Science as a Human Endeavour":
            lower = text.lower()
            if any(term in lower for term in ["first nations", "indigenous", "aboriginal", "torres strait"]):
                if not any(term in lower for term in ["local", "community", "source", "teacher-provided", "approved", "specific"]):
                    add_issue(issues, qid, "cultural_protocol", "medium", "First Nations knowledge task lacks source/community-boundary wording", "Use local/community-approved or teacher-provided sources and avoid generalising across Nations.")

        for problem in diagram_structural_issues(ex):
            add_issue(issues, qid, "representation", "high", problem, "Fix diagram_data so the renderer has complete typed data, labels and values.")
            self_risk = risk_max(self_risk, "high")
            exam_risk = risk_max(exam_risk, "high")

        if is_rep:
            if rep_quality == "not_suitable":
                add_issue(issues, qid, "representation", "high", "Representation is referenced or metadata-tagged but no usable representation exists", "Add diagram_data/diagram_description or remove the representation demand.")
                self_risk = risk_max(self_risk, "high")
                exam_risk = risk_max(exam_risk, "high")
            elif rep_quality == "weak":
                add_issue(issues, qid, "representation", "medium", "Representation reasoning appears to stop at low-level value reading", profile.representation_note)
                exam_risk = risk_max(exam_risk, "medium")

        if (is_ext or is_complex) and ext_quality in {"weak", "not_suitable"}:
            sev = "high" if ext_quality == "not_suitable" else "medium"
            add_issue(issues, qid, "extension", sev, f"extension_quality={ext_quality}; task demand appears routine", profile.extension_note)
            exam_risk = risk_max(exam_risk, sev)

        if fit == "possibly_too_advanced":
            add_issue(issues, qid, "year_fit", "medium", "Content appears to use later-year science terminology", "Simplify for this year or move the item to a later bank.")
            self_risk = risk_max(self_risk, "medium")
        elif fit == "routine_mcq_over_tagged":
            add_issue(issues, qid, "year_fit", "medium", "Extending MCQ appears to be routine recall", "Retag or add evidence/prediction/explanation demand.")
            exam_risk = risk_max(exam_risk, "medium")

        if tmpl == "high":
            add_issue(issues, qid, "template", "high", "Template/TODO/meta text detected", "Replace generated placeholder text with finished content.")
            self_risk = risk_max(self_risk, "high")
        elif tmpl == "medium":
            add_issue(issues, qid, "template", "medium", "Generic teaching or sample-reasoning language", "Make steps/sample reasoning specific to the concept and evidence path.")
            self_risk = risk_max(self_risk, "medium")

        rows.append(
            {
                "id": qid,
                "topic": ex.get("topic") or "",
                "topic_ids": "|".join(map(str, ex.get("topic_ids") or [])),
                "question_type": qt,
                "difficulty": diff,
                "complexity": comp,
                "complexity_calibration": complexity_assessment.status,
                "complexity_evidence": ", ".join(complexity_assessment.evidence or complexity_assessment.risk_flags),
                "strand": strand,
                "sub_strand": str(m.get("sub_strand") or ""),
                "data_representation": data_rep,
                "has_answer": has_answer,
                "has_steps": has_steps,
                "step_count": len(steps) if isinstance(steps, list) else 0,
                "has_rubric": has_rubric,
                "has_sample_reasoning": has_sample,
                "has_sub_parts": has_sub_parts,
                "has_choices": has_choices,
                "correct_choice_valid": correct_choice_valid,
                "has_diagram_data": has_diagram,
                "diagram_type": diagram_type,
                "is_cer": is_cer,
                "is_inquiry": is_inquiry,
                "is_representation_question": is_rep,
                "is_extending": is_ext,
                "is_complex_unfamiliar": is_complex,
                "self_study_risk": self_risk,
                "exam_prep_risk": exam_risk,
                "ai_marking_risk": ai_risk,
                "representation_quality": rep_quality,
                "extension_quality": ext_quality,
                "year_fit": fit,
                "template_risk": tmpl,
            }
        )

    for row in rows:
        main_issue, priority, fix = choose_main_issue(issues, row["id"])
        row["main_issue"] = main_issue
        row["fix_priority"] = priority
        row["recommended_fix"] = fix

    if not valid_topic_ids:
        add_issue(
            issues, "*bank-level*", "curriculum_alignment", "critical",
            f"Missing or empty Year {profile.year} science curriculum slice",
            f"Provide {curriculum_dir / f'year{profile.year}.json'} before auditing coverage.",
        )
    else:
        for topic_id in sorted(valid_topic_ids):
            count = topic_counts[topic_id]
            if count == 0:
                add_issue(
                    issues, "*bank-level*", "curriculum_alignment", "high",
                    f"Curriculum topic {topic_id} has no exercises",
                    f"Add exercises tagged to {topic_id}.",
                )
            elif count < 3:
                add_issue(
                    issues, "*bank-level*", "curriculum_alignment", "medium",
                    f"Curriculum topic {topic_id} has only {count} linked exercises",
                    f"Review whether {topic_id} needs broader question coverage.",
                )

    qpath = out_dir / f"{prefix}_question_audit.csv"
    ipath = out_dir / f"{prefix}_issue_flags.csv"
    spath = out_dir / f"{prefix}_audit_summary.md"
    with qpath.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=QUESTION_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    with ipath.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=ISSUE_COLUMNS)
        writer.writeheader()
        writer.writerows(issues)

    severity_counts = Counter(issue["severity"] for issue in issues)
    issue_type_counts = Counter(issue["issue_type"] for issue in issues)
    rep_rows = [row for row in rows if row["is_representation_question"] is True]
    ext_rows = [row for row in rows if row["is_extending"] is True or row["is_complex_unfamiliar"] is True]
    self_bad = sum(1 for row in rows if RISK_ORDER[row["self_study_risk"]] >= RISK_ORDER["medium"])
    exam_bad = sum(1 for row in rows if RISK_ORDER[row["exam_prep_risk"]] >= RISK_ORDER["medium"])
    ai_bad = sum(1 for row in rows if RISK_ORDER[row["ai_marking_risk"]] >= RISK_ORDER["medium"])
    rep_bad = sum(1 for row in rep_rows if row["representation_quality"] in {"weak", "not_suitable"})
    ext_bad = sum(1 for row in ext_rows if row["extension_quality"] in {"weak", "not_suitable"})
    fit_bad = sum(1 for row in rows if row["year_fit"] != "appropriate")
    scores = {
        "Schema/marking readiness": score_from_counts(len(rows), severity_counts["critical"] + severity_counts["high"] + ai_bad),
        "Self-study suitability": score_from_counts(len(rows), self_bad),
        "Exam preparation": score_from_counts(len(rows), exam_bad),
        "Year fit": score_from_counts(len(rows), fit_bad),
        "Representation quality": score_from_counts(max(1, len(rep_rows)), rep_bad),
        "Extension calibration": score_from_counts(max(1, len(ext_rows)), ext_bad),
    }

    def ids_for(severity: str, limit: int = 30) -> str:
        ids_for_sev = [issue["id"] for issue in issues if issue["severity"] == severity]
        if not ids_for_sev:
            return "none detected"
        suffix = "" if len(ids_for_sev) <= limit else f"; ... +{len(ids_for_sev) - limit}"
        return ", ".join(ids_for_sev[:limit]) + suffix

    summary = [
        f"# Year {profile.year} Science Audit",
        "",
        "## Scope",
        "",
        f"- Data file: `{safe_rel(data_file, ROOT)}`",
        f"- Items loaded: {len(exercises)}",
        f"- Unique IDs: {len(ids)}",
        f"- Output prefix: `{prefix}`",
        f"- Year profile: {profile.label}",
        "",
        "## Executive Result",
        "",
        f"- Critical issues: {severity_counts['critical']}",
        f"- High issues: {severity_counts['high']}",
        f"- Medium issues: {severity_counts['medium']}",
        f"- Low issues: {severity_counts['low']}",
        f"- Self-study medium-or-higher risk: {self_bad}",
        f"- Exam-prep medium-or-higher risk: {exam_bad}",
        f"- AI/marking medium-or-higher risk: {ai_bad}",
        "",
        "## Scores",
        "",
        "| Area | Score |",
        "|---|---:|",
    ]
    summary.extend(f"| {area} | {score}/5 |" for area, score in scores.items())
    summary.extend(
        [
            "",
            "## Bank Profile",
            "",
            "| Metric | Value |",
            "|---|---:|",
            f"| Question types | {dict(qtype_counts)} |",
            f"| Difficulty | {dict(difficulty_counts)} |",
            f"| Strand metadata | {dict(strand_counts)} |",
            f"| MCQ key distribution | {dict(key_counts)} |",
            f"| Representation items detected | {len(rep_rows)} |",
            f"| Extending/complex-unfamiliar items checked | {len(ext_rows)} |",
            "",
            "## Issue Types",
            "",
            "| Issue type | Count |",
            "|---|---:|",
        ]
    )
    if issue_type_counts:
        summary.extend(f"| {issue_type} | {count} |" for issue_type, count in issue_type_counts.most_common())
    else:
        summary.append("| none | 0 |")
    summary.extend(
        [
            "",
            "## Priority IDs",
            "",
            f"- Critical: {ids_for('critical')}",
            f"- High: {ids_for('high')}",
            f"- Medium: {ids_for('medium')}",
            f"- Low: {ids_for('low')}",
            "",
            "## Year-Specific Judgement",
            "",
            profile.representation_note,
            "",
            profile.extension_note,
            "",
            "## Recommended Priority",
            "",
            "1. Fix critical/high schema, factual, representation and marking issues first.",
            "2. Repair medium self-study and AI-marking issues: steps, CER rubrics, sample reasoning and multi-part answers.",
            "3. Calibrate extending labels against the year profile instead of applying a single Year 9/10 standard to all banks.",
        ]
    )
    spath.write_text("\n".join(summary) + "\n", encoding="utf-8")

    return {
        "year": profile.year,
        "loaded_count": len(exercises),
        "unique_ids": len(ids),
        "audit_rows": len(rows),
        "duplicate_ids": [qid for qid, count in ids.items() if count > 1],
        "issues": len(issues),
        "critical": severity_counts["critical"],
        "high": severity_counts["high"],
        "medium": severity_counts["medium"],
        "low": severity_counts["low"],
        "self_bad": self_bad,
        "exam_bad": exam_bad,
        "ai_bad": ai_bad,
        "rep_bad": rep_bad,
        "ext_bad": ext_bad,
        "outputs": {
            "question_audit": safe_rel(qpath, ROOT),
            "issue_flags": safe_rel(ipath, ROOT),
            "summary": safe_rel(spath, ROOT),
        },
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit AC9 Year 7-10 Science exercise banks with year-specific quality rules.")
    parser.add_argument("--years", nargs="+", type=int, default=[7, 8, 9, 10], help="Year levels to audit. Default: 7 8 9 10.")
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR, help="Directory containing exercise_{year}_science.json files.")
    parser.add_argument("--curriculum-dir", type=Path, default=DEFAULT_CURRICULUM_DIR, help="Directory containing AC9 Science year curriculum files.")
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR, help="Directory for audit CSV/Markdown outputs.")
    parser.add_argument(
        "--fail-on",
        choices=["none", "low", "medium", "high", "critical"],
        default="none",
        help="Exit non-zero if any audited bank has an issue at this severity or higher. Default: none.",
    )
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON summary.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    results: list[dict[str, Any]] = []
    for year in args.years:
        profile = YEAR_PROFILES.get(year)
        if not profile:
            raise SystemExit(f"No science audit profile is defined for Year {year}. Supported: {sorted(YEAR_PROFILES)}")
        data_file = args.data_dir / f"exercise_{year}_science.json"
        if not data_file.exists():
            raise SystemExit(f"Missing science exercise bank: {data_file}")
        results.append(audit_bank(data_file, args.out_dir, profile, args.curriculum_dir))

    if args.json:
        print(json.dumps(results, indent=2))
    else:
        for result in results:
            print(
                "Year {year}: items={loaded_count}, issues={issues}, "
                "critical={critical}, high={high}, medium={medium}, low={low}".format(**result)
            )

    threshold = RISK_ORDER[args.fail_on]
    if threshold > 0:
        for result in results:
            if any(result[name] for name, value in RISK_ORDER.items() if value >= threshold and name in result):
                return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
