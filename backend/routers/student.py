import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from backend.student_identity import (
    UUID_V4_PATTERN,
    create_student_token,
    ensure_parent_student_access,
    require_parent,
    require_student_id,
)
from backend.rules import save_display_name, get_student_list, delete_student_data
from backend.routers.auth import get_registered_student_profiles

router = APIRouter(prefix="/api/student", tags=["student"])

class SaveProfileRequest(BaseModel):
    display_name: str = Field(..., min_length=1, max_length=100)


class TokenRequest(BaseModel):
    student_id: str | None = Field(None, description="Optional existing student UUID v4 to register/login")


def _get_household_student_profiles() -> list[dict]:
    """Merge learning-data profiles with credential-only registered students."""
    profiles_by_id = {
        str(profile["student_id"]): {
            "student_id": str(profile["student_id"]),
            "display_name": profile.get("display_name"),
            "subjects": list(profile.get("subjects") or []),
        }
        for profile in get_student_list()
        if profile.get("student_id")
    }

    for registered in get_registered_student_profiles():
        student_id = registered["student_id"]
        profile = profiles_by_id.setdefault(
            student_id,
            {
                "student_id": student_id,
                "display_name": None,
                "subjects": [],
            },
        )
        if not profile.get("display_name"):
            profile["display_name"] = registered.get("display_name")

    return [profiles_by_id[student_id] for student_id in sorted(profiles_by_id)]


@router.post("/token")
def get_token(req: TokenRequest):
    """Generate or retrieve a cryptographically signed JWT bearer token for the student."""
    student_id = req.student_id
    if student_id:
        student_id = student_id.strip()
        if not UUID_V4_PATTERN.match(student_id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Provided student_id is not a valid UUID v4"
            )
    else:
        student_id = str(uuid.uuid4())
        
    try:
        token = create_student_token(student_id)
        return {
            "access_token": token,
            "token_type": "bearer",
            "student_id": student_id
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate session token: {str(e)}"
        )


@router.post("/profile")
def save_profile(
    req: SaveProfileRequest,
    student_id: str = Depends(require_student_id),
):
    """Save the student's display name to the backend."""
    save_display_name(student_id, req.display_name.strip())
    return {"status": "ok", "display_name": req.display_name.strip()}


@router.get("/list")
def list_students(
    student_id: str = Depends(require_student_id),
    parent_student_id: str = Depends(require_parent),
):
    """List all local student profiles for parent household management.

    Requires a valid parent session bound to the active browser student.
    The full list is returned so a parent can switch or delete any profile
    on this installation (not only the currently active one).
    """
    # Parent token must match the active student session (proves unlock).
    if student_id != parent_student_id:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "student_scope_mismatch",
                "message": "This parent session is not authorized for the active student.",
            },
        )
    return {"students": _get_household_student_profiles()}


@router.delete("/{student_id}")
def delete_student(
    student_id: str,
    caller_id: str = Depends(require_student_id),
    parent_student_id: str = Depends(require_parent),
):
    """Delete all data for a student across all tables and files.

    Requires parent authorization. The parent session must be bound to the
    active browser student; the target may be any local profile (household
    management), not only the active one.
    """
    if caller_id != parent_student_id:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "student_scope_mismatch",
                "message": "This parent session is not authorized for the active student.",
            },
        )
    if not UUID_V4_PATTERN.fullmatch(student_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "invalid_student_id",
                "message": "Deletion target must be a valid student UUID v4.",
            },
        )
    delete_student_data(student_id)
    return {"status": "ok", "message": f"Student {student_id} deleted."}
