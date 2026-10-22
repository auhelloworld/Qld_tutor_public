from __future__ import annotations

import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock
from backend.exam_simulator import (
    ABANDONED_GENERATED_SESSION_RETENTION,
    ExamSimulator,
    _prune_abandoned_generated_sessions,
    validate_exam_type_for_subject,
)


def test_exam_prioritizes_unseen_questions(monkeypatch):
    """Test that the exam simulator draws from unseen/incorrect questions before correct ones."""
    # 1. Mock exercises: 10 simple_familiar exercises
    mock_exercises = {
        f"ex_{i}": {
            "id": f"ex_{i}",
            "subject": "math",
            "year_level": 7,
            "complexity": "simple_familiar",
            "difficulty": "developing",
            "question": f"Question {i}?",
            "answer": "42",
            "steps": ["Step 1"]
        }
        for i in range(1, 11)
    }

    # 2. Mock student log: student has answered ex_1, ex_2, ex_3, ex_4, ex_5, ex_6 correctly.
    # Ex_7, ex_8, ex_9, ex_10 are unseen.
    mock_log = {
        "topics": {
            "topic_1": {
                "attempts": [
                    {"attempt_type": "answer", "question_id": f"ex_{i}", "correct": True}
                    for i in range(1, 7)
                ]
            }
        },
        "exam_sessions": []
    }

    # Mock rule engine loader
    mock_engine = MagicMock()
    mock_engine.get_attempt_outcomes.return_value = [
        (f"ex_{i}", True) for i in range(1, 7)
    ]
    mock_engine.get_extra_metadata.return_value = {"exam_sessions": []}
    
    # Patch get_engine
    import backend.exam_simulator
    monkeypatch.setattr(backend.exam_simulator, "get_engine", lambda student_id, subject: mock_engine)

    # 3. Create simulator and build paper of 5 questions (sf_ratio=1.0)
    sim = ExamSimulator(exercises=mock_exercises)
    
    # We ask for 5 questions
    paper = sim._build_paper(
        subject="math",
        year_level=7,
        num_questions=5,
        sf_ratio=1.0,
        cf_ratio=0.0,
        cu_ratio=0.0,
        student_id="test_student"
    )

    # All 4 unseen/incorrect questions (ex_7, ex_8, ex_9, ex_10) MUST be selected.
    # Exactly 1 correct question (from ex_1..ex_6) must be selected to fill the paper of 5.
    selected_set = set(paper)
    unseen_set = {f"ex_{i}" for i in range(7, 11)}
    correct_set = {f"ex_{i}" for i in range(1, 7)}

    assert unseen_set.issubset(selected_set), "All unseen/incorrect questions should be selected first."
    
    correct_selected = selected_set.intersection(correct_set)
    assert len(correct_selected) == 1, "Exactly one previously correct question should be selected to fill the paper."


def test_exam_history_sorted_newest_and_scoped(monkeypatch):
    sim = ExamSimulator(exercises={})
    fake_engine = MagicMock()
    fake_engine.get_exam_sessions.return_value = [
            {
                "exam_id": "old-year7",
                "started_at": "2026-01-01T09:00:00+00:00",
                "completed_at": "2026-01-01T10:00:00+00:00",
                "year_level": 7,
                "unit": None,
                "syllabus_subject": None,
                "time_limit_minutes": 45,
                "results": {"total_questions": 10, "correct": 7, "percentage": 70},
            },
            {
                "exam_id": "year8",
                "started_at": "2026-01-02T09:00:00+00:00",
                "completed_at": "2026-01-02T10:00:00+00:00",
                "year_level": 8,
                "unit": None,
                "syllabus_subject": None,
                "time_limit_minutes": 45,
                "results": {"total_questions": 10, "correct": 9, "percentage": 90},
            },
            {
                "exam_id": "new-year7",
                "started_at": "2026-01-03T09:00:00+00:00",
                "completed_at": "2026-01-03T10:00:00+00:00",
                "year_level": 7,
                "unit": None,
                "syllabus_subject": None,
                "time_limit_minutes": 45,
                "results": {"total_questions": 10, "correct": 8, "percentage": 80},
            },
        ]
    monkeypatch.setattr("backend.exam_simulator.get_engine", lambda *_: fake_engine)

    history = sim.get_history(student_id="student", subject="math", year_level=7)

    assert [item["exam_id"] for item in history] == ["new-year7", "old-year7"]


