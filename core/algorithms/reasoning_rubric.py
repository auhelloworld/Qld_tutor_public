"""Canonical scoring contract for reasoning rubrics.

Legacy exercise banks declare a list of binary ``key_points`` plus a
``max_score`` that is not always attainable from those points.  This module
normalises every rubric to one explicit contract:

* each legacy key point is worth one mark;
* a key point may optionally declare a positive integer ``marks`` value;
* the effective maximum is the sum of point marks, never an unrelated total;
* point attainment, not an LLM-reported total, determines the persisted score.
"""
from __future__ import annotations

import re
from typing import Any, Iterable, Mapping


_POINT_TEXT_KEYS = ("text", "label", "description", "criterion", "id")
_POINT_MARK_KEYS = ("marks", "weight", "score")
_PROGRESSIVE_LEVEL_RE = re.compile(r"^\s*([CBA])-level\s*:", re.IGNORECASE)
_PART_LABEL_RE = re.compile(r"^\s*([A-Za-z0-9]+)\s*[\).:\-]\s*(.+)$", re.DOTALL)
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+|\s*;\s*|\s+(?=(?:This|It|They|The|By|Through|Because)\b)")


def _point_text(point: Any, index: int) -> str:
    if isinstance(point, str):
        text = point.strip()
        return text or f"Criterion {index + 1}"
    if isinstance(point, Mapping):
        for key in _POINT_TEXT_KEYS:
            value = point.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return f"Criterion {index + 1}"


def _point_marks(point: Any) -> int:
    if isinstance(point, Mapping):
        for key in _POINT_MARK_KEYS:
            value = point.get(key)
            if value is None or isinstance(value, bool):
                continue
            try:
                marks = int(float(value))
            except (TypeError, ValueError):
                continue
            if marks > 0:
                return marks
    return 1


def _progressive_level_mode(points: list[dict[str, Any]]) -> bool:
    """Return True when three one-mark points form C/B/A achievement levels."""
    if len(points) != 3 or any(point["marks"] != 1 for point in points):
        return False
    labels: list[str] = []
    for point in points:
        match = _PROGRESSIVE_LEVEL_RE.match(point["text"])
        if not match:
            return False
        labels.append(match.group(1).upper())
    return labels == ["C", "B", "A"]


def _strip_part_label(text: str, label: str) -> str:
    match = _PART_LABEL_RE.match(text.strip())
    if match and match.group(1).lower() == label.lower():
        return match.group(2).strip()
    return text.strip()


def _criterion_units(text: str, label: str) -> list[str]:
    """Split authored answer/rubric prose into distinct, content-specific units."""
    clean = _strip_part_label(re.sub(r"\s+", " ", text).strip(), label)
    if not clean:
        return []
    units = [part.strip(" .") for part in _SENTENCE_SPLIT_RE.split(clean) if part.strip(" .")]
    if len(units) == 1:
        clauses = re.split(r"\s+(?:but|while|whereas|because|so that)\s+", units[0], flags=re.IGNORECASE)
        if len(clauses) > 1 and all(len(clause.split()) >= 4 for clause in clauses):
            units = [clause.strip(" .") for clause in clauses]
    return [unit[:240] for unit in units if len(unit.split()) >= 3]


def _task_fallback_criteria(part_question: str) -> list[str]:
    focus = re.sub(
        r"^\s*(?:identify|state|name|select|explain|analyse|analyze|evaluate|compare|justify|write|rewrite|create|draft|describe)\b\s*",
        "",
        re.sub(r"\s+", " ", part_question).strip(),
        flags=re.IGNORECASE,
    ).strip(" .:?")
    focus = focus[:150] or "the requirement in this part"
    lower = part_question.lower()
    if re.search(r"\b(?:analyse|analyze)\b", lower):
        return [
            f"Identifies precise evidence or a feature relevant to {focus}.",
            "Explains how the language, structure or design choice creates an effect.",
            "Connects that effect to meaning, audience response or purpose.",
        ]
    if re.search(r"\b(?:evaluate|justify)\b", lower):
        return [
            f"Makes a clear judgement about {focus}.",
            "Supports the judgement with relevant evidence or criteria.",
            "Explains why the evidence leads to that judgement, including any qualification required by the task.",
        ]
    if re.search(r"\bcompare\b", lower):
        return [
            f"Addresses both elements in the comparison of {focus}.",
            "States a meaningful similarity, difference or relationship between them.",
            "Supports the comparison with precise evidence and explains its significance.",
        ]
    if re.search(r"\b(?:write|rewrite|create|draft)\b", lower):
        return [
            f"Produces a response that fulfils {focus}.",
            "Uses language and structural choices suited to the stated purpose and audience.",
            "Controls cohesion, vocabulary and sentences sufficiently for the requested form.",
        ]
    if re.search(r"\b(?:explain|why|how)\b", lower):
        return [
            f"States a relevant response to {focus}.",
            "Explains the relationship, cause or effect rather than only naming a detail.",
            "Uses relevant evidence or wording and links it to the conclusion.",
        ]
    return [
        f"Addresses {focus} accurately.",
        "Uses relevant detail or evidence from the question or stimulus.",
        "Communicates the response clearly and completely for the marks available.",
    ]


