from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from backend import rules
from backend.rules import get_engine
from backend.services.attempt_outcomes import AttemptOutcome


STUDENT_ID = "structured-attempt-query-student"
SUBJECT = "math"
TOPIC = "AC9M7N01"


def _create_legacy_attempts_table(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        CREATE TABLE attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id TEXT NOT NULL,
            subject TEXT NOT NULL,
            topic TEXT NOT NULL,
            question_id TEXT NOT NULL,
            correct INTEGER NOT NULL,
            error_type TEXT,
            timestamp TEXT NOT NULL,
            skill_id TEXT NOT NULL,
            response_time_ms INTEGER NOT NULL,
            attempt_type TEXT NOT NULL,
            student_answer TEXT,
            misconception_id TEXT,
            extra TEXT NOT NULL
        )
        """
    )
    return conn


def _insert_legacy(conn: sqlite3.Connection, attempt: dict, index: int) -> None:
    conn.execute(
        """
        INSERT INTO attempts (
            student_id, subject, topic, question_id, correct, error_type,
            timestamp, skill_id, response_time_ms, attempt_type,
            student_answer, misconception_id, extra
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            STUDENT_ID,
            SUBJECT,
            TOPIC,
            attempt["question_id"],
            1 if attempt.get("correct") else 0,
            attempt.get("error_type"),
            attempt["timestamp"],
            f"{TOPIC}/{attempt['question_id']}",
            0,
            attempt.get("attempt_type", "answer"),
            attempt.get("student_answer"),
            None,
            json.dumps(attempt),
        ),
    )


def test_legacy_attempt_rows_are_backfilled_for_structured_queries() -> None:
    conn = _create_legacy_attempts_table(rules.runtime_db_path())
    attempts = [
        {
            "question_id": "q-correct",
            "timestamp": "2025-01-01T00:00:01+00:00",
            "attempt_type": "answer",
            "student_answer": "1",
            "correct": True,
        },
        {
            "question_id": "q-incorrect",
            "timestamp": "2025-01-01T00:00:02+00:00",
            "attempt_type": "diagnostic",
            "student_answer": "2",
            "correct": False,
        },
        {
            "question_id": "q-speed",
            "timestamp": "2025-01-01T00:00:03+00:00",
            "attempt_type": "answer",
            "student_answer": "1",
            "correct": True,
            "is_speed_round": True,
        },
        {
            "question_id": "q-unanswered",
            "timestamp": "2025-01-01T00:00:04+00:00",
            "attempt_type": "answer",
            "student_answer": "",
            "correct": False,
        },
        {
            "question_id": "q-hint",
            "timestamp": "2025-01-01T00:00:05+00:00",
            "attempt_type": "hint",
            "correct": False,
        },
        {
            "attempt_id": "pending-whole",
            "question_id": "q-pending-whole",
            "timestamp": "2025-01-01T00:00:06+00:00",
            "attempt_type": "answer",
            "student_answer": "explanation",
            "correct": False,
            "error_type": "parent_review_pending",
        },
        {
            "attempt_id": "pending-parts",
            "question_id": "q-pending-parts",
            "timestamp": "2025-01-01T00:00:07+00:00",
            "attempt_type": "answer",
            "student_answer": '{"a":"first","b":"second"}',
            "correct": False,
            "error_type": "parent_review_pending",
            "part_results": [
                {
                    "label": "a",
                    "student_answer": "first",
                    "outcome": "pending",
                    "error_type": "parent_review_pending",
                    "score": 0,
                    "max_score": 1,
                },
                {
                    "label": "b",
                    "student_answer": "second",
                    "outcome": "pending",
                    "error_type": "parent_review_pending",
                    "score": 0,
                    "max_score": 2,
                },
            ],
        },
    ]
    for index, attempt in enumerate(attempts):
        _insert_legacy(conn, attempt, index)
    conn.commit()
    conn.close()

    engine = get_engine(STUDENT_ID, SUBJECT)

    assert engine.get_attempted_question_ids() == {"q-correct", "q-incorrect"}
    pending = engine.get_pending_reviews()
    assert {(item["question_id"], item["part_label"]) for item in pending} == {
        ("q-pending-whole", None),
        ("q-pending-parts", "a"),
        ("q-pending-parts", "b"),
    }

    conn = sqlite3.connect(rules.runtime_db_path())
    try:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(attempts)")}
        assert {"outcome", "is_speed_round", "review_pending"} <= columns
        rows = {
            question_id: (outcome, is_speed_round, review_pending)
            for question_id, outcome, is_speed_round, review_pending in conn.execute(
                """
                SELECT question_id, outcome, is_speed_round, review_pending
                FROM attempts
                WHERE student_id = ? AND subject = ?
                """,
                (STUDENT_ID, SUBJECT),
            )
        }
        assert rows["q-correct"] == ("correct", 0, 0)
        assert rows["q-incorrect"] == ("incorrect", 0, 0)
        assert rows["q-speed"] == ("correct", 1, 0)
        assert rows["q-unanswered"] == ("unanswered", 0, 0)
        assert rows["q-pending-whole"] == ("pending", 0, 1)
        assert rows["q-pending-parts"] == ("pending", 0, 1)
        indexes = {row[1] for row in conn.execute("PRAGMA index_list(attempts)")}
        assert "idx_attempts_scored_question_ids_covering" in indexes
        assert "idx_attempts_parent_review" in indexes
    finally:
        conn.close()