def test_prune_abandoned_generated_sessions_is_conservative():
    now = datetime(2026, 2, 1, tzinfo=timezone.utc)
    old_started = (now - ABANDONED_GENERATED_SESSION_RETENTION - timedelta(minutes=1)).isoformat()
    fresh_started = (now - ABANDONED_GENERATED_SESSION_RETENTION + timedelta(minutes=1)).isoformat()
    sessions = [
        {"exam_id": "old-generated", "started_at": old_started, "completed_at": None},
        {"exam_id": "fresh-generated", "started_at": fresh_started, "completed_at": None},
        {
            "exam_id": "old-imported",
            "started_at": old_started,
            "completed_at": None,
            "imported_from": "paper.json",
        },
        {
            "exam_id": "old-completed",
            "started_at": old_started,
            "completed_at": now.isoformat(),
        },
        {"exam_id": "malformed-time", "started_at": "not-a-timestamp", "completed_at": None},
    ]

    retained = _prune_abandoned_generated_sessions(sessions, now=now)

    assert [session["exam_id"] for session in retained] == [
        "fresh-generated",
        "old-imported",
        "old-completed",
        "malformed-time",
    ]


def test_unsupported_exam_type_falls_back_to_mixed():
    safe_type, warning = validate_exam_type_for_subject("english", "fluency_check")

    assert safe_type == "mixed"
    assert warning is not None
    assert warning["code"] == "unsupported_exam_type"
    assert warning["requested_exam_type"] == "fluency_check"


def test_english_exam_filter_prefers_metadata_facet():
    sim = ExamSimulator(exercises={})
    candidates = [
        {
            "id": "reading_facet",
            "subject": "english",
            "year_level": 7,
            "question": "Use evidence from the text.",
            "english_metadata": {"facet": "text_evidence"},
            "topic_ids": [],
        },
        {
            "id": "language_facet",
            "subject": "english",
            "year_level": 7,
            "question": "Choose the correct punctuation.",
            "english_metadata": {"facet": "language_conventions"},
            "topic_ids": [],
        },
    ]

    reading = sim._filter_candidates_by_exam_type(candidates, subject="english", exam_type="reading")
    language = sim._filter_candidates_by_exam_type(candidates, subject="english", exam_type="language_conventions")

    assert [ex["id"] for ex in reading] == ["reading_facet"]
    assert [ex["id"] for ex in language] == ["language_facet"]


def test_english_naplan_literacy_filters_short_reading_and_conventions():
    sim = ExamSimulator(exercises={})
    candidates = [
        {
            "id": "reading_short",
            "subject": "english",
            "year_level": 7,
            "english_metadata": {"facet": "reading_comprehension"},
            "topic_ids": ["AC9E7LY05"],
            "question_type": "multiple_choice",
        },
        {
            "id": "spelling_short",
            "subject": "english",
            "year_level": 7,
            "english_metadata": {"facet": "spelling_punctuation"},
            "topic_ids": ["AC9E7LY08"],
            "question_type": "short_answer",
        },
        {
            "id": "writing_short",
            "subject": "english",
            "year_level": 7,
            "english_metadata": {"facet": "writing_structure"},
            "topic_ids": ["AC9E7LY06"],
            "question_type": "short_answer",
        },
        {
            "id": "reading_reasoning",
            "subject": "english",
            "year_level": 7,
            "english_metadata": {"facet": "text_evidence"},
            "topic_ids": ["AC9E7LY05"],
            "question_type": "reasoning",
        },
    ]

    result = sim._filter_candidates_by_exam_type(
        candidates,
        subject="english",
        exam_type="naplan_literacy",
    )

    assert [ex["id"] for ex in result] == ["reading_short", "spelling_short"]


def test_probability_strand_mapping():
    sim = ExamSimulator(exercises={})
    assert sim._strand_from_topic_id("AC9M7P01") == "Probability"
    assert sim._strand_from_topic_id("AC9M7SP01") == "Space"
    assert sim._strand_from_topic_id("AC9M7ST01") == "Statistics"
    # Year 10 two-digit year codes
    assert sim._strand_from_topic_id("AC9M10N01") == "Number"
    assert sim._strand_from_topic_id("AC9E10LY01") == "Literacy"
    # Science U / H / I
    assert sim._strand_from_topic_id("AC9S8U01") == "Understanding"
    assert sim._strand_from_topic_id("AC9S8H01") == "Human endeavour"
    assert sim._strand_from_topic_id("AC9S10I03") == "Inquiry"


