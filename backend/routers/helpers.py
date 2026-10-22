from fastapi import Depends, HTTPException
from backend.student_identity import require_student_id
from backend.rate_limiter import RATE_LIMIT_DEFAULTS, _RATE_LIMITER
import backend.tutor_engine as _tutor_engine_mod

def rate_limit_dependency(method: str, path: str):
    """Create a FastAPI dependency that rate-limits per student per endpoint."""
    endpoint_key = f"{method} {path}"
    limit = RATE_LIMIT_DEFAULTS.get(endpoint_key, 60)

    async def _check(student_id: str = Depends(require_student_id)):
        if not _RATE_LIMITER.admit(student_id, endpoint_key, limit):
            retry = _RATE_LIMITER.retry_after_seconds(student_id, endpoint_key)
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "rate_limited",
                    "message": f"Too many requests. Retry after {retry}s.",
                    "endpoint": path,
                    "retry_after": retry,
                },
                headers={"Retry-After": str(retry)},
            )
        return student_id

    return _check


def get_tutor_engine():
    """Indirection so tests can patch ``backend.tutor_engine.get_tutor_engine``."""
    return _tutor_engine_mod.get_tutor_engine()
