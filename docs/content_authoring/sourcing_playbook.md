# Content Authoring & Sourcing Playbook

This playbook is the **source-of-truth workflow** for adding or changing curriculum-aligned content in Qld_tutor: curriculum slices, concept cards, exercise banks, misconceptions, and approvals.

It covers the **current inventory** (not the original Year 7 Maths seed drop alone):

| Area | Scope | Practice banks |
| --- | --- | --- |
| AC9 Mathematics | Years 7–10 | `data/exercise_{7,8,9,10}_math.json` |
| AC9 English | Years 7–10 | `data/exercise_{7,8,9,10}_english.json` (+ stimuli) |
| AC9 Science | Years 7–10 | `data/exercise_{7,8,9,10}_science.json` |
| QCAA Mathematical Methods | Units 1–4 | `data/exercise_methods_u1_u2.json`, `…_u3_u4.json` |
| QCAA Specialist Mathematics | Units 1–4 | `data/exercise_specialist_u1_u2.json`, `…_u3_u4.json` |

Companion docs:

| Document | Use when |
| --- | --- |
| [importing_questions_from_web.md](./importing_questions_from_web.md) | Web/LLM-inspired **exercise** import (rewrite, schema, merge) |
| [../../data/latex_spec.md](../../data/latex_spec.md) | Math delimiters, units, escaping |
| [../../README.md](../../README.md) | Runtime architecture and audit command matrix |
| [../../core/schema/exercise_schema.py](../../core/schema/exercise_schema.py) | Canonical `ExerciseItem` |
| [../../core/schema/curriculum_schema.py](../../core/schema/curriculum_schema.py) | Curriculum / concept-card / `lesson_content` shapes |

> **Bottom line:** every artefact must be (a) traceable to a named primary source or original authorship, (b) **original wording** in student-facing fields (except official CC BY curriculum text), (c) schema-valid, and (d) attested where coverage gates expect it (e.g. `data/content_approvals.yaml` for AC9 Maths concept work).

---

## 1. What you are authoring

```text
data/curriculum/          Framework slices (topics, elaborations, concept_cards)
data/exercise_*.json      Practice items (ExerciseItem arrays)
data/english_stimuli.json Shared English passages (when used)
data/misconceptions/      Curated misconception library + worked examples (mainly AC9 Maths)
data/content_approvals.yaml
data/sources/             Upstream PDFs/MD you consulted (not loaded at runtime)
staging/                  Drafts only (never production)
```

Runtime loads **curriculum + exercise JSON** (and English stimuli). It does **not** read `data/sources/` PDFs as a RAG corpus.

### 1.1 Content map (production files)

| Kind | Paths |
| --- | --- |
| AC9 Maths curriculum | `data/curriculum/ac9_maths/year{7,8,9,10}.json` |
| AC9 English curriculum | `data/curriculum/ac9_english/year{7,8,9,10}.json` |
| AC9 Science curriculum | `data/curriculum/ac9_science/year{7,8,9,10}.json` |
| QCAA senior maths | `data/curriculum/qcaa_senior_maths/{methods,specialist,general,essential}.json` |
| Registry / index | `data/curriculum/frameworks.json`, `data/curriculum/index.json` |
| AC9 exercise banks | `data/exercise_{7–10}_{math,english,science}.json` |
| Senior exercise banks | `data/exercise_methods_u*.json`, `data/exercise_specialist_u*.json` |
| Misconceptions (AC9 Maths) | `data/misconceptions/prod/ac9_maths.json` |
| Worked examples (misconceptions) | `data/misconceptions/worked_examples/ac9_maths.json` |

Counts change over time; use `scripts/check_exercises.py` and bank statistics rather than hardcoded inventory numbers from older docs.

---

## 2. Primary sources and licensing

Use these in priority order.

### 2.1 ACARA Australian Curriculum v9 (CC BY 4.0)

Primary source for AC9 topics, achievement standards, content descriptors, and elaborations.

- **Portal**: https://v9.australiancurriculum.edu.au/
- **License**: CC BY 4.0
- **You may**: copy official elaborations/descriptors into curriculum records with correct ids and `source_ref`
- **You must**: keep official elaboration ids (e.g. `AC9M7N04_E1`); do not reword official text and re-label it as original ACARA prose

