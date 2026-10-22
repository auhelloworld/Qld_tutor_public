"""Unit tests for text_precheck module."""
from __future__ import annotations

from core.algorithms.text_precheck import precheck_text


class TestPrecheckText:
    def test_clean_text_returns_empty_summary(self):
        text = "The sun set over the mountains. The sky turned orange. Birds sang their evening songs."
        result = precheck_text(text)
        assert result["sentence_count"] == 3
        assert result["summary"] == ""

    def test_missing_capitalization(self):
        text = "the sun set over the mountains. The sky turned orange."
        result = precheck_text(text)
        assert len(result["missing_capitalization"]) == 1
        assert "capital letter" in result["summary"]

    def test_missing_end_punctuation(self):
        text = "The sun set over the mountains. The sky turned orange"
        result = precheck_text(text)
        assert len(result["no_end_punctuation"]) == 1
        assert "missing end punctuation" in result["summary"]

    def test_american_spellings(self):
        text = "The color of the sky. My favorite center."
        result = precheck_text(text)
        assert len(result["american_spellings"]) >= 2
        assert result["american_spellings"][0][1] == "colour"
        assert "American spelling" in result["summary"]

    def test_long_sentences(self):
        text = ("This is an extremely long sentence that goes on and on and on without "
                "any clear break or pause which makes it very hard for the reader to "
                "follow and understand what the writer is trying to say.") + "."
        result = precheck_text(text)
        assert len(result["long_sentences"]) >= 1
        assert "long sentence" in result["summary"]

    def test_flesch_score_present(self):
        text = "The cat sat on the mat. The dog ran away. Birds sing in trees."
        result = precheck_text(text)
        assert 0 <= result["flesch_score"] <= 100

    def test_empty_text(self):
        result = precheck_text("")
        assert result["sentence_count"] == 0
        assert result["summary"] == ""
