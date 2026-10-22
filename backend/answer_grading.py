"""Shared deterministic answer grading helpers.

These helpers are intentionally local/deterministic. The main tutor marking
path can still use richer LLM rubric marking for reasoning responses, while
exam and diagnostic paths use this module to stay subject-aware without making
LLM calls.
"""
from __future__ import annotations

import json
import logging
import re

from backend.subject_registry import is_text_graded

logger = logging.getLogger(__name__)


def _parse_multi_part_answer(student_answer: str) -> dict[str, str]:
    """Parse JSON or line-based multi-part answers into label -> answer."""
    student_parts: dict[str, str] = {}
    try:
        parsed = json.loads(student_answer)
        if isinstance(parsed, dict):
            return {str(k).lower().strip(): str(v).strip() for k, v in parsed.items()}
    except (TypeError, ValueError):
        pass

    for line in student_answer.split("\n"):
        line = line.strip()
        if not line:
            continue
        for sep in [":", ")", "."]:
            if sep in line[:4]:
                label, _, ans = line.partition(sep)
                student_parts[label.strip().lower()] = ans.strip()
                break
    return student_parts


def _check_mcq_answer(exercise: dict, student_answer: str) -> bool:
    """Grade a multiple-choice answer by letter or selected option text."""
    correct_choice = (exercise.get("correct_choice") or "").strip().upper()
    if not correct_choice:
        return False

    student = student_answer.strip().upper()
    choices = exercise.get("choices") or []

    is_correct = student == correct_choice
    if not is_correct and student.startswith(correct_choice):
        suffix = student[len(correct_choice):]
        if not suffix or suffix[0].isspace() or suffix[0] in ".)-:,_":
            is_correct = True

    if not is_correct:
        correct_choice_str = None
        try:
            correct_idx = ord(correct_choice) - ord("A")
            if 0 <= correct_idx < len(choices):
                correct_choice_str = choices[correct_idx].strip().upper()
        except Exception:
            logger.warning("Failed to parse MCQ correct choice: %s", correct_choice)

        if correct_choice_str:
            if student == correct_choice_str:
                is_correct = True
            else:
                prefix_match = re.match(
                    rf"^{re.escape(correct_choice)}[\s\.\)\:\-\,\_]+(.*)",
                    correct_choice_str,
                    re.IGNORECASE,
                )
                if prefix_match and student == prefix_match.group(1).strip():
                    is_correct = True
    return is_correct


def _accepted_text_variants(exercise: dict) -> list[str]:
    """All extra accepted answers for an English text item.

    Grading historically only read the top-level ``alternative_answers`` field,
    while authored content also stored variants under
    ``english_metadata.accepted_answer_variants``. Honour both so neither is dead data.
    """
    variants: list[str] = list(exercise.get("alternative_answers") or [])
    meta = exercise.get("english_metadata") or exercise.get("science_metadata") or {}
    variants.extend(meta.get("accepted_answer_variants") or [])
    return [v for v in variants if isinstance(v, str) and v.strip()]


def _check_text_answer(exercise: dict, student_answer: str, correct_answer: str) -> bool:
    """Grade an English text answer with strict spelling preservation."""
    from backend.answer_normalize import are_equivalent_text, are_equivalent_text_strict

    eq_fn = are_equivalent_text_strict if exercise.get("strict_punctuation", False) else are_equivalent_text
    if eq_fn(student_answer, correct_answer):
        return True
    for alt in _accepted_text_variants(exercise):
        if eq_fn(student_answer, alt):
            return True
    return False


def _check_math_answer(student_answer: str, correct_answer: str) -> bool:
    """Grade a non-English short answer using the existing maths logic."""
    from backend.answer_normalize import are_equivalent, normalise

    if are_equivalent(student_answer, correct_answer):
        return True
    student_form = normalise(student_answer)
    correct_form = normalise(correct_answer)
    if student_form.decimal is not None and correct_form.decimal is not None:
        return student_form.decimal == correct_form.decimal
    if student_form.integer is not None and correct_form.integer is not None:
        return student_form.integer == correct_form.integer
    if student_form.fraction is not None and correct_form.fraction is not None:
        return student_form.fraction == correct_form.fraction
    s_text = student_form.text_words or student_answer.strip().lower()
    c_text = correct_form.text_words or correct_answer.strip().lower()
    return s_text == c_text


