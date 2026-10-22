from __future__ import annotations

from datetime import datetime, timezone

import pytest

from backend.api import app
from backend.exam_simulator import ExamSimulator
from backend.rules import get_engine
from backend.services.attempt_outcomes import AttemptOutcome
from backend.student_identity import create_student_token
from fastapi.testclient import TestClient


STUDENT_ID = "exam-review-student"
TOPIC = "AC9M7N01"


def _session(*, exam_id: str, question_id: str, topic_ids: list[str]) -> dict:
    return {
        "exam_id": exam_id,
        "student_id": STUDENT_ID,
        "subject": "math",
        "year_level": 7,
        "unit": None,
        "syllabus_subject": None,
        "started_at": "2026-01-01T09:00:00+00:00",
        "deadline_at": "2030-01-01T10:00:00+00:00",
        "time_limit_minutes": 45,
        "completed_at": None,
        "paper": [question_id],
        "responses": {question_id: "an explanation"},
        "current_index": 0,
        "flagged": [],
        "results": None,
        "exam_type": "mixed",
        "_topic_ids": topic_ids,
    }


def _seed_sessions(sessions: list[dict]) -> None:
    engine = get_engine(STUDENT_ID, "math")
    log = engine._read_log(topics=[])
    for session in sessions:
        # The private marker is only a test convenience; the simulator resolves
        # topic_ids from its exercise fixture when it logs the attempt.
        session.pop("_topic_ids", None)
    log["exam_sessions"] = sessions
    engine._write_log(log)


def _pending_result(exam_id: str, question_id: str, topic_ids: list[str]) -> dict:
    return {
        "exam_id": exam_id,
        "total_questions": 1,
        "correct": 0,
        "percentage": 0,
        "total_score": 0,
        "total_max_score": 1,
        "pending_count": 1,
        "scored_questions": 0,
        "provisional": True,
        "strand_breakdown": [],
        "weak_topics": [],
        "results_per_question": [
            {
                "question_id": question_id,
                "question": "Explain the answer.",
                "correct_answer": "A valid explanation",
                "student_answer": "an explanation",
                "is_correct": False,
                "topic_ids": topic_ids,
                "difficulty": "developing",
                "score": 0,
                "max_score": 1,
                "requires_review": True,
            }
        ],
        "started_at": "2026-01-01T09:00:00+00:00",
        "deadline_at": "2030-01-01T10:00:00+00:00",
        "completed_at": "2026-01-01T09:01:00+00:00",
        "time_limit_minutes": 45,
    }


def _legacy_completed_session(
    *,
    exam_id: str,
    question_id: str,
    completed_at: str,
    student_answer: str = "an explanation",
    subject: str = "math",
    student_id: str = STUDENT_ID,
) -> dict:
    session = _session(exam_id=exam_id, question_id=question_id, topic_ids=[TOPIC])
    session["student_id"] = student_id
    session["subject"] = subject
    session["responses"] = {question_id: student_answer}
    session["completed_at"] = completed_at
    session["results"] = _pending_result(exam_id, question_id, [TOPIC])
    session["results"]["completed_at"] = completed_at
    session["results"]["results_per_question"][0]["student_answer"] = student_answer
    return session


def _submit_pending(sim: ExamSimulator, exam_id: str, question_id: str) -> dict:
    return sim.submit(
        student_id=STUDENT_ID,
        subject="math",
        exam_id=exam_id,
        responses={question_id: "an explanation"},
    )


