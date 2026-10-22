from __future__ import annotations

from datetime import datetime, timedelta, timezone
import sqlite3

from backend._testing import reset_engine_factory_cache
from backend.rules import MISTAKE_STATE_DERIVATION_VERSION, get_engine


def _fresh_engine(tmp_data_dir, student_id: str = "mistake-state-student"):
    (tmp_data_dir / "qld_tutor.db").unlink(missing_ok=True)
    reset_engine_factory_cache()
    return get_engine(student_id, "math")


def _reopen_engine(student_id: str = "mistake-state-student"):
    reset_engine_factory_cache()
    return get_engine(student_id, "math")


def test_incorrect_attempt_materializes_and_cross_topic_fanout_counts_once(tmp_data_dir):
    engine = _fresh_engine(tmp_data_dir)

    engine.log_attempt(
        "AC9M7N02",
        "q-cross-topic",
        False,
        error_type="incorrect_value",
        student_answer="12",
        topic_ids=["AC9M7N02", "AC9M7N03"],
    )

    page = engine.query_mistake_states(valid_topic_ids={"AC9M7N02", "AC9M7N03"})
    assert page["total"] == 1
    assert page["rows"][0]["question_id"] == "q-cross-topic"
    assert page["rows"][0]["attempt_count"] == 1
    assert page["rows"][0]["fixed_by_later_correct"] is False
    assert engine.query_mistake_states(topic_id="AC9M7N03")["total"] == 1


def test_cause_then_independent_correct_marks_fixed_but_show_answer_does_not(tmp_data_dir):
    engine = _fresh_engine(tmp_data_dir)
    engine.log_attempt(
        "AC9M7N02",
        "q-fixed",
        False,
        error_type="concept_gap",
        student_answer="wrong",
    )
    engine.log_attempt(
        "AC9M7N02",
        "q-fixed",
        True,
        student_answer="right",
        used_show_answer=True,
    )

    revealed = engine.query_mistake_states(topic_id="AC9M7N02")["rows"][0]
    assert revealed["fixed_by_later_correct"] is False
    assert revealed["attempt_count"] == 2

    engine.log_attempt(
        "AC9M7N02",
        "q-fixed",
        True,
        student_answer="right before reflection",
    )
    premature = engine.query_mistake_states(topic_id="AC9M7N02")["rows"][0]
    assert premature["fixed_by_later_correct"] is False
    assert premature["closure_stage"] == "needs_understanding"

    engine.update_latest_incorrect_attempt_metadata(
        "q-fixed",
        {
            "error_cause": "concept_gap",
            "cause_recorded_at": datetime.now(timezone.utc).isoformat(),
        },
        topics=["AC9M7N02"],
    )
    assert engine.get_mistake_state("q-fixed")["closure_stage"] == "needs_retry"

    engine.log_attempt(
        "AC9M7N02",
        "q-fixed",
        True,
        student_answer="right after reflection",
    )
    fixed = engine.query_mistake_states(topic_id="AC9M7N02")["rows"][0]
    assert fixed["fixed_by_later_correct"] is True
    assert fixed["closure_stage"] == "needs_transfer"
    assert fixed["last_correct_after_error_at"]
    assert fixed["attempt"]["student_answer"] == "wrong"
    assert fixed["attempt_count"] == 4
    assert engine.query_mistake_states(status="active")["total"] == 1
    assert engine.query_mistake_states(status="resolved")["total"] == 0


def test_progressive_attempt_replaces_state_instead_of_adding_history(tmp_data_dir):
    engine = _fresh_engine(tmp_data_dir)
    attempt_id = "progressive-attempt"

    engine.log_attempt(
        "AC9M7N02",
        "q-progressive",
        False,
        error_type="parent_review_pending",
        student_answer="draft",
        outcome="pending",
        attempt_id=attempt_id,
    )
    assert engine.query_mistake_states()["total"] == 0

    engine.log_attempt(
        "AC9M7N02",
        "q-progressive",
        False,
        error_type="incorrect_value",
        student_answer="revised but wrong",
        outcome="incorrect",
        attempt_id=attempt_id,
    )
    wrong = engine.query_mistake_states()["rows"][0]
    assert wrong["attempt_count"] == 1

    engine.log_attempt(
        "AC9M7N02",
        "q-progressive",
        True,
        error_type=None,
        student_answer="final answer",
        outcome="correct",
        attempt_id=attempt_id,
    )
    assert engine.query_mistake_states()["total"] == 0


