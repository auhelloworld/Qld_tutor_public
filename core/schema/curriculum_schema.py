"""Pydantic v2 schemas for curriculum data.

Implements design §3.2 of the curriculum-framework-foundation spec. Defines:

- Building blocks: ``HintLevel``, ``ConceptCard``.
- First-class data: ``Elaboration``, ``SupplementaryResource``.
- Six discriminated ``CurriculumTopicCommon`` subclasses, one per Framework_Id:
  ``AC9MathsTopic``, ``AC9EnglishTopic``, ``AC9ScienceTopic``,
  ``QCAASeniorMathsTopic``, ``QCAASeniorEnglishTopic``,
  ``QCAASeniorScienceTopic``.
- The ``SubjectTopic`` discriminated union and the ``CurriculumSequence`` and
  ``FrameworkSliceFile`` envelopes.

Cross-model invariants enforced here (per Req 3.10, 3.10a, 4.4, 4.5, 4.9, 5.6,
6.2, 6.7, 6.8, 6.9):

- topic-id-validity: every topic's ``topic_id`` is accepted by its declared
  framework's validator from ``backend.curriculum_frameworks``. Imported lazily
  inside the validator to avoid an import-time cycle with the registry module.
- elaboration-attachment: every ``acara_official`` elaboration's
  ``elaboration_id`` prefix (substring before ``_E``) equals the topic's
  ``topic_id``, on AC9 subclasses.
- resource-payload-required: at least one of ``url`` / ``content`` is non-null.
- elaboration-id provenance shape: AC9 form vs QCAA Senior form.
- sequence dedup: ``CurriculumSequence.sequence`` rejects duplicates.
- sequence-curriculum consistency + prerequisites-internal-consistency on the
  ``FrameworkSliceFile`` envelope.

Strict mode is enabled with ``model_config = ConfigDict(extra='forbid')`` on
every model, so unspecified fields cause a ``ValidationError`` (Req 3.11).
"""

from __future__ import annotations

import re
from typing import Annotated, Literal, Union

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationInfo,
    field_validator,
    model_validator,
)

# --- Building blocks ---------------------------------------------------------


class HintLevel(BaseModel):
    """A single hint strategy attached to a concept card."""

    model_config = ConfigDict(extra="forbid")

    level: Literal["concept_reminder", "step_prompt", "analogy"]
    template: str


class WorkedExampleStep(BaseModel):
    """A single step in a concept card's worked example."""

    model_config = ConfigDict(extra="forbid")

    step: int = Field(ge=1, description="Step number (1-indexed)")
    instruction: str = Field(
        min_length=1,
        description="What the student does in this step (e.g. 'Find the GCD of 18 and 24')",
    )
    result: str = Field(
        min_length=1,
        description="The outcome of this step (e.g. 'GCD = 6')",
    )


class LessonSection(BaseModel):
    """A single section of lesson content (explanation, method, example, etc.)."""

    model_config = ConfigDict(extra="forbid")

    heading: str = Field(min_length=1, description="Section title")
    body: str = Field(min_length=1, description="Section content in plain text or markdown")
    type: Literal[
        "concept", "method", "example", "warning", "connection",
        "context", "technique", "model_text",
        "phenomenon", "theory", "experiment",
    ] = Field(
        description="Section type — determines frontend rendering style"
    )
    diagram: dict | None = Field(
        default=None,
        description=(
            "Optional figure rendered with the shared DiagramRenderer. Use a "
            "type from SUPPORTED_DIAGRAM_TYPES (e.g. function_graph, "
            "coordinate_plane, circle, data_table). Backward-compatible: omit "
            "for text-only sections."
        ),
    )


class VocabularyItem(BaseModel):
    """A key term with its student-friendly definition."""

    model_config = ConfigDict(extra="forbid")

    term: str = Field(min_length=1)
    definition: str = Field(min_length=1)


class ExternalResource(BaseModel):
    """A link to an external learning resource (video, article, etc.)."""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1)
    url: str = Field(min_length=1)
    type: Literal["video", "article", "interactive", "worksheet"] = "video"


class AdditionalWorkedExample(BaseModel):
    """An extra worked example beyond the primary one in the concept card."""

    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1)
    answer: str = Field(min_length=1)
    steps: list[WorkedExampleStep] = Field(min_length=1)


class PracticeQuestion(BaseModel):
    """A practice question inside lesson content, serving as a placeholder or guided/independent step."""

    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1)
    answer: str = Field(min_length=1)
    steps: list[WorkedExampleStep] = Field(default_factory=list)


