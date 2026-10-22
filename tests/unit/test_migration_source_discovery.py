"""Regression tests for migration source-file discovery.

These tests intentionally exercise the repository source layout, not just the
markdown parser internals. A directory reshuffle should fail here before the
migration silently becomes a zero-candidate no-op.
"""

from backend.migrations.migrate_ac9_english import AC9EnglishMigration
from backend.migrations.migrate_ac9_maths import AC9MathsMigration


def test_ac9_maths_migration_discovers_current_source_layout():
    candidates = AC9MathsMigration().parse_source_documents()

    topic_ids = {candidate.topic_id for candidate in candidates}
    assert "AC9M7N01" in topic_ids
    assert "AC9M8N01" in topic_ids
    assert "AC9M9N01" in topic_ids
    assert len(candidates) >= 60


def test_ac9_english_migration_discovers_current_source_layout():
    candidates = AC9EnglishMigration().parse_source_documents()

    topic_ids = {candidate.topic_id for candidate in candidates}
    assert "AC9E7LA01" in topic_ids
    assert "AC9E7LY08" in topic_ids
    assert len(candidates) >= 24
