"""Student quests / stars economy (game-style motivation).

Storage: data/logs/<student_id>/quests.json
Stars awarded on tutor mark (idempotent by attempt_id).

Economy design (household, ~daily practice)
------------------------------------------
Primary earn path = answering questions (marks). Quests are habit bonuses.
Streak bonus is superlinear over a 14-day cycle so freezes insure real progress,
but peak streak pay must not drown out practice or make shop items free.

Typical solid day (≈20 attempts, ~70% correct, mid-streak, no Error Book):
  marks ~75⭐ + quests ~40–55⭐ → ~115–130⭐ (under default daily cap).

Shop targets (solid-day units ≈ 100–120⭐):
  freeze ≈ 1 day · iPad 15 / $2 ≈ 3–4 days · iPad 30 / movie ≈ 6–7 days
  $5 ≈ 1 week · pizza ≈ 1–1½ weeks.
"""

from __future__ import annotations

import json
import logging
import math
import random
import sqlite3
import threading
import uuid
import weakref
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

from backend import rules
from backend.sqlite_utils import connect_sqlite
from backend.student_lifecycle import student_write_guard
from backend.services.attempt_outcomes import is_independent_learning_attempt

logger = logging.getLogger(__name__)

_LOCKS: weakref.WeakValueDictionary[str, threading.RLock] = weakref.WeakValueDictionary()
_LOCKS_GUARD = threading.Lock()

# Room for a full practice day + quest claims without always clipping.
DEFAULT_DAILY_STAR_CAP = 300
# Old shipped defaults — rewrite to DEFAULT on load so parent/code stay in sync.
# (Do not include intentional custom values like 100 or 250.)
_LEGACY_DAILY_CAPS = frozenset({80, 120, 160, 200})
LEDGER_MAX = 200
IDEM_MAX = 500
# Cash grand prize: 28-day streak + avg ≥170⭐/day over last 28 days → $100 (not stars).
STREAK_CASH_PRIZE_DAYS = 28
STREAK_CASH_PRIZE_AVG_STARS = 170
STREAK_CASH_PRIZE_DOLLARS = 100
STREAK_CASH_PRIZE_CENTS = STREAK_CASH_PRIZE_DOLLARS * 100
# Legacy names kept for any external refs / tests migration
STREAK_60_GRAND_PRIZE_DOLLARS = STREAK_CASH_PRIZE_DOLLARS
STREAK_60_GRAND_PRIZE_CENTS = STREAK_CASH_PRIZE_CENTS
# Only true earn events count toward daily average (not refunds / holds).
_STARS_BY_DAY_EARN_REASONS = frozenset({"mark", "quest_claim", "chest_open"})

# Prize wheel: every spin costs stars, including a losing spin. Payouts are
# recycled wallet currency, so ``spin_win`` deliberately stays outside the
# daily earn reasons above.
SPIN_COST_STARS = 20
SPIN_MAX_PER_DAY = 10
SPIN_PRIZES: tuple[tuple[float, int, str, str], ...] = (
    (40.0, 0, "No luck this time", "🙈"),
    (25.0, 15, "15 stars", "⭐"),
    (15.0, 20, "20 stars", "✨"),
    (10.0, 30, "30 stars", "🌟"),
    (5.0, 50, "50 stars", "💫"),
    (3.9, 100, "100 stars", "🎉"),
    (1.0, 500, "500 stars", "🏆"),
    (0.1, 1000, "JACKPOT — 1000 stars", "💎"),
)

# Mark stars (main earn path) — modest per item; volume comes from practice.
MARK_STARS_WRONG = 1
MARK_STARS_CORRECT = 5
MARK_STARS_ERROR_BOOK = 5  # same as a normal correct mark

# Streak-tick: superlinear ramp, 14-day cycle wrap (strictly non-decreasing).
# Formula: BASE + d² // DIV  → day 1:5 … day 7:17 … day 10:30 … day 14:54
STREAK_REWARD_CYCLE_DAYS = 14
STREAK_REWARD_BASE = 5
STREAK_REWARD_DIV = 4

# Daily quest bonuses (habit / quality; smaller than a full practice session).
QUEST_REWARD_DAILY_GOAL = 18
QUEST_REWARD_ACCURACY = 12
QUEST_REWARD_ERROR_FIX = 24
QUEST_REWARD_INTERLEAVE = 16
QUEST_INTERLEAVE_TARGET = 3
# Solid accuracy: need N attempts at ≥ ACC threshold.
QUEST_ACCURACY_MIN_ATTEMPTS = 10
QUEST_ACCURACY_MIN_RATE = 0.75
# Error Book warrior: complete one transfer-safe source mistake today.
QUEST_ERROR_FIX_TARGET = 1

DEFAULT_CATALOG: list[dict[str, Any]] = [
    {
        "id": "streak_freeze",
        "title": "Streak freeze (1 day)",
        "emoji": "🛡️",
        "cost_stars": 100,
        "category": "item",
        "stock": None,
        "enabled": True,
        "sort": 5,
        "description": "Miss one day without breaking your streak. ≈1 solid practice day; protects the late ramp.",
    },
    {
        "id": "ipad_15",
        "title": "iPad 15 min",
        "emoji": "📱",
        "cost_stars": 400,
        "category": "screen_time",
        "stock": None,
        "enabled": True,
        "sort": 10,
        "description": "15 minutes of iPad time (parent must approve). ≈3–4 solid practice days.",
    },
    {
        "id": "ipad_30",
        "title": "iPad 30 min",
        "emoji": "📱",
        "cost_stars": 750,
        "category": "screen_time",
        "stock": None,
        "enabled": True,
        "sort": 20,
        "description": "30 minutes of iPad time (parent must approve). ≈6 solid practice days.",
    },
    {
        "id": "movie_pick",
        "title": "Pick a movie",
        "emoji": "🎬",
        "cost_stars": 800,
        "category": "privilege",
        "stock": None,
        "enabled": True,
        "sort": 40,
        "description": "You choose the family movie. ≈6–7 solid practice days.",
    },
    {
        "id": "cash_2",
        "title": "Pocket money $2",
        "emoji": "💵",
        "cost_stars": 400,
        "category": "cash",
        "stock": None,
        "enabled": True,
        "sort": 50,
        "description": "$2 pocket money when parent approves. ≈2½–3 solid days.",
    },
    {
        "id": "cash_5",
        "title": "Pocket money $5",
        "emoji": "💵",
        "cost_stars": 900,
        "category": "cash",
        "stock": None,
        "enabled": True,
        "sort": 60,
        "description": "$5 pocket money when parent approves. ≈1 week of solid practice.",
    },
    {
        "id": "pizza",
        "title": "Pizza night",
        "emoji": "🍕",
        "cost_stars": 1000,
        "category": "food",
        "stock": 1,
        "enabled": True,
        "sort": 70,
        "description": "Family pizza night — big goal. ≈1–1½ weeks of solid practice.",
    },
]

DIFFICULTY_WEIGHT = {
    "foundational": 1.0,
    "developing": 1.2,
    "extending": 1.5,
    "simple_familiar": 1.0,
    "complex_familiar": 1.2,
    "complex_unfamiliar": 1.5,
}

LEVEL_TITLES = {
    1: "Recruit",
    5: "Explorer",
    10: "Knight",
    15: "Champion",
    20: "Legend",
}


def _lock_for(student_id: str) -> threading.RLock:
    with _LOCKS_GUARD:
        lock = _LOCKS.get(student_id)
        if lock is None:
            lock = threading.RLock()
            _LOCKS[student_id] = lock
        return lock


def _path(student_id: str) -> Path:
    return rules.LOG_ROOT / student_id / "quests.json"


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _today() -> str:
    return date.today().isoformat()


