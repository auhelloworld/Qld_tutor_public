import os
import sqlite3
import time
import logging
import threading
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import APIKeyHeader
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

# Logger configuration
logger = logging.getLogger(__name__)

_REQUEST_METRICS_LOCK = threading.Lock()
_REQUEST_COUNT = 0
_REQUEST_IN_FLIGHT = 0
_REQUEST_TOTAL_MS = 0.0
_REQUEST_MAX_MS = 0.0

# Core imports for health endpoint and routing delegates
from backend.tutor_engine import _llm_health, shutdown_error_pattern_executor
from backend.routers.helpers import get_tutor_engine
from backend.rules import initialize_runtime_database

# Import modular router components
from backend.routers.curriculum import router as curriculum_router
from backend.routers.diagnostic import router as diagnostic_router
from backend.routers.exam import router as exam_router
from backend.routers.tutor import router as tutor_router, invalidate_mistakes_cache
from backend.routers.student import router as student_router
from backend.routers.parent import router as parent_router
from backend.routers.auth import router as auth_router
from backend.routers.writing import router as writing_router
from backend.routers.bank_review import router as bank_review_router
from backend.routers.quests import router as quests_router

# Resolution helpers for CORS
def _resolve_cors_origins() -> list[str]:
    """Read CORS_ORIGINS from env (comma-separated) or default to localhost."""
    raw = os.getenv("CORS_ORIGINS", "")
    if raw.strip():
        return [origin.strip() for origin in raw.split(",") if origin.strip()]
    return ["http://localhost:3000"]


_CORS_ORIGINS = _resolve_cors_origins()

# API authentication setup
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def verify_api_key(request: Request, api_key: str = Depends(api_key_header)):
    if request.method == "OPTIONS":
        return
    if request.url.path in ("/api/health", "/api/ready", "/api/student/token") or request.url.path.startswith("/api/auth/"):
        return
    env_key = os.getenv("API_KEY")
    if not env_key:
        return
    
    # 1. Skip API key check when request has any student session (Authorization or X-Student-Id)
    if request.headers.get("Authorization") or request.headers.get("X-Student-Id"):
        return

    # 2. Skip API key check for requests originating from the configured CORS origins (frontend browser)
    origin = request.headers.get("Origin")
    if origin and origin in _CORS_ORIGINS:
        return

    # 3. Check X-API-Key header (backward compatibility, server-to-server)
    if api_key == env_key:
        return
    raise HTTPException(
        status_code=403,
        detail={
            "error": "invalid_api_key",
            "message": "Invalid or missing X-API-Key header.",
        }
    )


app = FastAPI(
    title="QLD AI Tutor API",
    description="Backend API for the QLD AI Tutoring System",
    version="2.0.0",
    dependencies=[Depends(verify_api_key)]
)
app.router.add_event_handler("startup", initialize_runtime_database)
app.router.add_event_handler("shutdown", shutdown_error_pattern_executor)


@app.middleware("http")
async def record_request_metrics(request: Request, call_next):
    """Track bounded, aggregate request metrics without retaining request data."""
    global _REQUEST_COUNT, _REQUEST_IN_FLIGHT, _REQUEST_TOTAL_MS, _REQUEST_MAX_MS
    started = time.monotonic()
    with _REQUEST_METRICS_LOCK:
        _REQUEST_IN_FLIGHT += 1
    try:
        return await call_next(request)
    finally:
        elapsed_ms = (time.monotonic() - started) * 1000
        with _REQUEST_METRICS_LOCK:
            _REQUEST_IN_FLIGHT -= 1
            _REQUEST_COUNT += 1
            _REQUEST_TOTAL_MS += elapsed_ms
            _REQUEST_MAX_MS = max(_REQUEST_MAX_MS, elapsed_ms)

# CORS middleware for the client web interface
if "*" in _CORS_ORIGINS:
    logger.warning("CORS_ORIGINS contains '*'; credentialed cross-origin requests are disabled.")
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex="https?://.*",
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Exercise pools and curriculum views are large, repetitive JSON (about 90%
# smaller compressed). Starlette skips text/event-stream responses.
app.add_middleware(GZipMiddleware, minimum_size=1000)


# --- Custom Exception Handlers ---

@app.exception_handler(HTTPException)
async def structured_http_exception_handler(request, exc):
    """Return the detail dict verbatim when it carries an 'error' key."""
    headers = getattr(exc, "headers", None) or {}
    if isinstance(exc.detail, dict) and "error" in exc.detail:
        return JSONResponse(status_code=exc.status_code, content=exc.detail, headers=headers)
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail}, headers=headers)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc):
    """Map student_answer/student_message length errors to HTTP 400 with structured body."""
    for error in exc.errors():
        loc = error.get("loc", [])
        error_type = error.get("type", "")

        # student_message exceeds 1000 characters
        if "student_message" in str(loc) and error_type == "string_too_long":
            return JSONResponse(
                status_code=400,
                content={
                    "error": "student_message_too_long",
                    "message": "Student message exceeds 1000 characters",
                    "endpoint": request.url.path,
                },
            )

        # student_answer exceeds 1000 characters
        if "student_answer" in str(loc) and error_type == "string_too_long":
            return JSONResponse(
                status_code=400,
                content={
                    "error": "student_answer_too_long",
                    "message": "Student answer exceeds 1000 characters",
                    "endpoint": request.url.path,
                },
            )

    errors_detail = []
    for error in exc.errors():
        loc_str = " -> ".join(str(x) for x in error.get("loc", []) if x != "body")
        msg = error.get("msg", "")
        if msg.startswith("Value error, "):
            msg = msg[len("Value error, "):]
        if loc_str:
            errors_detail.append(f"{loc_str}: {msg}")
        else:
            errors_detail.append(msg)
    
    detailed_message = "; ".join(errors_detail) if errors_detail else "Request body is malformed or missing required fields."

    return JSONResponse(
        status_code=422,
        content={
            "error": "invalid_request_body",
            "message": f"Request body validation failed: {detailed_message}",
            "endpoint": request.url.path,
        },
    )


