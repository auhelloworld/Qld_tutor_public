import logging
import json
from collections import Counter
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from zoneinfo import ZoneInfo
from backend.rules import get_engine, get_weekly_learning_records, get_weekly_reflection
from backend.tutor_engine import get_tutor_engine
from backend.subject_registry import display_name_for_subject
from backend.services.analytics_scope import topic_in_scope, valid_topic_ids_for_scope
from backend.services.attempt_outcomes import (
    AttemptOutcome,
    classify_attempt,
    deduplicate_attempts,
    is_independent_learning_attempt,
    is_scored_learning_attempt,
)
from backend.services.facet_mapping import english_learning_facet, science_learning_facet

logger = logging.getLogger(__name__)



def _parent_guided_deep_link(
    subject: str,
    year: str,
    *,
    year_level: int | None,
    unit: int | None,
    syllabus_subject: str | None,
    topic_id: str | None = None,
) -> str:
    """Build a parent recommendation link that cannot fall back to browser scope."""
    picker_subject = f"senior_{syllabus_subject}" if syllabus_subject else subject
    params: dict[str, str] = {
        "subject": picker_subject,
        "mode": "parent-focus",
    }
    if topic_id:
        params["topic"] = topic_id
    if unit is not None:
        params["unit"] = str(unit)
    elif year_level is not None:
        params["year"] = f"year{year_level}"
    elif year:
        params["year"] = year
    if syllabus_subject:
        params["syllabus_subject"] = syllabus_subject
    return f"/guided-practice?{urlencode(params)}"
def _year_level_from_year(year: str | None) -> int | None:
    if not year:
        return None
    if year.startswith("year"):
        try:
            return int(year.removeprefix("year"))
        except ValueError:
            return None
    return None


def _is_real_learning_attempt(att: dict) -> bool:
    if not is_scored_learning_attempt(att) or bool(att.get("used_show_answer")):
        return False
    return not str(att.get("question_id", "")).startswith("pseudo_")


def _is_remediation_attempt(att: dict) -> bool:
    """Evidence suitable for conceptual/facet remediation decisions."""
    return _is_real_learning_attempt(att) and not bool(att.get("is_speed_round"))


def _attempt_score_ratio(att: dict) -> float:
    """Return scored credit in [0, 1], preserving rubric partial credit."""
    score = att.get("score")
    max_score = att.get("max_score")
    try:
        if score is not None and max_score is not None and float(max_score) > 0:
            return max(0.0, min(float(score) / float(max_score), 1.0))
    except (TypeError, ValueError, ZeroDivisionError):
        pass
    return 1.0 if att.get("correct") else 0.0


def _count_student_dialogue_turns(topic_data: dict) -> int:
    return sum(
        1
        for turn in topic_data.get("dialogue_sessions", [])
        if turn.get("role") == "student"
    )


def _weighted_student_dialogue_turns(topic_data: dict) -> float:
    """Weighted student dialogue turns for the independence metric.

    Pre-attempt concept exploration is encouraged metacognition, so it counts
    far less toward 'help reliance' (0.25) than post-attempt rescue turns (1.0).
    """
    total = 0.0
    for turn in topic_data.get("dialogue_sessions", []):
        if turn.get("role") != "student":
            continue
        total += 0.25 if turn.get("pre_attempt") else 1.0
    return total


