from __future__ import annotations

import json

import threading
from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest

from backend.exam_simulator import ExamSimulator
from backend.content_authoring.concept_card_helper import _parse_json_object as parse_card_json_object
from backend.ingestion_v2 import _parse_json_object as parse_ingestion_json_object
from backend.routers.writing import align_and_validate_scores, _parse_writing_response
from backend.services.marking import strip_fences
from backend.tutor_engine import TutorEngine, _llm_health
from core.schema.dialogue_schema import DialogueLLMResult
from core.schema.tutor_schema import MarkResult, PSMTResult, ReasoningResult


VALID_STUDENT_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"


def _engine_with_failing_client() -> TutorEngine:
    engine = TutorEngine()
    client = MagicMock()
    client.chat.completions.create.side_effect = RuntimeError("API down")
    engine.client = client
    return engine


def _reset_health() -> None:
    _llm_health.last_success = None
    _llm_health.last_failure = None
    _llm_health.failure_exception = None


def _chat_response(content: str):
    response = MagicMock()
    choice = MagicMock()
    choice.message.content = content
    response.choices = [choice]
    return response


def test_call_llm_safe_records_failure_when_live_client_raises():
    _reset_health()
    engine = _engine_with_failing_client()
    fallback = MarkResult.fallback()

    result = engine._call_llm_safe(
        prompt="Return JSON",
        expected_schema=MarkResult,
        fallback=fallback,
        response_format={"type": "json_object"},
    )

    assert result is fallback
    assert _llm_health.last_failure is not None
    assert _llm_health.last_success is None
    assert _llm_health.failure_exception == "LLMCallError"


def test_call_llm_safe_repairs_malformed_live_json_before_fallback():
    _reset_health()
    engine = TutorEngine()
    client = MagicMock()
    client.chat.completions.create.side_effect = [
        _chat_response("The answer is correct. Feedback: Correct."),
        _chat_response('{"correct": "yes", "comment": "Correct."}'),
    ]
    engine.client = client
    fallback = MarkResult.fallback()

    result = engine._call_llm_safe(
        prompt="Grade this answer.",
        expected_schema=MarkResult,
        fallback=fallback,
        response_format={"type": "json_object"},
        temp=0,
        max_tokens=300,
    )

    assert result is not fallback
    assert result.is_correct is True
    assert result.feedback == "Correct."
    assert client.chat.completions.create.call_count == 2
    assert _llm_health.last_success is not None
    assert _llm_health.last_failure is None



def test_mark_result_repair_has_room_for_reasoning_provider_output():
    """Malformed MarkResult repair must not reuse the old 800-token ceiling."""
    _reset_health()
    engine = TutorEngine()
    client = MagicMock()
    client.chat.completions.create.side_effect = [
        _chat_response("not json"),
        _chat_response('{"is_correct": true, "feedback": "Correct."}'),
    ]
    engine.client = client
    fallback = MarkResult.fallback()

    result = engine._call_llm_safe(
        prompt="Grade this answer.",
        expected_schema=MarkResult,
        fallback=fallback,
        response_format={"type": "json_object"},
        max_tokens=800,
    )

    assert result.is_correct is True
    assert client.chat.completions.create.call_args_list[1].kwargs["max_tokens"] == 1600


def test_short_answer_mark_uses_expanded_json_budget(monkeypatch):
    """Short-answer JSON has enough room for local reasoning providers."""
    engine = TutorEngine()
    engine.client = MagicMock()
    captured = {}

    def _fake_safe(**kwargs):
        captured.update(kwargs)
        return MarkResult(is_correct=True, feedback="Correct.")

    monkeypatch.setattr(engine, "_call_llm_safe", _fake_safe)
    question = {
        "id": "sa_budget",
        "subject": "english",
        "question": "Explain the effect.",
        "answer": "It builds tension.",
        "topic_ids": ["AC9E7LE02"],
    }

    result = engine._mark_short_answer(question, "A plausible semantic response.", student_id=VALID_STUDENT_ID)

    assert result["is_correct"] is True
    assert captured["max_tokens"] == 1600

