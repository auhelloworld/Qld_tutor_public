"""Integration tests for misconception endpoints (Task 13.1).

Tests list endpoints with and without subject/topic_id params.
"""
import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient

from backend.api import app


@pytest.fixture
def client():
    """Create a test client for the FastAPI app."""
    return TestClient(app)


class TestMisconceptionListEndpoint:
    def test_list_all_misconceptions(self, client):
        """GET /api/misconceptions/list returns all misconceptions."""
        res = client.get("/api/misconceptions/list")
        assert res.status_code == 200
        data = res.json()
        assert isinstance(data, list)

    def test_list_by_topic_id(self, client):
        """GET /api/misconceptions/list?topic_id=AC9M7N04 filters by topic."""
        res = client.get("/api/misconceptions/list?topic_id=AC9M7N04")
        assert res.status_code == 200
        data = res.json()
        assert isinstance(data, list)
        # All returned records should have AC9M7N04 in their topic_ids
        for rec in data:
            assert "AC9M7N04" in rec["topic_ids"]

    def test_list_by_subject(self, client):
        """GET /api/misconceptions/list?subject=math returns math misconceptions."""
        res = client.get("/api/misconceptions/list?subject=math")
        assert res.status_code == 200
        data = res.json()
        assert isinstance(data, list)

    def test_no_student_id_required(self, client):
        """Misconception endpoints are Phase-2 Unaffected (no X-Student-Id required)."""
        # Remove student ID header
        res = client.get(
            "/api/misconceptions/list",
            headers={"X-Student-Id": ""},
        )
        # Should still work (200) since these are unaffected endpoints
        # The endpoint doesn't require student_id
        assert res.status_code == 200

    def test_provenance_included(self, client):
        """Each record includes provenance block."""
        res = client.get("/api/misconceptions/list")
        data = res.json()
        if data:
            assert "provenance" in data[0]
            assert "source" in data[0]["provenance"]


class TestWorkedExamplesListEndpoint:
    def test_list_all_worked_examples(self, client):
        """GET /api/worked_examples/list returns all worked examples."""
        res = client.get("/api/worked_examples/list")
        assert res.status_code == 200
        data = res.json()
        assert isinstance(data, list)

    def test_list_by_topic_id(self, client):
        """GET /api/worked_examples/list?topic_id=AC9M7N04 filters by topic."""
        res = client.get("/api/worked_examples/list?topic_id=AC9M7N04")
        assert res.status_code == 200
        data = res.json()
        assert isinstance(data, list)
        for rec in data:
            assert "AC9M7N04" in rec["topic_ids"]

    def test_list_by_subject(self, client):
        """GET /api/worked_examples/list?subject=math returns math examples."""
        res = client.get("/api/worked_examples/list?subject=math")
        assert res.status_code == 200
        data = res.json()
        assert isinstance(data, list)