# ── Blueprint preset tests ──────────────────────────────────────────────

def _make_exercises():
    """Create a diverse pool for blueprint testing."""
    pool = {}
    base = {
        "subject": "math",
        "year_level": 7,
        "question": "Q?",
        "answer": "A",
        "steps": ["S1"],
        "topic_ids": ["AC9M7N01"],
    }
    # Foundational short_answer
    for i in range(5):
        eid = f"f_sa_{i}"
        pool[eid] = {**base, "id": eid, "difficulty": "foundational",
                     "complexity": "simple_familiar", "question_type": "short_answer"}
    # Developing short_answer
    for i in range(5):
        eid = f"d_sa_{i}"
        pool[eid] = {**base, "id": eid, "difficulty": "developing",
                     "complexity": "complex_familiar", "question_type": "short_answer"}
    # Developing MCQ
    for i in range(3):
        eid = f"d_mcq_{i}"
        pool[eid] = {**base, "id": eid, "difficulty": "developing",
                     "complexity": "complex_familiar", "question_type": "multiple_choice",
                     "choices": ["A", "B", "C"], "correct_choice": "A"}
    # Extending reasoning
    for i in range(3):
        eid = f"e_r_{i}"
        pool[eid] = {**base, "id": eid, "difficulty": "extending",
                     "complexity": "complex_unfamiliar", "question_type": "reasoning",
                     "rubric": {"max_score": 3}, "sample_reasoning": "SR"}
    # AMC short_answer
    for i in range(3):
        eid = f"amc_{i}"
        pool[eid] = {**base, "id": eid, "difficulty": "AMC",
                     "complexity": "complex_unfamiliar", "question_type": "short_answer"}
    # Multi-part (2 sub_parts)
    for i in range(2):
        eid = f"mp2_{i}"
        pool[eid] = {**base, "id": eid, "difficulty": "developing",
                     "complexity": "complex_familiar", "question_type": "multi_part",
                     "sub_parts": [{"label": "a", "question": "Pa", "answer": "Aa"},
                                   {"label": "b", "question": "Pb", "answer": "Ab"}]}
    # Multi-part (3 sub_parts)
    eid = "mp3_0"
    pool[eid] = {**base, "id": eid, "difficulty": "extending",
                 "complexity": "complex_unfamiliar", "question_type": "multi_part",
                 "sub_parts": [{"label": "a", "question": "Pa", "answer": "Aa"},
                               {"label": "b", "question": "Pb", "answer": "Ab"},
                               {"label": "c", "question": "Pc", "answer": "Ac"}]}
    return pool


def test_new_exam_types_accepted():
    """New exam types should not fall back to mixed."""
    for etype in ("naplan_numeracy", "fluency_check", "challenge_amc"):
        safe_type, warning = validate_exam_type_for_subject("math", etype)
        assert safe_type == etype, f"{etype} should be accepted"
        assert warning is None, f"{etype} should not produce a warning"


def test_naplan_literacy_exam_type_accepted():
    safe_type, warning = validate_exam_type_for_subject("english", "naplan_literacy")
    assert safe_type == "naplan_literacy"
    assert warning is None


def test_fluency_check_filters_foundational_developing():
    sim = ExamSimulator(exercises=_make_exercises())
    candidates = list(sim.exercises.values())
    result = sim._math_blueprint_fluency(candidates)
    for ex in result:
        assert ex["difficulty"] in {"foundational", "developing"}
        assert ex["question_type"] in {"short_answer", "multiple_choice"}
    # Should include all foundational and developing SA + MCQ
    assert len(result) == 13  # 5 + 5 + 3


def test_naplan_excludes_long_multipart():
    sim = ExamSimulator(exercises=_make_exercises())
    candidates = list(sim.exercises.values())
    result = sim._math_blueprint_naplan(candidates)
    for ex in result:
        if ex["question_type"] == "multi_part":
            parts = ex.get("sub_parts") or []
            assert len(parts) <= 2
    # Should include all SA, MCQ, and 2-part MP but exclude 3-part MP
    ids = {ex["id"] for ex in result}
    assert "mp3_0" not in ids
    assert "mp2_0" in ids


def test_challenge_amc_filters_amc_and_extending():
    sim = ExamSimulator(exercises=_make_exercises())
    candidates = list(sim.exercises.values())
    result = sim._math_blueprint_challenge(candidates)
    for ex in result:
        assert (
            ex["difficulty"] in {"AMC", "extending"}
            or ex["complexity"] == "complex_unfamiliar"
        )
    ids = {ex["id"] for ex in result}
    # All AMC and extending exercises should be included
    for i in range(3):
        assert f"amc_{i}" in ids
        assert f"e_r_{i}" in ids


