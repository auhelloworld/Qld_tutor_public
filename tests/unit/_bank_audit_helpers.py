"""Shared mechanics for full-bank quality regression tests.

Subject-specific audit rules remain in their owning test modules; only exact,
semantics-free helpers live here.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Iterator


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def normalise_alphanum(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value).lower())


def strip_choice_prefix(value: Any) -> str:
    return re.sub(r"^\s*[A-Z]\s*[\).:-]\s*", "", str(value).strip(), flags=re.IGNORECASE)


def answer_matches_choice(answer: Any, choice: Any, key: str) -> bool:
    """Match an MCQ answer by key or selected option text.

    A key-only answer is authoritative even when the option text contains only
    symbols (for example ``<``, ``>``, or ``=``), which normalise to an empty
    alphanumeric string.
    """
    answer_norm = normalise_alphanum(answer)
    key_norm = normalise_alphanum(key)
    if key_norm and (
        answer_norm == key_norm
        or f"choice{key_norm}iscorrect" in answer_norm
        or f"{key_norm}iscorrect" in answer_norm
    ):
        return True

    choice_norm = normalise_alphanum(strip_choice_prefix(choice).rstrip("."))
    return bool(choice_norm) and (
        choice_norm in answer_norm
        or answer_norm in choice_norm
    )


def walk_strings(value: Any) -> Iterator[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from walk_strings(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from walk_strings(item)


def audit_senior_question_type(
    exercise: dict[str, Any],
    issues: dict[str, list[str]],
    *,
    min_reasoning_key_points: int,
    min_reasoning_score: int,
    min_multi_part_marks: int,
) -> None:
    exercise_id = str(exercise.get("id", "unknown"))
    question_type = exercise.get("question_type")
    if question_type == "multiple_choice":
        choices = exercise.get("choices") or []
        key = str(exercise.get("correct_choice") or "").upper()
        if len(choices) < 2 or len(key) != 1:
            issues["mc_missing_choices_or_key"].append(exercise_id)
            return
        index = ord(key) - ord("A")
        if index < 0 or index >= len(choices):
            issues["mc_invalid_key"].append(exercise_id)
            return
        if len(choices) != len(set(map(str, choices))):
            issues["mc_duplicate_choices"].append(exercise_id)
        if not answer_matches_choice(exercise.get("answer", ""), choices[index], key):
            issues["mc_answer_mismatch"].append(exercise_id)
    elif question_type == "reasoning":
        rubric = exercise.get("rubric") or {}
        key_points = rubric.get("key_points") or []
        if (
            len(key_points) < min_reasoning_key_points
            or int(rubric.get("max_score") or 0) < min_reasoning_score
        ):
            issues["reasoning_weak_rubric"].append(exercise_id)
        if not str(exercise.get("sample_reasoning", "")).strip():
            issues["reasoning_missing_sample"].append(exercise_id)
    elif question_type == "multi_part":
        sub_parts = exercise.get("sub_parts") or []
        if len(sub_parts) < 2:
            issues["multipart_too_short"].append(exercise_id)
        total_marks = sum(int(part.get("marks", 1) or 1) for part in sub_parts)
        if total_marks < min_multi_part_marks:
            issues["multipart_low_marks"].append(exercise_id)
        for index, part in enumerate(sub_parts):
            if not all(part.get(key) for key in ("label", "question", "answer")):
                issues["multipart_subpart_incomplete"].append(f"{exercise_id}:{index}")


def audit_senior_template_signatures(
    items: list[dict[str, Any]],
    issues: dict[str, list[str]],
    *,
    question_skeleton,
    min_diversity_sample: int,
    min_content_diversity: float,
    max_boilerplate_share: float,
) -> None:
    from collections import Counter, defaultdict

    by_type: dict[Any, list[dict[str, Any]]] = defaultdict(list)
    for exercise in items:
        by_type[exercise.get("question_type")].append(exercise)

    multiple_choice = by_type.get("multiple_choice", [])
    if len(multiple_choice) >= min_diversity_sample:
        choice_sets = {
            tuple(sorted(str(choice) for choice in exercise.get("choices") or []))
            for exercise in multiple_choice
        }
        if len(choice_sets) / len(multiple_choice) < min_content_diversity:
            issues["templated_low_choiceset_diversity"].append(
                f"{len(choice_sets)}/{len(multiple_choice)}"
            )
        distractors: Counter[str] = Counter()
        for exercise in multiple_choice:
            key = str(exercise.get("correct_choice") or "").upper()
            for index, choice in enumerate(exercise.get("choices") or []):
                if chr(ord("A") + index) != key:
                    distractors[str(choice)] += 1
        if distractors:
            _, top_count = distractors.most_common(1)[0]
            if top_count / len(multiple_choice) > max_boilerplate_share:
                issues["templated_boilerplate_distractor"].append(
                    f"{top_count}/{len(multiple_choice)}"
                )

    for question_type in ("short_answer", "multi_part"):
        type_items = by_type.get(question_type, [])
        if len(type_items) >= min_diversity_sample:
            skeletons = Counter(
                question_skeleton(exercise.get("question", ""))
                for exercise in type_items
            )
            _, top_count = skeletons.most_common(1)[0]
            if top_count / len(type_items) > max_boilerplate_share:
                issues["templated_dominant_question_stem"].append(
                    f"{question_type}:{top_count}/{len(type_items)}"
                )

    reasoning = by_type.get("reasoning", [])
    if len(reasoning) >= min_diversity_sample:
        distinct = len({
            str(exercise.get("sample_reasoning", ""))
            for exercise in reasoning
        })
        if distinct / len(reasoning) < min_content_diversity:
            issues["templated_low_reasoning_diversity"].append(
                f"{distinct}/{len(reasoning)}"
            )
