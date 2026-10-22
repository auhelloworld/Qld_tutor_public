from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote

import pytest

from backend._testing import reset_engine_factory_cache
from backend.routers import tutor
from backend.rules import get_engine
from backend.services.today_plan import FOCUS_MAX_QUESTIONS, build_today_plan
from backend.services.today_topics import build_topic_facts

DAY = date(2026, 8, 1)


def _fresh_engine(tmp_data_dir, student_id: str = "today-study-student", subject: str = "math"):
    (tmp_data_dir / "qld_tutor.db").unlink(missing_ok=True)
    reset_engine_factory_cache()
    return get_engine(student_id, subject)


def _row(topic, status="developing", bkt=0.6, attempts=6):
    return {"topic": topic, "status": status, "bkt_mastery": bkt, "direct_attempts_count": attempts}


def _plan(**overrides):
    kwargs = dict(
        day=DAY,
        subject="math",
        scope="year7",
        recommendation={"recommendation_type": "forward", "topic_id": "AC9M7N01"},
        progress=[_row("AC9M7N01")],
        mistake_rows=[],
        forward_topic="AC9M7N01",
    )
    kwargs.update(overrides)
    return build_today_plan(**kwargs)


def _task(plan, kind):
    return next(task for task in plan["tasks"] if task["kind"] == kind)


def _evidence(*answers):
    """Today evidence for one task. Each answer: (question_id, topics, independent[, supported])."""
    rows = []
    for answer in answers:
        question_id, topics, independent = answer[:3]
        supported = answer[3] if len(answer) > 3 else independent
        rows.append({
            "question_id": question_id,
            "topics": list(topics),
            "supported_correct": supported,
            "independent_correct": independent,
        })
    return {
        "attempted": len(rows),
        "attempted_question_ids": [row["question_id"] for row in rows],
        "ordered_evidence": rows,
    }


REVIEW_DAY = {"recommendation_type": "revision", "topic_id": "AC9M7N03", "reason": "Due for revision"}


def test_today_plan_keeps_a_slot_for_the_new_topic():
    plan = _plan(
        recommendation=REVIEW_DAY,
        progress=[_row("AC9M7N03", "mastered", 0.9), _row("AC9M7N02", "emerging", 0.3, 2)],
        mistake_rows=[
            {"question_id": "source-q", "topic_id": "AC9M7N05", "closure_stage": "needs_understanding", "resolved": False},
            {"question_id": "transfer-q", "topic_id": "AC9M7N04", "closure_stage": "needs_transfer", "resolved": False},
        ],
        due_revision_topics=["AC9M7N03"],
        forward_topic="AC9M7N02",
    )

    # Two mistake topics and the new topic fill the three-topic budget; the review waits.
    assert [task["kind"] for task in plan["tasks"]] == ["mistake", "mistake", "focus", "exit"]
    assert plan["tasks"][0]["question_id"] == "transfer-q"
    assert _task(plan, "focus")["topic_id"] == "AC9M7N02"
    assert _task(plan, "exit")["topic_ids"] == ["AC9M7N02", "AC9M7N04"]
    mistake = next(task for task in plan["tasks"] if task["question_id"] == "source-q")
    assert mistake["href"].startswith("/today/practice?")
    assert "today_task=" in mistake["href"]
    assert plan["next_href"] == plan["tasks"][0]["href"]
    assert "today_task=" in plan["next_href"]


@pytest.mark.parametrize("stage", ["needs_understanding", "needs_retry", "needs_transfer", "needs_consolidation"])
def test_every_mistake_step_opens_the_today_practice_page(stage):
    plan = _plan(mistake_rows=[{
        "question_id": "m-q", "topic_id": "AC9M7N05", "closure_stage": stage, "resolved": False,
        "consolidation_due_at": "2026-07-01T00:00:00+00:00",
    }])

    step = _task(plan, "mistake")
    assert step["closure_stage"] == stage
    assert step["href"] == f"/today/practice?subject=math&year=year7&today_task={quote(step['id'], safe='')}"


def test_a_mistake_made_today_waits_for_tomorrow():
    """A wrong answer today does not add a step to today's plan or replace a planned one."""
    now = datetime(2026, 8, 1, 15, 0, tzinfo=timezone(timedelta(hours=10)))
    older = {
        "question_id": "older-q", "topic_id": "AC9M7N01", "closure_stage": "needs_understanding",
        "resolved": False, "attempt_count": 1, "last_incorrect_at": "2026-07-31T03:00:00+00:00",
    }
    # 13:00 in Brisbane today, and more attempts: it would sort before the older mistake.
    fresh = {**older, "question_id": "fresh-q", "attempt_count": 2, "last_incorrect_at": "2026-08-01T03:00:00+00:00"}

    plan = _plan(mistake_rows=[fresh, older], now=now)

    assert [task["question_id"] for task in plan["tasks"] if task["kind"] == "mistake"] == ["older-q"]
    assert _task(plan, "exit")["locked"] is True


def test_a_mistake_made_and_worked_on_today_stays_as_a_done_step():
    now = datetime(2026, 8, 1, 15, 0, tzinfo=timezone(timedelta(hours=10)))
    caused_today = {
        "question_id": "caused-q", "topic_id": "AC9M7N01", "closure_stage": "needs_retry", "resolved": False,
        "last_incorrect_at": "2026-08-01T03:00:00+00:00", "cause_recorded_at": "2026-08-01T03:05:00+00:00",
    }

    plan = _plan(mistake_rows=[caused_today], now=now)

    step = _task(plan, "mistake")
    assert step["question_id"] == "caused-q"
    assert step["completed"] is True


def test_mistake_retry_opens_the_today_practice_page():
    plan = _plan(mistake_rows=[
        {"question_id": "retry-q", "topic_id": "AC9M7N05", "closure_stage": "needs_retry", "resolved": False},
    ])

    retry = _task(plan, "mistake")
    assert retry["question_id"] == "retry-q"
    assert retry["question_target"] == 1
    assert retry["href"] == f"/today/practice?subject=math&year=year7&today_task={quote(retry['id'], safe='')}"


