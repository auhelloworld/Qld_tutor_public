"""AC9 English migration script.

Reads ``data/sources/English/ac9_english_yr7_as_cd_alignment.md`` (the QCAA-published
alignment matrix) and ``data/sources/English/english-curriculum-content-7-10-v9.docx``
(the detailed ACARA curriculum specification), extracts Year 7 English codes,
strands, sub-strands, descriptions, and official elaborations, and writes
``data/curriculum/ac9_english/year7.json`` as a validated ``FrameworkSliceFile``.

Scope: this migration manages **only Year 7 English**. Years 8–10 English are
authored separately (their own curriculum slices + exercise banks) and are NOT
written or overwritten here.

Implements design §3.5 of the curriculum-framework-foundation spec. Lifts
and adapts table-parsing and DOCX XML extraction logic, ensuring:
- per-Topic_Id dedup that preserves first-appearance order;
- later-row-wins for ``content_descriptor_text``;
- ``" | "``-joined ``achievement_standard_text`` for codes that span multiple rows/aspects;
- row-span aspect propagation for empty first cells in markdown tables;
- XML-based parsing of the DOCX document to extract official elaborations.

Run as ``python -m backend.migrations.migrate_ac9_english``. Idempotent.
"""

from __future__ import annotations

import glob
import logging
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

from backend.migrations.base import (
    BaseFrameworkMigration,
    MigrationRunSummary,
    TopicCandidate,
    logger,
)
from core.schema.curriculum_schema import CurriculumSequence


# ---------------------------------------------------------------------------
# Module-level constants
# ---------------------------------------------------------------------------

_REPO_ROOT = Path(__file__).resolve().parents[2]
_SOURCES_DIR = _REPO_ROOT / "data" / "sources" / "English"
_CURRICULUM_ROOT = _REPO_ROOT / "data" / "curriculum"

_ALIGNMENT_PATH = _SOURCES_DIR / "ac9_english_yr7_as_cd_alignment.md"
_DOCX_PATH = _SOURCES_DIR / "english-curriculum-content-7-10-v9.docx"

_SUPPORTED_YEAR_LEVELS = (7, 8, 9, 10)


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

