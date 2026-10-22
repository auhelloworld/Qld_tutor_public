# Importing practice questions from the web

This guide explains how to turn internet-found or LLM-discovered maths/English/science questions into **schema-valid items** in the Qld_tutor exercise banks.

It covers **AC9 Years 7–10** and **QCAA Mathematical Methods / Specialist Mathematics** (Units 1–4). Pair it with:

| Document | Role |
| --- | --- |
| [sourcing_playbook.md](./sourcing_playbook.md) | Primary sources, licensing, concept cards, and current bank workflow |
| [../../data/latex_spec.md](../../data/latex_spec.md) | Math delimiters and units |
| [../../core/schema/exercise_schema.py](../../core/schema/exercise_schema.py) | Canonical `ExerciseItem` schema |
| [../../core/schema/curriculum_schema.py](../../core/schema/curriculum_schema.py) | Canonical curriculum and concept-card schema |

> **Bottom line:** web search and LLMs are for **inspiration and drafting**. Production JSON must be **original wording** (or clearly licensed), mapped to a real `topic_id`, and pass `scripts/check_exercises.py`.

---

## 1. What “import” means here

| Allowed | Not allowed |
| --- | --- |
| Find a skill/style online (e.g. “surd simplification, QCAA Methods”) | Copy past-paper or textbook text into `question` / `steps` |
| Use an LLM to **rewrite** with new numbers and original stem | Paste VCAA / QCAA / NAPLAN / commercial paper items verbatim |
| Adapt structure after changing context and values | Commit copyrighted stimulus passages without rights |
| Attribute loose inspiration in a local note or `exercise_attribution.yaml` | Claim official exam status for practice items |

Official curriculum text (ACARA / QCAA syllabuses under **CC BY 4.0**) may be used for **topic alignment**, not as a free pass to copy commercial exam papers.

---

## 2. End-to-end workflow

```text
1. Choose course + topic_id from data/curriculum/
2. Collect inspiration (web / paper / LLM search) — do not paste finals yet
3. Rewrite: original stem, new numbers, full solution
4. Map into ExerciseItem JSON (schema below)
5. Keep the raw draft and source notes under staging/; do not write unreviewed output to data/
6. Append reviewed objects to the correct data/exercise_*.json array
7. Validate: check_exercises → latex → subject audit
8. Optional: iterative content audit for new --item-id only
9. Spot-check in the student UI (render + marking)
```

### 2.1 Choose the bank file

| Course | File(s) | `subject` | Scope field |
| --- | --- | --- | --- |
| AC9 Mathematics Y7–10 | `data/exercise_7_math.json` … `exercise_10_math.json` | `math` | `year_level` |
| AC9 English Y7–10 | `data/exercise_7_english.json` … | `english` | `year_level` |
| AC9 Science Y7–10 | `data/exercise_7_science.json` … | `science` | `year_level` |
| Mathematical Methods U1–2 | `data/exercise_methods_u1_u2.json` | `methods` | `unit` 1 or 2 |
| Mathematical Methods U3–4 | `data/exercise_methods_u3_u4.json` | `methods` | `unit` 3 or 4 |
| Specialist Mathematics U1–2 | `data/exercise_specialist_u1_u2.json` | `specialist` | `unit` 1 or 2 |
| Specialist Mathematics U3–4 | `data/exercise_specialist_u3_u4.json` | `specialist` | `unit` 3 or 4 |

Runtime auto-loads every `data/exercise_*.json`. Append objects to the existing **JSON array**; keep valid JSON (commas, no trailing comma after the last element).

### 2.2 Resolve a real `topic_id`

Topic ids must exist in the curriculum slice. Do not invent codes.

| Course | Curriculum slice | Example ids |
| --- | --- | --- |
| AC9 Maths Y9 | `data/curriculum/ac9_maths/year9.json` | `AC9M9N01`, `AC9M9A02` |
| Methods | `data/curriculum/qcaa_senior_maths/methods.json` | `QCAA_METHODS_U1_T1` … `QCAA_METHODS_U4_T5` |
| Specialist | `data/curriculum/qcaa_senior_maths/specialist.json` | `QCAA_SPECIALIST_U1_T1` … |

