from __future__ import annotations

import asyncio
import smtplib
from email.message import EmailMessage
from email.utils import formataddr

from app.config import cfg


async def send_email(
    recipient: str,
    subject: str,
    text_content: str,
    html_content: str | None = None,
) -> bool:
    if not cfg.SMTP_HOST or not cfg.SMTP_FROM_EMAIL:
        return False
    await asyncio.to_thread(
        _send_email,
        recipient,
        subject,
        text_content,
        html_content,
    )
    return True


def _send_email(
    recipient: str,
    subject: str,
    text_content: str,
    html_content: str | None,
) -> None:
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = formataddr(("NoteFlow", cfg.SMTP_FROM_EMAIL))
    message["To"] = recipient
    message.set_content(text_content)
    if html_content:
        message.add_alternative(html_content, subtype="html")

    smtp_factory = smtplib.SMTP_SSL if cfg.SMTP_USE_SSL else smtplib.SMTP
    with smtp_factory(cfg.SMTP_HOST, cfg.SMTP_PORT, timeout=10) as client:
        if cfg.SMTP_USE_TLS and not cfg.SMTP_USE_SSL:
            client.starttls()
        if cfg.SMTP_USERNAME:
            client.login(cfg.SMTP_USERNAME, cfg.SMTP_PASSWORD)
        client.send_message(message)
