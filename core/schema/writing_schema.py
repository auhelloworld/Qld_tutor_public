"""Pydantic v2 schema for Writing Assessment module.

Junior writing uses NAPLAN-style persuasive/narrative criteria for skill feedback;
Years 7 and 9 align most closely with NAPLAN practice, while Years 8 and 10 use
the same criteria as formative junior writing practice. Senior writing uses
QCAA-style formative criteria modelled on English General ISMG categories.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


# Per ACARA NAPLAN Persuasive Writing Marking Guide (total 48 marks)
# Per ACARA NAPLAN Narrative Writing Marking Guide (total 47 marks)
NAPLAN_PERSUASIVE_CRITERIA: list[dict[str, Any]] = [
    {"number": 1, "domain": "Authorial", "name": "Audience", "max_score": 6,
     "description": "Ability to engage, persuade, or entertain the reader."},
    {"number": 2, "domain": "Authorial", "name": "Text Structure", "max_score": 4,
     "description": "Coherent beginning, middle, end; clear thesis statement."},
    {"number": 3, "domain": "Authorial", "name": "Ideas", "max_score": 5,
     "description": "Selection, relevance, and elaboration of ideas for an argument."},
    {"number": 4, "domain": "Authorial", "name": "Persuasive Devices", "max_score": 4,
     "description": "Use of rhetorical techniques (e.g., emotive language, rhetorical questions)."},
    {"number": 5, "domain": "Language", "name": "Vocabulary", "max_score": 5,
     "description": "Precise nouns, descriptive verbs, and mature academic or literary choices."},
    {"number": 6, "domain": "Language", "name": "Cohesion", "max_score": 4,
     "description": "Use of transitional words to link ideas (e.g., nevertheless, consequently)."},
    {"number": 7, "domain": "Language", "name": "Paragraphing", "max_score": 3,
     "description": "Segmenting text into paragraphs to support the argument structure."},
    {"number": 8, "domain": "Language", "name": "Sentence Structure", "max_score": 6,
     "description": "Variety of simple, compound, and complex sentences."},
    {"number": 9, "domain": "Language", "name": "Punctuation", "max_score": 5,
     "description": "Correct sentence boundaries and use of a range of punctuation marks."},
    {"number": 10, "domain": "Language", "name": "Spelling", "max_score": 6,
     "description": "Accuracy in high-frequency, complex, and subject-specific vocabulary."},
]

NAPLAN_NARRATIVE_CRITERIA: list[dict[str, Any]] = [
    {"number": 1, "domain": "Authorial", "name": "Audience", "max_score": 6,
     "description": "Capacity to orient, engage, and affect the reader."},
    {"number": 2, "domain": "Authorial", "name": "Text Structure", "max_score": 4,
     "description": "Organisation of narrative features (orientation, complication, resolution)."},
    {"number": 3, "domain": "Authorial", "name": "Ideas", "max_score": 5,
     "description": "Creation, selection, and crafting of ideas for a story."},
    {"number": 4, "domain": "Authorial", "name": "Character and Setting", "max_score": 4,
     "description": "Portrayal and development of characters and the sense of place/atmosphere."},
    {"number": 5, "domain": "Language", "name": "Vocabulary", "max_score": 5,
     "description": "Range and precision of contextually appropriate language choices."},
    {"number": 6, "domain": "Language", "name": "Cohesion", "max_score": 4,
     "description": "Control of multiple threads and relationships across the text."},
    {"number": 7, "domain": "Language", "name": "Paragraphing", "max_score": 2,
     "description": "Segmenting text into paragraphs to assist the reader."},
    {"number": 8, "domain": "Language", "name": "Sentence Structure", "max_score": 6,
     "description": "Production of grammatically correct and meaningful sentences."},
    {"number": 9, "domain": "Language", "name": "Punctuation", "max_score": 5,
     "description": "Correct and appropriate punctuation to aid reading."},
    {"number": 10, "domain": "Language", "name": "Spelling", "max_score": 6,
     "description": "Accuracy of spelling and the difficulty of the words used."},
]

JUNIOR_ANALYTICAL_CRITERIA: list[dict[str, Any]] = [
    {"number": 1, "domain": "TEEL", "name": "Point / Thesis", "max_score": 5,
     "description": "Clear topic sentence or thesis statement that directly answers the prompt."},
    {"number": 2, "domain": "TEEL", "name": "Evidence / Integration", "max_score": 5,
     "description": "Selection and smooth integration of relevant evidence or quotes from the source text."},
    {"number": 3, "domain": "TEEL", "name": "Explanation / Analysis", "max_score": 5,
     "description": "Analysis of the evidence, explaining how language features, techniques, or ideas construct meaning."},
    {"number": 4, "domain": "TEEL", "name": "Structure / Mechanics", "max_score": 5,
     "description": "Adherence to TEEL structure (including link), and control of grammar, spelling, and punctuation."},
]

JUNIOR_EXPOSITORY_CRITERIA: list[dict[str, Any]] = [
    {"number": 1, "domain": "Informative", "name": "Purpose and Audience", "max_score": 5,
     "description": "Clear informative purpose, appropriate register, and awareness of the intended reader."},
    {"number": 2, "domain": "Informative", "name": "Text Structure", "max_score": 5,
     "description": "Logical introduction, sequenced body sections, and a concluding statement or synthesis."},
    {"number": 3, "domain": "Informative", "name": "Ideas and Explanation", "max_score": 5,
     "description": "Relevant facts, examples, definitions, and explanations that develop the topic accurately."},
    {"number": 4, "domain": "Informative", "name": "Language and Cohesion", "max_score": 5,
     "description": "Precise vocabulary, cohesive links, varied sentences, and control of spelling and punctuation."},
]

NAPLAN_CRITERIA_MAP: dict[str, list[dict[str, Any]]] = {
    "persuasive": NAPLAN_PERSUASIVE_CRITERIA,
    "narrative": NAPLAN_NARRATIVE_CRITERIA,
    "analytical": JUNIOR_ANALYTICAL_CRITERIA,
    "expository": JUNIOR_EXPOSITORY_CRITERIA,
}

NAPLAN_CRITERIA: list[dict[str, Any]] = NAPLAN_NARRATIVE_CRITERIA  # backward compat

# QCAA-style formative senior criteria modelled on English General ISMG categories
# (9/8/8 = 25 marks total). Official assessment depends on the school task sheet
# and exact ISMG for the instrument.
ISMG_ANALYTICAL_CRITERIA: list[dict[str, Any]] = [
    {"number": 1, "domain": "ISMG", "name": "Knowledge application", "max_score": 9,
     "description": "Analysis of perspectives, representations, cultural assumptions, and the effects of aesthetic features/stylistic devices."},
    {"number": 2, "domain": "ISMG", "name": "Organisation and development", "max_score": 8,
     "description": "Use of analytical genre conventions; synthesis of evidence from text/s; logical sequencing of ideas."},
    {"number": 3, "domain": "ISMG", "name": "Textual features", "max_score": 8,
     "description": "Discriminating language choices; control of grammar, punctuation, and spelling; use of cohesive devices."},
]

ISMG_CREATIVE_CRITERIA: list[dict[str, Any]] = [
    {"number": 1, "domain": "ISMG", "name": "Knowledge application", "max_score": 9,
     "description": "Creation of perspectives in an imaginative text; manipulation of aesthetic features to prompt emotional/critical responses."},
    {"number": 2, "domain": "ISMG", "name": "Organisation and development", "max_score": 8,
     "description": "Use of imaginative genre conventions (plot, characterisation); selection and sequencing of subject matter."},
    {"number": 3, "domain": "ISMG", "name": "Textual features", "max_score": 8,
     "description": "Creative language choices; control of grammar, punctuation, and spelling; use of written features."},
]

ISMG_PUBLIC_PERSUASIVE_CRITERIA: list[dict[str, Any]] = [
    {"number": 1, "domain": "ISMG", "name": "Knowledge application", "max_score": 9,
     "description": "Creation of perspectives and representations; use of cultural assumptions, attitudes, values, and beliefs to persuade."},
    {"number": 2, "domain": "ISMG", "name": "Organisation and development", "max_score": 8,
     "description": "Use of public-facing genre conventions (e.g. feature article); selection and synthesis of subject matter; cohesion."},
    {"number": 3, "domain": "ISMG", "name": "Textual features", "max_score": 8,
     "description": "Discriminating language choices for persuasion; control of grammar, punctuation, and spelling."},
]

ISMG_CRITERIA_MAP: dict[str, list[dict[str, Any]]] = {
    "analytical": ISMG_ANALYTICAL_CRITERIA,
    "creative": ISMG_CREATIVE_CRITERIA,
    "persuasive": ISMG_PUBLIC_PERSUASIVE_CRITERIA,
}

COGNITIVE_VERBS: list[dict[str, str]] = [
    {"name": "Analyse", "description": "Examine features/evidence to identify patterns, effects, or relationships."},
    {"name": "Evaluate", "description": "Make judgments about the effectiveness or value of textual choices."},
    {"name": "Justify", "description": "Support an argument or choice with evidence and reasoning."},
    {"name": "Create", "description": "Apply genre conventions and stylistic choices to produce an original response."},
    {"name": "Reflect", "description": "Explain and defend creative choices and their intended effects."},
]

# Maps each ISMG criterion to its primary cognitive verb(s)
ISMG_VERB_MAP: dict[str, dict[int, list[str]]] = {
    "analytical": {
        1: ["Analyse", "Evaluate"],
        2: ["Justify"],
        3: [],
    },
    "creative": {
        1: ["Create"],
        2: ["Create"],
        3: ["Reflect"],
    },
    "persuasive": {
        1: ["Analyse", "Evaluate"],
        2: ["Justify"],
        3: [],
    },
}

VERB_CRITERION_NUMBERS: dict[str, list[int]] = {
    "Analyse": [1],
    "Evaluate": [1],
    "Justify": [2],
    "Create": [1, 2],
    "Reflect": [3],
}

REMEDIATION_CODES: dict[int, list[str]] = {
    1: ["LA01"],
    2: ["LA03", "LA04"],
    3: ["LE04", "LE07"],
    4: ["LE06", "LE07"],
    5: ["LA08"],
    6: ["LA04"],
    7: ["LA04"],
    8: ["LA05", "LA06"],
    9: ["LA09"],
    10: ["LA08", "LY08"],
}

REMEDIATION_MAP: dict[int, list[str]] = {
    k: [f"AC9E7{code}" for code in v]
    for k, v in REMEDIATION_CODES.items()
}  # backward compat — Year 7 only


NAPLAN_DOMAIN = Literal["Authorial", "Language"]
ISMG_DOMAIN = Literal["ISMG"]
TEEL_DOMAIN = Literal["TEEL"]
INFORMATIVE_DOMAIN = Literal["Informative"]
CriterionDomain = NAPLAN_DOMAIN | ISMG_DOMAIN | TEEL_DOMAIN | INFORMATIVE_DOMAIN


class CriterionScore(BaseModel):
    model_config = {"extra": "forbid"}
    criterion_number: int = Field(ge=1, le=10)
    domain: CriterionDomain
    name: str = Field(min_length=1, max_length=100)
    score: int = Field(ge=0)
    max_score: int = Field(ge=1, le=9)
    feedback: str = Field(min_length=1, max_length=1000)
    # Quoted text in `feedback` that the server could not find in the draft or
    # the task texts. The UI shows a warning; the score does not change.
    unverified_quotes: list[str] = Field(default_factory=list, max_length=5)

    @model_validator(mode="after")
    def score_within_range(self) -> "CriterionScore":
        if self.score > self.max_score:
            raise ValueError(f"score {self.score} exceeds max_score {self.max_score}")
        return self


class Highlight(BaseModel):
    model_config = {"extra": "forbid"}
    criterion_number: int = Field(ge=1, le=10)
    text_snippet: str = Field(min_length=1, max_length=500)
    start_index: int = Field(ge=0)
    end_index: int = Field(ge=0)
    issue_type: str = Field(min_length=1, max_length=100)
    suggestion: str = Field(min_length=1, max_length=500)


class TopicWordLimit(BaseModel):
    model_config = {"extra": "forbid"}
    min: int = Field(ge=1, le=3000)
    max: int = Field(ge=1, le=3000)


class TopicTaskConditions(BaseModel):
    model_config = {"extra": "forbid"}
    label: str | None = Field(default=None, max_length=120)
    planningMinutes: int | None = Field(default=None, ge=0, le=240)
    writingMinutes: int | None = Field(default=None, ge=0, le=240)
    conditionsNote: str | None = Field(default=None, max_length=1000)


class TopicOfficialSource(BaseModel):
    model_config = {"extra": "forbid"}
    label: str = Field(min_length=1, max_length=200)
    url: str | None = Field(default=None, max_length=500)
    note: str | None = Field(default=None, max_length=1000)


class WritingTopicContext(BaseModel):
    model_config = {"extra": "forbid"}
    topic_title: str | None = Field(default=None, max_length=200)
    context: str | None = Field(default=None, max_length=1500)
    target_audience: str | None = Field(default=None, max_length=500)
    mode: str | None = Field(default=None, max_length=200)
    prescribed_text: str | None = Field(default=None, max_length=500)
    task_conditions: TopicTaskConditions | None = None
    official_source: TopicOfficialSource | None = None
    writing_tips: list[str] = Field(default_factory=list, max_length=8)
    stimulus_text: str | None = Field(default=None, max_length=5000)
    word_limit: TopicWordLimit | None = None


class WritingAssessmentRequest(BaseModel):
    model_config = {"extra": "forbid"}
    subject: str = Field(default="english")
    year_level: int = Field(ge=7, le=12)
    prompt_type: Literal["persuasive", "narrative", "analytical", "expository"]
    topic_id: str | None = Field(default=None)
    topic_prompt: str | None = Field(default=None)
    topic_context: WritingTopicContext | None = None
    draft_text: str = Field(min_length=1, max_length=10000)
    source_text: str = Field(default="", max_length=5000)
    writer_statement: str = Field(default="", max_length=5000)
    task_sheet_text: str = Field(default="", max_length=12000)
    school_ismg_text: str = Field(default="", max_length=12000)
    time_limit_minutes: int = Field(default=0, ge=0)
    time_taken_seconds: int = Field(default=0, ge=0)
    assessment_request_id: str | None = Field(
        default=None,
        min_length=8,
        max_length=64,
        pattern=r"^[A-Za-z0-9._:-]+$",
        description=(
            "Client-generated idempotency key. Retrying the same submission with this "
            "value returns its persisted assessment instead of scoring it again."
        ),
    )
    # Audit Packet 4.1 — linked writing revision loop
    revision_of: str | None = Field(
        default=None,
        description="ISO timestamp of the original assessment this draft revises.",
    )

    @model_validator(mode="after")
    def senior_expository_not_supported(self) -> "WritingAssessmentRequest":
        if self.year_level >= 11 and self.prompt_type == "expository":
            raise ValueError(
                "Expository writing is currently supported for Years 7-10 only. "
                "For senior public-audience tasks, choose persuasive."
            )
        return self

    @model_validator(mode="after")
    def word_count_below_limit(self) -> "WritingAssessmentRequest":
        word_count = len(self.draft_text.split())
        min_words = 50 if self.year_level <= 10 else 80
        if word_count < min_words:
            raise ValueError(
                f"Draft must be at least {min_words} words for meaningful assessment "
                f"(has {word_count} words). Please write more before submitting."
            )
        if word_count > 2000:
            raise ValueError(f"Draft exceeds 2000 word limit (has {word_count} words)")
        return self


    @model_validator(mode="after")
    def _analytical_needs_source_text(self) -> "WritingAssessmentRequest":
        """Analytical essays require a source text (stimulus)."""
        if self.prompt_type == "analytical" and not self.source_text.strip():
            raise ValueError(
                "Analytical writing requires a source text to analyse. "
                "Please paste the text you are analysing."
            )
        return self


class CognitiveVerbScore(BaseModel):
    model_config = {"extra": "forbid"}
    verb: str = Field(min_length=1, max_length=50)
    score: int = Field(ge=0, le=5)
    feedback: str = Field(min_length=1, max_length=500)
    criterion_numbers: list[int] = Field(default_factory=list)


class NextLearningStep(BaseModel):
    model_config = {"extra": "forbid"}
    priority_goal: str = Field(min_length=1, max_length=200)
    why_it_matters: str = Field(min_length=1, max_length=500)
    recommendation: str = Field(min_length=1, max_length=500)


class RevisionPlanItem(BaseModel):
    model_config = {"extra": "forbid"}
    priority: int = Field(ge=1, le=5)
    target: str = Field(min_length=1, max_length=200)
    why: str = Field(min_length=1, max_length=500)
    how: str = Field(min_length=1, max_length=700)
    example_revision: str | None = Field(default=None, max_length=700)
    success_criteria: list[str] = Field(default_factory=list, max_length=3)


class SourceUseFeedback(BaseModel):
    model_config = {"extra": "forbid"}
    uses_source_evidence: bool = Field(default=False)
    best_evidence_used: str = Field(default="", max_length=500)
    missing_or_misread_evidence: str = Field(default="", max_length=500)
    quote_integration_tip: str = Field(default="", max_length=500)


class WritingSkillDrill(BaseModel):
    model_config = {"extra": "forbid"}
    criterion_number: int = Field(ge=1, le=10)
    skill: str = Field(min_length=1, max_length=100)
    drill_prompt: str = Field(min_length=1, max_length=500)
    practice_tip: str = Field(min_length=1, max_length=500)


class ParagraphFeedback(BaseModel):
    model_config = {"extra": "forbid"}
    strongest_paragraph: str = Field(default="", max_length=500)
    paragraph_to_revise_first: str = Field(default="", max_length=500)
    sentence_level_improvement: str = Field(default="", max_length=500)


class WritingAssessmentResponse(BaseModel):
    model_config = {"extra": "forbid"}
    timestamp: str = Field(default="")
    revision_of: str | None = Field(default=None)
    assessment_request_id: str | None = Field(default=None)
    insufficient_evidence: bool = Field(default=False)
    is_senior: bool = Field(default=False)
    total_score: int = Field(ge=0)
    max_total_score: int = Field(ge=1, default=48)
    estimated_band: int | None = Field(default=None, ge=1, le=8)
    criterion_scores: list[CriterionScore]
    highlights: list[Highlight] = Field(default_factory=list)
    remediation_links: list[str] = Field(default_factory=list)
    overall_feedback: str = Field(default="")
    strengths: list[str] = Field(default_factory=list)
    next_learning_steps: list[NextLearningStep] = Field(default_factory=list)
    revision_plan: list[RevisionPlanItem] = Field(default_factory=list)
    paragraph_feedback: ParagraphFeedback | None = Field(default=None)
    source_use_feedback: SourceUseFeedback | None = Field(default=None)
    writing_skill_drills: list[WritingSkillDrill] = Field(default_factory=list)
    task_alignment_warnings: list[str] = Field(default_factory=list)
    writer_statement_feedback: str = Field(default="")
    cognitive_verb_scores: list[CognitiveVerbScore] = Field(default_factory=list)
    portfolio_saved: bool | None = Field(default=None)



def get_remediation_links(
    criterion_scores: list[CriterionScore],
    year_level: int = 7,
) -> list[str]:
    """Generate remediation topic links appropriate to the student's year level.

    For junior years (7-10) uses AC9E curriculum codes interpolated to year level.
    Senior writing remediation is handled in the writing router so it can map
    ISMG criteria to QCAA senior English writing-skill topic IDs.
    """
    if year_level >= 11:
        return _get_remediation_fallback(criterion_scores)

    yr = min(max(year_level, 7), 10)
    topics: set[str] = set()
    for cs in criterion_scores:
        if cs.score < cs.max_score * 0.6:
            codes = REMEDIATION_CODES.get(cs.criterion_number, [])
            for code in codes:
                topics.add(f"AC9E{yr}{code}")
    return sorted(topics)


def _get_remediation_fallback(criterion_scores: list[CriterionScore]) -> list[str]:
    """Fallback — use generic links for senior students."""
    topics: set[str] = set()
    for cs in criterion_scores:
        if cs.score < cs.max_score * 0.6:
            links = REMEDIATION_MAP.get(cs.criterion_number, [])
            topics.update(links)
    return sorted(topics)


def get_criteria_for_prompt(year_level: int, prompt_type: str) -> list[dict]:
    """Return the correct criteria list based on year level and prompt type."""
    if year_level >= 11:
        # Senior — ISMG criteria by assessment type
        ismg_key = prompt_type
        if prompt_type == "narrative":
            ismg_key = "creative"
        return ISMG_CRITERIA_MAP.get(ismg_key, ISMG_ANALYTICAL_CRITERIA)
    # Junior — NAPLAN criteria by prompt type
    return NAPLAN_CRITERIA_MAP.get(prompt_type, NAPLAN_NARRATIVE_CRITERIA)