def test_call_llm_retries_text_only_for_openai_compatible_text_providers():
    engine = TutorEngine()
    client = MagicMock()
    client.chat.completions.create.side_effect = [
        RuntimeError("Invalid type for messages[0].content: expected a string"),
        _chat_response('{"is_correct": true, "feedback": "Accepted."}'),
    ]
    engine.client = client

    raw = engine._call_llm(
        "Return JSON.",
        response_format={"type": "json_object"},
        temp=0,
        raise_on_error=True,
    )

    assert raw == '{"is_correct": true, "feedback": "Accepted."}'
    assert client.chat.completions.create.call_count == 2
    first_messages = client.chat.completions.create.call_args_list[0].kwargs["messages"]
    second_messages = client.chat.completions.create.call_args_list[1].kwargs["messages"]
    assert isinstance(first_messages[-1]["content"], list)
    assert second_messages[-1]["content"] == "Return JSON."


def test_tutor_parser_strips_deepseek_think_blocks():
    raw = '<think>I should reason privately.</think>\n```json\n{"is_correct": true, "feedback": "Good."}\n```'
    assert strip_fences(raw) == '{"is_correct": true, "feedback": "Good."}'


def test_schema_field_aliases_reduce_provider_format_fallbacks():
    mark = MarkResult.model_validate({"correct": "yes", "comment": "Nice work."})
    assert mark.is_correct is True
    assert mark.feedback == "Nice work."

    numeric_mark = MarkResult.model_validate({"mark": 3, "comment": "Partial credit.", "is_correct": False})
    assert numeric_mark.is_correct is False
    assert numeric_mark.feedback == "Partial credit."

    with pytest.raises(Exception):
        MarkResult.model_validate({"correct": "the denominator should be 12", "comment": "This is the correct answer text."})

    reasoning = ReasoningResult.model_validate({
        "marks": "2",
        "max_marks": "3",
        "comment": "Mostly clear.",
        "criteria": [{"point": "Uses evidence", "achieved": "true"}],
    })
    assert reasoning.score == 2
    assert reasoning.max_score == 3
    assert reasoning.feedback == "Mostly clear."
    assert reasoning.key_points[0].text == "Uses evidence"
    assert reasoning.key_points[0].met is True

    fraction_score = ReasoningResult.model_validate({
        "score": "2/3",
        "max_score": "3",
        "feedback": "Partial.",
    })
    assert fraction_score.score == 2
    assert fraction_score.max_score == 3

    psmt = PSMTResult.model_validate({
        "feedback": "Revise the evaluation section.",
        "criteria_scores": {
            "formulate": None,
            "solve": None,
            "evaluate and verify": None,
            "communicate": 3,
        },
        "readiness": "developing",
        "gaps": ["evaluation"],
        "actions": ["Add limitations."],
    })
    assert psmt.mentor_feedback_markdown.startswith("Revise")
    assert psmt.criterion_scores.communicate == 3
    assert psmt.criterion_scores.evaluate_verify is None
    assert psmt.top_gaps == ["evaluation"]
    assert psmt.next_revision_actions == ["Add limitations."]

    dialogue = DialogueLLMResult.model_validate({"reply": "Try isolating the variable first."})
    assert dialogue.tutor_message.startswith("Try isolating")

    # Extra provider keys must not discard a valid dialogue reply (P1).
    dialogue_extra = DialogueLLMResult.model_validate({
        "tutor_message": "What operation undoes multiplication?",
        "confidence": 0.9,
        "suggested_actions": ["try_again"],
        "references_student_working": "yes",
    })
    assert "multiplication" in dialogue_extra.tutor_message
    assert dialogue_extra.references_student_working is True


def test_psmt_schema_rejects_missing_or_out_of_range_criteria():
    base = {
        "mentor_feedback_markdown": "Feedback.",
        "readiness_level": "developing",
        "top_gaps": [],
        "next_revision_actions": [],
        "safety_flags": [],
    }

    with pytest.raises(ValueError):
        PSMTResult.model_validate({
            **base,
            "criterion_scores": {"formulate": 3},
        })

    with pytest.raises(ValueError):
        PSMTResult.model_validate({
            **base,
            "criterion_scores": {
                "formulate": 6,
                "solve": None,
                "evaluate_verify": None,
                "communicate": 3,
            },
        })


