"""Verification gate for Task 7 — ``backend/curriculum_loader.py``.

Covers the gates listed at the bottom of Task 7 in
``.kiro/specs/curriculum-framework-foundation/tasks.md``:

1. ``load_slice("AC9_MATHS", 7)`` returns a populated ``FrameworkSliceFile``.
2. ``load_topic("AC9M7N04")`` returns a topic with the expected strand.
3. ``load_topic`` returns ``None`` for both:
   - an identifier rejected by every framework validator (no framework
     matches), and
   - an identifier accepted by some framework validator but absent from
     disk (validator-accepts-but-slice-missing — Req 9.1a).
4. ``load_unified_view()`` produces the backward-compat shape with
   ``math.year7`` populated.
5. The unified view is deterministic across consecutive calls (Req 12.8).
6. The mtime cache reuses parsed slices and invalidates on ``mtime`` bump.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

import pytest

from backend.curriculum_loader import CurriculumLoader
from core.schema.curriculum_schema import FrameworkSliceFile


# Repo-relative path to the shipped Year 7 Maths slice. We use the real
# file (not a fixture) because Task 7's gates explicitly probe it.
_REPO_ROOT = Path(__file__).resolve().parents[2]
_REAL_STORE = _REPO_ROOT / "data" / "curriculum"


# ---------------------------------------------------------------------------
# Gate 1: load_slice returns a populated FrameworkSliceFile
# ---------------------------------------------------------------------------


def test_every_prerequisite_comes_before_its_topic_in_teaching_order():
    problems = []
    for path in sorted(_REAL_STORE.glob("*/*.json")):
        sequence = json.loads(path.read_text(encoding="utf-8")).get("sequence") or {}
        position = {topic: index for index, topic in enumerate(sequence.get("sequence") or [])}
        for topic, prerequisites in (sequence.get("prerequisites") or {}).items():
            for prerequisite in prerequisites:
                if topic in position and prerequisite in position and position[prerequisite] > position[topic]:
                    problems.append(f"{path.parent.name}/{path.name}: {topic} needs {prerequisite}")

    assert problems == []


def test_load_slice_ac9_maths_year7_returns_30_topics():
    loader = CurriculumLoader()
    slice_obj = loader.load_slice("AC9_MATHS", 7)

    assert isinstance(slice_obj, FrameworkSliceFile)
    assert slice_obj.framework_id == "AC9_MATHS"
    assert len(slice_obj.topics) == 30
    # The shipped Year 7 sequence covers every topic in the slice.
    assert len(slice_obj.sequence.sequence) == 30
    assert slice_obj.sequence.is_strict is False


def test_load_slice_default_store_resolves_repo_root_regardless_of_cwd(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The default ``store_root`` is computed from ``__file__`` so that
    callers running from outside the repo still hit the canonical store.
    """
    monkeypatch.chdir(tmp_path)  # cwd is now a temp dir, not the repo root
    loader = CurriculumLoader()
    slice_obj = loader.load_slice("AC9_MATHS", 7)
    assert slice_obj.framework_id == "AC9_MATHS"


def test_load_slice_raises_file_not_found_for_missing_slice(
    tmp_path: Path,
) -> None:
    """A slice file that does not exist surfaces ``FileNotFoundError``."""
    loader = CurriculumLoader(store_root=tmp_path)
    with pytest.raises(FileNotFoundError):
        loader.load_slice("AC9_MATHS", 7)


# ---------------------------------------------------------------------------
# Gate 2: load_topic returns the expected topic
# ---------------------------------------------------------------------------


def test_load_topic_ac9m7n04_returns_number_strand_topic():
    loader = CurriculumLoader()
    topic = loader.load_topic("AC9M7N04")

    assert topic is not None
    assert topic.topic_id == "AC9M7N04"
    assert topic.name  # non-empty
    # AC9M7N04 belongs to the Number strand (rational-number representations)
    assert topic.strand == "Number"
    assert topic.year_level == 7
    assert topic.framework == "AC9_MATHS"


# ---------------------------------------------------------------------------
# Gate 3: load_topic returns None — both branches
# ---------------------------------------------------------------------------


def test_load_topic_unknown_returns_none_when_no_framework_matches():
    """``AC9M99X99`` has bogus year/strand digits so no framework's
    validator accepts it — the loader short-circuits to ``None``.
    """
    loader = CurriculumLoader()
    assert loader.load_topic("AC9M99X99") is None


def test_load_topic_well_formed_but_slice_missing_returns_none():
    """``AC9M10N99`` is a structurally valid AC9 Maths code (Year 10, Number),
    but no such topic exists in the migrated Year 10 slice.
    Per Req 9.1a, the loader returns ``None`` rather than raising.
    """
    loader = CurriculumLoader()
    assert loader.load_topic("AC9M10N99") is None


