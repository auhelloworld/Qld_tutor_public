"""Single source of truth for subject metadata.

Every subject the app knows about is described here ONCE, so that adding a new
senior course (e.g. Chemistry, Literature, Specialist Mathematics) is a single
registry entry plus content — not edits scattered across grading, scoping,
display, and exam code.

Keys are the **storage subject** — the value stored in an exercise's
``subject`` field and used for per-student logs (e.g. ``"methods"``,
``"chemistry"``, ``"english"``). The picker/curriculum key for a senior course
is the storage subject prefixed with ``senior_`` (e.g. ``senior_chemistry``);
:func:`storage_subject_for_scope` resolves either form to the storage subject.

Grading mode:
  - ``"sympy"`` → deterministic symbolic/numeric grading (mathematics).
  - ``"text"``  → text-equivalence / LLM-rubric grading (english, science).

See ``docs/adding-senior-courses.md`` for the end-to-end checklist.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

GradingMode = Literal["sympy", "text"]


@dataclass(frozen=True)
class SubjectInfo:
    storage_subject: str
    grading: GradingMode
    display_name: str
    framework_id: str | None


# Keyed by STORAGE subject. ``display_name`` uses QCAA-aligned course titles.
SUBJECTS: dict[str, SubjectInfo] = {
    # --- Junior (AC9) -------------------------------------------------------
    "math": SubjectInfo("math", "sympy", "Mathematics", "AC9_MATHS"),
    "mathematics": SubjectInfo("mathematics", "sympy", "Mathematics", "AC9_MATHS"),
    "english": SubjectInfo("english", "text", "English", "AC9_ENGLISH"),
    "science": SubjectInfo("science", "text", "Science", "AC9_SCIENCE"),
    # --- Senior QCAA — Mathematics suite (sympy-graded) --------------------
    "methods": SubjectInfo("methods", "sympy", "Mathematical Methods", "QCAA_SENIOR_MATHS"),
    "general": SubjectInfo("general", "sympy", "General Mathematics", "QCAA_SENIOR_MATHS"),
    "specialist": SubjectInfo("specialist", "sympy", "Specialist Mathematics", "QCAA_SENIOR_MATHS"),
    "essential": SubjectInfo("essential", "sympy", "Essential Mathematics", "QCAA_SENIOR_MATHS"),
    # --- Senior QCAA — Sciences (text-graded) ------------------------------
    "biology": SubjectInfo("biology", "text", "Biology", "QCAA_SENIOR_SCIENCE"),
    "chemistry": SubjectInfo("chemistry", "text", "Chemistry", "QCAA_SENIOR_SCIENCE"),
    "physics": SubjectInfo("physics", "text", "Physics", "QCAA_SENIOR_SCIENCE"),
    "psychology": SubjectInfo("psychology", "text", "Psychology", "QCAA_SENIOR_SCIENCE"),
    "earth_environmental_science": SubjectInfo(
        "earth_environmental_science", "text", "Earth & Environmental Science", "QCAA_SENIOR_SCIENCE"
    ),
    # --- Senior QCAA — English suite (text-graded) -------------------------
    "literature": SubjectInfo("literature", "text", "Literature", "QCAA_SENIOR_ENGLISH"),
    "essential_english": SubjectInfo("essential_english", "text", "Essential English", "QCAA_SENIOR_ENGLISH"),
    "eal": SubjectInfo("eal", "text", "English as an Additional Language", "QCAA_SENIOR_ENGLISH"),
    "literature_extension": SubjectInfo("literature_extension", "text", "Literature Extension", "QCAA_SENIOR_ENGLISH"),
}

# Legacy family fallbacks for any ``senior_*`` key not explicitly registered,
# so older callers keep their previous behaviour.
_ENGLISH_FAMILY = {"english", "literature", "english_extension", "essential_english", "eal", "literature_extension"}
_SCIENCE_FAMILY = {"science", "biology", "chemistry", "physics", "psychology", "earth_environmental_science"}


def _norm(subject: str | None) -> str:
    return (subject or "math").strip().lower()


def storage_subject_for_scope(subject: str | None) -> str:
    """Resolve a picker/curriculum subject (junior or ``senior_*``) OR an
    already-storage subject to the storage subject used by exercise banks and
    per-student logs."""
    normalised = _norm(subject)
    if not normalised.startswith("senior_"):
        return normalised
    suffix = normalised.removeprefix("senior_")
    if suffix in SUBJECTS:
        return suffix
    if suffix in _ENGLISH_FAMILY:
        return "english"
    if suffix in _SCIENCE_FAMILY:
        return "science"
    return "math"


def grading_mode_for_subject(subject: str | None) -> GradingMode:
    """Grading mode for a STORAGE subject; defaults to ``"sympy"`` (maths)."""
    info = SUBJECTS.get(_norm(subject))
    return info.grading if info else "sympy"


def is_text_graded(subject: str | None) -> bool:
    """True when the subject uses text/LLM grading (english + sciences)."""
    return grading_mode_for_subject(subject) == "text"


def is_known_subject(subject: str | None) -> bool:
    """True when ``subject`` is a registered STORAGE subject."""
    return _norm(subject) in SUBJECTS


def display_name_for_subject(subject: str | None) -> str | None:
    info = SUBJECTS.get(_norm(subject))
    return info.display_name if info else None


def framework_for_subject(subject: str | None) -> str | None:
    info = SUBJECTS.get(_norm(subject))
    return info.framework_id if info else None