def _clean_text(text: str) -> str:
    """Normalise whitespace and strip markdown bolding."""
    text = text.replace("**", "")
    text = re.sub(r"<br\s*/?>", " ", text, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", text).strip()


def _derive_name(aspect_text: str, topic_id: str) -> str:
    """Derive topic name from the first sentence of the aspect text."""
    text = aspect_text.strip()
    if not text:
        return topic_id
    period_index = text.find(".")
    if period_index == -1:
        return text
    return text[:period_index].strip() or topic_id


def _parse_curriculum_docx(docx_path: Path) -> dict[str, dict[str, Any]]:
    """Unzip the DOCX and extract all Year 7 English content descriptions and elaborations.

    Returns a dict mapping topic_id -> {
        'strand': strand,
        'sub_strand': sub_strand,
        'content_descriptor_text': description_text,
        'elaborations': list of elab strings
    }
    """
    WORD_NAMESPACE = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
    PARA = WORD_NAMESPACE + 'p'
    TEXT = WORD_NAMESPACE + 't'

    if not docx_path.exists():
        logger.warning("English DOCX syllabus not found at %s", docx_path)
        return {}

    logger.info("Extracting paragraphs from English DOCX syllabus: %s", docx_path)
    try:
        with zipfile.ZipFile(docx_path) as docx:
            tree = ET.parse(docx.open('word/document.xml'))
            root = tree.getroot()

            paragraphs = []
            for paragraph in root.iter(PARA):
                texts = [node.text for node in paragraph.iter(TEXT) if node.text]
                if texts:
                    paragraphs.append(''.join(texts).strip())
    except Exception as e:
        logger.error("Failed to parse DOCX file: %s", e)
        return {}

    results = {}
    current_strand = None
    current_sub_strand = None
    in_year7 = False

    i = 0
    while i < len(paragraphs):
        p = paragraphs[i]
        
        # Detect Strand
        if p.startswith("Strand: "):
            current_strand = p[len("Strand: "):].strip()
            i += 1
            continue
            
        # Detect Year Level
        if p == "Year 7":
            in_year7 = True
            i += 1
            continue
        elif p.startswith("Year ") and p != "Year 7":
            in_year7 = False
            i += 1
            continue
            
        # Detect Sub-strand
        if p.startswith("Sub-strand: "):
            current_sub_strand = p[len("Sub-strand: "):].strip()
            i += 1
            continue

        # Look for Year 7 content codes (e.g. AC9E7LA01)
        # The structure is:
        # Paragraph i: Content description text
        # Paragraph i+1: Code (e.g. AC9E7LA01)
        # Paragraph i+2...: Elaborations (until next sub-strand/strand/year or next code description)
        match = re.match(r'^AC9E7(LA|LE|LY)\d{2}$', p)
        if match and in_year7:
            code = p
            desc_text = paragraphs[i-1] if i > 0 else ""

            # Extract elaborations
            elaborations = []
            j = i + 1
            while j < len(paragraphs):
                next_p = paragraphs[j]
                if next_p.startswith("Strand: ") or next_p.startswith("Sub-strand: ") or next_p.startswith("Year "):
                    break
                if re.match(r'^AC9E7(LA|LE|LY)\d{2}$', next_p):
                    break
                # Look-ahead: if the next paragraph's successor is a code, then the next paragraph
                # is the description of that code, meaning we must stop collecting elaborations now.
                if j + 1 < len(paragraphs) and re.match(r'^AC9E7(LA|LE|LY)\d{2}$', paragraphs[j+1]):
                    break
                
                if next_p in ("Content descriptionsStudents learn to:", "Content elaborations", "This may involve students:"):
                    j += 1
                    continue
                if next_p:
                    elaborations.append(next_p)
                j += 1

            # Normalise strand names for validation
            strand_map = {
                "Language": "Language",
                "Literature": "Literature",
                "Literacy": "Literacy",
            }
            results[code] = {
                "strand": strand_map.get(current_strand, "Language"),
                "sub_strand": current_sub_strand or "",
                "content_descriptor_text": desc_text,
                "elaborations": elaborations,
            }
            i = j
            continue

        i += 1

    return results


# ---------------------------------------------------------------------------
# Migration class
# ---------------------------------------------------------------------------

class AC9EnglishMigration(BaseFrameworkMigration):
    """Per-framework migration script for AC9 English.

    Parses the alignment matrix markdown and enriches the topics with detailed
    fields and official elaborations extracted from the DOCX file.
    """

    def framework_id(self) -> str:
        return "AC9_ENGLISH"

    def parse_source_documents(self) -> list[TopicCandidate]:
        """Load alignment matrix markdown, extract aspects and codes, and merge with DOCX data."""
        if not _ALIGNMENT_PATH.exists():
            logger.warning("AC9 English: alignment matrix document not found at %s; producing zero candidates", _ALIGNMENT_PATH)
            return []

        # Parse detailed syllabus descriptions and elaborations first
        docx_data = _parse_curriculum_docx(_DOCX_PATH)

        # Parse alignment matrix markdown
        logger.info("Parsing AC9 English alignment matrix: %s", _ALIGNMENT_PATH)
        alignment_text = _ALIGNMENT_PATH.read_text(encoding="utf-8")

        by_topic_id: dict[str, TopicCandidate] = {}
        current_aspect = ""
        in_table = False

        for raw_line in alignment_text.splitlines():
            line = raw_line.strip()

            if line.startswith("| Achievement Standard Aspect |"):
                in_table = True
                continue

            if not in_table:
                continue

            if line.startswith("| :---"):
                continue

            if not line:
                in_table = False
                continue

            if not line.startswith("|"):
                in_table = False
                continue

            cells = [c.strip() for c in line.split("|")[1:-1]]
            if len(cells) < 3:
                continue

            aspect_cleaned = _clean_text(cells[0])
            if aspect_cleaned:
                current_aspect = aspect_cleaned

            codes = [c.strip() for c in cells[2].split("<br>") if c.strip()]
            if not codes:
                continue

            for code in codes:
                # Retrieve structural detail from docx
                details = docx_data.get(code, {})
                strand = details.get("strand", "Language")
                sub_strand = details.get("sub_strand", "")
                
                # Use official description from DOCX, or fall back to code name
                desc_text = details.get("content_descriptor_text", code)

                # Convert plain-text elaborations to schema format
                elabs_payload = []
                for idx, elab_text in enumerate(details.get("elaborations", [])):
                    elabs_payload.append({
                        "elaboration_id": f"{code}_E{idx + 1}",
                        "text": elab_text,
                        "source": "acara_official",
                    })

                if code in by_topic_id:
                    self._merge_duplicate(by_topic_id[code], current_aspect, desc_text)
                else:
                    payload = {
                        "framework": "AC9_ENGLISH",
                        "topic_id": code,
                        "name": _derive_name(current_aspect, code),
                        "strand": strand,
                        "sub_strand": sub_strand,
                        "year_level": 7,
                        "achievement_standard_text": current_aspect,
                        "content_descriptor_text": desc_text,
                        "elaborations": elabs_payload,
                        "supplementary_resources": [],
                        "skills": [],
                        "concept_card": {"core_rule": "", "hint_levels": []},
                    }
                    by_topic_id[code] = TopicCandidate(topic_id=code, payload=payload)

        # Deduplicate and sort keys by first-appearance order
        return list(by_topic_id.values())

    def output_path_for(self, candidate: TopicCandidate) -> Path:
        year_level = candidate.payload["year_level"]
        return _CURRICULUM_ROOT / "ac9_english" / f"year{year_level}.json"

    def sequence_for(
        self,
        slice_path: Path,
        candidates: list[TopicCandidate],
    ) -> CurriculumSequence:
        return CurriculumSequence(
            sequence=[c.topic_id for c in candidates],
            prerequisites={},
            is_strict=False,
        )

    @staticmethod
    def _merge_duplicate(
        candidate: TopicCandidate,
        aspect_text: str,
        descriptor_text: str,
    ) -> None:
        """Fold duplicate row aspects and descriptions together."""
        prior_aspect = candidate.payload["achievement_standard_text"]
        if aspect_text and aspect_text not in prior_aspect.split(" | "):
            candidate.payload["achievement_standard_text"] = (
                f"{prior_aspect} | {aspect_text}" if prior_aspect else aspect_text
            )
        if descriptor_text:
            candidate.payload["content_descriptor_text"] = descriptor_text

    # NOTE: This migration intentionally manages ONLY Year 7 English (its rich
    # docx + alignment-matrix source). Years 8–10 English are authored separately
    # and live in their own slices/exercise banks, so this migration must NOT
    # write or overwrite them. (An earlier version emitted empty Y8–10 shells,
    # which — now that those years are authored — would destroy real content;
    # that override has been removed. See Audit §7.2.)


# ---------------------------------------------------------------------------
# CLI entrypoint
# ---------------------------------------------------------------------------

def _configure_cli_logging() -> None:
    backend_logger = logging.getLogger("backend.migrations")
    if not any(
        isinstance(h, logging.StreamHandler) and not isinstance(h, logging.NullHandler)
        for h in backend_logger.handlers
    ):
        handler = logging.StreamHandler()
        handler.setFormatter(
            logging.Formatter("%(levelname)s %(name)s: %(message)s")
        )
        backend_logger.addHandler(handler)
    backend_logger.setLevel(logging.INFO)


def _print_summary(summary: MigrationRunSummary) -> None:
    print("AC9_ENGLISH migration complete:")
    print(f"  extracted: {summary.extracted}")
    print(f"  written:   {summary.written}")
    print(f"  skipped:   {summary.skipped}")


if __name__ == "__main__":
    _configure_cli_logging()
    summary = AC9EnglishMigration().run()
    _print_summary(summary)
