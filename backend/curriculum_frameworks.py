"""Curriculum Framework Registry.

This module is the single source of truth for every curriculum framework the
system recognises. Six frameworks ship in Phase 1:

    AC9_MATHS, AC9_ENGLISH, AC9_SCIENCE,
    QCAA_SENIOR_MATHS, QCAA_SENIOR_ENGLISH, QCAA_SENIOR_SCIENCE

The registry is deliberately framework-only — no LLM clients, no network
libraries, no AI service SDKs. The only stdlib imports are ``re``,
``dataclasses``, ``types`` (for ``MappingProxyType``), ``typing``, and
``collections.abc``.

Design references:
    - .kiro/specs/curriculum-framework-foundation/design.md §3.1, §4.5
    - .kiro/specs/curriculum-framework-foundation/requirements.md
      Req 1, Req 9, Req 11, Req 14
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class ConfigurationError(RuntimeError):
    """Raised at import time when registry invariants are violated.

    The validator-disjointness invariant (Req 1.11) is the canonical example:
    if two frameworks' validators both accept the same probe string, the
    registry must refuse to load.
    """


# ---------------------------------------------------------------------------
# Framework dataclass
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Framework:
    """Immutable description of a single curriculum framework.

    Fields (all required):
        framework_id:           Registry key, e.g. ``"AC9_MATHS"``.
        human_name:             Display name, e.g. ``"Australian Curriculum
                                v9 — Mathematics"``.
        jurisdiction:           ``"ACARA"`` for AC9, ``"QCAA-Senior"`` for
                                Senior frameworks.
        validator:              Callable returning ``True`` exactly when the
                                input string is a valid Topic_Id for this
                                framework.
        supported_subjects:     Tuple of subject keys the framework owns.
        supported_year_levels:  Tuple of year levels for AC9; ``None`` for
                                Senior (which uses Units 1-4 instead).
        attribution:            Verbatim copyright/license string per Req
                                14.3 / 14.4.
        slice_directory:        Lower-case framework_id; the directory under
                                ``data/curriculum/`` that holds this
                                framework's slice files.
        subject_suffix:         Top-level subject key in the unified
                                curriculum view (e.g. ``"math"`` for AC9
                                Maths, ``"senior_math"`` for QCAA Senior
                                Maths).
    """

    framework_id: str
    human_name: str
    jurisdiction: str
    validator: Callable[[str], bool]
    supported_subjects: tuple[str, ...]
    supported_year_levels: tuple[int, ...] | None
    attribution: str
    slice_directory: str
    subject_suffix: str


# ---------------------------------------------------------------------------
# Validator regexes (compiled once at module load)
# ---------------------------------------------------------------------------

_AC9_MATHS_RE = re.compile(r"^AC9M(7|8|9|10)(N|A|M|SP|ST|P)\d{2}$")
_AC9_ENGLISH_RE = re.compile(r"^AC9E(7|8|9|10)(LA|LE|LY)\d{2}$")
_AC9_SCIENCE_RE = re.compile(r"^AC9S(7|8|9|10)(U|H|I)\d{2}$")

# Outer-shape regex shared by every QCAA Senior framework (Req 1.8). Each
# Senior framework's validator additionally narrows acceptance to its own
# ``supported_subjects`` (uppercased) so the validator-disjointness invariant
# (Req 1.11) holds across the three Senior frameworks.
_QCAA_SENIOR_RE = re.compile(r"^QCAA_([A-Z_]+)_U[1-4]_T\d+$")


def _ac9_maths_validator(s: str) -> bool:
    return bool(_AC9_MATHS_RE.match(s))


def _ac9_english_validator(s: str) -> bool:
    return bool(_AC9_ENGLISH_RE.match(s))


def _ac9_science_validator(s: str) -> bool:
    return bool(_AC9_SCIENCE_RE.match(s))


def _make_qcaa_senior_validator(
    subject_prefixes: tuple[str, ...],
) -> Callable[[str], bool]:
    """Build a Senior validator that requires both the outer Senior shape and
    a subject prefix from ``subject_prefixes`` (uppercase comparison).

    The outer regex ``^QCAA_[A-Z_]+_U[1-4]_T\\d+$`` (Req 1.8) is still
    satisfied by every accepted string; the subject narrowing is an
    additional constraint that disambiguates the three Senior frameworks
    and so satisfies the validator-disjointness invariant (Req 1.11).
    """
    allowed_uppercase = frozenset(p.upper() for p in subject_prefixes)

    def _validator(s: str) -> bool:
        match = _QCAA_SENIOR_RE.match(s)
        if match is None:
            return False
        return match.group(1) in allowed_uppercase

    return _validator


_qcaa_senior_maths_validator = _make_qcaa_senior_validator(
    ("methods", "general", "specialist", "essential")
)
_qcaa_senior_english_validator = _make_qcaa_senior_validator(
    (
        "english",
        "literature",
        "essential_english",
        "eal",
        "literature_extension",
    )
)
_qcaa_senior_science_validator = _make_qcaa_senior_validator(
    (
        "biology",
        "chemistry",
        "physics",
        "psychology",
        "earth_environmental_science",
    )
)


# ---------------------------------------------------------------------------
# Attribution constants (Req 14.3 / 14.4)
# ---------------------------------------------------------------------------

_AC9_ATTRIB = (
    "© ACARA. Australian Curriculum Version 9.0. Licensed under CC BY 4.0."
)
_QCAA_ATTRIB = (
    "© State of Queensland (Queensland Curriculum & Assessment Authority). "
    "Licensed under CC BY 4.0."
)


# ---------------------------------------------------------------------------
# Framework registry (immutable)
# ---------------------------------------------------------------------------

_FRAMEWORKS_MUTABLE: dict[str, Framework] = {
    "AC9_MATHS": Framework(
        framework_id="AC9_MATHS",
        human_name="Australian Curriculum v9 — Mathematics",
        jurisdiction="ACARA",
        validator=_ac9_maths_validator,
        supported_subjects=("math",),
        supported_year_levels=(7, 8, 9, 10),
        attribution=_AC9_ATTRIB,
        slice_directory="ac9_maths",
        subject_suffix="math",
    ),
    "AC9_ENGLISH": Framework(
        framework_id="AC9_ENGLISH",
        human_name="Australian Curriculum v9 — English",
        jurisdiction="ACARA",
        validator=_ac9_english_validator,
        supported_subjects=("english",),
        supported_year_levels=(7, 8, 9, 10),
        attribution=_AC9_ATTRIB,
        slice_directory="ac9_english",
        subject_suffix="english",
    ),
    "AC9_SCIENCE": Framework(
        framework_id="AC9_SCIENCE",
        human_name="Australian Curriculum v9 — Science",
        jurisdiction="ACARA",
        validator=_ac9_science_validator,
        supported_subjects=("science",),
        supported_year_levels=(7, 8, 9, 10),
        attribution=_AC9_ATTRIB,
        slice_directory="ac9_science",
        subject_suffix="science",
    ),
    "QCAA_SENIOR_MATHS": Framework(
        framework_id="QCAA_SENIOR_MATHS",
        human_name="QCAA Senior Mathematics",
        jurisdiction="QCAA-Senior",
        validator=_qcaa_senior_maths_validator,
        supported_subjects=("methods", "general", "specialist", "essential"),
        supported_year_levels=None,
        attribution=_QCAA_ATTRIB,
        slice_directory="qcaa_senior_maths",
        subject_suffix="senior_math",
    ),
    "QCAA_SENIOR_ENGLISH": Framework(
        framework_id="QCAA_SENIOR_ENGLISH",
        human_name="QCAA Senior English",
        jurisdiction="QCAA-Senior",
        validator=_qcaa_senior_english_validator,
        supported_subjects=(
            "english",
            "literature",
            "essential_english",
            "eal",
            "literature_extension",
        ),
        supported_year_levels=None,
        attribution=_QCAA_ATTRIB,
        slice_directory="qcaa_senior_english",
        subject_suffix="senior_english",
    ),
    "QCAA_SENIOR_SCIENCE": Framework(
        framework_id="QCAA_SENIOR_SCIENCE",
        human_name="QCAA Senior Science",
        jurisdiction="QCAA-Senior",
        validator=_qcaa_senior_science_validator,
        supported_subjects=(
            "biology",
            "chemistry",
            "physics",
            "psychology",
            "earth_environmental_science",
        ),
        supported_year_levels=None,
        attribution=_QCAA_ATTRIB,
        slice_directory="qcaa_senior_science",
        subject_suffix="senior_science",
    ),
}

# Public, immutable view of the registry. ``MappingProxyType`` prevents
# callers from mutating the underlying dict while still presenting a normal
# Mapping interface.
FRAMEWORKS: Mapping[str, Framework] = MappingProxyType(_FRAMEWORKS_MUTABLE)


# ---------------------------------------------------------------------------
# Legacy translation table (Design §4.5; Req 9.8)
# ---------------------------------------------------------------------------

_LEGACY_TRANSLATION_MUTABLE: dict[str, list[str]] = {
    # "fractions" → rational-number representations + operations on positive
    # rationals.
    "fractions": ["AC9M7N04", "AC9M7N06"],
    # "decimals" → operations on positive rationals (Year 7 N06 covers
    # rounding and decimal handling).
    "decimals": ["AC9M7N06"],
    # "linear_equations" → solve one-variable linear equations with natural
    # number solutions.
    "linear_equations": ["AC9M7A03"],
    # "geometry" → area + volume + circle (Measurement strand).
    "geometry": ["AC9M7M01", "AC9M7M02", "AC9M7M03"],
    # "algebraic_expressions" → placeholder; AC9 Year 8 Algebra slice ships
    # empty in Phase 1, so this currently resolves to "concept not found"
    # (Req 9.5).
    "algebraic_expressions": ["AC9M8A01"],
    # "narrative_writing" → maps to AC9E7LE05 in Year 7 English slice (fully populated).
    "narrative_writing": ["AC9E7LE05"],
}

LEGACY_TRANSLATION_TABLE: Mapping[str, list[str]] = MappingProxyType(
    _LEGACY_TRANSLATION_MUTABLE
)
"""Maps legacy snake_case topic names to one or more canonical Topic_Ids.

