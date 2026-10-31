from __future__ import annotations

import unittest
from contextlib import asynccontextmanager
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.routers import agent


class CheckpointSession:
    """Checkpoint-only transaction: no memory SQL, inserts or index writes."""

    def __init__(self):
        self.commits = 0
        self.refreshed = []

    async def commit(self):
        self.commits += 1

    async def refresh(self, record):
        self.refreshed.append(record)

    async def execute(self, *args, **kwargs):
        raise AssertionError("task resolution must not query or mutate long-term memories")

    def add(self, record):
        raise AssertionError("task resolution must not insert memory or outbox records")


class CheckpointMemoryBoundaryTest(unittest.IsolatedAsyncioTestCase):
    def checkpoint(self, kind="edit_preview", status="waiting_user_confirm"):
        return SimpleNamespace(
            id="checkpoint-a", user_id="user-a", run_id="run-a", session_id="session-a",
            checkpoint_type=kind, intent="note_edit", status=status,
            payload={
                "instruction": "把这句话解释得简单一点", "noteId": "note-a",
                "workingMemory": {"title": "修改正式笔记", "currentStep": "preview",
                                  "completedSteps": [], "pendingSteps": ["确认"]},
            },
            created_at=datetime(2026, 10, 31), updated_at=datetime(2026, 10, 31),
            resolved_at=None,
        )

    async def resolve(self, checkpoint, status, **kwargs):
        session = CheckpointSession()

        @asynccontextmanager
        async def sessions():
            yield session

        repository = SimpleNamespace(get_checkpoint=AsyncMock(return_value=checkpoint))
        with patch.object(agent, "AsyncSessionLocal", sessions), patch.object(agent, "RunRepository", return_value=repository):
            result = await agent._resolve_checkpoint_by_id(
                user_id="user-a", checkpoint_id="checkpoint-a", status=status, **kwargs,
            )
        repository.get_checkpoint.assert_awaited_once_with("user-a", "checkpoint-a")
        return result, session

    async def test_terminal_task_outcomes_preserve_history_without_memory_side_effects(self):
        for kind in ("draft_workspace", "edit_preview", "custom_task"):
            for status, working_status in (("resolved", "completed"), ("cancelled", "cancelled"), ("failed", "failed")):
                with self.subTest(kind=kind, status=status):
                    checkpoint = self.checkpoint(kind)
                    result, session = await self.resolve(checkpoint, status, payload_patch={"editPreviewId": "edit-a"})
                    self.assertEqual(result["status"], status)
                    self.assertEqual(result["workingMemory"]["status"], working_status)
                    self.assertEqual(result["workingMemory"]["relatedNoteId"], "note-a")
                    self.assertEqual(result["workingMemory"]["relatedEditPreviewId"], "edit-a")
                    self.assertEqual(result["payload"]["instruction"], "把这句话解释得简单一点")
                    self.assertIsNotNone(result["resolvedAt"])
                    self.assertEqual(session.commits, 1)
                    self.assertEqual(session.refreshed, [checkpoint])
                    if status == "resolved":
                        self.assertEqual(result["workingMemory"]["pendingSteps"], [])
                        self.assertIn("preview", result["workingMemory"]["completedSteps"])

    async def test_retry_cancel_does_not_change_finished_checkpoint(self):
        checkpoint = self.checkpoint(status="resolved")
        result, session = await self.resolve(checkpoint, "cancelled")
        self.assertEqual(result["status"], "resolved")
        self.assertEqual(session.commits, 0)

    async def test_missing_or_unowned_checkpoint_has_no_side_effect(self):
        result, session = await self.resolve(None, "cancelled")
        self.assertIsNone(result)
        self.assertEqual(session.commits, 0)


if __name__ == "__main__":
    unittest.main()
