"""Verify WritingAssessment schema validation and serialization."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from core.schema.writing_schema import (
    WritingAssessmentRequest,
    WritingAssessmentResponse,
    CriterionScore,
    Highlight,
    NAPLAN_CRITERIA,
    NAPLAN_PERSUASIVE_CRITERIA,
    NAPLAN_NARRATIVE_CRITERIA,
    JUNIOR_EXPOSITORY_CRITERIA,
    ISMG_ANALYTICAL_CRITERIA,
    ISMG_CREATIVE_CRITERIA,
    ISMG_PUBLIC_PERSUASIVE_CRITERIA,
    COGNITIVE_VERBS,
    get_criteria_for_prompt,
)


class TestCriterionScore:
    def test_valid_criterion(self):
        cs = CriterionScore(
            criterion_number=1,
            domain="Authorial",
            name="Audience",
            score=4,
            max_score=6,
            feedback="Good engagement with the reader.",
        )
        assert cs.score == 4
        assert cs.max_score == 6

    def test_ismg_domain_allowed(self):
        cs = CriterionScore(
            criterion_number=1,
            domain="ISMG",
            name="Knowledge and understanding",
            score=5,
            max_score=7,
            feedback="Good analysis.",
        )
        assert cs.domain == "ISMG"

    def test_score_exceeds_max_raises_error(self):
        with pytest.raises(ValidationError):
            CriterionScore(
                criterion_number=1, domain="Authorial", name="Audience",
                score=7, max_score=6, feedback="Invalid score.",
            )

    def test_negative_score_raises_error(self):
        with pytest.raises(ValidationError):
            CriterionScore(
                criterion_number=1, domain="Authorial", name="Audience",
                score=-1, max_score=6, feedback="Invalid.",
            )

    def test_score_zero_is_valid(self):
        cs = CriterionScore(
            criterion_number=1, domain="Authorial", name="Audience",
            score=0, max_score=6, feedback="No audience engagement evident.",
        )
        assert cs.score == 0


class TestWritingAssessmentRequest:
    def test_valid_request(self):
        req = WritingAssessmentRequest(
            subject="english",
            year_level=7,
            prompt_type="narrative",
            draft_text="The sun set over the horizon and the sky turned orange and pink. " * 10,
        )
        assert req.subject == "english"
        assert req.prompt_type == "narrative"
        assert req.source_text == ""
        assert req.writer_statement == ""

    def test_assessment_request_id_is_validated(self):
        req = WritingAssessmentRequest(
            subject="english",
            year_level=7,
            prompt_type="narrative",
            draft_text="The sun set over the horizon and the sky turned orange and pink. " * 10,
            assessment_request_id="writing-request_1234",
        )
        assert req.assessment_request_id == "writing-request_1234"

        with pytest.raises(ValidationError):
            WritingAssessmentRequest(
                subject="english",
                year_level=7,
                prompt_type="narrative",
                draft_text="The sun set over the horizon and the sky turned orange and pink. " * 10,
                assessment_request_id="bad id",
            )

    def test_valid_analytical_request_with_source_text(self):
        req = WritingAssessmentRequest(
            subject="english",
            year_level=11,
            prompt_type="analytical",
            draft_text="The author uses metaphor to convey deeper meaning about the human condition and our relationship with nature. " * 10,
            source_text="The sun set over the mountains. The sky turned orange.",
        )
        assert req.prompt_type == "analytical"
        assert req.source_text

    def test_analytical_without_source_text_raises_error(self):
        with pytest.raises(ValidationError, match="source text"):
            WritingAssessmentRequest(
                subject="english", year_level=11,
                prompt_type="analytical",
                draft_text="The author uses metaphor to convey deeper meaning about the human condition and our relationship with nature. " * 10,
                source_text="",
            )

    def test_empty_draft_raises_error(self):
        with pytest.raises(ValidationError):
            WritingAssessmentRequest(
                subject="english", year_level=7,
                prompt_type="persuasive", draft_text="",
            )

    def test_draft_too_long_raises_error(self):
        with pytest.raises(ValidationError):
            WritingAssessmentRequest(
                subject="english", year_level=7,
                prompt_type="persuasive",
                draft_text="word " * 2001,
            )

    def test_invalid_prompt_type_raises_error(self):
        with pytest.raises(ValidationError):
            WritingAssessmentRequest(
                subject="english", year_level=7,
                prompt_type="invalid_type", draft_text="Some text.",
            )

    def test_invalid_year_level_raises_error(self):
        with pytest.raises(ValidationError):
            WritingAssessmentRequest(
                subject="english", year_level=5,
                prompt_type="narrative", draft_text="Some text.",
            )

    def test_expository_allowed_junior(self):
        req = WritingAssessmentRequest(
            subject="english", year_level=8,
            prompt_type="expository",
            draft_text="Students can learn more effectively when clear explanations define the topic and provide useful examples. " * 10,
        )
        assert req.prompt_type == "expository"
        assert req.year_level == 8

    def test_expository_not_supported_senior(self):
        with pytest.raises(ValidationError, match="Years 7-10"):
            WritingAssessmentRequest(
                subject="english", year_level=11,
                prompt_type="expository",
                draft_text="Students can learn more effectively when clear explanations define the topic and provide useful examples. " * 10,
            )

    def test_analytical_allowed_junior(self):
        req = WritingAssessmentRequest(
            subject="english", year_level=7,
            prompt_type="analytical",
            draft_text="The author uses metaphor to convey deeper meaning about the human condition and our relationship with nature. " * 10,
            source_text="The sun set over the mountains. The sky turned orange.",
        )
        assert req.prompt_type == "analytical"
        assert req.year_level == 7


class TestWritingAssessmentResponse:
    def test_valid_response(self):
        response = WritingAssessmentResponse(
            total_score=30,
            max_total_score=46,
            estimated_band=5,
            criterion_scores=[
                CriterionScore(
                    criterion_number=1, domain="Authorial", name="Audience",
                    score=4, max_score=6, feedback="Good audience engagement.",
                ),
                CriterionScore(
                    criterion_number=7, domain="Language", name="Paragraphing",
                    score=1, max_score=2, feedback="Basic paragraph structure present.",
                ),
            ],
            highlights=[
                Highlight(
                    criterion_number=9,
                    text_snippet="she was happy and excited and she jumped",
                    start_index=45,
                    end_index=85,
                    issue_type="run_on_sentence",
                    suggestion="Consider breaking into shorter sentences.",
                ),
            ],
            remediation_links=["AC9E7LA09", "AC9E7LA05"],
            overall_feedback="Good narrative structure. Work on sentence variety.",
            strengths=["Engaging opening", "Good use of dialogue"],
            next_learning_steps=[
                {"priority_goal": "Improve sentence variety",
                 "why_it_matters": "Varied sentence structures improve rhythm and reader engagement.",
                 "recommendation": "Practice combining short sentences using subordinating conjunctions."},
            ],
            revision_plan=[
                {"priority": 1, "target": "Improve sentence variety",
                 "why": "The draft relies on similar sentence patterns.",
                 "how": "Revise one paragraph by combining two short sentences and splitting one long sentence.",
                 "example_revision": "Although the setting is calm, the character feels uneasy."},
            ],
            paragraph_feedback={
                "strongest_paragraph": "The opening paragraph clearly establishes the setting.",
                "paragraph_to_revise_first": "The middle paragraph needs a clearer main idea.",
                "sentence_level_improvement": "Vary sentence openings to improve rhythm.",
            },
        )
        assert response.total_score == 30
        assert len(response.criterion_scores) == 2
        assert response.remediation_links == ["AC9E7LA09", "AC9E7LA05"]
        assert response.writer_statement_feedback == ""
        assert response.revision_plan[0].target == "Improve sentence variety"
        assert response.paragraph_feedback is not None
        assert "opening paragraph" in response.paragraph_feedback.strongest_paragraph

    def test_senior_response_with_writer_statement_feedback(self):
        response = WritingAssessmentResponse(
            is_senior=True,
            total_score=18,
            max_total_score=22,
            criterion_scores=[
                CriterionScore(
                    criterion_number=1, domain="ISMG", name="Knowledge and understanding",
                    score=4, max_score=5, feedback="Good genre awareness.",
                ),
            ],
            overall_feedback="Creative writing with strong voice.",
            strengths=["Imagery"],
            next_learning_steps=[
                {"priority_goal": "Improve paragraph structure",
                 "why_it_matters": "Clear paragraphing helps the reader follow the narrative.",
                 "recommendation": "Use PEEL structure for each body paragraph."},
            ],
            writer_statement_feedback="Shows good reflection on narrative choices.",
        )
        assert response.writer_statement_feedback == "Shows good reflection on narrative choices."
        assert response.estimated_band is None

    def test_estimated_band_can_be_none(self):
        response = WritingAssessmentResponse(
            is_senior=True,
            total_score=0,
            max_total_score=22,
            estimated_band=None,
            criterion_scores=[],
        )
        assert response.estimated_band is None


class TestNAPLaNCriteriaConstants:
    def test_ten_criteria(self):
        for criteria in [NAPLAN_CRITERIA, NAPLAN_PERSUASIVE_CRITERIA, NAPLAN_NARRATIVE_CRITERIA]:
            assert len(criteria) == 10
        assert len(JUNIOR_EXPOSITORY_CRITERIA) == 4

    def test_persuasive_vs_narrative_criterion_4(self):
        pers = NAPLAN_PERSUASIVE_CRITERIA[3]
        narr = NAPLAN_NARRATIVE_CRITERIA[3]
        assert pers["name"] == "Persuasive Devices"
        assert narr["name"] == "Character and Setting"
        assert pers["number"] == narr["number"] == 4

    def test_each_has_required_fields(self):
        for c in NAPLAN_CRITERIA:
            assert "number" in c
            assert "domain" in c
            assert "name" in c
            assert "max_score" in c
            assert "description" in c

    def test_narrative_max_total_is_47(self):
        total = sum(c["max_score"] for c in NAPLAN_CRITERIA)
        assert total == 47

    def test_persuasive_max_total_is_48(self):
        total = sum(c["max_score"] for c in NAPLAN_PERSUASIVE_CRITERIA)
        assert total == 48

    def test_ismg_has_domain_field(self):
        for c in ISMG_ANALYTICAL_CRITERIA + ISMG_CREATIVE_CRITERIA + ISMG_PUBLIC_PERSUASIVE_CRITERIA:
            assert "domain" in c
            assert c["domain"] == "ISMG"


class TestISMGCriteria:
    def test_analytical_has_three_criteria(self):
        assert len(ISMG_ANALYTICAL_CRITERIA) == 3

    def test_creative_has_three_criteria(self):
        assert len(ISMG_CREATIVE_CRITERIA) == 3

    def test_persuasive_has_three_criteria(self):
        assert len(ISMG_PUBLIC_PERSUASIVE_CRITERIA) == 3

    def test_total_max_scores(self):
        assert sum(c["max_score"] for c in ISMG_ANALYTICAL_CRITERIA) == 25
        assert sum(c["max_score"] for c in ISMG_CREATIVE_CRITERIA) == 25
        assert sum(c["max_score"] for c in ISMG_PUBLIC_PERSUASIVE_CRITERIA) == 25


class TestGetCriteriaForPrompt:
    def test_junior_narrative(self):
        criteria = get_criteria_for_prompt(7, "narrative")
        assert criteria[3]["name"] == "Character and Setting"

    def test_junior_persuasive(self):
        criteria = get_criteria_for_prompt(7, "persuasive")
        assert criteria[3]["name"] == "Persuasive Devices"  # persuasive keeps this name

    def test_senior_analytical(self):
        criteria = get_criteria_for_prompt(11, "analytical")
        assert len(criteria) == 3
        assert criteria[0]["name"] == "Knowledge application"

    def test_senior_narrative_maps_to_creative(self):
        criteria = get_criteria_for_prompt(11, "narrative")
        assert len(criteria) == 3
        assert criteria[0]["max_score"] == 9  # creative ISMG

    def test_senior_persuasive(self):
        criteria = get_criteria_for_prompt(11, "persuasive")
        assert len(criteria) == 3
        assert criteria[0]["max_score"] == 9


class TestCognitiveVerbs:
    def test_five_verbs(self):
        assert len(COGNITIVE_VERBS) == 5

    def test_verbs_are_analyse_evaluate_justify_create_reflect(self):
        verb_names = {v["name"] for v in COGNITIVE_VERBS}
        assert verb_names == {"Analyse", "Evaluate", "Justify", "Create", "Reflect"}
