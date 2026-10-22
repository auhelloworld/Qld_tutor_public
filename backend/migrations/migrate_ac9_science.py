"""AC9 Science migration script (Phase 1 — empty-shell variant).

Phase 1 ships no AC9 Science source documents under ``data/sources/``.
This script is wired in now so the registry stays in sync with disk
(Req 2.7) and the loader finds a slice file for every supported year
level. When a future phase ships ``ac9_science_yr*.md`` source documents,
add a parser (mirroring ``migrate_ac9_maths._parse_alignment_matrix``)
and the same orchestration in ``BaseFrameworkMigration.run`` will route
candidates into these slice files.

Implements design §3.5 of the curriculum-framework-foundation spec for the
AC9 Science framework. Idempotent: a second back-to-back run reports
``written=0``.
"""

from __future__ import annotations

import glob
import logging
from pathlib import Path

from backend.migrations.base import (
    BaseFrameworkMigration,
    MigrationRunSummary,
    TopicCandidate,
    logger,
)
from core.schema.curriculum_schema import CurriculumSequence


# Repository root — three parents up from this file:
#   migrate_ac9_science.py → migrations/ → backend/ → repo root.
_REPO_ROOT = Path(__file__).resolve().parents[2]
_CURRICULUM_ROOT = _REPO_ROOT / "data" / "curriculum"
_SOURCES_DIR = _REPO_ROOT / "data" / "sources"

# Years 7-10 are the AC9 supported year levels per
# ``backend.curriculum_frameworks.FRAMEWORKS["AC9_SCIENCE"].supported_year_levels``.
_SUPPORTED_YEAR_LEVELS = (7, 8, 9, 10)


class AC9ScienceMigration(BaseFrameworkMigration):
    """Per-framework migration script for AC9 Science.

    Phase 1 ships zero source documents; ``parse_source_documents`` returns
    ``[]``. The override of ``run`` below emits empty-shell slice files for
    Years 7-10 so the loader finds a file per supported year level
    (Req 2.7).
    """

    def framework_id(self) -> str:
        return "AC9_SCIENCE"

    def parse_source_documents(self) -> list[TopicCandidate]:
        """Discover ``ac9_science_yr*.md`` under ``data/sources/`` and parse.

        Phase 1 ships no source documents, so the glob returns an empty
        list and we warn + return ``[]``. When source documents land in a
        future phase this method should be replaced with a real parser
        analogous to ``migrate_ac9_maths._parse_alignment_matrix``.
        """
        pattern = str(_SOURCES_DIR / "ac9_science_yr*.md")
        matches = sorted(glob.glob(pattern))
        if not matches:
            logger.warning(
                "AC9 Science: no source documents matching %s; producing zero candidates",
                pattern,
            )
            return []

        logger.warning(
            "AC9 Science: source documents found at %s but no parser is implemented yet; "
            "producing zero candidates",
            matches,
        )
        return []

    def output_path_for(self, candidate: TopicCandidate) -> Path:
        year_level = candidate.payload["year_level"]
        return _CURRICULUM_ROOT / "ac9_science" / f"year{year_level}.json"

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

    # --- Override to emit empty shells for unmigrated years (Req 2.7) -------

    def run(self) -> MigrationRunSummary:
        """Run the regular pipeline, then emit Year 7-10 empty shells.

        See ``AC9EnglishMigration.run`` for the full rationale.
        """
        from core.schema.curriculum_schema import FrameworkSliceFile

        summary = super().run()

        for year in _SUPPORTED_YEAR_LEVELS:
            slice_path = _CURRICULUM_ROOT / "ac9_science" / f"year{year}.json"
            empty_slice = FrameworkSliceFile(
                framework_id=self.framework_id(),
                topics=[],
                sequence=CurriculumSequence(
                    sequence=[], prerequisites={}, is_strict=False
                ),
            )
            if self._write_if_changed(slice_path, empty_slice):
                summary.written += 1

        return summary


# ---------------------------------------------------------------------------
# CLI entrypoint
# ---------------------------------------------------------------------------


def _configure_cli_logging() -> None:
    backend_logger = logging.getLogger("backend.migrations")
    if not any(
        isinstance(h, logging.StreamHandler) and not isinstance(h, logging.NullHandler)
        for h in backend_logger.handlers
    ):
        handler = logging.StreamHandler()
        handler.setFormatter(
            logging.Formatter("%(levelname)s %(name)s: %(message)s")
        )
        backend_logger.addHandler(handler)
    backend_logger.setLevel(logging.INFO)


def _print_summary(summary: MigrationRunSummary) -> None:
    print("AC9_SCIENCE migration complete:")
    print(f"  extracted: {summary.extracted}")
    print(f"  written:   {summary.written}")
    print(f"  skipped:   {summary.skipped}")
    if summary.skipped_reasons:
        print(f"  reasons:   {summary.skipped_reasons}")


if __name__ == "__main__":
    _configure_cli_logging()
    summary = AC9ScienceMigration().run()
    _print_summary(summary)
