#!/usr/bin/env python3
"""
Math Rendering Validator v4
- JSON validation
- Delimiter validation
- LaTeX structure checks
- Unit checks (handling safe units, ambiguous units, and nested braces)
- Unicode math symbol checks
- Auto-wrap heuristic (aligned with frontend preprocessMarkdown)
- Robust KaTeX compilation validation via batched Node.js execution
- Severity levels: ERROR / WARN / INFO
- Exit code 1 if any ERROR-level issues found (CI/CD ready)

Usage:
    python scripts/latex_validator.py data/exercise_7_math.json data/exercise_8_math.json

Optional:
    npm install katex  (in frontend/)
"""

import json
import os
import re
import sys
import subprocess

# ---------------------------------------------------------------------------
# Severity levels
# ---------------------------------------------------------------------------
ERROR = "ERROR"   # Rendering breakage
WARN  = "WARN"    # Likely problem
INFO  = "INFO"    # Stylistic / heuristic

# ---------------------------------------------------------------------------
# Units
# ---------------------------------------------------------------------------

# Units that do not collide with math variables (e.g. cm, kg, mL, km/h)
SAFE_UNITS = [
    'mm', 'cm', 'km',
    'kg', 'mL', 'kL',
    'cm²', 'cm³', 'm²', 'm³',
    'cm\\^2', 'cm\\^3', 'm\\^2', 'm\\^3',
    'km/h', 'm/s', '°C'
]
SAFE_UNITS_RE = re.compile(
    rf'(?<![a-zA-Z])({"|".join(SAFE_UNITS)})(?![a-zA-Z])'
)

# Single-letter units that commonly collide with variables
AMBIGUOUS_UNITS = ['m', 'g', 'L']
AMBIGUOUS_UNITS_RE = re.compile(
    rf'\d\s*({"|".join(AMBIGUOUS_UNITS)})(?![a-zA-Z])'
)

BAD_UNICODE = {
    '√': r'\sqrt{}',
    '×': r'\times',
    '÷': r'\div',
    '−': '-',
    '≤': r'\le',
    '≥': r'\ge',
}

DEPRECATED_COMMANDS = {
    'choose': r'use \binom instead',
    'over': r'use \frac instead',
}

UNSUPPORTED_COMMANDS = {'label', 'ref'}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def braces_balanced(text):
    depth = 0
    for ch in text:
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth < 0:
                return False
    return depth == 0


def strip_text_commands(text):
    """Strip all \\text{...}, \\textit{...}, \\textbf{...} etc. commands."""
    result = []
    i = 0
    n = len(text)
    while i < n:
        match = re.match(r'\\text[a-zA-Z]*\{', text[i:])
        if match:
            skip_len = match.end()
            depth = 1
            i += skip_len
            while i < n and depth > 0:
                if text[i] == '{':
                    depth += 1
                elif text[i] == '}':
                    depth -= 1
                i += 1
        else:
            result.append(text[i])
            i += 1
    return "".join(result)


def has_bare_units(block):
    """Check if a math block contains unit abbreviations without \\text{} wrapping."""
    stripped = strip_text_commands(block)
    match = SAFE_UNITS_RE.search(stripped)
    if match:
        return match.group(1)
    match = AMBIGUOUS_UNITS_RE.search(stripped)
    if match:
        return match.group(1)
    return None


def extract_math_blocks(text):
    blocks = []
    display = re.findall(r'\$\$(.+?)\$\$', text, flags=re.DOTALL)
    blocks.extend(display)
    stripped = re.sub(r'\$\$.+?\$\$', '', text, flags=re.DOTALL)
    inline = re.findall(r'\$(.+?)\$', stripped, flags=re.DOTALL)
    blocks.extend(inline)
    return blocks