def test_focus_follows_the_forward_topic_on_a_review_day():
    """A due review must not switch the new topic to the first unstarted topic by ID."""
    plan = _plan(
        recommendation=REVIEW_DAY,
        progress=[
            _row("AC9M7N03", "mastered", 0.93),
            _row("AC9M7N01", "developing", 0.62, 8),
            _row("AC9M7A01", "not_started", None, 0),
        ],
        due_revision_topics=["AC9M7N03"],
        forward_topic="AC9M7N01",
    )

    assert _task(plan, "revision")["topic_ids"] == ["AC9M7N03"]
    assert _task(plan, "focus")["topic_id"] == "AC9M7N01"


def test_review_leaves_room_for_the_new_topic():
    plan = _plan(
        recommendation=REVIEW_DAY,
        progress=[_row(topic, "mastered", 0.9) for topic in ("AC9M7N01", "AC9M7N02", "AC9M7N03")]
        + [_row("AC9M7N04", "emerging", 0.4, 1)],
        due_revision_topics=["AC9M7N01", "AC9M7N02", "AC9M7N03"],
        forward_topic="AC9M7N04",
    )

    assert _task(plan, "revision")["topic_ids"] == ["AC9M7N01", "AC9M7N02"]
    assert _task(plan, "focus")["topic_id"] == "AC9M7N04"


def test_unit_plan_links_keep_the_syllabus_scope():
    plan = _plan(
        scope="unit1",
        syllabus_subject="methods",
        recommendation={"recommendation_type": "senior_scope"},
        progress=[_row("QCAA_METHODS_U1_T2", "not_started", None, 0)],
        forward_topic="QCAA_METHODS_U1_T2",
    )

    assert _task(plan, "focus")["topic_id"] == "QCAA_METHODS_U1_T2"
    assert "unit=1" in plan["next_href"]
    assert "syllabus_subject=methods" in plan["next_href"]


def test_unit_topic_facts_keep_only_prerequisites_inside_the_unit(tmp_data_dir):
    from backend.services.analytics_scope import curriculum_topics_for_scope

    engine = _fresh_engine(tmp_data_dir, "unit-order-student", subject="methods")
    unit2 = curriculum_topics_for_scope("methods", unit=2, syllabus_subject="methods")

    facts = engine.today_topic_facts("unit2", log_snapshot={"topics": {}}, unit_topics=unit2)

    assert facts.order == tuple(topic.topic_id for topic in unit2)
    # Unit 2 Topic 1 builds on a Unit 1 topic. Unit 1 is outside this scope, so it is no gate.
    assert facts.missing_prerequisites("QCAA_METHODS_U2_T1") == []
    assert facts.next_topic() == "QCAA_METHODS_U2_T1"


def test_review_stops_per_topic_after_an_unaided_right_answer_or_two_answers():
    common = dict(
        recommendation=REVIEW_DAY,
        progress=[_row("AC9M7N03", "mastered", 0.9), _row("AC9M7N02", "mastered", 0.9), _row("AC9M7N01")],
        due_revision_topics=["AC9M7N03", "AC9M7N02"],
    )
    review = _task(_plan(**common), "revision")
    assert review["topic_ids"] == ["AC9M7N03", "AC9M7N02"]
    assert review["question_target"] == 4
    assert review["href"].startswith("/today/practice?")
    assert "today_topics" not in review["href"]

    partly = _task(_plan(**common, task_stats={review["id"]: _evidence(
        ("r1", ["AC9M7N03"], True),
        ("r2", ["AC9M7N02"], False),
    )}), "revision")
    assert partly["completed"] is False
    assert partly["topic_progress"] == [
        {"topic_id": "AC9M7N03", "answered": 1, "done": True},
        {"topic_id": "AC9M7N02", "answered": 1, "done": False},
    ]
    # The link names only the step. The practice page asks the open topics.
    assert partly["href"] == review["href"]

    done = _task(_plan(**common, task_stats={review["id"]: _evidence(
        ("r1", ["AC9M7N03"], True),
        ("r2", ["AC9M7N02"], False),
        ("r3", ["AC9M7N02"], True),
    )}), "revision")
    assert done["completed"] is True
    assert done["question_completed"] == 3
    # The first answer on AC9M7N02 was wrong, so the review was not done from memory.
    assert done["independent_secured"] is False
    assert done["supported_progress"] is True


@pytest.mark.parametrize(("answers", "completed", "secured"), [
    ([True, True, True], False, False),
    ([False, True, True, True], True, True),
    ([True, False, True, False], False, False),
    ([False] * FOCUS_MAX_QUESTIONS, True, False),
])
def test_focus_stops_when_three_of_the_last_four_are_right_on_your_own(answers, completed, secured):
    focus = _task(_plan(), "focus")
    stats = {focus["id"]: _evidence(*[(f"f{i}", ["AC9M7N01"], ok) for i, ok in enumerate(answers)])}
    focus = _task(_plan(task_stats=stats), "focus")

    assert focus["question_target"] == FOCUS_MAX_QUESTIONS
    assert focus["question_completed"] == len(answers)
    assert focus["completed"] is completed
    assert focus["independent_secured"] is secured


def test_new_topic_starts_with_a_learn_step_and_sets_the_goal():
    common = dict(
        progress=[_row("AC9M7N01", "not_started", None, 0)],
        success_criteria={"AC9M7N01": "I can find square roots of perfect squares."},
    )
    plan = _plan(**common)
    focus = _task(plan, "focus")
    assert focus["practice_mode"] == "guided"
    assert focus["learn_step"] is True
    assert focus["href"] == f"/today/practice?subject=math&year=year7&today_task={quote(focus['id'], safe='')}"
    assert plan["goal"] == "I can find square roots of perfect squares."
    assert focus["success_criterion"] == plan["goal"]

    started = _plan(**common, task_stats={focus["id"]: _evidence(("f1", ["AC9M7N01"], False))})
    assert _task(started, "focus")["learn_step"] is False


@pytest.mark.parametrize(("first_guided", "mode", "title"), [
    (True, "guided", "Learn something new"),
    (False, "independent", "Practise on your own"),
])
def test_new_topic_keeps_the_mode_it_started_with_for_the_day(first_guided, mode, title):
    """Progress made today must not switch the step's help rule or title."""
    initial = _task(_plan(progress=[_row("AC9M7N01", "not_started", None, 0)]), "focus")
    answers = _evidence(("f1", ["AC9M7N01"], True), ("f2", ["AC9M7N01"], True))
    answers["ordered_evidence"][0]["guided"] = first_guided

    # The answers lift the topic past the guided threshold.
    focus = _task(_plan(progress=[_row("AC9M7N01", "developing", 0.7, 6)], task_stats={initial["id"]: answers}), "focus")

    assert focus["practice_mode"] == mode
    assert focus["title"] == title
    assert focus["learn_step"] is False


