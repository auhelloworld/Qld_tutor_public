"""LLM-assisted concept_card drafter for AC9 Maths topics (Years 7–10).

Writes drafts to staging/concept_cards/<topic_id>.json. Never writes to data/.
Invokable via: python -m backend.content_authoring.concept_card_helper --topic-id AC9M7N04
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from pydantic import ValidationError

from core.schema.curriculum_schema import ConceptCard
from backend.services.marking import strip_fences

STAGING_ROOT = Path(__file__).resolve().parents[2] / "staging" / "concept_cards"
SAFE_TOPIC_RE = re.compile(r"^AC9M(7|8|9|10)(N|A|M|SP|ST|P)\d{2}$")

CORE_RULE_LEN_MIN = 30
CORE_RULE_LEN_MAX = 240

DRAFT_PROMPT = """You are drafting a concept card for an Australian Curriculum v9 Mathematics topic.

Topic ID: {topic_id}
Year level: {year_level}
Strand: {strand}
Achievement standard: {achievement_standard_text}
Content descriptor: {content_descriptor_text}
Elaborations:
{elaborations_block}

Produce a JSON object with exactly this shape:
{{
  "core_rule": "...",
  "hint_levels": [
    {{"level": "concept_reminder", "template": "..."}},
    {{"level": "step_prompt", "template": "..."}},
    {{"level": "analogy", "template": "..."}}
  ],
  "worked_example": {{
    "question": "...",
    "answer": "...",
    "steps": [
      {{"step": 1, "instruction": "...", "result": "..."}},
      {{"step": 2, "instruction": "...", "result": "..."}},
      {{"step": 3, "instruction": "...", "result": "..."}}
    ],
    "explanation": "..."
  }}
}}

