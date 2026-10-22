"""Quest-board prize wheel contracts.

The wheel is a star **sink**: it charges on every spin, wins are capped by an
authored prize table, and it is limited per day. Winnings must not leak into the
daily earn cap or the effort average that gates the real-money streak prize,
because they are recycled stars rather than new practice.
"""
from __future__ import annotations

import pytest

from backend.services import quests as quests_svc

STUDENT = "c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f"


@pytest.fixture(autouse=True)
def isolated_state(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.rules.LOG_ROOT", tmp_path / "logs")
    (tmp_path / "logs").mkdir(parents=True, exist_ok=True)
    yield


def _set_stars(student_id: str, stars: int) -> None:
    with quests_svc._lock_for(student_id):
        state = quests_svc._read_state(student_id)
        state["stars"] = stars
        quests_svc._write_state(student_id, state)


def _state(student_id: str) -> dict:
    with quests_svc._lock_for(student_id):
        return quests_svc._read_state(student_id)


def test_prize_table_totals_one_hundred_percent():
    total = sum(chance for chance, _stars, _label, _emoji in quests_svc.SPIN_PRIZES)
    assert round(total, 6) == 100.0


def test_prize_table_matches_the_authored_odds():
    table = {stars: chance for chance, stars, _label, _emoji in quests_svc.SPIN_PRIZES}
    assert table == {0: 40.0, 15: 25.0, 20: 15.0, 30: 10.0, 50: 5.0, 100: 3.9, 500: 1.0, 1000: 0.1}
    assert quests_svc.SPIN_COST_STARS == 20
    assert quests_svc.SPIN_MAX_PER_DAY == 10


@pytest.mark.parametrize(
    "roll,expected_stars",
    [
        (0.0, 0),      # first slice
        (39.999, 0),   # last of the 40% losing band
        (40.0, 15),    # 25%
        (64.999, 15),
        (65.0, 20),    # 15%
        (80.0, 30),    # 10%
        (90.0, 50),    # 5%
        (95.0, 100),   # 3.9%
        (98.9, 500),   # 1%
        (99.9, 1000),  # 0.1% jackpot
        (99.9999, 1000),
    ],
)
def test_roll_maps_to_the_expected_slice(roll, expected_stars):
    assert quests_svc._roll_spin_prize(roll)["stars"] == expected_stars


def test_spin_charges_the_cost_and_pays_the_prize():
    _set_stars(STUDENT, 100)
    result = quests_svc.spin_wheel(STUDENT, roll=80.0)  # 30-star slice
    assert result["ok"] is True
    assert result["prize"]["stars"] == 30
    assert result["cost_stars"] == 20
    assert result["net_stars"] == 10
    assert result["stars"] == 110
    assert result["spins_used"] == 1
    assert result["spins_remaining"] == quests_svc.SPIN_MAX_PER_DAY - 1


def test_losing_spin_still_costs_stars():
    _set_stars(STUDENT, 100)
    result = quests_svc.spin_wheel(STUDENT, roll=0.0)
    assert result["prize"]["stars"] == 0
    assert result["prize"]["won"] is False
    assert result["net_stars"] == -20
    assert result["stars"] == 80


def test_spin_requires_the_cost_and_leaves_the_wallet_untouched():
    _set_stars(STUDENT, 19)
    result = quests_svc.spin_wheel(STUDENT)
    assert result == {
        "ok": False,
        "error": "insufficient_stars",
        "cost_stars": 20,
        "stars": 19,
    }
    assert _state(STUDENT)["stars"] == 19


def test_daily_limit_is_ten_spins():
    _set_stars(STUDENT, 10_000)
    for index in range(quests_svc.SPIN_MAX_PER_DAY):
        assert quests_svc.spin_wheel(STUDENT, roll=0.0)["ok"] is True, index

    blocked = quests_svc.spin_wheel(STUDENT, roll=0.0)
    assert blocked["ok"] is False
    assert blocked["error"] == "spin_daily_limit"
    assert blocked["spins_remaining"] == 0

    stars_after_limit = _state(STUDENT)["stars"]
    # The refused spin must not charge.
    assert quests_svc.spin_wheel(STUDENT, roll=0.0)["ok"] is False
    assert _state(STUDENT)["stars"] == stars_after_limit


def test_winnings_do_not_count_toward_the_daily_earn_cap():
    """Spin payouts are recycled stars, not new effort.

    They must stay out of ``stars_by_day``, which feeds both the daily earn cap
    and the 28-day effort average behind the cash prize.
    """
    _set_stars(STUDENT, 200)
    day = quests_svc._today()
    before = quests_svc._stars_earned_today(_state(STUDENT), day)

    quests_svc.spin_wheel(STUDENT, roll=99.9)  # jackpot
    state = _state(STUDENT)
    assert state["stars"] == 200 - 20 + 1000
    assert quests_svc._stars_earned_today(state, day) == before
    assert int((state.get("stars_by_day") or {}).get(day) or 0) == 0


def test_spin_is_recorded_in_the_ledger():
    _set_stars(STUDENT, 100)
    quests_svc.spin_wheel(STUDENT, roll=90.0)  # 50-star slice
    reasons = [row["reason"] for row in _state(STUDENT)["ledger"]]
    assert reasons[-2:] == ["spin_cost", "spin_win"]


def test_parent_can_disable_the_wheel():
    _set_stars(STUDENT, 100)
    quests_svc.parent_update_settings(STUDENT, spin_enabled=False)
    result = quests_svc.spin_wheel(STUDENT)
    assert result == {"ok": False, "error": "spin_disabled"}
    assert _state(STUDENT)["stars"] == 100

    quests_svc.parent_update_settings(STUDENT, spin_enabled=True)
    assert quests_svc.spin_wheel(STUDENT, roll=0.0)["ok"] is True


def test_status_reports_affordability_and_allowance():
    _set_stars(STUDENT, 5)
    status = quests_svc.spin_status(_state(STUDENT))
    assert status["cost_stars"] == 20
    assert status["max_per_day"] == 10
    assert status["spins_remaining"] == 10
    assert status["can_spin"] is False  # cannot afford
    assert len(status["prizes"]) == len(quests_svc.SPIN_PRIZES)

    _set_stars(STUDENT, 40)
    assert quests_svc.spin_status(_state(STUDENT))["can_spin"] is True


def test_overview_exposes_spin_status():
    overview = quests_svc.build_overview(
        STUDENT,
        streak_days=0,
        today_attempts=0,
        today_correct=0,
        daily_goal=20,
        activity_dates=set(),
    )
    assert "spin" in overview
    assert overview["spin"]["cost_stars"] == 20
    assert overview["spin"]["max_per_day"] == 10


def test_spin_endpoint_returns_the_prize_and_reports_refusals(monkeypatch):
    from fastapi.testclient import TestClient

    monkeypatch.setenv("API_KEY", "")
    from backend.api import app
    from backend.student_identity import create_student_token

    client = TestClient(app)
    headers = {"Authorization": f"Bearer {create_student_token(STUDENT)}"}

    _set_stars(STUDENT, 60)
    ok = client.post("/api/quests/spin", headers=headers)
    assert ok.status_code == 200, ok.text
    body = ok.json()
    assert body["ok"] is True
    assert body["cost_stars"] == 20
    assert body["prize"]["stars"] in {0, 15, 20, 30, 50, 100, 500, 1000}
    assert body["spins_remaining"] == quests_svc.SPIN_MAX_PER_DAY - 1

    _set_stars(STUDENT, 0)
    refused = client.post("/api/quests/spin", headers=headers)
    assert refused.status_code == 400
    assert refused.json()["error"] == "insufficient_stars"

    unauthenticated = client.post(
        "/api/quests/spin",
        headers={"Origin": "http://localhost:3000"},
    )
    assert unauthenticated.status_code == 401
