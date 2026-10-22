from __future__ import annotations


def test_attempt_metadata_requires_a_short_explanation_not_a_single_token():
    with pytest.raises(ValueError, match="self_explanation_min_words"):
        tutor_router.AttemptMetadataRequest(
            question_id="q1",
            attempt_id="attempt-1",
            self_explanation="because",
        )

    request = tutor_router.AttemptMetadataRequest(
        question_id="q1",
        attempt_id="attempt-1",
        self_explanation="The inverse operation balances both sides.",
    )
    assert request.self_explanation == "The inverse operation balances both sides."

import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend import rules
from backend.routers import auth as auth_router
from backend.routers import parent as parent_router
from backend.routers import quests as quests_router
from backend.routers import student as student_router
from backend.routers import tutor as tutor_router
from backend.services import derived_analytics, quests as quests_service
from backend.student_identity import require_parent, require_student_id


STUDENT_A = "11111111-1111-4111-8111-111111111111"
STUDENT_B = "22222222-2222-4222-8222-222222222222"


class _NoopConnection:
    def execute(self, *_args, **_kwargs):
        return self

    def commit(self):
        return None

    def close(self):
        return None


def test_delete_student_data_rejects_path_escape_before_touching_storage(tmp_path, monkeypatch):
    log_root = tmp_path / "logs"
    log_root.mkdir()
    victim = tmp_path / "victim"
    victim.mkdir()
    monkeypatch.setattr(rules, "LOG_ROOT", log_root)
    monkeypatch.setattr(rules, "_get_db_connection", lambda: pytest.fail("database must not be opened"))

    with pytest.raises(ValueError, match="valid student UUID"):
        rules.delete_student_data("../victim")

    assert victim.is_dir()


def test_delete_route_rejects_non_uuid_target(monkeypatch):
    called = []
    monkeypatch.setattr(student_router, "delete_student_data", lambda target: called.append(target))
    with pytest.raises(HTTPException) as exc_info:
        student_router.delete_student("..", caller_id=STUDENT_A, parent_student_id=STUDENT_A)
    assert exc_info.value.status_code == 400
    assert called == []


def test_delete_endpoint_rejects_encoded_dot_segment(monkeypatch):
    called = []
    monkeypatch.setattr(student_router, "delete_student_data", lambda target: called.append(target))
    app = FastAPI()
    app.include_router(student_router.router)
    app.dependency_overrides[require_student_id] = lambda: STUDENT_A
    app.dependency_overrides[require_parent] = lambda: STUDENT_A

    response = TestClient(app).delete("/api/student/%2E%2E")

    assert response.status_code == 400
    assert response.json()["detail"]["error"] == "invalid_student_id"
    assert called == []


def test_delete_student_data_removes_registered_login(tmp_path, monkeypatch):
    log_root = tmp_path / "logs"
    student_dir = log_root / STUDENT_A
    student_dir.mkdir(parents=True)
    (student_dir / "marker.json").write_text("{}", encoding="utf-8")
    credentials_path = tmp_path / "credentials.json"
    credentials_path.write_text(json.dumps({
        "Student A": {"student_id": STUDENT_A, "password_hash": "hash-a"},
        "Student B": {"student_id": STUDENT_B, "password_hash": "hash-b"},
    }), encoding="utf-8")
    monkeypatch.setattr(rules, "LOG_ROOT", log_root)
    monkeypatch.setattr(rules, "_get_db_connection", lambda: _NoopConnection())
    monkeypatch.setattr(auth_router, "CREDENTIALS_PATH", credentials_path)

    rules.delete_student_data(STUDENT_A)

    saved = json.loads(credentials_path.read_text(encoding="utf-8"))
    assert "Student A" not in saved
    assert saved["Student B"]["student_id"] == STUDENT_B
    assert not student_dir.exists()