@pytest.mark.parametrize("decision", [True, False])
def test_parent_review_reconciles_whole_exam_result_and_is_idempotent(
    monkeypatch: pytest.MonkeyPatch,
    decision: bool,
) -> None:
    question_id = "exam-review-whole"
    exercise = {
        "id": question_id,
        "subject": "math",
        "year_level": 7,
        "question": "Explain the answer.",
        "question_type": "reasoning",
        "topic_ids": [TOPIC],
    }
    sim = ExamSimulator({question_id: exercise})
    _seed_sessions([_session(exam_id="exam-whole", question_id=question_id, topic_ids=[TOPIC])])
    monkeypatch.setattr(
        sim,
        "_grade_paper",
        lambda session: _pending_result(session["exam_id"], question_id, [TOPIC]),
    )

    submitted = _submit_pending(sim, "exam-whole", question_id)
    attempt_id = submitted["results_per_question"][0]["attempt_id"]
    engine = get_engine(STUDENT_ID, "math")
    pending = engine.get_pending_reviews()
    assert pending[0]["exam_id"] == "exam-whole"
    assert pending[0]["attempt_id"] == attempt_id

    assert engine.review_attempt(
        topic=TOPIC,
        question_id=question_id,
        student_answer="an explanation",
        correct=decision,
        attempt_id=attempt_id,
        exam_id="exam-whole",
    ) is True
    assert sim.reconcile_parent_review(
        student_id=STUDENT_ID,
        subject="math",
        exam_id="exam-whole",
        question_id=question_id,
        attempt_id=attempt_id,
        correct=decision,
    ) is True

    session = get_engine(STUDENT_ID, "math").get_exam_sessions()[0]
    result = session["results"]
    assert result["provisional"] is False
    assert result["pending_count"] == 0
    assert result["correct"] == int(decision)
    assert result["percentage"] == (100.0 if decision else 0.0)
    assert result["results_per_question"][0].get("requires_review") is not True
    assert engine.get_pending_reviews() == []

    # A repeated request cannot change the attempt or aggregate a second mark.
    assert engine.review_attempt(
        topic=TOPIC,
        question_id=question_id,
        student_answer="an explanation",
        correct=not decision,
        attempt_id=attempt_id,
        exam_id="exam-whole",
    ) is False
    assert sim.reconcile_parent_review(
        student_id=STUDENT_ID,
        subject="math",
        exam_id="exam-whole",
        question_id=question_id,
        attempt_id=attempt_id,
        correct=not decision,
    ) is False
    unchanged = get_engine(STUDENT_ID, "math").get_exam_sessions()[0]["results"]
    assert unchanged["correct"] == int(decision)
    assert unchanged["percentage"] == (100.0 if decision else 0.0)


def test_review_uses_attempt_and_exam_identity_when_question_repeats() -> None:
    question_id = "exam-review-repeated-question"
    exercise = {
        "id": question_id,
        "subject": "math",
        "year_level": 7,
        "question": "Explain the answer.",
        "question_type": "reasoning",
        "topic_ids": [TOPIC],
    }
    sim = ExamSimulator({question_id: exercise})
    _seed_sessions([
        _session(exam_id="exam-a", question_id=question_id, topic_ids=[TOPIC]),
        _session(exam_id="exam-b", question_id=question_id, topic_ids=[TOPIC]),
    ])
    # Both submissions use the same fake grader, but each gets a separate
    # physical attempt_id and result entry.
    sim._grade_paper = lambda session: _pending_result(session["exam_id"], question_id, [TOPIC])
    first = _submit_pending(sim, "exam-a", question_id)
    second = _submit_pending(sim, "exam-b", question_id)
    first_attempt_id = first["results_per_question"][0]["attempt_id"]
    second_attempt_id = second["results_per_question"][0]["attempt_id"]
    assert first_attempt_id != second_attempt_id

    engine = get_engine(STUDENT_ID, "math")
    # A mismatched exam_id cannot resolve an attempt merely because its question
    # ID is shared by another session.
    assert engine.review_attempt(
        topic=TOPIC,
        question_id=question_id,
        student_answer="an explanation",
        correct=True,
        attempt_id=first_attempt_id,
        exam_id="exam-b",
    ) is False
    assert len(engine.get_pending_reviews()) == 2

    assert engine.review_attempt(
        topic=TOPIC,
        question_id=question_id,
        student_answer="an explanation",
        correct=True,
        attempt_id=first_attempt_id,
        exam_id="exam-a",
    ) is True
    assert sim.reconcile_parent_review(
        student_id=STUDENT_ID,
        subject="math",
        exam_id="exam-a",
        question_id=question_id,
        attempt_id=first_attempt_id,
        correct=True,
    ) is True

    sessions = {
        session["exam_id"]: session
        for session in get_engine(STUDENT_ID, "math").get_exam_sessions()
    }
    assert sessions["exam-a"]["results"]["provisional"] is False
    assert sessions["exam-a"]["results"]["correct"] == 1
    assert sessions["exam-b"]["results"]["provisional"] is True
    assert sessions["exam-b"]["results"]["pending_count"] == 1
    assert any(item["attempt_id"] == second_attempt_id for item in engine.get_pending_reviews())