**Local alignment matrices (already in repo):**

| Learning area | Path pattern |
| --- | --- |
| Maths | `data/sources/Math/ac9_maths_yr{7,8,9,10}_as_cd_alignment.md` |
| English | `data/sources/English/ac9_english_yr{7,8,9,10}_as_cd_alignment.md` |
| Science | `data/sources/Science/` (curriculum content + CAP examples) |

Also: `data/sources/Math/mathematics_year_{7,8,9,10}.md` and English/Science v9 content digests.

### 2.2 QCAA senior syllabuses and instruments (CC BY 4.0 for syllabuses)

Primary source for Methods, Specialist, and other senior shells.

- **Portal**: https://www.qcaa.qld.edu.au/senior/senior-subjects
- **Local PDFs** (reference only — **do not paste exam stems** into banks):
  - `data/sources/Maths_Methods/` — syllabus, formula book, sample IA/EA materials
  - `data/sources/Specialist_maths/` — syllabus, formula book, sample instruments

Syllabus topic structure in production is encoded as `QCAA_<COURSE>_U<unit>_T<n>` in the curriculum JSON (e.g. `QCAA_METHODS_U3_T4`).

### 2.3 Textbooks, commercial sites, and past papers (RESTRICTED)

You may **read** these to understand typical year-level demand and item style.

You must **never** copy stems, options, stimulus text, or mark schemes verbatim into production JSON.

If structure was inspired by a named resource:

1. Fully rewrite the stem and change all numbers/context.
2. Record attribution (create the file if missing):

```yaml
# data/sources/exercise_attribution.yaml
attributions:
  methods_u3t4_sa99:
    inspired_by: "Public worksheet style: polynomial definite integrals"
    adaptation_notes: "Original stem; new limits and coefficients; new solution."
```

Detailed web-import steps: [importing_questions_from_web.md](./importing_questions_from_web.md).

### 2.4 Student-facing language

- Australian English: *maths*, *metre*, *recognise*, *colour*.
- Age-appropriate: short sentences; define jargon.
- Practice items are **formative**; never brand them as official QCAA/NAPLAN results.

---

## 3. Curriculum slices (topics and concept cards)

Curriculum for AC9 Y7–10 and major senior maths courses is **already populated**. Day-to-day work is usually **editing concept cards / lesson_content** or **adding exercises**, not rebuilding years from scratch.

### 3.1 When you must regenerate a slice

Only if you intentionally change alignment sources or add descriptors:

1. Update the alignment markdown under `data/sources/…`.
2. Run the matching migration (idempotent; preserve hand-authored concept cards carefully):

```powershell
# Examples — run only what you need
backend\venv\Scripts\python.exe -m backend.migrations.migrate_ac9_maths
backend\venv\Scripts\python.exe -m backend.migrations.migrate_ac9_english
backend\venv\Scripts\python.exe -m backend.migrations.migrate_ac9_science
backend\venv\Scripts\python.exe -m backend.migrations.migrate_qcaa_methods
backend\venv\Scripts\python.exe -m backend.migrations.generate_index
```

3. Diff the curriculum JSON before committing. Migrations can overwrite structural fields; re-check concept cards after a regen.

### 3.2 AC9 Maths concept card (per topic)

Helper (draft only → `staging/`, never writes `data/`):

```powershell
backend\venv\Scripts\python.exe -m backend.content_authoring.concept_card_helper --topic-id AC9M7N04
```

Expected shape (see `ConceptCard` in curriculum schema):

- `core_rule` — 30–240 characters; states the rule itself (not “this topic is about…”)
- `hint_levels` — at least `concept_reminder`, `step_prompt`, `analogy` (no multi-digit answer leakage; use placeholders like `<numerator>`)
- optional `worked_example` and `lesson_content`

`lesson_content` is validated as `LessonContent` by `core/schema/curriculum_schema.py`. It requires at least one `learning_objectives` entry and one `explanation_sections` entry; optional fields include vocabulary, common mistakes, real-world connections, worked examples, guided/independent practice, success criteria, and external resources. Unknown fields are rejected (`extra="forbid"`). Use the current curriculum JSON as the source of truth for topic ids and counts; do not copy a hard-coded topic inventory into authoring prompts.

