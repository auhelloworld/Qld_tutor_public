"""Student quests / stars API (game motivation)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.services import quests as quests_svc
from backend.student_identity import ensure_parent_student_access, require_parent, require_student_id

router = APIRouter(tags=["quests"])


def _today_stats(student_id: str, subject: str = "math") -> dict:
    """Cross-subject daily attempts / streak (subject arg kept for API compat)."""
    _ = subject  # wallet is global; progress merges all subject logs
    return quests_svc.collect_cross_subject_stats(student_id)


@router.get("/api/quests/overview")
def quests_overview(
    subject: str = "math",
    student_id: str = Depends(require_student_id),
):
    stats = _today_stats(student_id, subject)
    return quests_svc.build_overview(
        student_id,
        streak_days=stats["streak_days"],
        today_attempts=stats["today_attempts"],
        today_correct=stats["today_correct"],
        today_independent_attempts=stats.get("today_independent_attempts"),
        today_independent_correct=stats.get("today_independent_correct"),
        daily_goal=stats["daily_goal"],
        activity_dates=stats["activity_dates"],
    )


@router.get("/api/quests/wallet")
def quests_wallet(student_id: str = Depends(require_student_id)):
    """Lightweight stars chip for the practice home page."""
    return quests_svc.wallet_public(student_id)


class ClaimRequest(BaseModel):
    quest_id: str = Field(min_length=1, max_length=64)
    subject: str = "math"


@router.post("/api/quests/claim")
def quests_claim(req: ClaimRequest, student_id: str = Depends(require_student_id)):
    stats = _today_stats(student_id, req.subject)
    overview = quests_svc.build_overview(
        student_id,
        streak_days=stats["streak_days"],
        today_attempts=stats["today_attempts"],
        today_correct=stats["today_correct"],
        today_independent_attempts=stats.get("today_independent_attempts"),
        today_independent_correct=stats.get("today_independent_correct"),
        daily_goal=stats["daily_goal"],
        activity_dates=stats["activity_dates"],
    )
    result = quests_svc.claim_quest(student_id, req.quest_id, overview_ctx=overview)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result)
    return result


@router.post("/api/quests/open-chest")
def quests_open_chest(student_id: str = Depends(require_student_id)):
    result = quests_svc.open_chest(student_id)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result)
    return result


@router.post("/api/quests/spin")
def quests_spin(student_id: str = Depends(require_student_id)):
    result = quests_svc.spin_wheel(student_id)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result)
    return result


class RedeemRequest(BaseModel):
    catalog_id: str = Field(min_length=1, max_length=64)
    quantity: int = Field(default=1, ge=1, le=20)


@router.post("/api/quests/redeem")
def quests_redeem(req: RedeemRequest, student_id: str = Depends(require_student_id)):
    result = quests_svc.redeem(student_id, req.catalog_id, quantity=req.quantity)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result)
    return result


# --- Parent admin (X-Parent-Token) ---


@router.get("/api/parent/quests/snapshot")
def parent_quests_snapshot(
    student_id: str = Depends(require_student_id),
    _parent_id: str = Depends(require_parent),
):
    """Wallet + catalog + pending redemptions for the active student."""
    ensure_parent_student_access(student_id, _parent_id)
    return quests_svc.parent_snapshot(student_id)


class ParentSettingsBody(BaseModel):
    enabled: bool | None = None
    shop_enabled: bool | None = None
    chests_enabled: bool | None = None
    spin_enabled: bool | None = None
    daily_star_cap: int | None = Field(default=None, ge=20, le=500)


@router.patch("/api/parent/quests/settings")
def parent_quests_settings(
    body: ParentSettingsBody,
    student_id: str = Depends(require_student_id),
    _parent_id: str = Depends(require_parent),
):
    ensure_parent_student_access(student_id, _parent_id)
    result = quests_svc.parent_update_settings(
        student_id,
        enabled=body.enabled,
        shop_enabled=body.shop_enabled,
        chests_enabled=body.chests_enabled,
        spin_enabled=body.spin_enabled,
        daily_star_cap=body.daily_star_cap,
    )
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result)
    return result


class CatalogItemBody(BaseModel):
    id: str | None = None
    title: str = Field(min_length=1, max_length=80)
    emoji: str = "🎁"
    cost_stars: int = Field(default=40, ge=1, le=5000)
    category: str = "privilege"
    stock: int | None = None
    enabled: bool = True
    sort: int = 100
    description: str = ""


@router.post("/api/parent/quests/catalog")
def parent_quests_save_catalog(
    body: CatalogItemBody,
    student_id: str = Depends(require_student_id),
    _parent_id: str = Depends(require_parent),
):
    ensure_parent_student_access(student_id, _parent_id)
    return quests_svc.parent_save_catalog_item(student_id, body.model_dump())


@router.delete("/api/parent/quests/catalog/{catalog_id}")
def parent_quests_delete_catalog(
    catalog_id: str,
    student_id: str = Depends(require_student_id),
    _parent_id: str = Depends(require_parent),
):
    ensure_parent_student_access(student_id, _parent_id)
    return quests_svc.parent_delete_catalog_item(student_id, catalog_id)


class ResolveRedemptionBody(BaseModel):
    approve: bool
    parent_note: str = ""


@router.post("/api/parent/quests/redemptions/{redemption_id}/resolve")
def parent_quests_resolve(
    redemption_id: str,
    body: ResolveRedemptionBody,
    student_id: str = Depends(require_student_id),
    _parent_id: str = Depends(require_parent),
):
    ensure_parent_student_access(student_id, _parent_id)
    result = quests_svc.parent_resolve_redemption(
        student_id,
        redemption_id,
        approve=body.approve,
        parent_note=body.parent_note or "",
    )
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result)
    return result
