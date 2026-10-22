from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

from backend.ingestion_v2 import DataIngestionPipeline, IngestionScope
from backend.llm_provider import get_llm_client
from backend.migrations.bootstrap_senior_shells import _SENIOR_FRAMEWORKS
from core.schema.curriculum_schema import FrameworkSliceFile
from core.schema.exercise_schema import ExerciseItem


def test_bootstrap_subjects_follow_canonical_registry():
    assert _SENIOR_FRAMEWORKS["QCAA_SENIOR_ENGLISH"] == [
        "english", "literature", "essential_english", "eal", "literature_extension"
    ]
    assert "earth_environmental_science" in _SENIOR_FRAMEWORKS["QCAA_SENIOR_SCIENCE"]


def test_shared_provider_prefers_complete_generic_configuration(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "generic-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://llm.example/v1")
    monkeypatch.setenv("LLM_MODEL", "generic-model")
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-key")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-key")
    fake_client = MagicMock()

    with patch("backend.llm_provider.OpenAI", return_value=fake_client) as openai:
        client, model = get_llm_client()

    assert client is fake_client
    assert model == "generic-model"
    openai.assert_called_once_with(
        api_key="generic-key",
        base_url="https://llm.example/v1",
    )


def test_ingestion_scope_accepts_registered_senior_subject():
    scope = IngestionScope(
        framework_id="QCAA_SENIOR_SCIENCE",
        subject="earth_environmental_science",
        year_level=None,
        unit=1,
    )
    assert scope.unit == 1


def test_ingestion_emits_canonical_exercise_with_scope(tmp_path):
    raw_dir = tmp_path / "raw"
    staging_dir = tmp_path / "staging"
    raw_dir.mkdir()
    (raw_dir / "items.txt").write_text("one exercise", encoding="utf-8")
    pipeline = DataIngestionPipeline(raw_dir=raw_dir, staging_dir=staging_dir)
    pipeline.client = object()
    pipeline._call_llm_json = lambda prompt, system_msg="": json.dumps({
        "exercises": [{
            "topic_id": "QCAA_METHODS_U1_T1",
            "question": "State the domain of f(x) = sqrt(x).",
            "answer": "x >= 0",
            "steps": ["Require the radicand to be non-negative."],
        }],
    })

    pipeline.ingest_exercises(
        "items.txt",
        framework_id="QCAA_SENIOR_MATHS",
        subject="methods",
        year_level=None,
        unit=1,
    )

    records = json.loads((staging_dir / "exercise_draft.json").read_text(encoding="utf-8"))
    item = ExerciseItem.model_validate(records[0])
    assert item.framework == "QCAA_SENIOR_MATHS"
    assert item.subject == "methods"
    assert item.unit == 1
    assert item.year_level is None
    assert item.topic_ids == ["QCAA_METHODS_U1_T1"]


def test_ingestion_emits_canonical_curriculum_slice(tmp_path):
    raw_dir = tmp_path / "raw"
    staging_dir = tmp_path / "staging"
    raw_dir.mkdir()
    (raw_dir / "syllabus.md").write_text("## Fractions", encoding="utf-8")
    pipeline = DataIngestionPipeline(raw_dir=raw_dir, staging_dir=staging_dir)
    pipeline.client = object()
    pipeline._call_llm_json = lambda prompt, system_msg="": json.dumps({
        "topics": [{
            "topic": "fractions",
            "skills": ["equivalent fractions"],
            "concept_card": {
                "core_rule": "Equivalent fractions have the same value.",
                "hint_levels": ["Find a common factor."],
            },
            "source_ref": "Fractions can be represented in equivalent forms.",
        }],
    })

    pipeline.ingest_syllabus("syllabus.md")

    envelope = FrameworkSliceFile.model_validate(
        json.loads((staging_dir / "curriculum_draft.json").read_text(encoding="utf-8"))
    )
    assert envelope.framework_id == "AC9_MATHS"
    assert envelope.topics
    assert envelope.topics[0].topic_id == "AC9M7N04"
    assert envelope.sequence.sequence == [topic.topic_id for topic in envelope.topics]