def _default_state() -> dict[str, Any]:
    return {
        "version": 1,
        "stars": 0,
        "xp": 0,
        "level": 1,
        "freeze_tokens": 0,
        "chests": 0,
        # Special chests: 28-day streak + high daily avg → $100 cash (parent pays)
        "grand_prize_chests": 0,
        "stars_by_day": {},
        "enabled": True,
        "daily_star_cap": DEFAULT_DAILY_STAR_CAP,
        "shop_enabled": True,
        "chests_enabled": True,
        "spin_enabled": True,
        "spins_by_day": {},
        "ledger": [],
        "idempotency": {},
        "qid_day_counts": {},
        "quests_claimed": {},
        "chest_milestones": {},
        "error_fix_day": {},
        "error_fix_sources_by_day": {},
        "strands_by_day": {},
        "freeze_dates": [],
        "catalog": deepcopy(DEFAULT_CATALOG),
        "redemptions": [],
        "updated_at": _utc_now(),
    }


def _read_state(student_id: str) -> dict[str, Any]:
    path = _path(student_id)
    if not path.is_file():
        return _default_state()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        logger.warning("Corrupt quests.json for %s — resetting", student_id)
        return _default_state()
    if not isinstance(data, dict):
        return _default_state()
    base = _default_state()
    base.update({k: v for k, v in data.items() if k in base or k in data})
    # Ensure required collections
    for key, default in (
        ("ledger", []),
        ("idempotency", {}),
        ("qid_day_counts", {}),
        ("quests_claimed", {}),
        ("chest_milestones", {}),
        ("error_fix_day", {}),
        ("error_fix_sources_by_day", {}),
        ("strands_by_day", {}),
        ("freeze_dates", []),
        ("stars_by_day", {}),
        ("spins_by_day", {}),
        ("catalog", deepcopy(DEFAULT_CATALOG)),
        ("redemptions", []),
    ):
        if not isinstance(base.get(key), type(default)):
            base[key] = default
    if not base.get("catalog"):
        base["catalog"] = deepcopy(DEFAULT_CATALOG)
    else:
        # Keep built-in shop prices in sync unless parent customized the row.
        base["catalog"] = _sync_builtin_catalog(list(base.get("catalog") or []))
    # Bump legacy default daily caps so economy rebalances reach existing students.
    if int(base.get("daily_star_cap") or 0) in _LEGACY_DAILY_CAPS:
        base["daily_star_cap"] = DEFAULT_DAILY_STAR_CAP
    return base


def _sync_builtin_catalog(catalog: list[Any]) -> list[dict[str, Any]]:
    """Overlay DEFAULT_CATALOG for built-in ids that were not parent-edited.

    Ensures economy rebalances (e.g. freeze 60→20) reach existing students
    without wiping custom rewards parents added.
    """
    defaults = {str(c["id"]): c for c in DEFAULT_CATALOG}
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in catalog:
        if not isinstance(raw, dict):
            continue
        cid = str(raw.get("id") or "")
        if cid in defaults and not raw.get("parent_customized"):
            d = defaults[cid]
            merged = deepcopy(d)
            # Preserve per-student stock / enabled toggles
            if "stock" in raw:
                merged["stock"] = raw["stock"]
            if "enabled" in raw:
                merged["enabled"] = bool(raw["enabled"])
            out.append(merged)
        else:
            out.append(raw)
        if cid:
            seen.add(cid)
    for d in DEFAULT_CATALOG:
        did = str(d["id"])
        if did not in seen:
            out.append(deepcopy(d))
    return out


