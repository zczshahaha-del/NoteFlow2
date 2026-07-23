from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession


class Repository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session


def require_user_id(user_id: str) -> str:
    value = (user_id or "").strip()
    if not value:
        raise ValueError("user_id is required for owned repository queries")
    return value
