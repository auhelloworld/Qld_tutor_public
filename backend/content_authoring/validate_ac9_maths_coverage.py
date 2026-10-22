"""AC9 Maths content coverage validator (Years 7–10).

Pure-Python checker. No LLM calls. Exit 0 iff all specified year levels meet
the coverage quota defined in the content-population-ac9-maths spec.

Invokable via: python -m backend.content_authoring.validate_ac9_maths_coverage [--year 7|8|9|10|all]
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

from pydantic import ValidationError

REPO = Path(__file__).resolve().parents[2]
CURRICULUM_DIR = REPO / "data" / "curriculum" / "ac9_maths"
EXERCISE_DIR = REPO / "data"
MISC_PATH = REPO / "data" / "misconceptions" / "prod" / "ac9_maths.json"
APPROVALS_PATH = REPO / "data" / "content_approvals.yaml"

CORE_RULE_LEN_MIN = 30
CORE_RULE_LEN_MAX = 240
REQUIRED_LEVELS = ("concept_reminder", "step_prompt", "analogy")
EXERCISES_PER_TOPIC_MIN = 5
DIFFICULTY_QUOTA = {"foundational": 1, "developing": 2, "extending": 1}
STRANDS = ("Number", "Algebra", "Measurement", "Space", "Statistics", "Probability")

# Year 7 has a higher misconception bar (more seed data); Years 8-10 start at 20.
MISC_TOTAL_BY_YEAR = {7: 25, 8: 20, 9: 20, 10: 20}
MISC_PER_STRAND_MIN = 3


def _load_slice(year: int):
    """Load and validate a year-level slice. Returns (FrameworkSliceFile, None) or (None, error_str)."""
    from core.schema.curriculum_schema import FrameworkSliceFile

    path = CURRICULUM_DIR / f"year{year}.json"
    if not path.exists():
        return None, f"year{year}.json does not exist"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return FrameworkSliceFile.model_validate(data), None
    except (json.JSONDecodeError, ValidationError) as exc:
        return None, f"year{year}.json schema error: {exc}"


def _load_exercises() -> tuple[dict[str, list], list[str]]:
    """Load all exercises, indexed by topic_id membership, and collect schema validation errors."""
    from core.schema.exercise_schema import ExerciseItem

    by_topic: dict[str, list] = defaultdict(list)
    validation_errors: list[str] = []

    for path in sorted(EXERCISE_DIR.glob("exercise_*.json")):
        try:
            records = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            validation_errors.append(f"File {path.name} JSON load error: {exc}")
            continue
        if not isinstance(records, list):
            continue
        for idx, raw in enumerate(records):
            try:
                ex = ExerciseItem.model_validate(raw)
                if ex.status != "active":
                    continue
                for tid in ex.topic_ids:
                    by_topic[tid].append(ex)
            except ValidationError as exc:
                first_err = str(exc).split("\n")[0]
                validation_errors.append(
                    f"Schema error in {path.name} at record index {idx} (ID: {raw.get('id', 'unknown')}): {first_err}"
                )
    return by_topic, validation_errors


def _load_misconceptions():
    """Load misconception records. Returns (list[MisconceptionRecord], error_str|None)."""
    from core.schema.misconception_schema import MisconceptionRecord

    if not MISC_PATH.exists():
        return [], "misconceptions file not found"
    try:
        data = json.loads(MISC_PATH.read_text(encoding="utf-8"))
        records = [MisconceptionRecord.model_validate(r) for r in data.get("misconceptions", [])]
        return records, None
    except (json.JSONDecodeError, ValidationError) as exc:
        return [], f"misconceptions schema error: {exc}"


def _strand_for_topic(topic_id: str, slice_file) -> str | None:
    """Resolve a topic_id to its strand within the slice."""
    for t in slice_file.topics:
        if t.topic_id == topic_id and hasattr(t, "strand"):
            return t.strand
    return None


def _check_year(year: int, exercises_by_topic: dict, misconceptions: list) -> list[str]:
    """Check a single year level. Returns list of gap strings."""
    gaps: list[str] = []

    slice_file, err = _load_slice(year)
    if err:
        gaps.append(f"Year {year}: {err}")
        return gaps

    if not slice_file.topics:
        gaps.append(f"Year {year}: slice has 0 topics (empty shell)")
        return gaps

    # Per-topic checks
    satisfied = 0
    for topic in slice_file.topics:
        topic_gaps: list[str] = []
        card = topic.concept_card

        # Concept card: core_rule
        if not (CORE_RULE_LEN_MIN <= len(card.core_rule) <= CORE_RULE_LEN_MAX):
            if len(card.core_rule) == 0:
                topic_gaps.append("core_rule is empty")
            else:
                topic_gaps.append(
                    f"core_rule length {len(card.core_rule)} not in "
                    f"[{CORE_RULE_LEN_MIN}, {CORE_RULE_LEN_MAX}]"
                )

        # Concept card: hint_levels
        levels = {h.level for h in card.hint_levels}
        for needed in REQUIRED_LEVELS:
            if needed not in levels:
                topic_gaps.append(f"missing hint_level '{needed}'")

        # Exercises
        ex_for_topic = exercises_by_topic.get(topic.topic_id, [])
        if len(ex_for_topic) < EXERCISES_PER_TOPIC_MIN:
            topic_gaps.append(
                f"only {len(ex_for_topic)} exercises (need {EXERCISES_PER_TOPIC_MIN})"
            )
        else:
            diff_counts: dict[str, int] = defaultdict(int)
            for ex in ex_for_topic:
                diff_counts[ex.difficulty] += 1
            for tier, needed_count in DIFFICULTY_QUOTA.items():
                if diff_counts.get(tier, 0) < needed_count:
                    topic_gaps.append(
                        f"difficulty '{tier}': {diff_counts.get(tier, 0)} < {needed_count}"
                    )

        # Elaborations
        if not topic.elaborations:
            topic_gaps.append("zero elaborations")

        if topic_gaps:
            for g in topic_gaps:
                gaps.append(f"Year {year} {topic.topic_id}: {g}")
        else:
            satisfied += 1

    total = len(slice_file.topics)
    gaps.append(f"Year {year} topic coverage: {satisfied}/{total}")

    # Misconception strand coverage for this year
    misc_total = MISC_TOTAL_BY_YEAR.get(year, 20)
    year_topic_ids = {t.topic_id for t in slice_file.topics}
    year_misconceptions = [
        m for m in misconceptions
        if any(tid in year_topic_ids for tid in m.topic_ids)
    ]

    if len(year_misconceptions) < misc_total:
        gaps.append(
            f"Year {year} misconceptions: {len(year_misconceptions)} < {misc_total}"
        )

    by_strand: dict[str, int] = defaultdict(int)
    for m in year_misconceptions:
        for tid in m.topic_ids:
            if tid in year_topic_ids:
                strand = _strand_for_topic(tid, slice_file)
                if strand:
                    by_strand[strand] += 1
                    break

    # Only check strands that actually exist in this year's slice
    year_strands = {getattr(t, "strand", None) for t in slice_file.topics}
    for strand in STRANDS:
        if strand in year_strands and by_strand.get(strand, 0) < MISC_PER_STRAND_MIN:
            gaps.append(
                f"Year {year} strand '{strand}': "
                f"{by_strand.get(strand, 0)} misconceptions < {MISC_PER_STRAND_MIN}"
            )

    return gaps


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="validate_ac9_maths_coverage",
        description="Check AC9 Maths content coverage against the production quota.",
    )
    parser.add_argument(
        "--year",
        default="all",
        help="Year level to check: 7, 8, 9, 10, or 'all' (default: all)",
    )
    args = parser.parse_args()

    if args.year == "all":
        years = [7, 8, 9, 10]
    else:
        try:
            y = int(args.year)
            if y not in (7, 8, 9, 10):
                print(f"ERROR: --year must be 7, 8, 9, 10, or 'all'", file=sys.stderr)
                return 2
            years = [y]
        except ValueError:
            print(f"ERROR: --year must be 7, 8, 9, 10, or 'all'", file=sys.stderr)
            return 2

    # Load shared data
    exercises_by_topic, validation_errors = _load_exercises()
    misconceptions, misc_err = _load_misconceptions()
    if misc_err:
        print(f"WARNING: {misc_err}", file=sys.stderr)

    # Check approvals manifest
    all_gaps: list[str] = []
    all_gaps.extend(validation_errors)
    if not APPROVALS_PATH.exists():
        all_gaps.append(f"content_approvals.yaml missing at {APPROVALS_PATH}")
    else:
        try:
            import yaml
            approvals = yaml.safe_load(APPROVALS_PATH.read_text(encoding="utf-8"))
            if not isinstance(approvals, dict):
                all_gaps.append("content_approvals.yaml: root must be a mapping")
        except Exception as exc:
            all_gaps.append(f"content_approvals.yaml: parse error — {exc}")

    # Per-year checks
    has_real_gaps = False
    for year in years:
        year_gaps = _check_year(year, exercises_by_topic, misconceptions)
        for g in year_gaps:
            if "topic coverage:" in g:
                # Summary line — check if it shows full coverage
                if not g.endswith(f"{g.split('/')[-1].split('/')[0]}/{g.split('/')[-1].split('/')[0]}"):
                    pass  # always print summary
            else:
                has_real_gaps = True
            all_gaps.append(g)

    # Report
    if all_gaps:
        for g in all_gaps:
            print(g)

    # Determine exit status: 0 only if no real gaps (summary lines don't count)
    real_gaps = [
        g for g in all_gaps
        if "topic coverage:" not in g
    ]
    if real_gaps:
        print(f"\n{len(real_gaps)} gap(s) found. Exit 1.")
        return 1
    else:
        print("\n✓ All quotas satisfied.")
        return 0


if __name__ == "__main__":
    sys.exit(main())