Promote by editing the topic’s `concept_card` in e.g. `data/curriculum/ac9_maths/year7.json`.

### 3.3 Official elaborations

When attaching ACARA elaborations:

- `elaboration_id` prefix must match `topic_id` (e.g. `AC9M7N04_E1` on topic `AC9M7N04`)
- `source`: typically `acara_official`
- `source_ref`: canonical ACARA URL

### 3.4 Senior curriculum

Topic ids live in `data/curriculum/qcaa_senior_maths/methods.json` (and `specialist.json`, etc.). Each topic may already include a `concept_card`. Prefer extending that card and adding exercises over inventing new topic codes.

New senior **course** (not just items): update the framework registry in `backend/curriculum_frameworks.py`, add the matching curriculum slice under `data/curriculum/`, and cover the registration contract in `tests/unit/test_curriculum_frameworks.py` before merging.

---

## 4. Exercise banks

### 4.1 Which file

| Course | Append to |
| --- | --- |
| AC9 Math year *n* | `data/exercise_{n}_math.json` |
| AC9 English year *n* | `data/exercise_{n}_english.json` |
| AC9 Science year *n* | `data/exercise_{n}_science.json` |
| Methods units 1–2 | `data/exercise_methods_u1_u2.json` |
| Methods units 3–4 | `data/exercise_methods_u3_u4.json` |
| Specialist units 1–2 | `data/exercise_specialist_u1_u2.json` |
| Specialist units 3–4 | `data/exercise_specialist_u3_u4.json` |

Any `data/exercise_*.json` array is auto-discovered. Prefer the canonical files above rather than ad-hoc extras unless you have a clear staging reason.

Optional while drafting: `"status": "draft"` (default `"active"`). Drafts are ignored by practice and most audits.

### 4.2 Schema essentials (`ExerciseItem`)

Canonical: `core/schema/exercise_schema.py`. **`extra="forbid"`** — unknown keys fail.

| Field | Notes |
| --- | --- |
| `id` | Unique, stable (e.g. `math_9_sa_AC9M9N01_001`, `methods_u3t4_sa01`, `spec_u1t1_sa01`) |
| `topic` | Usually the primary topic code |
| `question`, `answer`, `steps` | Student stem, mark key, worked steps |
| `framework` | e.g. `AC9_MATHS`, `QCAA_SENIOR_MATHS` |
| `topic_ids` | 1–20 real curriculum topic ids |
| `subject` | Storage subject: `math`, `english`, `science`, `methods`, `specialist`, … |
| `difficulty` | `foundational` \| `developing` \| `extending` \| `AMC` |
| `year_level` **or** `unit` | AC9: `year_level` 7–10 only. Senior: `unit` 1–4 only. Never both. |
| `question_type` | `short_answer` (default), `multiple_choice`, `reasoning`, `multi_part` |

By type:

- **multiple_choice** → `choices` (≥2), `correct_choice`
- **reasoning** → `rubric` with `key_points` + `max_score`; prefer `sample_reasoning`
- **multi_part** → `sub_parts` (≥2) each with `label`, `question`, `answer`

Optional: `complexity` (`simple_familiar` | `complex_familiar` | `complex_unfamiliar`), `math_metadata` / `english_metadata` / `science_metadata`, diagrams, tolerances, alternatives.

Full templates and web rewrite flow: [importing_questions_from_web.md](./importing_questions_from_web.md).

### 4.3 AC9 Maths difficulty quota (coverage gate)

`validate_ac9_maths_coverage` expects **per topic** (active items):

| Requirement | Minimum |
| --- | --- |
| Exercises targeting the topic | ≥ 5 |
| `foundational` | ≥ 1 |
| `developing` | ≥ 2 |
| `extending` | ≥ 1 |

### 4.4 Marking-friendly maths answers

Prefer concise keys: `8`, `8/3`, `2*sqrt(3)`, `pi/2`, `2 and 3`.  
Hard-to-parse forms → MCQ or reasoning. See `data/latex_spec.md` for display LaTeX.

### 4.5 English stimuli

