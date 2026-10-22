"""Unit tests for SpacedRepetitionScheduler (Task 11.2).

Verifies:
- Interval progression 1d → 3d → 7d → 14d → 30d → 60d → 60d (plateau).
- Wrong revision resets to 1d.
- No revision created below mastery threshold.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from backend.spaced_repetition import (
    INTERVALS_DAYS,
    MASTERY_THRESHOLD,
    SpacedRepetitionScheduler,
)


@pytest.fixture
def now():
    """Fixed UTC datetime for testing."""
    return datetime(2026, 5, 19, 12, 0, 0, tzinfo=timezone.utc)


class TestMaybeInitialise:
    """Tests for SpacedRepetitionScheduler.maybe_initialise."""

    def test_creates_revision_record(self, now):
        """Creates a revision record when none exists."""
        topic_data = {"attempts": [], "accuracy": 0.9}
        SpacedRepetitionScheduler.maybe_initialise(topic_data, now=now)
        assert "revision" in topic_data
        rev = topic_data["revision"]
        assert rev["consecutive_revisions"] == 0
        assert rev["first_mastered_at"] == now.isoformat()
        expected_review = (now + timedelta(days=1)).isoformat()
        assert rev["next_review_at"] == expected_review

    def test_does_not_overwrite_existing(self, now):
        """Does not overwrite an existing revision record."""
        topic_data = {
            "attempts": [],
            "accuracy": 0.9,
            "revision": {
                "first_mastered_at": "2026-01-01T00:00:00+00:00",
                "consecutive_revisions": 3,
                "next_review_at": "2026-06-01T00:00:00+00:00",
            },
        }
        SpacedRepetitionScheduler.maybe_initialise(topic_data, now=now)
        assert topic_data["revision"]["consecutive_revisions"] == 3


class TestOnRevisionResponse:
    """Tests for SpacedRepetitionScheduler.on_revision_response."""

    def test_interval_progression(self, now):
        """Correct responses advance through the interval sequence."""
        topic_data = {
            "revision": {
                "first_mastered_at": "2026-01-01T00:00:00+00:00",
                "consecutive_revisions": 0,
                "next_review_at": now.isoformat(),
            }
        }

        # Walk through each interval
        expected_intervals = INTERVALS_DAYS[1:]  # After first correct: 3, 7, 14, 30, 60
        current_time = now
        for i, expected_days in enumerate(expected_intervals):
            SpacedRepetitionScheduler.on_revision_response(
                topic_data, is_correct=True, current_bkt=0.9, now=current_time
            )
            expected_review = (current_time + timedelta(days=expected_days)).isoformat()
            assert topic_data["revision"]["next_review_at"] == expected_review
            assert topic_data["revision"]["consecutive_revisions"] == i + 1
            current_time = current_time + timedelta(days=expected_days)

    def test_plateau_at_60_days(self, now):
        """After reaching the end of intervals, plateaus at 60 days."""
        topic_data = {
            "revision": {
                "first_mastered_at": "2026-01-01T00:00:00+00:00",
                "consecutive_revisions": len(INTERVALS_DAYS) - 1,
                "next_review_at": now.isoformat(),
            }
        }
        SpacedRepetitionScheduler.on_revision_response(
            topic_data, is_correct=True, current_bkt=0.9, now=now
        )
        expected_review = (now + timedelta(days=60)).isoformat()
        assert topic_data["revision"]["next_review_at"] == expected_review

    def test_incorrect_graduated_demotion(self, now):
        """Incorrect response decreases counter by 1 and schedules corresponding interval."""
        topic_data = {
            "revision": {
                "first_mastered_at": "2026-01-01T00:00:00+00:00",
                "consecutive_revisions": 4,
                "next_review_at": now.isoformat(),
            }
        }
        SpacedRepetitionScheduler.on_revision_response(
            topic_data, is_correct=False, current_bkt=0.7, now=now
        )
        assert topic_data["revision"]["consecutive_revisions"] == 3
        # INTERVALS_DAYS[3] is 14 days
        expected_review = (now + timedelta(days=14)).isoformat()
        assert topic_data["revision"]["next_review_at"] == expected_review

    def test_correct_but_below_mastery_graduated_demotion(self, now):
        """Correct but BKT below threshold decreases counter by 1 like incorrect."""
        topic_data = {
            "revision": {
                "first_mastered_at": "2026-01-01T00:00:00+00:00",
                "consecutive_revisions": 3,
                "next_review_at": now.isoformat(),
            }
        }
        SpacedRepetitionScheduler.on_revision_response(
            topic_data, is_correct=True, current_bkt=0.6, now=now
        )
        assert topic_data["revision"]["consecutive_revisions"] == 2
        # INTERVALS_DAYS[2] is 7 days
        expected_review = (now + timedelta(days=7)).isoformat()
        assert topic_data["revision"]["next_review_at"] == expected_review

    def test_high_support_correct_does_not_advance_interval(self, now):
        """Worked-example/show-answer success repeats the current interval."""
        topic_data = {
            "revision": {
                "first_mastered_at": "2026-01-01T00:00:00+00:00",
                "consecutive_revisions": 2,
                "next_review_at": now.isoformat(),
            }
        }
        SpacedRepetitionScheduler.on_revision_response(
            topic_data,
            is_correct=True,
            current_bkt=0.9,
            now=now,
            support_level=3,
        )
        assert topic_data["revision"]["consecutive_revisions"] == 2
        assert topic_data["revision"]["next_review_at"] == (
            now + timedelta(days=INTERVALS_DAYS[2])
        ).isoformat()

    def test_no_revision_record_is_noop(self, now):
        """If no revision record exists, on_revision_response is a no-op."""
        topic_data = {"attempts": [], "accuracy": 0.5}
        SpacedRepetitionScheduler.on_revision_response(
            topic_data, is_correct=True, current_bkt=0.9, now=now
        )
        assert "revision" not in topic_data


class TestOneMovePerDay:
    """Spacing comes from separate days: only the first answer of a day moves the schedule."""

    @staticmethod
    def _topic(level: int, now: datetime) -> dict:
        return {"revision": {
            "first_mastered_at": "2026-01-01T00:00:00+00:00",
            "consecutive_revisions": level,
            "next_review_at": now.isoformat(),
        }}

    def test_more_correct_answers_on_the_same_day_do_not_move_again(self, now):
        topic = self._topic(0, now)
        for minutes in range(5):
            SpacedRepetitionScheduler.on_revision_response(
                topic, is_correct=True, current_bkt=0.9, now=now + timedelta(minutes=minutes),
            )
        assert topic["revision"]["consecutive_revisions"] == 1
        assert topic["revision"]["next_review_at"] == (now + timedelta(days=INTERVALS_DAYS[1])).isoformat()

    def test_first_answer_of_the_day_decides(self, now):
        topic = self._topic(3, now)
        SpacedRepetitionScheduler.on_revision_response(topic, is_correct=False, current_bkt=0.9, now=now)
        SpacedRepetitionScheduler.on_revision_response(
            topic, is_correct=True, current_bkt=0.9, now=now + timedelta(minutes=5),
        )
        assert topic["revision"]["consecutive_revisions"] == 2

    def test_next_brisbane_day_moves_again(self):
        # 23:00 and 01:00 in Brisbane (UTC+10) are different days.
        late = datetime(2026, 5, 19, 13, 0, tzinfo=timezone.utc)
        early_next_day = datetime(2026, 5, 19, 15, 0, tzinfo=timezone.utc)
        topic = self._topic(0, late)
        SpacedRepetitionScheduler.on_revision_response(topic, is_correct=True, current_bkt=0.9, now=late)
        SpacedRepetitionScheduler.on_revision_response(
            topic, is_correct=True, current_bkt=0.9, now=early_next_day,
        )
        assert topic["revision"]["consecutive_revisions"] == 2

    def test_same_brisbane_day_across_utc_midnight_moves_once(self):
        # 09:00 and 11:00 in Brisbane are the same day, but they fall on two UTC dates.
        before_utc_midnight = datetime(2026, 5, 19, 23, 0, tzinfo=timezone.utc)
        after_utc_midnight = datetime(2026, 5, 20, 1, 0, tzinfo=timezone.utc)
        topic = self._topic(0, before_utc_midnight)
        SpacedRepetitionScheduler.on_revision_response(
            topic, is_correct=True, current_bkt=0.9, now=before_utc_midnight,
        )
        SpacedRepetitionScheduler.on_revision_response(
            topic, is_correct=True, current_bkt=0.9, now=after_utc_midnight,
        )
        assert topic["revision"]["consecutive_revisions"] == 1

    def test_answer_after_reading_help_keeps_the_interval(self, now):
        """Retrieval must come from memory: concept or tutor help (levels 1-2) does not promote."""
        topic = self._topic(2, now)
        SpacedRepetitionScheduler.on_revision_response(
            topic, is_correct=True, current_bkt=0.9, now=now, support_level=1,
        )
        assert topic["revision"]["consecutive_revisions"] == 2
        assert topic["revision"]["next_review_at"] == (now + timedelta(days=INTERVALS_DAYS[2])).isoformat()

    def test_newly_mastered_topic_does_not_move_on_the_same_day(self, now):
        topic: dict = {"attempts": []}
        SpacedRepetitionScheduler.maybe_initialise(topic, now=now)
        SpacedRepetitionScheduler.on_revision_response(
            topic, is_correct=True, current_bkt=0.9, now=now + timedelta(hours=1),
        )
        assert topic["revision"]["consecutive_revisions"] == 0
        assert topic["revision"]["next_review_at"] == (now + timedelta(days=INTERVALS_DAYS[0])).isoformat()


class TestFindDue:
    """Tests for SpacedRepetitionScheduler.find_due."""

    def test_returns_oldest_due_topic(self, now):
        """Returns the topic with the oldest overdue next_review_at."""
        log = {
            "topics": {
                "AC9M7N04": {
                    "attempts": [],
                    "revision": {
                        "next_review_at": (now - timedelta(days=3)).isoformat(),
                        "consecutive_revisions": 1,
                        "first_mastered_at": "2026-01-01T00:00:00+00:00",
                    },
                },
                "AC9M7N06": {
                    "attempts": [],
                    "revision": {
                        "next_review_at": (now - timedelta(days=1)).isoformat(),
                        "consecutive_revisions": 0,
                        "first_mastered_at": "2026-01-01T00:00:00+00:00",
                    },
                },
            }
        }
        result = SpacedRepetitionScheduler.find_due(log, now=now)
        assert result == "AC9M7N04"  # Oldest overdue

    def test_returns_none_when_nothing_due(self, now):
        """Returns None when no topics are due."""
        log = {
            "topics": {
                "AC9M7N04": {
                    "attempts": [],
                    "revision": {
                        "next_review_at": (now + timedelta(days=5)).isoformat(),
                        "consecutive_revisions": 1,
                        "first_mastered_at": "2026-01-01T00:00:00+00:00",
                    },
                },
            }
        }
        result = SpacedRepetitionScheduler.find_due(log, now=now)
        assert result is None

    def test_returns_none_when_no_revision_records(self, now):
        """Returns None when no topics have revision records."""
        log = {"topics": {"AC9M7N04": {"attempts": [], "accuracy": 0.5}}}
        result = SpacedRepetitionScheduler.find_due(log, now=now)
        assert result is None