def test_multi_part_parent_reviews_reconcile_each_part_before_finalising_exam() -> None:
    question_id = "exam-review-multipart"
    topic_ids = [TOPIC, "AC9M7A01"]
    exercise = {
        "id": question_id,
        "subject": "math",
        "year_level": 7,
        "question": "Solve both parts.",
        "question_type": "multi_part",
        "topic_ids": topic_ids,
        "sub_parts": [
            {"label": "a", "question": "Part A", "answer": "A", "marks": 1},
            {"label": "b", "question": "Part B", "answer": "B", "marks": 2},
        ],
    }
    sim = ExamSimulator({question_id: exercise})
    _seed_sessions([_session(exam_id="exam-parts", question_id=question_id, topic_ids=topic_ids)])

    def grade_parts(session: dict) -> dict:
        result = _pending_result(session["exam_id"], question_id, topic_ids)
        result["total_max_score"] = 3
        result["results_per_question"][0].update({
            "score": 0,
            "max_score": 3,
            "part_results": [
                {
                    "label": "a",
                    "student_answer": "first",
                    "outcome": AttemptOutcome.PENDING.value,
                    "error_type": "parent_review_pending",
                    "score": 0,
                    "max_score": 1,
                },
                {
                    "label": "b",
                    "student_answer": "second",
                    "outcome": AttemptOutcome.PENDING.value,
                    "error_type": "parent_review_pending",
                    "score": 0,
                    "max_score": 2,
                },
            ],
        })
        return result

    sim._grade_paper = grade_parts
    submitted = _submit_pending(sim, "exam-parts", question_id)
    attempt_id = submitted["results_per_question"][0]["attempt_id"]
    engine = get_engine(STUDENT_ID, "math")
    assert {item["part_label"] for item in engine.get_pending_reviews()} == {"a", "b"}

    assert engine.review_attempt(
        topic=TOPIC,
        question_id=question_id,
        student_answer="first",
        correct=True,
        attempt_id=attempt_id,
        part_label="a",
        exam_id="exam-parts",
    ) is True
    assert sim.reconcile_parent_review(
        student_id=STUDENT_ID,
        subject="math",
        exam_id="exam-parts",
        question_id=question_id,
        attempt_id=attempt_id,
        correct=True,
        part_label="a",
    ) is True
    interim = get_engine(STUDENT_ID, "math").get_exam_sessions()[0]["results"]
    assert interim["provisional"] is True
    assert interim["pending_count"] == 1
    assert {item["part_label"] for item in engine.get_pending_reviews()} == {"b"}

    assert engine.review_attempt(
        topic=TOPIC,
        question_id=question_id,
        student_answer="second",
        correct=False,
        attempt_id=attempt_id,
        part_label="b",
        exam_id="exam-parts",
    ) is True
    assert sim.reconcile_parent_review(
        student_id=STUDENT_ID,
        subject="math",
        exam_id="exam-parts",
        question_id=question_id,
        attempt_id=attempt_id,
        correct=False,
        part_label="b",
    ) is True

    final = get_engine(STUDENT_ID, "math").get_exam_sessions()[0]["results"]
    entry = final["results_per_question"][0]
    assert final["provisional"] is False
    assert final["pending_count"] == 0
    assert final["correct"] == 0
    assert final["total_score"] == 1
    assert final["total_max_score"] == 3
    assert final["percentage"] == pytest.approx(33.3)
    assert "requires_review" not in entry
    assert entry["part_results"][0]["is_correct"] is True
    assert entry["part_results"][1]["is_correct"] is False
    assert engine.get_pending_reviews() == []