Stimulus-linked items resolve through `data/english_stimuli.json` and English metadata (`stimulus_id` / `passage_mode`). Do not commit copyrighted passages without rights.

### 4.6 Example (current AC9 style)

```json
{
  "id": "math_7_sa_AC9M7N04_099",
  "topic": "AC9M7N04",
  "question": "Write three fractions equivalent to $\\frac{3}{5}$.",
  "answer": "6/10, 9/15, 12/20",
  "steps": [
    "Multiply numerator and denominator by 2: $3/5 = 6/10$.",
    "Multiply by 3: $3/5 = 9/15$.",
    "Multiply by 4: $3/5 = 12/20$."
  ],
  "framework": "AC9_MATHS",
  "topic_ids": ["AC9M7N04"],
  "subject": "math",
  "difficulty": "foundational",
  "year_level": 7,
  "question_type": "short_answer",
  "complexity": "simple_familiar"
}
```

Do **not** include `"unit": null` — omit `unit` entirely for AC9.

### 4.7 Example (current senior style)

```json
{
  "id": "methods_u3t4_sa99",
  "topic": "QCAA_METHODS_U3_T4",
  "question": "Evaluate $\\int_{0}^{2} 3x^{2}\\,dx$.",
  "answer": "8",
  "steps": [
    "Antiderivative of $3x^{2}$ is $x^{3}$.",
    "$[x^{3}]_{0}^{2}=8$."
  ],
  "framework": "QCAA_SENIOR_MATHS",
  "topic_ids": ["QCAA_METHODS_U3_T4"],
  "subject": "methods",
  "difficulty": "foundational",
  "unit": 3,
  "question_type": "short_answer",
  "complexity": "simple_familiar",
  "math_metadata": {
    "technology_active": false,
    "assessment_objective": "apply",
    "strand": "Calculus",
    "skill": "definite_integral"
  }
}
```

---

## 5. Misconceptions and worked examples (AC9 Maths)

Still used for remediation paths. Files:

- Library: `data/misconceptions/prod/ac9_maths.json`
- Worked examples: `data/misconceptions/worked_examples/ac9_maths.json`
- Approvals: `data/misconceptions/approvals.yaml`

Coverage gate (`validate_ac9_maths_coverage`) enforces **year totals** and **per-strand minima** for misconceptions (see script constants; Year 7 has a higher total than 8–10).

If you add a `predicate` detection signature:

1. Implement it in `backend/misconception_predicates.py` (`PREDICATE_REGISTRY`).
2. Add true-positive and false-positive tests in `tests/unit/test_misconception_predicates.py`.

Keep misconception id strand letters consistent with targeted `topic_ids` (e.g. Number vs Algebra).

---

## 6. Approvals

### 6.1 AC9 Maths concept / curriculum attestations

`data/content_approvals.yaml` is checked by `validate_ac9_maths_coverage` (file must exist and parse).

```yaml
approvals:
  - target_path: "data/curriculum/ac9_maths/year7.json#AC9M7N04.concept_card"
    reviewer_name: "Jane Doe"
    reviewer_role: "Year 7 Maths teacher"
    reviewed_at: "2026-07-13T00:00:00+10:00"
    source_url_or_citation: "https://v9.australiancurriculum.edu.au/..."
    notes: "Concept card checked against elaborations; Year 7 reading level."
```

### 6.2 Misconception approvals

```yaml
# data/misconceptions/approvals.yaml
MC_M7N_equiv_fraction_addnum_01:
  reviewer: "Jane Doe"
  approved_at: "2026-07-13T00:00:00+10:00"
  note: "Signature checked against sample student responses."
```

Reviewers should fact-check against named sources, check age-appropriateness, and confirm hints do not leak exercise answers.

---

## 7. Workflows by task

### 7.1 Add exercises to an existing topic (most common)

1. Confirm `topic_id` in the curriculum slice.
2. Author original items (or rewrite web-inspired drafts).
3. Append to the correct `exercise_*.json`.
4. Run gates in §8.
5. Optional: iterative content audit with `--item-id` for new ids only.

### 7.2 Improve a concept card / lesson

