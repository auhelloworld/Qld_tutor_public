"""Shared infrastructure for per-framework migration scripts.

Implements design §3.4 of the curriculum-framework-foundation spec. Defines:

- :class:`TopicCandidate` — pre-validation, per-topic payload produced by a
  per-framework parser.
- :class:`MigrationRunSummary` — counts logged at the end of every run.
- :class:`BaseFrameworkMigration` — the ABC every per-framework migration
  script subclasses. Its concrete :meth:`BaseFrameworkMigration.run`
  orchestrates the load → parse → validator-filter → merge-preserve-manual
  → write-if-changed → log pipeline so each subclass only ships parsing
  logic.

Every write goes through :meth:`BaseFrameworkMigration.canonical_dump` so
that two runs over byte-equivalent inputs produce byte-equivalent outputs
(idempotence invariant — Req 7.4 / 7.5 / 7.10).

This module deliberately ships with zero LLM-, network-, or AI-SDK imports
(Req 7.12). The only stdlib imports are ``abc``, ``dataclasses``, ``json``,
``logging``, and ``pathlib``.
"""

from __future__ import annotations

import json
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # pragma: no cover - import-cycle dodge
    from core.schema.curriculum_schema import (
        CurriculumSequence,
        FrameworkSliceFile,
    )


# ---------------------------------------------------------------------------
# Logger
# ---------------------------------------------------------------------------

# Single named logger used by every per-framework migration script. Library
# code attaches a :class:`~logging.NullHandler` so tests and import-time
# usage do not emit "No handler could be found" warnings; per-script
# ``__main__`` blocks (in concrete migration scripts) are responsible for
# attaching a real ``StreamHandler`` when running from the CLI.
logger = logging.getLogger("backend.migrations")
logger.addHandler(logging.NullHandler())


# ---------------------------------------------------------------------------
# Migration-script-internal data classes
# ---------------------------------------------------------------------------


@dataclass
class TopicCandidate:
    """A single topic produced by a parser, prior to Pydantic validation.

    ``topic_id`` is checked against the framework's validator (Req 7.3); if
    it fails, the candidate is dropped before it ever reaches the schema.
    ``payload`` is the full topic dictionary in slice-file shape — i.e.,
    the dict that will be validated against a ``Subject_Topic_Model``
    (one of ``AC9MathsTopic``, ``AC9EnglishTopic``, ...).
    """

    topic_id: str
    payload: dict[str, Any]


@dataclass
class MigrationRunSummary:
    """Counts logged at the end of :meth:`BaseFrameworkMigration.run`.

    Fields:
        extracted:        Number of candidates returned by the parser.
        written:          Number of slice files actually written to disk
                          (i.e., where canonical content differed from the
                          existing on-disk text).
        skipped:          Total candidates dropped before write — equal to
                          ``sum(skipped_reasons.values())``.
        skipped_reasons:  Per-reason histogram, e.g.
                          ``{"validator_rejected": 3}``.
    """

    extracted: int
    written: int
    skipped: int
    skipped_reasons: dict[str, int] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# BaseFrameworkMigration
# ---------------------------------------------------------------------------


