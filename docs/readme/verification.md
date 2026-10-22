# Verification and content audits

## Read-only learning-loop audit availability

The repository currently has **no checked-in `scripts/audit_transfer_failures.py` read-only learning-loop CLI**. The previously documented learning-loop report commands are therefore not runnable in this checkout and are intentionally not part of the current verification workflow. Runtime health remains available through `/api/health` and `/api/ready`; use the backend test tiers below for repository-level evidence, and inspect live learning-loop data only with an operator-approved read-only database procedure.

Run the current suites directly so a missing dependency or skipped frontend command cannot be mistaken for a pass.

Backend tiers:

```bash
# Default developer loop: deterministic unit-level checks only.
backend/venv/bin/python -m pytest tests/ -m fast -ra

# Boundary/API tests, Hypothesis invariants, and full-bank auditor gates.
backend/venv/bin/python -m pytest tests/ -m integration -ra
backend/venv/bin/python -m pytest tests/ -m property -ra
backend/venv/bin/python -m pytest tests/ -m content_audit -ra

# Complete release regression suite (all tiers).
backend/venv/bin/python -m pytest tests/ -ra
```

Frontend:

```bash
cd frontend
npm test
npx tsc --noEmit
npm run lint
npm run build
npx playwright install chromium  # once per clean machine/browser cache
npm run test:e2e
npm audit --audit-level=low
```

The Playwright suite starts an isolated Next.js server on `127.0.0.1:3100`. Desktop Chromium loads all 18 Science Lab renderers and exercises the repaired Force, Food Web, Particle, Wave, Selection, Seasons and Moon interactions; the Pixel 5 project additionally verifies Inquiry Notebook completion, dedicated drag surfaces, real touch scrolling and document-level overflow.

A local `npm audit --audit-level=low` run against the current lockfile on **2026-09-15** reported **0 vulnerabilities** with Next.js 16.3.5, Vitest/coverage 4.1.11, sharp 0.35.4 and js-yaml 4.3.2. `npm ci` may still report a peer-compatibility warning because `mafs@0.21.0` depends on `use-resize-observer@9.1.0`, whose peer range stops at React 18 while this project uses React 19.2.4. This is not an `npm audit` vulnerability: forcing `use-resize-observer@10` would cross a breaking export change, so the project keeps the upstream-compatible Mafs dependency and covers it with Maths Lab regression tests until Mafs updates its dependency range.

On Windows, use `backend/venv/Scripts/python.exe` for Python commands. The shared pytest configuration redirects runtime learning storage to a per-test temporary SQLite database and temporary log root; tests must not read or write the installation's `data/qld_tutor.db`.

## Core content checks

```bash
backend/venv/bin/python scripts/check_exercises.py
backend/venv/bin/python scripts/audit_math_banks.py --years 7 8 9 10
backend/venv/bin/python scripts/audit_math_bank_full.py --all
backend/venv/bin/python -m pytest tests/unit/test_math_bank_quality.py -q
backend/venv/bin/python -m pytest tests/unit/test_science_bank_quality.py -q
backend/venv/bin/python -m pytest tests/unit/test_methods_bank_quality.py -q
backend/venv/bin/python -m pytest tests/unit/test_specialist_bank_quality.py -q
backend/venv/bin/python -m pytest tests/unit/test_english_bank_quality.py -q
backend/venv/bin/python scripts/audit_english_bank_full.py --all
backend/venv/bin/python scripts/audit_science_banks.py --years 7 8 9 10
backend/venv/bin/python scripts/audit_science_bank_full.py --all
backend/venv/bin/python scripts/audit_senior_math_bank_full.py --all --strict
```

## Production-bound iterative content audit (all subjects)

For a release or a claim that a bank has been content-certified, start with the `iterative-question-bank-content-audit` SKILL (see `iterative-question-bank-content-audit/SKILL.md` and `WEB_CHAT_REVIEWER_GUIDE.md`). This is one workflow: the static subject scripts above are deterministic preflight gates within it, rather than a completed audit that happens before the SKILL. They cannot by themselves establish the correctness of open responses, modelling, factual nuance, rubric quality, diagrams or practical-safety judgements.