def test_parent_review_and_manual_resolution_update_materialized_state(tmp_data_dir):
    engine = _fresh_engine(tmp_data_dir)
    attempt_id = engine.log_attempt(
        "AC9M7N02",
        "q-parent-review",
        False,
        error_type="parent_review_pending",
        student_answer="explanation",
        outcome="pending",
    )

    assert engine.review_attempt(
        "AC9M7N02",
        "q-parent-review",
        "explanation",
        False,
        attempt_id=attempt_id,
    )
    row = engine.query_mistake_states()["rows"][0]
    assert row["error_type"] == "parent_review_rejected"

    engine.update_mistake_review_state(
        "q-parent-review",
        resolved=True,
        resolved_at="2026-07-31T10:00:00+00:00",
        review_count=1,
        resolution_source="manual_dismissal",
    )
    resolved = engine.query_mistake_states()["rows"][0]
    assert resolved["resolved"] is True
    assert resolved["review_count"] == 1
    assert resolved["resolution_source"] == "manual_dismissal"


def test_recent_query_pages_in_sql_with_stable_total(tmp_data_dir):
    engine = _fresh_engine(tmp_data_dir)
    for index in range(5):
        engine.log_attempt(
            "AC9M7N02",
            f"q-page-{index}",
            False,
            error_type="incorrect_value" if index % 2 else "concept_gap",
            student_answer=str(index),
        )

    first = engine.query_mistake_states(limit=2, offset=0)
    second = engine.query_mistake_states(limit=2, offset=2)
    filtered = engine.query_mistake_states(error_type="incorrect_value")

    assert first["total"] == second["total"] == 5
    assert len(first["rows"]) == len(second["rows"]) == 2
    assert {row["question_id"] for row in first["rows"]}.isdisjoint(
        {row["question_id"] for row in second["rows"]}
    )
    assert filtered["total"] == 2


def test_get_mistakes_uses_materialized_page_without_loading_history(tmp_data_dir, monkeypatch):
    from types import SimpleNamespace

    from backend.routers import tutor

    engine = _fresh_engine(tmp_data_dir)
    exercises = {}
    for index in range(4):
        question_id = f"q-api-{index}"
        exercises[question_id] = {
            "id": question_id,
            "question": f"Question {index}",
            "answer": "correct",
            "question_type": "short_answer",
            "topic_ids": ["AC9M7N02"],
        }
        engine.log_attempt(
            "AC9M7N02",
            question_id,
            False,
            error_type="concept_gap",
            student_answer=f"wrong-{index}",
        )

    def fail_if_history_is_loaded(*_args, **_kwargs):
        raise AssertionError("materialized Error Book must not call load_log")

    monkeypatch.setattr(engine, "load_log", fail_if_history_is_loaded)
    monkeypatch.setattr(tutor, "get_engine", lambda *_args: engine)
    monkeypatch.setattr(
        tutor,
        "get_tutor_engine",
        lambda: SimpleNamespace(exercises=exercises),
    )
    with tutor._MISTAKES_CACHE_LOCK:
        tutor._MISTAKES_CACHE.clear()

    result = tutor.get_mistakes(
        subject="math",
        year_level=7,
        limit=2,
        offset=1,
        student_id=engine.student_id,
    )

    assert result["total"] == 4
    assert result["returned"] == 2
    assert result["offset"] == 1
    assert result["has_more"] is True
    assert len(result["mistakes"]) == 2
    assert all(item["status"] == "active" for item in result["mistakes"])


def test_delete_student_data_removes_materialized_mistake_rows(tmp_data_dir, monkeypatch):
    import sqlite3

    import backend.rules as rules
    import backend.routers.auth as auth_router

    student_id = "22222222-2222-4222-8222-222222222222"
    engine = _fresh_engine(tmp_data_dir, student_id)
    engine.log_attempt(
        "AC9M7N02",
        "q-delete",
        False,
        error_type="concept_gap",
        student_answer="wrong",
        topic_ids=["AC9M7N02", "AC9M7N03"],
    )
    monkeypatch.setattr(auth_router, "remove_credentials_for_student", lambda _student_id: None)

    rules.delete_student_data(student_id)

    conn = sqlite3.connect(str(tmp_data_dir / "qld_tutor.db"))
    try:
        state_count = conn.execute(
            "SELECT COUNT(*) FROM mistake_state WHERE student_id = ?", (student_id,)
        ).fetchone()[0]
        topic_count = conn.execute(
            "SELECT COUNT(*) FROM mistake_state_topics WHERE student_id = ?", (student_id,)
        ).fetchone()[0]
    finally:
        conn.close()
    assert state_count == 0
    assert topic_count == 0


