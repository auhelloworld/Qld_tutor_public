import bcrypt
import json
import threading
import uuid
from pathlib import Path
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from backend.student_identity import UUID_V4_PATTERN, create_student_token
from backend.student_lifecycle import student_lifecycle_lock
from backend.rate_limiter import RATE_LIMIT_DEFAULTS, _RATE_LIMITER
from backend.rules import is_student_deleted, save_display_name

router = APIRouter(prefix="/api/auth", tags=["auth"])

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
CREDENTIALS_PATH = _PROJECT_ROOT / "data" / "credentials.json"
_CREDS_LOCK = threading.Lock()
_DUMMY_PASSWORD_HASH = bcrypt.hashpw(b"invalid-credential", bcrypt.gensalt()).decode()


class CredentialStoreUnavailable(RuntimeError):
    """The credential file exists but cannot be trusted or decoded."""


def _load_credentials() -> dict:
    if not CREDENTIALS_PATH.exists():
        return {}
    try:
        raw = CREDENTIALS_PATH.read_text(encoding="utf-8")
    except OSError as exc:
        raise CredentialStoreUnavailable("credential store cannot be read") from exc
    # A newly mounted data directory may contain an empty placeholder. Treat
    # only blank content as an empty store; malformed non-empty JSON remains a
    # fail-closed error so registration can never erase existing accounts.
    if not raw.strip():
        return {}
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise CredentialStoreUnavailable("credential store cannot be read") from exc
    if not isinstance(payload, dict):
        raise CredentialStoreUnavailable("credential store must contain an object")
    return payload


def _save_credentials(data: dict) -> None:
    import os
    import tempfile

    CREDENTIALS_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=str(CREDENTIALS_PATH.parent),
        prefix=f".{CREDENTIALS_PATH.name}.",
        suffix=".tmp",
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2, ensure_ascii=False)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, CREDENTIALS_PATH)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def remove_credentials_for_student(student_id: str) -> int:
    """Remove every registered-name mapping for one deleted student."""
    with _CREDS_LOCK:
        credentials = _load_credentials()
        retained = {
            name: record
            for name, record in credentials.items()
            if not isinstance(record, dict) or record.get("student_id") != student_id
        }
        removed = len(credentials) - len(retained)
        if removed:
            _save_credentials(retained)
        return removed


def get_registered_student_profiles() -> list[dict[str, str]]:
    """Return the non-secret profile projection for locally registered students."""
    with _CREDS_LOCK:
        credentials = _load_credentials()

    if not isinstance(credentials, dict):
        return []

    profiles_by_id: dict[str, str] = {}
    for raw_name, record in sorted(
        credentials.items(), key=lambda item: str(item[0]).casefold()
    ):
        if not isinstance(record, dict):
            continue
        student_id = str(record.get("student_id") or "").strip()
        display_name = str(raw_name).strip()
        if (
            student_id not in profiles_by_id
            and UUID_V4_PATTERN.fullmatch(student_id)
            and display_name
        ):
            profiles_by_id[student_id] = display_name

    return [
        {"student_id": student_id, "display_name": display_name}
        for student_id, display_name in sorted(profiles_by_id.items())
    ]


class RegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=4, max_length=100)
    student_id: str | None = Field(default=None, max_length=64)


class LoginRequest(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1, max_length=100)


class AuthResponse(BaseModel):
    student_id: str
    access_token: str
    token_type: str = "bearer"
    display_name: str | None = None


@router.post("/register", response_model=AuthResponse)
def register(req: RegisterRequest):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail={"error": "invalid_name", "message": "Name cannot be empty."})

    # A deleted anonymous UUID is never reusable. Allocate a fresh identity so
    # registration cannot create a credential that database tombstones reject.
    if req.student_id and UUID_V4_PATTERN.fullmatch(req.student_id):
        student_id = req.student_id
    else:
        student_id = str(uuid.uuid4())
    if is_student_deleted(student_id):
        student_id = str(uuid.uuid4())

    with student_lifecycle_lock(student_id):
        # Recheck while holding the same lock used by profile deletion.
        if is_student_deleted(student_id):
            student_id = str(uuid.uuid4())

        with _CREDS_LOCK:
            try:
                creds = _load_credentials()
            except CredentialStoreUnavailable as exc:
                raise HTTPException(
                    status_code=503,
                    detail={
                        "error": "credential_store_unavailable",
                        "message": "The credential store is unavailable. No account data was changed.",
                    },
                ) from exc
            if name in creds:
                raise HTTPException(status_code=409, detail={"error": "name_taken", "message": f"Name '{name}' is already registered. Use login instead."})

            original_credentials = dict(creds)
            pw_hash = bcrypt.hashpw(req.password.encode(), bcrypt.gensalt()).decode()
            creds[name] = {"student_id": student_id, "password_hash": pw_hash}
            _save_credentials(creds)
            try:
                # Sync the canonical display name before returning a credential.
                save_display_name(student_id, name)
            except Exception as exc:
                try:
                    _save_credentials(original_credentials)
                except Exception as rollback_exc:
                    raise HTTPException(
                        status_code=503,
                        detail={
                            "error": "registration_rollback_failed",
                            "message": "Registration could not be completed safely. Parent cleanup is required.",
                        },
                    ) from rollback_exc
                raise HTTPException(
                    status_code=503,
                    detail={
                        "error": "registration_persistence_failed",
                        "message": "Registration could not be saved. No credential was retained.",
                    },
                ) from exc

    token = create_student_token(student_id)
    return AuthResponse(student_id=student_id, access_token=token, display_name=name)


@router.post("/login", response_model=AuthResponse)
def login(req: LoginRequest):
    name = req.name.strip()
    rate_key = name.casefold() or "anonymous"
    endpoint_key = "POST /api/auth/login"
    limit = RATE_LIMIT_DEFAULTS[endpoint_key]
    if not _RATE_LIMITER.admit(rate_key, endpoint_key, limit):
        retry_after = _RATE_LIMITER.retry_after_seconds(rate_key, endpoint_key)
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limited",
                "message": "Too many login attempts. Please wait and try again.",
            },
            headers={"Retry-After": str(retry_after)},
        )

    try:
        creds = _load_credentials()
    except CredentialStoreUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "credential_store_unavailable",
                "message": "The credential store is unavailable. No account data was changed.",
            },
        ) from exc

    record = creds.get(name)
    stored_hash = (
        str(record.get("password_hash"))
        if isinstance(record, dict) and record.get("password_hash")
        else _DUMMY_PASSWORD_HASH
    )
    try:
        password_valid = bcrypt.checkpw(req.password.encode(), stored_hash.encode())
    except (TypeError, ValueError):
        password_valid = False
    if not isinstance(record, dict) or not password_valid:
        raise HTTPException(
            status_code=401,
            detail={"error": "invalid_credentials", "message": "Invalid name or password."},
        )

    student_id = str(record.get("student_id") or "")
    if not UUID_V4_PATTERN.fullmatch(student_id):
        raise HTTPException(
            status_code=401,
            detail={"error": "invalid_credentials", "message": "Invalid name or password."},
        )
    # Sync the credential name to the database on every login so the
    # Parent View student list stays consistent with the registered name.
    save_display_name(student_id, name)

    token = create_student_token(student_id)
    return AuthResponse(student_id=student_id, access_token=token, display_name=name)
