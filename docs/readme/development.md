# Development and configuration

## Run locally

### Prerequisites

- Python 3.10 or newer
- Node.js 20 or newer
- npm

### Install

Linux/macOS:

```bash
python3 -m venv backend/venv
backend/venv/bin/pip install -e ".[dev,test]"
cd frontend
npm install
cd ..
cp .env.example .env
```

Windows PowerShell:

```powershell
python -m venv backend/venv
backend/venv/Scripts/python.exe -m pip install -e ".[dev,test]"
Set-Location frontend
npm install
Set-Location ..
Copy-Item .env.example .env
```

### Start

On Linux/macOS, the helper script starts both applications in production mode by default:

```bash
./start.sh
```

Use `./start.sh --dev` only when you need Uvicorn reload and the Next.js Turbopack development server. `./start.sh --prod` remains an explicit alias for the default production mode. Production mode builds the frontend only when `frontend/.next/server` is absent, so run `npm run build` yourself after frontend changes. The script expects the virtual environment at `backend/venv`.

For manual startup, run these in separate terminals:

```bash
# terminal 1
backend/venv/bin/python -m uvicorn backend.api:app --host 0.0.0.0 --port 8000 --reload

# terminal 2
cd frontend
npm run dev
```

On Windows, replace the backend executable with `backend/venv/Scripts/python.exe`.

Open:

- Student UI: `http://localhost:3000`
- Weekly learning review: `http://localhost:3000/weekly-report`
- Backend health: `http://localhost:8000/api/health`
- Interactive API docs: `http://localhost:8000/docs`

## Configuration

The backend loads the root `.env` file. Next.js only reads the documented `NEXT_PUBLIC_*` feature flags during development compilation or the production build; API routing is fixed to the same-origin `/api` namespace and does not use a public backend URL, port, or shared key.

| Variable | Behaviour |
| --- | --- |
| `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` | Generic OpenAI-compatible provider. **All three** must be non-empty to select this configuration. |
| `GEMINI_API_KEY` | Fallback provider when the complete generic configuration is absent; uses Google's OpenAI-compatible endpoint and `gemini-1.5-flash` from `backend/llm_provider.py`. |
| `OPENAI_API_KEY` | Next fallback; uses the OpenAI SDK default endpoint and `gpt-4o-mini` from `backend/llm_provider.py`. |
| `LLM_TIMEOUT` | Optional tutor/marking request timeout; default `30` seconds. |
| `EXAM_LLM_ADJUDICATION` | Optional one-way second opinion for locally rejected, adjudicable maths value answers in exams and Diagnostic; defaults to enabled. Set `false` for fully deterministic exam/Diagnostic marking. |
| `WRITING_TIMEOUT` | Optional timeout for each Writing Hub provider call; default `120` seconds. |
| `WRITING_TOTAL_TIMEOUT` | End-to-end live Writing assessment deadline across initial and compact calls; default and maximum `180` seconds. The browser waits `190` seconds. |
| `WRITING_MAX_TOKENS` | Optional Writing Hub output limit; default `6000`. |
| `CORS_ORIGINS` | Comma-separated browser origins. Defaults to `http://localhost:3000`. Set the deployed frontend origin explicitly. |
| `JWT_SECRET` | HMAC secret for student and parent tokens. If absent, a random secret is created at process start and existing tokens become invalid after restart. Set a stable, strong value in deployment. |
| `PARENT_PASSWORD` | Enables Parent Dashboard login. There is no built-in password; an empty value keeps parent access locked. |
| `API_KEY` | Optional shared key for direct/server-to-server API clients using `X-API-Key`. Browser calls use student sessions through the same-origin Next.js proxy and never embed this secret. |
| `NEXT_PUBLIC_GUIDED_PRACTICE` | Set to `false` to hide guided practice; enabled by default. |
| `NEXT_PUBLIC_LEARNING_MAP` | Set to `false` to disable the learning-map navigation; enabled by default. |
| `NEXT_PUBLIC_SCIENCE_LAB` | Set to `false` to hide advertised Science Lab entry points; the direct `/science-lab` route remains available for standalone access and testing. Enabled by default. |

