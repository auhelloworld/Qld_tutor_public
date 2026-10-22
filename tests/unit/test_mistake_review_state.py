from __future__ import annotations

from contextlib import nullcontext
from types import SimpleNamespace

import pytest

from backend.routers import tutor


class _FakeEngine:
    def __init__(self, log: dict):
        self.log = log
        self._lock = nullcontext()
        self.requested_topics: list[set[str] | None] = []

    def _read_log(self, topics=None) -> dict:
        return self.log

    def _write_log(self, log: dict) -> None:
        self.log = log

    def load_log(self, topics=None) -> dict:
        requested = None if topics is None else {str(topic) for topic in topics}
        self.requested_topics.append(requested)
        if requested is None:
            return self.log
        return {
            **self.log,
            "topics": {
                topic_id: topic_data
                for topic_id, topic_data in self.log.get("topics", {}).items()
                if topic_id in requested
            },
        }


def test_resolve_mistake_review_persists_state(monkeypatch):
    engine = _FakeEngine({"topics": {}})
    monkeypatch.setattr(tutor, "get_engine", lambda *_: engine)

    result = tutor.resolve_mistake_review(
        tutor.MistakeResolveRequest(
            subject="math",
            topic_id="AC9M7N02",
            question_id="math_7_f_AC9M7N02_adae12",
            resolved=True,
            year_level=7,
        ),
        student_id="student",
    )

    key = "math::year7::AC9M7N02::math_7_f_AC9M7N02_adae12"
    assert result["status"] == "resolved"
    assert engine.log["mistake_reviews"][key]["resolved"] is True
    assert engine.log["mistake_reviews"][key]["review_count"] == 1


def test_get_mistakes_reads_resolved_review_state(monkeypatch):
    qid = "math_7_f_AC9M7N02_adae12"
    key = f"math::year7::AC9M7N02::{qid}"
    engine = _FakeEngine({
        "mistake_reviews": {
            key: {"resolved": True, "resolved_at": "2026-01-01T00:00:00+00:00", "review_count": 1}
        },
        "topics": {
            "AC9M7N02": {
                "attempts": [{
                    "attempt_type": "answer",
                    "question_id": qid,
                    "correct": False,
                    "student_answer": "wrong",
                    "error_type": "concept_gap",
                    "timestamp": "2026-01-01T00:00:00+00:00",
                }]
            }
        },
    })
    fake_tutor = SimpleNamespace(exercises={
        qid: {
            "id": qid,
            "question": "Simplify 18/24.",
            "answer": "3/4",
            "question_type": "short_answer",
        }
    })
    monkeypatch.setattr(tutor, "get_engine", lambda *_: engine)
    monkeypatch.setattr(tutor, "get_tutor_engine", lambda: fake_tutor)
    with tutor._MISTAKES_CACHE_LOCK:
        tutor._MISTAKES_CACHE.clear()

    result = tutor.get_mistakes(subject="math", year_level=7, student_id="student")

    assert engine.requested_topics[0] is not None
    assert "AC9M7N02" in engine.requested_topics[0]
    assert all(not topic.startswith("AC9M8") for topic in engine.requested_topics[0])
    assert result["mistakes"][0]["status"] == "resolved"
    assert result["mistakes"][0]["resolved"] is True
    assert result["mistakes"][0]["review_count"] == 1


