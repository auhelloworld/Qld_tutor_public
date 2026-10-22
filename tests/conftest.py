"""Shared test fixtures and Hypothesis profile configuration.

This conftest is loaded automatically by pytest for all tests under tests/.
"""
from __future__ import annotations

import json
import os
import shutil
import socket
from pathlib import Path
import sympy  # Pre-import to avoid import latency timeouts during tests

# Pin every deployment-sensitive setting before any backend import. Empty
# strings intentionally shadow values from the repository .env because
# python-dotenv loads with override=False.
os.environ.update({
    "API_KEY": "",
    "LLM_API_KEY": "",
    "LLM_BASE_URL": "",
    "LLM_MODEL": "",
    "GEMINI_API_KEY": "",
    "OPENAI_API_KEY": "",
    "CORS_ORIGINS": "http://localhost:3000",
    "JWT_SECRET": "test-jwt-secret-not-for-production",
    "PARENT_PASSWORD": "test-parent-password",
})

import pytest
from freezegun import freeze_time
from hypothesis import HealthCheck, settings

# ---------------------------------------------------------------------------
# 4.1 — Hypothesis profiles
# ---------------------------------------------------------------------------

# Several property tests do real filesystem I/O (migrations, per-student log
# writes), which legitimately exceeds Hypothesis's default 200ms per-example
# deadline on slower/Windows machines. Disable the deadline for dev/ci (nightly
# already does) so these tests are timing-robust rather than flaky.
settings.register_profile("dev", max_examples=50, deadline=None)
settings.register_profile("ci", max_examples=200, derandomize=True, deadline=None)
settings.register_profile(
    "nightly",
    max_examples=1000,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow],
)
settings.load_profile("dev")


_CONTENT_AUDIT_FILES = frozenset({
    "test_math_bank_full_audit.py",
    "test_science_bank_full_audit.py",
    "test_english_bank_full_audit.py",
    "test_senior_math_bank_full_audit.py",
    "test_math_bank_quality.py",
    "test_science_bank_quality.py",
    "test_english_bank_quality.py",
    "test_methods_bank_quality.py",
    "test_specialist_bank_quality.py",
    "test_math_auditor_regressions.py",
    "test_english_metadata_gate.py",
    "test_latex_syntax.py",
    "test_misconception_subject_coverage.py",
    "test_validate_ac9_maths_coverage.py",
})
_FULL_DATA_FILES = frozenset({
    "test_diagnostic_engine.py",
    "test_diagnostic_pack_builder.py",
    "test_phase1_invariants.py",
})


def pytest_collection_modifyitems(items):
    """Apply stable test tiers without thousands of repetitive decorators."""
    for item in items:
        path = Path(str(item.path))
        parts = set(path.parts)
        if "integration" in parts:
            item.add_marker(pytest.mark.integration)
        elif "property" in parts:
            item.add_marker(pytest.mark.property)
        else:
            item.add_marker(pytest.mark.unit)

        is_content_audit = (
            path.name in _CONTENT_AUDIT_FILES
            or (
                path.name == "test_question_types.py"
                and "TestExerciseDataIntegrity" in item.nodeid
            )
            or (
                path.name == "test_api_endpoints.py"
                and "test_get_exercises_no_topic_returns_full_list" in item.nodeid
            )
        )
        if is_content_audit:
            item.add_marker(pytest.mark.content_audit)
        if path.name in _FULL_DATA_FILES:
            item.add_marker(pytest.mark.full_data)

        if not any(
            item.get_closest_marker(name)
            for name in ("integration", "property", "content_audit", "slow")
        ):
            item.add_marker(pytest.mark.fast)


# ---------------------------------------------------------------------------
# 4.2 — tmp_data_dir fixture
# ---------------------------------------------------------------------------



