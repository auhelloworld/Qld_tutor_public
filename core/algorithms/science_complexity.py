"""Contextual Science complexity calibration.

The AC9 exercise schema stores both a pedagogical ``difficulty`` ladder and a
QCE-style ``complexity`` label.  They are related, but they are not aliases.
This module deliberately ignores ``difficulty`` and evaluates complexity from
observable task characteristics: unfamiliar transfer, evidence synthesis,
multiple constraints, data/model interpretation, inquiry evaluation and the
required response structure.

The result is a conservative audit signal.  It never rewrites content or
complexity metadata automatically; borderline items are queued for human/AI
review with the evidence that triggered the decision.
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Iterable


VALID_COMPLEXITY = {"simple_familiar", "complex_familiar", "complex_unfamiliar"}

_TRANSFER_CONTEXT_RE = re.compile(
    r"\b(a student|students|a researcher|researchers|a scientist|scientists|"
    r"a community|local council|farm|mine|reef|wetland|ecosystem|hospital|"
    r"field study|case study|new material|new species|new technology|scenario|"
    r"investigation|experiment|trial|site|sample|population)\b",
    re.I,
)
_TRANSFER_VERB_RE = re.compile(
    r"\b(apply|predict|infer|evaluate|assess|recommend|propose|design|justify|"
    r"determine|decide|adapt|transfer|extrapolate|select the best|most appropriate)\b",
    re.I,
)
_EVIDENCE_RE = re.compile(
    r"\b(use|using|from|draw on|combine|synthesi[sz]e|weigh|compare)\b.{0,45}"
    r"\b(data|evidence|results|observations|graph|table|model|source|study|studies)\b|"
    r"\b(data|evidence|results|observations)\b.{0,45}\b(support|justify|show|indicate|suggest)\b",
    re.I,
)
_METHOD_EVALUATION_RE = re.compile(
    r"\b(validity|valid|reliability|reliable|uncertainty|limitation|bias|"
    r"confound|sample size|repeatability|replication|accuracy|precision|"
    r"controlled variable|fair test|method flaw|source of error)\b",
    re.I,
)
_MODEL_EVALUATION_RE = re.compile(
    r"\b(model|theory|explanation)\b.{0,65}\b(limit|limitation|assumption|"
    r"predict|prediction|evaluate|revise|evidence|strength|weakness|valid)\b|"
    r"\b(limit|limitation|assumption|evaluate|revise)\b.{0,45}\b(model|theory)\b",
    re.I,
)
_MULTIPLE_CONSTRAINT_RE = re.compile(
    r"\b(both|at least two|two different|multiple|several|while also|"
    r"considering|take into account|trade-?off|constraint|criteria|advantages? and disadvantages?|"
    r"benefits? and risks?|ethical and|environmental and|economic and)\b",
    re.I,
)
_DATA_INTERPRETATION_RE = re.compile(
    r"\b(trend|pattern|relationship|anomal(?:y|ies)|outlier|gradient|rate|"
    r"correlation|distribution|compare|difference|change over time|proportional|"
    r"interpolate|extrapolate)\b",
    re.I,
)
_DIRECT_STEM_RE = re.compile(
    r"^\s*(define|name|state|identify|list|recall|what is|what are|which of|"
    r"which statement|give one|describe one|explain why)\b",
    re.I,
)
_COGNITIVE_VERB_RE = re.compile(
    r"\b(explain|compare|analyse|analyze|evaluate|justify|predict|infer|design|"
    r"recommend|assess|interpret|propose|determine|calculate|describe|identify)\b",
    re.I,
)


@dataclass(frozen=True)
class ScienceComplexityAssessment:
    exercise_id: str
    primary_topic_id: str
    declared_complexity: str
    status: str
    evidence: tuple[str, ...]
    risk_flags: tuple[str, ...]
    contextual_dimensions: int
    direct_low_demand: bool
    review_priority: str
    rationale: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "exercise_id": self.exercise_id,
            "primary_topic_id": self.primary_topic_id,
            "declared_complexity": self.declared_complexity,
            "status": self.status,
            "evidence": list(self.evidence),
            "risk_flags": list(self.risk_flags),
            "contextual_dimensions": self.contextual_dimensions,
            "direct_low_demand": self.direct_low_demand,
            "review_priority": self.review_priority,
            "rationale": self.rationale,
        }


def _word_count(value: Any) -> int:
    return len(re.findall(r"[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?", str(value or "")))


def _primary_topic_id(exercise: dict[str, Any]) -> str:
    for topic_id in exercise.get("topic_ids") or []:
        if isinstance(topic_id, str) and topic_id.strip():
            return topic_id.strip()
    return ""


def _prompt_text(exercise: dict[str, Any]) -> str:
    parts = [str(exercise.get("question") or "")]
    for part in exercise.get("sub_parts") or []:
        if isinstance(part, dict):
            parts.append(str(part.get("question") or ""))
    return " ".join(parts).strip()


def _response_text(exercise: dict[str, Any]) -> str:
    parts = [str(exercise.get("answer") or ""), str(exercise.get("sample_reasoning") or "")]
    parts.extend(str(step) for step in exercise.get("steps") or [])
    for part in exercise.get("sub_parts") or []:
        if isinstance(part, dict):
            parts.append(str(part.get("answer") or ""))
    return " ".join(parts).strip()


def _has_visual_or_data(exercise: dict[str, Any]) -> bool:
    metadata = exercise.get("science_metadata") or {}
    data_representation = str(metadata.get("data_representation") or "").lower()
    return bool(
        exercise.get("diagram_data")
        or exercise.get("diagram_description")
        or exercise.get("image")
        or data_representation in {"table", "graph", "diagram", "model"}
    )


def _rubric_point_count(exercise: dict[str, Any]) -> int:
    rubric = exercise.get("rubric") or {}
    points = rubric.get("key_points") if isinstance(rubric, dict) else None
    return len(points) if isinstance(points, list) else 0


def assess_science_complexity(exercise: dict[str, Any]) -> ScienceComplexityAssessment:
    """Assess whether the declared complexity has contextual support.

    ``difficulty`` is intentionally not read.  The assessment is therefore
    independent of the pedagogical difficulty ladder and cannot mechanically
    map every extending item to ``complex_unfamiliar``.
    """
    exercise_id = str(exercise.get("id") or "<missing>")
    primary_topic_id = _primary_topic_id(exercise)
    declared = str(exercise.get("complexity") or "")
    prompt = _prompt_text(exercise)
    response = _response_text(exercise)
    combined = f"{prompt} {response}".strip()
    metadata = exercise.get("science_metadata") or {}
    question_type = str(exercise.get("question_type") or "short_answer")
    sub_parts = [part for part in exercise.get("sub_parts") or [] if isinstance(part, dict)]
    has_visual = _has_visual_or_data(exercise)

    evidence: list[str] = []
    risk_flags: list[str] = []

    rich_scenario_transfer = bool(
        _TRANSFER_CONTEXT_RE.search(prompt)
        and (
            _TRANSFER_VERB_RE.search(prompt)
            or (
                question_type in {"reasoning", "multi_part"}
                and _word_count(prompt) >= 30
                and (_rubric_point_count(exercise) >= 3 or len(sub_parts) >= 2)
            )
        )
    )
    if rich_scenario_transfer:
        evidence.append("unfamiliar_transfer")

    cognitive_verbs = {match.group(1).lower() for match in _COGNITIVE_VERB_RE.finditer(prompt)}
    if len(sub_parts) >= 2 or _MULTIPLE_CONSTRAINT_RE.search(prompt) or len(cognitive_verbs) >= 2:
        evidence.append("multiple_constraints")

    cer_authored = bool(metadata.get("claim_evidence_reasoning"))
    if _EVIDENCE_RE.search(combined) and (has_visual or cer_authored or "study" in combined.lower()):
        evidence.append("evidence_synthesis")

    if has_visual and _DATA_INTERPRETATION_RE.search(combined):
        evidence.append("data_interpretation")

    if _METHOD_EVALUATION_RE.search(combined):
        evidence.append("method_evaluation")

    if _MODEL_EVALUATION_RE.search(combined):
        evidence.append("model_evaluation")

    rubric_points = _rubric_point_count(exercise)
    response_depth = _word_count(response)
    if (
        question_type in {"reasoning", "multi_part"}
        and (rubric_points >= 3 or len(sub_parts) >= 2)
        and response_depth >= 35
    ):
        evidence.append("extended_reasoning_structure")

    evidence = list(dict.fromkeys(evidence))
    contextual_evidence = {
        "unfamiliar_transfer",
        "multiple_constraints",
        "evidence_synthesis",
        "data_interpretation",
        "method_evaluation",
        "model_evaluation",
    }
    contextual_dimensions = len(contextual_evidence.intersection(evidence))

    direct_low_demand = bool(
        question_type in {"multiple_choice", "short_answer"}
        and _word_count(prompt) <= 20
        and _word_count(response) <= 32
        and not has_visual
        and not sub_parts
        and _DIRECT_STEM_RE.search(prompt)
        and contextual_dimensions == 0
    )
    if direct_low_demand:
        risk_flags.append("short_direct_response")
    if question_type == "multiple_choice" and not has_visual and contextual_dimensions == 0:
        risk_flags.append("context_free_multiple_choice")
    if declared == "complex_unfamiliar" and "unfamiliar_transfer" not in evidence:
        risk_flags.append("no_unfamiliar_transfer_signal")
    if declared == "complex_unfamiliar" and contextual_dimensions < 2:
        risk_flags.append("insufficient_contextual_dimensions")

    if declared not in VALID_COMPLEXITY:
        status = "invalid"
        priority = "high"
        rationale = "The complexity label is missing or invalid."
    elif declared == "complex_unfamiliar":
        has_structured_reasoning = "extended_reasoning_structure" in evidence
        if direct_low_demand or (contextual_dimensions == 0 and not has_structured_reasoning):
            status = "unsupported"
            priority = "high"
            rationale = (
                "Complex unfamiliar is not supported by unfamiliar transfer, multiple constraints, "
                "evidence synthesis, data/model interpretation, inquiry evaluation or a substantial "
                "structured reasoning response."
            )
        elif contextual_dimensions == 0 or (contextual_dimensions == 1 and not has_structured_reasoning):
            status = "review"
            priority = "medium"
            rationale = (
                "The item has limited contextual complexity evidence; review whether it genuinely "
                "requires unfamiliar transfer rather than a familiar explanation."
            )
        else:
            status = "supported"
            priority = "none"
            rationale = (
                "The task combines contextual demand with structured reasoning, or shows at least "
                "two independent contextual complexity dimensions."
            )
    elif declared == "complex_familiar":
        if direct_low_demand:
            status = "review"
            priority = "low"
            rationale = "The task appears short and direct for a complex-familiar label."
        else:
            status = "supported"
            priority = "none"
            rationale = "No clear overstatement signal was detected."
    else:  # simple_familiar
        if contextual_dimensions >= 3 and question_type in {"reasoning", "multi_part"}:
            status = "review_understated"
            priority = "low"
            rationale = "Several contextual dimensions suggest the simple-familiar label may understate demand."
        else:
            status = "supported"
            priority = "none"
            rationale = "No clear understatement signal was detected."

    return ScienceComplexityAssessment(
        exercise_id=exercise_id,
        primary_topic_id=primary_topic_id,
        declared_complexity=declared,
        status=status,
        evidence=tuple(evidence),
        risk_flags=tuple(dict.fromkeys(risk_flags)),
        contextual_dimensions=contextual_dimensions,
        direct_low_demand=direct_low_demand,
        review_priority=priority,
        rationale=rationale,
    )


def complexity_review_queue(exercises: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return deterministic high-to-low review rows without modifying content."""
    priority_order = {"high": 0, "medium": 1, "low": 2, "none": 3}
    rows: list[dict[str, Any]] = []
    for exercise in exercises:
        assessment = assess_science_complexity(exercise)
        if assessment.review_priority == "none":
            continue
        rows.append(
            {
                **assessment.as_dict(),
                "question_type": exercise.get("question_type") or "short_answer",
                "question": str(exercise.get("question") or ""),
                "answer_excerpt": str(exercise.get("answer") or "")[:240],
                "science_metadata": json.dumps(exercise.get("science_metadata") or {}, ensure_ascii=False),
            }
        )
    rows.sort(
        key=lambda row: (
            priority_order.get(str(row["review_priority"]), 9),
            str(row["primary_topic_id"]),
            str(row["exercise_id"]),
        )
    )
    return rows