def test_today_stats_record_whether_the_first_answer_was_guided(tmp_data_dir):
    engine = _fresh_engine(tmp_data_dir, "guided-phase-student")
    task_id = "today|2026-10-20|math|year7|focus|AC9M7N01"
    engine.log_attempt("AC9M7N01", "g1", True, student_answer="4", today_task_id=task_id,
                       support_level=0, first_attempt=True, guided_phase="guided")
    engine.log_attempt("AC9M7N01", "g2", True, student_answer="5", today_task_id=task_id,
                       support_level=0, first_attempt=True, guided_phase="independent")

    now = datetime.now(timezone.utc)
    stats = engine.get_today_plan_attempt_stats((now - timedelta(days=1)).isoformat(), (now + timedelta(days=1)).isoformat())
    assert [row["guided"] for row in stats[task_id]["ordered_evidence"]] == [True, False]


def test_final_check_asks_about_the_new_topic_and_one_review_topic():
    plan = _plan(
        recommendation=REVIEW_DAY,
        progress=[_row("AC9M7N03", "mastered", 0.9), _row("AC9M7N01", "not_started", None, 0)],
        due_revision_topics=["AC9M7N03"],
    )

    final = _task(plan, "exit")
    assert final["topic_ids"] == ["AC9M7N01", "AC9M7N03"]
    assert final["question_target"] == 2
    assert final["title"].startswith("Final check")


def test_final_check_uses_the_new_topic_twice_when_it_is_the_only_topic():
    plan = _plan(progress=[_row("AC9M7N01", "emerging", 0.31, 2)])
    assert _task(plan, "exit")["topic_ids"] == ["AC9M7N01"]


def test_final_check_quality_uses_only_the_first_two_answers():
    """Extra answers must not turn a wrong first answer into a pass."""
    final = _task(_plan(), "exit")
    plan = _plan(task_stats={final["id"]: _evidence(
        ("e1", ["AC9M7N01"], False),
        ("e2", ["AC9M7N01"], True),
        ("e3", ["AC9M7N01"], True),
    )})

    final = _task(plan, "exit")
    assert final["completed"] is True
    assert final["independent_correct_count"] == 1
    assert final["independent_secured"] is False
    assert plan["independent_secured"] is False


def test_started_final_check_keeps_its_topics_for_the_day():
    started = "today|2026-08-01|math|year7|exit|AC9M7N06,AC9M7N04"
    plan = _plan(
        recommendation=REVIEW_DAY,
        progress=[_row("AC9M7N04", "mastered", 0.9), _row("AC9M7N06", "emerging", 0.31, 2)],
        due_revision_topics=["AC9M7N04"],
        forward_topic="AC9M7N06",
        task_stats={started: _evidence(("e1", ["AC9M7N06"], True))},
    )

    final = _task(plan, "exit")
    assert final["id"] == started
    assert final["topic_ids"] == ["AC9M7N06", "AC9M7N04"]
    assert final["question_completed"] == 1


def test_plan_can_finish_without_independent_evidence():
    initial = _plan()
    focus, final = _task(initial, "focus"), _task(initial, "exit")
    plan = _plan(task_stats={
        focus["id"]: _evidence(*[(f"f{i}", ["AC9M7N01"], False, True) for i in range(FOCUS_MAX_QUESTIONS)]),
        final["id"]: _evidence(("e1", ["AC9M7N01"], True), ("e2", ["AC9M7N01"], False)),
    })

    assert plan["complete"] is True
    assert plan["independent_secured"] is False
    assert plan["question_completed"] == FOCUS_MAX_QUESTIONS + 2
    assert plan["remaining_minutes"] == 0
    assert plan["next_task_id"] is None


def test_remaining_minutes_go_down_as_work_is_done():
    initial = _plan()
    focus = _task(initial, "focus")
    later = _plan(task_stats={focus["id"]: _evidence(("f1", ["AC9M7N01"], True), ("f2", ["AC9M7N01"], True))})

    assert initial["remaining_minutes"] == initial["estimated_minutes"]
    assert later["remaining_minutes"] < initial["remaining_minutes"]
    assert later["estimated_minutes"] == initial["estimated_minutes"]


def test_at_most_three_mistake_steps_a_day():
    rows = [
        {"question_id": f"m{i}", "topic_id": "AC9M7N01", "closure_stage": "needs_transfer", "resolved": False}
        for i in range(5)
    ]
    plan = _plan(mistake_rows=rows)
    assert sum(task["kind"] == "mistake" for task in plan["tasks"]) == 3


def test_plan_has_no_compatibility_aliases():
    plan = _plan(mistake_rows=[{
        "question_id": "m1", "topic_id": "AC9M7N01", "closure_stage": "needs_transfer", "resolved": False,
    }])

    for key in ("secured", "secured_tasks", "completed", "question_target", "supported_correct_count"):
        assert key not in plan
    for task in plan["tasks"]:
        for key in ("secured", "correct_count", "target_count", "completed_count", "quality_target"):
            assert key not in task


def test_started_focus_stays_for_the_day():
    old_task = "today|2026-08-01|math|year7|focus|AC9M7N01"
    plan = _plan(
        forward_topic="AC9M7N02",
        progress=[_row("AC9M7N02", "emerging", 0.1, 1)],
        task_stats={old_task: _evidence(("f1", ["AC9M7N01"], True), ("f2", ["AC9M7N01"], True))},
    )

    focus = _task(plan, "focus")
    assert focus["id"] == old_task
    assert focus["topic_id"] == "AC9M7N01"
    assert focus["question_completed"] == 2
    assert focus["completed"] is False


def test_today_plan_keeps_a_mistake_closed_today_as_completed():
    plan = _plan(
        forward_topic="AC9M7N02",
        progress=[_row("AC9M7N02", "emerging", 0.2, 1)],
        mistake_rows=[{
            "question_id": "closed-q",
            "topic_id": "AC9M7N01",
            "closure_stage": "closed",
            "resolved": True,
            "closed_at": "2026-08-01T01:00:00+00:00",
        }],
    )

    mistake = _task(plan, "mistake")
    assert mistake["question_id"] == "closed-q"
    assert mistake["completed"] is True


