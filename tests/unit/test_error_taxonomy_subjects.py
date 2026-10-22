from __future__ import annotations

from backend.routers import tutor


def test_english_taxonomy_loads_student_friendly_phase2_codes():
    tutor._ERROR_TAXONOMY_CACHE.clear()
    taxonomy = tutor._get_error_taxonomy("english")

    assert taxonomy["weak_text_evidence"]["severity"] == "medium"
    assert taxonomy["inference_error"]["severity"] == "high"
    assert taxonomy["incomplete_answer"]["tip"]


def test_science_taxonomy_loads_science_specific_codes():
    tutor._ERROR_TAXONOMY_CACHE.clear()
    taxonomy = tutor._get_error_taxonomy("science")

    assert taxonomy["evidence_mismatch"]["severity"] == "high"
    assert taxonomy["claim_evidence_reasoning_gap"]["severity"] == "medium"
    assert taxonomy["variable_confusion"]["tip"]
