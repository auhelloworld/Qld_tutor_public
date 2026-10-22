"""Diagnostic placement: area estimates, item selection, and evidence routing.

Synthetic slices keep each rule visible: short-answer items are answered "1"
(correct) or "2" (incorrect) and marked by the real deterministic grader.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from backend.diagnostic_engine import (
    DiagnosticEngine,
    area_band,
    area_limits,
    estimate_ability,
)
from backend.rules import get_engine


def _slice(*topics: tuple[str, str]):
    return SimpleNamespace(
        topics=[SimpleNamespace(topic_id=t, strand=s, sub_strand=None) for t, s in topics],
        sequence=SimpleNamespace(sequence=[t for t, _ in topics]),
    )


def _item(qid: str, topic: str, difficulty: str = "developing", year: int = 7, **extra) -> dict:
    return {
        "id": qid, "subject": "math", "year_level": year, "topic_ids": [topic],
        "question_type": "short_answer", "difficulty": difficulty,
        "question": qid, "answer": "1", **extra,
    }


SLICES = {
    7: _slice(("N1", "Number"), ("N2", "Number"), ("A1", "Algebra")),
    8: _slice(("N8", "Number"), ("A8", "Algebra")),
}
BANK = [
    *(_item(f"n1-{band}-{i}", "N1", band) for band in ("foundational", "developing", "extending") for i in range(3)),
    *(_item(f"n2-{band}-{i}", "N2", band) for band in ("foundational", "developing", "extending") for i in range(3)),
    *(_item(f"a1-{band}-{i}", "A1", band) for band in ("foundational", "developing", "extending") for i in range(3)),
    *(_item(f"n8-{band}-{i}", "N8", band, year=8) for band in ("foundational", "developing", "extending") for i in range(3)),
    *(_item(f"a8-{band}-{i}", "A8", band, year=8) for band in ("foundational", "developing", "extending") for i in range(3)),
]


@pytest.fixture
def engine(monkeypatch):
    diagnostic = DiagnosticEngine({item["id"]: dict(item) for item in BANK})
    monkeypatch.setattr(diagnostic.loader, "load_slice", lambda _fw, year: SLICES[int(year)])
    monkeypatch.setattr(diagnostic.builder, "build", lambda **_: [])
    monkeypatch.setattr(
        diagnostic, "_grading_capabilities",
        lambda *_: {"reasoning_supported": False, "parent_review_mode": False},
    )
    monkeypatch.setattr("backend.api.invalidate_mistakes_cache", lambda *_: None)
    return diagnostic


def _run(engine, student_id, respond_kwargs, *, year=7, **start_kwargs):
    started = engine.start(student_id=student_id, subject="math", year_level=year, **start_kwargs)
    question, served = started["question"], []
    for _ in range(40):
        served.append(question)
        result = engine.respond(
            student_id=student_id, report_id=started["report_id"],
            question_id=question["id"], **respond_kwargs(question),
        )
        if result.get("completed"):
            return started, result, served
        question = result["question"]
    raise AssertionError("diagnostic did not finish")


def _answer(text):
    return lambda _question: {"student_answer": text}


def _response(difficulty, correct, **extra):
    return {"difficulty": difficulty, "is_correct": correct, "outcome": "correct" if correct else "incorrect",
            "question_type": "short_answer", "attempt_type": "diagnostic", **extra}


def test_area_limits_spread_items_across_areas():
    assert area_limits(6) == (2, 3)  # Maths and split Science
    assert area_limits(3) == (4, 5)  # English: 12-15 questions, not 6-9


def test_ability_estimate_uses_difficulty_not_answer_order():
    recovered = [_response("developing", False), _response("foundational", True), _response("developing", True)]
    assert estimate_ability(recovered) == pytest.approx(estimate_ability(list(reversed(recovered))))
    # BKT with a learning step scored this pattern 0.99 ("mastered").
    assert area_band(estimate_ability(recovered)) == "building"
    assert area_band(estimate_ability([_response("developing", True), _response("extending", True)])) == "secure"
    assert area_band(estimate_ability([_response("developing", False), _response("foundational", False)])) == "start_here"

    pending = {**_response("developing", False), "outcome": "pending", "grading_deferred": True}
    assert estimate_ability([_response("developing", True), pending]) == estimate_ability([_response("developing", True)])
    lucky = {**_response("developing", True), "confidence": "guess"}
    assert estimate_ability([lucky]) < estimate_ability([_response("developing", True)])


def test_all_correct_is_secure_and_all_wrong_is_start_here(engine):
    started, strong, _ = _run(engine, "placement-strong", _answer("1"))
    assert started["progress"]["area_total"] == 2
    assert started["coverage"]["area_count"] == 2
    assert started["coverage"]["estimated_questions"] == 2 * area_limits(2)[0]
    assert {area["band"] for area in strong["areas"].values()} == {"secure"}
    assert strong["start_topics"] == []

    _, weak, _ = _run(engine, "placement-weak", _answer("2"))
    assert {area["band"] for area in weak["areas"].values()} == {"start_here"}
    assert set(weak["start_topics"]) <= {"N1", "N2", "A1"} and weak["start_topics"]


def test_next_question_prefers_a_new_topic_within_the_area(engine):
    pools = {"Number": {"foundational": [], "developing": [_item("d1", "N1"), _item("d2", "N1"), _item("d3", "N2")],
                        "extending": [], "AMC": []}}
    report = {"year_level": 7, "subject": "math", "selection_offset": 0, "area_limits": [3, 4],
              "responses": [{**_response("developing", True), "question_id": "d1", "topic_id": "N1", "area": "Number"}]}
    assert engine._next_question(report, pools, ["Number"]) == "d3"


def test_selection_offset_is_student_specific_and_stable():
    first = DiagnosticEngine._selection_offset("student-a", "math", 7, 0)
    assert first == DiagnosticEngine._selection_offset("student-a", "math", 7, 0)
    assert first != DiagnosticEngine._selection_offset("student-b", "math", 7, 0)


def test_not_learned_and_wrong_answers_stay_out_of_error_book(engine):
    def respond(question):
        if question["topic_ids"] == ["A1"]:
            return {"student_answer": "", "not_learned": True}
        return {"student_answer": "2"}

    _, result, _ = _run(engine, "placement-not-learned", respond)
    assert result["areas"]["Algebra"]["band"] == "start_here"

    student = get_engine("placement-not-learned", "math")
    assert student.query_mistake_states(status=None)["total"] == 0
    rows = [a for t in student.load_log()["topics"].values() for a in t["attempts"]]
    not_learned = [a for a in rows if a.get("error_type") == "not_yet_learned"]
    assert not_learned and all(a["correct"] is False for a in not_learned)
    assert not any(str(a.get("question_id", "")).startswith("pseudo_") for a in rows)


def test_confident_error_sets_start_topic_and_misconception_note(engine):
    engine.exercises["n2-developing-0"]["math_metadata"] = {"common_misconceptions": ["Adds denominators."]}
    report = {"subject": "math", "year_level": 7, "responses": [
        {**_response("developing", False), "question_id": "n1-developing-0", "topic_id": "N1", "area": "Number"},
        {**_response("foundational", False), "question_id": "n2-developing-0", "topic_id": "N2", "area": "Number",
         "confidence": "sure"},
    ]}
    number = engine._area_results(report)["Number"]
    assert number["band"] == "start_here"
    assert number["start_topic"] == "N2"  # sure-but-wrong outranks an earlier topic
    assert number["confident_errors"] == ["N2"]
    assert number["misconception_notes"] == ["Adds denominators."]


def test_failed_area_gets_one_prior_year_probe_outside_the_estimate(engine):
    _, result, served = _run(engine, "placement-prior", _answer("2"), year=8)
    probes = [q for q in served if q["id"].startswith(("n1-", "n2-", "a1-"))]
    assert len(probes) == 2  # one Year 7 check per failed area
    number = result["areas"]["Number"]
    assert number["prior_year_check"]["year"] == 7
    assert number["prior_year_check"]["correct"] is False
    assert number["questions"] == len([q for q in served if q["topic_ids"] == ["N8"]])


def test_area_retest_skips_cooldown_and_updates_only_that_area(engine):
    _run(engine, "placement-retest", _answer("2"))
    student = get_engine("placement-retest", "math")
    before = student.get_diagnostic_status(7)

    _, retest, served = _run(engine, "placement-retest", _answer("1"), area="Algebra")
    assert {q["topic_ids"][0] for q in served} == {"A1"}
    after = student.get_diagnostic_status(7)
    assert after["completed_at"] == before["completed_at"]
    assert after["areas"]["Algebra"]["band"] == "secure"
    assert after["areas"]["Algebra"]["previous_band"] == "start_here"
    assert after["areas"]["Number"] == before["areas"]["Number"]
    assert retest["areas"]["Algebra"]["band"] == "secure"