def test_load_topic_returns_none_when_slice_directory_missing(
    tmp_path: Path,
) -> None:
    """A Topic_Id whose owning framework has no slice directory at all
    (e.g. an empty store) still resolves to ``None`` rather than raising.
    """
    loader = CurriculumLoader(store_root=tmp_path)
    assert loader.load_topic("AC9M7N04") is None


# ---------------------------------------------------------------------------
# Gate 4: load_unified_view shape
# ---------------------------------------------------------------------------


def test_load_unified_view_contains_math_year7_block():
    loader = CurriculumLoader()
    view = loader.load_unified_view()

    assert "math" in view, "AC9_MATHS must project under the 'math' key"
    assert "year7" in view["math"], "math block must contain year7"

    year7 = view["math"]["year7"]
    assert "AC9M7N04" in year7
    assert isinstance(year7["AC9M7N04"], dict)
    assert year7["AC9M7N04"]["topic_id"] == "AC9M7N04"

    # Sequence is exposed alongside the topic dicts.
    assert "sequence" in year7
    assert isinstance(year7["sequence"], list)
    assert "AC9M7N04" in year7["sequence"]


# ---------------------------------------------------------------------------
# Gate 5: determinism (Req 12.8)
# ---------------------------------------------------------------------------


def test_load_unified_view_is_deterministic_across_calls():
    loader = CurriculumLoader()

    first = loader.load_unified_view()
    second = loader.load_unified_view()

    # JSON-equivalent: both equal as Python dicts AND serialise identically
    # under canonical (sort_keys=True) JSON.
    assert first == second
    assert json.dumps(first, sort_keys=True) == json.dumps(
        second, sort_keys=True
    )


# ---------------------------------------------------------------------------
# Gate 6: mtime cache populates and invalidates
# ---------------------------------------------------------------------------


def _write_minimal_slice(path: Path) -> None:
    """Write a minimal valid AC9_MATHS Year 7 slice with one topic."""
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "framework_id": "AC9_MATHS",
        "sequence": {
            "sequence": ["AC9M7N01"],
            "prerequisites": {},
            "is_strict": False,
        },
        "topics": [
            {
                "framework": "AC9_MATHS",
                "topic_id": "AC9M7N01",
                "name": "Squares and square roots",
                "strand": "Number",
                "year_level": 7,
                "achievement_standard_text": "Students solve square problems.",
                "content_descriptor_text": "Square numbers and roots.",
                "elaborations": [],
                "supplementary_resources": [],
                "skills": [],
                "concept_card": {"core_rule": "", "hint_levels": []},
            }
        ],
    }
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_content_hash_cache_reuses_parsed_slice_until_content_changes(
    tmp_path: Path,
) -> None:
    slice_path = tmp_path / "ac9_maths" / "year7.json"
    _write_minimal_slice(slice_path)

    loader = CurriculumLoader(store_root=tmp_path)

    first = loader.load_slice("AC9_MATHS", 7)
    # The cache now holds an entry for this slice.
    assert slice_path in loader._cache  # type: ignore[attr-defined]
    _, cached_obj = loader._cache[slice_path]  # type: ignore[attr-defined]

    second = loader.load_slice("AC9_MATHS", 7)
    # Cache hit returns the same object identity (no re-parse).
    assert second is cached_obj
    assert second is first

    # Change neither content nor mtime — cache should still hit.
    third = loader.load_slice("AC9_MATHS", 7)
    assert third is cached_obj

    # Now change the content (same mtime). Cache must miss.
    payload = json.loads(slice_path.read_text(encoding="utf-8"))
    payload["topics"][0]["topic_id"] = "AC9M7N04"
    payload["topics"][0]["name"] = "Equivalent representations"
    payload["sequence"]["sequence"] = ["AC9M7N04"]
    slice_path.write_text(json.dumps(payload), encoding="utf-8")

    fourth = loader.load_slice("AC9_MATHS", 7)
    assert fourth is not cached_obj
    assert fourth.topics[0].topic_id == "AC9M7N04"


def test_content_hash_cache_picks_up_content_changes(tmp_path: Path) -> None:
    """A real edit flows through the cache based on content, not mtime."""
    slice_path = tmp_path / "ac9_maths" / "year7.json"
    _write_minimal_slice(slice_path)

    loader = CurriculumLoader(store_root=tmp_path)
    first = loader.load_slice("AC9_MATHS", 7)
    assert [t.topic_id for t in first.topics] == ["AC9M7N01"]

    # Edit the slice file: replace the single topic with AC9M7N04.
    payload = json.loads(slice_path.read_text(encoding="utf-8"))
    payload["topics"][0]["topic_id"] = "AC9M7N04"
    payload["topics"][0]["name"] = "Equivalent representations"
    payload["sequence"]["sequence"] = ["AC9M7N04"]
    slice_path.write_text(json.dumps(payload), encoding="utf-8")

    second = loader.load_slice("AC9_MATHS", 7)
    assert [t.topic_id for t in second.topics] == ["AC9M7N04"]
