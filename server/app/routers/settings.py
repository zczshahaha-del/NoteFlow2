from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.database import AsyncSessionLocal
from app.deps import CurrentUser, get_current_user
from app.services.user_settings import (
    get_or_create_user_settings,
    settings_to_dict,
    update_user_memory_enabled,
)

router = APIRouter(prefix="/settings", tags=["settings"])


class SettingsUpdatePayload(BaseModel):
    memoryEnabled: Optional[bool] = None


@router.get("")
async def get_settings(user: CurrentUser = Depends(get_current_user)):
    async with AsyncSessionLocal() as session:
        settings = await get_or_create_user_settings(session, user.id)
        await session.commit()
        await session.refresh(settings)
        return {"settings": settings_to_dict(settings)}


@router.put("")
async def update_settings(
    payload: SettingsUpdatePayload,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        settings = await get_or_create_user_settings(session, user.id)
        if payload.memoryEnabled is not None:
            settings = await update_user_memory_enabled(session, user.id, payload.memoryEnabled)
        await session.commit()
        await session.refresh(settings)
        return {"settings": settings_to_dict(settings)}