@pytest.mark.parametrize(
    "initial_response",
    [
        "not JSON",
        json.dumps({
            "mentor_feedback_markdown": "Incomplete.",
            "criterion_scores": {"formulate": 3},
            "readiness_level": "developing",
        }),
    ],
)
def test_psmt_compact_reassessment_recovers_malformed_or_incomplete_initial_response(
    initial_response,
):
    engine = TutorEngine()
    engine.client = MagicMock()
    complete = {
        "mentor_feedback_markdown": "### Strengths\nClear purpose.\n### Gaps\nAdd validation.",
        "criterion_scores": {
            "formulate": 3,
            "solve": None,
            "evaluate_verify": None,
            "communicate": 3,
        },
        "readiness_level": "developing",
        "top_gaps": ["Add validation"],
        "next_revision_actions": ["Test one model output"],
        "safety_flags": [],
    }
    engine._call_llm = MagicMock(
        side_effect=[initial_response, json.dumps(complete)]
    )

    result = engine.check_psmt("math", "Formulate", "A sufficiently detailed draft.")

    assert result["llm_status"] == "live"
    assert result["structured_feedback"]["criterion_scores"] == complete["criterion_scores"]
    assert engine._call_llm.call_count == 2
    first_call, retry_call = engine._call_llm.call_args_list
    assert first_call.kwargs["max_tokens"] == 2000
    assert retry_call.kwargs["max_tokens"] == 1600
    assert retry_call.kwargs["temp"] == 0.0
    assert "compact formative QCAA PSMT re-assessment" in retry_call.args[0]


def test_psmt_compact_reassessment_still_incomplete_returns_unavailable():
    engine = TutorEngine()
    engine.client = MagicMock()
    incomplete = json.dumps({
        "mentor_feedback_markdown": "Incomplete.",
        "criterion_scores": {"formulate": 3},
        "readiness_level": "developing",
    })
    engine._call_llm = MagicMock(side_effect=[incomplete, incomplete])

    result = engine.check_psmt("math", "Formulate", "A sufficiently detailed draft.")

    assert result["llm_status"] == "unavailable"
    assert result["structured_feedback"]["criterion_scores"] == {
        "formulate": None,
        "solve": None,
        "evaluate_verify": None,
        "communicate": None,
    }
    assert engine._call_llm.call_count == 2
    assert "temporarily unavailable" in result["feedback"].lower()


def test_unparseable_is_correct_falls_back_to_parent_review(monkeypatch):
    """P1: is_correct='partial' must not silently mark wrong."""
    engine = TutorEngine()
    engine.client = MagicMock()
    question = {
        "id": "sa_partial",
        "subject": "english",
        "question": "Explain the effect.",
        "answer": "It builds tension.",
        "topic_ids": ["AC9E7LE02"],
    }

    def _fake_safe(**kwargs):
        # Simulate parser path: unparseable is_correct → schema fail → fallback object
        return kwargs["fallback"]

    monkeypatch.setattr(engine, "_call_llm_safe", _fake_safe)
    result = engine._mark_short_answer(
        question, "A plausible open answer that needs semantic grading.", student_id=VALID_STUDENT_ID
    )
    assert result["error_type"] == "parent_review_pending"
    assert result["is_correct"] is False


def test_unparseable_is_correct_rejects_schema():
    with pytest.raises(Exception):
        MarkResult.model_validate({"is_correct": "partial", "feedback": "Hmm."})
    with pytest.raises(Exception):
        MarkResult.model_validate({"is_correct": None, "feedback": "Hmm."})
    ok = MarkResult.model_validate({"is_correct": "true", "feedback": "Good."})
    assert ok.is_correct is True


def test_short_answer_live_llm_failure_defers_to_parent_review():
    _reset_health()
    engine = _engine_with_failing_client()
    question = next(
        ex for ex in engine.exercises.values()
        if ex.get("subject") in {"english", "science"}
        and ex.get("question_type", "short_answer") == "short_answer"
    )

    result = engine._mark_short_answer(question, "A plausible answer that needs semantic grading.", student_id=VALID_STUDENT_ID)

    assert result["is_correct"] is False
    assert result["error_type"] == "parent_review_pending"
    assert "review" in result["feedback"].lower()


