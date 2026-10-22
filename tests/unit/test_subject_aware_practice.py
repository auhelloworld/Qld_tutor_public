from __future__ import annotations

from backend._testing import reset_engine_factory_cache
from backend.routers.curriculum import get_exercises
from backend.routers.helpers import get_tutor_engine
from backend.rules import get_engine


VALID_STUDENT_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"


def test_english_recommendation_uses_english_framework():
    reset_engine_factory_cache()
    rec = get_engine(VALID_STUDENT_ID, "english").recommend_next_topic("year7")

    assert rec["framework_id"] == "AC9_ENGLISH"
    assert rec["topic_id"].startswith("AC9E7")
    assert not rec["topic_id"].startswith("AC9M")


def test_exercise_filter_rejects_cross_subject_topic_results():
    english = get_exercises(topic="AC9E7LA07", subject="english")
    assert english
    assert {ex.get("subject") for ex in english} == {"english"}

    math = get_exercises(topic="AC9E7LA07", subject="math")
    assert math == []


def test_tutor_suggest_filters_by_subject():
    tutor = get_tutor_engine()
    english = tutor.suggest_practice(
        "AC9E7LA07",
        "retrieve",
        student_id=VALID_STUDENT_ID,
        subject="english",
    )
    assert english.get("question")
    assert english["question"]["subject"] == "english"

    math = tutor.suggest_practice(
        "AC9E7LA07",
        "retrieve",
        student_id=VALID_STUDENT_ID,
        subject="math",
    )
    assert "error" in math


def test_exercise_filter_by_year_level():
    # The list endpoint requires a topic; the year filter narrows that pool.
    y7_exercises = get_exercises(topic="AC9M7N02", subject="math", year_level=7)
    assert y7_exercises
    assert all(ex.get("year_level") == 7 for ex in y7_exercises)

    # A Year 8 filter must not return the Year 7 items of the same topic.
    y8_exercises = get_exercises(topic="AC9M7N02", subject="math", year_level=8)
    assert all(ex.get("year_level") == 8 for ex in y8_exercises)


def test_tutor_suggest_filters_by_year_level():
    tutor = get_tutor_engine()
    # Suggest practice for a math topic with year_level=7
    res = tutor.suggest_practice(
        "AC9M7N01",
        "retrieve",
        student_id=VALID_STUDENT_ID,
        subject="math",
        year_level=7,
    )
    assert res.get("question")
    assert res["question"]["year_level"] == 7

    # Suggest with wrong year_level should fail to find a question
    res_wrong_year = tutor.suggest_practice(
        "AC9M7N01",
        "retrieve",
        student_id=VALID_STUDENT_ID,
        subject="math",
        year_level=8,
    )
    assert "error" in res_wrong_year

