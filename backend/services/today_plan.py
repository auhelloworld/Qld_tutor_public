"""Compose a deterministic daily self-study session from existing evidence.

Order: repair past mistakes, review due topics from memory, learn or practise
the next topic, then a short final check with no help. Each step stops on
evidence, not on a fixed number of questions, so a student who shows the skill
early does less work. The student may do the steps in any order; the final
check opens last. After the day is done, optional "more practice" steps follow:
one more new topic a day and rounds of mixed practice.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import date, datetime
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

from backend.services.today_topics import TopicFacts, default_question_minutes


MAX_SESSION_TOPICS = 3
MAX_MISTAKE_TASKS = 3
MAX_REVISION_TOPICS = 3
# A review topic is done after one right answer from memory, or after two answers.
REVIEW_QUESTIONS_PER_TOPIC = 2
# Mean answers per review topic, for the time estimate.
REVIEW_EXPECTED_ANSWERS = 1.5
# The topic step is done when 3 of the last 4 answers are right on the first
# try with no help (at least 4 answers), or after 10 answers.
FOCUS_MIN_QUESTIONS = 4
FOCUS_MAX_QUESTIONS = 10
FOCUS_WINDOW = 4
FOCUS_WINDOW_CORRECT = 3
FOCUS_EXPECTED_QUESTIONS = 6
EXIT_QUESTION_TARGET = 2
LEARN_STEP_MINUTES = 4
REFLECTION_MINUTES = 2
DIAGNOSTIC_DEFAULT_QUESTIONS = 15
# Mixed practice after the day is done: rounds of questions on today's topics.
MIXED_ROUND_QUESTIONS = 4
MAX_MIXED_TOPICS = 4

_STAGE_TITLES = {
    "needs_understanding": "Find out why an answer was wrong",
    "needs_retry": "Try a past mistake again on your own",
    "needs_transfer": "Show you can fix it on a new question",
    "needs_consolidation": "Check an old mistake is still fixed",
}
_STAGE_REASONS = {
    "needs_understanding": "Choose what went wrong. This step has no questions.",
    "needs_retry": "Answer the same question again, with no help.",
    "needs_transfer": "Answer a new question on the same idea.",
    "needs_consolidation": "A few days have passed. Answer one question with no help.",
}
_STAGE_PRIORITY = {
    "needs_consolidation": 0,
    "needs_transfer": 1,
    "needs_retry": 2,
    "needs_understanding": 3,
}
_QUESTION_STAGES = {"needs_retry", "needs_transfer", "needs_consolidation"}
_TODAY_EVENT_STAGES = (
    ("closed_at", "needs_consolidation"),
    ("transfer_correct_at", "needs_transfer"),
    ("retry_correct_at", "needs_retry"),
    ("cause_recorded_at", "needs_understanding"),
)


def _task_id(day: date, subject: str, scope: str, kind: str, target: str) -> str:
    return "|".join(("today", day.isoformat(), subject, scope, kind, target))


def _prior_target(task_ids, prefix: str) -> str | None:
    """Target of a task of this kind that already has answers today."""
    for task_id in sorted(task_ids):
        if task_id.startswith(prefix):
            target = task_id[len(prefix):]
            if target:
                return target
    return None


def _is_on_day(value: str | None, day: date) -> bool:
    if not value:
        return False
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(
            ZoneInfo("Australia/Brisbane")
        ).date() == day
    except ValueError:
        return False


def _is_due(value: str | None, now: datetime) -> bool:
    if not value:
        return False
    try:
        due = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if due.tzinfo is None:
            due = due.replace(tzinfo=ZoneInfo("Australia/Brisbane"))
        return due <= now
    except ValueError:
        return False


def _today_action_stage(row: dict, day: date) -> str | None:
    """Return the furthest closure action evidenced today for a stable task."""
    for field, stage in _TODAY_EVENT_STAGES:
        if _is_on_day(row.get(field), day):
            return stage
    return None


def _scope_query(subject: str, scope: str) -> dict[str, str]:
    query = {"subject": subject}
    if scope.startswith("unit"):
        query["unit"] = scope.removeprefix("unit")
    else:
        query["year"] = scope
    return query


def _today_practice_href(
    *,
    subject: str,
    scope: str,
    task_id: str,
    syllabus_subject: str | None = None,
) -> str:
    """Link to the one Today practice page. The page reads the step from the plan."""
    query = {**_scope_query(subject, scope), "today_task": task_id}
    if syllabus_subject:
        query["syllabus_subject"] = syllabus_subject
    return "/today/practice?" + urlencode(query)


def _is_new_today(row: dict, day: date) -> bool:
    """True for a mistake first made today that has no work on it yet.

    A wrong answer today does not add work today: the mistake waits for
    tomorrow's plan. A mistake that already has a cause or a retry stays.
    """
    return (
        str(row.get("closure_stage") or "needs_understanding") == "needs_understanding"
        and not row.get("cause_recorded_at")
        and _is_on_day(row.get("last_incorrect_at"), day)
    )


def _use_guided(progress: list[dict], topic_id: str) -> bool:
    item = next((row for row in progress if str(row.get("topic")) == topic_id), None)
    if not item:
        return True
    status = str(item.get("status") or "not_started")
    mastery = item.get("bkt_mastery")
    direct = int(item.get("direct_attempts_count") or 0)
    return status in {"not_started", "emerging"} or mastery is None or float(mastery) < 0.5 or direct < 2


def _mistake_priority(row: dict) -> tuple[int, int]:
    stage = str(row.get("closure_stage") or "needs_understanding")
    attempts = int(row.get("attempt_count") or row.get("repeat_count") or 0)
    return (_STAGE_PRIORITY.get(stage, 9), -attempts)


def _ordered_evidence(task_stats: dict[str, dict], task_id: str) -> list[dict]:
    """Answers owned by one task, in first-answer order."""
    return list(((task_stats.get(task_id) or {}).get("ordered_evidence")) or [])


def _count(rows: list[dict], key: str) -> int:
    return sum(1 for row in rows if row.get(key))


def _finalise_plan(
    *,
    day: date,
    subject: str,
    scope: str,
    tasks: list[dict],
    goal: str | None,
    next_review_at: str | None = None,
    more_practice: list[dict] | None = None,
) -> dict:
    completed_tasks = sum(1 for task in tasks if task["completed"])
    first_pending = next((task for task in tasks if not task["completed"]), None)
    complete = bool(tasks) and completed_tasks == len(tasks)
    gate_task = next((task for task in tasks if task["kind"] in {"exit", "diagnostic"}), None)
    if gate_task is not None:
        evidence_gate = bool(gate_task.get("independent_secured"))
    else:
        evidence_gate = all(task.get("independent_secured") for task in tasks)
    return {
        "session_id": f"{day.isoformat()}:{subject}:{scope}",
        "date": day.isoformat(),
        "subject": subject,
        "scope": scope,
        "goal": goal,
        "estimated_minutes": sum(int(task["estimated_minutes"]) for task in tasks),
        "remaining_minutes": sum(
            int(task["remaining_minutes"]) for task in tasks if not task["completed"]
        ),
        "question_completed": sum(int(task.get("question_completed") or 0) for task in tasks),
        "completed_tasks": completed_tasks,
        "total_tasks": len(tasks),
        "complete": complete,
        "independent_secured": complete and evidence_gate,
        "next_review_at": next_review_at,
        "next_task_id": first_pending["id"] if first_pending else None,
        "next_href": first_pending["href"] if first_pending else None,
        "tasks": tasks,
        # Optional steps after the day is done. They do not change the day's result.
        "more_practice": more_practice or [],
    }


@dataclass(frozen=True)
class _StepContext:
    """What every Today step builder needs."""

    day: date
    subject: str
    scope: str
    syllabus_subject: str | None
    stats: Mapping[str, dict]
    progress: list[dict]
    criteria: Mapping[str, str]
    names: Mapping[str, str]
    minutes_for: Callable[[str | None], float]

    def task_id(self, kind: str, target: str) -> str:
        return _task_id(self.day, self.subject, self.scope, kind, target)

    def href(self, task_id: str) -> str:
        return _today_practice_href(
            subject=self.subject,
            scope=self.scope,
            task_id=task_id,
            syllabus_subject=self.syllabus_subject,
        )

    def name(self, topic_id: str) -> str:
        return self.names.get(topic_id) or topic_id


_TOPIC_STEP_TITLES = {
    "focus": ("Learn something new", "Practise on your own"),
    "extra": ("Learn one more topic", "Practise one more topic"),
}


def _topic_step(ctx: _StepContext, kind: str, topic_id: str) -> dict:
    """A one-topic step: the day's new topic ("focus") or one more topic ("extra")."""
    task_id = ctx.task_id(kind, topic_id)
    answers = _ordered_evidence(ctx.stats, task_id)[:FOCUS_MAX_QUESTIONS]
    # A started step keeps its mode for the day: answers today must not
    # switch its help rule or its title.
    guided = bool(answers[0].get("guided")) if answers else _use_guided(ctx.progress, topic_id)
    answered = len(answers)
    window = answers[-FOCUS_WINDOW:]
    criterion_met = (
        answered >= FOCUS_MIN_QUESTIONS
        and _count(window, "independent_correct") >= FOCUS_WINDOW_CORRECT
    )
    completed = criterion_met or answered >= FOCUS_MAX_QUESTIONS
    learn_step = guided and answered == 0
    if answered < FOCUS_EXPECTED_QUESTIONS:
        questions_left = FOCUS_EXPECTED_QUESTIONS - answered
    else:
        questions_left = min(2, FOCUS_MAX_QUESTIONS - answered)
    minutes = ctx.minutes_for(topic_id)
    stop_rule = "Practise until you get 3 of 4 right on your own (at most 10 questions)."
    guided_title, independent_title = _TOPIC_STEP_TITLES[kind]
    return {
        "id": task_id,
        "kind": kind,
        "title": guided_title if guided else independent_title,
        "reason": (
            f"Read a short lesson and an example first. Then {stop_rule[0].lower()}{stop_rule[1:]}"
            if guided
            else stop_rule
        ),
        "estimated_minutes": (LEARN_STEP_MINUTES if guided else 0) + math.ceil(minutes * FOCUS_EXPECTED_QUESTIONS),
        "remaining_minutes": (
            0 if completed
            else (LEARN_STEP_MINUTES if learn_step else 0) + math.ceil(minutes * questions_left)
        ),
        "question_target": FOCUS_MAX_QUESTIONS,
        "question_completed": answered,
        "independent_correct_count": _count(answers, "independent_correct"),
        "completed": completed,
        "supported_progress": completed and _count(window, "supported_correct") >= FOCUS_WINDOW_CORRECT,
        "independent_secured": criterion_met,
        "learn_step": learn_step,
        "success_criterion": ctx.criteria.get(topic_id),
        "href": ctx.href(task_id),
        "topic_id": topic_id,
        "topic_ids": [topic_id],
        "topic_names": [ctx.name(topic_id)],
        "question_id": None,
        "practice_mode": "guided" if guided else "independent",
    }


