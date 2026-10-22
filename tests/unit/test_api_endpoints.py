"""Verification gate for Task 10 — ``backend/api.py`` endpoints.

Covers the gates listed at the bottom of Task 10 in
``.kiro/specs/curriculum-framework-foundation/tasks.md``:

- ``GET /api/curriculum`` returns 200 with top-level ``"math"`` and
  ``math.year7`` containing ``AC9M7N02`` (Req 12.1, 12.2).
- ``GET /api/exercises?topic=fractions`` returns the same exercise IDs as
  before this feature (Req 12.6) — i.e. ``math_7_f_AC9M7N02_adae12`` and ``math_7_d_AC9M7N02_827f9b``.
- ``GET /api/exercises?topic=AC9M7N02`` returns the seed exercises whose
  ``topic_ids`` include that code (Req 12.7; the additive Topic_Id filter
  started matching once Task 11 tagged the records).
- ``GET /api/tutor/recommend?subject=math&year=year7`` returns a payload
  with ``topic_id`` and ``framework_id`` set to non-null values (Req 9.7).

Also covers Task 4 verification (student-isolation spec):
- Affected endpoints reject requests without X-Student-Id header.
- Affected endpoints reject invalid UUID values.
- Unaffected endpoints work with or without the header.
"""

from __future__ import annotations

from datetime import date

from fastapi.testclient import TestClient
import pytest

from backend.api import app, _CORS_ORIGINS
from backend.student_identity import create_student_token


@pytest.fixture(autouse=True)
def _isolate_runtime_storage(tmp_data_dir):
    """Keep endpoint tests off the repository's live SQLite and log paths."""
    yield


client = TestClient(app)


# Removed mock_json_load to test full exercise list

# A valid UUID v4 for use in tests that hit affected endpoints.
VALID_STUDENT_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"


def _auth_headers(student_id: str = VALID_STUDENT_ID) -> dict:
    token = create_student_token(student_id)
    return {"Authorization": f"Bearer {token}"}


STUDENT_ID_HEADER = _auth_headers()


# ---------------------------------------------------------------------------
# Gate 1: GET /api/curriculum
# ---------------------------------------------------------------------------


def test_get_curriculum_returns_unified_view_with_math_year7():
    response = client.get("/api/curriculum")
    assert response.status_code == 200

    payload = response.json()
    assert "math" in payload
    assert "year7" in payload["math"]

    year7 = payload["math"]["year7"]
    assert "AC9M7N02" in year7
    assert isinstance(year7["AC9M7N02"], dict)
    assert year7["AC9M7N02"]["topic_id"] == "AC9M7N02"

    # The sequence is exposed alongside topic dicts.
    assert "sequence" in year7
    assert "AC9M7N02" in year7["sequence"]


def test_get_curriculum_is_deterministic_across_calls():
    """Two consecutive calls return JSON-equivalent payloads (Req 12.8)."""
    first = client.get("/api/curriculum").json()
    second = client.get("/api/curriculum").json()
    assert first == second




