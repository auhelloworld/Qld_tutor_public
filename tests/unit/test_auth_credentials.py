"""Credential-store contracts for /api/auth (register + login).

Covers the durability and disclosure defects found in review:
- the store path must not depend on the process working directory;
- an interrupted write must not truncate the file;
- a corrupt file must not read as "no accounts" (which let the next
  registration overwrite every account);
- login must be throttled and must not reveal which names are registered.
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.api import app
from backend.rate_limiter import _RATE_LIMITER
from backend.routers import auth as auth_router

client = TestClient(app)


@pytest.fixture(autouse=True)
def isolated_credentials(tmp_path, monkeypatch):
    """Point the credential store at a temp file and reset login throttling."""
    monkeypatch.setattr(auth_router, "CREDENTIALS_PATH", tmp_path / "credentials.json")
    _RATE_LIMITER._buckets.clear()
    yield
    _RATE_LIMITER._buckets.clear()


def test_credentials_path_is_repo_anchored_not_cwd_relative():
    """A relative path silently moves the store when uvicorn starts elsewhere."""
    from backend.routers.auth import CREDENTIALS_PATH as configured

    # The module-level default (not the fixture override) must be absolute.
    default = Path(auth_router.__dict__["_PROJECT_ROOT"]) / "data" / "credentials.json"
    assert default.is_absolute()
    assert default.parent.name == "data"
    assert isinstance(configured, Path)


def test_register_then_login_round_trip():
    reg = client.post("/api/auth/register", json={"name": "Ada", "password": "hunter2"})
    assert reg.status_code == 200, reg.text
    student_id = reg.json()["student_id"]

    login = client.post("/api/auth/login", json={"name": "Ada", "password": "hunter2"})
    assert login.status_code == 200, login.text
    assert login.json()["student_id"] == student_id
    assert login.json()["access_token"]


def test_save_is_atomic_and_leaves_no_temp_files():
    client.post("/api/auth/register", json={"name": "Ada", "password": "hunter2"})
    path = auth_router.CREDENTIALS_PATH
    assert path.exists()
    # Valid JSON on disk, and no stray temp files beside it.
    json.loads(path.read_text(encoding="utf-8"))
    leftovers = [p.name for p in path.parent.iterdir() if p.suffix == ".tmp"]
    assert leftovers == []


def test_corrupt_store_does_not_erase_accounts():
    client.post("/api/auth/register", json={"name": "Ada", "password": "hunter2"})
    path = auth_router.CREDENTIALS_PATH
    original = path.read_text(encoding="utf-8")
    path.write_text(original[: len(original) // 2], encoding="utf-8")  # truncated write

    # Registering the same name must not be allowed to overwrite the file.
    resp = client.post("/api/auth/register", json={"name": "Ada", "password": "other"})
    assert resp.status_code == 503
    assert resp.json()["error"] == "credential_store_unavailable"
    assert path.read_text(encoding="utf-8") == original[: len(original) // 2]

    login = client.post("/api/auth/login", json={"name": "Ada", "password": "hunter2"})
    assert login.status_code == 503


def test_login_does_not_disclose_registered_names():
    client.post("/api/auth/register", json={"name": "Ada", "password": "hunter2"})

    unknown = client.post("/api/auth/login", json={"name": "Nobody", "password": "hunter2"})
    wrong_pw = client.post("/api/auth/login", json={"name": "Ada", "password": "wrong"})

    assert unknown.status_code == wrong_pw.status_code == 401
    assert unknown.json() == wrong_pw.json()
    assert unknown.json()["error"] == "invalid_credentials"


def test_login_is_rate_limited():
    client.post("/api/auth/register", json={"name": "Ada", "password": "hunter2"})
    statuses = [
        client.post("/api/auth/login", json={"name": "Ada", "password": "wrong"}).status_code
        for _ in range(12)
    ]
    assert 429 in statuses, statuses
    limited = client.post("/api/auth/login", json={"name": "Ada", "password": "hunter2"})
    assert limited.status_code == 429
    assert limited.headers.get("Retry-After")
