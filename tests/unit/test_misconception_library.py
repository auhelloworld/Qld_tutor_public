"""Unit tests for backend/misconception_library.py (Task 12.3).

Tests: load, duplicate detection, unresolvable topic detection, unapproved warning.
"""
import json
import logging
import pytest
from pathlib import Path
from unittest.mock import patch

from backend.misconception_library import MisconceptionLibrary, PROD_DIR, WE_DIR, APPROVAL_PATH


@pytest.fixture
def tmp_misconception_dirs(tmp_path):
    """Create temporary misconception directories with test data."""
    prod_dir = tmp_path / "prod"
    prod_dir.mkdir()
    we_dir = tmp_path / "worked_examples"
    we_dir.mkdir()
    approval_path = tmp_path / "approvals.yaml"

    # Write a valid misconception file
    mc_data = {
        "misconceptions": [
            {
                "misconception_id": "MC_M7N_test_thing_01",
                "name": "Test misconception",
                "description": "A test description",
                "student_facing_explanation": "A student explanation",
                "topic_ids": ["AC9M7N04"],
                "detection_signatures": [
                    {"kind": "regex", "pattern": "^9$", "notes": "test"}
                ],
                "worked_example_ids": [],
                "provenance": {
                    "source": "hand_curated",
                    "approved_by": "seed",
                    "approved_at": "2025-01-15T00:00:00+00:00",
                },
            }
        ]
    }
    (prod_dir / "ac9_maths.json").write_text(json.dumps(mc_data))

    # Write approvals
    import yaml
    approvals = {
        "MC_M7N_test_thing_01": {
            "reviewer": "seed",
            "approved_at": "2025-01-15T00:00:00+00:00",
            "note": "test",
        }
    }
    approval_path.write_text(yaml.safe_dump(approvals))

    return prod_dir, we_dir, approval_path


class TestMisconceptionLibraryLoad:
    def test_loads_valid_records(self, tmp_misconception_dirs):
        """Library loads successfully against a small fixture directory."""
        prod_dir, we_dir, approval_path = tmp_misconception_dirs

        with patch("backend.misconception_library.PROD_DIR", prod_dir), \
             patch("backend.misconception_library.WE_DIR", we_dir), \
             patch("backend.misconception_library.APPROVAL_PATH", approval_path):
            lib = MisconceptionLibrary()

        assert "MC_M7N_test_thing_01" in lib.misconceptions
        assert "AC9M7N04" in lib.by_topic_id
        assert len(lib.by_topic_id["AC9M7N04"]) == 1

    def test_duplicate_misconception_id_caught(self, tmp_misconception_dirs, caplog):
        """Duplicate misconception_id is caught and logged."""
        prod_dir, we_dir, approval_path = tmp_misconception_dirs

        # Add a second file with the same misconception_id
        mc_data = {
            "misconceptions": [
                {
                    "misconception_id": "MC_M7N_test_thing_01",
                    "name": "Duplicate",
                    "description": "Duplicate desc",
                    "student_facing_explanation": "Dup explanation",
                    "topic_ids": ["AC9M7N04"],
                    "detection_signatures": [],
                    "worked_example_ids": [],
                    "provenance": {
                        "source": "hand_curated",
                        "approved_by": "seed",
                        "approved_at": "2025-01-15T00:00:00+00:00",
                    },
                }
            ]
        }
        (prod_dir / "duplicate.json").write_text(json.dumps(mc_data))

        with patch("backend.misconception_library.PROD_DIR", prod_dir), \
             patch("backend.misconception_library.WE_DIR", we_dir), \
             patch("backend.misconception_library.APPROVAL_PATH", approval_path):
            with caplog.at_level(logging.ERROR):
                lib = MisconceptionLibrary()

        assert "Duplicate misconception_id" in caplog.text
        # Only one record should be loaded
        assert len(lib.misconceptions) == 1

    def test_unresolvable_topic_id_caught(self, tmp_misconception_dirs, caplog):
        """Unresolvable topic_id is caught and record is skipped."""
        prod_dir, we_dir, approval_path = tmp_misconception_dirs

        mc_data = {
            "misconceptions": [
                {
                    "misconception_id": "MC_M7N_bad_topic_01",
                    "name": "Bad topic",
                    "description": "Has unresolvable topic",
                    "student_facing_explanation": "Explanation",
                    "topic_ids": ["INVALID_TOPIC_ID"],
                    "detection_signatures": [],
                    "worked_example_ids": [],
                    "provenance": {
                        "source": "hand_curated",
                        "approved_by": "seed",
                        "approved_at": "2025-01-15T00:00:00+00:00",
                    },
                }
            ]
        }
        (prod_dir / "bad_topics.json").write_text(json.dumps(mc_data))

        with patch("backend.misconception_library.PROD_DIR", prod_dir), \
             patch("backend.misconception_library.WE_DIR", we_dir), \
             patch("backend.misconception_library.APPROVAL_PATH", approval_path):
            with caplog.at_level(logging.ERROR):
                lib = MisconceptionLibrary()

        assert "unresolvable topic_ids" in caplog.text
        assert "MC_M7N_bad_topic_01" not in lib.misconceptions

    def test_unapproved_record_produces_warning(self, tmp_misconception_dirs, caplog):
        """Unapproved record produces a warning but still loads."""
        prod_dir, we_dir, approval_path = tmp_misconception_dirs

        mc_data = {
            "misconceptions": [
                {
                    "misconception_id": "MC_M7N_unapproved_01",
                    "name": "Unapproved",
                    "description": "Not in approvals",
                    "student_facing_explanation": "Explanation",
                    "topic_ids": ["AC9M7N04"],
                    "detection_signatures": [],
                    "worked_example_ids": [],
                    "provenance": {
                        "source": "hand_curated",
                        "approved_by": "seed",
                        "approved_at": "2025-01-15T00:00:00+00:00",
                    },
                }
            ]
        }
        (prod_dir / "unapproved.json").write_text(json.dumps(mc_data))

        with patch("backend.misconception_library.PROD_DIR", prod_dir), \
             patch("backend.misconception_library.WE_DIR", we_dir), \
             patch("backend.misconception_library.APPROVAL_PATH", approval_path):
            with caplog.at_level(logging.WARNING):
                lib = MisconceptionLibrary()

        assert "Unapproved misconception" in caplog.text
        # Record should still be loaded
        assert "MC_M7N_unapproved_01" in lib.misconceptions