def test_status_filter_and_summary_cover_full_scope(tmp_data_dir):
    engine = _fresh_engine(tmp_data_dir)
    for question_id, topic_id, error_type in (
        ("q-active-1", "AC9M7N02", "concept_gap"),
        ("q-active-2", "AC9M7N03", "incorrect_value"),
        ("q-resolved", "AC9M7N02", "concept_gap"),
    ):
        engine.log_attempt(
            topic_id,
            question_id,
            False,
            error_type=error_type,
            student_answer="wrong",
        )
    engine.update_mistake_review_state(
        "q-resolved",
        resolved=True,
        resolved_at="2026-07-31T11:00:00+00:00",
        review_count=2,
        resolution_source="manual_dismissal",
    )

    active = engine.query_mistake_states(status="active", limit=1)
    resolved = engine.query_mistake_states(status="resolved", limit=10)
    summary = active["summary"]

    assert active["total"] == 2
    assert len(active["rows"]) == 1
    assert resolved["total"] == 1
    assert resolved["rows"][0]["question_id"] == "q-resolved"
    assert summary == {
        "total": 3,
        "active": 2,
        "resolved": 1,
        "closed": 0,
        "dismissed": 1,
        "reviews": 2,
        "topic_counts": {"AC9M7N02": 2, "AC9M7N03": 1},
        "error_type_counts": {"concept_gap": 2, "incorrect_value": 1},
        "topic_progress": {
            "AC9M7N02": {"total": 2, "overcome": 0, "reviews": 2},
            "AC9M7N03": {"total": 1, "overcome": 0, "reviews": 0},
        },
    }


def test_supported_or_legacy_correct_answers_cannot_fix_error_book_state(tmp_data_dir):
    engine = _fresh_engine(tmp_data_dir, "mistake-provenance-student")
    incorrect = {
        "attempt_id": "source-attempt",
        "question_id": "q-provenance",
        "attempt_type": "answer",
        "correct": False,
        "error_type": "concept_gap",
        "student_answer": "wrong",
        "support_level": 0,
        "timestamp": "2026-08-01T10:00:00+00:00",
    }
    for support_level in [1, 2, 3, 4]:
        correct = {
            "attempt_id": f"correct-{support_level}",
            "question_id": "q-provenance",
            "attempt_type": "answer",
            "correct": True,
            "student_answer": "right",
            "support_level": support_level,
            "timestamp": f"2026-08-01T10:0{support_level}:00+00:00",
        }
        if support_level == 4:
            correct["used_show_answer"] = True
        state, _ = engine._derive_mistake_state([
            ("AC9M7N02", incorrect),
            ("AC9M7N02", correct),
        ])
        assert state is not None
        assert state["fixed_by_later_correct"] is False
        assert state["last_correct_after_error_at"] is None

    legacy_correct = {
        "attempt_id": "correct-legacy",
        "question_id": "q-provenance",
        "attempt_type": "answer",
        "correct": True,
        "student_answer": "right",
        "timestamp": "2026-08-01T10:05:00+00:00",
    }
    state, _ = engine._derive_mistake_state([
        ("AC9M7N02", incorrect),
        ("AC9M7N02", legacy_correct),
    ])
    assert state is not None
    assert state["fixed_by_later_correct"] is False
    assert state["last_correct_after_error_at"] is None


