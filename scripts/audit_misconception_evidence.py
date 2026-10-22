#!/usr/bin/env python3
"""Report whether English/Science misconception authoring has real evidence.

This script does not generate misconception records.  It deduplicates physical
attempts, excludes pending/unanswered/speed-round work, aggregates repeated
specific errors across different questions, and reports whether a small reviewed
content batch is justified.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Any

from backend.services.misconception_evidence import (
    DEFAULT_SUBJECTS,
    analyse_misconception_evidence,
    load_log_records,
)


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_DIR = ROOT / "data"
DEFAULT_LOGS_DIR = DEFAULT_DATA_DIR / "logs"


def load_exercises(data_dir: Path, subjects: list[str]) -> dict[str, dict[str, Any]]:
    exercises: dict[str, dict[str, Any]] = {}
    for subject in subjects:
        for path in sorted(data_dir.glob(f"exercise_*_{subject}.json")):
            try:
                payload = json.loads(path.read_text(encoding="utf-8-sig"))
            except (OSError, json.JSONDecodeError):
                continue
            if not isinstance(payload, list):
                continue
            for exercise in payload:
                if not isinstance(exercise, dict):
                    continue
                exercise_id = str(exercise.get("id") or "")
                if exercise_id:
                    exercises[exercise_id] = exercise
    return exercises


def write_report(report: dict[str, Any], out_dir: Path) -> dict[str, str]:
    out_dir.mkdir(parents=True, exist_ok=True)
    summary_path = out_dir / "misconception_evidence_summary.json"
    candidates_path = out_dir / "misconception_evidence_candidates.csv"
    summary_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    fields = [
        "subject",
        "primary_topic_id",
        "evidence_code",
        "evidence_kind",
        "error_count",
        "distinct_questions",
        "distinct_students",
        "confidence",
        "ready_for_authoring",
        "question_ids",
        "example_answers",
    ]
    with candidates_path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for candidate in report.get("candidates", []):
            row = dict(candidate)
            row["question_ids"] = ", ".join(row.get("question_ids") or [])
            row["example_answers"] = " | ".join(row.get("example_answers") or [])
            writer.writerow({field: row.get(field, "") for field in fields})

    return {
        "summary": str(summary_path),
        "candidates": str(candidates_path),
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Check whether English/Science misconception content has sufficient real error evidence."
    )
    parser.add_argument("--logs-dir", type=Path, default=DEFAULT_LOGS_DIR)
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--subjects", nargs="+", default=list(DEFAULT_SUBJECTS))
    parser.add_argument("--min-errors", type=int, default=5)
    parser.add_argument("--min-distinct-questions", type=int, default=3)
    parser.add_argument("--min-confidence", type=float, default=0.72)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--json", action="store_true")
    parser.add_argument(
        "--require-ready",
        action="store_true",
        help="Exit 1 unless every requested subject has a ready evidence candidate.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    subjects = [str(subject).lower() for subject in args.subjects]
    exercises = load_exercises(args.data_dir, subjects)
    logs = load_log_records(args.logs_dir, subjects=subjects)
    report = analyse_misconception_evidence(
        logs,
        exercises,
        subjects=subjects,
        min_errors=args.min_errors,
        min_distinct_questions=args.min_distinct_questions,
        min_confidence=args.min_confidence,
    ).as_dict()

    if args.out:
        report["outputs"] = write_report(report, args.out)

    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        for subject in subjects:
            state = "READY" if report["readiness"].get(subject) else "WAIT"
            print(
                f"{subject}: {state}; confirmed_errors={report['confirmed_errors'].get(subject, 0)}; "
                f"{report['reason'].get(subject, '')}"
            )

    if args.require_ready and not report.get("all_ready"):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
