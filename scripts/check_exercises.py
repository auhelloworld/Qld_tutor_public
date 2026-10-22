from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import ValidationError

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from core.schema.exercise_schema import ExerciseItem
from backend.content_authoring.stimulus_loader import (
    StimulusValidationError,
    validate_stimulus_library,
)


BARE_UNITS = re.compile(r"(?<![a-zA-Z])(cm|mm|km|kg|ml|cm\^[23]|cm[2-3]|km/h|m/s)(?![a-zA-Z])")
LEFT_DELIMITER = re.compile(r"\\left(?![a-zA-Z])")
RIGHT_DELIMITER = re.compile(r"\\right(?![a-zA-Z])")
MARKDOWN_IMAGE = re.compile(r"!\[[^\]]*\]\(([^)]+)\)")
CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
SUPPORTED_DIAGRAM_TYPES = {
    "right_triangle",
    "triangle",
    "rectangle",
    "circle",
    "coordinate_plane",
    "number_line",
    "rectangular_prism",
    "simple_bar_chart",
    "confidence_intervals",
    "pascal_triangle",
    "data_table",
    "sample_space_grid",
    "function_graph",
    "slope_field",
    "tree_diagram",
    "venn_diagram",
    "unit_circle",
    "sector",
    "box_plot",
    "construction_diagram",
    "food_web",
    "particle_model",
    "process_flow",
    "force_diagram",
}


@dataclass(frozen=True)
class ValidationIssue:
    severity: str
    code: str
    message: str
    exercise_id: str = "unknown"
    file: str = ""


def _issue(severity: str, code: str, message: str, ex: dict[str, Any], file_label: str) -> ValidationIssue:
    return ValidationIssue(severity, code, message, str(ex.get("id", "unknown")), file_label)


def has_bare_units(block: str):
    stripped = re.sub(r"\\text\{[^}]*\}", "", block)
    return BARE_UNITS.search(stripped)


def would_auto_wrap(text: str) -> bool:
    if "$" in text:
        return False
    if not re.search(r"[\^_][a-zA-Z0-9{]", text):
        return False
    return bool(re.search(r"\d", text)) or bool(re.search(r"\\[a-zA-Z]", text))