1. Verify the SKILL package, then prepare one exact canonical production scope. Use the appropriate `--subject`, `--year` (or `--unit` for senior Maths), optional ID selection, and `--delivery-scope external` for a public/external English release.

   ```bash
   backend/venv/bin/python iterative-question-bank-content-audit/scripts/run_question_bank_audit.py verify-package
   backend/venv/bin/python iterative-question-bank-content-audit/scripts/run_question_bank_audit.py \
     prepare --repo . --subject science --year 9
   ```

2. `prepare` makes the source-bound manifest and batches, and runs `scripts/check_exercises.py`, the applicable deterministic auditor(s), and the matching subject quality pytest gate. For English it also binds the source-rights check to the requested delivery scope. A failed or missing preflight gate requires correction and a fresh run; it cannot be bypassed for acceptance. Item-level findings from preflight (including Maths `*_maths_gate_issue_flags.csv` / `*_issue_flags.jsonl`) are imported as **review candidates**, not auto-confirmed errors. High-confidence Maths incorrect flags are elevated for batching.
3. For every batch, run `prepare-batch`; have Codex/LLM complete the generated blind-review prompt first; save that structured response and run `validate-blind`. The blind prompt hides the authored answer, rubric and worked solution so the reviewer produces an independent answer or assessment. English sidecar stimuli are reduced to the same student-visible text snapshot used by runtime and Tier 3. Use the subject-scoped `<run-dir>/resources/REVIEWER_BRIEF.md` generated by `prepare` (not the full operator `SKILL.md`) plus the referenced schema summary when reviewing.
4. Only after blind validation, open the full-review prompt. The reviewer checks every root item and sub-part, including answer/working correctness, MCQ option agreement, marking contract, rubrics, factual evidence, diagrams and subject-specific requirements. Prefer `response_mode: "compact"` for clean `no_issue` items to cut output tokens; any finding, preflight flag, mismatch or non-ready outcome must use a full audit row plus detailed issue rows. Save the audit/issue JSON, then run `validate-batch` (the coordinator expands compact rows into the full ledger shape).
5. Run the fresh-context Tier 3 independent review and **issue-level** adjudication for active findings (`prepare-tier3`, `next-tier3`, validation commands). Then run `reconcile` and `finalise`. The coordinator rechecks source, evidence, prompt, preflight and review-record hashes before issuing `PASS`, `PASS WITH DOCUMENTED RISKS`, or `FAIL`.
6. Apply accepted fixes only with separate authoring authority. Then start a new production-bound, ID-selected delta audit for every changed ID; the coordinator expands the linked dependency closure. A delta `PASS` certifies that closure only, never the whole bank.
7. For efficient post-fix re-audit, optionally seed clean unchanged IDs from a prior acceptance run so only changed/missing items need LLM review:

   ```bash
   backend/venv/bin/python iterative-question-bank-content-audit/scripts/run_question_bank_audit.py \
     prepare --repo . --subject math --year 9 --item-id ID1 --item-id ID2
   backend/venv/bin/python iterative-question-bank-content-audit/scripts/run_question_bank_audit.py \
     seed-prior --run-dir <NEW_RUN> --prior-run <OLD_PASS_RUN>
   ```

   `seed-prior` reuses whole batches when every ID is clean and dependency-hash-matched, and peels partial matches into completed seed batches so only remaining IDs stay pending.

The coordinator is provider-neutral: it never edits exercise data or calls an LLM API itself. In a Codex agent task, Codex follows the SKILL and performs the blind, full and Tier 3 reviews without a project API key. A fully unattended command-line implementation needs a separately configured model runner. Neither a coordinator `PASS` nor LLM review replaces qualified teacher, curriculum and subject review.

## AC9 Maths audit workflow

The two AC9 Maths audit scripts have different jobs and should be used together (and as preflight inside the iterative content audit above):

