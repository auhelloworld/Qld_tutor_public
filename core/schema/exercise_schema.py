"""Pydantic v2 schema for tagged exercises.

Implements design §3.3 of the curriculum-framework-foundation spec, splitting
``ExerciseItem`` out of ``core/schema/ingestion_schema.py`` and widening it to
the multi-framework shape required by Req 8 of the spec.

The canonical home for ``ExerciseItem`` is now this module. The legacy
``core.schema.ingestion_schema.ExerciseItem`` remains in place as a
transitional shim used by ``backend/ingestion_v2.py`` (the in-flight
ingestion pipeline that still emits the old four-field shape). The legacy
shim will be retired once that pipeline is updated; until then both names
coexist intentionally.

Cross-field invariants enforced here (Req 8.2 / 8.5 / 8.6):

- ``_ac9_xor_senior``: AC9 frameworks require ``year_level`` and reject
  ``unit``; QCAA Senior frameworks require ``unit`` and reject ``year_level``.
  Jurisdiction is read lazily from the framework registry so this module can
  be imported before ``backend.curriculum_frameworks`` is loaded.
- ``_topic_ids_unique_nonempty``: ``topic_ids`` rejects empty strings and
  duplicate entries.

The cross-framework referential integrity invariant (Req 8.7) — i.e. every
``topic_ids`` entry must exist as a ``topic_id`` in some Framework_Slice on
disk — is NOT enforced at Pydantic validation time. It belongs to the
``ExerciseStore`` load path (see Task 10/11), because it requires reading
every framework slice and surfacing per-record errors (Req 8.8/8.9) without
aborting the whole load.

The optional ``diagram_data`` field is declared as a permissive ``dict | None``
so the existing seed exercises in ``data/exercise_7_math.json`` (which carry
free-form diagram payloads) remain parseable. A fully-typed ``DiagramData``
model is still out of scope, but ``_diagram_type_supported`` now checks the
root ``diagram_data.type`` against :data:`SUPPORTED_DIAGRAM_TYPES` exactly as
``ExerciseSubPart`` checks part-level payloads, so an unrenderable type is
rejected at validation time instead of falling back to placeholder text in the
browser. Per-type field shapes remain unvalidated.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class MathExerciseMetadata(BaseModel):
    """Optional mathematics-specific metadata for gradual schema enrichment."""

    model_config = ConfigDict(extra="forbid")

    strand: str | None = None
    sub_strand: str | None = None
    skill: str | None = None
    calculator_allowed: bool | None = None
    expected_working_steps: list[str] | None = None
    prerequisite_skills: list[str] | None = None
    common_misconceptions: list[str] | None = None
    strategy_focus: str | None = None
    representation_type: str | None = None
    # --- Senior QCAA (e.g. Mathematical Methods) enrichment ------------------
    # Whether the item is intended for a technology-active context. QCAA senior
    # maths assessment splits external Paper 1 (technology-free) from Paper 2
    # (technology-active); this flag lets banks/gates tag and balance the two.
    technology_active: bool | None = None
    # QCAA assessment objective the item targets (supports gates that check a
    # spread beyond rote recall).
    assessment_objective: Literal[
        "recall", "comprehend", "apply", "analyse", "synthesise", "evaluate"
    ] | None = None
    # Human-readable syllabus topic label, e.g. "U3 T4 Introduction to integration".
    unit_topic: str | None = None
    # Note of which formula-book entry the item draws on (for lesson cross-linking).
    formula_reference: str | None = None


class EnglishExerciseMetadata(BaseModel):
    """Optional English-specific metadata for reading, language, and writing tasks."""

    model_config = ConfigDict(extra="forbid")

    facet: Literal[
        "reading_comprehension",
        "text_evidence",
        "language_conventions",
        "vocabulary",
        "writing_structure",
        "spelling_punctuation",
    ] | None = None
    passage: str | None = None
    # Explicit sidecar stimulus identifier. Existing content also stores this
    # in ``passage`` for backward compatibility with older loader paths.
    stimulus_id: str | None = None
    # Where the reading text (if any) lives, so tooling needn't infer it:
    #   "stimulus" -> ``passage`` is a stimulus_id in data/english_stimuli.json
    #   "inline"   -> the text is embedded in the question (**Passage/Extract/Micro-text:**)
    #   "none"     -> self-contained task with no accompanying text
    passage_mode: Literal["stimulus", "inline", "none"] | None = None
    evidence_spans: list[dict] | None = None
    accepted_answer_variants: list[str] | None = None
    grammar_focus: str | None = None
    writing_skill: str | None = None


class ScienceExerciseMetadata(BaseModel):
    """Optional Science-specific metadata for AC9 and senior science practice."""

    model_config = ConfigDict(extra="forbid")

    strand: str | None = None
    sub_strand: str | None = None
    science_understanding: str | None = None
    science_inquiry_skill: str | None = None
    science_as_human_endeavour: str | None = None
    practical_context: str | None = None
    safety_notes: list[str] | None = None
    equipment: list[str] | None = None
    data_representation: Literal[
        "table",
        "graph",
        "diagram",
        "model",
        "calculation",
        "extended_response",
    ] | None = None
    variables: dict | None = None
    claim_evidence_reasoning: bool | None = None


SUPPORTED_DIAGRAM_TYPES = {
    "right_triangle",
    "triangle",
    "rectangle",
    "circle",
    "coordinate_plane",
    "number_line",
    "rectangular_prism",
    "simple_bar_chart",
    "confidence_intervals",
    "pascal_triangle",
    "data_table",
    "sample_space_grid",
    "function_graph",
    "slope_field",
    "tree_diagram",
    "venn_diagram",
    "unit_circle",
    "sector",
    "box_plot",
    "construction_diagram",
    "food_web",
    "particle_model",
    "process_flow",
    "force_diagram",
}


class ExerciseSubPart(BaseModel):
    """Typed multi-part item with optional part-level scoring and media."""

    model_config = ConfigDict(extra="forbid")

    label: str
    question: str
    answer: str
    marks: int | float = Field(default=1, ge=0)
    max_score: int | float | None = Field(default=None, ge=0)
    choices: list[str] | None = None
    correct_choice: str | None = None
    rubric: dict | None = None
    partial_credit: dict | None = None
    answer_tolerance: dict | None = None
    alternative_answers: list[str] | None = None
    steps: list[str] | None = None
    difficulty: Literal["foundational", "developing", "extending", "AMC"] | None = None
    diagram_data: dict | None = None
    image: str | None = None
    diagram_description: str | None = None

    @model_validator(mode="after")
    def _part_contract(self):
        """Validate optional choice, rubric, score, and diagram contracts."""
        if self.choices is not None:
            choices = [choice.strip() for choice in self.choices]
            if len(choices) < 2 or any(not choice for choice in choices):
                raise ValueError("sub-part choices must contain at least two non-empty options")
            if len({choice.casefold() for choice in choices}) != len(choices):
                raise ValueError("sub-part choices must be unique")
            if self.correct_choice is not None:
                correct = self.correct_choice.strip()
                if not correct:
                    raise ValueError("sub-part correct_choice must be non-empty")

                def choice_key(value: str) -> str | None:
                    candidate = value.strip()
                    if candidate.startswith("("):
                        candidate = candidate[1:]
                    if candidate and candidate[0].isalpha() and (
                        len(candidate) == 1 or candidate[1] in ".):- "
                    ):
                        return candidate[0].upper()
                    return None

                correct_key = choice_key(correct)
                valid_key = any(
                    correct.casefold() == choice.casefold()
                    or (
                        correct_key is not None
                        and choice_key(choice) == correct_key
                    )
                    for choice in choices
                )
                if not valid_key:
                    raise ValueError("sub-part correct_choice must match one of its choices")
        elif self.correct_choice is not None:
            raise ValueError("sub-part correct_choice requires choices")

        if self.max_score is not None and self.max_score < self.marks:
            raise ValueError("sub-part max_score must be at least marks")

        if self.rubric is not None:
            rubric_max = self.rubric.get("max_score")
            if (
                "max_score" not in self.rubric
                or isinstance(rubric_max, bool)
                or not isinstance(rubric_max, (int, float))
                or rubric_max <= 0
            ):
                raise ValueError("sub-part rubric must declare a positive numeric max_score")
            from core.algorithms.reasoning_rubric import normalise_reasoning_rubric

            contract = normalise_reasoning_rubric(self.rubric)
            if not contract["valid"]:
                raise ValueError("sub-part rubric must contain attainable key points")
            if float(rubric_max) != float(contract["max_score"]):
                raise ValueError(
                    "sub-part rubric max_score must match its attainable key-point score"
                )
            declared_score = self.max_score if self.max_score is not None else self.marks
            if float(contract["max_score"]) != float(declared_score):
                raise ValueError(
                    "sub-part rubric max_score must match the declared part score"
                )

        if self.diagram_data is not None:
            diagram_type = self.diagram_data.get("type")
            if not isinstance(diagram_type, str) or not diagram_type.strip():
                raise ValueError("sub-part diagram_data must include a type")
            if diagram_type not in SUPPORTED_DIAGRAM_TYPES:
                raise ValueError(
                    f"unsupported sub-part diagram_data.type {diagram_type!r}"
                )
        return self


class ExerciseItem(BaseModel):
    """A single exercise tagged with framework + Topic_Id metadata.

    Field summary (Req 8.1):

    Identity / content (legacy fields, retained verbatim per Req 8.10):
        id, topic, question, answer, steps

    Framework tagging (new in this phase):
        framework         — Framework_Id from the registry (Req 8.3).
        topic_ids         — One or more Topic_Ids the exercise practises
                            (Req 8.2). Bounded 1..20, deduplicated, no empty
                            strings.
        subject           — Free-form subject label (e.g. "math", "english").
        difficulty        — Tri-state difficulty enum (Req 8.4).
        year_level / unit — Mutually exclusive per jurisdiction (Req 8.5/8.6).

    Question types (QCE/ATAR exam alignment):
        question_type     — "short_answer" (default), "multiple_choice", or
                            "reasoning".
        choices           — MCQ options (required when question_type is
                            "multiple_choice").
        correct_choice    — The correct option key (e.g. "A").
        rubric            — Scoring rubric for reasoning questions.
        sample_reasoning  — Model answer for LLM-based rubric grading.
        complexity        — QCE exam complexity classification.

    Optional render hints (legacy free-form):
        diagram_data, image, diagram_description.
    """

    model_config = ConfigDict(extra="forbid")

    # --- Identity / content (legacy) -----------------------------------------
    id: str
    status: Literal["active", "draft"] = "active"
    topic: str  # legacy human-readable name, retained for backward compat
    question: str
    answer: str
    steps: list[str] = Field(default_factory=list)

    # --- Framework tagging (new) ---------------------------------------------
    framework: str  # constrained at validate-time to a registered Framework_Id
    topic_ids: list[str] = Field(min_length=1, max_length=20)
    subject: str
    difficulty: Literal["foundational", "developing", "extending", "AMC"]

    # AC9 vs Senior is encoded via these two mutually exclusive fields. The
    # ``_ac9_xor_senior`` validator enforces the XOR rule per jurisdiction.
    year_level: Literal[7, 8, 9, 10] | None = None
    unit: Literal[1, 2, 3, 4] | None = None

    # --- Question type (QCE/ATAR exam alignment) -----------------------------
    question_type: Literal["short_answer", "multiple_choice", "reasoning", "multi_part"] = "short_answer"

    # MCQ-specific fields
    choices: list[str] | None = None
    correct_choice: str | None = None

    # Reasoning-specific fields
    rubric: dict | None = None              # {"key_points": [...], "max_score": int}
    sample_reasoning: str | None = None     # Model answer for LLM rubric grading

    # QCE exam complexity classification
    complexity: Literal[
        "simple_familiar", "complex_familiar", "complex_unfamiliar"
    ] | None = None

    # --- Multi-part questions (QCE extended response) -------------------------
    sub_parts: list[ExerciseSubPart] | None = None
    # Each part can carry its own rubric, partial-credit rules, tolerance,
    # alternatives, diagram/image and score ceiling.

    # --- Optional render hints (legacy) --------------------------------------
    diagram_data: dict | None = None
    image: str | None = None
    diagram_description: str | None = None

    # --- Alternative accepted answers (English rewriting) --------------------
    alternative_answers: list[str] | None = None

    # --- Optional deterministic marking support ------------------------------
    answer_tolerance: dict | None = None
    partial_credit: dict | None = None

    # --- Strict punctuation mode (English punctuation exercises) -------------
    strict_punctuation: bool | None = None

    # --- Optional subject-specific metadata (backward-compatible) -----------
    math_metadata: MathExerciseMetadata | None = None
    english_metadata: EnglishExerciseMetadata | None = None
    science_metadata: ScienceExerciseMetadata | None = None

    @model_validator(mode="after")
    def _ac9_xor_senior(self):
        """Year_level XOR unit, dispatched on framework jurisdiction.

        Req 8.5: AC9 exercises require ``year_level`` and reject ``unit``.
        Req 8.6: QCAA Senior exercises require ``unit`` and reject
                 ``year_level``.

        The framework registry is imported lazily so that this module can be
        imported before ``backend.curriculum_frameworks`` is fully loaded.
        """
        from backend.curriculum_frameworks import FRAMEWORKS  # lazy

        fw = FRAMEWORKS.get(self.framework)
        if fw is None:
            raise ValueError(
                f"unknown framework: {self.framework!r}; not registered "
                "in backend.curriculum_frameworks.FRAMEWORKS"
            )

        if fw.jurisdiction == "ACARA":
            if self.year_level is None:
                raise ValueError(
                    f"AC9 exercises must declare year_level (framework="
                    f"{self.framework!r})"
                )
            if self.unit is not None:
                raise ValueError(
                    f"AC9 exercises must not declare unit (framework="
                    f"{self.framework!r})"
                )
        else:  # QCAA-Senior
            if self.unit is None:
                raise ValueError(
                    f"Senior exercises must declare unit (framework="
                    f"{self.framework!r})"
                )
            if self.year_level is not None:
                raise ValueError(
                    f"Senior exercises must not declare year_level (framework="
                    f"{self.framework!r})"
                )
        return self

    @model_validator(mode="after")
    def _topic_ids_unique_nonempty(self):
        """Reject empty-string entries and duplicates in ``topic_ids``.

        Req 8.2: ``topic_ids`` is a list of strings with no duplicates and no
        empty entries. Length bounds (1..20) are enforced declaratively by
        ``Field(min_length=1, max_length=20)``.
        """
        for entry in self.topic_ids:
            if not entry or not entry.strip():
                raise ValueError("topic_ids must not contain empty strings")
        if len(set(self.topic_ids)) != len(self.topic_ids):
            raise ValueError("topic_ids must not contain duplicates")
        return self

    @model_validator(mode="after")
    def _question_type_fields(self):
        """Enforce cross-field constraints per question_type.

        - ``multiple_choice`` requires ``choices`` (2+) and ``correct_choice``.
        - ``reasoning`` requires ``rubric`` with ``key_points`` and ``max_score``.
        - ``multi_part`` requires ``sub_parts`` with at least 2 entries.
        - ``short_answer`` must not declare MCQ- or reasoning-only fields.
        """
        qt = self.question_type
        if qt == "multiple_choice":
            if not self.choices or len(self.choices) < 2:
                raise ValueError(
                    "multiple_choice exercises must declare choices (min 2)"
                )
            if not self.correct_choice:
                raise ValueError(
                    "multiple_choice exercises must declare correct_choice"
                )
        elif qt == "reasoning":
            if not self.rubric:
                raise ValueError(
                    "reasoning exercises must declare rubric"
                )
            if "key_points" not in self.rubric or "max_score" not in self.rubric:
                raise ValueError(
                    "reasoning rubric must contain 'key_points' and 'max_score'"
                )
            from core.algorithms.reasoning_rubric import (
                normalise_reasoning_rubric,
                normalised_rubric_payload,
            )
            contract = normalise_reasoning_rubric(self.rubric)
            if not contract["valid"]:
                raise ValueError(contract["reason"] or "invalid reasoning rubric")
            # Legacy binary rubrics are normalised at the schema boundary so
            # downstream code never receives an unattainable total.
            self.rubric = normalised_rubric_payload(self.rubric)
        elif qt == "multi_part":
            if not self.sub_parts or len(self.sub_parts) < 2:
                raise ValueError(
                    "multi_part exercises must declare sub_parts (min 2)"
                )
            labels: list[str] = []
            for i, part in enumerate(self.sub_parts):
                if not part.label.strip() or not part.question.strip() or not part.answer.strip():
                    raise ValueError(
                        f"sub_parts[{i}] must have non-empty 'label', 'question', and 'answer'"
                    )
                labels.append(part.label.strip().lower())
            if len(labels) != len(set(labels)):
                raise ValueError("multi_part sub_parts must use unique labels")
        else:  # short_answer
            if self.choices is not None:
                raise ValueError(
                    "short_answer exercises must not declare choices"
                )
            if self.correct_choice is not None:
                raise ValueError(
                    "short_answer exercises must not declare correct_choice"
                )
        return self

    @model_validator(mode="after")
    def _diagram_type_supported(self):
        """Reject a root ``diagram_data`` the renderer cannot draw.

        ``ExerciseSubPart`` already enforced this, but the root field did not,
        so a typo or an invented type reached the browser and rendered as the
        grey ``Diagram: <type>`` fallback with no validation error. The
        frontend ``DiagramRenderer`` switch and this set are the same 24 types;
        keeping the check here means the guarantee no longer depends on
        remembering to run ``scripts/check_exercises.py``.
        """
        if self.diagram_data is None:
            return self
        diagram_type = self.diagram_data.get("type")
        if not isinstance(diagram_type, str) or not diagram_type.strip():
            raise ValueError("diagram_data must include a type")
        if diagram_type not in SUPPORTED_DIAGRAM_TYPES:
            raise ValueError(
                f"unsupported diagram_data.type {diagram_type!r}"
            )
        return self


__all__ = [
    "EnglishExerciseMetadata",
    "ExerciseItem",
    "ExerciseSubPart",
    "MathExerciseMetadata",
    "ScienceExerciseMetadata",
]