Quick inspection (PowerShell / Python):

```powershell
backend\venv\Scripts\python.exe -c "import json; from pathlib import Path; d=json.loads(Path('data/curriculum/qcaa_senior_maths/methods.json').read_text(encoding='utf-8')); print([t['topic_id'] for t in d['topics']])"
```

Set both:

- `topic` — same code as the primary topic (existing bank style)
- `topic_ids` — `["QCAA_METHODS_U3_T4"]` (1–20 entries allowed; usually one)

### 2.3 Mint a unique `id`

| Bank | Pattern examples |
| --- | --- |
| Methods | `methods_u3t4_sa99`, `methods_u1t1_01`, `methods_u3t4_mp02` |
| Specialist | `spec_u1t1_sa01`, `spec_u4t1_mcq01` |
| AC9 Maths | `math_7_f_AC9M7N02_<hash>`, `math_9_sa_AC9M9N01_099` |

Rules:

- Unique across the whole repository
- Stable forever (never renumber after students may have logs)
- Match the existing bank's topic/type naming style; do not assume a global starting number
- Prefer the next free suffix or hash for that topic/type

Optional while drafting: `"status": "draft"` — draft records are excluded from practice and most audits until you set `"active"` (default).

---

## 3. Schema requirements (`ExerciseItem`)

Canonical model: `core/schema/exercise_schema.py`.  
**`extra="forbid"`** — any unknown field fails validation.

### 3.1 Fields required for every item

| Field | Allowed values / notes |
| --- | --- |
| `id` | Unique string |
| `topic` | Legacy/human label; match primary topic code |
| `question` | Student stem; maths uses `$...$` LaTeX |
| `answer` | Marking key (string) |
| `steps` | List of worked-step strings (prefer non-empty) |
| `framework` | `AC9_MATHS` / `AC9_ENGLISH` / `AC9_SCIENCE` / `QCAA_SENIOR_MATHS` / … |
| `topic_ids` | 1–20 real curriculum topic ids, no duplicates/empties |
| `subject` | Storage subject: `math`, `methods`, `specialist`, `english`, `science`, … |
| `difficulty` | `foundational` \| `developing` \| `extending` \| `AMC` |

### 3.2 Jurisdiction XOR

| Framework family | Required | Forbidden |
| --- | --- | --- |
| ACARA (AC9_*) | `year_level` ∈ {7,8,9,10} | `unit` |
| QCAA Senior | `unit` ∈ {1,2,3,4} | `year_level` |

### 3.3 By `question_type`

| `question_type` | Extra requirements |
| --- | --- |
| `short_answer` (default) | `answer` sufficient for grading |
| `multiple_choice` | `choices` (≥2), `correct_choice` (e.g. `"A"`); set `answer` to the same key |
| `reasoning` | `rubric` with `key_points` (list) and `max_score`; strongly prefer `sample_reasoning` |
| `multi_part` | `sub_parts` (≥2); each part needs non-empty `label`, `question`, `answer` |

Optional (recommended for senior maths):

```json
"complexity": "simple_familiar",
"math_metadata": {
  "technology_active": false,
  "assessment_objective": "apply",
  "strand": "Calculus",
  "skill": "definite_integral"
}
```

`complexity`: `simple_familiar` | `complex_familiar` | `complex_unfamiliar`  
`assessment_objective`: `recall` | `comprehend` | `apply` | `analyse` | `synthesise` | `evaluate`

Other optional fields: `diagram_data`, `image`, `diagram_description`, `alternative_answers`, `answer_tolerance`, `partial_credit`, and subject metadata blocks.

Do not add helper keys such as `tech_mode`; technology tagging belongs in `math_metadata.technology_active`. Root `diagram_data.type` must be one of the supported renderer types listed in `core/schema/exercise_schema.py` (for example, `coordinate_plane` or `function_graph`).

---

## 4. Templates

### 4.1 Senior short answer (Methods / Specialist)

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

Specialist: change `id` / `topic` / `topic_ids` / `subject` to `specialist` and `QCAA_SPECIALIST_U…`.

### 4.2 AC9 Mathematics short answer

