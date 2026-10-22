"""Verification gate for LaTeX syntax and rendering in exercise libraries.

Ensures all math content in the JSON exercise libraries conforms to the LaTeX specifications
defined in `data/latex_spec.md` and renders cleanly with KaTeX without syntax or compilation errors.
"""

from __future__ import annotations

import json
from pathlib import Path
import sys

import pytest

# Ensure the repository root is in sys.path to allow importing scripts modules
_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from scripts import latex_validator


def _discover_exercise_files() -> list[Path]:
    """Find all JSON files in data/ containing list of exercise items."""
    data_dir = _REPO_ROOT / "data"
    exercise_files = []
    
    for path in data_dir.glob("*.json"):
        if path.name == "credentials.json" or "taxonomy" in path.name:
            continue
        try:
            with open(path, "r", encoding="utf-8") as f:
                content = json.load(f)
            if isinstance(content, list) and len(content) > 0:
                # Basic check to see if it contains exercise structures
                first_item = content[0]
                if isinstance(first_item, dict) and "question" in first_item:
                    exercise_files.append(path)
        except Exception:
            continue
            
    return sorted(exercise_files)


_EXERCISE_FILES = _discover_exercise_files()


@pytest.mark.parametrize(
    "filepath",
    _EXERCISE_FILES,
    ids=[path.name for path in _EXERCISE_FILES],
)
def test_latex_syntax_errors(filepath: Path) -> None:
    """Verify that the exercise file contains zero ERROR-level LaTeX issues."""
    # Ensure KaTeX path is initialized
    latex_validator._katex_path = latex_validator.find_katex()
    
    # Run the validation
    counts = latex_validator.check_file(str(filepath), use_katex=True)
    
    # Check if there are any ERROR-level issues (which break KaTeX frontend rendering)
    num_errors = counts[latex_validator.ERROR]
    assert num_errors == 0, (
        f"{filepath.name} has {num_errors} LaTeX rendering/syntax errors! "
        f"Please run `python scripts/latex_validator.py {filepath}` for details."
    )
