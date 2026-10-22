"""Tests for Task 12 — _ErrorPatternCache.

Verifies:
- Two consecutive calls within 60s and same incorrect count → second is cached.
- Adding 2 new errors → next call is a cache miss.
- After 60s → cache miss.
- Different student_id → distinct cache entries.
"""
from __future__ import annotations

import time
from unittest.mock import patch

from backend.tutor_engine import _ErrorPatternCache
from core.schema.tutor_schema import ErrorPatternResult


class TestErrorPatternCache:
    """Unit tests for the _ErrorPatternCache class."""

    def test_cache_hit_within_ttl_same_count(self):
        """Two consecutive calls within 60s and same incorrect count → cached."""
        cache = _ErrorPatternCache()
        result = ErrorPatternResult(pattern_found=True, analysis="Repeated calc errors")

        cache.store("student1", "fractions", 5, result)
        served = cache.maybe_serve("student1", "fractions", 5)
        assert served is not None
        assert served.pattern_found is True
        assert served.analysis == "Repeated calc errors"

    def test_cache_miss_after_new_incorrect_threshold(self):
        """Adding 2 new errors → next call is a cache miss."""
        cache = _ErrorPatternCache()
        result = ErrorPatternResult(pattern_found=True, analysis="Pattern A")

        cache.store("student1", "fractions", 5, result)
        # Same count → hit
        assert cache.maybe_serve("student1", "fractions", 5) is not None
        # 1 new error → still hit (threshold is 2)
        assert cache.maybe_serve("student1", "fractions", 6) is not None
        # 2 new errors → miss
        assert cache.maybe_serve("student1", "fractions", 7) is None

    def test_cache_miss_after_ttl_expires(self):
        """After 60s → cache miss."""
        cache = _ErrorPatternCache()
        result = ErrorPatternResult(pattern_found=True, analysis="Pattern B")

        # Store with a fake old timestamp
        cache._cache[("student1", "fractions")] = (
            time.monotonic() - 61,  # 61 seconds ago
            5,
            result,
        )
        served = cache.maybe_serve("student1", "fractions", 5)
        assert served is None

    def test_different_students_distinct_entries(self):
        """Different student_id → distinct cache entries."""
        cache = _ErrorPatternCache()
        result_a = ErrorPatternResult(pattern_found=True, analysis="Student A pattern")
        result_b = ErrorPatternResult(pattern_found=True, analysis="Student B pattern")

        cache.store("student_a", "fractions", 5, result_a)
        cache.store("student_b", "fractions", 3, result_b)

        served_a = cache.maybe_serve("student_a", "fractions", 5)
        served_b = cache.maybe_serve("student_b", "fractions", 3)

        assert served_a is not None
        assert served_a.analysis == "Student A pattern"
        assert served_b is not None
        assert served_b.analysis == "Student B pattern"

    def test_cache_miss_on_empty(self):
        """Empty cache returns None."""
        cache = _ErrorPatternCache()
        assert cache.maybe_serve("student1", "fractions", 5) is None

    def test_different_topics_distinct_entries(self):
        """Different topics for same student → distinct cache entries."""
        cache = _ErrorPatternCache()
        result_a = ErrorPatternResult(pattern_found=True, analysis="Fractions pattern")
        result_b = ErrorPatternResult(pattern_found=True, analysis="Algebra pattern")

        cache.store("student1", "fractions", 5, result_a)
        cache.store("student1", "algebra", 4, result_b)

        assert cache.maybe_serve("student1", "fractions", 5).analysis == "Fractions pattern"
        assert cache.maybe_serve("student1", "algebra", 4).analysis == "Algebra pattern"