class BaseFrameworkMigration(ABC):
    """Shared base class for every per-framework migration script.

    Subclasses implement four small abstract methods; the heavy lifting —
    grouping by output slice, validator filtering, manual-edit preservation,
    canonical serialisation, and idempotent writes — lives in :meth:`run`.
    """

    # --- Subclass surface ---------------------------------------------------

    @abstractmethod
    def framework_id(self) -> str:
        """Return the registered Framework_Id this migration writes to."""

    @abstractmethod
    def parse_source_documents(self) -> list[TopicCandidate]:
        """Parse source documents and return one ``TopicCandidate`` per topic."""

    @abstractmethod
    def output_path_for(self, candidate: TopicCandidate) -> Path:
        """Return the slice file ``candidate`` should be written to.

        E.g. ``Path("data/curriculum/ac9_maths/year7.json")`` for an
        ``AC9_MATHS`` Year 7 candidate.
        """

    @abstractmethod
    def sequence_for(
        self,
        slice_path: Path,
        candidates: list[TopicCandidate],
    ) -> "CurriculumSequence":
        """Return the ``CurriculumSequence`` for the given slice's candidates."""

    # --- Orchestration ------------------------------------------------------

    def run(self) -> MigrationRunSummary:
        """Run the full pipeline for this migration.

        Algorithm:

        1. Resolve ``framework`` from the registry (raises ``KeyError`` if
           ``framework_id()`` is not registered — fail-fast).
        2. Parse all source documents into ``TopicCandidate``s.
        3. Filter candidates by ``framework.validator`` (Req 7.3 / 7.10);
           rejected candidates increment ``skipped_reasons["validator_rejected"]``
           and emit a warning naming the offending Topic_Id.
        4. Group surviving candidates by ``output_path_for(c)``.
        5. For each ``(slice_path, group)``: load the existing slice JSON
           (if any), merge with ``_merge_preserve_manual`` to preserve
           hand-edited concept cards / skills, build the slice via
           ``FrameworkSliceFile``, write only if the canonical serialisation
           differs from the existing on-disk text.
        6. Log the ``MigrationRunSummary`` at INFO level and return it.
        """
        # Lazy imports break the registry → schema → migrations cycle and
        # keep this module free of any registry/schema imports at module
        # load time.
        from backend.curriculum_frameworks import get_framework
        from core.schema.curriculum_schema import FrameworkSliceFile

        framework = get_framework(self.framework_id())

        candidates = self.parse_source_documents()
        summary = MigrationRunSummary(
            extracted=len(candidates),
            written=0,
            skipped=0,
            skipped_reasons={},
        )

        # Validator-filter (Req 7.3 / 7.10)
        per_slice: dict[Path, list[TopicCandidate]] = {}
        for candidate in candidates:
            if not framework.validator(candidate.topic_id):
                summary.skipped += 1
                summary.skipped_reasons["validator_rejected"] = (
                    summary.skipped_reasons.get("validator_rejected", 0) + 1
                )
                logger.warning(
                    "skipping candidate with invalid topic_id %r for framework %s",
                    candidate.topic_id,
                    framework.framework_id,
                )
                continue
            per_slice.setdefault(self.output_path_for(candidate), []).append(
                candidate
            )

        # Group → merge → validate → write-if-changed
        for slice_path, group in per_slice.items():
            existing = self._load_existing(slice_path)
            merged_topics = self._merge_preserve_manual(existing, group)
            sequence = self.sequence_for(slice_path, group)
            slice_obj = FrameworkSliceFile(
                framework_id=self.framework_id(),
                topics=merged_topics,
                sequence=sequence,
            )
            if self._write_if_changed(slice_path, slice_obj):
                summary.written += 1

        logger.info(
            "migration %s complete: extracted=%d written=%d skipped=%d reasons=%s",
            self.framework_id(),
            summary.extracted,
            summary.written,
            summary.skipped,
            summary.skipped_reasons,
        )
        return summary

    # --- Helpers ------------------------------------------------------------

    @staticmethod
    def canonical_dump(payload: dict) -> str:
        """Serialise ``payload`` deterministically (Req 7.4).

        Sorted keys + fixed indent + trailing newline + ``ensure_ascii=False``
        so that two runs over byte-equivalent inputs produce byte-equivalent
        outputs and so that non-ASCII curriculum text (e.g., the en/em dash
        in topic names) survives round-tripping unchanged.
        """
        return json.dumps(payload, sort_keys=True, indent=2, ensure_ascii=False) + "\n"

    def _write_if_changed(
        self,
        path: Path,
        slice_obj: "FrameworkSliceFile",
    ) -> bool:
        """Write ``slice_obj`` to ``path`` only if the canonical form differs.

        Returns ``True`` when a write occurred, ``False`` when the existing
        on-disk text already matches byte-for-byte. Creates parent directories
        as needed (so the first run against a fresh checkout works without a
        manual ``mkdir``).
        """
        new_text = self.canonical_dump(slice_obj.model_dump(mode="json"))
        if path.exists() and path.read_text(encoding="utf-8") == new_text:
            return False
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(new_text, encoding="utf-8")
        return True

    def _load_existing(self, path: Path) -> dict | None:
        """Return the existing slice file as a JSON dict, or ``None``.

        Read-only; the file is not validated against ``FrameworkSliceFile``
        here because :meth:`_merge_preserve_manual` only needs the raw
        ``topics`` list. Validation happens once, at the construction of
        the new ``FrameworkSliceFile`` inside :meth:`run`.
        """
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def _merge_preserve_manual(
        self,
        existing: dict | None,
        group: list[TopicCandidate],
    ) -> list[dict]:
        """Overlay candidate payloads with hand-edited fields from disk.

        For each candidate, if the existing slice already contains a topic
        with the same ``topic_id`` AND that topic carries hand-edited
        teaching content — specifically, a non-empty ``concept_card.core_rule``
        or a non-empty ``skills`` list — those values are preserved on top
        of the candidate's payload. Every other field (achievement-standard
        text, content descriptor, strand, year level, ...) is taken from the
        candidate, so re-running a migration after a source-document update
        still propagates upstream changes.
        """
        existing_topics: dict[str, dict] = {}
        if existing is not None:
            for topic in existing.get("topics", []):
                existing_topics[topic["topic_id"]] = topic

        merged: list[dict] = []
        for candidate in group:
            payload = dict(candidate.payload)
            prior = existing_topics.get(candidate.topic_id)
            if prior is not None:
                prior_card = prior.get("concept_card") or {}
                if prior_card.get("core_rule"):
                    payload["concept_card"] = dict(prior_card)
                prior_skills = prior.get("skills") or []
                if prior_skills:
                    payload["skills"] = list(prior_skills)
            merged.append(payload)
        return merged


class SeniorMigrationStub(BaseFrameworkMigration, ABC):
    """Stub base for QCAA Senior migration scripts (Phase 1).

    Senior frameworks have no source documents in Phase 1. Running a
    concrete subclass prints a not-implemented message to stderr and
    exits with status 1 (Req 7.9). The empty-shell slice files that the
    loader requires are produced by ``bootstrap_senior_shells.py``
    (Task 17.4), not by these stubs.

    Subclasses only need to implement ``framework_id()``; the remaining
    abstract methods are filled in here with stub implementations that
    should never be reached (``parse_source_documents`` exits before
    ``output_path_for`` or ``sequence_for`` are called).
    """

    def parse_source_documents(self) -> list[TopicCandidate]:
        """Print not-implemented message and exit 1."""
        import sys

        msg = f"not implemented in Phase 1 — {self.framework_id()}"
        print(msg, file=sys.stderr)
        sys.exit(1)

    def output_path_for(self, candidate: TopicCandidate) -> Path:
        raise NotImplementedError("SeniorMigrationStub should never reach output_path_for")

    def sequence_for(self, slice_path: Path, candidates: list[TopicCandidate]) -> "CurriculumSequence":
        raise NotImplementedError("SeniorMigrationStub should never reach sequence_for")


__all__ = [
    "TopicCandidate",
    "MigrationRunSummary",
    "BaseFrameworkMigration",
    "SeniorMigrationStub",
    "logger",
]
