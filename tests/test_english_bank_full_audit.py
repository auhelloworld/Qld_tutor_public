"""Tests for the full AC9 English exercise-bank audit."""

from __future__ import annotations

import csv
import json
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from audit_english_bank_full import (  # type: ignore
    YEAR_PROFILES,
    analysis_quality_status,
    audit_exercise,
    audit_year,
    conventions_quality_status,
    evidence_quality_status,
    evidence_to_stimulus_findings,
    load_stimuli,
    multi_part_choice_findings,
    multipart_contract_findings,
    multipart_marking_findings,
    rubric_dimension_status,
    stimulus_searchable_text,
    stimulus_source_issues,
    stimulus_integrity_status,
    task_contract_findings,
    writing_quality_status,
)


@pytest.fixture
def audit_tmp_path():
    path = ROOT / ".tmp" / "test_tmp_english_audit" / uuid.uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)


def base_english_exercise(**overrides):
    ex = {
        "id": "english_7_test_001",
        "topic": "Analyse characterisation with evidence",
        "question": "**Passage:** Mina paused at the gate, then lifted her chin and stepped inside.\n\n**Question:** Explain how the writer reveals Mina's courage. Use evidence.",
        "answer": "The phrase 'lifted her chin' shows Mina's courage because it suggests she chooses to act despite hesitation.",
        "steps": [
            "Identify the action that reveals Mina's attitude.",
            "Quote or paraphrase the evidence.",
            "Explain how the action suggests courage.",
        ],
        "framework": "AC9_ENGLISH",
        "topic_ids": ["AC9E7LE02"],
        "subject": "english",
        "difficulty": "developing",
        "year_level": 7,
        "question_type": "reasoning",
        "rubric": {
            "key_points": [
                "Identifies a relevant character action.",
                "Uses evidence from the passage.",
                "Explains how the action reveals courage.",
            ],
            "max_score": 3,
        },
        "sample_reasoning": "Mina's courage is shown by the phrase 'lifted her chin'. This action suggests she is nervous but decides to enter anyway, so the writer reveals courage through controlled body language.",
        "english_metadata": {
            "facet": "text_evidence",
            "passage_mode": "inline",
            "accepted_answer_variants": ["'lifted her chin' shows courage."],
        },
        "complexity": "complex_familiar",
    }
    ex.update(overrides)
    return ex


def topic_profiles():
    return {
        "AC9E7LE02": type(
            "TopicProfile",
            (),
            {
                "topic_id": "AC9E7LE02",
                "name": "Character, setting and theme",
                "strand": "Literature",
                "keywords": {"character", "evidence", "courage", "writer", "reveals"},
            },
        )()
    }


def issue_codes(issues):
    return {issue.code for issue in issues}