| Script | Primary purpose | What a clean run means |
| --- | --- | --- |
| `scripts/audit_math_banks.py` | Whole-bank heuristic review of worked steps, answer completeness, representations, rubrics, difficulty, extending/AMC demand, year fit and curriculum coverage. It also consumes high-confidence deterministic maths results from the full auditor. | No findings at the selected `--fail-on` severity. Heuristic medium/low findings still require human judgement. |
| `scripts/audit_math_bank_full.py` | Canonical `ExerciseItem` schema validation, **deterministic `verify_maths`** (skill/AC9-code routing, multi-part per-part checks, skill-agnostic arithmetic/MCQ/steps fallbacks), diagram checks and detailed per-item review queues. | With `--strict`, there are no critical/high hard errors and no definite content errors. It does **not** mean every answer was deterministically verified (hard verified/incorrect is a minority of the bank; most items remain inconclusive and need LLM/human review). |

Run a single Year 7 review while authoring:

```bash
backend/venv/bin/python scripts/audit_math_banks.py --years 7
backend/venv/bin/python scripts/audit_math_bank_full.py --year 7
```

These report-only commands normally exit `0` after successfully producing artifacts, even when review findings exist. Inspect the generated summaries and CSV/JSONL queues under `audit_output/`.

Use explicit gates for acceptance or CI:

```bash
# Fail on any high or critical heuristic finding.
backend/venv/bin/python scripts/audit_math_banks.py \
  --years 7 8 9 10 --fail-on high

# Fail on critical/high structural errors or any definite content error.
backend/venv/bin/python scripts/audit_math_bank_full.py --all --strict
```

`audit_math_banks.py --fail-on` accepts `critical`, `high`, `medium`, `low`, or `none`. The selected level includes more severe findings; for example, `--fail-on high` fails on both high and critical issues. Its default is `none`, which makes it a report generator rather than a gate.

Useful output files include:

- `year{n}_math_audit_summary.md`: heuristic bank summary and risk counts.
- `year{n}_math_question_audit.csv`: one heuristic audit row per question.
- `year{n}_math_issue_flags.csv`: heuristic findings to triage.
- `year{n}_math_full_summary.md`: schema, maths, diagram and extension summary.
- `year{n}_math_hard_errors.csv`: structural errors that must be fixed.
- `year{n}_math_human_review_queue.csv`: content, diagram and judgement-based findings.
- `year{n}_math_issue_flags.jsonl`: full issue ledger (schema + maths + diagram + extension).
- `year{n}_math_maths_gate_issue_flags.csv`: maths-only gate findings for skill preflight import (`maths_incorrect` / `maths_likely_issue`); high-confidence incorrect flags are elevated when the iterative audit prepares a run.
- `year{n}_math_maths_review_queue.csv`: every item whose mathematical correctness was not deterministically established (`unsupported`, `inconclusive`, or `parse_failed`).

Use `--out-dir PATH` with `audit_math_banks.py` or `--out PATH` with `audit_math_bank_full.py` to write artifacts elsewhere. Use `--data-dir PATH` with either script when auditing a staged copy of the `data/` directory. When the iterative content audit runs `prepare` for Maths, the full auditor writes under the run’s `preflight/` tree and those issue files are imported as review candidates.

Recommended authoring/preflight sequence after changing an AC9 Maths bank (complete the iterative content audit above before claiming certification):

1. Run `scripts/check_exercises.py` for repository-wide schema and content contracts.
2. Run `scripts/latex_validator.py` for the changed Maths files.
3. Run `tests/unit/test_math_bank_quality.py` for duplicate labels, rubric/template and bank-shape regressions.
4. Run `audit_math_banks.py` in report mode and triage its heuristic findings.
5. Run `audit_math_bank_full.py` and review the human queue, maths gate issue flags, and maths verification queue.
6. Resolve confirmed problems, record intentional heuristic exceptions during review, then rerun both scripts with `--fail-on high` / `--strict` as the final gate.
7. Re-certify changed production IDs with the iterative audit (`--item-id` / `--ids-file`) and optional `seed-prior` from the last clean acceptance run.

Deterministic verification covers only supported closed mathematical patterns (routing via skill name or AC9 topic codes, multi-part per-part verification, and skill-agnostic arithmetic/MCQ/steps checks). Items in the maths review queue, open reasoning, modelling, proof and rubric-based responses still require qualified human review or the iterative LLM content audit. Do not treat a clean `--strict` full-auditor run as full-bank answer certification.