def _check_math_answer_with_metadata(exercise: dict, student_answer: str, correct_answer: str) -> bool:
    """Grade a maths answer using item-specific tolerance and alternatives."""
    from backend.answer_normalize import are_equivalent_with_metadata

    return are_equivalent_with_metadata(
        student_answer,
        correct_answer,
        answer_tolerance=exercise.get("answer_tolerance"),
        alternative_answers=exercise.get("alternative_answers"),
    )


def _check_sub_part_answer(exercise: dict, part: dict, student_answer: str) -> bool:
    """Grade a subpart, accepting visible MCQ choice text when choices exist."""
    correct_answer = part.get("answer", "")
    choices = part.get("choices") or []
    if choices and isinstance(correct_answer, str) and len(correct_answer.strip()) == 1:
        pseudo_mcq = {"correct_choice": correct_answer, "choices": choices}
        if _check_mcq_answer(pseudo_mcq, student_answer):
            return True

    if is_text_graded(exercise.get("subject", "math")):
        # A multi-part answer is graded against the selected part only. Do not
        # pass the root exercise through here: its accepted variants describe
        # the whole item and must not make a different part correct.
        part_context = {
            "strict_punctuation": exercise.get("strict_punctuation", False),
            "alternative_answers": part.get("alternative_answers") or [],
        }
        return _check_text_answer(part_context, student_answer, correct_answer)
    return _check_math_answer_with_metadata(
        {
            "answer_tolerance": part.get("answer_tolerance"),
            "alternative_answers": part.get("alternative_answers") or [],
        },
        student_answer,
        correct_answer,
    )


def grade_answer(exercise: dict, student_answer: str) -> bool:
    """Deterministically grade an answer with subject-aware text handling."""
    if not student_answer or not student_answer.strip():
        return False

    question_type = exercise.get("question_type", "short_answer")
    subject = exercise.get("subject", "math")
    correct_answer = exercise.get("answer", "")

    if question_type == "multiple_choice":
        return _check_mcq_answer(exercise, student_answer)

    if question_type == "multi_part":
        sub_parts = exercise.get("sub_parts", [])
        if not sub_parts:
            return False
        student_parts = _parse_multi_part_answer(student_answer)
        for part in sub_parts:
            label = str(part.get("label", "")).lower().strip()
            part_answer = part.get("answer", "")
            student_part = student_parts.get(label, "")
            if not student_part:
                return False
            if not _check_sub_part_answer(exercise, part, student_part):
                return False
        return True

    if is_text_graded(subject):
        return _check_text_answer(exercise, student_answer, correct_answer)
    return _check_math_answer_with_metadata(exercise, student_answer, correct_answer)


_LATEX_COMMAND = re.compile(r"\\[A-Za-z]+")
_LATEX_TEXT = re.compile(r"\\(?:text|mathrm|textbf|operatorname)\s*\{[^{}]*\}")
_SCRIPT_MARK = re.compile(r"[\^_]")
# A prose word has small letters. Point names such as "BCD" are not prose.
_PROSE_WORD = re.compile(r"(?<![\\A-Za-z])[A-Za-z]*[a-z][A-Za-z]*")
# A multiple-choice answer can start with its label, for example "B) ".
_CHOICE_LABEL = re.compile(r"^([A-H]\)\s+)(.+)$", re.DOTALL)