def stratified_complexity_sample(
    exercises: Iterable[dict[str, Any]],
    *,
    per_topic: int = 2,
) -> list[dict[str, Any]]:
    """Select a deterministic per-topic review sample.

    High-risk complex-unfamiliar items are selected first.  Remaining slots are
    filled by supported complex-unfamiliar items so a reviewer sees both likely
    problems and legitimate examples rather than only negative cases.
    """
    if per_topic < 1:
        return []

    grouped: dict[str, list[tuple[dict[str, Any], ScienceComplexityAssessment]]] = defaultdict(list)
    for exercise in exercises:
        assessment = assess_science_complexity(exercise)
        if assessment.declared_complexity != "complex_unfamiliar":
            continue
        grouped[assessment.primary_topic_id or "<missing>"].append((exercise, assessment))

    status_order = {"unsupported": 0, "review": 1, "supported": 2}
    sample: list[dict[str, Any]] = []
    for topic_id in sorted(grouped):
        candidates = sorted(
            grouped[topic_id],
            key=lambda pair: (
                status_order.get(pair[1].status, 9),
                -int(pair[1].direct_low_demand),
                pair[1].exercise_id,
            ),
        )
        selected = candidates[:per_topic]
        for exercise, assessment in selected:
            sample.append(
                {
                    **assessment.as_dict(),
                    "question_type": exercise.get("question_type") or "short_answer",
                    "question": str(exercise.get("question") or ""),
                    "answer_excerpt": str(exercise.get("answer") or "")[:240],
                }
            )
    return sample