def test_exam_fanout_review_updates_all_topic_copies_once() -> None:
    question_id = "exam-review-fanout"
    topic_ids = [TOPIC, "AC9M7A01"]
    exercise = {
        "id": question_id,
        "subject": "math",
        "year_level": 7,
        "question": "Explain the answer.",
        "question_type": "reasoning",
        "topic_ids": topic_ids,
    }
    sim = ExamSimulator({question_id: exercise})
    _seed_sessions([_session(exam_id="exam-fanout", question_id=question_id, topic_ids=topic_ids)])
    sim._grade_paper = lambda session: _pending_result(session["exam_id"], question_id, topic_ids)

    submitted = _submit_pending(sim, "exam-fanout", question_id)
    attempt_id = submitted["results_per_question"][0]["attempt_id"]
    engine = get_engine(STUDENT_ID, "math")
    log = engine.load_log(topics=topic_ids)
    assert [len(log["topics"][topic]["attempts"]) for topic in topic_ids] == [1, 1]

    assert engine.review_attempt(
        topic=TOPIC,
        question_id=question_id,
        student_answer="an explanation",
        correct=True,
        attempt_id=attempt_id,
        exam_id="exam-fanout",
    ) is True
    assert sim.reconcile_parent_review(
        student_id=STUDENT_ID,
        subject="math",
        exam_id="exam-fanout",
        question_id=question_id,
        attempt_id=attempt_id,
        correct=True,
    ) is True

    log = engine.load_log(topics=topic_ids)
    assert [len(log["topics"][topic]["attempts"]) for topic in topic_ids] == [1, 1]
    assert all(log["topics"][topic]["attempts"][0]["outcome"] == AttemptOutcome.CORRECT.value for topic in topic_ids)
    assert get_engine(STUDENT_ID, "math").get_exam_sessions()[0]["results"]["provisional"] is False


def test_parent_review_api_passes_exact_exam_identity() -> None:
    student_id = "88888888-8888-4888-8888-888888888888"
    question_id = "imported-parent-review-question"
    exam_id = "imported-parent-review-exam"
    attempt_id = "imported-parent-review-attempt"
    imported_question = {
        "id": question_id,
        "subject": "math",
        "year_level": 7,
        "question": "Explain why the answer is correct.",
        "question_type": "reasoning",
        "answer": "A valid explanation",
        "topic_ids": [TOPIC],
        "sub_parts": [],
    }
    engine = get_engine(student_id, "math")
    engine.log_attempt(
        topic=TOPIC,
        question_id=question_id,
        is_correct=False,
        error_type="parent_review_pending",
        student_answer="an explanation",
        topic_ids=[TOPIC],
        question_type="reasoning",
        outcome=AttemptOutcome.PENDING,
        score=0,
        max_score=1,
        attempt_id=attempt_id,
        exam_id=exam_id,
    )
    session = _session(exam_id=exam_id, question_id=question_id, topic_ids=[TOPIC])
    session["student_id"] = student_id
    session["completed_at"] = "2026-01-01T09:01:00+00:00"
    session["imported_questions"] = [imported_question]
    session["results"] = _pending_result(exam_id, question_id, [TOPIC])
    session["results"]["results_per_question"][0]["attempt_id"] = attempt_id
    log = engine._read_log(topics=[])
    log["exam_sessions"] = [session]
    engine._write_log(log)

    client = TestClient(app)
    auth_headers = {"Authorization": f"Bearer {create_student_token(student_id)}"}
    login = client.post(
        "/api/parent/login",
        json={"password": "test-parent-password"},
        headers=auth_headers,
    )
    assert login.status_code == 200
    parent_headers = {
        **auth_headers,
        "X-Parent-Token": login.json()["token"],
    }

    queue = client.get(
        "/api/parent/review-queue",
        params={"student_id": student_id, "subject": "math"},
        headers=parent_headers,
    )
    assert queue.status_code == 200
    item = queue.json()["pending"][0]
    assert item["exam_id"] == exam_id
    assert item["attempt_id"] == attempt_id
    assert item["question"] == imported_question["question"]

    reviewed = client.post(
        "/api/parent/review",
        json={
            "student_id": student_id,
            "subject": "math",
            "topic": TOPIC,
            "question_id": question_id,
            "student_answer": "an explanation",
            "correct": True,
            "attempt_id": attempt_id,
            "exam_id": exam_id,
        },
        headers=parent_headers,
    )
    assert reviewed.status_code == 200
    assert reviewed.json()["ok"] is True
    assert reviewed.json()["exam_reconciled"] is True

    session_after = get_engine(student_id, "math").get_exam_sessions()[0]
    assert session_after["results"]["provisional"] is False
    assert session_after["results"]["correct"] == 1


