from __future__ import annotations

import hashlib
import html
import logging
import secrets
from urllib.parse import quote

import httpx

from app.config import cfg
from app.services.smtp_delivery import send_email

logger = logging.getLogger(__name__)


def generate_reset_token() -> tuple[str, str]:
    token = secrets.token_urlsafe(32)
    return token, hash_reset_token(token)


def hash_reset_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def reset_url(email: str, token: str) -> str:
    return f"{cfg.FRONTEND_BASE_URL}/?resetEmail={quote(email)}&resetToken={quote(token)}"


async def deliver_reset_token(email: str, token: str) -> bool:
    url = reset_url(email, token)
    if cfg.PASSWORD_RESET_WEBHOOK_URL:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                cfg.PASSWORD_RESET_WEBHOOK_URL,
                json={
                    "type": "password_reset",
                    "email": email,
                    "resetUrl": url,
                    "expiresInMinutes": cfg.PASSWORD_RESET_TTL_MINUTES,
                },
            )
            response.raise_for_status()
        return True

    safe_url = html.escape(url, quote=True)
    return await send_email(
        email,
        "重置你的 NoteFlow 密码",
        "请打开下面的链接设置新密码：\n\n"
        f"{url}\n\n"
        f"链接将在 {cfg.PASSWORD_RESET_TTL_MINUTES} 分钟后失效，且只能使用一次。"
        "如果不是你本人操作，请忽略这封邮件。",
        (
            '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;'
            'color:#1f2937;line-height:1.7">'
            '<h2 style="margin:0 0 16px">重置 NoteFlow 密码</h2>'
            '<p>点击下面的按钮设置新密码：</p>'
            f'<p><a href="{safe_url}" style="display:inline-block;padding:10px 18px;'
            'border-radius:8px;background:#315f7d;color:#fff;text-decoration:none">设置新密码</a></p>'
            f'<p style="color:#6b7280;font-size:13px">链接将在 {cfg.PASSWORD_RESET_TTL_MINUTES} 分钟后失效，且只能使用一次。</p>'
            '<p style="color:#6b7280;font-size:13px">如果不是你本人操作，请忽略这封邮件。</p>'
            '</div>'
        ),
    )
