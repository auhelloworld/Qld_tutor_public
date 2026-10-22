"""Quality gate: every Year 7 English exercise must have a valid english_metadata.facet.

Audit Packet 1.2 — prevents future English content from being metadata-blind.
The allowed facets are defined by EnglishExerciseMetadata in exercise_schema.py.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from typing import get_args

from core.schema.exercise_schema import EnglishExerciseMetadata
from backend.content_authoring.stimulus_loader import (
    FORBIDDEN_RECORD_FIELDS,
    validate_stimulus_library,
)

_DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"
_ENGLISH_EXERCISE_FILE = _DATA_DIR / "exercise_7_english.json"
_ENGLISH_STIMULI_FILE = _DATA_DIR / "english_stimuli.json"
_YEAR7_ENGLISH_CURRICULUM_FILE = _DATA_DIR / "curriculum" / "ac9_english" / "year7.json"
_YEAR8_ENGLISH_CURRICULUM_FILE = _DATA_DIR / "curriculum" / "ac9_english" / "year8.json"

# Extract allowed facets from the schema's Literal type
_facet_annotation = EnglishExerciseMetadata.model_fields["facet"].annotation
_literal_type = next(a for a in get_args(_facet_annotation) if a is not type(None))
_ALLOWED_FACETS = set(get_args(_literal_type))


@pytest.fixture(scope="module")
def english_exercises() -> list[dict]:
    """Load all Year 7 English exercises once per module."""
    if not _ENGLISH_EXERCISE_FILE.exists():
        pytest.skip("exercise_7_english.json not found")
    data = json.loads(_ENGLISH_EXERCISE_FILE.read_text(encoding="utf-8"))
    assert isinstance(data, list), "Exercise file must contain a JSON array"
    return data


@pytest.fixture(scope="module")
def english_stimuli() -> dict[str, dict]:
    """Load and validate the structured Year 7 English stimulus library."""
    if not _ENGLISH_STIMULI_FILE.exists():
        pytest.skip("english_stimuli.json not found")
    raw = json.loads(_ENGLISH_STIMULI_FILE.read_text(encoding="utf-8"))
    return validate_stimulus_library(raw)


@pytest.fixture(scope="module")
def english_curriculum_topic_ids() -> set[str]:
    """All authored AC9 English topic ids (Years 7-10).

    The structured stimulus library now serves every secondary year, so stimulus
    curriculum links must be validated against the full set, not just Y7/Y8.
    """
    ac9_english_dir = _YEAR7_ENGLISH_CURRICULUM_FILE.parent
    ids: set[str] = set()
    for year_file in sorted(ac9_english_dir.glob("year*.json")):
        raw = json.loads(year_file.read_text(encoding="utf-8"))
        ids |= {topic["topic_id"] for topic in raw.get("topics", [])}
    return ids


class TestEnglishMetadataQualityGate:
    """Every Year 7 English exercise must carry a valid facet tag."""

    def test_all_exercises_have_english_metadata(self, english_exercises):
        exercises_missing_metadata = [
            ex["id"] for ex in english_exercises
            if ex.get("subject") == "english"
            and ex.get("year_level") == 7
            and not ex.get("english_metadata")
        ]
        assert not exercises_missing_metadata, (
            f"{len(exercises_missing_metadata)} exercises missing english_metadata: "
            f"{exercises_missing_metadata[:10]}..."
        )

    def test_all_exercises_have_valid_facet(self, english_exercises):
        exercises_with_invalid_facet = []
        for ex in english_exercises:
            if ex.get("subject") != "english" or ex.get("year_level") != 7:
                continue
            meta = ex.get("english_metadata") or {}
            facet = meta.get("facet")
            if facet not in _ALLOWED_FACETS:
                exercises_with_invalid_facet.append({
                    "id": ex["id"],
                    "facet": facet,
                })
        assert not exercises_with_invalid_facet, (
            f"{len(exercises_with_invalid_facet)} exercises have invalid/missing facet: "
            f"{exercises_with_invalid_facet[:10]}..."
        )

    def test_all_exercises_have_complexity_for_adaptive_selection(self, english_exercises):
        missing_complexity = [
            ex["id"] for ex in english_exercises
            if ex.get("subject") == "english"
            and ex.get("year_level") == 7
            and ex.get("complexity") not in {
                "simple_familiar",
                "complex_familiar",
                "complex_unfamiliar",
            }
        ]
        assert not missing_complexity, (
            f"{len(missing_complexity)} exercises missing valid complexity: "
            f"{missing_complexity[:10]}..."
        )

    def test_language_convention_items_have_grammar_focus(self, english_exercises):
        missing_focus = []
        for ex in english_exercises:
            if ex.get("subject") != "english" or ex.get("year_level") != 7:
                continue
            meta = ex.get("english_metadata") or {}
            if meta.get("facet") in {"language_conventions", "spelling_punctuation", "vocabulary"}:
                if not meta.get("grammar_focus"):
                    missing_focus.append(ex["id"])

        assert not missing_focus, (
            f"{len(missing_focus)} language/vocabulary exercises missing grammar_focus: "
            f"{missing_focus[:10]}..."
        )

    def test_writing_structure_items_have_writing_skill(self, english_exercises):
        missing_skill = []
        for ex in english_exercises:
            if ex.get("subject") != "english" or ex.get("year_level") != 7:
                continue
            meta = ex.get("english_metadata") or {}
            if meta.get("facet") == "writing_structure" and not meta.get("writing_skill"):
                missing_skill.append(ex["id"])

        assert not missing_skill, (
            f"{len(missing_skill)} writing-structure exercises missing writing_skill: "
            f"{missing_skill[:10]}..."
        )

    def test_facet_distribution_covers_all_facets(self, english_exercises):
        """Ensure every allowed facet has at least one exercise."""
        facet_counts: dict[str, int] = {}
        for ex in english_exercises:
            if ex.get("subject") != "english" or ex.get("year_level") != 7:
                continue
            meta = ex.get("english_metadata") or {}
            facet = meta.get("facet")
            if facet:
                facet_counts[facet] = facet_counts.get(facet, 0) + 1

        uncovered = _ALLOWED_FACETS - set(facet_counts.keys())
        assert not uncovered, (
            f"Facets with zero exercises: {uncovered}. "
            "Each facet needs at least one exercise for balanced exam generation."
        )

    def test_bank_has_real_useful_minimum_scale(self, english_exercises):
        year7_items = [
            ex for ex in english_exercises
            if ex.get("subject") == "english" and ex.get("year_level") == 7
        ]
        topic_counts: dict[str, int] = {}
        source_based_count = 0
        for ex in year7_items:
            for topic_id in ex.get("topic_ids", []):
                topic_counts[topic_id] = topic_counts.get(topic_id, 0) + 1
            passage = (ex.get("english_metadata") or {}).get("passage")
            if isinstance(passage, str) and passage.startswith("ST-EN-"):
                source_based_count += 1

        # Year 7 English was deliberately pruned for quality (see prune_refresh_year7_english).
        # The floor reflects the post-prune bank; the structural guarantees below
        # (full 24-topic coverage, >=20 per topic, >=250 source-based) are the real quality gate.
        assert len(year7_items) >= 590
        assert len(topic_counts) == 24
        assert min(topic_counts.values()) >= 20
        assert source_based_count >= 250

    def test_facet_matches_topic_id_intent(self, english_exercises):
        """Spot-check that facet aligns with topic ID patterns.

        Reading topics (AC9E7LE*) should mostly be reading_comprehension or text_evidence.
        Language topics about punctuation (AC9E7LA09) should be spelling_punctuation.
        """
        reading_topic_reading_facet = {"reading_comprehension", "text_evidence", "vocabulary"}
        mismatches = []
        for ex in english_exercises:
            if ex.get("subject") != "english" or ex.get("year_level") != 7:
                continue
            topic_ids = ex.get("topic_ids", [])
            meta = ex.get("english_metadata") or {}
            facet = meta.get("facet")
            if not facet:
                continue
            # AC9E7LE* topics should have reading-side facets
            if all(tid.startswith("AC9E7LE") for tid in topic_ids):
                if facet not in reading_topic_reading_facet and facet != "writing_structure":
                    mismatches.append({"id": ex["id"], "facet": facet, "topics": topic_ids})

        assert len(mismatches) < 5, (
            f"{len(mismatches)} reading-topic exercises have unexpected facets: "
            f"{mismatches[:5]}"
        )

    def test_stimulus_sidecar_uses_v2_structured_records(self, english_stimuli):
        assert len(english_stimuli) >= 38
        assert all(isinstance(record, dict) for record in english_stimuli.values())
        assert all(
            record.get("student_display", {}).get("plain_text")
            for record in english_stimuli.values()
        )

    def test_stimulus_curriculum_links_are_ac9_english(
        self,
        english_stimuli,
        english_curriculum_topic_ids,
    ):
        invalid_links = []
        for stimulus_id, record in english_stimuli.items():
            for topic_id in record.get("curriculum_links", []):
                if topic_id not in english_curriculum_topic_ids:
                    invalid_links.append({"id": stimulus_id, "topic_id": topic_id})
        assert not invalid_links, f"Invalid stimulus curriculum links: {invalid_links[:10]}"

    def test_all_sidecar_references_resolve_to_plain_text(
        self,
        english_exercises,
        english_stimuli,
    ):
        unresolved = []
        for ex in english_exercises:
            passage = (ex.get("english_metadata") or {}).get("passage")
            if not isinstance(passage, str) or not passage.startswith("ST-EN-"):
                continue
            record = english_stimuli.get(passage)
            plain_text = (record or {}).get("student_display", {}).get("plain_text")
            if not isinstance(plain_text, str) or not plain_text.strip():
                unresolved.append({"id": ex["id"], "passage": passage})
        assert not unresolved, f"Unresolved stimulus references: {unresolved[:10]}"

    def test_stimuli_do_not_carry_answers_or_rubrics(self, english_stimuli):
        leaked_fields = []
        for stimulus_id, record in english_stimuli.items():
            forbidden = sorted(FORBIDDEN_RECORD_FIELDS & set(record))
            if forbidden:
                leaked_fields.append({"id": stimulus_id, "fields": forbidden})
        assert not leaked_fields, f"Stimuli contain answer/rubric fields: {leaked_fields}"

    def test_at_least_24_exercises_use_multimodal_stimuli(
        self,
        english_exercises,
        english_stimuli,
    ):
        multimodal_ids = {
            stimulus_id
            for stimulus_id, record in english_stimuli.items()
            if record.get("visual_elements") and record.get("layout_features")
        }
        multimodal_exercises = [
            ex["id"]
            for ex in english_exercises
            if (ex.get("english_metadata") or {}).get("passage") in multimodal_ids
        ]
        assert len(multimodal_exercises) >= 24, (
            f"Expected at least 24 multimodal stimulus exercises, found "
            f"{len(multimodal_exercises)}"
        )
