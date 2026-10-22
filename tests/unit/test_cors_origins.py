"""Verification for Task 8 — Env-driven CORS origins.

Tests that _resolve_cors_origins reads from CORS_ORIGINS env var
and defaults to localhost:3000 when unset.
"""

from backend.api import _resolve_cors_origins


def test_cors_default_is_localhost(monkeypatch):
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    origins = _resolve_cors_origins()
    assert origins == ["http://localhost:3000"]


def test_cors_reads_from_env(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "https://x.example,https://y.example")
    origins = _resolve_cors_origins()
    assert "https://x.example" in origins
    assert "https://y.example" in origins


def test_cors_trims_whitespace(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "  https://a.example , https://b.example  ")
    origins = _resolve_cors_origins()
    assert origins == ["https://a.example", "https://b.example"]


def test_cors_empty_string_defaults_to_localhost(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "   ")
    origins = _resolve_cors_origins()
    assert origins == ["http://localhost:3000"]
