"""Promotion script for misconception candidates.

Moves a reviewed staging candidate to production with full provenance.
No LLM calls. Refuses to overwrite existing records.

Usage:
    python -m backend.mining.promote_misconception \
        --staging-path data/misconceptions/staging/ac9_maths/<run_id>/<file>.json \
        --reviewer "Jane Smith" \
        --note "Verified against Year 7 cohort data"

Design §3.7 — misconception-library spec.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from core.schema.misconception_schema import MisconceptionRecord

PROD_DIR = project_root / "data" / "misconceptions" / "prod"
APPROVAL_PATH = project_root / "data" / "misconceptions" / "approvals.yaml"


def _canonical_dump(payload: dict) -> str:
    """Canonical JSON serialisation."""
    return json.dumps(payload, sort_keys=True, indent=2, ensure_ascii=False) + "\n"


def _utcnow_iso() -> str:
    """Current UTC time in ISO 8601 format."""
    return datetime.now(timezone.utc).isoformat()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse CLI arguments."""
    parser = argparse.ArgumentParser(
        description="Promote a staging misconception candidate to production."
    )
    parser.add_argument("--staging-path", required=True, type=Path, help="Path to staging JSON file")
    parser.add_argument("--reviewer", required=True, help="Reviewer identifier")
    parser.add_argument("--note", required=True, help="Review note")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """Main entry point. Returns 0 on success, 1 on failure."""
    args = parse_args(argv)

    if not args.staging_path.exists():
        print(f"Error: staging file not found: {args.staging_path}", file=sys.stderr)
        return 1

    # Load and parse staging record
    try:
        raw = json.loads(args.staging_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        print(f"Error reading staging file: {e}", file=sys.stderr)
        return 1

    # Derive run_id from path structure: .../staging/<framework>/<run_id>/<file>.json
    parts = args.staging_path.parts
    try:
        staging_idx = parts.index("staging")
        framework_short = parts[staging_idx + 1]
        run_id = parts[staging_idx + 2]
    except (ValueError, IndexError):
        print("Error: cannot derive framework/run_id from staging path", file=sys.stderr)
        return 1

    # Build the validated record with proper provenance
    record_data = {k: v for k, v in raw.items() if k != "pending_review"}
    record_data["provenance"] = {
        "source": "ai_mined_human_approved",
        "approved_by": args.reviewer,
        "approved_at": _utcnow_iso(),
        "mined_from_run_id": run_id,
    }

    try:
        candidate = MisconceptionRecord.model_validate(record_data)
    except Exception as e:
        print(f"Error: staging record fails validation: {e}", file=sys.stderr)
        return 1

    # Load or create production file
    PROD_DIR.mkdir(parents=True, exist_ok=True)
    prod_file = PROD_DIR / f"{framework_short}.json"
    if prod_file.exists():
        prod_data = json.loads(prod_file.read_text(encoding="utf-8"))
    else:
        prod_data = {"misconceptions": []}

    # Refuse to promote duplicates (Req 4.5)
    if any(m["misconception_id"] == candidate.misconception_id for m in prod_data["misconceptions"]):
        print(
            f"Refusing to promote: {candidate.misconception_id} already in production",
            file=sys.stderr,
        )
        return 1

    # Append and sort
    prod_data["misconceptions"].append(candidate.model_dump())
    prod_data["misconceptions"].sort(key=lambda m: m["misconception_id"])
    prod_file.write_text(_canonical_dump(prod_data), encoding="utf-8")

    # Append to approval manifest
    APPROVAL_PATH.parent.mkdir(parents=True, exist_ok=True)
    if APPROVAL_PATH.exists():
        manifest = yaml.safe_load(APPROVAL_PATH.read_text(encoding="utf-8")) or {}
    else:
        manifest = {}

    manifest[candidate.misconception_id] = {
        "reviewer": args.reviewer,
        "approved_at": candidate.provenance.approved_at,
        "note": args.note,
    }
    APPROVAL_PATH.write_text(yaml.safe_dump(manifest, sort_keys=True), encoding="utf-8")

    # Move staging file to promoted/
    promoted_dir = args.staging_path.parent / "promoted"
    promoted_dir.mkdir(exist_ok=True)
    args.staging_path.rename(promoted_dir / args.staging_path.name)

    print(f"Promoted {candidate.misconception_id} to {prod_file}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
