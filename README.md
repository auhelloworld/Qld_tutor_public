# Queensland AI Tutoring System

A self-hosted tutoring application for Queensland secondary students. It combines curriculum-grounded practice, deterministic learning progression, adaptive diagnostics, fixed-calendar weekly learning reviews, timed practice papers, writing feedback, interactive Maths and Science investigations, and household progress oversight in one local installation.

The supplied deployment is intended for a **controlled, non-public household host serving one active student**, such as a trusted LAN or VPN. It is not an internet-hardened edge service: the default Compose port is published on host interfaces, the repository does not terminate TLS, and the existing shared-key, registration, and LLM-abuse boundaries are not sufficient for direct public exposure. Do not reinterpret the accepted non-public deployment risk as approval for internet deployment.

The repository currently has authored practice banks for AC9 Mathematics, English, and Science in Years 7–10, plus QCAA Mathematical Methods and Specialist Mathematics in Units 1–4. Senior English is supported by the Writing Hub; other senior-course entries remain content shells until banks are authored. This is a household/self-study product, not a school information system.

## Quick start

### Prerequisites

- Python 3.10 or newer
- Node.js 20 or newer
- npm

### Install and run locally

```bash
python3 -m venv backend/venv
backend/venv/bin/pip install -e ".[dev,test]"
cd frontend && npm install && cd ..
cp .env.example .env
./start.sh
```

`./start.sh` starts both applications in production mode by default. Use `./start.sh --dev` for Uvicorn reload and the Next.js Turbopack development server. Production mode rebuilds the frontend only when `frontend/.next/server` is absent; run `npm run build` after frontend changes.

For manual startup, run the backend and frontend in separate terminals:

```bash
backend/venv/bin/python -m uvicorn backend.api:app --host 0.0.0.0 --port 8000 --reload
# in another terminal
cd frontend && npm run dev
```

Open:

- Student UI: <http://localhost:3000>
- Weekly learning review: <http://localhost:3000/weekly-report>
- Backend health: <http://localhost:8000/api/health>
- Interactive API docs: <http://localhost:8000/docs>

For Windows PowerShell, use `backend/venv/Scripts/python.exe` and the installation commands documented in [Development and configuration](docs/readme/development.md).

## Docker Compose

```bash
cp .env.example .env
# set a real LLM_API_KEY or blank it for mock mode; edit CORS_ORIGINS,
# JWT_SECRET, and PARENT_PASSWORD as appropriate
docker compose up --build -d
```

The service runs Next.js and FastAPI in one container and publishes the frontend/API entry point at <http://localhost:9527>. The browser uses the same-origin `/api` namespace; Next.js forwards it internally to FastAPI. Port `9528` is not published.

On backend startup, idempotent SQLite schema upgrades and legacy index-column backfills run before readiness is advertised; they do not delete attempt history. `/api/ready` also fails if any `data/exercise_*.json` file cannot be read, parsed, or loaded as a JSON array, rather than silently serving a partial bank.

The default `9527:3000` binding is accepted only for controlled non-public LAN/VPN use. Direct internet exposure requires a separately reviewed boundary with firewall policy, HTTPS termination, hardened identity and API authorization, registration controls, secret rotation, and global LLM-abuse limits.

After a rebuild, verify the service with:

```bash
docker compose ps tutor
curl -fsS http://127.0.0.1:9527/api/health
curl -fsS http://127.0.0.1:9527/api/ready
curl -fsS http://127.0.0.1:9527/today >/dev/null
curl -fsS http://127.0.0.1:9527/weekly-report >/dev/null
```

See [Operations](docs/readme/operations.md) for startup behaviour, health semantics, credentials, runtime backups, rollback, and data reset.

## Minimal configuration

The backend loads the root `.env`; browser requests always use the current frontend origin's `/api` path. Provider selection is:

1. Complete `LLM_API_KEY`, `LLM_BASE_URL`, and `LLM_MODEL` configuration;
2. `GEMINI_API_KEY` fallback;
3. `OPENAI_API_KEY` fallback;
4. mock mode when no complete provider configuration exists.

At minimum, set a stable strong `JWT_SECRET` for a deployment. Set `PARENT_PASSWORD` to enable the Parent Dashboard and set the deployed frontend origin in `CORS_ORIGINS`. The documented feature flags are `NEXT_PUBLIC_GUIDED_PRACTICE`, `NEXT_PUBLIC_LEARNING_MAP`, and `NEXT_PUBLIC_SCIENCE_LAB`; do not put server secrets in `NEXT_PUBLIC_*` variables.