```json
{
  "id": "math_9_sa_AC9M9N01_099",
  "topic": "AC9M9N01",
  "question": "Classify $\\sqrt{2}$ and $0.75$ as rational or irrational.",
  "answer": "$\\sqrt{2}$ is irrational; $0.75$ is rational.",
  "steps": [
    "$\\sqrt{2}$ is non-terminating and non-recurring.",
    "$0.75 = \\frac{3}{4}$, a ratio of integers."
  ],
  "framework": "AC9_MATHS",
  "topic_ids": ["AC9M9N01"],
  "subject": "math",
  "difficulty": "developing",
  "year_level": 9,
  "question_type": "short_answer",
  "complexity": "simple_familiar"
}
```

### 4.3 Multiple choice

```json
{
  "id": "methods_u3t4_mcq99",
  "topic": "QCAA_METHODS_U3_T4",
  "question": "Which is an antiderivative of $2x$ (omit $+C$)?",
  "answer": "A",
  "steps": ["$\\int 2x\\,dx = x^{2}+C$."],
  "framework": "QCAA_SENIOR_MATHS",
  "topic_ids": ["QCAA_METHODS_U3_T4"],
  "subject": "methods",
  "difficulty": "foundational",
  "unit": 3,
  "question_type": "multiple_choice",
  "choices": [
    "A. $x^{2}$",
    "B. $2x^{2}$",
    "C. $x$",
    "D. $2$"
  ],
  "correct_choice": "A",
  "complexity": "simple_familiar"
}
```

### 4.4 Reasoning (rubric)

```json
{
  "id": "methods_u3t4_rsn99",
  "topic": "QCAA_METHODS_U3_T4",
  "question": "Explain why $\\int_a^b f(x)\\,dx = F(b)-F(a)$ when $F'=f$.",
  "answer": "Net change in antiderivative equals definite integral (FTC).",
  "steps": [],
  "framework": "QCAA_SENIOR_MATHS",
  "topic_ids": ["QCAA_METHODS_U3_T4"],
  "subject": "methods",
  "difficulty": "developing",
  "unit": 3,
  "question_type": "reasoning",
  "sample_reasoning": "If $F'=f$, the fundamental theorem gives $\\int_a^b f=F(b)-F(a)$. Constants cancel under subtraction.",
  "rubric": {
    "key_points": [
      "Identify $F$ as an antiderivative of $f$.",
      "State $\\int_a^b f(x)\\,dx=F(b)-F(a)$.",
      "Note that $+C$ cancels in $F(b)-F(a)$."
    ],
    "max_score": 3
  },
  "complexity": "complex_familiar"
}
```

### 4.5 Multi-part

```json
{
  "id": "methods_u3t4_mp99",
  "topic": "QCAA_METHODS_U3_T4",
  "question": "Consider $y=x^{2}$ on $[0,2]$.",
  "answer": "See sub-parts.",
  "steps": [
    "Antiderivative $x^{3}/3$.",
    "$[x^{3}/3]_0^2=8/3$."
  ],
  "framework": "QCAA_SENIOR_MATHS",
  "topic_ids": ["QCAA_METHODS_U3_T4"],
  "subject": "methods",
  "difficulty": "developing",
  "unit": 3,
  "question_type": "multi_part",
  "sub_parts": [
    {
      "label": "a",
      "question": "Evaluate $\\int_{0}^{2} x^{2}\\,dx$.",
      "answer": "8/3",
      "marks": 2
    },
    {
      "label": "b",
      "question": "State the exact area under the curve on $[0,2]$.",
      "answer": "8/3",
      "marks": 1
    }
  ],
  "complexity": "complex_familiar"
}
```

A multi-part sub-question may itself be MCQ by adding `choices` and using a letter as `answer` (see existing Methods/Specialist multipartite items).

---

## 5. Answer and LaTeX conventions (maths)

Maths short answers are graded mainly by **local symbolic/numeric equivalence** (`backend/answer_normalize.py`), not free prose.

| Prefer as `answer` | Avoid as sole key |
| --- | --- |
| `8`, `-3`, `8/3`, `pi/2` | Long sentences for closed tasks |
| `2*sqrt(3)`, `2 and 3` | Unparseable display-only forms |
| MCQ letter `A` | Options without a `correct_choice` |