def test_outdated_derivation_rebuild_removes_supported_retry_closure_and_is_idempotent(tmp_data_dir):
    student_id = "mistake-version-supported"
    engine = _fresh_engine(tmp_data_dir, student_id)
    engine.log_attempt(
        "AC9M7N02",
        "q-version-supported",
        False,
        error_type="concept_gap",
        student_answer="wrong",
        support_level=0,
    )
    engine.update_latest_incorrect_attempt_metadata(
        "q-version-supported",
        {
            "error_cause": "concept_gap",
            "cause_recorded_at": datetime.now(timezone.utc).isoformat(),
        },
        topics=["AC9M7N02"],
    )
    engine.log_attempt(
        "AC9M7N02",
        "q-version-supported",
        True,
        student_answer="right with help",
        support_level=2,
    )
    assert engine.get_mistake_state("q-version-supported")["closure_stage"] == "needs_retry"

    db_path = tmp_data_dir / "qld_tutor.db"
    conn = sqlite3.connect(str(db_path))
    try:
        with conn:
            conn.execute(
                """
                UPDATE mistake_state
                SET fixed_by_later_correct = 1,
                    last_correct_after_error_at = '2026-08-01T10:01:00+00:00',
                    retry_correct_at = '2026-08-01T10:01:00+00:00',
                    transfer_correct_at = '2026-08-01T10:02:00+00:00',
                    consolidation_due_at = '2026-08-04T10:02:00+00:00',
                    closed_at = '2026-08-04T10:03:00+00:00',
                    closure_stage = 'closed', resolved = 1,
                    resolution_source = 'demonstrated_correction',
                    derivation_version = 0
                WHERE student_id = ? AND subject = 'math'
                  AND question_id = 'q-version-supported'
                """,
                (student_id,),
            )
    finally:
        conn.close()

    migrated = _reopen_engine(student_id).get_mistake_state("q-version-supported")
    assert migrated["derivation_version"] == MISTAKE_STATE_DERIVATION_VERSION
    assert migrated["fixed_by_later_correct"] is False
    assert migrated["last_correct_after_error_at"] is None
    assert migrated["closure_stage"] == "needs_retry"
    assert migrated["resolved"] is False
    assert migrated["retry_correct_at"] is None
    assert migrated["transfer_correct_at"] is None
    assert migrated["consolidation_due_at"] is None
    assert migrated["closed_at"] is None

    migrated_at = migrated["updated_at"]
    again = _reopen_engine(student_id).get_mistake_state("q-version-supported")
    assert again["derivation_version"] == MISTAKE_STATE_DERIVATION_VERSION
    assert again["updated_at"] == migrated_at


def test_outdated_derivation_preserves_manual_dismissal(tmp_data_dir):
    student_id = "mistake-version-dismissed"
    engine = _fresh_engine(tmp_data_dir, student_id)
    engine.log_attempt(
        "AC9M7N02",
        "q-version-dismissed",
        False,
        error_type="concept_gap",
        student_answer="wrong",
        support_level=0,
    )
    resolved_at = "2026-08-01T11:00:00+00:00"
    engine.set_mistake_closure_state(
        "q-version-dismissed",
        closure_stage="dismissed",
        resolved=True,
        resolved_at=resolved_at,
        review_count=1,
        resolution_source="manual_dismissal",
    )
    conn = sqlite3.connect(str(tmp_data_dir / "qld_tutor.db"))
    try:
        with conn:
            conn.execute(
                """
                UPDATE mistake_state SET derivation_version = 0
                WHERE student_id = ? AND subject = 'math'
                  AND question_id = 'q-version-dismissed'
                """,
                (student_id,),
            )
    finally:
        conn.close()

    migrated = _reopen_engine(student_id).get_mistake_state("q-version-dismissed")
    assert migrated["derivation_version"] == MISTAKE_STATE_DERIVATION_VERSION
    assert migrated["closure_stage"] == "dismissed"
    assert migrated["resolved"] is True
    assert migrated["resolved_at"] == resolved_at
    assert migrated["resolution_source"] == "manual_dismissal"
    assert migrated["review_count"] == 1


