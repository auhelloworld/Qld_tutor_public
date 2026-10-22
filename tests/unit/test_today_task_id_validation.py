"""Today task IDs are checked against the question that is marked."""

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from backend.tutor_engine import _validated_today_task_id

QUESTION = {"subject": "math", "year_level": 7, "topic_ids": ["AC9M7N01"]}


def _task_id(kind: str, target: str) -> str:
    today = datetime.now(ZoneInfo("Australia/Brisbane")).date().isoformat()
    return f"today|{today}|math|year7|{kind}|{target}"


def _validate(task_id: str) -> str | None:
    return _validated_today_task_id(task_id, "q-1", QUESTION, review_source=None, review_question_id=None)


@pytest.mark.parametrize("kind,target", [("extra", "AC9M7N01"), ("mixed", "AC9M7N02,AC9M7N01")])
def test_more_practice_steps_accept_questions_on_their_topics(kind, target):
    task_id = _task_id(kind, target)

    assert _validate(task_id) == task_id


@pytest.mark.parametrize("kind", ["extra", "mixed"])
def test_more_practice_steps_reject_questions_on_other_topics(kind):
    assert _validate(_task_id(kind, "AC9M7N05")) is None
