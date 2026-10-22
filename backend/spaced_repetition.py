"""Spaced Repetition Scheduler.

Design §3.4 — diagnostic-and-spaced-repetition spec.
Req 5.1–5.7, 6.2, 6.6.

Implements the forgetting-curve interval scheduler for previously-mastered topics.
"""
from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

INTERVALS_DAYS = [1, 3, 7, 14, 30, 60]
MASTERY_THRESHOLD = 0.8
# Students study on Brisbane calendar days; Today plans use the same day.
_STUDY_TIMEZONE = ZoneInfo("Australia/Brisbane")


def _study_day(now: datetime) -> str:
    moment = now if now.tzinfo is not None else now.replace(tzinfo=timezone.utc)
    return moment.astimezone(_STUDY_TIMEZONE).date().isoformat()


class SpacedRepetitionScheduler:
    """Stateless scheduler for spaced-repetition intervals."""

    @staticmethod
    def maybe_initialise(topic_data: dict, *, now: datetime) -> None:
        """Add a revision record when a topic first reaches mastery.

        Only initialises if no revision record exists yet. Reaching mastery is
        the topic's schedule change for that day.
        """
        if "revision" in topic_data:
            return
        topic_data["revision"] = {
            "first_mastered_at": now.isoformat(),
            "consecutive_revisions": 0,
            "next_review_at": (now + timedelta(days=INTERVALS_DAYS[0])).isoformat(),
            "last_moved_on": _study_day(now),
        }

    @staticmethod
    def on_revision_response(
        topic_data: dict,
        *,
        is_correct: bool,
        current_bkt: float,
        now: datetime,
        support_level: int = 0,
    ) -> None:
        """Update the revision schedule after a revision response.

        The schedule moves at most once per topic per study day, and the first
        answer of the day decides the move. More answers in the same session are
        practice: they do not count as another spaced retrieval.

        Only an unaided correct answer (support level 0) advances the interval.
        A correct answer after help (concept, tutor, worked example or a shown
        answer) keeps the current interval. A wrong answer moves back one step.
        """
        if "revision" not in topic_data:
            return
        rev = topic_data["revision"]
        today = _study_day(now)
        if rev.get("last_moved_on") == today:
            return
        rev["last_moved_on"] = today
        support_level = max(0, min(4, int(support_level or 0)))
        if is_correct and current_bkt >= MASTERY_THRESHOLD and support_level == 0:
            rev["consecutive_revisions"] += 1
            idx = min(rev["consecutive_revisions"], len(INTERVALS_DAYS) - 1)
            rev["next_review_at"] = (
                now + timedelta(days=INTERVALS_DAYS[idx])
            ).isoformat()
        elif is_correct and current_bkt >= MASTERY_THRESHOLD:
            idx = min(rev["consecutive_revisions"], len(INTERVALS_DAYS) - 1)
            rev["next_review_at"] = (
                now + timedelta(days=INTERVALS_DAYS[idx])
            ).isoformat()
        else:
            # Graduated demotion: reduce level by 1 instead of resetting to day-1
            rev["consecutive_revisions"] = max(0, rev["consecutive_revisions"] - 1)
            idx = min(rev["consecutive_revisions"], len(INTERVALS_DAYS) - 1)
            rev["next_review_at"] = (
                now + timedelta(days=INTERVALS_DAYS[idx])
            ).isoformat()

    @staticmethod
    def find_all_due(
        log: dict,
        *,
        now: datetime,
        framework_slice=None,
        is_mastered_fn: Callable[[list], bool] | None = None,
        limit: int | None = None,
    ) -> list[str]:
        """Return overdue Topic_Ids from oldest to newest review date.

        With ``is_mastered_fn``, a topic that is no longer mastered is not due:
        the student learns it again. Strict prerequisites must be mastered too.
        """
        slice_topic_ids = set()
        if framework_slice is not None:
            slice_topic_ids = {t.topic_id for t in framework_slice.topics}

        candidates = []
        for topic_id, topic_data in log.get("topics", {}).items():
            if framework_slice is not None and topic_id not in slice_topic_ids:
                continue
            rev = topic_data.get("revision")
            if not rev:
                continue
            review_at_str = rev.get("next_review_at")
            if not review_at_str:
                continue
            review_at = _parse_iso(review_at_str)
            if review_at > now:
                continue

            if is_mastered_fn is not None:
                if not is_mastered_fn(topic_data.get("attempts", [])):
                    continue

            if framework_slice is not None and is_mastered_fn is not None:
                if not _prereqs_mastered(
                    framework_slice, log, topic_id, is_mastered_fn
                ):
                    continue

            candidates.append((review_at, topic_id))

        ordered = [topic_id for _, topic_id in sorted(candidates)]
        return ordered[:limit] if limit is not None else ordered

    @staticmethod
    def find_due(
        log: dict,
        *,
        now: datetime,
        framework_slice=None,
        is_mastered_fn: Callable[[list], bool] | None = None,
    ) -> str | None:
        """Return the Topic_Id with the oldest next_review_at <= now."""
        due = SpacedRepetitionScheduler.find_all_due(
            log,
            now=now,
            framework_slice=framework_slice,
            is_mastered_fn=is_mastered_fn,
            limit=1,
        )
        return due[0] if due else None


def _parse_iso(s: str) -> datetime:
    """Parse an ISO 8601 string to a timezone-aware datetime."""
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _prereqs_mastered(
    framework_slice, log: dict, topic_id: str, is_mastered_fn: Callable[[list], bool]
) -> bool:
    """Check if all strict prerequisites for a topic are mastered."""
    if not framework_slice.sequence.is_strict:
        return True
    prereqs = framework_slice.sequence.prerequisites.get(topic_id, [])
    for prereq_id in prereqs:
        attempts = log.get("topics", {}).get(prereq_id, {}).get("attempts", [])
        if not is_mastered_fn(attempts):
            return False
    return True
