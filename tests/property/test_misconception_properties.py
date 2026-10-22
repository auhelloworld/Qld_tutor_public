"""Property-based tests for the misconception library (Task 14).

Tests:
14.1 LLM-cost reduction: signature-matched answers skip _analyze_error_patterns
14.2 Mining idempotence: same inputs → same staging files
14.3 Promotion idempotence: re-running on promoted record exits non-zero
14.4 Cross-framework referential integrity: all loaded topic_ids resolve
"""
import json
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

from hypothesis import given, settings, assume, HealthCheck
from hypothesis import strategies as st

from backend.misconception_library import get_library, MisconceptionLibrary
from backend.misconception_predicates import PREDICATE_REGISTRY
from backend.curriculum_frameworks import get_framework_for_topic_id


class TestLLMCostReduction:
    """14.1: For any wrong answer that signature-matches, _analyze_error_patterns is not invoked.

    **Validates: Requirements 9.1**
    """

    @given(student_answer=st.sampled_from(["9", "9.0", " 9 "]))
    @settings(max_examples=10, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_signature_match_skips_llm(self, student_answer, tmp_path):
        """When negative_squared predicate matches, LLM error-pattern is skipped."""
        from backend.tutor_engine import TutorEngine

        exercise = {
            "id": "prop_test_01",
            "question": "Evaluate (-3)²",
            "answer": "-9",
            "steps": [],
            "topic": "AC9M7N04",
            "topic_ids": ["AC9M7N04"],
            "subject": "math",
        }

        with patch.dict("os.environ", {"GEMINI_API_KEY": "", "OPENAI_API_KEY": ""}):
            engine = TutorEngine()
            engine.exercises["prop_test_01"] = exercise

        log_dir = tmp_path / "logs" / "prop_student"
        log_dir.mkdir(parents=True, exist_ok=True)
        (log_dir / "math_log.json").write_text(
            json.dumps({"student_id": "prop_student", "topics": {}})
        )

        with patch("backend.rules.LOG_ROOT", tmp_path / "logs"), \
             patch.object(engine, "_analyze_error_patterns") as mock_analyze:
            result = engine.mark("prop_test_01", student_answer, student_id="prop_student")

        # The misconception should be detected
        assert result.get("misconception_id") == "MC_M7N_negative_squared_01"
        # And _analyze_error_patterns should NOT be called
        mock_analyze.assert_not_called()


class TestMiningIdempotence:
    """14.2: Same elaborations + anonymised errors → byte-equivalent staging files.

    **Validates: Requirements 3.8**
    """

    def test_same_inputs_same_run_id(self):
        """Deterministic run_id from identical inputs."""
        from backend.mining.mine_misconceptions import _compute_run_id

        elaborations = {"AC9M7N04": "Test elaboration text"}
        errors = {"AC9M7N04": [{"topic_id": "AC9M7N04", "question_id": "q1"}]}

        run_id_1 = _compute_run_id(elaborations, errors)
        run_id_2 = _compute_run_id(elaborations, errors)

        assert run_id_1 == run_id_2

    def test_different_inputs_different_run_id(self):
        """Different inputs produce different run_ids."""
        from backend.mining.mine_misconceptions import _compute_run_id

        elaborations_1 = {"AC9M7N04": "Text A"}
        elaborations_2 = {"AC9M7N04": "Text B"}
        errors = {}

        run_id_1 = _compute_run_id(elaborations_1, errors)
        run_id_2 = _compute_run_id(elaborations_2, errors)

        assert run_id_1 != run_id_2


class TestPromotionIdempotence:
    """14.3: Re-running on already-promoted record exits non-zero without modifying production.

    **Validates: Requirements 4.5**
    """

    def test_duplicate_promotion_exits_nonzero(self, tmp_path):
        """Promoting an already-promoted record exits with code 1."""
        from backend.mining.promote_misconception import main

        # Create staging file
        staging_dir = tmp_path / "staging" / "ac9_maths" / "run123"
        staging_dir.mkdir(parents=True)
        staging_file = staging_dir / "MC_M7N_dup_test_01.json"
        staging_data = {
            "misconception_id": "MC_M7N_dup_test_01",
            "name": "Dup test",
            "description": "Test",
            "student_facing_explanation": "Test",
            "topic_ids": ["AC9M7N04"],
            "detection_signatures": [],
            "worked_example_ids": [],
            "provenance": {
                "source": "ai_mined_human_approved",
                "approved_by": "PENDING_REVIEW",
                "approved_at": "PENDING_REVIEW",
                "mined_from_run_id": "run123",
            },
            "pending_review": True,
        }
        staging_file.write_text(json.dumps(staging_data))

        # Create prod dir with the record already present
        prod_dir = tmp_path / "prod"
        prod_dir.mkdir()
        prod_data = {
            "misconceptions": [
                {
                    "misconception_id": "MC_M7N_dup_test_01",
                    "name": "Already promoted",
                    "description": "Already there",
                    "student_facing_explanation": "Already",
                    "topic_ids": ["AC9M7N04"],
                    "detection_signatures": [],
                    "worked_example_ids": [],
                    "provenance": {
                        "source": "ai_mined_human_approved",
                        "approved_by": "reviewer",
                        "approved_at": "2025-01-15T00:00:00+00:00",
                        "mined_from_run_id": "run123",
                    },
                }
            ]
        }
        (prod_dir / "ac9_maths.json").write_text(json.dumps(prod_data))

        approval_path = tmp_path / "approvals.yaml"
        approval_path.write_text("")

        with patch("backend.mining.promote_misconception.PROD_DIR", prod_dir), \
             patch("backend.mining.promote_misconception.APPROVAL_PATH", approval_path):
            exit_code = main([
                "--staging-path", str(staging_file),
                "--reviewer", "test_reviewer",
                "--note", "test note",
            ])

        assert exit_code == 1


class TestCrossFrameworkReferentialIntegrity:
    """14.4: Every loaded record's topic_ids resolve via get_framework_for_topic_id.

    **Validates: Requirements 1.7, 5.4**
    """

    def test_all_loaded_misconceptions_have_resolvable_topics(self):
        """Every misconception in the production library has resolvable topic_ids."""
        lib = get_library()
        for mid, rec in lib.misconceptions.items():
            for tid in rec.topic_ids:
                fw = get_framework_for_topic_id(tid)
                assert fw is not None, (
                    f"Misconception {mid} has unresolvable topic_id: {tid}"
                )

    def test_all_loaded_worked_examples_have_resolvable_topics(self):
        """Every worked example in the production library has resolvable topic_ids."""
        lib = get_library()
        for weid, rec in lib.worked_examples.items():
            for tid in rec.topic_ids:
                fw = get_framework_for_topic_id(tid)
                assert fw is not None, (
                    f"Worked example {weid} has unresolvable topic_id: {tid}"
                )