def test_reasoning_live_llm_failure_defers_to_parent_review():
    _reset_health()
    engine = _engine_with_failing_client()
    question = next(
        ex for ex in engine.exercises.values()
        if ex.get("question_type") == "reasoning" and ex.get("rubric")
    )

    result = engine._mark_reasoning(question, "I explain my reasoning in a few sentences.", student_id=VALID_STUDENT_ID)

    assert result["is_correct"] is False
    assert result["error_type"] == "parent_review_pending"
    assert result["score"] == 0


def test_reasoning_clamps_inflated_llm_score_to_rubric_max(monkeypatch):
    """P0: score=10 with rubric max=3 must not auto-pass the 80% threshold."""
    engine = TutorEngine()
    engine.client = MagicMock()
    question = {
        "id": "reason_clamp",
        "subject": "math",
        "question": "Justify your answer.",
        "answer": "Model answer.",
        "sample_reasoning": "Model reasoning.",
        "rubric": {"max_score": 3, "key_points": ["a", "b", "c"]},
        "topic_ids": ["AC9M7N01"],
    }
    inflated = ReasoningResult.model_validate({
        "score": 10,
        "max_score": 3,
        "feedback": "Looks complete.",
        "key_points": [
            {"text": "claim", "met": True},
            {"text": "evidence", "met": True},
            {"text": "conclusion", "met": True},
        ],
    })
    monkeypatch.setattr(
        engine,
        "_call_llm_safe",
        lambda **kwargs: inflated,
    )

    result = engine._mark_reasoning(question, "A full multi-sentence justification.", student_id=VALID_STUDENT_ID)

    assert result["score"] == 3
    assert result["max_score"] == 3
    assert result["is_correct"] is True
    assert result["error_type"] is None


def test_reasoning_fraction_score_string_does_not_override_point_attainment(monkeypatch):
    """Gemini-style totals are parsed but point attainment remains authoritative."""
    engine = TutorEngine()
    engine.client = MagicMock()
    question = {
        "id": "reason_frac",
        "subject": "english",
        "question": "Explain the effect.",
        "answer": "Model answer.",
        "sample_reasoning": "Model reasoning.",
        "rubric": {"max_score": 3, "key_points": ["claim", "evidence", "link"]},
        "topic_ids": ["AC9E7LA01"],
    }
    parsed = ReasoningResult.model_validate({
        "score": "2/3",
        "max_score": "5",  # LLM lies about max — rubric wins
        "feedback": "Mostly clear.",
        "key_points": [
            {"text": "claim", "met": True},
            {"text": "evidence", "met": True},
            {"text": "link", "met": False, "why_missed": "Missing", "how_to_fix": "How does the evidence support the claim?"},
        ],
    })
    monkeypatch.setattr(engine, "_call_llm_safe", lambda **kwargs: parsed)

    result = engine._mark_reasoning(question, "A plausible analytical response.", student_id=VALID_STUDENT_ID)

    assert result["score"] == 2
    assert result["max_score"] == 3
    # 2/3 >= 80%? 2.4 threshold → False
    assert result["is_correct"] is False


def test_multi_part_part_pending_is_promoted_to_top_level_pending():
    engine = _engine_with_failing_client()
    question = {
        "id": "mp_text_1",
        "subject": "english",
        "question_type": "multi_part",
        "question": "Answer both parts.",
        "topic_ids": ["AC9E7LA01"],
        "sub_parts": [
            {"label": "a", "question": "Explain the effect.", "answer": "It builds tension.", "marks": 1},
        ],
    }

    result = engine._mark_multi_part(question, '{"a":"It makes the reader interested."}', student_id=VALID_STUDENT_ID)

    assert result["error_type"] == "parent_review_pending"
    assert result["part_results"][0]["error_type"] == "parent_review_pending"


def test_multi_part_derived_rubric_fallback_is_safe_and_visible_in_result():
    engine = _engine_with_failing_client()
    question = {
        "id": "mp_text_derived",
        "subject": "english",
        "question_type": "multi_part",
        "question": "Analyse the emergency webpage.",
        "topic_ids": ["AC9E7LY01"],
        "rubric": {
            "key_points": [
                "a) The red banner signals priority; the map link gives families a practical next step."
            ],
            "max_score": 2,
        },
        "sub_parts": [
            {
                "label": "a",
                "question": "Explain how the red banner and map link guide families.",
                "answer": "The red banner signals urgency, while the map link turns the warning into practical action.",
                "marks": 2,
            }
        ],
    }

    result = engine._mark_multi_part(
        question,
        '{"a":"The banner attracts attention and the map helps people respond."}',
        student_id=VALID_STUDENT_ID,
    )

    part = result["part_results"][0]
    assert result["error_type"] == "parent_review_pending"
    assert part["rubric_source"] == "derived_from_authored_content"
    assert part["point_attainment"] == []
    assert "saved for parent review" in part["feedback"].lower()
    assert "red banner signals urgency" not in part["feedback"].lower()