def answer_markdown(text) -> str:
    """Answer text for a Markdown view with maths.

    Many maths answers are stored as bare LaTeX with no ``$`` signs, for
    example ``3\\frac{21}{25}``, and Markdown shows them as code. A bare maths
    expression is put between ``$`` signs; a choice label such as ``B) `` stays
    outside. Text that has ``$`` signs, plain text, and text with prose words
    do not change: in maths mode a sentence loses its spaces.
    """
    value = "" if text is None else str(text)
    expression = value.strip()
    if not expression or "$" in expression:
        return value
    if not (_LATEX_COMMAND.search(expression) or _SCRIPT_MARK.search(expression)):
        return value
    label = ""
    labelled = _CHOICE_LABEL.match(expression)
    if labelled:
        label, expression = labelled.groups()
    words = _LATEX_COMMAND.sub(" ", _LATEX_TEXT.sub(" ", expression))
    if any(len(word) >= 3 for word in _PROSE_WORD.findall(words)):
        return value
    return f"{label}${expression}$"


def correct_answer_for_display(exercise: dict) -> str:
    """Return the safest correct-answer text for reports and review screens.

    The text is Markdown: a bare LaTeX answer gets ``$`` signs (``answer_markdown``).
    """
    return answer_markdown(_correct_answer_text(exercise))


def _correct_answer_text(exercise: dict) -> str:
    if exercise.get("question_type") != "multiple_choice":
        return exercise.get("answer", "")

    correct_choice = (exercise.get("correct_choice") or "").strip().upper()
    if not correct_choice:
        return exercise.get("answer", "")

    choices = exercise.get("choices") or []
    try:
        correct_idx = ord(correct_choice) - ord("A")
        if 0 <= correct_idx < len(choices):
            choice_text = str(choices[correct_idx]).strip()
            return choice_text or correct_choice
    except Exception:
        logger.warning("Failed to build MCQ display answer: %s", correct_choice)
    return correct_choice


def grade_multi_part_details(exercise: dict, student_answer: str) -> dict:
    """Grade a multi-part exercise returning per-part detail for partial credit.

    Audit Packet 3.1 — enables partial-credit scoring for English multi-part
    questions where all-or-nothing is too harsh.

    Returns a dict with:
    - ``part_results``: list of per-part dicts (label, is_correct, marks, student_answer, correct_answer)
    - ``score``: total marks earned
    - ``max_score``: total marks available
    - ``is_correct``: True only when all parts are correct
    """
    sub_parts = exercise.get("sub_parts") or []
    if not sub_parts:
        return {
            "part_results": [],
            "score": 0,
            "max_score": 0,
            "is_correct": False,
        }

    subject = exercise.get("subject", "math")
    student_parts = _parse_multi_part_answer(student_answer)
    part_results = []
    total_score = 0.0
    total_max = 0.0

    for part in sub_parts:
        label = str(part.get("label", "")).lower().strip()
        correct_answer = part.get("answer", "")
        try:
            max_score = float(part.get("max_score", part.get("marks", 1)) or 0)
        except (TypeError, ValueError):
            max_score = 0.0
        max_score = max(0.0, max_score)
        student_part = student_parts.get(label, "").strip()
        is_part_correct = bool(
            student_part and _check_sub_part_answer(exercise, part, student_part)
        )
        part_score = max_score if is_part_correct else 0.0
        outcome = (
            "correct" if is_part_correct
            else "incorrect" if student_part
            else "unanswered"
        )

        total_score += part_score
        total_max += max_score

        part_results.append({
            "label": part.get("label", ""),
            "is_correct": is_part_correct,
            "outcome": outcome,
            "marks": part.get("marks", 1),
            "score": int(part_score) if part_score.is_integer() else part_score,
            "max_score": int(max_score) if max_score.is_integer() else max_score,
            "student_answer": student_part,
            "correct_answer": correct_answer,
        })

    outcomes = {part["outcome"] for part in part_results}
    overall_outcome = (
        "unanswered" if "unanswered" in outcomes
        else "incorrect" if "incorrect" in outcomes
        else "correct"
    )
    return {
        "part_results": part_results,
        "score": int(total_score) if total_score.is_integer() else total_score,
        "max_score": int(total_max) if total_max.is_integer() else total_max,
        "is_correct": overall_outcome == "correct",
        "outcome": overall_outcome,
    }


__all__ = ["grade_answer", "answer_markdown", "correct_answer_for_display", "grade_multi_part_details"]