def _topic_options(
    ctx: _StepContext,
    facts: TopicFacts,
    kind: str,
    *,
    recommended: str | None,
    exclude: str | None = None,
) -> list[dict]:
    """Every topic of the scope, in teaching order, as a step to choose instead.

    A topic with open prerequisites can be chosen too; the step names them.
    """
    options = []
    for topic_id in facts.order:
        if topic_id == exclude:
            continue
        missing = facts.missing_prerequisites(topic_id)
        options.append({
            **_topic_step(ctx, kind, topic_id),
            "recommended": topic_id == recommended,
            "mastered": topic_id in facts.mastered,
            "missing_prerequisites": missing,
            "missing_prerequisite_names": [ctx.name(prerequisite) for prerequisite in missing],
        })
    return options


def _mixed_step(ctx: _StepContext, topics: list[str]) -> dict:
    """Rounds of questions on today's topics, mixed together. It has no end."""
    task_id = ctx.task_id("mixed", ",".join(topics))
    answers = _ordered_evidence(ctx.stats, task_id)
    answered = len(answers)
    left = MIXED_ROUND_QUESTIONS - answered % MIXED_ROUND_QUESTIONS
    minutes = sum(ctx.minutes_for(topic) for topic in topics) / len(topics)
    single = len(topics) == 1
    return {
        "id": task_id,
        "kind": "mixed",
        "title": "More questions on today’s topic" if single else "Mixed practice",
        "reason": (
            f"{'More questions on today’s topic' if single else 'Questions on today’s topics, mixed together'}. "
            f"A round is {MIXED_ROUND_QUESTIONS} questions. Stop when you like."
        ),
        "estimated_minutes": math.ceil(minutes * MIXED_ROUND_QUESTIONS),
        "remaining_minutes": math.ceil(minutes * left),
        "question_target": answered + left,
        "question_completed": answered,
        "independent_correct_count": _count(answers, "independent_correct"),
        "completed": False,
        "supported_progress": False,
        "independent_secured": False,
        "href": ctx.href(task_id),
        "topic_id": topics[0],
        "topic_ids": topics,
        "topic_names": [ctx.name(topic) for topic in topics],
        "question_id": None,
        "practice_mode": "independent",
    }


