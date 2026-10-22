"""Diagnostic Pack Builder.

Design §3.2 — diagnostic-and-spaced-repetition spec.
Req 1.1–1.8.

Builds a deterministic 40-question diagnostic pack for a given (subject, year_level).
"""
from __future__ import annotations

import logging
import warnings
from collections import defaultdict

from backend.curriculum_frameworks import get_framework, iter_frameworks
from backend.curriculum_loader import CurriculumLoader

logger = logging.getLogger(__name__)

PACK_SIZE = 40
MIN_PER_STRAND = 4
DIFFICULTY_QUOTAS = {"foundational": 12, "developing": 20, "extending": 8}


class DiagnosticPackBuilder:
    """Builds a deterministic diagnostic pack from the Exercise_Store."""

    def __init__(self, loader: CurriculumLoader, exercises: dict):
        self.loader = loader
        self.exercises = exercises

    def build(
        self,
        *,
        subject: str,
        year_level: int,
        previewed_senior_subjects: list[str] | None = None,
    ) -> list[str]:
        """Return an ordered list of question_id strings for the diagnostic pack."""
        framework = self._framework_for_subject(subject)
        if framework is None:
            return []

        try:
            slice_obj = self.loader.load_slice(framework.framework_id, year_level)
        except FileNotFoundError:
            return []

        # Collect valid topic_ids from the slice
        valid_topic_ids = {t.topic_id for t in slice_obj.topics}

        # Get exercises for this subject + year_level
        candidates = self._get_candidates(subject, year_level, valid_topic_ids)

        # Group by strand
        strand_map = self._group_by_strand(slice_obj, candidates)

        # Select per strand (≥4 each)
        per_strand = self._select_per_strand(strand_map)

        # Flatten in alphabetical strand order
        items = self._concatenate_alphabetical(per_strand)

        # Apply difficulty distribution
        items = self._apply_difficulty_distribution(items)

        # Senior preview for Year 10
        if year_level == 10 and previewed_senior_subjects:
            items = self._inject_senior_preview(items, previewed_senior_subjects)

        return [ex["id"] for ex in items[:PACK_SIZE]]

    def _framework_for_subject(self, subject: str):
        """Find the AC9 framework for a given subject."""
        subject_map = {
            "math": "AC9_MATHS",
            "english": "AC9_ENGLISH",
            "science": "AC9_SCIENCE",
        }
        fw_id = subject_map.get(subject)
        if fw_id is None:
            return None
        return get_framework(fw_id)

    def _get_candidates(
        self, subject: str, year_level: int, valid_topic_ids: set[str]
    ) -> list[dict]:
        """Get exercise records matching subject, year_level, and valid topic_ids."""
        candidates = []
        for ex in self.exercises.values():
            if ex.get("subject") != subject:
                continue
            if ex.get("year_level") != year_level:
                continue
            # At least one topic_id must be in the valid set (Req 1.6)
            ex_topics = ex.get("topic_ids", [])
            if not any(tid in valid_topic_ids for tid in ex_topics):
                continue
            candidates.append(ex)
        return candidates

    def _group_by_strand(
        self, slice_obj, candidates: list[dict]
    ) -> dict[str, list[dict]]:
        """Group exercises by strand, ordered by ascending topic_id then exercise id."""
        # Build topic_id -> strand mapping
        topic_to_strand: dict[str, str] = {}
        for topic in slice_obj.topics:
            topic_to_strand[topic.topic_id] = topic.strand

        # Group exercises by strand (use first matching topic_id's strand)
        strand_map: dict[str, list[dict]] = defaultdict(list)
        for ex in candidates:
            ex_topics = ex.get("topic_ids", [])
            for tid in sorted(ex_topics):
                if tid in topic_to_strand:
                    strand = topic_to_strand[tid]
                    strand_map[strand].append(ex)
                    break

        # Sort within each strand: by first topic_id ascending, then exercise id ascending
        for strand in strand_map:
            strand_map[strand].sort(
                key=lambda ex: (
                    min(
                        (tid for tid in ex.get("topic_ids", []) if tid in topic_to_strand),
                        default="",
                    ),
                    ex["id"],
                )
            )
            # Deduplicate (an exercise may appear once per strand)
            seen = set()
            deduped = []
            for ex in strand_map[strand]:
                if ex["id"] not in seen:
                    seen.add(ex["id"])
                    deduped.append(ex)
            strand_map[strand] = deduped

        return dict(strand_map)

    def _select_per_strand(
        self, strand_map: dict[str, list[dict]]
    ) -> dict[str, list[dict]]:
        """Select at least MIN_PER_STRAND items per strand; emit warning on shortfall."""
        result: dict[str, list[dict]] = {}
        for strand in sorted(strand_map.keys()):
            items = strand_map[strand]
            if len(items) < MIN_PER_STRAND:
                warnings.warn(
                    f"Diagnostic pack: strand '{strand}' has only {len(items)} "
                    f"items (minimum {MIN_PER_STRAND} required).",
                    stacklevel=2,
                )
            result[strand] = items
        return result

    def _concatenate_alphabetical(
        self, per_strand: dict[str, list[dict]]
    ) -> list[dict]:
        """Concatenate strand items in alphabetical strand order."""
        items = []
        for strand in sorted(per_strand.keys()):
            items.extend(per_strand[strand])
        return items

    def _apply_difficulty_distribution(self, items: list[dict]) -> list[dict]:
        """Enforce 30/50/20 difficulty mix as a stable secondary sort.

        Selects up to the quota for each difficulty level, maintaining
        the existing order within each level.
        """
        by_difficulty: dict[str, list[dict]] = {
            "foundational": [],
            "developing": [],
            "extending": [],
        }
        for ex in items:
            diff = ex.get("difficulty", "developing")
            if diff == "AMC":
                diff = "extending"
            if diff in by_difficulty:
                by_difficulty[diff].append(ex)
            else:
                by_difficulty["developing"].append(ex)

        result = []
        for diff, quota in DIFFICULTY_QUOTAS.items():
            result.extend(by_difficulty[diff][:quota])

        # If we don't have enough items to fill quotas, just return what we have
        # If we have more items than PACK_SIZE after quotas, the caller truncates
        if len(result) < PACK_SIZE:
            # Backfill with remaining items not yet selected
            selected_ids = {ex["id"] for ex in result}
            for ex in items:
                if ex["id"] not in selected_ids:
                    result.append(ex)
                    if len(result) >= PACK_SIZE:
                        break

        return result

    def _inject_senior_preview(
        self, items: list[dict], previewed_senior_subjects: list[str]
    ) -> list[dict]:
        """Replace last 4 items with QCAA Senior Unit 1 items for Year 10 students."""
        senior_items = []
        for raw_subject in previewed_senior_subjects:
            normalised = raw_subject.strip().lower()
            # Find senior exercises
            for ex in self.exercises.values():
                if ex.get("unit") == 1:
                    # Check if exercise belongs to a senior framework
                    fw = ex.get("framework", "")
                    if "SENIOR" in fw:
                        senior_items.append(ex)

        # Sort for determinism
        senior_items.sort(key=lambda ex: ex["id"])

        slots = 4
        if len(senior_items) < slots:
            if senior_items:
                warnings.warn(
                    f"Diagnostic pack: senior preview has only {len(senior_items)} "
                    f"items (expected {slots}). Backfilling with Year-10 items.",
                    stacklevel=2,
                )
            # Use what we have, keep the rest as-is
            slots = len(senior_items)

        if slots > 0 and len(items) >= slots:
            items = items[:-slots] + senior_items[:slots]

        return items
