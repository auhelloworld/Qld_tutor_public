"""Verification gate for Task 4 — `backend/migrations/base.py`.

Drives ``BaseFrameworkMigration`` through an in-memory subclass against a
``tmp_path`` fixture and asserts:

- one write on first run, zero writes on second run (idempotence — Req 7.4 /
  7.5);
- invalid Topic_Ids are filtered with the right ``skipped_reasons`` counter
  (Req 7.10);
- ``_merge_preserve_manual`` keeps hand-edited ``concept_card.core_rule`` and
  ``skills`` from the prior slice;
- ``canonical_dump`` is order-stable;
- ``_write_if_changed`` reports ``False`` on no-op writes.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.migrations.base import (
    BaseFrameworkMigration,
    MigrationRunSummary,
    TopicCandidate,
)
from core.schema.curriculum_schema import CurriculumSequence


# ---------------------------------------------------------------------------
# Fixtures: candidates + in-memory subclass
# ---------------------------------------------------------------------------


def _ac9_maths_payload(topic_id: str) -> dict:
    """Return a minimal payload that satisfies ``AC9MathsTopic``.

    Strand ``Number`` is correct for any AC9M*N* code; we use it everywhere
    so the schema-side discriminator never trips, even on intentionally
    invalid topic_ids that get filtered before validation anyway.
    """
    return {
        "framework": "AC9_MATHS",
        "topic_id": topic_id,
        "name": f"Test topic {topic_id}",
        "strand": "Number",
        "year_level": 7,
        "achievement_standard_text": "Achievement standard for " + topic_id,
        "content_descriptor_text": "Content descriptor for " + topic_id,
    }


class _FakeMigration(BaseFrameworkMigration):
    """Minimal in-memory subclass for the verification gate.

    Writes a single slice at ``<root>/ac9_maths/year7.json`` and emits one
    valid + one invalid candidate so we exercise both the happy path and
    the validator-filter path in a single ``run()``.
    """

    def __init__(
        self,
        root: Path,
        candidates: list[TopicCandidate] | None = None,
    ) -> None:
        self._root = root
        self._candidates = candidates if candidates is not None else [
            TopicCandidate(
                topic_id="AC9M7N04",
                payload=_ac9_maths_payload("AC9M7N04"),
            ),
            TopicCandidate(
                topic_id="AC9X99X99",  # rejected by AC9_MATHS validator
                payload=_ac9_maths_payload("AC9X99X99"),
            ),
        ]

    def framework_id(self) -> str:
        return "AC9_MATHS"

    def parse_source_documents(self) -> list[TopicCandidate]:
        return self._candidates

    def output_path_for(self, candidate: TopicCandidate) -> Path:
        return self._root / "ac9_maths" / "year7.json"

    def sequence_for(
        self,
        slice_path: Path,
        candidates: list[TopicCandidate],
    ) -> CurriculumSequence:
        return CurriculumSequence(
            sequence=[c.topic_id for c in candidates],
            prerequisites={},
            is_strict=False,
        )


# ---------------------------------------------------------------------------
# run() end-to-end: counts + idempotence
# ---------------------------------------------------------------------------


def test_run_writes_once_then_is_idempotent(tmp_path):
    migration = _FakeMigration(tmp_path)
    out_path = tmp_path / "ac9_maths" / "year7.json"

    first = migration.run()

    assert isinstance(first, MigrationRunSummary)
    assert first.extracted == 2
    assert first.written == 1
    assert first.skipped == 1
    assert first.skipped_reasons == {"validator_rejected": 1}
    assert out_path.exists()

    # Persisted slice contains exactly the one valid topic and a sequence
    # with that single topic_id.
    on_disk = json.loads(out_path.read_text(encoding="utf-8"))
    assert on_disk["framework_id"] == "AC9_MATHS"
    assert [t["topic_id"] for t in on_disk["topics"]] == ["AC9M7N04"]
    assert on_disk["sequence"]["sequence"] == ["AC9M7N04"]
    assert on_disk["sequence"]["is_strict"] is False

    # Second run: same inputs, byte-equivalent canonical output, so no write.
    second = migration.run()
    assert second.extracted == 2
    assert second.written == 0
    assert second.skipped == 1
    assert second.skipped_reasons == {"validator_rejected": 1}


# ---------------------------------------------------------------------------
# _merge_preserve_manual: keeps hand-edited core_rule + skills
# ---------------------------------------------------------------------------


def test_merge_preserve_manual_keeps_core_rule_and_skills(tmp_path):
    out_path = tmp_path / "ac9_maths" / "year7.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Pre-populate the slice with a topic that carries hand-edited teaching
    # content. Stored as raw JSON because _load_existing doesn't validate.
    prior_topic = _ac9_maths_payload("AC9M7N04")
    prior_topic["concept_card"] = {
        "core_rule": "manual rule",
        "hint_levels": [],
    }
    prior_topic["skills"] = ["manual_skill"]
    prior_slice = {
        "framework_id": "AC9_MATHS",
        "topics": [prior_topic],
        "sequence": {
            "sequence": ["AC9M7N04"],
            "prerequisites": {},
            "is_strict": False,
        },
    }
    out_path.write_text(json.dumps(prior_slice, indent=2), encoding="utf-8")

    # Re-run the migration. The candidate carries an empty concept_card and
    # empty skills list, so without preservation it would clobber the
    # hand-edits.
    candidate_payload = _ac9_maths_payload("AC9M7N04")
    candidate_payload["concept_card"] = {"core_rule": "", "hint_levels": []}
    candidate_payload["skills"] = []
    migration = _FakeMigration(
        tmp_path,
        candidates=[
            TopicCandidate(topic_id="AC9M7N04", payload=candidate_payload)
        ],
    )

    summary = migration.run()
    assert summary.written == 1
    assert summary.skipped == 0

    rewritten = json.loads(out_path.read_text(encoding="utf-8"))
    [topic] = rewritten["topics"]
    assert topic["concept_card"]["core_rule"] == "manual rule"
    assert topic["skills"] == ["manual_skill"]
    # Non-preserved fields still come from the candidate.
    assert topic["achievement_standard_text"] == "Achievement standard for AC9M7N04"


# ---------------------------------------------------------------------------
# canonical_dump: insertion-order-independent
# ---------------------------------------------------------------------------


def test_canonical_dump_is_key_order_independent():
    a = {"b": 1, "a": {"y": 2, "x": 1}}
    b = {"a": {"x": 1, "y": 2}, "b": 1}

    dumped_a = BaseFrameworkMigration.canonical_dump(a)
    dumped_b = BaseFrameworkMigration.canonical_dump(b)

    assert dumped_a == dumped_b
    # Trailing newline is part of the contract (so files end on \n cleanly).
    assert dumped_a.endswith("\n")


# ---------------------------------------------------------------------------
# _write_if_changed: returns False on identical content
# ---------------------------------------------------------------------------


def test_write_if_changed_returns_false_when_content_unchanged(tmp_path):
    migration = _FakeMigration(tmp_path)

    # First run writes the file.
    first = migration.run()
    assert first.written == 1

    out_path = tmp_path / "ac9_maths" / "year7.json"

    # Build the same slice object the migration would build and confirm
    # _write_if_changed reports no-op without rewriting the file.
    from core.schema.curriculum_schema import FrameworkSliceFile

    existing = json.loads(out_path.read_text(encoding="utf-8"))
    slice_obj = FrameworkSliceFile.model_validate(existing)

    mtime_before = out_path.stat().st_mtime_ns
    wrote = migration._write_if_changed(out_path, slice_obj)
    mtime_after = out_path.stat().st_mtime_ns

    assert wrote is False
    assert mtime_before == mtime_after