def _more_practice(
    ctx: _StepContext,
    facts: TopicFacts | None,
    prefix_base: str,
    focus_topic: str | None,
    study_topics: list[str],
) -> list[dict]:
    """Steps after the day is done: one more topic a day, then mixed rounds."""
    steps = []
    extra_topic = _prior_target(ctx.stats, prefix_base + "extra|")
    if extra_topic:
        # One more topic a day: a started extra topic stays, also when it is done.
        steps.append(_topic_step(ctx, "extra", extra_topic))
    elif facts:
        candidate = facts.next_topic(exclude=[focus_topic] if focus_topic else []) or next(
            (topic for topic in facts.order if topic != focus_topic), None
        )
        if candidate:
            step = _topic_step(ctx, "extra", candidate)
            step["topic_options"] = _topic_options(ctx, facts, "extra", recommended=candidate, exclude=focus_topic)
            steps.append(step)

    prior_mixed = _prior_target(ctx.stats, prefix_base + "mixed|")
    if prior_mixed:
        mixed_topics = [topic for topic in prior_mixed.split(",") if topic]
    else:
        today_topics = [*study_topics, *([extra_topic] if extra_topic else [])]
        mixed_topics = list(dict.fromkeys(today_topics))[:MAX_MIXED_TOPICS]
    if mixed_topics:
        steps.append(_mixed_step(ctx, mixed_topics))
    return steps


