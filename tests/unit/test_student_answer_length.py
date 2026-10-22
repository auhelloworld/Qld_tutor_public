"""Verification for Task 7 — Length cap on student_answer.

Confirms that student_answer exceeding 1000 characters returns HTTP 400
with the structured error body.
"""

from fastapi.testclient import TestClient

from backend.api import app
from backend.student_identity import create_student_token

client = TestClient(app)

VALID_STUDENT_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"


def _auth_headers(student_id: str = VALID_STUDENT_ID) -> dict:
    token = create_student_token(student_id)
    return {"Authorization": f"Bearer {token}"}


def test_student_answer_too_long_returns_400():
    response = client.post(
        "/api/tutor/mark",
        json={"question_id": "math_7_f_AC9M7N02_adae12", "student_answer": "x" * 1001},
        headers=_auth_headers(),
    )
    assert response.status_code == 400
    assert response.json()["error"] == "student_answer_too_long"


def test_student_answer_at_limit_is_accepted():
    """Exactly 1000 characters should be accepted (not rejected)."""
    response = client.post(
        "/api/tutor/mark",
        json={"question_id": "math_7_f_AC9M7N02_adae12", "student_answer": "x" * 1000},
        headers=_auth_headers(),
    )
    # Should not be 400 for length — may be 200 (mock mode grading)
    assert response.status_code == 200
