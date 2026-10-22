"""Unit tests for ``core.schema.curriculum_schema``.

Verification gate for task 1 of the curriculum-framework-foundation spec.
Covers:

1. happy-path validation of each Subject_Topic_Model with a minimal valid payload
2. fail-closed rejection: ``framework="UNKNOWN_FRAMEWORK"`` raises ``ValidationError``
3. ``extra='forbid'``: an unspecified field raises
4. resource-payload-required: ``SupplementaryResource`` with both ``url=None``
   and ``content=None`` raises
5. AC9 elaboration-attachment: an ``acara_official`` elaboration whose
   ``elaboration_id`` prefix doesn't match the topic's ``topic_id`` raises
6. ``CurriculumSequence`` dedup: duplicates in ``sequence`` raises
7. ``FrameworkSliceFile`` sequence-curriculum consistency: a sequence entry
   that isn't in topics raises
8. ``FrameworkSliceFile`` prerequisites-internal-consistency: a prereq target
   not in topics raises

The topic-id-validity model_validator (task 1.8) lazily imports
``backend.curriculum_frameworks.get_framework`` at runtime. That registry
module does not exist yet at task-1 time (it lands in task 3), so this test
file installs a stub via ``monkeypatch`` and ``sys.modules`` to satisfy the
import. Tests that exercise the validator path are explicit about which
framework_ids the stub accepts.
"""

from __future__ import annotations

import re
import sys
import types
from dataclasses import dataclass

import pytest
from pydantic import ValidationError

from core.schema.curriculum_schema import (
    AC9EnglishTopic,
    AC9MathsTopic,
    AC9ScienceTopic,
    CurriculumSequence,
    Elaboration,
    FrameworkSliceFile,
    QCAASeniorEnglishTopic,
    QCAASeniorMathsTopic,
    QCAASeniorScienceTopic,
    SupplementaryResource,
)


# ---------------------------------------------------------------------------
# Registry stub
# ---------------------------------------------------------------------------
#
# The schema's topic-id-validity model_validator (Req 3.10) lazily imports
# ``backend.curriculum_frameworks.get_framework`` from inside the validator.
# That module is delivered by task 3 of the spec; at task-1 time it does not
# exist. We install a minimal stub module into ``sys.modules`` for the test
# session so the lazy import resolves to a controllable fake.

_AC9_MATHS_RE = re.compile(r"^AC9M(7|8|9|10)(N|A|M|SP|ST|P)\d{2}$")
_AC9_ENGLISH_RE = re.compile(r"^AC9E(7|8|9|10)(LA|LE|LY)\d{2}$")
_AC9_SCIENCE_RE = re.compile(r"^AC9S(7|8|9|10)(U|H|I)\d{2}$")
_QCAA_SENIOR_RE = re.compile(r"^QCAA_[A-Z_]+_U[1-4]_T\d+$")


@dataclass(frozen=True)
class _StubFramework:
    framework_id: str
    validator: object  # Callable[[str], bool]


_STUB_FRAMEWORKS = {
    "AC9_MATHS": _StubFramework("AC9_MATHS", lambda s: bool(_AC9_MATHS_RE.match(s))),
    "AC9_ENGLISH": _StubFramework("AC9_ENGLISH", lambda s: bool(_AC9_ENGLISH_RE.match(s))),
    "AC9_SCIENCE": _StubFramework("AC9_SCIENCE", lambda s: bool(_AC9_SCIENCE_RE.match(s))),
    "QCAA_SENIOR_MATHS": _StubFramework(
        "QCAA_SENIOR_MATHS", lambda s: bool(_QCAA_SENIOR_RE.match(s))
    ),
    "QCAA_SENIOR_ENGLISH": _StubFramework(
        "QCAA_SENIOR_ENGLISH", lambda s: bool(_QCAA_SENIOR_RE.match(s))
    ),
    "QCAA_SENIOR_SCIENCE": _StubFramework(
        "QCAA_SENIOR_SCIENCE", lambda s: bool(_QCAA_SENIOR_RE.match(s))
    ),
}


def _stub_get_framework(framework_id: str) -> _StubFramework:
    try:
        return _STUB_FRAMEWORKS[framework_id]
    except KeyError as exc:
        raise KeyError(f"unknown framework: {framework_id!r}") from exc


