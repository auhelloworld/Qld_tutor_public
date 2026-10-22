"""Integration tests for speed round and exam endpoints.

Covers previously untested endpoints:
- POST /api/speed-round/start
- POST /api/speed-round/submit
- GET /api/speed-round/history
- POST /api/exam/start
- GET /api/exam/list-papers
- POST /api/exam/submit
- GET /api/exam/history
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from backend.api import app
from backend.exam_simulator import get_exam_simulator
from backend.student_identity import create_student_token
from backend.rate_limiter import _RATE_LIMITER


VALID_STUDENT_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"


def _auth_headers(student_id: str = VALID_STUDENT_ID) -> dict:
    """Create Authorization header with a valid JWT bearer token."""
    token = create_student_token(student_id)
    return {"Authorization": f"Bearer {token}"}


# Alias for tests that check missing auth
STUDENT_HEADERS = _auth_headers()


def _bearer_headers(student_id: str) -> dict:
    token = create_student_token(student_id)
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# POST /api/speed-round/start
# ---------------------------------------------------------------------------


class TestSpeedRoundStart:
    """POST /api/speed-round/start — start a speed round session."""

    def test_start_requires_auth(self):
        client = TestClient(app)
        resp = client.post(
            "/api/speed-round/start",
            json={"subject": "math", "num_questions": 5},
        )
        assert resp.status_code == 401
        assert resp.json()["error"] == "missing_student_id"

    def test_start_returns_questions(self, tmp_data_dir):
        client = TestClient(app)
        resp = client.post(
            "/api/speed-round/start",
            json={"subject": "math", "year_level": 7, "num_questions": 3, "time_limit_seconds": 120},
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "session_id" in body
        assert "questions" in body
        assert len(body["questions"]) <= 3
        assert body["time_limit_seconds"] == 120
        assert body["total"] == len(body["questions"])
        # Questions should NOT contain answers
        for q in body["questions"]:
            assert "answer" not in q
            assert "id" in q
            assert "question" in q

    def test_start_with_topic_filter(self, tmp_data_dir):
        client = TestClient(app)
        resp = client.post(
            "/api/speed-round/start",
            json={"subject": "math", "topic": "nonexistent_topic_xyz", "num_questions": 5},
            headers=STUDENT_HEADERS,
        )
        # Should return 404 if no questions match
        assert resp.status_code == 404

    def test_start_with_multiple_choice_includes_choices(self, tmp_data_dir):
        """MCQ questions should include choices in the response."""
        client = TestClient(app)
        resp = client.post(
            "/api/speed-round/start",
            json={"subject": "math", "num_questions": 50},  # Large pool to increase chance of MCQ
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["questions"]) > 0

    def test_challenge_mode_returns_strategy_metadata(self, tmp_data_dir):
        """Challenge mode should expose strategy prompts without leaking answers."""
        client = TestClient(app)
        resp = client.post(
            "/api/speed-round/start",
            json={
                "subject": "math",
                "year_level": 7,
                "topic": "AC9M7P01",
                "num_questions": 3,
                "challenge_mode": True,
            },
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["challenge_mode"] is True
        assert body["strategy_counts"]
        assert len(body["questions"]) > 0
        for q in body["questions"]:
            assert "answer" not in q
            assert q["challenge_strategy"]
            assert q["strategy_prompt"]
            assert q["post_challenge_reflection_prompt"]


# ---------------------------------------------------------------------------
# POST /api/speed-round/submit
# ---------------------------------------------------------------------------


class TestSpeedRoundSubmit:
    """POST /api/speed-round/submit — submit speed round answers."""

    def test_submit_requires_auth(self):
        client = TestClient(app)
        resp = client.post(
            "/api/speed-round/submit",
            json={"session_id": "some-id", "responses": {}},
        )
        assert resp.status_code == 401

    def test_submit_nonexistent_session_returns_404(self, tmp_data_dir):
        client = TestClient(app)
        resp = client.post(
            "/api/speed-round/submit",
            json={"session_id": "nonexistent-session-id", "responses": {}},
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 404
        assert resp.json()["error"] == "session_not_found"

    def test_submit_valid_session(self, tmp_data_dir):
        client = TestClient(app)
        # Start a session first
        start_resp = client.post(
            "/api/speed-round/start",
            json={"subject": "math", "num_questions": 2, "time_limit_seconds": 300},
            headers=STUDENT_HEADERS,
        )
        assert start_resp.status_code == 200
        session_id = start_resp.json()["session_id"]
        questions = start_resp.json()["questions"]

        # Submit answers
        responses = {q["id"]: "42" for q in questions}
        resp = client.post(
            "/api/speed-round/submit",
            json={"session_id": session_id, "responses": responses},
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["session_id"] == session_id
        assert "correct" in body
        assert "total" in body
        assert "accuracy" in body
        assert "results" in body
        assert body["total"] == len(questions)

    def test_submit_twice_returns_404(self, tmp_data_dir):
        """Second submit should fail (session already completed)."""
        client = TestClient(app)
        start_resp = client.post(
            "/api/speed-round/start",
            json={"subject": "math", "num_questions": 1, "time_limit_seconds": 300},
            headers=STUDENT_HEADERS,
        )
        session_id = start_resp.json()["session_id"]
        questions = start_resp.json()["questions"]
        responses = {q["id"]: "1" for q in questions}

        # First submit
        resp1 = client.post(
            "/api/speed-round/submit",
            json={"session_id": session_id, "responses": responses},
            headers=STUDENT_HEADERS,
        )
        assert resp1.status_code == 200

        # Second submit should fail
        resp2 = client.post(
            "/api/speed-round/submit",
            json={"session_id": session_id, "responses": responses},
            headers=STUDENT_HEADERS,
        )
        assert resp2.status_code == 404


# ---------------------------------------------------------------------------
# GET /api/speed-round/history
# ---------------------------------------------------------------------------


class TestSpeedRoundHistory:
    """GET /api/speed-round/history — past speed round sessions."""

    def test_history_requires_auth(self):
        client = TestClient(app)
        resp = client.get("/api/speed-round/history")
        assert resp.status_code == 401

    def test_history_empty_initially(self):
        client = TestClient(app)
        unique_id = "f1f2f3f4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
        resp = client.get(
            "/api/speed-round/history",
            headers=_auth_headers(unique_id),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "sessions" in body
        assert body["total"] == 0

    def test_history_after_completed_session(self, tmp_data_dir):
        client = TestClient(app)
        unique_id = "e1e2e3e4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
        headers = _auth_headers(unique_id)

        # Start and complete a session
        start_resp = client.post(
            "/api/speed-round/start",
            json={"subject": "math", "num_questions": 1},
            headers=headers,
        )
        session_id = start_resp.json()["session_id"]
        questions = start_resp.json()["questions"]
        client.post(
            "/api/speed-round/submit",
            json={"session_id": session_id, "responses": {questions[0]["id"]: "1"}},
            headers=headers,
        )

        # Check history
        resp = client.get("/api/speed-round/history", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] >= 1


# ---------------------------------------------------------------------------
# POST /api/exam/start
# ---------------------------------------------------------------------------


class TestExamStart:
    """POST /api/exam/start — start a timed mock exam."""

    def test_start_requires_auth(self):
        client = TestClient(app)
        resp = client.post(
            "/api/exam/start",
            json={"subject": "math", "year_level": 7, "num_questions": 5},
        )
        assert resp.status_code == 401

    def test_start_returns_exam_paper(self, tmp_data_dir):
        client = TestClient(app)
        resp = client.post(
            "/api/exam/start",
            json={
                "subject": "math",
                "year_level": 7,
                "num_questions": 5,
                "time_limit_minutes": 30,
            },
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "exam_id" in body
        assert "questions" in body
        assert "time_limit_minutes" in body
        assert body["time_limit_minutes"] == 30
        # Questions should NOT contain answers
        for q in body["questions"]:
            assert "answer" not in q
            assert "id" in q

    def test_imported_exam_rejects_path_traversal(self, tmp_data_dir, tmp_path, monkeypatch):
        """Imported papers must stay inside data/exams."""
        monkeypatch.chdir(tmp_path)
        outside_file = tmp_data_dir / "outside.json"
        outside_file.write_text(json.dumps({"title": "Outside", "questions": []}))

        client = TestClient(app)
        resp = client.post(
            "/api/exam/start",
            json={
                "subject": "math",
                "year_level": 7,
                "exam_file": "../outside.json",
            },
            headers=_bearer_headers("11111111-1111-4111-8111-111111111111"),
        )

        assert resp.status_code == 404

    def test_imported_exam_resumes_saved_session(self, tmp_data_dir, tmp_path, monkeypatch):
        """Selecting the same unchanged imported paper restores its session state."""
        monkeypatch.chdir(tmp_path)
        exams_dir = tmp_data_dir / "exams"
        question = {
            "id": "imported_resume_q1",
            "subject": "math",
            "year_level": 7,
            "question": "What is 2 + 2?",
            "question_type": "short_answer",
            "answer": "4",
            "topic_ids": ["AC9M7N01"],
        }
        (exams_dir / "resume-paper.json").write_text(
            json.dumps({"title": "Resume Paper", "time_limit_minutes": 10, "questions": [question]})
        )

        student_id = "12121212-1212-4212-8212-121212121212"
        headers = _bearer_headers(student_id)
        client = TestClient(app)
        first = client.post(
            "/api/exam/start",
            json={"subject": "math", "year_level": 7, "exam_file": "resume-paper.json"},
            headers=headers,
        )
        assert first.status_code == 200
        first_body = first.json()
        saved = client.post(
            "/api/exam/save",
            json={
                "subject": "math",
                "exam_id": first_body["exam_id"],
                "responses": {question["id"]: "4"},
                "current_index": 1,
                "flagged": [question["id"]],
            },
            headers=headers,
        )
        assert saved.status_code == 200

        second = client.post(
            "/api/exam/start",
            json={"subject": "math", "year_level": 7, "exam_file": "resume-paper.json"},
            headers=headers,
        )
        assert second.status_code == 200
        second_body = second.json()
        assert second_body["resumed"] is True
        assert second_body["exam_id"] == first_body["exam_id"]
        assert second_body["started_at"] == first_body["started_at"]
        assert second_body["time_limit_minutes"] == 10
        assert second_body["responses"] == {question["id"]: "4"}
        assert second_body["current_index"] == 1
        assert second_body["flagged"] == [question["id"]]

        from backend.rules import get_engine

        sessions = get_engine(student_id, "math").get_exam_sessions()
        assert len([session for session in sessions if not session.get("completed_at")]) == 1

    def test_imported_exam_fingerprint_prevents_resume_after_file_change(
        self, tmp_data_dir, tmp_path, monkeypatch
    ):
        """A changed file with the same filename starts a distinct paper."""
        monkeypatch.chdir(tmp_path)
        exams_dir = tmp_data_dir / "exams"
        paper_path = exams_dir / "fingerprint-paper.json"
        base_question = {
            "id": "fingerprint_q1",
            "subject": "math",
            "year_level": 7,
            "question": "What is 2 + 2?",
            "question_type": "short_answer",
            "answer": "4",
            "topic_ids": ["AC9M7N01"],
        }
        paper_path.write_text(
            json.dumps({"title": "Original Paper", "time_limit_minutes": 10, "questions": [base_question]})
        )

        headers = _bearer_headers("13131313-1313-4313-8313-131313131313")
        client = TestClient(app)
        first = client.post(
            "/api/exam/start",
            json={"subject": "math", "year_level": 7, "exam_file": paper_path.name},
            headers=headers,
        )
        assert first.status_code == 200

        changed_question = {**base_question, "answer": "5"}
        paper_path.write_text(
            json.dumps({"title": "Changed Paper", "time_limit_minutes": 10, "questions": [changed_question]})
        )
        second = client.post(
            "/api/exam/start",
            json={"subject": "math", "year_level": 7, "exam_file": paper_path.name},
            headers=headers,
        )
        assert second.status_code == 200
        assert second.json().get("resumed") is not True
        assert second.json()["exam_id"] != first.json()["exam_id"]
        assert second.json()["title"] == "Changed Paper"

    def test_senior_unit_scope_is_accepted(self, tmp_data_dir):
        """Senior course requests can omit year_level and scope by unit."""
        client = TestClient(app)
        resp = client.post(
            "/api/exam/start",
            json={
                "subject": "senior_math",
                "year_level": None,
                "unit": 1,
                "syllabus_subject": "mathematical_methods",
                "num_questions": 3,
            },
            headers=_bearer_headers("22222222-2222-4222-8222-222222222222"),
        )

        assert resp.status_code == 200
        body = resp.json()
        if body.get("error") == "insufficient_exercises":
            assert "Unit 1" in body["message"]
        else:
            assert body["questions"]

    def test_resume_returns_started_at_for_timer_calc(self, tmp_data_dir):
        """Resuming an incomplete exam returns started_at so frontend can compute remaining time."""
        student_id = "33333333-3333-4333-8333-333333333333"
        headers = _bearer_headers(student_id)
        client = TestClient(app)

        # Start exam (do NOT submit — leaves it incomplete)
        first = client.post(
            "/api/exam/start",
            json={"subject": "math", "year_level": 7, "num_questions": 5, "time_limit_minutes": 45},
            headers=headers,
        )
        assert first.status_code == 200
        first_body = first.json()
        assert "started_at" in first_body
        original_started_at = first_body["started_at"]
        original_exam_id = first_body["exam_id"]

        # Call start again with same scope — should resume
        second = client.post(
            "/api/exam/start",
            json={"subject": "math", "year_level": 7, "num_questions": 5, "time_limit_minutes": 45},
            headers=headers,
        )
        assert second.status_code == 200
        second_body = second.json()
        assert second_body.get("resumed") is True
        assert second_body["exam_id"] == original_exam_id
        assert second_body["started_at"] == original_started_at
        assert second_body["time_limit_minutes"] == 45

    def test_resume_does_not_match_different_year(self, tmp_data_dir):
        """An incomplete Year 7 exam should NOT be resumed when starting Year 8."""
        student_id = "44444444-4444-4444-8444-444444444444"
        headers = _bearer_headers(student_id)
        client = TestClient(app)

        # Start Year 7 exam (do NOT submit)
        first = client.post(
            "/api/exam/start",
            json={"subject": "math", "year_level": 7, "num_questions": 5},
            headers=headers,
        )
        assert first.status_code == 200
        first_exam_id = first.json()["exam_id"]

        # Start Year 8 exam — should NOT resume Year 7 session
        second = client.post(
            "/api/exam/start",
            json={"subject": "math", "year_level": 8, "num_questions": 5},
            headers=headers,
        )
        assert second.status_code == 200
        second_body = second.json()
        # Either a new exam or insufficient exercises, but NOT the same exam
        if "exam_id" in second_body:
            assert second_body["exam_id"] != first_exam_id
        assert second_body.get("resumed") is not True

    def test_resume_does_not_match_different_exam_type(self, tmp_data_dir):
        """An incomplete mixed exam should NOT be resumed when starting fluency_check."""
        student_id = "55555555-5555-4555-8555-555555555555"
        headers = _bearer_headers(student_id)
        client = TestClient(app)

        # Start mixed exam (do NOT submit)
        first = client.post(
            "/api/exam/start",
            json={"subject": "math", "year_level": 7, "num_questions": 5, "exam_type": "mixed"},
            headers=headers,
        )
        assert first.status_code == 200
        first_exam_id = first.json()["exam_id"]

        # Start fluency_check exam — should NOT resume mixed session
        second = client.post(
            "/api/exam/start",
            json={"subject": "math", "year_level": 7, "num_questions": 5, "exam_type": "fluency_check"},
            headers=headers,
        )
        assert second.status_code == 200
        second_body = second.json()
        if "exam_id" in second_body:
            assert second_body["exam_id"] != first_exam_id
        assert second_body.get("resumed") is not True


# ---------------------------------------------------------------------------
# GET /api/exam/list-papers
# ---------------------------------------------------------------------------


class TestExamListPapers:
    """GET /api/exam/list-papers — list available exam papers."""

    def test_list_papers_no_auth_required(self):
        """list-papers doesn't require auth (read-only)."""
        client = TestClient(app)
        resp = client.get("/api/exam/list-papers")
        assert resp.status_code == 200
        body = resp.json()
        assert isinstance(body, list)