def write_mini_bank(base_path: Path, items: list[dict]) -> tuple[Path, Path, Path]:
    data_dir = base_path / "data"
    curriculum_dir = data_dir / "curriculum" / "ac9_english"
    stimuli_file = data_dir / "english_stimuli.json"
    data_dir.mkdir()
    curriculum_dir.mkdir(parents=True)
    (data_dir / "exercise_7_english.json").write_text(json.dumps(items, indent=2), encoding="utf-8")
    stimuli_file.write_text(json.dumps({"stimuli": {}}, indent=2), encoding="utf-8")
    (curriculum_dir / "year7.json").write_text(
        json.dumps(
            {
                "topics": [
                    {
                        "topic_id": "AC9E7LE02",
                        "name": "Character, setting and theme",
                        "concept_card": {"core_rule": "Use evidence to infer character."},
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    return data_dir, curriculum_dir, stimuli_file


def test_year8_repaired_items_remain_aligned_with_current_stimuli():
    bank = {
        item["id"]: item
        for item in json.loads((ROOT / "data" / "exercise_8_english.json").read_text(encoding="utf-8"))
    }

    assert "Lead actors" in bank["english_8_la01_005"]["sample_reasoning"]
    assert "Grab a badge" not in bank["english_8_la01_005"]["sample_reasoning"]

    la08_answer = bank["english_8_la08_010"]["answer"]
    assert "melancholy diction" in la08_answer and "measured pacing" in la08_answer
    assert "foreboding atmosphere" not in la08_answer

    le03_answer = bank["english_8_le03_011"]["answer"]
    assert "foreground" in le03_answer and "blurred" in le03_answer
    assert all(term not in le03_answer for term in ("low angle", "bright light", "centred composition"))

    clinic = bank["english_8_ly01_008"]
    assert all(term in clinic["question"] for term in ("three days a week", "no permanent doctor", "100 km"))

    assert "virtual tour" in bank["english_8_ly06_003"]["sample_reasoning"]
    assert "local creek" not in bank["english_8_ly06_003"]["sample_reasoning"]

    spelling = bank["english_8_ly08_013"]
    assert "environmental" in spelling["question"] and "environmental" in spelling["answer"]
    assert all(term not in spelling["answer"] for term in ("silent 'n'", "verge", "circle"))

    punctuation = bank["english_8_la09_003"]
    assert ";" in punctuation["question"] and "—" in punctuation["question"]
    assert "semicolon" in punctuation["answer"] and "dash" in punctuation["answer"]

    assert "the wall in red jumpers" in bank["english_8_le03_010"]["answer"]


def test_year9_repaired_comparison_and_template_batches_remain_aligned():
    bank = {
        item["id"]: item
        for item in json.loads((ROOT / "data" / "exercise_9_english.json").read_text(encoding="utf-8"))
    }

    corrected_contract_ids = {
        "english_9_adapt_ext_AC9E9LE01_r02",
        "english_9_adapt_ext_AC9E9LE03_r02",
        "english_9_adapt_ext_AC9E9LE05_r02",
        "english_9_adapt_ext_AC9E9LY03_r02",
        "english_9_adapt_ext_AC9E9LY06_r02",
    }
    for ex_id in corrected_contract_ids:
        ex = bank[ex_id]
        assert task_contract_findings(ex) == []
        assert "weak response" not in " ".join(ex["steps"]).lower()
        assert any("literal" in point.lower() for point in ex["rubric"]["key_points"])

    comparison_items = [
        ex for ex in bank.values()
        if ex["id"].startswith("english_9_stim_ST_EN_Y9_") and ex["id"].endswith("_008")
    ]
    assert len(comparison_items) == 28
    assert all(task_contract_findings(ex) == [] for ex in comparison_items)
    assert all(ex["answer"] != ex["sample_reasoning"] for ex in comparison_items)

    serialised = json.dumps(list(bank.values()), ensure_ascii=False)
    for broken_phrase in (
        "The evidence point about",
        "create a expansive",
        "create a inviting",
        "create a informative",
        "create a instructional",
        "Notice who is missing..",
        "what 'The speaker's claim that 'everyone deserves a clear chance'' says",
    ):
        assert broken_phrase not in serialised

    stimuli = load_stimuli(ROOT / "data" / "english_stimuli.json")
    weak_response_item = bank["english_9_stim_ST_EN_Y9_16_006"]
    assert evidence_to_stimulus_findings(weak_response_item, stimuli) == []


def test_audit_exercise_flags_core_schema_and_metadata_errors():
    row, issues = audit_exercise(
        base_english_exercise(framework="AC9_SCIENCE", english_metadata=None),
        YEAR_PROFILES[7],
        topic_profiles(),
        {},
    )
    assert row["main_priority"] in {"P0", "P1"}
    codes = issue_codes(issues)
    assert "bad_framework" in codes
    assert "missing_english_metadata" in codes


def test_stimulus_mode_requires_resolvable_sidecar_plain_text():
    ex = base_english_exercise(
        question="Use stimulus ST-EN-TEST. What is the main inference?",
        english_metadata={"facet": "reading_comprehension", "passage": "ST-EN-TEST", "passage_mode": "stimulus"},
    )
    status, evidence = stimulus_integrity_status(ex, {})
    assert status == "unresolved_stimulus"
    assert "ST-EN-TEST" in evidence

    status, evidence = stimulus_integrity_status(
        ex,
        {"ST-EN-TEST": {"id": "ST-EN-TEST", "student_display": {"plain_text": "A short test passage."}}},
    )
    assert status == "resolved"
    assert evidence == "ST-EN-TEST"


def test_text_evidence_task_requires_evidence_in_answer_or_rubric():
    ex = base_english_exercise(
        answer="Mina is brave.",
        sample_reasoning="Mina is brave.",
        steps=["State the answer.", "Check it makes sense."],
        rubric={"key_points": ["States an inference.", "Uses a complete sentence.", "Responds to the prompt."], "max_score": 3},
    )
    status, evidence = evidence_quality_status(ex, {})
    assert status == "thin"
    assert "evidence" in evidence.lower()


def test_analysis_quality_requires_effect_meaning_or_audience_link():
    ex = base_english_exercise(
        question="**Passage:** The door groaned.\n\n**Question:** Analyse the effect of the sound imagery.",
        answer="The sound imagery is the door groaned.",
        sample_reasoning="The sound imagery is the door groaned.",
        steps=["Name the sound imagery.", "Restate the image.", "Write a sentence."],
        rubric={"key_points": ["Names the imagery.", "Restates the example.", "Uses a complete sentence."], "max_score": 3},
    )
    status, evidence = analysis_quality_status(ex, YEAR_PROFILES[7])
    assert status == "thin_effect_link"
    assert "effect" in evidence


def test_punctuation_items_require_strict_punctuation_mode():
    ex = base_english_exercise(
        question_type="short_answer",
        question="Add the missing apostrophe: The girls bag was heavy.",
        answer="The girl's bag was heavy.",
        rubric=None,
        sample_reasoning=None,
        english_metadata={"facet": "spelling_punctuation", "passage_mode": "none", "grammar_focus": "apostrophes"},
    )
    status, evidence = conventions_quality_status(ex)
    assert status == "punctuation_not_strict"
    assert "strict_punctuation" in evidence


def test_reasoning_punctuation_analysis_does_not_require_strict_punctuation_mode():
    ex = base_english_exercise(
        question="Analyse how the semicolon shapes rhythm and meaning.",
        english_metadata={
            "facet": "spelling_punctuation",
            "passage_mode": "none",
            "grammar_focus": "semicolons",
        },
    )
    status, _ = conventions_quality_status(ex)
    assert status == "adequate"


def test_writing_structure_items_need_writing_skill_metadata():
    ex = base_english_exercise(
        question="Rewrite this paragraph opening so it has a clearer topic sentence.",
        english_metadata={"facet": "writing_structure", "passage_mode": "inline"},
    )
    status, evidence = writing_quality_status(ex, YEAR_PROFILES[7])
    assert status == "missing_writing_skill"
    assert "writing_skill" in evidence


def test_quote_not_found_in_stimulus_is_flagged():
    ex = base_english_exercise(
        question="Use stimulus ST-EN-TEST. Explain Mina's courage using evidence.",
        answer="The phrase 'lifted her sword' shows courage.",
        sample_reasoning="The quote 'lifted her sword' suggests bravery.",
        english_metadata={
            "facet": "text_evidence",
            "passage": "ST-EN-TEST",
            "passage_mode": "stimulus",
        },
    )
    _row, issues = audit_exercise(
        ex,
        YEAR_PROFILES[7],
        topic_profiles(),
        {"ST-EN-TEST": {"id": "ST-EN-TEST", "student_display": {"plain_text": "Mina lifted her chin and stepped inside."}}},
    )
    assert "quote_not_found_in_stimulus" in issue_codes(issues)
    assert any(issue.code == "quote_not_found_in_stimulus" and issue.priority == "P1" for issue in issues)


def test_valid_quote_found_in_stimulus_passes_quote_check():
    ex = base_english_exercise(
        question="Use stimulus ST-EN-TEST. Explain Mina's courage using evidence.",
        answer="The phrase 'lifted her chin' shows courage.",
        sample_reasoning="'lifted her chin' suggests Mina chooses to act despite fear.",
        english_metadata={
            "facet": "text_evidence",
            "passage": "ST-EN-TEST",
            "passage_mode": "stimulus",
        },
    )
    _row, issues = audit_exercise(
        ex,
        YEAR_PROFILES[7],
        topic_profiles(),
        {"ST-EN-TEST": {"id": "ST-EN-TEST", "student_display": {"plain_text": "Mina lifted her chin and stepped inside."}}},
    )
    assert "quote_not_found_in_stimulus" not in issue_codes(issues)


def test_hidden_stimulus_analysis_metadata_is_not_student_quote_source():
    record = {
        "id": "ST-EN-TEST",
        "student_display": {"plain_text": "Mina lifted her chin and stepped inside."},
        "texts": [{"content": "Mina lifted her sword.", "effect": "Signals courage."}],
        "analysis_targets": ["courage"],
    }
    assert stimulus_searchable_text(record) == "Mina lifted her chin and stepped inside."
    ex = base_english_exercise(
        question="Use stimulus ST-EN-TEST. Explain Mina's courage using evidence.",
        answer="The phrase 'lifted her sword' shows courage.",
        sample_reasoning="'lifted her sword' proves courage.",
        english_metadata={"facet": "text_evidence", "passage": "ST-EN-TEST", "passage_mode": "stimulus"},
    )
    _row, issues = audit_exercise(ex, YEAR_PROFILES[7], topic_profiles(), {"ST-EN-TEST": record})
    assert "quote_not_found_in_stimulus" in issue_codes(issues)


def test_multi_part_contract_rejects_orphan_labels_and_missing_part_mcq_key():
    ex = base_english_exercise(
        question_type="multi_part",
        answer="a) First answer; c) Orphaned answer.",
        steps=["Complete Part a, then Part c."],
        rubric={"key_points": ["a) First answer", "b) Second answer"], "max_score": 2},
        sub_parts=[
            {"label": "a", "question": "Choose.", "choices": ["A) One", "B) Two"], "answer": "B", "marks": 1},
            {"label": "b", "question": "Explain.", "answer": "Second answer", "marks": 1},
        ],
    )
    assert multipart_contract_findings(ex)
    assert any(code == "multipart_mcq_missing_or_invalid_key" for code, _ in multi_part_choice_findings(ex))


def test_high_mark_open_part_requires_authored_rubric_not_runtime_derivation():
    ex = base_english_exercise(
        question_type="multi_part",
        rubric={"key_points": ["a) Explains the effect.", "b) Uses evidence."], "max_score": 3},
        sub_parts=[
            {"label": "a", "question": "Explain the effect.", "answer": "It creates suspense.", "marks": 2},
            {"label": "b", "question": "Name evidence.", "answer": "The gate creaked.", "marks": 1},
        ],
    )
    findings = multipart_marking_findings(ex)
    assert any(code == "multipart_part_rubric_missing" for _priority, code, _evidence in findings)


def test_single_response_root_rubric_is_not_multipart_mark_mismatch():
    """Reasoning/MCQ items with root max_score and no sub_parts are not multiparts."""
    ex = base_english_exercise(
        question_type="reasoning",
        rubric={
            "key_points": [
                {"text": "Produces two craft sentences.", "marks": 1},
                {"text": "Identifies the effect wording.", "marks": 1},
                {"text": "Explains reader effect.", "marks": 1},
            ],
            "max_score": 3,
        },
    )
    assert "sub_parts" not in ex or not ex.get("sub_parts")
    findings = multipart_marking_findings(ex)
    assert not any(code == "multipart_effective_mark_mismatch" for _p, code, _e in findings)


def test_multipart_root_vs_part_mark_mismatch_still_reported():
    ex = base_english_exercise(
        question_type="multi_part",
        rubric={
            "key_points": [
                {"text": "a) Explains the effect.", "marks": 1},
                {"text": "b) Uses evidence.", "marks": 1},
            ],
            "max_score": 5,
        },
        sub_parts=[
            {
                "label": "a",
                "question": "Explain the effect.",
                "answer": "It creates suspense.",
                "marks": 2,
                "rubric": {
                    "key_points": [{"text": "Explains effect with text link.", "marks": 2}],
                    "max_score": 2,
                },
            },
            {
                "label": "b",
                "question": "Name evidence.",
                "answer": "The gate creaked.",
                "marks": 1,
            },
        ],
    )
    findings = multipart_marking_findings(ex)
    assert any(code == "multipart_effective_mark_mismatch" for _p, code, _e in findings)


def test_external_delivery_scope_requires_explicit_external_clearance():
    stimulus = {
        "ST-EN-TEST": {
            "id": "ST-EN-TEST",
            "year_level": 7,
            "source_attribution": {
                "title": "Test text",
                "author_or_organisation": "Test author",
                "licence_or_status": "reviewed",
            },
            "source_rights_review": {
                "status": "reviewed_for_private_non_public_educational_use",
                "reviewed_on": "2026-07-14",
                "approved_scope": "private tutoring",
                "external_distribution": "not_cleared",
            },
        }
    }
    ex = base_english_exercise(
        english_metadata={"facet": "text_evidence", "passage": "ST-EN-TEST", "passage_mode": "stimulus"},
    )
    issues = stimulus_source_issues(7, [ex], stimulus, delivery_scope="external")
    assert "external_distribution_not_cleared" in issue_codes(issues)


def test_quote_check_normalises_unicode_hyphen_variants():
    ex = base_english_exercise(
        question="Use stimulus ST-EN-TEST. Explain the concern using evidence.",
        answer="The phrase 'text-speak harms spelling' presents the concern directly.",
        sample_reasoning="The writer reports a concern about text-speak.",
        english_metadata={
            "facet": "text_evidence",
            "passage": "ST-EN-TEST",
            "passage_mode": "stimulus",
        },
    )
    findings = evidence_to_stimulus_findings(
        ex,
        {"ST-EN-TEST": {"student_display": {"plain_text": "Some teachers worry that 'text‑speak' harms spelling."}}},
    )
    assert findings == []


def test_quoted_analytical_term_is_not_treated_as_source_wording():
    ex = base_english_exercise(
        question='Explain how the poster uses "social distance" through a close-up image.',
        answer="The close-up reduces social distance and creates intimacy.",
        sample_reasoning="The visual framing positions the viewer near the subject.",
        english_metadata={
            "facet": "language_conventions",
            "passage": "ST-EN-TEST",
            "stimulus_id": "ST-EN-TEST",
            "passage_mode": "stimulus",
            "grammar_focus": "visual metalanguage",
        },
    )
    findings = evidence_to_stimulus_findings(
        ex,
        {"ST-EN-TEST": {"student_display": {"plain_text": "A close-up photograph fills most of the poster."}}},
    )
    assert findings == []


def test_inline_quote_is_checked_against_inline_passage():
    ex = base_english_exercise(
        answer='The phrase "the moon exploded" shows courage.',
        sample_reasoning="The response uses a quotation.",
    )
    findings = evidence_to_stimulus_findings(ex, {})
    assert findings == [("quote_not_found_in_stimulus", "the moon exploded")]


def test_revision_wording_is_not_treated_as_a_source_quote():
    ex = base_english_exercise(
        question="Revise the headline to make it more persuasive.",
        answer='New headline: "Protect Our Local Forest".',
        sample_reasoning='I created "Protect Our Local Forest" to use direct address.',
        english_metadata={
            "facet": "writing_structure",
            "passage": "ST-EN-TEST",
            "stimulus_id": "ST-EN-TEST",
            "passage_mode": "stimulus",
            "writing_skill": "persuasive headline",
        },
    )
    assert evidence_to_stimulus_findings(
        ex,
        {"ST-EN-TEST": {"student_display": {"plain_text": "Original headline"}}},
    ) == []


def test_alternative_words_and_reader_reactions_are_not_source_quote_claims():
    ex = base_english_exercise(
        question=(
            "**Short text:** The windows blinked awake.\n\n"
            "**Question:** Explain how the imagery positions the reader."
        ),
        answer=(
            "The soft verb creates warmth. The windows do not 'glare' or 'flash'; "
            "a reader may think 'this place feels welcoming'."
        ),
        sample_reasoning="The phrase 'windows blinked awake' is the source evidence.",
    )
    assert evidence_to_stimulus_findings(ex, {}) == []


def test_intertextual_work_title_is_not_treated_as_source_wording():
    ex = base_english_exercise(
        question=(
            "**Short text:** The speaker takes the road not chosen.\n\n"
            "**Question:** Explain the intertextual reference."
        ),
        answer="The line echoes Robert Frost's poem 'The Road Not Taken'.",
        sample_reasoning="The phrase 'the road not chosen' is the source evidence.",
    )
    assert evidence_to_stimulus_findings(ex, {}) == []


def test_visual_evidence_can_be_supported_without_quotation_marks():
    ex = base_english_exercise(
        question=(
            "**Extract:** A cover places a tired volunteer in the foreground while the crowd is blurred behind her.\n\n"
            "**Question:** Explain how the visual evidence positions the viewer."
        ),
        answer="The foreground volunteer receives visual salience while the blurred crowd becomes background context.",
        sample_reasoning="I compare the foreground subject with the blurred background.",
        english_metadata={"facet": "text_evidence", "passage_mode": "inline"},
    )
    findings = evidence_to_stimulus_findings(ex, {})
    assert not any(code == "evidence_support_thin" for code, _ in findings)


def test_student_weak_response_quote_is_not_treated_as_stimulus_wording():
    ex = base_english_exercise(
        question=(
            "Weak-response repair for Reef Visitor Code Poster: "
            "A student writes: 'The author uses imperative verbs to make it interesting.' "
            "Explain the weakness and improve it."
        ),
        answer="The response names a technique without explaining its effect.",
        sample_reasoning="I would connect the imperative verbs to responsible visitor behaviour.",
        english_metadata={
            "facet": "writing_structure",
            "passage": "ST-EN-TEST",
            "stimulus_id": "ST-EN-TEST",
            "passage_mode": "stimulus",
            "writing_skill": "analytical response repair",
        },
    )
    findings = evidence_to_stimulus_findings(
        ex,
        {"ST-EN-TEST": {"student_display": {"plain_text": "Look, float and leave coral untouched."}}},
    )
    assert findings == []


def test_prompt_quote_claimed_from_linked_stimulus_is_verified_for_other_facets():
    ex = base_english_exercise(
        question="Analyse the speaker's move: Talia says, 'I agree with Jay about cost.'",
        answer="The acknowledgement supports collaboration.",
        sample_reasoning="The speaker acknowledges another view.",
        english_metadata={
            "facet": "language_conventions",
            "passage": "ST-EN-TEST",
            "stimulus_id": "ST-EN-TEST",
            "passage_mode": "stimulus",
            "grammar_focus": "interaction and register",
        },
    )
    findings = evidence_to_stimulus_findings(
        ex,
        {"ST-EN-TEST": {"student_display": {"plain_text": "Kai discusses internet access."}}},
    )
    assert findings == [("quote_not_found_in_stimulus", "I agree with Jay about cost.")]


def test_duplicate_missing_quotes_are_reported_once():
    ex = base_english_exercise(
        question="Use stimulus ST-EN-TEST and quote evidence.",
        answer='The phrase "missing words" is important.',
        sample_reasoning='The phrase "missing words" supports the answer.',
        english_metadata={
            "facet": "text_evidence",
            "passage": "ST-EN-TEST",
            "passage_mode": "stimulus",
        },
    )
    findings = evidence_to_stimulus_findings(
        ex,
        {"ST-EN-TEST": {"student_display": {"plain_text": "Different words."}}},
    )
    assert findings == [("quote_not_found_in_stimulus", "missing words")]


def test_comparison_prompt_rejects_weak_response_repair_rubric():
    ex = base_english_exercise(
        question=(
            "Reading comparison: Extract: locked gate and morning light. "
            "Compare a literal reading with an analytical reading, then justify which is stronger."
        ),
        answer=(
            "A literal reading describes a gate. An analytical reading interprets restriction and hope. "
            "The analytical reading is stronger because it explains the contrast."
        ),
        sample_reasoning=(
            "I compare physical description with symbolic interpretation and judge the analytical reading stronger."
        ),
        rubric={
            "key_points": [
                "Diagnoses the weakness in the supplied response.",
                "Uses evidence to repair the explanation.",
                "Explains how the technique shapes meaning.",
                "Justifies why the revised response is stronger.",
            ],
            "max_score": 4,
        },
    )
    findings = task_contract_findings(ex)
    assert ("rubric_task_mismatch", "Comparison prompt is paired with a weak-response repair rubric.") in findings


def test_comparison_prompt_requires_two_distinct_model_readings_and_judgement():
    ex = base_english_exercise(
        question="Compare two plausible interpretations and justify which is stronger.",
        answer="The text creates a tense mood through imagery.",
        sample_reasoning="The imagery is effective.",
        rubric={
            "key_points": [
                "Offers two plausible interpretations.",
                "Uses evidence to test each reading.",
                "Compares the readings.",
                "Justifies which reading is stronger.",
            ],
            "max_score": 4,
        },
    )
    findings = task_contract_findings(ex)
    assert any(code == "comparison_model_answer_mismatch" for code, _ in findings)


def test_embedded_micro_text_is_the_quote_source_even_with_legacy_stimulus_metadata():
    ex = base_english_exercise(
        question=(
            "Use this micro-text for a Year 10 analysis: "
            "The narrator says, 'I will not call fear wisdom.'"
        ),
        answer=(
            "The phrase 'I will not call fear wisdom' establishes a firm first-person judgement."
        ),
        sample_reasoning=(
            "The phrase 'I will not call fear wisdom' creates a controlled, defiant voice."
        ),
        english_metadata={
            "facet": "text_evidence",
            "passage": "ST-EN-UNRELATED",
            "passage_mode": "stimulus",
        },
    )
    stimuli = {
        "ST-EN-UNRELATED": {
            "title": "Unrelated",
            "student_display": {"plain_text": "A different passage."},
        }
    }
    findings = evidence_to_stimulus_findings(ex, stimuli)
    assert not any(code == "quote_not_found_in_stimulus" for code, _ in findings)


def test_comparison_prompt_accepts_two_interpretations_and_judgement():
    ex = base_english_exercise(
        question="Compare two plausible interpretations and justify which is stronger.",
        answer=(
            "One interpretation is that the notice encourages cooperation. "
            "Another interpretation is that it pressures readers to conform. "
            "The second interpretation is stronger because the exclusionary label "
            "creates a social cost for disagreement."
        ),
        sample_reasoning="",
        rubric={
            "key_points": [
                "Offers two plausible interpretations.",
                "Uses evidence to test each reading.",
                "Compares the readings.",
                "Justifies which reading is stronger.",
            ],
            "max_score": 4,
        },
    )
    findings = task_contract_findings(ex)
    assert not any(code == "comparison_model_answer_mismatch" for code, _ in findings)


def test_mcq_correct_choice_can_supply_evidence_support():
    ex = base_english_exercise(
        question=(
            "**Micro-text:** The response groups evidence by changing attitudes rather than source order.\n\n"
            "**Question:** Which option best explains how the evidence is organised?"
        ),
        answer="C",
        sample_reasoning=None,
        question_type="multiple_choice",
        choices=[
            "A) It repeats the source order without a controlling idea.",
            "B) It lists evidence without explaining a relationship.",
            "C) The phrase 'groups evidence by changing attitudes' shows conceptual organisation.",
            "D) It offers an unsupported personal preference.",
        ],
        correct_choice="C",
        rubric=None,
        english_metadata={
            "facet": "text_evidence",
            "passage_mode": "inline",
        },
    )
    findings = evidence_to_stimulus_findings(ex, {})
    assert not any(code == "evidence_support_thin" for code, _ in findings)


def test_analytical_rubric_accepts_evaluative_judgement_language():
    ex = base_english_exercise(
        question="Write an analytical paragraph about representation and stereotype.",
        rubric={
            "key_points": [
                "Uses precise evidence from the stimulus.",
                "Analyses how organisation represents young people.",
                "Evaluates how the design resists or reinforces stereotypes.",
            ],
            "max_score": 3,
        },
    )
    status, evidence = rubric_dimension_status(ex)
    assert status == "adequate", evidence


def test_analytical_rubric_missing_evidence_is_flagged():
    ex = base_english_exercise(
        rubric={
            "key_points": [
                "Explains an interpretation of character.",
                "Analyses language or structure.",
                "Uses clear expression.",
            ],
            "max_score": 3,
        },
        english_metadata={
            "facet": "text_evidence",
            "passage_mode": "inline",
        },
    )
    _row, issues = audit_exercise(ex, YEAR_PROFILES[7], topic_profiles(), {})
    assert "rubric_dimensions_thin" in issue_codes(issues)


def test_analytical_paragraph_in_writing_facet_uses_analytical_dimensions():
    ex = base_english_exercise(
        question="Write a Year 8 analytical paragraph explaining how imagery positions the reader.",
        rubric={
            "key_points": [
                "Accurately interprets the image.",
                "Uses specific evidence from the extract.",
                "Analyses the creator's imagery and visual positioning.",
                "Explains the effect on the audience.",
            ],
            "max_score": 4,
        },
        english_metadata={
            "facet": "writing_structure",
            "passage_mode": "inline",
            "writing_skill": "analytical paragraph",
        },
    )
    status, evidence = rubric_dimension_status(ex)
    assert status == "adequate", evidence


def test_task_specific_multimodal_rubric_is_accepted_without_fixed_dimension_labels():
    ex = base_english_exercise(
        question=(
            "Evaluate whether a quiz button supports a webpage for new students. "
            "Propose an alternative interactive feature and justify it."
        ),
        rubric={
            "key_points": [
                "Identifies the webpage's purpose and the quiz's role.",
                "Evaluates whether the quiz suits new students' needs.",
                "Proposes a specific alternative interactive feature.",
                "Justifies the alternative by linking it to user needs and purpose.",
            ],
            "max_score": 4,
        },
        english_metadata={
            "facet": "writing_structure",
            "passage_mode": "none",
            "writing_skill": "multimodal design",
        },
    )
    status, evidence = rubric_dimension_status(ex)
    assert status == "adequate", evidence


def test_generic_four_point_rubric_is_not_accepted_as_task_specific():
    ex = base_english_exercise(
        rubric={
            "key_points": [
                "Answers the question.",
                "Uses complete sentences.",
                "Includes relevant ideas.",
                "Checks the answer.",
            ],
            "max_score": 4,
        }
    )
    status, _ = rubric_dimension_status(ex)
    assert status == "rubric_dimensions_thin"


def test_writing_rubric_missing_audience_purpose_or_cohesion_is_flagged():
    ex = base_english_exercise(
        question="Write an imaginative opening using vivid vocabulary.",
        answer="A strong opening uses vivid vocabulary.",
        rubric={"key_points": ["Uses vivid vocabulary."], "max_score": 3},
        english_metadata={
            "facet": "writing_structure",
            "passage_mode": "none",
            "writing_skill": "narrative opening",
        },
    )
    _row, issues = audit_exercise(ex, YEAR_PROFILES[7], topic_profiles(), {})
    assert "rubric_dimensions_thin" in issue_codes(issues)


def test_rubric_dimensions_are_inferred_without_non_schema_task_type():
    ex = base_english_exercise()
    status, _ = rubric_dimension_status(ex)
    assert status != "not_applicable"


def test_non_schema_task_type_is_not_silently_removed():
    ex = base_english_exercise()
    ex["english_metadata"]["task_type"] = "analytical_response"
    _row, issues = audit_exercise(ex, YEAR_PROFILES[7], topic_profiles(), {})
    assert "pydantic_validation" in issue_codes(issues)


def test_stimulus_source_rights_unknown_is_queued_for_review():
    ex = base_english_exercise(
        english_metadata={
            "facet": "text_evidence",
            "passage": "ST-EN-TEST",
            "stimulus_id": "ST-EN-TEST",
            "passage_mode": "stimulus",
        }
    )
    issues = stimulus_source_issues(
        7,
        [ex],
        {
            "ST-EN-TEST": {
                "year_level": 7,
                "source_attribution": {
                    "title": "Legacy text",
                    "author_or_organisation": "Unknown",
                    "licence_or_status": "External source status not asserted.",
                },
            }
        },
    )
    assert any(issue.code == "source_rights_review_needed" and issue.priority == "P2" for issue in issues)


def test_stimulus_source_rights_reviewed_for_private_use_is_resolved():
    ex = base_english_exercise(
        english_metadata={
            "facet": "text_evidence",
            "passage": "ST-EN-TEST",
            "stimulus_id": "ST-EN-TEST",
            "passage_mode": "stimulus",
        }
    )
    issues = stimulus_source_issues(
        7,
        [ex],
        {
            "ST-EN-TEST": {
                "year_level": 7,
                "source_attribution": {
                    "title": "Legacy text",
                    "author_or_organisation": "Local classroom bank",
                    "licence_or_status": (
                        "Legacy classroom stimulus; retained for internal educational use. "
                        "External source status not asserted."
                    ),
                },
                "source_rights_review": {
                    "status": "reviewed_for_private_non_public_educational_use",
                    "reviewed_on": "2026-07-11",
                    "approved_scope": "Private, non-public, non-commercial single-student tutoring use.",
                    "external_distribution": "not_cleared",
                },
            }
        },
    )
    assert not any(issue.code == "source_rights_review_needed" for issue in issues)
    assert not any(issue.category == "source_rights" for issue in issues)


def test_load_stimuli_applies_global_source_rights_review(audit_tmp_path):
    stimuli_path = audit_tmp_path / "stimuli.json"
    stimuli_path.write_text(
        json.dumps(
            {
                "source_rights_review": {
                    "status": "reviewed_for_private_non_public_educational_use",
                    "reviewed_on": "2026-07-11",
                    "approved_scope": "Private tutoring use.",
                    "external_distribution": "not_cleared",
                },
                "stimuli": {
                    "ST-EN-TEST": {
                        "id": "ST-EN-TEST",
                        "source_attribution": {
                            "title": "Test",
                            "author_or_organisation": "Local bank",
                            "licence_or_status": "External source status not asserted.",
                        },
                    }
                },
            }
        ),
        encoding="utf-8",
    )

    loaded = load_stimuli(stimuli_path)

    assert loaded["ST-EN-TEST"]["source_rights_review"]["status"] == (
        "reviewed_for_private_non_public_educational_use"
    )


def test_missing_writing_tasks_at_bank_level_is_flagged(audit_tmp_path):
    item = base_english_exercise(
        english_metadata={
            "facet": "text_evidence",
            "passage_mode": "inline",
        }
    )
    data_dir, curriculum_dir, stimuli_file = write_mini_bank(audit_tmp_path, [item])
    out_dir = audit_tmp_path / "audit"
    audit_year(7, data_dir=data_dir, curriculum_dir=curriculum_dir, stimuli_file=stimuli_file, out_dir=out_dir)

    with (out_dir / "year7_english_full_issue_flags.csv").open(newline="", encoding="utf-8-sig") as f:
        codes = {row["code"] for row in csv.DictReader(f)}
    assert "missing_writing_tasks" in codes


def test_clean_mini_bank_strict_exits_0(audit_tmp_path):
    items = [
        base_english_exercise(
            id="english_7_clean_analytical",
            english_metadata={
                "facet": "text_evidence",
                "passage_mode": "inline",
            },
        ),
        base_english_exercise(
            id="english_7_clean_writing",
            question="Write an imaginative opening for a story about entering a hidden garden.",
            answer="A strong opening establishes audience interest through vivid vocabulary, clear sentence control and cohesive structure.",
            question_type="multi_part",
            sub_parts=[
                {"label": "a", "question": "State the intended audience and purpose.", "answer": "Audience: Year 7 readers; purpose: entertain.", "marks": 1},
                {"label": "b", "question": "Draft one opening sentence.", "answer": "The locked gate sighed open under Mina's shaking hand.", "marks": 1},
            ],
            rubric={
                "key_points": [
                    "Matches purpose and audience.",
                    "Uses cohesive narrative structure.",
                    "Controls vocabulary and sentence choices.",
                ],
                "max_score": 2,
            },
            english_metadata={
                "facet": "writing_structure",
                "passage_mode": "none",
                "writing_skill": "narrative opening",
            },
        ),
        base_english_exercise(
            id="english_7_clean_conventions",
            question_type="short_answer",
            question="Add the missing apostrophe: The girls bag was heavy.",
            answer="The girl's bag was heavy.",
            rubric=None,
            sample_reasoning=None,
            strict_punctuation=True,
            english_metadata={
                "facet": "spelling_punctuation",
                "passage_mode": "none",
                "grammar_focus": "apostrophes",
            },
        ),
    ]
    data_dir, curriculum_dir, stimuli_file = write_mini_bank(audit_tmp_path, items)
    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts" / "audit_english_bank_full.py"),
            "--year",
            "7",
            "--data-dir",
            str(data_dir),
            "--curriculum-dir",
            str(curriculum_dir),
            "--stimuli-file",
            str(stimuli_file),
            "--out",
            str(audit_tmp_path / "out"),
            "--strict",
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_full_audit_output_workflow_writes_acceptance_files(audit_tmp_path):
    data_dir = audit_tmp_path / "data"
    curriculum_dir = data_dir / "curriculum" / "ac9_english"
    out_dir = audit_tmp_path / "audit"
    data_dir.mkdir()
    curriculum_dir.mkdir(parents=True)
    (data_dir / "exercise_7_english.json").write_text(
        json.dumps([base_english_exercise()], indent=2),
        encoding="utf-8",
    )
    (data_dir / "english_stimuli.json").write_text(
        json.dumps({"stimuli": {}}, indent=2),
        encoding="utf-8",
    )
    (curriculum_dir / "year7.json").write_text(
        json.dumps(
            {
                "topics": [
                    {
                        "topic_id": "AC9E7LE02",
                        "name": "Character, setting and theme",
                        "concept_card": {"core_rule": "Use evidence to infer character."},
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    result = audit_year(
        7,
        data_dir=data_dir,
        curriculum_dir=curriculum_dir,
        stimuli_file=data_dir / "english_stimuli.json",
        out_dir=out_dir,
    )

    assert result["items"] == 1
    for filename in [
        "year7_english_full_summary.md",
        "year7_english_item_audit.csv",
        "year7_english_issue_flags.jsonl",
        "year7_english_hard_errors.csv",
        "year7_english_human_review_queue.csv",
    ]:
        assert (out_dir / filename).exists(), filename

    with (out_dir / "year7_english_full_item_audit.csv").open(newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    assert rows[0]["id"] == "english_7_test_001"
