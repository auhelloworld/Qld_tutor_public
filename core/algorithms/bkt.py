"""Bayesian Knowledge Tracing (BKT) — shared pure-function implementation.

Calibrated for secondary school mathematics (Years 7–12):
  P(L0) = 0.10  — Low prior knowledge; students rarely know a topic before instruction
  P(T)  = 0.15  — Moderate learning rate per opportunity with instant feedback
  P(G)  = 0.20  — Base guess probability (overridden per question type)
  P(S)  = 0.08  — Low slip; students who truly know rarely make errors in math

Recency decay: applying a recency decay factor allows mastery to naturally
drop for topics that have not been practised recently, aligning BKT with the
spaced-repetition philosophy already built into the system.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone, timedelta


# ---------------------------------------------------------------------------
# Calibrated BKT parameters for secondary school mathematics
# ---------------------------------------------------------------------------

P_L0: float = 0.10
P_T: float  = 0.15
P_G: float  = 0.20
P_S: float  = 0.08


# ---------------------------------------------------------------------------
# Question-type-specific guess / slip overrides
# ---------------------------------------------------------------------------

_PARAMS_BY_TYPE = {
    "multiple_choice": (0.25, 0.05),  # random guess among 4 choices; low slip for MC
    "short_answer":    (0.02, 0.08),  # near-zero guess for numeric/algebraic; normal slip
    "fill_blank":      (0.05, 0.10),
    "reasoning":       (0.15, 0.10),  # partial rubric credit counts as partial guess
    "multi_part":      (0.08, 0.08),
}

# A right answer that the student marked "guess" is weak evidence. The
# diagnostic ability estimate uses the same floor (backend/diagnostic_engine.py).
REPORTED_GUESS_P_G: float = 0.5


# ---------------------------------------------------------------------------
# Recency decay
# ---------------------------------------------------------------------------

RECENCY_HALF_LIFE_DAYS: float = 14.0
"""Number of days after which attempt weight halves.

A half-life of 14 days means:
- 7-day-old attempt: ~71% weight
- 14-day-old attempt: 50% weight
- 28-day-old attempt: 25% weight
- 90-day-old attempt: ~1% weight
"""


# ---------------------------------------------------------------------------
# Scalability cap (conservative)
# ---------------------------------------------------------------------------

_UNSCORED_OUTCOMES = {"pending", "unanswered", "dismissed"}
_UNSCORED_ERROR_TYPES = {
    "parent_review_pending",
    "grading_deferred",
    "llm_unavailable",
    "llm_error",
    "marking_unavailable",
    "review_pending",
    "unscored",
    "unanswered",
    "not_answered",
    "empty_response",
    "in_progress",
    "dismissed",
    "manual_dismissed",
    "parent_dismissed",
}


def _is_scored_observation(attempt: dict) -> bool:
    """Interpret new outcome fields and legacy uncertainty markers."""
    outcome = str(attempt.get("outcome") or "").strip().lower()
    if outcome in _UNSCORED_OUTCOMES:
        return False
    if str(attempt.get("error_type") or "").strip().lower() in _UNSCORED_ERROR_TYPES:
        return False
    if attempt.get("grading_deferred"):
        return False
    if "student_answer" in attempt and not str(attempt.get("student_answer") or "").strip():
        return False
    return True


BKT_MAX_ATTEMPTS: int = 300
"""Only the most recent N attempts per topic contribute to BKT.