# ---------------------------------------------------------------------------
# Global runtime-data isolation
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session", autouse=True)
def _shared_exercise_bank_loader():
    """Parse authored exercises once, then install isolated shallow snapshots.

    Tests add or replace top-level exercise records but do not mutate nested
    objects in existing authored records. Each engine therefore receives its
    own outer exercise dict and index lists while safely sharing immutable
    nested authored content.
    """
    import backend.tutor_engine as tutor_module

    engine_type = tutor_module.TutorEngine
    original_loader = engine_type._load_exercises_from_disk
    seed = tutor_module._tutor_engine or engine_type()
    snapshot_exercises = {
        question_id: dict(exercise)
        for question_id, exercise in seed.exercises.items()
    }
    snapshot_subject_year = {
        key: tuple(str(exercise.get("id")) for exercise in exercises)
        for key, exercises in seed._exercises_by_subject_year.items()
    }
    snapshot_topics = {
        key: tuple(str(exercise.get("id")) for exercise in exercises)
        for key, exercises in seed._exercises_by_topic.items()
    }
    snapshot_availability = {
        "by_subject": dict(seed._content_availability["by_subject"]),
        "by_year": {
            subject: dict(counts)
            for subject, counts in seed._content_availability["by_year"].items()
        },
        "by_unit": {
            subject: dict(counts)
            for subject, counts in seed._content_availability["by_unit"].items()
        },
    }

    def install_snapshot(self):
        exercises = {
            question_id: dict(exercise)
            for question_id, exercise in snapshot_exercises.items()
        }
        self.exercises = exercises
        self._exercises_by_subject_year = {
            key: [exercises[question_id] for question_id in question_ids]
            for key, question_ids in snapshot_subject_year.items()
        }
        self._exercises_by_topic = {
            key: [exercises[question_id] for question_id in question_ids]
            for key, question_ids in snapshot_topics.items()
        }
        self._content_availability = {
            "by_subject": dict(snapshot_availability["by_subject"]),
            "by_year": {
                subject: dict(counts)
                for subject, counts in snapshot_availability["by_year"].items()
            },
            "by_unit": {
                subject: dict(counts)
                for subject, counts in snapshot_availability["by_unit"].items()
            },
        }
        return {
            "exercise_count": len(exercises),
            "subject_year_buckets": len(self._exercises_by_subject_year),
            "topic_buckets": len(self._exercises_by_topic),
        }

    engine_type._load_exercises_from_disk = install_snapshot
    try:
        yield
    finally:
        engine_type._load_exercises_from_disk = original_loader


@pytest.fixture(autouse=True)
def _isolate_runtime_storage(tmp_path, monkeypatch):
    """Keep every test away from the host's production SQLite and log files.

    ``runtime_db_path()`` resolves the database from the live ``LOG_ROOT`` value,
    so redirecting it before each test and clearing the engine/schema caches gives
    every test a fresh database. Tests that request ``tmp_data_dir`` may safely
    override this path later for their copied content tree.
    """
    from backend import rules
    from backend._testing import reset_engine_factory_cache
    from backend.routers import auth, writing

    runtime_data = tmp_path / "runtime-data"
    log_root = runtime_data / "logs"
    log_root.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(rules, "LOG_ROOT", log_root)
    monkeypatch.setattr(writing, "_LOG_ROOT", log_root)
    monkeypatch.setattr(auth, "CREDENTIALS_PATH", runtime_data / "credentials.json")
    reset_engine_factory_cache()
    try:
        yield
    finally:
        reset_engine_factory_cache()

@pytest.fixture
def tmp_data_dir(tmp_path, monkeypatch, request):
    """Return isolated runtime data; copy authored banks only when marked."""
    src = Path(__file__).resolve().parents[1] / "data"
    dst = tmp_path / "data"
    if request.node.get_closest_marker("full_data"):
        shutil.copytree(
            src,
            dst,
            ignore=shutil.ignore_patterns(
                "*.db",
                "*.db-wal",
                "*.db-shm",
                "*.bak",
                "credentials.json",
                "*.py",
                "sources",
                "logs",
                "scratch",
            ),
        )
    else:
        dst.mkdir(parents=True, exist_ok=True)

    for directory in ("logs", "scratch", "exams"):
        (dst / directory).mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr("backend.rules.LOG_ROOT", dst / "logs")
    from backend._testing import reset_engine_factory_cache
    from backend.routers import auth as auth_router

    # Never copy/read the installation credential file in tests. Tests that
    # need registered users can create them in this per-test path.
    monkeypatch.setattr(auth_router, "CREDENTIALS_PATH", dst / "credentials.json")

    reset_engine_factory_cache()
    yield dst
    reset_engine_factory_cache()


# ---------------------------------------------------------------------------
# 4.3 — mock_llm fixture
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_llm(monkeypatch):
    """Fixture that patches TutorEngine._call_llm to return controlled responses."""
    responses = {}

    def _mock_call_llm(self, prompt, **kwargs):
        for substring, response in responses.items():
            if substring in prompt:
                return response
        # Default: return a valid JSON fallback
        return json.dumps(
            {"is_correct": False, "error_type": "concept_gap", "feedback": "[MOCK]"}
        )

    monkeypatch.setattr(
        "backend.tutor_engine.TutorEngine._call_llm", _mock_call_llm
    )
    return responses  # caller can add entries: responses["Simplify"] = '{"is_correct": true, ...}'


# ---------------------------------------------------------------------------
# 4.4 — frozen_time fixture
# ---------------------------------------------------------------------------


@pytest.fixture
def frozen_time():
    """Freeze time with a tick() method for advancing."""
    freezer = freeze_time("2024-01-01 00:00:00")
    frozen = freezer.start()
    yield frozen
    freezer.stop()


# ---------------------------------------------------------------------------
# 4.5 — block_outbound_network autouse fixture
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def block_outbound_network(monkeypatch):
    """Block all outbound network connections except localhost."""
    original_connect = socket.socket.connect

    def guarded_connect(self, address):
        host = address[0] if isinstance(address, tuple) else address
        if host not in ("127.0.0.1", "localhost", "::1", "0.0.0.0"):
            raise ConnectionError(f"Network access blocked in tests: {address}")
        return original_connect(self, address)

    monkeypatch.setattr(socket.socket, "connect", guarded_connect)


