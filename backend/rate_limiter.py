"""Sliding-window rate limiter per (student_id, endpoint_key).

Design §3.7 — robustness-hardening spec.
Req 8.1, 8.2–8.5, 8.7, 8.9, 8.10.
"""
from __future__ import annotations

import threading
import time
from collections import OrderedDict, deque

RATE_LIMIT_WINDOW_SEC: float = 60.0

RATE_LIMIT_DEFAULTS: dict[str, int] = {
    "POST /api/tutor/mark": 30,
    "POST /api/tutor/suggest": 120,
    "POST /api/tutor/dialogue": 60,
    "POST /api/tutor/writing/assess": 10,
    "POST /api/diagnostic/start": 5,
    "POST /api/diagnostic/respond": 60,
    "GET /api/diagnostic/status": 60,
    "POST /api/diagnostic/dismiss": 5,
    "POST /api/parent/login": 5,
    "POST /api/auth/login": 10,
    "tutor.error_pattern": 5,
}


class _RateLimiter:
    """Thread-safe, bounded sliding-window limiter.

    Buckets are kept in access order.  Stale cleanup is periodic instead of an
    O(number-of-identities) scan on every admitted request, and an unknown key
    is rejected when the hard capacity is exhausted after cleanup.  Failing
    closed preserves rate-limit guarantees during high-cardinality abuse.
    """

    STALE_AFTER_SEC: float = RATE_LIMIT_WINDOW_SEC * 2
    CLEANUP_INTERVAL_SEC: float = 5.0
    MAX_BUCKETS: int = 10_000

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._buckets: OrderedDict[tuple[str, str], deque[float]] = OrderedDict()
        self._last_cleanup = 0.0

    def admit(self, student_id: str, endpoint_key: str, limit: int) -> bool:
        """Return True if the request is admitted, False if rate-limited."""
        now = time.monotonic()
        cutoff = now - RATE_LIMIT_WINDOW_SEC
        key = (student_id, endpoint_key)
        with self._lock:
            self._maybe_cleanup(now)
            bucket = self._buckets.get(key)
            if bucket is None:
                if len(self._buckets) >= self.MAX_BUCKETS:
                    self._cleanup_stale(now)
                if len(self._buckets) >= self.MAX_BUCKETS:
                    return False
                bucket = deque()
                self._buckets[key] = bucket
            else:
                self._buckets.move_to_end(key)

            while bucket and bucket[0] < cutoff:
                bucket.popleft()
            if len(bucket) >= limit:
                return False
            bucket.append(now)
            return True

    def retry_after_seconds(self, student_id: str, endpoint_key: str) -> int:
        """Return seconds until the oldest entry expires from the window."""
        now = time.monotonic()
        key = (student_id, endpoint_key)
        with self._lock:
            bucket = self._buckets.get(key)
            if not bucket:
                return 1
            while bucket and bucket[0] < now - RATE_LIMIT_WINDOW_SEC:
                bucket.popleft()
            if not bucket:
                self._buckets.pop(key, None)
                return 1
            self._buckets.move_to_end(key)
            return max(1, int(bucket[0] + RATE_LIMIT_WINDOW_SEC - now) + 1)

    def discard_student(self, student_id: str) -> None:
        """Remove all limiter state for a deleted student/profile."""
        with self._lock:
            for key in [key for key in self._buckets if key[0] == student_id]:
                self._buckets.pop(key, None)

    def _maybe_cleanup(self, now: float) -> None:
        """Run the O(N) stale scan at most once per cleanup interval."""
        if now - self._last_cleanup < self.CLEANUP_INTERVAL_SEC:
            return
        self._cleanup_stale(now)

    def _cleanup_stale(self, now: float) -> None:
        """Remove idle buckets. Caller holds ``_lock``."""
        stale_cutoff = now - self.STALE_AFTER_SEC
        for key in [
            key
            for key, bucket in self._buckets.items()
            if not bucket or bucket[-1] < stale_cutoff
        ]:
            self._buckets.pop(key, None)
        self._last_cleanup = now


_RATE_LIMITER = _RateLimiter()
