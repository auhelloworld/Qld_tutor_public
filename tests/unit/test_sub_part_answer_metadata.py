"""Sub-part grading must use the sub-part's own answer metadata.

``ExerciseSubPart`` declares ``alternative_answers`` and ``answer_tolerance``,
but grading previously read those fields from the root item. That had two
consequences:

* authored per-part variants were dead data — a student typing "16" for an
  answer of "16 goals" was marked wrong even though the author had accepted it;
* root-level metadata leaked into every part, so part (a)'s answer (or a whole
  question model answer) could be accepted for part (b).
"""
from __future__ import annotations

import json

from backend.answer_grading import _check_sub_part_answer, grade_multi_part_details


def _item(**overrides):
    item = {
        "id": "multi-part-metadata",
        "subject": "math",
        "question_type": "multi_part",
        "question": "Answer each part.",
        "answer": "see sub-parts",
    }
    item.update(overrides)
    return item


def test_part_level_alternative_answers_are_honoured():
    part = {
        "label": "a",
        "question": "How many goals did the team score?",
        "answer": "16 goals",
        "alternative_answers": ["16"],
    }
    item = _item(sub_parts=[part])
    assert _check_sub_part_answer(item, part, "16 goals") is True
    assert _check_sub_part_answer(item, part, "16") is True
    assert _check_sub_part_answer(item, part, "17") is False


def test_part_level_tolerance_is_honoured():
    part = {
        "label": "a",
        "question": "Estimate the mass in grams.",
        "answer": "30",
        "answer_tolerance": {"absolute": 5},
    }
    item = _item(sub_parts=[part])
    assert _check_sub_part_answer(item, part, "34") is True
    assert _check_sub_part_answer(item, part, "37") is False


def test_root_alternatives_do_not_leak_into_other_parts():
    parts = [
        {"label": "a", "question": "Calculate 3 + 4.", "answer": "7"},
        {"label": "b", "question": "Calculate 5 + 6.", "answer": "11"},
    ]
    item = _item(answer="7", alternative_answers=["7", "seven"], sub_parts=parts)

    assert _check_sub_part_answer(item, parts[1], "11") is True
    assert _check_sub_part_answer(item, parts[1], "7") is False
    assert _check_sub_part_answer(item, parts[1], "seven") is False

    detail = grade_multi_part_details(item, json.dumps({"a": "7", "b": "7"}))
    assert detail["is_correct"] is False
    assert detail["score"] < detail["max_score"]


def test_root_tolerance_does_not_leak_into_an_exact_part():
    part = {"label": "a", "question": "Exactly how many students?", "answer": "30"}
    item = _item(answer_tolerance={"absolute": 5}, sub_parts=[part])
    assert _check_sub_part_answer(item, part, "30") is True
    assert _check_sub_part_answer(item, part, "34") is False


def test_whole_question_english_variant_does_not_satisfy_a_single_part():
    model_answer = "The director separates performers, helpers and guests."
    parts = [
        {"label": "a", "question": "Give one example.", "answer": "Lead actors, crew and guests."},
        {"label": "b", "question": "Explain the effect.", "answer": "It builds a hierarchy."},
    ]
    item = _item(
        subject="english",
        sub_parts=parts,
        english_metadata={"accepted_answer_variants": [model_answer]},
    )
    assert _check_sub_part_answer(item, parts[0], "Lead actors, crew and guests.") is True
    assert _check_sub_part_answer(item, parts[0], model_answer) is False


def test_authored_sub_part_variants_in_the_shipped_banks_are_accepted():
    """Every authored per-part variant must grade as correct."""
    import glob

    checked = 0
    rejected = []
    for path in sorted(glob.glob("data/exercise_*.json")):
        with open(path, encoding="utf-8") as handle:
            items = json.load(handle)
        if not isinstance(items, list):
            continue
        for exercise in items:
            if not isinstance(exercise, dict) or exercise.get("question_type") != "multi_part":
                continue
            for part in exercise.get("sub_parts") or []:
                for variant in part.get("alternative_answers") or []:
                    checked += 1
                    if not _check_sub_part_answer(exercise, part, variant):
                        rejected.append((exercise.get("id"), part.get("label"), variant))
    assert checked > 0, "no authored sub-part variants found to verify"
    assert rejected == [], f"authored variants graded wrong: {rejected}"