def test_legacy_result_reconciles_by_exam_question_and_saved_response_idempotently() -> None:
    question_id = "legacy-review-exact"
    target = _legacy_completed_session(
        exam_id="legacy-target",
        question_id=question_id,
        completed_at="2026-01-02T09:00:00+00:00",
    )
    other = _legacy_completed_session(
        exam_id="legacy-other",
        question_id=question_id,
        completed_at="2026-01-03T09:00:00+00:00",
    )
    _seed_sessions([target, other])
    sim = ExamSimulator({})

    assert sim.reconcile_parent_review(
        student_id=STUDENT_ID,
        subject="math",
        exam_id="legacy-target",
        question_id=question_id,
        attempt_id=None,
        student_answer="an explanation",
        correct=True,
    ) is True

    sessions = {
        session["exam_id"]: session
        for session in get_engine(STUDENT_ID, "math").get_exam_sessions()
    }
    assert sessions["legacy-target"]["results"]["provisional"] is False
    assert sessions["legacy-target"]["results"]["correct"] == 1
    assert sessions["legacy-other"]["results"]["provisional"] is True
    assert sim.reconcile_parent_review(
        student_id=STUDENT_ID,
        subject="math",
        exam_id="legacy-target",
        question_id=question_id,
        attempt_id=None,
        student_answer="an explanation",
        correct=False,
    ) is False


def test_legacy_result_without_exam_id_uses_unique_newest_completed_match() -> None:
    question_id = "legacy-review-newest"
    older = _legacy_completed_session(
        exam_id="legacy-older",
        question_id=question_id,
        completed_at="2026-01-02T09:00:00+00:00",
    )
    newer = _legacy_completed_session(
        exam_id="legacy-newer",
        question_id=question_id,
        completed_at="2026-01-03T09:00:00+00:00",
    )
    _seed_sessions([older, newer])
    sim = ExamSimulator({})

    assert sim.reconcile_parent_review(
        student_id=STUDENT_ID,
        subject="science",
        exam_id=None,
        question_id=question_id,
        attempt_id=None,
        student_answer="an explanation",
        correct=True,
    ) is False
    assert sim.reconcile_parent_review(
        student_id=STUDENT_ID,
        subject="math",
        exam_id=None,
        question_id=question_id,
        attempt_id=None,
        student_answer="different response",
        correct=True,
    ) is False
    assert sim.reconcile_parent_review(
        student_id=STUDENT_ID,
        subject="math",
        exam_id=None,
        question_id=question_id,
        attempt_id=None,
        student_answer="an explanation",
        correct=True,
    ) is True

    sessions = {
        session["exam_id"]: session
        for session in get_engine(STUDENT_ID, "math").get_exam_sessions()
    }
    assert sessions["legacy-older"]["results"]["provisional"] is True
    assert sessions["legacy-newer"]["results"]["provisional"] is False


