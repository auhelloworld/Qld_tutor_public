"""Quality gates for AC9 English exercise banks (Years 7-10).

Hard gates (all four years) enforce structural integrity: schema-shaped content,
no duplicates/empties/template-leakage, valid curriculum tagging and coverage,
well-formed MCQ / reasoning / multi-part items, valid facets, resolvable stimulus
references, and a present passage for reading/evidence items.

Softer, year-tunable quality signals (reasoning depth, multi-part marks,
short-answer answer-variant coverage, formulaic-answer detection) are collected as
*advisories* and reported but do NOT fail the suite, mirroring the report-only
philosophy used while the maths Year-8 gaps were closed.
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from tests.unit._bank_audit_helpers import load_json as _load_json

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from pydantic import ValidationError
from backend.services.marking import _mcq_feedback_contract
from core.algorithms.reasoning_rubric import normalise_reasoning_rubric
from core.schema.exercise_schema import ExerciseItem

DATA_DIR = REPO_ROOT / "data"
ENGLISH_YEARS = (7, 8, 9, 10)
HARD_GATE_YEARS = {7, 8, 9, 10}
STRICT_RUBRIC_GATE_YEARS = {7, 8}
RUBRIC_REVIEW_YEARS = {7, 8, 9, 10}
DETEMPLATE_GATE_YEARS = {7, 8, 9, 10}
STIMULUS_REUSE_GATE_YEARS = {8}
MC_FEEDBACK_REQUIRED_YEARS = {7, 8}

MIN_TOPIC_COUNT = 5
VALID_DIFFICULTY = {"foundational", "developing", "extending"}
VALID_COMPLEXITY = {"simple_familiar", "complex_familiar", "complex_unfamiliar"}
FORBIDDEN_DIFFICULTY_COMPLEXITY = {
    ("foundational", "complex_familiar"),
    ("foundational", "complex_unfamiliar"),
    ("extending", "simple_familiar"),
}
REQUIRED_DIFFICULTY_LADDER = {"foundational", "developing", "extending"}
MAX_DIFFICULTY_SHARE = 0.85
VALID_FACETS = {
    "reading_comprehension",
    "text_evidence",
    "language_conventions",
    "vocabulary",
    "writing_structure",
    "spelling_punctuation",
}
PASSAGE_FACETS = {"reading_comprehension", "text_evidence"}

BAD_CONTENT_PATTERNS = (
    re.compile(r"\bTODO\b", re.IGNORECASE),
    re.compile(r"\bTEMPLATE\b", re.IGNORECASE),
    re.compile(r"as an ai", re.IGNORECASE),
    re.compile(r"\{\{[^}]+\}\}"),
    re.compile(r"should deliberately adjust", re.IGNORECASE),  # known hollow-answer signature
)

# A stimulus-id-looking passage value: uppercase token, no spaces (e.g. ST-EN-Y10-01).
STIMULUS_ID_RE = re.compile(r"^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$")
# Signals that a question carries its own text inline.
INLINE_TEXT_RE = re.compile(
    r"passage:|extract:|micro-?text:|\bread:|stanza:|poem:|quote:|lines?:|text:"
    r"|['\"\u2018\u2019\u201c\u201d]|:\s*\S[^:]{40,}",
    re.IGNORECASE,
)
# A question that explicitly points at a specific supplied text it should accompany.
REFERENCES_TEXT_RE = re.compile(
    r"\b(?:the|this|above|following)\s+(?:passage|extract|poem|article|stanza|micro-?text|text)\b",
    re.IGNORECASE,
)
FORMULAIC_ANSWER_RE = re.compile(
    r"this task requires analysis of|the important choice is|should deliberately adjust",
    re.IGNORECASE,
)
GENERIC_RUBRIC_FILLER = {
    "Uses relevant evidence from the text or task.",
    "Explains how the evidence shapes meaning, audience response or purpose.",
    "Uses relevant wording, context or evidence from the question/stimulus where appropriate.",
}
ANALYTICAL_PROMPT_RE = re.compile(
    r"\b(analyse|analyze|evaluate|explain how)\b",
    re.IGNORECASE,
)
TEMPLATE_QUESTION_OPENINGS = (
    "Read the micro-text, then complete the Year 7 exam-style task",
    "Use this micro-text to write a 3–4 sentence analytical paragraph",
    "Compare two possible interpretations of this evidence:",
    "Evaluate this weak response to the micro-text:",
    "In the micro-text, identify one example of",
    "Write an analytical paragraph explaining how the",
    "Offer an alternative interpretation",
    "Compare a literal interpretation and an analytical interpretation",
    "Evaluate this weak response: 'The writer makes it interesting.'",
)
INLINE_PASSAGE_BLOCK_RE = re.compile(
    r"\*\*(?:Passage|Extract):\*\*\s*(.*?)\s*\*\*Question:\*\*",
    re.DOTALL,
)
MAX_INLINE_PASSAGE_REUSE = 4
MAX_STIMULUS_REUSE = 4
EXPLICIT_PART_LABEL_RE = re.compile(
    r"\b(?:part\s+)?([a-d])\s*\)",
    re.IGNORECASE,
)
STEP_PART_LABEL_RE = re.compile(r"\bpart\s+([a-z])\b", re.IGNORECASE)


@dataclass(frozen=True)
class EnglishBankQualityReport:
    year: int
    issues: dict[str, list[str]]
    advisories: dict[str, list[str]] = field(default_factory=dict)

    @property
    def has_issues(self) -> bool:
        return any(self.issues.values())

    def _fmt(self, mapping: dict[str, list[str]]) -> str:
        return ", ".join(
            f"{code}={len(items)}" for code, items in sorted(mapping.items()) if items
        )

    def summary(self) -> str:
        if not self.has_issues:
            base = f"Year {self.year}: OK"
        else:
            base = f"Year {self.year}: {self._fmt(self.issues)}"
        adv = self._fmt(self.advisories)
        return base + (f"  [advisory: {adv}]" if adv else "")

    def details(self, *, limit: int = 8) -> str:
        lines = [self.summary()]
        for code, items in sorted(self.issues.items()):
            if not items:
                continue
            shown = ", ".join(items[:limit])
            suffix = "" if len(items) <= limit else f", ... +{len(items) - limit}"
            lines.append(f"  {code}: {shown}{suffix}")
        return "\n".join(lines)


def _stimulus_ids() -> set[str]:
    lib = _load_json(DATA_DIR / "english_stimuli.json")
    stimuli = lib.get("stimuli", {}) if isinstance(lib, dict) else {}
    return set(stimuli.keys())


def _curriculum_topics(year: int) -> set[str]:
    cur = _load_json(DATA_DIR / "curriculum" / "ac9_english" / f"year{year}.json")
    return {topic["topic_id"] for topic in cur.get("topics", [])}


def _audit_year(year: int, stim_ids: set[str]) -> EnglishBankQualityReport:
    exercises = _load_json(DATA_DIR / f"exercise_{year}_english.json")
    curriculum_topics = _curriculum_topics(year)

    issues: dict[str, list[str]] = defaultdict(list)
    advisories: dict[str, list[str]] = defaultdict(list)
    ids = Counter(str(ex.get("id", "")) for ex in exercises)
    questions = Counter(str(ex.get("question", "")) for ex in exercises)
    topic_counts: Counter[str] = Counter()
    difficulty_counts: Counter[str] = Counter()
    inline_passages: dict[str, list[str]] = defaultdict(list)
    stimulus_refs: dict[str, list[str]] = defaultdict(list)

    for ex in exercises:
        ex_id = str(ex.get("id", "unknown"))
        question = str(ex.get("question", ""))
        answer = str(ex.get("answer", ""))
        meta = ex.get("english_metadata") or {}
        facet = meta.get("facet")
        passage = meta.get("passage")

        try:
            ExerciseItem.model_validate(ex)
        except ValidationError as exc:
            issues["canonical_schema_validation"].append(
                f"{ex_id}:{exc.errors(include_url=False)[0].get('msg', 'invalid item')}"
            )

        if len(question.strip()) < 5:
            issues["empty_question"].append(ex_id)
        if not answer.strip():
            issues["empty_answer"].append(ex_id)

        difficulty = ex.get("difficulty")
        complexity = ex.get("complexity")
        if difficulty in VALID_DIFFICULTY:
            difficulty_counts[difficulty] += 1
        else:
            issues["invalid_difficulty"].append(f"{ex_id}:{difficulty}")
        if complexity not in VALID_COMPLEXITY:
            issues["missing_or_invalid_complexity"].append(f"{ex_id}:{complexity}")
        if (str(difficulty), str(complexity)) in FORBIDDEN_DIFFICULTY_COMPLEXITY:
            issues["difficulty_complexity_conflict"].append(
                f"{ex_id}:{difficulty}+{complexity}"
            )

        searchable = json.dumps(ex, ensure_ascii=False)
        for pattern in BAD_CONTENT_PATTERNS:
            if pattern.search(searchable):
                issues["template_or_meta_text"].append(ex_id)
                break
        if year in DETEMPLATE_GATE_YEARS and question.startswith(TEMPLATE_QUESTION_OPENINGS):
            issues["template_question_opening"].append(ex_id)

        if year in DETEMPLATE_GATE_YEARS:
            passage_match = INLINE_PASSAGE_BLOCK_RE.search(question)
            if passage_match:
                inline_passages[_normalise_text(passage_match.group(1))].append(ex_id)

        for topic_id in (str(t) for t in ex.get("topic_ids") or []):
            topic_counts[topic_id] += 1
            if topic_id not in curriculum_topics:
                issues["unknown_topic_id"].append(f"{ex_id}:{topic_id}")

        if facet is not None and facet not in VALID_FACETS:
            issues["invalid_facet"].append(f"{ex_id}:{facet}")

        # Stimulus integrity + passage location (uses the explicit passage_mode tag).
        stimulus_id = meta.get("stimulus_id")
        passage_str = str(stimulus_id or passage).strip() if isinstance(stimulus_id or passage, str) else ""
        if passage and stimulus_id and passage != stimulus_id:
            issues["stimulus_ref_mismatch"].append(f"{ex_id}:{passage}!={stimulus_id}")
        passage_mode = meta.get("passage_mode")
        if passage_mode == "stimulus" and passage_str and passage_str not in stim_ids:
            issues["stimulus_unresolved"].append(f"{ex_id}:{passage_str}")
        # Belt-and-braces: a stimulus-id-shaped passage that doesn't resolve, regardless of mode.
        elif passage_str and STIMULUS_ID_RE.match(passage_str) and passage_str not in stim_ids:
            issues["stimulus_unresolved"].append(f"{ex_id}:{passage_str}")
        if (
            year in STIMULUS_REUSE_GATE_YEARS
            and passage_mode == "stimulus"
            and passage_str
            and passage_str in stim_ids
        ):
            stimulus_refs[passage_str].append(ex_id)
        if facet in PASSAGE_FACETS and passage_mode == "none":
            # Hard fail only when the item explicitly points at a specific text it
            # should be paired with but none is present (e.g. "...from the extract").
            # Self-contained "generate/apply" reading tasks are surfaced as advisory only.
            if REFERENCES_TEXT_RE.search(question):
                issues["references_absent_text"].append(ex_id)
            else:
                advisories["reading_item_missing_passage"].append(ex_id)

        qt = ex.get("question_type")
        if qt == "multiple_choice":
            _audit_mc(ex, issues)
        elif qt == "reasoning":
            _audit_reasoning(ex, issues, advisories)
        elif qt == "multi_part":
            _audit_multi_part(ex, issues, advisories)
        elif qt == "short_answer":
            # Grading now honours both alternative_answers and accepted_answer_variants;
            # open short-answers are additionally LLM/review-graded in exam & diagnostic.
            meta_variants = meta.get("accepted_answer_variants")
            if not ex.get("alternative_answers") and not meta_variants:
                advisories["short_answer_no_variants"].append(ex_id)

        if FORMULAIC_ANSWER_RE.search(answer):
            advisories["formulaic_answer"].append(ex_id)

        rubric = ex.get("rubric") if isinstance(ex.get("rubric"), dict) else {}
        for point in rubric.get("key_points") or []:
            if isinstance(point, str) and point.strip() in GENERIC_RUBRIC_FILLER:
                issues["generic_rubric_filler"].append(ex_id)
                break
        if (
            year in RUBRIC_REVIEW_YEARS
            and qt != "multiple_choice"
            and int(rubric.get("max_score") or 0) <= 2
            and ANALYTICAL_PROMPT_RE.search(question)
        ):
            target = issues if year in STRICT_RUBRIC_GATE_YEARS else advisories
            target["analytical_rubric_too_narrow"].append(ex_id)

    for ex_id, count in ids.items():
        if count > 1:
            issues["duplicate_id"].append(ex_id)
    for question, count in questions.items():
        if question and count > 1:
            issues["duplicate_question"].append(question[:80])
    for topic_id in sorted(curriculum_topics):
        if topic_counts[topic_id] < MIN_TOPIC_COUNT:
            issues["topic_under_minimum"].append(f"{topic_id}:{topic_counts[topic_id]}")

    missing_ladder = REQUIRED_DIFFICULTY_LADDER - set(difficulty_counts)
    if missing_ladder:
        issues["difficulty_ladder_incomplete"].append(",".join(sorted(missing_ladder)))
    total = len(exercises)
    if total:
        for band, count in difficulty_counts.items():
            if count / total > MAX_DIFFICULTY_SHARE:
                issues["difficulty_band_dominates"].append(f"{band}:{count}/{total}")

    for ids_for_passage in inline_passages.values():
        if len(ids_for_passage) > MAX_INLINE_PASSAGE_REUSE:
            issues["inline_passage_overused"].append(
                f"{len(ids_for_passage)}:{','.join(ids_for_passage[:6])}"
            )
    for stimulus_id, ids_for_stimulus in stimulus_refs.items():
        if len(ids_for_stimulus) > MAX_STIMULUS_REUSE:
            issues["stimulus_overused"].append(
                f"{stimulus_id}:{len(ids_for_stimulus)}:{','.join(ids_for_stimulus[:6])}"
            )

    return EnglishBankQualityReport(year=year, issues=dict(issues), advisories=dict(advisories))


def _normalise_text(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def _audit_mc(ex: dict[str, Any], issues: dict[str, list[str]]) -> None:
    ex_id = str(ex.get("id", "unknown"))
    choices = ex.get("choices") or []
    correct = ex.get("correct_choice")
    if len(choices) < 2 or not correct:
        issues["mc_missing_choices_or_key"].append(ex_id)
        return
    if len(choices) != len(set(map(str, choices))):
        issues["mc_duplicate_choices"].append(ex_id)
    if not isinstance(correct, str) or len(correct) != 1:
        issues["mc_invalid_key"].append(ex_id)
        return
    index = ord(correct.upper()) - ord("A")
    if index < 0 or index >= len(choices):
        issues["mc_invalid_key"].append(ex_id)
        return
    # English MCQ answers are stored as the option letter; verify it matches the key.
    raw_answer = str(ex.get("answer", "")).strip()
    answer = raw_answer.upper()
    if answer in {"A", "B", "C", "D", "E"}:
        if answer != correct.upper():
            issues["mc_answer_mismatch"].append(ex_id)
    else:
        selected = re.sub(r"^\s*[A-E]\s*[\).:-]?\s*", "", str(choices[index]), flags=re.I)
        normal_answer = _normalise_text(raw_answer)
        normal_selected = _normalise_text(selected)
        if not normal_answer or not (
            normal_answer == normal_selected
            or normal_answer in normal_selected
            or normal_selected in normal_answer
        ):
            issues["mc_answer_mismatch"].append(ex_id)
    year = int(ex.get("year_level") or 0)
    if year in MC_FEEDBACK_REQUIRED_YEARS:
        rubric = ex.get("rubric") if isinstance(ex.get("rubric"), dict) else {}
        expected_distractors = {
            chr(ord("A") + i) for i in range(len(choices))
        } - {correct.upper()}
        runtime_contract = _mcq_feedback_contract(ex, next(iter(expected_distractors), None))
        correct_explanation = str(runtime_contract.get("correct_explanation") or "").strip()
        if len(correct_explanation.split()) < 8:
            issues["mc_missing_correct_explanation"].append(ex_id)

        if year == 7:
            for option in expected_distractors:
                option_contract = _mcq_feedback_contract(ex, option)
                feedback = str(
                    option_contract.get("selected_feedback")
                    or option_contract.get("strategy")
                    or ""
                ).strip()
                if len(feedback.split()) < 6:
                    issues["mc_missing_retry_guidance"].append(f"{ex_id}:{option}")
            return

        distractor_feedback = rubric.get("distractor_feedback")
        if not isinstance(distractor_feedback, dict):
            issues["mc_missing_distractor_feedback"].append(ex_id)
            return
        feedback_keys = {str(key).upper() for key in distractor_feedback}
        if feedback_keys != expected_distractors:
            issues["mc_missing_distractor_feedback"].append(ex_id)
        for option in expected_distractors:
            feedback = str(distractor_feedback.get(option) or "").strip()
            if len(feedback.split()) < 6:
                issues["mc_missing_distractor_feedback"].append(f"{ex_id}:{option}")


def _audit_reasoning(ex, issues, advisories) -> None:
    ex_id = str(ex.get("id", "unknown"))
    rubric = ex.get("rubric") or {}
    key_points = rubric.get("key_points") or []
    contract = normalise_reasoning_rubric(rubric)
    if not contract["valid"] or contract["max_score"] < 2:
        issues["reasoning_missing_or_weak_rubric"].append(ex_id)
    if not str(ex.get("sample_reasoning", "")).strip():
        issues["reasoning_missing_sample"].append(ex_id)
    if contract["scoring_mode"] != "progressive_levels" and (
        len(key_points) < 4 or contract["max_score"] < 4
    ):
        advisories["reasoning_shallow"].append(ex_id)


def _audit_multi_part(ex, issues, advisories) -> None:
    ex_id = str(ex.get("id", "unknown"))
    sub_parts = ex.get("sub_parts") or []
    if len(sub_parts) < 2:
        issues["multipart_too_short"].append(ex_id)
    labels = [str(part.get("label") or "").strip().lower() for part in sub_parts if isinstance(part, dict)]
    if len(labels) != len(set(labels)) or any(not label for label in labels):
        issues["multipart_duplicate_or_empty_label"].append(ex_id)

    expected = set(labels)
    rubric = ex.get("rubric") if isinstance(ex.get("rubric"), dict) else {}
    labelled_fields = {
        "answer": (str(ex.get("answer") or ""), False),
        "steps": ("\n".join(str(step) for step in ex.get("steps") or []), True),
        "rubric": ("\n".join(str(point) for point in rubric.get("key_points") or []), False),
    }
    for field, (value, is_steps) in labelled_fields.items():
        found = {match.group(1).lower() for match in EXPLICIT_PART_LABEL_RE.finditer(value)}
        if is_steps:
            found.update(match.group(1).lower() for match in STEP_PART_LABEL_RE.finditer(value))
        if "a" in found and (not is_steps or len(found) > 1) and found != expected:
            issues["multipart_root_label_mismatch"].append(f"{ex_id}:{field}")

    for idx, part in enumerate(sub_parts):
        if not all(part.get(key) for key in ("label", "question", "answer")):
            issues["multipart_subpart_incomplete"].append(f"{ex_id}:{idx}")
            continue
        choices = part.get("choices") or []
        if choices:
            correct = str(part.get("correct_choice") or "").strip().upper()
            choice_index = ord(correct) - ord("A") if len(correct) == 1 else -1
            if len(choices) < 2 or len(choices) != len({str(choice) for choice in choices}):
                issues["multipart_mcq_choices_invalid"].append(f"{ex_id}:{part.get('label', idx)}")
                continue
            if choice_index < 0 or choice_index >= len(choices):
                issues["multipart_mcq_missing_or_invalid_key"].append(f"{ex_id}:{part.get('label', idx)}")
                continue
            answer = str(part.get("answer") or "").strip()
            selected = re.sub(r"^\s*\(?[A-Ea-e]\)?\s*[\).:-]?\s*", "", str(choices[choice_index])).strip()
            if answer.upper() in {"A", "B", "C", "D", "E"}:
                matches = answer.upper() == correct
            else:
                matches = _normalise_text(answer) in {_normalise_text(selected), _normalise_text(str(choices[choice_index]))}
            if not matches:
                issues["multipart_mcq_answer_mismatch"].append(f"{ex_id}:{part.get('label', idx)}")
            continue
        marks = float(part.get("max_score", part.get("marks", 1)) or 1)
        if marks <= 1:
            continue
        part_rubric = part.get("rubric") if isinstance(part.get("rubric"), dict) else None
        if not part_rubric:
            advisories["multipart_part_rubric_missing"].append(
                f"{ex_id}:{part.get('label', idx)}"
            )
            continue
        contract = normalise_reasoning_rubric(part_rubric)
        if not contract["valid"] or float(contract["max_score"]) != marks:
            issues["multipart_part_scoring_unsupported"].append(f"{ex_id}:{part.get('label', idx)}")
    total_marks = sum(int(part.get("marks", 1) or 1) for part in sub_parts)
    if total_marks < 4:
        advisories["multipart_low_marks"].append(ex_id)


def test_english_bank_quality_report_all_years() -> None:
    """The auditor runs for every English year and returns well-formed reports."""
    stim_ids = _stimulus_ids()
    reports = [_audit_year(year, stim_ids) for year in ENGLISH_YEARS]
    assert [r.year for r in reports] == list(ENGLISH_YEARS)
    for report in reports:
        for mapping in (report.issues, report.advisories):
            assert isinstance(mapping, dict)
            for code, offenders in mapping.items():
                assert isinstance(code, str) and code, report.summary()
                assert isinstance(offenders, list)
                assert all(isinstance(item, str) for item in offenders)


def test_english_bank_hard_gates() -> None:
    stim_ids = _stimulus_ids()
    reports = [_audit_year(year, stim_ids) for year in ENGLISH_YEARS]
    hard_failures = [
        report.details()
        for report in reports
        if report.year in HARD_GATE_YEARS and report.has_issues
    ]
    assert not hard_failures, "\n\n".join(hard_failures)


def test_year7_and_year8_banks_reject_generic_rubrics_narrow_analysis_and_template_reuse() -> None:
    """Years 7 and 8 enforce self-study and de-templating quality gates."""
    guarded_codes = {
        "generic_rubric_filler",
        "analytical_rubric_too_narrow",
        "template_question_opening",
        "inline_passage_overused",
        "stimulus_overused",
    }
    reports = [_audit_year(year, _stimulus_ids()) for year in (7, 8)]
    failures = []
    for report in reports:
        year_failures = {
            code: report.issues.get(code, [])
            for code in guarded_codes
            if report.issues.get(code)
        }
        if year_failures:
            failures.append(report.details())
    assert not failures, "\n\n".join(failures)


def test_year10_mcq_distractors_do_not_use_legacy_mechanical_templates() -> None:
    """Year 10 MCQs must require textual discrimination, not template spotting."""
    exercises = _load_json(DATA_DIR / "exercise_10_english.json")
    forbidden = (
        "through casual conversation",
        "single, obvious message",
        "without employing",
        "personal opinion about",
        "instead of analyzing",
    )
    offenders: list[str] = []
    for exercise in exercises:
        if exercise.get("question_type") != "multiple_choice":
            continue
        choice_text = " ".join(str(choice) for choice in exercise.get("choices") or []).lower()
        if any(pattern in choice_text for pattern in forbidden):
            offenders.append(str(exercise.get("id") or "unknown"))
    assert not offenders, f"Year 10 MCQs retain mechanical distractor templates: {offenders}"


def test_year10_student_prompts_hide_authoring_labels() -> None:
    """Internal generation labels must not appear in active student questions."""
    exercises = _load_json(DATA_DIR / "exercise_10_english.json")
    forbidden = (
        re.compile(r"\bversion\s+\d+\b", re.IGNORECASE),
        re.compile(r"evidence-effect-polished", re.IGNORECASE),
        re.compile(r"weak-response repair", re.IGNORECASE),
        re.compile(r"transfer-and-compare craft task", re.IGNORECASE),
        re.compile(r"simple-versus-nuanced interpretation", re.IGNORECASE),
    )
    offenders = [
        str(exercise.get("id") or "unknown")
        for exercise in exercises
        if any(pattern.search(str(exercise.get("question") or "")) for pattern in forbidden)
    ]
    assert not offenders, f"Year 10 questions expose authoring labels: {offenders}"


def test_year10_bank_rejects_generator_jargon_and_non_self_contained_comparison_prompts() -> None:
    exercises = _load_json(DATA_DIR / "exercise_10_english.json")
    forbidden = (
        "evidence point about",
        "hinge evidence",
        "a polished paragraph would",
        "a strong paragraph would",
        "another text studied in class",
        "select one other year 10 stimulus",
        "a polished sentence could argue",
        "this makes the plan senior-ready",
        "giving the audience a precise interpretive path rather than a summary",
        "its effect comes from",
        "the stronger reading explains how the evidence works",
    )
    jargon_offenders: list[str] = []
    comparison_offenders: list[str] = []
    for exercise in exercises:
        payload = json.dumps(exercise, ensure_ascii=False).lower()
        if any(phrase in payload for phrase in forbidden):
            jargon_offenders.append(str(exercise.get("id") or "unknown"))
        exercise_id = str(exercise.get("id") or "")
        if exercise_id.startswith("english_10_stim_ST_EN_Y10_") and exercise_id.endswith("_010"):
            question = str(exercise.get("question") or "").lower()
            if "self-contained comparative plan" not in question or "do not invent evidence" not in question:
                comparison_offenders.append(exercise_id)
    assert not jargon_offenders, f"Year 10 bank retains generator-facing wording: {jargon_offenders}"
    assert not comparison_offenders, f"Year 10 comparison plans are not self-contained: {comparison_offenders}"


def test_year10_model_answers_reject_known_generated_grammar_fragments() -> None:
    exercises = _load_json(DATA_DIR / "exercise_10_english.json")
    forbidden = (
        re.compile(r"\bbecause how\b", re.IGNORECASE),
        re.compile(r"\bthe text make\b", re.IGNORECASE),
        re.compile(r"\bthe text let\b", re.IGNORECASE),
        re.compile(r"\b(?:and|,) [a-z -]+ shapes how\b", re.IGNORECASE),
    )
    offenders: list[str] = []
    for exercise in exercises:
        response = " ".join(
            str(exercise.get(field) or "")
            for field in ("answer", "sample_reasoning")
        )
        if any(pattern.search(response) for pattern in forbidden):
            offenders.append(str(exercise.get("id") or "unknown"))
    assert not offenders, f"Year 10 model answers contain generated grammar fragments: {offenders}"


def test_year10_student_stimuli_do_not_pre_solve_analysis() -> None:
    library = _load_json(DATA_DIR / "english_stimuli.json")
    stimuli = library.get("stimuli", {})
    leakage_phrases = (
        "positions the audience",
        "inviting analysis",
        "the text invites readers",
        "careful readers should notice",
        "works as social speculation",
        "the structure puts disruption first",
        "turns appreciation into participation",
    )
    offenders: list[str] = []
    for stimulus_id, record in stimuli.items():
        if not str(stimulus_id).startswith("ST-EN-Y10-"):
            continue
        display = str((record.get("student_display") or {}).get("plain_text") or "")
        if any(phrase in display.lower() for phrase in leakage_phrases):
            offenders.append(str(stimulus_id))
        texts = record.get("texts") or []
        primary = next(
            (str(item.get("content") or "") for item in texts if isinstance(item, dict) and item.get("role") in {"extract", "stimulus"}),
            "",
        )
        if primary and primary != display:
            offenders.append(f"{stimulus_id}:display_text_mismatch")
    assert not offenders, f"Year 10 student stimuli leak analysis or diverge from source text: {offenders}"