- Put student-facing display math in `question` / `steps` with `$...$` (see `data/latex_spec.md`).
- Escape backslashes in JSON: `"$\\int_{0}^{1} x\\,dx$"`.
- Forms that are hard for SymPy (some intervals, awkward \(e^x\) strings) → prefer **MCQ** or **reasoning**.
- Use `alternative_answers` when several equivalent student forms should mark correct.

---

## 6. LLM-assisted drafting

### 6.1 Inspiration → rewrite (text)

Use when you found a *style* of question online and need an original bank item.

```text
You are authoring original QCAA Mathematical Methods practice for a private tutor app.

Topic id: QCAA_METHODS_U3_T4
Unit: 3
Difficulty: foundational
technology_active: false

Constraints:
- Invent ONE original short_answer item. Do NOT copy any exam or textbook wording.
- Use new numerical values and a fresh context.
- Australian English.
- Output ONLY a single JSON object (no markdown fence) with fields:
  id, topic, question, answer, steps, framework, topic_ids, subject,
  difficulty, unit, question_type, complexity, math_metadata
- framework = "QCAA_SENIOR_MATHS"
- subject = "methods"
- topic = "QCAA_METHODS_U3_T4"
- topic_ids = ["QCAA_METHODS_U3_T4"]
- answer must be a concise markable form (e.g. "8" or "2*sqrt(3)")
- question and steps use $...$ LaTeX

Inspiration only (do not copy): <paste a short description of the skill, not a paper stem>
```

### 6.2 Page / screenshot scan

For a photo or screenshot of a worksheet, a vision-capable LLM may produce a **draft only**. Save the raw output and source notes under `staging/`, then apply the same rewrite and schema workflow as any other import:

1. Rewrite every stem and change numbers, context, and wording so the production item is original.
2. Fix `topic_ids`, `framework`, `year_level`/`unit`, and `id` to match this repository.
3. Keep only fields declared by `ExerciseItem`; unknown fields are rejected because the schema uses `extra="forbid"`.
4. Do not use helper keys such as `tech_mode`. For senior maths technology tagging, use `math_metadata.technology_active`.
5. For diagrams, use a supported `diagram_data.type` such as `coordinate_plane`, `function_graph`, or `number_line`; do not invent renderer types such as `interactive_plotter`.
6. Review answers, LaTeX escaping, copyright/licensing, and marking behaviour before merging into `data/`.

The image is an aid for drafting, not evidence that the scanned wording may be copied into a production bank.

### 6.3 Staging before merge

Recommended layout:

```text
staging/web_import/
  2026-07-13_methods_u3t4_batch.json   # array of draft items
  notes.md                             # sources consulted, rewrite notes
```

Merge only after validation. Optional attribution (if structure was adapted from a named resource):

```yaml
# data/sources/exercise_attribution.yaml  (create if missing)
attributions:
  methods_u3t4_sa99:
    inspired_by: "Public worksheet style: definite integrals of polynomials"
    adaptation_notes: "Fully rewritten stem; new limits and coefficients."
```

---

## 7. Merge into the bank

1. Keep raw scans, generated drafts, and source notes under `staging/`; never treat them as production content.
2. After rewriting and reviewing the item, open the target file (e.g. `data/exercise_methods_u3_u4.json`).
3. Append the reviewed object(s) to the top-level array.
4. Ensure commas between objects and save UTF-8 without BOM.
5. Run the schema, LaTeX, and subject-specific gates before committing.

Do **not** edit curriculum JSON unless you are adding a real new syllabus topic (rare).

---

## 8. Validation gates

Run from the repository root.

### 8.1 Always

```powershell
backend\venv\Scripts\python.exe scripts\check_exercises.py
```

Expect exit `0` and no schema errors for your new ids.

### 8.2 Maths LaTeX

```powershell
backend\venv\Scripts\python.exe scripts\latex_validator.py data\exercise_methods_u3_u4.json
```

### 8.3 Subject auditors (structure / coverage)

```powershell
# AC9 Maths
backend\venv\Scripts\python.exe scripts\audit_math_banks.py --years 9
backend\venv\Scripts\python.exe scripts\audit_math_bank_full.py --year 9

# Senior Methods / Specialist
backend\venv\Scripts\python.exe scripts\audit_senior_math_bank_full.py --course methods
backend\venv\Scripts\python.exe scripts\audit_senior_math_bank_full.py --course specialist
```