1. Draft with `backend/venv/bin/python -m backend.content_authoring.concept_card_helper --topic-id ...` or directly against `ConceptCard` / `LessonContent` in `core/schema/curriculum_schema.py`.
2. Edit the topic in the curriculum JSON.
3. Validate the curriculum slice with `FrameworkSliceFile` (or the relevant curriculum coverage gate).
4. AC9 Maths: update `content_approvals.yaml` if required by your process.
5. Smoke-test guided practice / hints in the UI.

### 7.3 Web- or paper-inspired item batch

Follow [importing_questions_from_web.md](./importing_questions_from_web.md) end-to-end (rights → rewrite → schema → merge → validate).

### 7.4 AC9 Maths “fill coverage gaps” loop

```powershell
backend\venv\Scripts\python.exe -m backend.content_authoring.validate_ac9_maths_coverage --year 7
# Fix reported gaps (exercises, difficulty mix, concept_card, misconceptions, approvals)
backend\venv\Scripts\python.exe scripts\check_exercises.py
```

### 7.5 Senior Methods / Specialist batch

1. Pick unit + `QCAA_*` topic id from curriculum JSON.
2. Author into the matching unit-pair exercise file.
3. `scripts/check_exercises.py` + `scripts/latex_validator.py` +
   `scripts/audit_senior_math_bank_full.py --course methods|specialist`
4. Optional full or delta iterative audit (`--subject methods|specialist`).

---

## 8. Validation gates (current)

Run from the repository root. Prefer the Windows venv path below; on Linux/macOS use `backend/venv/bin/python`.

### 8.1 Always (any exercise change)

```powershell
backend\venv\Scripts\python.exe scripts\check_exercises.py
```

### 8.2 Maths LaTeX

```powershell
backend\venv\Scripts\python.exe scripts\latex_validator.py `
  data\exercise_7_math.json data\exercise_8_math.json `
  data\exercise_9_math.json data\exercise_10_math.json
# or the specific senior files you edited
```

### 8.3 AC9 Maths coverage + quality

```powershell
backend\venv\Scripts\python.exe -m backend.content_authoring.validate_ac9_maths_coverage --year all
backend\venv\Scripts\python.exe scripts\audit_math_banks.py --years 7 8 9 10
backend\venv\Scripts\python.exe scripts\audit_math_bank_full.py --all
backend\venv\Scripts\python.exe -m pytest tests/unit/test_math_bank_quality.py -q
```

### 8.4 AC9 English / Science

```powershell
backend\venv\Scripts\python.exe scripts\audit_english_bank_full.py --all
backend\venv\Scripts\python.exe -m pytest tests/unit/test_english_bank_quality.py -q

backend\venv\Scripts\python.exe scripts\audit_science_banks.py --years 7 8 9 10
backend\venv\Scripts\python.exe scripts\audit_science_bank_full.py --all
backend\venv\Scripts\python.exe -m pytest tests/unit/test_science_bank_quality.py -q
```

### 8.5 Senior maths

```powershell
backend\venv\Scripts\python.exe scripts\audit_senior_math_bank_full.py --all
backend\venv\Scripts\python.exe -m pytest tests/unit/test_methods_bank_quality.py tests/unit/test_specialist_bank_quality.py -q
```

### 8.6 Iterative content audit (optional, thorough)

```powershell
backend\venv\Scripts\python.exe iterative-question-bank-content-audit\scripts\run_question_bank_audit.py verify-package
backend\venv\Scripts\python.exe iterative-question-bank-content-audit\scripts\run_question_bank_audit.py prepare `
  --repo E:\Qld_tutor --subject methods --item-id methods_u3t4_sa99
