from __future__ import annotations

from types import SimpleNamespace

from backend.services import derived_analytics


class _FakeEngine:
    def __init__(self, log: dict):
        self._log = log
        self.requested_topics: list[set[str] | None] = []

    def load_log(self, topics=None) -> dict:
        requested = None if topics is None else {str(topic) for topic in topics}
        self.requested_topics.append(requested)
        if requested is None:
            return self._log
        return {
            **self._log,
            "topics": {
                topic_id: topic_data
                for topic_id, topic_data in self._log.get("topics", {}).items()
                if topic_id in requested
            },
        }


def test_learning_facets_respect_year_scope(monkeypatch):
    log = {
        "topics": {
            "AC9M7N02": {
                "attempts": [{
                    "attempt_type": "answer",
                    "question_id": "year7_q",
                    "correct": False,
                    "error_type": "concept_gap",
                    "timestamp": "2026-01-01T00:00:00+00:00",
                }]
            },
            "AC9M8N01": {
                "attempts": [{
                    "attempt_type": "answer",
                    "question_id": "year8_q",
                    "correct": True,
                    "timestamp": "2026-01-01T00:01:00+00:00",
                }]
            },
        }
    }
    tutor = SimpleNamespace(exercises={
        "year7_q": {"question_type": "short_answer"},
        "year8_q": {"question_type": "short_answer"},
    })
    engine = _FakeEngine(log)
    monkeypatch.setattr(derived_analytics, "get_engine", lambda *_: engine)
    monkeypatch.setattr(derived_analytics, "get_tutor_engine", lambda: tutor)

    year7 = derived_analytics.derive_learning_facets("student", "math", year_level=7)
    year8 = derived_analytics.derive_learning_facets("student", "math", year_level=8)

    assert engine.requested_topics[0] is not None
    assert "AC9M7N02" in engine.requested_topics[0]
    assert "AC9M8N01" not in engine.requested_topics[0]
    assert engine.requested_topics[1] is not None
    assert "AC9M8N01" in engine.requested_topics[1]
    assert "AC9M7N02" not in engine.requested_topics[1]

    assert year7["conceptual_understanding"]["status"] == "stretch"
    assert year8["conceptual_understanding"]["status"] == "developing"
    assert year8["conceptual_understanding"]["confidence"] == "low"


def test_learning_facets_prefer_science_metadata_facet(monkeypatch):
    log = {
        "topics": {
            "AC9S7I01": {
                "attempts": [{
                    "attempt_type": "answer",
                    "question_id": "science_q",
                    "correct": False,
                    "timestamp": "2026-01-01T00:00:00+00:00",
                }]
            }
        }
    }
    tutor = SimpleNamespace(exercises={
        "science_q": {
            "question": "Name the cell structure.",
            "topic": "cells",
            "science_metadata": {"science_inquiry_skill": "plan a fair investigation"},
        }
    })
    monkeypatch.setattr(derived_analytics, "get_engine", lambda *_: _FakeEngine(log))
    monkeypatch.setattr(derived_analytics, "get_tutor_engine", lambda: tutor)

    facets = derived_analytics.derive_learning_facets("student", "science")

    assert facets["inquiry_design"]["status"] == "stretch"
    assert facets["conceptual_knowledge"]["score"] == 0.5
