"""Integration test: mark with misconception detection (Task 13.2).

Verifies that a wrong answer matching a signature returns misconception_id
and does NOT trigger the Phase 3 LLM error-pattern call.
"""
import json
import pytest
from unittest.mock import patch, MagicMock
from pathlib import Path

from backend.tutor_engine import TutorEngine


@pytest.fixture
def tutor_with_exercise(tmp_path):
    """Create a TutorEngine with a test exercise that has topic_ids."""
    # Create a minimal exercise file
    exercise_data = [
        {
            "id": "test_neg_sq_01",
            "question": "Evaluate (-3)²",
            "answer": "-9",
            "steps": [],
            "topic": "AC9M7N04",
            "topic_ids": ["AC9M7N04"],
            "subject": "math",
        }
    ]
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "exercise_test.json").write_text(json.dumps(exercise_data))

    # Patch the project root so TutorEngine finds our test data
    with patch.dict("os.environ", {"GEMINI_API_KEY": "", "OPENAI_API_KEY": ""}):
        engine = TutorEngine()
        # Manually add our test exercise
        engine.exercises["test_neg_sq_01"] = exercise_data[0]

    return engine


class TestMarkWithMisconception:
    def test_signature_match_returns_misconception_id(self, tutor_with_exercise, tmp_path):
        """Wrong answer matching negative_squared produces misconception_id."""
        # Create a temp log directory for the student
        log_dir = tmp_path / "logs" / "test_student"
        log_dir.mkdir(parents=True)
        log_file = log_dir / "math_log.json"
        log_file.write_text(json.dumps({"student_id": "test_student", "topics": {}}))

        with patch("backend.rules.LOG_ROOT", tmp_path / "logs"):
            result = tutor_with_exercise.mark(
                "test_neg_sq_01", "9", student_id="test_student"
            )

        # In mock mode, the LLM returns fallback (is_correct=False)
        # The misconception detection should still run
        assert result.get("misconception_id") == "MC_M7N_negative_squared_01"

    def test_signature_match_skips_error_pattern_analysis(self, tutor_with_exercise, tmp_path):
        """When misconception matches, _analyze_error_patterns is NOT called."""
        log_dir = tmp_path / "logs" / "test_student2"
        log_dir.mkdir(parents=True)
        log_file = log_dir / "math_log.json"
        log_file.write_text(json.dumps({"student_id": "test_student2", "topics": {}}))

        with patch("backend.rules.LOG_ROOT", tmp_path / "logs"), \
             patch.object(tutor_with_exercise, "_analyze_error_patterns") as mock_analyze:
            result = tutor_with_exercise.mark(
                "test_neg_sq_01", "9", student_id="test_student2"
            )

        # _analyze_error_patterns should NOT have been called
        mock_analyze.assert_not_called()
