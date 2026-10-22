#!/usr/bin/env python3
"""
One-time migration: reparent legacy single-tenant logs under data/logs/{legacy_default}/.

Idempotent: running twice produces byte-equivalent output.

Phase 2 Requirement 11.
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

LOG = logging.getLogger("migrate_student_logs")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOG_ROOT = PROJECT_ROOT / "data" / "logs"
DEFAULT_LEGACY_ID = "legacy_default"


def parse_args() -> argparse.Namespace:
    """Parse CLI arguments: --legacy-id and --dry-run."""
    p = argparse.ArgumentParser(
        description="Migrate legacy single-tenant student logs to per-student folders."
    )
    p.add_argument(
        "--legacy-id",
        default=DEFAULT_LEGACY_ID,
        help=f"Designated_Legacy_Student_Id (default: {DEFAULT_LEGACY_ID})",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Do not write target files; report what would happen.",
    )
    return p.parse_args()


def canonical_dump(payload: dict) -> str:
    """Same canonicalisation rule as Phase 1 migration scripts (Req 11.5)."""
    return json.dumps(payload, sort_keys=True, indent=2, ensure_ascii=False) + "\n"


def attempt_key(record: dict) -> tuple:
    """Identity tuple for dedup: (question_id, timestamp). Req 11.8."""
    return (record.get("question_id", ""), record.get("timestamp", ""))


def merge_attempts(
    existing: list[dict], incoming: list[dict]
) -> tuple[list[dict], int]:
    """Merge incoming attempts into existing, dedup by attempt_key.

    Returns (merged_list, skipped_count).
    """
    seen = {attempt_key(r) for r in existing}
    merged = list(existing)
    skipped = 0
    for r in incoming:
        if attempt_key(r) in seen:
            skipped += 1
            continue
        seen.add(attempt_key(r))
        merged.append(r)
    return merged, skipped


def migrate_file(
    source: Path, target: Path, legacy_id: str, dry_run: bool
) -> tuple[int, int, bool]:
    """Migrate a single legacy log file to the per-student target.

    Returns (preserved_count, skipped_count, written: bool).
    """
    src_data = json.loads(source.read_text(encoding="utf-8"))

    if target.exists():
        tgt_data = json.loads(target.read_text(encoding="utf-8"))
    else:
        tgt_data = {"student_id": legacy_id, "topics": {}}

    preserved = 0
    skipped = 0

    for topic, src_topic in src_data.get("topics", {}).items():
        tgt_topic = tgt_data.setdefault("topics", {}).setdefault(
            topic, {"attempts": [], "accuracy": 0.0}
        )
        incoming_attempts = src_topic.get("attempts", [])
        merged, dups = merge_attempts(tgt_topic["attempts"], incoming_attempts)
        tgt_topic["attempts"] = merged

        # Recompute accuracy on merged answer-only attempts
        answer_records = [
            a for a in merged if a.get("attempt_type", "answer") == "answer"
        ]
        if answer_records:
            tgt_topic["accuracy"] = round(
                sum(1 for a in answer_records if a["correct"]) / len(answer_records),
                3,
            )
        else:
            tgt_topic["accuracy"] = 0.0

        preserved += len(incoming_attempts) - dups
        skipped += dups

    # Ensure student_id is set (Req 11.6)
    tgt_data["student_id"] = legacy_id

    # Write only if changed (idempotence guarantee)
    written = False
    if not dry_run:
        target.parent.mkdir(parents=True, exist_ok=True)
        new_text = canonical_dump(tgt_data)
        existing_text = target.read_text(encoding="utf-8") if target.exists() else None
        if existing_text != new_text:
            target.write_text(new_text, encoding="utf-8")
            written = True

    return preserved, skipped, written


def main() -> int:
    """Entry point: glob legacy logs and migrate each to per-student folder."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    args = parse_args()

    LOG_ROOT.mkdir(parents=True, exist_ok=True)

    # Glob only files directly in data/logs/ matching *_log.json (not in subdirs)
    legacy_files = sorted(
        p for p in LOG_ROOT.glob("*_log.json") if p.is_file()
    )

    if not legacy_files:
        LOG.info("No legacy log files found at %s", LOG_ROOT)
        return 0

    sources_read = 0
    targets_written = 0
    preserved_total = 0
    skipped_total = 0
    target_dir = LOG_ROOT / args.legacy_id

    for src in legacy_files:
        subject = src.stem.removesuffix("_log")
        target = target_dir / f"{subject}_log.json"

        preserved, skipped, written = migrate_file(
            src, target, args.legacy_id, args.dry_run
        )

        sources_read += 1
        preserved_total += preserved
        skipped_total += skipped
        if written:
            targets_written += 1

        LOG.info(
            "  %s -> %s : preserved=%d skipped(duplicates)=%d written=%s",
            src.name,
            target.relative_to(PROJECT_ROOT),
            preserved,
            skipped,
            written if not args.dry_run else "dry-run",
        )

    LOG.info(
        "Summary: sources=%d targets_written=%d preserved=%d skipped=%d",
        sources_read,
        targets_written,
        preserved_total,
        skipped_total,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