An ID-selected post-fix audit may return `PASS`, but certifies only its selected dependency closure. Its report must not be read as a full-year or full-bank approval. For multi-part items, acceptance review records independent evidence and answer comparison for every sub-part, not only the labels.

## Senior Maths audit workflow

QCAA Mathematical Methods and Specialist Mathematics use a shared senior auditor plus the repository schema and subject-specific pytest gates:

| Check | Primary purpose | What a clean run means |
| --- | --- | --- |
| `scripts/check_exercises.py` | Repository-wide canonical `ExerciseItem` and runtime content contracts. | The banks can be loaded through the canonical schema; this does not establish mathematical correctness. |
| `scripts/audit_senior_math_bank_full.py` | Course/unit routing, canonical schema, curriculum coverage, MCQ key consistency, technology-active/free conditions, worked support, multi-part labels and rubric coverage, reasoning depth, difficulty/complexity calibration and Paper 1/Paper 2 balance. | Report mode produces review artifacts. `--strict` fails on P0/P1 blockers; `--fail-on P2` also requires high-mark part rubrics and other repair work to be resolved. Non-MCQ mathematics still requires review. |
| `tests/unit/test_methods_bank_quality.py` and `tests/unit/test_specialist_bank_quality.py` | Curriculum spine, syllabus boundaries and authored bank regression gates. | Encoded quality contracts pass for the current banks. |

Run one course while authoring:

```bash
backend/venv/bin/python scripts/audit_senior_math_bank_full.py --course methods
backend/venv/bin/python scripts/audit_senior_math_bank_full.py --course specialist
```

Use the deterministic authoring gates after triage:

```bash
# P0/P1 structural, routing, marking and definite-content blockers.
backend/venv/bin/python scripts/audit_senior_math_bank_full.py --all --strict

# Stronger gate: also require the P2 repair/review queue to be empty.
backend/venv/bin/python scripts/audit_senior_math_bank_full.py --all --fail-on P2

backend/venv/bin/python -m pytest tests/unit/test_methods_bank_quality.py -q
backend/venv/bin/python -m pytest tests/unit/test_specialist_bank_quality.py -q
```

`--fail-on` accepts `P0`, `P1`, `P2`, or `P3`; the selected priority includes all more severe findings. Report mode has no failure threshold. `--strict` is equivalent to `--fail-on P1`.

For each course, the output directory contains a full summary, per-item CSV, CSV/JSONL issue flags, repair checklists, and a `*_maths_review_queue.csv`. The queue deliberately includes every non-MCQ item because the auditor does not have a general verified solver for senior calculus, statistics, vectors, matrices, complex numbers or proofs. `key_consistent` means only that an MCQ answer agrees with its configured key; it is not an independent proof that the keyed mathematics is correct.

Recommended authoring/preflight sequence after changing a Senior Maths bank (complete the iterative content audit above before claiming certification):

1. Run `scripts/check_exercises.py` and `scripts/latex_validator.py` for the changed files.
2. Run the matching Methods or Specialist quality pytest gate, then run the senior auditor in report mode and inspect P1-P3 findings, including duplicate sub-part labels, generic rubrics and high-mark part-rubric coverage.
3. Have a qualified reviewer or separately validated checking process verify the queued mathematics, including model solutions, proof/rubric sufficiency, technology conditions, exact/rounded form, domains, assumptions and conclusions.
4. Rerun `--strict` for P0/P1 blockers. Use `--fail-on P2` only when release policy requires an empty repair queue.

## AC9 English audit workflow

AC9 English uses one CLI auditor plus a pytest quality gate:

| Check | Primary purpose | Gate semantics |
| --- | --- | --- |
| `scripts/audit_english_bank_full.py` | Per-item and bank-level review of canonical schema, curriculum coverage, student-visible stimulus quotation accuracy, root/sub-part label and choice-key contracts, evidence support, authored high-mark part rubrics, analytical/writing rubrics, language conventions, self-study support, year fit and stimulus source/rights metadata. | Report-only by default. `--strict` fails on P0/P1. `--fail-on P2` also requires high-mark part-rubric and other P2 repair/review work to be resolved. |
| `tests/unit/test_english_bank_quality.py` | Fast repository gate for duplicates, empty/template content, curriculum minimums, difficulty distribution, MCQ/reasoning/multi-part structure, sub-part choice keys, canonical schema, facets and stimulus references. | Hard issues fail pytest. Advisories such as shallow reasoning, missing authored high-mark part rubrics or thin accepted-answer variants remain review signals rather than automatic failures. |

