"""Tests for bank-review import / append / parent gate."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.student_identity import create_parent_token, create_student_token


VALID_STUDENT_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"


def _valid_math_item(ex_id: str = "bank_review_test_001") -> dict:
    return {
        "id": ex_id,
        "topic": "Test topic",
        "question": "What is $1+1$?",
        "answer": "2",
        "steps": ["Add one and one."],
        "framework": "AC9_MATHS",
        "topic_ids": ["AC9M7N01"],
        "subject": "math",
        "difficulty": "foundational",
        "year_level": 7,
        "question_type": "short_answer",
        "complexity": "simple_familiar",
    }


def _parent_headers(student_id: str = VALID_STUDENT_ID) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {create_student_token(student_id)}",
        "X-Parent-Token": create_parent_token(student_id),
    }


@pytest.fixture
def parent_client(tmp_path, monkeypatch):
    monkeypatch.setenv("PARENT_PASSWORD", "test-parent-secret")
    from backend.services import exercise_bank_paths as paths_mod
    from backend.routers import bank_review as br

    monkeypatch.setattr(paths_mod, "DEFAULT_DATA_DIR", tmp_path)
    monkeypatch.setattr(br, "DEFAULT_DATA_DIR", tmp_path)
    (tmp_path / "exercise_7_math.json").write_text("[]\n", encoding="utf-8")

    with br._sessions_lock:
        br._sessions.clear()

    from backend.api import app
    return TestClient(app)


def test_status_without_parent_password(monkeypatch):
    monkeypatch.setenv("PARENT_PASSWORD", "")
    from backend.api import app
    client = TestClient(app)
    res = client.get("/api/dev/bank-review/status")
    assert res.status_code == 200
    assert res.json()["enabled"] is False
    assert res.json()["auth"] == "parent"


def test_status_with_parent_password(monkeypatch):
    monkeypatch.setenv("PARENT_PASSWORD", "x")
    from backend.api import app
    client = TestClient(app)
    res = client.get("/api/dev/bank-review/status")
    assert res.status_code == 200
    assert res.json()["enabled"] is True


def test_import_requires_parent_token(parent_client):
    res = parent_client.post("/api/dev/bank-review/import", json=[_valid_math_item()])
    assert res.status_code == 401


def test_import_session_item_and_append(parent_client, tmp_path):
    client = parent_client
    headers = _parent_headers()
    item = _valid_math_item("bank_review_append_me")

    res = client.post("/api/dev/bank-review/import", json=[item], headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 1
    assert body["valid_for_append"] == 1
    sid = body["session_id"]

    res = client.get(f"/api/dev/bank-review/session/{sid}", headers=headers)
    assert res.status_code == 200
    items = res.json()["items"]
    assert len(items) == 1
    assert items[0]["id"] == "bank_review_append_me"
    assert items[0]["target_file"] == "exercise_7_math.json"

    res = client.get(f"/api/dev/bank-review/session/{sid}/item", params={"index": 0}, headers=headers)
    assert res.status_code == 200
    assert res.json()["exercise"]["id"] == "bank_review_append_me"

    with patch("backend.routers.bank_review.get_tutor_engine") as mock_eng:
        mock_eng.return_value.reload_exercises.return_value = {"exercise_count": 1}
        res = client.post(
            f"/api/dev/bank-review/session/{sid}/append",
            json={"mode": "all_valid"},
            headers=headers,
        )
    assert res.status_code == 200
    report = res.json()
    assert report["added_total"] == 1
    assert report["reload_succeeded"] is True
    assert report["backup_created"] is True
    assert report["files"][0]["backup_created"] is True
    assert report["files"][0]["backup_path"] == str(
        tmp_path / "exercise_7_math.json.bak"
    )
    assert (tmp_path / "exercise_7_math.json.bak").read_bytes() == b"[]\n"
    bank = json.loads((tmp_path / "exercise_7_math.json").read_text(encoding="utf-8"))
    assert any(e.get("id") == "bank_review_append_me" for e in bank)

    with patch("backend.routers.bank_review.get_tutor_engine") as mock_eng:
        mock_eng.return_value.reload_exercises.return_value = {"exercise_count": 1}
        res = client.post(
            f"/api/dev/bank-review/session/{sid}/append",
            json={"mode": "all_valid"},
            headers=headers,
        )
    assert res.status_code == 200
    assert res.json()["added_total"] == 0
    assert "bank_review_append_me" in res.json()["skipped_duplicate"]


def test_import_invalid_shape(parent_client):
    res = parent_client.post(
        "/api/dev/bank-review/import",
        json={"foo": 1},
        headers=_parent_headers(),
    )
    assert res.status_code == 400


def test_invalid_item_blocked_from_append(parent_client):
    headers = _parent_headers()
    bad = {"id": "nope", "question": "x"}
    res = parent_client.post("/api/dev/bank-review/import", json=[bad], headers=headers)
    assert res.status_code == 200
    assert res.json()["valid_for_append"] == 0
    sid = res.json()["session_id"]
    with patch("backend.routers.bank_review.get_tutor_engine") as mock_eng:
        mock_eng.return_value.reload_exercises.return_value = {}
        res = parent_client.post(
            f"/api/dev/bank-review/session/{sid}/append",
            json={"mode": "all_valid"},
            headers=headers,
        )
    assert res.status_code == 200
    assert res.json()["added_total"] == 0
    assert "nope" in res.json()["blocked_invalid"]


def test_flag_reviewed(parent_client):
    headers = _parent_headers()
    item = _valid_math_item("flag_me")
    sid = parent_client.post(
        "/api/dev/bank-review/import", json=[item], headers=headers,
    ).json()["session_id"]
    res = parent_client.post(
        f"/api/dev/bank-review/session/{sid}/flag",
        json={"index": 0, "reviewed": True},
        headers=headers,
    )
    assert res.status_code == 200
    assert res.json()["reviewed"] is True


def test_import_generation_candidates_wrapper(parent_client):
    headers = _parent_headers()
    item = _valid_math_item("gen_cand_1")
    item["status"] = "draft"
    res = parent_client.post(
        "/api/dev/bank-review/import",
        json={"candidates": [item], "stimuli": [], "generation_notes": []},
        headers=headers,
    )
    assert res.status_code == 200
    body = res.json()
    assert body["detected_format"] == "generation_candidates"
    assert body["total"] == 1
    assert body["draft_status_count"] == 1


def test_bulk_status_and_export(parent_client):
    headers = _parent_headers()
    item = _valid_math_item("draft_to_active")
    item["status"] = "draft"
    sid = parent_client.post(
        "/api/dev/bank-review/import", json=[item], headers=headers,
    ).json()["session_id"]

    res = parent_client.post(
        f"/api/dev/bank-review/session/{sid}/bulk-status",
        json={"status": "active", "mode": "all"},
        headers=headers,
    )
    assert res.status_code == 200
    assert res.json()["changed"] == 1

    res = parent_client.get(
        f"/api/dev/bank-review/session/{sid}/export",
        headers=headers,
    )
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 1
    assert body["exercises"][0]["status"] == "active"
    assert body["exercises"][0]["id"] == "draft_to_active"


def test_update_question_answer_steps_and_rubric_points(parent_client):
    headers = _parent_headers()
    item = _valid_math_item("edit_me")
    item["question_type"] = "reasoning"
    item["sample_reasoning"] = "Because 1+1=2."
    item["rubric"] = {
        "max_score": 2,
        "key_points": [
            {"text": "States sum", "marks": 1},
            "Gives final answer",
        ],
    }
    sid = parent_client.post(
        "/api/dev/bank-review/import", json=[item], headers=headers,
    ).json()["session_id"]

    res = parent_client.post(
        f"/api/dev/bank-review/session/{sid}/update",
        json={
            "index": 0,
            "question": "Explain why $1+1=2$.",
            "answer": "By definition of addition.",
            "steps": ["Start with 1", "Add 1 to get 2"],
            "rubric_key_points": ["Mentions addition", "Concludes 2"],
            "status": "active",
        },
        headers=headers,
    )
    assert res.status_code == 200
    body = res.json()
    ex = body["exercise"]
    assert ex["question"] == "Explain why $1+1=2$."
    assert ex["answer"] == "By definition of addition."
    assert ex["steps"] == ["Start with 1", "Add 1 to get 2"]
    assert ex["status"] == "active"
    kps = ex["rubric"]["key_points"]
    assert kps[0]["text"] == "Mentions addition"
    assert kps[0].get("marks") == 1  # preserved from object form
    assert kps[1] == "Concludes 2"

    # Session item is the edited version for subsequent mark/append
    item_again = parent_client.get(
        f"/api/dev/bank-review/session/{sid}/item",
        params={"index": 0},
        headers=headers,
    ).json()["exercise"]
    assert item_again["answer"] == "By definition of addition."


def test_ephemeral_mark_without_persist(parent_client):
    headers = _parent_headers()
    item = _valid_math_item("mark_me_numeric")
    item["answer"] = "2"
    item["question"] = "1+1"
    sid = parent_client.post(
        "/api/dev/bank-review/import", json=[item], headers=headers,
    ).json()["session_id"]
    res = parent_client.post(
        f"/api/dev/bank-review/session/{sid}/mark",
        json={"index": 0, "student_answer": "2"},
        headers=headers,
    )
    assert res.status_code == 200
    body = res.json()
    assert body.get("bank_review") is True
    assert body.get("persisted") is False


def test_mark_question_ephemeral_unit():
    from backend.tutor_engine import TutorEngine
    engine = TutorEngine()
    item = _valid_math_item("eph_1")
    item["answer"] = "5"
    result = engine.mark_question_ephemeral(item, "5", student_id="bank-review-local")
    assert result["persisted"] is False
    assert result["bank_review"] is True
    assert "is_correct" in result


def test_mark_multi_part_question_ephemeral_unit():
    from backend.tutor_engine import TutorEngine

    engine = TutorEngine()
    item = _valid_math_item("eph_multi_1")
    item.update({
        "question": "Answer both parts.",
        "answer": "See parts.",
        "question_type": "multi_part",
        "sub_parts": [
            {"label": "a", "question": "What is 1 + 1?", "answer": "2", "marks": 1},
            {"label": "b", "question": "What is 2 + 2?", "answer": "4", "marks": 1},
        ],
    })

    result = engine.mark_question_ephemeral(
        item,
        json.dumps({"a": "2"}),
        student_id="bank-review-multipart-local",
    )

    assert result["persisted"] is False
    assert result["bank_review"] is True
    assert result["part_results"][0]["is_correct"] is True
    assert result["part_results"][1]["outcome"] == "unanswered"


def test_load_bank_edit_and_save_bank(parent_client, tmp_path, monkeypatch):
    from backend.routers import bank_review as br

    monkeypatch.setattr(br, "DEFAULT_DATA_DIR", tmp_path)
    bank_name = "exercise_7_math.json"
    original = [
        {
            "id": "y7m_existing_1",
            "topic": "Number",
            "question": "What is $1+1$?",
            "answer": "2",
            "steps": ["Add."],
            "framework": "AC9_MATHS",
            "topic_ids": ["AC9M7N01"],
            "subject": "math",
            "difficulty": "foundational",
            "year_level": 7,
            "question_type": "short_answer",
            "complexity": "simple_familiar",
            "status": "active",
        },
        {
            "id": "y7m_existing_2",
            "topic": "Number",
            "question": "What is $2+2$?",
            "answer": "4",
            "steps": ["Add."],
            "framework": "AC9_MATHS",
            "topic_ids": ["AC9M7N01"],
            "subject": "math",
            "difficulty": "foundational",
            "year_level": 7,
            "question_type": "short_answer",
            "complexity": "simple_familiar",
            "status": "active",
        },
    ]
    (tmp_path / bank_name).write_text(json.dumps(original, indent=2) + "\n", encoding="utf-8")

    headers = _parent_headers()
    res = parent_client.get("/api/dev/bank-review/targets", headers=headers)
    assert res.status_code == 200
    assert any(t["file"] == bank_name for t in res.json()["targets"])

    res = parent_client.post(
        "/api/dev/bank-review/load-bank",
        json={"filename": bank_name},
        headers=headers,
    )
    assert res.status_code == 200
    body = res.json()
    assert body["source_kind"] == "bank_file"
    assert body["bank_filename"] == bank_name
    assert body["total"] == 2
    sid = body["session_id"]

    res = parent_client.post(
        f"/api/dev/bank-review/session/{sid}/update",
        json={"index": 0, "answer": "2 (exactly)", "question": "Evaluate $1+1$."},
        headers=headers,
    )
    assert res.status_code == 200
    assert res.json()["exercise"]["answer"] == "2 (exactly)"

    with patch("backend.routers.bank_review.get_tutor_engine") as mock_eng:
        mock_eng.return_value.reload_exercises.return_value = {"exercise_count": 2}
        res = parent_client.post(
            f"/api/dev/bank-review/session/{sid}/save-bank",
            json={"filename": bank_name, "create_backup": True},
            headers=headers,
        )
    assert res.status_code == 200
    assert res.json()["ok"] is True
    assert res.json()["num_items"] == 2

    saved = json.loads((tmp_path / bank_name).read_text(encoding="utf-8"))
    assert len(saved) == 2
    assert saved[0]["id"] == "y7m_existing_1"
    assert saved[0]["answer"] == "2 (exactly)"
    assert saved[0]["question"] == "Evaluate $1+1$."
    assert saved[1]["id"] == "y7m_existing_2"
    assert (tmp_path / f"{bank_name}.bak").is_file()




def test_production_bank_save_is_strict_and_preserves_invalid_session(parent_client, tmp_path):
    headers = _parent_headers()
    bank_path = tmp_path / "exercise_7_math.json"
    original = b"[]\n"
    bank_path.write_bytes(original)
    invalid = _valid_math_item("invalid_durable_write")
    invalid["diagram_data"] = {"type": "not_supported"}
    sid = parent_client.post(
        "/api/dev/bank-review/import",
        json=[invalid],
        headers=headers,
    ).json()["session_id"]

    rejected_flag = parent_client.post(
        f"/api/dev/bank-review/session/{sid}/save-bank",
        json={"filename": bank_path.name, "require_all_valid": False},
        headers=headers,
    )
    assert rejected_flag.status_code == 400
    assert rejected_flag.json()["error"] == "strict_validation_required"

    rejected_item = parent_client.post(
        f"/api/dev/bank-review/session/{sid}/save-bank",
        json={"filename": bank_path.name},
        headers=headers,
    )
    assert rejected_item.status_code == 400
    assert rejected_item.json()["error"] == "invalid_items"
    assert bank_path.read_bytes() == original


def test_bank_save_aborts_when_backup_cannot_be_verified(parent_client, tmp_path, monkeypatch):
    from backend.routers import bank_review as br

    headers = _parent_headers()
    bank_path = tmp_path / "exercise_7_math.json"
    original = b"[{\"id\": \"original\"}]\n"
    bank_path.write_bytes(original)
    sid = parent_client.post(
        "/api/dev/bank-review/import",
        json=[_valid_math_item("backup_guard")],
        headers=headers,
    ).json()["session_id"]

    def fail_backup(path, data):
        raise OSError("read-only backup")

    monkeypatch.setattr(br, "atomic_write_bytes", fail_backup)
    response = parent_client.post(
        f"/api/dev/bank-review/session/{sid}/save-bank",
        json={"filename": bank_path.name, "create_backup": True},
        headers=headers,
    )
    assert response.status_code == 500
    assert response.json()["error"] == "backup_failed"
    assert response.json()["backup_created"] is False
    assert bank_path.read_bytes() == original
    assert not (tmp_path / "exercise_7_math.json.tmp").exists()


def test_bank_save_reports_reload_failure_as_error(parent_client, tmp_path):
    from backend.routers import bank_review as br

    headers = _parent_headers()
    bank_path = tmp_path / "exercise_7_math.json"
    bank_path.write_text("[]\n", encoding="utf-8")
    sid = parent_client.post(
        "/api/dev/bank-review/import",
        json=[_valid_math_item("reload_guard")],
        headers=headers,
    ).json()["session_id"]

    with patch.object(br, "get_tutor_engine") as mock_engine:
        mock_engine.return_value.reload_exercises.side_effect = RuntimeError("cache failed")
        response = parent_client.post(
            f"/api/dev/bank-review/session/{sid}/save-bank",
            json={"filename": bank_path.name, "create_backup": True},
            headers=headers,
        )

    assert response.status_code == 500
    detail = response.json()
    assert detail["error"] == "reload_failed"
    assert detail["reload_succeeded"] is False
    assert detail["backup_created"] is True
    assert json.loads(bank_path.read_text(encoding="utf-8"))[0]["id"] == "reload_guard"


def test_exam_save_rejects_invalid_session_item(parent_client, tmp_path):
    headers = _parent_headers()
    bad_paper = {
        "title": "Invalid paper",
        "time_limit_minutes": 30,
        "questions": [{
            **_valid_math_item("invalid_exam_write"),
            "diagram_data": {"type": "not_supported"},
        }],
    }
    imported = parent_client.post(
        "/api/dev/bank-review/import",
        json={**bad_paper, "source_name": "invalid-paper.json"},
        headers=headers,
    )
    assert imported.status_code == 200
    sid = imported.json()["session_id"]

    response = parent_client.post(
        f"/api/dev/bank-review/session/{sid}/save-exam",
        json={"filename": "invalid-paper.json"},
        headers=headers,
    )
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_items"
    assert not (tmp_path / "exams" / "invalid-paper.json").exists()

    headers = _parent_headers()
    item = _valid_math_item("sample_rsn_1")
    item["question_type"] = "reasoning"
    item["sample_reasoning"] = "Old sample."
    item["rubric"] = {"max_score": 2, "key_points": ["Mentions sum"]}
    sid = parent_client.post(
        "/api/dev/bank-review/import", json=[item], headers=headers,
    ).json()["session_id"]

    res = parent_client.post(
        f"/api/dev/bank-review/session/{sid}/update",
        json={"index": 0, "sample_reasoning": "Because $1+1=2$ by definition."},
        headers=headers,
    )
    assert res.status_code == 200
    assert res.json()["exercise"]["sample_reasoning"] == "Because $1+1=2$ by definition."

    res = parent_client.post(
        f"/api/dev/bank-review/session/{sid}/update",
        json={"index": 0, "clear_sample_reasoning": True},
        headers=headers,
    )
    assert res.status_code == 200
    assert not res.json()["exercise"].get("sample_reasoning")


def test_update_diagram_data(parent_client):
    headers = _parent_headers()
    item = _valid_math_item("diag_edit_1")
    item["diagram_data"] = {"type": "number_line", "min": 0, "max": 5}
    sid = parent_client.post(
        "/api/dev/bank-review/import", json=[item], headers=headers,
    ).json()["session_id"]

    res = parent_client.post(
        f"/api/dev/bank-review/session/{sid}/update",
        json={
            "index": 0,
            "diagram_data": {"type": "number_line", "min": 0, "max": 10, "marks": [{"value": 2}]},
        },
        headers=headers,
    )
    assert res.status_code == 200
    diag = res.json()["exercise"]["diagram_data"]
    assert diag["max"] == 10
    assert diag["marks"][0]["value"] == 2
    assert res.json()["meta"]["has_diagram"] is True

    res = parent_client.post(
        f"/api/dev/bank-review/session/{sid}/update",
        json={"index": 0, "clear_diagram": True},
        headers=headers,
    )
    assert res.status_code == 200
    assert "diagram_data" not in res.json()["exercise"] or res.json()["exercise"].get("diagram_data") in (None, {})
    # After clear, has_diagram should be false
    assert res.json()["meta"]["has_diagram"] is False


def test_update_image_reference_and_clear(parent_client):
    headers = _parent_headers()
    item = _valid_math_item("image_edit_1")
    item["image"] = "/images/old.svg"
    sid = parent_client.post(
        "/api/dev/bank-review/import", json=[item], headers=headers,
    ).json()["session_id"]

    res = parent_client.post(
        f"/api/dev/bank-review/session/{sid}/update",
        json={"index": 0, "image": "/images/new.svg"},
        headers=headers,
    )
    assert res.status_code == 200
    assert res.json()["exercise"]["image"] == "/images/new.svg"
    assert res.json()["meta"]["has_diagram"] is True

    res = parent_client.post(
        f"/api/dev/bank-review/session/{sid}/update",
        json={"index": 0, "clear_image": True},
        headers=headers,
    )
    assert res.status_code == 200
    assert "image" not in res.json()["exercise"]
    assert res.json()["meta"]["has_diagram"] is False


def test_delete_item_only_changes_review_session(parent_client):
    headers = _parent_headers()
    items = [_valid_math_item("delete_me"), _valid_math_item("keep_me")]
    sid = parent_client.post(
        "/api/dev/bank-review/import", json=items, headers=headers,
    ).json()["session_id"]

    res = parent_client.delete(
        f"/api/dev/bank-review/session/{sid}/item",
        params={"index": 0},
        headers=headers,
    )
    assert res.status_code == 200
    assert res.json() == {
        "ok": True,
        "deleted_id": "delete_me",
        "deleted_index": 0,
        "total": 1,
        "next_index": 0,
    }

    session = parent_client.get(
        f"/api/dev/bank-review/session/{sid}", headers=headers,
    )
    assert session.status_code == 200
    assert session.json()["total"] == 1
    assert [row["id"] for row in session.json()["items"]] == ["keep_me"]

    item = parent_client.get(
        f"/api/dev/bank-review/session/{sid}/item",
        params={"index": 0},
        headers=headers,
    )
    assert item.status_code == 200
    assert item.json()["exercise"]["id"] == "keep_me"


def test_update_multi_part_sub_parts(parent_client):
    headers = _parent_headers()
    item = _valid_math_item("mp_edit_1")
    item["question_type"] = "multi_part"
    item["question"] = "A rectangle has sides."
    item["answer"] = "See parts"
    item["sub_parts"] = [
        {"label": "a", "question": "Perimeter expression", "answer": "6x+4", "marks": 1},
        {"label": "b", "question": "Find x if P=34", "answer": "5", "marks": 2},
    ]
    sid = parent_client.post(
        "/api/dev/bank-review/import", json=[item], headers=headers,
    ).json()["session_id"]

    res = parent_client.post(
        f"/api/dev/bank-review/session/{sid}/update",
        json={
            "index": 0,
            "question": "A rectangle has length $(2x+3)$ and width $(x-1)$.",
            "sub_parts": [
                {"label": "a", "question": "Write perimeter in simplest form.", "answer": "6x+4", "marks": 1},
                {"label": "b", "question": "If perimeter is 34, find $x$.", "answer": "5", "marks": 2},
                {"label": "c", "question": "Find the area when $x=5$.", "answer": "52", "marks": 1},
            ],
        },
        headers=headers,
    )
    assert res.status_code == 200
    parts = res.json()["exercise"]["sub_parts"]
    assert len(parts) == 3
    assert parts[0]["question"] == "Write perimeter in simplest form."
    assert parts[2]["label"] == "c"
    assert parts[2]["answer"] == "52"
    assert parts[2]["marks"] == 1


def test_import_exam_questions_wrapper(parent_client):
    headers = _parent_headers()
    paper = {
        "title": "Sample Y7 Quiz",
        "time_limit_minutes": 45,
        "questions": [
            {
                "id": "exam_q1",
                "question": "Simplify 2/4",
                "answer": "1/2",
                "question_type": "short_answer",
            }
        ],
    }
    res = parent_client.post(
        "/api/dev/bank-review/import",
        json={**paper, "source_name": "sample_quiz.json", "default_subject": "math", "default_year_level": 7},
        headers=headers,
    )
    assert res.status_code == 200
    body = res.json()
    assert body["detected_format"] == "imported_exam"
    assert body["source_kind"] == "exam"
    assert body["total"] == 1
    sid = body["session_id"]

    item = parent_client.get(
        f"/api/dev/bank-review/session/{sid}/item",
        params={"index": 0},
        headers=headers,
    ).json()["exercise"]
    assert item["subject"] == "math"
    assert item["year_level"] == 7
    assert item["answer"] == "1/2"

    # Edit answer in session
    res = parent_client.post(
        f"/api/dev/bank-review/session/{sid}/update",
        json={"index": 0, "answer": "1/2 (simplest form)"},
        headers=headers,
    )
    assert res.status_code == 200
    assert res.json()["exercise"]["answer"] == "1/2 (simplest form)"


def test_import_exam_file_and_save_exam(parent_client, tmp_path, monkeypatch):
    from backend.routers import bank_review as br

    exams_dir = tmp_path / "exams"
    exams_dir.mkdir()
    paper = {
        "title": "Disk Paper",
        "time_limit_minutes": 30,
        "questions": [
            {
                **_valid_math_item("disk_q1"),
                "question": "What is 3+4?",
                "answer": "7",
            }
        ],
    }
    (exams_dir / "disk_paper.json").write_text(json.dumps(paper), encoding="utf-8")
    monkeypatch.setattr(br, "DEFAULT_EXAMS_DIR", exams_dir)

    headers = _parent_headers()
    res = parent_client.get("/api/dev/bank-review/exams", headers=headers)
    assert res.status_code == 200
    papers = res.json()["papers"]
    assert any(p["filename"] == "disk_paper.json" for p in papers)

    res = parent_client.post(
        "/api/dev/bank-review/import-exam",
        json={"filename": "disk_paper.json", "default_subject": "math", "default_year_level": 7},
        headers=headers,
    )
    assert res.status_code == 200
    sid = res.json()["session_id"]
    assert res.json()["exam_filename"] == "disk_paper.json"

    parent_client.post(
        f"/api/dev/bank-review/session/{sid}/update",
        json={"index": 0, "question": "What is $3+4$?", "answer": "7"},
        headers=headers,
    )

    res = parent_client.post(
        f"/api/dev/bank-review/session/{sid}/save-exam",
        json={"filename": "disk_paper.json", "create_backup": True},
        headers=headers,
    )
    assert res.status_code == 200
    assert res.json()["ok"] is True
    saved = json.loads((exams_dir / "disk_paper.json").read_text(encoding="utf-8"))
    assert saved["title"] == "Disk Paper"
    assert saved["questions"][0]["question"] == "What is $3+4$?"
    assert saved["questions"][0]["answer"] == "7"
    assert (exams_dir / "disk_paper.json.bak").is_file()


def test_import_enforces_active_session_capacity(parent_client, monkeypatch):
    from backend.routers import bank_review as br

    monkeypatch.setattr(br, "_MAX_ACTIVE_SESSIONS", 2)
    headers = _parent_headers()
    first = parent_client.post(
        "/api/dev/bank-review/import",
        json=[_valid_math_item("capacity_1")],
        headers=headers,
    )
    second = parent_client.post(
        "/api/dev/bank-review/import",
        json=[_valid_math_item("capacity_2")],
        headers=headers,
    )
    blocked = parent_client.post(
        "/api/dev/bank-review/import",
        json=[_valid_math_item("capacity_3")],
        headers=headers,
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert blocked.status_code == 429
    detail = blocked.json()
    assert detail["error"] == "bank_review_session_capacity_reached"
    assert detail["max_active_sessions"] == 2

    existing = parent_client.get(
        f"/api/dev/bank-review/session/{first.json()['session_id']}",
        headers=headers,
    )
    assert existing.status_code == 200


def test_append_revalidates_selected_item_at_durable_boundary(parent_client, tmp_path):
    from backend.routers import bank_review as br

    headers = _parent_headers()
    item_id = "append_fresh_validation"
    sid = parent_client.post(
        "/api/dev/bank-review/import",
        json=[_valid_math_item(item_id)],
        headers=headers,
    ).json()["session_id"]
    # Simulate stale cached validation: the in-memory item changes after import
    # without updating the earlier validation snapshot.
    with br._sessions_lock:
        br._sessions[sid]["items"][0]["diagram_data"] = {"type": "not_supported"}

    original = (tmp_path / "exercise_7_math.json").read_bytes()
    response = parent_client.post(
        f"/api/dev/bank-review/session/{sid}/append",
        json={"mode": "all_valid"},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["added_total"] == 0
    assert item_id in response.json()["blocked_invalid"]
    assert (tmp_path / "exercise_7_math.json").read_bytes() == original


def test_append_backup_failure_preserves_original_bytes(parent_client, tmp_path, monkeypatch):
    headers = _parent_headers()
    bank_path = tmp_path / "exercise_7_math.json"
    original = bank_path.read_bytes()
    sid = parent_client.post(
        "/api/dev/bank-review/import",
        json=[_valid_math_item("append_backup_guard")],
        headers=headers,
    ).json()["session_id"]

    from backend.routers import bank_review as br

    def fail_backup(path, data):
        raise OSError("backup is read-only")

    monkeypatch.setattr(br, "atomic_write_bytes", fail_backup)
    response = parent_client.post(
        f"/api/dev/bank-review/session/{sid}/append",
        json={"mode": "all_valid"},
        headers=headers,
    )

    assert response.status_code == 500
    detail = response.json()
    assert detail["error"] == "backup_failed"
    assert detail["backup_created"] is False
    assert detail["files_written"] == []
    assert detail["per_file_atomic"] is True
    assert bank_path.read_bytes() == original
    assert not (tmp_path / "exercise_7_math.json.tmp").exists()


def test_append_reload_failure_is_non_success_and_reports_written_files(parent_client, tmp_path):
    from backend.routers import bank_review as br

    headers = _parent_headers()
    item_id = "append_reload_guard"
    sid = parent_client.post(
        "/api/dev/bank-review/import",
        json=[_valid_math_item(item_id)],
        headers=headers,
    ).json()["session_id"]

    with patch.object(br, "get_tutor_engine") as mock_engine:
        mock_engine.return_value.reload_exercises.side_effect = RuntimeError("cache failed")
        response = parent_client.post(
            f"/api/dev/bank-review/session/{sid}/append",
            json={"mode": "all_valid"},
            headers=headers,
        )

    assert response.status_code == 500
    detail = response.json()
    assert detail["error"] == "reload_failed"
    assert detail["reload_succeeded"] is False
    assert detail["added_total"] == 1
    assert detail["backup_created"] is True
    assert detail["files_written"][0]["backup_created"] is True
    assert json.loads((tmp_path / "exercise_7_math.json").read_text(encoding="utf-8"))[0]["id"] == item_id


def test_existing_production_file_cannot_skip_verified_backup(parent_client, tmp_path):
    headers = _parent_headers()
    bank_path = tmp_path / "exercise_7_math.json"
    original = bank_path.read_bytes()
    sid = parent_client.post(
        "/api/dev/bank-review/import",
        json=[_valid_math_item("backup_required_guard")],
        headers=headers,
    ).json()["session_id"]

    response = parent_client.post(
        f"/api/dev/bank-review/session/{sid}/save-bank",
        json={"filename": bank_path.name, "create_backup": False},
        headers=headers,
    )

    assert response.status_code == 400
    assert response.json()["error"] == "backup_required"
    assert bank_path.read_bytes() == original


def test_replace_failure_preserves_original_and_reports_write_failure(parent_client, tmp_path, monkeypatch):
    from backend.routers import bank_review as br

    headers = _parent_headers()
    bank_path = tmp_path / "exercise_7_math.json"
    original = bank_path.read_bytes()
    sid = parent_client.post(
        "/api/dev/bank-review/import",
        json=[_valid_math_item("replace_failure_guard")],
        headers=headers,
    ).json()["session_id"]

    from backend.services import atomic_files
    original_replace = atomic_files.os.replace

    def fail_replace(source, target):
        if Path(target) == bank_path:
            raise OSError("replace denied")
        return original_replace(source, target)

    monkeypatch.setattr(atomic_files.os, "replace", fail_replace)
    response = parent_client.post(
        f"/api/dev/bank-review/session/{sid}/save-bank",
        json={"filename": bank_path.name, "create_backup": True},
        headers=headers,
    )

    assert response.status_code == 500
    detail = response.json()
    assert detail["error"] == "write_failed"
    assert detail["backup_created"] is True
    assert bank_path.read_bytes() == original
    assert (tmp_path / "exercise_7_math.json.bak").read_bytes() == original
    assert not (tmp_path / "exercise_7_math.json.tmp").exists()


def test_concurrent_appends_to_one_bank_do_not_lose_items(tmp_path, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    import threading
    import time
    from backend.routers import bank_review as br

    bank_path = tmp_path / "exercise_7_math.json"
    bank_path.write_text("[]\n", encoding="utf-8")
    original_write = br._write_json_with_verified_backup_locked
    active = 0
    max_active = 0
    guard = threading.Lock()

    def observed_write(*args, **kwargs):
        nonlocal active, max_active
        with guard:
            active += 1
            max_active = max(max_active, active)
        try:
            time.sleep(0.03)
            return original_write(*args, **kwargs)
        finally:
            with guard:
                active -= 1

    monkeypatch.setattr(br, "_write_json_with_verified_backup_locked", observed_write)
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(br._atomic_append_to_bank, bank_path, [_valid_math_item("append-a")]),
            executor.submit(br._atomic_append_to_bank, bank_path, [_valid_math_item("append-b")]),
        ]
        reports = [future.result() for future in futures]

    saved = json.loads(bank_path.read_text(encoding="utf-8"))
    assert {item["id"] for item in saved} == {"append-a", "append-b"}
    assert sum(report["added"] for report in reports) == 2
    assert max_active == 1
    assert not list(tmp_path.glob("*.tmp"))


def test_update_relocates_item_by_id_after_concurrent_lower_index_delete(monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    import threading
    from backend.routers import bank_review as br

    created = br._build_session_from_items(
        [_valid_math_item("delete-first"), _valid_math_item("edit-second")],
        source_name="concurrent-edit",
        detected_format="exercise_list",
    )
    session_id = created["session_id"]
    entered = threading.Event()
    resume = threading.Event()
    original_apply = br._apply_item_edits

    def blocking_apply(item, req):
        entered.set()
        assert resume.wait(timeout=2)
        return original_apply(item, req)

    monkeypatch.setattr(br, "_apply_item_edits", blocking_apply)
    request = br.UpdateItemRequest(index=1, answer="updated answer")
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(
            br.bank_review_update_item,
            session_id,
            request,
            "parent",
        )
        assert entered.wait(timeout=2)
        with br._sessions_lock:
            session = br._sessions[session_id]
            session["items"].pop(0)
            session["validations"].pop(0)
        resume.set()
        result = future.result(timeout=2)

    assert result["index"] == 0
    with br._sessions_lock:
        assert br._sessions[session_id]["items"][0]["id"] == "edit-second"
        assert br._sessions[session_id]["items"][0]["answer"] == "updated answer"
        br._sessions.pop(session_id, None)


def test_active_bank_review_session_uses_last_access_for_expiry(monkeypatch):
    from backend.routers import bank_review as br

    with br._sessions_lock:
        br._sessions.clear()
        br._sessions["active"] = {
            "created_at": 1.0,
            "last_access_at": 9_900.0,
            "items": [],
            "validations": [],
            "reviewed": {},
        }
        br._purge_expired_sessions(now=10_000.0)
        assert "active" in br._sessions

    monkeypatch.setattr(br.time, "time", lambda: 10_001.0)
    br._get_session("active")
    with br._sessions_lock:
        assert br._sessions["active"]["last_access_at"] == 10_001.0
        br._sessions.clear()
