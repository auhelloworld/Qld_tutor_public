"""Misconception Library — loader, index, and detection engine.

Design §3.3 — misconception-library spec.
Loads misconception and worked-example records from production directories,
validates them, builds in-memory indices, and provides a `detect()` function
for signature-based misconception matching at grading time.
"""
from __future__ import annotations

import json
import logging
import re
import threading
from pathlib import Path

import yaml

from core.schema.misconception_schema import (
    MisconceptionRecord,
    WorkedExampleRecord,
)

LOG = logging.getLogger(__name__)

project_root = Path(__file__).parent.parent
PROD_DIR = project_root / "data" / "misconceptions" / "prod"
WE_DIR = project_root / "data" / "misconceptions" / "worked_examples"
APPROVAL_PATH = project_root / "data" / "misconceptions" / "approvals.yaml"


class MisconceptionLibrary:
    """In-memory index of misconception and worked-example records."""

    def __init__(self) -> None:
        self.misconceptions: dict[str, MisconceptionRecord] = {}
        self.worked_examples: dict[str, WorkedExampleRecord] = {}
        self.by_topic_id: dict[str, list[MisconceptionRecord]] = {}
        self.we_by_topic_id: dict[str, list[WorkedExampleRecord]] = {}
        self.we_by_misconception: dict[str, list[WorkedExampleRecord]] = {}
        self._load()

    def _load_approvals(self) -> dict[str, dict]:
        """Parse approvals.yaml into {misconception_id: {reviewer, approved_at, note}}."""
        if not APPROVAL_PATH.exists():
            return {}
        try:
            raw = yaml.safe_load(APPROVAL_PATH.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                return raw
            return {}
        except Exception as e:
            LOG.error("Failed to parse approvals.yaml: %s", e)
            return {}

    def _all_topic_ids_resolvable(self, topic_ids: list[str]) -> bool:
        """Check that every topic_id resolves via Phase 1's framework registry."""
        from backend.curriculum_frameworks import get_framework_for_topic_id

        for tid in topic_ids:
            if get_framework_for_topic_id(tid) is None:
                return False
        return True

    def _load(self) -> None:
        """Load all misconception and worked-example records from disk."""
        approvals = self._load_approvals()

        # --- Load misconceptions ---
        seen_ids: set[str] = set()
        if PROD_DIR.exists():
            for path in sorted(PROD_DIR.glob("*.json")):
                try:
                    data = json.loads(path.read_text(encoding="utf-8"))
                except (json.JSONDecodeError, OSError) as e:
                    LOG.error("Failed to read misconception file %s: %s", path, e)
                    continue

                for raw in data.get("misconceptions", []):
                    try:
                        rec = MisconceptionRecord.model_validate(raw)
                    except Exception as e:
                        mid = raw.get("misconception_id", "<unknown>")
                        LOG.error("Misconception validation failed for %s: %s", mid, e)
                        continue

                    if rec.misconception_id in seen_ids:
                        LOG.error("Duplicate misconception_id: %s", rec.misconception_id)
                        continue

                    if rec.misconception_id not in approvals:
                        LOG.warning("Unapproved misconception in production: %s", rec.misconception_id)

                    if not self._all_topic_ids_resolvable(rec.topic_ids):
                        LOG.error(
                            "Misconception %s references unresolvable topic_ids: %s",
                            rec.misconception_id,
                            rec.topic_ids,
                        )
                        continue

                    self.misconceptions[rec.misconception_id] = rec
                    seen_ids.add(rec.misconception_id)
                    for tid in rec.topic_ids:
                        self.by_topic_id.setdefault(tid, []).append(rec)

        # --- Load worked examples ---
        seen_we_ids: set[str] = set()
        if WE_DIR.exists():
            for path in sorted(WE_DIR.glob("*.json")):
                try:
                    data = json.loads(path.read_text(encoding="utf-8"))
                except (json.JSONDecodeError, OSError) as e:
                    LOG.error("Failed to read worked-example file %s: %s", path, e)
                    continue

                for raw in data.get("worked_examples", []):
                    try:
                        rec = WorkedExampleRecord.model_validate(raw)
                    except Exception as e:
                        weid = raw.get("worked_example_id", "<unknown>")
                        LOG.error("Worked-example validation failed for %s: %s", weid, e)
                        continue

                    if rec.worked_example_id in seen_we_ids:
                        LOG.error("Duplicate worked_example_id: %s", rec.worked_example_id)
                        continue

                    if not self._all_topic_ids_resolvable(rec.topic_ids):
                        LOG.error(
                            "Worked example %s references unresolvable topic_ids: %s",
                            rec.worked_example_id,
                            rec.topic_ids,
                        )
                        continue

                    self.worked_examples[rec.worked_example_id] = rec
                    seen_we_ids.add(rec.worked_example_id)
                    for tid in rec.topic_ids:
                        self.we_by_topic_id.setdefault(tid, []).append(rec)
                    for mid in rec.targets_misconception_ids:
                        self.we_by_misconception.setdefault(mid, []).append(rec)

    def detect(
        self,
        *,
        topic_ids: list[str],
        question: dict,
        student_answer: str,
        correct_answer: str,
    ) -> str | None:
        """Return first matching misconception_id or None."""
        seen: set[str] = set()
        for tid in topic_ids:
            for rec in self.by_topic_id.get(tid, []):
                if rec.misconception_id in seen:
                    continue
                seen.add(rec.misconception_id)
                if self._record_matches(rec, question, student_answer, correct_answer):
                    return rec.misconception_id
        return None

    def list_for_subject(self, subject: str) -> list[dict]:
        """Return all misconception records whose topic_ids belong to frameworks supporting ``subject``."""
        from backend.curriculum_frameworks import FRAMEWORKS

        matching_tids: set[str] = set()
        for fw in FRAMEWORKS.values():
            if subject in fw.supported_subjects:
                for tid in self.by_topic_id:
                    if fw.validator(tid):
                        matching_tids.add(tid)

        out: list[dict] = []
        seen: set[str] = set()
        for tid in sorted(matching_tids):
            for rec in self.by_topic_id.get(tid, []):
                if rec.misconception_id not in seen:
                    out.append(rec.model_dump())
                    seen.add(rec.misconception_id)
        return out

    def list_worked_examples_for_subject(self, subject: str) -> list[dict]:
        """Return all worked-example records whose topic_ids belong to frameworks supporting ``subject``."""
        from backend.curriculum_frameworks import FRAMEWORKS

        matching_tids: set[str] = set()
        for fw in FRAMEWORKS.values():
            if subject in fw.supported_subjects:
                for tid in self.we_by_topic_id:
                    if fw.validator(tid):
                        matching_tids.add(tid)

        out: list[dict] = []
        seen: set[str] = set()
        for tid in sorted(matching_tids):
            for rec in self.we_by_topic_id.get(tid, []):
                if rec.worked_example_id not in seen:
                    out.append(rec.model_dump())
                    seen.add(rec.worked_example_id)
        return out

    def _record_matches(
        self,
        rec: MisconceptionRecord,
        question: dict,
        student: str,
        correct: str,
    ) -> bool:
        """Check if any detection signature on the record matches."""
        from backend.misconception_predicates import PREDICATE_REGISTRY

        for sig in rec.detection_signatures:
            try:
                if sig.kind == "regex":
                    if re.search(sig.pattern, student, re.IGNORECASE):
                        return True
                elif sig.kind == "numeric":
                    if self._numeric_match(sig.pattern, student, correct):
                        return True
                elif sig.kind == "predicate":
                    fn = PREDICATE_REGISTRY.get(sig.pattern)
                    if fn and fn(question, student, correct):
                        return True
            except Exception as e:
                LOG.warning(
                    "Signature match raised on %s: %s", rec.misconception_id, e
                )
        return False

    def _numeric_match(self, pattern: str, student: str, correct: str) -> bool:
        """Evaluate a numeric detection signature.

        Pattern is a JSON string like:
        {"op": "abs", "relation": "answer == abs(correct)"}
        """
        try:
            spec = json.loads(pattern) if isinstance(pattern, str) else pattern
            op = spec.get("op", "")
            s_val = float(student.strip())
            c_val = float(correct.strip())

            if op == "abs":
                # Student gives abs(correct) when correct is negative
                return c_val < 0 and abs(s_val - abs(c_val)) < 1e-9
            elif op == "sign_flip":
                # Student gives -correct when the correct answer is POSITIVE
                # (i.e. wrongly made a positive result negative). Restricting to
                # c_val > 0 keeps this distinct from the negative_squared case
                # (correct negative, student gives its absolute value), so the
                # more specific predicate can match instead of this generic op.
                return c_val > 0 and abs(s_val + c_val) < 1e-9
            elif op == "off_by_factor":
                factor = spec.get("factor", 10)
                return abs(s_val - c_val * factor) < 1e-9 or abs(s_val * factor - c_val) < 1e-9
        except (json.JSONDecodeError, ValueError, TypeError, KeyError):
            pass
        return False


# ---------------------------------------------------------------------------
# Module singleton; initialised at first use to allow lazy startup.
# ---------------------------------------------------------------------------

_LIBRARY: MisconceptionLibrary | None = None
_LIBRARY_LOCK = threading.Lock()


def get_library() -> MisconceptionLibrary:
    """Lazy singleton factory for MisconceptionLibrary."""
    global _LIBRARY
    if _LIBRARY is None:
        with _LIBRARY_LOCK:
            if _LIBRARY is None:
                _LIBRARY = MisconceptionLibrary()
    return _LIBRARY
