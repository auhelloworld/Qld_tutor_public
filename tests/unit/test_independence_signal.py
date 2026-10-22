"""The independence signal must rest on help a student can actually use.

The hint entry points are disabled because the authored hints were not good
enough, so ``hint_count`` is now always 0. Independence was computed from hints
and dialogue only, which meant a student who revealed the answer on every
question still scored as fully independent — the metric read clean because the
behaviour it measured had been switched off, not because the child worked alone.

Revealing the answer is unambiguous help-reliance, is recorded on the attempt,
and was not counted anywhere.
"""
from __future__ import annotations

import json
from unittest.mock import patch

import pytest

from backend.services.derived_analytics import derive_learning_facets

TOPIC = "AC9M7N01"


@pytest.fixture(autouse=True)
def isolate_rule_engine_storage(tmp_path, monkeypatch):
    """Keep cached engines and SQLite writes inside the current test directory."""
    from backend._testing import reset_engine_factory_cache

    monkeypatch.setattr("backend.rules.LOG_ROOT", tmp_path / "logs")
    reset_engine_factory_cache()
    yield
    reset_engine_factory_cache()


@pytest.fixture
def student(request, tmp_path):
    student_id = f"independence-{abs(hash(request.node.name)) % 10**8}"
    directory = tmp_path / "logs" / student_id
    directory.mkdir(parents=True)
    (directory / "math_log.json").write_text(
        json.dumps({"student_id": student_id, "topics": {}})
    )
    return student_id, tmp_path / "logs"


def _log_answers(student_id, *, count, revealed):
    from backend.rules import get_engine

    engine = get_engine(student_id, "math")
    for index in range(count):
        engine.log_attempt(
            topic=TOPIC,
            question_id=f"q{index}",
            is_correct=True,
            question_type="short_answer",
            topic_ids=[TOPIC],
            student_answer="4",
            difficulty="developing",
            used_show_answer=revealed,
            support_level=4 if revealed else 0,
        )


def _independence(student_id):
    return derive_learning_facets(student_id, subject="math")["independence"]


def test_revealing_every_answer_is_not_independence(student):
    student_id, log_root = student
    with patch("backend.rules.LOG_ROOT", log_root):
        _log_answers(student_id, count=6, revealed=True)
        facet = _independence(student_id)
    assert facet["reveal_count"] == 6
    assert facet["score"] < 0.85, facet


def test_working_unaided_still_scores_as_independent(student):
    student_id, log_root = student
    with patch("backend.rules.LOG_ROOT", log_root):
        _log_answers(student_id, count=6, revealed=False)
        facet = _independence(student_id)
    assert facet["reveal_count"] == 0
    assert facet["score"] >= 0.85, facet


def test_the_two_cases_are_distinguishable(student, tmp_path):
    """The point of the change: these used to produce the same score."""
    unaided_id, log_root = student
    revealed_id = unaided_id + "-revealed"
    directory = log_root / revealed_id
    directory.mkdir(parents=True)
    (directory / "math_log.json").write_text(
        json.dumps({"student_id": revealed_id, "topics": {}})
    )
    with patch("backend.rules.LOG_ROOT", log_root):
        _log_answers(unaided_id, count=6, revealed=False)
        _log_answers(revealed_id, count=6, revealed=True)
        unaided = _independence(unaided_id)
        revealed = _independence(revealed_id)
    assert unaided["score"] > revealed["score"], (unaided, revealed)


def test_reveal_count_is_reported_for_the_parent_view(student):
    student_id, log_root = student
    with patch("backend.rules.LOG_ROOT", log_root):
        _log_answers(student_id, count=2, revealed=True)
        facet = _independence(student_id)
    assert "reveal_count" in facet
    assert "hint_count" in facet, "kept so a re-enabled hint feature still reports"


def test_coaching_wording_no_longer_assumes_hints_are_available():
    """The advice told students to attempt something 'before opening a hint',
    which they cannot do while the hint buttons are disabled.
    """
    import inspect

    from backend.services import derived_analytics

    source = inspect.getsource(derived_analytics)
    assert "before opening a hint" not in source
    assert "Use hints after making a first attempt" not in source
