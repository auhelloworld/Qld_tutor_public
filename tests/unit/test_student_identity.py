"""Unit tests for backend/student_identity.py — Task 3 verification gate.

Tests the three branches of ``require_student_id``:
- Missing header → raises StudentIdMissing (401)
- Invalid UUID → raises StudentIdInvalid (401)
- Valid UUID → returns the UUID string
"""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

import pytest

from backend.student_identity import (
    StudentIdInvalid,
    StudentIdMissing,
    create_parent_token,
    encode_jwt,
    ensure_parent_student_access,
    get_parent_password,
    require_parent,
    require_student_id,
)


def _mock_request(path: str = "/api/tutor/mark") -> MagicMock:
    """Create a minimal mock Request with a url.path attribute."""
    request = MagicMock()
    request.url.path = path
    return request


def test_missing_header_raises_student_id_missing():
    request = _mock_request("/api/tutor/mark")
    with pytest.raises(StudentIdMissing) as exc_info:
        asyncio.run(require_student_id(request, x_student_id=None))
    assert exc_info.value.status_code == 401
    assert exc_info.value.detail["error"] == "missing_student_id"
    assert exc_info.value.detail["endpoint"] == "/api/tutor/mark"


def test_invalid_uuid_raises_student_id_invalid():
    request = _mock_request("/api/tutor/mark")
    with pytest.raises(StudentIdInvalid) as exc_info:
        asyncio.run(require_student_id(request, x_student_id="not-a-uuid"))
    assert exc_info.value.status_code == 401
    assert exc_info.value.detail["error"] == "invalid_student_id"
    assert "not-a-uuid" in exc_info.value.detail["message"]
    assert exc_info.value.detail["endpoint"] == "/api/tutor/mark"


def test_valid_uuid_returns_the_string():
    request = _mock_request("/api/tutor/suggest")
    valid_uuid = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
    result = asyncio.run(require_student_id(request, x_student_id=valid_uuid))
    assert result == valid_uuid


def test_valid_uuid_uppercase_returns_the_string():
    """UUID matching is case-insensitive per spec."""
    request = _mock_request("/api/tutor/plan")
    valid_uuid = "A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D"
    result = asyncio.run(require_student_id(request, x_student_id=valid_uuid))
    assert result == valid_uuid


def test_parent_password_has_no_builtin_default(monkeypatch):
    monkeypatch.delenv("PARENT_PASSWORD", raising=False)
    assert get_parent_password() is None


def test_configured_parent_password_is_returned(monkeypatch):
    monkeypatch.setenv("PARENT_PASSWORD", "a-private-password")
    assert get_parent_password() == "a-private-password"


def test_parent_token_is_bound_to_student():
    student_id = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
    token = create_parent_token(student_id)
    result = asyncio.run(require_parent(_mock_request("/api/parent/review-queue"), x_parent_token=token))
    assert result == student_id


def test_parent_token_expires_within_two_hours():
    """A parent token left in a shared browser tab must not stay valid all day."""
    from backend.student_identity import decode_jwt

    payload = decode_jwt(create_parent_token("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"))
    assert payload["exp"] - payload["iat"] <= 2 * 3600


def test_unbound_legacy_parent_token_is_rejected():
    token = encode_jwt({"role": "parent"})
    with pytest.raises(Exception) as exc_info:
        asyncio.run(require_parent(_mock_request("/api/parent/review-queue"), x_parent_token=token))
    assert exc_info.value.status_code == 401
    assert exc_info.value.detail["error"] == "parent_auth_invalid"


def test_parent_scope_requires_caller_parent_and_target_match():
    student_id = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
    assert ensure_parent_student_access(student_id, student_id, student_id) == student_id

    other = "11111111-2222-4333-8444-555555555555"
    with pytest.raises(Exception) as exc_info:
        ensure_parent_student_access(student_id, student_id, other)
    assert exc_info.value.status_code == 403
    assert exc_info.value.detail["error"] == "student_scope_mismatch"