### 8.4 Iterative content audit (new items only)

After a clean schema pass, audit only the production ids you added:

```powershell
backend\venv\Scripts\python.exe iterative-question-bank-content-audit\scripts\run_question_bank_audit.py verify-package

backend\venv\Scripts\python.exe iterative-question-bank-content-audit\scripts\run_question_bank_audit.py prepare `
  --repo E:\Qld_tutor `
  --subject methods `
  --item-id methods_u3t4_sa99 `
  --item-id methods_u3t4_mcq99
```

Then follow the skill: `next-batch` → blind/full review → `prepare-tier3` if needed → `finalise`.

For a full-bank run after a large import, omit `--item-id` (one subject/year or subject-only for senior).

### 8.5 UI smoke check

1. Start backend + frontend (`start.sh` or manual uvicorn / `npm run dev`).
2. Open the course → unit/year → topic.
3. Confirm the new id appears, KaTeX renders, and a known-good answer marks correct.

---

## 9. English and Science notes

### English

- Prefer stimulus ids from `data/english_stimuli.json` via `english_metadata.stimulus_id` / `passage_mode` when using shared passages.
- Do not paste copyrighted literary extracts; use public-domain, original, or licensed text.
- Reasoning items need rubrics; short answers benefit from `alternative_answers` / accepted variants.

### Science

- Use `science_metadata` for strand, variables, CER flags when relevant.
- Check factual claims against an authoritative source; units and year-level language matter.
- Run `scripts/audit_science_banks.py` / `audit_science_bank_full.py` after imports.

---

## 10. Common failures

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Pydantic / check_exercises error on unknown field | Schema `extra=forbid` | Remove non-schema keys (`tech_mode`, `source_url`, …) |
| “must declare year_level” / “must not declare unit” | AC9 vs senior XOR | Fix `year_level` vs `unit` |
| Topic missing at runtime | Invented `topic_ids` | Copy exact id from curriculum JSON |
| Student answer correct but marked wrong | Unparseable `answer` | Use sympy-friendly form or MCQ/reasoning |
| MCQ schema fail | Missing `choices` or `correct_choice` | Add both; align `answer` |
| Reasoning schema fail | Rubric missing `key_points` / `max_score` | Complete rubric contract |
| Multi-part schema fail | &lt;2 parts or empty part answer | Complete all parts |
| KaTeX broken in UI | Bad LaTeX / unescaped `\` in JSON | Follow `latex_spec.md`; double backslashes |
| Duplicate `id` | Reused suffix | Grep banks for the id before merge |

---

## 11. Checklist (copy per batch)

```text
[ ] Rights: rewritten / licensed; not a verbatim past paper
[ ] Course file chosen (correct unit pair or year file)
[ ] topic_id exists in curriculum slice
[ ] Unique id minted
[ ] framework / subject / year_level|unit correct
[ ] question_type fields complete
[ ] answer markable; steps present
[ ] LaTeX $...$ and JSON escaping OK
[ ] scripts/check_exercises.py passes
[ ] latex_validator / subject audit run for touched files
[ ] Optional: --item-id content audit
[ ] UI: renders and marks as expected
[ ] Optional: attribution note for adapted structure
```

---

## 12. Related commands (Windows)

```powershell
# Schema gate
backend\venv\Scripts\python.exe scripts\check_exercises.py

# Senior banks
backend\venv\Scripts\python.exe scripts\audit_senior_math_bank_full.py --all

# Package-verified iterative audit (example: Specialist unit 1 only)
backend\venv\Scripts\python.exe iterative-question-bank-content-audit\scripts\run_question_bank_audit.py prepare `
  --repo E:\Qld_tutor --subject specialist --unit 1
```

On Linux/macOS, use `backend/venv/bin/python` instead of `backend\venv\Scripts\python.exe`.

---

## 13. Scope reminder

Imported web-inspired items become ordinary authored practice content. They do **not** become official QCAA, NAPLAN, or school assessment. Labels, scores, and exam-simulator bands remain formative practice indicators only.
