"""Offline ingestion helpers that emit the repository's canonical schemas.

The pipeline is intentionally staging-only: it never writes authored exercise
banks or curriculum slices directly. A caller supplies the target framework and
scope, and every accepted record is validated before the staged JSON is saved.
"""

from __future__ import annotations

import base64
import json
import os
import re
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import TypeAdapter, ValidationError

# Add project root to path for direct ``python backend/ingestion_v2.py`` use.
project_root = Path(__file__).resolve().parent.parent
if str(project_root) not in sys.path:
    sys.path.append(str(project_root))

from backend.curriculum_frameworks import get_framework, legacy_translate
from backend.llm_provider import get_llm_client
from core.prompt_templates.ingestion_prompts import (
    EXERCISE_INGESTION_PROMPT,
    SYLLABUS_INGESTION_PROMPT,
)
from core.schema.curriculum_schema import (
    ConceptCard,
    CurriculumSequence,
    FrameworkSliceFile,
    SubjectTopic,
)
from core.schema.exercise_schema import ExerciseItem


_SUBJECT_TOPIC_ADAPTER = TypeAdapter(SubjectTopic)
_AC9_MATHS_TOPIC_RE = re.compile(r"^AC9M(?:7|8|9|10)(?P<strand>SP|ST|N|A|M|P)\d{2}$")
_AC9_ENGLISH_TOPIC_RE = re.compile(r"^AC9E(?:7|8|9|10)(?P<strand>LA|LE|LY)\d{2}$")
_AC9_SCIENCE_TOPIC_RE = re.compile(r"^AC9S(?:7|8|9|10)(?P<strand>U|H|I)\d{2}$")
_QCAA_TOPIC_RE = re.compile(
    r"^QCAA_(?P<subject>[A-Z_]+)_U(?P<unit>[1-4])_T(?P<topic>\d+)$"
)


@dataclass(frozen=True)
class IngestionScope:
    """Canonical framework/scope metadata attached to every staged record."""

    framework_id: str = "AC9_MATHS"
    subject: str = "math"
    year_level: int | None = 7
    unit: int | None = None

    def __post_init__(self) -> None:
        framework = get_framework(self.framework_id)
        if self.subject not in framework.supported_subjects:
            raise ValueError(
                f"subject {self.subject!r} is not registered for {self.framework_id}"
            )
        if framework.jurisdiction == "ACARA":
            if self.year_level not in framework.supported_year_levels or self.unit is not None:
                raise ValueError(
                    "AC9 ingestion scope requires a supported year_level and no unit"
                )
        elif self.unit not in (1, 2, 3, 4) or self.year_level is not None:
            raise ValueError(
                "QCAA Senior ingestion scope requires unit 1-4 and no year_level"
            )



def _parse_json_object(raw: str | None) -> dict:
    """Parse strict, fenced, or prose-wrapped JSON object output."""
    if not raw:
        return {}
    text = raw.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            text = "\n".join(lines[1:-1]).strip()
    if not text.startswith("{"):
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            text = text[start:end + 1]
    return json.loads(text)