def test_get_mistakes_marks_older_error_fixed_by_later_correct(monkeypatch):
    qid = "math_7_f_AC9M7N02_fixed"
    engine = _FakeEngine({
        "topics": {
            "AC9M7N02": {
                "attempts": [
                    {
                        "attempt_type": "answer",
                        "question_id": qid,
                        "correct": False,
                        "student_answer": "12",
                        "error_type": "concept_gap",
                        "timestamp": "2026-01-01T00:00:00+00:00",
                    },
                    {
                        "attempt_type": "answer",
                        "question_id": qid,
                        "correct": True,
                        "student_answer": "6",
                        "error_type": None,
                        "timestamp": "2026-01-02T00:00:00+00:00",
                    },
                ]
            }
        },
    })
    fake_tutor = SimpleNamespace(exercises={
        qid: {
            "id": qid,
            "question": "Find the HCF of 18 and 24.",
            "answer": "6",
            "question_type": "short_answer",
        }
    })
    monkeypatch.setattr(tutor, "get_engine", lambda *_: engine)
    monkeypatch.setattr(tutor, "get_tutor_engine", lambda: fake_tutor)
    with tutor._MISTAKES_CACHE_LOCK:
        tutor._MISTAKES_CACHE.clear()

    result = tutor.get_mistakes(subject="math", year_level=7, student_id="student")

    assert len(result["mistakes"]) == 1
    mistake = result["mistakes"][0]
    assert mistake["status"] == "active"
    assert mistake["resolved"] is False
    assert mistake["closure_stage"] == "needs_transfer"
    assert mistake["student_answer"] == "12"
    assert mistake["last_correct_after_error_at"] == "2026-01-02T00:00:00+00:00"


def test_get_mistakes_lists_the_worked_steps_of_the_question(monkeypatch):
    """The cause step shows how to get the right answer, next to the student's answer."""
    qid = "math_7_f_AC9M7N02_steps"
    engine = _FakeEngine({
        "topics": {
            "AC9M7N02": {
                "attempts": [{
                    "attempt_type": "answer", "question_id": qid, "correct": False,
                    "student_answer": "12", "error_type": "concept_gap",
                    "timestamp": "2026-01-01T00:00:00+00:00",
                }]
            }
        },
    })
    fake_tutor = SimpleNamespace(exercises={
        qid: {
            "id": qid, "question": "Find the HCF of 18 and 24.", "answer": "6",
            "question_type": "short_answer", "steps": ["List the factors of 18 and 24.", "", "The highest common factor is 6."],
        }
    })
    monkeypatch.setattr(tutor, "get_engine", lambda *_: engine)
    monkeypatch.setattr(tutor, "get_tutor_engine", lambda: fake_tutor)
    with tutor._MISTAKES_CACHE_LOCK:
        tutor._MISTAKES_CACHE.clear()

    result = tutor.get_mistakes(subject="math", year_level=7, student_id="student")

    assert result["mistakes"][0]["solution_steps"] == [
        "List the factors of 18 and 24.",
        "The highest common factor is 6.",
    ]

def test_get_mistakes_excludes_pending_only_work(monkeypatch):
    qid = "math_7_f_AC9M7N02_pending"
    engine = _FakeEngine({
        "topics": {
            "AC9M7N02": {
                "attempts": [{
                    "attempt_type": "answer",
                    "question_id": qid,
                    "correct": False,
                    "outcome": "pending",
                    "student_answer": "needs review",
                    "error_type": "parent_review_pending",
                    "timestamp": "2026-01-01T00:00:00+00:00",
                }]
            }
        },
    })
    monkeypatch.setattr(tutor, "get_engine", lambda *_: engine)
    monkeypatch.setattr(tutor, "get_tutor_engine", lambda: SimpleNamespace(exercises={
        qid: {
            "id": qid,
            "question": "Explain your method.",
            "answer": "A valid explanation.",
            "question_type": "short_answer",
        }
    }))
    with tutor._MISTAKES_CACHE_LOCK:
        tutor._MISTAKES_CACHE.clear()

    result = tutor.get_mistakes(subject="math", year_level=7, student_id="student")

    assert result["mistakes"] == []
    assert result["total"] == 0


