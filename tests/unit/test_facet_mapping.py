from backend.services.facet_mapping import english_learning_facet, science_learning_facet


def test_english_authored_facets_map_to_reporting_facets():
    assert english_learning_facet({"english_metadata": {"facet": "reading_comprehension"}}) == "comprehension"
    assert english_learning_facet({"english_metadata": {"facet": "spelling_punctuation"}}) == "language_conventions"
    assert english_learning_facet({"english_metadata": {"facet": "text_evidence"}}) == "text_evidence"


def test_science_authored_metadata_maps_predictably():
    assert science_learning_facet({"science_metadata": {"variables": {"independent": "light"}}}) == "inquiry_design"
    assert science_learning_facet({"science_metadata": {"safety_notes": ["Wear goggles"]}}) == "inquiry_design"
    assert science_learning_facet({"science_metadata": {"data_representation": "graph"}}) == "data_interpretation"
    assert science_learning_facet({"science_metadata": {"claim_evidence_reasoning": True}}) == "scientific_reasoning"
    assert science_learning_facet({"science_metadata": {"science_as_human_endeavour": "community decisions"}}) == "science_in_context"
    assert science_learning_facet({"science_metadata": {"science_understanding": "particle model"}}) == "conceptual_knowledge"


def test_science_keyword_fallback_is_only_used_without_authored_metadata():
    assert science_learning_facet({"question": "Interpret the trend in the graph."}) == "data_interpretation"
    assert science_learning_facet({
        "question": "Interpret the graph.",
        "science_metadata": {"science_understanding": "ecosystem interactions"},
    }) == "conceptual_knowledge"