def derive_multi_part_rubric(
    question: Mapping[str, Any],
    part: Mapping[str, Any],
) -> dict[str, Any] | None:
    """Build a hidden part-level rubric from authored content when one is absent.

    The derivation uses the matching labelled top-level point and the authored
    part answer before falling back to task-specific criteria. It is intended
    for LLM partial marking, not deterministic exact-answer matching.
    """
    existing = part.get("rubric")
    if isinstance(existing, Mapping) and normalise_reasoning_rubric(existing)["valid"]:
        return dict(existing)

    raw_max = part.get("max_score", part.get("marks", 1))
    try:
        numeric_max = float(raw_max)
    except (TypeError, ValueError):
        return None
    if numeric_max <= 1 or not numeric_max.is_integer():
        return None
    target_count = int(numeric_max)

    label = str(part.get("label") or "").strip().lower()
    top_rubric = question.get("rubric") if isinstance(question.get("rubric"), Mapping) else {}
    matching_point = ""
    for point in top_rubric.get("key_points") or []:
        text = _point_text(point, 0)
        match = _PART_LABEL_RE.match(text)
        if match and match.group(1).lower() == label:
            matching_point = match.group(2).strip()
            break

    candidates: list[str] = []
    for source in (matching_point, str(part.get("answer") or "")):
        for unit in _criterion_units(source, label):
            normalised = re.sub(r"[^a-z0-9]+", " ", unit.lower()).strip()
            if not normalised:
                continue
            if any(
                normalised == existing_norm
                or normalised in existing_norm
                or existing_norm in normalised
                for existing_norm, _ in [
                    (re.sub(r"[^a-z0-9]+", " ", item.lower()).strip(), item)
                    for item in candidates
                ]
            ):
                continue
            candidates.append(unit)

    for fallback in _task_fallback_criteria(str(part.get("question") or "")):
        if len(candidates) >= target_count:
            break
        candidates.append(fallback)

    criteria = candidates[:target_count]
    if len(criteria) != target_count:
        return None
    return {
        "key_points": [{"text": criterion, "marks": 1} for criterion in criteria],
        "max_score": target_count,
        "derived": True,
        "derived_from": "labelled top-level rubric and authored part answer",
    }


def normalise_reasoning_rubric(rubric: Mapping[str, Any] | None) -> dict[str, Any]:
    """Return a validated, attainable reasoning-rubric representation.

    ``declared_max_score`` is retained for audit visibility, while
    ``max_score`` is always derived from the key points actually available for
    marking.  Empty or malformed key-point lists produce an invalid contract.
    """
    source = dict(rubric or {})
    raw_points = source.get("key_points")
    if not isinstance(raw_points, list) or not raw_points:
        return {
            "valid": False,
            "key_points": [],
            "max_score": 0,
            "declared_max_score": source.get("max_score"),
            "normalised": False,
            "scoring_mode": "independent_points",
            "reason": "reasoning rubric requires at least one key point",
        }

    points = [
        {
            "index": index,
            "text": _point_text(point, index),
            "marks": _point_marks(point),
        }
        for index, point in enumerate(raw_points)
    ]
    effective_max = sum(point["marks"] for point in points)
    scoring_mode = "progressive_levels" if _progressive_level_mode(points) else "independent_points"
    declared = source.get("max_score")
    try:
        declared_int = int(float(declared)) if declared is not None and not isinstance(declared, bool) else None
    except (TypeError, ValueError):
        declared_int = None

    return {
        "valid": effective_max > 0,
        "key_points": points,
        "max_score": effective_max,
        "declared_max_score": declared,
        "normalised": declared_int != effective_max,
        "scoring_mode": scoring_mode,
        "reason": None,
    }