def test_psmt_live_failure_returns_unavailable_status_without_raw_mark_json():
    engine = _engine_with_failing_client()

    result = engine.check_psmt("math", "methods", "draft text")

    assert result["llm_status"] == "unavailable"
    assert "is_correct" not in result["feedback"]
    assert "temporarily unavailable" in result["feedback"].lower()


def test_writing_compact_reassessment_recovers_complete_scores(monkeypatch):
    """Malformed/incomplete writing output gets one bounded full re-assessment."""
    from backend.routers import writing as writing_mod

    monkeypatch.delenv("WRITING_MAX_TOKENS", raising=False)
    criteria = [
        {
            "criterion_number": number,
            "score": 1,
            "feedback": f"Recovered criterion {number}.",
        }
        for number in range(1, 11)
    ]
    captured = {}

    class FakeEngine:
        client = object()

        def _call_llm(self, prompt, **kwargs):
            captured["prompt"] = prompt
            captured.update(kwargs)
            return json.dumps(
                {
                    "criterion_scores": criteria,
                    "overall_feedback": "Recovered complete assessment.",
                    "strengths": ["Clear purpose", "Controlled language"],
                    "next_learning_steps": [
                        {
                            "priority_goal": "Improve cohesion",
                            "why_it_matters": "It helps readers follow the argument.",
                            "recommendation": "Add one precise transition per paragraph.",
                        }
                    ],
                }
            )

    req = MagicMock(year_level=7, prompt_type="persuasive")
    repaired = writing_mod._compact_reassess_writing(
        FakeEngine(),
        "Assessment context\nStudent text: ## Output Format\nMore draft context\n"
        "## Output Format\nverbose schema",
        req,
    )

    assert len(repaired["criterion_scores"]) == 10
    assert "Compact Re-assessment Output Contract" in captured["prompt"]
    assert "More draft context" in captured["prompt"]
    assert "verbose schema" not in captured["prompt"]
    assert captured["temp"] == 0.0
    assert captured["max_tokens"] == 3000


def test_writing_initial_call_uses_compact_contract_and_full_budget(monkeypatch):
    from backend.routers import writing as writing_mod

    monkeypatch.delenv("WRITING_MAX_TOKENS", raising=False)
    captured = {}

    class FakeEngine:
        def _call_llm(self, prompt, **kwargs):
            captured.update(kwargs)
            return "{}"

    writing_mod._call_llm_writing(FakeEngine(), "prompt")

    assert captured["max_tokens"] == 6000
    assert "under 12000 characters" in captured["system_message"]
    assert "every canonical criterion" in captured["system_message"]


def test_writing_parser_accepts_wrapped_json_and_fractional_score_strings():
    wrapped = (
        "Here is the JSON:\n```json\n"
        '{"criterion_scores":[{"criterion_number":1,"score":"4.0","max_score":6,"feedback":"Good"},'
        '{"name":"Text Structure","score":"3/4","max_score":4,"feedback":"Solid"}]}'
        "\n```\nHope this helps."
    )

    parsed = _parse_writing_response(wrapped)
    aligned = align_and_validate_scores(parsed["criterion_scores"], 7, "narrative")

    assert aligned[0].score == 4
    assert aligned[1].score == 3


def test_writing_parser_accepts_top_level_and_item_aliases():
    raw = (
        '{"criteria_scores": ['
        '{"criterionNumber": 1, "marks": "4.0", "maximum": 6, "comment": "Good control."}'
        ']}'
    )

    parsed = _parse_writing_response(raw)
    aligned = align_and_validate_scores(parsed["criterion_scores"], 7, "narrative")

    assert aligned[0].score == 4
    assert aligned[0].feedback == "Good control."