def lint_exercise_text(ex: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    fields = ["question", "answer", "sample_reasoning"]

    for field in fields:
        text = ex.get(field, "")
        if not text:
            continue

        if CONTROL_CHARS.search(str(text)):
            errors.append(f"{field}: contains unsupported control character; check escaped LaTeX commands")

        cleaned_text = re.sub(r"\\+\$", "", str(text))
        if cleaned_text.count("$") % 2 != 0:
            errors.append(f"{field}: unbalanced '$' delimiters")

        display_blocks = re.findall(r"\$\$(.+?)\$\$", cleaned_text, re.DOTALL)
        text_no_display = re.sub(r"\$\$.+?\$\$", "", cleaned_text, flags=re.DOTALL)
        inline_blocks = re.findall(r"\$(.+?)\$", text_no_display, re.DOTALL)

        for block in display_blocks + inline_blocks:
            doubled_bs = re.findall(r"\\\\([a-zA-Z]+)", block)
            if doubled_bs:
                errors.append(f"{field}: doubled backslash before {doubled_bs} in math block: ${block}$")
            if "√" in block:
                errors.append(f"{field}: Unicode square root inside math block, use \\sqrt{{}} instead: ${block}$")
            if block.count("{") != block.count("}"):
                errors.append(f"{field}: mismatched braces in block: ${block}$")
            if len(LEFT_DELIMITER.findall(block)) != len(RIGHT_DELIMITER.findall(block)):
                errors.append(f"{field}: mismatched \\left and \\right in block: ${block}$")

            unit_match = has_bare_units(block)
            if unit_match:
                errors.append(f"{field}: bare unit '{unit_match.group(1)}' in math block without \\text{{}} wrapping: ${block}$")

            commands = re.findall(r"(?<!\\)\\(?![\\$])([a-zA-Z]+)", block)
            for cmd, hint in {"choose": "use \\binom instead", "over": "use \\frac instead"}.items():
                if cmd in commands:
                    errors.append(f"{field}: deprecated command '\\{cmd}' in block: ${block}$ - {hint}")
            for cmd in ("label", "ref"):
                if cmd in commands:
                    errors.append(f"{field}: unsupported command '\\{cmd}' used in block: ${block}$")

        for env in ("equation", "align", "eqnarray"):
            if f"\\begin{{{env}}}" in str(text) or f"\\end{{{env}}}" in str(text):
                errors.append(f"{field}: unsupported '{env}' environment found")
        if re.search(r"\\[()\[\]]", str(text)):
            errors.append(f"{field}: uses \\(...\\) or \\[...\\] delimiters, use $...$ or $$...$$ instead")

    for idx, choice in enumerate(ex.get("choices") or []):
        if CONTROL_CHARS.search(str(choice)):
            errors.append(f"choices[{idx}]: contains unsupported control character; check escaped LaTeX commands")
        cleaned_choice = re.sub(r"\\+\$", "", str(choice))
        if cleaned_choice.count("$") % 2 != 0:
            errors.append(f"choices[{idx}]: unbalanced '$' delimiters")
        for block in re.findall(r"\$(.+?)\$", cleaned_choice, re.DOTALL):
            if re.findall(r"\\\\([a-zA-Z]+)", block):
                errors.append(f"choices[{idx}]: doubled backslash in block: ${block}$")
            if block.count("{") != block.count("}"):
                errors.append(f"choices[{idx}]: mismatched braces in block: ${block}$")
            unit_match = has_bare_units(block)
            if unit_match:
                errors.append(f"choices[{idx}]: bare unit '{unit_match.group(1)}' in math block without \\text{{}} wrapping: ${block}$")
        if re.search(r"\\[()\[\]]", str(choice)):
            errors.append(f"choices[{idx}]: uses \\(...\\) or \\[...\\] delimiters")

    for idx, step in enumerate(ex.get("steps", [])):
        step_text = str(step)
        if CONTROL_CHARS.search(step_text):
            errors.append(f"steps[{idx}]: contains unsupported control character; check escaped LaTeX commands")
        if "$" not in step_text and re.search(r"(\^|_|\\[a-zA-Z]+)", step_text):
            errors.append(f"steps[{idx}]: math-like content without $ delimiters")
        if would_auto_wrap(step_text) and re.search(r"[a-zA-Z]{3,}", step_text):
            errors.append(f"steps[{idx}]: auto-wrap may mangle English text")
        if re.sub(r"\\+\$", "", step_text).count("$") % 2 != 0:
            errors.append(f"steps[{idx}]: unbalanced '$' delimiters")

    return errors


def _text_lint_severity(message: str) -> str:
    if "math-like content without $ delimiters" in message:
        return "warning"
    if "auto-wrap may mangle English text" in message:
        return "warning"
    return "error"


def load_framework_registry(data_dir: Path) -> dict[str, dict[str, Any]]:
    path = data_dir / "curriculum" / "frameworks.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    return {fw["framework_id"]: fw for fw in data.get("frameworks", [])}


def load_topic_registry(data_dir: Path) -> dict[str, dict[str, Any]]:
    topics: dict[str, dict[str, Any]] = {}
    for path in (data_dir / "curriculum").rglob("*.json"):
        if path.name in {"frameworks.json", "index.json"}:
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        framework = data.get("framework_id")
        year_match = re.match(r"year(\d+)\.json$", path.name)
        file_year = int(year_match.group(1)) if year_match else None
        for topic in data.get("topics", []):
            topic_id = topic.get("topic_id")
            if not topic_id:
                continue
            unit_match = re.search(r"_U([1-4])(?:_|$)", topic_id)
            topics[topic_id] = {
                "framework": topic.get("framework") or framework,
                "year_level": topic.get("year_level") or file_year,
                "unit": topic.get("unit") or (int(unit_match.group(1)) if unit_match else None),
            }
    return topics


def validate_english_stimuli_file(
    data_dir: Path,
    topic_registry: dict[str, dict[str, Any]],
) -> tuple[dict[str, dict[str, Any]], list[ValidationIssue]]:
    path = data_dir / "english_stimuli.json"
    issues: list[ValidationIssue] = []
    if not path.exists():
        issues.append(ValidationIssue("error", "stimuli_missing", "english_stimuli.json is missing", "file", str(path)))
        return {}, issues

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        records = validate_stimulus_library(raw)
    except json.JSONDecodeError as exc:
        issues.append(ValidationIssue("error", "stimuli_invalid_json", str(exc), "file", str(path)))
        return {}, issues
    except StimulusValidationError as exc:
        issues.append(ValidationIssue("error", "stimuli_schema_invalid", str(exc), "file", str(path)))
        return {}, issues

    for stimulus_id, record in records.items():
        for topic_id in record.get("curriculum_links") or []:
            topic = topic_registry.get(str(topic_id))
            if not topic:
                issues.append(ValidationIssue("error", "stimuli_unknown_curriculum_link", f"curriculum link {topic_id!r} is not in curriculum", stimulus_id, str(path)))
                continue
            if topic.get("framework") != "AC9_ENGLISH":
                issues.append(ValidationIssue("error", "stimuli_curriculum_framework", f"curriculum link {topic_id!r} belongs to {topic.get('framework')}", stimulus_id, str(path)))
            record_year = record.get("year_level")
            if record_year and topic.get("year_level") != record_year:
                issues.append(ValidationIssue("error", "stimuli_curriculum_year", f"curriculum link {topic_id!r} is Year {topic.get('year_level')}, not stimulus Year {record_year}", stimulus_id, str(path)))

    return records, issues


def _local_asset_exists(asset: str, public_dir: Path) -> bool:
    if asset.startswith(("http://", "https://", "data:")):
        return True
    cleaned = asset.split("#", 1)[0].split("?", 1)[0].lstrip("/")
    return (public_dir / cleaned).exists() or Path(cleaned).exists()


def _subject_allowed(ex_subject: str, framework: dict[str, Any]) -> bool:
    supported = set(framework.get("supported_subjects") or [])
    subject_suffix = framework.get("subject_suffix")
    allowed = supported | {subject_suffix} | {f"senior_{subject}" for subject in supported}
    return ex_subject in allowed


def validate_collection(
    exercises: list[dict[str, Any]],
    *,
    topic_registry: dict[str, dict[str, Any]] | None = None,
    framework_registry: dict[str, dict[str, Any]] | None = None,
    stimulus_records: dict[str, dict[str, Any]] | None = None,
    public_dir: Path | None = None,
    file_label: str = "",
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    topic_registry = topic_registry or {}
    framework_registry = framework_registry or {}
    stimulus_records = stimulus_records or {}
    public_dir = public_dir or Path("frontend/public")

    for ex in exercises:
        try:
            ExerciseItem.model_validate(ex)
        except ValidationError as exc:
            issues.append(_issue("error", "schema_invalid", str(exc.errors()[0].get("msg", exc)), ex, file_label))

        if ex.get("status", "active") != "active":
            continue

        for msg in lint_exercise_text(ex):
            issues.append(_issue(_text_lint_severity(msg), "text_lint", msg, ex, file_label))

        framework = framework_registry.get(str(ex.get("framework", "")))
        if framework and not _subject_allowed(str(ex.get("subject", "")), framework):
            issues.append(_issue("error", "subject_framework_mismatch", "subject is not compatible with framework", ex, file_label))

        for topic_id in ex.get("topic_ids") or []:
            topic = topic_registry.get(str(topic_id))
            if not topic:
                issues.append(_issue("error", "unknown_topic_id", f"topic_id {topic_id!r} is not in curriculum", ex, file_label))
                continue
            if ex.get("framework") and topic.get("framework") and ex.get("framework") != topic.get("framework"):
                issues.append(_issue("error", "topic_framework_mismatch", f"topic_id {topic_id!r} belongs to {topic.get('framework')}", ex, file_label))
            if ex.get("year_level") and topic.get("year_level") and int(ex["year_level"]) != int(topic["year_level"]):
                issues.append(_issue("error", "topic_year_mismatch", f"topic_id {topic_id!r} is Year {topic.get('year_level')}", ex, file_label))
            if ex.get("unit") and topic.get("unit") and int(ex["unit"]) != int(topic["unit"]):
                issues.append(_issue("error", "topic_unit_mismatch", f"topic_id {topic_id!r} is Unit {topic.get('unit')}", ex, file_label))

        diagram_data = ex.get("diagram_data")
        if diagram_data:
            diagram_type = diagram_data.get("type") if isinstance(diagram_data, dict) else None
            if not diagram_type:
                issues.append(_issue("error", "diagram_type_missing", "diagram_data must include a type", ex, file_label))
            elif diagram_type not in SUPPORTED_DIAGRAM_TYPES:
                issues.append(_issue("error", "unsupported_diagram_type", f"diagram_data.type {diagram_type!r} is not supported by DiagramRenderer", ex, file_label))

        assets = []
        if ex.get("image"):
            assets.append(str(ex["image"]))
        for field in ("question", "answer", "sample_reasoning"):
            assets.extend(MARKDOWN_IMAGE.findall(str(ex.get(field, ""))))
        for asset in assets:
            if not _local_asset_exists(asset, public_dir):
                issues.append(_issue("error", "missing_image_asset", f"image asset not found: {asset}", ex, file_label))

        science_metadata = ex.get("science_metadata") or {}
        representation = science_metadata.get("data_representation") if isinstance(science_metadata, dict) else None
        if representation in {"table", "graph", "diagram"} and not (ex.get("diagram_data") or ex.get("image")):
            issues.append(_issue("warning", "science_representation_without_visual", f"science {representation} task has no diagram_data or image", ex, file_label))

        english_metadata = ex.get("english_metadata") or {}
        passage = None
        if isinstance(english_metadata, dict):
            passage = english_metadata.get("stimulus_id") or english_metadata.get("passage")
        if (
            ex.get("subject") == "english"
            and isinstance(passage, str)
            and passage.startswith("ST-EN-")
        ):
            record = stimulus_records.get(passage)
            if not record:
                issues.append(_issue("error", "missing_english_stimulus", f"stimulus_id {passage!r} is not in english_stimuli.json", ex, file_label))
            else:
                display = record.get("student_display")
                plain_text = display.get("plain_text") if isinstance(display, dict) else None
                if not isinstance(plain_text, str) or not plain_text.strip():
                    issues.append(_issue("error", "english_stimulus_missing_plain_text", f"stimulus_id {passage!r} has no student_display.plain_text", ex, file_label))
                if record.get("year_level") and ex.get("year_level") and int(record["year_level"]) != int(ex["year_level"]):
                    issues.append(_issue("error", "english_stimulus_year_mismatch", f"stimulus_id {passage!r} is Year {record.get('year_level')}", ex, file_label))

    return issues


def validate_files(files: list[Path], *, data_dir: Path) -> list[ValidationIssue]:
    topic_registry = load_topic_registry(data_dir)
    framework_registry = load_framework_registry(data_dir)
    public_dir = data_dir.parent / "frontend" / "public"
    stimulus_records, stimulus_issues = validate_english_stimuli_file(data_dir, topic_registry)
    issues: list[ValidationIssue] = []
    seen_ids: dict[str, str] = {}
    issues.extend(stimulus_issues)

    for path in files:
        try:
            exercises = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            issues.append(ValidationIssue("error", "invalid_json", str(exc), "file", str(path)))
            continue
        if not isinstance(exercises, list):
            issues.append(ValidationIssue("error", "invalid_file_shape", "exercise file must contain a top-level list", "file", str(path)))
            continue

        for ex in exercises:
            ex_id = str(ex.get("id", "unknown"))
            if ex_id in seen_ids:
                issues.append(ValidationIssue("error", "duplicate_id", f"duplicate exercise id also found in {seen_ids[ex_id]}", ex_id, str(path)))
            else:
                seen_ids[ex_id] = str(path)

        issues.extend(
            validate_collection(
                exercises,
                topic_registry=topic_registry,
                framework_registry=framework_registry,
                stimulus_records=stimulus_records,
                public_dir=public_dir,
                file_label=str(path),
            )
        )
    return issues


def discover_exercise_files(project_root: Path, gate: str) -> list[Path]:
    if gate == "scratch":
        files = sorted((project_root / "scratch").glob("qldtutor_*.json"))
        excluded = re.compile(r"artefact|bak|pre_|pre-|pre_repair|pre_latex|pre-answersplit")
        return [path for path in files if not excluded.search(path.name)]
    return sorted((project_root / "data").glob("exercise_*.json"))


def _inventory_records(files: list[Path]) -> tuple[list[dict[str, Any]], dict[str, dict[str, int]]]:
    active: list[dict[str, Any]] = []
    per_file: dict[str, dict[str, int]] = {}
    for path in files:
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, list):
            continue
        active_count = sum(
            1 for item in raw
            if isinstance(item, dict) and item.get("status", "active") != "draft"
        )
        draft_count = sum(
            1 for item in raw
            if isinstance(item, dict) and item.get("status", "active") == "draft"
        )
        active.extend(
            item for item in raw
            if isinstance(item, dict) and item.get("status", "active") != "draft"
        )
        per_file[path.name] = {"active": active_count, "draft": draft_count}
    return active, per_file


def render_inventory_markdown(files: list[Path]) -> str:
    active, per_file = _inventory_records(files)
    subject_counts: dict[str, int] = {}
    for item in active:
        subject = str(item.get("subject") or "unknown")
        subject_counts[subject] = subject_counts.get(subject, 0) + 1

    draft_total = sum(counts["draft"] for counts in per_file.values())
    active_total = len(active)

    def count(name: str) -> str:
        values = per_file.get(name, {"active": 0, "draft": 0})
        suffix = f" active + {values['draft']} draft" if values["draft"] else ""
        return f"{values['active']:,}{suffix}"

    draft_labels: list[str] = []
    junior_subject_names = {"math": "Mathematics", "english": "English", "science": "Science"}
    for name, values in per_file.items():
        if not values["draft"]:
            continue
        match = re.fullmatch(r"exercise_(\d+)_(math|english|science)\.json", name)
        if match:
            draft_labels.append(
                f"{values['draft']} Year {match.group(1)} {junior_subject_names[match.group(2)]}"
            )
        else:
            draft_labels.append(f"{values['draft']} in {name}")
    draft_note = " and ".join(draft_labels) if draft_labels else "none"

    return "\n".join([
        "<!-- content-inventory:start (generated by scripts/check_exercises.py --update-readme) -->",
        f"Counts below are active authored exercise records read from the current files under `data/`. Runtime practice, diagnostics, generated papers, coverage checks and content audits exclude records marked with `\"status\": \"draft\"`; the repository currently has **{active_total:,} active records** plus {draft_total} drafts ({draft_note}) that are not selectable as practice content.",
        "",
        "| Curriculum/course | Scope | Authored items | Practice status |",
        "| --- | ---: | ---: | --- |",
        f"| AC9 Mathematics | Years 7–10 | {subject_counts.get('math', 0):,} | Available |",
        f"| AC9 English | Years 7–10 | {subject_counts.get('english', 0):,} | Available; reading/viewing items can use `data/english_stimuli.json` |",
        f"| AC9 Science | Years 7–10 | {subject_counts.get('science', 0):,} | Available; {sum(v['draft'] for k, v in per_file.items() if '_science' in k)} additional draft records are excluded |",
        f"| QCAA Mathematical Methods | Units 1–4 | {subject_counts.get('methods', 0):,} | Available |",
        f"| QCAA Specialist Mathematics | Units 1–4 | {subject_counts.get('specialist', 0):,} | Available |",
        "| QCAA senior English | Writing Hub and curriculum mapping | No standalone exercise bank | Writing feedback available |",
        "| Other registered QCAA courses | Curriculum shells/registry entries | No authored exercise bank | Not selectable as authored practice content |",
        "",
        f"The repository contains **{active_total:,} active** authored exercise records (**{active_total + draft_total:,}** records including {draft_total} drafts: {draft_note}). Per-file counts are:",
        "",
        "| Bank | Year/unit files | Items |",
        "| --- | --- | ---: |",
        f"| Mathematics | Year 7 / 8 / 9 / 10 | {count('exercise_7_math.json')} / {count('exercise_8_math.json')} / {count('exercise_9_math.json')} / {count('exercise_10_math.json')} |",
        f"| English | Year 7 / 8 / 9 / 10 | {count('exercise_7_english.json')} / {count('exercise_8_english.json')} / {count('exercise_9_english.json')} / {count('exercise_10_english.json')} |",
        f"| Science | Year 7 / 8 / 9 / 10 | {count('exercise_7_science.json')} / {count('exercise_8_science.json')} / {count('exercise_9_science.json')} / {count('exercise_10_science.json')} |",
        f"| Mathematical Methods | Units 1–2 / Units 3–4 | {count('exercise_methods_u1_u2.json')} / {count('exercise_methods_u3_u4.json')} |",
        f"| Specialist Mathematics | Units 1–2 / Units 3–4 | {count('exercise_specialist_u1_u2.json')} / {count('exercise_specialist_u3_u4.json')} |",
        "<!-- content-inventory:end -->",
    ])


def update_readme_inventory(readme_path: Path, inventory: str) -> None:
    text = readme_path.read_text(encoding="utf-8")
    start_marker = "<!-- content-inventory:start"
    end_marker = "<!-- content-inventory:end -->"
    if start_marker in text and end_marker in text:
        start = text.index(start_marker)
        end = text.index(end_marker, start) + len(end_marker)
        updated = text[:start] + inventory + text[end:]
    else:
        heading = "## Current content inventory\n"
        following = "\nThe content-availability API"
        start = text.index(heading) + len(heading)
        end = text.index(following, start)
        updated = text[:start] + "\n" + inventory + "\n" + text[end:]
    readme_path.write_text(updated, encoding="utf-8")


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Validate authored exercise banks.")
    parser.add_argument(
        "--gate",
        choices=("production", "scratch"),
        default="production",
        help="Validate deployable data banks or authoring scratch banks separately.",
    )
    parser.add_argument(
        "--inventory",
        action="store_true",
        help="Print the generated production inventory block.",
    )
    parser.add_argument(
        "--update-readme",
        action="store_true",
        help="Refresh the generated production inventory in docs/readme/content.md after a clean validation.",
    )
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parents[1]
    data_dir = project_root / "data"
    files = discover_exercise_files(project_root, args.gate)
    if not files:
        print(f"No exercise files found for {args.gate} gate.")
        return 1

    issues = validate_files(files, data_dir=data_dir)
    errors = [issue for issue in issues if issue.severity == "error"]
    warnings = [issue for issue in issues if issue.severity == "warning"]

    for issue in issues:
        print(f"{issue.severity.upper()} {issue.code} {issue.file} {issue.exercise_id}: {issue.message}")

    if args.inventory:
        if args.gate != "production":
            parser.error("--inventory is only available for the production gate")
        print(render_inventory_markdown(files))

    if args.update_readme:
        if args.gate != "production":
            parser.error("--update-readme is only available for the production gate")
        if errors:
            print("Content inventory was not updated because the production gate has errors.")
        else:
            # The inventory moved from README.md to docs/readme/content.md.
            update_readme_inventory(project_root / "docs" / "readme" / "content.md", render_inventory_markdown(files))
            print("Updated content inventory in docs/readme/content.md.")

    print(
        f"Checked {len(files)} {args.gate} exercise files. "
        f"Errors: {len(errors)}. Warnings: {len(warnings)}."
    )
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
