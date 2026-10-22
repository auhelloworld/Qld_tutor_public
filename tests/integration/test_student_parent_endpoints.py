"""Integration tests for student identity and parent review endpoints.

Covers the student identity and parent-only endpoint boundary:
- POST /api/student/token
- POST /api/student/profile
- GET /api/student/list
- DELETE /api/student/{student_id}
- GET /api/parent/review-queue
- POST /api/parent/review
- GET /api/parent/pu-mode
- POST /api/parent/pu-mode
- GET /api/parent/english-summary
- POST /api/parent/login
"""
from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from backend.api import app
from backend.student_identity import create_student_token, create_parent_token, decode_jwt


VALID_STUDENT_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
STUDENT_HEADERS = {"X-Student-Id": VALID_STUDENT_ID}


def _bearer_headers(student_id: str) -> dict:
    """Create Authorization header with a valid JWT bearer token."""
    token = create_student_token(student_id)
    return {"Authorization": f"Bearer {token}"}


def _parent_headers(student_id: str) -> dict:
    """Student bearer headers plus a valid parent-authorization token."""
    return {**_bearer_headers(student_id), "X-Parent-Token": create_parent_token(student_id)}


@pytest.fixture(autouse=True)
def isolated_parent_login_limiter(monkeypatch):
    """Keep the process-global login limiter isolated between tests."""
    from backend.rate_limiter import _RateLimiter

    monkeypatch.setattr("backend.routers.parent._RATE_LIMITER", _RateLimiter())


# ---------------------------------------------------------------------------
# POST /api/parent/login
# ---------------------------------------------------------------------------


class TestParentLogin:
    def test_login_requires_student_session(self):
        client = TestClient(app)
        resp = client.post("/api/parent/login", json={"password": "test-parent-password"})
        assert resp.status_code == 401
        assert resp.json()["error"] == "missing_student_id"

    def test_login_rejects_wrong_password(self):
        client = TestClient(app)
        sid = str(uuid.uuid4())
        resp = client.post(
            "/api/parent/login",
            json={"password": "wrong"},
            headers=_bearer_headers(sid),
        )
        assert resp.status_code == 401
        assert resp.json()["error"] == "invalid_parent_password"

    def test_login_token_is_bound_to_active_student(self):
        client = TestClient(app)
        sid = str(uuid.uuid4())
        resp = client.post(
            "/api/parent/login",
            json={"password": "test-parent-password"},
            headers=_bearer_headers(sid),
        )
        assert resp.status_code == 200
        payload = decode_jwt(resp.json()["token"])
        assert payload["role"] == "parent"
        assert payload["sub"] == sid

    def test_login_disabled_without_configured_password(self, monkeypatch):
        client = TestClient(app)
        sid = str(uuid.uuid4())
        monkeypatch.delenv("PARENT_PASSWORD", raising=False)
        resp = client.post(
            "/api/parent/login",
            json={"password": "parent123"},
            headers=_bearer_headers(sid),
        )
        assert resp.status_code == 503
        assert resp.json()["error"] == "parent_password_not_configured"

    def test_login_is_rate_limited(self, monkeypatch):
        from backend.rate_limiter import RATE_LIMIT_DEFAULTS, _RateLimiter

        sid = str(uuid.uuid4())
        client = TestClient(app)
        monkeypatch.setitem(RATE_LIMIT_DEFAULTS, "POST /api/parent/login", 2)
        monkeypatch.setattr("backend.routers.parent._RATE_LIMITER", _RateLimiter())
        for _ in range(2):
            resp = client.post(
                "/api/parent/login",
                json={"password": "wrong"},
                headers=_bearer_headers(sid),
            )
            assert resp.status_code == 401
        resp = client.post(
            "/api/parent/login",
            json={"password": "wrong"},
            headers=_bearer_headers(sid),
        )
        assert resp.status_code == 429
        assert resp.json()["error"] == "rate_limited"


# ---------------------------------------------------------------------------
# POST /api/student/token
# ---------------------------------------------------------------------------