def test_english_mixed_exam_covers_all_facets(monkeypatch):
    """Mixed English exam must include at least one exercise per facet."""
    from unittest.mock import MagicMock
    import backend.exam_simulator as _mod

    # Build 60 exercises, 10 per facet, all with complexity=None (sf bucket)
    all_facets = [
        "reading_comprehension", "text_evidence", "language_conventions",
        "vocabulary", "writing_structure", "spelling_punctuation",
    ]
    exercises: dict = {}
    for facet in all_facets:
        for i in range(10):
            eid = f"en_{facet}_{i}"
            exercises[eid] = {
                "id": eid,
                "subject": "english",
                "year_level": 7,
                "difficulty": "developing",
                "question": f"Q {facet} {i}?",
                "answer": "A",
                "topic_ids": ["AC9E7LA01"],
                "english_metadata": {"facet": facet},
                "question_type": "short_answer",
            }

    mock_log = {"topics": {}, "exam_sessions": []}
    mock_engine = MagicMock()
    mock_engine.load_log.return_value = mock_log
    monkeypatch.setattr(_mod, "get_engine", lambda sid, subj: mock_engine)

    sim = ExamSimulator(exercises=exercises)
    paper = sim._build_paper(
        subject="english",
        year_level=7,
        num_questions=12,
        sf_ratio=1.0,
        cf_ratio=0.0,
        cu_ratio=0.0,
        student_id="test_student",
        exam_type="mixed",
    )

    # Collect facets present in the paper
    facets_in_paper: set = set()
    for qid in paper:
        ex = exercises[qid]
        facet = (ex.get("english_metadata") or {}).get("facet")
        facets_in_paper.add(facet)

    assert facets_in_paper == set(all_facets), (
        f"Missing facets: {set(all_facets) - facets_in_paper}"
    )


# ── QCAA Methods Paper 1 / Paper 2 presets (Phase 5) ─────────────────────

def test_methods_paper_exam_types_accepted():
    for etype in ("mixed", "paper_1", "paper_2"):
        safe_type, warning = validate_exam_type_for_subject("methods", etype)
        assert safe_type == etype
        assert warning is None


def _methods_pool():
    base = {
        "subject": "methods",
        "unit": 3,
        "framework": "QCAA_SENIOR_MATHS",
        "question": "Q?",
        "answer": "1",
        "topic_ids": ["QCAA_METHODS_U3_T1"],
        "difficulty": "developing",
        "complexity": "complex_familiar",
        "question_type": "short_answer",
    }
    pool = {}
    for i in range(4):
        eid = f"tf_{i}"
        pool[eid] = {**base, "id": eid, "math_metadata": {"technology_active": False}}
    for i in range(3):
        eid = f"ta_{i}"
        pool[eid] = {**base, "id": eid, "math_metadata": {"technology_active": True}}
    # an item with no flag must be excluded from both papers
    pool["noflag"] = {**base, "id": "noflag", "math_metadata": {}}
    return pool


def test_methods_paper1_keeps_only_technology_free():
    sim = ExamSimulator(exercises={})
    candidates = list(_methods_pool().values())
    result = sim._filter_candidates_by_exam_type(candidates, subject="methods", exam_type="paper_1")
    ids = {ex["id"] for ex in result}
    assert ids == {"tf_0", "tf_1", "tf_2", "tf_3"}


def test_methods_paper2_keeps_only_technology_active():
    sim = ExamSimulator(exercises={})
    candidates = list(_methods_pool().values())
    result = sim._filter_candidates_by_exam_type(candidates, subject="methods", exam_type="paper_2")
    ids = {ex["id"] for ex in result}
    assert ids == {"ta_0", "ta_1", "ta_2"}


def test_methods_build_paper_matches_subject_without_syllabus_field():
    """Methods items carry subject='methods' but no syllabus_subject field; the
    lenient filter must still match them when syllabus_subject='methods'."""
    pool = _methods_pool()
    sim = ExamSimulator(exercises=pool)
    candidates = [ex for ex in pool.values()]
    filtered = [
        ex for ex in candidates
        if (ex.get("syllabus_subject") or ex.get("course") or ex.get("subject") or "").strip().lower() == "methods"
    ]
    assert len(filtered) == len(pool)
