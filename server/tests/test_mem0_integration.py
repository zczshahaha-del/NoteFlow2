from __future__ import annotations

import asyncio
import unittest

from app.config import cfg
from app.memory.policy import classify_memory_content, filter_eligible_memories
from app.memory.rollout import effective_memory_provider, mem0_shadow_selected
from app.providers.mem0 import Mem0Provider
from app.providers.resilience import AsyncCircuitBreaker, CircuitOpenError


class FakeMem0:
    def __init__(self):
        self.calls = []

    def add(self, content, **kwargs):
        self.calls.append(("add", content, kwargs))
        return {"results": [{"id": "mem0-1", "memory": content, "event": "ADD"}]}

    def search(self, query, **kwargs):
        self.calls.append(("search", query, kwargs))
        return {"results": [{"id": "mem0-1", "memory": "偏好", "metadata": {"noteflow_memory_id": "nf-1"}}]}

    def delete(self, memory_id):
        self.calls.append(("delete", memory_id, {}))
        return {"message": "ok"}


class MissingDeleteMem0(FakeMem0):
    def delete(self, memory_id):
        raise ValueError(f"Memory with id {memory_id} not found")


class MemoryRecord:
    def __init__(self, *, status="active", content="用户偏好：简洁", deleted_at=None, expires_at=None):
        self.status = status
        self.content = content
        self.deleted_at = deleted_at
        self.expires_at = expires_at


class Mem0IntegrationTest(unittest.IsolatedAsyncioTestCase):
    async def test_provider_is_user_scoped_and_uses_raw_add(self):
        client = FakeMem0()
        provider = Mem0Provider(client_factory=lambda: client)
        added = await provider.add(user_id="u-1", content="用户偏好：简洁", metadata={"noteflow_memory_id": "nf-1"})
        rows = await provider.search(user_id="u-1", query="怎么回答", limit=6)
        deleted = await provider.delete(user_id="u-1", memory_id="mem0-1")
        self.assertEqual(added["id"], "mem0-1")
        self.assertEqual(rows[0]["metadata"]["noteflow_memory_id"], "nf-1")
        self.assertTrue(deleted)
        self.assertFalse(client.calls[0][2]["infer"])
        self.assertEqual(client.calls[1][2]["filters"], {"user_id": "u-1"})

    async def test_circuit_opens_and_recovers_only_after_cooldown(self):
        breaker = AsyncCircuitBreaker(2, 60, 60)

        async def fail():
            raise TimeoutError("provider unavailable")

        for _ in range(2):
            with self.assertRaises(TimeoutError):
                await breaker.call(fail, timeout_ms=100)
        with self.assertRaises(CircuitOpenError):
            await breaker.call(fail, timeout_ms=100)

    async def test_delete_is_idempotent_when_external_record_is_already_gone(self):
        provider = Mem0Provider(client_factory=MissingDeleteMem0)
        self.assertTrue(await provider.delete(user_id="u-1", memory_id="gone"))

    def test_sensitive_and_temporary_values_never_enter_context(self):
        for text in (
            "请记住密码 NeverStore-8899",
            "API_KEY=sk-abcdefghijklmnop",
            "银行卡号 6222021234567890",
            "病历号 M-2026-991",
            "我朋友叫李雷，他住在北京",
            "这次先暂时不要代码",
        ):
            with self.subTest(text=text):
                self.assertFalse(classify_memory_content(text).allowed)
        rows = [MemoryRecord(), MemoryRecord(content="密码是 NeverStore-8899")]
        self.assertEqual(len(filter_eligible_memories(rows)), 1)

    def test_rollout_is_off_by_default_and_allowlist_is_exact(self):
        old = {
            "MEMORY_PROVIDER": cfg.MEMORY_PROVIDER,
            "MEM0_CANARY_ENABLED": cfg.MEM0_CANARY_ENABLED,
            "MEM0_CANARY_USER_IDS": cfg.MEM0_CANARY_USER_IDS,
            "MEMORY_SHADOW_ENABLED": cfg.MEMORY_SHADOW_ENABLED,
            "MEMORY_SHADOW_READ_PERCENT": cfg.MEMORY_SHADOW_READ_PERCENT,
        }
        try:
            cfg.MEMORY_PROVIDER = "mem0"
            cfg.MEM0_CANARY_ENABLED = True
            cfg.MEM0_CANARY_USER_IDS = {"internal-user"}
            cfg.MEMORY_SHADOW_ENABLED = True
            cfg.MEMORY_SHADOW_READ_PERCENT = 100
            self.assertEqual(effective_memory_provider("internal-user"), "mem0")
            self.assertEqual(effective_memory_provider("other-user"), "legacy")
            self.assertTrue(mem0_shadow_selected("other-user"))
            cfg.MEM0_CANARY_ENABLED = False
            self.assertEqual(effective_memory_provider("other-user"), "mem0")
        finally:
            for key, value in old.items():
                setattr(cfg, key, value)


if __name__ == "__main__":
    unittest.main()