def _parse_timestamp(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _attempt_weight(att: dict, now: datetime) -> float:
    ts = _parse_timestamp(att.get("timestamp"))
    base = 1.0 if ts and ts >= now - timedelta(days=7) else 0.35
    if att.get("attempt_type") == "diagnostic":
        base *= 0.75
    return base


def _topic_attempt_metrics(atts: list[dict], now: datetime) -> dict:
    weighted_total = 0.0
    weighted_correct = 0.0
    recent_attempts = 0
    recent_correct = 0
    recent_incorrect = 0
    for att in atts:
        weight = _attempt_weight(att, now)
        weighted_total += weight
        if att.get("correct"):
            weighted_correct += weight
        ts = _parse_timestamp(att.get("timestamp"))
        if ts and ts >= now - timedelta(days=7):
            recent_attempts += 1
            if att.get("correct"):
                recent_correct += 1
            else:
                recent_incorrect += 1
    weighted_accuracy = weighted_correct / weighted_total if weighted_total > 0 else 1.0
    recent_accuracy = recent_correct / recent_attempts if recent_attempts > 0 else None
    confidence = "high" if len(atts) >= 6 else "medium" if len(atts) >= 3 else "low"

    independent_atts = [att for att in atts if is_independent_learning_attempt(att)]
    independent_weighted_total = 0.0
    independent_weighted_correct = 0.0
    independent_recent_attempts = 0
    independent_recent_correct = 0
    for att in independent_atts:
        weight = _attempt_weight(att, now)
        independent_weighted_total += weight
        if att.get("correct"):
            independent_weighted_correct += weight
        ts = _parse_timestamp(att.get("timestamp"))
        if ts and ts >= now - timedelta(days=7):
            independent_recent_attempts += 1
            if att.get("correct"):
                independent_recent_correct += 1
    independent_weighted_accuracy = (
        independent_weighted_correct / independent_weighted_total
        if independent_weighted_total > 0
        else None
    )
    independent_recent_accuracy = (
        independent_recent_correct / independent_recent_attempts
        if independent_recent_attempts > 0
        else None
    )
    independent_confidence = _confidence_for_count(len(independent_atts))
    return {
        "attempts": len(atts),
        "weighted_total": weighted_total,
        "weighted_accuracy": weighted_accuracy,
        "recent_attempts": recent_attempts,
        "recent_accuracy": recent_accuracy,
        "recent_incorrect": recent_incorrect,
        "confidence": confidence,
        "independent_evidence_count": len(independent_atts),
        "independent_weighted_accuracy": independent_weighted_accuracy,
        "independent_recent_attempts": independent_recent_attempts,
        "independent_recent_accuracy": independent_recent_accuracy,
        "independent_confidence": independent_confidence,
    }


def _confidence_for_count(count: int) -> str:
    if count <= 0:
        return "none"
    if count <= 2:
        return "low"
    if count <= 4:
        return "medium"
    return "high"


def _status_for_score(score: float, evidence_count: int) -> str:
    if evidence_count <= 0:
        return "developing"
    if score >= 0.75:
        return "secure" if _confidence_for_count(evidence_count) != "low" else "developing"
    if score >= 0.4:
        return "developing"
    return "stretch"


def _finalise_facet_confidence(facets: dict) -> dict:
    for meta in facets.values():
        evidence_count = int(meta.get("evidence_count") or 0)
        confidence = meta.get("confidence") or _confidence_for_count(evidence_count)
        meta["evidence_count"] = evidence_count
        meta["confidence"] = confidence
        meta.setdefault("evidence_sources", {})
        if meta.get("status") == "secure" and confidence == "low":
            meta["status"] = "developing"
            meta["evidence"] = f"{meta.get('evidence', '')} More evidence is needed before treating this as secure.".strip()
    return facets


def _writing_history_path(student_id: str) -> Path:
    return Path(__file__).resolve().parents[2] / "data" / "logs" / student_id / "english_writing_log.json"


def _load_writing_assessments(student_id: str, year_level: int | None) -> list[dict]:
    path = _writing_history_path(student_id)
    try:
        if not path.exists():
            return []
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        logger.warning("Failed to load writing history for facet derivation", exc_info=True)
        return []
    assessments = data.get("assessments", [])
    if year_level is None:
        return [a for a in assessments if isinstance(a, dict)]
    return [a for a in assessments if isinstance(a, dict) and a.get("year_level") == year_level]


def _writing_facet_for_criterion(score: dict) -> str | None:
    name = str(score.get("name") or "").lower()
    domain = str(score.get("domain") or "").lower()
    if any(term in name for term in ("vocabulary", "register")):
        return "vocabulary"
    if any(term in name for term in ("spelling", "punctuation", "grammar", "sentence", "syntax", "conventions", "textual features")):
        return "language_conventions"
    if any(term in name for term in ("structure", "organisation", "organization", "paragraph", "cohesion", "development")):
        return "writing_structure"
    if any(term in name for term in ("evidence", "source", "analysis", "knowledge", "thesis", "point", "explanation")):
        return "text_evidence"
    if domain in {"teel", "ismg"}:
        return "text_evidence"
    return None


def _apply_english_writing_evidence(facets: dict, student_id: str, year_level: int | None) -> None:
    assessments = _load_writing_assessments(student_id, year_level)
    buckets: dict[str, list[float]] = {
        "text_evidence": [],
        "language_conventions": [],
        "vocabulary": [],
        "writing_structure": [],
    }
    for assessment in assessments:
        for score in assessment.get("criterion_scores", []) or []:
            if not isinstance(score, dict):
                continue
            max_score = score.get("max_score") or 0
            if not max_score:
                continue
            facet = _writing_facet_for_criterion(score)
            if facet in buckets:
                buckets[facet].append(float(score.get("score") or 0) / float(max_score))
        source_feedback = assessment.get("source_use_feedback") or {}
        if isinstance(source_feedback, dict) and source_feedback:
            buckets["text_evidence"].append(1.0 if source_feedback.get("uses_source_evidence") else 0.0)

    for facet, ratios in buckets.items():
        if not ratios or facet not in facets:
            continue
        writing_count = len(ratios)
        writing_score = sum(ratios) / writing_count
        existing_count = int(facets[facet].get("evidence_count") or 0)
        existing_score = float(facets[facet].get("score") or 0.5)
        combined_count = existing_count + writing_count
        combined_score = (
            (existing_score * existing_count) + (writing_score * writing_count)
        ) / combined_count if combined_count else writing_score
        facets[facet]["score"] = round(combined_score, 2)
        facets[facet]["status"] = _status_for_score(combined_score, combined_count)
        facets[facet]["evidence_count"] = combined_count
        sources = dict(facets[facet].get("evidence_sources") or {})
        if existing_count:
            sources.setdefault("practice", existing_count)
        sources["writing"] = sources.get("writing", 0) + writing_count
        facets[facet]["evidence_sources"] = sources
        facets[facet]["evidence"] = (
            f"Combined practice and Writing Hub evidence across {combined_count} item"
            f"{'' if combined_count == 1 else 's'}."
        )


def _latest_exam_weak_topics(
    log_data: dict,
    valid_topic_ids: set[str] | None,
    *,
    subject: str | None = None,
    year_level: int | None = None,
    unit: int | None = None,
    syllabus_subject: str | None = None,
) -> list[str]:
    sessions = []
    for session in log_data.get("exam_sessions", []):
        results = session.get("results")
        if not session.get("completed_at") or not isinstance(results, dict):
            continue
        if subject and str(session.get("subject") or subject).lower() != subject.lower():
            continue
        if year_level is not None and session.get("year_level") != year_level:
            continue
        if unit is not None and session.get("unit") != unit:
            continue
        if syllabus_subject is not None and session.get("syllabus_subject") != syllabus_subject:
            continue
        provisional = bool(results.get("provisional")) or any(
            item.get("requires_review")
            for item in results.get("results_per_question", [])
            if isinstance(item, dict)
        )
        if provisional:
            continue
        sessions.append(session)
    sessions.sort(key=lambda s: s.get("completed_at") or s.get("started_at") or "", reverse=True)
    if not sessions:
        return []
    weak_topics = sessions[0].get("results", {}).get("weak_topics", []) or []
    return [tid for tid in weak_topics if topic_in_scope(tid, valid_topic_ids)]


def derive_learning_facets(
    student_id: str,
    subject: str = "math",
    year_level: int | None = None,
    unit: int | None = None,
    syllabus_subject: str | None = None,
) -> dict:
    """Derive learning facets (fluency, conceptual understanding, reasoning, problem solving, independence)
    from student logs and exercise metadata without altering the core database schema.
    """
    engine = get_engine(student_id, subject)
    valid_topic_ids = valid_topic_ids_for_scope(subject, year_level, unit, syllabus_subject)
    log_data = engine.load_log(topics=valid_topic_ids)
    tutor = get_tutor_engine()

    dialogue_student_turns = 0
    dialogue_help_weight = 0.0
    scoped_attempt_rows: list[dict] = []

    for topic_id, topic_data in log_data.get("topics", {}).items():
        if not topic_in_scope(topic_id, valid_topic_ids):
            continue
        dialogue_student_turns += _count_student_dialogue_turns(topic_data)
        dialogue_help_weight += _weighted_student_dialogue_turns(topic_data)
        scoped_attempt_rows.extend(topic_data.get("attempts", []))

    physical_attempts = deduplicate_attempts(scoped_attempt_rows)
    hint_count = sum(
        1 for attempt in physical_attempts
        if attempt.get("attempt_type") == "hint"
    )
    reveal_count = sum(
        1 for attempt in physical_attempts
        if is_scored_learning_attempt(attempt) and bool(attempt.get("used_show_answer"))
    )
    attempts = [attempt for attempt in physical_attempts if _is_real_learning_attempt(attempt)]
    independent_attempts = [
        attempt for attempt in physical_attempts
        if is_independent_learning_attempt(attempt)
    ]
    total_answers = len(attempts)

    subj = (subject or "math").lower().strip()

    # Defaults based on subject
    if subj == "english":
        facets = {
            "comprehension": {
                "status": "developing",
                "score": 0.5,
                "evidence": "Not enough comprehension exercises attempted yet."
            },
            "text_evidence": {
                "status": "developing",
                "score": 0.5,
                "evidence": "Not enough evidence-based exercises attempted yet."
            },
            "language_conventions": {
                "status": "developing",
                "score": 0.5,
                "evidence": "Not enough language conventions exercises attempted yet."
            },
            "vocabulary": {
                "status": "developing",
                "score": 0.5,
                "evidence": "Not enough vocabulary exercises attempted yet."
            },
            "writing_structure": {
                "status": "developing",
                "score": 0.5,
                "evidence": "Not enough writing structure exercises attempted yet."
            },
            "independence": {
                "status": "developing",
                "score": 0.5,
                "evidence": "Get started by attempting questions independently."
            }
        }
    elif subj == "science":
        facets = {
            "conceptual_knowledge": {
                "status": "developing",
                "score": 0.5,
                "evidence": "Not enough conceptual Science evidence yet."
            },
            "inquiry_design": {
                "status": "developing",
                "score": 0.5,
                "evidence": "Not enough investigation-design evidence yet."
            },
            "data_interpretation": {
                "status": "developing",
                "score": 0.5,
                "evidence": "Not enough table, graph or data interpretation evidence yet."
            },
            "scientific_reasoning": {
                "status": "developing",
                "score": 0.5,
                "evidence": "Not enough claim-evidence-reasoning evidence yet."
            },
            "science_in_context": {
                "status": "developing",
                "score": 0.5,
                "evidence": "Not enough science-in-context evidence yet."
            },
            "independence": {
                "status": "developing",
                "score": 0.5,
                "evidence": "Get started by attempting questions independently."
            }
        }
    else:
        facets = {
            "fluency": {
                "status": "developing",
                "score": 0.5,
                "evidence": "Not enough practice data yet. Complete more exercises to calibrate."
            },
            "conceptual_understanding": {
                "status": "developing",
                "score": 0.5,
                "evidence": "Not enough practice data yet. Review lessons to improve."
            },
            "reasoning": {
                "status": "developing",
                "score": 0.5,
                "evidence": "Not enough reasoning questions attempted yet."
            },
            "problem_solving": {
                "status": "developing",
                "score": 0.5,
                "evidence": "Not enough extending or AMC questions attempted yet."
            },
            "independence": {
                "status": "developing",
                "score": 0.5,
                "evidence": "Get started by attempting questions independently."
            }
        }

    def apply_independence_facet() -> None:
        # Pre-attempt exploration is down-weighted (see _weighted_student_dialogue_turns)
        # so productive metacognition is not penalised as help-reliance.
        independent_answer_count = len(independent_attempts)
        total_help = hint_count + dialogue_help_weight + reveal_count
        total_actions = total_answers + total_help
        if total_actions > 0:
            independence_score = independent_answer_count / total_actions
        else:
            independence_score = 1.0

        facets["independence"]["score"] = round(independence_score, 2)
        facets["independence"]["evidence_count"] = independent_answer_count
        facets["independence"]["independent_evidence_count"] = independent_answer_count
        facets["independence"]["confidence"] = _confidence_for_count(independent_answer_count)
        facets["independence"]["evidence_sources"] = (
            {"practice": independent_answer_count} if independent_answer_count else {}
        )
        facets["independence"]["answer_count"] = total_answers
        facets["independence"]["supported_answer_count"] = max(
            0, total_answers - independent_answer_count
        )
        facets["independence"]["hint_count"] = hint_count
        facets["independence"]["reveal_count"] = reveal_count
        facets["independence"]["dialogue_turns"] = dialogue_student_turns
        if independence_score >= 0.85:
            facets["independence"]["status"] = _status_for_score(independence_score, independent_answer_count)
            facets["independence"]["evidence"] = "Solves questions independently with minimal reliance on Concept, AI Tutor Chat or revealed answers."
        elif independence_score >= 0.5:
            facets["independence"]["status"] = "developing"
            facets["independence"]["evidence"] = "Uses Concept, AI Tutor Chat or worked examples to get unstuck while building independence."
        else:
            facets["independence"]["status"] = "stretch"
            facets["independence"]["evidence"] = "Independent evidence is limited. Try attempting the first step before asking for help."

    if not attempts:
        if subj == "english":
            _apply_english_writing_evidence(facets, student_id, year_level)
        apply_independence_facet()
        return _finalise_facet_confidence(facets)

    # Helper function to compute status/score/evidence for a given list of attempts
    def compute_facet(att_list, name, secure_msg, dev_msg, stretch_msg):
        if not att_list:
            return
        score = sum(_attempt_score_ratio(a) for a in att_list) / len(att_list)
        evidence_count = len(att_list)
        facets[name]["score"] = round(score, 2)
        facets[name]["evidence_count"] = evidence_count
        facets[name]["confidence"] = _confidence_for_count(evidence_count)
        facets[name]["evidence_sources"] = {"practice": evidence_count}
        status = _status_for_score(score, evidence_count)
        if status == "secure":
            facets[name]["status"] = "secure"
            facets[name]["evidence"] = secure_msg
        elif status == "developing":
            facets[name]["status"] = "developing"
            facets[name]["evidence"] = dev_msg
        else:
            facets[name]["status"] = "stretch"
            facets[name]["evidence"] = stretch_msg

    # 1. Subject-specific classification logic. Speed-round evidence is useful
    # for fluency, but it must not drive conceptual remediation or extension.
    facet_attempts = [attempt for attempt in attempts if not attempt.get("is_speed_round")]

    if subj == "english":
        comp_attempts = []
        evidence_attempts = []
        conv_attempts = []
        vocab_attempts = []
        writing_attempts = []

        for att in facet_attempts:
            qid = att.get("question_id", "")
            ex = tutor.exercises.get(qid, {})
            facet = english_learning_facet(ex)
            if facet == "text_evidence":
                evidence_attempts.append(att)
            elif facet == "language_conventions":
                conv_attempts.append(att)
            elif facet == "vocabulary":
                vocab_attempts.append(att)
            elif facet == "writing_structure":
                writing_attempts.append(att)
            else:
                comp_attempts.append(att)

        compute_facet(comp_attempts, "comprehension", 
                      "Strong reading comprehension and inference skills.",
                      "Good general comprehension, but misses subtle details or tone.",
                      "Needs practice with literal comprehension and reading closely.")
        compute_facet(evidence_attempts, "text_evidence",
                      "Consistently supports arguments with precise quotes and text evidence.",
                      "Identifies evidence but could integrate or explain it more clearly.",
                      "Needs practice locating and quoting evidence from the text.")
        compute_facet(conv_attempts, "language_conventions",
                      "Excellent command of grammar, punctuation, and spelling.",
                      "Developing language skills, with occasional grammatical slips.",
                      "Needs practice with core punctuation, grammar rules, or spelling.")
        compute_facet(vocab_attempts, "vocabulary",
                      "Strong understanding of vocabulary and literary devices.",
                      "Developing vocabulary; sometimes misses meanings or metaphors.",
                      "Focus on learning key terms, definitions, and word meanings.")
        compute_facet(writing_attempts, "writing_structure",
                      "Excellent sentence and paragraph structuring.",
                      "Structures sentences well but needs more varied paragraph layout.",
                      "Needs practice organizing ideas and structuring clear sentences.")

    elif subj == "science":
        science_attempts: dict[str, list[dict]] = {
            "conceptual_knowledge": [],
            "inquiry_design": [],
            "data_interpretation": [],
            "scientific_reasoning": [],
            "science_in_context": [],
        }
        for att in facet_attempts:
            qid = att.get("question_id", "")
            ex = tutor.exercises.get(qid, {})
            science_attempts[science_learning_facet(ex)].append(att)

        compute_facet(science_attempts["conceptual_knowledge"], "conceptual_knowledge",
                      "Strong grasp of core scientific concepts and relationships.",
                      "Developing understanding of scientific concepts with some gaps.",
                      "Review the core scientific model, vocabulary and causal relationships.")
        compute_facet(science_attempts["inquiry_design"], "inquiry_design",
                      "Plans fair investigations and identifies variables, equipment and safety controls.",
                      "Can plan an investigation but needs more precision with variables or controls.",
                      "Practise identifying variables, controls, equipment and safety requirements.")
        compute_facet(science_attempts["data_interpretation"], "data_interpretation",
                      "Accurately interprets tables, graphs, diagrams and calculated patterns.",
                      "Finds main data patterns but sometimes misses units, scales or anomalies.",
                      "Practise reading axes, units, trends and anomalies before drawing conclusions.")
        compute_facet(science_attempts["scientific_reasoning"], "scientific_reasoning",
                      "Links claims to relevant evidence with clear scientific reasoning.",
                      "Uses evidence but needs a clearer explanation of how it supports the claim.",
                      "Practise claim-evidence-reasoning responses using specific data.")
        compute_facet(science_attempts["science_in_context"], "science_in_context",
                      "Explains how science interacts with technology, society and decision-making.",
                      "Recognises science-in-society links but needs more specific evaluation.",
                      "Practise evaluating benefits, limitations and impacts in real contexts.")

    else:
        # Maths / Default
        # 1. Fluency: based on short-answer questions correct on the first attempt without tutor support
        sa_attempts = []
        first_attempt_correct_count = 0
        question_attempt_orders = {}  # question_id -> list of attempts

        for att in attempts:
            qid = att.get("question_id")
            if not qid:
                continue
            ex = tutor.exercises.get(qid, {})
            q_type = att.get("question_type") or ex.get("question_type") or "short_answer"
            
            if q_type == "short_answer":
                sa_attempts.append(att)
                if qid not in question_attempt_orders:
                    question_attempt_orders[qid] = []
                question_attempt_orders[qid].append(att)

        if sa_attempts:
            first_attempts_correct = 0
            total_unique_sa = len(question_attempt_orders)
            for qid, atts_list in question_attempt_orders.items():
                sorted_atts = sorted(atts_list, key=lambda a: a.get("timestamp", ""))
                first_att = sorted_atts[0]
                if first_att.get("correct"):
                    first_attempts_correct += 1
            
            fluency_score = first_attempts_correct / total_unique_sa if total_unique_sa > 0 else 0.5
            facets["fluency"]["score"] = round(fluency_score, 2)
            facets["fluency"]["evidence_count"] = total_unique_sa
            facets["fluency"]["confidence"] = _confidence_for_count(total_unique_sa)
            facets["fluency"]["evidence_sources"] = {"practice": total_unique_sa}
            fluency_status = _status_for_score(fluency_score, total_unique_sa)
            if fluency_status == "secure":
                facets["fluency"]["status"] = "secure"
                facets["fluency"]["evidence"] = "Most fluency and short-answer questions correct on first attempt."
            elif fluency_status == "developing":
                facets["fluency"]["status"] = "developing"
                facets["fluency"]["evidence"] = "Building speed. Some short-answer questions need multiple attempts."
            else:
                facets["fluency"]["status"] = "stretch"
                facets["fluency"]["evidence"] = "Needs more basic recall and calculation practice."

        # 2. Conceptual Understanding: every incorrect response reduces the
        # score. A likely calculation/value slip retains only limited credit;
        # it can never make an all-wrong history look conceptually secure.
        concept_attempts = facet_attempts
        concept_credit = 0.0
        for attempt in concept_attempts:
            if attempt.get("correct"):
                concept_credit += 1.0
                continue
            partial_credit = _attempt_score_ratio(attempt)
            if attempt.get("error_type") == "incorrect_value":
                concept_credit += max(partial_credit, 0.25)
            else:
                concept_credit += partial_credit

        concept_score = (
            concept_credit / len(concept_attempts)
            if concept_attempts
            else 0.5
        )
        concept_evidence_count = len(concept_attempts)

        facets["conceptual_understanding"]["score"] = round(concept_score, 2)
        facets["conceptual_understanding"]["evidence_count"] = concept_evidence_count
        facets["conceptual_understanding"]["confidence"] = _confidence_for_count(concept_evidence_count)
        facets["conceptual_understanding"]["evidence_sources"] = {"practice": concept_evidence_count} if concept_evidence_count else {}
        concept_status = _status_for_score(concept_score, concept_evidence_count)
        if concept_status == "secure" and concept_score >= 0.8:
            facets["conceptual_understanding"]["status"] = "secure"
            facets["conceptual_understanding"]["evidence"] = "Strong grasp of topic rules and core concept relations."
        elif concept_score >= 0.5:
            facets["conceptual_understanding"]["status"] = "developing"
            facets["conceptual_understanding"]["evidence"] = "Understands core ideas but makes occasional conceptual slips."
        else:
            facets["conceptual_understanding"]["status"] = "stretch"
            facets["conceptual_understanding"]["evidence"] = "Frequent conceptual errors. Review lesson cards and worked examples."

        # 3. Reasoning: based on reasoning questions and rubric scores
        reasoning_attempts = []
        reasoning_score_sum = 0.0
        reasoning_max_sum = 0.0

        for att in facet_attempts:
            qid = att.get("question_id")
            ex = tutor.exercises.get(qid, {})
            q_type = att.get("question_type") or ex.get("question_type")
            
            if q_type == "reasoning":
                reasoning_attempts.append(att)
                score = att.get("score")
                max_score = att.get("max_score")
                if score is not None and max_score:
                    reasoning_score_sum += score
                    reasoning_max_sum += max_score
                else:
                    reasoning_score_sum += 1.0 if att.get("correct") else 0.0
                    reasoning_max_sum += 1.0

        if reasoning_attempts:
            reasoning_score = reasoning_score_sum / reasoning_max_sum if reasoning_max_sum > 0 else 0.5
            facets["reasoning"]["score"] = round(reasoning_score, 2)
            facets["reasoning"]["evidence_count"] = len(reasoning_attempts)
            facets["reasoning"]["confidence"] = _confidence_for_count(len(reasoning_attempts))
            facets["reasoning"]["evidence_sources"] = {"practice": len(reasoning_attempts)}
            reasoning_status = _status_for_score(reasoning_score, len(reasoning_attempts))
            if reasoning_status == "secure" and reasoning_score >= 0.8:
                facets["reasoning"]["status"] = "secure"
                facets["reasoning"]["evidence"] = "Explanations meet all key points of mathematical reasoning rubrics."
            elif reasoning_score >= 0.4:
                facets["reasoning"]["status"] = "developing"
                facets["reasoning"]["evidence"] = "Explanations show correct logic but omit intermediate steps or justifications."
            else:
                facets["reasoning"]["status"] = "stretch"
                facets["reasoning"]["evidence"] = "Needs practice structuring justifications and writing complete mathematical steps."

        # 4. Problem Solving: based on difficulty (extending, AMC) and complexity (complex unfamiliar)
        solving_attempts = []
        solving_correct = 0

        for att in facet_attempts:
            qid = att.get("question_id")
            ex = tutor.exercises.get(qid, {})
            diff = ex.get("difficulty")
            comp = ex.get("complexity")
            
            if diff in ("extending", "AMC") or comp == "complex_unfamiliar":
                solving_attempts.append(att)
                if att.get("correct"):
                    solving_correct += 1

        if solving_attempts:
            solving_score = solving_correct / len(solving_attempts)
            facets["problem_solving"]["score"] = round(solving_score, 2)
            facets["problem_solving"]["evidence_count"] = len(solving_attempts)
            facets["problem_solving"]["confidence"] = _confidence_for_count(len(solving_attempts))
            facets["problem_solving"]["evidence_sources"] = {"practice": len(solving_attempts)}
            solving_status = _status_for_score(solving_score, len(solving_attempts))
            if solving_status == "secure":
                facets["problem_solving"]["status"] = "secure"
                facets["problem_solving"]["evidence"] = "Highly capable at solving non-routine and complex unfamiliar questions."
            elif solving_status == "developing":
                facets["problem_solving"]["status"] = "developing"
                facets["problem_solving"]["evidence"] = "Handles standard unfamiliar tasks but struggles with multi-part AMC challenges."
            else:
                facets["problem_solving"]["status"] = "stretch"
                facets["problem_solving"]["evidence"] = "Struggles with non-routine problem solving. Start with develops first."

    # 5. Independence: based on ratio of hints/dialogue to questions (common to all subjects)
    if subj == "english":
        _apply_english_writing_evidence(facets, student_id, year_level)
    apply_independence_facet()

    return _finalise_facet_confidence(facets)


def derive_parent_next_steps(
    student_id: str,
    subject: str = "math",
    year: str = "year7",
    year_level: int | None = None,
    unit: int | None = None,
    syllabus_subject: str | None = None,
) -> dict:
    """Derive parent-friendly insights and next-step actions from student log data."""
    engine = get_engine(student_id, subject)
    if year_level is None:
        year_level = _year_level_from_year(year)
    valid_topic_ids = valid_topic_ids_for_scope(subject, year_level, unit, syllabus_subject)
    log_data = engine.load_log(topics=valid_topic_ids)
    tutor = get_tutor_engine()

    dialogue_student_turns = 0
    topic_attempts: dict[str, list[dict]] = {}
    scoped_attempt_rows: list[dict] = []

    for topic_id, topic_data in log_data.get("topics", {}).items():
        if not topic_in_scope(topic_id, valid_topic_ids):
            continue
        dialogue_student_turns += _count_student_dialogue_turns(topic_data)
        for attempt in topic_data.get("attempts", []):
            scoped_attempt_rows.append({**attempt, "_analytics_topic_id": topic_id})

    physical_attempts = deduplicate_attempts(scoped_attempt_rows)
    attempts = [
        attempt for attempt in physical_attempts
        if _is_remediation_attempt(attempt)
    ]
    for attempt in attempts:
        topic_id = str(attempt.get("_analytics_topic_id") or "")
        if topic_id:
            topic_attempts.setdefault(topic_id, []).append(attempt)
    hint_count = sum(
        1 for attempt in physical_attempts
        if attempt.get("attempt_type") == "hint"
    )
    independent_evidence_count = sum(
        1 for attempt in attempts
        if is_independent_learning_attempt(attempt)
    )
    supported_answer_count = max(0, len(attempts) - independent_evidence_count)
    reveal_count = sum(
        1 for attempt in physical_attempts
        if is_scored_learning_attempt(attempt) and bool(attempt.get("used_show_answer"))
    )

    # Defaults
    fallback_response = {
        "headline": "Ready to begin practice session",
        "what_went_well": ["Completed baseline setup successfully."],
        "main_difficulty": "No recent logs to analyze",
        "why_it_matters": "Active practice logs let the system detect error patterns and suggest tailored parent coaching actions.",
        "next_practice_action": "Ask your child to open the Guided Practice page and start a new session.",
        "suggested_duration_minutes": 15,
        "weekly_coaching_plan": {
            "focus": "Build a steady home-learning routine with short guided sessions.",
            "student_actions": [
                "Complete two Guided Practice sessions this week.",
                "After each question, say one step you used before checking feedback.",
            ],
            "parent_questions": [
                "What did the question ask you to find?",
                "What is one strategy you tried before asking for help?",
            ],
            "review_topics": [],
        },
        "reason_codes": ["no_recent_evidence"],
        "evidence": {
            "recent_attempts": 0,
            "recent_accuracy": None,
            "independent_evidence_count": 0,
            "independent_accuracy": None,
            "confidence": "none",
            "hint_count": hint_count,
            "dialogue_turns": dialogue_student_turns,
        },
        "deep_link": _parent_guided_deep_link(
            subject,
            year,
            year_level=year_level,
            unit=unit,
            syllabus_subject=syllabus_subject,
        ),
    }

    if not attempts:
        return fallback_response

    # Find the topic with the strongest current intervention signal.
    now = datetime.now(timezone.utc)
    latest_exam_weak_topics = _latest_exam_weak_topics(
        log_data,
        valid_topic_ids,
        subject=subject,
        year_level=year_level,
        unit=unit,
        syllabus_subject=syllabus_subject,
    )
    topic_metrics = {
        t_id: _topic_attempt_metrics(atts, now)
        for t_id, atts in topic_attempts.items()
    }

    def topic_name(topic_id: str | None) -> str:
        if not topic_id:
            return "Core Topics"
        topic_obj = tutor._loader.load_topic(topic_id)
        if topic_obj:
            # The short name reads well in a sentence; descriptors can hold LaTeX.
            return topic_obj.name or topic_obj.content_descriptor_text or topic_id
        return topic_id

    most_practised_id = max(
        topic_metrics,
        key=lambda topic_id: topic_metrics[topic_id].get("attempts", 0),
        default=None,
    )
    confident_topics = {
        topic_id: metrics
        for topic_id, metrics in topic_metrics.items()
        if metrics.get("confidence") in {"medium", "high"}
    }
    independent_confident_topics = {
        topic_id: metrics
        for topic_id, metrics in topic_metrics.items()
        if metrics.get("independent_confidence") in {"medium", "high"}
        and metrics.get("independent_evidence_count", 0) > 0
    }
    strongest_id = max(
        independent_confident_topics,
        key=lambda topic_id: independent_confident_topics[topic_id].get(
            "independent_weighted_accuracy", 0.0
        ) or 0.0,
        default=None,
    )

    if not confident_topics:
        selected_id = most_practised_id
        selected = topic_metrics.get(selected_id or "", {})
        selected_name = topic_name(selected_id)
        return {
            "headline": "Promising early signal — collect more evidence",
            "what_went_well": ["The student has started building a practice record."],
            "main_difficulty": "Not enough independent scored evidence yet",
            "why_it_matters": "One or two responses can be affected by guessing, unfamiliar wording or a temporary slip, so they should not trigger a strong remediation or extension claim.",
            "next_practice_action": f"Complete two or three more independent questions on '{selected_name}' before changing the level of practice.",
            "suggested_duration_minutes": 15,
            "weekly_coaching_plan": {
                "focus": f"Build a reliable baseline for {selected_name}.",
                "student_actions": [
                    f"Complete three questions on {selected_name} without speed-round mode.",
                    "Show one line of reasoning or evidence for each answer.",
                ],
                "parent_questions": ["What evidence would make you more confident that you understand this topic?"],
                "review_topics": [selected_name] if selected_id else [],
            },
            "focus_area": {
                "topic_id": selected_id,
                "name": selected_name,
                "accuracy": round(selected.get("weighted_accuracy", 0.0), 2),
            },
            "most_practised_area": {
                "topic_id": most_practised_id,
                "name": topic_name(most_practised_id),
                "attempts": selected.get("attempts", 0),
            } if most_practised_id else None,
            "strongest_area": None,
            "reason_codes": ["low_evidence"],
            "evidence": {
                "recent_attempts": selected.get("recent_attempts", 0),
                "recent_accuracy": selected.get("recent_accuracy"),
                "weighted_accuracy": round(selected.get("weighted_accuracy", 0.0), 2),
                "independent_evidence_count": selected.get("independent_evidence_count", 0),
                "independent_accuracy": (
                    round(selected["independent_weighted_accuracy"], 2)
                    if selected.get("independent_weighted_accuracy") is not None
                    else None
                ),
                "confidence": selected.get("confidence", "low"),
                "hint_count": hint_count,
                "dialogue_turns": dialogue_student_turns,
            },
            "deep_link": _parent_guided_deep_link(
                subject,
                year,
                year_level=year_level,
                unit=unit,
                syllabus_subject=syllabus_subject,
                topic_id=selected_id,
            ),
        }

    worst_topic_id = None
    worst_score = -1.0
    for t_id, metrics in confident_topics.items():
        score = 0.0
        score += metrics["recent_incorrect"] * 2.0
        score += (1.0 - metrics["weighted_accuracy"]) * max(metrics["weighted_total"], 1.0)
        if t_id in latest_exam_weak_topics:
            score += 1.5
        if metrics["confidence"] in ("medium", "high") and metrics["weighted_accuracy"] < 0.65:
            score += 1.0
        if score >= worst_score:
            worst_score = score
            worst_topic_id = t_id

    if not worst_topic_id:
        worst_topic_id = next(iter(confident_topics), None)

    selected_metrics = topic_metrics.get(worst_topic_id or "", {})
    worst_accuracy = selected_metrics.get("weighted_accuracy", 1.0)

    worst_topic_name = topic_name(worst_topic_id)

    reason_codes = []
    if selected_metrics.get("recent_incorrect", 0) >= 2:
        reason_codes.append("repeated_recent_errors")
    elif selected_metrics.get("recent_incorrect", 0) == 1:
        reason_codes.append("recent_error")
    if selected_metrics.get("weighted_accuracy", 1.0) < 0.65 and selected_metrics.get("attempts", 0) >= 2:
        reason_codes.append("low_mastery")
    if worst_topic_id in latest_exam_weak_topics:
        reason_codes.append("latest_exam_gap")

    # Compile strengths
    strengths = []
    correct_count = sum(1 for a in attempts if a.get("correct"))
    accuracy = correct_count / len(attempts) if attempts else 0.0

    if accuracy >= 0.8:
        strengths.append(f"Answered {correct_count}/{len(attempts)} recent questions correctly in this scope.")
    else:
        strengths.append("Persisted through multiple problem-solving attempts.")

    help_count = hint_count + dialogue_student_turns + supported_answer_count + reveal_count
    if help_count > len(attempts):
        reason_codes.append("high_help_reliance")
    if help_count > 0 and help_count <= len(attempts) * 0.5:
        strengths.append("Used tutor support productively to get unstuck.")
    else:
        strengths.append("Attempted questions independently before requesting help.")

    # Infer main difficulty and action points
    error_types = [a.get("error_type") for a in attempts if not a.get("correct") and a.get("error_type")]
    error_counter = Counter(error_types)
    common_error = error_counter.most_common(1)[0][0] if error_counter else None

    subject_key = (subject or "math").lower().strip()
    independent_ready = (
        selected_metrics.get("independent_confidence") in {"medium", "high"}
        and selected_metrics.get("independent_weighted_accuracy") is not None
        and selected_metrics.get("independent_weighted_accuracy", 0.0) >= 0.8
    )
    if subject_key == "english" and worst_accuracy < 0.8:
        headline = "English skill review recommended"
        main_difficulty = "Reading, evidence or language precision needs consolidation"
        why_it_matters = "English improvement depends on locating precise evidence, explaining its effect and applying conventions consistently."
        next_practice_action = f"Complete a short Guided Practice set on '{worst_topic_name}' and ask your child to point to the exact words or language rule supporting each answer."
        suggested_duration_minutes = 15
    elif subject_key == "science" and worst_accuracy < 0.8:
        headline = "Science reasoning review recommended"
        main_difficulty = "Scientific concepts, inquiry design or evidence interpretation need consolidation"
        why_it_matters = "Science responses are strongest when the student links a model or claim to specific observations, data and controlled variables."
        next_practice_action = f"Review '{worst_topic_name}' using one model, graph or claim-evidence-reasoning explanation before attempting three new questions."
        suggested_duration_minutes = 15
    elif common_error == "incorrect_value":
        headline = "Good effort — focus next on checking calculation steps"
        main_difficulty = "Arithmetic, sign, or place-value slips"
        why_it_matters = "In high-level mathematics, minor arithmetic slips or incorrect operations change final answers even when the conceptual understanding is sound."
        next_practice_action = f"Ask your child to write out calculations step-by-step for '{worst_topic_name}' and check their signs before submitting."
        suggested_duration_minutes = 15
    elif common_error == "concept_gap":
        headline = "Core concept review recommended"
        main_difficulty = "Gaps in topic-specific rules or definitions"
        why_it_matters = "Concepts serve as building blocks. Skipping or misunderstanding a basic definition makes complex and unfamiliar questions much harder to solve."
        next_practice_action = f"Review the '{worst_topic_name}' concept card together and ask your child to explain the core rule in their own words."
        suggested_duration_minutes = 15
    elif help_count > len(attempts):
        headline = "Build independent practice habits"
        main_difficulty = "Reliance on answer reveals or tutor support"
        why_it_matters = "Examples and AI chat can help when first starting, but true mastery requires retrieving rules and attempting calculations independently."
        next_practice_action = "Encourage your child to write down their first line of working on paper before asking the tutor for help."
        suggested_duration_minutes = 15
    elif independent_ready:
        headline = "Secure evidence — proceed to extending challenges"
        main_difficulty = "Maintain accuracy while increasing complexity"
        why_it_matters = "Consistent success across several scored attempts supports a cautious move to more complex and unfamiliar tasks."
        next_practice_action = f"Start a Guided Practice session on '{worst_topic_name}' and use High Achiever Mode for an extra challenge."
        suggested_duration_minutes = 20
    else:
        headline = "Targeted practice recommended"
        main_difficulty = "Accuracy is not yet consistent enough for extension"
        why_it_matters = "Several scored attempts show that this skill still needs retrieval and checking practice before difficulty increases."
        next_practice_action = f"Complete a focused Guided Practice set on '{worst_topic_name}', then explain one corrected mistake aloud."
        suggested_duration_minutes = 15

    independence_action = (
        "Write the first line of working before asking the tutor for help."
        if help_count > len(attempts) * 0.5
        else "Make a first attempt independently, then write what changed after checking support."
    )
    weekly_coaching_plan = {
        "focus": f"Strengthen {worst_topic_name} with short, evidence-based review.",
        "student_actions": [
            f"Redo two questions from {worst_topic_name} and write one checked step for each.",
            independence_action,
            "End the week by explaining one corrected mistake in your own words.",
        ],
        "parent_questions": [
            "What did you try first, before using tutor support or an example?",
            "Which word, number, or evidence in the question told you what to do?",
            "How would you check this answer if you saw a similar question tomorrow?",
        ],
        "review_topics": [worst_topic_name] if worst_topic_name else [],
    }

    return {
        "headline": headline,
        "what_went_well": strengths[:2],
        "main_difficulty": main_difficulty,
        "why_it_matters": why_it_matters,
        "next_practice_action": next_practice_action,
        "suggested_duration_minutes": suggested_duration_minutes,
        "weekly_coaching_plan": weekly_coaching_plan,
        "focus_area": {
            "topic_id": worst_topic_id,
            "name": worst_topic_name,
            "accuracy": round(worst_accuracy, 2)
        },
        "most_practised_area": {
            "topic_id": most_practised_id,
            "name": topic_name(most_practised_id),
            "attempts": topic_metrics.get(most_practised_id or "", {}).get("attempts", 0),
        } if most_practised_id else None,
        "strongest_area": {
            "topic_id": strongest_id,
            "name": topic_name(strongest_id),
            "accuracy": round(
                independent_confident_topics.get(strongest_id or "", {}).get(
                    "independent_weighted_accuracy", 0.0
                ) or 0.0,
                2,
            ),
            "confidence": independent_confident_topics.get(strongest_id or "", {}).get(
                "independent_confidence", "medium"
            ),
        } if strongest_id else None,
        "reason_codes": reason_codes or ["practice_momentum"],
        "evidence": {
            "recent_attempts": selected_metrics.get("recent_attempts", 0),
            "recent_accuracy": (
                round(selected_metrics["recent_accuracy"], 2)
                if selected_metrics.get("recent_accuracy") is not None
                else None
            ),
            "weighted_accuracy": round(worst_accuracy, 2),
            "independent_evidence_count": selected_metrics.get("independent_evidence_count", 0),
            "independent_accuracy": (
                round(selected_metrics["independent_weighted_accuracy"], 2)
                if selected_metrics.get("independent_weighted_accuracy") is not None
                else None
            ),
            "confidence": selected_metrics.get("confidence", "low"),
            "hint_count": hint_count,
            "dialogue_turns": dialogue_student_turns,
        },
        "deep_link": _parent_guided_deep_link(
            subject,
            year,
            year_level=year_level,
            unit=unit,
            syllabus_subject=syllabus_subject,
            topic_id=worst_topic_id,
        ),
    }



def derive_weekly_learning_summary(
    student_id: str,
    days: int = 7,
    *,
    now: datetime | None = None,
    window_start: datetime | None = None,
) -> dict:
    """Return one cross-subject, student-scoped learning evidence projection.

    Physical attempts are de-duplicated before aggregation.  The efficiency rate
    uses only observed timestamp spans inside 15-minute activity windows; it does
    not claim to measure wall-clock study time when the event history cannot do so.
    ``window_start`` allows fixed calendar-week reports while preserving the
    rolling-window API used by existing student and parent views.
    """
    if days < 1 or days > 31:
        raise ValueError("days must be between 1 and 31")

    window_end = now or datetime.now(timezone.utc)
    if window_end.tzinfo is None:
        window_end = window_end.replace(tzinfo=timezone.utc)
    else:
        window_end = window_end.astimezone(timezone.utc)
    if window_start is None:
        window_start = window_end - timedelta(days=days)
    elif window_start.tzinfo is None:
        window_start = window_start.replace(tzinfo=timezone.utc)
    else:
        window_start = window_start.astimezone(timezone.utc)
    if window_start >= window_end:
        raise ValueError("window_start must be before window_end")

    def in_window(timestamp: datetime) -> bool:
        return window_start <= timestamp < window_end

    def utc_timestamp(value: Any) -> datetime | None:
        parsed = _parse_timestamp(value)
        if parsed is None:
            return None
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

    attempt_rows, stored_closures = get_weekly_learning_records(
        student_id,
        window_start.isoformat(),
        window_end.isoformat(),
    )
    closure_rows: list[tuple[str, str, datetime]] = []
    for subject, review_key, raw_closed_at in stored_closures:
        closed_at = utc_timestamp(raw_closed_at)
        if closed_at and in_window(closed_at):
            closure_rows.append((subject, review_key, closed_at))

    physical_attempts = deduplicate_attempts(attempt_rows)
    recent_attempts: list[dict] = []
    attempt_timestamps: list[datetime] = []
    for attempt in physical_attempts:
        timestamp = utc_timestamp(attempt.get("timestamp"))
        if timestamp is None or not in_window(timestamp):
            continue
        if not is_scored_learning_attempt(attempt):
            continue
        if str(attempt.get("question_id") or "").startswith("pseudo_"):
            continue
        recent_attempts.append(attempt)
        attempt_timestamps.append(timestamp)

    independent_correct = 0
    first_independent_correct = 0
    supported_correct = 0
    revision_attempts = 0
    self_explanations = 0
    confidence_counts = {"guess": 0, "maybe": 0, "sure": 0}
    high_confidence_errors = 0
    low_confidence_correct = 0
    subject_breakdown: dict[str, dict[str, Any]] = {}

    for attempt in recent_attempts:
        outcome = classify_attempt(attempt)
        correct = outcome is AttemptOutcome.CORRECT
        independent = is_independent_learning_attempt(attempt)
        subject = str(attempt.get("_summary_subject") or "unknown")
        topic = str(attempt.get("_summary_topic") or "Unknown topic")
        subject_row = subject_breakdown.setdefault(
            subject,
            {
                "attempts": 0,
                "correct": 0,
                "incorrect": 0,
                "independent_attempts": 0,
                "first_independent_correct": 0,
                "supported_correct": 0,
                "topics": {},
            },
        )
        topic_row = subject_row["topics"].setdefault(
            topic,
            {
                "attempts": 0,
                "correct": 0,
                "incorrect": 0,
                "independent_attempts": 0,
                "first_independent_correct": 0,
                "supported_correct": 0,
            },
        )
        subject_row["attempts"] += 1
        topic_row["attempts"] += 1
        if correct:
            subject_row["correct"] += 1
            topic_row["correct"] += 1
        else:
            subject_row["incorrect"] += 1
            topic_row["incorrect"] += 1
        if independent:
            subject_row["independent_attempts"] += 1
            topic_row["independent_attempts"] += 1

        if correct and independent:
            independent_correct += 1
            if attempt.get("first_attempt") is True:
                first_independent_correct += 1
                subject_row["first_independent_correct"] += 1
                topic_row["first_independent_correct"] += 1

        support_level = attempt.get("support_level")
        try:
            explicitly_supported = support_level is not None and float(support_level) > 0
        except (TypeError, ValueError):
            explicitly_supported = False
        if correct and explicitly_supported and not bool(attempt.get("used_show_answer")):
            supported_correct += 1
            subject_row["supported_correct"] += 1
            topic_row["supported_correct"] += 1

        if bool(attempt.get("is_revision")) or str(attempt.get("review_source") or "") in {
            "error_book", "spaced_revision", "revision"
        }:
            revision_attempts += 1
        if str(attempt.get("self_explanation") or "").strip():
            self_explanations += 1

        confidence = str(attempt.get("confidence") or "").strip().lower()
        if confidence in confidence_counts:
            confidence_counts[confidence] += 1
            if confidence == "sure" and outcome is AttemptOutcome.INCORRECT:
                high_confidence_errors += 1
            if confidence == "guess" and correct:
                low_confidence_correct += 1

    # Sum only observable first-to-last spans in clusters separated by no more
    # than 15 minutes. Single isolated events add zero rather than invented time.
    timestamps = sorted(set(attempt_timestamps))
    activity_windows = 0
    active_seconds = 0.0
    if timestamps:
        activity_windows = 1
        active_start = timestamps[0]
        active_end = timestamps[0]
        for timestamp in timestamps[1:]:
            if timestamp - active_end <= timedelta(minutes=15):
                active_end = timestamp
                continue
            active_seconds += max(0.0, (active_end - active_start).total_seconds())
            activity_windows += 1
            active_start = timestamp
            active_end = timestamp
        active_seconds += max(0.0, (active_end - active_start).total_seconds())

    active_minutes = round(active_seconds / 60.0, 1)
    secured_per_10_minutes = (
        round(first_independent_correct / (active_minutes / 10.0), 2)
        if active_minutes > 0
        else None
    )
    unique_closures = {
        (subject, question_id, closed_at.isoformat())
        for subject, question_id, closed_at in closure_rows
    }
    confidence_judgements = sum(confidence_counts.values())

    if not recent_attempts:
        next_action = "Complete one short practice set and attempt each first step before using help."
    elif high_confidence_errors:
        next_action = "Review the high-confidence errors and name the cue that should change the method next time."
    elif supported_correct > first_independent_correct:
        next_action = "Repeat one supported success without tutor support to turn it into independent evidence."
    elif revision_attempts and not unique_closures:
        next_action = "Finish one fresh transfer or spaced-consolidation check from the Error Book."
    elif self_explanations == 0:
        next_action = "After the next answer, write one short explanation of why the method works."
    else:
        next_action = "Keep the routine: first attempt independently, then explain the key cue."

    return {
        "scope": "all_subjects",
        "days": days,
        "window_start": window_start.isoformat(),
        "window_end": window_end.isoformat(),
        "attempts": len(recent_attempts),
        "activity_days": len({
            timestamp.astimezone(WEEKLY_REPORT_TIMEZONE).date().isoformat()
            for timestamp in attempt_timestamps
        }),
        "independent_correct": independent_correct,
        "first_independent_correct": first_independent_correct,
        "supported_correct": supported_correct,
        "revision_attempts": revision_attempts,
        "mistake_closures": len(unique_closures),
        "self_explanations": self_explanations,
        "confidence_judgements": confidence_judgements,
        "confidence_counts": confidence_counts,
        "high_confidence_errors": high_confidence_errors,
        "low_confidence_correct": low_confidence_correct,
        "active_minutes_estimate": active_minutes,
        "activity_window_count": activity_windows,
        "independent_secured_per_10_active_minutes": secured_per_10_minutes,
        "time_basis": "active_timestamp_windows",
        "time_basis_note": (
            "Estimated from first-to-last attempt timestamps within 15-minute activity windows; "
            "isolated events add no invented duration."
        ),
        "subject_breakdown": subject_breakdown,
        "next_action": next_action,
    }



WEEKLY_REPORT_TIMEZONE = ZoneInfo("Australia/Brisbane")
WEEKLY_REPORT_HISTORY_WEEKS = 12


def weekly_report_window(
    week_start_value: str | date | None = None,
    *,
    now: datetime | None = None,
) -> tuple[date, datetime, datetime, date, datetime]:
    """Resolve one Brisbane Monday-to-Monday reporting window.

    The selected week must be one of the current or previous 11 calendar weeks.
    Returned datetimes are UTC and the end boundary is exclusive.
    """
    now_utc = now or datetime.now(timezone.utc)
    if now_utc.tzinfo is None:
        now_utc = now_utc.replace(tzinfo=timezone.utc)
    else:
        now_utc = now_utc.astimezone(timezone.utc)
    local_today = now_utc.astimezone(WEEKLY_REPORT_TIMEZONE).date()
    current_week_start = local_today - timedelta(days=local_today.weekday())

    if week_start_value is None or week_start_value == "":
        selected_start = current_week_start
    elif isinstance(week_start_value, date):
        selected_start = week_start_value
    else:
        try:
            selected_start = date.fromisoformat(str(week_start_value))
        except ValueError as exc:
            raise ValueError("week_start must be an ISO date") from exc

    if selected_start.weekday() != 0:
        raise ValueError("week_start must be a Monday")
    earliest_start = current_week_start - timedelta(
        weeks=WEEKLY_REPORT_HISTORY_WEEKS - 1
    )
    if selected_start > current_week_start or selected_start < earliest_start:
        raise ValueError("week_start must be within the available 12-week history")

    local_start = datetime.combine(
        selected_start,
        time.min,
        tzinfo=WEEKLY_REPORT_TIMEZONE,
    )
    local_end = local_start + timedelta(days=7)
    return (
        selected_start,
        local_start.astimezone(timezone.utc),
        local_end.astimezone(timezone.utc),
        current_week_start,
        now_utc,
    )


def _weekly_evidence_status(attempts: int) -> str:
    if attempts == 0:
        return "none"
    if attempts < 5:
        return "limited"
    return "sufficient"


def _topic_report_detail(topic: str) -> dict[str, Any]:
    """Build a compact, student-readable explanation for a topic key.

    Topic IDs remain the stable analytics key, but the report exposes the
    curriculum name, a plain description, the core idea, and a few success
    criteria so the student can turn feedback into an action.
    """
    topic_id = str(topic or "").strip()
    cleaned = topic_id.replace("_", " ").replace("-", " ")
    fallback = " ".join(part for part in cleaned.split() if part) or "this topic"
    detail = {
        "code": topic_id,
        "title": fallback,
        "description": "",
        "key_idea": "",
        "success_criteria": [],
    }
    if not topic_id:
        return detail

    try:
        topic_obj = get_tutor_engine()._loader.load_topic(topic_id)
    except (FileNotFoundError, KeyError, OSError, TypeError, ValueError):
        return detail
    if topic_obj is None:
        return detail

    name = str(getattr(topic_obj, "name", "") or "").strip()
    descriptor = str(getattr(topic_obj, "content_descriptor_text", "") or "").strip()
    concept_card = getattr(topic_obj, "concept_card", None)
    core_rule = str(getattr(concept_card, "core_rule", "") or "").strip()
    lesson_content = getattr(concept_card, "lesson_content", None)
    candidate_criteria = (
        getattr(lesson_content, "success_criteria", None)
        or getattr(lesson_content, "learning_objectives", None)
        or []
    )
    success_criteria: list[str] = []
    for candidate in candidate_criteria:
        text = str(candidate or "").strip()
        if text and text not in success_criteria:
            success_criteria.append(text)
        if len(success_criteria) == 3:
            break

    detail.update({
        "title": name or fallback,
        "description": descriptor or core_rule or name or fallback,
        "key_idea": core_rule if descriptor and core_rule and core_rule.casefold() != descriptor.casefold() else "",
        "success_criteria": success_criteria,
    })
    return detail


def _topic_report_label(topic: str) -> str:
    """Return a concise label while keeping the official code traceable."""
    topic_id = str(topic or "").strip()
    detail = _topic_report_detail(topic)
    cleaned = topic_id.replace("_", " ").replace("-", " ")
    fallback = " ".join(part for part in cleaned.split() if part) or "this topic"
    if topic_id and (
        detail["title"] != fallback
        or detail["description"]
        or detail["key_idea"]
    ):
        return f"{detail['title']} [{topic_id}]"
    return detail["title"]


def _weekly_topic_focus_priority(metrics: dict[str, Any]) -> tuple[float, float, int, int]:
    """Rank a topic by its unresolved share, not raw practice volume.

    Raw error counts make heavily practised topics dominate even when the
    learner has already produced substantial independent evidence.  The first
    two terms instead prefer the largest proportion needing review and the
    smallest proportion secured independently; counts only break later ties.
    """
    attempts = max(1, int(metrics.get("attempts") or 0))
    needs_review = min(
        attempts,
        int(metrics.get("incorrect") or 0)
        + int(metrics.get("supported_correct") or 0),
    )
    independent_secured = min(
        attempts,
        int(metrics.get("first_independent_correct") or 0),
    )
    return (
        needs_review / attempts,
        -(independent_secured / attempts),
        needs_review,
        attempts,
    )


def _weekly_activity_summary(summary: dict) -> dict[str, Any]:
    """Describe recorded activity without inferring homework load or effort."""
    attempts = int(summary.get("attempts") or 0)
    active_days = int(summary.get("activity_days") or 0)
    subject_rows = [
        row for row in summary.get("subject_breakdown", {}).values()
        if isinstance(row, dict) and int(row.get("attempts") or 0) > 0
    ]
    topic_rows = [
        values
        for subject_row in subject_rows
        for values in (
            subject_row.get("topics", {}).values()
            if isinstance(subject_row.get("topics"), dict)
            else []
        )
        if isinstance(values, dict) and int(values.get("attempts") or 0) > 0
    ]
    topic_count = len(topic_rows)
    repeated_topic_count = sum(
        1 for values in topic_rows if int(values.get("attempts") or 0) >= 2
    )
    incorrect_answers = sum(
        int(row.get("incorrect") or 0) for row in subject_rows
    )

    if attempts == 0:
        message = "No scored practice is recorded for this week yet."
    else:
        message = (
            f"Recorded activity: {attempts} question{'s' if attempts != 1 else ''} "
            f"across {topic_count} topic{'s' if topic_count != 1 else ''} on "
            f"{active_days} active day{'s' if active_days != 1 else ''}."
        )

    return {
        "attempts": attempts,
        "active_days": active_days,
        "subject_count": len(subject_rows),
        "topic_count": topic_count,
        "repeated_topic_count": repeated_topic_count,
        "incorrect_answers": incorrect_answers,
        "message": message,
        "basis_note": (
            "These counts describe recorded activity only; they do not measure assigned "
            "homework, question difficulty, effort or study time."
        ),
    }


def _subject_weekly_reports(summary: dict) -> list[dict]:
    reports: list[dict] = []
    for subject, raw_metrics in summary.get("subject_breakdown", {}).items():
        metrics = raw_metrics if isinstance(raw_metrics, dict) else {}
        attempts = int(metrics.get("attempts") or 0)
        correct = int(metrics.get("correct") or 0)
        topics = metrics.get("topics") if isinstance(metrics.get("topics"), dict) else {}
        all_topic_rows = [
            (str(topic), values)
            for topic, values in topics.items()
            if isinstance(values, dict) and int(values.get("attempts") or 0) > 0
        ]
        topic_rows = [
            (topic, values)
            for topic, values in all_topic_rows
            if int(values.get("attempts") or 0) >= 2
        ]
        topic_overview = []
        for topic, values in sorted(
            all_topic_rows,
            key=lambda item: (-int(item[1].get("attempts") or 0), item[0]),
        )[:6]:
            detail = _topic_report_detail(topic)
            topic_overview.append({
                "topic": topic,
                "title": str(detail.get("title") or _topic_report_label(topic)),
                "attempts": int(values.get("attempts") or 0),
                "correct": int(values.get("correct") or 0),
                "incorrect": int(values.get("incorrect") or 0),
                "first_independent_correct": int(values.get("first_independent_correct") or 0),
                "supported_correct": int(values.get("supported_correct") or 0),
            })

        highlight = None
        if topic_rows:
            highlight_topic, highlight_metrics = max(
                topic_rows,
                key=lambda item: (
                    int(item[1].get("first_independent_correct") or 0),
                    int(item[1].get("correct") or 0),
                    int(item[1].get("attempts") or 0),
                ),
            )
            highlight_detail = _topic_report_detail(highlight_topic)
            highlight_label = _topic_report_label(highlight_topic)
            secured = int(highlight_metrics.get("first_independent_correct") or 0)
            topic_correct = int(highlight_metrics.get("correct") or 0)
            if secured > 0:
                question_word = "question" if secured == 1 else "questions"
                highlight = {
                    "topic": highlight_topic,
                    "message": f"You solved {secured} {question_word} on {highlight_label} on your first try without tutor support.",
                    "topic_detail": highlight_detail,
                }
            elif topic_correct > 0:
                question_word = "question" if topic_correct == 1 else "questions"
                highlight = {
                    "topic": highlight_topic,
                    "message": f"You solved {topic_correct} {question_word} on {highlight_label}. Try one similar question without tutor support next.",
                    "topic_detail": highlight_detail,
                }

        focus = None
        focus_candidates = [
            item
            for item in topic_rows
            if int(item[1].get("incorrect") or 0) > 0
            or int(item[1].get("supported_correct") or 0) > 0
        ]
        if focus_candidates:
            focus_topic, focus_metrics = max(
                focus_candidates,
                key=lambda item: _weekly_topic_focus_priority(item[1]),
            )
            focus_detail = _topic_report_detail(focus_topic)
            focus_label = _topic_report_label(focus_topic)
            incorrect = int(focus_metrics.get("incorrect") or 0)
            supported = int(focus_metrics.get("supported_correct") or 0)
            if incorrect > 0:
                attempt_word = "answer" if incorrect == 1 else "answers"
                message = f"Review {focus_label}: {incorrect} {attempt_word} still need checking."
            else:
                question_word = "question" if supported == 1 else "questions"
                message = (
                    f"You solved {supported} {question_word} on {focus_label} with tutor support. "
                    "Try one similar question without tutor support, then explain the key step."
                )
            focus = {
                "topic": focus_topic,
                "message": message,
                "topic_detail": focus_detail,
            }

        reports.append({
            "subject": subject,
            "subject_label": display_name_for_subject(subject) or subject.replace("_", " ").title(),
            "attempts": attempts,
            "correct": correct,
            "accuracy": round(correct / attempts * 100, 1) if attempts else None,
            "first_independent_correct": int(metrics.get("first_independent_correct") or 0),
            "supported_correct": int(metrics.get("supported_correct") or 0),
            "topics_touched": len(all_topic_rows),
            "topics_with_repeated_evidence": len(topic_rows),
            "topic_overview": topic_overview,
            "additional_topic_count": max(0, len(all_topic_rows) - len(topic_overview)),
            "evidence_status": _weekly_evidence_status(attempts),
            "highlight": highlight,
            "focus": focus,
        })
    return sorted(reports, key=lambda item: (-item["attempts"], item["subject_label"]))


def derive_student_weekly_report(
    student_id: str,
    week_start: str | date | None = None,
    *,
    now: datetime | None = None,
) -> dict:
    """Build one actionable, fixed-calendar-week student report."""
    (
        selected_start,
        selected_start_utc,
        selected_end_utc,
        current_week_start,
        now_utc,
    ) = weekly_report_window(week_start, now=now)
    is_current_week = selected_start == current_week_start
    analysis_end = min(selected_end_utc, now_utc) if is_current_week else selected_end_utc
    if analysis_end <= selected_start_utc:
        analysis_end = selected_start_utc + timedelta(microseconds=1)

    summary = derive_weekly_learning_summary(
        student_id,
        days=7,
        now=analysis_end,
        window_start=selected_start_utc,
    )
    previous_start_utc = selected_start_utc - timedelta(days=7)
    previous_summary = derive_weekly_learning_summary(
        student_id,
        days=7,
        now=selected_start_utc,
        window_start=previous_start_utc,
    )
    subject_reports = _subject_weekly_reports(summary)
    evidence_status = _weekly_evidence_status(int(summary["attempts"]))
    activity_summary = _weekly_activity_summary(summary)

    strongest_subject = max(
        subject_reports,
        key=lambda item: (item["first_independent_correct"], item["attempts"]),
        default=None,
    )
    weekly_highlight_detail = None
    if summary["attempts"] == 0:
        weekly_highlight = "No scored questions yet. Start with one short practice set to begin your review."
    elif strongest_subject and strongest_subject.get("highlight"):
        weekly_highlight = strongest_subject["highlight"]["message"]
        weekly_highlight_detail = strongest_subject["highlight"].get("topic_detail")
    elif summary["mistake_closures"] > 0:
        review_word = "mistake review" if summary["mistake_closures"] == 1 else "mistake reviews"
        weekly_highlight = (
            f"You completed {summary['mistake_closures']} {review_word}. "
            "Keep the checking step that helped you fix one mistake."
        )
    else:
        attempt_word = "question" if summary["attempts"] == 1 else "questions"
        weekly_highlight = (
            f"You completed {summary['attempts']} scored {attempt_word} this week. "
            "Choose one answer to explain in your own words."
        )

    focus_report = max(
        (item for item in subject_reports if item["focus"]),
        key=lambda item: _weekly_topic_focus_priority(
            summary.get("subject_breakdown", {})
            .get(item["subject"], {})
            .get("topics", {})
            .get(item["focus"]["topic"], {})
        ),
        default=None,
    )
    focus_detail = focus_report["focus"].get("topic_detail") if focus_report else None
    if evidence_status == "none":
        focus_message = "Complete one small practice set before choosing a focus."
    elif focus_report:
        focus_message = focus_report["focus"]["message"]
    elif evidence_status == "limited":
        focus_message = "Keep practising a little longer before choosing one focus area."
    else:
        focus_message = "No single focus stands out; keep using first attempts, sensible help, and your own explanations."

    if focus_report:
        focus_topic = focus_report["focus"]["topic"]
        focus_detail = focus_report["focus"].get("topic_detail") or _topic_report_detail(focus_topic)
        focus_title = str(focus_detail.get("title") or _topic_report_label(focus_topic))
        focus_metrics = (
            summary.get("subject_breakdown", {})
            .get(focus_report["subject"], {})
            .get("topics", {})
            .get(focus_topic, {})
        )
        focus_incorrect = int(focus_metrics.get("incorrect") or 0)
        success_criteria = next(
            (str(item).strip() for item in focus_detail.get("success_criteria", []) if str(item).strip()),
            "I can explain one key step in my own words.",
        )
        if focus_incorrect > 0:
            goal = {
                "kind": "review",
                "title": f"Review one mistake in {focus_title}",
                "action": (
                    f"This topic has {focus_incorrect} answer{'s' if focus_incorrect != 1 else ''} "
                    "that need checking. Revisit one, identify the exact step that changed, and "
                    "write the correction. This replaces extra practice; it is not an additional set."
                ),
                "subject": focus_report["subject"],
                "topic": focus_topic,
                "topic_detail": focus_detail,
                "practice_count": 0,
                "success_criteria": "I can explain the original mistake and show the corrected step.",
                "help_guidance": "Use Concept or the AI Tutor only after you identify the exact step that needs correction.",
                "cta_label": "Review one mistake",
                "href": f"/mistakes?subject={focus_report['subject']}&topic={focus_topic}",
            }
        else:
            goal = {
                "kind": "check",
                "title": f"Check {focus_title} independently",
                "action": (
                    f"Choose one question on {focus_title} that you previously solved with tutor support. "
                    "Try only 1 similar question independently, then explain the key step."
                ),
                "subject": focus_report["subject"],
                "topic": focus_topic,
                "topic_detail": focus_detail,
                "practice_count": 1,
                "success_criteria": success_criteria,
                "help_guidance": "Keep Concept and Chat closed for this check; use them afterwards only if the check shows a gap.",
                "cta_label": "Start one check",
                "href": f"/guided-practice?subject={focus_report['subject']}&topic={focus_topic}",
            }
    elif activity_summary["incorrect_answers"] > 0:
        goal = {
            "kind": "review",
            "title": "Review one mistake from this week",
            "action": (
                "Several topics have only one attempt, so there is not enough repeated evidence "
                "to name one reliable focus. Choose one incorrect answer, identify what changed, "
                "and write the correction instead of starting another set."
            ),
            "subject": None,
            "topic": None,
            "topic_detail": None,
            "practice_count": 0,
            "success_criteria": "I can explain one original mistake and its corrected step.",
            "help_guidance": "Choose the mistake that was hardest to explain, not simply the latest one.",
            "cta_label": "Review one mistake",
            "href": "/mistakes",
        }
    elif summary["supported_correct"] > 0:
        goal = {
            "kind": "check",
            "title": "Turn one supported answer into an independent answer",
            "action": (
                "Choose one question you solved with tutor support. Try one similar question without tutor support, "
                "then explain the step that made it work."
            ),
            "subject": None,
            "topic": None,
            "topic_detail": None,
            "practice_count": 1,
            "success_criteria": "I can explain the key step without copying the example.",
            "help_guidance": "It is fine to use help after a real first attempt; try again later without it.",
            "cta_label": "Start one check",
            "href": "/guided-practice",
        }
    elif summary["attempts"] > 0:
        goal = {
            "kind": "reflect",
            "title": "Carry one useful strategy into next week",
            "action": (
                "The recorded answers do not show one repeated gap that needs another task. "
                "Choose one method or checking step that worked and write it below."
            ),
            "subject": None,
            "topic": None,
            "topic_detail": None,
            "practice_count": 0,
            "success_criteria": "I can name one method or checking step that helped.",
            "help_guidance": "This reflection consolidates the week; it is not extra practice.",
            "cta_label": "Write my reflection",
            "href": "#reflection-heading",
        }
    else:
        goal = {
            "kind": "practice",
            "title": "Start one small practice set",
            "action": (
                "Choose one topic and complete 3 short questions. After one answer, "
                "explain why your method works."
            ),
            "subject": None,
            "topic": None,
            "topic_detail": None,
            "practice_count": 3,
            "success_criteria": "I can explain one answer in my own words.",
            "help_guidance": "Try each question once, then use tutor support to identify the step you need to practise.",
            "cta_label": "Choose short practice",
            "href": "/guided-practice",
        }

    previous_attempts = int(previous_summary["attempts"])
    previous_independent = int(previous_summary["first_independent_correct"])
    if previous_attempts == 0:
        comparison_message = "No questions were recorded in the previous week, so there is no comparison yet."
    elif summary["first_independent_correct"] > previous_independent:
        comparison_message = "You solved more questions without tutor support than in the previous week."
    else:
        comparison_message = "These counts are context only; one week is not enough to label progress or decline."

    reflection = get_weekly_reflection(student_id, selected_start.isoformat())
    history_week_starts = [
        (current_week_start - timedelta(weeks=offset)).isoformat()
        for offset in range(WEEKLY_REPORT_HISTORY_WEEKS)
    ]

    return {
        "report_version": 2,
        "scope": "all_subjects",
        "calendar_basis": "monday_sunday",
        "timezone": "Australia/Brisbane",
        "week_start": selected_start.isoformat(),
        "week_end": (selected_start + timedelta(days=6)).isoformat(),
        "is_current_week": is_current_week,
        "period_status": "in_progress" if is_current_week else "complete",
        "generated_at": now_utc.isoformat(),
        "history_week_starts": history_week_starts,
        "evidence_status": evidence_status,
        "activity_summary": activity_summary,
        "summary": summary,
        "weekly_highlight": weekly_highlight,
        "weekly_highlight_detail": weekly_highlight_detail,
        "focus_message": focus_message,
        "focus_detail": focus_detail,
        "next_week_goal": goal,
        "subject_reports": subject_reports,
        "comparison": {
            "available": previous_attempts > 0,
            "previous_week_start": (selected_start - timedelta(days=7)).isoformat(),
            "attempts_delta": int(summary["attempts"]) - previous_attempts,
            "first_independent_correct_delta": int(summary["first_independent_correct"]) - previous_independent,
            "message": comparison_message,
        },
        "reflection": reflection,
        "evidence_note": (
            "A focus suggestion appears after at least two attempts on a topic and prioritises "
            "the share of answers that were incorrect or used tutor support, not the topic with "
            "the most questions. It is a practice suggestion, not a label of ability."
        ),
    }