def _diagnostic_task(day: date, subject: str, scope: str, diagnostic: dict, minutes_per_question: float) -> dict:
    diagnostic_completed = _is_on_day(diagnostic.get("completed_at"), day)
    question_target = max(1, int(diagnostic.get("question_target") or DIAGNOSTIC_DEFAULT_QUESTIONS))
    question_completed = max(0, int(diagnostic.get("question_completed") or 0))
    if diagnostic_completed:
        question_completed = question_completed or question_target
        question_target = min(question_target, question_completed)
    question_completed = min(question_target, question_completed)
    secured = diagnostic_completed and diagnostic.get("valid_completion") is not False
    return {
        "id": _task_id(day, subject, scope, "diagnostic", "assessment"),
        "kind": "diagnostic",
        "title": "Review today’s diagnostic results" if diagnostic_completed else "Complete today’s diagnostic",
        "reason": (
            "The diagnostic is today’s whole session. No other practice is added."
            if diagnostic_completed
            else "Answer a short set of questions. They show the tutor where you should start."
        ),
        "estimated_minutes": math.ceil(minutes_per_question * question_target),
        "remaining_minutes": (
            0 if diagnostic_completed
            else math.ceil(minutes_per_question * (question_target - question_completed))
        ),
        "question_target": question_target,
        "question_completed": question_completed,
        "independent_correct_count": int(secured),
        "completed": diagnostic_completed,
        "supported_progress": secured,
        "independent_secured": secured,
        "href": "/diagnostic?" + urlencode(_scope_query(subject, scope)),
        "topic_id": None,
        "topic_ids": [],
        "question_id": None,
    }