def test_get_mistakes_counts_cross_tagged_physical_attempt_once(monkeypatch):
    qid = "math_7_cross_tagged_wrong"
    primary = {
        "attempt_type": "answer",
        "question_id": qid,
        "correct": False,
        "student_answer": "12",
        "error_type": "incorrect_value",
        "timestamp": "2026-01-01T00:00:00.100000+00:00",
        "weight": 1.0,
    }
    secondary = {**primary, "timestamp": "2026-01-01T00:00:00.200000+00:00", "weight": 0.3}
    engine = _FakeEngine({
        "topics": {
            "AC9M7N02": {"attempts": [primary]},
            "AC9M7N03": {"attempts": [secondary]},
        }
    })
    monkeypatch.setattr(tutor, "get_engine", lambda *_: engine)
    monkeypatch.setattr(tutor, "get_tutor_engine", lambda: SimpleNamespace(exercises={
        qid: {
            "id": qid,
            "question": "Find the value.",
            "answer": "6",
            "question_type": "short_answer",
        }
    }))
    with tutor._MISTAKES_CACHE_LOCK:
        tutor._MISTAKES_CACHE.clear()

    result = tutor.get_mistakes(subject="math", year_level=7, student_id="student")

    assert result["total"] == 1
    assert result["mistakes"][0]["attempt_count"] == 1


def test_error_taxonomy_endpoint_is_subject_specific():
    english = tutor.get_error_taxonomy(subject="english")
    science = tutor.get_error_taxonomy(subject="science")

    english_codes = {entry["code"] for entry in english["error_types"]}
    science_codes = {entry["code"] for entry in science["error_types"]}

    assert "weak_text_evidence" in english_codes
    assert "claim_evidence_reasoning_gap" in science_codes
    assert all(entry["label"] for entry in english["error_types"])


def test_get_study_plans_returns_topic_keyed_map(monkeypatch):
    class FakePlanEngine:
        def get_study_plan(self, topic: str) -> dict:
            return {"action": "assessment", "message": f"Review {topic}"}

    monkeypatch.setattr(tutor, "get_engine", lambda *_: FakePlanEngine())

    result = tutor.get_study_plans(
        tutor.StudyPlansRequest(subject="math", topics=["AC9M7N02", "AC9M7N02", "AC9M7N03"]),
        student_id="student",
    )

    assert list(result["plans"].keys()) == ["AC9M7N02", "AC9M7N03"]
    assert result["plans"]["AC9M7N02"]["topic"] == "AC9M7N02"


def test_mistake_review_key_inference():
    # Test AC9 Maths
    key_ac9 = tutor._mistake_review_key("math", "AC9M7N02", "q1")
    assert key_ac9 == "math::year7::AC9M7N02::q1"

    # Test QCAA Senior Methods
    key_qcaa = tutor._mistake_review_key("methods", "QCAA_METHODS_U1_T1", "q2")
    assert key_qcaa == "methods::methods::unit1::QCAA_METHODS_U1_T1::q2"

    # Test garbage/fallback
    key_garbage = tutor._mistake_review_key("math", "GARBAGE", "q3")
    assert key_garbage == "math::all::GARBAGE::q3"


def test_get_trap_notebook_excludes_resolved(monkeypatch):
    qid = "math_7_f_AC9M7N02_adae12"
    engine = _FakeEngine({
        "topics": {
            "AC9M7N02": {
                "attempts": [
                    {
                        "attempt_type": "answer",
                        "question_id": qid,
                        "correct": False,
                        "student_answer": "wrong",
                        "timestamp": "2026-01-01T00:00:00+00:00",
                    },
                    {
                        "attempt_type": "answer",
                        "question_id": qid,
                        "correct": True,
                        "student_answer": "3/4",
                        "timestamp": "2026-01-02T00:00:00+00:00",
                    }
                ]
            }
        },
    })
    fake_tutor = SimpleNamespace(
        exercises={
            qid: {
                "id": qid,
                "question": "Simplify 18/24.",
                "answer": "3/4",
                "question_type": "short_answer",
            }
        },
        get_concept_card_dict=lambda *_: {"core_rule": "Always reduce fractions to simplest form."}
    )
    monkeypatch.setattr(tutor, "get_engine", lambda *_: engine)
    monkeypatch.setattr(tutor, "get_tutor_engine", lambda: fake_tutor)

    result = tutor.get_trap_notebook(subject="math", year_level=7, student_id="student")
    # Should exclude it because the most recent attempt is correct
    assert result["total"] == 0
    assert len(result["entries"]) == 0


