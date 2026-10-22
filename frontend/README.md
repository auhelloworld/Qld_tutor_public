# QLD AI Tutor — Frontend

The browser application for QLD AI Tutor. It is a Next.js App Router frontend for curriculum-grounded practice, Guided Practice, adaptive Diagnostic assessment, daily study, Error Book revision, mock exams, Writing Hub, parent progress tools, the Interactive Maths Lab, and the curriculum-linked Science Lab.

The frontend is intentionally a client for the FastAPI backend. Curriculum data, marking, progression, authentication, diagnostic branching, persistence, and parent authorization remain server responsibilities.

## Stack

- Next.js `16.3.5` App Router with Turbopack development mode
- React `19.2.4` and TypeScript
- Tailwind CSS 4 utilities alongside the existing component styles
- React Markdown, KaTeX, and MathML output for accessible mathematical notation
- Mafs and custom renderers for interactive plots, tables, graphs, and diagrams
- Vitest, Testing Library, jsdom, and `vitest-axe` for component and contract tests
- Playwright `1.63.0` with Chromium for desktop and mobile browser E2E tests

## Requirements

- Node.js 20.11.0 or newer
- npm
- A running QLD AI Tutor backend for interactive use

For the complete repository setup, provider configuration, backend startup, and content information, see the [repository README](../README.md).

## Local development

From the repository root, install the backend and frontend dependencies once:

```bash
python3 -m venv backend/venv
backend/venv/bin/pip install -e ".[test]"
cd frontend
npm ci
cd ..
cp .env.example .env
```

The root `.env` is used by the backend. On Linux/macOS, `start.sh` creates `frontend/.env` as a symlink to that file when needed.

### Start both applications

The helper script is the recommended local workflow on Linux/macOS:

```bash
./start.sh
```

This starts:

- Backend: `http://localhost:8000`
- Frontend: `http://localhost:3000`

Use `Ctrl+C` to stop both processes. Use `./start.sh --prod` for the local Next.js production server; run `npm run build` yourself after frontend changes when using that mode.

### Start the frontend manually

Run the backend in one terminal:

```bash
backend/venv/bin/python -m uvicorn backend.api:app \
  --host 0.0.0.0 --port 8000 --reload
```

Run the frontend in another:

```bash
cd frontend
npm run dev
```

For a local production server:

```bash
cd frontend
npm run build
npm run start
```

`npm run start` serves the built application on port `3000` by default.

## Docker Compose

Run Docker from the repository root, not from `frontend/`:

```bash
cp .env.example .env
# Edit .env: set CORS_ORIGINS, JWT_SECRET, and PARENT_PASSWORD as needed.
docker compose up --build -d
```

The supplied Compose service runs the backend and frontend in one container. Only the Next.js entry point is published on the host:

| Endpoint | URL | Container target | Host exposure |
| --- | --- | ---: | --- |
| Frontend | `http://localhost:9527` | 3000 | Published |
| Proxied API | `http://localhost:9527/api` | Next.js → `127.0.0.1:8000` | Same origin as frontend |
| FastAPI direct | `http://127.0.0.1:8000` inside the container | 8000 | Not published |

Browser requests use relative `/api/*` URLs. Next.js rewrites them inside the container to FastAPI, and Uvicorn listens only on the container loopback interface. Port `9528` is not required and must not be opened in the host firewall or cloud security group.

Useful commands:

```bash
docker compose ps
docker compose logs -f tutor
curl -fsS http://127.0.0.1:9527/api/health
curl -I http://127.0.0.1:9527/
docker compose down
```

A healthy deployment returns success through port `9527`, while `curl --max-time 3 http://127.0.0.1:9528/api/health` must fail to connect. `docker compose ps` should show only `9527:3000` as a published host mapping; a bare `8000/tcp` entry is image metadata, not a published port.

The Compose file bind-mounts the repository `data/` directory so the SQLite database, credentials, authored content, logs, and imported exams persist across container recreation. Back up `data/` before upgrades or manual runtime changes.

## Frontend configuration

Only frontend feature flags are embedded at build time:

| Variable | Behaviour |
| --- | --- |
| `NEXT_PUBLIC_GUIDED_PRACTICE` | Set to `false` to hide Guided Practice. Enabled by default. |
| `NEXT_PUBLIC_LEARNING_MAP` | Set to `false` to disable learning-map navigation. Enabled by default. |
| `NEXT_PUBLIC_SCIENCE_LAB` | Set to `false` to hide advertised Science Lab entry points; direct `/science-lab` access remains available. Enabled by default. |

Backend-only variables such as `LLM_API_KEY`, `API_KEY`, `CORS_ORIGINS`, `JWT_SECRET`, and `PARENT_PASSWORD` belong in the root `.env`. Never expose their values through `NEXT_PUBLIC_*`. `PARENT_PASSWORD` is validated server-side and has no built-in default; an empty value keeps parent access locked.

## Application routes

| Route | Purpose |
| --- | --- |
| `/` | Standard practice with curriculum/topic selection and tutor feedback |
| `/today` | Daily study plan: past mistakes, review, a new topic (the student can choose it), and a final check. Steps in any order; the final check is last. Optional more practice after the day is done. Each step stops on evidence |
| `/today/practice` | The one practice page for every Today step, also the past-mistake steps (`?today_task=<id>`) |
| `/guided-practice` | Scaffolded concept support, hints, corrective retries, and fading support |
| `/diagnostic` | Adaptive subject/year or senior-unit diagnostic assessment |
| `/dashboard` | Topic progress, mastery, recommendations, and study-plan views |
| `/weekly-report` | Calendar-week learning review, evidence summary, and student reflection |
| `/mistakes` | Error Book with evidence-based mistake review and retry workflows |
| `/quests` | Daily quest board and rewards |
| `/challenge` | Timed Speed Round fluency practice |
| `/exam` | Mock exam setup, in-progress session, resume, and results |
| `/writing` | Years 7–10 and senior writing planning, drafting, assessment, and revision tools |
| `/parent` | Server-authorized parent dashboard and student/profile management |
| `/bank-review` | Parent-authorized exercise-bank review workflow |
| `/psmt` | QCAA PSMT assistant and saved history |
| `/lab` | Interactive Maths Lab |
| `/science-lab` | 18 AC9 Years 7–10 investigations with Learn, Explore, local Inquiry Notebook, and transfer practice |