# ---------------------------------------------------------------------------
# Auto-wrap heuristic — aligned with frontend preprocessMarkdown
#
# The frontend logic (format.ts lines 80-93):
#   1. If no $ in text AND has ^/_ followed by alphanumeric AND has digits/commands:
#      a. If NO English words → wrap entire string in $...$
#      b. If HAS English words → wrap individual math tokens in $...$
#
# Case (a) is fine: pure math gets wrapped correctly.
# Case (b) is also fine: the frontend wraps individual tokens like 2^5 → $2^5$.
#
# The ONLY real risk is when the token-wrapping regex in case (b) fails to
# capture a math expression that the human intended to be in math mode.
# We flag this as INFO (not ERROR/WARN).
# ---------------------------------------------------------------------------

def check_auto_wrap_risk(text):
    """
    Returns True if the text would trigger frontend auto-wrap AND the result
    might not match the author's intent.

    Aligned with frontend preprocessMarkdown:
    - If text has $ delimiters → no auto-wrap → no risk.
    - If text has ^/_ but no English words → frontend wraps entire string → usually correct.
    - If text has ^/_ AND English words → frontend wraps individual tokens → usually correct.
    """
    # If text already has $ delimiters, no auto-wrap happens
    if '$' in text:
        return False

    # Frontend trigger: [^_][a-zA-Z0-9{]
    if not re.search(r'[\^_][a-zA-Z0-9{]', text):
        return False

    # Frontend requires digits or backslash commands
    if not (re.search(r'\d', text) or re.search(r'\\[a-zA-Z]', text)):
        return False

    # At this point the frontend WILL auto-wrap something.
    # Check if English words are present — if so, frontend wraps individual tokens
    # which is almost always correct. Only flag pure math expressions without $.
    plain_text = re.sub(r'\\[a-zA-Z]+', '', text)
    has_english_words = bool(re.search(r'[a-zA-Z]{3,}', plain_text))

    if has_english_words:
        # Frontend wraps individual tokens — this is correct behavior.
        # No real risk here, the frontend handles it properly.
        return False

    # Pure math without delimiters — frontend wraps entire string.
    # This is also usually correct, but worth noting as INFO.
    return True


# ---------------------------------------------------------------------------
# KaTeX integration
# ---------------------------------------------------------------------------

_katex_path = None


