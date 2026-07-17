from __future__ import annotations

from datetime import datetime

from sqlalchemy import select

from app.models.db import UserSettings


def settings_to_dict(settings: UserSettings) -> dict:
    return {
        "memoryEnabled": bool(settings.memory_enabled),
        "preferences": settings.preferences or {},
        "createdAt": settings.created_at.isoformat() if settings.created_at else None,
        "updatedAt": settings.updated_at.isoformat() if settings.updated_at else None,
    }


async def get_or_create_user_settings(session, user_id: str) -> UserSettings:
    result = await session.execute(select(UserSettings).where(UserSettings.user_id == user_id))
    settings = result.scalar_one_or_none()
    if settings is not None:
        return settings

    settings = UserSettings(
        user_id=user_id,
        memory_enabled=True,
        preferences={},
    )
    session.add(settings)
    await session.flush()
    return settings


async def is_user_memory_enabled(session, user_id: str) -> bool:
    settings = await get_or_create_user_settings(session, user_id)
    return bool(settings.memory_enabled)


async def update_user_memory_enabled(session, user_id: str, enabled: bool) -> UserSettings:
    settings = await get_or_create_user_settings(session, user_id)
    settings.memory_enabled = bool(enabled)
    settings.updated_at = datetime.utcnow()
    await session.flush()
    return settings