@pytest.fixture(autouse=True)
def _patch_registry(monkeypatch):
    """Install a fake ``backend.curriculum_frameworks`` module for each test.

    The schema validator does ``from backend.curriculum_frameworks import
    get_framework`` lazily, so we ensure both the package and the leaf module
    are present in ``sys.modules`` before any topic instantiation runs.
    """
    backend_pkg = sys.modules.get("backend")
    if backend_pkg is None:
        backend_pkg = types.ModuleType("backend")
        backend_pkg.__path__ = []  # mark as package
        monkeypatch.setitem(sys.modules, "backend", backend_pkg)

    fake_module = types.ModuleType("backend.curriculum_frameworks")
    fake_module.get_framework = _stub_get_framework
    monkeypatch.setitem(sys.modules, "backend.curriculum_frameworks", fake_module)
    monkeypatch.setattr(backend_pkg, "curriculum_frameworks", fake_module, raising=False)
    yield


# ---------------------------------------------------------------------------
# Minimal valid payload helpers
# ---------------------------------------------------------------------------


def _ac9_maths_payload(**overrides):
    base = {
        "framework": "AC9_MATHS",
        "topic_id": "AC9M7N04",
        "name": "Equivalent representations of rational numbers",
        "strand": "Number",
        "year_level": 7,
        "achievement_standard_text": "AS text",
        "content_descriptor_text": "CD text",
    }
    base.update(overrides)
    return base


def _ac9_english_payload(**overrides):
    base = {
        "framework": "AC9_ENGLISH",
        "topic_id": "AC9E7LE05",
        "name": "Narrative writing fundamentals",
        "strand": "Literature",
        "sub_strand": "Examining literature",
        "year_level": 7,
        "achievement_standard_text": "AS text",
        "content_descriptor_text": "CD text",
    }
    base.update(overrides)
    return base


def _ac9_science_payload(**overrides):
    base = {
        "framework": "AC9_SCIENCE",
        "topic_id": "AC9S7U03",
        "name": "Particle model of matter",
        "strand": "Science Understanding",
        "sub_strand": "P",
        "year_level": 7,
        "achievement_standard_text": "AS text",
        "content_descriptor_text": "CD text",
    }
    base.update(overrides)
    return base


def _qcaa_maths_payload(**overrides):
    base = {
        "framework": "QCAA_SENIOR_MATHS",
        "topic_id": "QCAA_METHODS_U1_T2",
        "name": "Functions and graphs",
        "syllabus_subject": "methods",
        "unit": 1,
        "topic_number": 2,
    }
    base.update(overrides)
    return base


def _qcaa_english_payload(**overrides):
    base = {
        "framework": "QCAA_SENIOR_ENGLISH",
        "topic_id": "QCAA_ENGLISH_U1_T1",
        "name": "Perspectives and texts",
        "syllabus_subject": "english",
        "unit": 1,
        "topic_number": 1,
    }
    base.update(overrides)
    return base


