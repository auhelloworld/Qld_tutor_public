"""Compare authored difficulty bands with real answer accuracy (read-only).

The diagnostic staircase and ability estimate trust the authored band of each
item. This report shows accuracy per band and lists items whose observed
accuracy is outside their band's expected range, so authors can relabel them.

Usage:
    backend/venv/bin/python scripts/check_difficulty_calibration.py [--min-attempts 8]
"""
from __future__ import annotations

import argparse
import json
import sqlite3
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BANDS = ("foundational", "developing", "extending", "AMC")
# Observed accuracy outside this range makes the band label suspect.
EXPECTED_ACCURACY = {
    "foundational": (0.5, 1.0),
    "developing": (0.3, 0.95),
    "extending": (0.0, 0.9),
    "AMC": (0.0, 0.8),
}


def load_bands(data_dir: Path) -> dict[str, tuple[str, str]]:
    bands: dict[str, tuple[str, str]] = {}
    for path in sorted(data_dir.glob("exercise_*.json")):
        for item in json.loads(path.read_text(encoding="utf-8")):
            if isinstance(item, dict) and item.get("id"):
                bands[str(item["id"])] = (str(item.get("difficulty") or "developing"), path.name)
    return bands


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", type=Path, default=ROOT / "data" / "qld_tutor.db")
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data")
    parser.add_argument("--min-attempts", type=int, default=8)
    args = parser.parse_args()

    bands = load_bands(args.data_dir)
    conn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    try:
        rows = conn.execute(
            """
            SELECT question_id, outcome FROM attempts
            WHERE attempt_type IN ('answer', 'diagnostic')
              AND outcome IN ('correct', 'incorrect')
              AND is_speed_round = 0
              AND question_id NOT LIKE 'pseudo_%'
            """
        ).fetchall()
    finally:
        conn.close()

    per_item: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    per_band: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for question_id, outcome in rows:
        if question_id not in bands:
            continue
        for bucket in (per_item[question_id], per_band[bands[question_id][0]]):
            bucket[0] += outcome == "correct"
            bucket[1] += 1

    print("Accuracy by authored band (all scored answers):")
    for band in BANDS:
        correct, total = per_band.get(band, [0, 0])
        print(f"  {band:12} {correct}/{total}" + (f" = {correct / total:.0%}" if total else ""))

    flagged = []
    for question_id, (correct, total) in per_item.items():
        band, source = bands[question_id]
        low, high = EXPECTED_ACCURACY.get(band, (0.0, 1.0))
        if total >= args.min_attempts and not low <= correct / total <= high:
            flagged.append((band, correct / total, total, question_id, source))
    print(f"\nItems outside their band's expected accuracy (>= {args.min_attempts} answers): {len(flagged)}")
    for band, accuracy, total, question_id, source in sorted(flagged):
        print(f"  {band:12} {accuracy:4.0%} of {total:3}  {question_id}  ({source})")


if __name__ == "__main__":
    main()
