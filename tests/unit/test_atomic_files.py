from __future__ import annotations

import os

import pytest

from backend.services.atomic_files import atomic_write_bytes, atomic_write_text


def test_atomic_write_replaces_content_without_fixed_temp_file(tmp_path):
    target = tmp_path / "state.json"
    target.write_text("old", encoding="utf-8")

    atomic_write_text(target, '{"ok": true}')

    assert target.read_text(encoding="utf-8") == '{"ok": true}'
    assert not list(tmp_path.glob("*.tmp"))
    assert not list(tmp_path.glob(".*.tmp"))


def test_atomic_write_cleans_unique_temp_when_replace_fails(tmp_path, monkeypatch):
    target = tmp_path / "state.json"
    target.write_bytes(b"old")

    def fail_replace(_source, _target):
        raise OSError("replace failed")

    monkeypatch.setattr(os, "replace", fail_replace)
    with pytest.raises(OSError, match="replace failed"):
        atomic_write_bytes(target, b"new")

    assert target.read_bytes() == b"old"
    assert not list(tmp_path.glob(".*.tmp"))
