from __future__ import annotations

import asyncio
import unittest
from unittest.mock import patch

from app.memory.policy import classify_memory_content, filter_eligible_memories
from app.memory.runtime import resolve_memory_read
from app.providers.mem0 import Mem0Provider
from app.providers.resilience import AsyncCircuitBreaker, CircuitOpenError
from app.memory.planning import memory_read_plan_from_turn_plan
from app.services.turn_planner import IntentParameters, PrimaryIntent, TurnPlan


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
    def __init__(
        self,
        *,
        memory_id="nf-1",
        status="active",
        content="用户偏好：简洁",
        canonical_key="",
        deleted_at=None,
        expires_at=None,
    ):
        self.id = memory_id
        self.status = status
        self.content = content
        self.canonical_key = canonical_key
        self.deleted_at = deleted_at
        self.expires_at = expires_at


class UnrelatedMem0Provider:
    async def search(self, **kwargs):
        del kwargs
        return [
            {
                "id": "mem0-unrelated",
                "metadata": {"noteflow_memory_id": "nf-unrelated"},
            }
        ]


class RecordingSession:
    def __init__(self):
        self.added = []

    def add(self, value):
        self.added.append(value)


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

    async def test_provider_can_restrict_search_to_noteflow_projection(self):
        client = FakeMem0()
        provider = Mem0Provider(client_factory=lambda: client)

        await provider.search(
            user_id="u-1",
            query="我叫什么名字",
            limit=6,
            metadata_filters={"noteflow_memory_id": "nf-name"},
        )

        self.assertEqual(
            client.calls[0][2]["filters"],
            {"user_id": "u-1", "noteflow_memory_id": "nf-name"},
        )

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

    async def test_mem0_miss_falls_back_to_safe_relational_candidates(self):
        session = RecordingSession()
        candidates = [
            MemoryRecord(memory_id="nf-age", content="用户年龄为24岁", canonical_key="profile.age"),
            MemoryRecord(memory_id="nf-height", content="用户身高：180cm", canonical_key="profile.height"),
        ]

        with patch("app.memory.runtime.get_mem0_provider", return_value=UnrelatedMem0Provider()):
            result = await resolve_memory_read(
                session,
                user_id="u-1",
                query="我多大，身高多少",
                candidate_memories=candidates,
                limit=6,
            )

        self.assertEqual([memory.id for memory in result], ["nf-age", "nf-height"])
        self.assertTrue(session.added[0].hard_violation)

    def test_height_read_plan_comes_from_the_single_turn_plan(self):
        turn_plan = TurnPlan(
            primary_intent=PrimaryIntent.MEMORY,
            intent_parameters=IntentParameters(
                memory_action="read",
                memory_scope="global",
                memory_layers=["semantic"],
                memory_types=["personal_info"],
                memory_key="profile.height",
                memory_query="用户身高",
            ),
            confidence=0.95,
        )
        plan = memory_read_plan_from_turn_plan(
            turn_plan,
            question="我身高多少你还记得吗",
        )

        self.assertEqual(plan.memory_types, ["personal_info"])
        self.assertEqual(plan.canonical_keys, ["profile.height"])
        self.assertEqual(plan.layers, ["semantic"])
        self.assertEqual(plan.query, "用户身高")

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

if __name__ == "__main__":
    unittest.main()
