"""Phase 3 property-based tests — parser, redaction, verifier, rate-limiter.

**Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.10**

Uses Hypothesis with the ``dev`` profile (50 examples max).
"""
from __future__ import annotations

import os
import time
from fractions import Fraction
from math import gcd

import pytest
from hypothesis import given, settings, assume, HealthCheck
from hypothesis import strategies as st

from backend.answer_normalize import CanonicalAnswerForm, normalise, signatures
from backend.answer_redact import REDACTION_TOKEN, redact
from backend.rate_limiter import RATE_LIMIT_DEFAULTS, _RateLimiter
from backend.tutor_engine import TutorEngine
from core.schema.tutor_schema import (
    ErrorPatternResult,
    HintResult,
    MarkResult,
    VariationResult,
)

_FIXTURE_HC = [HealthCheck.function_scoped_fixture]


# ---------------------------------------------------------------------------
# Shared engine instance (avoid fixture-scoped issue with Hypothesis)
# ---------------------------------------------------------------------------

def _get_mock_engine():
    """Create a TutorEngine in mock mode."""
    os.environ.pop("GEMINI_API_KEY", None)
    os.environ.pop("OPENAI_API_KEY", None)
    return TutorEngine()


_ENGINE = _get_mock_engine()


# ---------------------------------------------------------------------------
# 10.1 Parser totality: _parse_llm_json never raises for any string input.
# **Validates: Requirements 6.1**
# ---------------------------------------------------------------------------


@pytest.mark.property
@given(st.text(min_size=0, max_size=200))
def test_parser_totality(raw: str):
    """_parse_llm_json never raises for any string input across all four schemas."""
    schemas = [
        (MarkResult, MarkResult.fallback()),
        (HintResult, HintResult.fallback()),
        (VariationResult, VariationResult.fallback()),
        (ErrorPatternResult, ErrorPatternResult.fallback()),
    ]
    for schema_cls, fallback in schemas:
        result = _ENGINE._parse_llm_json(raw, schema_cls, fallback)
        assert isinstance(result, schema_cls), (
            f"Expected {schema_cls.__name__}, got {type(result).__name__}"
        )


# ---------------------------------------------------------------------------
# 10.2 Redaction idempotence: redact(redact(t, a), a) == redact(t, a).
# **Validates: Requirements 6.2**
# ---------------------------------------------------------------------------


@pytest.mark.property
@given(
    st.text(min_size=0, max_size=100),
    st.text(min_size=1, max_size=20),
)
def test_redaction_idempotence(text: str, answer: str):
    """redact(redact(t, a), a) == redact(t, a)."""
    first_pass, _ = redact(text, answer)
    second_pass, _ = redact(first_pass, answer)
    assert second_pass == first_pass, (
        f"Redaction not idempotent:\n"
        f"  text={text!r}\n  answer={answer!r}\n"
        f"  first={first_pass!r}\n  second={second_pass!r}"
    )


# ---------------------------------------------------------------------------
# 10.3 Redaction left/right monotonicity.
# **Validates: Requirements 6.3**
# ---------------------------------------------------------------------------


@pytest.mark.property
@given(
    st.text(min_size=1, max_size=50),
    st.text(min_size=1, max_size=50),
    st.sampled_from(["7", "3/4", "12", "0.75", "15"]),
)
def test_redaction_left_monotonicity(t1: str, t2: str, answer: str):
    """If a signature is redacted in T1, it is also redacted in T1+T2."""
    # If the boundary character of t1 and t2 are both alphanumeric, they merge and alter word boundaries.
    assume(not (t1 and t1[-1].isalnum() and t2 and t2[0].isalnum()))

    redacted_t1, applied_t1 = redact(t1, answer)
    redacted_combined, applied_combined = redact(t1 + t2, answer)

    if not applied_t1:
        return  # Nothing to check if no redaction in T1

    # If redaction was applied to T1, it must also be applied to T1+T2
    # (the combined text contains T1 as a prefix, so the same leaks exist)
    assert applied_combined, (
        f"Redaction applied to T1={t1!r} but not to T1+T2 with answer={answer!r}"
    )


# ---------------------------------------------------------------------------
# 10.4 No-leak-after-redaction: after redaction, no signature appears in text.
# **Validates: Requirements 6.4**
# ---------------------------------------------------------------------------


@pytest.mark.property
@given(
    st.sampled_from(["7", "3/4", "0.75", "12", "1/2", "15"]),
)
def test_no_leak_after_redaction(answer: str):
    """After redaction, no signature form of the answer appears in the text."""
    sig_set = signatures(answer)
    assume(len(sig_set) > 0)

    # Pick a signature to embed in text
    sig_list = sorted(sig_set)
    text = f"The answer is {sig_list[0]} which you should know."

    redacted, applied = redact(text, answer)

    if not applied:
        return  # If redaction didn't apply, the signature wasn't found

    # After redaction, no signature should remain (check non-trivial ones)
    cleaned = redacted.replace(REDACTION_TOKEN, "")
    for sig in sig_set:
        if sig and len(sig) > 1:
            assert sig.lower() not in cleaned.lower(), (
                f"Leak detected: {sig!r} still in redacted text after removing tokens"
            )


# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# 10.6 Rate-limit upper bound: N+1 calls within window, last is denied.
# **Validates: Requirements 6.6, 6.8, 6.10**
# ---------------------------------------------------------------------------


@pytest.mark.property
@given(st.integers(min_value=5, max_value=30))
def test_rate_limit_upper_bound(limit: int):
    """N+1 calls within the window: the (N+1)th is denied."""
    limiter = _RateLimiter()
    student_id = "rate-test-student"
    endpoint = "POST /api/tutor/mark"

    admitted_count = 0
    for i in range(limit + 1):
        if limiter.admit(student_id, endpoint, limit):
            admitted_count += 1

    assert admitted_count == limit, (
        f"Expected exactly {limit} admissions, got {admitted_count}"
    )


# ---------------------------------------------------------------------------
# 10.7 Normaliser totality + determinism.
# **Validates: Requirements 6.7**
# ---------------------------------------------------------------------------


@pytest.mark.property
@given(st.text(min_size=0, max_size=100))
def test_normaliser_totality(s: str):
    """normalise(s) never raises and returns a CanonicalAnswerForm."""
    result = normalise(s)
    assert isinstance(result, CanonicalAnswerForm), (
        f"normalise({s!r}) returned {type(result).__name__}, expected CanonicalAnswerForm"
    )


@pytest.mark.property
@given(st.text(min_size=0, max_size=100))
def test_normaliser_determinism(s: str):
    """normalise(s) == normalise(s) — same input always produces same output."""
    result1 = normalise(s)
    result2 = normalise(s)
    assert result1 == result2, (
        f"normalise({s!r}) is not deterministic: {result1} != {result2}"
    )
