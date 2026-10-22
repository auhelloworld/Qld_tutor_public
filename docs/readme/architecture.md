# Architecture and repository layout

## Architecture and trust boundaries

```text
Browser (Next.js 16 / React 19)
        |
        | REST + student token; parent token on protected parent calls
        v
FastAPI application
  |-- curriculum and exercise loader
  |-- deterministic BKT, recommendations, CAT branching, scheduling
  |-- local answer normalisation and subject-aware marking dispatch
  |-- optional LLM adapter for dialogue, open-response marking, writing, PSMT
  `-- local persistence in data/
```

- **Backend**: Python 3.10+, FastAPI, Pydantic v2, SymPy, and the OpenAI Python SDK. `backend/api.py` assembles routers; `backend/rules.py`, `backend/diagnostic_engine.py`, and `core/algorithms/` contain the main deterministic learning logic.
- **Frontend**: Next.js 16 App Router, React 19, Tailwind CSS 4, KaTeX, and Mafs under `frontend/`. Question text is rendered by `MathMarkdown` (react-markdown with `remark-gfm` for tables, `remark-math` + `rehype-katex` for maths), so authored GFM pipe tables render as real HTML tables.
- **Content**: curriculum, exercises, stimuli, taxonomies, and writing topics are versioned local files under `data/`.
- **Persistence**: attempts, topic state, diagnostics, exam metadata, derived mistake state, and student weekly reflections are stored in `data/qld_tutor.db`. Weekly report statistics are derived from the attempt history for fixed calendar-week boundaries; only the student-authored reflection is stored as a weekly row. Writing Hub and PSMT keep separate feature-specific histories under `data/logs/`; credentials are stored in `data/credentials.json`. Docker Compose bind-mounts the whole `data/` directory.
- **No RAG layer**: the runtime does not use a vector database or remote content-retrieval pipeline.

The LLM is not authoritative for progression. Its output is parsed into typed schemas and treated as untrusted. Learning routing, BKT, spaced repetition, and recommendation decisions remain deterministic.

Student attempts, topic state, diagnostics, exam metadata, and weekly reflections use SQLite only at runtime. Writing Hub and PSMT retain their separate feature-specific JSON histories. Attempt outcome, Speed Round status, parent-review status, and Error Book review links are also stored in indexed columns, so hot lookups do not scan or classify every historical JSON payload. FastAPI startup runs the idempotent schema upgrade before readiness is advertised: it creates missing tables/indexes, adds missing columns, and backfills legacy index columns without deleting attempt history. The exercise snapshot separately records any unreadable, malformed, or non-array `exercise_*.json` file so readiness cannot succeed with a silently partial bank.

Older per-student Maths/English/Science logs are imported explicitly and offline before an upgrade:

```bash
backend/venv/bin/python -m backend.migrate_legacy_json_to_sqlite --dry-run
backend/venv/bin/python -m backend.migrate_legacy_json_to_sqlite
```

The importer is idempotent and preserves source JSON files; archive or delete those files separately after verification.

## Repository layout

```text
backend/                  FastAPI app, routers, learning rules, services, migrations
  content_authoring/      Content helpers and curriculum coverage checks
  routers/                Auth, Bank Review, curriculum, diagnostic, exam, parent, quests, student, tutor, writing
  services/               Marking, adjudication, analytics, attempt/evidence handling, validation, study planning, quests, history, and projections
core/                     Shared algorithms, prompt templates, and Pydantic schemas
frontend/                 Next.js application
  src/app/                Student, dashboard, weekly-report, diagnostic, exam, writing, parent, and tool pages
                          (includes /weekly-report, /lab Maths Lab, and /science-lab Science Lab)
  src/components/         Reusable UI and workflow components
    lab-shared/           Layout, slider, control-card and Mafs-stage components shared by both labs
    lab/                  Maths Lab tabs and scenes
    science-lab/          Science Lab directory, inquiry panel, controls, and SVG/Canvas scenes
  src/lib/                API client, subject registry, formatting, and navigation helpers
    science-lab/          Activity schema, activities, curriculum map, renderer registry, pure models
data/                     Authored content and local runtime data
  curriculum/             AC9 and QCAA framework slices
  exams/                  Imported practice papers (no JSON papers are currently committed)
  misconceptions/         Curated misconception libraries
docs/                     Authoring guides, implementation notes, and historical audit reports
scripts/                  Content validators, provider checks, and subject-audit scripts
iterative-question-bank-content-audit/
                          Production-bound question-bank review workflow
qld-tutor-question-bank-generation/
                          Question-bank generation inputs and tooling
qld-tutor-source-digest/  Source-digest inputs and generated research context
audit_output/             Generated audit reports and review queues
scratch/                  Authoring scratch banks and temporary review inputs
staging/                  Staged content and release-preparation artifacts
tests/                    Backend unit, integration, property, and full-bank audit tests
```

Historical audit and implementation-plan documents in `docs/` explain past work; they are not the source of truth for current runtime behaviour. Use the code, schemas, current data files, and the root README for current status.