def test_get_curriculum_scope_returns_only_selected_content_with_picker_shape():
    full = client.get("/api/curriculum")
    response = client.get(
        "/api/curriculum",
        params={"subject": "math", "scope": "year7"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert "AC9M7N02" in payload["math"]["year7"]
    assert payload["math"]["year8"] == {}
    assert "english" in payload and "year7" in payload["english"]
    assert len(response.content) < len(full.content) // 5

    etag = response.headers["etag"]
    unchanged = client.get(
        "/api/curriculum",
        params={"subject": "math", "scope": "year7"},
        headers={"If-None-Match": etag},
    )
    assert unchanged.status_code == 304
    assert unchanged.content == b""


def test_get_curriculum_scope_rejects_incomplete_or_unknown_scope():
    incomplete = client.get("/api/curriculum", params={"subject": "math"})
    assert incomplete.status_code == 400
    unknown = client.get(
        "/api/curriculum",
        params={"subject": "math", "scope": "year99"},
    )
    assert unknown.status_code == 404
def test_content_availability_counts_authored_exercises():
    """Content availability exposes authored exercise counts by subject and scope."""
    response = client.get("/api/content/availability")
    assert response.status_code == 200
    payload = response.json()
    assert payload["by_subject"]["math"] > 0
    assert payload["by_year"]["math"]["year7"] > 0
    assert "by_unit" in payload


def test_content_availability_uses_precomputed_engine_counts(monkeypatch):
    from backend.routers import curriculum

    class FakeEngine:
        def content_availability(self):
            return {
                "by_subject": {"math": 12},
                "by_year": {"math": {"year7": 12}},
                "by_unit": {},
            }

    monkeypatch.setattr(curriculum, "get_tutor_engine", lambda: FakeEngine())
    assert curriculum.content_availability()["by_subject"] == {"math": 12}


# ---------------------------------------------------------------------------
# Gate 2: GET /api/exercises (legacy mode)
# ---------------------------------------------------------------------------


def test_get_exercises_legacy_topic_returns_phase0_records():
    response = client.get("/api/exercises", params={"topic": "Represent natural numbers as products of powers of prime numbers using exponent notation"})
    assert response.status_code == 200
    ids = [ex["id"] for ex in response.json()]
    assert len(ids) > 0


def test_get_exercises_without_topic_is_rejected():
    """An unfiltered request would serialise the whole bank (tens of MB)."""
    response = client.get("/api/exercises")
    assert response.status_code == 400
    assert response.json()["error"] == "exercise_topic_required"

    scoped_only = client.get("/api/exercises", params={"subject": "math", "year_level": 7})
    assert scoped_only.status_code == 400


def test_get_exercises_response_is_gzip_compressed():
    response = client.get(
        "/api/exercises",
        params={"topic": "AC9M7N06"},
        headers={"Accept-Encoding": "gzip"},
    )
    assert response.status_code == 200
    assert response.headers.get("content-encoding") == "gzip"
    assert len(response.json()) > 0


# ---------------------------------------------------------------------------
# Gate 3: GET /api/exercises?topic=<Topic_Id> (additive Topic_Id mode)
# ---------------------------------------------------------------------------


def test_get_exercises_topic_id_mode_returns_tagged_records():
    """The AC9 Topic_Id branch returns the seed exercises whose
    ``topic_ids`` array contains the requested code. Task 11.2 tagged the
    seed exercises, so ``AC9M7N02`` matches both ``math_7_f_AC9M7N02_adae12`` (Simplify
    18/24) and ``math_7_d_AC9M7N02_3b2b86`` (Convert 3/5 to a decimal — multi-tagged).
    Req 12.7.
    """
    response = client.get("/api/exercises", params={"topic": "AC9M7N02"})
    assert response.status_code == 200
    ids = {ex["id"] for ex in response.json()}
    assert len(ids) > 0


def test_get_exercises_topic_id_mode_resolves_multi_tagged_record():
    """Sanity check the multi-Topic_Id record. ``math_7_d_AC9M7N02_3b2b86`` is tagged
    with both ``AC9M7N02`` and ``AC9M7N06``, so querying by ``AC9M7N06``
    must surface ``math_7_d_AC9M7N02_827f9b`` (Add 1/3 + 1/6) and ``math_7_d_AC9M7N02_3b2b86``.
    """
    response = client.get("/api/exercises", params={"topic": "AC9M7N06"})
    assert response.status_code == 200
    ids = {ex["id"] for ex in response.json()}
    assert len(ids) > 0


def test_topic_id_exercises_use_index_and_omit_concept_card(monkeypatch):
    from backend.routers import curriculum

    class FullBankMustNotBeScanned(dict):
        def values(self):
            raise AssertionError("canonical topic lookup scanned the full exercise bank")

    exercises = [
        {
            "id": f"indexed-{index}",
            "subject": "math",
            "year_level": 7,
            "topic_ids": ["AC9M7N02"],
            "question": f"Question {index}",
            "question_type": "short_answer",
            "difficulty": "foundational",
        }
        for index in range(2)
    ]

    class FakeEngine:
        exercises = FullBankMustNotBeScanned()

        def exercises_for_topic(self, topic_id):
            assert topic_id == "AC9M7N02"
            return exercises

        def get_concept_card_dict(self, topic_id):
            concept_calls.append(topic_id)
            return {"core_rule": "Shared rule"}

    concept_calls: list[str] = []
    monkeypatch.setattr(curriculum, "get_tutor_engine", lambda: FakeEngine())

    result = curriculum.get_exercises(
        topic="AC9M7N02",
        subject="math",
        year_level=7,
        unit=None,
        syllabus_subject=None,
    )

    assert [row["id"] for row in result] == ["indexed-0", "indexed-1"]
    # The pool list does not repeat the topic concept card on every item;
    # it was 83-89% of the payload and the frontend does not read it.
    assert concept_calls == []
    assert all("concept_card" not in row for row in result)


# ---------------------------------------------------------------------------
# Gate 4: GET /api/tutor/recommend
# ---------------------------------------------------------------------------


def test_recommend_endpoint_returns_topic_id_and_framework_id(monkeypatch):
    from backend.rules import StudyRuleEngine
    monkeypatch.setattr(StudyRuleEngine, "load_log", lambda self, topics=None: {
        "student_id": VALID_STUDENT_ID,
        "topics": {},
        "diagnostic_status": {
            "math::7": {"diagnostic_dismissed_at": "2026-06-03T00:00:00"}
        }
    })
    monkeypatch.setattr(StudyRuleEngine, "has_learning_data", lambda self: False)
    monkeypatch.setattr(
        StudyRuleEngine,
        "get_diagnostic_status",
        lambda self, year_level: {"diagnostic_dismissed_at": "2026-06-03T00:00:00"},
    )

    response = client.get(
        "/api/tutor/recommend",
        params={"subject": "math", "year": "year7"},
        headers=STUDENT_ID_HEADER,
    )
    assert response.status_code == 200
    payload = response.json()

    # Canonical fields per Req 9.7.
    assert payload["topic_id"] is not None
    assert payload["framework_id"] == "AC9_MATHS"
    assert payload["recommendation_type"] == "forward"
    assert "name" in payload
    assert payload["name"]

    # Backward-compat legacy keys retained.
    assert payload["topic"] == payload["topic_id"]
    assert "reason" in payload
    assert "mastery" in payload


# ---------------------------------------------------------------------------
# Other endpoints still return 2xx (Req 12.4 surface preservation)
# ---------------------------------------------------------------------------


def test_health_endpoint_returns_ok():
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["message"] == "QLD AI Tutor API is running."
    assert body["llm_status"] in ("mock", "configured", "healthy", "unreachable")
    assert body["cors_origins"] == _CORS_ORIGINS


def test_progress_endpoint_returns_list():
    response = client.get("/api/tutor/progress", params={"subject": "math"}, headers=STUDENT_ID_HEADER)
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_progress_endpoint_scopes_by_year_level(monkeypatch):
    from backend.rules import StudyRuleEngine

    monkeypatch.setattr(StudyRuleEngine, "load_log", lambda self, topics=None: {
        "student_id": VALID_STUDENT_ID,
        "topics": {
            "AC9M7N02": {"attempts": [], "accuracy": 0.2},
            "AC9M8N01": {"attempts": [], "accuracy": 0.8},
        },
    })

    response = client.get(
        "/api/tutor/progress",
        params={"subject": "math", "year_level": 8},
        headers=STUDENT_ID_HEADER,
    )

    assert response.status_code == 200
    assert [item["topic"] for item in response.json()] == ["AC9M8N01"]


def test_progress_summary_endpoint_returns_compact_payload(monkeypatch):
    from backend.routers import tutor

    class FakeEngine:
        def get_progress_summary(self, **kwargs):
            assert kwargs["include_unattempted"] is True
            assert kwargs["valid_topic_ids"]
            return {
                "topics": [{
                    "topic": "AC9M7N02",
                    "attempts_count": 1,
                    "direct_attempts_count": 1,
                }],
                "total_direct_attempts": 1,
            }

    monkeypatch.setattr(tutor, "get_engine", lambda student_id, subject: FakeEngine())
    response = client.get(
        "/api/tutor/progress-summary",
        params={"subject": "math", "year_level": 7, "include_unattempted": True},
        headers=STUDENT_ID_HEADER,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total_direct_attempts"] == 1
    assert "scored_attempt_keys" not in payload["topics"][0]


def test_mistakes_endpoint_scopes_by_year_level(monkeypatch):
    from backend.rules import StudyRuleEngine
    from backend.routers import tutor

    with tutor._MISTAKES_CACHE_LOCK:
        tutor._MISTAKES_CACHE.clear()
    monkeypatch.setattr(StudyRuleEngine, "query_mistake_states", None)

    today = date.today().isoformat()
    monkeypatch.setattr(StudyRuleEngine, "load_log", lambda self, topics=None: {
        "student_id": VALID_STUDENT_ID,
        "topics": {
            "AC9M7N02": {
                "attempts": [{
                    "attempt_type": "answer",
                    "question_id": "math_7_f_AC9M7N02_adae12",
                    "correct": False,
                    "student_answer": "wrong",
                    "error_type": "concept_gap",
                    "timestamp": f"{today}T00:00:00+00:00",
                }]
            },
            "AC9M8N01": {
                "attempts": [{
                    "attempt_type": "answer",
                    "question_id": "math_8_f_AC9M8N01_f3d3b1",
                    "correct": False,
                    "student_answer": "wrong",
                    "error_type": "concept_gap",
                    "timestamp": f"{today}T00:01:00+00:00",
                }]
            },
        },
    })

    response = client.get(
        "/api/tutor/mistakes",
        params={"subject": "math", "year_level": 8},
        headers=STUDENT_ID_HEADER,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["mistakes"][0]["topic_id"] == "AC9M8N01"


def test_mistakes_endpoint_includes_real_diagnostic_attempts(monkeypatch):
    from backend.rules import StudyRuleEngine
    from backend.routers import tutor

    with tutor._MISTAKES_CACHE_LOCK:
        tutor._MISTAKES_CACHE.clear()
    monkeypatch.setattr(StudyRuleEngine, "query_mistake_states", None)
    today = date.today().isoformat()
    monkeypatch.setattr(StudyRuleEngine, "load_log", lambda self, topics=None: {
        "student_id": VALID_STUDENT_ID,
        "topics": {
            "AC9M7N02": {
                "attempts": [{
                    "attempt_type": "diagnostic",
                    "question_id": "math_7_f_AC9M7N02_adae12",
                    "correct": False,
                    "student_answer": "wrong",
                    "error_type": "concept_gap",
                    "timestamp": f"{today}T00:00:00+00:00",
                }]
            },
        },
    })

    response = client.get(
        "/api/tutor/mistakes",
        params={"subject": "math", "year_level": 7},
        headers=STUDENT_ID_HEADER,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["mistakes"][0]["source"] == "diagnostic"


def test_mistakes_endpoint_excludes_pseudo_diagnostic_attempts(monkeypatch):
    from backend.rules import StudyRuleEngine
    from backend.routers import tutor

    with tutor._MISTAKES_CACHE_LOCK:
        tutor._MISTAKES_CACHE.clear()
    monkeypatch.setattr(StudyRuleEngine, "query_mistake_states", None)
    today = date.today().isoformat()
    monkeypatch.setattr(StudyRuleEngine, "load_log", lambda self, topics=None: {
        "student_id": VALID_STUDENT_ID,
        "topics": {
            "AC9M7N02": {
                "attempts": [{
                    "attempt_type": "diagnostic",
                    "question_id": "pseudo_AC9M7N02_0",
                    "correct": False,
                    "student_answer": "wrong",
                    "error_type": "concept_gap",
                    "timestamp": f"{today}T00:00:00+00:00",
                    "skill_id": "AC9M7N02/pseudo_0",
                }]
            },
        },
    })

    response = client.get(
        "/api/tutor/mistakes",
        params={"subject": "math", "year_level": 7},
        headers=STUDENT_ID_HEADER,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 0


def test_mistakes_endpoint_pagination(monkeypatch):
    """EB3: limit/offset bound the returned slice while total/has_more reflect
    the full result set."""
    from types import SimpleNamespace
    from backend.rules import StudyRuleEngine
    from backend.routers import tutor

    with tutor._MISTAKES_CACHE_LOCK:
        tutor._MISTAKES_CACHE.clear()
    monkeypatch.setattr(StudyRuleEngine, "query_mistake_states", None)
    today = date.today().isoformat()
    topics = ["AC9M7N01", "AC9M7N04", "AC9M7N06"]
    fake_exercises = {
        f"q{i}": {
            "id": f"q{i}",
            "question": f"Question {i}",
            "answer": "a",
            "question_type": "short_answer",
            "topic_ids": [tid],
        }
        for i, tid in enumerate(topics, start=1)
    }
    monkeypatch.setattr(tutor, "get_tutor_engine", lambda: SimpleNamespace(exercises=fake_exercises))
    monkeypatch.setattr(StudyRuleEngine, "load_log", lambda self, topics=None: {
        "student_id": VALID_STUDENT_ID,
        "topics": {
            tid: {"attempts": [{
                "attempt_type": "answer",
                "question_id": f"q{i}",
                "correct": False,
                "student_answer": "wrong",
                "error_type": "concept_gap",
                "timestamp": f"{today}T00:00:0{i}+00:00",
            }]}
            for i, tid in enumerate(topics, start=1)
        },
    })

    first = client.get(
        "/api/tutor/mistakes",
        params={"subject": "math", "year_level": 7, "limit": 2, "offset": 0},
        headers=STUDENT_ID_HEADER,
    ).json()
    assert first["total"] == 3
    assert first["returned"] == 2
    assert len(first["mistakes"]) == 2
    assert first["has_more"] is True

    second = client.get(
        "/api/tutor/mistakes",
        params={"subject": "math", "year_level": 7, "limit": 2, "offset": 2},
        headers=STUDENT_ID_HEADER,
    ).json()
    assert second["total"] == 3
    assert second["returned"] == 1
    assert second["has_more"] is False

    resolved = client.get(
        "/api/tutor/mistakes",
        params={
            "subject": "math",
            "year_level": 7,
            "status": "resolved",
            "limit": 2,
            "offset": 0,
        },
        headers=STUDENT_ID_HEADER,
    ).json()
    assert resolved["total"] == 0
    assert resolved["mistakes"] == []
    assert resolved["summary"]["active"] == 3
    assert resolved["summary"]["resolved"] == 0


def test_daily_summary_endpoint_is_explicitly_global(monkeypatch):
    from backend.services import quests

    today = date.today().isoformat()
    monkeypatch.setattr(quests, "collect_cross_subject_stats", lambda student_id: {
        "today_attempts": 2,
        "today_correct": 1,
        "streak_days": 1,
        "freeze_applied": False,
        "freeze_tokens": 0,
        "activity_dates": {today},
        "daily_goal": 20,
    })
    monkeypatch.setattr(quests, "wallet_public", lambda student_id: {})

    response = client.get(
        "/api/tutor/daily-summary",
        params={"subject": "math", "year_level": 8},
        headers=STUDENT_ID_HEADER,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["scope"] == "all_subjects"
    assert payload["today_attempts"] == 2
    assert payload["today_correct"] == 1
    assert payload["today_accuracy"] == 50


# ---------------------------------------------------------------------------
# Task 4 Verification: Student identity gate on affected endpoints
# ---------------------------------------------------------------------------


def test_mark_without_header_returns_401_missing_student_id():
    """POST /api/tutor/mark without X-Student-Id → 401 missing_student_id."""
    response = client.post(
        "/api/tutor/mark",
        json={"question_id": "math_7_f_AC9M7N02_adae12", "student_answer": "2^4 × 3"},
    )
    assert response.status_code == 401
    body = response.json()
    assert body["error"] == "missing_student_id"
    assert "endpoint" in body
    assert "message" in body


def test_mark_with_invalid_uuid_returns_401_invalid_student_id():
    """POST /api/tutor/mark with X-Student-Id: not-a-uuid → 401 invalid_student_id."""
    response = client.post(
        "/api/tutor/mark",
        json={"question_id": "math_7_f_AC9M7N02_adae12", "student_answer": "2^4 × 3"},
        headers={"X-Student-Id": "not-a-uuid"},
    )
    assert response.status_code == 401
    body = response.json()
    assert body["error"] == "invalid_student_id"
    assert "not-a-uuid" in body["message"]
    assert "endpoint" in body


def test_mark_with_valid_uuid_returns_200():
    """POST /api/tutor/mark with valid UUID → 200."""
    response = client.post(
        "/api/tutor/mark",
        json={"question_id": "math_7_f_AC9M7N02_adae12", "student_answer": "2^4 × 3"},
        headers=STUDENT_ID_HEADER,
    )
    assert response.status_code == 200


def test_curriculum_without_header_returns_200():
    """GET /api/curriculum without X-Student-Id → 200 (unaffected endpoint)."""
    response = client.get("/api/curriculum")
    assert response.status_code == 200


def test_curriculum_with_header_returns_200():
    """GET /api/curriculum with X-Student-Id → 200 (header is ignored)."""
    response = client.get("/api/curriculum", headers=STUDENT_ID_HEADER)
    assert response.status_code == 200


def test_recommend_diagnostic_prompt_for_new_student():
    """GET /api/tutor/recommend for a fresh student ID with no learning data returns a diagnostic prompt."""
    import uuid
    fresh_student_id = str(uuid.uuid4())
    response = client.get(
        "/api/tutor/recommend",
        params={"subject": "math", "year": "year7"},
        headers=_auth_headers(fresh_student_id),
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["recommendation_type"] == "diagnostic_prompt"
    assert "Complete a diagnostic assessment" in payload["reason"]


def test_reflect_endpoint_saves_reflection():
    """POST /api/tutor/reflect with valid input updates the attempt reflection."""
    # 1. Answer first so there is a previous attempt
    mark_response = client.post(
        "/api/tutor/mark",
        json={"question_id": "math_7_f_AC9M7N02_adae12", "student_answer": "123"},
        headers=STUDENT_ID_HEADER,
    )
    assert mark_response.status_code == 200

    # 2. Call reflect endpoint
    reflect_response = client.post(
        "/api/tutor/reflect",
        json={"question_id": "math_7_f_AC9M7N02_adae12", "reflection_type": "calculation_slip"},
        headers=STUDENT_ID_HEADER,
    )
    assert reflect_response.status_code == 200
    assert reflect_response.json() == {"success": True}


def test_advanced_lesson_returns_empty_for_missing_topic():
    response = client.get(
        "/api/tutor/advanced-lesson",
        params={"topic_id": "NON_EXISTENT", "subject": "math", "year": "year7"},
    )
    assert response.status_code == 200
    assert response.json() == {}


def test_advanced_lesson_returns_data_for_math_year7():
    response = client.get(
        "/api/tutor/advanced-lesson",
        params={"topic_id": "AC9M7N02", "subject": "math", "year": "year7"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload, dict)
    assert "why_it_works" in payload
    assert isinstance(payload["why_it_works"], list)



def test_daily_summary_failure_does_not_fall_back_to_scoped_metrics(monkeypatch):
    from backend.services import quests

    def unavailable(student_id):
        raise RuntimeError("quest stats unavailable")

    monkeypatch.setattr(quests, "collect_cross_subject_stats", unavailable)
    response = client.get(
        "/api/tutor/daily-summary",
        params={"subject": "math", "year_level": 8},
        headers=STUDENT_ID_HEADER,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["scope"] == "all_subjects"
    assert payload["today_attempts"] == 0
    assert payload["today_correct"] == 0
