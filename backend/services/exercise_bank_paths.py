"""Map exercise records to on-disk bank files under data/exercise_*.json."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from backend.curriculum_frameworks import iter_frameworks

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATA_DIR = PROJECT_ROOT / "data"

JUNIOR_SUBJECTS = frozenset({"math", "english", "science"})
SENIOR_UNIT_SUBJECTS = frozenset(
    subject
    for framework in iter_frameworks()
    if framework.jurisdiction == "QCAA-Senior"
    for subject in framework.supported_subjects
)

# Alias storage subjects that should map to the math junior banks.
_SUBJECT_ALIASES = {
    "mathematics": "math",
}


class BankPathError(ValueError):
    """Raised when an exercise cannot be mapped to a known production bank file."""


def normalise_storage_subject(subject: Any) -> str:
    raw = str(subject or "").strip().lower()
    return _SUBJECT_ALIASES.get(raw, raw)


def _resolve_senior_filename(subject: str, unit: Any) -> str:
    try:
        unit_int = int(unit)
    except (TypeError, ValueError):
        raise BankPathError(f"subject {subject!r} requires unit 1-4") from None
    if unit_int in (1, 2):
        return f"exercise_{subject}_u1_u2.json"
    if unit_int in (3, 4):
        return f"exercise_{subject}_u3_u4.json"
    raise BankPathError(f"unsupported unit {unit_int} for subject {subject!r}")


def resolve_exercise_bank_filename(exercise: dict[str, Any]) -> str:
    """Return the basename of the target bank file for one exercise.

    Raises BankPathError when the item cannot be mapped to an existing bank layout.
    Senior subjects use a future-proof Units 1-2 / Units 3-4 filename policy,
    including registered courses that do not yet have authored banks.
    """
    if not isinstance(exercise, dict):
        raise BankPathError("exercise must be a dict")

    subject = normalise_storage_subject(exercise.get("subject"))
    if not subject:
        raise BankPathError("missing subject")

    # English is both an AC9 storage subject and a QCAA Senior English subject.
    # An explicit unit therefore selects the Senior policy; a year selects the
    # existing AC9 policy. Other registered senior subjects always use units.
    if subject in SENIOR_UNIT_SUBJECTS and exercise.get("unit") is not None:
        return _resolve_senior_filename(subject, exercise.get("unit"))

    if subject in JUNIOR_SUBJECTS:
        year = exercise.get("year_level")
        try:
            year_int = int(year)
        except (TypeError, ValueError):
            raise BankPathError(f"junior subject {subject!r} requires year_level 7-10") from None
        if year_int not in (7, 8, 9, 10):
            raise BankPathError(f"unsupported year_level {year_int} for subject {subject!r}")
        return f"exercise_{year_int}_{subject}.json"

    if subject in SENIOR_UNIT_SUBJECTS:
        return _resolve_senior_filename(subject, exercise.get("unit"))

    raise BankPathError(
        f"unsupported subject {subject!r} for bank append "
        f"(known: {', '.join(sorted(JUNIOR_SUBJECTS | SENIOR_UNIT_SUBJECTS))})"
    )


def resolve_exercise_bank_path(
    exercise: dict[str, Any],
    *,
    data_dir: Path | None = None,
) -> Path:
    """Return the absolute path of the target bank file."""
    root = data_dir if data_dir is not None else DEFAULT_DATA_DIR
    return root / resolve_exercise_bank_filename(exercise)


def list_known_bank_files(*, data_dir: Path | None = None) -> list[Path]:
    """Return existing exercise_*.json bank files under data_dir."""
    root = data_dir if data_dir is not None else DEFAULT_DATA_DIR
    return sorted(p for p in root.glob("exercise_*.json") if p.is_file())


def group_exercises_by_bank(
    exercises: list[dict[str, Any]],
    *,
    data_dir: Path | None = None,
) -> tuple[dict[str, list[dict[str, Any]]], list[dict[str, Any]]]:
    """Split exercises into {filename: items} and a list of unmapped items with reason."""
    grouped: dict[str, list[dict[str, Any]]] = {}
    unmapped: list[dict[str, Any]] = []
    for ex in exercises:
        try:
            name = resolve_exercise_bank_filename(ex)
            grouped.setdefault(name, []).append(ex)
        except BankPathError as exc:
            unmapped.append({
                "id": ex.get("id") if isinstance(ex, dict) else None,
                "reason": str(exc),
                "exercise": ex if isinstance(ex, dict) else None,
            })
    # Attach absolute paths for callers that need them
    if data_dir is not None:
        # filename keys stay as basenames; callers join with data_dir
        pass
    return grouped, unmapped
