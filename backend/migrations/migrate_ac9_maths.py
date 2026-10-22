"""AC9 Mathematics migration script (Phase 1 — Year 7 only).

Reads ``data/sources/Math/ac9_maths_yr7_as_cd_alignment.md`` (the QCAA-published
alignment matrix), extracts AC9 Year 7 Maths codes, and writes
``data/curriculum/ac9_maths/year7.json`` as a validated ``FrameworkSliceFile``.

Implements design §3.5 of the curriculum-framework-foundation spec. Lifts
the table-parsing logic from the doomed ``backend/ingestion.py`` (slated
for deletion in Step 7), now with:

- per-Topic_Id dedup that preserves first-appearance order (Req 13.3 /
  no-duplicate-in-sequence invariant);
- later-row-wins for ``content_descriptor_text``, ``" | "``-joined
  ``achievement_standard_text`` for codes that span multiple rows
  (matches the legacy parser's behaviour);
- strand-letter → strand-name mapping derived from the registry's regex
  shape (re-imported via a dedicated ``_STRAND_LETTER_RE`` constant in
  this module to avoid coupling the parser to the registry's private
  regex);
- missing-source-document tolerance: a missing alignment markdown logs a
  warning and produces zero candidates rather than crashing (Req 7.8).

Run as ``python -m backend.migrations.migrate_ac9_maths``. Idempotent: a
second back-to-back run reports ``written=0`` because the canonical
serialiser produces byte-equivalent output for byte-equivalent input
(Req 7.4 / 7.5).
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

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

# Repository root — three parents up from this file:
#   migrate_ac9_maths.py → migrations/ → backend/ → repo root.
_REPO_ROOT = Path(__file__).resolve().parents[2]

_SOURCES_DIR = _REPO_ROOT / "data" / "sources" / "Math"
_SOURCE_PATH = _SOURCES_DIR / "ac9_maths_yr7_as_cd_alignment.md"
_CURRICULUM_ROOT = _REPO_ROOT / "data" / "curriculum"

# AC9 Maths code shape, mirrored from the registry validator regex but kept
# local so the parser does not depend on a private symbol of
# ``backend.curriculum_frameworks``. Group 1 is the year digit(s); group 2 is
# the strand letter(s).
_STRAND_LETTER_RE = re.compile(r"^AC9M(7|8|9|10)(N|A|M|SP|ST|P)\d{2}$")

# Strand letter → human strand name (Req 13.2). The keys match the
# capturing group 2 of ``_STRAND_LETTER_RE`` exactly.
_STRAND_NAME_BY_LETTER: dict[str, str] = {
    "N": "Number",
    "A": "Algebra",
    "M": "Measurement",
    "SP": "Space",
    "ST": "Statistics",
    "P": "Probability",
}

# Bullet-marker prefixes the parser strips off the front of each
# ``<br>``-delimited cell fragment. Keeps the description text matching the
# legacy parser's behaviour (Req 13.1).
_BULLET_PREFIXES = ("•", "*", "-")


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------


def _strip_bullet(fragment: str) -> str:
    """Trim a leading bullet marker plus surrounding whitespace from ``fragment``."""
    text = fragment.strip()
    for marker in _BULLET_PREFIXES:
        if text.startswith(marker):
            text = text[len(marker):].lstrip()
            break
    return text


def _clean_aspect(cell: str) -> str:
    """Normalise an aspect cell: strip ``**`` and ``<br>`` markers, collapse whitespace.

    The aspect column in the alignment markdown wraps multiple bold
    sentences for the same code-list with ``<br><br>`` separators (e.g.
    ``**They use all 4 operations ...**<br><br>**They choose between ...**``).
    Both ``**`` and ``<br>`` are markdown rendering hints; in plain-text
    storage we want them converted to whitespace so downstream renderers
    don't have to know about markdown internals.
    """
    text = cell.replace("**", "")
    text = re.sub(r"<br\s*/?>", " ", text, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", text).strip()


def _is_alignment_header(line: str) -> bool:
    """Return true for the source alignment-table header row."""
    lowered = line.lower()
    return (
        lowered.startswith("| achievement standard")
        and "content description" in lowered
        and "ac v9.0 code" in lowered
    )


def _derive_name(aspect_text: str, topic_id: str) -> str:
    """Pick a topic ``name`` from the cleaned aspect text.

    Heuristic: take the first sentence (up to and including the first
    full stop). If the cleaned aspect is empty, fall back to the topic_id
    itself so the schema's ``name`` field remains non-empty.
    """
    text = aspect_text.strip()
    if not text:
        return topic_id
    period_index = text.find(".")
    if period_index == -1:
        return text
    return text[:period_index].strip() or topic_id


def _strand_for(topic_id: str) -> str:
    """Return the strand name for ``topic_id``.

    Caller has already verified ``topic_id`` is a valid AC9_Maths_Code, so
    the regex match always succeeds. We keep the assertion for clarity —
    a mismatch here would indicate the registry validator and the local
    regex have drifted.
    """
    match = _STRAND_LETTER_RE.match(topic_id)
    assert match is not None, f"_strand_for called with invalid topic_id {topic_id!r}"
    return _STRAND_NAME_BY_LETTER[match.group(2)]


def _empty_concept_card() -> dict:
    """Return the default empty ``concept_card`` payload."""
    return {"core_rule": "", "hint_levels": []}


# ---------------------------------------------------------------------------
# Migration class
# ---------------------------------------------------------------------------


class AC9MathsMigration(BaseFrameworkMigration):
    """Per-framework migration script for AC9 Mathematics.

    Phase 1 ships Year 7 only. Years 8-10 source documents are not present;
    when a source is missing this migration produces zero candidates and
    leaves the corresponding slice files untouched (the empty Year 8-10
    shells are written by the AC9 English/Science scripts pattern in
    Task 16, not here, since the AC9_Maths source is the only AC9 Maths
    source we have today).
    """

    # --- Required abstract methods -----------------------------------------

    def framework_id(self) -> str:
        return "AC9_MATHS"
    def parse_source_documents(self) -> list[TopicCandidate]:
        """Load Year 7-10 alignment markdowns and return candidates."""
        candidates = []
        source_files = sorted(_SOURCES_DIR.glob("ac9_maths_yr*_as_cd_alignment.md"))
        if not source_files:
            logger.warning(
                "No AC9 Maths source documents found in %s; producing zero candidates",
                _SOURCES_DIR,
            )
            return []
        
        # Parse each file and collect candidates
        for source_file in source_files:
            logger.info("Parsing AC9 Maths source document: %s", source_file)
            text = source_file.read_text(encoding="utf-8")
            candidates.extend(self._parse_alignment_matrix(text))
            
        # Deduplicate candidates across files by topic_id (preserving order)
        seen = set()
        deduped = []
        for c in candidates:
            if c.topic_id not in seen:
                seen.add(c.topic_id)
                deduped.append(c)
            else:
                # Merge duplicate descriptors/aspects
                prior = next(x for x in deduped if x.topic_id == c.topic_id)
                self._merge_duplicate(
                    prior,
                    c.payload["achievement_standard_text"],
                    c.payload["content_descriptor_text"]
                )
        return deduped

    def output_path_for(self, candidate: TopicCandidate) -> Path:
        """Resolve the slice file for ``candidate`` based on its year_level."""
        year_level = candidate.payload["year_level"]
        return _CURRICULUM_ROOT / "ac9_maths" / f"year{year_level}.json"

    def sequence_for(
        self,
        slice_path: Path,
        candidates: list[TopicCandidate],
    ) -> CurriculumSequence:
        """Return a non-strict sequence in document-first-appearance order.

        ``candidates`` here is the validator-filtered group for this slice;
        because the parser already deduplicates by topic_id, the sequence
        list contains each code at most once (Req 13.3 no-duplicate-in-
        sequence invariant).
        """
        return CurriculumSequence(
            sequence=[c.topic_id for c in candidates],
            prerequisites={},
            is_strict=False,
        )

    # --- Parser ------------------------------------------------------------

    def _parse_alignment_matrix(self, text: str) -> list[TopicCandidate]:
        """Walk the alignment-matrix table and return one candidate per code.

        Algorithm:

        1. Skip lines until the table header row beginning ``| Achievement
           Standard Aspect |``.
        2. Skip the separator row (``| :--- |``).
        3. For each subsequent table row (line starting with ``|``):
           - split into three cells (aspect, descriptions, codes);
           - clean the aspect (strip ``**``, normalise whitespace);
           - split descriptions and codes by ``<br>``, strip bullets;
           - for each code, attach the matching description by index when
             ``len(descs) == len(codes)``, else fall back to the joined
             descriptions string.
        4. Stop at the first blank line after the table.

        Per-Topic_Id dedup (Req 13.3):

        - first occurrence sets the candidate's order in the returned list;
        - later occurrences concatenate ``achievement_standard_text`` with
          ``" | "`` (matches the legacy parser's behaviour) and overwrite
          ``content_descriptor_text`` (later row wins, per design §3.5).
        """
        # Preserve insertion order so the returned list reflects document
        # order even after dedup.
        by_topic_id: dict[str, TopicCandidate] = {}

        in_table = False
        seen_header = False

        for raw_line in text.splitlines():
            line = raw_line.strip()

            if _is_alignment_header(line):
                in_table = True
                seen_header = True
                continue

            if not in_table:
                continue

            # Separator row immediately after the header.
            if line.startswith("| :---"):
                continue

            # Blank line ends the table.
            if not line:
                in_table = False
                continue

            # Any non-table line (e.g., the next markdown heading) ends
            # the table. We don't expect this between header and first
            # blank line in the Year 7 source, but defensive parsing keeps
            # us safe if the source layout changes.
            if not line.startswith("|"):
                in_table = False
                continue

            cells = [c.strip() for c in line.split("|")[1:-1]]
            if len(cells) < 3:
                continue

            aspect_cleaned = _clean_aspect(cells[0])

            descriptions = [
                _strip_bullet(d)
                for d in cells[1].split("<br>")
                if d.strip()
            ]
            codes = [c.strip() for c in cells[2].split("<br>") if c.strip()]
            if not codes:
                continue

            for index, code in enumerate(codes):
                if len(descriptions) == len(codes):
                    descriptor_text = descriptions[index]
                else:
                    descriptor_text = " ".join(descriptions)

                if code in by_topic_id:
                    self._merge_duplicate(
                        by_topic_id[code], aspect_cleaned, descriptor_text
                    )
                else:
                    by_topic_id[code] = self._build_candidate(
                        topic_id=code,
                        aspect_text=aspect_cleaned,
                        descriptor_text=descriptor_text,
                    )

        if not seen_header:
            logger.warning(
                "AC9 Maths source contained no alignment-matrix table; produced zero candidates"
            )

        return list(by_topic_id.values())

    # --- Candidate construction / merge ------------------------------------

    @staticmethod
    def _build_candidate(
        *,
        topic_id: str,
        aspect_text: str,
        descriptor_text: str,
    ) -> TopicCandidate:
        """Build the initial ``TopicCandidate`` for a first-occurrence row.

        The ``strand`` field is derived from the topic_id even when the code
        is not registry-valid; if the validator later rejects the code, the
        ``run()`` orchestrator will discard the candidate before the strand
        ever reaches Pydantic. We protect against malformed codes here by
        falling back to the topic_id as the strand placeholder so the dict
        remains shaped correctly for downstream serialisation in tests that
        bypass the validator gate.
        """
        match = _STRAND_LETTER_RE.match(topic_id)
        if match is None:
            strand = topic_id  # placeholder — will be filtered by validator
            year_level = 7
        else:
            strand = _STRAND_NAME_BY_LETTER[match.group(2)]
            year_level = int(match.group(1))

        payload = {
            "framework": "AC9_MATHS",
            "topic_id": topic_id,
            "name": _derive_name(aspect_text, topic_id),
            "strand": strand,
            "year_level": year_level,
            "achievement_standard_text": aspect_text,
            "content_descriptor_text": descriptor_text,
            "elaborations": [],
            "supplementary_resources": [],
            "skills": [],
            "concept_card": _empty_concept_card(),
        }
        return TopicCandidate(topic_id=topic_id, payload=payload)

    @staticmethod
    def _merge_duplicate(
        candidate: TopicCandidate,
        aspect_text: str,
        descriptor_text: str,
    ) -> None:
        """Fold a duplicate row into ``candidate`` (Req 13.3).

        - ``achievement_standard_text``: ``" | "``-joined union (skipping
          duplicate fragments to keep output concise without changing
          semantics).
        - ``content_descriptor_text``: later row wins (design §3.5).
        - ``name``: keep the first-row name. The aspect text may differ
          across rows for the same code; the first-row name is the most
          stable choice and downstream consumers rely on the
          achievement-standard text for full context.
        """
        prior_aspect = candidate.payload["achievement_standard_text"]
        if aspect_text and aspect_text not in prior_aspect.split(" | "):
            candidate.payload["achievement_standard_text"] = (
                f"{prior_aspect} | {aspect_text}" if prior_aspect else aspect_text
            )
        if descriptor_text:
            candidate.payload["content_descriptor_text"] = descriptor_text


# ---------------------------------------------------------------------------
# CLI entrypoint
# ---------------------------------------------------------------------------


def _configure_cli_logging() -> None:
    """Attach a stream handler at INFO to ``backend.migrations`` for CLI runs.

    Library imports (and tests) keep the logger silent because
    ``base.py`` only adds a ``NullHandler``. CLI runs need real output, so
    we attach a stream handler here, idempotently — re-runs in the same
    process (e.g., from a REPL) do not duplicate handlers.
    """
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
    """Render the run summary on stdout for CLI users."""
    print("AC9_MATHS migration complete:")
    print(f"  extracted: {summary.extracted}")
    print(f"  written:   {summary.written}")
    print(f"  skipped:   {summary.skipped}")
    if summary.skipped_reasons:
        print(f"  reasons:   {summary.skipped_reasons}")


if __name__ == "__main__":
    _configure_cli_logging()
    summary = AC9MathsMigration().run()
    _print_summary(summary)