See [Development and configuration](docs/readme/development.md) for the complete environment-variable table, mock-mode behaviour, marking rules, and LLM failure states.

## Core features

- Curriculum browsing, standard practice, Guided Practice, corrective retries, self-explanations, and scaffold fading.
- Today Study with scoped task planning, review from memory, Error Book work, a no-help final check, and deterministic BKT/mastery evidence. Each step stops on evidence, not on a question count. The student can choose the new topic and the order of the steps, and can do optional more practice after the day is done. Every step, also the past-mistake steps, runs on one practice page; on a wide screen the help panel opens next to the question.
- Fixed Monday–Sunday weekly learning reports in `Australia/Brisbane`, with subject evidence and a single evidence-triggered reflection.
- Adaptive diagnostics, generated and imported practice papers, resumable exams, Writing Hub feedback, PSMT assistance, and parent oversight.
- Parent-gated Bank Review with explicit durable writes, validation, backup, and rollback safeguards.
- Interactive Maths Lab and an 18-activity AC9 Science Lab with bounded rendering, student-scoped local Inquiry Notebooks, descriptor-aware curriculum links, and an independent transfer path back to normal practice evidence.
- Local SQLite runtime persistence, optional provider-backed semantic marking, safe review deferral, and no RAG/vector-database runtime layer.

## Science Lab

`/science-lab` is a standalone frontend learning module for AC9 Science Years 7–10. It contains 18 interactive investigations across Biological, Chemical, Earth and Space, Physical, and Science Inquiry content: seasons; particles; forces; food webs; waves; natural selection; energy efficiency; mixture separation; reaction balancing; plate boundaries; homeostasis; measurement and error; genetics; reaction rates; carbon and climate; radioactive half-life; Moon/tides/eclipses; and cell-to-system failure.

Each Learn activity follows Orient → Predict → Manipulate → Observe → Explain → Transfer. Quantitative results remain gated until a prediction is submitted. Durable local completion requires prediction reasoning, variables, all inquiry stages, at least three observations with two distinct data states, a claim–evidence–reasoning response, and a model limitation. Predictions do not need to be correct. Notebook and completion records are isolated by the active student profile and remain in that browser; they do not update BKT or mastery. Only the independent transfer exercise enters the normal marking and progress flow.

The implementation uses pure TypeScript teaching models, lazy SVG/Canvas renderers, fixed resource budgets, explicit model limitations, reduced-motion/hidden-page controls, and mobile-safe keyboard/touch alternatives.

For browser verification, install Chromium once and run the desktop/mobile suite:

```bash
cd frontend
npx playwright install chromium
npm run test:e2e
```

## Documentation

The detailed README content is split by audience and task under [`docs/readme/`](docs/readme/):

| Document | Contents |
| --- | --- |
| [Workflows](docs/readme/workflows.md) | Student workflows, daily study, weekly reports, diagnostics, exams, Writing Hub, parent tools, Bank Review, Maths Lab, and Science Lab. |
| [Reliability](docs/readme/reliability.md) | Evidence semantics, durable writes, assessment finality, prompt boundaries, and test isolation. |
| [Content and authoring](docs/readme/content.md) | Current content inventory, schemas, question families, stimulus rules, and authoring references. |
| [Architecture](docs/readme/architecture.md) | Runtime architecture, trust boundaries, persistence, migration, and repository layout. |
| [Development and configuration](docs/readme/development.md) | Local setup, startup, environment variables, mock mode, marking, and provider failures. |
| [Operations](docs/readme/operations.md) | Compose deployment, health checks, backups, rollback, and reset procedures. |
| [Verification](docs/readme/verification.md) | Test tiers, content gates, and production-bound audit procedures. |
| [Limitations](docs/readme/limitations.md) | Deployment scope, product boundaries, content coverage, and known limitations. |

Related documentation:

- [Content authoring guides](docs/content_authoring/)
- [Bank Review durability notes](docs/bank-review.md)
- [LLM runtime audit](docs/llm-runtime-audit.md)
- [Adding senior courses](docs/adding-senior-courses.md)

The code, schemas, current data files, and runtime behaviour are authoritative. Historical audit and implementation-plan documents provide supporting context only.
MIT applies to the code; third-party question-bank content is excluded / remains under its original terms