def _qcaa_science_payload(**overrides):
    base = {
        "framework": "QCAA_SENIOR_SCIENCE",
        "topic_id": "QCAA_BIOLOGY_U1_T1",
        "name": "Cells as the basis of life",
        "syllabus_subject": "biology",
        "unit": 1,
        "topic_number": 1,
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# 1. Happy-path validation of each Subject_Topic_Model
# ---------------------------------------------------------------------------


def test_ac9_maths_topic_minimal_valid():
    topic = AC9MathsTopic.model_validate(_ac9_maths_payload())
    assert topic.framework == "AC9_MATHS"
    assert topic.topic_id == "AC9M7N04"
    assert topic.elaborations == []
    assert topic.supplementary_resources == []


def test_ac9_english_topic_minimal_valid():
    topic = AC9EnglishTopic.model_validate(_ac9_english_payload())
    assert topic.framework == "AC9_ENGLISH"
    assert topic.strand == "Literature"


def test_ac9_science_topic_minimal_valid():
    topic = AC9ScienceTopic.model_validate(_ac9_science_payload())
    assert topic.framework == "AC9_SCIENCE"
    assert topic.sub_strand == "P"


def test_ac9_science_topic_sub_strand_optional():
    payload = _ac9_science_payload(strand="Science Inquiry", sub_strand=None)
    topic = AC9ScienceTopic.model_validate(payload)
    assert topic.sub_strand is None


def test_qcaa_senior_maths_topic_minimal_valid():
    topic = QCAASeniorMathsTopic.model_validate(_qcaa_maths_payload())
    assert topic.framework == "QCAA_SENIOR_MATHS"
    assert topic.unit == 1
    assert topic.topic_number == 2


def test_qcaa_senior_english_topic_minimal_valid():
    topic = QCAASeniorEnglishTopic.model_validate(_qcaa_english_payload())
    assert topic.framework == "QCAA_SENIOR_ENGLISH"
    assert topic.syllabus_subject == "english"


def test_qcaa_senior_science_topic_minimal_valid():
    topic = QCAASeniorScienceTopic.model_validate(_qcaa_science_payload())
    assert topic.framework == "QCAA_SENIOR_SCIENCE"
    assert topic.syllabus_subject == "biology"


# ---------------------------------------------------------------------------
# 2. Fail-closed: unknown framework rejected by the discriminated union
# ---------------------------------------------------------------------------


def test_unknown_framework_rejected_at_envelope():
    """A topic dict with ``framework="UNKNOWN_FRAMEWORK"`` cannot match any
    discriminated-union branch and must raise ``ValidationError`` when fed
    through ``FrameworkSliceFile`` (Req 3.4 / 3.10a fail-closed policy)."""
    payload = {
        "framework_id": "AC9_MATHS",
        "topics": [
            {
                "framework": "UNKNOWN_FRAMEWORK",
                "topic_id": "AC9M7N04",
                "name": "x",
                "strand": "Number",
                "year_level": 7,
                "achievement_standard_text": "x",
                "content_descriptor_text": "x",
            }
        ],
        "sequence": {"sequence": [], "prerequisites": {}, "is_strict": False},
    }
    with pytest.raises(ValidationError):
        FrameworkSliceFile.model_validate(payload)


# ---------------------------------------------------------------------------
# 3. extra='forbid'
# ---------------------------------------------------------------------------


def test_extra_field_forbidden_on_topic():
    payload = _ac9_maths_payload(unexpected_field="boom")
    with pytest.raises(ValidationError):
        AC9MathsTopic.model_validate(payload)


def test_extra_field_forbidden_on_supplementary_resource():
    with pytest.raises(ValidationError):
        SupplementaryResource.model_validate(
            {
                "resource_id": "r1",
                "type": "video",
                "title": "intro",
                "url": "https://example.com",
                "extra": "boom",
            }
        )


# ---------------------------------------------------------------------------
# 4. Resource-payload-required (Req 5.6)
# ---------------------------------------------------------------------------


def test_resource_with_no_url_and_no_content_rejected():
    with pytest.raises(ValidationError, match="at least one of url or content"):
        SupplementaryResource.model_validate(
            {
                "resource_id": "r1",
                "type": "worked_example",
                "title": "missing payload",
                "url": None,
                "content": None,
            }
        )


def test_resource_with_only_url_accepted():
    r = SupplementaryResource.model_validate(
        {
            "resource_id": "r1",
            "type": "worked_example",
            "title": "ok",
            "url": "https://example.com/wx",
        }
    )
    assert r.url == "https://example.com/wx"
    assert r.content is None


def test_resource_with_only_content_accepted():
    r = SupplementaryResource.model_validate(
        {
            "resource_id": "r2",
            "type": "worked_example",
            "title": "ok",
            "content": "## Worked example\n...",
        }
    )
    assert r.content.startswith("## Worked example")


# ---------------------------------------------------------------------------
# 5. AC9 elaboration-attachment (Req 4.9)
# ---------------------------------------------------------------------------


def test_acara_official_elaboration_with_matching_prefix_accepted():
    elab = {
        "elaboration_id": "AC9M7N04_E1",
        "text": "official elaboration",
        "source": "acara_official",
        "source_ref": "ACARA AC9 Maths Y7",
    }
    topic = AC9MathsTopic.model_validate(_ac9_maths_payload(elaborations=[elab]))
    assert topic.elaborations[0].elaboration_id == "AC9M7N04_E1"


def test_acara_official_elaboration_with_mismatched_prefix_rejected():
    elab = {
        # prefix AC9M7N06 doesn't match the topic_id AC9M7N04
        "elaboration_id": "AC9M7N06_E1",
        "text": "wrong attachment",
        "source": "acara_official",
    }
    with pytest.raises(ValidationError, match="prefix"):
        AC9MathsTopic.model_validate(_ac9_maths_payload(elaborations=[elab]))


def test_school_added_elaboration_not_subject_to_attachment_rule():
    """Only ``acara_official`` elaborations are constrained by the attachment
    invariant. School-added content can use any id shape."""
    elab = {
        "elaboration_id": "school_local_001",
        "text": "teacher-authored elaboration",
        "source": "school_added",
    }
    topic = AC9MathsTopic.model_validate(_ac9_maths_payload(elaborations=[elab]))
    assert topic.elaborations[0].source == "school_added"


def test_qcaa_official_elaboration_id_shape_enforced():
    """QCAA Senior elaborations use the SM-suffixed shape (Req 4.5)."""
    bad = {
        "elaboration_id": "AC9M7N04_E1",  # AC9 shape on a QCAA source
        "text": "wrong shape",
        "source": "qcaa_official",
    }
    with pytest.raises(ValidationError):
        Elaboration.model_validate(bad)


# ---------------------------------------------------------------------------
# 6. CurriculumSequence dedup (Req 6.2)
# ---------------------------------------------------------------------------


def test_sequence_with_duplicates_rejected():
    with pytest.raises(ValidationError, match="duplicates"):
        CurriculumSequence.model_validate(
            {
                "sequence": ["AC9M7N04", "AC9M7N06", "AC9M7N04"],
                "prerequisites": {},
                "is_strict": False,
            }
        )


def test_sequence_without_duplicates_accepted():
    seq = CurriculumSequence.model_validate(
        {
            "sequence": ["AC9M7N04", "AC9M7N06"],
            "prerequisites": {},
            "is_strict": False,
        }
    )
    assert seq.sequence == ["AC9M7N04", "AC9M7N06"]


# ---------------------------------------------------------------------------
# 7. FrameworkSliceFile sequence-curriculum consistency (Req 6.7)
# ---------------------------------------------------------------------------


def test_sequence_entry_missing_from_topics_rejected():
    payload = {
        "framework_id": "AC9_MATHS",
        "topics": [_ac9_maths_payload()],  # only AC9M7N04 present
        "sequence": {
            "sequence": ["AC9M7N04", "AC9M7N06"],  # AC9M7N06 not in topics
            "prerequisites": {},
            "is_strict": False,
        },
    }
    with pytest.raises(ValidationError, match="sequence references topic_id"):
        FrameworkSliceFile.model_validate(payload)


def test_consistent_slice_accepts():
    payload = {
        "framework_id": "AC9_MATHS",
        "topics": [
            _ac9_maths_payload(),
            _ac9_maths_payload(topic_id="AC9M7N06", name="Operations on rationals"),
        ],
        "sequence": {
            "sequence": ["AC9M7N04", "AC9M7N06"],
            "prerequisites": {"AC9M7N06": ["AC9M7N04"]},
            "is_strict": False,
        },
    }
    slice_obj = FrameworkSliceFile.model_validate(payload)
    assert [t.topic_id for t in slice_obj.topics] == ["AC9M7N04", "AC9M7N06"]


# ---------------------------------------------------------------------------
# 8. FrameworkSliceFile prerequisites-internal-consistency (Req 6.8 / 6.9)
# ---------------------------------------------------------------------------


def test_prereq_key_missing_from_topics_rejected():
    payload = {
        "framework_id": "AC9_MATHS",
        "topics": [_ac9_maths_payload()],
        "sequence": {
            "sequence": ["AC9M7N04"],
            "prerequisites": {"AC9M7N99": ["AC9M7N04"]},  # key not in topics
            "is_strict": False,
        },
    }
    with pytest.raises(ValidationError, match="prerequisites key"):
        FrameworkSliceFile.model_validate(payload)


def test_prereq_target_missing_from_topics_rejected():
    payload = {
        "framework_id": "AC9_MATHS",
        "topics": [
            _ac9_maths_payload(),
            _ac9_maths_payload(topic_id="AC9M7N06", name="Operations"),
        ],
        "sequence": {
            "sequence": ["AC9M7N04", "AC9M7N06"],
            # AC9M7M01 is not in topics
            "prerequisites": {"AC9M7N06": ["AC9M7N04", "AC9M7M01"]},
            "is_strict": False,
        },
    }
    with pytest.raises(ValidationError, match="prerequisite"):
        FrameworkSliceFile.model_validate(payload)


# ---------------------------------------------------------------------------
# Bonus: topic-id-validity invariant via the registry stub
# ---------------------------------------------------------------------------


def test_topic_id_rejected_by_framework_validator():
    """``topic_id="AC9M7Z99"`` is not accepted by the AC9_MATHS validator
    (strand letter ``Z`` is not in the allowed set), so the topic-id-validity
    model_validator must raise (Req 3.10)."""
    payload = _ac9_maths_payload(topic_id="AC9M7Z99")
    with pytest.raises(ValidationError, match="not accepted by the validator"):
        AC9MathsTopic.model_validate(payload)


def test_qcaa_senior_english_literature_extension_topic_minimal_valid():
    payload = _qcaa_english_payload(
        topic_id="QCAA_LITERATURE_EXTENSION_U1_T1",
        name="Literature extension perspectives",
        syllabus_subject="literature_extension",
    )
    topic = QCAASeniorEnglishTopic.model_validate(payload)
    assert topic.syllabus_subject == "literature_extension"