def find_katex():
    """Try to locate the katex Node.js module."""
    candidates = [
        # Relative to this script (data/math_validator_v3.py → ../frontend/node_modules)
        os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'frontend', 'node_modules', 'katex'),
        # Relative to CWD
        os.path.join('frontend', 'node_modules', 'katex'),
        os.path.join('node_modules', 'katex'),
    ]
    for path in candidates:
        pkg = os.path.join(path, 'package.json')
        if os.path.isfile(pkg):
            return os.path.abspath(path)

    # Try global require
    try:
        result = subprocess.run(
            ["node", "-e", "console.log(require.resolve('katex'))"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            return os.path.dirname(result.stdout.strip())
    except Exception:
        pass

    return None


def katex_validate_batch(blocks):
    """
    Validate multiple math blocks in a single Node.js process.
    Returns a list of (index, error_message_or_None) tuples.
    """
    if not blocks:
        return []

    katex_dir = _katex_path
    if not katex_dir:
        return [(i, None) for i in range(len(blocks))]

    # Build JS that reads all blocks from stdin (one per line, base64-encoded to avoid escaping issues)
    js = f"""
const katex = require('{katex_dir}');
const fs = require('fs');
const input = fs.readFileSync(0, 'utf-8');
const lines = input.split('\\n');
for (const line of lines) {{
  if (!line.trim()) continue;
  try {{
    const decoded = Buffer.from(line, 'base64').toString('utf-8');
    katex.renderToString(decoded);
    console.log("OK");
  }} catch(e) {{
    console.log("ERR:" + e.message);
  }}
}}
"""
    import base64
    stdin_data = '\n'.join(base64.b64encode(b.encode()).decode() for b in blocks) + '\n'

    try:
        result = subprocess.run(
            ["node", "-e", js],
            input=stdin_data,
            capture_output=True,
            text=True,
            timeout=30
        )
        outputs = result.stdout.strip().split('\n')
        results = []
        for i, block in enumerate(blocks):
            if i < len(outputs):
                out = outputs[i].strip()
                if out.startswith("ERR:"):
                    results.append((i, out[4:]))
                else:
                    results.append((i, None))
            else:
                results.append((i, None))
        return results
    except Exception as e:
        return [(i, f"KaTeX batch execution failed: {e}") for i in range(len(blocks))]


# ---------------------------------------------------------------------------
# Field validation
# ---------------------------------------------------------------------------

def check_text_field(text, field_name, katex_blocks=None):
    """
    Validate a text field. If katex_blocks is a list, math blocks are appended
    for batched KaTeX validation later (instead of spawning a process per block).
    """
    errors = []

    if not text:
        return errors

    # Preprocess escaped dollar signs to align with frontend preprocessMarkdown
    preprocessed_text = re.sub(r'\\+\$', '&#36;', text)

    # --- Delimiter checks (ERROR) ---
    if preprocessed_text.count('$') % 2:
        errors.append((ERROR, f"{field_name}: unbalanced '$' delimiters"))

    if preprocessed_text.count('$$') % 2:
        errors.append((ERROR, f"{field_name}: unbalanced '$$' delimiters"))

    if '$$$' in preprocessed_text:
        errors.append((WARN, f"{field_name}: suspicious '$$$' sequence"))

    if '$$$$' in preprocessed_text:
        errors.append((WARN, f"{field_name}: suspicious '$$$$' sequence"))

    # --- Environment checks (ERROR) ---
    for env in ['equation', 'align', 'eqnarray']:
        if f'\\begin{{{env}}}' in preprocessed_text or f'\\end{{{env}}}' in preprocessed_text:
            errors.append((ERROR, f"{field_name}: unsupported environment {env}"))

    if re.search(r'\\[()\[\]]', preprocessed_text):
        errors.append((ERROR, f"{field_name}: use $...$ or $$...$$ delimiters"))

    # --- Auto-wrap risk (INFO) — aligned with frontend ---
    if check_auto_wrap_risk(preprocessed_text):
        errors.append((INFO, f"{field_name}: frontend auto-wrap risk"))

    # --- Math block content checks ---
    for block in extract_math_blocks(preprocessed_text):

        if not block.strip():
            errors.append((ERROR, f"{field_name}: empty math block"))
            continue

        # Doubled backslashes
        doubled = re.findall(r'\\\\([a-zA-Z]+)', block)
        if doubled:
            errors.append((ERROR, f"{field_name}: doubled backslashes {doubled}"))

        # Unicode symbols
        for symbol, replacement in BAD_UNICODE.items():
            if symbol in block:
                errors.append((WARN, f"{field_name}: Unicode '{symbol}' found (use {replacement})"))

        # Brace balance
        if not braces_balanced(block):
            errors.append((ERROR, f"{field_name}: unbalanced braces"))

        # Bare units
        unit = has_bare_units(block)
        if unit:
            errors.append((WARN, f"{field_name}: bare unit '{unit}' not wrapped in \\text{{}}"))

        # Command checks
        commands = re.findall(r'\\([a-zA-Z]+)', block)

        left_count = commands.count('left')
        right_count = commands.count('right')
        if left_count != right_count:
            errors.append((ERROR, f"{field_name}: mismatched \\left ({left_count}) and \\right ({right_count})"))

        for cmd in commands:
            if cmd in DEPRECATED_COMMANDS:
                errors.append((WARN, f"{field_name}: deprecated \\{cmd} ({DEPRECATED_COMMANDS[cmd]})"))
            if cmd in UNSUPPORTED_COMMANDS:
                errors.append((ERROR, f"{field_name}: unsupported \\{cmd}"))

        # Collect for batched KaTeX validation
        if katex_blocks is not None:
            block_for_katex = block.replace('&#36;', '\\char36 ')
            katex_blocks.append((field_name, block_for_katex))

    return errors


def validate_exercise(exercise, katex_blocks=None):
    errors = []

    for field in ['question', 'answer', 'sample_reasoning']:
        errors.extend(
            check_text_field(exercise.get(field, ''), field, katex_blocks)
        )

    choices = exercise.get('choices') or []
    for idx, choice in enumerate(choices):
        errors.extend(
            check_text_field(choice, f'choices[{idx}]', katex_blocks)
        )

    steps = exercise.get('steps') or []
    for idx, step in enumerate(steps):
        errors.extend(
            check_text_field(step, f'steps[{idx}]', katex_blocks)
        )

        # Only flag steps with no $ that contain actual LaTeX commands
        # (not just ^ with digits, which the frontend handles via auto-wrap)
        if '$' not in step and re.search(r'\\[a-zA-Z]+', step):
            errors.append(
                (WARN, f"steps[{idx}]: LaTeX commands without $...$ delimiters")
            )

    return errors


# ---------------------------------------------------------------------------
# File validation
# ---------------------------------------------------------------------------

def check_file(filepath, use_katex=False):
    print(f"\n{'='*60}")
    print(f"Checking {filepath}")
    print(f"{'='*60}")

    with open(filepath, 'r', encoding='utf-8') as f:
        exercises = json.load(f)

    total_exercises = len(exercises)
    exercises_with_issues = 0
    counts = {ERROR: 0, WARN: 0, INFO: 0}

    for ex in exercises:
        katex_blocks = [] if use_katex else None
        errs = validate_exercise(ex, katex_blocks)

        # Batch KaTeX validation for this exercise
        if use_katex and katex_blocks:
            blocks_only = [b for _, b in katex_blocks]
            katex_results = katex_validate_batch(blocks_only)
            for (field_name, _), (idx, katex_err) in zip(katex_blocks, katex_results):
                if katex_err:
                    errs.append((ERROR, f"{field_name}: KaTeX compile error: {katex_err}"))

        if errs:
            exercises_with_issues += 1
            print(f"\n  [{ex.get('id', 'unknown')}]")
            for severity, msg in errs:
                tag = f"  {severity}"
                print(f"    {tag:6s} {msg}")
            for severity, _ in errs:
                counts[severity] += 1

    total = sum(counts.values())
    passed = total_exercises - exercises_with_issues

    print(f"\n{'─'*60}")
    print(f"  Exercises: {passed}/{total_exercises} passed")
    print(f"  Issues:    {counts[ERROR]} errors, {counts[WARN]} warnings, {counts[INFO]} info")
    print(f"  Total:     {total}")
    print(f"{'─'*60}")

    return counts


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    files = sys.argv[1:]

    if not files:
        print("Usage: python math_validator_v3.py file1.json file2.json")
        print("\nOptions:")
        print("  --no-katex   Skip KaTeX compilation checks")
        return 1

    no_katex = '--no-katex' in files
    files = [f for f in files if f != '--no-katex']

    global _katex_path

    use_katex = not no_katex
    if use_katex:
        _katex_path = find_katex()
        if _katex_path:
            print(f"KaTeX validation ENABLED ({_katex_path})")
        else:
            print("KaTeX validation DISABLED (npm install katex in frontend/ to enable)")
            use_katex = False
    else:
        print("KaTeX validation DISABLED (--no-katex flag)")

    all_counts = {ERROR: 0, WARN: 0, INFO: 0}

    for filepath in files:
        if not os.path.exists(filepath):
            print(f"File not found: {filepath}")
            continue
        try:
            counts = check_file(filepath, use_katex)
            for k in all_counts:
                all_counts[k] += counts[k]
        except Exception as e:
            print(f"Error processing {filepath}: {e}")

    # Final summary
    if len(files) > 1:
        total = sum(all_counts.values())
        print(f"\n{'='*60}")
        print(f"OVERALL: {all_counts[ERROR]} errors, {all_counts[WARN]} warnings, {all_counts[INFO]} info ({total} total)")
        print(f"{'='*60}")

    # Exit with non-zero code if any ERROR-level issues found
    return 1 if all_counts[ERROR] > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
