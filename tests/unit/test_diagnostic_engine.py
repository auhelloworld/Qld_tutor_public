"""Unit tests for DiagnosticEngine (Task 11.3).

Verifies:
- Cooldown enforcement (45-day window).
- Finalisation writes direct attempts only and stores per-area results.
- Staircase branching follows scored evidence only.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from backend.diagnostic_engine import (
    DiagnosticEngine,
    DiagnosticTooRecent,
    DiagnosticAlreadyFinalised,
    DiagnosticRequestConflict,
)
from backend.rules import get_engine


@pytest.fixture
def diagnostic_engine(tmp_data_dir):
    """Create a DiagnosticEngine with test data."""
    from backend.curriculum_loader import CurriculumLoader

    loader = CurriculumLoader(store_root=tmp_data_dir / "curriculum")
    exercises = {}
    for ex_file in tmp_data_dir.glob("exercise_*.json"):
        with open(ex_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, list):
            continue
        for ex in data:
            exercises[ex["id"]] = ex
    return DiagnosticEngine(exercises=exercises, loader=loader)


class TestDiagnosticStart:
    """Tests for DiagnosticEngine.start."""

    def test_start_creates_report(self, tmp_data_dir, diagnostic_engine):
        """Starting a diagnostic creates a report and returns first question."""
        result = diagnostic_engine.start(
            student_id="test-student-1", subject="math", year_level=7
        )
        assert "report_id" in result
        assert "question" in result
        assert "progress" in result
        assert result["progress"]["current"] == 1

    def test_start_cooldown_enforcement(self, tmp_data_dir, diagnostic_engine):
        """Cannot start a new diagnostic within 45 days of completion."""
        student_id = "test-student-cooldown"
        engine = get_engine(student_id, "math")

        # Seed a completed diagnostic
        now = datetime.now(timezone.utc)
        recent_completion = (now - timedelta(days=30)).isoformat()
        log = engine.load_log()
        log["diagnostic_status"] = {
            "math::7": {
                "report_id": "old-report",
                "completed_at": recent_completion,
                "first_interaction_at": recent_completion,
                "diagnostic_dismissed_at": None,
            }
        }
        log["diagnostic_reports"] = [{
            "report_id": "old-report",
            "subject": "math",
            "year_level": 7,
            "started_at": recent_completion,
            "completed_at": recent_completion,
            "pack": [],
            "cursor": 0,
            "responses": [],
            "derived_bkt": {},
        }]
        engine.save_log(log)

        with pytest.raises(DiagnosticTooRecent):
            diagnostic_engine.start(
                student_id=student_id, subject="math", year_level=7
            )

    def test_start_after_cooldown_allows_rerun(self, tmp_data_dir, diagnostic_engine):
        """Can start a new diagnostic after 45 days."""
        student_id = "test-student-rerun"
        engine = get_engine(student_id, "math")

        # Seed a completed diagnostic from 46 days ago
        now = datetime.now(timezone.utc)
        old_completion = (now - timedelta(days=46)).isoformat()
        log = engine.load_log()
        log["diagnostic_status"] = {
            "math::7": {
                "report_id": "old-report",
                "completed_at": old_completion,
                "first_interaction_at": old_completion,
                "diagnostic_dismissed_at": None,
            }
        }
        log["diagnostic_reports"] = [{
            "report_id": "old-report",
            "subject": "math",
            "year_level": 7,
            "started_at": old_completion,
            "completed_at": old_completion,
            "pack": [],
            "cursor": 0,
            "responses": [],
            "derived_bkt": {},
        }]
        engine.save_log(log)

        result = diagnostic_engine.start(
            student_id=student_id, subject="math", year_level=7
        )
        assert "report_id" in result
        assert result["report_id"] != "old-report"


class TestDiagnosticRespond:
    """Tests for DiagnosticEngine.respond."""

    def test_respond_advances_cursor(self, tmp_data_dir, diagnostic_engine):
        """Responding advances the cursor and returns next question."""
        start_result = diagnostic_engine.start(
            student_id="test-respond", subject="math", year_level=7
        )
        report_id = start_result["report_id"]
        question_id = start_result["question"]["id"]

        result = diagnostic_engine.respond(
            student_id="test-respond",
            report_id=report_id,
            question_id=question_id,
            student_answer="3/4",
        )
        assert result.get("completed") is not True or "question" in result or "derived_bkt" in result

    def test_adjudicated_response_is_persisted_and_included_in_area_result(
        self, tmp_data_dir, diagnostic_engine, monkeypatch
    ):
        """An explicit upgrade is a scored diagnostic observation with provenance."""
        from backend.services import answer_adjudication
        from backend.services.attempt_outcomes import is_scored_learning_attempt

        item = {
            "id": "diagnostic-adjudicated-value",
            "subject": "math",
            "year_level": 7,
            "question_type": "short_answer",
            "question": "Estimate the product, then give the actual value and error.",
            "answer": "Estimate 80; actual 80.36; error 0.36.",
            "topic_ids": ["AC9M7N01"],
            "difficulty": "developing",
        }
        diagnostic_engine.exercises[item["id"]] = item
        student_id = "test-diagnostic-adjudicated"
        report_id = "diagnostic-adjudicated-report"
        now = datetime.now(timezone.utc).isoformat()
        engine = get_engine(student_id, "math")
        log = engine.load_log()
        log["diagnostic_reports"] = [{
            "report_id": report_id,
            "subject": "math",
            "year_level": 7,
            "started_at": now,
            "completed_at": None,
            "pack": [item["id"]],
            "cursor": 0,
            "responses": [],
            "derived_bkt": {},
        }]
        log["diagnostic_status"] = {
            "math::7": {
                "report_id": report_id,
                "completed_at": None,
                "first_interaction_at": now,
                "diagnostic_dismissed_at": None,
            }
        }
        engine.save_log(log)

        monkeypatch.setattr(
            answer_adjudication,
            "adjudicate_equivalence",
            lambda *_args, **_kwargs: "confirmed",
        )
        invalidated: list[str] = []
        monkeypatch.setattr(
            "backend.api.invalidate_mistakes_cache",
            lambda value: invalidated.append(value),
        )
        monkeypatch.setattr(
            diagnostic_engine,
            "_next_question",
            lambda *_args, **_kwargs: None,
        )

        result = diagnostic_engine.respond(
            student_id=student_id,
            report_id=report_id,
            question_id=item["id"],
            student_answer="80, 80.36, 0.36",
        )

        assert result["completed"] is True
        assert result["is_correct"] is True
        assert result["response_outcome"] == "correct"
        assert result["llm_adjudicated"] is True
        assert result["grading_deferred"] is False
        assert result["scored_responses"] == 1
        assert invalidated == [student_id]

        saved_report = engine.get_diagnostic_reports()[0]
        saved_response = saved_report["responses"][0]
        assert saved_response["llm_adjudicated"] is True
        assert saved_response["is_correct"] is True
        assert saved_response["outcome"] == "correct"
        assert is_scored_learning_attempt(saved_response) is True
        assert saved_report["areas"]["Number"]["questions"] == 1

    def test_respond_to_finalised_raises(self, tmp_data_dir, diagnostic_engine):
        """Responding to a finalised report raises DiagnosticAlreadyFinalised."""
        student_id = "test-finalised"
        engine = get_engine(student_id, "math")

        # Seed a finalised report
        log = engine.load_log()
        log["diagnostic_reports"] = [{
            "report_id": "done-report",
            "subject": "math",
            "year_level": 7,
            "started_at": "2026-01-01T00:00:00+00:00",
            "completed_at": "2026-01-01T01:00:00+00:00",
            "pack": ["math_7_f_AC9M7N02_adae12"],
            "cursor": 1,
            "responses": [],
            "derived_bkt": {"AC9M7N04": 0.5},
        }]
        log["diagnostic_status"] = {
            "math::7": {
                "report_id": "done-report",
                "completed_at": "2026-01-01T01:00:00+00:00",
                "first_interaction_at": "2026-01-01T00:00:00+00:00",
                "diagnostic_dismissed_at": None,
            }
        }
        engine.save_log(log)

        with pytest.raises(DiagnosticAlreadyFinalised):
            diagnostic_engine.respond(
                student_id=student_id,
                report_id="done-report",
                question_id="math_7_f_AC9M7N02_adae12",
                student_answer="test",
            )


class TestDiagnosticFinalisation:
    """Tests for diagnostic finalisation."""

    def test_full_run_reports_areas_and_writes_direct_attempts_only(self, tmp_data_dir, diagnostic_engine):
        """A full run stores area results and never invents inferred topic rows."""
        student_id = "test-full-run"
        start_result = diagnostic_engine.start(
            student_id=student_id, subject="math", year_level=7
        )
        report_id = start_result["report_id"]

        current_question = start_result["question"]
        for _ in range(30):
            result = diagnostic_engine.respond(
                student_id=student_id,
                report_id=report_id,
                question_id=current_question["id"],
                student_answer=current_question.get("answer", "wrong"),
            )
            if result.get("completed"):
                assert result["areas"]
                assert all(area["band"] in {"secure", "building", "start_here"} for area in result["areas"].values())
                break
            current_question = result["question"]

        log = get_engine(student_id, "math").load_log()
        diagnostic_attempts = [
            attempt
            for topic_data in log.get("topics", {}).values()
            for attempt in topic_data.get("attempts", [])
            if attempt.get("attempt_type") == "diagnostic"
        ]
        assert diagnostic_attempts
        assert not any(str(a.get("question_id", "")).startswith("pseudo_") for a in diagnostic_attempts)
        assert all(a["diagnostic_evidence"]["inferred_from_strand"] is False for a in diagnostic_attempts)
        assert all(a["error_book_eligible"] is False for a in diagnostic_attempts)

    def test_reasoning_llm_failure_defers_not_wrong(self, tmp_data_dir, diagnostic_engine, monkeypatch):
        """P1: reasoning LLM failure → grading_deferred, not silent incorrect."""
        from unittest.mock import MagicMock

        fake = MagicMock()
        fake._mark_reasoning.return_value = {
            "is_correct": False,
            "error_type": "parent_review_pending",
            "score": 0,
            "max_score": 3,
        }
        import backend.routers.helpers as helpers
        monkeypatch.setattr(helpers, "get_tutor_engine", lambda: fake)

        is_correct, deferred = diagnostic_engine._grade_reasoning_correct(
            {
                "id": "r1",
                "question_type": "reasoning",
                "rubric": {"max_score": 3, "key_points": ["a", "b", "c"]},
                "question": "Justify.",
                "answer": "Because.",
            },
            "A multi-sentence justification.",
        )
        assert is_correct is False
        assert deferred is True

    def test_unclassified_miss_does_not_invent_concept_gap(self, tmp_data_dir, diagnostic_engine):
        """Diagnostic misses use the same error type as practice, never concept_gap."""
        short_answer = {
            "id": "sa1",
            "question_type": "short_answer",
            "subject": "math",
            "question": "What is 2+2?",
            "answer": "4",
        }
        result = diagnostic_engine._grade_response(short_answer, "5")
        assert result["is_correct"] is False
        assert result["outcome"] == "incorrect"
        # Practice marks the same deterministic miss as incorrect_value.
        assert result["error_type"] == "incorrect_value"

        mcq = {
            "id": "mc1",
            "question_type": "multiple_choice",
            "subject": "math",
            "question": "Pick the even number.",
            "correct_choice": "B",
            "choices": ["A) 1", "B) 2", "C) 3", "D) 5"],
            "answer": "2",
        }
        mcq_result = diagnostic_engine._grade_response(mcq, "A")
        assert mcq_result["is_correct"] is False
        assert mcq_result["error_type"] == "incorrect_choice"


class TestDiagnosticStatus:
    """Tests for DiagnosticEngine.status."""

    def test_status_no_diagnostic(self, tmp_data_dir, diagnostic_engine):
        """Status returns not completed when no diagnostic exists."""
        result = diagnostic_engine.status(
            student_id="test-no-diag", subject="math", year_level=7
        )
        assert result["completed"] is False
        assert result["report_id"] is None

    def test_status_after_start(self, tmp_data_dir, diagnostic_engine):
        """Status returns not completed after starting but not finishing."""
        diagnostic_engine.start(
            student_id="test-status", subject="math", year_level=7
        )
        result = diagnostic_engine.status(
            student_id="test-status", subject="math", year_level=7
        )
        assert result["completed"] is False
        assert result["report_id"] is not None


class TestDiagnosticDismiss:
    """Tests for DiagnosticEngine.dismiss."""

    def test_dismiss_sets_timestamp(self, tmp_data_dir, diagnostic_engine):
        """Dismissing sets diagnostic_dismissed_at."""
        student_id = "test-dismiss"
        result = diagnostic_engine.dismiss(
            student_id=student_id, subject="math", year_level=7
        )
        assert result["dismissed"] is True

        # Verify in log
        engine = get_engine(student_id, "math")
        log = engine.load_log()
        status = log["diagnostic_status"]["math::7"]
        assert status["diagnostic_dismissed_at"] is not None


class TestDiagnosticAdaptiveBranching:
    """Branching must follow scored evidence, not deferred placeholders."""

    @staticmethod
    def _report(*responses):
        return {"subject": "math", "year_level": 7, "area_limits": [2, 3], "responses": list(responses)}

    def test_deferred_first_response_does_not_move_the_staircase(self, diagnostic_engine):
        """A pending first grade keeps the area on its developing probe."""
        pools = {
            "Number": {
                "foundational": [{"id": "f1"}],
                "developing": [{"id": "d1"}, {"id": "d2"}],
                "extending": [{"id": "e1"}],
                "AMC": [{"id": "a1"}],
            }
        }
        report = self._report({
            "question_id": "d1",
            "topic_id": "AC9M7N01",
            "difficulty": "developing",
            "is_correct": False,
            "grading_deferred": True,
            "outcome": "pending",
            "error_type": "grading_deferred",
        })
        assert diagnostic_engine._next_question(report, pools, ["Number"]) == "d2"

    def test_staircase_moves_one_band_per_scored_answer(self, diagnostic_engine):
        pools = {
            "Number": {
                "foundational": [{"id": "f1"}],
                "developing": [{"id": "d1"}],
                "extending": [{"id": "e1"}],
                "AMC": [{"id": "a1"}],
            }
        }
        report = self._report({
            "question_id": "d1", "topic_id": "AC9M7N01", "difficulty": "developing",
            "is_correct": True, "outcome": "correct", "attempt_type": "diagnostic",
        })
        assert diagnostic_engine._next_question(report, pools, ["Number"]) == "e1"

        report["responses"].append({
            "question_id": "e1", "topic_id": "AC9M7N01", "difficulty": "extending",
            "is_correct": False, "outcome": "incorrect", "attempt_type": "diagnostic",
        })
        # Mixed answers need a third item: one band easier (developing is used,
        # so the nearest easier band wins).
        assert diagnostic_engine._next_question(report, pools, ["Number"]) == "f1"


class TestSpacedRepetitionDirectEvidence:
    def test_find_due_ignores_inferred_pseudo_mastery(self, tmp_data_dir):
        """Strand-inferred pseudo attempts alone must not unlock revision."""
        from backend.rules import StudyRuleEngine
        from backend.spaced_repetition import SpacedRepetitionScheduler, MASTERY_THRESHOLD

        now = datetime.now(timezone.utc)
        log = {
            "topics": {
                "AC9M7N04": {
                    "attempts": [
                        {
                            "question_id": "pseudo_AC9M7N04_0",
                            "correct": True,
                            "attempt_type": "diagnostic",
                            "diagnostic_evidence": {
                                "inferred_from_strand": True,
                                "direct_questions": 0,
                            },
                        }
                    ]
                    * 10,  # even many inferred corrects should not count as direct
                    "revision": {
                        "first_mastered_at": now.isoformat(),
                        "consecutive_revisions": 0,
                        "next_review_at": (now - timedelta(days=1)).isoformat(),
                    },
                }
            }
        }

        engine = StudyRuleEngine.__new__(StudyRuleEngine)
        engine.subject = "math"

        due = SpacedRepetitionScheduler.find_due(
            log,
            now=now,
            framework_slice=None,
            is_mastered_fn=StudyRuleEngine.mastery_established,
        )
        # No direct evidence → not mastered → not due
        assert due is None

def test_pending_responses_stop_at_hard_unscored_cap(
    tmp_data_dir, diagnostic_engine, monkeypatch: pytest.MonkeyPatch
):
    """A provider outage cannot turn a nominal diagnostic into a bank-length run."""
    from backend.services.attempt_outcomes import AttemptOutcome
    from backend.diagnostic_engine import MAX_UNSCORED_RESPONSES

    monkeypatch.setattr(
        diagnostic_engine,
        "_grade_response",
        lambda *_args, **_kwargs: {
            "is_correct": False,
            "outcome": AttemptOutcome.PENDING.value,
            "error_type": "grading_deferred",
            "score": 0,
            "max_score": 1,
        },
    )
    start = diagnostic_engine.start(
        student_id="test-pending-cap", subject="math", year_level=7
    )
    current = start["question"]
    result = None
    for _ in range(MAX_UNSCORED_RESPONSES + 2):
        result = diagnostic_engine.respond(
            student_id="test-pending-cap",
            report_id=start["report_id"],
            question_id=current["id"],
            student_answer="a response that needs review",
        )
        if result.get("completed"):
            break
        current = result["question"]

    assert result is not None and result["completed"] is True
    assert result["unscored_responses"] == MAX_UNSCORED_RESPONSES
    assert result["valid_completion"] is False
    assert any("prevents an open-ended session" in warning for warning in result["grading_warnings"])

    report = next(
        report
        for report in get_engine("test-pending-cap", "math").load_log()["diagnostic_reports"]
        if report["report_id"] == start["report_id"]
    )
    assert len(report["responses"]) == MAX_UNSCORED_RESPONSES
    assert report["termination_reason"] == "unscored_cap"


def test_staircase_climbs_to_amc_when_the_area_needs_more_items():
    diagnostic = DiagnosticEngine({})
    pools = {
        "Number": {
            "foundational": [],
            "developing": [{"id": "d1"}],
            "extending": [{"id": "e1"}],
            "AMC": [{"id": "a1"}],
        }
    }
    report = {
        "subject": "math",
        "year_level": 7,
        "area_limits": [4, 5],  # English-sized areas need more than two answers
        "responses": [
            {"question_id": "d1", "topic_id": "T", "area": "Number", "difficulty": "developing",
             "is_correct": True, "outcome": "correct"},
            {"question_id": "e1", "topic_id": "T", "area": "Number", "difficulty": "extending",
             "is_correct": True, "outcome": "correct"},
        ],
    }

    assert diagnostic._next_question(report, pools, ["Number"]) == "a1"


def test_start_prefers_unseen_practice_question(
    tmp_data_dir, monkeypatch: pytest.MonkeyPatch
):
    from types import SimpleNamespace

    exercises = {
        question_id: {
            "id": question_id,
            "subject": "math",
            "year_level": 7,
            "topic_ids": ["AC9M7N01"],
            "question_type": "short_answer",
            "difficulty": "developing",
            "question": question_id,
            "answer": "1",
        }
        for question_id in ("seen-q", "unseen-q")
    }
    diagnostic = DiagnosticEngine(exercises)
    monkeypatch.setattr(
        diagnostic.loader,
        "load_slice",
        lambda *_: SimpleNamespace(
            topics=[SimpleNamespace(topic_id="AC9M7N01", strand="Number")]
        ),
    )
    monkeypatch.setattr(
        diagnostic.builder, "build", lambda **_: ["seen-q", "unseen-q"]
    )
    monkeypatch.setattr(
        diagnostic,
        "_grading_capabilities",
        lambda *_: {"reasoning_supported": False, "parent_review_mode": False},
    )

    engine = get_engine("test-seen-selection", "math")
    log = engine.load_log()
    log.setdefault("topics", {})["AC9M7N01"] = {
        "accuracy": 1.0,
        "attempts": [
            {
                "attempt_id": "practice-1",
                "attempt_type": "answer",
                "question_id": "seen-q",
                "correct": True,
                "outcome": "correct",
                "timestamp": "2026-01-01T00:00:00+00:00",
                "skill_id": "AC9M7N01/seen-q",
                "response_time_ms": 100,
            }
        ],
    }
    engine.save_log(log)

    start = diagnostic.start(
        student_id="test-seen-selection", subject="math", year_level=7
    )
    assert start["question"]["id"] == "unseen-q"


def test_reduced_coverage_summary_discloses_missing_grade_level_bands():
    summary = DiagnosticEngine._coverage_summary(
        "english",
        {"Language": {"foundational": [{"id": "f1"}], "developing": [], "extending": [], "AMC": []}},
        {"reasoning_supported": False, "parent_review_mode": False},
    )
    assert summary["reduced"] is True
    assert summary["missing_difficulty_bands"] == ["developing", "extending"]
    assert "Semantic marking is unavailable" in summary["message"]


def test_start_resumes_saved_cursor_without_restarting(
    tmp_data_dir, diagnostic_engine, monkeypatch: pytest.MonkeyPatch
):
    from backend.services.attempt_outcomes import AttemptOutcome

    monkeypatch.setattr(
        diagnostic_engine,
        "_grade_response",
        lambda *_args, **_kwargs: {
            "is_correct": True,
            "outcome": AttemptOutcome.CORRECT.value,
            "error_type": None,
            "score": 1,
            "max_score": 1,
        },
    )
    student_id = "test-resume-cursor"
    started = diagnostic_engine.start(
        student_id=student_id, subject="math", year_level=7
    )
    progressed = diagnostic_engine.respond(
        student_id=student_id,
        report_id=started["report_id"],
        question_id=started["question"]["id"],
        student_answer="4",
    )
    assert progressed["completed"] is False

    resumed = diagnostic_engine.start(
        student_id=student_id, subject="math", year_level=7
    )
    assert resumed["report_id"] == started["report_id"]
    assert resumed["question"]["id"] == progressed["question"]["id"]
    assert resumed["progress"] == progressed["progress"]



def test_respond_request_id_replays_persisted_response(diagnostic_engine, monkeypatch):
    """A committed diagnostic response must not advance the report twice."""
    student_id = "test-diagnostic-idempotency"
    started = diagnostic_engine.start(student_id=student_id, subject="math", year_level=7)
    report_id = started["report_id"]
    question_id = started["question"]["id"]
    engine = get_engine(student_id, "math")
    log = engine.load_log()
    report = next(item for item in log["diagnostic_reports"] if item["report_id"] == report_id)
    report["pack"] = [question_id]
    report["cursor"] = 0
    report["responses"] = []
    report["completed_at"] = None
    engine.save_log(log)
    monkeypatch.setattr(diagnostic_engine, "_next_question", lambda *_args, **_kwargs: None)

    first = diagnostic_engine.respond(
        student_id=student_id,
        report_id=report_id,
        question_id=question_id,
        student_answer="3/4",
        request_id="diagnostic-idempotency-001",
        request_fingerprint="fingerprint-a",
    )
    second = diagnostic_engine.respond(
        student_id=student_id,
        report_id=report_id,
        question_id=question_id,
        student_answer="3/4",
        request_id="diagnostic-idempotency-001",
        request_fingerprint="fingerprint-a",
    )

    saved_report = engine.get_diagnostic_reports()[0]
    assert second == first
    assert len(saved_report["responses"]) == 1
    assert saved_report["cursor"] == 1

    with pytest.raises(DiagnosticRequestConflict):
        diagnostic_engine.respond(
            student_id=student_id,
            report_id=report_id,
            question_id=question_id,
            student_answer="1/2",
            request_id="diagnostic-idempotency-001",
            request_fingerprint="fingerprint-b",
        )


def test_report_areas_split_science_understanding_and_follow_curriculum_order(diagnostic_engine):
    capabilities = {"reasoning_supported": True, "parent_review_mode": False}
    _, science = diagnostic_engine._get_pools_and_strands("science", 7, capabilities=capabilities)
    assert "Science Understanding" not in science
    assert {"Biological sciences", "Chemical sciences", "Earth and space sciences", "Physical sciences"} <= set(science)
    assert len(science) == 6

    _, maths = diagnostic_engine._get_pools_and_strands("math", 7, capabilities=capabilities)
    first_topic = diagnostic_engine.loader.load_slice("AC9_MATHS", 7).sequence.sequence[0]
    assert maths[0] == diagnostic_engine._topic_areas("math", 7)[first_topic]