Bounds worst-case cost as a single student's history grows over Years 7–12.
With the 14-day recency half-life, attempts beyond a few months already
contribute <1%, so a high cap (300) leaves realistic single-topic histories
numerically unchanged while preventing unbounded growth. Pass ``max_attempts=None``
to disable the cap.
"""


def _recency_weight(timestamp: str | None, now: datetime | None = None) -> float:
    """Return a decay weight in (0, 1] for a single attempt timestamp.

    Returns 1.0 when ``timestamp`` is missing (backward compatible).
    """
    if not timestamp:
        return 1.0
    try:
        ts = datetime.fromisoformat(timestamp)
    except (ValueError, TypeError):
        return 1.0
    ref = (now or datetime.now(timezone.utc))
    if ref.tzinfo is None:
        ref = ref.replace(tzinfo=timezone.utc)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    age_days = (ref - ts).total_seconds() / 86400.0
    if age_days <= 0:
        return 1.0
    return 2.0 ** (-age_days / RECENCY_HALF_LIFE_DAYS)


# ---------------------------------------------------------------------------
# Core BKT
# ---------------------------------------------------------------------------


def calculate_bkt(
    attempts: list[dict],
    *,
    p_l0: float = P_L0,
    p_t: float = P_T,
    p_g: float = P_G,
    p_s: float = P_S,
    correct_key: str = "correct",
    filter_attempt_types: bool = True,
    apply_recency: bool = True,
    recency_ref_time: datetime | None = None,
    max_attempts: int | None = BKT_MAX_ATTEMPTS,
) -> float:
    """Run BKT over a list of attempt dicts and return P(Learned).

    Args:
        attempts: List of dicts, each containing at least ``correct_key``.
        p_l0: Prior probability of initial knowledge.
        p_t: Transition probability (learn per opportunity).
        p_g: Default guess probability.
        p_s: Default slip probability.
        correct_key: Key in each dict indicating correctness (bool).
        filter_attempt_types: If True, only consider records with
            ``attempt_type`` in ("answer", "diagnostic").
        apply_recency: If True, multiply each attempt's contribution by a
            decay factor based on its timestamp.
        recency_ref_time: Reference time for recency calculation (default: now).
        max_attempts: If set, only the most recent N attempts (after filtering)
            contribute — a conservative cap to bound cost as history grows.
            Defaults to ``BKT_MAX_ATTEMPTS``; pass None to disable.

    Returns:
        P(Learned) after all observations, rounded to 3 decimal places.
        When there are no scored observations, returns ``p_l0`` (the prior)
        rather than 0.0, so unattempted topics are not treated as known-unlearned.
    """
    if filter_attempt_types:
        attempts = [
            a for a in attempts
            if a.get("attempt_type", "answer") in ("answer", "diagnostic")
            and not a.get("is_speed_round")
            and _is_scored_observation(a)
        ]

    if not attempts:
        # No scored evidence: return the prior, not zero. Zero implies "known
        # unlearned" and over-punishes unattempted topics in mastery gates.
        return round(p_l0, 3)

    # Conservative scalability cap: only the most recent ``max_attempts`` per
    # topic contribute. Realistic single-topic histories are far below the cap,
    # so this is numerically a no-op today while bounding worst-case growth.
    if max_attempts is not None and len(attempts) > max_attempts:
        attempts = attempts[-max_attempts:]

    now = recency_ref_time or datetime.now(timezone.utc)
    p_L = p_l0

    for att in attempts:
        correct = att[correct_key]

        # Dynamic guess/slip based on question type
        qt = att.get("question_type")
        if qt in _PARAMS_BY_TYPE:
            pg, ps = _PARAMS_BY_TYPE[qt]
        else:
            pg, ps = p_g, p_s

        # Metacognitive reflection dynamic slip calibration:
        # If the student flagged a mistake as a "calculation_slip", we treat it as a high-probability slip
        if not correct and att.get("reflection_type") == "calculation_slip":
            ps = 0.50

        # The student said they guessed: a right answer shows little.
        if correct and att.get("confidence") == "guess":
            pg = max(pg, REPORTED_GUESS_P_G)

        if correct:
            denom = p_L * (1 - ps) + (1 - p_L) * pg
            p_L_given_obs = (p_L * (1 - ps)) / max(denom, 1e-9)
        else:
            denom = p_L * ps + (1 - p_L) * (1 - pg)
            p_L_given_obs = (p_L * ps) / max(denom, 1e-9)

        p_L_new = p_L_given_obs + (1 - p_L_given_obs) * p_t
        try:
            base_weight = float(att.get("weight", 1.0))
        except (ValueError, TypeError):
            base_weight = 1.0

        if apply_recency:
            decay = _recency_weight(att.get("timestamp"), now)
            effective_weight = base_weight * decay
        else:
            effective_weight = base_weight

        p_L = p_L + effective_weight * (p_L_new - p_L)
        p_L = max(0.01, min(0.99, p_L))

    return round(p_L, 3)


# ---------------------------------------------------------------------------
# Shared accuracy recomputation
# ---------------------------------------------------------------------------


def recompute_accuracy(topic_data: dict, *, apply_recency: bool = False) -> None:
    """Recompute accuracy from answer-type and diagnostic-type records.

    Backward compat: absent ``attempt_type`` counts as "answer".
    Mutates ``topic_data["accuracy"]`` in place.
    """
    attempts = topic_data.get("attempts", [])
    answer_attempts = [
        a for a in attempts
        if a.get("attempt_type", "answer") in ("answer", "diagnostic")
        and not a.get("is_speed_round")
        and _is_scored_observation(a)
    ]
    if not answer_attempts:
        topic_data["accuracy"] = 0.0
        return

    if apply_recency:
        now = datetime.now(timezone.utc)
        weighted_correct = sum(
            _recency_weight(a.get("timestamp"), now)
            for a in answer_attempts
            if a["correct"]
        )
        weighted_total = sum(
            _recency_weight(a.get("timestamp"), now)
            for a in answer_attempts
        )
        topic_data["accuracy"] = round(weighted_correct / weighted_total, 2) if weighted_total > 0 else 0.0
    else:
        correct_count = sum(1 for a in answer_attempts if a["correct"])
        topic_data["accuracy"] = round(correct_count / len(answer_attempts), 2)


# ---------------------------------------------------------------------------
# BKT Parameter Calibration
# ---------------------------------------------------------------------------


def calibrate_parameters(
    all_attempts: list[list[dict]],
    *,
    p_l0_options: list[float] | None = None,
    p_t_options: list[float] | None = None,
    progress_callback=None,
) -> dict:
    """Grid-search for optimal BKT parameters against observed data.

    Args:
        all_attempts: List of per-topic attempt sequences. Each inner list
            contains dicts with at least ``correct`` (bool) and optionally
            ``question_type`` (str).
        p_l0_options: P(L0) values to try (default: 0.05, 0.10, 0.15, 0.20, 0.30).
        p_t_options: P(T) values to try (default: 0.05, 0.10, 0.15, 0.20, 0.25).

    Returns:
        Dict with best parameters, prediction RMSE, and a plain-English
        explanation suitable for non-technical readers.
    """
    if p_l0_options is None:
        p_l0_options = [0.05, 0.10, 0.15, 0.20, 0.30]
    if p_t_options is None:
        p_t_options = [0.05, 0.10, 0.15, 0.20, 0.25]

    # Flatten all attempts for prediction scoring
    all_pairs: list[tuple[list[dict], bool]] = []
    for seq in all_attempts:
        if len(seq) < 2:
            continue  # need at least 2 attempts to compare prediction vs actual
        for i in range(1, len(seq)):
            history = seq[:i]
            actual = seq[i]["correct"]
            all_pairs.append((history, actual))

    if len(all_pairs) < 5:
        return {
            "p_l0": P_L0,
            "p_t": P_T,
            "rmse": 1.0,
            "sample_size": len(all_pairs),
            "message": (
                "Not enough data to calibrate — at least 5 predictions are needed. "
                "The default BKT parameters are being used."
            ),
        }

    total_combos = len(p_l0_options) * len(p_t_options)
    best_params = None
    best_rmse = float("inf")

    combo_idx = 0
    for p_l0 in p_l0_options:
        for p_t in p_t_options:
            squared_errors = []
            for history, actual in all_pairs:
                bkt = calculate_bkt(
                    history, p_l0=p_l0, p_t=p_t, apply_recency=False
                )
                # Predicted probability of correct on NEXT attempt
                # Use the default guess/slip (non-question-type-specific)
                pred_correct = bkt * (1 - P_S) + (1 - bkt) * P_G
                squared_errors.append((pred_correct - (1 if actual else 0)) ** 2)

            rmse = (sum(squared_errors) / len(squared_errors)) ** 0.5
            if rmse < best_rmse:
                best_rmse = rmse
                best_params = (p_l0, p_t)

            combo_idx += 1
            if progress_callback:
                progress_callback(combo_idx, total_combos)

    if best_params is None:
        return {
            "p_l0": P_L0, "p_t": P_T, "rmse": 1.0,
            "sample_size": len(all_pairs),
            "message": "Calibration failed — using default parameters.",
        }

    p_l0_best, p_t_best = best_params

    # Build a plain-English explanation
    if best_rmse < 0.35:
        quality = "good"
    elif best_rmse < 0.45:
        quality = "fair"
    else:
        quality = "weak — more data or different topics may be needed"

    message = (
        f"Calibrated from {len(all_pairs)} predictions across multiple topics. "
        f"Fit quality: {quality} (RMSE = {best_rmse:.3f}).\n\n"
        f"P(L0) = {p_l0_best:.2f}: "
    )
    if p_l0_best <= 0.10:
        message += (
            "Students know very little before instruction — "
            "most topics start from near zero knowledge."
        )
    elif p_l0_best <= 0.20:
        message += (
            "Students have some prior familiarity with topics — "
            "they may have seen similar material before."
        )
    else:
        message += (
            "Students appear to have significant prior knowledge — "
            "they may be reviewing familiar content rather than learning new topics."
        )

    message += f"\n\nP(T) = {p_t_best:.2f}: "
    if p_t_best <= 0.08:
        message += (
            "Learning per attempt is relatively slow — "
            "students benefit from repeated practice and may need additional instruction."
        )
    elif p_t_best <= 0.15:
        message += (
            "Students learn at a moderate pace — "
            "regular practice with feedback is effective."
        )
    else:
        message += (
            "Students learn quickly from each attempt — "
            "the instant feedback and hints appear to be very effective."
        )

    return {
        "p_l0": p_l0_best,
        "p_t": p_t_best,
        "rmse": round(best_rmse, 3),
        "sample_size": len(all_pairs),
        "message": message,
    }
