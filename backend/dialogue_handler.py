"""Per-question dialogue handler.

Design §3.3–3.7 — tutoring-dialogue spec.
Orchestrates session resolution, stuck classification, action dispatch,
conversation building, LLM calls, redaction, and persistence.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import get_args

from core.schema.dialogue_schema import (
    DialogueLLMResult,
    DialogueResponse,
    StuckClassifierResult,
    SuggestedAction,
)
from backend.answer_redact import redact
from backend.answer_normalize import signatures
from backend.dialogue_session import resolve_active_session
from backend.services.attempt_outcomes import AttemptOutcome, classify_attempt, is_scored_learning_attempt
from backend.tutor_engine import (
    UNTRUSTED_CONTENT_SYSTEM_MESSAGE,
    PROMPT_INJECTION_OPEN,
    PROMPT_INJECTION_CLOSE,
    _prompt_context_for_question,
    _wrap_student_answer,
    sanitize_prompt_content,
)

logger = logging.getLogger(__name__)

# --- Constants ---

CONVERSATION_BUDGET = 10
TURN_CAP = 30
PRE_ATTEMPT_CONCEPT_PREFIX = "[PRE_ATTEMPT_CONCEPT] "
PRE_ATTEMPT_FIRST_STEP_PREFIX = "[PRE_ATTEMPT_FIRST_STEP] "


@lru_cache(maxsize=1)
def _math_taxonomy_codes() -> tuple[set[str], set[str]]:
    """Return valid taxonomy error and subtype codes from the JSON asset."""
    path = Path(__file__).resolve().parents[1] / "data" / "error_taxonomy_math.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    primary_codes: set[str] = set()
    subtype_codes: set[str] = set()
    for entry in data.get("error_types", []):
        code = entry.get("code")
        if code:
            primary_codes.add(code)
        for subtype in entry.get("subtypes", []):
            sub_code = subtype.get("code")
            if sub_code:
                subtype_codes.add(sub_code)
    return primary_codes, subtype_codes


@lru_cache(maxsize=1)
def _english_taxonomy_codes() -> tuple[set[str], set[str]]:
    """Return valid English taxonomy error and subtype codes from JSON asset."""
    path = Path(__file__).resolve().parents[1] / "data" / "error_taxonomy_english.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    primary_codes: set[str] = set()
    subtype_codes: set[str] = set()
    for entry in data.get("error_types", []):
        code = entry.get("code")
        if code:
            primary_codes.add(code)
        for subtype in entry.get("subtypes", []):
            sub_code = subtype.get("code")
            if sub_code:
                subtype_codes.add(sub_code)
    return primary_codes, subtype_codes


_ENGLISH_GAP_RULES: list[tuple[str, str, str, str, str, bool]] = [
    (r"spell(?:ing|ed)?.*(?:wrong|mistake|error)|misspell|incorrect.*spelling", "spelling_mechanics", "phonetic_spelling_slip", "Practise spelling the word by breaking it into syllables or checking a dictionary.", "Spelling needs attention — try sounding out tricky words.", False),
    (r"homophone|there.*their.*they.re|your.*you.re|its.*it.s|affect.*effect", "spelling_mechanics", "homophone_confusion", "Practise choosing the correct homophone by checking meaning in context.", "Mixing up words that sound the same — try a homophone drill.", False),
    (r"comma|semicolon|colon|dash|punctuation.*(?:missing|wrong|error)|run-?on|splice", "punctuation_mechanics", "comma_splice_runon", "Practise joining or ending sentences with the correct punctuation.", "Punctuation needs a check — try reading your sentences aloud.", False),
    (r"apostrophe|contraction|possessive.*(?:error|wrong|missing)", "punctuation_mechanics", "apostrophe_misplacement", "Practise using apostrophes correctly for possession and contractions.", "Apostrophe placement needs review.", False),
    (r"capital|title case|proper noun.*(?:lower|upper)", "punctuation_mechanics", "capitalization_slip", "Check that proper nouns, titles, and sentence starts use capital letters.", "Capital letters need attention — try a quick proofread.", False),
    (r"tense|past.*present|present.*past|verb.*agreement|subject.*verb|singular.*plural", "grammar_syntax", "tense_inconsistency", "Practise keeping verb tenses consistent and matching subjects with verbs.", "Grammar structure may need work — check your verb tenses.", False),
    (r"sentence.*fragment|fragment|incomplete.*sentence|missing.*verb|missing.*subject", "grammar_syntax", "sentence_fragment", "Practise writing complete sentences with a subject and a verb.", "Some sentences may be incomplete — try a sentence-building drill.", False),
    (r"paragraph.*(?:structure|break|order)|topic.*sentence|concluding|no.*paragraph", "writing_composition", "PEEL_structure_incomplete", "Practise organising ideas into paragraphs with a clear topic sentence.", "Paragraph structure may need attention.", False),
    (r"evidence|quote|proof|support.*claim|example.*(?:weak|missing|irrelevant)", "textual_analysis", "unsubstantiated_claim", "Practise selecting one quote or specific detail and explaining how it supports your point.", "Evidence selection needs work — try finding a specific quote.", False),
    (r"analyse|analysis|explain.*why|how.*author|author.*purpose|technique|device", "textual_analysis", "literary_device_mislabel", "Practise naming the technique used and then explaining its effect on the reader.", "Analysis could go deeper — try naming a specific technique.", False),
    (r"vocabulary|word.*choice|simple.*word|descriptive.*(?:weak|flat|dull)|adverb|adjective.*(?:missing|weak)", "vocabulary_register", "expression_imprecision", "Practise replacing one plain word with a precise or vivid alternative.", "Vocabulary could be more precise — try a word-choice drill.", False),
    (r"cohesion|transition|linking.*word|connect|flow|however|therefore|furthermore|in addition", "writing_composition", "coherence_linking_missing", "Practise adding linking words to connect ideas between sentences.", "Text flow may need work — try adding a transition.", False),
    (r"inference|reading.*between|hidden.*meaning|implied|suggest|tone|mood|atmosphere", "inferential_comprehension", "tone_attitude_misreading", "Practise looking for clues the author gives about character feelings or themes.", "Reading may be too literal — try an inference practice task.", False),
    (r"theme|main idea|purpose|message|lesson|moral", "inferential_comprehension", "main_idea_skew", "Practise identifying what the text teaches or reveals about life.", "Theme or main idea may need work — try a summary task.", False),
]


def _classify_gap_from_working(question: dict, student_working: str, tutor_message: str) -> dict:
    """Create a conservative taxonomy-backed gap classification.

    This intentionally does not alter marking or BKT. It only enriches the
    latest incorrect attempt after a student uses Explain my answer.

    Supports both math and English taxonomies based on question subject.
    """
    subject = (question.get("subject") or "math").lower()
    text = f"{student_working} {tutor_message}"
    lower = text.lower()

    first_step_match = re.search(r"(?:step|line)\s*(\d+)", lower)
    first_incorrect_step = int(first_step_match.group(1)) if first_step_match else None

    if subject == "english":
        primary_codes, subtype_codes = _english_taxonomy_codes()
        for pattern, primary, subtype, action, summary, is_slip in _ENGLISH_GAP_RULES:
            if re.search(pattern, lower):
                if primary not in primary_codes or subtype not in subtype_codes:
                    break
                return {
                    "is_classifiable": True,
                    "primary_error_code": primary,
                    "secondary_error_codes": [],
                    "subtype_codes": [subtype],
                    "confidence": "medium",
                    "first_incorrect_step": first_incorrect_step,
                    "evidence": student_working[:240],
                    "recommended_action": action,
                    "linked_misconception_id": None,
                    "is_slip": is_slip,
                    "is_conceptual": not is_slip,
                    "parent_summary": summary,
                }

        return {
            "is_classifiable": False,
            "primary_error_code": None,
            "secondary_error_codes": [],
            "subtype_codes": [],
            "confidence": "low",
            "first_incorrect_step": first_incorrect_step,
            "evidence": student_working[:240],
            "recommended_action": "Ask your child to explain their answer in their own words before classifying the error.",
            "linked_misconception_id": None,
            "is_slip": False,
            "is_conceptual": False,
            "parent_summary": "There was not enough clear evidence to classify the English error yet.",
        }

    primary_codes, subtype_codes = _math_taxonomy_codes()

    rules: list[tuple[str, str, str, str, str]] = [
        (r"denominator|common denominator|add(?:ed|ing)? denominators|\b1/3\b|\b1/4\b", "fraction_error", "no_common_denominator", "Practise finding equivalent fractions with a common denominator.", "The working appears to break around equivalent denominators."),
        (r"negative|minus|double negative|integer|number line", "sign_error", "integer_direction_error", "Practise directed-number questions on a number line.", "The working suggests a sign or direction error."),
        (r"order of operations|bodmas|bidmas|bracket|power before|left.?to.?right", "order_of_ops", "brackets_ignored", "Practise evaluating expressions one operation layer at a time.", "The working suggests operation order was not applied consistently."),
        (r"percent|percentage|discount|gst|decimal", "decimal_percentage_error", "percentage_of_error", "Practise converting percentages to decimals before calculating.", "The working suggests a percentage or decimal conversion issue."),
        (r"round|significant figure|decimal place|estimate", "rounding_error", "wrong_significant_figures", "Practise identifying the rounding digit and checking the next digit.", "The working suggests a rounding-place decision issue."),
        (r"radius|diameter|circumference|area|perimeter|volume|formula|triangle.*half", "formula_misuse", "wrong_formula_selected", "Review which formula matches the measured quantity before substituting.", "The working suggests the wrong formula or dimension was selected."),
        (r"equation|solve|inverse|balance|isolate|both sides", "equation_solving_error", "balance_error", "Practise doing the same inverse operation to both sides.", "The working suggests an equation-balancing issue."),
        (r"expand|distribut|bracket", "distribution_error", "second_term_not_multiplied", "Practise multiplying every term inside brackets.", "The working suggests the distributive law was applied incompletely."),
        (r"like terms|unlike terms|collect terms|simplify expression", "like_terms_error", "combines_unlike_terms", "Practise grouping only terms with the same variable part.", "The working suggests unlike terms may have been combined."),
        (r"ratio|scale|map|unit rate|best buy|parts", "scale_ratio_error", "unitary_method_error", "Practise finding one part or one unit before scaling up.", "The working suggests a proportional-reasoning issue."),
        (r"unit|cm|km|metre|gram|litre|dimension", "unit_error", "wrong_dimension_units", "Check that the final unit matches the quantity being found.", "The working suggests units or dimensions need checking."),
        (r"angle|parallel|transversal|triangle|quadrilateral|polygon", "geometry_reasoning_error", "angle_sum_error", "Review the relevant angle relationship before calculating.", "The working suggests a geometry property was misapplied."),
        (r"graph|coordinate|axis|x.?y|gradient|intercept", "graph_error", "x_y_swapped", "Practise reading axes and plotting ordered pairs carefully.", "The working suggests a graph or coordinate-reading issue."),
        (r"mean|median|mode|range|outlier|frequency|data", "statistics_error", "mean_calculation_error", "Practise choosing the statistic that matches the question context.", "The working suggests a statistics procedure or interpretation issue."),
        (r"probability|sample space|outcome|favourable|expected frequency|equally likely", "probability_error", "incorrect_sample_space", "Practise listing the full sample space before forming the probability fraction.", "The working suggests the sample space or favourable outcomes need checking."),
        (r"stuck|don.t know|no idea|confused|not sure", "concept_gap", "no_strategy", "Review the concept card, then try one scaffolded example.", "The student message suggests they do not yet have a strategy."),
        (r"forgot|missing|didn.t finish|incomplete|left out", "incomplete_answer", "missing_final_step", "Practise finishing with a clear final answer and units where needed.", "The working appears incomplete."),
    ]

    for pattern, primary, subtype, action, summary in rules:
        if re.search(pattern, lower):
            if primary not in primary_codes or subtype not in subtype_codes:
                break
            is_slip = primary in {"calculation_error", "rounding_error"}
            return {
                "is_classifiable": True,
                "primary_error_code": primary,
                "secondary_error_codes": [],
                "subtype_codes": [subtype],
                "confidence": "medium",
                "first_incorrect_step": first_incorrect_step,
                "evidence": student_working[:240],
                "recommended_action": action,
                "linked_misconception_id": None,
                "is_slip": is_slip,
                "is_conceptual": not is_slip,
                "parent_summary": summary,
            }

    return {
        "is_classifiable": False,
        "primary_error_code": None,
        "secondary_error_codes": [],
        "subtype_codes": [],
        "confidence": "low",
        "first_incorrect_step": first_incorrect_step,
        "evidence": student_working[:240],
        "recommended_action": "Ask the student to show one more line of working before classifying the gap.",
        "linked_misconception_id": None,
        "is_slip": False,
        "is_conceptual": False,
        "parent_summary": "There was not enough clear evidence to classify the mistake yet.",
    }

# --- Stuck classifier (Tasks 3.1–3.3) ---

_STUCK_KEYWORDS = [
    "stuck",
    "don't get",
    "do not get",
    "don't understand",
    "do not understand",
    "confused",
    "lost",
]

_NEGATORS = ["not", "n't", "never", "no longer"]

_STUCK_CLASSIFIER_PROMPT = (
    "You are a student-message classifier. Determine whether the student is expressing "
    "that they are stuck, confused, or need help.\n\n"
    "Student message:\n"
    f"{PROMPT_INJECTION_OPEN}\n"
    "{message}\n"
    f"{PROMPT_INJECTION_CLOSE}\n\n"
    'Respond with JSON: {{"stuck": true}} or {{"stuck": false}}'
)


def deterministic_stuck(message: str) -> bool | None:
    """Return True/False if deterministic match is conclusive, None to defer to LLM.

    Uses a 4-token negator window before the matched keyword.
    """
    lower = message.lower()

    for keyword in _STUCK_KEYWORDS:
        idx = lower.find(keyword)
        if idx == -1:
            continue
        # Look at the 4 word-tokens immediately preceding the match
        preceding_text = lower[:idx]
        preceding_tokens = preceding_text.split()[-4:]
        preceding_joined = " ".join(preceding_tokens)

        if any(neg in preceding_joined for neg in _NEGATORS):
            return False  # negated — explicitly not stuck
        return True

    return None  # no match either way; LLM may still classify


def classify_stuck(message: str, tutor) -> bool:
    """Classify if student is stuck. Uses deterministic first, LLM fallback.

    Efficiency (Q7): avoid a second LLM round-trip on the common dialogue turns.
    - Deterministic keyword match is conclusive when present.
    - Action-button presses (e.g. "show_worked_example") are never "stuck"
      expressions, so they short-circuit to False with no LLM call.
    - Longer substantive messages (answers, explanations) are treated as
      engagement, not stuck.
    Only short, genuinely ambiguous free text falls through to the LLM.
    """
    det = deterministic_stuck(message)
    if det is not None:
        return det

    # Action-button invocations are not free-text "stuck" signals.
    if message.strip() in get_args(SuggestedAction):
        return False

    if len(message.split()) > 6:
        return False

    try:
        safe_message = sanitize_prompt_content(message)
        prompt = _STUCK_CLASSIFIER_PROMPT.format(message=safe_message)
        result = tutor._call_llm_safe(
            prompt=prompt,
            expected_schema=StuckClassifierResult,
            fallback=StuckClassifierResult.fallback(),
            response_format={"type": "json_object"},
            temp=0.0,
            system_message=UNTRUSTED_CONTENT_SYSTEM_MESSAGE,
        )
        return result.stuck
    except Exception:
        return False


# --- Action dispatcher (Tasks 4.1–4.6) ---


def _handle_show_worked_example(tutor, question, topic, prior_turns):
    """Show a worked example via the variation pipeline.

    Phase 8 (Req 10.7): When the most recent attempt has a misconception_id,
    prefer a WorkedExampleRecord whose targets_misconception_ids contains it.
    """
    # Phase 8: Try misconception-targeted worked example first
    try:
        from backend.misconception_library import get_library
        lib = get_library()
        topic_ids = question.get("topic_ids", [])

        # Check if there's a recent misconception_id we can target
        misconception_id = question.get("_last_misconception_id")
        if misconception_id and misconception_id in lib.we_by_misconception:
            examples = lib.we_by_misconception[misconception_id]
            if examples:
                ex = examples[0]
                steps = "\n".join(
                    f"{s.step_number}. {s.prose}" + (f" ({s.math_latex})" if s.math_latex else "")
                    for s in ex.steps
                )
                msg = (
                    f"Here's a worked example targeting your misconception:\n\n"
                    f"**{ex.name}**\n\n"
                    f"Question: {ex.question}\n\n{steps}\n\n"
                    f"Answer: {ex.final_answer}\n\n"
                    f"Now try the original — what's your next move?"
                )
                return (msg, ["try_again", "mark_final_answer"], {})

        # Fallback: topic-overlapping worked examples
        for tid in topic_ids:
            if tid in lib.we_by_topic_id:
                examples = lib.we_by_topic_id[tid]
                if examples:
                    ex = examples[0]
                    steps = "\n".join(
                        f"{s.step_number}. {s.prose}" + (f" ({s.math_latex})" if s.math_latex else "")
                        for s in ex.steps
                    )
                    msg = (
                        f"Here's a worked example for this topic:\n\n"
                        f"**{ex.name}**\n\n"
                        f"Question: {ex.question}\n\n{steps}\n\n"
                        f"Answer: {ex.final_answer}\n\n"
                        f"Now try the original — what's your next move?"
                    )
                    return (msg, ["try_again", "mark_final_answer"], {})
    except Exception:
        pass

    # Fallback when no pre-authored worked examples are found
    return (
        "I couldn't find a similar worked example for this topic. "
        "If you'd like, I can give you the next step instead.",
        ["give_next_step", "try_again"],
        {},
    )


def _handle_give_next_step(tutor, question, topic, prior_turns):
    """Return the most explicit hint level through the redactor."""
    primary_topic = getattr(type(tutor), "_primary_topic_identifier", None)
    concept_topic = (
        primary_topic(tutor, question)
        if callable(primary_topic)
        else (question.get("topic_ids") or [topic])[0]
    )
    concept_card = tutor.get_concept_card_dict(concept_topic)
    hint_levels = concept_card.get("hint_levels", [])

    if not hint_levels:
        return (
            "Try carefully checking each step you've written so far.",
            ["try_again"],
            {},
        )

    msg = hint_levels[-1].get("template", hint_levels[-1]) if isinstance(hint_levels[-1], dict) else str(hint_levels[-1])

    # Run through redactor
    answer = question.get("answer", "")
    try:
        redacted_msg, _ = redact(msg, answer)
        if not redacted_msg.strip() or len(redacted_msg) < 4:
            redacted_msg = "Try carefully checking each step you've written so far."
    except Exception:
        redacted_msg = msg

    return (redacted_msg, ["try_again", "mark_final_answer"], {})


def _handle_try_again(tutor, question, topic, prior_turns):
    """Short encouragement plus the most relevant prior hint."""
    # Find the most recent hint the student received
    hint_records = [
        t for t in prior_turns
        if t.get("role") == "tutor" and "hint" in t.get("message", "").lower()
    ]

    if hint_records:
        last_hint = hint_records[-1]["message"]
        msg = f"You're on the right track! Remember: {last_hint[:200]}"
    else:
        msg = "Give it another go — you're closer than you think. Try working through it step by step."

    return (msg, ["give_next_step", "mark_final_answer"], {})


def _handle_mark_final_answer(tutor, question, topic, prior_turns):
    """Redirect to the mark flow."""
    return (
        "Ready to submit? Use the answer box above to enter your final answer, "
        "then click 'Check Answer' to have it marked.",
        [],
        {},
    )


def _handle_change_topic(tutor, question, topic, prior_turns):
    """Session-close message."""
    return (
        "No worries — pick a different question from the curriculum when you're ready.",
        [],
        {},
    )


def _handle_explain_my_answer(tutor, question, topic, prior_turns):
    """Prompt the student to explain their reasoning step by step."""
    return (
        "Take me through your solution step by step. What was the first thing you did? "
        "Write each step clearly so I can help you spot where things went wrong.",
        ["try_again", "mark_final_answer"],
        {},
    )


DISPATCH_TABLE = {
    "show_worked_example": _handle_show_worked_example,
    "give_next_step": _handle_give_next_step,
    "try_again": _handle_try_again,
    "explain_my_answer": _handle_explain_my_answer,
    "mark_final_answer": _handle_mark_final_answer,
    "change_topic": _handle_change_topic,
}


# --- Suggested-action selection (Task 5.1–5.2) ---


def select_actions(
    *,
    stuck: bool,
    prior_turns: list[dict],
    references_student_working: bool,
    references_candidate_final_answer: bool,
) -> list[SuggestedAction]:
    """Deterministic action selection per design §3.7."""
    out: list[SuggestedAction] = []

    student_count = sum(1 for t in prior_turns if t.get("role") == "student")
    prior_actions = {
        t["message"]
        for t in prior_turns
        if t.get("role") == "student" and t.get("message") in get_args(SuggestedAction)
    }

    if stuck and "show_worked_example" not in prior_actions:
        out.append("show_worked_example")
    if student_count >= 3 and "give_next_step" not in prior_actions:
        out.append("give_next_step")
    if references_student_working:
        out.append("try_again")
    if references_candidate_final_answer:
        out.append("mark_final_answer")

    # Cap at 4
    return out[:4]


def _subject_dialogue_guidance(question: dict) -> str:
    """Small subject-specific coaching line for the generic dialogue prompt."""
    subject = (question.get("subject") or "").lower()
    if subject == "english":
        facet = (question.get("english_metadata") or {}).get("facet")
        facet_guidance = {
            "text_evidence": "Ask for exact words or a short quote from the text before accepting a claim.",
            "reading_comprehension": "Keep the student anchored to what the passage actually says.",
            "language_conventions": "Use precise grammar or punctuation language, then ask the student to apply it.",
            "vocabulary": "Ask the student to use context clues before giving a definition.",
            "writing_structure": "Focus on claim, evidence, explanation, and sentence control.",
        }.get(facet, "Prioritise text evidence, clear expression, and the student's own wording.")
        return f"English coaching focus: {facet_guidance}"
    if subject == "science":
        metadata = question.get("science_metadata") or {}
        if metadata.get("claim_evidence_reasoning"):
            return "Science coaching focus: use claim, evidence, and reasoning; ask the student to connect data to the concept."
        if metadata.get("science_inquiry_skill") or metadata.get("variables"):
            return "Science coaching focus: identify variables, evidence, patterns, and fair-test reasoning before answering."
        return "Science coaching focus: connect the concept to evidence, data, observations, or a model."
    return "Math coaching focus: ask for working, reasoning, and a check of the method before final-answer confidence."


# --- Conversation builder (Task 6.1–6.2) ---


def build_conversation_messages(prior_turns: list[dict]) -> list[dict]:
    """Return the most-recent CONVERSATION_BUDGET non-system turns oldest-first."""
    non_system = [t for t in prior_turns if t.get("role") in ("student", "tutor")]

    if len(non_system) > CONVERSATION_BUDGET:
        non_system = non_system[-CONVERSATION_BUDGET:]

    return [_to_chat_message(t) for t in non_system]


def _to_chat_message(turn: dict) -> dict:
    """Convert a Dialogue_Turn_Record to an OpenAI-style chat message."""
    role = "user" if turn["role"] == "student" else "assistant"
    content = _wrap_student_answer(turn["message"]) if role == "user" else turn["message"]
    return {"role": role, "content": content}


# --- Exception (Task 7.3) ---


class CapReached(Exception):
    """Raised when the per-session dialogue turn cap is reached."""

    pass


# --- Main handler class (Tasks 7–8) ---


def _with_last_misconception(question: dict, log: dict, question_id: str) -> dict:
    """Attach the newest misconception for one question without mutating the bank."""
    candidates = [
        attempt
        for topic_data in log.get("topics", {}).values()
        for attempt in topic_data.get("attempts", [])
        if attempt.get("question_id") == question_id and attempt.get("misconception_id")
    ]
    if not candidates:
        return question
    latest = max(candidates, key=lambda attempt: str(attempt.get("timestamp") or ""))
    annotated = dict(question)
    annotated["_last_misconception_id"] = str(latest["misconception_id"])
    return annotated


class DialogueHandler:
    """Orchestrates a single dialogue turn."""

    def __init__(self, tutor_engine):
        self._tutor = tutor_engine

    def handle(
        self, *, student_id: str, question_id: str, student_message: str
    ) -> DialogueResponse:
        """Process a dialogue turn and return the response."""
        from backend.rules import get_engine

        # Task 7.1: Validate question existence
        question = self._tutor.exercises.get(question_id)
        if question is None:
            return DialogueResponse(
                tutor_message="I don't recognise that question. Try picking another from the curriculum.",
                suggested_actions=["change_topic"],
                dialogue_session_id="00000000-0000-4000-8000-000000000000",
                redaction_applied=False,
            )

        topic = question["topic"]
        primary_topic = getattr(type(self._tutor), "_primary_topic_identifier", None)
        concept_topic = (
            primary_topic(self._tutor, question)
            if callable(primary_topic)
            else (question.get("topic_ids") or [topic])[0]
        )
        subject = question.get("subject", "math")

        # Task 7.2: Resolve engine via Phase 2 factory
        engine = get_engine(student_id, subject)

        # Read only this dialogue topic for context, and attach the latest
        # persisted misconception for targeted worked examples.
        stale_log = engine.load_log(topics=[topic])
        _, prior_turns, _ = resolve_active_session(stale_log, topic, question_id)
        recent_attempts = engine.get_attempts_for_question(
            question_id, attempt_types=("answer", "diagnostic"), limit=20
        )
        question = _with_last_misconception(
            question,
            {"topics": {topic: {"attempts": recent_attempts}}},
            question_id,
        )

        # Strip frontend mode prefixes before classification/prompting.
        is_explaining = student_message.startswith("[EXPLAINING] ")
        is_pre_attempt_concept = student_message.startswith(PRE_ATTEMPT_CONCEPT_PREFIX)
        is_pre_attempt_first_step = student_message.startswith(PRE_ATTEMPT_FIRST_STEP_PREFIX)
        is_pre_attempt = is_pre_attempt_concept or is_pre_attempt_first_step
        clean_message = student_message
        if is_explaining:
            clean_message = clean_message[len("[EXPLAINING] "):]
        elif is_pre_attempt_concept:
            clean_message = clean_message[len(PRE_ATTEMPT_CONCEPT_PREFIX):]
        elif is_pre_attempt_first_step:
            clean_message = clean_message[len(PRE_ATTEMPT_FIRST_STEP_PREFIX):]

        # Compute stuck classification on the student-visible content, not mode prefixes.
        stuck = classify_stuck(clean_message, self._tutor)

        # Task 7.3: Action dispatch vs free-text conversation.
        # Action handlers return their own chips; do not overwrite them with
        # select_actions (which is only for free-text turns).
        is_action_dispatch = clean_message in get_args(SuggestedAction)
        if is_action_dispatch:
            tutor_msg, actions, _refs = self._handle_action(
                clean_message, question, concept_topic, prior_turns
            )
            references_student_working = False
            references_candidate_final_answer = False
        else:
            converse_res = self._converse(
                question,
                concept_topic,
                prior_turns,
                clean_message,
                stuck,
                student_id=student_id,
                is_explaining=is_explaining,
                is_pre_attempt=is_pre_attempt,
                is_pre_attempt_first_step=is_pre_attempt_first_step,
            )
            if len(converse_res) == 4:
                tutor_msg, references_student_working, references_candidate_final_answer, new_misconception = converse_res
            else:
                tutor_msg, references_student_working, references_candidate_final_answer = converse_res
                new_misconception = None

            if new_misconception:
                try:
                    from backend.misconception_library import stage_mined_misconception
                    stage_mined_misconception(topic_id=topic, mined_data=new_misconception)
                except Exception as exc:
                    import logging
                    logging.getLogger("DialogueHandler").warning("Failed to stage newly mined misconception from dialogue: %s", exc)

            actions = select_actions(
                stuck=stuck,
                prior_turns=prior_turns,
                references_student_working=references_student_working,
                references_candidate_final_answer=references_candidate_final_answer,
            )

        # --- Record error attribution when student explains their answer ---
        if is_explaining and tutor_msg:
            try:
                gap_classification = _classify_gap_from_working(
                    question,
                    clean_message,
                    tutor_msg,
                )
                updates = {
                    "error_attribution": tutor_msg,
                    "gap_classification": gap_classification,
                }
                updater = getattr(engine, "update_latest_incorrect_attempt_metadata", None)
                if callable(updater):
                    updater(
                        question_id,
                        updates,
                        topics=question.get("topic_ids") or [topic],
                    )
                else:
                    with engine._lock:
                        log = engine._read_log(topics=question.get("topic_ids") or [topic])
                        for t_data in log.get("topics", {}).values():
                            for att in t_data.get("attempts", []):
                                if (att.get("question_id") == question_id
                                        and att.get("attempt_type") == "answer"
                                        and is_scored_learning_attempt(att)
                                        and classify_attempt(att) is AttemptOutcome.INCORRECT):
                                    att.update(updates)
                        engine._write_log(log)
            except Exception:
                logger.warning("Failed to persist error attribution for question %s", question_id)

        # Task 7.5: Phase 3 redactor
        answer = question.get("answer", "")
        try:
            redacted, applied = redact(tutor_msg, answer)
            if not redacted.strip() or len(redacted) < 4:
                redacted = "Let's try the next step yourself — what comes next?"
                applied = True
        except Exception:
            redacted = "Let's try the next step yourself — what comes next?"
            applied = True

        # Task 7.6: Acquire lock; resolve session, check cap, append turns (atomic)
        with engine._lock:
            log = engine._read_log(topics=[topic])
            session_id, prior_turns, is_new = resolve_active_session(
                log, topic, question_id
            )
            non_system_count = sum(
                1 for t in prior_turns if t.get("role") in ("student", "tutor")
            )
            if non_system_count >= TURN_CAP:
                self._append_close_marker(
                    engine, log, topic, question_id, session_id, "session_closed_by_cap"
                )
                raise CapReached()
            self._append_turn(
                engine,
                log,
                topic,
                question_id,
                session_id,
                role="student",
                message=clean_message,
                stuck_classified=stuck,
                pre_attempt=is_pre_attempt,
            )
            self._append_turn(
                engine,
                log,
                topic,
                question_id,
                session_id,
                role="tutor",
                message=redacted,
            )

        # Task 7.7: Build response — preserve handler chips for action dispatch
        # (empty is intentional for mark_final_answer / change_topic).
        final_actions = list(actions or [])

        return DialogueResponse(
            tutor_message=redacted,
            suggested_actions=final_actions,
            dialogue_session_id=session_id,
            redaction_applied=applied,
        )

    def _handle_action(self, action: str, question, topic, prior_turns):
        """Dispatch an action invocation."""
        handler_fn = DISPATCH_TABLE.get(action)
        if handler_fn is None:
            return (
                "I didn't understand that action. Try typing your question instead.",
                ["mark_final_answer", "change_topic"],
                {},
            )
        return handler_fn(self._tutor, question, topic, prior_turns)

    def _converse(
        self,
        question,
        topic,
        prior_turns,
        student_message,
        stuck,
        *,
        student_id: str,
        is_explaining: bool = False,
        is_pre_attempt: bool = False,
        is_pre_attempt_first_step: bool = False,
    ):
        """Run the free-text conversation path via LLM."""

        messages = build_conversation_messages(prior_turns)

        concept_card = self._tutor.get_concept_card_dict(topic)
        core_rule = concept_card.get("core_rule", "")
        prompt_context = _prompt_context_for_question(question)

        # Fetch recent answer attempts for this question (if any)
        attempt_context = ""
        try:
            question_id = question.get("id", "")
            if question_id and student_id:
                from backend.rules import get_engine
                recent_attempts = get_engine(
                    student_id, question.get("subject", "math")
                ).get_attempts_for_question(
                    question_id, attempt_types=("answer",), limit=3
                )
                if recent_attempts:
                    attempt_context = "\n\nStudent's recent answer attempts on this question:\n"
                    for a in recent_attempts[-3:]:
                        status = "Correct" if a.get("correct") else f"Wrong (error: {a.get('error_type', 'unknown')})"
                        attempt_answer = _wrap_student_answer(str(a.get("student_answer") or ""))
                        attempt_context += f"- Tried: {attempt_answer} → {status}\n"
        except Exception:
            logger.warning("Failed to build dialogue attempt context for question %s", question_id)

        metadata_bits = []
        if question.get("question_type"):
            metadata_bits.append(f"question_type={question.get('question_type')}")
        if question.get("difficulty"):
            metadata_bits.append(f"difficulty={question.get('difficulty')}")
        if question.get("complexity"):
            metadata_bits.append(f"complexity={question.get('complexity')}")
        metadata_context = "; ".join(metadata_bits) if metadata_bits else "not specified"

        from backend.services.question_context import llm_question_context
        system_prompt = (
            f"{UNTRUSTED_CONTENT_SYSTEM_MESSAGE}\n\n"
            f"You are a Socratic tutor helping a student with this question.\n"
            f"{llm_question_context(question)}\n"
            f"Level: {prompt_context['year_level']}; Subject: {prompt_context['subject']}; Age range: {prompt_context['age_range']}\n"
            f"Question context: {metadata_context}\n"
            f"Topic: {topic}\n"
            f"Core rule: {core_rule}{attempt_context}\n\n"
            f"{_subject_dialogue_guidance(question)}\n"
            f"Assume a capable high-school student. Be concise, ask for reasoning, and avoid giving the final answer unless marking.\n\n"
        )
        if is_explaining:
            system_prompt += (
                f"The student is asking to understand their submitted answer attempt. "
                f"They may have provided only a final answer, not full working.\n"
                f"- Use the recent attempt context and the student's current message to infer the likely mistake.\n"
                f"- If their working is available, identify the specific step or logic point where the error occurred.\n"
                f"- If their working is not available, explain the most likely issue and ask one focused question about their method.\n"
                f"- Explain how to correct the thinking, but do NOT reveal the final answer or a complete solution.\n"
                f"- Keep it concise: 2-3 sentences, then one next action for the student.\n\n"
            )
        elif is_pre_attempt:
            system_prompt += (
                f"The student has not submitted an answer yet. This is pre-attempt support.\n"
                f"- Do NOT compute the final result.\n"
                f"- Do NOT reveal the final answer or the last solution step.\n"
                f"- Do NOT provide a complete worked example with a final answer.\n"
                f"- Give only a concept reminder, analogous setup, or starting observation.\n"
                f"- End by asking the student to try an answer before getting more help.\n"
            )
            if is_pre_attempt_first_step:
                system_prompt += (
                    f"- If giving a first step, stop after that first setup step and do not continue the solution.\n\n"
                )
            elif "similar" in student_message.lower() or "example" in student_message.lower():
                system_prompt += (
                    f"- If giving a similar example, use different values or evidence, model only the setup or first move, "
                    f"and leave the final step for the student.\n\n"
                )
            else:
                system_prompt += "\n"
        else:
            system_prompt += (
                f"Guide the student toward the answer without revealing it directly. "
                f"If the student has made previous incorrect attempts, reference what they tried "
                f"and nudge them in a different direction. "
                f"Ask probing questions. Be encouraging and concise.\n\n"
            )
        system_prompt += (
            f"Respond with JSON:\n"
            f'{{"tutor_message": "...", "references_student_working": true/false, '
            f'"references_candidate_final_answer": true/false, '
            f'"new_misconception": null or {{"name": string, "description": string, "student_facing_explanation": string}}}}\n\n'
            f"If the student reveals a systematic conceptual error/misconception in their working or explanations, "
            f"populate the 'new_misconception' object. Otherwise, set it to null."
        )

        # Build the full prompt from prior messages
        conversation_text = ""
        for msg in messages:  # prior turns
            role_label = "Student" if msg["role"] == "user" else "Tutor"
            conversation_text += f"{role_label}: {msg['content']}\n"

        full_prompt = (
            f"{system_prompt}\n\n"
            f"Conversation so far:\n{conversation_text}\n"
            f"Student (current): {_wrap_student_answer(student_message)}\n\n"
            f"Respond with JSON."
        )

        result: DialogueLLMResult = self._tutor._call_llm_safe(
            prompt=full_prompt,
            expected_schema=DialogueLLMResult,
            fallback=DialogueLLMResult.fallback(),
            response_format={"type": "json_object"},
            temp=0.3,
            system_message=UNTRUSTED_CONTENT_SYSTEM_MESSAGE,
            max_tokens=800,
        )

        return (
            result.tutor_message,
            result.references_student_working,
            result.references_candidate_final_answer,
            result.new_misconception,
        )

    # --- Persistence helpers (Task 8.1–8.2) ---

    def _append_turn(
        self,
        engine,
        log: dict,
        topic: str,
        question_id: str,
        session_id: str,
        *,
        role: str,
        message: str,
        stuck_classified: bool | None = None,
        pre_attempt: bool = False,
    ) -> None:
        """Append a Dialogue_Turn_Record. Caller must hold the lock."""
        if topic not in log.get("topics", {}):
            log.setdefault("topics", {})[topic] = {"attempts": [], "accuracy": 0.0}

        record = {
            "attempt_type": "dialogue",
            "role": role,
            "message": message,
            "question_id": question_id,
            "dialogue_session_id": session_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        if stuck_classified is not None:
            record["stuck_classified"] = stuck_classified
        if pre_attempt:
            # Pre-attempt concept exploration is encouraged metacognition, not
            # help-reliance. Analytics weights these turns lower for independence.
            record["pre_attempt"] = True

        log["topics"][topic].setdefault("dialogue_sessions", []).append(record)
        engine._write_log(log)

    def _append_close_marker(
        self,
        engine,
        log: dict,
        topic: str,
        question_id: str,
        session_id: str,
        message: str,
    ) -> None:
        """Append a system-role close marker. Caller must hold the lock."""
        self._append_turn(
            engine,
            log,
            topic,
            question_id,
            session_id,
            role="system",
            message=message,
        )