@app.exception_handler(Exception)
async def catch_all_exception_handler(request, exc):
    """Return structured internal_error with no traceback in the body."""
    logger.exception("Unhandled exception on %s", request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "error": "internal_error",
            "message": "An unexpected error occurred.",
            "endpoint": request.url.path,
        },
    )


# --- Health and readiness checks ---


@app.get("/api/ready")
def readiness_check():
    """Report whether the backend can safely serve the proxied frontend.

    Liveness remains available at /api/health. Readiness additionally verifies
    that the exercise snapshot loaded and the runtime SQLite/data paths are
    accessible, so the entrypoint and Compose do not advertise a half-started
    application.
    """
    checks: dict[str, str | int] = {}
    try:
        engine = get_tutor_engine()
        exercise_count = len(engine.exercises)
        checks["exercise_count"] = exercise_count
        if exercise_count <= 0:
            raise RuntimeError("exercise bank is empty")

        validation = engine.runtime_validation_report()
        skipped_invalid = int(validation.get("skipped_invalid_count", 0))
        checks["skipped_invalid_exercise_count"] = skipped_invalid
        if skipped_invalid:
            raise RuntimeError("exercise bank contains invalid active items")
        invalid_bank_files = int(validation.get("invalid_bank_file_count", 0))
        checks["invalid_exercise_bank_file_count"] = invalid_bank_files
        if invalid_bank_files:
            raise RuntimeError("one or more exercise bank files could not be loaded")

        from backend import rules

        db_path = rules.runtime_db_path()
        db_path.parent.mkdir(parents=True, exist_ok=True)
        if not os.access(db_path.parent, os.W_OK):
            raise RuntimeError("runtime data directory is not writable")
        if db_path.exists() and not os.access(db_path, os.R_OK | os.W_OK):
            raise RuntimeError("runtime database is not readable and writable")

        with sqlite3.connect(str(db_path), timeout=1.0) as conn:
            conn.execute("SELECT 1").fetchone()
        checks["sqlite"] = "ok"
    except Exception as exc:
        logger.warning("Readiness check failed: %s", exc)
        return JSONResponse(
            status_code=503,
            content={
                "status": "not_ready",
                "message": "QLD AI Tutor backend is not ready.",
                "checks": checks,
            },
        )

    return {
        "status": "ready",
        "message": "QLD AI Tutor backend is ready.",
        "checks": checks,
    }


class HealthCheck(BaseModel):
    status: str
    message: str
    llm_status: str = "mock"
    cors_origins: list[str] = []
    runtime: dict[str, int | float | None] = {}


@app.get("/api/health", response_model=HealthCheck)
def health_check():
    engine = get_tutor_engine()

    # Determine LLM health status safely
    if engine.client is None:
        llm_status = "mock"
    else:
        now = time.monotonic()
        if _llm_health.last_failure is not None and (now - _llm_health.last_failure) < 300:
            if _llm_health.last_success is None or _llm_health.last_success < _llm_health.last_failure:
                llm_status = "unreachable"
            else:
                llm_status = "degraded"
        else:
            llm_status = "healthy"

    from backend import rules
    from backend.routers import tutor as tutor_router

    db_path = rules.runtime_db_path()
    db_bytes = db_path.stat().st_size if db_path.exists() else 0
    wal_path = db_path.with_name(db_path.name + "-wal")
    wal_bytes = wal_path.stat().st_size if wal_path.exists() else 0
    with tutor_router._MISTAKES_CACHE_LOCK:
        mistakes_cache_entries = len(tutor_router._MISTAKES_CACHE)
    with tutor_router._SPEED_ROUND_SESSIONS_LOCK:
        speed_round_sessions = len(tutor_router._speed_round_sessions)
    with _REQUEST_METRICS_LOCK:
        request_count = _REQUEST_COUNT
        request_in_flight = _REQUEST_IN_FLIGHT
        request_average_ms = _REQUEST_TOTAL_MS / request_count if request_count else 0.0
        request_max_ms = _REQUEST_MAX_MS

    return {
        "status": "ok",
        "message": "QLD AI Tutor API is running.",
        "llm_status": llm_status,
        "cors_origins": _CORS_ORIGINS,
        "runtime": {
            "exercise_count": len(engine.exercises),
            "exercise_bank_generation": engine.exercise_bank_generation,
            "skipped_invalid_exercise_count": engine.runtime_validation_report()[
                "skipped_invalid_count"
            ],
            "invalid_exercise_bank_file_count": engine.runtime_validation_report()[
                "invalid_bank_file_count"
            ],
            "engine_cache_entries": len(rules._ENGINES),
            "mistakes_cache_entries": mistakes_cache_entries,
            "speed_round_sessions": speed_round_sessions,
            "active_threads": threading.active_count(),
            "sqlite_bytes": db_bytes,
            "sqlite_wal_bytes": wal_bytes,
            "request_count": request_count,
            "request_in_flight": request_in_flight,
            "request_average_ms": round(request_average_ms, 2),
            "request_max_ms": round(request_max_ms, 2),
        },
    }


# Register modular sub-routers
app.include_router(curriculum_router)
app.include_router(diagnostic_router)
app.include_router(exam_router)
app.include_router(tutor_router)
app.include_router(student_router)
app.include_router(parent_router)
app.include_router(auth_router)
app.include_router(writing_router)
app.include_router(bank_review_router)
app.include_router(quests_router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "backend.api:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        reload_dirs=["backend", "core"],
    )