class TestStudentToken:
    """POST /api/student/token — generate or retrieve session token."""

    def test_new_student_gets_token(self):
        client = TestClient(app)
        resp = client.post("/api/student/token", json={})
        assert resp.status_code == 200
        body = resp.json()
        assert "access_token" in body
        assert body["token_type"] == "bearer"
        assert "student_id" in body
        # Validate the student_id is a valid UUID v4
        assert len(body["student_id"]) == 36

    def test_existing_student_gets_token(self):
        client = TestClient(app)
        sid = str(uuid.uuid4())
        resp = client.post("/api/student/token", json={"student_id": sid})
        assert resp.status_code == 200
        body = resp.json()
        assert body["student_id"] == sid
        assert "access_token" in body

    def test_invalid_uuid_returns_400(self):
        client = TestClient(app)
        resp = client.post("/api/student/token", json={"student_id": "not-a-uuid"})
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# POST /api/student/profile
# ---------------------------------------------------------------------------


class TestStudentProfile:
    """POST /api/student/profile — save display name."""

    def test_save_profile_with_valid_token(self, tmp_data_dir):
        client = TestClient(app)
        headers = _bearer_headers(VALID_STUDENT_ID)
        resp = client.post(
            "/api/student/profile",
            json={"display_name": "Alice"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["display_name"] == "Alice"

    def test_save_profile_without_auth_returns_400(self):
        client = TestClient(app)
        resp = client.post(
            "/api/student/profile",
            json={"display_name": "Bob"},
        )
        assert resp.status_code == 401

    def test_save_profile_empty_name_returns_422(self):
        client = TestClient(app)
        headers = _bearer_headers(VALID_STUDENT_ID)
        resp = client.post(
            "/api/student/profile",
            json={"display_name": ""},
            headers=headers,
        )
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# GET /api/student/list
# ---------------------------------------------------------------------------


class TestStudentList:
    """GET /api/student/list — parent household profile list."""

    def test_list_requires_auth(self):
        client = TestClient(app)
        resp = client.get("/api/student/list")
        assert resp.status_code == 401
        assert resp.json()["error"] == "missing_student_id"

    def test_list_rejects_student_only_token(self, tmp_data_dir):
        client = TestClient(app)
        headers = _bearer_headers(VALID_STUDENT_ID)
        resp = client.get("/api/student/list", headers=headers)
        assert resp.status_code == 401

    def test_list_returns_household_profiles_for_parent(self, tmp_data_dir):
        client = TestClient(app)
        client.post(
            "/api/student/profile",
            json={"display_name": "Alice"},
            headers=_bearer_headers(VALID_STUDENT_ID),
        )
        other = str(uuid.uuid4())
        client.post(
            "/api/student/profile",
            json={"display_name": "Bob"},
            headers=_bearer_headers(other),
        )
        resp = client.get("/api/student/list", headers=_parent_headers(VALID_STUDENT_ID))
        assert resp.status_code == 200
        students = resp.json()["students"]
        ids = {s["student_id"] for s in students}
        assert VALID_STUDENT_ID in ids
        assert other in ids
        alice = next(s for s in students if s["student_id"] == VALID_STUDENT_ID)
        assert alice["display_name"] == "Alice"
        assert isinstance(alice["subjects"], list)

    def test_list_includes_registered_students_without_sqlite_rows(
        self, tmp_path, monkeypatch
    ):
        from backend.routers import auth as auth_module

        credentials_path = tmp_path / "credentials.json"
        monkeypatch.setattr(auth_module, "CREDENTIALS_PATH", credentials_path)
        other = str(uuid.uuid4())
        auth_module._save_credentials({
            "Alice Login": {
                "student_id": VALID_STUDENT_ID,
                "password_hash": "unused-in-this-test",
            },
            "Bob Login": {
                "student_id": other,
                "password_hash": "unused-in-this-test",
            },
        })

        client = TestClient(app)
        client.post(
            "/api/student/profile",
            json={"display_name": "Alice Profile"},
            headers=_bearer_headers(VALID_STUDENT_ID),
        )
        resp = client.get(
            "/api/student/list", headers=_parent_headers(VALID_STUDENT_ID)
        )

        assert resp.status_code == 200
        students = {item["student_id"]: item for item in resp.json()["students"]}
        assert set(students) == {VALID_STUDENT_ID, other}
        assert students[VALID_STUDENT_ID]["display_name"] == "Alice Profile"
        assert students[other] == {
            "student_id": other,
            "display_name": "Bob Login",
            "subjects": [],
        }

    def test_list_rejects_parent_token_bound_to_other_student(self, tmp_data_dir):
        other = str(uuid.uuid4())
        headers = {**_bearer_headers(VALID_STUDENT_ID), "X-Parent-Token": create_parent_token(other)}
        resp = TestClient(app).get("/api/student/list", headers=headers)
        assert resp.status_code == 403
        assert resp.json()["error"] == "student_scope_mismatch"


# ---------------------------------------------------------------------------
# DELETE /api/student/{student_id}
# ---------------------------------------------------------------------------


class TestStudentDelete:
    """DELETE /api/student/{student_id} — delete student data (requires auth)."""

    def test_delete_requires_auth(self):
        client = TestClient(app)
        sid = str(uuid.uuid4())
        resp = client.delete(f"/api/student/{sid}")
        assert resp.status_code == 401
        assert resp.json()["error"] == "missing_student_id"

    def test_delete_requires_parent_token(self, tmp_data_dir):
        """A student token alone must NOT be able to delete data."""
        client = TestClient(app)
        target_id = str(uuid.uuid4())
        resp = client.delete(f"/api/student/{target_id}", headers=_bearer_headers(VALID_STUDENT_ID))
        assert resp.status_code == 401

    def test_delete_allows_other_household_profile_with_parent_token(self, monkeypatch):
        """Parent may delete any local profile after unlocking for the active student."""
        client = TestClient(app)
        target_id = str(uuid.uuid4())
        headers = _parent_headers(VALID_STUDENT_ID)
        deleted: list[str] = []
        monkeypatch.setattr(
            "backend.routers.student.delete_student_data",
            lambda student_id: deleted.append(student_id),
        )
        resp = client.delete(f"/api/student/{target_id}", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"
        assert deleted == [target_id]

    def test_delete_active_student_with_parent_token(self, monkeypatch):
        client = TestClient(app)
        headers = _parent_headers(VALID_STUDENT_ID)
        deleted: list[str] = []
        monkeypatch.setattr(
            "backend.routers.student.delete_student_data",
            lambda student_id: deleted.append(student_id),
        )
        resp = client.delete(f"/api/student/{VALID_STUDENT_ID}", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"
        assert deleted == [VALID_STUDENT_ID]


# ---------------------------------------------------------------------------
# GET /api/parent/review-queue
# ---------------------------------------------------------------------------


class TestParentReviewQueue:
    """GET /api/parent/review-queue — list pending parent reviews."""

    def test_review_queue_requires_auth(self):
        client = TestClient(app)
        resp = client.get(
            "/api/parent/review-queue",
            params={"student_id": VALID_STUDENT_ID},
        )
        assert resp.status_code == 401
        assert resp.json()["error"] == "missing_student_id"

    def test_review_queue_rejects_student_only_token(self):
        client = TestClient(app)
        headers = _bearer_headers(VALID_STUDENT_ID)
        resp = client.get(
            "/api/parent/review-queue",
            params={"student_id": VALID_STUDENT_ID, "subject": "math"},
            headers=headers,
        )
        assert resp.status_code == 401

    def test_review_queue_with_parent_auth(self):
        client = TestClient(app)
        resp = client.get(
            "/api/parent/review-queue",
            params={"student_id": VALID_STUDENT_ID, "subject": "math"},
            headers=_parent_headers(VALID_STUDENT_ID),
        )
        assert resp.status_code == 200
        assert "pending" in resp.json()

    def test_review_queue_rejects_other_target(self):
        client = TestClient(app)
        resp = client.get(
            "/api/parent/review-queue",
            params={"student_id": str(uuid.uuid4()), "subject": "math"},
            headers=_parent_headers(VALID_STUDENT_ID),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# POST /api/parent/review
# ---------------------------------------------------------------------------


class TestParentReview:
    """POST /api/parent/review — approve or reject a pending review."""

    def test_review_requires_auth(self):
        client = TestClient(app)
        resp = client.post(
            "/api/parent/review",
            json={
                "student_id": VALID_STUDENT_ID,
                "subject": "math",
                "topic": "fractions",
                "question_id": "q1",
                "student_answer": "1/2",
                "correct": True,
            },
        )
        assert resp.status_code == 401
        assert resp.json()["error"] == "missing_student_id"

    def test_review_rejects_student_only_token(self, tmp_data_dir):
        """Student token alone must NOT approve reviews (no self-approval)."""
        client = TestClient(app)
        resp = client.post(
            "/api/parent/review",
            json={
                "student_id": VALID_STUDENT_ID,
                "subject": "math",
                "topic": "fractions",
                "question_id": "nonexistent_q",
                "student_answer": "1/2",
                "correct": True,
            },
            headers=_bearer_headers(VALID_STUDENT_ID),
        )
        assert resp.status_code == 401

    def test_review_with_auth(self, tmp_data_dir):
        client = TestClient(app)
        headers = _parent_headers(VALID_STUDENT_ID)
        resp = client.post(
            "/api/parent/review",
            json={
                "student_id": VALID_STUDENT_ID,
                "subject": "math",
                "topic": "fractions",
                "question_id": "nonexistent_q",
                "student_answer": "1/2",
                "correct": True,
            },
            headers=headers,
        )
        assert resp.status_code == 200
        # Review not found is expected since we didn't seed one
        assert resp.json()["ok"] is False

    def test_review_rejects_other_target(self, tmp_data_dir):
        client = TestClient(app)
        other = str(uuid.uuid4())
        resp = client.post(
            "/api/parent/review",
            json={
                "student_id": other,
                "subject": "math",
                "topic": "fractions",
                "question_id": "q1",
                "student_answer": "1/2",
                "correct": True,
            },
            headers=_parent_headers(VALID_STUDENT_ID),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# GET/POST /api/parent/pu-mode
# ---------------------------------------------------------------------------


class TestParentPuMode:
    """GET and POST /api/parent/pu-mode — parent review mode toggle."""

    def test_get_pu_mode_requires_auth(self):
        client = TestClient(app)
        resp = client.get("/api/parent/pu-mode")
        assert resp.status_code == 401
        assert resp.json()["error"] == "missing_student_id"

    def test_get_pu_mode_rejects_student_only_token(self):
        client = TestClient(app)
        headers = _bearer_headers(VALID_STUDENT_ID)
        resp = client.get("/api/parent/pu-mode", headers=headers)
        assert resp.status_code == 401

    def test_get_pu_mode_with_parent_auth(self):
        client = TestClient(app)
        resp = client.get("/api/parent/pu-mode", headers=_parent_headers(VALID_STUDENT_ID))
        assert resp.status_code == 200
        assert "pu_mode" in resp.json()

    def test_set_pu_mode_requires_auth(self):
        client = TestClient(app)
        resp = client.post("/api/parent/pu-mode", json={"enabled": True})
        assert resp.status_code == 401
        assert resp.json()["error"] == "missing_student_id"

    def test_set_pu_mode_rejects_student_only_token(self):
        """Student token alone must NOT toggle PU-mode."""
        client = TestClient(app)
        resp = client.post("/api/parent/pu-mode", json={"enabled": True}, headers=_bearer_headers(VALID_STUDENT_ID))
        assert resp.status_code == 401

    def test_set_pu_mode_with_auth(self, tmp_data_dir):
        client = TestClient(app)
        headers = _parent_headers(VALID_STUDENT_ID)
        # Enable
        resp = client.post("/api/parent/pu-mode", json={"enabled": True}, headers=headers)
        assert resp.status_code == 200
        assert resp.json()["pu_mode"] is True
        # The per-student setting is now readable back via GET (same active student).
        resp = client.get("/api/parent/pu-mode", headers=headers)
        assert resp.json()["pu_mode"] is True
        # Disable (cleanup)
        resp = client.post("/api/parent/pu-mode", json={"enabled": False}, headers=headers)
        assert resp.status_code == 200
        assert resp.json()["pu_mode"] is False


# ---------------------------------------------------------------------------
# GET /api/parent/english-summary
# ---------------------------------------------------------------------------


class TestParentEnglishSummary:
    def test_summary_rejects_student_only_token(self, tmp_data_dir):
        resp = TestClient(app).get(
            "/api/parent/english-summary",
            params={"student_id": VALID_STUDENT_ID, "year_level": 7},
            headers=_bearer_headers(VALID_STUDENT_ID),
        )
        assert resp.status_code == 401

    def test_summary_rejects_other_target(self, tmp_data_dir):
        resp = TestClient(app).get(
            "/api/parent/english-summary",
            params={"student_id": str(uuid.uuid4()), "year_level": 7},
            headers=_parent_headers(VALID_STUDENT_ID),
        )
        assert resp.status_code == 403

    def test_summary_allows_bound_parent(self, tmp_data_dir):
        resp = TestClient(app).get(
            "/api/parent/english-summary",
            params={"student_id": VALID_STUDENT_ID, "year_level": 7},
            headers=_parent_headers(VALID_STUDENT_ID),
        )
        assert resp.status_code == 200
        assert resp.json()["student_id"] == VALID_STUDENT_ID
