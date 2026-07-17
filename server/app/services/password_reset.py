from __future__ import annotations

import hashlib
import logging
import secrets
from urllib.parse import quote

import httpx

from app.config import cfg

logger = logging.getLogger(__name__)


def generate_reset_token() -> tuple[str, str]:
    token = secrets.token_urlsafe(32)
    return token, hash_reset_token(token)


def hash_reset_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def reset_url(email: str, token: str) -> str:
    return f"{cfg.FRONTEND_BASE_URL}/?resetEmail={quote(email)}&resetToken={quote(token)}"


async def deliver_reset_token(email: str, token: str) -> bool:
    if not cfg.PASSWORD_RESET_WEBHOOK_URL:
        return False
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(
            cfg.PASSWORD_RESET_WEBHOOK_URL,
            json={
                "type": "password_reset",
                "email": email,
                "resetUrl": reset_url(email, token),
                "expiresInMinutes": cfg.PASSWORD_RESET_TTL_MINUTES,
            },
        )
        response.raise_for_status()
    return True
