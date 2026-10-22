from backend.tutor_engine import _prompt_context_for_question


def test_prompt_context_prefers_english_topic_id():
    ctx = _prompt_context_for_question(
        {
            "id": "eng-1",
            "subject": "english",
            "year_level": 7,
            "topic": "grammar",
            "topic_ids": ["AC9E7LA07"],
        }
    )

    assert ctx == {
        "year_level": "Year 7",
        "subject": "English",
        "age_range": "12-13",
    }


def test_prompt_context_uses_year_metadata_without_topic_ids():
    ctx = _prompt_context_for_question(
        {
            "id": "math-8",
            "subject": "math",
            "year_level": 8,
            "topic": "legacy_human_label",
        }
    )

    assert ctx == {
        "year_level": "Year 8",
        "subject": "Math",
        "age_range": "13-14",
    }


def test_prompt_context_uses_senior_unit_metadata_without_year_level():
    ctx = _prompt_context_for_question(
        {
            "id": "senior-english-1",
            "subject": "senior_english",
            "unit": 3,
            "topic": "legacy_human_label",
        }
    )

    assert ctx == {
        "year_level": "Unit 3",
        "subject": "Senior English",
        "age_range": "16-18",
    }


def test_prompt_context_uses_year_metadata_when_topic_id_unparseable():
    """An unparseable/legacy topic_id must not silently downgrade to Year 7
    when the question carries an explicit year_level (Audit F3)."""
    ctx = _prompt_context_for_question(
        {
            "id": "x",
            "subject": "math",
            "year_level": 10,
            "topic": "legacy_label",
            "topic_ids": ["legacy_label"],  # not an AC9 id → unparseable
        }
    )

    assert ctx["year_level"] == "Year 10"
    assert ctx["age_range"] == "15-16"
    assert ctx["subject"] == "Math"