Run a single-year authoring review:

```bash
backend/venv/bin/python scripts/audit_english_bank_full.py --year 7
backend/venv/bin/python -m pytest tests/unit/test_english_bank_quality.py -q
```

Run all years in report mode:

```bash
backend/venv/bin/python scripts/audit_english_bank_full.py --all
```

Use explicit acceptance gates:

```bash
# Fail on definite blockers and high-impact content/stimulus errors (P0/P1).
backend/venv/bin/python scripts/audit_english_bank_full.py --all --strict

# Stronger release gate: also fail while P2 repairs or rights reviews remain.
backend/venv/bin/python scripts/audit_english_bank_full.py --all --fail-on P2
```

For an external/public delivery candidate, bind source-rights checks to that scope. The current private-only stimulus review will deliberately block an uncleared external release:

```bash
backend/venv/bin/python scripts/audit_english_bank_full.py --all --strict --delivery-scope external
```

English audit priorities are:

- `P0`: schema, missing question or missing answer blocker.
- `P1`: high-impact schema, curriculum, answer-key, root/sub-part contract, stimulus, quotation or source-attribution error.
- `P2`: evidence, authored high-mark part-rubric coverage, effective mark-total mismatch, rubric dimensions, self-study, exam-prep, thin curriculum coverage or source-rights review.
- `P3`: advisory calibration and polish.

Useful output files include:

- `year{n}_english_full_summary.md`: yearly counts, status snapshot and repair checklist.
- `year{n}_english_full_item_audit.csv`: one detailed audit row per exercise.
- `year{n}_english_full_issue_flags.csv`: all P0-P3 findings.
- `year{n}_english_hard_errors.csv`: P0/P1 blockers used by `--strict`.
- `year{n}_english_human_review_queue.csv`: P2/P3 review work.
- `year{n}_english_full_repair_checklist.csv` and `.md`: prioritised P0-P2 repair list.

Use `--years 7 8`, `--data-dir PATH`, `--curriculum-dir PATH`, `--stimuli-file PATH`, `--delivery-scope private|external`, and `--out-dir PATH` to audit selected years or staged content. `--out PATH` is accepted as an alias for `--out-dir`.

Recommended acceptance sequence after changing an English bank or stimulus:

1. Run `scripts/check_exercises.py` for repository-wide schema and stimulus-reference contracts.
2. Run `tests/unit/test_english_bank_quality.py` for the fast hard gate, including sub-part labels and choice keys.
3. Run `audit_english_bank_full.py` in report mode and inspect P1/P2 findings, especially quotation mismatches, student-visible stimulus evidence, part-rubric coverage and source-rights status.
4. For a sidecar stimulus, review the exact `student_display.plain_text` representation only. Blind and Tier 3 review use the same projection/hash; author metadata (`effect`, targets and source notes) is not student evidence. Treat multimodal records as textual accessibility representations unless a real renderer artifact exists.
5. Confirm open answers, interpretations, model responses and rubric judgements with a qualified English reviewer; automation can verify support and consistency, not the only valid interpretation.
6. Rerun with `--strict`; use `--fail-on P2` when the release policy requires an empty repair/review queue. Use `--delivery-scope external` for public/external distribution.

## AC9 Science audit workflow

The two AC9 Science audit scripts share canonical schema, curriculum and complexity-calibration sources, but serve different review layers:

| Script | Primary purpose | Gate semantics |
| --- | --- | --- |
| `scripts/audit_science_banks.py` | Fast whole-bank heuristic scan for schema, real curriculum coverage, factual-risk patterns, MCQ/rubric/CER support, inquiry demand, representations, year fit, extension quality and complexity calibration. | Report-only by default. Use `--fail-on high` for structural/factual blockers or `--fail-on medium` to include repair-level quality findings. |
| `scripts/audit_science_bank_full.py` | Detailed per-item audit with P0-P3 priorities, canonical schema, curriculum and bank coverage, science fact checks, CER/inquiry/data/diagram semantics, self-study/exam readiness and dedicated complexity review/sample artifacts. | Report-only by default. `--strict` fails on P0/P1; `--fail-on P2` also requires repair-level findings to be resolved. |