def _result_text(result: Any) -> str:
    if isinstance(result, str):
        return result.strip()
    if isinstance(result, Mapping):
        for key in _POINT_TEXT_KEYS:
            value = result.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        text = result.get("text")
        if isinstance(text, str):
            return text.strip()
    text = getattr(result, "text", None)
    if isinstance(text, str):
        return text.strip()
    return ""


def _result_met(result: Any) -> bool:
    if isinstance(result, Mapping):
        value = result.get("met")
        if value is None:
            for key in ("achieved", "is_met", "covered"):
                if key in result:
                    value = result.get(key)
                    break
    else:
        value = getattr(result, "met", None)
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and value in (0, 1):
        return bool(value)
    if isinstance(value, str):
        cleaned = value.strip().lower()
        if cleaned in ("true", "yes", "1", "met", "achieved"):
            return True
        if cleaned in ("false", "no", "0", "unmet", "missed"):
            return False
    return False


def _norm_match_text(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def _text_match_score(a: str, b: str) -> int:
    """Higher is better. 0 = no useful match."""
    na, nb = _norm_match_text(a), _norm_match_text(b)
    if not na or not nb:
        return 0
    if na == nb:
        return 1000 + len(na)
    if na in nb or nb in na:
        return 500 + min(len(na), len(nb))
    ta, tb = set(na.split()), set(nb.split())
    if not ta or not tb:
        return 0
    overlap = ta & tb
    if not overlap:
        return 0
    # Prefer meaningful token overlap (ignore ultra-short tokens like "a"/"of").
    meaningful = {t for t in overlap if len(t) > 2}
    if not meaningful:
        return 0
    return 100 + 10 * len(meaningful) + len(" ".join(sorted(meaningful)))


def align_reasoning_point_results(
    expected_points: list[Mapping[str, Any]],
    results: Iterable[Any],
) -> tuple[list[dict[str, Any]], bool]:
    """Align model key-point rows to the rubric (same length/order).

    When the model returns fewer or reordered rows, map by text similarity and
    treat any unmatched rubric criteria as unmet.  Missing rows never invent
    credit (``met=False``).  Returns ``(aligned_rows, fully_specified)``.
    """
    result_list = list(results)
    n = len(expected_points)
    if n == 0:
        return [], True

    def _optional_str(result: Any, *names: str) -> str | None:
        for name in names:
            if isinstance(result, Mapping):
                value = result.get(name)
            else:
                value = getattr(result, name, None)
            if isinstance(value, str) and value.strip():
                cleaned = value.strip()
                if cleaned.lower() not in ("none", "null", "false", "no"):
                    return cleaned
        return None

    def _as_row(result: Any, fallback_label: str, *, from_model: bool) -> dict[str, Any]:
        has_model = from_model and result is not None
        label = _result_text(result) or fallback_label
        return {
            "text": label,
            "met": _result_met(result) if has_model else False,
            "from_model": has_model,
            "why_missed": _optional_str(result, "why_missed", "missed_reason") if has_model else None,
            "how_to_fix": _optional_str(result, "how_to_fix", "fix") if has_model else None,
        }

    # Exact count: preserve order (legacy contract / progressive levels).
    if len(result_list) == n:
        aligned = [
            _as_row(result, f"Criterion {point['index'] + 1}", from_model=True)
            for point, result in zip(expected_points, result_list)
        ]
        return aligned, True

    # Empty payload: cannot score from model evidence.
    if not result_list:
        return (
            [
                _as_row(None, f"Criterion {point['index'] + 1}", from_model=False)
                for point in expected_points
            ],
            False,
        )

    used: set[int] = set()
    aligned_slots: list[dict[str, Any] | None] = [None] * n

    # 1) Prefer strong text matches against rubric criterion text.
    # Greedy: repeatedly assign the globally best unused (point, result) pair.
    pending_points = list(expected_points)
    while pending_points:
        best_pair = None  # (score, point_index_in_pending, result_idx)
        for p_i, point in enumerate(pending_points):
            rubric_text = str(point.get("text") or "")
            for idx, result in enumerate(result_list):
                if idx in used:
                    continue
                score = _text_match_score(rubric_text, _result_text(result))
                if score <= 0:
                    continue
                if best_pair is None or score > best_pair[0]:
                    best_pair = (score, p_i, idx)
        if best_pair is None:
            break
        _, p_i, idx = best_pair
        point = pending_points.pop(p_i)
        used.add(idx)
        aligned_slots[point["index"]] = _as_row(
            result_list[idx],
            f"Criterion {point['index'] + 1}",
            from_model=True,
        )

    # 2) Fill remaining slots in order with unused model rows (positional).
    unused = [idx for idx in range(len(result_list)) if idx not in used]
    for point in expected_points:
        slot = point["index"]
        if aligned_slots[slot] is not None:
            continue
        if unused:
            idx = unused.pop(0)
            used.add(idx)
            aligned_slots[slot] = _as_row(
                result_list[idx],
                f"Criterion {slot + 1}",
                from_model=True,
            )
        else:
            # No model evidence for this criterion → unmet (never invent credit).
            aligned_slots[slot] = _as_row(
                None,
                f"Criterion {slot + 1}",
                from_model=False,
            )

    aligned = [row for row in aligned_slots if row is not None]
    # fully_specified: every rubric slot had a model row (possibly reordered),
    # even if the model originally returned a different count.
    fully_specified = all(row.get("from_model") for row in aligned)
    return aligned, fully_specified


def score_reasoning_points(
    rubric: Mapping[str, Any] | None,
    results: Iterable[Any],
) -> dict[str, Any]:
    """Score point-by-point results against the canonical rubric.

    Prefer one model row per rubric point in order.  When the model returns a
    partial or reordered list, align conservatively: unmatched criteria are
    treated as unmet (no invented credit).  An empty model list is still a
    contract failure so callers can defer to review.
    """
    contract = normalise_reasoning_rubric(rubric)
    expected = contract["key_points"]
    if not contract["valid"]:
        return {
            **contract,
            "score": 0,
            "point_attainment": [],
            "contract_complete": False,
        }

    raw_results = list(results)
    aligned, fully_specified = align_reasoning_point_results(expected, raw_results)

    # No usable point decisions from the model → do not invent a total.
    if not raw_results:
        return {
            **contract,
            "score": 0,
            "point_attainment": [],
            "contract_complete": False,
            "reason": (
                f"expected {len(expected)} point results but received 0"
            ),
            "aligned": False,
        }

    attainment: list[dict[str, Any]] = []
    score = 0
    progression_open = True
    for point, result in zip(expected, aligned):
        reported_met = bool(result.get("met"))
        safe_label = result.get("text")
        if not isinstance(safe_label, str) or not safe_label.strip():
            safe_label = f"Criterion {point['index'] + 1}"

        if contract["scoring_mode"] == "progressive_levels":
            effective_met = progression_open and reported_met
            if not reported_met:
                progression_open = False
        else:
            effective_met = reported_met
        awarded = point["marks"] if effective_met else 0
        score += awarded
        attainment.append(
            {
                "index": point["index"],
                "label": safe_label.strip(),
                "met": effective_met,
                "reported_met": reported_met,
                "prerequisite_blocked": reported_met and not effective_met,
                "marks_awarded": awarded,
                "marks_available": point["marks"],
                "from_model": bool(result.get("from_model")),
                "why_missed": result.get("why_missed"),
                "how_to_fix": result.get("how_to_fix"),
            }
        )

    return {
        **contract,
        "score": score,
        "point_attainment": attainment,
        "contract_complete": True,
        "aligned": fully_specified,
        "received_point_count": len(raw_results),
        "reason": None
        if fully_specified
        else (
            f"aligned partial key_points: expected {len(expected)} "
            f"but received {len(raw_results)}; missing criteria marked unmet"
        ),
    }


def normalised_rubric_payload(rubric: Mapping[str, Any] | None) -> dict[str, Any]:
    """Return a copy suitable for schema/load-time normalisation."""
    source = dict(rubric or {})
    contract = normalise_reasoning_rubric(source)
    if not contract["valid"]:
        return source
    source["max_score"] = contract["max_score"]
    return source
