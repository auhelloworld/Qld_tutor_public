"""Verification gate for Task 3 — curriculum framework registry.

Covers Req 1 (registry shape + invariants), Req 9 (legacy translation),
Req 11 (Year 10 dual-visibility stub), and Req 14 (attribution).

Each test is documented inline against the verification gate clauses listed
in `tasks.md` Task 3.
"""

from __future__ import annotations

import dataclasses
import importlib

import pytest


# ---------------------------------------------------------------------------
# Gate 1: module imports cleanly (validator-disjointness self-check passes)
# ---------------------------------------------------------------------------


def test_module_imports_cleanly():
    """`python -c 'import backend.curriculum_frameworks'` must succeed."""
    import backend.curriculum_frameworks  # noqa: F401

    # If the disjointness self-check had raised, the import above would have
    # failed. Reaching this line is the assertion.


# ---------------------------------------------------------------------------
# Gates 2-9: get_framework_for_topic_id behaviour
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "topic_id,expected",
    [
        # Gate 2
        ("AC9M7N01", "AC9_MATHS"),
        # Gate 3
        ("AC9M10A03", "AC9_MATHS"),
        # Gate 4
        ("AC9E7LA01", "AC9_ENGLISH"),
        # Gate 5
        ("AC9E10LE05", "AC9_ENGLISH"),
        # Gate 6
        ("AC9S7U03", "AC9_SCIENCE"),
        # Gate 7
        ("QCAA_METHODS_U1_T1", "QCAA_SENIOR_MATHS"),
        # Senior English / Science routing (additional coverage)
        ("QCAA_LITERATURE_U2_T3", "QCAA_SENIOR_ENGLISH"),
        ("QCAA_BIOLOGY_U1_T2", "QCAA_SENIOR_SCIENCE"),
    ],
)
def test_get_framework_for_topic_id_routes_known_codes(topic_id, expected):
    from backend.curriculum_frameworks import get_framework_for_topic_id

    assert get_framework_for_topic_id(topic_id) == expected


@pytest.mark.parametrize(
    "topic_id",
    [
        # Gate 8: garbage string
        "garbage_xyz",
        # Gate 9: legacy snake_case names are NOT topic_ids — they go through
        # legacy_translate(), not get_framework_for_topic_id().
        "fractions",
        "decimals",
        "linear_equations",
        # Empty string and other malformed inputs
        "",
        "AC9X7N01",  # bogus subject letter
        "AC9M11N01",  # year out of range for AC9
        "QCAA_METHODS_U5_T1",  # unit out of range
    ],
)
def test_get_framework_for_topic_id_returns_none_for_non_topic_ids(topic_id):
    from backend.curriculum_frameworks import get_framework_for_topic_id

    assert get_framework_for_topic_id(topic_id) is None


# ---------------------------------------------------------------------------
# Gate 10: get_framework returns the registered Framework
# ---------------------------------------------------------------------------


def test_get_framework_returns_ac9_maths_with_expected_human_name():
    from backend.curriculum_frameworks import get_framework

    fw = get_framework("AC9_MATHS")
    assert fw.human_name == "Australian Curriculum v9 — Mathematics"
    assert fw.framework_id == "AC9_MATHS"
    assert fw.jurisdiction == "ACARA"


def test_get_framework_raises_keyerror_on_unknown_id():
    from backend.curriculum_frameworks import get_framework

    with pytest.raises(KeyError):
        get_framework("DOES_NOT_EXIST")


# ---------------------------------------------------------------------------
# Gate 11: iter_frameworks yields exactly six frameworks
# ---------------------------------------------------------------------------


def test_iter_frameworks_yields_six_entries():
    from backend.curriculum_frameworks import iter_frameworks

    frameworks = list(iter_frameworks())
    assert len(frameworks) == 6

    ids = {fw.framework_id for fw in frameworks}
    assert ids == {
        "AC9_MATHS",
        "AC9_ENGLISH",
        "AC9_SCIENCE",
        "QCAA_SENIOR_MATHS",
        "QCAA_SENIOR_ENGLISH",
        "QCAA_SENIOR_SCIENCE",
    }


def test_iter_frameworks_returns_consistent_attribution_strings():
    from backend.curriculum_frameworks import iter_frameworks

    ac9_attrib = (
        "© ACARA. Australian Curriculum Version 9.0. Licensed under CC BY 4.0."
    )
    qcaa_attrib = (
        "© State of Queensland (Queensland Curriculum & Assessment Authority). "
        "Licensed under CC BY 4.0."
    )

    for fw in iter_frameworks():
        if fw.jurisdiction == "ACARA":
            assert fw.attribution == ac9_attrib
        else:
            assert fw.jurisdiction == "QCAA-Senior"
            assert fw.attribution == qcaa_attrib


def test_ac9_frameworks_have_year_levels_7_to_10():
    from backend.curriculum_frameworks import iter_frameworks

    for fw in iter_frameworks():
        if fw.jurisdiction == "ACARA":
            assert fw.supported_year_levels == (7, 8, 9, 10)
        else:
            assert fw.supported_year_levels is None


# ---------------------------------------------------------------------------
# Gate 12: legacy_translate maps known names to expected Topic_Ids
# ---------------------------------------------------------------------------


def test_legacy_translate_maps_fractions_to_two_codes():
    from backend.curriculum_frameworks import legacy_translate

    assert legacy_translate("fractions") == ["AC9M7N04", "AC9M7N06"]


