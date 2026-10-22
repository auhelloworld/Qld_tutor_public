"""Unit tests for quests / stars economy."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.services import quests as quests_svc


@pytest.fixture
def student_id(tmp_path, monkeypatch):
    from backend._testing import reset_engine_factory_cache

    reset_engine_factory_cache()
    monkeypatch.setattr(quests_svc.rules, "LOG_ROOT", tmp_path / "logs")
    yield "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
    reset_engine_factory_cache()


def test_cross_subject_stats_merges_logs(student_id, tmp_path, monkeypatch):
    """Attempts from math + english both count toward today_attempts."""
    from datetime import datetime, timezone
    from backend.rules import get_engine

    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    def _seed(subject: str, qid: str, correct: bool, goal: int):
        get_engine(student_id, subject).save_log({
            "student_id": student_id,
            "settings": {"daily_goal": goal},
            "topics": {
                "t1": {
                    "attempts": [{
                        "attempt_type": "answer",
                        "question_id": qid,
                        "correct": correct,
                        "support_level": 0,
                        "timestamp": now,
                    }]
                }
            },
        })

    _seed("math", "mq1", True, 10)
    _seed("english", "eq1", False, 5)

    stats = quests_svc.collect_cross_subject_stats(student_id)
    assert stats["today_attempts"] == 2
    assert stats["today_correct"] == 1
    assert stats["daily_goal"] == 10  # max of 10 and 5
    assert stats["subjects_scanned"] == ["english", "math"]
    assert len(stats["activity_dates"]) >= 1


def test_streak_tick_reward_scales_and_resets_biweekly():
    """Keep-streak reward ramps superlinearly, then wraps every 14 days."""
    base = quests_svc.STREAK_REWARD_BASE
    cycle = quests_svc.STREAK_REWARD_CYCLE_DAYS
    div = quests_svc.STREAK_REWARD_DIV

    assert quests_svc.streak_cycle_day(0) == 0
    assert quests_svc.streak_cycle_day(1) == 1
    assert quests_svc.streak_cycle_day(7) == 7
    assert quests_svc.streak_cycle_day(14) == 14
    assert quests_svc.streak_cycle_day(15) == 1  # biweekly reset
    assert quests_svc.streak_cycle_day(16) == 2
    assert quests_svc.streak_cycle_day(28) == 14

    rewards = [quests_svc.streak_tick_reward_stars(d) for d in range(1, cycle + 1)]
    assert rewards[0] == base
    assert rewards[1] == base  # day 2 still modest
    assert rewards[6] == base + (7 * 7) // div - 1  # day 7
    assert rewards[13] == base + (14 * 14) // div - 1  # day 14 peak
    assert rewards[13] == quests_svc.streak_tick_reward_max()
    assert quests_svc.streak_tick_reward_stars(15) == base  # wraps
    assert quests_svc.streak_tick_reward_stars(15) == rewards[0]

    # Superlinear: late growth > early growth (freeze protects the ramp)
    early_gain = rewards[3] - rewards[0]   # days 1→4
    late_gain = rewards[13] - rewards[10]  # days 11→14
    assert late_gain > early_gain
    assert all(rewards[i] <= rewards[i + 1] for i in range(len(rewards) - 1))
    # Peak streak bonus stays below a solid practice session (~75 mark stars)
    assert rewards[13] < 75

    # Preview before practice: continuing streak projects +1 day
    assert quests_svc.projected_streak_for_reward(6, practiced_today=False) == 7
    assert quests_svc.projected_streak_for_reward(6, practiced_today=True) == 6
    assert quests_svc.projected_streak_for_reward(0, practiced_today=False) == 1
    assert cycle == 14


def test_economy_shop_and_quest_balance():
    """Shop prices and quest bonuses stay in a coherent effort scale."""
    by_id = {c["id"]: c for c in quests_svc.DEFAULT_CATALOG}
    freeze = by_id["streak_freeze"]["cost_stars"]
    ipad15 = by_id["ipad_15"]["cost_stars"]
    ipad30 = by_id["ipad_30"]["cost_stars"]
    movie = by_id["movie_pick"]["cost_stars"]
    cash2 = by_id["cash_2"]["cost_stars"]
    cash5 = by_id["cash_5"]["cost_stars"]
    pizza = by_id["pizza"]["cost_stars"]

    # Current household policy: the freeze is cheapest; 15-minute screen time
    # and $2 cash share a tier, followed by larger privileges/rewards.
    assert freeze < ipad15 == cash2 < ipad30 < movie < cash5 < pizza
    peak = quests_svc.streak_tick_reward_max()
    # A freeze costs roughly one solid day and more than one streak payout.
    assert freeze >= peak
    assert freeze <= peak * 2
    # Real rewards remain multi-day goals at the current earning rate.
    assert ipad15 >= 300
    assert pizza >= 800

    # Quest stack (non-streak) < one solid mark session (~100)
    quest_stack = (
        quests_svc.QUEST_REWARD_DAILY_GOAL
        + quests_svc.QUEST_REWARD_ACCURACY
        + quests_svc.QUEST_REWARD_ERROR_FIX
        + quests_svc.QUEST_REWARD_INTERLEAVE
    )
    assert quest_stack < 100
    # Error-book quest hardest → pays more than show-up floor or accuracy alone
    assert quests_svc.QUEST_REWARD_ERROR_FIX > quests_svc.QUEST_REWARD_ACCURACY
    assert quests_svc.QUEST_REWARD_ERROR_FIX > quests_svc.STREAK_REWARD_BASE
    assert quests_svc.QUEST_ACCURACY_MIN_ATTEMPTS == 10
    assert quests_svc.QUEST_ACCURACY_MIN_RATE == 0.75
    assert quests_svc.QUEST_ERROR_FIX_TARGET == 1


def test_accuracy_and_error_fix_thresholds(student_id):
    """Solid accuracy = 10 attempts @ 75%; Error Book warrior = one transfer."""
    # 9/10 correct = 90% but only 9 attempts → incomplete
    ov = quests_svc.build_overview(
        student_id, streak_days=1, today_attempts=9, today_correct=9, daily_goal=20
    )
    acc_q = next(q for q in ov["quests"] if q["id"] == "accuracy_ok")
    assert acc_q["complete"] is False

    # 7/10 = 70% < 75% → incomplete
    ov = quests_svc.build_overview(
        student_id, streak_days=1, today_attempts=10, today_correct=7, daily_goal=20
    )
    acc_q = next(q for q in ov["quests"] if q["id"] == "accuracy_ok")
    assert acc_q["complete"] is False

    # 8/10 = 80% ≥ 75% → complete
    ov = quests_svc.build_overview(
        student_id, streak_days=1, today_attempts=10, today_correct=8, daily_goal=20
    )
    acc_q = next(q for q in ov["quests"] if q["id"] == "accuracy_ok")
    assert acc_q["complete"] is True
    assert "10" in acc_q["description"] and "75%" in acc_q["description"]

    # Error fix progress: zero incomplete, one complete.
    ov = quests_svc.build_overview(
        student_id, streak_days=1, today_attempts=0, today_correct=0, daily_goal=20
    )
    efix = next(q for q in ov["quests"] if q["id"] == "error_fix_5")
    assert efix["complete"] is False
    assert efix["progress"] == 0.0

    with quests_svc._lock_for(student_id):
        st = quests_svc._read_state(student_id)
        st["error_fix_day"] = {quests_svc._today(): 1}
        quests_svc._write_state(student_id, st)
    ov = quests_svc.build_overview(
        student_id, streak_days=1, today_attempts=1, today_correct=1, daily_goal=20
    )
    efix = next(q for q in ov["quests"] if q["id"] == "error_fix_5")
    assert efix["complete"] is True
    assert "transfer-safe" in efix["description"]


def test_overview_streak_tick_uses_scaled_reward(student_id):
    ov = quests_svc.build_overview(
        student_id,
        streak_days=7,
        today_attempts=2,
        today_correct=1,
        daily_goal=10,
    )
    streak_q = next(q for q in ov["quests"] if q["id"] == "streak_tick")
    expected = quests_svc.streak_tick_reward_stars(7)
    assert streak_q["reward_stars"] == expected
    assert streak_q["streak_cycle_day"] == 7
    assert ov["streak_reward_stars"] == expected
    assert ov["streak_reward_cycle_day"] == 7
    assert "2 weeks" in streak_q["description"] or "Cycle day" in streak_q["description"]

    # Claim pays scaled amount
    res = quests_svc.claim_quest(student_id, "streak_tick", overview_ctx=ov)
    assert res["ok"] is True
    assert res["awarded"] == expected


def test_streak_freeze_bridges_gap(student_id):
    from datetime import date, timedelta

    today = date.today()
    yesterday = (today - timedelta(days=1)).isoformat()
    day_before = (today - timedelta(days=2)).isoformat()
    # Activity on day_before only (missed yesterday)
    activity = {day_before}

    with quests_svc._lock_for(student_id):
        st = quests_svc._read_state(student_id)
        st["freeze_tokens"] = 1
        quests_svc._write_state(student_id, st)

    res = quests_svc.apply_auto_streak_freeze(student_id, activity)
    assert res["applied"] is True
    assert res["freeze_tokens"] == 0
    assert yesterday in res["freeze_dates"]
    # streak ends yesterday (frozen), length at least 1
    assert res["streak_days"] >= 1

    # second call idempotent
    res2 = quests_svc.apply_auto_streak_freeze(student_id, activity)
    assert res2["applied"] is False


def test_xp_curve_and_one_xp_per_star(student_id):
    assert quests_svc.xp_to_next_level(1) == 100
    assert quests_svc.xp_to_next_level(2) == 150
    assert quests_svc.xp_to_next_level(5) == 300

    res = quests_svc.award_for_mark(
        student_id,
        attempt_id="xp1",
        question_id="qx_xp",
        is_correct=True,
        question={},
    )
    assert res["awarded"] > 0
    # 1 XP per star
    with quests_svc._lock_for(student_id):
        st = quests_svc._read_state(student_id)
        assert st["xp"] == res["awarded"] or st["level"] > 1


def test_stars_by_day_ignores_redeem_refund(student_id):
    """Refund after rejected redeem must not inflate effort average or daily cap."""
    quests_svc.award_for_mark(
        student_id, attempt_id="r1", question_id="qr1", is_correct=True, question={}
    )
    with quests_svc._lock_for(student_id):
        st = quests_svc._read_state(student_id)
        day = quests_svc._today()
        earned = quests_svc._stars_earned_today(st, day)
        hist = int((st.get("stars_by_day") or {}).get(day) or 0)
        st["stars"] = 500
        quests_svc._write_state(student_id, st)

    red = quests_svc.redeem(student_id, "ipad_15")
    assert red["ok"] is True
    rid = red["redemption"]["id"]
    quests_svc.parent_resolve_redemption(student_id, rid, approve=False)

    with quests_svc._lock_for(student_id):
        st = quests_svc._read_state(student_id)
        day = quests_svc._today()
        after_hist = int((st.get("stars_by_day") or {}).get(day) or 0)
        after_cap = quests_svc._stars_earned_today(st, day)
    assert after_hist == hist  # refund must not add to stars_by_day
    assert after_cap == earned  # refund must not eat daily cap room


def test_open_grand_prize_when_chests_counter_desynced(student_id):
    with quests_svc._lock_for(student_id):
        st = quests_svc._read_state(student_id)
        st["chests"] = 0
        st["grand_prize_chests"] = 1
        quests_svc._write_state(student_id, st)
    opened = quests_svc.open_chest(student_id)
    assert opened["ok"] is True
    assert opened["loot"]["type"] == "cash_grand_prize"
    assert opened["loot"]["cash_label"] == "$100"


def test_streak_28_cash_prize_requires_avg_and_opens_100_dollars(student_id):
    from datetime import date, timedelta

    # 28-day streak alone is not enough without high average
    ov_low = quests_svc.build_overview(
        student_id,
        streak_days=28,
        today_attempts=1,
        today_correct=1,
        daily_goal=10,
    )
    assert ov_low.get("grand_prize_chests", 0) == 0
    assert ov_low["cash_prize"]["need_streak"] == 28
    assert ov_low["cash_prize"]["need_avg"] == 170
    assert ov_low["cash_prize"]["prize_dollars"] == 100

    # Seed last 28 days at 170⭐/day average
    with quests_svc._lock_for(student_id):
        st = quests_svc._read_state(student_id)
        hist = {}
        today = date.today()
        for i in range(28):
            hist[(today - timedelta(days=i)).isoformat()] = 170
        st["stars_by_day"] = hist
        # clear any partial milestones from previous overview except keep clean prize flag
        st["chest_milestones"] = {
            k: v for k, v in (st.get("chest_milestones") or {}).items()
            if k not in ("streak_28_cash", "streak_60")
        }
        st["grand_prize_chests"] = 0
        quests_svc._write_state(student_id, st)

    ov = quests_svc.build_overview(
        student_id,
        streak_days=28,
        today_attempts=1,
        today_correct=1,
        daily_goal=10,
    )
    assert ov.get("grand_prize_chests", 0) >= 1
    assert ov["cash_prize"]["avg_stars"] >= 170
    assert ov["cash_prize"]["already_awarded"] is True

    before = ov["stars"]
    opened = quests_svc.open_chest(student_id)
    assert opened["ok"] is True
    assert opened["loot"]["type"] == "cash_grand_prize"
    assert opened["loot"]["amount_cents"] == quests_svc.STREAK_CASH_PRIZE_CENTS
    assert opened["stars"] == before  # cash only
    assert opened["loot"]["cash_label"] == "$100"

    snap = quests_svc.parent_snapshot(student_id)
    pending = [r for r in snap["recent_redemptions"] if r.get("status") == "pending"]
    cash_red = next(r for r in pending if r.get("catalog_id") == "streak_28_cash")
    assert cash_red.get("cost_stars") == 0
    assert cash_red.get("cash_cents") == 100 * 100


def test_compute_mark_stars_basic():
    assert quests_svc.compute_mark_stars(is_correct=True) == quests_svc.MARK_STARS_CORRECT
    assert quests_svc.compute_mark_stars(is_correct=False) == quests_svc.MARK_STARS_WRONG
    assert quests_svc.compute_mark_stars(is_correct=True, qid_day_count_before=3) == 0
    assert quests_svc.compute_mark_stars(
        is_correct=True, review_source="error_book"
    ) == quests_svc.MARK_STARS_ERROR_BOOK
    # Accuracy mult only when day stats supplied
    assert quests_svc.compute_mark_stars(
        is_correct=True, today_attempts=10, today_correct=9
    ) == int(round(quests_svc.MARK_STARS_CORRECT * 1.15))
    assert quests_svc.compute_mark_stars(
        is_correct=True, today_attempts=10, today_correct=2
    ) == int(round(quests_svc.MARK_STARS_CORRECT * 0.85))


def test_award_and_idempotent(student_id, tmp_path):
    q = {"difficulty": "developing", "subject": "math"}
    a1 = quests_svc.award_for_mark(
        student_id,
        attempt_id="att_1",
        question_id="q1",
        is_correct=True,
        question=q,
    )
    assert a1 is not None
    assert a1["awarded"] > 0
    stars1 = a1["stars"]

    a2 = quests_svc.award_for_mark(
        student_id,
        attempt_id="att_1",
        question_id="q1",
        is_correct=True,
        question=q,
    )
    assert a2["awarded"] == 0
    assert a2.get("skipped") == "duplicate"
    assert a2["stars"] == stars1

    path = tmp_path / "logs" / student_id / "quests.json"
    assert path.is_file()
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["stars"] == stars1


def test_error_fix_counts_only_unique_transfer_safe_sources(student_id):
    def award(
        attempt: str,
        source: str | None,
        *,
        eligible: bool,
        correct: bool = True,
        shown: bool = False,
        stage: str | None = "needs_transfer",
    ):
        quests_svc.award_for_mark(
            student_id,
            attempt_id=attempt,
            question_id=f"variation-{attempt}",
            is_correct=correct,
            review_source="error_book",
            review_question_id=source,
            review_match={"eligible": eligible},
            review_closure_stage=stage,
            used_show_answer=shown,
            question={},
        )

    award("wrong", "source-a", eligible=True, correct=False)
    award("ineligible", "source-a", eligible=False)
    award("revealed", "source-a", eligible=True, shown=True)
    award("missing-source", None, eligible=True)
    award("unknown-stage", "source-a", eligible=True, stage=None)

    with quests_svc._lock_for(student_id):
        state = quests_svc._read_state(student_id)
    day = quests_svc._today()
    assert int((state.get("error_fix_day") or {}).get(day) or 0) == 0

    award("eligible-a", "source-a", eligible=True)
    award("duplicate-a", "source-a", eligible=True)
    with quests_svc._lock_for(student_id):
        state = quests_svc._read_state(student_id)
    assert state["error_fix_day"][day] == 1
    assert state["error_fix_sources_by_day"][day] == ["source-a"]

    award("eligible-b", "source-b", eligible=True)
    award("consolidation-c", "source-c", eligible=True, stage="needs_consolidation")
    with quests_svc._lock_for(student_id):
        state = quests_svc._read_state(student_id)
    assert state["error_fix_day"][day] == 2
    assert state["error_fix_sources_by_day"][day] == ["source-a", "source-b"]


def test_daily_cap(student_id):
    quests_svc.award_for_mark(
        student_id, attempt_id="c1", question_id="qx", is_correct=True, question={}
    )
    # force low cap
    with quests_svc._lock_for(student_id):
        st = quests_svc._read_state(student_id)
        st["daily_star_cap"] = 5
        st["stars"] = 0
        # clear today's positive ledger so cap room is 5 but we'll award many
        st["ledger"] = []
        quests_svc._write_state(student_id, st)

    # first award under cap
    r = quests_svc.award_for_mark(
        student_id, attempt_id="c2", question_id="qy", is_correct=True, question={}
    )
    assert r["awarded"] <= 5


def test_redeem_multi_quantity(student_id):
    ipad_cost = next(
        item["cost_stars"] for item in quests_svc.DEFAULT_CATALOG if item["id"] == "ipad_15"
    )
    starting_stars = ipad_cost * 3 + 30
    with quests_svc._lock_for(student_id):
        st = quests_svc._read_state(student_id)
        st["stars"] = starting_stars
        quests_svc._write_state(student_id, st)

    red = quests_svc.redeem(student_id, "ipad_15", quantity=3)
    assert red["ok"] is True
    assert red["quantity"] == 3
    assert red["redemption"]["quantity"] == 3
    assert red["redemption"]["cost_stars"] == ipad_cost * 3
    assert "×3" in red["redemption"]["title"]
    assert red["stars"] == starting_stars - ipad_cost * 3

    # Reject refunds the full multi-item hold.
    rid = red["redemption"]["id"]
    rej = quests_svc.parent_resolve_redemption(student_id, rid, approve=False)
    assert rej["ok"] is True
    assert rej["stars"] == starting_stars

    # Freeze multi-redemption auto-grants the full token quantity.
    freeze_cost = next(
        item["cost_stars"] for item in quests_svc.DEFAULT_CATALOG if item["id"] == "streak_freeze"
    )
    freeze_start = freeze_cost * 2 + 10
    with quests_svc._lock_for(student_id):
        st = quests_svc._read_state(student_id)
        st["stars"] = freeze_start
        st["freeze_tokens"] = 0
        quests_svc._write_state(student_id, st)
    fr = quests_svc.redeem(student_id, "streak_freeze", quantity=2)
    assert fr["ok"] is True
    assert fr.get("auto_approved") is True
    with quests_svc._lock_for(student_id):
        st = quests_svc._read_state(student_id)
        assert st["freeze_tokens"] == 2
        assert st["stars"] == freeze_start - freeze_cost * 2


def test_parent_approve_reject_and_error_fix(student_id):
    for i in range(quests_svc.QUEST_ERROR_FIX_TARGET):
        quests_svc.award_for_mark(
            student_id,
            attempt_id=f"eb{i+1}",
            question_id=f"eb_q{i+1}",
            is_correct=True,
            review_source="error_book",
            review_question_id=f"source_q{i+1}",
            review_match={"eligible": True},
            review_closure_stage="needs_transfer",
            question={},
        )
    ov = quests_svc.build_overview(
        student_id,
        streak_days=1,
        today_attempts=quests_svc.QUEST_ERROR_FIX_TARGET,
        today_correct=quests_svc.QUEST_ERROR_FIX_TARGET,
        daily_goal=20,
    )
    efix = next(q for q in ov["quests"] if q["id"] == "error_fix_5")
    assert efix["complete"] is True
    assert efix["claimable"] is True
    assert "transfer-safe" in efix["description"]

    # seed enough stars for redeem
    with quests_svc._lock_for(student_id):
        st = quests_svc._read_state(student_id)
        st["stars"] = 500
        quests_svc._write_state(student_id, st)

    red = quests_svc.redeem(student_id, "ipad_15")
    assert red["ok"] is True
    rid = red["redemption"]["id"]
    assert red["redemption"]["status"] == "pending"

    rej = quests_svc.parent_resolve_redemption(student_id, rid, approve=False, parent_note="later")
    assert rej["ok"] is True
    assert rej["redemption"]["status"] == "rejected"
    assert rej["stars"] >= 500  # refunded

    red2 = quests_svc.redeem(student_id, "ipad_15")
    rid2 = red2["redemption"]["id"]
    appr = quests_svc.parent_resolve_redemption(student_id, rid2, approve=True)
    assert appr["ok"] is True
    assert appr["redemption"]["status"] == "approved"

    snap = quests_svc.parent_snapshot(student_id)
    assert "catalog" in snap
    assert snap["daily_star_cap"] >= 20


def test_overview_claim_chest_redeem(student_id):
    # seed stars
    quests_svc.award_for_mark(
        student_id, attempt_id="o1", question_id="q1", is_correct=True, question={}
    )
    ov = quests_svc.build_overview(
        student_id,
        streak_days=3,
        today_attempts=20,
        today_correct=15,
        daily_goal=10,
    )
    assert ov["stars"] >= 0
    assert ov["level"] >= 1
    assert len(ov["quests"]) == 5
    assert ov["chests"] >= 1  # streak 3 grant
    assert any(c["id"] == "ipad_15" for c in ov["catalog"])

    # claim streak_tick or daily_goal
    claimable = next(q for q in ov["quests"] if q["claimable"])
    res = quests_svc.claim_quest(student_id, claimable["id"], overview_ctx=ov)
    assert res["ok"] is True
    assert res["awarded"] >= 0

    # open chest
    chest = quests_svc.open_chest(student_id)
    assert chest["ok"] is True
    assert "loot" in chest

    # redeem a real-world reward (parent approval); skip auto-items like freeze
    ov2 = quests_svc.build_overview(student_id, streak_days=3, today_attempts=20, today_correct=15, daily_goal=10)
    item = next(
        (c for c in ov2["catalog"] if c.get("id") == "ipad_15"),
        min(ov2["catalog"], key=lambda c: c["cost_stars"]),
    )
    if ov2["stars"] >= item["cost_stars"]:
        red = quests_svc.redeem(student_id, item["id"])
        assert red["ok"] is True
        expect_status = "approved" if item["id"] == "streak_freeze" else "pending"
        assert red["redemption"]["status"] == expect_status
        assert red["stars"] == ov2["stars"] - item["cost_stars"]


def test_master_toggle_blocks_all_student_quest_spending_and_rewards(student_id):
    overview = quests_svc.build_overview(
        student_id,
        streak_days=1,
        today_attempts=20,
        today_correct=20,
        daily_goal=20,
    )
    with quests_svc._lock_for(student_id):
        state = quests_svc._read_state(student_id)
        state["enabled"] = False
        state["stars"] = 2_000
        state["chests"] = 1
        quests_svc._write_state(student_id, state)

    assert quests_svc.claim_quest(student_id, "daily_goal", overview_ctx=overview) == {
        "ok": False,
        "error": "quests_disabled",
    }
    assert quests_svc.open_chest(student_id) == {"ok": False, "error": "quests_disabled"}
    assert quests_svc.redeem(student_id, "ipad_15") == {
        "ok": False,
        "error": "quests_disabled",
    }
    assert quests_svc.spin_wheel(student_id, roll=99.9) == {
        "ok": False,
        "error": "quests_disabled",
    }

    with quests_svc._lock_for(student_id):
        state = quests_svc._read_state(student_id)
    assert state["stars"] == 2_000
    assert state["chests"] == 1
    assert state["redemptions"] == []
    assert quests_svc.spin_status(state)["enabled"] is False


def test_chest_star_reward_respects_daily_cap(student_id, monkeypatch):
    with quests_svc._lock_for(student_id):
        state = quests_svc._read_state(student_id)
        state["chests"] = 1
        state["daily_star_cap"] = 20
        state["stars_by_day"] = {quests_svc._today(): 17}
        quests_svc._write_state(student_id, state)

    monkeypatch.setattr(quests_svc.random, "random", lambda: 0.1)
    monkeypatch.setattr(quests_svc.random, "randint", lambda _low, _high: 10)
    opened = quests_svc.open_chest(student_id)

    assert opened["ok"] is True
    assert opened["loot"] == {
        "type": "stars",
        "amount": 3,
        "label": "Small star pack",
        "raw_amount": 10,
        "capped": True,
    }
    with quests_svc._lock_for(student_id):
        state = quests_svc._read_state(student_id)
    assert quests_svc._stars_earned_today(state, quests_svc._today()) == 20


def test_chest_bonus_does_not_claim_an_unpersisted_item(student_id, monkeypatch):
    with quests_svc._lock_for(student_id):
        state = quests_svc._read_state(student_id)
        state["chests"] = 1
        quests_svc._write_state(student_id, state)

    monkeypatch.setattr(quests_svc.random, "random", lambda: 0.9)
    opened = quests_svc.open_chest(student_id)
    assert opened["loot"] == {"type": "stars", "amount": 8, "label": "8-star bonus"}


def test_rejected_multi_quantity_restores_all_limited_stock(student_id):
    saved = quests_svc.parent_save_catalog_item(
        student_id,
        {
            "id": "limited_reward",
            "title": "Limited reward",
            "cost_stars": 10,
            "stock": 5,
            "enabled": True,
        },
    )
    assert saved["ok"] is True
    with quests_svc._lock_for(student_id):
        state = quests_svc._read_state(student_id)
        state["stars"] = 100
        quests_svc._write_state(student_id, state)

    redeemed = quests_svc.redeem(student_id, "limited_reward", quantity=3)
    assert redeemed["ok"] is True
    held_snapshot = quests_svc.parent_snapshot(student_id)
    assert next(
        item for item in held_snapshot["catalog"] if item["id"] == "limited_reward"
    )["stock"] == 2

    rejected = quests_svc.parent_resolve_redemption(
        student_id,
        redeemed["redemption"]["id"],
        approve=False,
    )
    assert rejected["ok"] is True
    snapshot = quests_svc.parent_snapshot(student_id)
    assert next(item for item in snapshot["catalog"] if item["id"] == "limited_reward")["stock"] == 5


def test_interleave_claim_lifecycle(student_id):
    day = quests_svc._today()
    with quests_svc._lock_for(student_id):
        state = quests_svc._read_state(student_id)
        state["strands_by_day"] = {day: ["Number", "Algebra", "Measurement"]}
        quests_svc._write_state(student_id, state)

    overview = quests_svc.build_overview(
        student_id,
        streak_days=1,
        today_attempts=3,
        today_correct=3,
        daily_goal=20,
    )
    interleave = next(q for q in overview["quests"] if q["id"] == "interleave_3")
    assert interleave["complete"] is True
    assert interleave["claimable"] is True
    assert interleave["claimed"] is False

    claimed = quests_svc.claim_quest(student_id, "interleave_3", overview_ctx=overview)
    assert claimed["ok"] is True
    assert claimed["awarded"] == quests_svc.QUEST_REWARD_INTERLEAVE

    after = quests_svc.build_overview(
        student_id,
        streak_days=1,
        today_attempts=3,
        today_correct=3,
        daily_goal=20,
    )
    interleave_after = next(q for q in after["quests"] if q["id"] == "interleave_3")
    assert interleave_after["claimed"] is True
    assert interleave_after["claimable"] is False
    duplicate = quests_svc.claim_quest(student_id, "interleave_3", overview_ctx=after)
    assert duplicate["ok"] is False
    assert duplicate["error"] == "already_claimed"


def test_default_daily_star_cap_and_legacy_migration(student_id):
    assert quests_svc.DEFAULT_DAILY_STAR_CAP == 300

    # New student gets default cap 300
    snap = quests_svc.parent_snapshot(student_id)
    assert snap["daily_star_cap"] == 300

    # Legacy caps (80, 120, 160, 200) get migrated to 300
    for legacy in (80, 120, 160, 200):
        with quests_svc._lock_for(student_id):
            state = quests_svc._read_state(student_id)
            state["daily_star_cap"] = legacy
            quests_svc._write_state(student_id, state)

        reloaded = quests_svc._read_state(student_id)
        assert reloaded["daily_star_cap"] == 300

    # Custom intentional cap (e.g. 250, 450) is preserved
    with quests_svc._lock_for(student_id):
        state = quests_svc._read_state(student_id)
        state["daily_star_cap"] = 250
        quests_svc._write_state(student_id, state)

    reloaded = quests_svc._read_state(student_id)
    assert reloaded["daily_star_cap"] == 250

    # Parent update allows setting cap up to 500
    res = quests_svc.parent_update_settings(student_id, daily_star_cap=450)
    assert res["ok"] is True
    assert res["daily_star_cap"] == 450

    # Cap > 500 or < 20 is rejected
    assert quests_svc.parent_update_settings(student_id, daily_star_cap=501)["ok"] is False
    assert quests_svc.parent_update_settings(student_id, daily_star_cap=19)["ok"] is False

