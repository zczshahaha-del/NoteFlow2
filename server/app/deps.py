from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select

from app import database as db
from app.config import cfg
from app.database import AsyncSessionLocal
from app.models.db import UserSession
from app.utils import decode_token


# ── JWT Auth dependency ──

_bearer_scheme = HTTPBearer(auto_error=False)


@dataclass
class CurrentUser:
    id: str
    email: str
    display_name: str
    session_id: Optional[str] = None


def auth_token_from_request(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = None,
) -> Optional[str]:
    if credentials is not None:
        return credentials.credentials
    return request.cookies.get(cfg.AUTH_COOKIE_NAME)


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
) -> CurrentUser:
    token = auth_token_from_request(request, credentials)
    if not token:
        raise HTTPException(status_code=401, detail="authentication required")
    payload = decode_token(token)
    if payload is None:
        raise HTTPException(status_code=401, detail="session expired or invalid")

    session_id = payload.get("sid")
    if session_id:
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(UserSession).where(
                    UserSession.id == session_id,
                    UserSession.user_id == payload["sub"],
                    UserSession.revoked_at.is_(None),
                    UserSession.expires_at > datetime.utcnow(),
                )
            )
            if result.scalar_one_or_none() is None:
                raise HTTPException(status_code=401, detail="session has been revoked or expired")

    return CurrentUser(
        id=payload["sub"],
        email=payload.get("email", ""),
        display_name=payload.get("displayName", ""),
        session_id=session_id,
    )


# ── Redis rate limiter ──

def redis_rate_limit(prefix: str, limit: int, window_seconds: int = 60):
    async def _rate_limit(request: Request, user: CurrentUser = Depends(get_current_user)):
        if db.redis_client is None or limit <= 0:
            return user

        bucket = int(time.time()) // window_seconds
        key = f"noteflow:rate:{prefix}:{user.id}:{bucket}"
        count = await db.redis_client.incr(key)
        if count == 1:
            await db.redis_client.expire(key, window_seconds + 1)
        if count > limit:
            raise HTTPException(status_code=429, detail="too many AI requests, please try again later")

        return user

    return _rate_limit


_public_rate_windows: dict[str, tuple[int, int]] = {}


def public_rate_limit(prefix: str, limit: int, window_seconds: int = 300):
    async def _rate_limit(request: Request):
        if limit <= 0:
            return
        address = request.client.host if request.client else "unknown"
        bucket = int(time.time()) // window_seconds
        key = f"noteflow:rate:{prefix}:{address}:{bucket}"

        if db.redis_client is not None:
            count = await db.redis_client.incr(key)
            if count == 1:
                await db.redis_client.expire(key, window_seconds + 1)
        else:
            previous_bucket, previous_count = _public_rate_windows.get(key, (bucket, 0))
            count = previous_count + 1 if previous_bucket == bucket else 1
            _public_rate_windows[key] = (bucket, count)
            if len(_public_rate_windows) > 2048:
                stale_keys = [
                    item
                    for item, (item_bucket, _) in _public_rate_windows.items()
                    if item_bucket < bucket
                ]
                for item in stale_keys:
                    _public_rate_windows.pop(item, None)

        if count > limit:
            raise HTTPException(
                status_code=429,
                detail="too many authentication attempts, please try again later",
            )

    return _rate_limit