def test_dismissed_in_progress_diagnostic_does_not_take_over_today():
    """"Don't remind me" mid-diagnostic must not lock Today to the diagnostic."""
    in_progress = {"report_id": "r1", "completed_at": None, "question_target": 8, "question_completed": 2}

    active = _plan(diagnostic_status=in_progress)
    assert [task["kind"] for task in active["tasks"]] == ["diagnostic"]
    assert active["tasks"][0]["estimated_minutes"] == 16  # about 2 minutes per question
    assert active["remaining_minutes"] == 12

    dismissed = _plan(diagnostic_status={**in_progress, "diagnostic_dismissed_at": "2026-07-30T00:00:00+00:00"})
    assert "diagnostic" not in [task["kind"] for task in dismissed["tasks"]]


def test_today_plan_keeps_diagnostic_as_the_only_task_for_the_day():
    in_progress = _plan(diagnostic_status={
        "report_id": "diagnostic-1",
        "completed_at": None,
        "question_completed": 6,
        "question_target": 15,
    })
    assert [task["kind"] for task in in_progress["tasks"]] == ["diagnostic"]
    assert in_progress["question_completed"] == 6
    assert in_progress["complete"] is False

    completed = _plan(diagnostic_status={
        "report_id": "diagnostic-1",
        "completed_at": "2026-08-01T02:00:00+00:00",
        "question_completed": 15,
        "question_target": 15,
        "valid_completion": True,
    })
    assert [task["kind"] for task in completed["tasks"]] == ["diagnostic"]
    assert completed["question_completed"] == 15
    assert completed["complete"] is True
    assert completed["independent_secured"] is True
    assert completed["next_task_id"] is None


def test_today_plan_only_schedules_consolidation_when_due():
    now = datetime(2026, 8, 1, 9, 0, tzinfo=timezone(timedelta(hours=10)))
    base = {
        "question_id": "source-consolidation",
        "topic_id": "AC9M7N03",
        "closure_stage": "needs_consolidation",
        "resolved": False,
    }
    common = dict(recommendation={"recommendation_type": "senior_scope"}, progress=[], forward_topic=None, now=now)

    early = _plan(**common, mistake_rows=[{**base, "consolidation_due_at": (now + timedelta(hours=2)).isoformat()}])
    assert all(task["kind"] != "mistake" for task in early["tasks"])

    due = _plan(**common, mistake_rows=[{**base, "consolidation_due_at": (now - timedelta(seconds=1)).isoformat()}])
    mistake_task = _task(due, "mistake")
    assert mistake_task["closure_stage"] == "needs_consolidation"
    assert mistake_task["href"].startswith("/today/practice?")


def test_revision_reason_ignores_a_forward_recommendation():
    common = dict(
        progress=[_row("AC9M7N01", "mastered", 0.9), _row("AC9M7N04", "emerging", 0.3, 2)],
        due_revision_topics=["AC9M7N01"],
        forward_topic="AC9M7N04",
    )
    forward = _plan(**common, recommendation={
        "recommendation_type": "forward",
        "topic_id": "AC9M7N04",
        "reason": "Mastery at 30% — keep practising independently to reach 85%.",
    })
    assert "Mastery at 30%" not in _task(forward, "revision")["reason"]

    due = _plan(**common, recommendation={
        "recommendation_type": "revision",
        "topic_id": "AC9M7N01",
        "reason": "Spaced revision — last practised 5 days ago.",
    })
    assert _task(due, "revision")["reason"] == "Spaced revision — last practised 5 days ago."


def test_today_plan_tasks_carry_topic_names():
    plan = _plan(
        recommendation=REVIEW_DAY,
        progress=[_row("AC9M7N03", "mastered", 0.9), _row("AC9M7N01")],
        mistake_rows=[{
            "question_id": "mistake-q",
            "topic_id": "AC9M7N05",
            "closure_stage": "needs_transfer",
            "resolved": False,
        }],
        due_revision_topics=["AC9M7N03"],
        topic_names={"AC9M7N03": "Squares and square roots"},
    )

    for task in plan["tasks"]:
        assert len(task["topic_names"]) == len(task["topic_ids"])
    assert _task(plan, "revision")["topic_names"] == ["Squares and square roots"]
    # A topic without a curriculum name falls back to its identifier.
    assert _task(plan, "mistake")["topic_names"] == ["AC9M7N05"]


def test_mistake_stages_advance_from_cause_to_retry(tmp_data_dir):
    engine = _fresh_engine(tmp_data_dir)
    engine.log_attempt(
        "AC9M7N02",
        "source-q",
        False,
        error_type="concept_gap",
        student_answer="wrong",
    )
    assert engine.get_mistake_state("source-q")["closure_stage"] == "needs_understanding"

    assert engine.update_latest_incorrect_attempt_metadata(
        "source-q",
        {
            "error_cause": "method_choice",
            "reflection_type": "method_choice",
            "cause_recorded_at": "2026-07-31T10:00:00+00:00",
        },
        topics=["AC9M7N02"],
    )
    caused = engine.get_mistake_state("source-q")
    assert caused["closure_stage"] == "needs_retry"
    assert caused["error_cause"] == "method_choice"

    engine.log_attempt(
        "AC9M7N02",
        "source-q",
        True,
        student_answer="right",
    )
    retried = engine.get_mistake_state("source-q")
    assert retried["closure_stage"] == "needs_transfer"
    assert retried["retry_correct_at"]