Constraints:
- core_rule: 30-240 characters; state the mathematical rule itself; do NOT name the topic or begin with "This topic is about"; do NOT include any specific numeric answer.
- concept_reminder: re-state the rule as a Socratic question; no numeric values.
- step_prompt: ask the student to perform one concrete next step; use placeholder notation like <numerator>, <base> instead of concrete numbers.
- analogy: map the operation onto a real-world scenario or simpler analogous problem; one sentence.
- worked_example: a CONCRETE problem with SPECIFIC numbers, fully solved step by step. This IS allowed to have real numbers (unlike hints). Choose a simple example appropriate for Year {year_level}.
- All strings must be Australian English (use "maths", "metre", "recognise").
- Output ONLY the JSON object, no markdown fences, no commentary.
"""


def _parse_json_object(raw: str | None) -> dict:
    """Parse strict, fenced, or prose-wrapped JSON object output."""
    if not raw:
        return {}
    text = strip_fences(raw)
    if not text.startswith("{"):
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            text = text[start:end + 1]
    return json.loads(text)


def validate_topic_id(value: str) -> str:
    """Validate that the topic_id matches the AC9 Maths pattern (Years 7-10)."""
    if not SAFE_TOPIC_RE.match(value):
        raise argparse.ArgumentTypeError(
            f"--topic-id must match AC9 Maths pattern {SAFE_TOPIC_RE.pattern!r}, "
            f"got {value!r}"
        )
    return value


def check_quality(card: ConceptCard) -> list[str]:
    """Return a list of warning strings for quantitative quality checks."""
    warnings: list[str] = []

    # Core rule length
    if len(card.core_rule) < CORE_RULE_LEN_MIN:
        warnings.append(
            f"core_rule too short: {len(card.core_rule)} chars "
            f"(minimum {CORE_RULE_LEN_MIN})"
        )
    if len(card.core_rule) > CORE_RULE_LEN_MAX:
        warnings.append(
            f"core_rule too long: {len(card.core_rule)} chars "
            f"(maximum {CORE_RULE_LEN_MAX})"
        )

    # Required hint levels
    levels_present = {h.level for h in card.hint_levels}
    for required in ("concept_reminder", "step_prompt", "analogy"):
        if required not in levels_present:
            warnings.append(f"missing hint_level '{required}'")

    # Numeric leak guard: reject multi-digit literals in hint templates
    for hint in card.hint_levels:
        if re.search(r"\d{2,}", hint.template):
            warnings.append(
                f"hint '{hint.level}' contains multi-digit numeric literal — "
                "use placeholder notation (e.g. <numerator>) instead"
            )

    # Circular rule check: core_rule should not start with "This topic"
    if card.core_rule.lower().startswith("this topic"):
        warnings.append(
            "core_rule begins with 'This topic...' — state the rule itself, "
            "not a description of the topic"
        )

    # Worked example checks
    if card.worked_example is None:
        warnings.append("worked_example is missing — include a concrete solved problem")
    else:
        we = card.worked_example
        if len(we.steps) < 2:
            warnings.append(
                f"worked_example has only {len(we.steps)} step(s) — "
                "include at least 2 steps to show the working"
            )
        if we.answer and we.answer in card.core_rule:
            warnings.append(
                "worked_example answer appears verbatim in core_rule — "
                "the rule should be general, not tied to one example"
            )

    return warnings


def _build_prompt(topic) -> str:
    """Build the LLM prompt from a loaded topic object."""
    elabs = getattr(topic, "elaborations", [])
    elab_text = (
        "\n".join(f"- {e.elaboration_id}: {e.text}" for e in elabs)
        if elabs
        else "(no elaborations attached yet)"
    )
    return DRAFT_PROMPT.format(
        topic_id=topic.topic_id,
        year_level=getattr(topic, "year_level", "?"),
        strand=getattr(topic, "strand", "?"),
        achievement_standard_text=getattr(topic, "achievement_standard_text", ""),
        content_descriptor_text=getattr(topic, "content_descriptor_text", ""),
        elaborations_block=elab_text,
    )


def _draft(topic_id: str) -> int:
    """Draft a concept_card for the given topic_id. Returns exit code."""
    from backend.curriculum_loader import CurriculumLoader

    loader = CurriculumLoader()
    topic = loader.load_topic(topic_id)
    if topic is None:
        print(
            f"ERROR: topic {topic_id!r} not found in curriculum slice. "
            "Has the migration been run for this year level?",
            file=sys.stderr,
        )
        return 2

    # Check LLM availability
    from backend.tutor_engine import get_tutor_engine

    engine = get_tutor_engine()
    if engine.client is None:
        print(
            "ERROR: LLM key required for drafting; "
            "set GEMINI_API_KEY or OPENAI_API_KEY",
            file=sys.stderr,
        )
        return 3

    prompt = _build_prompt(topic)
    raw = engine._call_llm(prompt, response_format={"type": "json_object"}, temp=0.4)

    # Parse and validate
    try:
        data = _parse_json_object(raw)
        card = ConceptCard.model_validate(data)
    except (json.JSONDecodeError, ValidationError) as exc:
        print(f"ERROR: LLM output failed validation: {exc}", file=sys.stderr)
        print(f"Raw output length: {len(raw) if isinstance(raw, str) else 0}", file=sys.stderr)
        return 4

    # Quality checks
    warnings = check_quality(card)

    # Write to staging
    STAGING_ROOT.mkdir(parents=True, exist_ok=True)
    out_path = STAGING_ROOT / f"{topic_id}.json"
    out_path.write_text(
        json.dumps(card.model_dump(), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    # Report
    print(f"Wrote: {out_path}")
    print(f"  core_rule ({len(card.core_rule)} chars): {card.core_rule[:80]}...")
    for h in card.hint_levels:
        print(f"  hint[{h.level}] ({len(h.template)} chars)")
    if warnings:
        print("  WARNINGS:")
        for w in warnings:
            print(f"    ⚠ {w}")
        return 1  # success but with warnings
    else:
        print("  ✓ All quantitative checks passed.")
        return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="concept_card_helper",
        description="Draft a concept_card for an AC9 Maths topic using the LLM.",
    )
    parser.add_argument(
        "--topic-id",
        type=validate_topic_id,
        required=True,
        help="AC9 Maths Topic_Id (e.g. AC9M7N04, AC9M9A02)",
    )
    args = parser.parse_args()
    return _draft(args.topic_id)


if __name__ == "__main__":
    sys.exit(main())