class LessonContent(BaseModel):
    """Structured lesson content that turns a topic from a formula card into a mini-lesson.

    Designed to be subject-agnostic: works for maths, English, and science
    by varying the section types used in explanation_sections.
    """

    model_config = ConfigDict(extra="forbid")

    prerequisite_topics: list[str] = Field(
        default_factory=list,
        description="Topic IDs the student should understand before this one",
    )
    learning_objectives: list[str] = Field(
        min_length=1,
        description="What the student will be able to do after this lesson (2-4 items)",
    )
    explanation_sections: list[LessonSection] = Field(
        min_length=1,
        description="Ordered teaching content sections",
    )
    key_vocabulary: list[VocabularyItem] = Field(
        default_factory=list,
        description="Key terms with definitions",
    )
    common_mistakes: list[str] = Field(
        default_factory=list,
        description="Typical errors students make on this topic",
    )
    real_world_connections: list[str] = Field(
        default_factory=list,
        description="How this topic connects to everyday life",
    )
    additional_worked_examples: list[AdditionalWorkedExample] = Field(
        default_factory=list,
        description="Extra worked examples beyond the concept card's primary one",
    )
    guided_practice: list[PracticeQuestion] = Field(
        default_factory=list,
        description="Guided practice questions for this topic",
    )
    independent_practice: list[PracticeQuestion] = Field(
        default_factory=list,
        description="Independent practice questions for this topic",
    )
    success_criteria: list[str] = Field(
        default_factory=list,
        description="Success criteria statements for the student (e.g. 'I can...')"
    )
    external_resources: list[ExternalResource] = Field(
        default_factory=list,
        description="Links to videos, articles, or interactive tools",
    )


class ConceptCardWorkedExample(BaseModel):
    """A concrete worked example embedded in a concept card.
    Shows the student exactly how the topic's rule applies to a specific
    problem, step by step. Unlike the abstract ``core_rule`` and Socratic
    ``hint_levels``, this is a fully-solved demonstration.
    """

    model_config = ConfigDict(extra="forbid")

    question: str = Field(
        min_length=1,
        description="The example question (e.g. 'Simplify 18/24')",
    )
    answer: str = Field(
        min_length=1,
        description="The final answer (e.g. '3/4')",
    )
    steps: list[WorkedExampleStep] = Field(
        min_length=1,
        description="Step-by-step solution showing the working",
    )
    explanation: str = Field(
        default="",
        description="Optional plain-English summary of why this method works",
    )


class ConceptCard(BaseModel):
    """The core rule, graduated hint strategies, and worked example for a topic."""

    model_config = ConfigDict(extra="forbid")

    core_rule: str = ""
    hint_levels: list[HintLevel] = Field(default_factory=list)
    worked_example: ConceptCardWorkedExample | None = Field(
        default=None,
        description="A concrete step-by-step solved problem demonstrating the rule",
    )
    lesson_content: LessonContent | None = Field(
        default=None,
        description="Structured mini-lesson content for this topic",
    )


# --- First-class data --------------------------------------------------------


# Req 4.4: AC9 official elaboration ids look like ``AC9M7N01_E1``.
_AC9_ELAB_RE = re.compile(r"^AC9[A-Z]+\d+[A-Z]+\d{2}_E\d+$")
# Req 4.5: QCAA Senior subject-matter ids look like
# ``QCAA_METHODS_U1_T2_SM3``.
_QCAA_ELAB_RE = re.compile(r"^QCAA_[A-Z_]+_U[1-4]_T\d+_SM\d+$")


class Elaboration(BaseModel):
    """A first-class supplementary content item attached to a topic.

    Provenance is recorded via ``source`` (Req 4.1, 4.2). The ``elaboration_id``
    shape is constrained per provenance via :meth:`_check_elaboration_id_shape`.
    """

    model_config = ConfigDict(extra="forbid")

    elaboration_id: str = Field(min_length=1)
    text: str = Field(min_length=1)
    source: Literal[
        "acara_official",
        "qcaa_official",
        "school_added",
        "textbook",
        "ai_generated",
    ]
    source_ref: str | None = None

    @model_validator(mode="after")
    def _check_elaboration_id_shape(self):
        """Switch on ``source`` to apply the correct id regex (Req 4.4 / 4.5).

        For non-official sources we accept any non-empty string; school-added
        and AI-generated content does not need to mimic an official id shape.
        Implemented as ``model_validator(mode='after')`` so ``source`` is
        already populated when we inspect it.
        """
        if self.source == "acara_official":
            if not _AC9_ELAB_RE.match(self.elaboration_id):
                raise ValueError(
                    f"acara_official elaboration_id {self.elaboration_id!r} "
                    f"must match ^AC9[A-Z]+\\d+[A-Z]+\\d{{2}}_E\\d+$"
                )
        elif self.source == "qcaa_official":
            if not _QCAA_ELAB_RE.match(self.elaboration_id):
                raise ValueError(
                    f"qcaa_official elaboration_id {self.elaboration_id!r} "
                    f"must match ^QCAA_[A-Z_]+_U[1-4]_T\\d+_SM\\d+$"
                )
        return self


