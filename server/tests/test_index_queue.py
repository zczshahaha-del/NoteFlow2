from __future__ import annotations

import asyncio
import unittest
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.services.markdown_index import create_index_job, schedule_index_retry


class IndexQueueTest(unittest.TestCase):
    def test_pending_job_is_reused_for_rapid_saves(self) -> None:
        pending_job = SimpleNamespace(next_attempt_at="later")
        result = SimpleNamespace(scalar_one_or_none=lambda: pending_job)
        session = SimpleNamespace(execute=AsyncMock(return_value=result), flush=AsyncMock())
        note = SimpleNamespace(id="note-1", user_id="user-1", index_status="indexed")

        returned = asyncio.run(create_index_job(session, note))

        self.assertIs(returned, pending_job)
        self.assertIsNone(pending_job.next_attempt_at)
        self.assertEqual(note.index_status, "outdated")
        session.flush.assert_awaited_once()

    def test_failure_is_retried_then_exposes_terminal_reason(self) -> None:
        now = datetime(2026, 7, 15, 12, 0, 0)
        note = SimpleNamespace(index_status="indexing")
        job = SimpleNamespace(
            retry_count=0,
            max_retries=3,
            status="running",
            error_message=None,
            next_attempt_at=None,
            finished_at=None,
        )

        for retry_count in range(1, 4):
            schedule_index_retry(note, job, RuntimeError("embedding unavailable"), now)
            self.assertEqual(job.retry_count, retry_count)
            self.assertEqual(job.status, "pending")
            self.assertEqual(job.next_attempt_at, now + timedelta(seconds=2 ** retry_count))
            self.assertEqual(note.index_status, "outdated")

        schedule_index_retry(note, job, RuntimeError("embedding unavailable"), now)

        self.assertEqual(job.status, "failed")
        self.assertEqual(job.error_message, "embedding unavailable")
        self.assertEqual(job.finished_at, now)
        self.assertIsNone(job.next_attempt_at)
        self.assertEqual(note.index_status, "failed")


if __name__ == "__main__":
    unittest.main()