def test_legacy_newest_timestamp_tie_is_ambiguous_and_does_not_mutate() -> None:
    question_id = "legacy-review-tie"
    tied_at = "2026-01-03T09:00:00+00:00"
    _seed_sessions([
        _legacy_completed_session(
            exam_id="legacy-tie-a",
            question_id=question_id,
            completed_at=tied_at,
        ),
        _legacy_completed_session(
            exam_id="legacy-tie-b",
            question_id=question_id,
            completed_at=tied_at,
        ),
    ])

    assert ExamSimulator({}).reconcile_parent_review(
        student_id=STUDENT_ID,
        subject="math",
        exam_id=None,
        question_id=question_id,
        attempt_id=None,
        student_answer="an explanation",
        correct=True,
    ) is False
    assert all(
        session["results"]["provisional"] is True
        for session in get_engine(STUDENT_ID, "math").get_exam_sessions()
    )


def test_legacy_multipart_reconciliation_matches_saved_part_response() -> None:
    question_id = "legacy-review-part"
    session = _legacy_completed_session(
        exam_id="legacy-part-exam",
        question_id=question_id,
        completed_at="2026-01-03T09:00:00+00:00",
        student_answer='{"a": "part response"}',
    )
    entry = session["results"]["results_per_question"][0]
    entry.update({
        "score": 0,
        "max_score": 2,
        "part_results": [{
            "label": "a",
            "student_answer": "part response",
            "outcome": AttemptOutcome.PENDING.value,
            "error_type": "parent_review_pending",
            "score": 0,
            "max_score": 2,
        }],
    })
    session["results"]["total_max_score"] = 2
    _seed_sessions([session])

    assert ExamSimulator({}).reconcile_parent_review(
        student_id=STUDENT_ID,
        subject="math",
        exam_id="legacy-part-exam",
        question_id=question_id,
        attempt_id=None,
        part_label="a",
        student_answer="part response",
        correct=True,
    ) is True
    result = get_engine(STUDENT_ID, "math").get_exam_sessions()[0]["results"]
    assert result["provisional"] is False
    assert result["total_score"] == 2
    assert result["results_per_question"][0]["part_results"][0]["is_correct"] is True


def test_parent_review_api_reconciles_legacy_exam_without_identity_fields() -> None:
    student_id = "99999999-9999-4999-8999-999999999999"
    question_id = "legacy-parent-review-api"
    exam_id = "legacy-parent-review-exam"
    engine = get_engine(student_id, "math")
    engine.log_attempt(
        topic=TOPIC,
        question_id=question_id,
        is_correct=False,
        error_type="parent_review_pending",
        student_answer="legacy response",
        topic_ids=[TOPIC],
        question_type="reasoning",
        outcome=AttemptOutcome.PENDING,
        score=0,
        max_score=1,
    )
    session = _legacy_completed_session(
        exam_id=exam_id,
        question_id=question_id,
        completed_at="2026-01-03T09:00:00+00:00",
        student_answer="legacy response",
        student_id=student_id,
    )
    log = engine._read_log(topics=[])
    log["exam_sessions"] = [session]
    engine._write_log(log)

    client = TestClient(app)
    auth_headers = {"Authorization": f"Bearer {create_student_token(student_id)}"}
    login = client.post(
        "/api/parent/login",
        json={"password": "test-parent-password"},
        headers=auth_headers,
    )
    assert login.status_code == 200
    reviewed = client.post(
        "/api/parent/review",
        json={
            "student_id": student_id,
            "subject": "math",
            "topic": TOPIC,
            "question_id": question_id,
            "student_answer": "legacy response",
            "correct": True,
        },
        headers={**auth_headers, "X-Parent-Token": login.json()["token"]},
    )

    assert reviewed.status_code == 200
    assert reviewed.json()["ok"] is True
    assert reviewed.json()["exam_reconciled"] is True
    result = get_engine(student_id, "math").get_exam_sessions()[0]["results"]
    assert result["provisional"] is False
    assert result["correct"] == 1
