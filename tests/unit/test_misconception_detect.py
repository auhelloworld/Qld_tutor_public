"""Unit tests for misconception detection (Task 12.4).

Tests signature matching for each kind: regex, numeric, predicate.
"""
import json
import pytest
from unittest.mock import patch

from backend.misconception_library import MisconceptionLibrary


@pytest.fixture
def library_with_signatures(tmp_path):
    """Create a library with one misconception per signature kind."""
    prod_dir = tmp_path / "prod"
    prod_dir.mkdir()
    we_dir = tmp_path / "worked_examples"
    we_dir.mkdir()
    approval_path = tmp_path / "approvals.yaml"

    mc_data = {
        "misconceptions": [
            {
                "misconception_id": "MC_M7N_regex_test_01",
                "name": "Regex test",
                "description": "Tests regex matching",
                "student_facing_explanation": "Explanation",
                "topic_ids": ["AC9M7N04"],
                "detection_signatures": [
                    {"kind": "regex", "pattern": "^9$", "notes": "Matches exactly 9"}
                ],
                "worked_example_ids": [],
                "provenance": {
                    "source": "hand_curated",
                    "approved_by": "seed",
                    "approved_at": "2025-01-15T00:00:00+00:00",
                },
            },
            {
                "misconception_id": "MC_M7N_numeric_test_01",
                "name": "Numeric test",
                "description": "Tests numeric matching",
                "student_facing_explanation": "Explanation",
                "topic_ids": ["AC9M7N06"],
                "detection_signatures": [
                    {
                        "kind": "numeric",
                        "pattern": json.dumps({"op": "abs"}),
                        "notes": "abs match",
                    }
                ],
                "worked_example_ids": [],
                "provenance": {
                    "source": "hand_curated",
                    "approved_by": "seed",
                    "approved_at": "2025-01-15T00:00:00+00:00",
                },
            },
            {
                "misconception_id": "MC_M7N_predicate_test_01",
                "name": "Predicate test",
                "description": "Tests predicate matching",
                "student_facing_explanation": "Explanation",
                "topic_ids": ["AC9M7A03"],
                "detection_signatures": [
                    {
                        "kind": "predicate",
                        "pattern": "negative_squared",
                        "notes": "predicate match",
                    }
                ],
                "worked_example_ids": [],
                "provenance": {
                    "source": "hand_curated",
                    "approved_by": "seed",
                    "approved_at": "2025-01-15T00:00:00+00:00",
                },
            },
        ]
    }
    (prod_dir / "ac9_maths.json").write_text(json.dumps(mc_data))

    import yaml
    approvals = {
        "MC_M7N_regex_test_01": {"reviewer": "seed", "approved_at": "2025-01-15", "note": "test"},
        "MC_M7N_numeric_test_01": {"reviewer": "seed", "approved_at": "2025-01-15", "note": "test"},
        "MC_M7N_predicate_test_01": {"reviewer": "seed", "approved_at": "2025-01-15", "note": "test"},
    }
    approval_path.write_text(yaml.safe_dump(approvals))

    with patch("backend.misconception_library.PROD_DIR", prod_dir), \
         patch("backend.misconception_library.WE_DIR", we_dir), \
         patch("backend.misconception_library.APPROVAL_PATH", approval_path):
        lib = MisconceptionLibrary()

    return lib


class TestDetectRegex:
    def test_regex_match(self, library_with_signatures):
        """Regex signature matches student answer '9'."""
        result = library_with_signatures.detect(
            topic_ids=["AC9M7N04"],
            question={},
            student_answer="9",
            correct_answer="-9",
        )
        assert result == "MC_M7N_regex_test_01"

    def test_regex_no_match(self, library_with_signatures):
        """Regex signature does not match '10'."""
        result = library_with_signatures.detect(
            topic_ids=["AC9M7N04"],
            question={},
            student_answer="10",
            correct_answer="-9",
        )
        assert result is None


class TestDetectNumeric:
    def test_numeric_abs_match(self, library_with_signatures):
        """Numeric abs signature matches when student gives abs(correct)."""
        result = library_with_signatures.detect(
            topic_ids=["AC9M7N06"],
            question={},
            student_answer="5",
            correct_answer="-5",
        )
        assert result == "MC_M7N_numeric_test_01"

    def test_numeric_no_match(self, library_with_signatures):
        """Numeric signature does not match when correct is positive."""
        result = library_with_signatures.detect(
            topic_ids=["AC9M7N06"],
            question={},
            student_answer="5",
            correct_answer="5",
        )
        assert result is None


class TestDetectPredicate:
    def test_predicate_match(self, library_with_signatures):
        """Predicate signature matches via negative_squared predicate."""
        result = library_with_signatures.detect(
            topic_ids=["AC9M7A03"],
            question={},
            student_answer="9",
            correct_answer="-9",
        )
        assert result == "MC_M7N_predicate_test_01"

    def test_predicate_no_match(self, library_with_signatures):
        """Predicate does not match when student gives correct answer."""
        result = library_with_signatures.detect(
            topic_ids=["AC9M7A03"],
            question={},
            student_answer="-9",
            correct_answer="-9",
        )
        assert result is None


class TestDetectNoTopicMatch:
    def test_no_match_for_unrelated_topic(self, library_with_signatures):
        """No match when topic_ids don't overlap with any misconception."""
        result = library_with_signatures.detect(
            topic_ids=["AC9M7SP01"],
            question={},
            student_answer="9",
            correct_answer="-9",
        )
        assert result is None