def test_structured_columns_track_new_and_reviewed_attempts() -> None:
    engine = get_engine(STUDENT_ID, SUBJECT)
    engine.log_attempt(
        topic=TOPIC,
        question_id="q-new-correct",
        is_correct=True,
        student_answer="42",
        outcome=AttemptOutcome.CORRECT,
    )
    engine.log_attempt(
        topic=TOPIC,
        question_id="q-new-speed",
        is_correct=True,
        student_answer="42",
        outcome=AttemptOutcome.CORRECT,
        is_speed_round=True,
    )
    attempt_id = engine.log_attempt(
        topic=TOPIC,
        question_id="q-new-parts",
        is_correct=False,
        error_type="parent_review_pending",
        student_answer='{ "a": "x", "b": "y" }',
        outcome=AttemptOutcome.PENDING,
        part_results=[
            {
                "label": "a",
                "student_answer": "x",
                "outcome": "pending",
                "error_type": "parent_review_pending",
                "score": 0,
                "max_score": 1,
            },
            {
                "label": "b",
                "student_answer": "y",
                "outcome": "pending",
                "error_type": "parent_review_pending",
                "score": 0,
                "max_score": 1,
            },
        ],
    )

    assert engine.get_attempted_question_ids() == {"q-new-correct"}
    assert [item["part_label"] for item in engine.get_pending_reviews()] == ["a", "b"]

    assert engine.review_attempt(
        TOPIC,
        "q-new-parts",
        "",
        True,
        attempt_id=attempt_id,
        part_label="a",
    )
    assert [item["part_label"] for item in engine.get_pending_reviews()] == ["b"]
    assert engine.review_attempt(
        TOPIC,
        "q-new-parts",
        "",
        True,
        attempt_id=attempt_id,
        part_label="b",
    )
    assert engine.get_pending_reviews() == []
    assert engine.get_attempted_question_ids() == {"q-new-correct", "q-new-parts"}

    conn = sqlite3.connect(rules.runtime_db_path())
    try:
        assert conn.execute(
            """
            SELECT outcome, is_speed_round, review_pending
            FROM attempts
            WHERE student_id = ? AND subject = ? AND question_id = ?
            """,
            (STUDENT_ID, SUBJECT, "q-new-parts"),
        ).fetchone() == ("correct", 0, 0)
    finally:
        conn.close()


def test_flagging_an_incorrect_attempt_updates_parent_review_index() -> None:
    engine = get_engine(STUDENT_ID, SUBJECT)
    engine.log_attempt(
        topic=TOPIC,
        question_id="q-flag",
        is_correct=False,
        error_type="incorrect_value",
        student_answer="wrong",
        outcome=AttemptOutcome.INCORRECT,
    )
    assert engine.get_attempted_question_ids() == {"q-flag"}

    assert engine.flag_attempt_for_review("q-flag", "wrong")
    assert engine.get_attempted_question_ids() == set()
    assert [item["question_id"] for item in engine.get_pending_reviews()] == ["q-flag"]

    conn = sqlite3.connect(rules.runtime_db_path())
    try:
        assert conn.execute(
            """
            SELECT outcome, review_pending FROM attempts
            WHERE student_id = ? AND subject = ? AND question_id = ?
            """,
            (STUDENT_ID, SUBJECT, "q-flag"),
        ).fetchone() == ("pending", 1)
    finally:
        conn.close()
