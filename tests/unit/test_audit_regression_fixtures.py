"""Smoke tests for the shared Phase 0 audit-regression fixtures."""


def test_outcome_fixture_distinguishes_unknown_from_wrong(outcome_attempts):
    assert outcome_attempts["incorrect"]["error_type"] == "incorrect_value"
    assert outcome_attempts["pending"]["error_type"] == "parent_review_pending"
    assert outcome_attempts["deferred"]["error_type"] == "llm_unavailable"
    assert outcome_attempts["unanswered"]["student_answer"] == ""


def test_cross_tag_fixture_represents_one_physical_event(cross_tagged_attempt_log):
    rows = [
        attempt
        for topic in cross_tagged_attempt_log["topics"].values()
        for attempt in topic["attempts"]
    ]
    assert len(rows) == 2
    assert rows[0]["question_id"] == rows[1]["question_id"]
    assert rows[0]["timestamp"] == rows[1]["timestamp"]
    assert {row["weight"] for row in rows} == {1.0, 0.3}


def test_complex_question_fixtures_cover_context_and_partial_marking(
    progressive_multi_part_exercise,
    english_stimulus_exercise,
    science_visual_exercise,
):
    assert any(part["marks"] > 1 for part in progressive_multi_part_exercise["sub_parts"])
    assert english_stimulus_exercise["english_metadata"]["passage"]
    assert science_visual_exercise["diagram_data"]["type"] == "force_diagram"


def test_low_confidence_fixture_is_not_sufficient_evidence(low_confidence_mastery):
    assert low_confidence_mastery["bkt_mastery"] >= 0.8
    assert low_confidence_mastery["confidence"] == "low"
    assert low_confidence_mastery["evidence_count"] == 1
