"""Unit tests for ``backend/migrations/migrate_ac9_maths.py``.

Exercises ``_parse_alignment_matrix`` against a minimal synthetic markdown
table inline in the test, plus the strand-letter → strand-name mapping for
every AC9 strand.

These tests stay focused on the parser itself; the end-to-end idempotence
of the migration script (write-once, write-zero on re-run) is covered by
the verification gate in tasks.md, not here.
"""

from __future__ import annotations

import textwrap

import pytest

from backend.migrations.migrate_ac9_maths import (
    AC9MathsMigration,
    _STRAND_NAME_BY_LETTER,
    _strand_for,
)


# ---------------------------------------------------------------------------
# Synthetic table fixture
# ---------------------------------------------------------------------------


def _table(rows: str) -> str:
    """Embed ``rows`` in a minimal valid alignment-matrix markdown table."""
    return textwrap.dedent(
        """
        # Some heading

        Preamble that should be ignored.

        | Achievement Standard Aspect | Relevant Content Description/s | AC v9.0 Code |
        | :--- | :--- | :--- |
        """
    ) + rows + "\n\nTrailing prose after a blank line.\n"


# ---------------------------------------------------------------------------
# _parse_alignment_matrix: single-row happy path
# ---------------------------------------------------------------------------


def test_parse_single_row_extracts_one_candidate_per_code():
    text = _table(
        "| **Aspect one.** Sentence two. | • Description A<br>• Description B | "
        "AC9M7N04<br>AC9M7N06 |"
    )

    candidates = AC9MathsMigration()._parse_alignment_matrix(text)
    by_id = {c.topic_id: c.payload for c in candidates}

    assert set(by_id) == {"AC9M7N04", "AC9M7N06"}

    n04 = by_id["AC9M7N04"]
    assert n04["framework"] == "AC9_MATHS"
    assert n04["year_level"] == 7
    assert n04["strand"] == "Number"
    # Aspect markers stripped, multi-sentence aspect collapses to first
    # sentence for the topic name.
    assert n04["name"] == "Aspect one"
    assert n04["achievement_standard_text"] == "Aspect one. Sentence two."
    # Descriptions aligned by index when len(descs) == len(codes).
    assert n04["content_descriptor_text"] == "Description A"
    assert by_id["AC9M7N06"]["content_descriptor_text"] == "Description B"

    # Default-empty fields populated.
    assert n04["elaborations"] == []
    assert n04["supplementary_resources"] == []
    assert n04["skills"] == []
    assert n04["concept_card"] == {"core_rule": "", "hint_levels": []}


# ---------------------------------------------------------------------------
# Multi-row dedup: " | "-joined achievement_standard_text, single candidate
# ---------------------------------------------------------------------------


def test_multi_row_dedup_joins_aspects_with_pipe_separator():
    rows = (
        "| **First aspect.** | • First descriptor | AC9M7N04 |\n"
        "| **Second aspect.** | • Second descriptor | AC9M7N04 |"
    )
    text = _table(rows)

    candidates = AC9MathsMigration()._parse_alignment_matrix(text)

    assert len(candidates) == 1
    payload = candidates[0].payload
    assert payload["topic_id"] == "AC9M7N04"
    assert payload["achievement_standard_text"] == "First aspect. | Second aspect."
    # Later row wins for the descriptor.
    assert payload["content_descriptor_text"] == "Second descriptor"
    # Name is taken from the first row.
    assert payload["name"] == "First aspect"


# ---------------------------------------------------------------------------
# Multi-row dedup: descriptor count matches codes per row, not across rows
# ---------------------------------------------------------------------------


def test_descriptions_join_when_count_mismatches_codes():
    # Two codes in this row but three descriptions, so the parser falls
    # back to joining descriptions for both codes.
    text = _table(
        "| **Aspect** | • Desc A<br>• Desc B<br>• Desc C | AC9M7N04<br>AC9M7N06 |"
    )

    candidates = AC9MathsMigration()._parse_alignment_matrix(text)
    by_id = {c.topic_id: c.payload for c in candidates}

    expected_descriptor = "Desc A Desc B Desc C"
    assert by_id["AC9M7N04"]["content_descriptor_text"] == expected_descriptor
    assert by_id["AC9M7N06"]["content_descriptor_text"] == expected_descriptor


# ---------------------------------------------------------------------------
# Document order preserved across dedup
# ---------------------------------------------------------------------------


def test_first_appearance_order_preserved_after_dedup():
    rows = (
        "| **A** | • d1 | AC9M7N04 |\n"
        "| **B** | • d2 | AC9M7A03 |\n"
        "| **C** | • d3 | AC9M7N04 |\n"  # duplicate — must not move N04
        "| **D** | • d4 | AC9M7M01 |"
    )
    text = _table(rows)

    candidates = AC9MathsMigration()._parse_alignment_matrix(text)
    order = [c.topic_id for c in candidates]
    assert order == ["AC9M7N04", "AC9M7A03", "AC9M7M01"]


# ---------------------------------------------------------------------------
# Strand-letter mapping covers every AC9 strand
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "topic_id, expected_strand",
    [
        ("AC9M7N04", "Number"),
        ("AC9M7A03", "Algebra"),
        ("AC9M7M01", "Measurement"),
        ("AC9M7SP02", "Space"),
        ("AC9M7ST01", "Statistics"),
        ("AC9M7P01", "Probability"),
    ],
)
def test_strand_for_maps_every_ac9_strand_letter(topic_id, expected_strand):
    assert _strand_for(topic_id) == expected_strand


def test_strand_name_by_letter_table_is_complete():
    # Sanity: the keys cover the six AC9 Maths strand letters and nothing else.
    assert set(_STRAND_NAME_BY_LETTER) == {"N", "A", "M", "SP", "ST", "P"}


# ---------------------------------------------------------------------------
# Bullet stripping
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw_descriptor, expected",
    [
        ("• A bullet", "A bullet"),
        ("* A star", "A star"),
        ("- A dash", "A dash"),
        ("Plain text", "Plain text"),
    ],
)
def test_bullet_prefixes_stripped_from_descriptors(raw_descriptor, expected):
    text = _table(f"| **Aspect** | {raw_descriptor} | AC9M7N04 |")
    [candidate] = AC9MathsMigration()._parse_alignment_matrix(text)
    assert candidate.payload["content_descriptor_text"] == expected


# ---------------------------------------------------------------------------
# Empty-aspect fallback to topic_id as name
# ---------------------------------------------------------------------------


def test_empty_aspect_falls_back_to_topic_id_for_name():
    text = _table("|  | • desc | AC9M7N04 |")
    [candidate] = AC9MathsMigration()._parse_alignment_matrix(text)
    assert candidate.payload["name"] == "AC9M7N04"
    assert candidate.payload["achievement_standard_text"] == ""