def test_transfer_requires_later_consolidation_before_closing(tmp_data_dir, monkeypatch):
    engine = _fresh_engine(tmp_data_dir)
    monkeypatch.setattr(tutor, "get_engine", lambda *_args: engine)
    engine.log_attempt(
        "AC9M7N02",
        "source-q",
        False,
        error_type="concept_gap",
        student_answer="wrong",
    )
    engine.update_latest_incorrect_attempt_metadata(
        "source-q",
        {
            "error_cause": "concept_gap",
            "cause_recorded_at": datetime.now(timezone.utc).isoformat(),
        },
        topics=["AC9M7N02"],
    )
    engine.log_attempt(
        "AC9M7N02",
        "source-q",
        True,
        student_answer="corrected original",
    )
    engine.log_attempt(
        "AC9M7N02",
        "transfer-q-1",
        True,
        student_answer="right",
        review_source="error_book",
        review_question_id="source-q",
        review_match={"eligible": True},
    )

    request = tutor.MistakeResolveRequest(
        subject="math",
        question_id="source-q",
        topic_id="AC9M7N02",
        resolved=True,
        resolution_source="demonstrated_correction",
        year_level=7,
    )
    first = tutor.resolve_mistake_review(request, student_id=engine.student_id)
    assert first["resolved"] is False
    assert first["closure_stage"] == "needs_consolidation"
    assert datetime.fromisoformat(first["consolidation_due_at"]) - datetime.fromisoformat(first["transfer_correct_at"]) == timedelta(days=3)

    past_due = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    engine.set_mistake_closure_state(
        "source-q",
        closure_stage="needs_consolidation",
        resolved=False,
        resolved_at=None,
        review_count=first["review_count"],
        resolution_source="demonstrated_correction",
        transfer_correct_at=first["transfer_correct_at"],
        consolidation_due_at=past_due,
    )
    engine.log_attempt(
        "AC9M7N02",
        "transfer-q-2",
        True,
        student_answer="right again",
        review_source="error_book",
        review_question_id="source-q",
        review_match={"eligible": True},
    )

    closed = tutor.resolve_mistake_review(request, student_id=engine.student_id)
    assert closed["resolved"] is True
    assert closed["closure_stage"] == "closed"
    assert closed["closed_at"]


def test_a_second_try_on_a_transfer_question_does_not_advance_the_mistake(tmp_data_dir, monkeypatch):
    """Only a first try shows transfer. A right answer after "Not right yet" is practice."""
    from fastapi import HTTPException

    engine = _fresh_engine(tmp_data_dir)
    monkeypatch.setattr(tutor, "get_engine", lambda *_args: engine)
    engine.log_attempt("AC9M7N02", "source-q", False, error_type="concept_gap", student_answer="wrong")
    engine.update_latest_incorrect_attempt_metadata(
        "source-q",
        {"error_cause": "concept_gap", "cause_recorded_at": datetime.now(timezone.utc).isoformat()},
        topics=["AC9M7N02"],
    )
    engine.log_attempt("AC9M7N02", "source-q", True, student_answer="corrected original")
    transfer = dict(review_source="error_book", review_question_id="source-q", review_match={"eligible": True})
    engine.log_attempt("AC9M7N02", "transfer-q", False, student_answer="miss", first_attempt=True, **transfer)
    engine.log_attempt("AC9M7N02", "transfer-q", True, student_answer="second try", first_attempt=False, **transfer)

    request = tutor.MistakeResolveRequest(
        subject="math", question_id="source-q", topic_id="AC9M7N02",
        resolved=True, resolution_source="demonstrated_correction", year_level=7,
    )
    with pytest.raises(HTTPException) as refused:
        tutor.resolve_mistake_review(request, student_id=engine.student_id)
    assert refused.value.status_code == 409
    assert engine.get_mistake_state("source-q")["closure_stage"] == "needs_transfer"


def test_existing_mistake_state_schema_is_upgraded_idempotently(tmp_data_dir):
    import sqlite3

    db_path = tmp_data_dir / "qld_tutor.db"
    db_path.unlink(missing_ok=True)
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            """
            CREATE TABLE mistake_state (
                student_id TEXT NOT NULL, subject TEXT NOT NULL, question_id TEXT NOT NULL,
                topic_id TEXT NOT NULL, error_type TEXT, last_incorrect_at TEXT NOT NULL,
                last_correct_after_error_at TEXT, fixed_by_later_correct INTEGER NOT NULL DEFAULT 0,
                attempt_count INTEGER NOT NULL, attempt_data TEXT NOT NULL,
                resolved INTEGER NOT NULL DEFAULT 0, resolved_at TEXT,
                review_count INTEGER NOT NULL DEFAULT 0, resolution_source TEXT,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (student_id, subject, question_id)
            )
            """
        )
        conn.execute(
            """
            INSERT INTO mistake_state (
                student_id, subject, question_id, topic_id, last_incorrect_at,
                attempt_count, attempt_data, updated_at
            ) VALUES ('legacy-student', 'math', 'legacy-q', 'AC9M7N02',
                      '2026-07-01T00:00:00+00:00', 1,
                      '{"question_id":"legacy-q","correct":false}',
                      '2026-07-01T00:00:00+00:00')
            """
        )
        conn.commit()
    finally:
        conn.close()

    reset_engine_factory_cache()
    engine = get_engine("legacy-student", "math")
    state = engine.get_mistake_state("legacy-q")

    assert state is not None
    assert state["closure_stage"] == "needs_understanding"
    conn = sqlite3.connect(db_path)
    try:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(mistake_state)")}
    finally:
        conn.close()
    assert {
        "closure_stage", "error_cause", "cause_recorded_at", "retry_correct_at",
        "transfer_correct_at", "consolidation_due_at", "closed_at",
    } <= columns


def test_today_plan_endpoint_reuses_one_scoped_log_snapshot(tmp_data_dir, monkeypatch):
    engine = _fresh_engine(tmp_data_dir, "today-snapshot-student")
    monkeypatch.setattr(tutor, "get_engine", lambda *_args: engine)
    original_load_log = engine.load_log
    calls: list[tuple[str, ...]] = []

    def counted_load_log(topics=None):
        calls.append(tuple(topics or ()))
        return original_load_log(topics=topics)

    monkeypatch.setattr(engine, "load_log", counted_load_log)

    plan = tutor.get_today_plan(
        subject="math",
        year="year7",
        student_id=engine.student_id,
    )

    assert plan["session_id"].endswith(":math:year7")
    assert len(calls) == 1
    assert "AC9M7N02" in calls[0]


def test_today_plan_endpoint_returns_diagnostic_for_new_junior_student(tmp_data_dir, monkeypatch):
    engine = _fresh_engine(tmp_data_dir, "new-today-student")
    monkeypatch.setattr(tutor, "get_engine", lambda *_args: engine)

    plan = tutor.get_today_plan(
        subject="math",
        year="year7",
        student_id=engine.student_id,
    )

    assert plan["session_id"].endswith(":math:year7")
    assert plan["tasks"][0]["kind"] == "diagnostic"
    assert plan["next_href"].startswith("/diagnostic?")