Run a single-year authoring review:

```bash
backend/venv/bin/python scripts/audit_science_banks.py --years 7
backend/venv/bin/python scripts/audit_science_bank_full.py --year 7
backend/venv/bin/python -m pytest tests/unit/test_science_bank_quality.py -q
```

Run all years with explicit gates:

```bash
# Fast gate: critical/high structural, curriculum, factual and representation issues.
backend/venv/bin/python scripts/audit_science_banks.py \
  --years 7 8 9 10 --fail-on high

# Detailed definite-error gate (P0/P1).
backend/venv/bin/python scripts/audit_science_bank_full.py --all --strict

# Stronger release gate including P2 quality repairs.
backend/venv/bin/python scripts/audit_science_bank_full.py --all --fail-on P2
```

`audit_science_banks.py --fail-on` accepts `critical`, `high`, `medium`, `low`, or `none`. `audit_science_bank_full.py --fail-on` accepts `P0`, `P1`, `P2`, `P3`, or `none`.

Science full-audit priorities are:

- `P0`: canonical schema, missing answer/question or clear factual blocker.
- `P1`: high-impact curriculum, marking, question-structure or missing-representation blocker.
- `P2`: CER, inquiry, safety controls, data interpretation, multi-part rubric coverage, self-study, exam-prep, thin coverage or unsupported complexity repair.
- `P3`: complexity calibration and other advisory human review.

Useful output files include:

- `year{n}_science_audit_summary.md`: fast heuristic bank summary and risk scores.
- `year{n}_science_question_audit.csv`: heuristic row for every item, including shared complexity status/evidence.
- `year{n}_science_issue_flags.csv`: heuristic severity-ranked findings.
- `year{n}_science_full_summary.md`: detailed P0-P3 summary and repair checklist.
- `year{n}_science_full_item_audit.csv`: detailed item-level status table.
- `year{n}_science_hard_errors.csv`: P0/P1 findings used by `--strict`.
- `year{n}_science_human_review_queue.csv`: P2/P3 review work.
- `year{n}_science_complexity_review_queue.csv`: items whose declared complexity needs review.
- `year{n}_science_complexity_stratified_sample.csv`: deterministic per-topic sample for bounded human calibration.

Both scripts accept `--data-dir PATH`, `--curriculum-dir PATH`, and `--out-dir PATH`; the full auditor also accepts `--out PATH` as an alias. A staged bank must be audited with its matching staged curriculum directory so missing-topic checks use the intended scope.

Recommended authoring/preflight sequence after changing a Science bank (complete the iterative content audit above before claiming certification):

1. Run `scripts/check_exercises.py` for repository-wide canonical schema and renderer contracts.
2. Run `tests/unit/test_science_bank_quality.py` for minimum topic coverage, difficulty distribution, content diversity and question-family hard gates.
3. Run `audit_science_banks.py` in report mode and resolve confirmed high/critical findings.
4. Run `audit_science_bank_full.py`; inspect P2/P3, complexity queues and the stratified sample rather than treating them as proven factual errors.
5. Have a qualified Science reviewer verify open explanations, models, experimental designs and year-level factual nuance, then rerun `--fail-on high` / `--strict`. Use `--fail-on P2` only when release policy requires an empty repair queue.

## Additional validation commands

KaTeX validation for the AC9 Maths banks:

```bash
backend/venv/bin/python scripts/latex_validator.py \
  data/exercise_7_math.json data/exercise_8_math.json \
  data/exercise_9_math.json data/exercise_10_math.json
```

After changing providers, run:

```bash
backend/venv/bin/python scripts/check_llm_provider.py
```

Audit scripts generate review artifacts under `audit_output/`. Their P2/P3 queues are heuristic human-review worklists, not equivalent to schema failures or proof that every open answer is factually correct. Avoid copying dated pass counts or queue sizes into permanent feature claims.