class SupplementaryResource(BaseModel):
    """A teacher-facing resource attached to a topic.

    Carries either an external ``url`` or inline ``content`` (Req 5.6); at
    least one of the two must be supplied.
    """

    model_config = ConfigDict(extra="forbid")

    resource_id: str
    type: Literal[
        "worked_example",
        "video",
        "textbook_chapter",
        "scaffolded_question",
        "real_world_context",
        "exam_link",
    ]
    title: str = Field(min_length=1)
    url: str | None = None
    content: str | None = None
    license: str | None = None
    grade_band: str | None = None

    @field_validator("content")
    @classmethod
    def _payload_required(cls, v: str | None, info: ValidationInfo) -> str | None:
        """Resource-payload-required invariant (Req 5.6).

        At least one of ``url`` / ``content`` must be non-null. We enforce on
        ``content`` because ``url`` is declared first in field order, so by the
        time ``content`` is validated ``info.data["url"]`` is already set.
        """
        if v is None and info.data.get("url") is None:
            raise ValueError(
                "SupplementaryResource requires at least one of url or content"
            )
        return v


# --- Topic discriminated union ----------------------------------------------


class CurriculumTopicCommon(BaseModel):
    """Base model carrying fields shared by every topic regardless of framework.

    Subclasses pin ``framework`` to a single ``Literal[Framework_Id]`` and add
    framework-specific fields (strand, year_level, unit, etc.).
    """

    model_config = ConfigDict(extra="forbid")

    framework: str  # narrowed in subclasses to a Literal Framework_Id
    topic_id: str
    name: str
    elaborations: list[Elaboration] = Field(default_factory=list)
    supplementary_resources: list[SupplementaryResource] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    concept_card: ConceptCard = Field(default_factory=ConceptCard)
    atar_pathway: dict | None = None
    habit_challenges: list[dict] = Field(default_factory=list)
    pathway_group: str | None = None

    @model_validator(mode="after")
    def _check_topic_id_against_framework_validator(self):
        """Topic-id-validity invariant (Req 3.10 / 3.10a).

        Lazily import the registry so that this module can be imported before
        ``backend.curriculum_frameworks`` lands. If the registry is genuinely
        missing at runtime we let the ImportError propagate, since downstream
        callers will hit the same problem.
        """
        from backend.curriculum_frameworks import get_framework  # lazy

        fw = get_framework(self.framework)
        if not fw.validator(self.topic_id):
            raise ValueError(
                f"topic_id {self.topic_id!r} is not accepted by the validator "
                f"of framework {self.framework!r}"
            )
        return self


def _check_ac9_elaboration_attachment(self: CurriculumTopicCommon) -> CurriculumTopicCommon:
    """Elaboration-attachment invariant (Req 4.9).

    For AC9 topics, every ``acara_official`` elaboration's ``elaboration_id``
    prefix (substring before ``_E``) must equal the topic's ``topic_id``.
    """
    for elab in self.elaborations:
        if elab.source != "acara_official":
            continue
        prefix = elab.elaboration_id.split("_E", 1)[0]
        if prefix != self.topic_id:
            raise ValueError(
                f"acara_official elaboration {elab.elaboration_id!r} is "
                f"attached to topic {self.topic_id!r} but its prefix "
                f"resolves to {prefix!r}"
            )
    return self


class AC9MathsTopic(CurriculumTopicCommon):
    framework: Literal["AC9_MATHS"]
    strand: Literal[
        "Number", "Algebra", "Measurement", "Space", "Statistics", "Probability"
    ]
    year_level: Literal[7, 8, 9, 10]
    achievement_standard_text: str
    content_descriptor_text: str

    @model_validator(mode="after")
    def _check_elaboration_attachment(self):
        return _check_ac9_elaboration_attachment(self)


class AC9EnglishTopic(CurriculumTopicCommon):
    framework: Literal["AC9_ENGLISH"]
    strand: Literal["Language", "Literature", "Literacy"]
    sub_strand: str
    year_level: Literal[7, 8, 9, 10]
    achievement_standard_text: str
    content_descriptor_text: str

    @model_validator(mode="after")
    def _check_elaboration_attachment(self):
        return _check_ac9_elaboration_attachment(self)