def test_same_attempt_keeps_maximum_support_and_error_book_source(tmp_data_dir):
    engine = _fresh_engine(tmp_data_dir, "support-max-student")
    attempt_id = engine.log_attempt(
        "AC9M7N01", "q-multi", False, student_answer='{"a":"1"}',
        attempt_id="physical-attempt", support_level=3,
        review_source="error_book", review_question_id="source-q",
    )
    engine.log_attempt(
        "AC9M7N01", "q-multi", True, student_answer='{"a":"1","b":"2"}',
        attempt_id=attempt_id, support_level=1,
        review_source="today_plan", review_question_id="today-task",
        today_task_id="today-task", first_attempt=False,
    )

    attempts = engine.load_log(topics=["AC9M7N01"])["topics"]["AC9M7N01"]["attempts"]
    attempt = next(row for row in attempts if row.get("attempt_id") == attempt_id)
    assert attempt["support_level"] == 3
    assert attempt["review_source"] == "error_book"
    assert attempt["review_question_id"] == "source-q"
    assert attempt["today_task_id"] == "today-task"
    assert attempt["first_attempt"] is False


def test_today_plan_endpoint_returns_curriculum_topic_names(tmp_data_dir, monkeypatch):
    engine = _fresh_engine(tmp_data_dir, "today-names-student")
    monkeypatch.setattr(tutor, "get_engine", lambda *_args: engine)

    plan = tutor.get_today_plan(
        subject="math",
        year="unit1",
        syllabus_subject="methods",
        student_id=engine.student_id,
    )

    named = [task for task in plan["tasks"] if task.get("topic_ids")]
    assert named
    for task in named:
        assert task["topic_names"]
        assert all(name and not name.startswith("QCAA_") for name in task["topic_names"])


def _seed_due_review(engine, topic_id: str) -> None:
    now = datetime.now(timezone.utc)
    log = engine.load_log()
    log["topics"][topic_id] = {
        "attempts": [
            {
                "question_id": f"seed_{topic_id}_{index}",
                "correct": True,
                "error_type": None,
                "attempt_type": "answer",
                "support_level": 0,
                "timestamp": (now - timedelta(days=5, minutes=index)).isoformat(),
            }
            for index in range(6)
        ],
        "accuracy": 1.0,
        "revision": {
            "first_mastered_at": (now - timedelta(days=5)).isoformat(),
            "consecutive_revisions": 1,
            "next_review_at": (now - timedelta(hours=1)).isoformat(),
        },
    }
    log["diagnostic_status"] = {
        "math::7": {
            "report_id": None,
            "completed_at": None,
            "first_interaction_at": "2026-01-01T00:00:00+00:00",
            "diagnostic_dismissed_at": "2026-01-01T00:00:00+00:00",
        }
    }
    engine.save_log(log)


def test_today_plan_endpoint_uses_the_forward_topic_on_a_review_day(tmp_data_dir, monkeypatch):
    engine = _fresh_engine(tmp_data_dir, "today-forward-student")
    monkeypatch.setattr(tutor, "get_engine", lambda *_args: engine)
    sequence = engine._loader.load_slice("AC9_MATHS", 7).sequence.sequence
    _seed_due_review(engine, sequence[0])

    plan = tutor.get_today_plan(subject="math", year="year7", student_id=engine.student_id)

    review = next(task for task in plan["tasks"] if task["kind"] == "revision")
    focus = next(task for task in plan["tasks"] if task["kind"] == "focus")
    assert review["topic_ids"] == [sequence[0]]
    assert focus["topic_id"] == sequence[1]
    assert plan["goal"].startswith("I can")


def test_today_plan_endpoint_reviews_a_due_senior_topic_of_the_unit(tmp_data_dir, monkeypatch):
    engine = _fresh_engine(tmp_data_dir, "today-senior-review-student", subject="methods")
    monkeypatch.setattr(tutor, "get_engine", lambda *_args: engine)
    _seed_due_review(engine, "QCAA_METHODS_U1_T1")
    # Also due, but Unit 2 is a different scope.
    _seed_due_review(engine, "QCAA_METHODS_U2_T1")

    plan = tutor.get_today_plan(
        subject="methods",
        year="unit1",
        syllabus_subject="methods",
        student_id=engine.student_id,
    )

    review = next(task for task in plan["tasks"] if task["kind"] == "revision")
    assert review["topic_ids"] == ["QCAA_METHODS_U1_T1"]
    assert review["href"].startswith("/today/practice?")
    assert "unit=1" in review["href"]
    assert "syllabus_subject=methods" in review["href"]


def test_today_plan_endpoint_reports_the_next_review_date(tmp_data_dir, monkeypatch):
    engine = _fresh_engine(tmp_data_dir, "today-next-review-student")
    monkeypatch.setattr(tutor, "get_engine", lambda *_args: engine)
    sequence = engine._loader.load_slice("AC9_MATHS", 7).sequence.sequence
    _seed_due_review(engine, sequence[0])
    log = engine.load_log()
    soon = datetime.now(timezone.utc) + timedelta(days=3)
    log["topics"][sequence[0]]["revision"]["next_review_at"] = soon.isoformat()
    engine.save_log(log)

    plan = tutor.get_today_plan(subject="math", year="year7", student_id=engine.student_id)

    assert plan["next_review_at"] == soon.isoformat()
    assert all(task["kind"] != "revision" for task in plan["tasks"])


def test_today_attempt_stats_count_unique_questions_and_independent_quality(tmp_data_dir):
    engine = _fresh_engine(tmp_data_dir, "today-unique-student")
    task_id = "today|2026-08-01|math|year7|focus|AC9M7N01"
    engine.log_attempt("AC9M7N01", "q-repeat", False, student_answer="wrong", today_task_id=task_id)
    engine.log_attempt("AC9M7N01", "q-repeat", True, student_answer="correct", today_task_id=task_id)
    engine.log_attempt(
        "AC9M7N01", "q-supported", True, student_answer="scaffolded",
        today_task_id=task_id, support_level=3,
    )
    engine.log_attempt(
        "AC9M7N01", "q-revealed", True, student_answer="shown",
        today_task_id=task_id, support_level=4,
    )
    engine.log_attempt(
        "AC9M7N01", "q-error-book", False, student_answer="wrong",
        review_source="error_book", review_question_id="source-q",
        today_task_id=task_id,
    )

    stats = engine.get_today_plan_attempt_stats(
        "2000-01-01T00:00:00+00:00", "2100-01-01T00:00:00+00:00"
    )[task_id]

    assert stats["attempted"] == 4
    assert sum(row["supported_correct"] for row in stats["ordered_evidence"]) == 2
    assert sum(row["independent_correct"] for row in stats["ordered_evidence"]) == 0
    assert all(row["topics"] == ["AC9M7N01"] for row in stats["ordered_evidence"])
    assert not hasattr(engine, "get_today_plan_attempt_counts")


