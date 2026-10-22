#!/usr/bin/env python3
"""Full AC9 English exercise-bank audit for Years 7-10.

This is the English counterpart to the full Science auditor. It keeps the same
repair-output workflow, but the checks are English-specific: stimulus integrity,
text evidence, analytical depth, language conventions, writing-structure tasks,
open-answer marking support, and exam-prep calibration.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, get_args

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from pydantic import ValidationError
    from core.algorithms.reasoning_rubric import normalise_reasoning_rubric
    from core.schema.exercise_schema import EnglishExerciseMetadata, ExerciseItem

    _facet_annotation = EnglishExerciseMetadata.model_fields["facet"].annotation
    _literal_type = next(arg for arg in get_args(_facet_annotation) if arg is not type(None))
    VALID_FACETS = set(get_args(_literal_type))
except Exception:  # pragma: no cover - fallback for running outside the project venv
    ValidationError = Exception  # type: ignore[assignment]
    ExerciseItem = None  # type: ignore[assignment]
    normalise_reasoning_rubric = None  # type: ignore[assignment]
    VALID_FACETS = {
        "reading_comprehension",
        "text_evidence",
        "language_conventions",
        "vocabulary",
        "writing_structure",
        "spelling_punctuation",
    }


DEFAULT_DATA_DIR = ROOT / "data"
DEFAULT_CURRICULUM_DIR = DEFAULT_DATA_DIR / "curriculum" / "ac9_english"
DEFAULT_STIMULI_FILE = DEFAULT_DATA_DIR / "english_stimuli.json"
DEFAULT_OUT_DIR = ROOT / "audit_output"

VALID_QTYPES = {"short_answer", "multiple_choice", "reasoning", "multi_part"}
VALID_DIFFICULTY = {"foundational", "developing", "extending"}
VALID_COMPLEXITY = {"simple_familiar", "complex_familiar", "complex_unfamiliar"}
VALID_PASSAGE_MODES = {"stimulus", "inline", "none"}
DELIVERY_SCOPES = {"private", "external"}
RUBRIC_TASK_TYPES = {
    "analytical_response",
    "comparative_response",
    "imaginative_writing",
    "persuasive_writing",
    "informative_writing",
}
PRIORITY_ORDER = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}
PASS_STATUS = "pass"

PASSAGE_FACETS = {"reading_comprehension", "text_evidence"}
CONVENTION_FACETS = {"language_conventions", "spelling_punctuation", "vocabulary"}

TOPIC_STRAND_BY_CODE = {
    "LA": "Language",
    "LE": "Literature",
    "LY": "Literacy",
}
FACETS_BY_TOPIC_STRAND = {
    "Language": {"reading_comprehension", "language_conventions", "vocabulary", "spelling_punctuation", "text_evidence", "writing_structure"},
    "Literature": {"reading_comprehension", "text_evidence", "vocabulary", "writing_structure"},
    "Literacy": {"reading_comprehension", "text_evidence", "writing_structure", "language_conventions", "spelling_punctuation", "vocabulary"},
}

STOP_WORDS = {
    "about", "above", "across", "after", "again", "answer", "because", "between",
    "could", "describe", "different", "during", "each", "english", "example",
    "explain", "following", "given", "identify", "include", "including",
    "language", "meaning", "passage", "question", "reader", "students", "their",
    "there", "these", "through", "using", "which", "while", "would", "write",
}
BAD_CONTENT_PATTERNS = (
    (re.compile(r"\bTODO\b|\bTEMPLATE\b|as an ai|\{\{[^}]+\}\}", re.I), "template_or_meta_text"),
    (re.compile(r"should deliberately adjust|this task requires analysis of|the important choice is", re.I), "formulaic_answer"),
    (re.compile(r"\(version\s+\d+", re.I), "generator_version_marker"),
)
MOJIBAKE_RE = re.compile(r"鈥|攕|擻|脳|�")
INLINE_TEXT_RE = re.compile(
    r"\*\*(?:passage|extract|micro-?text|short text|poem|stanza|text):\*\*|"
    r"\bmicro-?text\s*:|"
    r"\b(read|extract|stanza|poem|quote|evidence|lines?)\b.{0,140}:|"
    r"['\"\u2018\u2019\u201c\u201d].{20,}['\"\u2018\u2019\u201c\u201d]",
    re.I | re.S,
)
REFERENCES_TEXT_RE = re.compile(
    r"\b(?:the|this|above|following|supplied)\s+"
    r"(?:passage|extract|poem|article|stanza|micro-?text|text|panel|image|visual)\b",
    re.I,
)
ANALYTICAL_PROMPT_RE = re.compile(
    r"\b(analyse|analyze|evaluate|explain how|how does|effect|purpose|positions?|"
    r"theme|character|tone|mood|audience|perspective|compare|interpretation)\b",
    re.I,
)
ANALYTICAL_RESPONSE_PROMPT_RE = re.compile(
    r"\b(analyse|analyze|analytical paragraph|evaluate|explain how|interpret|compare|justify (?:which|why|your judgement))\b",
    re.I,
)
EVIDENCE_PROMPT_RE = re.compile(
    r"\b(evidence|quote|quotation|phrase|word choice|line|from the text|from the passage|"
    r"from the extract|support your answer|justify)\b",
    re.I,
)
EVIDENCE_RESPONSE_RE = re.compile(
    r"['\"\u2018\u2019\u201c\u201d].+['\"\u2018\u2019\u201c\u201d]|\b(evidence|quote|phrase|word choice|line|"
    r"the text says|the passage states|shows|suggests|implies|reveals|represents?|builds?|creates?|"
    r"contrasts?|language choice|because)\b",
    re.I | re.S,
)
EFFECT_RESPONSE_RE = re.compile(
    r"\b(effect|creates?|shows?|suggests?|implies?|reveals?|positions?|emphasises?|highlights?|"
    r"contrasts?|symbolises?|therefore|so that|audience|reader|purpose|theme|tone|mood|meaning)\b",
    re.I,
)
LOW_DEMAND_PROMPT_RE = re.compile(r"^\s*(what|which|who|where|when|identify|select|choose)\b", re.I)
PUNCTUATION_RE = re.compile(r"\b(punctuation|comma|apostrophe|quotation marks?|colon|semicolon|dash|full stop|capital letter)\b", re.I)
FIRST_NATIONS_RE = re.compile(
    r"\b(?:[Ff]irst Nations|[Ii]ndigenous|[Aa]boriginal|Torres Strait|[Ee]lder|Country|[Dd]reaming)\b"
)
SOURCE_BOUNDARY_RE = re.compile(r"\b(local|community|teacher-provided|approved|specific source|permission|respectful|protocol)\b", re.I)
QUOTE_RE = re.compile(
    r"\"([^\"\n]{2,160})\"|(?<![A-Za-z0-9])'((?:[^'\n]|(?<=[A-Za-z])'(?=[A-Za-z])){2,160})'(?![A-Za-z0-9])|"
    r"\u201c([^\u201d\n]{2,160})\u201d|(?<![A-Za-z0-9])\u2018((?:[^\u2019\n]|(?<=[A-Za-z])\u2019(?=[A-Za-z])){2,160})\u2019(?![A-Za-z0-9])"
)
HYPHEN_VARIANTS_RE = re.compile(r"[\u00ad\u2010\u2011\u2012\u2013\u2014\u2015\u2212]")
ANALYTICAL_TERM_QUOTES = {
    "direct address",
    "high angle",
    "low angle",
    "man vs nature",
    "man versus nature",
    "social distance",
    "vector line",
    "visual hierarchy",
}
INLINE_PASSAGE_BLOCK_RE = re.compile(
    r"\*\*(?:passage|extract|micro-?text|short text|poem|stanza|text):\*\*\s*"
    r"(.*?)\s*(?:\*\*(?:question|task|prompt):\*\*|$)",
    re.I | re.S,
)
QUESTION_TASK_BLOCK_RE = re.compile(
    r"\*\*(?:question|task|prompt):\*\*\s*(.*)$",
    re.I | re.S,
)
EMBEDDED_MICRO_TEXT_RE = re.compile(
    r"(?:\*\*micro-?text:\*\*|\buse\s+(?:this|the)\s+micro-?text\b|"
    r"\buse\s+evidence\s+from\s*:|\bexplain\s+its\s+effect\s*:)",
    re.I,
)
GENERATIVE_RESPONSE_PROMPT_RE = re.compile(
    r"\b(?:rewrite|revise|compose|draft|create|invent|replace|adapt|reframe|propose|"
    r"move\b.{0,50}\bdifferent position|construct\b.{0,60}\balternative|"
    r"write\b.{0,80}\b(?:framing|version|paragraphs?\s*[—-]\s*one using each))\b",
    re.I | re.S,
)
SOURCE_QUOTE_CONTEXT_RE = re.compile(
    r"\b(?:by using|the text says|the passage states|the extract|the phrase|the word|the sentence|"
    r"the clause|the metaphor|the image|the headline|the quotation|the quote|the evidence|"
    r"the revision from|the word family|the semicolon in|the dash in|the narrator|the speaker|"
    r"the writer|the author)\b",
    re.I,
)
NON_SOURCE_QUOTE_CONTEXT_RE = re.compile(
    r"\b(?:instead of|rather than|alternative|replacement|replace(?:s|d|ment)?|claim|"
    r"problem in this sentence|too broad|my version|would use|could use|might use|"
    r"for example|e\.g\.|such as|english idiom|reader (?:thinks|feels|might think)|"
    r"student (?:says|calls|argues|writes)|weak response|model response|work title|poem title|"
    r"common omission|misspell(?:ing|ed)?|do not|does not|not just|if the writer|if the poet|"
    r"calling .{0,30} worse|not synonymous|structure label|rhetorical question|"
    r"echoes|intertextual|allusion|reference to|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*'s poem)\b",
    re.I | re.S,
)
PHRASE_SUPPORT_RE = re.compile(
    r"\b(evidence|data|detail|example|visual|image|feature|phrase|word choice|line|quotation|quote|"
    r"the text says|the passage states|this wording|the wording|the phrase|the word|foreground|background|"
    r"source|perspective|voice|quoting)\b",
    re.I,
)


@dataclass(frozen=True)
class YearProfile:
    year: int
    label: str
    min_reasoning_points: int
    extension_note: str
    analysis_note: str
    overreach_terms: re.Pattern[str] | None = None


YEAR_PROFILES: dict[int, YearProfile] = {
    7: YearProfile(
        7,
        "Year 7: identity, literary value, visual techniques, vocabulary, text evidence, conventions and paragraph control",
        3,
        "Year 7 extending items should require evidence, interpretation, comparison, visual/language effect, or purposeful writing choices.",
        "Year 7 analysis should move beyond naming a feature into effect on meaning, audience or purpose.",
        re.compile(r"\b(modernism|postmodern|metafiction|intertextuality|ecocriticism|focalisation)\b", re.I),
    ),
    8: YearProfile(
        8,
        "Year 8: text structures, intertextuality, multimodal choices, argument, connotation and controlled syntax",
        3,
        "Year 8 extending items should use unfamiliar texts, comparisons, audience positioning, structural choices or argument evaluation.",
        "Year 8 analysis should connect evidence to positioning, context, structure or inferred meaning.",
        re.compile(r"\b(metafiction|postcolonial|stream of consciousness|deconstruction)\b", re.I),
    ),
    9: YearProfile(
        9,
        "Year 9: critical literacy, style, representation, argument, evaluative comparison and senior-readiness analysis",
        4,
        "Year 9 extending items should require evaluative judgement, multiple interpretations, structural comparison, or critical literacy.",
        "Year 9 analysis should justify how textual choices shape perspective, representation, value or audience response.",
    ),
    10: YearProfile(
        10,
        "Year 10: sophisticated interpretation, context, authorial style, comparative analysis and senior English preparation",
        4,
        "Year 10 extending items should resemble senior-prep: nuanced analysis, evaluation of representation, context, style and evidence.",
        "Year 10 analysis should sustain an interpretation with evidence and explain authorial purpose or audience positioning.",
    ),
}


@dataclass(frozen=True)
class TopicProfile:
    topic_id: str
    name: str
    strand: str
    keywords: set[str]


@dataclass
class IssueFlag:
    exercise_id: str
    priority: str
    category: str
    code: str
    message: str
    evidence: str = ""
    recommended_fix: str = ""
    confidence: str = "high"


AUDIT_COLUMNS = [
    "id",
    "topic",
    "primary_topic_id",
    "question_type",
    "difficulty",
    "complexity",
    "facet",
    "passage_mode",
    "passage_ref",
    "topic_alignment",
    "stimulus_integrity",
    "answer_key_quality",
    "evidence_quality",
    "analysis_quality",
    "conventions_quality",
    "writing_quality",
    "standards_support",
    "self_study",
    "exam_prep",
    "template_risk",
    "main_priority",
    "main_issue",
    "recommended_fix",
]
ISSUE_COLUMNS = [
    "exercise_id",
    "priority",
    "category",
    "code",
    "message",
    "evidence",
    "recommended_fix",
    "confidence",
]


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def walk_strings(value: Any):
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from walk_strings(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from walk_strings(item)


def words(value: Any) -> list[str]:
    return re.findall(r"[A-Za-z0-9%]+(?:[-'][A-Za-z0-9%]+)?", str(value or ""))


def wc(value: Any) -> int:
    return len(words(value))


def norm_text(value: Any) -> str:
    text = str(value or "").lower()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def keywords_from_text(text: str) -> set[str]:
    tokens = re.findall(r"[a-z][a-z0-9-]{3,}", text.lower())
    return {token for token in tokens if token not in STOP_WORDS}


def meta(ex: dict[str, Any]) -> dict[str, Any]:
    value = ex.get("english_metadata") or {}
    return value if isinstance(value, dict) else {}


def strip_choice_prefix(value: Any) -> str:
    return re.sub(r"^\s*\(?[A-Ea-e]\)?\s*[\).:-]?\s*", "", str(value or "").strip())


def topic_strand_from_id(topic_id: str) -> str:
    match = re.fullmatch(r"AC9E\d+(LA|LE|LY)\d+", str(topic_id))
    return TOPIC_STRAND_BY_CODE.get(match.group(1), "") if match else ""


def combined_text(ex: dict[str, Any], stimuli: dict[str, Any] | None = None) -> str:
    parts: list[str] = []
    for key in ["question", "answer", "sample_reasoning", "diagram_description"]:
        parts.append(str(ex.get(key) or ""))
    parts.extend(str(step) for step in ex.get("steps") or [])
    parts.extend(str(choice) for choice in ex.get("choices") or [])
    parts.append(json.dumps(meta(ex), ensure_ascii=False))
    for part in ex.get("sub_parts") or []:
        if isinstance(part, dict):
            parts.append(str(part.get("question") or ""))
            parts.append(str(part.get("answer") or ""))
    stim = stimulus_record(ex, stimuli or {})
    if stim:
        parts.append(str(stim.get("title") or ""))
        parts.append(" ".join(str(t) for t in stim.get("analysis_targets") or []))
        parts.append(str(stim.get("purpose") or ""))
        parts.append(str(stim.get("context") or ""))
    return " ".join(parts)


def response_text(ex: dict[str, Any]) -> str:
    parts = [str(ex.get("answer") or ""), str(ex.get("sample_reasoning") or "")]
    parts.extend(str(step) for step in ex.get("steps") or [])
    rubric = ex.get("rubric") if isinstance(ex.get("rubric"), dict) else {}
    if rubric:
        parts.extend(str(point) for point in rubric.get("key_points") or [])
        for key in ["correct_explanation", "full_credit", "partial_credit"]:
            if key in rubric:
                parts.append(str(rubric.get(key) or ""))
        distractor_feedback = rubric.get("distractor_feedback")
        if isinstance(distractor_feedback, dict):
            parts.extend(str(value) for value in distractor_feedback.values())
    for part in ex.get("sub_parts") or []:
        if isinstance(part, dict):
            parts.extend(str(part.get(field) or "") for field in ("answer", "sample_reasoning"))
            parts.extend(str(step) for step in part.get("steps") or [])
            part_rubric = part.get("rubric") if isinstance(part.get("rubric"), dict) else {}
            parts.extend(str(point) for point in part_rubric.get("key_points") or [])
            for key in ("correct_explanation", "full_credit", "partial_credit"):
                parts.append(str(part_rubric.get(key) or ""))
            parts.extend(str(choice) for choice in part.get("choices") or [])
    return " ".join(parts)


def prompt_text(ex: dict[str, Any]) -> str:
    parts = [str(ex.get("question") or "")]
    for part in ex.get("sub_parts") or []:
        if isinstance(part, dict):
            parts.append(str(part.get("question") or ""))
    return " ".join(parts)


def passage_ref(ex: dict[str, Any]) -> str:
    m = meta(ex)
    return str(m.get("stimulus_id") or m.get("passage") or "").strip()


def stimulus_record(ex: dict[str, Any], stimuli: dict[str, Any]) -> dict[str, Any] | None:
    ref = passage_ref(ex)
    record = stimuli.get(ref)
    return record if isinstance(record, dict) else None


def load_stimuli(path: Path = DEFAULT_STIMULI_FILE) -> dict[str, Any]:
    raw = load_json(path)
    if not isinstance(raw, dict) or not isinstance(raw.get("stimuli"), dict):
        return {}

    global_review = raw.get("source_rights_review")
    loaded: dict[str, Any] = {}
    for stimulus_id, record in raw["stimuli"].items():
        if not isinstance(record, dict):
            loaded[stimulus_id] = record
            continue
        merged = dict(record)
        if isinstance(global_review, dict) and not isinstance(merged.get("source_rights_review"), dict):
            merged["source_rights_review"] = dict(global_review)
        loaded[stimulus_id] = merged
    return loaded


def load_topic_profiles(year: int, curriculum_dir: Path = DEFAULT_CURRICULUM_DIR) -> dict[str, TopicProfile]:
    curriculum = load_json(curriculum_dir / f"year{year}.json")
    profiles: dict[str, TopicProfile] = {}
    for topic in curriculum.get("topics", []):
        topic_id = str(topic.get("topic_id") or "")
        profiles[topic_id] = TopicProfile(
            topic_id=topic_id,
            name=str(topic.get("name") or ""),
            strand=topic_strand_from_id(topic_id),
            keywords=keywords_from_text(" ".join(walk_strings(topic))),
        )
    return profiles


def add_issue(
    issues: list[IssueFlag],
    qid: str,
    priority: str,
    category: str,
    code: str,
    message: str,
    evidence: str = "",
    recommended_fix: str = "",
    confidence: str = "high",
) -> None:
    issues.append(
        IssueFlag(
            exercise_id=qid or "<missing>",
            priority=priority,
            category=category,
            code=code,
            message=message,
            evidence=evidence[:900],
            recommended_fix=recommended_fix[:900],
            confidence=confidence,
        )
    )


def best_issue(issues: list[IssueFlag], qid: str) -> IssueFlag | None:
    qissues = [issue for issue in issues if issue.exercise_id == qid]
    if not qissues:
        return None
    return sorted(qissues, key=lambda issue: PRIORITY_ORDER[issue.priority])[0]


def topic_alignment_status(
    ex: dict[str, Any],
    topic_profiles: dict[str, TopicProfile],
    stimuli: dict[str, Any],
) -> tuple[str, str]:
    topic_ids = [str(tid) for tid in ex.get("topic_ids") or []]
    if not topic_ids:
        return "missing_topic", "No topic_ids"
    primary = topic_ids[0]
    profile = topic_profiles.get(primary)
    if not profile:
        return "invalid_topic", f"{primary} is not in the curriculum"
    item_keywords = keywords_from_text(combined_text(ex, stimuli))
    overlap = sorted(item_keywords & profile.keywords)
    if len(overlap) >= 3:
        return "strong", ", ".join(overlap[:8])
    if len(overlap) >= 1:
        return "thin", ", ".join(overlap[:8])
    stim = stimulus_record(ex, stimuli)
    if stim and primary in set(stim.get("curriculum_links") or []):
        return "adequate_via_stimulus", f"{primary} is linked by stimulus {stim.get('id')}"
    return "weak", f"No meaningful keyword overlap with {primary}: {profile.name}"


def stimulus_integrity_status(ex: dict[str, Any], stimuli: dict[str, Any]) -> tuple[str, str]:
    m = meta(ex)
    facet = m.get("facet")
    mode = m.get("passage_mode")
    ref = passage_ref(ex)
    question = str(ex.get("question") or "")
    has_inline = bool(INLINE_TEXT_RE.search(question))

    if mode == "stimulus":
        if not ref:
            return "missing_stimulus_ref", "passage_mode='stimulus' but no passage/stimulus_id is present."
        record = stimuli.get(ref)
        if not isinstance(record, dict):
            return "unresolved_stimulus", f"{ref} is not in english_stimuli.json."
        plain_text = record.get("student_display", {}).get("plain_text")
        if not isinstance(plain_text, str) or not plain_text.strip():
            return "stimulus_missing_plain_text", f"{ref} has no student_display.plain_text."
        if m.get("passage") and m.get("stimulus_id") and m.get("passage") != m.get("stimulus_id"):
            return "stimulus_ref_mismatch", "english_metadata.passage and stimulus_id disagree."
        return "resolved", ref

    if mode == "inline":
        if has_inline:
            return "inline_present", ""
        if facet in PASSAGE_FACETS or REFERENCES_TEXT_RE.search(question):
            return "inline_text_missing", "passage_mode='inline' but the question has no clear embedded passage/extract."
        return "inline_unclear", "Inline mode is declared, but no explicit passage marker was detected."

    if mode == "none":
        if facet in PASSAGE_FACETS and REFERENCES_TEXT_RE.search(question):
            return "references_absent_text", "The question refers to a supplied text, but passage_mode is none."
        if facet in PASSAGE_FACETS:
            return "self_contained_reading", "Reading/evidence facet has no supplied text; review whether it is truly self-contained."
        return "not_applicable", ""

    return "missing_passage_mode", "english_metadata.passage_mode should be stimulus, inline or none."


def answer_key_quality_status(ex: dict[str, Any]) -> tuple[str, str]:
    qt = ex.get("question_type")
    if qt != "multiple_choice":
        return "not_applicable", ""
    choices = ex.get("choices")
    correct = str(ex.get("correct_choice") or "").strip().upper()
    if not isinstance(choices, list) or len(choices) < 2 or not correct:
        return "invalid_mcq", "MCQ needs choices and correct_choice."
    idx = ord(correct) - ord("A")
    if idx < 0 or idx >= len(choices):
        return "invalid_key", f"correct_choice={correct!r} is outside the choices list."
    normalised_choices = [norm_text(strip_choice_prefix(choice)) for choice in choices]
    if len(set(normalised_choices)) != len(normalised_choices):
        return "duplicate_choices", "MCQ choices are not distinct."
    answer = str(ex.get("answer") or "").strip()
    answer_norm = norm_text(strip_choice_prefix(answer))
    correct_norm = norm_text(strip_choice_prefix(choices[idx]))
    if answer.upper() == correct:
        return "aligned", ""
    if answer_norm and (answer_norm == correct_norm or answer_norm in correct_norm or correct_norm in answer_norm):
        return "aligned", ""
    return "answer_mismatch", f"answer={answer!r}; correct choice={choices[idx]!r}"


def extract_quotes(text: str) -> list[str]:
    quotes: list[str] = []
    for match in QUOTE_RE.finditer(text):
        quote = next((group for group in match.groups() if group), "")
        quote = re.sub(r"\s+", " ", quote.strip())
        if quote and len(quote) >= 2:
            quotes.append(quote)
    return quotes


def normalise_quote_text(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[\u2018\u2019]", "'", text)
    text = re.sub(r"[\u201c\u201d]", '"', text)
    text = HYPHEN_VARIANTS_RE.sub("-", text)
    text = re.sub(r"[^a-z0-9'\s-]", " ", text)
    # Remove quotation-boundary apostrophes while retaining apostrophes inside
    # words such as "writer's" or "don't".
    text = re.sub(r"(?<![a-z0-9])'|'(?![a-z0-9])", " ", text)
    text = re.sub(r"\s*-\s*", "-", text)
    return re.sub(r"\s+", " ", text).strip()


def is_analytical_term_quote(quote: str) -> bool:
    """Return True for quoted English metalanguage, not claimed source wording."""
    return normalise_quote_text(quote) in ANALYTICAL_TERM_QUOTES


def quote_found_in_stimulus(quote: str, stimulus_norm: str) -> bool:
    quote_norm = normalise_quote_text(quote)
    if quote_norm in stimulus_norm:
        return True
    parts = [
        normalise_quote_text(part)
        for part in re.split(r"\s*(?:\.{2,}|\u2026)\s*", quote)
        if normalise_quote_text(part)
    ]
    if len(parts) <= 1:
        return False
    position = 0
    for part in parts:
        found = stimulus_norm.find(part, position)
        if found < 0:
            return False
        position = found + len(part)
    return True


def stimulus_plain_text(record: dict[str, Any] | None) -> str:
    if not isinstance(record, dict):
        return ""
    display = record.get("student_display")
    if isinstance(display, dict) and isinstance(display.get("plain_text"), str):
        return display["plain_text"]
    return ""


def stimulus_searchable_text(record: dict[str, Any] | None) -> str:
    """Return the exact sidecar text delivered by the current student runtime.

    Authoring fields such as ``texts.content`` and ``effect`` are editorial
    metadata.  They can help a full reviewer inspect the authoring record, but
    cannot validate a quotation because students do not receive them.
    """
    return stimulus_plain_text(record)


def inline_passage_text(ex: dict[str, Any]) -> str:
    match = INLINE_PASSAGE_BLOCK_RE.search(str(ex.get("question") or ""))
    return match.group(1).strip() if match else ""


def inline_task_text(ex: dict[str, Any]) -> str:
    match = QUESTION_TASK_BLOCK_RE.search(str(ex.get("question") or ""))
    return match.group(1).strip() if match else ""


def claimed_source_quotes_in_response(
    ex: dict[str, Any],
    response: str,
    source_text: str,
) -> list[str]:
    """Return only response quotes that plausibly claim wording from the supplied text.

    English model answers often quote invented alternatives, reader reactions, work
    titles or deliberately misspelled forms. Those should not be treated as failed
    source quotations. Missing wording is flagged only when the surrounding prose
    presents it as evidence from the source.
    """
    source_norm = normalise_quote_text(source_text)
    task_norm = normalise_quote_text(inline_task_text(ex))
    generative_task = bool(GENERATIVE_RESPONSE_PROMPT_RE.search(prompt_text(ex)))
    claimed: list[str] = []

    for match in QUOTE_RE.finditer(response):
        quote = next((group for group in match.groups() if group), "")
        quote = re.sub(r"\s+", " ", quote.strip())
        if not quote or is_analytical_term_quote(quote):
            continue

        quote_norm = normalise_quote_text(quote)
        if quote_found_in_stimulus(quote, source_norm):
            claimed.append(quote)
            continue

        # A quoted phrase repeated from the task itself is usually a student's
        # claim, a framing label or other metalinguistic wording, not source text.
        if task_norm and quote_norm and quote_norm in task_norm:
            continue

        before = response[max(0, match.start() - 150):match.start()]
        after = response[match.end():match.end() + 120]
        context = f"{before} {after}"
        if NON_SOURCE_QUOTE_CONTEXT_RE.search(context):
            continue

        explicit_source_claim = bool(
            SOURCE_QUOTE_CONTEXT_RE.search(before)
            or re.match(
                r"\s*(?:uses?|shows?|suggests?|implies?|reveals?|creates?|positions?|functions?|is\s+(?:a|an)\b)",
                after,
                re.I,
            )
        )
        if generative_task and not explicit_source_claim:
            continue
        if explicit_source_claim:
            claimed.append(quote)

    return claimed


def is_evidence_verification_task(ex: dict[str, Any]) -> bool:
    facet = meta(ex).get("facet")
    prompt = prompt_text(ex)
    if facet not in PASSAGE_FACETS and not EVIDENCE_PROMPT_RE.search(prompt):
        return False
    # Writing/revision tasks often quote the new wording they are proposing;
    # those strings are not claims about wording already present in the source.
    if re.search(r"\b(?:rewrite|revise|compose|draft|create|invent|suggest a revision)\b", prompt, re.I):
        return False
    if re.search(r"\b(?:weak|student|sample|model) response\b|evaluate (?:this|the) response", prompt, re.I):
        return False
    return True


def claimed_source_quotes_in_prompt(ex: dict[str, Any]) -> list[str]:
    prompt = prompt_text(ex)
    claimed: list[str] = []
    for match in QUOTE_RE.finditer(prompt):
        before = prompt[max(0, match.start() - 140):match.start()]
        if re.search(
            r"\b(?:student writes|weak (?:analytical )?response|sample response|model response|"
            r"turn the claim|problem in this sentence|replace)\b",
            before,
            re.I,
        ):
            continue
        if re.search(
            r"\b(?:text|passage|extract|stimulus|article|poem|discussion|speaker|character|narrator|author|writer|poster)\b"
            r".{0,90}\b(?:says?|states?|reads?|includes?|uses?|writes?|calls?|describes?)\b",
            before,
            re.I | re.S,
        ):
            quote = next((group for group in match.groups() if group), "")
            if quote and not is_analytical_term_quote(quote):
                claimed.append(re.sub(r"\s+", " ", quote.strip()))
    return claimed


def evidence_to_stimulus_findings(ex: dict[str, Any], stimuli: dict[str, Any]) -> list[tuple[str, str]]:
    m = meta(ex)
    mode = m.get("passage_mode")
    verify_response = is_evidence_verification_task(ex)
    prompt_quotes = claimed_source_quotes_in_prompt(ex) if mode == "stimulus" else []
    if not verify_response and not prompt_quotes:
        return []
    if EMBEDDED_MICRO_TEXT_RE.search(prompt_text(ex)):
        # Some legacy adaptive items carry a sidecar reference even though the
        # complete micro-text is already embedded in the student-facing prompt.
        # Audit the material the student actually sees and do not treat the
        # unrelated sidecar as the quotation source.
        source_text = prompt_text(ex)
    elif mode == "stimulus":
        source_text = stimulus_searchable_text(stimulus_record(ex, stimuli))
    elif mode == "inline":
        source_text = inline_passage_text(ex)
    else:
        return []
    if not source_text:
        return []

    rubric = ex.get("rubric") if isinstance(ex.get("rubric"), dict) else {}
    mcq_support_parts = [str(rubric.get("correct_explanation") or "")]
    if ex.get("question_type") == "multiple_choice":
        choices = ex.get("choices") or []
        correct = str(ex.get("correct_choice") or "").strip().upper()
        index = ord(correct) - ord("A") if len(correct) == 1 else -1
        if 0 <= index < len(choices):
            mcq_support_parts.append(str(choices[index]))
    mcq_support_parts.extend(
        str(point)
        for point in rubric.get("key_points") or []
        if re.match(r"^\s*Correct\s+choice\b", str(point), re.I)
    )
    rubric_support_text = " ".join(part for part in mcq_support_parts if part)
    authored_response = " ".join(str(ex.get(key) or "") for key in ["answer", "sample_reasoning"])
    quotes = list(prompt_quotes)
    if verify_response:
        quotes.extend(claimed_source_quotes_in_response(ex, authored_response, source_text))
    stimulus_norm = normalise_quote_text(source_text)
    findings: list[tuple[str, str]] = []
    seen_quotes: set[str] = set()
    for quote in quotes:
        quote_norm = normalise_quote_text(quote)
        if quote_norm in seen_quotes:
            continue
        seen_quotes.add(quote_norm)
        if not quote_found_in_stimulus(quote, stimulus_norm):
            findings.append(("quote_not_found_in_stimulus", quote))

    prompt = prompt_text(ex)
    rubric_text = json.dumps(rubric, ensure_ascii=False)
    if EVIDENCE_PROMPT_RE.search(prompt):
        support_text = " ".join([authored_response, rubric_support_text, rubric_text])
        if not quotes and not extract_quotes(rubric_support_text) and not PHRASE_SUPPORT_RE.search(support_text):
            findings.append(("evidence_support_thin", "Evidence/quote task has no quote or phrase support in answer, sample_reasoning or rubric."))
    return findings


def evidence_quality_status(ex: dict[str, Any], stimuli: dict[str, Any]) -> tuple[str, str]:
    m = meta(ex)
    facet = m.get("facet")
    prompt = prompt_text(ex)
    response = response_text(ex)
    needs_evidence = (
        facet == "text_evidence"
        or EVIDENCE_PROMPT_RE.search(prompt)
        or (facet == "reading_comprehension" and ANALYTICAL_PROMPT_RE.search(prompt))
    )
    if not needs_evidence:
        return "not_applicable", ""
    stim_status, _ = stimulus_integrity_status(ex, stimuli)
    if stim_status in {"unresolved_stimulus", "missing_stimulus_ref", "inline_text_missing", "references_absent_text"}:
        return "blocked_by_missing_text", "Evidence task cannot be checked until the referenced text is present."
    if EVIDENCE_RESPONSE_RE.search(response):
        return "adequate", ""
    if ex.get("question_type") == "multiple_choice":
        rubric = ex.get("rubric") if isinstance(ex.get("rubric"), dict) else {}
        if "correct choice" in json.dumps(rubric, ensure_ascii=False).lower():
            return "adequate", ""
    return "thin", "Text-evidence task lacks quote, phrase, line reference, or explicit evidence-to-claim wording in answer/rubric."


def analysis_quality_status(ex: dict[str, Any], profile: YearProfile) -> tuple[str, str]:
    prompt = prompt_text(ex)
    if not ANALYTICAL_PROMPT_RE.search(prompt):
        return "not_applicable", ""
    response = response_text(ex)
    if ex.get("question_type") == "multiple_choice":
        rubric = ex.get("rubric") if isinstance(ex.get("rubric"), dict) else {}
        rubric_text = " ".join(str(point) for point in rubric.get("key_points") or [])
        if re.search(r"\bcorrect choice\b", rubric_text, re.I) and wc(rubric_text) >= 10:
            return "adequate", ""
    rubric = ex.get("rubric") if isinstance(ex.get("rubric"), dict) else {}
    key_points = rubric.get("key_points") if isinstance(rubric, dict) else None
    max_score = int(rubric.get("max_score") or 0) if isinstance(rubric, dict) else 0
    if ex.get("question_type") in {"reasoning", "multi_part"} and (
        not isinstance(key_points, list) or len(key_points) < profile.min_reasoning_points or max_score < profile.min_reasoning_points
    ):
        return "rubric_too_thin", f"Analytical item needs at least {profile.min_reasoning_points} task-specific rubric points/marks."
    if not EFFECT_RESPONSE_RE.search(response):
        return "thin_effect_link", "Model support names content but does not clearly link technique/evidence to effect, meaning, audience or purpose."
    if profile.year >= 9 and ex.get("difficulty") == "extending":
        if not re.search(r"\b(evaluate|nuance|complex|alternative|perspective|representation|context|judgement|interpretation)\b", response, re.I):
            return "senior_prep_thin", "Year 9-10 extending analysis should model evaluative or nuanced interpretation."
    return "adequate", ""


def conventions_quality_status(ex: dict[str, Any]) -> tuple[str, str]:
    m = meta(ex)
    facet = m.get("facet")
    if facet not in CONVENTION_FACETS:
        return "not_applicable", ""
    prompt = prompt_text(ex)
    response = response_text(ex)
    if not m.get("grammar_focus"):
        return "missing_focus", f"{facet} item should declare english_metadata.grammar_focus."
    if facet == "spelling_punctuation" and ex.get("question_type") == "short_answer" and PUNCTUATION_RE.search(prompt):
        if not ex.get("strict_punctuation"):
            return "punctuation_not_strict", "Punctuation task should set strict_punctuation=true for deterministic marking."
        rubric_text = json.dumps(ex.get("rubric") or {}, ensure_ascii=False)
        if not re.search(r"[,.;:'\"!?()\-\u2014]", str(ex.get("answer") or "") + " " + rubric_text):
            return "punctuation_answer_unclear", "Punctuation task answer does not visibly include the target punctuation."
    if facet == "vocabulary" and ex.get("question_type") == "short_answer":
        variants = (ex.get("alternative_answers") or []) + (m.get("accepted_answer_variants") or [])
        if len(variants) < 2 and wc(ex.get("answer")) <= 4:
            return "vocabulary_variants_thin", "Short vocabulary answers should include accepted variants/synonyms."
    convention_text = " ".join([prompt, response, str(m.get("grammar_focus") or "")])
    if facet == "language_conventions" and not re.search(r"\b(grammar|clause|sentence|tense|verb|noun|adjective|adverb|pronoun|cohesion|syntax|punctuation|modality|nominalisation|voice|register|role|relationship|interaction|discussion|debate|language choices?|audience awareness|positioning|formal|informal|abstract vocabulary)\b", convention_text, re.I):
        return "convention_language_unclear", "Language-conventions item is not clearly anchored in a grammar or syntax concept."
    return "adequate", ""


def writing_quality_status(ex: dict[str, Any], profile: YearProfile) -> tuple[str, str]:
    m = meta(ex)
    if m.get("facet") != "writing_structure":
        return "not_applicable", ""
    if not m.get("writing_skill"):
        return "missing_writing_skill", "Writing-structure item should declare english_metadata.writing_skill."
    prompt = prompt_text(ex)
    response = response_text(ex)
    asks_creation = bool(re.search(r"\b(write|rewrite|compose|draft|plan|paragraph|introduction|conclusion|structure)\b", prompt, re.I))
    if asks_creation and ex.get("question_type") in {"reasoning", "multi_part"}:
        rubric = ex.get("rubric") if isinstance(ex.get("rubric"), dict) else {}
        if not rubric.get("key_points") or int(rubric.get("max_score") or 0) < profile.min_reasoning_points:
            return "writing_rubric_thin", "Writing task needs a rubric covering purpose, structure, cohesion and language choices."
    if asks_creation and not re.search(r"\b(audience|purpose|cohesion|structure|paragraph|topic sentence|evidence|elaboration|tone|register|modality)\b", response, re.I):
        return "writing_model_thin", "Model support should name the writing craft choices being practised."
    return "adequate", ""


def progressive_rubric_is_task_specific(ex: dict[str, Any], key_points: list[Any]) -> bool:
    """Recognise specific C/B/A rubrics without accepting generic level templates."""
    if len(key_points) != 3 or not all(isinstance(point, str) for point in key_points):
        return False
    level_patterns = [r"^\s*C-level\s*:", r"^\s*B-level\s*:", r"^\s*A-level\s*:"]
    if not all(re.match(pattern, point, re.I) for pattern, point in zip(level_patterns, key_points)):
        return False

    combined = " ".join(key_points)
    if re.search(
        r"identif(?:y|ies) relevant feature\s*/\s*evidence|"
        r"explains? the feature'?s effect using appropriate metalanguage|"
        r"analyses? how the feature shapes meaning, audience response, purpose or context",
        combined,
        re.I,
    ):
        return False

    prompt_terms = keywords_from_text(prompt_text(ex))
    rubric_terms = keywords_from_text(combined)
    task_overlap = prompt_terms & rubric_terms
    c_level, b_level, a_level = key_points
    c_specific = bool(extract_quotes(c_level)) or len(task_overlap) >= 1 or bool(
        re.search(r"\b(?:specific|such as|e\.g\.|contrast between|includes?|provides?|final action|headings?)\b", c_level, re.I)
    )
    b_explains = bool(re.search(
        r"\b(explain|effect|metalanguage|language|structure|technique|imagery|metaphor|simile|"
        r"personification|clause|tense|punctuation|suffix|morpholog|layout|salience|hierarchy|"
        r"rhythm|sound|tone|modality|cohesion|foreground|typograph|word choice|contrast|"
        r"juxtaposition|concession|acknowledg|heading|organis|chronolog|spatial|colour|color|"
        r"graph|photograph|dialogue|placement|sequence)\b",
        b_level,
        re.I,
    ))
    a_analyses = bool(re.search(
        r"\b(analy[sz]|meaning|audience|reader|purpose|context|interpret|position|theme|judg|"
        r"response|significance|identity|belonging|credibility|persuasi)\w*\b",
        a_level,
        re.I,
    ))
    return c_specific and b_explains and a_analyses


def task_specific_rubric_is_adequate(ex: dict[str, Any], key_points: list[Any]) -> bool:
    """Accept a clear task-specific rubric even when it does not use fixed dimension labels.

    English tasks include analysis, transformation, multimodal design, discussion and
    spelling strategy evaluation. A usable rubric may name the exact operations and
    outcomes without literally saying "interpretation", "evidence" or "structure".
    This check requires substantial prompt overlap, distinct assessable actions and
    both a concrete performance requirement and a reasoning/outcome requirement.
    """
    if len(key_points) < 3 or not all(isinstance(point, str) and wc(point) >= 4 for point in key_points):
        return False

    rubric = ex.get("rubric") if isinstance(ex.get("rubric"), dict) else {}
    try:
        max_score = float(rubric.get("max_score") or 0)
    except (TypeError, ValueError):
        return False
    if max_score < 3:
        return False

    combined = " ".join(str(point) for point in key_points)
    normalised_points = [norm_text(point) for point in key_points]
    if len(set(normalised_points)) != len(normalised_points):
        return False
    if re.search(
        r"\b(?:answers? the question|uses? complete sentences?|checks? (?:the|your) answer|"
        r"includes? relevant ideas?|shows? understanding)\b",
        combined,
        re.I,
    ):
        return False

    prompt_terms = keywords_from_text(prompt_text(ex))
    rubric_terms = keywords_from_text(combined)
    task_overlap = prompt_terms & rubric_terms
    stimulus_specific = (
        meta(ex).get("passage_mode") == "stimulus"
        and bool(re.search(r"\b(?:from the passage|specific evidence|precise detail)\b", combined, re.I))
    )
    if len(task_overlap) < 1 and not stimulus_specific:
        return False

    action_patterns = {
        "identify": r"\b(?:identif|select|name|locate|recognis|recogniz)\w*\b",
        "explain": r"\b(?:explain|connect|show|describe|interpret|acknowledg)\w*\b",
        "analyse": r"\b(?:analy[sz]|compar|evaluat|justif|judg|reflect|consider|assess)\w*\b",
        "produce": r"\b(?:writ|rewrit|design|creat|draft|propos|replac|revis|construct|adapt)\w*\b",
        "support": r"\b(?:use|support|embed|cite|referenc)\w*\b",
    }
    action_count = sum(bool(re.search(pattern, combined, re.I)) for pattern in action_patterns.values())
    if action_count < 2:
        return False

    has_concrete_requirement = len(task_overlap) >= 2 or bool(re.search(
        r"\b(?:specific|evidence|example|detail|quotation|quote|extract|stimulus|wording|"
        r"alternative|version|paragraph|sentence|feature|strategy|design|source|response|passage)\b",
        combined,
        re.I,
    ))
    has_reasoning_or_outcome = bool(re.search(
        r"\b(?:effect|audience|purpose|meaning|interpret|judg|evaluat|explain|connect|"
        r"clarity|tone|cohesion|structure|context|position|value|credibility|accuracy|"
        r"suitab|effective|reader|user|relationship|authority|accessibility|mood)\w*\b",
        combined,
        re.I,
    ))
    return has_concrete_requirement and has_reasoning_or_outcome


def task_contract_findings(ex: dict[str, Any]) -> list[tuple[str, str]]:
    """Detect prompt, rubric and model-answer contracts that assess different tasks."""
    prompt = prompt_text(ex)
    rubric = ex.get("rubric") if isinstance(ex.get("rubric"), dict) else {}
    rubric_text = " ".join(str(point) for point in rubric.get("key_points") or [])
    answer_text = " ".join(
        str(ex.get(field) or "") for field in ("answer", "sample_reasoning")
    )
    findings: list[tuple[str, str]] = []

    comparison_prompt = bool(re.search(
        r"\b(?:compare two (?:plausible )?interpretations|compare a literal reading with an analytical reading|"
        r"compare two readings)\b",
        prompt,
        re.I,
    ))
    weak_response_prompt = bool(re.search(
        r"\b(?:weak-response|weak response|student response has this flaw|explain the weakness|repair)\b",
        prompt,
        re.I,
    ))
    weak_rubric = bool(re.search(
        r"\b(?:diagnoses? the weakness|repair the explanation|revised response|weakens analysis)\b",
        rubric_text,
        re.I,
    ))
    comparison_rubric = bool(re.search(
        r"\b(?:literal reading|analytical reading|two (?:plausible )?interpretations|both readings|"
        r"which reading|explanatory strength)\b",
        rubric_text,
        re.I,
    ))

    if comparison_prompt and weak_rubric and not comparison_rubric:
        findings.append((
            "rubric_task_mismatch",
            "Comparison prompt is paired with a weak-response repair rubric.",
        ))
    elif weak_response_prompt and comparison_rubric and not weak_rubric:
        findings.append((
            "rubric_task_mismatch",
            "Weak-response repair prompt is paired with a comparison rubric.",
        ))

    if comparison_prompt:
        first_reading = bool(re.search(
            r"\b(?:(?:one|first) (?:possible )?(?:reading|interpretation)|a literal interpretation)\b",
            answer_text,
            re.I,
        ))
        second_reading = bool(re.search(
            r"\b(?:another (?:possible )?(?:reading|interpretation)|a second (?:reading|interpretation)|"
            r"the second (?:reading|interpretation)|an analytical interpretation|"
            r"another (?:is|sees|argues|interprets|reads|focuses|treats|presents))\b",
            answer_text,
            re.I,
        ))
        paired_views = bool(re.search(
            r"\bone (?:post|text|perspective|account|view)\b.{0,300}\b(?:the )?other\b",
            answer_text,
            re.I | re.S,
        ))
        prompt_names_alternatives = bool(re.search(
            r"(?:\bone where\b.{0,160}\bone where\b|"
            r"\b(?:reading|interpretation)s?\b.{0,180}\bor\b|"
            r"\bwhether\b.{0,180}\bor\b)",
            prompt,
            re.I | re.S,
        ))
        contrastive_answer = bool(re.search(
            r"\b(?:but|while|whereas|however|also|on the other hand)\b",
            answer_text,
            re.I,
        ))
        has_two_readings = (
            (first_reading and second_reading)
            or paired_views
            or (prompt_names_alternatives and contrastive_answer)
        )
        has_judgement = bool(re.search(
            r"\b(?:stronger|more defensible|more convincing|better explains?|most defensible|"
            r"neither reading is universally stronger)\b",
            answer_text,
            re.I,
        ))
        if not has_two_readings or not has_judgement:
            findings.append((
                "comparison_model_answer_mismatch",
                "Comparison model answer must present two distinct readings and justify a judgement.",
            ))

    return findings


EXPLICIT_PART_LABEL_RE = re.compile(
    r"\b(?:part\s+)?([a-d])\s*\)",
    re.IGNORECASE,
)
STEP_PART_LABEL_RE = re.compile(r"\bpart\s+([a-z])\b", re.IGNORECASE)


def explicit_part_labels(value: str, *, steps: bool = False) -> set[str]:
    labels = {match.group(1).lower() for match in EXPLICIT_PART_LABEL_RE.finditer(value)}
    if steps:
        labels.update(match.group(1).lower() for match in STEP_PART_LABEL_RE.finditer(value))
    return labels


def multipart_contract_findings(ex: dict[str, Any]) -> list[tuple[str, str]]:
    """Compare authored labelled root fields with the actual sub-part contract.

    Only compare fields that deliberately use part labels.  This preserves valid
    prose model answers while catching orphaned or missing ``a)``/``Part a``
    content deterministically.
    """
    parts = ex.get("sub_parts") or []
    expected = {
        str(part.get("label") or "").strip().lower()
        for part in parts
        if isinstance(part, dict) and str(part.get("label") or "").strip()
    }
    if not expected:
        return []
    rubric = ex.get("rubric") if isinstance(ex.get("rubric"), dict) else {}
    fields = {
        "answer": (str(ex.get("answer") or ""), False),
        "steps": ("\n".join(str(step) for step in ex.get("steps") or []), True),
        "rubric": ("\n".join(str(point) for point in rubric.get("key_points") or []), False),
    }
    findings: list[tuple[str, str]] = []
    for field, (value, is_steps) in fields.items():
        labels = explicit_part_labels(value, steps=is_steps)
        # A single "for part c" direction can legitimately supplement generic
        # whole-item steps. Treat it as a contract only when the steps actually
        # enumerate multiple labels.
        if "a" in labels and (not is_steps or len(labels) > 1) and labels != expected:
            missing = ", ".join(sorted(expected - labels)) or "none"
            orphaned = ", ".join(sorted(labels - expected)) or "none"
            findings.append((
                "multipart_root_label_mismatch",
                f"{field} labels={','.join(sorted(labels))}; expected={','.join(sorted(expected))}; "
                f"missing={missing}; orphaned={orphaned}.",
            ))
    return findings


def multi_part_choice_findings(ex: dict[str, Any]) -> list[tuple[str, str]]:
    """Validate MCQ semantics for choice-bearing sub-parts."""
    findings: list[tuple[str, str]] = []
    for index, part in enumerate(ex.get("sub_parts") or []):
        if not isinstance(part, dict) or not part.get("choices"):
            continue
        label = str(part.get("label") or index)
        choices = part.get("choices") or []
        correct = str(part.get("correct_choice") or "").strip().upper()
        if len(choices) < 2 or len(choices) != len({str(choice) for choice in choices}):
            findings.append(("multipart_mcq_choices_invalid", f"Sub-part {label} has invalid or duplicate choices."))
            continue
        choice_index = ord(correct) - ord("A") if len(correct) == 1 else -1
        if choice_index < 0 or choice_index >= len(choices):
            findings.append(("multipart_mcq_missing_or_invalid_key", f"Sub-part {label} needs a correct_choice matching its choices."))
            continue
        answer = str(part.get("answer") or "").strip()
        selected = strip_choice_prefix(choices[choice_index])
        if answer.upper() in {"A", "B", "C", "D", "E"}:
            answer_matches = answer.upper() == correct
        else:
            answer_matches = norm_text(answer) in {norm_text(selected), norm_text(str(choices[choice_index]))}
        if not answer_matches:
            findings.append(("multipart_mcq_answer_mismatch", f"Sub-part {label} answer does not match correct_choice {correct}."))
    return findings


def multipart_marking_findings(ex: dict[str, Any]) -> list[tuple[str, str, str]]:
    """Require authored scoring rules for high-mark open sub-parts.

    ``derive_multi_part_rubric`` remains a runtime fallback only.  It must not
    convert an un-authored marking contract into a clean content-audit result.

    Root rubric vs sub-part mark totals only apply when the item actually has
    ``sub_parts``. Single-response reasoning/MCQ items with a root rubric and
    no sub_parts must not be reported as multipart mark mismatches (empty
    sub_parts sum to 0 and would otherwise false-positive every max_score>0 item).
    """
    findings: list[tuple[str, str, str]] = []
    parts = [part for part in (ex.get("sub_parts") or []) if isinstance(part, dict)]
    total_marks = sum(
        float(part.get("max_score", part.get("marks", 1)) or 1)
        for part in parts
    )
    root_rubric = ex.get("rubric") if isinstance(ex.get("rubric"), dict) else {}
    # Only compare root ceiling to sub-part mark sum when multipart structure exists.
    if parts and root_rubric and normalise_reasoning_rubric:
        contract = normalise_reasoning_rubric(root_rubric)
        if contract.get("valid") and float(contract.get("max_score") or 0) != total_marks:
            findings.append((
                "P2",
                "multipart_effective_mark_mismatch",
                f"Root rubric can award {contract.get('max_score')}; sub-parts declare {total_marks:g} marks.",
            ))
    for index, part in enumerate(parts):
        if not isinstance(part, dict) or part.get("choices"):
            continue
        label = str(part.get("label") or index)
        try:
            marks = float(part.get("max_score", part.get("marks", 1)) or 1)
        except (TypeError, ValueError):
            marks = 1
        if marks <= 1:
            continue
        rubric = part.get("rubric") if isinstance(part.get("rubric"), dict) else None
        if not rubric:
            findings.append((
                "P2",
                "multipart_part_rubric_missing",
                f"High-mark open sub-part {label} ({marks:g} marks) has no authored part rubric; a derived fallback is not audit evidence.",
            ))
            continue
        contract = normalise_reasoning_rubric(rubric) if normalise_reasoning_rubric else {"valid": False}
        if not contract.get("valid") or float(contract.get("max_score") or 0) != marks:
            findings.append((
                "P1",
                "multipart_part_rubric_invalid",
                f"High-mark open sub-part {label} rubric is invalid or does not award its declared {marks:g} marks.",
            ))
    return findings


def rubric_dimension_status(ex: dict[str, Any]) -> tuple[str, str]:
    prompt = prompt_text(ex)
    facet = meta(ex).get("facet")
    explicit_task_type = meta(ex).get("task_type")
    if explicit_task_type in RUBRIC_TASK_TYPES:
        task_type = explicit_task_type
    elif ANALYTICAL_RESPONSE_PROMPT_RE.search(prompt) and ex.get("question_type") in {"reasoning", "multi_part"}:
        task_type = "comparative_response" if re.search(r"\bcompar", prompt, re.I) else "analytical_response"
    elif facet == "writing_structure" and ex.get("question_type") in {"reasoning", "multi_part"} and re.search(
        r"\b(?:write|rewrite|revise|compose|draft|plan|paragraph|opening|introduction|conclusion)\b",
        prompt,
        re.I,
    ):
        task_type = "writing_response"
    else:
        return "not_applicable", ""

    if ex.get("question_type") == "multi_part" and normalise_reasoning_rubric:
        unsupported: list[str] = []
        for part in ex.get("sub_parts") or []:
            if not isinstance(part, dict):
                continue
            if part.get("choices"):
                continue
            try:
                marks = float(part.get("max_score", part.get("marks", 1)) or 1)
            except (TypeError, ValueError):
                marks = 1
            if marks <= 1:
                continue
            part_rubric = part.get("rubric") if isinstance(part.get("rubric"), dict) else None
            contract = normalise_reasoning_rubric(part_rubric) if part_rubric else {"valid": False, "max_score": 0}
            if not contract["valid"] or float(contract["max_score"]) != marks:
                unsupported.append(str(part.get("label") or "?"))
        if not unsupported:
            return "adequate", ""
        return "rubric_dimensions_thin", f"Open sub-parts lack usable scoring criteria: {', '.join(unsupported)}."

    rubric = ex.get("rubric") if isinstance(ex.get("rubric"), dict) else {}
    key_points = (rubric.get("key_points") or []) if isinstance(rubric, dict) else []
    rubric_text = " ".join(str(point) for point in key_points).lower()
    if not rubric_text.strip():
        return "rubric_dimensions_thin", "Analytical or writing tasks need a rubric with task-specific dimensions."

    if task_type in {"analytical_response", "comparative_response"}:
        if progressive_rubric_is_task_specific(ex, key_points) or task_specific_rubric_is_adequate(ex, key_points):
            return "adequate", ""
        required = {
            "interpretation/understanding": r"\b(interpret(?:s|ed|ing|ation)?|understand(?:s|ing)?|comprehension|meaning|idea|theme|argument|viewpoint|judg(?:e)?ment|evaluat(?:e|es|ed|ing|ion)|position(?:s|ing)?|perspective|identif(?:y|ies|ied))\b",
            "evidence": r"\b(evidence|quote|quotation|phrase|example|reference|line|detail|specific reason|support(?:ing|s|ed)?|stimulus|extract)\b",
            "language/structure analysis": r"\b(language|structure|technique|feature|form|word choice|wording|imagery|syntax|cohesion|visual|symbol|metalanguage|register|address|label|evaluative|effect|layout|salience|hierarchy|hyperlink|foreground|background|typograph|modality|morpholog|suffix|tense|clause|punctuation|rhythm|sound|personification|metaphor|simile|framing|positioning|composition|repetition|allusion|intertextuality|contrast|juxtaposition|tone|mood|voice|sequence|organisation)\b",
        }
        missing = [label for label, pattern in required.items() if not re.search(pattern, rubric_text, re.I)]
        if missing:
            return "rubric_dimensions_thin", f"Rubric is missing: {', '.join(missing)}."
        return "adequate", ""

    if progressive_rubric_is_task_specific(ex, key_points) or task_specific_rubric_is_adequate(ex, key_points):
        return "adequate", ""

    writing_dimensions = {
        "purpose/audience": r"\b(purpose|audience|reader|tone|register|persuade|inform|entertain|position)\b",
        "structure/cohesion": r"\b(structure|cohesion|paragraph|sequence|opening|conclusion|organisation|transition)\b",
        "vocabulary/language choices": r"\b(vocabulary|language choice|word choice|description|imagery|modality|voice|figurative)\b",
        "sentence control": r"\b(sentence|syntax|punctuation|clause|control|fluency|grammar)\b",
    }
    covered = [label for label, pattern in writing_dimensions.items() if re.search(pattern, rubric_text, re.I)]
    if len(covered) < 2:
        return "rubric_dimensions_thin", "Writing rubric should cover at least two of purpose/audience, structure/cohesion, vocabulary/language choices, and sentence control."
    return "adequate", ""


def self_study_status(ex: dict[str, Any], evidence_status: str, analysis_status: str) -> tuple[str, str]:
    qt = ex.get("question_type")
    steps = ex.get("steps") or []
    step_text = " ".join(str(step) for step in steps)
    generic_steps = sum(
        1
        for pattern in [
            r"read the question",
            r"look for clues",
            r"think about",
            r"check your answer",
            r"use evidence",
        ]
        if re.search(pattern, step_text, re.I)
    )
    has_specific_steps = isinstance(steps, list) and wc(step_text) >= max(8, len(steps) * 4) and generic_steps < 3
    if qt != "multiple_choice" and not has_specific_steps:
        return "thin_steps", "Steps are missing, too short, or generic for self-study."
    if qt == "reasoning" and not str(ex.get("sample_reasoning") or "").strip():
        return "missing_sample", "Reasoning item needs sample_reasoning for self-study and LLM marking."
    if qt == "short_answer" and meta(ex).get("facet") in PASSAGE_FACETS:
        variants = (ex.get("alternative_answers") or []) + (meta(ex).get("accepted_answer_variants") or [])
        if len(variants) < 1 and evidence_status in {"thin", "blocked_by_missing_text"}:
            return "open_answer_support_thin", "Open reading short-answer needs variants, evidence support or a rubric-like answer."
    if analysis_status in {"rubric_too_thin", "thin_effect_link", "senior_prep_thin"}:
        return "analysis_support_thin", "Analytical item is not yet strong enough for independent review."
    return "ready", ""


def exam_prep_status(ex: dict[str, Any], profile: YearProfile, analysis_status: str, evidence_status: str) -> tuple[str, str]:
    diff = ex.get("difficulty")
    comp = ex.get("complexity")
    qt = ex.get("question_type")
    prompt = prompt_text(ex)
    if diff == "foundational" and comp != "simple_familiar":
        return "miscalibrated", "Foundational item should normally use simple_familiar complexity."
    if diff == "extending" and comp == "simple_familiar":
        return "weak_extension", "Extending item is tagged simple_familiar."
    if diff != "extending" and comp != "complex_unfamiliar":
        return "ready", ""
    if qt == "multiple_choice" and LOW_DEMAND_PROMPT_RE.search(prompt):
        choices = ex.get("choices") or []
        short_choices = choices and max(wc(strip_choice_prefix(choice)) for choice in choices) <= 5
        if short_choices:
            return "weak_extension", "Extending/complex MCQ appears to be low-demand recognition."
    if qt == "short_answer" and wc(ex.get("answer")) <= 4 and not ANALYTICAL_PROMPT_RE.search(prompt):
        return "weak_extension", "Extending short-answer appears to be a closed recall item."
    if analysis_status in {"adequate", "not_applicable"} and evidence_status in {"adequate", "not_applicable"}:
        return "ready", ""
    if ANALYTICAL_PROMPT_RE.search(prompt) or EVIDENCE_PROMPT_RE.search(prompt):
        return "needs_review", "Exam-style task needs stronger evidence or analysis support."
    return "weak_extension", profile.extension_note


def template_risk_status(ex: dict[str, Any]) -> tuple[str, str]:
    text = json.dumps(ex, ensure_ascii=False)
    if MOJIBAKE_RE.search(text):
        return "mojibake", "Text contains likely mojibake/encoding artifacts."
    for pattern, code in BAD_CONTENT_PATTERNS:
        if pattern.search(text):
            return code, "Template, generator-facing or formulaic wording detected."
    return "none", ""


def cultural_protocol_status(ex: dict[str, Any]) -> tuple[str, str]:
    text = combined_text(ex)
    if FIRST_NATIONS_RE.search(text) and not SOURCE_BOUNDARY_RE.search(text):
        return "needs_source_boundary", "First Nations content should name source/community boundaries or teacher-provided context."
    return "not_applicable", ""


def _priority_for_status(category: str, status: str) -> str:
    if status in {
        "unresolved_stimulus",
        "missing_stimulus_ref",
        "references_absent_text",
        "invalid_mcq",
        "invalid_key",
        "answer_mismatch",
        "mojibake",
    }:
        return "P1"
    if status in {
        "inline_text_missing",
        "blocked_by_missing_text",
        "stimulus_missing_plain_text",
        "stimulus_ref_mismatch",
        "duplicate_choices",
        "rubric_too_thin",
        "thin_effect_link",
        "senior_prep_thin",
        "punctuation_not_strict",
        "missing_focus",
        "missing_writing_skill",
        "writing_rubric_thin",
        "rubric_dimensions_thin",
        "thin_steps",
        "missing_sample",
        "open_answer_support_thin",
        "weak_extension",
        "miscalibrated",
        "needs_source_boundary",
    }:
        return "P2"
    if category in {"topic_alignment", "stimulus"}:
        return "P3"
    return "P3"


def audit_exercise(
    ex: dict[str, Any],
    profile: YearProfile,
    topic_profiles: dict[str, TopicProfile],
    stimuli: dict[str, Any],
    duplicate_ids: set[str] | None = None,
    duplicate_questions: set[str] | None = None,
) -> tuple[dict[str, Any], list[IssueFlag]]:
    qid = str(ex.get("id") or "")
    issues: list[IssueFlag] = []
    duplicate_ids = duplicate_ids or set()
    duplicate_questions = duplicate_questions or set()
    m = meta(ex)
    qt = ex.get("question_type")
    diff = ex.get("difficulty")
    comp = ex.get("complexity")
    topic_ids = [str(tid) for tid in ex.get("topic_ids") or []]
    primary = topic_ids[0] if topic_ids else ""

    if ExerciseItem is not None:
        try:
            ExerciseItem.model_validate(ex)
        except ValidationError as exc:
            add_issue(
                issues,
                qid,
                "P0",
                "schema",
                "pydantic_validation",
                "ExerciseItem schema validation failed.",
                evidence=str(exc).splitlines()[0],
                recommended_fix="Repair the item so it conforms to core.schema.exercise_schema.ExerciseItem.",
            )

    question_norm = norm_text(ex.get("question"))
    if qid in duplicate_ids:
        add_issue(issues, qid, "P1", "schema", "duplicate_id", "Duplicate exercise id.", recommended_fix="Give each exercise a unique id.")
    if question_norm and question_norm in duplicate_questions:
        add_issue(issues, qid, "P1", "schema", "duplicate_question", "Duplicate question text.", recommended_fix="Rewrite one item so the prompt is distinct.")
    if not str(ex.get("question") or "").strip():
        add_issue(issues, qid, "P0", "schema", "missing_question", "Missing student-facing question.", recommended_fix="Add a complete question.")
    if not str(ex.get("answer") or "").strip():
        add_issue(issues, qid, "P0", "schema", "missing_answer", "Missing model answer.", recommended_fix="Add a model answer or correct option key.")
    if ex.get("framework") != "AC9_ENGLISH":
        add_issue(issues, qid, "P1", "schema", "bad_framework", f"framework={ex.get('framework')!r}", recommended_fix="Use framework='AC9_ENGLISH'.")
    if str(ex.get("subject") or "").lower() != "english":
        add_issue(issues, qid, "P1", "schema", "bad_subject", f"subject={ex.get('subject')!r}", recommended_fix="Use subject='english'.")
    if ex.get("year_level") != profile.year:
        add_issue(issues, qid, "P1", "schema", "bad_year_level", f"year_level={ex.get('year_level')!r}", recommended_fix=f"Set year_level={profile.year} or move the item.")
    if qt not in VALID_QTYPES:
        add_issue(issues, qid, "P1", "schema", "bad_question_type", f"question_type={qt!r}", recommended_fix="Use short_answer, multiple_choice, reasoning or multi_part.")
    if diff not in VALID_DIFFICULTY:
        add_issue(issues, qid, "P1", "schema", "bad_difficulty", f"difficulty={diff!r}", recommended_fix="Use foundational, developing or extending.")
    if comp not in VALID_COMPLEXITY:
        add_issue(issues, qid, "P1", "schema", "bad_complexity", f"complexity={comp!r}", recommended_fix="Use simple_familiar, complex_familiar or complex_unfamiliar.")
    if not isinstance(ex.get("english_metadata"), dict):
        add_issue(issues, qid, "P1", "metadata", "missing_english_metadata", "english_metadata is missing or not an object.", recommended_fix="Add english_metadata with facet and passage_mode.")
    if m.get("facet") not in VALID_FACETS:
        add_issue(issues, qid, "P1", "metadata", "bad_facet", f"facet={m.get('facet')!r}", recommended_fix="Use a schema-approved English facet.")
    if m.get("passage_mode") not in VALID_PASSAGE_MODES:
        add_issue(issues, qid, "P2", "metadata", "bad_passage_mode", f"passage_mode={m.get('passage_mode')!r}", recommended_fix="Set passage_mode to stimulus, inline or none.")

    expected_prefix = f"AC9E{profile.year}"
    for tid in topic_ids:
        if tid not in topic_profiles:
            add_issue(issues, qid, "P1", "curriculum_alignment", "unknown_topic_id", f"{tid} is not in Year {profile.year} curriculum.", recommended_fix="Use a valid AC9 English topic id.")
        elif not tid.startswith(expected_prefix):
            add_issue(issues, qid, "P1", "curriculum_alignment", "wrong_year_topic_id", f"{tid} does not start with {expected_prefix}.", recommended_fix="Use a topic id from the audited year.")
    strand = topic_strand_from_id(primary)
    facet = m.get("facet")
    if strand and facet in VALID_FACETS and facet not in FACETS_BY_TOPIC_STRAND.get(strand, set()):
        add_issue(issues, qid, "P3", "metadata", "facet_topic_mismatch", f"{primary} is {strand}; facet={facet}", recommended_fix="Check whether the facet matches the English strand and task intent.", confidence="medium")

    answer_status, answer_evidence = answer_key_quality_status(ex)
    topic_status, topic_evidence = topic_alignment_status(ex, topic_profiles, stimuli)
    stimulus_status, stimulus_evidence = stimulus_integrity_status(ex, stimuli)
    evidence_status, evidence_evidence = evidence_quality_status(ex, stimuli)
    analysis_status, analysis_evidence = analysis_quality_status(ex, profile)
    conventions_status, conventions_evidence = conventions_quality_status(ex)
    writing_status, writing_evidence = writing_quality_status(ex, profile)
    standards_status, standards_evidence = rubric_dimension_status(ex)
    self_study, self_study_evidence = self_study_status(ex, evidence_status, analysis_status)
    exam_prep, exam_prep_evidence = exam_prep_status(ex, profile, analysis_status, evidence_status)
    template_risk, template_evidence = template_risk_status(ex)
    cultural_status, cultural_evidence = cultural_protocol_status(ex)

    if profile.overreach_terms and profile.overreach_terms.search(combined_text(ex, stimuli)):
        add_issue(issues, qid, "P3", "year_fit", "possible_overreach", "Item may use later-year or senior terminology.", recommended_fix="Check year appropriateness or move the item.", confidence="medium")

    status_issues = [
        ("topic_alignment", topic_status, topic_evidence, "Align question, answer and rubric to the target AC9 English topic."),
        ("stimulus", stimulus_status, stimulus_evidence, "Repair passage_mode, inline passage text, or stimulus references."),
        ("answer", answer_status, answer_evidence, "Align answer, correct_choice and choice text."),
        ("text_evidence", evidence_status, evidence_evidence, "Add quoted/phrased evidence and explain how it supports the answer."),
        ("analysis", analysis_status, analysis_evidence, profile.analysis_note),
        ("language_conventions", conventions_status, conventions_evidence, "Add grammar_focus, strict punctuation handling, or accepted variants."),
        ("writing_structure", writing_status, writing_evidence, "Add writing_skill and craft-specific rubric/model support."),
        ("standards_support", standards_status, standards_evidence, "Add rubric dimensions that match the English task demand."),
        ("self_study", self_study, self_study_evidence, "Add specific steps, variants, rubric points or sample reasoning."),
        ("exam_prep", exam_prep, exam_prep_evidence, "Retag or increase evidence/analysis/comparison demand."),
        ("template", template_risk, template_evidence, "Replace encoding artifacts, placeholders or formulaic wording."),
        ("cultural_protocol", cultural_status, cultural_evidence, "Add source/community boundaries or use teacher-provided context wording."),
    ]
    ok_statuses = {
        PASS_STATUS,
        "not_applicable",
        "resolved",
        "inline_present",
        "self_contained_reading",
        "aligned",
        "adequate",
        "ready",
        "none",
        "strong",
        "adequate_via_stimulus",
    }
    for category, status, evidence, fix in status_issues:
        if status in ok_statuses or not evidence:
            continue
        add_issue(issues, qid, _priority_for_status(category, status), category, status, evidence, recommended_fix=fix)

    for code, evidence in task_contract_findings(ex):
        add_issue(
            issues,
            qid,
            "P1",
            "standards_support",
            code,
            evidence,
            recommended_fix="Align the prompt, rubric, steps and model answer to the same English task contract.",
            confidence="high",
        )

    for code, evidence in multipart_contract_findings(ex):
        add_issue(
            issues,
            qid,
            "P1",
            "marking_contract",
            code,
            evidence,
            recommended_fix="Make the labelled root answer, steps and rubric use exactly the sub-part label set.",
            confidence="high",
        )

    for code, evidence in multi_part_choice_findings(ex):
        add_issue(
            issues,
            qid,
            "P1",
            "answer",
            code,
            evidence,
            recommended_fix="Add a valid sub-part correct_choice and align it with the authored answer and choices.",
            confidence="high",
        )

    for priority, code, evidence in multipart_marking_findings(ex):
        add_issue(
            issues,
            qid,
            priority,
            "rubric",
            code,
            evidence,
            recommended_fix="Author a task-specific part rubric with attainable marks; retain derived rubrics only as runtime fallback.",
            confidence="high" if priority == "P1" else "medium",
        )

    for code, evidence in evidence_to_stimulus_findings(ex, stimuli):
        if code == "quote_not_found_in_stimulus":
            add_issue(
                issues,
                qid,
                "P1",
                "text_evidence",
                code,
                "Quoted phrase was not found in the linked stimulus plain text.",
                evidence=evidence,
                recommended_fix="Check the quote against the stimulus or rewrite as a clear paraphrase without quotation marks.",
                confidence="high",
            )
        else:
            add_issue(
                issues,
                qid,
                "P2",
                "text_evidence",
                code,
                "Evidence/quote task has thin answer, sample or rubric support.",
                evidence=evidence,
                recommended_fix="Add a quote, named phrase, line reference or rubric point for textual evidence.",
            )

    if qt == "reasoning":
        rubric = ex.get("rubric") if isinstance(ex.get("rubric"), dict) else {}
        key_points = rubric.get("key_points") if isinstance(rubric, dict) else None
        if not isinstance(key_points, list) or len(key_points) < 2:
            add_issue(issues, qid, "P1", "rubric", "reasoning_rubric_missing", "Reasoning item lacks usable key_points.", recommended_fix="Add a task-specific rubric.")
        if not str(ex.get("sample_reasoning") or "").strip():
            add_issue(issues, qid, "P1", "rubric", "reasoning_missing_sample", "Reasoning item lacks sample_reasoning.", recommended_fix="Add a model response.")
    elif qt == "multi_part":
        sub_parts = ex.get("sub_parts")
        if not isinstance(sub_parts, list) or len(sub_parts) < 2:
            add_issue(issues, qid, "P1", "schema", "multipart_missing_subparts", "Multi-part item needs at least two sub_parts.", recommended_fix="Add labelled sub_parts with question, answer and marks.")
        else:
            total_marks = sum(int(part.get("marks", 1) or 1) for part in sub_parts if isinstance(part, dict))
            rubric = ex.get("rubric") if isinstance(ex.get("rubric"), dict) else {}
            if rubric and int(rubric.get("max_score") or 0) != total_marks:
                add_issue(issues, qid, "P2", "rubric", "multipart_mark_mismatch", f"rubric max_score={rubric.get('max_score')}; sub_part marks={total_marks}", recommended_fix="Set rubric.max_score to the total sub_part marks.")

    top = best_issue(issues, qid)
    row = {
        "id": qid,
        "topic": ex.get("topic") or "",
        "primary_topic_id": primary,
        "question_type": qt,
        "difficulty": diff,
        "complexity": comp,
        "facet": facet or "",
        "passage_mode": m.get("passage_mode") or "",
        "passage_ref": passage_ref(ex),
        "topic_alignment": topic_status,
        "stimulus_integrity": stimulus_status,
        "answer_key_quality": answer_status,
        "evidence_quality": evidence_status,
        "analysis_quality": analysis_status,
        "conventions_quality": conventions_status,
        "writing_quality": writing_status,
        "standards_support": standards_status,
        "self_study": self_study,
        "exam_prep": exam_prep,
        "template_risk": template_risk,
        "main_priority": top.priority if top else "",
        "main_issue": f"{top.category}/{top.code}: {top.message}" if top else "",
        "recommended_fix": top.recommended_fix if top else "",
    }
    return row, issues


def bank_balance_issues(year: int, rows: list[dict[str, Any]]) -> list[IssueFlag]:
    if not rows:
        return []
    bank_id = f"year{year}_english_bank"
    issues: list[IssueFlag] = []
    facets = {str(row.get("facet") or "") for row in rows}
    qtypes = Counter(str(row.get("question_type") or "") for row in rows)

    def bank_issue(code: str, message: str, priority: str = "P2") -> None:
        add_issue(
            issues,
            bank_id,
            priority,
            "bank_balance",
            code,
            message,
            evidence="review_needed",
            recommended_fix="Review yearly bank balance before using the audit as acceptance evidence.",
            confidence="medium",
        )

    if "text_evidence" not in facets:
        bank_issue("missing_text_evidence_tasks", "Bank has no explicit text_evidence facet tasks.")
    if "writing_structure" not in facets:
        bank_issue("missing_writing_tasks", "Bank has no writing-structure facet tasks.")
    if not (CONVENTION_FACETS & facets):
        bank_issue("missing_language_conventions_tasks", "Bank has no language conventions, spelling-punctuation or vocabulary facet tasks.")
    if not any(qtype in {"reasoning", "multi_part"} for qtype in qtypes):
        bank_issue("missing_reasoning_or_multipart_tasks", "Bank has no reasoning or multi_part tasks.")
    closed_count = qtypes["multiple_choice"] + qtypes["short_answer"]
    if closed_count / len(rows) > 0.85:
        bank_issue(
            "mcq_short_answer_dominant",
            "More than 85% of items are multiple_choice or short_answer.",
            priority="P3",
        )
    return issues


def curriculum_coverage_issues(
    year: int,
    exercises: list[dict[str, Any]],
    topic_profiles: dict[str, TopicProfile],
) -> list[IssueFlag]:
    counts: Counter[str] = Counter(
        str(topic_id)
        for ex in exercises
        for topic_id in (ex.get("topic_ids") or [])
    )
    issues: list[IssueFlag] = []
    for topic_id in sorted(topic_profiles):
        count = counts[topic_id]
        if count == 0:
            add_issue(
                issues, f"year{year}_english_bank", "P1", "curriculum_alignment",
                "topic_not_covered", f"Curriculum topic {topic_id} has no exercises.",
                recommended_fix=f"Add exercises tagged to {topic_id}.",
            )
        elif count < 5:
            add_issue(
                issues, f"year{year}_english_bank", "P2", "curriculum_alignment",
                "topic_coverage_thin", f"Curriculum topic {topic_id} has only {count} exercises.",
                recommended_fix=f"Review whether {topic_id} needs at least five varied items.",
                confidence="medium",
            )
    return issues


def stimulus_source_issues(
    year: int,
    exercises: list[dict[str, Any]],
    stimuli: dict[str, Any],
    delivery_scope: str = "private",
) -> list[IssueFlag]:
    refs = {passage_ref(ex) for ex in exercises if passage_ref(ex)}
    issues: list[IssueFlag] = []
    for ref in sorted(refs):
        record = stimuli.get(ref)
        if not isinstance(record, dict):
            continue  # Per-item stimulus integrity already reports unresolved references.
        issue_id = f"stimulus:{ref}"
        stimulus_year = record.get("year_level")
        if stimulus_year not in {None, year}:
            add_issue(
                issues, issue_id, "P1", "source_rights", "stimulus_year_mismatch",
                f"Stimulus year_level={stimulus_year}, but it is referenced by the Year {year} bank.",
                recommended_fix="Use a year-appropriate stimulus or correct its year metadata.",
            )
        attribution = record.get("source_attribution")
        if not isinstance(attribution, dict) or not attribution:
            add_issue(
                issues, issue_id, "P1", "source_rights", "source_attribution_missing",
                "Stimulus has no source_attribution record.",
                recommended_fix="Record the source, author/organisation and licence or usage status.",
            )
            continue
        author = attribution.get("author_or_organisation") or attribution.get("author")
        licence = attribution.get("licence_or_status") or attribution.get("license")
        rights_review = record.get("source_rights_review")
        review_status = (
            str(rights_review.get("status") or "").strip()
            if isinstance(rights_review, dict)
            else ""
        )
        reviewed_for_declared_scope = review_status in {
            "reviewed_for_private_non_public_educational_use",
            "reviewed_and_cleared_for_external_distribution",
        }
        external_cleared = (
            isinstance(rights_review, dict)
            and review_status == "reviewed_and_cleared_for_external_distribution"
            and str(rights_review.get("external_distribution") or "").strip().lower()
            in {"cleared", "approved", "permitted"}
        )
        if delivery_scope == "external" and not external_cleared:
            add_issue(
                issues, issue_id, "P1", "source_rights", "external_distribution_not_cleared",
                "Stimulus is not cleared for the requested external delivery scope.",
                recommended_fix="Obtain and record external-distribution clearance or use a cleared/original stimulus.",
            )
        if not str(attribution.get("title") or "").strip() or not str(author or "").strip() or not str(licence or "").strip():
            add_issue(
                issues, issue_id, "P1", "source_rights", "source_attribution_incomplete",
                "Source attribution needs title, author/organisation and licence/status.",
                recommended_fix="Complete the source attribution fields before release.",
            )
        elif reviewed_for_declared_scope:
            required_review_fields = {
                "reviewed_on": rights_review.get("reviewed_on"),
                "approved_scope": rights_review.get("approved_scope"),
                "external_distribution": rights_review.get("external_distribution"),
            }
            missing_review_fields = [
                field for field, value in required_review_fields.items()
                if not str(value or "").strip()
            ]
            if missing_review_fields:
                add_issue(
                    issues, issue_id, "P1", "source_rights", "source_rights_review_incomplete",
                    f"Reviewed source-rights record is missing: {', '.join(missing_review_fields)}.",
                    recommended_fix="Complete the review date, approved scope and external-distribution status.",
                )
        elif re.search(r"not asserted|internal educational use|status unknown|permission unknown", str(licence), re.I):
            add_issue(
                issues, issue_id, "P2", "source_rights", "source_rights_review_needed",
                f"Usage status requires review: {licence}",
                recommended_fix="Record a reviewed usage scope or confirm external distribution rights.",
                confidence="medium",
            )
    return issues


def write_outputs(
    year: int,
    rows: list[dict[str, Any]],
    issues: list[IssueFlag],
    out_dir: Path,
    data_file: Path,
    profile: YearProfile,
) -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    prefix = f"year{year}_english_full"
    acceptance_prefix = f"year{year}_english"
    item_path = out_dir / f"{prefix}_item_audit.csv"
    acceptance_item_path = out_dir / f"{acceptance_prefix}_item_audit.csv"
    issue_path = out_dir / f"{prefix}_issue_flags.csv"
    issue_jsonl_path = out_dir / f"{acceptance_prefix}_issue_flags.jsonl"
    hard_errors_path = out_dir / f"{acceptance_prefix}_hard_errors.csv"
    human_review_path = out_dir / f"{acceptance_prefix}_human_review_queue.csv"
    checklist_csv = out_dir / f"{prefix}_repair_checklist.csv"
    checklist_md = out_dir / f"{prefix}_repair_checklist.md"
    summary_path = out_dir / f"{prefix}_summary.md"

    for path in [item_path, acceptance_item_path]:
        with path.open("w", newline="", encoding="utf-8-sig") as f:
            writer = csv.DictWriter(f, fieldnames=AUDIT_COLUMNS)
            writer.writeheader()
            writer.writerows(rows)

    issue_rows = [issue.__dict__ for issue in issues]
    issue_rows.sort(key=lambda row: (PRIORITY_ORDER[row["priority"]], row["exercise_id"], row["code"]))
    with issue_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=ISSUE_COLUMNS)
        writer.writeheader()
        writer.writerows(issue_rows)
    with issue_jsonl_path.open("w", encoding="utf-8") as f:
        for row in issue_rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    with hard_errors_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=ISSUE_COLUMNS)
        writer.writeheader()
        writer.writerows(row for row in issue_rows if row["priority"] in {"P0", "P1"})
    with human_review_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=ISSUE_COLUMNS)
        writer.writeheader()
        writer.writerows(row for row in issue_rows if row["priority"] in {"P2", "P3"})

    checklist_rows = [
        {
            "priority": row["priority"],
            "id": row["exercise_id"],
            "category": row["category"],
            "code": row["code"],
            "message": row["message"],
            "recommended_fix": row["recommended_fix"],
            "confidence": row["confidence"],
        }
        for row in issue_rows
        if row["priority"] in {"P0", "P1", "P2"}
    ]
    with checklist_csv.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=["priority", "id", "category", "code", "message", "recommended_fix", "confidence"])
        writer.writeheader()
        writer.writerows(checklist_rows)

    priority_counts = Counter(issue.priority for issue in issues)
    category_counts = Counter(issue.category for issue in issues)
    facet_counts = Counter(str(row["facet"]) for row in rows)
    qtype_counts = Counter(str(row["question_type"]) for row in rows)
    difficulty_counts = Counter(str(row["difficulty"]) for row in rows)
    status_counts = {
        "topic_alignment": Counter(str(row["topic_alignment"]) for row in rows),
        "stimulus_integrity": Counter(str(row["stimulus_integrity"]) for row in rows),
        "evidence_quality": Counter(str(row["evidence_quality"]) for row in rows),
        "analysis_quality": Counter(str(row["analysis_quality"]) for row in rows),
        "conventions_quality": Counter(str(row["conventions_quality"]) for row in rows),
        "writing_quality": Counter(str(row["writing_quality"]) for row in rows),
        "standards_support": Counter(str(row["standards_support"]) for row in rows),
        "self_study": Counter(str(row["self_study"]) for row in rows),
        "exam_prep": Counter(str(row["exam_prep"]) for row in rows),
    }

    def rel(path: Path) -> str:
        resolved = path.resolve()
        try:
            return str(resolved.relative_to(ROOT.resolve()))
        except ValueError:
            return str(resolved)

    md_lines = [
        f"# Year {year} English Full Audit",
        "",
        "## Scope",
        "",
        f"- Data file: `{rel(data_file)}`",
        f"- Items loaded: {len(rows)}",
        f"- Year profile: {profile.label}",
        "",
        "## Priority Counts",
        "",
        "| Priority | Meaning | Count |",
        "|---|---|---:|",
        f"| P0 | schema/answer blocker | {priority_counts['P0']} |",
        f"| P1 | high-impact marking, metadata or stimulus blocker | {priority_counts['P1']} |",
        f"| P2 | self-study, analysis, evidence or exam-prep repair | {priority_counts['P2']} |",
        f"| P3 | advisory calibration or polish | {priority_counts['P3']} |",
        "",
        "## Bank Profile",
        "",
        "| Metric | Counts |",
        "|---|---|",
        f"| Question types | {dict(qtype_counts)} |",
        f"| Difficulty | {dict(difficulty_counts)} |",
        f"| Facets | {dict(facet_counts)} |",
        "",
        "## Category Counts",
        "",
        "| Category | Count |",
        "|---|---:|",
    ]
    if category_counts:
        md_lines.extend(f"| {cat} | {count} |" for cat, count in category_counts.most_common())
    else:
        md_lines.append("| none | 0 |")
    md_lines.extend(["", "## Status Snapshot", "", "| Area | Counts |", "|---|---|"])
    md_lines.extend(f"| {area} | {dict(counts)} |" for area, counts in status_counts.items())
    md_lines.extend(["", "## English-Specific Judgement", "", profile.analysis_note, "", profile.extension_note, "", "## Repair Checklist", ""])
    if checklist_rows:
        for row in checklist_rows[:140]:
            md_lines.append(
                f"- {row['priority']} `{row['id']}` {row['category']}/{row['code']}: "
                f"{row['message']} Fix: {row['recommended_fix']}"
            )
        if len(checklist_rows) > 140:
            md_lines.append(f"- ... +{len(checklist_rows) - 140} more in CSV")
    else:
        md_lines.append("- No P0-P2 repair items detected.")

    summary_path.write_text("\n".join(md_lines) + "\n", encoding="utf-8")
    checklist_md.write_text("\n".join(md_lines[md_lines.index("## Repair Checklist") :]) + "\n", encoding="utf-8")

    return {
        "year": year,
        "items": len(rows),
        "issues": len(issues),
        "P0": priority_counts["P0"],
        "P1": priority_counts["P1"],
        "P2": priority_counts["P2"],
        "P3": priority_counts["P3"],
        "outputs": {
            "item_audit": rel(item_path),
            "acceptance_item_audit": rel(acceptance_item_path),
            "issue_flags": rel(issue_path),
            "issue_flags_jsonl": rel(issue_jsonl_path),
            "hard_errors": rel(hard_errors_path),
            "human_review_queue": rel(human_review_path),
            "repair_checklist_csv": rel(checklist_csv),
            "repair_checklist_md": rel(checklist_md),
            "summary": rel(summary_path),
        },
    }


def audit_year(
    year: int,
    *,
    data_dir: Path = DEFAULT_DATA_DIR,
    curriculum_dir: Path = DEFAULT_CURRICULUM_DIR,
    stimuli_file: Path = DEFAULT_STIMULI_FILE,
    out_dir: Path = DEFAULT_OUT_DIR,
    delivery_scope: str = "private",
) -> dict[str, Any]:
    if delivery_scope not in DELIVERY_SCOPES:
        raise ValueError(f"Unknown delivery scope: {delivery_scope}")
    profile = YEAR_PROFILES.get(year)
    if profile is None:
        raise ValueError(f"No English audit profile for Year {year}")
    data_file = data_dir / f"exercise_{year}_english.json"
    exercises = load_json(data_file)
    topic_profiles = load_topic_profiles(year, curriculum_dir)
    stimuli = load_stimuli(stimuli_file)
    id_counts = Counter(str(ex.get("id") or "") for ex in exercises)
    duplicate_ids = {qid for qid, count in id_counts.items() if qid and count > 1}
    question_counts = Counter(norm_text(ex.get("question")) for ex in exercises if norm_text(ex.get("question")))
    duplicate_questions = {question for question, count in question_counts.items() if count > 1}

    rows: list[dict[str, Any]] = []
    issues: list[IssueFlag] = []
    for ex in exercises:
        row, ex_issues = audit_exercise(ex, profile, topic_profiles, stimuli, duplicate_ids, duplicate_questions)
        rows.append(row)
        issues.extend(ex_issues)
    issues.extend(bank_balance_issues(year, rows))
    issues.extend(curriculum_coverage_issues(year, exercises, topic_profiles))
    issues.extend(stimulus_source_issues(year, exercises, stimuli, delivery_scope))

    return write_outputs(year, rows, issues, out_dir, data_file, profile)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Full AC9 English bank audit for Years 7-10.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--year", type=int, help="Audit one year level.")
    group.add_argument("--years", nargs="+", type=int, help="Audit selected year levels.")
    group.add_argument("--all", action="store_true", help="Audit Years 7-10.")
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--curriculum-dir", type=Path, default=DEFAULT_CURRICULUM_DIR)
    parser.add_argument("--stimuli-file", type=Path, default=DEFAULT_STIMULI_FILE)
    parser.add_argument(
        "--delivery-scope",
        choices=sorted(DELIVERY_SCOPES),
        default="private",
        help="Check source-rights metadata against private or external delivery.",
    )
    parser.add_argument("--out", "--out-dir", dest="out_dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--json", action="store_true", help="Print machine-readable summary.")
    parser.add_argument("--fail-on", choices=["none", "P0", "P1", "P2", "P3"], default="none")
    parser.add_argument("--strict", action="store_true", help="Exit 1 when hard errors (P0/P1) are present.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    years = [args.year] if args.year else args.years if args.years else [7, 8, 9, 10]
    results = [
        audit_year(
            year,
            data_dir=args.data_dir,
            curriculum_dir=args.curriculum_dir,
            stimuli_file=args.stimuli_file,
            out_dir=args.out_dir,
            delivery_scope=args.delivery_scope,
        )
        for year in years
    ]

    if args.json:
        print(json.dumps(results, indent=2))
    else:
        for result in results:
            print(
                "Year {year}: items={items}, issues={issues}, "
                "P0={P0}, P1={P1}, P2={P2}, P3={P3}".format(**result)
            )

    fail_on = "P1" if args.strict else args.fail_on
    if fail_on != "none":
        max_allowed = PRIORITY_ORDER[fail_on]
        for result in results:
            for priority, value in PRIORITY_ORDER.items():
                if value <= max_allowed and result.get(priority, 0):
                    return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