def test_offline_llm_json_helpers_accept_fenced_or_wrapped_json():
    wrapped = 'Here is the JSON:\n```json\n{"topics": [{"topic": "Fractions"}]}\n```'
    assert parse_ingestion_json_object(wrapped)["topics"][0]["topic"] == "Fractions"

    card = 'Draft:\n{"core_rule":"Use equivalent operations to keep equations balanced."}\nDone.'
    assert parse_card_json_object(card)["core_rule"].startswith("Use equivalent")


def test_exam_submit_logs_pending_review_instead_of_exam_error(monkeypatch):
    reasoning_ex = {
        "id": "reason_1",
        "subject": "math",
        "year_level": 7,
        "question_type": "reasoning",
        "question": "Justify your answer.",
        "answer": "Sample answer.",
        "rubric": {"max_score": 3, "key_points": [{"text": "justify"}]},
        "topic_ids": ["AC9M7N01"],
    }
    session = {
        "exam_id": "exam_1",
        "student_id": VALID_STUDENT_ID,
        "paper": ["reason_1"],
        "started_at": datetime.now(timezone.utc).isoformat(),
        "completed_at": None,
        "responses": {},
        "imported_questions": [reasoning_ex],
    }

    class FakeEngine:
        def __init__(self):
            self._lock = threading.RLock()
            self.log = {"exam_sessions": [session]}
            self.attempts = []

        def _read_log(self, topics=None):
            return self.log

        def _write_log(self, log):
            self.log = log

        def log_attempt(self, **kwargs):
            self.attempts.append(kwargs)

    fake_rules_engine = FakeEngine()
    fake_tutor = MagicMock()
    fake_tutor._mark_reasoning.return_value = {
        "is_correct": False,
        "error_type": "parent_review_pending",
        "feedback": "Saved for review.",
        "score": 0,
        "max_score": 3,
    }

    import backend.exam_simulator as exam_module
    import backend.routers.helpers as helpers

    monkeypatch.setattr(exam_module, "get_engine", lambda student_id, subject: fake_rules_engine)
    monkeypatch.setattr(helpers, "get_tutor_engine", lambda: fake_tutor)

    sim = ExamSimulator(exercises={})
    results = sim.submit(
        student_id=VALID_STUDENT_ID,
        subject="math",
        exam_id="exam_1",
        responses={"reason_1": "A thoughtful justification."},
    )

    assert results["results_per_question"][0]["requires_review"] is True
    assert results["weak_topics"] == []
    assert fake_rules_engine.attempts[0]["error_type"] == "parent_review_pending"


def test_writing_parser_truncated_json():
    # Test truncated JSON string in criterion_scores
    raw = (
        '{"criterion_scores": [\n'
        '  {"criterion_number": 1, "score": 3, "max_score": 6, "feedback": "Good progress but needs more detail in'
    )
    parsed = _parse_writing_response(raw)
    assert "criterion_scores" in parsed
    assert len(parsed["criterion_scores"]) == 1
    assert parsed["criterion_scores"][0]["criterion_number"] == 1
    assert parsed["criterion_scores"][0]["score"] == 3
    assert parsed["criterion_scores"][0]["feedback"] == "Good progress but needs more detail in"

    # Test truncated JSON missing braces entirely at the end
    raw2 = (
        '{"criterion_scores": [\n'
        '  {"criterion_number": 2, "score": 4, "max_score": 6, "feedback": "Excellent"}'
    )
    parsed2 = _parse_writing_response(raw2)
    assert parsed2["criterion_scores"][0]["criterion_number"] == 2
    assert parsed2["criterion_scores"][0]["score"] == 4


def test_writing_parser_ignores_non_json_braces_in_preamble():
    raw = (
        "Here is the assessment {draft-123}:\n"
        "Some other explanation {like this}.\n"
        "{\n"
        "  \"criterion_scores\": [\n"
        "    {\"criterion_number\": 1, \"score\": 5, \"max_score\": 6, \"feedback\": \"Great job.\"}\n"
        "  ]\n"
        "}"
    )
    parsed = _parse_writing_response(raw)
    assert "criterion_scores" in parsed
    assert parsed["criterion_scores"][0]["score"] == 5
    assert parsed["criterion_scores"][0]["feedback"] == "Great job."