def build_today_plan(
    *,
    day: date,
    subject: str,
    scope: str,
    recommendation: dict,
    progress: list[dict],
    mistake_rows: list[dict],
    task_stats: dict[str, dict] | None = None,
    due_revision_topics: list[str] | None = None,
    forward_topic: str | None = None,
    diagnostic_status: dict | None = None,
    syllabus_subject: str | None = None,
    now: datetime | None = None,
    topic_names: dict[str, str] | None = None,
    success_criteria: dict[str, str] | None = None,
    next_review_at: str | None = None,
    topic_facts: TopicFacts | None = None,
    question_minutes: Mapping[str, float] | None = None,
) -> dict:
    """Build today's session: repair, review, learn the next topic, final check.

    ``forward_topic`` is the next topic in teaching order. It gets a place in
    the session even on days with mistakes and due reviews, so new learning
    happens every day. ``topic_facts`` lists the scope's topics, so the student
    can choose another new topic before the first answer. ``question_minutes``
    gives the mean minutes per question of each topic; other topics use the
    default for the study stage.
    """
    stats = task_stats or {}
    names_by_topic = topic_names or {}
    criteria = success_criteria or {}
    default_minutes = default_question_minutes(scope)
    minutes_by_topic = question_minutes or {}

    def minutes_for(topic_id: str | None) -> float:
        return float(minutes_by_topic.get(topic_id or "", default_minutes))

    ctx = _StepContext(
        day=day,
        subject=subject,
        scope=scope,
        syllabus_subject=syllabus_subject,
        stats=stats,
        progress=progress,
        criteria=criteria,
        names=names_by_topic,
        minutes_for=minutes_for,
    )

    def add_topic_names(planned: list[dict]) -> list[dict]:
        # Students see curriculum names; unknown topics fall back to their ID.
        for planned_task in planned:
            planned_task["topic_names"] = [
                names_by_topic.get(topic_id) or topic_id
                for topic_id in planned_task.get("topic_ids") or []
            ]
        return planned

    effective_now = now or datetime.now(ZoneInfo("Australia/Brisbane"))
    prefix_base = f"today|{day.isoformat()}|{subject}|{scope}|"
    rec_type = str(recommendation.get("recommendation_type") or "")
    rec_topic = recommendation.get("topic_id") or recommendation.get("topic")

    diagnostic = diagnostic_status or {}
    # "Don't remind me" pauses an unfinished run without locking Today to it.
    diagnostic_in_progress = bool(
        diagnostic.get("report_id")
        and not diagnostic.get("completed_at")
        and not diagnostic.get("diagnostic_dismissed_at")
    )
    if (
        rec_type == "diagnostic_prompt"
        or diagnostic_in_progress
        or _is_on_day(diagnostic.get("completed_at"), day)
    ):
        return _finalise_plan(
            day=day,
            subject=subject,
            scope=scope,
            tasks=add_topic_names([_diagnostic_task(day, subject, scope, diagnostic, default_minutes)]),
            goal=None,
            next_review_at=next_review_at,
        )

    tasks: list[dict] = []
    used_topics: set[str] = set()
    study_topics: list[str] = []

    def use_topic(topic_id: str | None) -> None:
        if topic_id:
            used_topics.add(topic_id)
            if topic_id not in study_topics:
                study_topics.append(topic_id)

    attempt_owner_by_question: dict[str, str] = {}
    for owner_task_id, raw_stats in stats.items():
        for attempted_question_id in raw_stats.get("attempted_question_ids") or []:
            attempt_owner_by_question.setdefault(str(attempted_question_id), str(owner_task_id))

    # A step started today keeps its topic for the rest of the day.
    prior_focus = _prior_target(stats, prefix_base + "focus|")
    planned_focus = prior_focus or forward_topic
    if prior_focus:
        use_topic(prior_focus)

    def has_room(topic_id: str) -> bool:
        """Keep one of the session's topics for the new topic."""
        if topic_id in used_topics:
            return True
        reserved = 1 if planned_focus and planned_focus not in used_topics and topic_id != planned_focus else 0
        return len(used_topics) + reserved < MAX_SESSION_TOPICS

    # --- 1. Past mistakes -------------------------------------------------
    active_rows = [
        row
        for row in mistake_rows
        if not row.get("resolved")
        and (
            str(row.get("closure_stage") or "needs_understanding") != "needs_consolidation"
            or _is_due(row.get("consolidation_due_at"), effective_now)
        )
    ]
    progressed_today = [row for row in mistake_rows if _today_action_stage(row, day) is not None]
    progressed_ids = {str(row.get("question_id") or "") for row in progressed_today}
    pending_rows = sorted(
        (
            row for row in active_rows
            if str(row.get("question_id") or "") not in progressed_ids and not _is_new_today(row, day)
        ),
        key=_mistake_priority,
    )
    selected_mistakes: list[dict] = []
    for row in sorted(progressed_today, key=_mistake_priority) + pending_rows:
        topic_id = str(row.get("topic_id") or "")
        if topic_id and not has_room(topic_id):
            continue
        selected_mistakes.append(row)
        use_topic(topic_id or None)
        if len(selected_mistakes) >= MAX_MISTAKE_TASKS:
            break

    for row in selected_mistakes:
        question_id = str(row.get("question_id") or "")
        topic_id = str(row.get("topic_id") or "")
        current_stage = str(row.get("closure_stage") or "needs_understanding")
        action_stage = _today_action_stage(row, day) or current_stage
        completed_by_closure = question_id in progressed_ids
        task_id = _task_id(day, subject, scope, "mistake", question_id)
        owner_task_id = attempt_owner_by_question.get(question_id)
        # Closure can come from an answer already owned by a focus or review
        # step. Keep the Error Book step complete, but do not count that same
        # question twice.
        closure_owned_elsewhere = bool(completed_by_closure and owner_task_id and owner_task_id != task_id)
        question_target = 0 if closure_owned_elsewhere else (1 if action_stage in _QUESTION_STAGES else 0)
        answers = _ordered_evidence(stats, task_id)[:question_target]
        completed = completed_by_closure or (question_target > 0 and bool(answers))
        independent = question_target if completed_by_closure else _count(answers, "independent_correct")
        supported = question_target if completed_by_closure else _count(answers, "supported_correct")
        minutes = math.ceil(minutes_for(topic_id) + 1) if question_target else REFLECTION_MINUTES
        tasks.append({
            "id": task_id,
            "kind": "mistake",
            "title": _STAGE_TITLES.get(action_stage, "Work on a past mistake"),
            "reason": _STAGE_REASONS.get(action_stage, "Work on a mistake from your Error Book."),
            "estimated_minutes": minutes,
            "remaining_minutes": 0 if completed else minutes,
            "question_target": question_target,
            "question_completed": question_target if completed else 0,
            "independent_correct_count": independent,
            "completed": completed,
            "supported_progress": completed and supported >= question_target,
            "independent_secured": completed and independent >= question_target,
            # Every step runs on the one Today practice page, also the cause step.
            "href": ctx.href(task_id),
            "topic_id": topic_id,
            "topic_ids": [topic_id] if topic_id else [],
            "question_id": question_id,
            "practice_mode": "independent",
            "closure_stage": action_stage,
            "consolidation_due_at": row.get("consolidation_due_at"),
        })

    # --- 2. Review due topics from memory ---------------------------------
    prior_revision = _prior_target(stats, prefix_base + "revision|")
    if prior_revision:
        revision_topics = [topic for topic in prior_revision.split(",") if topic][:MAX_REVISION_TOPICS]
    else:
        candidates: list[str] = []
        for topic in [*(due_revision_topics or []), rec_topic if rec_type == "revision" else None]:
            if topic and str(topic) not in candidates:
                candidates.append(str(topic))
        # Topics already in the session come first; new ones need a free slot.
        revision_topics = [topic for topic in candidates if topic in used_topics]
        for topic in candidates:
            if len(revision_topics) >= MAX_REVISION_TOPICS:
                break
            if topic not in revision_topics and has_room(topic):
                revision_topics.append(topic)
                used_topics.add(topic)
        revision_topics = revision_topics[:MAX_REVISION_TOPICS]
    for topic in revision_topics:
        use_topic(topic)

    if revision_topics:
        task_id = _task_id(day, subject, scope, "revision", ",".join(revision_topics))
        answers = _ordered_evidence(stats, task_id)
        topic_progress = []
        first_from_memory = True
        supported_each = True
        for topic in revision_topics:
            topic_answers = [row for row in answers if topic in (row.get("topics") or [])]
            topic_progress.append({
                "topic_id": topic,
                "answered": min(REVIEW_QUESTIONS_PER_TOPIC, len(topic_answers)),
                "done": (
                    len(topic_answers) >= REVIEW_QUESTIONS_PER_TOPIC
                    or any(row.get("independent_correct") for row in topic_answers)
                ),
            })
            first_from_memory = first_from_memory and bool(
                topic_answers and topic_answers[0].get("independent_correct")
            )
            supported_each = supported_each and any(row.get("supported_correct") for row in topic_answers)
        open_topics = [item for item in topic_progress if not item["done"]]
        completed = not open_topics
        question_target = REVIEW_QUESTIONS_PER_TOPIC * len(revision_topics)
        # Only a revision recommendation explains these topics. A forward
        # recommendation's reason is about a different, new topic.
        revision_reason = (
            str(recommendation.get("reason"))
            if rec_type == "revision"
            and rec_topic
            and str(rec_topic) in revision_topics
            and recommendation.get("reason")
            else (
                "Answer from memory first. Help opens after your first answer."
            )
        )
        tasks.append({
            "id": task_id,
            "kind": "revision",
            "title": "Review topics that are due" if len(revision_topics) > 1 else "Review a topic that is due",
            "reason": revision_reason,
            "estimated_minutes": math.ceil(
                sum(REVIEW_EXPECTED_ANSWERS * minutes_for(topic) for topic in revision_topics)
            ),
            "remaining_minutes": math.ceil(sum(
                (REVIEW_EXPECTED_ANSWERS if item["answered"] == 0 else 1) * minutes_for(item["topic_id"])
                for item in open_topics
            )),
            "question_target": question_target,
            "question_completed": min(question_target, len(answers)),
            "independent_correct_count": _count(answers, "independent_correct"),
            "completed": completed,
            "supported_progress": completed and supported_each,
            "independent_secured": completed and first_from_memory,
            "topic_progress": topic_progress,
            "href": _today_practice_href(
                subject=subject,
                scope=scope,
                task_id=task_id,
                syllabus_subject=syllabus_subject,
            ),
            "topic_id": revision_topics[0],
            "topic_ids": revision_topics,
            "question_id": None,
            "practice_mode": "independent",
        })

    # --- 3. Learn or practise the next topic ------------------------------
    focus_topic = planned_focus if planned_focus and has_room(planned_focus) else None
    if focus_topic:
        use_topic(focus_topic)
        focus_task = _topic_step(ctx, "focus", focus_topic)
        # Until the first answer the student may choose any topic of the scope.
        if topic_facts and not prior_focus:
            focus_task["topic_options"] = _topic_options(ctx, topic_facts, "focus", recommended=focus_topic)
        tasks.append(focus_task)

    # --- 4. Final check: today's topic and one older topic, no help -------
    prior_exit = _prior_target(stats, prefix_base + "exit|")
    if prior_exit:
        exit_topics = [topic for topic in prior_exit.split(",") if topic][:EXIT_QUESTION_TARGET]
    else:
        ordered_topics = ([focus_topic] if focus_topic else []) + revision_topics + study_topics
        exit_topics = list(dict.fromkeys(topic for topic in ordered_topics if topic))[:EXIT_QUESTION_TARGET]
    if exit_topics:
        task_id = _task_id(day, subject, scope, "exit", ",".join(exit_topics))
        answers = _ordered_evidence(stats, task_id)[:EXIT_QUESTION_TARGET]
        answered = len(answers)
        completed = answered >= EXIT_QUESTION_TARGET
        independent = _count(answers, "independent_correct")
        # The final check asks its topics in turn.
        question_minutes_left = [
            minutes_for(exit_topics[index % len(exit_topics)])
            for index in range(answered, EXIT_QUESTION_TARGET)
        ]
        tasks.append({
            "id": task_id,
            "kind": "exit",
            "title": "Final check: 2 questions on your own",
            "reason": "No help on these 2 questions. A wrong answer does not add work today. It changes what you review next.",
            "estimated_minutes": math.ceil(sum(
                minutes_for(exit_topics[index % len(exit_topics)]) for index in range(EXIT_QUESTION_TARGET)
            )),
            "remaining_minutes": 0 if completed else math.ceil(sum(question_minutes_left)),
            "question_target": EXIT_QUESTION_TARGET,
            "question_completed": answered,
            "independent_correct_count": independent,
            "completed": completed,
            "supported_progress": completed and _count(answers, "supported_correct") >= EXIT_QUESTION_TARGET,
            "independent_secured": completed and independent >= EXIT_QUESTION_TARGET,
            # The student does the other steps in any order; the final check is last.
            "locked": any(not task["completed"] for task in tasks),
            "href": _today_practice_href(
                subject=subject,
                scope=scope,
                task_id=task_id,
                syllabus_subject=syllabus_subject,
            ),
            "topic_id": exit_topics[0],
            "topic_ids": exit_topics,
            "question_id": None,
            "practice_mode": "independent",
        })

    more_practice = (
        _more_practice(ctx, topic_facts, prefix_base, focus_topic, study_topics)
        if tasks and all(task["completed"] for task in tasks)
        else []
    )
    return _finalise_plan(
        day=day,
        subject=subject,
        scope=scope,
        tasks=add_topic_names(tasks),
        goal=criteria.get(focus_topic) if focus_topic else None,
        next_review_at=next_review_at,
        more_practice=more_practice,
    )