class AC9ScienceTopic(CurriculumTopicCommon):
    framework: Literal["AC9_SCIENCE"]
    strand: Literal[
        "Science Understanding",
        "Science as a Human Endeavour",
        "Science Inquiry",
    ]
    sub_strand: Literal["B", "C", "P", "E"] | None = None
    year_level: Literal[7, 8, 9, 10]
    achievement_standard_text: str
    content_descriptor_text: str

    @model_validator(mode="after")
    def _check_elaboration_attachment(self):
        return _check_ac9_elaboration_attachment(self)


class QCAASeniorMathsTopic(CurriculumTopicCommon):
    framework: Literal["QCAA_SENIOR_MATHS"]
    syllabus_subject: Literal["methods", "general", "specialist", "essential"]
    unit: Literal[1, 2, 3, 4]
    topic_number: int = Field(ge=1)


class QCAASeniorEnglishTopic(CurriculumTopicCommon):
    framework: Literal["QCAA_SENIOR_ENGLISH"]
    syllabus_subject: Literal["english", "essential_english", "literature", "eal", "literature_extension"]
    unit: Literal[1, 2, 3, 4]
    topic_number: int = Field(ge=1)


class QCAASeniorScienceTopic(CurriculumTopicCommon):
    framework: Literal["QCAA_SENIOR_SCIENCE"]
    syllabus_subject: Literal["biology", "chemistry", "physics", "psychology", "earth_environmental_science"]
    unit: Literal[1, 2, 3, 4]
    topic_number: int = Field(ge=1)


# Discriminated union (Req 3.3 / 3.4). The ``framework`` field selects the
# concrete subclass. A topic dictionary whose ``framework`` is not one of the
# six registered ids is rejected with a ``ValidationError`` (fail-closed
# validation policy, Req 3.10a).
SubjectTopic = Annotated[
    Union[
        AC9MathsTopic,
        AC9EnglishTopic,
        AC9ScienceTopic,
        QCAASeniorMathsTopic,
        QCAASeniorEnglishTopic,
        QCAASeniorScienceTopic,
    ],
    Field(discriminator="framework"),
]


# --- Sequence and slice envelopes -------------------------------------------


class CurriculumSequence(BaseModel):
    """Per-Framework_Slice ordered list of Topic_Ids with prerequisites."""

    model_config = ConfigDict(extra="forbid")

    sequence: list[str] = Field(default_factory=list)
    prerequisites: dict[str, list[str]] = Field(default_factory=dict)
    is_strict: bool

    @field_validator("sequence")
    @classmethod
    def _no_duplicates(cls, v: list[str]) -> list[str]:
        """Sequence dedup invariant (Req 6.2)."""
        if len(set(v)) != len(v):
            raise ValueError("CurriculumSequence.sequence must not contain duplicates")
        return v


class FrameworkSliceFile(BaseModel):
    """Top-level envelope for a single Framework_Slice JSON file."""

    model_config = ConfigDict(extra="forbid")

    framework_id: str
    topics: list[SubjectTopic] = Field(default_factory=list)
    sequence: CurriculumSequence

    @model_validator(mode="after")
    def _check_sequence_and_prereq_consistency(self):
        """Enforce sequence-curriculum + prerequisites-internal consistency.

        Req 6.7: every entry in ``sequence.sequence`` must exist as a topic.
        Req 6.8: every key in ``sequence.prerequisites`` must exist as a topic.
        Req 6.9: every value in any prerequisites list must exist as a topic.
        """
        topic_ids = {t.topic_id for t in self.topics}

        for tid in self.sequence.sequence:
            if tid not in topic_ids:
                raise ValueError(
                    f"sequence references topic_id {tid!r} which is not "
                    f"present in the slice's topics"
                )

        for key, prereq_list in self.sequence.prerequisites.items():
            if key not in topic_ids:
                raise ValueError(
                    f"prerequisites key {key!r} is not present in the "
                    f"slice's topics"
                )
            for prereq in prereq_list:
                if prereq not in topic_ids:
                    raise ValueError(
                        f"prerequisite {prereq!r} (under key {key!r}) is not "
                        f"present in the slice's topics"
                    )
        return self


__all__ = [
    "HintLevel",
    "ConceptCard",
    "Elaboration",
    "SupplementaryResource",
    "CurriculumTopicCommon",
    "AC9MathsTopic",
    "AC9EnglishTopic",
    "AC9ScienceTopic",
    "QCAASeniorMathsTopic",
    "QCAASeniorEnglishTopic",
    "QCAASeniorScienceTopic",
    "SubjectTopic",
    "CurriculumSequence",
    "FrameworkSliceFile",
]
