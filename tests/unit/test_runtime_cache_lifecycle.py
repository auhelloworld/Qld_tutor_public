from types import SimpleNamespace

import pytest


def test_exam_simulator_shares_canonical_bank_including_senior_units(monkeypatch):
    import backend.exam_simulator as exam_module
    import backend.tutor_engine as tutor_module

    exercises = {
        "year-item": {"id": "year-item", "subject": "math", "year_level": 7},
        "unit-item": {
            "id": "unit-item",
            "subject": "methods",
            "unit": 3,
            "syllabus_subject": "methods",
        },
    }
    loader = object()
    tutor = SimpleNamespace(
        exercises=exercises,
        _loader=loader,
        exercise_bank_snapshot=lambda: (1, exercises),
    )
    monkeypatch.setattr(tutor_module, "get_tutor_engine", lambda: tutor)
    monkeypatch.setattr(exam_module, "_exam_simulator", None)

    simulator = exam_module.get_exam_simulator()

    assert simulator.exercises is exercises
    assert simulator.loader is loader
    assert simulator.exercises["unit-item"]["unit"] == 3
    assert simulator.exercises["unit-item"]["syllabus_subject"] == "methods"


def test_speed_round_cleanup_expires_abandoned_sessions_and_caps_registry(monkeypatch):
    import backend.routers.tutor as tutor_router

    monkeypatch.setattr(tutor_router.time, "time", lambda: 10_000.0)
    with tutor_router._SPEED_ROUND_SESSIONS_LOCK:
        tutor_router._speed_round_sessions.clear()
        tutor_router._speed_round_sessions["expired-abandoned"] = tutor_router.SpeedRoundSession(
            session_id="expired-abandoned",
            student_id="student",
            subject="math",
            topic=None,
            questions=[{"id": "old"}],
            start_time=10_000.0 - tutor_router._SPEED_ROUND_SESSION_TTL - 1,
            time_limit_seconds=120,
            completed=False,
        )
        for index in range(tutor_router._SPEED_ROUND_MAX_SESSIONS + 5):
            session_id = f"active-{index}"
            tutor_router._speed_round_sessions[session_id] = tutor_router.SpeedRoundSession(
                session_id=session_id,
                student_id="student",
                subject="math",
                topic=None,
                questions=[{"id": session_id}],
                start_time=9_000.0 + index,
                time_limit_seconds=120,
                completed=False,
            )

    tutor_router._cleanup_speed_round_sessions()

    with tutor_router._SPEED_ROUND_SESSIONS_LOCK:
        assert "expired-abandoned" not in tutor_router._speed_round_sessions
        assert len(tutor_router._speed_round_sessions) == tutor_router._SPEED_ROUND_MAX_SESSIONS
        assert "active-0" not in tutor_router._speed_round_sessions
        tutor_router._speed_round_sessions.clear()


def test_mistakes_cache_prunes_expired_entries_and_enforces_bound(monkeypatch):
    import backend.routers.tutor as tutor_router

    monkeypatch.setattr(tutor_router, "MISTAKES_CACHE_MAX_ENTRIES", 2)
    with tutor_router._MISTAKES_CACHE_LOCK:
        tutor_router._MISTAKES_CACHE.clear()
        tutor_router._MISTAKES_CACHE["expired"] = (9.0, {})
        tutor_router._MISTAKES_CACHE["oldest"] = (20.0, {})
        tutor_router._MISTAKES_CACHE["middle"] = (20.0, {})
        tutor_router._MISTAKES_CACHE["newest"] = (20.0, {})
        tutor_router._prune_mistakes_cache(10.0)

        assert list(tutor_router._MISTAKES_CACHE) == ["middle", "newest"]
        tutor_router._MISTAKES_CACHE.clear()


@pytest.mark.parametrize(
    "expression",
    [
        "1" * 65,
        "(" * 25 + "1" + ")" * 25,
        "2^1001",
        "2**1001",
        "1001!",
        "factorial(1001)",
        "factorial(-1001)",
        "factorial(factorial(7))",
        "2**factorial(1000)",
        "fibonacci(1000000)",
        "+".join(["1"] * 66),
    ],
)
def test_symbolic_parser_rejects_pathological_expression_shapes(expression):
    from backend.answer_normalize import safe_sympify

    with pytest.raises(ValueError):
        safe_sympify(expression)


def test_legacy_json_mirror_api_is_removed():
    from backend.rules import StudyRuleEngine

    assert not hasattr(StudyRuleEngine, "_mirror_to_file")
    assert not hasattr(StudyRuleEngine, "_mirror_hot_path")


def test_mistakes_cache_rejects_a_stale_generation():
    import backend.routers.tutor as tutor_router

    with tutor_router._MISTAKES_CACHE_LOCK:
        tutor_router._MISTAKES_CACHE.clear()
        generation = tutor_router._MISTAKES_CACHE_GENERATION

    tutor_router.invalidate_mistakes_cache("student-a")
    stored = tutor_router._store_mistakes_cache(
        "student-a:math",
        generation,
        100.0,
        {"mistakes": ["stale"]},
        10.0,
    )

    assert stored is False
    with tutor_router._MISTAKES_CACHE_LOCK:
        assert "student-a:math" not in tutor_router._MISTAKES_CACHE