def test_all_parent_quest_routes_reject_mismatched_parent_binding():
    calls = [
        lambda: quests_router.parent_quests_snapshot(student_id=STUDENT_B, _parent_id=STUDENT_A),
        lambda: quests_router.parent_quests_settings(
            quests_router.ParentSettingsBody(enabled=True),
            student_id=STUDENT_B,
            _parent_id=STUDENT_A,
        ),
        lambda: quests_router.parent_quests_save_catalog(
            quests_router.CatalogItemBody(title="Reward"),
            student_id=STUDENT_B,
            _parent_id=STUDENT_A,
        ),
        lambda: quests_router.parent_quests_delete_catalog(
            "reward-id",
            student_id=STUDENT_B,
            _parent_id=STUDENT_A,
        ),
        lambda: quests_router.parent_quests_resolve(
            "redemption-id",
            quests_router.ResolveRedemptionBody(approve=True),
            student_id=STUDENT_B,
            _parent_id=STUDENT_A,
        ),
    ]

    for invoke in calls:
        with pytest.raises(HTTPException) as exc_info:
            invoke()
        assert exc_info.value.status_code == 403


def test_revealed_answers_do_not_create_secure_parent_facets(monkeypatch):
    revealed = [
        {
            "attempt_id": f"revealed-{index}",
            "question_id": f"q-{index}",
            "attempt_type": "answer",
            "question_type": "short_answer",
            "correct": True,
            "used_show_answer": True,
            "student_answer": "42",
            "timestamp": f"2026-07-30T10:0{index}:00+00:00",
        }
        for index in range(3)
    ]

    class FakeEngine:
        def load_log(self, topics=None):
            return {"topics": {"AC9M7N02": {"attempts": revealed}}}

    class FakeTutor:
        pass

    FakeTutor.exercises = {
        row["question_id"]: {"question_type": "short_answer"}
        for row in revealed
    }

    monkeypatch.setattr(derived_analytics, "get_engine", lambda *_args, **_kwargs: FakeEngine())
    monkeypatch.setattr(derived_analytics, "get_tutor_engine", lambda: FakeTutor())
    monkeypatch.setattr(derived_analytics, "valid_topic_ids_for_scope", lambda *_args, **_kwargs: {"AC9M7N02"})

    facets = derived_analytics.derive_learning_facets(STUDENT_A, "math", year_level=7)

    assert facets["fluency"]["evidence_count"] == 0
    assert facets["conceptual_understanding"]["evidence_count"] == 0
    assert facets["independence"]["status"] == "stretch"
    assert facets["independence"]["reveal_count"] == 3


def test_progress_mastery_uses_direct_evidence_only():
    class Loader:
        def load_topic(self, _topic):
            return None

    engine = object.__new__(rules.StudyRuleEngine)
    engine._loader = Loader()
    attempt_time = datetime.now(timezone.utc) - timedelta(days=7)
    attempts = [
        {
            "attempt_id": f"attempt-{index}",
            "question_id": f"q-{index}",
            "attempt_type": "answer",
            "correct": True,
            "used_show_answer": index == 2,
            "student_answer": "42",
            "timestamp": (attempt_time + timedelta(minutes=index)).isoformat(),
        }
        for index in range(3)
    ]

    item = engine._progress_item("AC9M7N02", {"attempts": attempts, "accuracy": 1.0})

    assert item["direct_attempts_count"] == 2
    assert item["evidence_count"] == 2
    # Two direct answers remain developing under the current recency/evidence policy.
    assert item["status"] == "developing"