def _write_state(student_id: str, state: dict[str, Any]) -> None:
    with student_write_guard(student_id, rules.LOG_ROOT):
        state["updated_at"] = _utc_now()
        path = _path(student_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp.replace(path)


def xp_to_next_level(level: int) -> int:
    """XP needed to go from `level` → level+1. Curve: 100 + 50×(level−1)."""
    level = max(1, int(level))
    return 100 + 50 * (level - 1)


def title_for_level(level: int) -> str:
    level = max(1, int(level))
    chosen = "Recruit"
    for threshold, title in sorted(LEVEL_TITLES.items()):
        if level >= threshold:
            chosen = title
    return chosen


def compute_streak_days(activity_dates: Iterable[str], freeze_dates: Iterable[str] | None = None) -> int:
    """Consecutive days ending today or yesterday, treating freeze_dates as activity."""
    active = set(activity_dates or set())
    frozen = set(freeze_dates or set())
    effective = active | frozen
    if not effective:
        return 0
    streak = 0
    check = date.today()
    if check.isoformat() in effective:
        while check.isoformat() in effective:
            streak += 1
            check -= timedelta(days=1)
    elif (check - timedelta(days=1)).isoformat() in effective:
        check -= timedelta(days=1)
        while check.isoformat() in effective:
            streak += 1
            check -= timedelta(days=1)
    return streak


def streak_cycle_day(streak_days: int) -> int:
    """Map raw streak length onto 1..CYCLE (wraps every 2 weeks).

    Day 1–14 of a streak → 1–14; day 15 → 1; day 16 → 2; …
    """
    n = int(streak_days or 0)
    if n <= 0:
        return 0
    return ((n - 1) % STREAK_REWARD_CYCLE_DAYS) + 1


def streak_tick_reward_max() -> int:
    """Stars at the top of the biweekly ladder (cycle day 14)."""
    return streak_tick_reward_stars(STREAK_REWARD_CYCLE_DAYS)


def streak_tick_reward_stars(streak_days: int) -> int:
    """Stars for the keep-streak quest given current streak length.

    Superlinear ramp inside a 14-day cycle (then wraps):
    day 1 → 5⭐, day 7 → 17⭐, day 10 → 30⭐, day 14 → 54⭐, day 15 → 5⭐.

    Late days pay more so freeze is real insurance, but peak stay below a
    full practice session so answering questions remains the main earn path.
    """
    day = streak_cycle_day(streak_days)
    if day <= 0:
        return STREAK_REWARD_BASE
    # Quadratic: BASE + d²//DIV  (day1 uses BASE directly so start stays 5)
    if day == 1:
        return STREAK_REWARD_BASE
    return STREAK_REWARD_BASE + (day * day) // STREAK_REWARD_DIV - 1


def projected_streak_for_reward(streak_days: int, practiced_today: bool) -> int:
    """Streak length that will apply when today's keep-streak quest is claimable.

    If the student has not practiced yet, they are one day away from extending
    (or starting) the chain — show that future day so the reward preview matches
    what they will claim.
    """
    sd = max(0, int(streak_days or 0))
    if practiced_today:
        return sd if sd > 0 else 1
    # Chain still open from yesterday → next practice makes sd+1; else start at 1
    return sd + 1 if sd > 0 else 1


def apply_auto_streak_freeze(student_id: str, activity_dates: set[str]) -> dict[str, Any]:
    """If yesterday was missed but the day before was active, spend 1 freeze token.

    Marks yesterday as a freeze day so the streak bridge holds when the student
    returns (today or later). Idempotent for a given yesterday date.
    """
    today = date.today()
    yesterday = (today - timedelta(days=1)).isoformat()
    day_before = (today - timedelta(days=2)).isoformat()

    with _lock_for(student_id):
        state = _read_state(student_id)
        freeze_dates = [d for d in (state.get("freeze_dates") or []) if isinstance(d, str)]
        freeze_set = set(freeze_dates)
        tokens = int(state.get("freeze_tokens") or 0)

        # Bridge gap: had activity (or freeze) day-before-yesterday, missed yesterday
        day_before_ok = day_before in activity_dates or day_before in freeze_set
        missed_yesterday = yesterday not in activity_dates and yesterday not in freeze_set

        applied = False
        if day_before_ok and missed_yesterday and tokens > 0:
            state["freeze_tokens"] = tokens - 1
            freeze_dates.append(yesterday)
            # keep last 60 freeze dates
            state["freeze_dates"] = freeze_dates[-60:]
            _append_ledger(
                state,
                delta=0,
                reason="streak_freeze_used",
                meta={"date": yesterday, "tokens_left": state["freeze_tokens"]},
            )
            _write_state(student_id, state)
            applied = True
            freeze_set.add(yesterday)
            tokens = int(state.get("freeze_tokens") or 0)

        streak = compute_streak_days(activity_dates, freeze_set)
        return {
            "applied": applied,
            "freeze_tokens": tokens,
            "freeze_dates": list(freeze_set),
            "streak_days": streak,
        }


def wallet_public(student_id: str) -> dict[str, Any]:
    """Lightweight wallet for home page chip (no side effects)."""
    with _lock_for(student_id):
        state = _read_state(student_id)
        day = _today()
        return {
            "enabled": bool(state.get("enabled", True)),
            "stars": int(state.get("stars") or 0),
            "level": int(state.get("level") or 1),
            "title": title_for_level(int(state.get("level") or 1)),
            "daily_stars_earned": _stars_earned_today(state, day),
            "daily_star_cap": int(state.get("daily_star_cap") or DEFAULT_DAILY_STAR_CAP),
            "chests": int(state.get("chests") or 0),
            "freeze_tokens": int(state.get("freeze_tokens") or 0),
            "freeze_dates": list(state.get("freeze_dates") or []),
        }


def _storage_subjects_for_student(student_id: str) -> list[str]:
    """Return subjects with an existing SQLite or legacy-log footprint."""
    from backend.subject_registry import is_known_subject

    subjects: set[str] = set()
    db_path = rules.LOG_ROOT.parent / "qld_tutor.db"
    if db_path.is_file():
        try:
            conn = connect_sqlite(f"file:{db_path}?mode=ro", uri=True)
            try:
                rows = conn.execute(
                    """
                    SELECT subject FROM attempts WHERE student_id = ?
                    UNION SELECT subject FROM topic_metadata WHERE student_id = ?
                    UNION SELECT subject FROM diagnostic_status WHERE student_id = ?
                    UNION SELECT subject FROM student_subject_metadata WHERE student_id = ?
                    """,
                    (student_id, student_id, student_id, student_id),
                ).fetchall()
            finally:
                conn.close()
            for row in rows:
                subject = str(row[0] or "")
                if subject != "mathematics" and is_known_subject(subject):
                    subjects.add(subject)
        except sqlite3.Error:
            logger.debug("Could not inspect subject footprints for %s", student_id, exc_info=True)

    return sorted(subjects)


def _local_date_from_ts(ts: str) -> str:
    if not ts:
        return ""
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return dt.astimezone().date().isoformat()
    except Exception:
        return str(ts)[:10]


def _global_daily_goal_for_student(student_id: str) -> int | None:
    """Read the canonical all-subject goal from profile metadata, if present."""
    db_path = rules.LOG_ROOT.parent / "qld_tutor.db"
    if not db_path.is_file():
        return None
    try:
        conn = connect_sqlite(f"file:{db_path}?mode=ro", uri=True)
        try:
            row = conn.execute(
                """
                SELECT metadata FROM student_subject_metadata
                WHERE student_id = ? AND subject = ?
                """,
                (student_id, rules.PROFILE_SUBJECT),
            ).fetchone()
        finally:
            conn.close()
        if not row:
            return None
        metadata = json.loads(row[0])
        settings = metadata.get("settings", {}) if isinstance(metadata, dict) else {}
        value = settings.get("daily_goal") if isinstance(settings, dict) else None
        return max(1, min(100, int(value))) if value is not None else None
    except (sqlite3.Error, json.JSONDecodeError, TypeError, ValueError):
        logger.debug("Could not read global daily goal for %s", student_id, exc_info=True)
        return None


def collect_cross_subject_stats(student_id: str) -> dict[str, Any]:
    """Aggregate all-subject habit totals and independent answer accuracy.

    Unique question keys are ``subject:question_id`` so the same id in math vs
    English does not collapse. A canonical profile-level daily goal wins; the
    largest legacy subject goal is retained only as a backward-compatible fallback.
    """
    from backend.rules import get_engine

    today_str = _today()
    today_attempts = 0
    today_correct = 0
    today_independent_attempts = 0
    today_independent_correct = 0
    all_dates: set[str] = set()
    today_keys: set[str] = set()
    today_independent_keys: set[str] = set()
    goals: list[int] = []
    global_goal = _global_daily_goal_for_student(student_id)
    subjects = _storage_subjects_for_student(student_id)

    for subject in subjects:
        try:
            engine = get_engine(student_id, subject)
            compact_reader = getattr(engine, "get_answer_activity_records", None)
            metadata_reader = getattr(engine, "get_extra_metadata", None)
            if not callable(compact_reader) or not callable(metadata_reader):
                continue
            activity_records = compact_reader()
            extra = metadata_reader()
            settings = extra.get("settings", {})
            # Current persistence stores settings at the top level of the
            # subject metadata, not necessarily under a nested key.
            if "daily_goal" in extra:
                settings = extra
        except Exception:
            continue

        if (activity_records or settings) and "daily_goal" in settings:
            try:
                goals.append(int(settings.get("daily_goal")))
            except (TypeError, ValueError):
                pass

        for attempt in activity_records:
            ts = attempt.get("timestamp", "")
            if not ts:
                continue
            local_d = _local_date_from_ts(str(ts))
            if local_d:
                all_dates.add(local_d)
            if local_d != today_str:
                continue
            qid = str(attempt.get("question_id") or "").strip()
            if not qid:
                continue
            key = f"{subject}:{qid}"
            if key not in today_keys:
                today_keys.add(key)
                today_attempts += 1
                if attempt.get("correct"):
                    today_correct += 1
            if is_independent_learning_attempt(attempt) and key not in today_independent_keys:
                today_independent_keys.add(key)
                today_independent_attempts += 1
                if attempt.get("correct"):
                    today_independent_correct += 1

    daily_goal = global_goal if global_goal is not None else (max(goals) if goals else 20)
    daily_goal = max(1, min(100, int(daily_goal)))

    freeze = apply_auto_streak_freeze(student_id, all_dates)
    return {
        "today_attempts": today_attempts,
        "today_correct": today_correct,
        "today_independent_attempts": today_independent_attempts,
        "today_independent_correct": today_independent_correct,
        "streak_days": int(freeze.get("streak_days") or 0),
        "daily_goal": daily_goal,
        "activity_dates": all_dates,
        "freeze_applied": bool(freeze.get("applied")),
        "freeze_tokens": int(freeze.get("freeze_tokens") or 0),
        "subjects_scanned": subjects,
    }


def _apply_xp(state: dict[str, Any], xp_gain: int) -> dict[str, int]:
    if xp_gain <= 0:
        return {"level": int(state.get("level") or 1), "xp": int(state.get("xp") or 0), "levels_gained": 0}
    xp = int(state.get("xp") or 0) + xp_gain
    level = max(1, int(state.get("level") or 1))
    gained = 0
    # Cap runaway loops
    for _ in range(50):
        need = xp_to_next_level(level)
        if xp < need:
            break
        xp -= need
        level += 1
        gained += 1
    state["xp"] = xp
    state["level"] = level
    return {"level": level, "xp": xp, "levels_gained": gained}


def _stars_earned_today(state: dict[str, Any], day: str) -> int:
    """Stars earned toward the daily cap today (practice/quest/chest only).

    Must NOT count redeem_refund / other wallet adjustments — those would
    inflate "earned today" and starve the rest of the day under the cap.
    Prefer ``stars_by_day`` when present (survives ledger truncation).
    """
    hist = state.get("stars_by_day") or {}
    hist_n = 0
    if isinstance(hist, dict) and day in hist:
        try:
            hist_n = max(0, int(hist.get(day) or 0))
        except (TypeError, ValueError):
            hist_n = 0

    ledger_n = 0
    for row in state.get("ledger") or []:
        if not isinstance(row, dict):
            continue
        if row.get("day") != day:
            continue
        if row.get("reason") not in _STARS_BY_DAY_EARN_REASONS:
            continue
        delta = int(row.get("delta") or 0)
        if delta > 0:
            ledger_n += delta
    # hist can outlive LEDGER_MAX; ledger covers pre-hist sessions
    return max(hist_n, ledger_n)


def _append_ledger(
    state: dict[str, Any],
    *,
    delta: int,
    reason: str,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    entry = {
        "id": uuid.uuid4().hex[:12],
        "delta": int(delta),
        "reason": reason,
        "meta": meta or {},
        "day": _today(),
        "at": _utc_now(),
    }
    ledger = list(state.get("ledger") or [])
    ledger.append(entry)
    state["ledger"] = ledger[-LEDGER_MAX:]
    state["stars"] = max(0, int(state.get("stars") or 0) + int(delta))
    if delta > 0:
        # 1 XP per star earned (level is prestige, not the spend currency)
        _apply_xp(state, int(delta))
        # Effort average for cash prize: marks/quests/chest loot only.
        # Exclude redeem_refund (would double-count after a rejected shop hold).
        if reason in _STARS_BY_DAY_EARN_REASONS:
            day_key = entry["day"]
            hist = dict(state.get("stars_by_day") or {})
            hist[day_key] = int(hist.get(day_key) or 0) + int(delta)
            keep = sorted(hist.keys())[-90:]
            state["stars_by_day"] = {d: hist[d] for d in keep if d in hist}
    return entry


def average_stars_last_n_days(state: dict[str, Any], n: int = STREAK_CASH_PRIZE_DAYS) -> float:
    """Mean stars *earned* per calendar day over the last n days (including today).

    Always divides by n (empty days count as 0). That matches “daily average over
    a full 28-day window” and intentionally penalises freeze/gap days with no earn.
    """
    n = max(1, int(n))
    hist = state.get("stars_by_day") or {}
    if not isinstance(hist, dict):
        hist = {}
    today = date.today()
    total = 0
    for i in range(n):
        d = (today - timedelta(days=i)).isoformat()
        total += int(hist.get(d) or 0)
    return total / float(n)


def cash_prize_eligible(state: dict[str, Any], streak_days: int) -> dict[str, Any]:
    """28-day streak + average ≥170⭐/day over last 28 days (once per student)."""
    avg = average_stars_last_n_days(state, STREAK_CASH_PRIZE_DAYS)
    milestones = state.get("chest_milestones") or {}
    # Only the current prize flag counts (legacy streak_60 no longer blocks).
    already = bool(milestones.get("streak_28_cash"))
    ok = (
        int(streak_days) >= STREAK_CASH_PRIZE_DAYS
        and avg + 1e-9 >= float(STREAK_CASH_PRIZE_AVG_STARS)
        and not already
    )
    return {
        "eligible": ok,
        "streak_days": int(streak_days),
        # Floor to 1 decimal so UI never shows 170.0 when still short of 170.
        "avg_stars": int(avg * 10) / 10.0,
        "need_streak": STREAK_CASH_PRIZE_DAYS,
        "need_avg": STREAK_CASH_PRIZE_AVG_STARS,
        "prize_dollars": STREAK_CASH_PRIZE_DOLLARS,
        "already_awarded": already,
    }


def _difficulty_weight(question: dict[str, Any] | None) -> float:
    if not isinstance(question, dict):
        return 1.0
    for key in ("difficulty", "complexity"):
        raw = str(question.get(key) or "").strip().lower()
        if raw in DIFFICULTY_WEIGHT:
            return DIFFICULTY_WEIGHT[raw]
    return 1.0


def _accuracy_multiplier(today_attempts: int, today_correct: int) -> float:
    if today_attempts <= 0:
        return 1.0
    acc = today_correct / today_attempts
    if acc < 0.4:
        return 0.85
    if acc >= 0.7:
        return 1.15
    return 1.0


def compute_mark_stars(
    *,
    is_correct: bool,
    difficulty_weight: float = 1.0,
    used_hint: bool = False,
    today_attempts: int = 0,
    today_correct: int = 0,
    qid_day_count_before: int = 0,
    review_source: str | None = None,
    used_show_answer: bool = False,
) -> int:
    """Stars for one scored attempt (before daily cap)."""
    # Saw the correct answer before submitting → no stars (anti-cheat for
    # Error Book Show Answer → Redo question exploit).
    if used_show_answer:
        return 0
    # Repeat decay: 1st full, 2nd–3rd *0.3, 4th+ zero
    if qid_day_count_before >= 3:
        return 0
    repeat_mult = 1.0 if qid_day_count_before == 0 else 0.3

    if review_source == "error_book" and is_correct:
        base = float(MARK_STARS_ERROR_BOOK)
    elif is_correct:
        base = float(MARK_STARS_CORRECT)
    else:
        base = float(MARK_STARS_WRONG)

    hint_mult = 0.7 if used_hint else 1.0
    # Neutral 1.0 when caller did not supply real day stats (avoids bogus mult).
    if today_attempts and today_attempts > 0:
        acc_mult = _accuracy_multiplier(today_attempts, today_correct)
    else:
        acc_mult = 1.0
    raw = base * float(difficulty_weight) * hint_mult * acc_mult * repeat_mult
    return max(0, int(round(raw)))


def award_for_mark(
    student_id: str,
    *,
    attempt_id: str | None,
    question_id: str,
    is_correct: bool,
    question: dict[str, Any] | None = None,
    used_hint: bool = False,
    review_source: str | None = None,
    today_attempts: int | None = None,
    today_correct: int | None = None,
    used_show_answer: bool = False,
    review_question_id: str | None = None,
    review_match: dict[str, Any] | None = None,
    review_closure_stage: str | None = None,
    strand: str | None = None,
    part_label: str | None = None,
) -> dict[str, Any] | None:
    """Award stars for a persisted mark, idempotent per attempt and part."""
    if not student_id or not question_id:
        return None
    normalized_part = str(part_label or '').strip().lower()
    reward_key = (
        f"{question_id}:part:{normalized_part}"
        if normalized_part
        else question_id
    )
    idem_key = f"mark:{attempt_id or ''}:{reward_key}"
    if not attempt_id:
        # Still award once per call using synthetic key with timestamp bucket — prefer attempt_id
        idem_key = f"mark:noid:{reward_key}:{_utc_now()[:16]}"

    with _lock_for(student_id):
        state = _read_state(student_id)
        if not state.get("enabled", True):
            return {"awarded": 0, "skipped": "quests_disabled"}

        idem = dict(state.get("idempotency") or {})
        if attempt_id and idem.get(idem_key):
            return {"awarded": 0, "skipped": "duplicate", "stars": state.get("stars"), "level": state.get("level")}

        day = _today()
        qid_days = dict(state.get("qid_day_counts") or {})
        day_map = dict(qid_days.get(day) or {})
        prior = int(day_map.get(reward_key) or 0)

        # Use real day accuracy only when the caller provided it. Do NOT fake it
        # from per-question prior (that made every first try look like 100% → 1.15×).
        if today_attempts is not None and today_correct is not None:
            t_att = max(0, int(today_attempts))
            t_cor = max(0, int(today_correct)) + (1 if is_correct else 0)
        else:
            t_att = 0
            t_cor = 0

        stars = compute_mark_stars(
            is_correct=bool(is_correct),
            difficulty_weight=_difficulty_weight(question),
            used_hint=used_hint,
            today_attempts=t_att,
            today_correct=t_cor,
            qid_day_count_before=prior,
            review_source=review_source,
            used_show_answer=used_show_answer,
        )

        earned_today = _stars_earned_today(state, day)
        cap = int(state.get("daily_star_cap") or DEFAULT_DAILY_STAR_CAP)
        room = max(0, cap - earned_today)
        awarded = min(stars, room)

        day_map[reward_key] = prior + 1
        qid_days[day] = day_map
        # Keep only recent days
        keep_days = sorted(qid_days.keys())[-14:]
        state["qid_day_counts"] = {d: qid_days[d] for d in keep_days if d in qid_days}

        if awarded > 0:
            _append_ledger(
                state,
                delta=awarded,
                reason="mark",
                meta={
                    "question_id": question_id,
                    "part_label": normalized_part or None,
                    "attempt_id": attempt_id,
                    "is_correct": bool(is_correct),
                    "raw_stars": stars,
                    "capped": awarded < stars,
                    "review_source": review_source,
                },
            )

        # Track one transfer-safe success per unique source mistake. Merely
        # retrying the original item, an ineligible variation, or an answer
        # revealed before submission must not advance the Error Book quest.
        if (
            is_correct
            and review_source == "error_book"
            and not used_show_answer
            and review_question_id
            and isinstance(review_match, dict)
            and review_match.get("eligible") is True
            and review_closure_stage in {
                "needs_understanding", "needs_retry", "needs_transfer"
            }
        ):
            efix = dict(state.get("error_fix_day") or {})
            sources_by_day = dict(state.get("error_fix_sources_by_day") or {})
            raw_sources = sources_by_day.get(day)
            sources = {
                str(source_id)
                for source_id in raw_sources
                if source_id
            } if isinstance(raw_sources, list) else set()
            source_id = str(review_question_id)
            if source_id not in sources:
                sources.add(source_id)
                efix[day] = int(efix.get(day) or 0) + 1
            sources_by_day[day] = sorted(sources)
            # Keep only recent days while preserving legacy integer progress.
            keep = sorted(set(efix) | set(sources_by_day))[-14:]
            state["error_fix_day"] = {d: efix[d] for d in keep if d in efix}
            state["error_fix_sources_by_day"] = {
                d: sources_by_day[d] for d in keep if d in sources_by_day
            }

        # Track distinct strands for the interleave quest
        if is_correct and strand:
            strands = dict(state.get("strands_by_day") or {})
            day_strands = set(strands.get(day) or [])
            day_strands.add(str(strand))
            strands[day] = sorted(day_strands)
            keep = sorted(strands.keys())[-14:]
            state["strands_by_day"] = {d: strands[d] for d in keep if d in strands}

        if attempt_id:
            idem[idem_key] = True
            # trim idempotency
            if len(idem) > IDEM_MAX:
                keys = list(idem.keys())[-(IDEM_MAX // 2) :]
                idem = {k: True for k in keys}
            state["idempotency"] = idem

        _write_state(student_id, state)
        return {
            "awarded": awarded,
            "raw_stars": stars,
            "stars": int(state.get("stars") or 0),
            "xp": int(state.get("xp") or 0),
            "level": int(state.get("level") or 1),
            "title": title_for_level(int(state.get("level") or 1)),
            "daily_earned": _stars_earned_today(state, day),
            "daily_cap": cap,
        }


def _quest_definitions() -> list[dict[str, Any]]:
    return [
        {
            "id": "daily_goal",
            "title": "Hit today's practice goal",
            "emoji": "🎯",
            "reward_stars": QUEST_REWARD_DAILY_GOAL,
            "description": "Complete your daily question goal.",
        },
        {
            "id": "accuracy_ok",
            "title": "Solid accuracy",
            "emoji": "✨",
            "reward_stars": QUEST_REWARD_ACCURACY,
            "description": (
                f"At least {QUEST_ACCURACY_MIN_ATTEMPTS} attempts with "
                f"{int(QUEST_ACCURACY_MIN_RATE * 100)}%+ correct today."
            ),
        },
        {
            "id": "streak_tick",
            "title": "Keep the streak alive",
            "emoji": "🔥",
            # Placeholder — build_overview overwrites with streak-scaled value
            "reward_stars": STREAK_REWARD_BASE,
            "description": "Practice at least once today. Reward ramps later in the streak (resets every 2 weeks).",
        },
        {
            "id": "error_fix_5",
            "title": "Error Book warrior",
            "emoji": "📋",
            "reward_stars": QUEST_REWARD_ERROR_FIX,
            "description": "Complete one transfer-safe Error Book question today.",
        },
        {
            "id": "interleave_3",
            "title": "Interleaver",
            "emoji": "🔀",
            "reward_stars": QUEST_REWARD_INTERLEAVE,
            "description": f"Answer questions from {QUEST_INTERLEAVE_TARGET}+ different strands today.",
        },
    ]


def _spins_used_today(state: dict[str, Any]) -> int:
    spins_by_day = state.get("spins_by_day") or {}
    if not isinstance(spins_by_day, dict):
        return 0
    try:
        return max(0, int(spins_by_day.get(_today()) or 0))
    except (TypeError, ValueError):
        return 0


def spin_status(state: dict[str, Any]) -> dict[str, Any]:
    """Return the student-visible wheel allowance and authored odds."""
    enabled = bool(state.get("enabled", True)) and bool(state.get("spin_enabled", True))
    spins_used = min(SPIN_MAX_PER_DAY, _spins_used_today(state))
    spins_remaining = max(0, SPIN_MAX_PER_DAY - spins_used)
    stars = max(0, int(state.get("stars") or 0))
    return {
        "enabled": enabled,
        "cost_stars": SPIN_COST_STARS,
        "max_per_day": SPIN_MAX_PER_DAY,
        "spins_used": spins_used,
        "spins_remaining": spins_remaining,
        "can_spin": enabled and spins_remaining > 0 and stars >= SPIN_COST_STARS,
        "prizes": [
            {"chance": chance, "stars": stars, "label": label, "emoji": emoji}
            for chance, stars, label, emoji in SPIN_PRIZES
        ],
    }


def _roll_spin_prize(roll: float | None = None) -> dict[str, Any]:
    """Map a percentage roll in ``[0, 100)`` to the authored prize table."""
    value = random.random() * 100.0 if roll is None else float(roll)
    cumulative = 0.0
    for index, (chance, stars, label, emoji) in enumerate(SPIN_PRIZES):
        cumulative += chance
        if value < cumulative or index == len(SPIN_PRIZES) - 1:
            return {
                "index": index,
                "chance": chance,
                "stars": stars,
                "label": label,
                "emoji": emoji,
                "won": stars > 0,
            }
    raise RuntimeError("Spin prize table is empty")


def spin_wheel(student_id: str, *, roll: float | None = None) -> dict[str, Any]:
    """Charge one spin and pay its server-selected prize atomically."""
    with _lock_for(student_id):
        state = _read_state(student_id)
        if not state.get("enabled", True):
            return {"ok": False, "error": "quests_disabled"}
        if not state.get("spin_enabled", True):
            return {"ok": False, "error": "spin_disabled"}

        spins_used = _spins_used_today(state)
        if spins_used >= SPIN_MAX_PER_DAY:
            return {
                "ok": False,
                "error": "spin_daily_limit",
                "spins_remaining": 0,
            }

        stars_before = int(state.get("stars") or 0)
        if stars_before < SPIN_COST_STARS:
            return {
                "ok": False,
                "error": "insufficient_stars",
                "cost_stars": SPIN_COST_STARS,
                "stars": stars_before,
            }

        prize = _roll_spin_prize(roll)
        _append_ledger(
            state,
            delta=-SPIN_COST_STARS,
            reason="spin_cost",
            meta={"prize_index": prize["index"]},
        )
        if int(prize["stars"]) > 0:
            _append_ledger(
                state,
                delta=int(prize["stars"]),
                reason="spin_win",
                meta={"prize_index": prize["index"], "label": prize["label"]},
            )

        spins_used += 1
        spins_by_day = dict(state.get("spins_by_day") or {})
        spins_by_day[_today()] = spins_used
        keep_days = sorted(spins_by_day)[-35:]
        state["spins_by_day"] = {day: spins_by_day[day] for day in keep_days}
        _write_state(student_id, state)

        return {
            "ok": True,
            "prize": prize,
            "cost_stars": SPIN_COST_STARS,
            "net_stars": int(prize["stars"]) - SPIN_COST_STARS,
            "stars": int(state.get("stars") or 0),
            "level": int(state.get("level") or 1),
            "spins_used": spins_used,
            "spins_remaining": max(0, SPIN_MAX_PER_DAY - spins_used),
            "max_per_day": SPIN_MAX_PER_DAY,
        }


def build_overview(
    student_id: str,
    *,
    streak_days: int = 0,
    today_attempts: int = 0,
    today_correct: int = 0,
    today_independent_attempts: int | None = None,
    today_independent_correct: int | None = None,
    daily_goal: int = 20,
    activity_dates: set[str] | None = None,
) -> dict[str, Any]:
    # Auto-bridge a missed day with a freeze token when possible
    freeze_info: dict[str, Any] = {}
    if activity_dates is not None:
        freeze_info = apply_auto_streak_freeze(student_id, set(activity_dates))
        streak_days = int(freeze_info.get("streak_days") or streak_days)

    with _lock_for(student_id):
        state = _read_state(student_id)
        # Recompute streak with freezes if activity provided
        if activity_dates is not None:
            streak_days = compute_streak_days(
                activity_dates, state.get("freeze_dates") or []
            )
        # Grant streak chests on overview if milestones hit
        milestones = dict(state.get("chest_milestones") or {})
        changed = False
        if state.get("chests_enabled", True) and streak_days >= 3:
            # Regular chests at these streak lengths (once each)
            for m in (3, 6, 9, 12, 15, 18, 21, 30):
                mk = f"streak_{m}"
                if streak_days >= m and not milestones.get(mk):
                    milestones[mk] = True
                    state["chests"] = int(state.get("chests") or 0) + 1
                    _append_ledger(
                        state,
                        delta=0,
                        reason="chest_grant",
                        meta={"milestone": mk, "chests": 1},
                    )
                    changed = True
            if streak_days >= 7 and not milestones.get("week_7"):
                milestones["week_7"] = True
                state["chests"] = int(state.get("chests") or 0) + 1
                changed = True
            state["chest_milestones"] = milestones

        # Cash grand prize is independent of random-chest toggles, but still
        # requires chests_enabled so open_chest remains the fulfilment path.
        if state.get("chests_enabled", True):
            prize_info = cash_prize_eligible(state, streak_days)
            if prize_info["eligible"]:
                milestones = dict(state.get("chest_milestones") or {})
                milestones["streak_28_cash"] = True
                state["chest_milestones"] = milestones
                state["chests"] = int(state.get("chests") or 0) + 1
                state["grand_prize_chests"] = int(state.get("grand_prize_chests") or 0) + 1
                _append_ledger(
                    state,
                    delta=0,
                    reason="chest_grant",
                    meta={
                        "milestone": "streak_28_cash",
                        "chests": 1,
                        "grand_prize": True,
                        "prize_cents": STREAK_CASH_PRIZE_CENTS,
                        "avg_stars": prize_info["avg_stars"],
                        "streak_days": streak_days,
                    },
                )
                changed = True

        if changed:
            _write_state(student_id, state)

        day = _today()
        claimed = set((state.get("quests_claimed") or {}).get(day) or [])
        prize_status = cash_prize_eligible(state, streak_days)

        # Progress for quests
        accuracy_attempts = (
            today_attempts
            if today_independent_attempts is None
            else max(0, int(today_independent_attempts))
        )
        accuracy_correct = (
            today_correct
            if today_independent_correct is None
            else max(0, int(today_independent_correct))
        )
        acc = (accuracy_correct / accuracy_attempts) if accuracy_attempts else 0.0
        practiced_today = today_attempts >= 1
        reward_streak = projected_streak_for_reward(streak_days, practiced_today)
        cycle_day = streak_cycle_day(reward_streak)
        streak_reward = streak_tick_reward_stars(reward_streak)

        quests_out = []
        for q in _quest_definitions():
            qid = q["id"]
            row = dict(q)
            if qid == "daily_goal":
                progress = min(1.0, today_attempts / max(1, daily_goal))
                complete = today_attempts >= daily_goal
            elif qid == "accuracy_ok":
                min_att = QUEST_ACCURACY_MIN_ATTEMPTS
                min_acc = QUEST_ACCURACY_MIN_RATE
                progress = min(1.0, accuracy_attempts / float(min_att)) * (
                    1.0 if acc >= min_acc else (acc / min_acc if accuracy_attempts else 0.0)
                )
                complete = accuracy_attempts >= min_att and acc >= min_acc
            elif qid == "streak_tick":
                progress = 1.0 if practiced_today else 0.0
                complete = practiced_today
                row["reward_stars"] = streak_reward
                row["description"] = (
                    f"Practice at least once today. "
                    f"Cycle day {cycle_day}/{STREAK_REWARD_CYCLE_DAYS} "
                    f"(+{streak_reward}⭐ · max {streak_tick_reward_max()}⭐ · resets every 2 weeks)."
                )
                row["streak_cycle_day"] = cycle_day
                row["streak_cycle_len"] = STREAK_REWARD_CYCLE_DAYS
            elif qid == "error_fix_5":
                efix_n = int((state.get("error_fix_day") or {}).get(day) or 0)
                target = QUEST_ERROR_FIX_TARGET
                progress = min(1.0, efix_n / float(target))
                complete = efix_n >= target
            elif qid == "interleave_3":
                strands_today = state.get("strands_by_day") or {}
                strand_count = len(strands_today.get(day) or [])
                target = QUEST_INTERLEAVE_TARGET
                progress = min(1.0, strand_count / float(target))
                complete = strand_count >= target
            else:
                progress = 0.0
                complete = False
            quests_out.append({
                **row,
                "progress": round(min(1.0, progress), 3),
                "complete": complete,
                "claimed": qid in claimed,
                "claimable": complete and qid not in claimed,
            })

        level = int(state.get("level") or 1)
        xp = int(state.get("xp") or 0)
        need = xp_to_next_level(level)
        catalog = [
            c for c in (state.get("catalog") or DEFAULT_CATALOG)
            if isinstance(c, dict) and c.get("enabled", True)
        ]
        catalog = sorted(catalog, key=lambda c: int(c.get("sort") or 100))

        pending = [
            r for r in (state.get("redemptions") or [])
            if isinstance(r, dict) and r.get("status") == "pending"
        ]

        return {
            "enabled": bool(state.get("enabled", True)),
            "stars": int(state.get("stars") or 0),
            "xp": xp,
            "level": level,
            "title": title_for_level(level),
            "xp_to_next": need,
            "xp_progress": round(min(1.0, xp / need), 3) if need else 1.0,
            "freeze_tokens": int(state.get("freeze_tokens") or 0),
            "chests": int(state.get("chests") or 0),
            "grand_prize_chests": int(state.get("grand_prize_chests") or 0),
            "cash_prize": {
                "need_streak": STREAK_CASH_PRIZE_DAYS,
                "need_avg": STREAK_CASH_PRIZE_AVG_STARS,
                "prize_dollars": STREAK_CASH_PRIZE_DOLLARS,
                "streak_days": int(streak_days),
                "avg_stars": prize_status["avg_stars"],
                "eligible": bool(prize_status["eligible"]),
                "already_awarded": bool(prize_status["already_awarded"]),
                "progress_streak": min(1.0, int(streak_days) / float(STREAK_CASH_PRIZE_DAYS)),
                "progress_avg": min(
                    1.0,
                    float(prize_status["avg_stars"]) / float(STREAK_CASH_PRIZE_AVG_STARS),
                ),
            },
            "chests_enabled": bool(state.get("chests_enabled", True)),
            "shop_enabled": bool(state.get("shop_enabled", True)),
            "daily_star_cap": int(state.get("daily_star_cap") or DEFAULT_DAILY_STAR_CAP),
            "daily_stars_earned": _stars_earned_today(state, day),
            "streak_days": streak_days,
            "streak_reward_cycle_day": cycle_day,
            "streak_reward_cycle_days": STREAK_REWARD_CYCLE_DAYS,
            "streak_reward_stars": streak_reward,
            "streak_reward_max": streak_tick_reward_max(),
            "freeze_applied_today": bool(freeze_info.get("applied")),
            "today_attempts": today_attempts,
            "today_correct": today_correct,
            "today_independent_attempts": accuracy_attempts,
            "today_independent_correct": accuracy_correct,
            "daily_goal": daily_goal,
            "quests": quests_out,  # daily board (goal, accuracy, streak, error-book)
            "catalog": catalog,
            "pending_redemptions": len(pending),
            "ledger": list(reversed(state.get("ledger") or []))[:20],
            "spin": spin_status(state),
            "currency_name": "Stars",
            "currency_emoji": "⭐",
        }


def claim_quest(student_id: str, quest_id: str, *, overview_ctx: dict[str, Any]) -> dict[str, Any]:
    """Claim a completed daily quest reward."""
    quest_map = {q["id"]: q for q in _quest_definitions()}
    if quest_id not in quest_map:
        return {"ok": False, "error": "unknown_quest"}

    with _lock_for(student_id):
        state = _read_state(student_id)
        if not state.get("enabled", True):
            return {"ok": False, "error": "quests_disabled"}
        day = _today()
        claimed_map = dict(state.get("quests_claimed") or {})
        day_claimed = list(claimed_map.get(day) or [])
        if quest_id in day_claimed:
            return {"ok": False, "error": "already_claimed", "stars": state.get("stars")}

        # Re-check completion from overview_ctx
        quests = {q["id"]: q for q in overview_ctx.get("quests") or []}
        qinfo = quests.get(quest_id) or {}
        if not qinfo.get("claimable") and not qinfo.get("complete"):
            return {"ok": False, "error": "not_complete"}

        reward = int(quest_map[quest_id]["reward_stars"])
        if quest_id == "streak_tick":
            # Server-side scale from streak length (ignore client-spoofed reward_stars)
            sd = int(overview_ctx.get("streak_days") or 0)
            practiced = int(overview_ctx.get("today_attempts") or 0) >= 1
            reward = streak_tick_reward_stars(projected_streak_for_reward(sd, practiced))
        earned = _stars_earned_today(state, day)
        cap = int(state.get("daily_star_cap") or DEFAULT_DAILY_STAR_CAP)
        awarded = min(reward, max(0, cap - earned))
        if awarded > 0:
            meta: dict[str, Any] = {
                "quest_id": quest_id,
                "raw": reward,
                "capped": awarded < reward,
            }
            if quest_id == "streak_tick":
                meta["streak_days"] = int(overview_ctx.get("streak_days") or 0)
                meta["cycle_day"] = streak_cycle_day(
                    projected_streak_for_reward(
                        int(overview_ctx.get("streak_days") or 0),
                        int(overview_ctx.get("today_attempts") or 0) >= 1,
                    )
                )
            _append_ledger(
                state,
                delta=awarded,
                reason="quest_claim",
                meta=meta,
            )
        day_claimed.append(quest_id)
        claimed_map[day] = day_claimed
        keep_claim_days = sorted(claimed_map)[-90:]
        state["quests_claimed"] = {
            claim_day: claimed_map[claim_day] for claim_day in keep_claim_days
        }
        _write_state(student_id, state)
        return {
            "ok": True,
            "awarded": awarded,
            "stars": int(state.get("stars") or 0),
            "level": int(state.get("level") or 1),
            "xp": int(state.get("xp") or 0),
        }


def open_chest(student_id: str) -> dict[str, Any]:
    with _lock_for(student_id):
        state = _read_state(student_id)
        if not state.get("enabled", True):
            return {"ok": False, "error": "quests_disabled"}
        if not state.get("chests_enabled", True):
            return {"ok": False, "error": "chests_disabled"}
        chests = int(state.get("chests") or 0)
        grand = int(state.get("grand_prize_chests") or 0)
        # Grand prize can still open if counters desynced (grand>0 but chests==0)
        if chests < 1 and grand < 1:
            return {"ok": False, "error": "no_chests"}
        if chests > 0:
            state["chests"] = chests - 1

        if grand > 0:
            # Prefer cash grand prize: real money for parent to pay — zero stars
            state["grand_prize_chests"] = grand - 1
            cents = STREAK_CASH_PRIZE_CENTS
            dollars = cents / 100.0
            dollar_label = f"${dollars:g}" if cents % 100 == 0 else f"${dollars:.2f}"
            red = {
                "id": uuid.uuid4().hex[:12],
                "catalog_id": "streak_28_cash",
                "title": f"28-day high-effort cash prize ({dollar_label})",
                "emoji": "💵",
                "cost_stars": 0,
                "category": "cash",
                "status": "pending",
                "created_at": _utc_now(),
                "cash_cents": cents,
                "source": "streak_28_cash_prize",
                "description": (
                    f"{STREAK_CASH_PRIZE_DAYS}-day streak with ≥{STREAK_CASH_PRIZE_AVG_STARS}⭐/day avg "
                    f"— pay {dollar_label} pocket money (no stars)."
                ),
            }
            reds = list(state.get("redemptions") or [])
            reds.append(red)
            state["redemptions"] = reds[-100:]
            loot = {
                "type": "cash_grand_prize",
                "amount": cents,
                "amount_cents": cents,
                "cash_label": dollar_label,
                "label": (
                    f"{STREAK_CASH_PRIZE_DAYS}-day cash prize ({dollar_label}) "
                    f"— waiting for parent"
                ),
                "grand_prize": True,
                "redemption_id": red["id"],
            }
            _append_ledger(state, delta=0, reason="chest_open", meta=loot)
        else:
            # Chest EV ~20⭐ — bonus, not a second shop wallet. Star payouts
            # share the normal daily earn cap; freeze cards are inventory and
            # therefore remain available even when the star cap is full.
            roll = random.random()
            star_delta = 0
            if roll < 0.50:
                star_delta = random.randint(10, 18)
                loot = {"type": "stars", "amount": star_delta, "label": "Small star pack"}
            elif roll < 0.75:
                star_delta = random.randint(22, 36)
                loot = {"type": "stars", "amount": star_delta, "label": "Medium star pack"}
            elif roll < 0.88:
                state["freeze_tokens"] = int(state.get("freeze_tokens") or 0) + 1
                loot = {"type": "freeze_token", "amount": 1, "label": "Streak freeze card"}
            elif roll < 0.96:
                star_delta = 8
                loot = {"type": "stars", "amount": star_delta, "label": "8-star bonus"}
            else:
                star_delta = 15
                loot = {"type": "stars", "amount": star_delta, "label": "15-star bonus"}

            if star_delta > 0:
                earned = _stars_earned_today(state, _today())
                cap = int(state.get("daily_star_cap") or DEFAULT_DAILY_STAR_CAP)
                awarded = min(star_delta, max(0, cap - earned))
                if awarded != star_delta:
                    loot["raw_amount"] = star_delta
                    loot["amount"] = awarded
                    loot["capped"] = True
                _append_ledger(state, delta=awarded, reason="chest_open", meta=loot)
            else:
                _append_ledger(state, delta=0, reason="chest_open", meta=loot)

        _write_state(student_id, state)
        return {
            "ok": True,
            "loot": loot,
            "stars": int(state.get("stars") or 0),
            "chests": int(state.get("chests") or 0),
            "grand_prize_chests": int(state.get("grand_prize_chests") or 0),
            "freeze_tokens": int(state.get("freeze_tokens") or 0),
            "level": int(state.get("level") or 1),
        }


def redeem(
    student_id: str,
    catalog_id: str,
    quantity: int = 1,
) -> dict[str, Any]:
    """Pre-deduct stars and create pending redemption (supports multi-qty)."""
    try:
        qty = int(quantity)
    except (TypeError, ValueError):
        qty = 1
    qty = max(1, min(20, qty))  # hard cap 20 per request

    with _lock_for(student_id):
        state = _read_state(student_id)
        if not state.get("enabled", True):
            return {"ok": False, "error": "quests_disabled"}
        if not state.get("shop_enabled", True):
            return {"ok": False, "error": "shop_disabled"}
        catalog = [c for c in (state.get("catalog") or []) if isinstance(c, dict)]
        item = next((c for c in catalog if c.get("id") == catalog_id and c.get("enabled", True)), None)
        if not item:
            return {"ok": False, "error": "item_not_found"}
        unit_cost = int(item.get("cost_stars") or 0)
        stars = int(state.get("stars") or 0)
        if unit_cost <= 0:
            return {"ok": False, "error": "invalid_cost"}
        total_cost = unit_cost * qty
        if stars < total_cost:
            return {
                "ok": False,
                "error": "insufficient_stars",
                "stars": stars,
                "cost": total_cost,
                "quantity": qty,
                "unit_cost": unit_cost,
            }

        stock = item.get("stock")
        if stock is not None:
            stock_n = int(stock)
            if stock_n <= 0:
                return {"ok": False, "error": "out_of_stock"}
            if stock_n < qty:
                return {
                    "ok": False,
                    "error": "insufficient_stock",
                    "stock": stock_n,
                    "quantity": qty,
                }

        # Pre-deduct full multi-qty total
        _append_ledger(
            state,
            delta=-total_cost,
            reason="redeem_hold",
            meta={
                "catalog_id": catalog_id,
                "title": item.get("title"),
                "quantity": qty,
                "unit_cost": unit_cost,
            },
        )
        if stock is not None:
            item["stock"] = int(stock) - qty
            for i, c in enumerate(state["catalog"]):
                if c.get("id") == catalog_id:
                    state["catalog"][i] = item
                    break

        title = str(item.get("title") or "Reward")
        if qty > 1:
            title = f"{title} ×{qty}"

        # Instant digital items (no parent fulfilment needed)
        if catalog_id == "streak_freeze":
            state["freeze_tokens"] = int(state.get("freeze_tokens") or 0) + qty
            red = {
                "id": uuid.uuid4().hex[:12],
                "catalog_id": catalog_id,
                "title": title,
                "emoji": item.get("emoji"),
                "cost_stars": total_cost,
                "unit_cost": unit_cost,
                "quantity": qty,
                "status": "approved",
                "created_at": _utc_now(),
                "resolved_at": _utc_now(),
                "auto": True,
            }
            reds = list(state.get("redemptions") or [])
            reds.append(red)
            state["redemptions"] = reds[-100:]
            _write_state(student_id, state)
            return {
                "ok": True,
                "redemption": red,
                "stars": int(state.get("stars") or 0),
                "auto_approved": True,
                "quantity": qty,
            }

        red = {
            "id": uuid.uuid4().hex[:12],
            "catalog_id": catalog_id,
            "title": title,
            "emoji": item.get("emoji"),
            "cost_stars": total_cost,
            "unit_cost": unit_cost,
            "quantity": qty,
            "status": "pending",
            "created_at": _utc_now(),
        }
        reds = list(state.get("redemptions") or [])
        reds.append(red)
        state["redemptions"] = reds[-100:]
        _write_state(student_id, state)
        return {
            "ok": True,
            "redemption": red,
            "stars": int(state.get("stars") or 0),
            "quantity": qty,
        }


# ---------------------------------------------------------------------------
# Parent admin
# ---------------------------------------------------------------------------


def parent_snapshot(student_id: str) -> dict[str, Any]:
    with _lock_for(student_id):
        state = _read_state(student_id)
        reds = list(state.get("redemptions") or [])
        pending = [r for r in reds if isinstance(r, dict) and r.get("status") == "pending"]
        return {
            "student_id": student_id,
            "enabled": bool(state.get("enabled", True)),
            "shop_enabled": bool(state.get("shop_enabled", True)),
            "chests_enabled": bool(state.get("chests_enabled", True)),
            "spin_enabled": bool(state.get("spin_enabled", True)),
            "daily_star_cap": int(state.get("daily_star_cap") or DEFAULT_DAILY_STAR_CAP),
            "stars": int(state.get("stars") or 0),
            "level": int(state.get("level") or 1),
            "title": title_for_level(int(state.get("level") or 1)),
            "xp": int(state.get("xp") or 0),
            "chests": int(state.get("chests") or 0),
            "freeze_tokens": int(state.get("freeze_tokens") or 0),
            "catalog": list(state.get("catalog") or DEFAULT_CATALOG),
            "pending": list(reversed(pending)),
            "recent_redemptions": list(reversed(reds))[:30],
            "ledger": list(reversed(state.get("ledger") or []))[:30],
        }


def parent_update_settings(
    student_id: str,
    *,
    enabled: bool | None = None,
    shop_enabled: bool | None = None,
    chests_enabled: bool | None = None,
    spin_enabled: bool | None = None,
    daily_star_cap: int | None = None,
) -> dict[str, Any]:
    with _lock_for(student_id):
        state = _read_state(student_id)
        if enabled is not None:
            state["enabled"] = bool(enabled)
        if shop_enabled is not None:
            state["shop_enabled"] = bool(shop_enabled)
        if chests_enabled is not None:
            state["chests_enabled"] = bool(chests_enabled)
        if spin_enabled is not None:
            state["spin_enabled"] = bool(spin_enabled)
        if daily_star_cap is not None:
            cap = int(daily_star_cap)
            if cap < 20 or cap > 500:
                return {"ok": False, "error": "invalid_cap"}
            state["daily_star_cap"] = cap
        _write_state(student_id, state)
        return {"ok": True, **parent_snapshot(student_id)}


def parent_save_catalog_item(student_id: str, item: dict[str, Any]) -> dict[str, Any]:
    with _lock_for(student_id):
        state = _read_state(student_id)
        catalog = [c for c in (state.get("catalog") or []) if isinstance(c, dict)]
        cid = str(item.get("id") or "").strip() or uuid.uuid4().hex[:10]
        row = {
            "id": cid,
            "title": str(item.get("title") or "Reward").strip()[:80],
            "emoji": str(item.get("emoji") or "🎁")[:4],
            "cost_stars": max(1, int(item.get("cost_stars") or 10)),
            "category": str(item.get("category") or "privilege")[:32],
            "stock": item.get("stock"),
            "enabled": bool(item.get("enabled", True)),
            "sort": int(item.get("sort") or 100),
            "description": str(item.get("description") or "")[:240],
            # Parent edits stick; do not overwrite with DEFAULT_CATALOG on load.
            "parent_customized": True,
        }
        if row["stock"] is not None:
            try:
                row["stock"] = int(row["stock"])
            except (TypeError, ValueError):
                row["stock"] = None
        found = False
        for i, c in enumerate(catalog):
            if c.get("id") == cid:
                catalog[i] = row
                found = True
                break
        if not found:
            catalog.append(row)
        state["catalog"] = catalog
        _write_state(student_id, state)
        return {"ok": True, "item": row, "catalog": catalog}


def parent_delete_catalog_item(student_id: str, catalog_id: str) -> dict[str, Any]:
    with _lock_for(student_id):
        state = _read_state(student_id)
        catalog = [c for c in (state.get("catalog") or []) if isinstance(c, dict) and c.get("id") != catalog_id]
        state["catalog"] = catalog
        _write_state(student_id, state)
        return {"ok": True, "catalog": catalog}


def parent_resolve_redemption(
    student_id: str,
    redemption_id: str,
    *,
    approve: bool,
    parent_note: str = "",
) -> dict[str, Any]:
    with _lock_for(student_id):
        state = _read_state(student_id)
        reds = list(state.get("redemptions") or [])
        target = None
        for r in reds:
            if isinstance(r, dict) and r.get("id") == redemption_id:
                target = r
                break
        if not target:
            return {"ok": False, "error": "not_found"}
        if target.get("status") != "pending":
            return {"ok": False, "error": "not_pending", "status": target.get("status")}

        if approve:
            target["status"] = "approved"
            target["resolved_at"] = _utc_now()
            target["parent_note"] = parent_note[:200]
            _append_ledger(
                state,
                delta=0,
                reason="redeem_approved",
                meta={"redemption_id": redemption_id, "catalog_id": target.get("catalog_id")},
            )
        else:
            # Refund pre-deducted stars
            cost = int(target.get("cost_stars") or 0)
            target["status"] = "rejected"
            target["resolved_at"] = _utc_now()
            target["parent_note"] = parent_note[:200]
            if cost > 0:
                _append_ledger(
                    state,
                    delta=cost,
                    reason="redeem_refund",
                    meta={"redemption_id": redemption_id, "catalog_id": target.get("catalog_id")},
                )
            # Restore the full held quantity for stock-limited rewards.
            cid = target.get("catalog_id")
            try:
                restore_quantity = max(1, int(target.get("quantity") or 1))
            except (TypeError, ValueError):
                restore_quantity = 1
            for i, c in enumerate(state.get("catalog") or []):
                if isinstance(c, dict) and c.get("id") == cid and c.get("stock") is not None:
                    try:
                        c["stock"] = int(c["stock"]) + restore_quantity
                    except (TypeError, ValueError):
                        pass
                    state["catalog"][i] = c
                    break

        state["redemptions"] = reds
        _write_state(student_id, state)
        return {
            "ok": True,
            "redemption": target,
            "stars": int(state.get("stars") or 0),
        }