# ---------------------------------------------------------------------------
# 4.6 — tutor_engine_mock_mode fixture
# ---------------------------------------------------------------------------


@pytest.fixture
def tutor_engine_mock_mode(monkeypatch):
    """Ensure TutorEngine runs in mock mode (no API keys)."""
    for key in (
        "GEMINI_API_KEY",
        "OPENAI_API_KEY",
        "LLM_API_KEY",
        "LLM_BASE_URL",
        "LLM_MODEL",
    ):
        monkeypatch.setenv(key, "")
    # Reset the singleton
    import backend.tutor_engine as te

    te._tutor_engine = None
    yield
    te._tutor_engine = None


# ---------------------------------------------------------------------------
# Phase 0 — shared audit-regression fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def attempt_factory():
    """Build a log attempt with explicit outcome-related fields."""
    def _build(**overrides):
        row = {
            "question_id": "q-audit-1",
            "correct": False,
            "error_type": "incorrect_value",
            "timestamp": "2026-07-10T08:00:00+00:00",
            "attempt_type": "answer",
            "student_answer": "12",
            "weight": 1.0,
            "question_type": "short_answer",
        }
        row.update(overrides)
        return row
    return _build


@pytest.fixture
def outcome_attempts(attempt_factory):
    """Representative scored, pending, deferred, and unanswered attempts."""
    return {
        "correct": attempt_factory(correct=True, error_type=None, student_answer="14"),
        "incorrect": attempt_factory(),
        "pending": attempt_factory(error_type="parent_review_pending", student_answer="an explanation"),
        "deferred": attempt_factory(error_type="llm_unavailable", student_answer="an explanation"),
        "unanswered": attempt_factory(error_type="unanswered", student_answer=""),
    }


@pytest.fixture
def cross_tagged_attempt_log(attempt_factory):
    """One physical answer copied into two topic buckets."""
    import copy

    primary = attempt_factory(
        question_id="q-cross-tagged",
        student_answer="x = 4",
        timestamp="2026-07-10T08:15:00+00:00",
    )
    secondary = copy.deepcopy(primary)
    secondary["weight"] = 0.3
    return {
        "topics": {
            "AC9M7A03": {"attempts": [primary], "accuracy": 0.0},
            "AC9M7A05": {"attempts": [secondary], "accuracy": 0.0},
        }
    }


@pytest.fixture
def progressive_multi_part_exercise():
    return {
        "id": "q-multipart-audit",
        "topic": "Evidence and explanation",
        "question": "Use the data to answer all parts.",
        "answer": "See sub-parts.",
        "steps": ["Read the data.", "Answer each part."],
        "framework": "AC9_SCIENCE",
        "topic_ids": ["AC9S8I04"],
        "subject": "science",
        "difficulty": "extending",
        "year_level": 8,
        "question_type": "multi_part",
        "complexity": "complex_unfamiliar",
        "sub_parts": [
            {"label": "a", "question": "Identify the pattern.", "answer": "It increases.", "marks": 1},
            {"label": "b", "question": "Explain the pattern using evidence.", "answer": "The values rise in each interval.", "marks": 2},
            {"label": "c", "question": "Evaluate one limitation.", "answer": "The sample is small.", "marks": 2},
        ],
        "science_metadata": {"data_representation": "table", "claim_evidence_reasoning": True},
    }


@pytest.fixture
def english_stimulus_exercise():
    return {
        "id": "q-english-stimulus-audit",
        "question": "How does the writer position the reader?",
        "question_type": "reasoning",
        "topic_ids": ["AC9E9LY03"],
        "subject": "english",
        "difficulty": "extending",
        "complexity": "complex_unfamiliar",
        "english_metadata": {
            "facet": "text_evidence",
            "passage_mode": "stimulus",
            "passage": "The streetlights flickered as the crowd fell silent.",
        },
        "rubric": {"key_points": ["uses evidence", "explains effect"], "max_score": 2},
    }


@pytest.fixture
def science_visual_exercise():
    return {
        "id": "q-science-visual-audit",
        "question": "Which force is unbalanced?",
        "question_type": "short_answer",
        "topic_ids": ["AC9S10U05"],
        "subject": "science",
        "difficulty": "developing",
        "complexity": "complex_familiar",
        "diagram_data": {
            "type": "force_diagram",
            "forces": [
                {"direction": "right", "magnitude": 12, "label": "push"},
                {"direction": "left", "magnitude": 8, "label": "friction"},
            ],
        },
    }


@pytest.fixture
def low_confidence_mastery():
    return {
        "topic_id": "AC9M7N01",
        "bkt_mastery": 0.848,
        "status": "mastered",
        "confidence": "low",
        "evidence_count": 1,
    }