def test_today_attempt_stats_need_a_today_task_id(tmp_data_dir):
    """The old review_question_id fallback is gone: only validated Today task IDs count."""
    engine = _fresh_engine(tmp_data_dir, "today-key-student")
    task_id = "today|2026-08-01|math|year7|focus|AC9M7N01"
    engine.log_attempt(
        "AC9M7N01", "q-old-key", True, student_answer="right",
        review_source="today_plan", review_question_id=task_id,
    )

    stats = engine.get_today_plan_attempt_stats(
        "2000-01-01T00:00:00+00:00", "2100-01-01T00:00:00+00:00"
    )
    assert task_id not in stats


def test_today_attempt_stats_keep_first_answer_order(tmp_data_dir):
    engine = _fresh_engine(tmp_data_dir, "today-order-student")
    task_id = "today|2026-08-01|math|year7|exit|AC9M7N01"
    for question_id, correct in (("exit-1", False), ("exit-2", True), ("exit-3", True)):
        engine.log_attempt(
            "AC9M7N01", question_id, correct, student_answer="answer",
            today_task_id=task_id, support_level=0,
        )

    stats = engine.get_today_plan_attempt_stats(
        "2000-01-01T00:00:00+00:00", "2100-01-01T00:00:00+00:00"
    )[task_id]

    assert [row["question_id"] for row in stats["ordered_evidence"]] == ["exit-1", "exit-2", "exit-3"]
    assert [row["independent_correct"] for row in stats["ordered_evidence"]] == [False, True, True]


def test_today_attempt_stats_list_every_topic_of_a_cross_tagged_question(tmp_data_dir):
    engine = _fresh_engine(tmp_data_dir, "today-topics-student")
    task_id = "today|2026-08-01|math|year7|revision|AC9M7N01,AC9M7N02"
    engine.log_attempt(
        "AC9M7N01", "q-both", True, student_answer="answer",
        today_task_id=task_id, support_level=0, topic_ids=["AC9M7N01", "AC9M7N02"],
    )

    stats = engine.get_today_plan_attempt_stats(
        "2000-01-01T00:00:00+00:00", "2100-01-01T00:00:00+00:00"
    )[task_id]
    assert stats["attempted"] == 1
    assert stats["ordered_evidence"][0]["topics"] == ["AC9M7N01", "AC9M7N02"]


# --- Topic choice, free step order, more practice and time -------------------

# N02 builds on N01; N03 is mastered; N04 needs nothing.
FACTS = build_topic_facts(
    order=["AC9M7N01", "AC9M7N02", "AC9M7N04", "AC9M7N03"],
    mastered=["AC9M7N03"],
    prerequisites={"AC9M7N02": ["AC9M7N01"]},
)
NAMES = {
    "AC9M7N01": "Squares and square roots",
    "AC9M7N02": "Prime factorisation",
    "AC9M7N03": "Expanded notation",
    "AC9M7N04": "Equivalent rational numbers",
}


def _answers(prefix, topic, count):
    return _evidence(*[(f"{prefix}-q{index}", [topic], True) for index in range(count)])


def _finish_core(**overrides):
    """Answer every core step right, so today's plan is complete."""
    stats = dict(overrides.pop("task_stats", {}) or {})
    for task in _plan(**overrides, task_stats=stats)["tasks"]:
        count = FOCUS_MAX_QUESTIONS if task["kind"] == "focus" else max(1, task["question_target"])
        stats[task["id"]] = _answers(task["kind"], task["topic_ids"][0], min(count, 4))
    return _plan(**overrides, task_stats=stats), stats


def test_new_topic_step_offers_every_topic_of_the_year_until_the_first_answer():
    plan = _plan(topic_facts=FACTS, topic_names=NAMES)

    focus = _task(plan, "focus")
    options = {option["topic_id"]: option for option in focus["topic_options"]}
    assert list(options) == ["AC9M7N01", "AC9M7N02", "AC9M7N04", "AC9M7N03"]
    assert [option["recommended"] for option in focus["topic_options"]] == [True, False, False, False]
    assert options["AC9M7N03"]["mastered"] is True
    assert options["AC9M7N02"]["missing_prerequisites"] == ["AC9M7N01"]
    assert options["AC9M7N02"]["missing_prerequisite_names"] == ["Squares and square roots"]
    chosen = options["AC9M7N02"]
    assert chosen["kind"] == "focus"
    assert chosen["id"] != focus["id"]
    assert chosen["href"].startswith("/today/practice?")
    assert chosen["topic_names"] == ["Prime factorisation"]

    # The first answer on a chosen topic fixes the new topic for the day.
    started = _plan(topic_facts=FACTS, task_stats={chosen["id"]: _answers("pick", "AC9M7N02", 1)})
    focus = _task(started, "focus")
    assert focus["topic_id"] == "AC9M7N02"
    assert not focus.get("topic_options")


def test_final_check_opens_only_after_the_other_steps():
    plan = _plan()
    assert _task(plan, "exit")["locked"] is True

    focus = _task(plan, "focus")
    done = _plan(task_stats={focus["id"]: _answers("focus", "AC9M7N01", 4)})
    assert _task(done, "focus")["completed"] is True
    assert _task(done, "exit")["locked"] is False


def test_more_practice_appears_only_after_the_day_is_done():
    assert not _plan(topic_facts=FACTS).get("more_practice")

    plan, _ = _finish_core(topic_facts=FACTS, topic_names=NAMES)

    assert plan["complete"] is True
    extra, mixed = plan["more_practice"]
    # N02 still needs today's topic, so the next topic is N04.
    assert extra["kind"] == "extra"
    assert extra["topic_id"] == "AC9M7N04"
    assert [option["topic_id"] for option in extra["topic_options"]] == ["AC9M7N02", "AC9M7N04", "AC9M7N03"]
    assert mixed["kind"] == "mixed"
    assert mixed["topic_ids"] == ["AC9M7N01"]
    # One topic is not mixed: the step says so.
    assert mixed["title"] == "More questions on today’s topic"
    assert mixed["question_target"] == 4
    assert mixed["completed"] is False
    # More practice does not change the day's result.
    assert plan["total_tasks"] == len(plan["tasks"])


