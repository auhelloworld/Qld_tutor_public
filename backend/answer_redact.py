"""Token-level answer-leak redactor.

Design §3.4 — robustness-hardening spec.
Pure-Python module with no I/O, no LLM calls, no network.

Properties:
- Idempotent: redact(redact(t, a), a) == redact(t, a)
- Left-monotone: redaction in T1 survives in T1 + T2
- Never increases leakage
"""
from __future__ import annotations

import re

from backend.answer_normalize import signatures

# ---------------------------------------------------------------------------
# Redaction token (Req 4.2)
# ---------------------------------------------------------------------------

REDACTION_TOKEN = "[?]"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def redact(text: str, answer: str) -> tuple[str, bool]:
    """Redact answer leaks from text.

    Args:
        text: The hint text to redact.
        answer: The exercise's correct answer string.

    Returns:
        (redacted_text, applied) where applied is True if any redaction occurred.
    """
    if not text or not answer:
        return text, False

    try:
        sig_set = signatures(answer)
        if not sig_set:
            return text, False

        spans = _find_leak_spans(text, sig_set)
        if not spans:
            return text, False

        coalesced = _coalesce_overlapping(spans)
        coalesced.sort()

        out: list[str] = []
        cursor = 0
        for start, end in coalesced:
            out.append(text[cursor:start])
            out.append(REDACTION_TOKEN)
            cursor = end
        out.append(text[cursor:])

        redacted = "".join(out)
        applied = redacted != text
        return redacted, applied

    except Exception:
        # Totality: never raise, never increase leakage
        return text, False


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _find_leak_spans(text: str, sig_set: set[str]) -> list[tuple[int, int]]:
    """Find all (start, end) spans where a signature string appears in text."""
    spans: list[tuple[int, int]] = []

    for sig_str in sig_set:
        if not sig_str:
            continue
        # Skip single-character non-alphanumeric signatures — they are too
        # short to be meaningful answer leaks and can match inside the
        # REDACTION_TOKEN itself, breaking idempotence.
        if len(sig_str) == 1 and not sig_str.isalnum():
            continue
        # Build a word-boundary-aware pattern for the signature
        pattern = _pattern_for_signature(sig_str)
        if pattern is None:
            continue
        for m in pattern.finditer(text):
            spans.append((m.start(), m.end()))

    return spans


def _pattern_for_signature(sig_str: str) -> re.Pattern | None:
    """Build a regex pattern for a single signature string.

    Uses word boundaries where practical for precision.
    """
    try:
        # Escape the signature for use in regex
        escaped = re.escape(sig_str)
        # Use word boundaries to avoid partial matches within larger words
        # But for patterns with special chars (like /), use lookaround for boundaries
        if re.fullmatch(r"[a-zA-Z0-9 ]+", sig_str):
            # Pure alphanumeric + spaces: use word boundaries
            return re.compile(r"\b" + escaped + r"\b", re.IGNORECASE)
        else:
            # Contains special chars (fractions, units): match literally
            # Use lookahead/lookbehind for word-like boundaries where possible
            return re.compile(escaped, re.IGNORECASE)
    except re.error:
        return None


def _coalesce_overlapping(spans: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Merge overlapping or adjacent spans into non-overlapping intervals."""
    if not spans:
        return []

    sorted_spans = sorted(spans)
    merged: list[tuple[int, int]] = [sorted_spans[0]]

    for start, end in sorted_spans[1:]:
        prev_start, prev_end = merged[-1]
        if start <= prev_end:
            # Overlapping or adjacent — extend
            merged[-1] = (prev_start, max(prev_end, end))
        else:
            merged.append((start, end))

    return merged
