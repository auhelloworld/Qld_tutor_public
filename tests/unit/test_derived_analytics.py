import pytest
from fastapi.testclient import TestClient
from pathlib import Path
import json
from datetime import datetime, timedelta, timezone

from backend.api import app
from backend._testing import reset_engine_factory_cache
from backend.student_identity import create_student_token
from backend.services.derived_analytics import (
    derive_learning_facets,
    derive_parent_next_steps,
    derive_weekly_learning_summary,
)

client = TestClient(app)
VALID_STUDENT_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"


def _auth_headers(student_id: str = VALID_STUDENT_ID) -> dict:
    token = create_student_token(student_id)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def _isolate(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Reset engine cache and redirect LOG_ROOT to tmp_path for isolation."""
    reset_engine_factory_cache()
    monkeypatch.setattr("backend.rules.LOG_ROOT", tmp_path / "logs")
    yield
    reset_engine_factory_cache()


def test_derive_analytics_defaults_when_no_log():
    """Ensure that default values are returned when no log file exists."""
    facets = derive_learning_facets(VALID_STUDENT_ID, "math")
    assert facets["fluency"]["status"] == "developing"
    assert facets["fluency"]["score"] == 0.5

    steps = derive_parent_next_steps(VALID_STUDENT_ID, "math")
    assert "begin practice" in steps["headline"].lower()
    assert steps["weekly_coaching_plan"]["student_actions"]
    assert steps["weekly_coaching_plan"]["parent_questions"]


def test_pending_only_history_does_not_trigger_weak_parent_advice():
    from backend.rules import get_engine

    engine = get_engine(VALID_STUDENT_ID, "math")
    engine.save_log({
        "student_id": VALID_STUDENT_ID,
        "topics": {
            "AC9M7N02": {
                "attempts": [
                    {
                        "attempt_id": "pending-only-1",
                        "question_id": "math_7_pending_only",
                        "correct": False,
                        "outcome": "pending",
                        "error_type": "parent_review_pending",
                        "attempt_type": "answer",
                        "student_answer": "an explanation",
                        "timestamp": "2026-07-10T08:00:00+00:00",
                    }
                ],
                "accuracy": 0.0,
            }
        },
    })

    facets = derive_learning_facets(VALID_STUDENT_ID, "math")
    steps = derive_parent_next_steps(VALID_STUDENT_ID, "math")

    assert facets["fluency"]["evidence_count"] == 0
    assert "begin practice" in steps["headline"].lower()
    assert steps["reason_codes"] == ["no_recent_evidence"]


def test_derive_learning_facets_with_mock_data(tmp_path):
    """Thin evidence should report accuracy without overstating confidence."""
    from backend.rules import get_engine
    engine = get_engine(VALID_STUDENT_ID, "math")

    # Seed log data with mock short-answer attempts
    log_data = {
        "student_id": VALID_STUDENT_ID,
        "topics": {
            "AC9M7N02": {
                "attempts": [
                    {
                        "question_id": "math_7_f_AC9M7N02_1",
                        "correct": True,
                        "attempt_type": "answer",
                        "question_type": "short_answer",
                        "support_level": 0,
                        "timestamp": "2026-06-15T10:00:00Z"
                    },
                    {
                        "question_id": "math_7_f_AC9M7N02_2",
                        "correct": True,
                        "attempt_type": "answer",
                        "question_type": "short_answer",
                        "support_level": 0,
                        "timestamp": "2026-06-15T10:05:00Z"
                    }
                ],
                "accuracy": 1.0
            }
        }
    }
    engine.save_log(log_data)

    facets = derive_learning_facets(VALID_STUDENT_ID, "math")
    assert facets["fluency"]["status"] == "developing"
    assert facets["fluency"]["score"] == 1.0
    assert facets["fluency"]["confidence"] == "low"
    assert facets["independence"]["status"] == "developing"


def test_derive_learning_facets_counts_dialogue_help_as_independence_signal():
    """AI chat turns should reduce independence the same way hints do."""
    from backend.rules import get_engine
    engine = get_engine(VALID_STUDENT_ID, "math")

    engine.save_log({
        "student_id": VALID_STUDENT_ID,
        "topics": {
            "AC9M7N02": {
                "attempts": [
                    {
                        "question_id": "math_7_f_AC9M7N02_1",
                        "correct": True,
                        "attempt_type": "answer",
                        "question_type": "short_answer",
                        "support_level": 0,
                        "timestamp": "2026-06-15T10:00:00Z",
                    }
                ],
                "dialogue_sessions": [
                    {"role": "student", "message": "I need help", "timestamp": "2026-06-15T10:01:00Z"},
                    {"role": "tutor", "message": "Try the first step", "timestamp": "2026-06-15T10:01:02Z"},
                    {"role": "student", "message": "What next?", "timestamp": "2026-06-15T10:01:10Z"},
                ],
            }
        },
    })

    facets = derive_learning_facets(VALID_STUDENT_ID, "math")

    assert facets["independence"]["score"] == 0.33
    assert facets["independence"]["status"] == "stretch"
    assert facets["independence"]["answer_count"] == 1
    assert facets["independence"]["hint_count"] == 0
    assert facets["independence"]["dialogue_turns"] == 2


def test_derive_learning_facets_for_english_subject(monkeypatch):
    """English facets should use English skill names and classify by AC9 English topic IDs."""
    from backend.rules import get_engine
    engine = get_engine(VALID_STUDENT_ID, "english")
    engine.save_log({
        "student_id": VALID_STUDENT_ID,
        "topics": {
            "AC9E7LY03": {
                "attempts": [
                    {
                        "question_id": "eng_evidence",
                        "correct": True,
                        "attempt_type": "answer",
                        "timestamp": "2026-06-15T10:00:00Z",
                    }
                ]
            },
            "AC9E7LA05": {
                "attempts": [
                    {
                        "question_id": "eng_conventions",
                        "correct": False,
                        "attempt_type": "answer",
                        "timestamp": "2026-06-15T10:05:00Z",
                    }
                ]
            }
        }
    })

    class FakeTutor:
        exercises = {
            "eng_evidence": {"topic_ids": ["AC9E7LY03"], "question_type": "reasoning"},
            "eng_conventions": {"topic_ids": ["AC9E7LA05"], "question_type": "short_answer"},
        }

    monkeypatch.setattr("backend.services.derived_analytics.get_tutor_engine", lambda: FakeTutor())

    facets = derive_learning_facets(VALID_STUDENT_ID, "english")
    assert set(facets) == {
        "comprehension",
        "text_evidence",
        "language_conventions",
        "vocabulary",
        "writing_structure",
        "independence",
    }
    assert facets["text_evidence"]["status"] == "developing"
    assert facets["text_evidence"]["confidence"] == "low"
    assert facets["language_conventions"]["status"] == "stretch"


def test_derive_learning_facets_for_science_subject(monkeypatch):
    """Science facets should use science skill names and classify inquiry/evidence attempts."""
    from backend.rules import get_engine
    engine = get_engine(VALID_STUDENT_ID, "science")
    engine.save_log({
        "student_id": VALID_STUDENT_ID,
        "topics": {
            "AC9S7I01": {
                "attempts": [
                    {
                        "question_id": "sci_inquiry",
                        "correct": True,
                        "attempt_type": "answer",
                        "timestamp": "2026-06-15T10:00:00Z",
                    }
                ]
            },
            "AC9S7H01": {
                "attempts": [
                    {
                        "question_id": "sci_evidence",
                        "correct": False,
                        "attempt_type": "answer",
                        "timestamp": "2026-06-15T10:05:00Z",
                    }
                ]
            }
        }
    })

    class FakeTutor:
        exercises = {
            "sci_inquiry": {"topic": "Plan an experiment with variables", "question": "Identify the independent variable"},
            "sci_evidence": {"topic": "Evidence analysis", "question": "Evaluate the conclusion using evidence"},
        }

    monkeypatch.setattr("backend.services.derived_analytics.get_tutor_engine", lambda: FakeTutor())

    facets = derive_learning_facets(VALID_STUDENT_ID, "science")
    assert set(facets) == {
        "conceptual_knowledge",
        "inquiry_design",
        "data_interpretation",
        "scientific_reasoning",
        "science_in_context",
        "independence",
    }
    assert facets["inquiry_design"]["status"] == "developing"
    assert facets["scientific_reasoning"]["confidence"] == "low"
    assert facets["scientific_reasoning"]["status"] == "stretch"


def test_learning_facets_integrate_writing_history_for_english(monkeypatch, tmp_path):
    from backend.rules import get_engine
    from backend.services import derived_analytics

    engine = get_engine(VALID_STUDENT_ID, "english")
    engine.save_log({"student_id": VALID_STUDENT_ID, "topics": {}})
    writing_path = tmp_path / "english_writing_log.json"
    writing_path.write_text(json.dumps({
        "student_id": VALID_STUDENT_ID,
        "assessments": [
            {
                "timestamp": "2026-06-15T10:00:00+00:00",
                "year_level": 7,
                "criterion_scores": [
                    {"name": "Evidence / Integration", "score": 5, "max_score": 5},
                    {"name": "Text Structure", "score": 4, "max_score": 5},
                    {"name": "Punctuation", "score": 2, "max_score": 5},
                ],
                "source_use_feedback": {"uses_source_evidence": True},
            }
        ],
    }), encoding="utf-8")
    monkeypatch.setattr(derived_analytics, "_writing_history_path", lambda _student_id: writing_path)

    facets = derive_learning_facets(VALID_STUDENT_ID, "english", year_level=7)

    assert facets["text_evidence"]["evidence_sources"]["writing"] == 2
    assert facets["writing_structure"]["evidence_sources"]["writing"] == 1
    assert facets["language_conventions"]["evidence_sources"]["writing"] == 1
    assert facets["text_evidence"]["score"] > 0.8


def test_derive_parent_next_steps_with_incorrect_value_error(tmp_path):
    """Test that a predominance of incorrect_value errors produces calculation slip coaching tips."""
    from backend.rules import get_engine
    engine = get_engine(VALID_STUDENT_ID, "math")

    log_data = {
        "student_id": VALID_STUDENT_ID,
        "topics": {
            "AC9M7N02": {
                "attempts": [
                    {
                        "question_id": "math_7_f_AC9M7N02_1",
                        "correct": False,
                        "attempt_type": "answer",
                        "error_type": "incorrect_value",
                        "timestamp": "2026-06-15T10:00:00Z"
                    },
                    {
                        "question_id": "math_7_f_AC9M7N02_2",
                        "correct": False,
                        "attempt_type": "answer",
                        "error_type": "incorrect_value",
                        "timestamp": "2026-06-15T10:05:00Z"
                    },
                    {
                        "question_id": "math_7_f_AC9M7N02_3",
                        "correct": False,
                        "attempt_type": "answer",
                        "error_type": "incorrect_value",
                        "timestamp": "2026-06-15T10:10:00Z"
                    },
                    {
                        "question_id": "math_7_f_AC9M7N02_4",
                        "correct": False,
                        "attempt_type": "answer",
                        "error_type": "incorrect_value",
                        "timestamp": "2026-06-15T10:15:00Z"
                    },
                    {
                        "question_id": "math_7_f_AC9M7N02_5",
                        "correct": False,
                        "attempt_type": "answer",
                        "error_type": "incorrect_value",
                        "timestamp": "2026-06-15T10:20:00Z"
                    }
                ],
                "accuracy": 0.0
            }
        }
    }
    engine.save_log(log_data)

    steps = derive_parent_next_steps(VALID_STUDENT_ID, "math")
    assert "calculation" in steps["headline"].lower() or "calculation" in steps["main_difficulty"].lower()
    assert steps["suggested_duration_minutes"] == 15
    assert steps["focus_area"]["topic_id"] == "AC9M7N02"
    assert "weekly_coaching_plan" in steps
    assert steps["weekly_coaching_plan"]["review_topics"]


def test_parent_next_steps_returns_reason_codes_evidence_and_deep_link():
    """Parent next steps should explain why a focus topic was selected."""
    from backend.rules import get_engine
    engine = get_engine(VALID_STUDENT_ID, "math")
    now = datetime.now(timezone.utc).isoformat()

    engine.save_log({
        "student_id": VALID_STUDENT_ID,
        "topics": {
            "AC9M7N02": {
                "attempts": [
                    {
                        "question_id": "math_7_f_AC9M7N02_1",
                        "correct": False,
                        "attempt_type": "answer",
                        "error_type": "concept_gap",
                        "timestamp": now,
                    },
                    {
                        "question_id": "math_7_f_AC9M7N02_2",
                        "correct": False,
                        "attempt_type": "answer",
                        "error_type": "concept_gap",
                        "timestamp": now,
                    },
                    {
                        "question_id": "math_7_f_AC9M7N02_3",
                        "correct": True,
                        "attempt_type": "answer",
                        "timestamp": now,
                    },
                ],
                "dialogue_sessions": [
                    {"role": "student", "message": "Can you help?", "timestamp": now},
                    {"role": "tutor", "message": "Try identifying the rule.", "timestamp": now},
                ],
            }
        },
    })

    steps = derive_parent_next_steps(VALID_STUDENT_ID, "math")

    assert steps["focus_area"]["topic_id"] == "AC9M7N02"
    assert "repeated_recent_errors" in steps["reason_codes"]
    assert "low_mastery" in steps["reason_codes"]
    assert steps["evidence"]["recent_attempts"] == 3
    assert steps["evidence"]["recent_accuracy"] == 0.33
    assert steps["evidence"]["dialogue_turns"] == 1
    assert steps["deep_link"] == "/guided-practice?subject=math&mode=parent-focus&topic=AC9M7N02&year=year7"


def test_parent_next_steps_endpoint():
    """Ensure the GET /api/tutor/parent-next-steps endpoint works and requires auth headers."""
    # Test unauthorized
    response = client.get("/api/tutor/parent-next-steps")
    assert response.status_code == 401

    # Test authorized
    response = client.get("/api/tutor/parent-next-steps", headers=_auth_headers())
    assert response.status_code == 200
    payload = response.json()
    assert "headline" in payload
    assert "next_practice_action" in payload
    assert "weekly_coaching_plan" in payload


def test_learning_facets_endpoint():
    """Ensure the GET /api/tutor/learning-facets endpoint works and requires auth headers."""
    # Test unauthorized
    response = client.get("/api/tutor/learning-facets")
    assert response.status_code == 401

    # Test authorized
    response = client.get("/api/tutor/learning-facets", headers=_auth_headers())
    assert response.status_code == 200
    payload = response.json()
    assert "fluency" in payload
    assert "conceptual_understanding" in payload


@pytest.mark.parametrize("support_level", [1, 2, 3, 4])
def test_parent_extension_advice_requires_independent_evidence(support_level):
    from backend.rules import get_engine

    engine = get_engine(VALID_STUDENT_ID, "math")
    now = datetime.now(timezone.utc)
    attempts = []
    for index in range(6):
        attempt = {
            "question_id": f"supported-extension-{support_level}-{index}",
            "correct": True,
            "attempt_type": "answer",
            "question_type": "short_answer",
            "support_level": support_level,
            "timestamp": (now + timedelta(seconds=index)).isoformat(),
        }
        if support_level == 4:
            attempt["used_show_answer"] = True
        attempts.append(attempt)

    engine.save_log({
        "student_id": VALID_STUDENT_ID,
        "topics": {"AC9M7N02": {"attempts": attempts, "accuracy": 1.0}},
    })

    steps = derive_parent_next_steps(VALID_STUDENT_ID, "math")

    assert steps["evidence"]["independent_evidence_count"] == 0
    assert steps["evidence"]["independent_accuracy"] is None
    assert "extending challenges" not in steps["headline"].lower()


def test_parent_extension_advice_accepts_explicit_support_zero():
    from backend.rules import get_engine

    engine = get_engine(VALID_STUDENT_ID, "math")
    now = datetime.now(timezone.utc)
    attempts = [
        {
            "question_id": f"independent-extension-{index}",
            "correct": True,
            "attempt_type": "answer",
            "question_type": "short_answer",
            "support_level": 0,
            "timestamp": (now + timedelta(seconds=index)).isoformat(),
        }
        for index in range(6)
    ]
    engine.save_log({
        "student_id": VALID_STUDENT_ID,
        "topics": {"AC9M7N02": {"attempts": attempts, "accuracy": 1.0}},
    })

    steps = derive_parent_next_steps(VALID_STUDENT_ID, "math")

    assert steps["evidence"]["independent_evidence_count"] == 6
    assert steps["evidence"]["independent_accuracy"] == 1.0
    assert "extending challenges" in steps["headline"].lower()


def test_weekly_summary_reads_one_cross_subject_time_window(monkeypatch):
    from backend.rules import get_engine

    in_window_math = {
        "attempt_id": "weekly-math",
        "question_id": "math-weekly",
        "correct": True,
        "outcome": "correct",
        "attempt_type": "answer",
        "support_level": 0,
        "first_attempt": True,
        "timestamp": "2026-09-10T00:00:00+00:00",
    }
    old_math = {
        **in_window_math,
        "attempt_id": "old-math",
        "question_id": "old-math",
        "timestamp": "2026-08-01T00:00:00+00:00",
    }
    in_window_english = {
        **in_window_math,
        "attempt_id": "weekly-english",
        "question_id": "english-weekly",
        "correct": False,
        "outcome": "incorrect",
        "timestamp": "2026-09-11T00:00:00+00:00",
    }
    get_engine(VALID_STUDENT_ID, "math").save_log({
        "student_id": VALID_STUDENT_ID,
        "topics": {"AC9M7N01": {"attempts": [in_window_math, old_math], "accuracy": 1.0}},
    })
    get_engine(VALID_STUDENT_ID, "english").save_log({
        "student_id": VALID_STUDENT_ID,
        "topics": {"AC9E7LY01": {"attempts": [in_window_english], "accuracy": 0.0}},
    })

    monkeypatch.setattr(
        "backend.services.derived_analytics.get_engine",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("weekly summary must not fan out through engines")),
    )
    summary = derive_weekly_learning_summary(
        VALID_STUDENT_ID,
        now=datetime(2026, 9, 12, tzinfo=timezone.utc),
        window_start=datetime(2026, 9, 5, tzinfo=timezone.utc),
    )

    assert summary["attempts"] == 2
    assert set(summary["subject_breakdown"]) == {"math", "english"}
    assert summary["subject_breakdown"]["math"]["attempts"] == 1
    assert summary["subject_breakdown"]["english"]["incorrect"] == 1