```

Follow the skill: batches → Tier 3 if needed → `finalise`. See [importing_questions_from_web.md](./importing_questions_from_web.md) §8.4.

### 8.7 Regression tests

```powershell
backend\venv\Scripts\python.exe -m pytest tests/ -q
```

Do not treat a fixed historical pass count as the gate; require green for the suites you touch.

### 8.8 UI smoke

1. Start backend + frontend.
2. Open the subject/year or senior course → topic.
3. Confirm new items appear, LaTeX renders, and a known answer marks correctly.
4. For concept-card work: request a hint and confirm authored levels appear.

---

## 9. Common authoring mistakes

| Mistake | Fix |
| --- | --- |
| Circular `core_rule` (“the rule for X is the rule for X”) | State the actual mathematical/language rule |
| Numeric leakage in hints | Use placeholders (`<numerator>`); keep numbers in worked examples only |
| Wrong elaboration id prefix | Must match `topic_id` |
| AC9 item with `unit` or senior item with `year_level` | Schema XOR — omit the forbidden field |
| Invented `topic_ids` | Copy exact ids from curriculum JSON |
| Unknown JSON fields | Schema `extra=forbid` |
| Verbatim past-paper text | Rewrite + change values; attribute inspiration only |
| Difficulty inflation | `foundational` = short closed items; `extending` = multi-topic or modelling demand |
| Unmarkable symbolic answers | Prefer sympy-friendly keys or MCQ/reasoning |
| Strand mismatch on misconception ids | Align letter/prefix with targeted topics |
| Australian English slips | maths / metre / recognise |
| Committing only bank edits without `check_exercises` | Always run the schema gate before PR |

---

## 10. Promotion checklist (release gate)

Before merging a content PR:

- [ ] Rights: original or licensed; no commercial paper paste
- [ ] `topic_ids` exist in the active curriculum slice
- [ ] `scripts/check_exercises.py` exit 0
- [ ] Touched maths files pass `latex_validator.py`
- [ ] Subject auditor / quality tests relevant to the bank pass (or gaps triaged)
- [ ] AC9 Maths concept/coverage work: `validate_ac9_maths_coverage` clean for edited years; approvals updated
- [ ] Misconceptions (if any): predicates tested; `misconceptions/approvals.yaml` updated
- [ ] UI smoke for at least one new item and one hint/card path if curriculum changed
- [ ] Optional: iterative audit for high-risk new items
- [ ] PR lists topic ids / unit scope and reviewer names

---

## 11. Worked mini-example: one AC9 Maths topic exercise top-up

**Goal:** add a foundational short-answer item for `AC9M7N04`.

1. Confirm topic in `data/curriculum/ac9_maths/year7.json`.
2. Grep for free id: e.g. next `math_7_sa_AC9M7N04_*`.
3. Append object as in §4.6 to `data/exercise_7_math.json`.
4. Run:

```powershell
backend\venv\Scripts\python.exe scripts\check_exercises.py
backend\venv\Scripts\python.exe -m backend.content_authoring.validate_ac9_maths_coverage --year 7
```

5. Open Year 7 Maths → topic → practice the new id.

**Goal:** add a Methods U3 integral item — use §4.7, file `exercise_methods_u3_u4.json`, then senior audit commands in §8.5.

---

## 12. What this playbook no longer assumes

These were true of the early AC9 Maths bootstrap and are **outdated**:

| Old assumption | Current state |
| --- | --- |
| Only Year 7 Maths is in scope | Y7–10 Math/English/Science + Methods + Specialist banks |
| Years 8–10 curriculum must be migrated from blank | Slices and alignment sources already present |
| Exercise shape with `"unit": null` and free-text `topic` | Strict `ExerciseItem`; AC9 omits `unit`; use curriculum topic codes |
| Fixed “529 pytest passed” as a gate | Run current suites; don’t hardcode counts |
| Web import undocumented | See `importing_questions_from_web.md` |
| Senior content “future phase” | Methods and Specialist are live practice banks |

If you find another doc still describing the bootstrap-only world, prefer **this playbook + README** as current behaviour.

---

## 13. Quick command card (Windows)

```powershell
# Schema
backend\venv\Scripts\python.exe scripts\check_exercises.py

# AC9 Maths coverage
backend\venv\Scripts\python.exe -m backend.content_authoring.validate_ac9_maths_coverage --year all

# Concept-card draft
backend\venv\Scripts\python.exe -m backend.content_authoring.concept_card_helper --topic-id AC9M7N04

# Senior auditor
backend\venv\Scripts\python.exe scripts\audit_senior_math_bank_full.py --course methods

# List Methods topic ids
backend\venv\Scripts\python.exe -c "import json; from pathlib import Path; d=json.loads(Path('data/curriculum/qcaa_senior_maths/methods.json').read_text(encoding='utf-8')); print([t['topic_id'] for t in d['topics']])"
```