def test_daily_stats_separate_habit_and_independent_accuracy(monkeypatch):
    today = datetime.now(timezone.utc).isoformat()

    class FakeEngine:
        def get_answer_activity_records(self):
            return [
                {"question_id": "revealed", "correct": True, "timestamp": today, "used_show_answer": True, "support_level": 4},
                {"question_id": "direct", "correct": False, "timestamp": today, "used_show_answer": False, "support_level": 0},
            ]

        def get_extra_metadata(self):
            return {"settings": {"daily_goal": 30}}

    monkeypatch.setattr(quests_service, "_storage_subjects_for_student", lambda _student_id: ["math"])
    monkeypatch.setattr(quests_service, "_global_daily_goal_for_student", lambda _student_id: 5)
    monkeypatch.setattr(rules, "get_engine", lambda *_args, **_kwargs: FakeEngine())
    monkeypatch.setattr(quests_service, "apply_auto_streak_freeze", lambda *_args, **_kwargs: {"streak_days": 1, "applied": False, "freeze_tokens": 0})

    stats = quests_service.collect_cross_subject_stats(STUDENT_A)

    assert stats["today_attempts"] == 2
    assert stats["today_correct"] == 1
    assert stats["today_independent_attempts"] == 1
    assert stats["today_independent_correct"] == 0
    assert stats["daily_goal"] == 5


def test_accuracy_quest_uses_independent_attempts(tmp_path, monkeypatch):
    monkeypatch.setattr(quests_service.rules, "LOG_ROOT", tmp_path)
    overview = quests_service.build_overview(
        STUDENT_A,
        streak_days=1,
        today_attempts=10,
        today_correct=10,
        today_independent_attempts=0,
        today_independent_correct=0,
        daily_goal=10,
    )
    accuracy = next(item for item in overview["quests"] if item["id"] == "accuracy_ok")
    daily_goal = next(item for item in overview["quests"] if item["id"] == "daily_goal")
    assert daily_goal["complete"] is True
    assert accuracy["complete"] is False


def test_set_daily_goal_uses_profile_scope(monkeypatch):
    captured = {}

    class FakeEngine:
        _lock = __import__("threading").RLock()

        def _read_log(self, topics=None):
            return {"student_id": STUDENT_A, "settings": {}}

        def _write_log(self, data):
            captured["data"] = data

    def fake_get_engine(student_id, subject):
        captured["student_id"] = student_id
        captured["subject"] = subject
        return FakeEngine()

    monkeypatch.setattr(tutor_router, "get_engine", fake_get_engine)
    response = tutor_router.set_daily_goal({"daily_goal": 12, "subject": "math"}, student_id=STUDENT_A)

    assert captured["subject"] == rules.PROFILE_SUBJECT
    assert captured["data"]["settings"]["daily_goal"] == 12
    assert response["scope"] == "all_subjects"


def test_daily_stats_require_explicit_support_zero_and_deduplicate_fanout(monkeypatch):
    today = datetime.now(timezone.utc).isoformat()
    records = [
        {"question_id": "support-0", "correct": True, "timestamp": today, "support_level": 0},
        {"question_id": "support-1", "correct": True, "timestamp": today, "support_level": 1},
        {"question_id": "support-2", "correct": True, "timestamp": today, "support_level": 2},
        {"question_id": "support-3", "correct": True, "timestamp": today, "support_level": 3},
        {"question_id": "support-4", "correct": True, "timestamp": today, "support_level": 4, "used_show_answer": True},
        {"question_id": "legacy", "correct": True, "timestamp": today},
        {"question_id": "fanout", "correct": True, "timestamp": today, "support_level": 0},
        {"question_id": "fanout", "correct": True, "timestamp": today, "support_level": 0},
    ]

    class FakeEngine:
        def get_answer_activity_records(self):
            return records

        def get_extra_metadata(self):
            return {"settings": {"daily_goal": 20}}

    monkeypatch.setattr(quests_service, "_storage_subjects_for_student", lambda _student_id: ["math"])
    monkeypatch.setattr(quests_service, "_global_daily_goal_for_student", lambda _student_id: None)
    monkeypatch.setattr(rules, "get_engine", lambda *_args, **_kwargs: FakeEngine())
    monkeypatch.setattr(
        quests_service,
        "apply_auto_streak_freeze",
        lambda *_args, **_kwargs: {"streak_days": 1, "applied": False, "freeze_tokens": 0},
    )

    stats = quests_service.collect_cross_subject_stats(STUDENT_A)

    assert stats["today_attempts"] == 7
    assert stats["today_independent_attempts"] == 2
    assert stats["today_independent_correct"] == 2


