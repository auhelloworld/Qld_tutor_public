"""Validation tests for Writing Lab topic-bank reachability."""
from __future__ import annotations

import json
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
TOPICS_FILE = PROJECT_ROOT / "data" / "writing_topics.json"


def _is_active(topic: dict) -> bool:
    return not topic.get("disabled") and topic.get("status", "active") != "draft"


def _prompt_type_allowed_for_year(prompt_type: str, year_level: int) -> bool:
    return prompt_type in {"persuasive", "narrative", "analytical", "expository"}


def _validate_optional_future_fields(topic: dict) -> None:
    if "taskConditions" in topic:
        conditions = topic["taskConditions"]
        assert isinstance(conditions, dict), f"{topic['id']} taskConditions must be an object"
        if "planningMinutes" in conditions:
            assert isinstance(conditions["planningMinutes"], int) and conditions["planningMinutes"] >= 0
        if "writingMinutes" in conditions:
            assert isinstance(conditions["writingMinutes"], int) and conditions["writingMinutes"] >= 0
        for key in ("label", "conditionsNote"):
            if key in conditions:
                assert isinstance(conditions[key], str) and conditions[key].strip()

    if "officialSource" in topic:
        source = topic["officialSource"]
        assert isinstance(source, dict), f"{topic['id']} officialSource must be an object"
        assert isinstance(source.get("label"), str) and source["label"].strip()
        if "url" in source:
            assert isinstance(source["url"], str) and source["url"].startswith(("https://", "http://"))
        if "note" in source:
            assert isinstance(source["note"], str) and source["note"].strip()

    if "rubricProfile" in topic:
        assert topic["rubricProfile"] in {
            "naplan_style",
            "junior_curriculum",
            "senior_qcaa_general",
        }, f"{topic['id']} has unsupported rubricProfile"


def test_active_writing_topics_are_reachable_by_current_framework():
    topics = json.loads(TOPICS_FILE.read_text(encoding="utf-8"))
    unreachable = []

    for topic in topics:
        assert topic.get("id"), "Every writing topic needs a stable id"
        assert topic.get("type") in {"persuasive", "narrative", "analytical", "expository"}
        year_levels = topic.get("yearLevels")
        assert isinstance(year_levels, list) and year_levels, f"{topic['id']} needs yearLevels"
        _validate_optional_future_fields(topic)
        for year_level in year_levels:
            assert 7 <= year_level <= 12, f"{topic['id']} has invalid year level {year_level}"

        if not _is_active(topic):
            continue

        for year_level in year_levels:
            if not _prompt_type_allowed_for_year(topic["type"], year_level):
                unreachable.append(f"{topic['id']}:{topic['type']}:Y{year_level}")

    assert not unreachable, (
        "Active writing topics must be selectable by the current frontend/backend "
        f"framework or marked status='draft'/disabled=true: {unreachable}"
    )


def test_technology_free_day_is_expository_not_persuasive():
    topics = json.loads(TOPICS_FILE.read_text(encoding="utf-8"))
    topic = next(t for t in topics if t["id"] == "y8-p-explain-tech-free-day")

    assert topic["type"] == "expository"
    assert topic["category"] == "Informative/Expository"


def test_ai_study_habits_is_expository_not_persuasive():
    topics = json.loads(TOPICS_FILE.read_text(encoding="utf-8"))
    topic = next(t for t in topics if t["id"] == "y10-p-explain-ai-study")

    assert topic["type"] == "expository"
    assert topic["category"] == "Informative/Expository"


def test_phase7_high_value_writing_topic_coverage():
    topics = json.loads(TOPICS_FILE.read_text(encoding="utf-8"))
    by_id = {topic["id"]: topic for topic in topics}

    expected_ids = {
        "y10-p-phone-free-learning",
        "y10-p-student-transport",
        "qcaa-ia2-text-pair-belonging",
        "qcaa-ia2-text-pair-work-futures",
        "qcaa-ea-unseen-rain-platform",
        "qcaa-ea-unseen-glasshouse",
    }
    assert expected_ids <= set(by_id)

    year10_public_arguments = [
        topic for topic in topics
        if topic["type"] == "persuasive"
        and 10 in topic["yearLevels"]
        and topic.get("category") == "Year 10 Public Argument"
    ]
    assert len(year10_public_arguments) >= 2

    senior_text_pairs = [by_id["qcaa-ia2-text-pair-belonging"], by_id["qcaa-ia2-text-pair-work-futures"]]
    for topic in senior_text_pairs:
        assert topic["type"] == "persuasive"
        assert topic["rubricProfile"] == "senior_qcaa_general"
        assert "stimulusText" in topic and "Stimulus A" in topic["stimulusText"]
        assert topic["taskConditions"]["label"].startswith("IA2-style")
        assert topic["officialSource"]["url"].startswith("https://www.qcaa.qld.edu.au/")

    senior_unseen = [by_id["qcaa-ea-unseen-rain-platform"], by_id["qcaa-ea-unseen-glasshouse"]]
    for topic in senior_unseen:
        assert topic["type"] == "analytical"
        assert topic["rubricProfile"] == "senior_qcaa_general"
        assert "stimulusText" in topic and "unseen" in topic["mode"].lower()
        assert topic["taskConditions"]["label"].startswith("EA-style")


def test_senior_english_writing_remediation_map_is_populated():
    from backend.curriculum_loader import CurriculumLoader

    slice_obj = CurriculumLoader().load_slice("QCAA_SENIOR_ENGLISH", "english")
    topic_ids = {topic.topic_id for topic in slice_obj.topics}

    expected_ids = {
        "QCAA_ENGLISH_U3_T1",
        "QCAA_ENGLISH_U3_T2",
        "QCAA_ENGLISH_U3_T3",
        "QCAA_ENGLISH_U4_T1",
        "QCAA_ENGLISH_U4_T2",
    }
    assert expected_ids <= topic_ids
    assert slice_obj.sequence.sequence == [
        "QCAA_ENGLISH_U3_T1",
        "QCAA_ENGLISH_U3_T2",
        "QCAA_ENGLISH_U3_T3",
        "QCAA_ENGLISH_U4_T1",
        "QCAA_ENGLISH_U4_T2",
    ]

    for topic in slice_obj.topics:
        assert topic.skills
        assert topic.concept_card.core_rule
        assert topic.supplementary_resources