Provider selection order is: complete `LLM_*` configuration, then `GEMINI_API_KEY`, then `OPENAI_API_KEY`, then mock mode. `LLM_BASE_URL` and `LLM_MODEL` do not receive implicit backend defaults when only `LLM_API_KEY` is set; use the values in `.env.example` as an explicit generic-provider starting point. To use a Gemini or OpenAI fallback, first leave the generic configuration incomplete (for example, set `LLM_API_KEY=`), then add the fallback key. The supplied Compose service passes only the generic `LLM_*` credentials by default; add `GEMINI_API_KEY` or `OPENAI_API_KEY` to its `environment` list before relying on that fallback in Docker.

Browser requests always target `/api` on the current frontend origin. In Docker, Next.js forwards those requests inside the shared container to `http://127.0.0.1:8000`; local Next.js development uses the same rewrite. Do not put server secrets in `NEXT_PUBLIC_*` variables.

### Mock mode

Mock mode is selected only when no complete provider configuration is present. Because `.env.example` contains the non-empty placeholder `LLM_API_KEY=sk-your-key-here`, replace it with a real key or set `LLM_API_KEY=` after copying the file; the placeholder is treated as configured and will not select mock mode. The student home page presents mock mode as **Limited feedback mode**: it confirms that closed-answer marking still works and explains that some open responses may need parent review, without asking the student to configure a server key.

- deterministic practice and local marking continue to work;
- open responses that need semantic/rubric judgement are deferred for parent review instead of being marked wrong;
- diagnostic deferred responses do not update mastery;
- Provider timeouts, transport failures, unavailable, retryable, and pending grading outcomes remain neutral rather than becoming incorrect marks or mastery/Error Book evidence;
- Writing Hub shows local pre-check feedback and supports manual bring-your-own-LLM export/import;
- mock Writing/PSMT output is labelled as placeholder feedback.

Mock mode is useful for development and closed-answer practice, but it is not equivalent to live semantic marking.

## Marking and LLM failure behaviour

Marking is dispatched by subject and question type:

- **Maths-family short answers** use deterministic numeric/symbolic equivalence with fraction, unit, and tolerance handling first. In normal tutor practice, exams, and Diagnostic, a configured LLM may adjudicate a locally rejected value answer; it can only upgrade an explicitly confirmed equivalent response, never overturn a local correct result. Open/reasoning responses still use semantic marking or safe review deferral.
- **English/Science-family short answers** first use local text equivalence and authored accepted variants. Unmatched open responses use semantic marking when a provider is configured.
- **Reasoning items** use authored rubric points. The server recomputes the awarded total from point attainment instead of trusting a model-supplied total.
- **Multi-part items** are scored part by part; unmatched open parts can be sent through the semantic/review path.
- **Punctuation-focused English items** can require strict punctuation rather than normalised text matching.

The provider adapter tolerates common OpenAI-compatible differences, including providers that reject `response_format`, reasoning content outside the normal `content` field, fenced/prose-wrapped JSON, and common scalar aliases. Typed tutor/marking output makes one constrained JSON-repair request after an otherwise unusable structured response. Writing instead requests a bounded complete assessment first; if that response is malformed or omits canonical criteria, it performs one compact re-assessment before returning a retryable failure.

If a live response is still missing, invalid, or incomplete, the system uses an explicit safe state:

- tutor/exam open response: `parent_review_pending`;
- diagnostic open response: `grading_deferred`;
- live Writing assessment: retryable HTTP 503;
- PSMT: one compact re-assessment after malformed or incomplete structured feedback; if that also fails, an unavailable status with a retry message is returned and no formal PSMT history/readiness record is written.

See [LLM runtime audit](../llm-runtime-audit.md) for the deeper failure matrix. That document is supporting analysis, while the code remains authoritative.
