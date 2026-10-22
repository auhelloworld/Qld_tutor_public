"""Tests for the reading evidence-check endpoint (Audit Packet 2.2)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.api import app
from backend.student_identity import create_student_token

VALID_STUDENT_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
AUTH_HEADER = {"Authorization": f"Bearer {create_student_token(VALID_STUDENT_ID)}"}


@pytest.fixture()
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _seed_exercises(monkeypatch):
    """Inject a known exercise into the engine so evidence-check can resolve it."""
    from backend.routers import tutor as _tutor_mod

    _exercises = {
        "en_passage_1": {
            "id": "en_passage_1",
            "topic": "reading comprehension",
            "question": (
                "**Passage:**\n"
                "The ancient oak tree stood in the centre of the village green.\n"
                "Its branches spread wide, casting deep shadows across the grass.\n"
                "Children often played beneath it during the warm summer evenings.\n\n"
                "**Question:**\n"
                "Why is the oak tree important to the village?"
            ),
            "answer": "The oak tree provides shade and a gathering place.",
            "steps": [],
            "framework": "AC9_ENGLISH",
            "topic_ids": ["AC9E7LE01"],
            "subject": "english",
            "difficulty": "developing",
            "year_level": 7,
            "english_metadata": {"facet": "text_evidence"},
        },
        "en_no_passage": {
            "id": "en_no_passage",
            "topic": "spelling",
            "question": "Spell the past tense of 'run'.",
            "answer": "ran",
            "steps": [],
            "framework": "AC9_ENGLISH",
            "topic_ids": ["AC9E7LA09"],
            "subject": "english",
            "difficulty": "foundational",
            "year_level": 7,
            "english_metadata": {"facet": "spelling_punctuation"},
        },
    }

    engine = _tutor_mod.get_tutor_engine()
    monkeypatch.setattr(engine, "exercises", _exercises)


class TestEvidenceCheck:
    def test_strong_evidence(self, client):
        resp = client.post(
            "/api/tutor/english/evidence-check",
            json={
                "exercise_id": "en_passage_1",
                "student_answer": "The ancient oak tree stood in the centre and its branches spread wide casting deep shadows",
            },
            headers=AUTH_HEADER,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["has_passage"] is True
        assert body["evidence_score"] >= 2
        assert len(body["matched_phrases"]) > 0

    def test_weak_evidence(self, client):
        resp = client.post(
            "/api/tutor/english/evidence-check",
            json={
                "exercise_id": "en_passage_1",
                "student_answer": "I think trees are nice and important for people",
            },
            headers=AUTH_HEADER,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["evidence_score"] <= 1

    def test_empty_answer(self, client):
        resp = client.post(
            "/api/tutor/english/evidence-check",
            json={"exercise_id": "en_passage_1", "student_answer": ""},
            headers=AUTH_HEADER,
        )
        assert resp.status_code == 200
        assert resp.json()["evidence_score"] == 0

    def test_no_passage_exercise(self, client):
        resp = client.post(
            "/api/tutor/english/evidence-check",
            json={"exercise_id": "en_no_passage", "student_answer": "ran"},
            headers=AUTH_HEADER,
        )
        assert resp.status_code == 200
        assert resp.json()["has_passage"] is False

    def test_exercise_not_found(self, client):
        resp = client.post(
            "/api/tutor/english/evidence-check",
            json={"exercise_id": "nonexistent", "student_answer": "test"},
            headers=AUTH_HEADER,
        )
        assert resp.status_code == 404
