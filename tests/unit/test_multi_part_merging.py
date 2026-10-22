import json
import pytest
from pathlib import Path
from backend.tutor_engine import TutorEngine
from backend._testing import reset_engine_factory_cache

STUDENT_ID = "test-multipart-student"

@pytest.fixture(autouse=True)
def _isolate(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Reset engine cache and redirect LOG_ROOT to tmp_path for isolation."""
    reset_engine_factory_cache()
    monkeypatch.setattr("backend.rules.LOG_ROOT", tmp_path / "logs")
    yield
    reset_engine_factory_cache()

@pytest.fixture
def tutor():
    # Reset the singleton so we get a fresh instance
    import backend.tutor_engine as te
    te._tutor_engine = None
    engine = te.get_tutor_engine()
    # Inject a multi-part exercise
    engine.exercises["multipart_test_001"] = {
        "id": "multipart_test_001",
        "topic": "fractions",
        "question_type": "multi_part",
        "question": "A multi-part question.",
        "answer": "a: 6\nb: 10\nc: 15",
        "sub_parts": [
            {"label": "a", "question": "What is 2 * 3?", "answer": "6", "marks": 1},
            {"label": "b", "question": "What is 5 * 2?", "answer": "10", "marks": 1},
            {"label": "c", "question": "What is 3 * 5?", "answer": "15", "marks": 1}
        ],
        "framework": "AC9_MATHS",
        "topic_ids": ["AC9M7N04"],
        "subject": "math",
        "difficulty": "developing",
        "year_level": 7,
        "unit": None
    }
    return engine

def test_multipart_sequential_merging(tutor):
    # 1. First attempt: Student answers part 'a' correctly, but leaves others blank
    res1 = tutor.mark("multipart_test_001", "a: 6", student_id=STUDENT_ID)
    assert res1["is_correct"] is False  # Not all parts answered yet
    assert res1["score"] == 1
    assert res1["part_results"][0]["is_correct"] is True
    assert res1["part_results"][1]["is_correct"] is False
    assert res1["part_results"][2]["is_correct"] is False
    assert res1["quest_award"]["awarded"] > 0

    # 2. Second attempt: Student answers part 'b' correctly, but sends only part 'b'
    res2 = tutor.mark("multipart_test_001", "b: 10", student_id=STUDENT_ID)
    assert res2["is_correct"] is False  # Part (c) still unanswered
    assert res2["score"] == 2
    assert res2["part_results"][0]["is_correct"] is True  # merged from previous attempt!
    assert res2["part_results"][1]["is_correct"] is True  # new answer
    assert res2["part_results"][2]["is_correct"] is False
    assert res2["quest_award"]["awarded"] > 0

    # 3. Third attempt: Student answers part 'c' correctly (without label, which falls back to first unanswered part 'c')
    res3 = tutor.mark("multipart_test_001", "15", student_id=STUDENT_ID)
    assert res3["is_correct"] is True
    assert res3["score"] == 3
    assert res3["part_results"][0]["is_correct"] is True
    assert res3["part_results"][1]["is_correct"] is True
    assert res3["part_results"][2]["is_correct"] is True
    assert res3["quest_award"]["awarded"] > 0

    from backend.services import quests as quests_svc

    with quests_svc._lock_for(STUDENT_ID):
        state = quests_svc._read_state(STUDENT_ID)
    mark_entries = [entry for entry in state["ledger"] if entry.get("reason") == "mark"]
    assert len(mark_entries) == 3
    assert {entry["meta"].get("part_label") for entry in mark_entries} == {"a", "b", "c"}


def test_multipart_hall_hire(tutor):
    # Inject the actual Hall hire question into exercises cache
    tutor.exercises["math_7_mp2_AC9M7A01_34cae4"] = {
        "id": "math_7_mp2_AC9M7A01_34cae4",
        "topic": "formulas_substitution",
        "question_type": "multi_part",
        "question": "Hall hire: C = 50 + 25h.",
        "answer": "See parts",
        "sub_parts": [
            {"label": "a", "question": "Cost for 3 hours?", "answer": "125", "marks": 1},
            {"label": "b", "question": "\\$300 total → hours?", "answer": "10 hours", "marks": 1},
            {"label": "c", "question": "Manager: each hour $25 so first hour $50. Correct?", "answer": "No; \\$50 is flagfall, 1st hour is \\$75", "marks": 3}
        ],
        "framework": "AC9_MATHS",
        "topic_ids": ["AC9M7A01"],
        "subject": "math",
        "difficulty": "developing",
        "year_level": 7,
        "unit": None
    }

    # 1. Attempt part 'a' correctly
    res1 = tutor.mark("math_7_mp2_AC9M7A01_34cae4", "a: 125", student_id=STUDENT_ID)
    assert res1["is_correct"] is False
    assert res1["part_results"][0]["is_correct"] is True

    # 2. Attempt part 'b' with "10" (should match "10 hours" locally via our time-unit normalisation)
    res2 = tutor.mark("math_7_mp2_AC9M7A01_34cae4", "b: 10", student_id=STUDENT_ID)
    assert res2["is_correct"] is False
    assert res2["part_results"][1]["is_correct"] is True  # Time unit equivalence succeeded!

    # 3. Attempt part 'c' with a text answer that fails local are_equivalent and triggers LLM fallback.
    # We patch _call_llm_safe to return a correct mark result.
    # Also need a non-None client so the LLM path is taken (mock mode sets client=None).
    if not tutor.client:
        from unittest.mock import MagicMock
        tutor.client = MagicMock()
    from unittest.mock import patch
    from core.schema.tutor_schema import MarkResult
    
    mock_result = MarkResult(
        is_correct=True,
        error_type=None,
        feedback="Correct. $50 is a flagfall fee, so the first hour actually costs $75.",
        error_pattern=None,
        misconception_id=None,
        new_misconception=None
    )
    
    with patch.object(tutor, "_call_llm_safe", return_value=mock_result) as mock_call:
        res3 = tutor.mark("math_7_mp2_AC9M7A01_34cae4", "c: No, flagfall is 50", student_id=STUDENT_ID)
        
        # Verify LLM was called since it is a text-based answer and not numeric
        mock_call.assert_called_once()
        
        assert res3["is_correct"] is True
        assert res3["score"] == 5
        assert res3["part_results"][2]["is_correct"] is True
        assert "flagfall" in res3["feedback"]




def test_multipart_fourth_part_also_gets_independent_reward(tutor):
    """Part-level rewards continue past c and remain independently idempotent."""
    from backend.services import quests as quests_svc

    question_id = "multipart_test_004"
    tutor.exercises[question_id] = {
        **tutor.exercises["multipart_test_001"],
        "id": question_id,
        "sub_parts": [
            {"label": "a", "question": "What is 2 * 3?", "answer": "6", "marks": 1},
            {"label": "b", "question": "What is 5 * 2?", "answer": "10", "marks": 1},
            {"label": "c", "question": "What is 3 * 5?", "answer": "15", "marks": 1},
            {"label": "d", "question": "What is 2 * 2?", "answer": "4", "marks": 1},
        ],
    }
    student_id = f"{STUDENT_ID}-four"

    awards = [
        tutor.mark(question_id, answer, student_id=student_id)
        for answer in ("a: 6", "b: 10", "c: 15", "d: 4")
    ]

    assert all(result.get("quest_award", {}).get("awarded", 0) > 0 for result in awards)
    with quests_svc._lock_for(student_id):
        state = quests_svc._read_state(student_id)
    mark_entries = [entry for entry in state["ledger"] if entry.get("reason") == "mark"]
    assert len(mark_entries) == 4
    assert {entry["meta"].get("part_label") for entry in mark_entries} == {"a", "b", "c", "d"}


def test_multipart_first_attempt_starts_a_fresh_answer_round(tutor):
    """A repeated question must not revive answers from an older incomplete round."""
    student_id = f"{STUDENT_ID}-fresh-round"

    old_round = tutor.mark(
        "multipart_test_001",
        "a: 6",
        student_id=student_id,
    )
    old_round = tutor.mark(
        "multipart_test_001",
        "b: 999",
        student_id=student_id,
    )
    assert [part["student_answer"] for part in old_round["part_results"]] == ["6", "999", ""]
    old_attempt_id = old_round["attempt_id"]

    fresh_round = tutor.mark(
        "multipart_test_001",
        "a: 6",
        student_id=student_id,
        first_attempt=True,
    )

    assert fresh_round["attempt_id"] != old_attempt_id
    assert fresh_round["score"] == 1
    assert [part["student_answer"] for part in fresh_round["part_results"]] == ["6", "", ""]
    assert [part["outcome"] for part in fresh_round["part_results"]] == [
        "correct",
        "unanswered",
        "unanswered",
    ]

    continued_round = tutor.mark(
        "multipart_test_001",
        "b: 10",
        student_id=student_id,
        first_attempt=False,
    )

    assert continued_round["attempt_id"] == fresh_round["attempt_id"]
    assert continued_round["score"] == 2
    assert [part["student_answer"] for part in continued_round["part_results"]] == ["6", "10", ""]
