"""Generate ``data/curriculum/index.json`` and ``data/curriculum/frameworks.json``.

Walks every ``data/curriculum/*/*.json`` slice file, parses each as a
``FrameworkSliceFile``, collects every ``topic_id``, and writes a sorted
index. Also writes a ``frameworks.json`` containing the JSON-serialisable
fields of every registered framework (skipping the ``validator`` callable).

Idempotent: a second back-to-back run produces zero writes because both
outputs use ``BaseFrameworkMigration.canonical_dump`` and only write on
diff.

Implements design §3.8 / Req 2.4 (index-completeness invariant) and
design §4.1 / Req 14.3–14.4 (frameworks.json with attribution).

Run as: ``python -m backend.migrations.generate_index``
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from backend.curriculum_frameworks import FRAMEWORKS, iter_frameworks
from backend.migrations.base import BaseFrameworkMigration, logger
from core.schema.curriculum_schema import FrameworkSliceFile


_REPO_ROOT = Path(__file__).resolve().parents[2]
_CURRICULUM_ROOT = _REPO_ROOT / "data" / "curriculum"


def generate_index() -> int:
    """Walk all slice files, collect topic_ids, write index.json.

    Returns the number of files written (0 or 1).
    Raises ``RuntimeError`` if duplicate topic_ids are found across slices.
    """
    all_topic_ids: list[str] = []
    seen: dict[str, str] = {}  # topic_id → source file (for error messages)

    for slice_path in sorted(_CURRICULUM_ROOT.glob("*/*.json")):
        if slice_path.name in ("index.json", "frameworks.json"):
            continue
        try:
            slice_obj = FrameworkSliceFile.model_validate(
                json.loads(slice_path.read_text(encoding="utf-8"))
            )
        except Exception as exc:
            logger.warning("skipping %s: %s", slice_path, exc)
            continue

        for topic in slice_obj.topics:
            tid = topic.topic_id
            if tid in seen:
                raise RuntimeError(
                    f"Duplicate topic_id {tid!r} found in {slice_path} "
                    f"and {seen[tid]}. This indicates a validator-disjointness "
                    f"violation upstream."
                )
            seen[tid] = str(slice_path)
            all_topic_ids.append(tid)

    # Sort for deterministic output.
    all_topic_ids.sort()

    payload = {"topic_ids": all_topic_ids, "count": len(all_topic_ids)}
    canonical = BaseFrameworkMigration.canonical_dump(payload)

    index_path = _CURRICULUM_ROOT / "index.json"
    if index_path.exists() and index_path.read_text(encoding="utf-8") == canonical:
        return 0

    index_path.write_text(canonical, encoding="utf-8")
    logger.info("wrote %s (%d topic_ids)", index_path, len(all_topic_ids))
    return 1


def generate_frameworks() -> int:
    """Write frameworks.json from the registry (Req 14.3, 14.4).

    Returns the number of files written (0 or 1).
    Skips the ``validator`` callable (not JSON-serialisable).
    """
    frameworks_list = []
    for fw in iter_frameworks():
        entry = {
            "framework_id": fw.framework_id,
            "human_name": fw.human_name,
            "jurisdiction": fw.jurisdiction,
            "supported_subjects": list(fw.supported_subjects),
            "supported_year_levels": list(fw.supported_year_levels) if fw.supported_year_levels else None,
            "attribution": fw.attribution,
            "slice_directory": fw.slice_directory,
            "subject_suffix": fw.subject_suffix,
        }
        frameworks_list.append(entry)

    # Sort by framework_id for deterministic output.
    frameworks_list.sort(key=lambda f: f["framework_id"])

    payload = {"frameworks": frameworks_list}
    canonical = BaseFrameworkMigration.canonical_dump(payload)

    fw_path = _CURRICULUM_ROOT / "frameworks.json"
    if fw_path.exists() and fw_path.read_text(encoding="utf-8") == canonical:
        return 0

    fw_path.write_text(canonical, encoding="utf-8")
    logger.info("wrote %s (%d frameworks)", fw_path, len(frameworks_list))
    return 1


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
    idx_written = generate_index()
    fw_written = generate_frameworks()
    total = idx_written + fw_written
    print(f"generate_index complete: {total} file(s) written")
    if idx_written:
        print("  - index.json (updated)")
    if fw_written:
        print("  - frameworks.json (updated)")
    if total == 0:
        print("  (no changes — idempotent)")
