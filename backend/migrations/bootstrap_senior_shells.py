"""One-time bootstrap script for QCAA Senior empty-shell slice files.

Creates the empty-shell ``FrameworkSliceFile`` JSON files that the
curriculum loader expects to find on disk for every registered senior
framework. Running the senior migration stubs (``migrate_qcaa_methods``,
``migrate_qcaa_english``, ``migrate_qcaa_biology``) exits with status 1
because no parser is implemented in Phase 1; this bootstrap script fills
the gap by writing the empty shells directly.

Idempotent: a second run produces zero writes because
``BaseFrameworkMigration._write_if_changed`` compares canonical dumps.

Run as: ``python -m backend.migrations.bootstrap_senior_shells``

Implements design §3.7 / Req 2.7 / Req 7.9 of the
curriculum-framework-foundation spec.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from backend.curriculum_frameworks import FRAMEWORKS
from backend.migrations.base import BaseFrameworkMigration, logger
from core.schema.curriculum_schema import CurriculumSequence, FrameworkSliceFile


_REPO_ROOT = Path(__file__).resolve().parents[2]
_CURRICULUM_ROOT = _REPO_ROOT / "data" / "curriculum"

# Senior frameworks and their syllabus subjects are derived from the canonical
# framework registry so shell names cannot drift from curriculum/schema support.
_SENIOR_FRAMEWORKS: dict[str, list[str]] = {
    framework_id: list(framework.supported_subjects)
    for framework_id, framework in FRAMEWORKS.items()
    if framework.jurisdiction == "QCAA-Senior"
}


def _empty_slice(framework_id: str) -> FrameworkSliceFile:
    return FrameworkSliceFile(
        framework_id=framework_id,
        topics=[],
        sequence=CurriculumSequence(sequence=[], prerequisites={}, is_strict=False),
    )


def bootstrap() -> int:
    """Write empty-shell slice files for all senior frameworks.

    Returns the number of files actually written (0 on idempotent re-run).
    """
    written = 0
    for framework_id, subjects in _SENIOR_FRAMEWORKS.items():
        # Senior slice directory is the framework_id lowercased.
        slice_dir = _CURRICULUM_ROOT / framework_id.lower()
        slice_dir.mkdir(parents=True, exist_ok=True)
        empty = _empty_slice(framework_id)
        canonical = BaseFrameworkMigration.canonical_dump(
            empty.model_dump(mode="json")
        )
        for subject in subjects:
            path = slice_dir / f"{subject}.json"
            if path.exists() and path.read_text(encoding="utf-8") == canonical:
                continue
            path.write_text(canonical, encoding="utf-8")
            written += 1
            logger.info("wrote empty shell: %s", path)
    return written


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


if __name__ == "__main__":
    _configure_cli_logging()
    count = bootstrap()
    print(f"bootstrap_senior_shells complete: {count} files written")