Per Req 9.5, mappings whose targets are absent from every Framework_Slice on
disk (e.g. ``algebraic_expressions`` in Phase 1, where the AC9 Year 8 Algebra
slice ships as an empty shell) resolve to a structured "concept not found"
response at runtime rather than auto-correcting. The Tutor_Engine's lookup
path is responsible for surfacing that message; this table only records the
intended mapping.
"""


# ---------------------------------------------------------------------------
# Public lookup API
# ---------------------------------------------------------------------------


def get_framework_for_topic_id(topic_id: str) -> str | None:
    """Return the Framework_Id whose validator accepts ``topic_id``.

    Returns ``None`` when no registered framework's validator matches.
    The validator-disjointness invariant (Req 1.11) — enforced at import
    time — guarantees that at most one framework will ever match a given
    topic_id, so iteration order does not matter.
    """
    for fw in _FRAMEWORKS_MUTABLE.values():
        if fw.validator(topic_id):
            return fw.framework_id
    return None


def get_framework(framework_id: str) -> Framework:
    """Return the ``Framework`` registered under ``framework_id``.

    Raises ``KeyError`` when ``framework_id`` is not registered.
    """
    return _FRAMEWORKS_MUTABLE[framework_id]


def iter_frameworks() -> Iterator[Framework]:
    """Iterate over every registered ``Framework`` in registration order."""
    return iter(_FRAMEWORKS_MUTABLE.values())


def legacy_translate(legacy_name: str) -> list[str]:
    """Translate a legacy snake_case topic name to canonical Topic_Ids.

    Returns a fresh ``list[str]`` (not a reference into the registry) so
    callers can mutate the result without affecting the table. Returns an
    empty list when ``legacy_name`` is not a known legacy entry.
    """
    targets = _LEGACY_TRANSLATION_MUTABLE.get(legacy_name)
    if targets is None:
        return []
    return list(targets)


def query_topics_for_year10(
    previewed_senior_subjects: list[str],
) -> list[dict[str, Any]]:
    """Return AC9 Year 10 topics plus optional QCAA Senior Unit 1 previews.

    Thin wrapper around :meth:`CurriculumLoader.query_topics_for_year10`
    (Design §5; Req 11). Lives here so the registry remains the single
    public entry point for dual-visibility logic; the actual slice IO is
    delegated to ``CurriculumLoader`` to avoid duplicating mtime caching.

    The loader is imported lazily inside the function to avoid a circular
    import at module load (the loader imports the registry).
    """
    from backend.curriculum_loader import CurriculumLoader  # lazy

    return CurriculumLoader().query_topics_for_year10(previewed_senior_subjects)


# ---------------------------------------------------------------------------
# Validator-disjointness self-check (Req 1.11; Design §3.1)
# ---------------------------------------------------------------------------

# Representative probe set covering AC9 codes across all three subjects, QCAA
# Senior codes across multiple subjects/units, legacy names, and garbage
# strings. The Phase-4 property test in `pbt-test-suite` widens this with
# Hypothesis-generated probes.
_PROBE_SET: tuple[str, ...] = (
    # AC9 Maths
    "AC9M7N01",
    "AC9M7N04",
    "AC9M8A03",
    "AC9M10A03",
    "AC9M9SP02",
    # AC9 English
    "AC9E7LA01",
    "AC9E7LE05",
    "AC9E10LE05",
    "AC9E8LY03",
    # AC9 Science
    "AC9S7U03",
    "AC9S8H02",
    "AC9S10I05",
    # QCAA Senior
    "QCAA_METHODS_U1_T1",
    "QCAA_METHODS_U1_T2",
    "QCAA_BIOLOGY_U2_T3",
    "QCAA_LITERATURE_U4_T1",
    # Legacy names (must be rejected by every framework validator)
    "fractions",
    "decimals",
    "linear_equations",
    "geometry",
    "algebraic_expressions",
    "narrative_writing",
    # Garbage
    "garbage_xyz",
    "",
    "AC9X7N01",       # bogus subject letter
    "AC9M11N01",      # year out of range
    "QCAA__U1_T1",    # empty subject segment
    "QCAA_METHODS_U5_T1",  # unit out of range
)


def _check_validator_disjointness() -> None:
    """Verify no probe is accepted by more than one framework's validator.

    Raises ``ConfigurationError`` naming both colliding Framework_Ids and the
    offending probe string. Runs at module import time so misconfigured
    registries fail fast.
    """
    for probe in _PROBE_SET:
        accepting = [
            fw.framework_id
            for fw in _FRAMEWORKS_MUTABLE.values()
            if fw.validator(probe)
        ]
        if len(accepting) > 1:
            raise ConfigurationError(
                f"Validator-disjointness invariant violated: probe "
                f"{probe!r} accepted by frameworks {accepting}. "
                "At most one framework's validator may accept any given "
                "topic_id."
            )


_check_validator_disjointness()


__all__ = [
    "ConfigurationError",
    "Framework",
    "FRAMEWORKS",
    "LEGACY_TRANSLATION_TABLE",
    "get_framework",
    "get_framework_for_topic_id",
    "iter_frameworks",
    "legacy_translate",
    "query_topics_for_year10",
]
