"""AI-assisted misconception mining pipeline.

Proposes new misconception candidates from AC9 elaborations and anonymised
error logs. Candidates land in staging for mandatory human review.

Usage:
    python -m backend.mining.mine_misconceptions --subject math --year-level 7

Design §3.6 — misconception-library spec.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

from pydantic import BaseModel, ConfigDict

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from core.schema.misconception_schema import MisconceptionRecord

LOG = logging.getLogger(__name__)

STAGING_DIR = project_root / "data" / "misconceptions" / "staging"
LOG_ROOT = project_root / "data" / "logs"

# Anonymisation: only these fields are retained from per-student logs
ANON_FIELDS = ["topic_id", "question_id", "error_type", "student_answer_truncated", "timestamp_day"]

_MINING_PROMPT = """You are a mathematics education expert. Given the following AC9 curriculum topic and recent student errors, propose a single misconception record.

Topic ID: {topic_id}
Content descriptor: {elaboration}

Recent anonymised incorrect attempts (no PII):
{sample}

Respond with a JSON object containing:
- misconception_id: string matching MC_<FRAMEWORK>_<topic_short>_<seq> (e.g. MC_M7N_negative_squared_01)
- name: short human-readable name
- description: teacher-facing description
- student_facing_explanation: explanation for a 12-15 year old student
- topic_ids: list of AC9 topic IDs this applies to
- detection_signatures: list of {{kind, pattern, notes}} objects
- rationale: why this misconception is common (not stored in final record)
"""


class CandidateProposal(BaseModel):
    """LLM-shaped output schema for mining."""

    model_config = ConfigDict(extra="allow")

    misconception_id: str = ""
    name: str = ""
    description: str = ""
    student_facing_explanation: str = ""
    topic_ids: list[str] = []
    detection_signatures: list[dict] = []
    rationale: str = ""

    @classmethod
    def fallback(cls) -> "CandidateProposal":
        return cls()


def _canonical_dump(payload: dict) -> str:
    """Canonical JSON serialisation for idempotent output."""
    return json.dumps(payload, sort_keys=True, indent=2, ensure_ascii=False) + "\n"


def _compute_run_id(elaborations: dict, error_samples: dict) -> str:
    """Deterministic run_id from a hash of inputs (Req 3.8 idempotence)."""
    content = json.dumps(
        {"elaborations": elaborations, "errors": error_samples},
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256(content.encode()).hexdigest()[:12]


def _gather_elaborations(subject: str, year_level: int) -> dict[str, str]:
    """Read AC9 elaborations from the Phase 1 Curriculum_Store."""
    from backend.curriculum_loader import CurriculumLoader

    loader = CurriculumLoader()
    framework_map = {"math": "AC9_MATHS", "english": "AC9_ENGLISH", "science": "AC9_SCIENCE"}
    framework_id = framework_map.get(subject)
    if not framework_id:
        return {}

    try:
        slice_obj = loader.load_slice(framework_id, year_level)
    except FileNotFoundError:
        return {}

    elaborations: dict[str, str] = {}
    for topic in slice_obj.topics:
        elab_text = " ".join(topic.elaborations) if topic.elaborations else topic.content_descriptor_text
        elaborations[topic.topic_id] = elab_text

    return elaborations


def _gather_anonymised_errors(subject: str, year_level: int) -> dict[str, list[dict]]:
    """Gather anonymised error samples from per-student logs (Req 3.2, 3.9)."""
    error_samples: dict[str, list[dict]] = {}

    if not LOG_ROOT.exists():
        return error_samples

    for student_dir in LOG_ROOT.iterdir():
        if not student_dir.is_dir():
            continue
        log_file = student_dir / f"{subject}_log.json"
        if not log_file.exists():
            continue

        try:
            data = json.loads(log_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue

        for topic_id, topic_data in data.get("topics", {}).items():
            for attempt in topic_data.get("attempts", []):
                if attempt.get("correct"):
                    continue
                # Anonymise: drop student_id, truncate answer, truncate timestamp
                anon_record = {
                    "topic_id": topic_id,
                    "question_id": attempt.get("question_id", ""),
                    "error_type": attempt.get("error_type"),
                    "student_answer_truncated": "",  # No raw answers stored in logs
                    "timestamp_day": attempt.get("timestamp", "")[:10],
                }
                error_samples.setdefault(topic_id, []).append(anon_record)

    # Limit samples per topic to avoid huge prompts
    for tid in error_samples:
        error_samples[tid] = error_samples[tid][:10]

    return error_samples


def _format_summary_row(candidate: MisconceptionRecord, rationale: str, sample: list) -> str:
    """Format a single row for run_summary.md."""
    return (
        f"## {candidate.misconception_id}\n\n"
        f"**Name:** {candidate.name}\n\n"
        f"**Description:** {candidate.description}\n\n"
        f"**Rationale:** {rationale}\n\n"
        f"**Error sample size:** {len(sample)}\n\n"
        f"---\n"
    )


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse CLI arguments."""
    parser = argparse.ArgumentParser(
        description="Mine misconception candidates from AC9 elaborations and error logs."
    )
    parser.add_argument("--subject", required=True, help="Subject (math, english, science)")
    parser.add_argument("--year-level", type=int, required=True, help="Year level (7-10)")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    """Main entry point for the mining pipeline."""
    args = parse_args(argv)

    framework_short_map = {"math": "ac9_maths", "english": "ac9_english", "science": "ac9_science"}
    framework_short = framework_short_map.get(args.subject, f"ac9_{args.subject}")

    elaborations = _gather_elaborations(args.subject, args.year_level)
    error_samples = _gather_anonymised_errors(args.subject, args.year_level)

    if not elaborations:
        print(f"No elaborations found for {args.subject} year {args.year_level}.", file=sys.stderr)
        return

    # Deterministic run_id (Req 3.8)
    run_id = _compute_run_id(elaborations, error_samples)
    out_dir = STAGING_DIR / framework_short / run_id
    out_dir.mkdir(parents=True, exist_ok=True)

    # In mock mode (no API key), produce empty staging output
    from backend.tutor_engine import get_tutor_engine
    tutor = get_tutor_engine()

    if tutor.client is None:
        print("MOCK mode: no API key configured. Writing empty staging output.")
        (out_dir / "run_summary.md").write_text(
            f"# Mining Run {run_id}\n\nMOCK mode — no candidates generated.\n",
            encoding="utf-8",
        )
        return

    summaries: list[str] = [f"# Mining Run {run_id}\n\n"]
    for topic_id, elab_text in elaborations.items():
        sample = error_samples.get(topic_id, [])
        prompt = _MINING_PROMPT.format(
            topic_id=topic_id,
            elaboration=elab_text,
            sample=json.dumps(sample, indent=2),
        )

        proposal = tutor._call_llm_safe(
            prompt=prompt,
            expected_schema=CandidateProposal,
            fallback=CandidateProposal.fallback(),
            response_format={"type": "json_object"},
        )

        if not proposal or not proposal.misconception_id:
            continue

        try:
            candidate = MisconceptionRecord.model_validate({
                "misconception_id": proposal.misconception_id,
                "name": proposal.name,
                "description": proposal.description,
                "student_facing_explanation": proposal.student_facing_explanation,
                "topic_ids": proposal.topic_ids,
                "detection_signatures": proposal.detection_signatures,
                "worked_example_ids": [],
                "provenance": {
                    "source": "ai_mined_human_approved",
                    "approved_by": "PENDING_REVIEW",
                    "approved_at": "PENDING_REVIEW",
                    "mined_from_run_id": run_id,
                },
            })
        except Exception as e:
            LOG.warning("Candidate %s failed validation: %s", proposal.misconception_id, e)
            continue

        out_file = out_dir / f"{candidate.misconception_id}.json"
        payload = {**candidate.model_dump(), "pending_review": True}
        out_file.write_text(_canonical_dump(payload), encoding="utf-8")
        summaries.append(_format_summary_row(candidate, proposal.rationale, sample))

    (out_dir / "run_summary.md").write_text("\n".join(summaries), encoding="utf-8")
    print(f"Mining complete. {len(summaries) - 1} candidates written to {out_dir}")


if __name__ == "__main__":
    main()