def test_parent_review_queue_filters_by_selected_curriculum_scope(monkeypatch):
    pending = [
        {
            "attempt_id": "attempt-year7",
            "topic": "AC9M7N01",
            "question_id": "q-year7",
            "student_answer": "7",
            "timestamp": "2026-08-01T10:00:00+00:00",
        },
        {
            "attempt_id": "attempt-year8",
            "topic": "AC9M8N01",
            "question_id": "q-year8",
            "student_answer": "8",
            "timestamp": "2026-08-01T10:01:00+00:00",
        },
    ]

    class FakeEngine:
        def get_pending_reviews(self):
            return list(pending)

        def get_exam_sessions(self):
            return []

    class FakeTutor:
        exercises = {
            "q-year7": {"id": "q-year7", "question": "Year 7 question", "question_type": "short_answer"},
            "q-year8": {"id": "q-year8", "question": "Year 8 question", "question_type": "short_answer"},
        }

    monkeypatch.setattr(parent_router, "get_engine", lambda *_args, **_kwargs: FakeEngine())
    monkeypatch.setattr(parent_router, "get_tutor_engine", lambda: FakeTutor())
    monkeypatch.setattr(
        parent_router,
        "valid_topic_ids_for_scope",
        lambda *_args, **_kwargs: {"AC9M7N01"},
    )

    response = parent_router.parent_review_queue(
        student_id=STUDENT_A,
        subject="math",
        year_level=7,
        caller_id=STUDENT_A,
        parent_student_id=STUDENT_A,
    )

    assert [item["question_id"] for item in response["pending"]] == ["q-year7"]


def test_parent_recommendation_deep_link_preserves_course_scope(monkeypatch):
    class FakeEngine:
        def load_log(self, topics=None):
            return {"topics": {}}

    monkeypatch.setattr(derived_analytics, "get_engine", lambda *_args, **_kwargs: FakeEngine())
    monkeypatch.setattr(derived_analytics, "get_tutor_engine", lambda: object())
    monkeypatch.setattr(derived_analytics, "valid_topic_ids_for_scope", lambda *_args, **_kwargs: set())

    result = derived_analytics.derive_parent_next_steps(
        STUDENT_A,
        "methods",
        "unit1",
        unit=1,
        syllabus_subject="methods",
    )

    assert result["deep_link"] == (
        "/guided-practice?subject=senior_methods&mode=parent-focus"
        "&unit=1&syllabus_subject=methods"
    )


def test_parent_english_summary_does_not_claim_a_strongest_facet_from_one_answer(monkeypatch):
    now = datetime.now(timezone.utc).isoformat()
    attempt = {
        "attempt_id": "english-one",
        "question_id": "english-q1",
        "attempt_type": "answer",
        "question_type": "short_answer",
        "correct": True,
        "student_answer": "A sufficiently detailed answer.",
        "support_level": 0,
        "used_show_answer": False,
        "timestamp": now,
    }

    class FakeEngine:
        def load_log(self, topics=None):
            return {"topics": {"AC9E7X01": {"attempts": [attempt]}}}

    class FakeTutor:
        exercises = {
            "english-q1": {
                "topic_ids": ["AC9E7X01"],
                "english_metadata": {"facet": "reading_comprehension"},
            }
        }

    monkeypatch.setattr(parent_router, "get_engine", lambda *_args, **_kwargs: FakeEngine())
    monkeypatch.setattr(parent_router, "get_tutor_engine", lambda: FakeTutor())
    monkeypatch.setattr(parent_router, "valid_topic_ids_for_scope", lambda *_args, **_kwargs: {"AC9E7X01"})

    result = parent_router.parent_english_summary(
        student_id=STUDENT_A,
        caller_id=STUDENT_A,
        parent_student_id=STUDENT_A,
    )

    assert result["strongest_facet"] is None
    assert result["strongest_facet_label"] is None
    assert result["target_gap_facet"] is None
    assert "general enrichment" in result["discussion_prompt"].lower()
    assert "general enrichment" in result["home_activity"].lower()