### Science Lab boundary

Science Lab is deliberately frontend-only and independent of mastery. Its 18 activities use typed pure models with lazy SVG/Canvas scenes. Learn mode gates result-bearing observations until prediction, then requires a student-scoped browser-local notebook containing variables, three observations with two distinct data states, CER, and a model limitation before durable completion. Predictions may be incorrect; the evidence-based revision is the learning goal. Lab state never updates BKT, and only transfer practice enters the normal marking path. Browser-local drafts do not sync to another device.

`NEXT_PUBLIC_SCIENCE_LAB=false` hides advertised Science Lab entry points. The direct route remains available for standalone access and testing.

## Frontend architecture

```text
src/
├── app/                 App Router pages and route-level workflows
├── components/          Shared UI, tutor workflow, diagrams, and accessibility helpers
│   ├── tutor/           Question display, answer inputs, lesson content, hints, and dialogue
│   ├── lab/             Interactive Maths Lab scenes and controls
│   ├── lab-shared/      Shared laboratory layout and control primitives
│   └── science-lab/     Science Lab directories, controls, and renderers
├── lib/                 API client, typed models, identity, preferences, and feature flags
│   └── science-lab/     Simulation models, registry, clock, performance, and curriculum mapping
└── __tests__/           Vitest and Testing Library regression tests
```

Important conventions:

- Browser API calls use relative `/api/*` URLs. `next.config.ts` rewrites them server-side to `http://127.0.0.1:8000/api/*`; no public API origin, port, or key is embedded in browser JavaScript.
- `safeFetch` attaches the active student session, disables browser HTTP caching for API calls, handles token refresh, and supports request cancellation/timeouts.
- The shared `QuestionDisplay` and tutor input components are reused by standard practice and Diagnostic so question cards, LaTeX, diagrams, and answer controls stay aligned.
- Diagnostic transitions directly to the next question after a response; a prior question's Correct/Incorrect/Not scored verdict is not carried into the next question.
- Student UUID, display name, subject/year preferences, locale, navigation view, and senior-preview selections are stored in browser storage. Parent authorization is held separately in `sessionStorage` and remains server-validated.
- The default locale is `en-AU`. Mathematical Markdown produces HTML and MathML through KaTeX for visual and assistive-technology support.

## Testing and verification

Run commands from `frontend/`:

```bash
# Full frontend regression suite
npm test

# Install the pinned Playwright browser once, then run desktop/mobile Science Lab E2E
npx playwright install chromium
npm run test:e2e

# Authored-bank rendering and asset checks
npm run test:authoring

# Watch mode
npm run test:watch

# ESLint
npm run lint

# TypeScript validation
npx tsc --noEmit

# Production build
npm run build
```

Useful focused checks include:

```bash
npx vitest --run src/__tests__/diagnostic.test.tsx
npm audit --audit-level=low
```

The full Vitest suite covers route workflows, API behavior, accessibility, diagrams, Guided Practice, Diagnostic, exams, daily study, Error Book, quests, Writing Hub, parent components, Maths Lab, and Science Lab. `npm run test:e2e` starts an isolated Next.js server on `127.0.0.1:3100` and runs the Science Lab in desktop Chromium and a Pixel 5 mobile profile, including all-renderer smoke, inquiry completion, repaired simulation interactions, and touch scrolling. A successful production build is also required for Docker because the image copies the built Next.js output into the runtime stage.

The current lockfile reports **0 vulnerabilities** through `npm audit`. During `npm ci`, npm may emit a peer warning for `mafs@0.21.0 → use-resize-observer@9.1.0` because that package's peer metadata stops at React 18 while the project uses React 19.2.4. This is an upstream compatibility warning rather than an audit finding. Do not use `npm audit fix --force` or force `use-resize-observer@10`; v10 changes its export API. Keep the warning covered by the Maths Lab tests until Mafs publishes a compatible dependency update.

## Troubleshooting

- **`/api` requests fail through the frontend:** confirm FastAPI is running on `127.0.0.1:8000` in the same container (or on local port `8000` during development), then inspect `docker compose logs tutor`. Do not restore a public 9528 mapping.
- **Unexpected CORS or authorization errors:** set `CORS_ORIGINS` to the exact frontend origin, for example `http://SERVER_IP:9527`, and recreate the Compose service. Browser requests should remain same-origin on `/api`.
- **Port 9528 is reachable:** remove any `9528:8000` Compose mapping and close the corresponding host-firewall/cloud-security-group rule; the supported public entry point is port `9527` only.
- **Changes are missing from Docker:** run `docker compose up --build -d --force-recreate`; the Docker image contains a build-time snapshot of the frontend.
- **Parent Dashboard cannot unlock:** configure a non-empty server-side `PARENT_PASSWORD`; there is deliberately no client-side or built-in default password.
- **No LLM credentials:** closed-answer local marking and deterministic workflows still run, while semantic open responses use the backend's safe deferred/review behavior described in the repository README.