def test_only_one_more_topic_a_day_and_mixed_practice_has_rounds():
    plan, stats = _finish_core(topic_facts=FACTS)
    extra = plan["more_practice"][0]
    stats[extra["id"]] = _answers("extra", "AC9M7N04", 4)

    later = _plan(topic_facts=FACTS, task_stats=stats)
    extra, mixed = later["more_practice"]
    assert extra["topic_id"] == "AC9M7N04"
    assert extra["completed"] is True
    assert not extra.get("topic_options")
    assert mixed["topic_ids"] == ["AC9M7N01", "AC9M7N04"]
    assert mixed["title"] == "Mixed practice"

    stats[mixed["id"]] = _answers("mixed", "AC9M7N01", 4)
    after_round = _plan(topic_facts=FACTS, task_stats=stats)["more_practice"][1]
    assert after_round["question_completed"] == 4
    assert after_round["question_target"] == 8
    assert after_round["completed"] is False


def test_step_time_uses_the_minutes_per_question_of_each_topic():
    plan = _plan(question_minutes={"AC9M7N01": 4.0})

    assert _task(plan, "focus")["estimated_minutes"] == 6 * 4
    assert _task(plan, "exit")["estimated_minutes"] == 2 * 4


def test_senior_units_get_more_time_per_question_by_default():
    plan = _plan(
        scope="unit1",
        syllabus_subject="methods",
        recommendation={"recommendation_type": "senior_scope"},
        progress=[_row("QCAA_METHODS_U1_T2", "not_started", None, 0)],
        forward_topic="QCAA_METHODS_U1_T2",
    )

    assert _task(plan, "focus")["estimated_minutes"] == 4 + 6 * 4
    assert _task(plan, "exit")["estimated_minutes"] == 2 * 4


def test_today_plan_endpoint_offers_the_year_topics_and_bank_based_time(tmp_data_dir, monkeypatch):
    engine = _fresh_engine(tmp_data_dir, "today-choice-student")
    monkeypatch.setattr(tutor, "get_engine", lambda *_args: engine)
    sequence = engine._loader.load_slice("AC9_MATHS", 7).sequence.sequence
    _seed_due_review(engine, sequence[0])

    plan = tutor.get_today_plan(subject="math", year="year7", student_id=engine.student_id)

    focus = _task(plan, "focus")
    assert [option["topic_id"] for option in focus["topic_options"]] == list(sequence)
    assert [option["topic_id"] for option in focus["topic_options"] if option["recommended"]] == [focus["topic_id"]]
    # The bank mixes question types, so a question takes more than the old flat 2 minutes.
    assert focus["estimated_minutes"] > 4 + 6 * 2


# ---------------------------------------------------------------------------
# A right answer that the student marked "guess" is not a right answer
# ---------------------------------------------------------------------------


def test_today_attempt_stats_do_not_count_a_guessed_right_answer(tmp_data_dir):
    engine = _fresh_engine(tmp_data_dir, "today-guess-student")
    task_id = "today|2026-08-01|math|year7|focus|AC9M7N01"
    engine.log_attempt("AC9M7N01", "q-sure", True, student_answer="4", today_task_id=task_id, support_level=0)
    engine.log_attempt(
        "AC9M7N01", "q-guess", True, student_answer="4", today_task_id=task_id,
        support_level=0, confidence="guess",
    )

    stats = engine.get_today_plan_attempt_stats(
        "2000-01-01T00:00:00+00:00", "2100-01-01T00:00:00+00:00"
    )[task_id]

    rows = {row["question_id"]: row for row in stats["ordered_evidence"]}
    assert rows["q-sure"]["independent_correct"] is True
    assert rows["q-guess"]["independent_correct"] is False
    assert rows["q-guess"]["supported_correct"] is False
    # A guess is still an answered question.
    assert stats["attempted"] == 2


def _mistake_with_cause(engine) -> None:
    engine.log_attempt("AC9M7N02", "source-q", False, error_type="concept_gap", student_answer="wrong")
    engine.update_latest_incorrect_attempt_metadata(
        "source-q",
        {"error_cause": "concept_gap", "cause_recorded_at": datetime.now(timezone.utc).isoformat()},
        topics=["AC9M7N02"],
    )


def test_a_guessed_right_retry_does_not_fix_a_mistake(tmp_data_dir):
    engine = _fresh_engine(tmp_data_dir)
    _mistake_with_cause(engine)

    engine.log_attempt(
        "AC9M7N02", "source-q", True, student_answer="right", support_level=0, confidence="guess",
    )
    assert engine.get_mistake_state("source-q")["closure_stage"] == "needs_retry"

    engine.log_attempt("AC9M7N02", "source-q", True, student_answer="right", support_level=0)
    assert engine.get_mistake_state("source-q")["closure_stage"] == "needs_transfer"


def test_a_guessed_right_transfer_answer_does_not_advance_the_mistake(tmp_data_dir, monkeypatch):
    from fastapi import HTTPException

    engine = _fresh_engine(tmp_data_dir)
    monkeypatch.setattr(tutor, "get_engine", lambda *_args: engine)
    _mistake_with_cause(engine)
    engine.log_attempt("AC9M7N02", "source-q", True, student_answer="corrected original", support_level=0)
    engine.log_attempt(
        "AC9M7N02", "transfer-q", True, student_answer="guessed", first_attempt=True, confidence="guess",
        review_source="error_book", review_question_id="source-q", review_match={"eligible": True},
    )

    request = tutor.MistakeResolveRequest(
        subject="math", question_id="source-q", topic_id="AC9M7N02",
        resolved=True, resolution_source="demonstrated_correction", year_level=7,
    )
    with pytest.raises(HTTPException) as refused:
        tutor.resolve_mistake_review(request, student_id=engine.student_id)
    assert refused.value.status_code == 409
    assert engine.get_mistake_state("source-q")["closure_stage"] == "needs_transfer"
