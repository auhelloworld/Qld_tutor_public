"""Tests for the linked writing revision loop (Audit Packet 4.1)."""
from __future__ import annotations

import json
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.api import app
from backend.student_identity import create_student_token
from backend.routers import writing as _writing_mod

VALID_STUDENT_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
AUTH_HEADER = {"Authorization": f"Bearer {create_student_token(VALID_STUDENT_ID)}"}


@pytest.fixture()
def client():
    return TestClient(app)


@pytest.fixture()
def writing_log_dir(tmp_path):
    """Create a temp log dir with one assessment entry."""
    student_dir = tmp_path / VALID_STUDENT_ID
    student_dir.mkdir(parents=True)
    log_path = student_dir / "english_writing_log.json"

    original_assessment = {
        "timestamp": "2026-06-17T10:00:00+00:00",
        "year_level": 7,
        "prompt_type": "persuasive",
        "draft_text": "School uniforms should be banned because they limit student expression and creativity.",
        "word_count": 12,
        "total_score": 15,
        "max_total_score": 48,
        "estimated_band": 3,
        "criterion_scores": [
            {"criterion_number": 1, "name": "Audience", "score": 3, "max_score": 6},
            {"criterion_number": 2, "name": "Text Structure", "score": 2, "max_score": 4},
        ],
        "revision_of": None,
    }
    log_data = {"student_id": VALID_STUDENT_ID, "assessments": [original_assessment]}
    log_path.write_text(json.dumps(log_data), encoding="utf-8")
    return tmp_path


class TestRevisionCompare:
    def test_compare_returns_metrics(self, client, writing_log_dir):
        with patch.object(_writing_mod, "_LOG_ROOT", writing_log_dir):
            resp = client.post(
                "/api/tutor/writing/compare",
                json={
                    "original_timestamp": "2026-06-17T10:00:00+00:00",
                    "revised_text": (
                        "School uniforms should be banned because they limit student expression "
                        "and creativity. Furthermore, uniforms fail to accommodate diverse body "
                        "types and cultural backgrounds, creating discomfort for many students."
                    ),
                },
                headers=AUTH_HEADER,
            )
            assert resp.status_code == 200
            body = resp.json()
            assert body["original_score"] == 15
            assert body["revised_word_count"] > body["original_word_count"]
            assert body["word_count_change"] > 0
            assert len(body["new_vocabulary"]) > 0
            assert len(body["original_criterion_scores"]) == 2

    def test_compare_counts_only_non_empty_sentence_fragments(self, client, writing_log_dir):
        log_path = writing_log_dir / VALID_STUDENT_ID / "english_writing_log.json"
        history = json.loads(log_path.read_text(encoding="utf-8"))
        history["assessments"][0]["draft_text"] = "First sentence. Second sentence!!   "
        log_path.write_text(json.dumps(history), encoding="utf-8")

        with patch.object(_writing_mod, "_LOG_ROOT", writing_log_dir):
            resp = client.post(
                "/api/tutor/writing/compare",
                json={
                    "original_timestamp": "2026-06-17T10:00:00+00:00",
                    "revised_text": "One? Two... Three!!!   ",
                },
                headers=AUTH_HEADER,
            )

        assert resp.status_code == 200
        assert resp.json()["sentence_count"] == {"original": 2, "revised": 3}

    def test_compare_marks_insufficient_original_as_unscored(self, client, writing_log_dir):
        log_path = writing_log_dir / VALID_STUDENT_ID / "english_writing_log.json"
        log_path.write_text(
            json.dumps({
                "student_id": VALID_STUDENT_ID,
                "assessments": [{
                    "timestamp": "2026-06-17T10:00:00+00:00",
                    "year_level": 7,
                    "prompt_type": "persuasive",
                    "draft_text": "A short draft that did not contain enough developed evidence.",
                    "word_count": 10,
                    "total_score": 0,
                    "max_total_score": 48,
                    "criterion_scores": [],
                    "insufficient_evidence": True,
                }],
            }),
            encoding="utf-8",
        )
        with patch.object(_writing_mod, "_LOG_ROOT", writing_log_dir):
            resp = client.post(
                "/api/tutor/writing/compare",
                json={
                    "original_timestamp": "2026-06-17T10:00:00+00:00",
                    "revised_text": "A longer revised draft with more evidence and explanation.",
                },
                headers=AUTH_HEADER,
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["original_scored"] is False
        assert body["original_insufficient_evidence"] is True
        assert body["original_score"] is None
        assert body["original_max_score"] is None
        assert body["original_criterion_scores"] == []
        assert "does not create a baseline score" in body["feedback"]

    def test_compare_not_found(self, client, writing_log_dir):
        with patch.object(_writing_mod, "_LOG_ROOT", writing_log_dir):
            resp = client.post(
                "/api/tutor/writing/compare",
                json={
                    "original_timestamp": "1999-01-01T00:00:00+00:00",
                    "revised_text": "Some revised text here.",
                },
                headers=AUTH_HEADER,
            )
            assert resp.status_code == 404

    def test_compare_no_history(self, client, tmp_path):
        with patch.object(_writing_mod, "_LOG_ROOT", tmp_path):
            resp = client.post(
                "/api/tutor/writing/compare",
                json={
                    "original_timestamp": "2026-06-17T10:00:00+00:00",
                    "revised_text": "Some text.",
                },
                headers=AUTH_HEADER,
            )
            assert resp.status_code == 404


class TestRevisionOfInRequest:
    """Verify revision_of field is accepted in WritingAssessmentRequest."""

    def test_revision_of_accepted(self):
        from core.schema.writing_schema import WritingAssessmentRequest

        req = WritingAssessmentRequest(
            year_level=7,
            prompt_type="persuasive",
            draft_text="School uniforms should be banned. " * 30,  # meet word count
            revision_of="2026-06-17T10:00:00+00:00",
        )
        assert req.revision_of == "2026-06-17T10:00:00+00:00"

    def test_revision_of_defaults_none(self):
        from core.schema.writing_schema import WritingAssessmentRequest

        req = WritingAssessmentRequest(
            year_level=7,
            prompt_type="persuasive",
            draft_text="School uniforms should be banned. " * 30,
        )
        assert req.revision_of is None