def test_outdated_derivation_preserves_closed_state_only_with_independent_raw_evidence(tmp_data_dir):
    student_id = "mistake-version-verified"
    engine = _fresh_engine(tmp_data_dir, student_id)
    source_id = "q-version-verified"
    retry_at = datetime(2026, 8, 1, 10, 1, tzinfo=timezone.utc)
    transfer_at = retry_at + timedelta(minutes=1)
    due_at = transfer_at + timedelta(days=3)
    closed_at = due_at + timedelta(minutes=1)

    def attempt(
        attempt_id: str,
        question_id: str,
        timestamp: datetime,
        *,
        correct: bool,
        review: bool = False,
    ) -> dict:
        row = {
            "attempt_id": attempt_id,
            "question_id": question_id,
            "timestamp": timestamp.isoformat(),
            "updated_at": timestamp.isoformat(),
            "attempt_type": "answer",
            "correct": correct,
            "outcome": "correct" if correct else "incorrect",
            "error_type": None if correct else "concept_gap",
            "student_answer": "right" if correct else "wrong",
            "support_level": 0,
            "weight": 1.0,
        }
        if review:
            row.update({
                "review_source": "error_book",
                "review_question_id": source_id,
                "review_match": {"eligible": True},
            })
        return row

    incorrect_at = retry_at - timedelta(minutes=1)
    incorrect = attempt("source-wrong", source_id, incorrect_at, correct=False)
    incorrect.update({
        "error_cause": "concept_gap",
        "cause_recorded_at": (incorrect_at + timedelta(seconds=30)).isoformat(),
    })
    history = {
        "student_id": student_id,
        "topics": {
            "AC9M7N02": {
                "accuracy": 0.0,
                "attempts": [
                    incorrect,
                    attempt("source-retry", source_id, retry_at, correct=True),
                    attempt("transfer", "q-transfer", transfer_at, correct=True, review=True),
                    attempt("consolidation", "q-consolidation", closed_at, correct=True, review=True),
                ],
            }
        },
    }
    engine._write_log(history)
    engine.refresh_mistake_states([source_id, "q-transfer", "q-consolidation"])
    assert engine.get_mistake_state(source_id)["closure_stage"] == "needs_transfer"
    engine.set_mistake_closure_state(
        source_id,
        closure_stage="closed",
        resolved=True,
        resolved_at=closed_at.isoformat(),
        review_count=2,
        resolution_source="demonstrated_correction",
        transfer_correct_at=transfer_at.isoformat(),
        consolidation_due_at=due_at.isoformat(),
        closed_at=closed_at.isoformat(),
    )
    conn = sqlite3.connect(str(tmp_data_dir / "qld_tutor.db"))
    try:
        with conn:
            conn.execute(
                """
                UPDATE mistake_state SET derivation_version = 0
                WHERE student_id = ? AND subject = 'math' AND question_id = ?
                """,
                (student_id, source_id),
            )
    finally:
        conn.close()

    migrated = _reopen_engine(student_id).get_mistake_state(source_id)
    assert migrated["derivation_version"] == MISTAKE_STATE_DERIVATION_VERSION
    assert migrated["closure_stage"] == "closed"
    assert migrated["resolved"] is True
    assert migrated["resolution_source"] == "demonstrated_correction"
    assert migrated["transfer_correct_at"] == transfer_at.isoformat()
    assert migrated["consolidation_due_at"] == due_at.isoformat()
    assert migrated["closed_at"] == closed_at.isoformat()


def test_outdated_derivation_does_not_keep_a_step_from_a_guessed_transfer(tmp_data_dir):
    """A right answer marked "guess" is not closure evidence, also for stored rows."""
    student_id = "mistake-version-guess"
    engine = _fresh_engine(tmp_data_dir, student_id)
    source_id = "q-version-guess"
    wrong_at = datetime(2026, 8, 1, 10, 0, tzinfo=timezone.utc)
    retry_at = wrong_at + timedelta(minutes=1)
    transfer_at = retry_at + timedelta(minutes=1)

    def row(attempt_id: str, question_id: str, at: datetime, *, correct: bool, **extra) -> dict:
        return {
            "attempt_id": attempt_id,
            "question_id": question_id,
            "timestamp": at.isoformat(),
            "updated_at": at.isoformat(),
            "attempt_type": "answer",
            "correct": correct,
            "outcome": "correct" if correct else "incorrect",
            "error_type": None if correct else "concept_gap",
            "student_answer": "right" if correct else "wrong",
            "support_level": 0,
            "weight": 1.0,
            **extra,
        }

    engine._write_log({
        "student_id": student_id,
        "topics": {
            "AC9M7N02": {
                "accuracy": 0.0,
                "attempts": [
                    row(
                        "source-wrong", source_id, wrong_at, correct=False,
                        error_cause="concept_gap",
                        cause_recorded_at=(wrong_at + timedelta(seconds=30)).isoformat(),
                    ),
                    row("source-retry", source_id, retry_at, correct=True),
                    row(
                        "transfer", "q-transfer", transfer_at, correct=True, confidence="guess",
                        review_source="error_book", review_question_id=source_id,
                        review_match={"eligible": True},
                    ),
                ],
            }
        },
    })
    engine.refresh_mistake_states([source_id, "q-transfer"])
    engine.set_mistake_closure_state(
        source_id,
        closure_stage="needs_consolidation",
        resolved=False,
        resolved_at=None,
        review_count=1,
        resolution_source="demonstrated_correction",
        transfer_correct_at=transfer_at.isoformat(),
        consolidation_due_at=(transfer_at + timedelta(days=3)).isoformat(),
    )
    conn = sqlite3.connect(str(tmp_data_dir / "qld_tutor.db"))
    try:
        with conn:
            conn.execute(
                """
                UPDATE mistake_state SET derivation_version = 0
                WHERE student_id = ? AND subject = 'math' AND question_id = ?
                """,
                (student_id, source_id),
            )
    finally:
        conn.close()

    migrated = _reopen_engine(student_id).get_mistake_state(source_id)
    assert migrated["derivation_version"] == MISTAKE_STATE_DERIVATION_VERSION
    assert migrated["closure_stage"] == "needs_transfer"
    assert migrated["transfer_correct_at"] is None
