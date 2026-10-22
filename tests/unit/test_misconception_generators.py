"""The committed misconception data must match what its generator produces.

Several records apply across year levels — the same misconception recurs in the
Year 7-10 slices under different topic ids — so they are built by a script rather
than hand-edited, to stop the wording drifting apart between copies.

That only helps if the two stay in step. If someone edits the JSON directly, the
next generator run would silently revert their change, so this test fails instead.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
GENERATORS = [
    (
        "scripts/misconceptions/build_ac9_science_english.py",
        "data/misconceptions/prod/ac9_science_english.json",
    ),
    (
        "scripts/misconceptions/build_qcaa_senior_maths.py",
        "data/misconceptions/prod/qcaa_senior_maths.json",
    ),
    (
        "scripts/misconceptions/build_qcaa_senior_maths_worked_examples.py",
        "data/misconceptions/worked_examples/qcaa_senior_maths.json",
    ),
]


@pytest.mark.parametrize("generator,data_file", GENERATORS)
def test_generator_reproduces_the_committed_file(generator, data_file, tmp_path):
    generator_path = REPO / generator
    committed = REPO / data_file
    assert generator_path.exists(), f"missing generator {generator}"
    assert committed.exists(), f"missing data file {data_file}"

    regenerated = tmp_path / "regenerated.json"
    result = subprocess.run(
        [sys.executable, str(generator_path), "--out", str(regenerated)],
        capture_output=True,
        text=True,
        cwd=REPO,
    )
    assert result.returncode == 0, result.stderr

    assert json.loads(regenerated.read_text(encoding="utf-8")) == json.loads(
        committed.read_text(encoding="utf-8")
    ), (
        f"{data_file} differs from what {generator} produces. Edit the generator "
        "and re-run it rather than editing the JSON."
    )


@pytest.mark.parametrize("generator,data_file", GENERATORS)
def test_generator_defaults_to_the_repository_copy(generator, data_file):
    """Running it with no arguments must not write somewhere unexpected."""
    import importlib.util

    spec = importlib.util.spec_from_file_location("generator", REPO / generator)
    module = importlib.util.module_from_spec(spec)
    original_argv = sys.argv
    sys.argv = ["generator"]
    try:
        spec.loader.exec_module(module)
        assert module._output_path(data_file) == REPO / data_file
    finally:
        sys.argv = original_argv


def test_every_generated_record_is_approved():
    """An unapproved record loads with a warning and is easy to miss."""
    import yaml

    approvals = yaml.safe_load(
        (REPO / "data/misconceptions/approvals.yaml").read_text(encoding="utf-8")
    )
    missing = []
    for _, data_file in GENERATORS:
        payload = json.loads((REPO / data_file).read_text(encoding="utf-8"))
        for record in payload.get("misconceptions", []):
            if record["misconception_id"] not in approvals:
                missing.append(record["misconception_id"])
    assert missing == [], f"records with no approvals entry: {missing}"