def test_parent_english_activities_follow_specific_target_gap_not_strongest_area(monkeypatch):
    now = datetime.now(timezone.utc).isoformat()
    attempts = [
        {
            "attempt_id": "english-correct",
            "question_id": "english-q1",
            "attempt_type": "answer",
            "question_type": "short_answer",
            "correct": True,
            "student_answer": "A sufficiently detailed correct answer.",
            "support_level": 0,
            "used_show_answer": False,
            "timestamp": now,
        },
        {
            "attempt_id": "english-wrong",
            "question_id": "english-q2",
            "attempt_type": "answer",
            "question_type": "short_answer",
            "correct": False,
            "student_answer": "An unsupported claim.",
            "support_level": 0,
            "used_show_answer": False,
            "gap_classification": {"primary_error_code": "textual_analysis"},
            "timestamp": now,
        },
    ]

    class FakeEngine:
        def load_log(self, topics=None):
            return {"topics": {"AC9E7X01": {"attempts": attempts}}}

    class FakeTutor:
        exercises = {
            "english-q1": {"topic_ids": ["AC9E7X01"], "english_metadata": {"facet": "reading_comprehension"}},
            "english-q2": {"topic_ids": ["AC9E7X01"], "english_metadata": {"facet": "text_evidence"}},
        }

    monkeypatch.setattr(parent_router, "get_engine", lambda *_args, **_kwargs: FakeEngine())
    monkeypatch.setattr(parent_router, "get_tutor_engine", lambda: FakeTutor())
    monkeypatch.setattr(parent_router, "valid_topic_ids_for_scope", lambda *_args, **_kwargs: {"AC9E7X01"})

    result = parent_router.parent_english_summary(
        student_id=STUDENT_A,
        caller_id=STUDENT_A,
        parent_student_id=STUDENT_A,
    )

    assert result["strongest_facet"] is None
    assert result["target_gap_facet"] == "text_evidence"
    assert "specific word or phrase" in result["discussion_prompt"]
    assert "one word that carries" in result["home_activity"]


def test_parent_writing_history_projects_summary_fields_only(monkeypatch):
    from backend.routers import writing as writing_router

    monkeypatch.setattr(
        writing_router,
        "read_writing_history",
        lambda _student_id: {
            "assessments": [
                {
                    "timestamp": "2026-08-01T00:00:00+00:00",
                    "year_level": 11,
                    "prompt_type": "analytical",
                    "topic_title": "A text",
                    "word_count": 420,
                    "draft_text": "private draft",
                    "source_text": "private source",
                    "total_score": 8,
                    "max_total_score": 10,
                    "criterion_scores": [
                        {"criterion_number": 1, "name": "Knowledge", "score": 4, "max_score": 5, "feedback": "private feedback"},
                    ],
                    "revision_of": None,
                    "has_source_text": True,
                    "has_writer_statement": False,
                },
                {
                    "timestamp": "2026-08-02T00:00:00+00:00",
                    "year_level": 7,
                    "prompt_type": "narrative",
                    "word_count": 80,
                    "draft_text": "junior draft",
                    "total_score": 5,
                    "max_total_score": 10,
                },
            ],
            "truncated": False,
        },
    )

    result = parent_router.parent_writing_history(
        year_level=11,
        unit=1,
        syllabus_subject="english",
        caller_id=STUDENT_A,
        parent_student_id=STUDENT_A,
    )

    assert len(result["assessments"]) == 1
    entry = result["assessments"][0]
    assert entry["word_count"] == 420
    assert entry["criterion_scores"] == [{"criterion_number": 1, "name": "Knowledge", "score": 4, "max_score": 5}]
    assert "draft_text" not in entry
    assert "source_text" not in entry
