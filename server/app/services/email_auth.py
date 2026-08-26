from __future__ import annotations

import hashlib
import hmac
import secrets

import httpx

from app.config import cfg
from app.services.smtp_delivery import send_email


def generate_email_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_email_code(email: str, code: str, purpose: str, user_id: str | None = None) -> str:
    message = f"{purpose}:{user_id or '-'}:{email}:{code}".encode("utf-8")
    return hmac.new(cfg.JWT_SECRET.encode("utf-8"), message, hashlib.sha256).hexdigest()


def verify_email_code(
    email: str,
    code: str,
    purpose: str,
    expected_hash: str,
    user_id: str | None = None,
) -> bool:
    actual_hash = hash_email_code(email, code, purpose, user_id)
    return hmac.compare_digest(actual_hash, expected_hash)


async def deliver_email_code(email: str, code: str, purpose: str) -> bool:
    if cfg.AUTH_EMAIL_WEBHOOK_URL:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                cfg.AUTH_EMAIL_WEBHOOK_URL,
                json={
                    "type": "email_login_code" if purpose == "login" else "email_change_code",
                    "email": email,
                    "code": code,
                    "expiresInMinutes": cfg.EMAIL_CODE_TTL_MINUTES,
                },
            )
            response.raise_for_status()
        return True
    if not cfg.SMTP_HOST or not cfg.SMTP_FROM_EMAIL:
        return False
    action = {
        "change_email": "更换登录邮箱",
        "reset_password": "重置 NoteFlow 密码",
    }.get(purpose, "登录 NoteFlow")
    return await send_email(
        email,
        f"NoteFlow 验证码：{code}",
        f"你正在{action}。\n\n验证码：{code}\n\n"
        f"验证码将在 {cfg.EMAIL_CODE_TTL_MINUTES} 分钟后失效。"
        "如果不是你本人操作，请忽略这封邮件。",
    )