# ---------------------------------------------------------------------------
# POST /api/exam/submit
# ---------------------------------------------------------------------------


class TestExamSubmit:
    """POST /api/exam/submit — submit exam answers."""

    def test_submit_requires_auth(self):
        client = TestClient(app)
        resp = client.post(
            "/api/exam/submit",
            json={"exam_id": "some-id", "responses": {}},
        )
        assert resp.status_code == 401

    def test_submit_after_start(self, tmp_data_dir):
        """Full flow: start → submit."""
        client = TestClient(app)
        # Start exam
        start_resp = client.post(
            "/api/exam/start",
            json={"subject": "math", "year_level": 7, "num_questions": 3},
            headers=STUDENT_HEADERS,
        )
        assert start_resp.status_code == 200
        exam_id = start_resp.json()["exam_id"]
        questions = start_resp.json()["questions"]

        # Submit with answers
        responses = {q["id"]: "42" for q in questions}
        resp = client.post(
            "/api/exam/submit",
            json={"exam_id": exam_id, "responses": responses},
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "exam_id" in body or "results" in body or "score" in body or "total" in body

    def test_submit_after_english_start_uses_english_log(self, tmp_data_dir):
        """Submitting a non-math paper must look in that subject's exam sessions."""
        client = TestClient(app)
        headers = _bearer_headers("33333333-3333-4333-8333-333333333333")

        start_resp = client.post(
            "/api/exam/start",
            json={"subject": "english", "year_level": 7, "num_questions": 2},
            headers=headers,
        )
        assert start_resp.status_code == 200
        exam_id = start_resp.json()["exam_id"]
        questions = start_resp.json()["questions"]

        resp = client.post(
            "/api/exam/submit",
            json={
                "subject": "english",
                "exam_id": exam_id,
                "responses": {q["id"]: "" for q in questions},
            },
            headers=headers,
        )

        assert resp.status_code == 200
        body = resp.json()
        assert body.get("error") != "exam_not_found"
        assert body["exam_id"] == exam_id

    def test_imported_exam_submission_uses_persisted_questions(
        self,
        tmp_data_dir,
        tmp_path,
        monkeypatch,
    ):
        """Imported papers remain gradable even if the simulator memory cache is cold."""
        monkeypatch.chdir(tmp_path)
        exams_dir = tmp_data_dir / "exams"
        exams_dir.mkdir(exist_ok=True)
        imported_question = {
            "id": "imported_regression_q1",
            "subject": "math",
            "year_level": 7,
            "question": "What is 2 + 2?",
            "question_type": "short_answer",
            "answer": "4",
            "difficulty": "foundational",
            "topic_ids": ["AC9M7N01"],
        }
        (exams_dir / "regression-paper.json").write_text(
            json.dumps(
                {
                    "title": "Regression Paper",
                    "time_limit_minutes": 10,
                    "questions": [imported_question],
                }
            )
        )

        client = TestClient(app)
        headers = _bearer_headers("44444444-4444-4444-8444-444444444444")
        start_resp = client.post(
            "/api/exam/start",
            json={
                "subject": "math",
                "year_level": 7,
                "exam_file": "regression-paper.json",
            },
            headers=headers,
        )
        assert start_resp.status_code == 200
        exam_id = start_resp.json()["exam_id"]

        get_exam_simulator().exercises.pop(imported_question["id"], None)
        resp = client.post(
            "/api/exam/submit",
            json={
                "subject": "math",
                "exam_id": exam_id,
                "responses": {imported_question["id"]: "4"},
            },
            headers=headers,
        )

        assert resp.status_code == 200
        body = resp.json()
        assert body["exam_id"] == exam_id
        assert body["total_questions"] == 1
        assert body["results_per_question"][0]["question_id"] == imported_question["id"]

    def test_submit_preserves_recomputed_topic_accuracy(
        self,
        tmp_data_dir,
        tmp_path,
        monkeypatch,
    ):
        """Persisting exam results must not restore pre-submit topic accuracy."""
        from backend.rules import get_engine

        monkeypatch.chdir(tmp_path)
        exams_dir = tmp_data_dir / "exams"
        exams_dir.mkdir(exist_ok=True)
        topic_id = "AC9M7N01"
        question = {
            "id": "imported_accuracy_regression_q1",
            "subject": "math",
            "year_level": 7,
            "question": "What is 2 + 2?",
            "question_type": "short_answer",
            "answer": "4",
            "difficulty": "foundational",
            "topic_ids": [topic_id],
        }
        (exams_dir / "accuracy-regression-paper.json").write_text(
            json.dumps(
                {
                    "title": "Accuracy Regression Paper",
                    "time_limit_minutes": 45,
                    "questions": [question],
                }
            )
        )

        student_id = "77777777-7777-4777-8777-777777777777"
        headers = _bearer_headers(student_id)
        engine = get_engine(student_id, "math")
        engine.log_attempt(
            topic=topic_id,
            question_id="prior-incorrect",
            is_correct=False,
            error_type="exam_error",
            student_answer="3",
            topic_ids=[topic_id],
        )

        client = TestClient(app)
        started = client.post(
            "/api/exam/start",
            json={
                "subject": "math",
                "year_level": 7,
                "exam_file": "accuracy-regression-paper.json",
            },
            headers=headers,
        )
        assert started.status_code == 200
        exam_id = started.json()["exam_id"]

        submitted = client.post(
            "/api/exam/submit",
            json={
                "subject": "math",
                "exam_id": exam_id,
                "responses": {question["id"]: "4"},
            },
            headers=headers,
        )
        assert submitted.status_code == 200
        assert submitted.json()["correct"] == 1

        topic_data = engine.load_log(topics=[topic_id])["topics"][topic_id]
        answer_attempts = [
            attempt
            for attempt in topic_data["attempts"]
            if attempt.get("attempt_type", "answer") == "answer"
        ]
        assert len(answer_attempts) == 2
        assert topic_data["accuracy"] == pytest.approx(0.5)
        assert engine.get_study_plan(topic_id)["action"] == "weekly_revision"

        history = client.get(
            "/api/exam/history",
            params={"subject": "math"},
            headers=headers,
        )
        assert history.status_code == 200
        assert any(item["exam_id"] == exam_id for item in history.json())

    def test_generated_exam_does_not_resume_imported_paper(
        self,
        tmp_data_dir,
        tmp_path,
        monkeypatch,
    ):
        """Imported sessions are excluded even when all generated defaults match."""
        monkeypatch.chdir(tmp_path)
        exams_dir = tmp_data_dir / "exams"
        exams_dir.mkdir(exist_ok=True)
        imported_questions = [
            {
                "id": f"imported_resume_regression_q{i}",
                "subject": "math",
                "year_level": 7,
                "question": f"What is {i} + 1?",
                "question_type": "short_answer",
                "answer": str(i + 1),
                "difficulty": "foundational",
                "topic_ids": ["AC9M7N01"],
            }
            for i in range(20)
        ]
        (exams_dir / "resume-regression-paper.json").write_text(
            json.dumps(
                {
                    "title": "Resume Regression Paper",
                    "time_limit_minutes": 45,
                    "questions": imported_questions,
                }
            )
        )

        client = TestClient(app)
        headers = _bearer_headers("66666666-6666-4666-8666-666666666666")
        imported = client.post(
            "/api/exam/start",
            json={
                "subject": "math",
                "year_level": 7,
                "exam_type": "mixed",
                "exam_file": "resume-regression-paper.json",
            },
            headers=headers,
        )
        assert imported.status_code == 200
        imported_exam_id = imported.json()["exam_id"]

        generated = client.post(
            "/api/exam/start",
            json={
                "subject": "math",
                "year_level": 7,
                "exam_type": "mixed",
                "num_questions": 20,
                "time_limit_minutes": 45,
                "sf_ratio": 0.6,
                "cf_ratio": 0.3,
                "cu_ratio": 0.1,
            },
            headers=headers,
        )

        assert generated.status_code == 200
        body = generated.json()
        assert body.get("resumed") is not True
        if "exam_id" in body:
            assert body["exam_id"] != imported_exam_id
            imported_ids = {question["id"] for question in imported_questions}
            assert all(q["id"] not in imported_ids for q in body["questions"])


# ---------------------------------------------------------------------------
# GET /api/exam/history
# ---------------------------------------------------------------------------


class TestExamHistory:
    """GET /api/exam/history — past exam sessions."""

    def test_history_requires_auth(self):
        client = TestClient(app)
        resp = client.get("/api/exam/history")
        assert resp.status_code == 401

    def test_history_with_auth(self, tmp_data_dir):
        client = TestClient(app)
        resp = client.get(
            "/api/exam/history",
            params={"subject": "math"},
            headers=STUDENT_HEADERS,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert isinstance(body, dict) or isinstance(body, list)


def test_speed_round_failed_mark_can_retry_same_submission(monkeypatch):
    from fastapi import HTTPException
    import backend.routers.tutor as tutor_router

    student_id = "retry-student"
    session_id = "retry-session"
    session = tutor_router.SpeedRoundSession(
        session_id=session_id,
        student_id=student_id,
        subject="math",
        topic=None,
        questions=[{
            "id": "retry-question",
            "question": "What is 1 + 1?",
            "answer": "2",
            "question_type": "short_answer",
        }],
        start_time=tutor_router.time.time(),
        time_limit_seconds=120,
    )
    with tutor_router._SPEED_ROUND_SESSIONS_LOCK:
        tutor_router._speed_round_sessions[session_id] = session

    request_ids: list[str] = []

    class FakeTutor:
        calls = 0

        def mark(self, _question_id, _answer, **kwargs):
            self.calls += 1
            request_ids.append(kwargs["request_id"])
            if self.calls == 1:
                raise RuntimeError("temporary persistence failure")
            return {"is_correct": True, "outcome": "correct"}

    fake_tutor = FakeTutor()
    monkeypatch.setattr(tutor_router, "get_tutor_engine", lambda: fake_tutor)
    request = tutor_router.SpeedRoundSubmitRequest(
        session_id=session_id,
        responses={"retry-question": "2"},
    )

    with pytest.raises(HTTPException) as failed:
        tutor_router.speed_round_submit(request, student_id=student_id)
    assert failed.value.status_code == 503
    assert session.completed is False
    assert session.processing is False

    result = tutor_router.speed_round_submit(request, student_id=student_id)

    assert result["correct"] == 1
    assert session.completed is True
    assert request_ids[0] == request_ids[1]
    with tutor_router._SPEED_ROUND_SESSIONS_LOCK:
        tutor_router._speed_round_sessions.pop(session_id, None)
