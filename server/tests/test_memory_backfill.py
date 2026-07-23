from __future__ import annotations

import unittest
from datetime import datetime, timedelta
from types import SimpleNamespace

from app.memory.backfill import (
    _backfill_key,
    _eligible_backfill_memories,
)


def _memory(**overrides):
    values = {
        "id": "memory-1",
        "content": "用户喜欢简洁的回答",
        "status": "active",
        "deleted_at": None,
        "expires_at": None,
        "external_provider": None,
        "external_id": None,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class MemoryBackfillTest(unittest.TestCase):
    def test_only_safe_active_unlinked_memories_are_selected(self) -> None:
        eligible = _memory(id="eligible")
        linked = _memory(id="linked", external_provider="mem0", external_id="external-1")
        pending = _memory(id="pending", status="pending")
        expired = _memory(id="expired", expires_at=datetime.utcnow() - timedelta(seconds=1))
        secret = _memory(id="secret", content="我的 API Key 是 sk-abcdefghijklmnop")

        selected = _eligible_backfill_memories([eligible, linked, pending, expired, secret])

        self.assertEqual([memory.id for memory in selected], ["eligible"])

    def test_backfill_key_is_stable_within_a_batch(self) -> None:
        self.assertEqual(
            _backfill_key("memory-1", "20260723-v1"),
            "memory:memory-1:upsert:mem0-backfill:20260723-v1",
        )


if __name__ == "__main__":
    unittest.main()
