from __future__ import annotations

import hashlib

from app.config import cfg


def _bucket(user_id: str, namespace: str) -> int:
    digest = hashlib.sha256(f"{namespace}:{user_id}".encode()).digest()
    return int.from_bytes(digest[:4], "big") % 100


def mem0_shadow_selected(user_id: str) -> bool:
    if not cfg.MEMORY_SHADOW_ENABLED:
        return False
    return _bucket(user_id, "mem0-shadow") < cfg.MEMORY_SHADOW_READ_PERCENT


def effective_memory_provider(user_id: str) -> str:
    if cfg.MEMORY_PROVIDER != "mem0":
        return "legacy"
    if not cfg.MEM0_CANARY_ENABLED:
        return "mem0"
    if cfg.MEM0_CANARY_USER_IDS:
        return "mem0" if user_id in cfg.MEM0_CANARY_USER_IDS else "legacy"
    return "mem0" if _bucket(user_id, "mem0-canary") < cfg.MEM0_CANARY_PERCENT else "legacy"


def mem0_write_required(user_id: str) -> bool:
    return bool(cfg.MEMORY_SHADOW_WRITE_ENABLED or effective_memory_provider(user_id) == "mem0")
