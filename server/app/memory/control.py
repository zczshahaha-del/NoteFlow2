from __future__ import annotations

import hashlib
from sqlalchemy import text
from app.config import cfg
from app.services.user_settings import get_or_create_user_settings

DEFAULT_MISSION = (
    "只记录当前用户明确表达的长期偏好、个人背景、持续学习目标。"
    "保留用户的原意和中文表达，不推测缺失信息。忽略临时修改要求、任务状态、"
    "代码、引用文章、举例和他人信息。项目专属要求不升级为全局偏好。"
    "不记录密码、验证码、密钥等敏感信息。遇到矛盾事实不要同时视为确定事实。"
)


async def lock_owner(session, user_id):
    key = int.from_bytes(hashlib.sha256(("memory:" + user_id).encode()).digest()[:8], "big", signed=True)
    await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})


async def control(session, user_id):
    settings = await get_or_create_user_settings(session, user_id)
    return settings, dict((settings.preferences or {}).get("memoryControl") or {})


def save_control(settings, value):
    settings.preferences = {**(settings.preferences or {}), "memoryControl": value}


async def engine_name(session, user_id):
    # Engine selection belongs to deployment configuration, not user settings.
    # Ignore the old per-account opt-in marker, including explicit legacy values.
    return cfg.MEMORY_ENGINE


async def uses_hindsight(user_id):
    return cfg.MEMORY_ENGINE == "hindsight"