def test_legacy_translate_covers_all_six_documented_entries():
    from backend.curriculum_frameworks import legacy_translate

    assert legacy_translate("decimals") == ["AC9M7N06"]
    assert legacy_translate("linear_equations") == ["AC9M7A03"]
    assert legacy_translate("geometry") == [
        "AC9M7M01",
        "AC9M7M02",
        "AC9M7M03",
    ]
    assert legacy_translate("algebraic_expressions") == ["AC9M8A01"]
    assert legacy_translate("narrative_writing") == ["AC9E7LE05"]


def test_legacy_translate_returns_fresh_list_not_shared_reference():
    """Mutating the returned list must not affect the registry table."""
    from backend.curriculum_frameworks import legacy_translate

    first = legacy_translate("fractions")
    first.append("MUTATED")
    second = legacy_translate("fractions")
    assert second == ["AC9M7N04", "AC9M7N06"]


# ---------------------------------------------------------------------------
# Gate 13: legacy_translate("unknown_legacy") returns []
# ---------------------------------------------------------------------------


def test_legacy_translate_unknown_returns_empty_list():
    from backend.curriculum_frameworks import legacy_translate

    assert legacy_translate("unknown_legacy") == []
    assert legacy_translate("") == []


# ---------------------------------------------------------------------------
# Gate 14: query_topics_for_year10 is now wired through CurriculumLoader
# ---------------------------------------------------------------------------


def test_query_topics_for_year10_returns_list_with_no_previews():
    """With no previewed senior subjects and no Year 10 slices on disk,
    the result is an empty list. The function MUST NOT raise — Task 7
    replaced the Phase-1 ``NotImplementedError`` stub with a thin wrapper
    around ``CurriculumLoader.query_topics_for_year10``.
    """
    from backend.curriculum_frameworks import query_topics_for_year10

    result = query_topics_for_year10([])
    assert isinstance(result, list)


def test_query_topics_for_year10_warns_on_unknown_senior_subject():
    """Unknown senior subjects emit a warning and contribute no topics
    (Req 11.7); the call still succeeds with whatever else is loadable.
    """
    import warnings

    from backend.curriculum_frameworks import query_topics_for_year10

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        result = query_topics_for_year10(["definitely_not_a_subject"])

    assert isinstance(result, list)
    assert any(
        "definitely_not_a_subject" in str(w.message) for w in caught
    ), "expected a warning naming the unknown senior subject"


# ---------------------------------------------------------------------------
# Gate 15: disjointness self-check raises ConfigurationError on overlap
# ---------------------------------------------------------------------------


def test_disjointness_self_check_raises_on_validator_overlap():
    """Inject a validator collision and verify _check_validator_disjointness
    raises ConfigurationError naming both colliding Framework_Ids.

    The test mutates the module's mutable backing dict to install a
    colliding Framework, calls the self-check directly, and then restores
    pristine module state via importlib.reload — matching the intent of
    'monkeypatch one validator + re-import via importlib.reload, expect
    ConfigurationError' from the verification gate.
    """
    import backend.curriculum_frameworks as cf

    original_eng = cf._FRAMEWORKS_MUTABLE["AC9_ENGLISH"]
    ac9_maths_validator = cf._FRAMEWORKS_MUTABLE["AC9_MATHS"].validator

    try:
        # Install a colliding AC9_ENGLISH whose validator accepts AC9_MATHS
        # codes. The probe set contains AC9M7N01 etc., so the collision will
        # fire on the first probe iteration.
        cf._FRAMEWORKS_MUTABLE["AC9_ENGLISH"] = dataclasses.replace(
            original_eng, validator=ac9_maths_validator
        )

        with pytest.raises(cf.ConfigurationError) as exc_info:
            cf._check_validator_disjointness()

        msg = str(exc_info.value)
        assert "AC9_MATHS" in msg
        assert "AC9_ENGLISH" in msg
    finally:
        # Restore pristine module state. Reload re-runs the module body,
        # which rebuilds _FRAMEWORKS_MUTABLE from scratch and re-runs the
        # disjointness self-check. If the registry is healthy, the reload
        # itself is the assertion that we are back to a clean state.
        importlib.reload(cf)


# ---------------------------------------------------------------------------
# Additional structural sanity checks (Req 1.12: no AI/network imports)
# ---------------------------------------------------------------------------


def test_module_imports_no_ai_or_network_libraries():
    """Req 1.12: registry must not pull in LLM clients or network libs."""
    import sys

    # Force a fresh import to ensure we observe the module's actual import
    # graph rather than incidental imports from earlier tests.
    sys.modules.pop("backend.curriculum_frameworks", None)
    import backend.curriculum_frameworks  # noqa: F401

    forbidden = {
        "openai",
        "anthropic",
        "google.generativeai",
        "requests",
        "httpx",
        "urllib",
        "urllib.request",
        "langchain",
        "langgraph",
    }
    # The registry itself must not import any of these directly. We check by
    # inspecting the module's globals — direct `import x` statements bind a
    # name in module globals, so a clean module has no globals matching
    # the forbidden names.
    mod_globals = set(vars(backend.curriculum_frameworks).keys())
    leaked = forbidden & mod_globals
    assert not leaked, f"registry leaked AI/network imports: {leaked}"


def test_frameworks_mapping_is_immutable():
    """Direct assignment into FRAMEWORKS must raise (Req 1.2 immutability)."""
    from backend.curriculum_frameworks import FRAMEWORKS

    with pytest.raises(TypeError):
        FRAMEWORKS["NEW"] = None  # type: ignore[index]


def test_legacy_translation_table_is_immutable():
    from backend.curriculum_frameworks import LEGACY_TRANSLATION_TABLE

    with pytest.raises(TypeError):
        LEGACY_TRANSLATION_TABLE["new"] = ["X"]  # type: ignore[index]