def test_resolve_mistake_review_is_idempotent(monkeypatch):
    engine = _FakeEngine({"topics": {}})
    monkeypatch.setattr(tutor, "get_engine", lambda *_: engine)
    request = tutor.MistakeResolveRequest(
        subject="math",
        topic_id="AC9M7N02",
        question_id="math_7_f_AC9M7N02_adae12",
        resolved=True,
        resolution_source="manual_dismissal",
        year_level=7,
    )

    first = tutor.resolve_mistake_review(request, student_id="student")
    first_resolved_at = next(iter(engine.log["mistake_reviews"].values()))["resolved_at"]
    second = tutor.resolve_mistake_review(request, student_id="student")
    second_resolved_at = next(iter(engine.log["mistake_reviews"].values()))["resolved_at"]

    assert first["review_count"] == 1
    assert second["review_count"] == 1
    assert second_resolved_at == first_resolved_at


def test_resolve_mistake_review_repairs_derived_state_after_write_gap(monkeypatch):
    class _RepairingEngine(_FakeEngine):
        def __init__(self):
            super().__init__({"topics": {}})
            self.fail_next_closure_update = True
            self.closure_updates: list[dict] = []

        def set_mistake_closure_state(self, question_id: str, **values) -> None:
            if self.fail_next_closure_update:
                self.fail_next_closure_update = False
                raise RuntimeError("simulated derived state failure")
            self.closure_updates.append({"question_id": question_id, **values})

    engine = _RepairingEngine()
    monkeypatch.setattr(tutor, "get_engine", lambda *_: engine)
    monkeypatch.setattr(tutor, "replay_lookup", lambda *args: None)
    monkeypatch.setattr(tutor, "replay_store", lambda *args: None)
    request = tutor.MistakeResolveRequest(
        request_id="resolve-idempotency-001",
        subject="math",
        topic_id="AC9M7N02",
        question_id="math_7_f_AC9M7N02_adae12",
        resolved=True,
        resolution_source="manual_dismissal",
        year_level=7,
    )

    with pytest.raises(RuntimeError, match="simulated derived state failure"):
        tutor.resolve_mistake_review(request, student_id="student")

    review = next(iter(engine.log["mistake_reviews"].values()))
    assert review["review_count"] == 1
    assert review["resolved_at"] is not None

    second = tutor.resolve_mistake_review(request, student_id="student")

    assert second["review_count"] == 1
    assert second["resolved"] is True
    assert len(engine.log["mistake_reviews"]) == 1
    assert engine.closure_updates == [{
        "question_id": request.question_id,
        "closure_stage": review["closure_stage"],
        "resolved": review["resolved"],
        "resolved_at": review["resolved_at"],
        "review_count": review["review_count"],
        "resolution_source": review["resolution_source"],
        "transfer_correct_at": review["transfer_correct_at"],
        "consolidation_due_at": review["consolidation_due_at"],
        "closed_at": review["closed_at"],
    }]


def test_large_mistakes_result_is_not_kept_in_process_cache(monkeypatch):
    qid = "math_7_uncached_large_result"
    engine = _FakeEngine({
        "topics": {
            "AC9M7N02": {
                "attempts": [{
                    "attempt_type": "answer",
                    "question_id": qid,
                    "correct": False,
                    "student_answer": "wrong",
                    "error_type": "concept_gap",
                    "timestamp": "2026-01-01T00:00:00+00:00",
                }]
            }
        }
    })
    monkeypatch.setattr(tutor, "get_engine", lambda *_: engine)
    monkeypatch.setattr(tutor, "get_tutor_engine", lambda: SimpleNamespace(exercises={
        qid: {
            "id": qid,
            "question": "Find the value.",
            "answer": "6",
            "question_type": "short_answer",
        }
    }))
    monkeypatch.setattr(tutor, "MISTAKES_CACHE_MAX_ITEMS_PER_ENTRY", 0)
    with tutor._MISTAKES_CACHE_LOCK:
        tutor._MISTAKES_CACHE.clear()

    result = tutor.get_mistakes(subject="math", year_level=7, student_id="student")

    assert result["total"] == 1
    with tutor._MISTAKES_CACHE_LOCK:
        assert not tutor._MISTAKES_CACHE
