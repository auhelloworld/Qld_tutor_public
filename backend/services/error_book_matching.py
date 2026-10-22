"""Deterministic Error Book variation matching.

A correct answer may auto-resolve an Error Book item only when the redo question
is a genuine transfer task: same primary curriculum topic, same misconception or
observable skill demand, and not materially easier in difficulty, complexity or
response demand.  The matcher is pure so selection and server-side resolution
validation use exactly the same contract.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Iterable, Mapping

from backend.services.facet_mapping import english_learning_facet, science_learning_facet


_DIFFICULTY_RANK = {"foundational": 0, "developing": 1, "extending": 2, "AMC": 3}
_COMPLEXITY_RANK = {"simple_familiar": 0, "complex_familiar": 1, "complex_unfamiliar": 2}
_RESPONSE_RANK = {"multiple_choice": 0, "short_answer": 1, "reasoning": 2, "multi_part": 3}

_SKILL_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("calculation", re.compile(r"\b(calculate|solve|determine|find|compute|work out)\b", re.I)),
    ("data_interpretation", re.compile(r"\b(graph|table|data|trend|pattern|anomal|outlier|relationship)\b", re.I)),
    ("method_evaluation", re.compile(r"\b(validity|reliability|limitation|bias|uncertainty|fair test|sample size)\b", re.I)),
    ("justification", re.compile(r"\b(justify|prove|reasoning|show why|support your answer)\b", re.I)),
    ("evaluation", re.compile(r"\b(evaluate|assess|recommend|judge|most appropriate|best explanation)\b", re.I)),
    ("comparison", re.compile(r"\b(compare|contrast|similarit|difference|whereas)\b", re.I)),
    ("prediction", re.compile(r"\b(predict|forecast|infer|extrapolate)\b", re.I)),
    ("explanation", re.compile(r"\b(explain|why|because|mechanism|cause|effect)\b", re.I)),
    ("identification", re.compile(r"\b(identify|name|state|list|which)\b", re.I)),
)

_GENERIC_ERROR_TYPES = {
    "incorrect_choice",
    "incorrect_value",
    "incomplete_answer",
    "reasoning_incomplete",
    "parent_review_rejected",
    "partial_credit",
    "concept_gap",
}


@dataclass(frozen=True)
class ErrorBookVariationMatch:
    eligible: bool
    score: int
    reasons: tuple[str, ...]
    blockers: tuple[str, ...]
    source_question_id: str
    candidate_question_id: str
    same_primary_topic: bool
    misconception_or_skill_match: bool
    not_materially_easier: bool
    unseen: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "eligible": self.eligible,
            "score": self.score,
            "reasons": list(self.reasons),
            "blockers": list(self.blockers),
            "source_question_id": self.source_question_id,
            "candidate_question_id": self.candidate_question_id,
            "same_primary_topic": self.same_primary_topic,
            "misconception_or_skill_match": self.misconception_or_skill_match,
            "not_materially_easier": self.not_materially_easier,
            "unseen": self.unseen,
        }


def primary_topic_id(question: Mapping[str, Any]) -> str:
    for topic_id in question.get("topic_ids") or []:
        if isinstance(topic_id, str) and topic_id.strip():
            return topic_id.strip()
    topic = question.get("topic")
    return str(topic).strip() if topic else ""


def _metadata_tokens(question: Mapping[str, Any]) -> set[str]:
    tokens: set[str] = set()
    subject = str(question.get("subject") or "").lower()
    if subject == "english":
        tokens.add(f"facet:{english_learning_facet(dict(question))}")
    elif subject == "science":
        tokens.add(f"facet:{science_learning_facet(dict(question))}")

    for metadata_key in ("math_metadata", "english_metadata", "science_metadata"):
        metadata = question.get(metadata_key)
        if not isinstance(metadata, Mapping):
            continue
        for key, value in metadata.items():
            if isinstance(value, bool):
                if value:
                    tokens.add(f"meta:{key}")
            elif isinstance(value, str) and value.strip():
                cleaned = re.sub(r"\s+", "_", value.strip().lower())
                tokens.add(f"meta:{key}={cleaned}")
            elif isinstance(value, list):
                for item in value:
                    if isinstance(item, str) and item.strip():
                        cleaned = re.sub(r"\s+", "_", item.strip().lower())
                        tokens.add(f"meta:{key}={cleaned}")
    return tokens


def skill_signature(question: Mapping[str, Any]) -> set[str]:
    """Return observable skill/demand tokens, excluding the curriculum topic."""
    qtype = str(question.get("question_type") or "short_answer")
    text = " ".join(
        [str(question.get("question") or "")]
        + [
            str(part.get("question") or "")
            for part in question.get("sub_parts") or []
            if isinstance(part, Mapping)
        ]
    )
    tokens = {f"response:{qtype}"}
    response_rank = _RESPONSE_RANK.get(qtype, 1)
    tokens.add(f"response_band:{'extended' if response_rank >= 2 else 'selected' if response_rank == 0 else 'short'}")
    for name, pattern in _SKILL_PATTERNS:
        if pattern.search(text):
            tokens.add(f"demand:{name}")
    tokens.update(_metadata_tokens(question))
    return tokens


def _rank(value: object, mapping: Mapping[str, int], default: int) -> int:
    return mapping.get(str(value or ""), default)


def evaluate_error_book_variation(
    source_question: Mapping[str, Any],
    candidate_question: Mapping[str, Any],
    *,
    source_attempt: Mapping[str, Any] | None = None,
    misconception_topic_ids: Iterable[str] | None = None,
    unseen: bool = False,
) -> ErrorBookVariationMatch:
    """Evaluate one candidate against the transfer-safe resolution contract."""
    source_id = str(source_question.get("id") or "")
    candidate_id = str(candidate_question.get("id") or "")
    reasons: list[str] = []
    blockers: list[str] = []

    if not source_id or not candidate_id or source_id == candidate_id:
        blockers.append("candidate_must_be_a_different_question")

    source_topic = primary_topic_id(source_question)
    candidate_topic = primary_topic_id(candidate_question)
    same_primary_topic = bool(source_topic and source_topic == candidate_topic)
    if same_primary_topic:
        reasons.append("same_primary_topic")
    else:
        blockers.append("primary_topic_mismatch")

    source_difficulty = _rank(source_question.get("difficulty"), _DIFFICULTY_RANK, 1)
    candidate_difficulty = _rank(candidate_question.get("difficulty"), _DIFFICULTY_RANK, 1)
    source_complexity = _rank(source_question.get("complexity"), _COMPLEXITY_RANK, 1)
    candidate_complexity = _rank(candidate_question.get("complexity"), _COMPLEXITY_RANK, 1)
    source_response = _rank(source_question.get("question_type"), _RESPONSE_RANK, 1)
    candidate_response = _rank(candidate_question.get("question_type"), _RESPONSE_RANK, 1)

    not_materially_easier = bool(
        candidate_difficulty >= source_difficulty
        and candidate_complexity >= source_complexity
        and candidate_response >= source_response
    )
    if not_materially_easier:
        reasons.append("not_materially_easier")
    else:
        if candidate_difficulty < source_difficulty:
            blockers.append("lower_difficulty")
        if candidate_complexity < source_complexity:
            blockers.append("lower_complexity")
        if candidate_response < source_response:
            blockers.append("lower_response_demand")

    source_signature = skill_signature(source_question)
    candidate_signature = skill_signature(candidate_question)
    meaningful_overlap = {
        token
        for token in source_signature.intersection(candidate_signature)
        if not token.startswith(("response:", "response_band:"))
    }

    source_attempt = source_attempt or {}
    misconception_id = str(source_attempt.get("misconception_id") or "").strip()
    misconception_topics = {str(topic_id) for topic_id in misconception_topic_ids or []}
    misconception_match = bool(
        misconception_id
        and misconception_topics
        and candidate_topic in misconception_topics
    )

    error_type = str(source_attempt.get("error_type") or "").strip()
    specific_error_skill = bool(error_type and error_type not in _GENERIC_ERROR_TYPES)
    skill_match = bool(meaningful_overlap)
    if specific_error_skill and same_primary_topic:
        # A specific persisted error code is evidence of a skill-level match only
        # when the candidate remains in the same primary curriculum topic.
        skill_match = True
        reasons.append(f"specific_error:{error_type}")
    if misconception_match:
        reasons.append(f"misconception:{misconception_id}")
    if meaningful_overlap:
        reasons.append("skill_overlap:" + ",".join(sorted(meaningful_overlap)[:4]))

    misconception_or_skill_match = misconception_match or skill_match
    if not misconception_or_skill_match:
        blockers.append("no_misconception_or_skill_match")

    if unseen:
        reasons.append("unseen_question")

    eligible = not blockers and same_primary_topic and misconception_or_skill_match and not_materially_easier
    score = 0
    score += 60 if eligible else 0
    score += 20 if misconception_match else 0
    score += min(15, len(meaningful_overlap) * 5)
    score += 10 if candidate_difficulty == source_difficulty else 4 if candidate_difficulty > source_difficulty else 0
    score += 8 if candidate_complexity == source_complexity else 3 if candidate_complexity > source_complexity else 0
    score += 7 if candidate_response == source_response else 2 if candidate_response > source_response else 0
    score += 10 if unseen else 0

    return ErrorBookVariationMatch(
        eligible=eligible,
        score=score,
        reasons=tuple(dict.fromkeys(reasons)),
        blockers=tuple(dict.fromkeys(blockers)),
        source_question_id=source_id,
        candidate_question_id=candidate_id,
        same_primary_topic=same_primary_topic,
        misconception_or_skill_match=misconception_or_skill_match,
        not_materially_easier=not_materially_easier,
        unseen=unseen,
    )


def select_error_book_variation(
    source_question: Mapping[str, Any],
    candidates: Iterable[Mapping[str, Any]],
    *,
    source_attempt: Mapping[str, Any] | None = None,
    misconception_topic_ids: Iterable[str] | None = None,
    attempted_question_ids: Iterable[str] | None = None,
) -> tuple[dict[str, Any] | None, ErrorBookVariationMatch | None]:
    """Return the highest-ranked eligible variation, preferring unseen work."""
    attempted = {str(question_id) for question_id in attempted_question_ids or []}
    ranked: list[tuple[ErrorBookVariationMatch, dict[str, Any]]] = []
    for candidate in candidates:
        candidate_dict = dict(candidate)
        candidate_id = str(candidate_dict.get("id") or "")
        match = evaluate_error_book_variation(
            source_question,
            candidate_dict,
            source_attempt=source_attempt,
            misconception_topic_ids=misconception_topic_ids,
            unseen=bool(candidate_id and candidate_id not in attempted),
        )
        if match.eligible:
            ranked.append((match, candidate_dict))

    if not ranked:
        return None, None
    ranked.sort(
        key=lambda pair: (
            -pair[0].score,
            pair[0].candidate_question_id,
        )
    )
    best_match, best_candidate = ranked[0]
    return best_candidate, best_match