class DataIngestionPipeline:
    def __init__(
        self,
        *,
        framework_id: str = "AC9_MATHS",
        subject: str = "math",
        year_level: int | None = 7,
        unit: int | None = None,
        raw_dir: Path | None = None,
        staging_dir: Path | None = None,
    ):
        self.scope = IngestionScope(
            framework_id=framework_id,
            subject=subject,
            year_level=year_level,
            unit=unit,
        )
        # Use the same provider order and model defaults as TutorEngine.
        self.client, self.default_model = get_llm_client()
        if self.client is None:
            print("WARNING: No LLM provider is configured; ingestion is in mock mode.")

        self.raw_dir = Path(raw_dir) if raw_dir is not None else project_root / "raw_data"
        self.staging_dir = Path(staging_dir) if staging_dir is not None else project_root / "staging"
        self.staging_dir.mkdir(parents=True, exist_ok=True)

    def _scope_for(
        self,
        *,
        framework_id: str | None = None,
        subject: str | None = None,
        year_level: int | None | object = ...,
        unit: int | None | object = ...,
    ) -> IngestionScope:
        """Return an explicit override scope, retaining constructor defaults.

        ``None`` is meaningful for Senior scopes, so Ellipsis distinguishes an
        omitted argument from an explicit ``year_level=None``/``unit=None``.
        """
        return IngestionScope(
            framework_id=framework_id or self.scope.framework_id,
            subject=subject or self.scope.subject,
            year_level=self.scope.year_level if year_level is ... else year_level,
            unit=self.scope.unit if unit is ... else unit,
        )

    @staticmethod
    def _scope_prompt(scope: IngestionScope) -> str:
        return (
            "\n\nTarget canonical scope (do not change these values):\n"
            f"framework_id={scope.framework_id}; subject={scope.subject}; "
            f"year_level={scope.year_level}; unit={scope.unit}\n"
            "Use canonical topic IDs for this framework when they are present in the source."
        )

    @staticmethod
    def _topic_id_candidates(raw_topic: dict[str, Any], scope: IngestionScope) -> list[str]:
        framework = get_framework(scope.framework_id)
        candidates: list[str] = []
        raw_ids = raw_topic.get("topic_ids")
        if isinstance(raw_ids, list):
            candidates.extend(str(value).strip() for value in raw_ids if str(value).strip())
        for key in ("topic_id", "topic"):
            value = raw_topic.get(key)
            if isinstance(value, str) and value.strip():
                candidates.append(value.strip())

        valid: list[str] = []
        for candidate in candidates:
            if framework.validator(candidate):
                valid.append(candidate)
                continue
            for translated in legacy_translate(candidate):
                if framework.validator(translated):
                    valid.append(translated)
        valid = list(dict.fromkeys(valid))
        if not valid:
            topic_label = raw_topic.get("topic_id") or raw_topic.get("topic") or "<missing>"
            raise ValueError(
                f"cannot map topic {topic_label!r} to {scope.framework_id}"
            )
        return valid

    @staticmethod
    def _canonical_concept_card(raw_card: Any) -> dict[str, Any]:
        """Project loose LLM hint output into the strict ConceptCard schema."""
        raw = raw_card if isinstance(raw_card, dict) else {}
        hints: list[dict[str, str]] = []
        allowed_levels = {"concept_reminder", "step_prompt", "analogy"}
        for hint in raw.get("hint_levels") or []:
            if isinstance(hint, dict):
                level = str(hint.get("level") or "concept_reminder")
                template = str(hint.get("template") or "").strip()
            else:
                level = "concept_reminder"
                template = str(hint).strip()
            if not template:
                continue
            if level not in allowed_levels:
                level = "concept_reminder"
            hints.append({"level": level, "template": template})

        payload: dict[str, Any] = {
            "core_rule": str(raw.get("core_rule") or ""),
            "hint_levels": hints,
        }
        for key in ("worked_example", "lesson_content"):
            if key in raw and raw[key] is not None:
                payload[key] = raw[key]
        try:
            return ConceptCard.model_validate(payload).model_dump(mode="json")
        except ValidationError:
            return ConceptCard(
                core_rule=payload["core_rule"],
                hint_levels=hints,
            ).model_dump(mode="json")

    @classmethod
    def _canonical_topic_payload(
        cls,
        raw_topic: dict[str, Any],
        scope: IngestionScope,
        topic_id: str,
    ) -> dict[str, Any]:
        if not isinstance(raw_topic, dict):
            raise ValueError("topic extraction must be an object")
        payload: dict[str, Any] = {
            "framework": scope.framework_id,
            "topic_id": topic_id,
            "name": str(raw_topic.get("name") or raw_topic.get("topic") or topic_id),
            "skills": [str(skill) for skill in raw_topic.get("skills", []) if str(skill).strip()],
            "concept_card": cls._canonical_concept_card(raw_topic.get("concept_card")),
        }
        source_ref = str(raw_topic.get("source_ref") or "").strip()
        if source_ref:
            payload["elaborations"] = [{
                "elaboration_id": f"{topic_id}_INGESTED_1",
                "text": source_ref,
                "source": "ai_generated",
                "source_ref": source_ref,
            }]

        if scope.framework_id == "AC9_MATHS":
            match = _AC9_MATHS_TOPIC_RE.match(topic_id)
            strand = match.group("strand") if match else ""
            payload.update({
                "strand": {
                    "N": "Number", "A": "Algebra", "M": "Measurement",
                    "SP": "Space", "ST": "Statistics", "P": "Probability",
                }.get(strand, "Number"),
                "year_level": scope.year_level,
                "achievement_standard_text": str(raw_topic.get("achievement_standard_text") or ""),
                "content_descriptor_text": str(raw_topic.get("content_descriptor_text") or ""),
            })
        elif scope.framework_id == "AC9_ENGLISH":
            match = _AC9_ENGLISH_TOPIC_RE.match(topic_id)
            strand = match.group("strand") if match else ""
            payload.update({
                "strand": {"LA": "Language", "LE": "Literature", "LY": "Literacy"}.get(strand, "Language"),
                "sub_strand": str(raw_topic.get("sub_strand") or raw_topic.get("topic") or "General"),
                "year_level": scope.year_level,
                "achievement_standard_text": str(raw_topic.get("achievement_standard_text") or ""),
                "content_descriptor_text": str(raw_topic.get("content_descriptor_text") or ""),
            })
        elif scope.framework_id == "AC9_SCIENCE":
            match = _AC9_SCIENCE_TOPIC_RE.match(topic_id)
            strand = match.group("strand") if match else ""
            sub_strand = raw_topic.get("sub_strand")
            payload.update({
                "strand": {
                    "U": "Science Understanding",
                    "H": "Science as a Human Endeavour",
                    "I": "Science Inquiry",
                }.get(strand, "Science Understanding"),
                "sub_strand": sub_strand if sub_strand in {"B", "C", "P", "E"} else None,
                "year_level": scope.year_level,
                "achievement_standard_text": str(raw_topic.get("achievement_standard_text") or ""),
                "content_descriptor_text": str(raw_topic.get("content_descriptor_text") or ""),
            })
        else:
            match = _QCAA_TOPIC_RE.match(topic_id)
            if not match:
                raise ValueError(f"cannot derive QCAA metadata from topic_id {topic_id!r}")
            payload.update({
                "syllabus_subject": str(raw_topic.get("syllabus_subject") or match.group("subject").lower()),
                "unit": scope.unit,
                "topic_number": int(raw_topic.get("topic_number") or match.group("topic")),
            })
        return payload

    @classmethod
    def _canonical_topic_models(
        cls,
        raw_topic: dict[str, Any],
        scope: IngestionScope,
    ) -> list[SubjectTopic]:
        return [
            _SUBJECT_TOPIC_ADAPTER.validate_python(
                cls._canonical_topic_payload(raw_topic, scope, topic_id)
            )
            for topic_id in cls._topic_id_candidates(raw_topic, scope)
        ]

    @staticmethod
    def _canonical_exercise_payload(
        raw_exercise: dict[str, Any],
        scope: IngestionScope,
    ) -> dict[str, Any]:
        if not isinstance(raw_exercise, dict):
            raise ValueError("exercise extraction must be an object")
        allowed = set(ExerciseItem.model_fields)
        payload = {key: value for key, value in raw_exercise.items() if key in allowed}
        topic_ids = DataIngestionPipeline._topic_id_candidates(raw_exercise, scope)
        payload.update({
            "id": str(raw_exercise.get("id") or "pending"),
            "topic": str(raw_exercise.get("topic") or topic_ids[0]),
            "topic_ids": topic_ids,
            "framework": scope.framework_id,
            "subject": scope.subject,
            "difficulty": raw_exercise.get("difficulty") or "developing",
            "question_type": raw_exercise.get("question_type") or "short_answer",
            "complexity": raw_exercise.get("complexity") or "simple_familiar",
            "year_level": scope.year_level,
            "unit": scope.unit,
            "question": str(raw_exercise.get("question") or ""),
            "answer": str(raw_exercise.get("answer") or ""),
            "steps": raw_exercise.get("steps") or [],
        })
        return payload

    def normalize_exercise(self, ex: dict) -> dict:
        """Normalize media tags and ensure a fresh staging identifier."""
        ex["answer"] = str(ex.get("answer") or "").strip()
        if not ex.get("steps"):
            ex["steps"] = ["Calculate carefully based on the rules."]

        pattern = r'\[(?:插图|图)\s*:\s*([^\]]+\.(?:png|jpg|jpeg|gif))\]'

        def repl(match):
            filename = match.group(1).strip()
            return f"![图](/images/{filename})"

        ex["question"] = re.sub(pattern, repl, str(ex.get("question") or ""))

        if not ex.get("diagram_data") and not ex.get("diagram_description"):
            img_pattern = r'!\[.*?\]\((/images/[^)]+)\)'
            img_matches = re.findall(img_pattern, ex["question"])
            if img_matches:
                img_path = img_matches[0]
                ex["image"] = img_path
                description = self.describe_image(img_path)
                if description:
                    ex["diagram_description"] = description
                    print(f"    ✅ Auto-described image: {img_path}")

        ex["id"] = f"auto_{uuid.uuid4().hex[:8]}"
        return ex

    def describe_image(self, image_path: str) -> str | None:
        """Describe one local image once; return None when unavailable."""
        if not self.client:
            return None
        local_file = project_root / "frontend" / "public" / image_path.lstrip("/")
        if not local_file.exists():
            print(f"    ⚠️ Image not found: {local_file}")
            return None
        with open(local_file, "rb") as f:
            encoded = base64.b64encode(f.read()).decode("utf-8")
        mime = "image/png" if image_path.lower().endswith(".png") else "image/jpeg"
        try:
            response = self.client.chat.completions.create(
                model=self.default_model,
                messages=[{
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "Describe this educational diagram in detail for a Year 7 student. "
                                    "List all visible labels, measurements, shapes, and their spatial relationships. "
                                    "Be precise about numbers and units. Keep it under 100 words.",
                        },
                        {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{encoded}"}},
                    ],
                }],
                temperature=0.1,
                max_tokens=200,
            )
            return (response.choices[0].message.content or "").strip() or None
        except Exception as exc:
            print(f"    ⚠️ Vision API failed for {image_path}: {exc}")
            return None

    def split_markdown_by_headings(self, text: str) -> list[str]:
        """Split markdown into manageable chunks based on H2 headings."""
        parts = re.split(r'(?=\n##\s)', text)
        chunks: list[str] = []
        current_chunk = ""
        for part in parts:
            if len(current_chunk) + len(part) > 8000:
                if current_chunk:
                    chunks.append(current_chunk.strip())
                current_chunk = part
            else:
                current_chunk += part
        if current_chunk:
            chunks.append(current_chunk.strip())
        return chunks if chunks else [text]

    def split_text_chunks(self, text: str, max_chars: int = 8000) -> list[str]:
        """Split raw text into chunks by paragraphs."""
        paragraphs = text.split("\n\n")
        chunks: list[str] = []
        current = ""
        for paragraph in paragraphs:
            if len(current) + len(paragraph) > max_chars:
                if current:
                    chunks.append(current.strip())
                current = paragraph
            else:
                current += "\n\n" + paragraph
        if current:
            chunks.append(current.strip())
        return chunks if chunks else [text]

    def _call_llm_json(self, prompt: str, system_msg: str = "") -> str | None:
        """Call the selected provider and return raw JSON text."""
        if not self.client:
            return None
        messages = []
        if system_msg:
            messages.append({"role": "system", "content": system_msg})
        messages.append({"role": "user", "content": prompt})
        kwargs = {
            "model": self.default_model,
            "messages": messages,
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
        }
        try:
            response = self.client.chat.completions.create(**kwargs)
        except Exception as exc:
            msg = str(exc).lower()
            retry_tokens = ("response_format", "json_object", "unsupported parameter", "not supported", "json mode")
            if not any(token in msg for token in retry_tokens):
                raise
            kwargs.pop("response_format", None)
            response = self.client.chat.completions.create(**kwargs)
        return response.choices[0].message.content

    def ingest_syllabus(
        self,
        raw_filepath: str | os.PathLike[str],
        *,
        framework_id: str | None = None,
        subject: str | None = None,
        year_level: int | None | object = ...,
        unit: int | None | object = ...,
    ) -> None:
        """Extract a canonical FrameworkSliceFile into staging."""
        scope = self._scope_for(
            framework_id=framework_id,
            subject=subject,
            year_level=year_level,
            unit=unit,
        )
        raw_path = self.raw_dir / os.fspath(raw_filepath)
        if not raw_path.exists():
            print(f"Error: {raw_path} not found.")
            return
        raw_text = raw_path.read_text(encoding="utf-8")
        print(f"Processing Syllabus from {raw_filepath}...")
        if not self.client:
            print("MOCK MODE: Pretending to extract syllabus...")
            return

        chunks = self.split_markdown_by_headings(raw_text)
        print(f"Split syllabus into {len(chunks)} chunks for LLM processing.")
        all_topics: dict[str, SubjectTopic] = {}
        for index, chunk in enumerate(chunks):
            print(f"  -> Processing chunk {index + 1}/{len(chunks)}...")
            prompt = SYLLABUS_INGESTION_PROMPT.format(raw_text=chunk) + self._scope_prompt(scope)
            try:
                raw_json = self._call_llm_json(
                    prompt,
                    system_msg="You are a helpful curriculum data extraction assistant. Return valid JSON.",
                )
                if not raw_json:
                    continue
                for topic_dict in _parse_json_object(raw_json).get("topics", []):
                    try:
                        for topic in self._canonical_topic_models(topic_dict, scope):
                            all_topics[topic.topic_id] = topic
                    except (TypeError, ValueError, ValidationError) as exc:
                        print(f"  -> Warning: Skipping invalid topic in chunk {index + 1}: {exc}")
            except Exception as exc:
                print(f"  -> Warning: Failed to parse chunk {index + 1}. Error: {exc}")

        topic_ids = list(all_topics)
        envelope = FrameworkSliceFile(
            framework_id=scope.framework_id,
            topics=list(all_topics.values()),
            sequence=CurriculumSequence(
                sequence=topic_ids,
                prerequisites={},
                is_strict=False,
            ),
        )
        out_path = self.staging_dir / "curriculum_draft.json"
        out_path.write_text(
            json.dumps(envelope.model_dump(mode="json"), indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(f"✅ Syllabus extraction complete. Extracted {len(all_topics)} topics. Saved to {out_path}")

    def ingest_exercises(
        self,
        raw_filepath: str | os.PathLike[str],
        *,
        framework_id: str | None = None,
        subject: str | None = None,
        year_level: int | None | object = ...,
        unit: int | None | object = ...,
    ) -> None:
        """Extract canonical ExerciseItems into a staging JSON array."""
        scope = self._scope_for(
            framework_id=framework_id,
            subject=subject,
            year_level=year_level,
            unit=unit,
        )
        raw_path = self.raw_dir / os.fspath(raw_filepath)
        if not raw_path.exists():
            print(f"Error: {raw_path} not found.")
            return
        raw_text = raw_path.read_text(encoding="utf-8")
        print(f"Processing Exercises from {raw_filepath}...")
        if not self.client:
            print("MOCK MODE: Pretending to extract exercises...")
            return

        chunks = self.split_text_chunks(raw_text)
        print(f"Split exercises into {len(chunks)} chunks for LLM processing.")
        all_exercises: list[dict[str, Any]] = []
        for index, chunk in enumerate(chunks):
            print(f"  -> Processing chunk {index + 1}/{len(chunks)}...")
            prompt = EXERCISE_INGESTION_PROMPT.format(raw_text=chunk) + self._scope_prompt(scope)
            try:
                raw_json = self._call_llm_json(
                    prompt,
                    system_msg="You are an expert tutor creating canonical structured exercises. Return valid JSON.",
                )
                if not raw_json:
                    continue
                for raw_exercise in _parse_json_object(raw_json).get("exercises", []):
                    try:
                        payload = self._canonical_exercise_payload(raw_exercise, scope)
                        normalized = self.normalize_exercise(payload)
                        validated = ExerciseItem.model_validate(normalized)
                        all_exercises.append(validated.model_dump(mode="json"))
                    except (TypeError, ValueError, ValidationError) as exc:
                        print(f"  -> Warning: Skipping invalid exercise in chunk {index + 1}: {exc}")
            except Exception as exc:
                print(f"  -> Warning: Failed to parse chunk {index + 1}. Error: {exc}")

        out_path = self.staging_dir / "exercise_draft.json"
        out_path.write_text(
            json.dumps(all_exercises, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(f"✅ Exercise extraction complete. Extracted {len(all_exercises)} exercises. Saved to {out_path}")


if __name__ == "__main__":
    pipeline = DataIngestionPipeline()
    if len(sys.argv) > 1:
        for filename in sys.argv[1:]:
            if "syllabus" in filename.lower() or filename.endswith(".md"):
                pipeline.ingest_syllabus(filename)
            else:
                pipeline.ingest_exercises(filename)
    else:
        print("Usage: python3 ingestion_v2.py [syllabus_file] [exercise_file]")
        print("Files must be located in the raw_data/ directory.")
