from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.models.db import ChatMessage, ChatSession
from app.routers.chat_sessions import _message_out, _session_out
from app.routers import chat_sessions


class ChatSessionApiTests(unittest.TestCase):
    def test_chat_session_routes_are_registered(self):
        methods_by_path: dict[str, set[str]] = {}
        for route in app.routes:
            if route.path.startswith("/api/chat-sessions"):
                methods_by_path.setdefault(route.path, set()).update(route.methods or set())
        self.assertIn("GET", methods_by_path["/api/chat-sessions"])
        self.assertIn("POST", methods_by_path["/api/chat-sessions"])
        self.assertIn("GET", methods_by_path["/api/chat-sessions/{session_id}/messages"])
        self.assertIn("PATCH", methods_by_path["/api/chat-sessions/{session_id}"])
        self.assertIn("DELETE", methods_by_path["/api/chat-sessions/{session_id}"])

    def test_session_and_message_output_preserve_history_metadata(self):
        now = datetime.utcnow()
        session = ChatSession(
            id="session-1",
            user_id="user-1",
            title="Go 学习笔记",
            status="active",
            created_at=now,
            updated_at=now,
            last_message_at=now,
        )
        message = ChatMessage(
            id="message-1",
            session_id=session.id,
            user_id="user-1",
            run_id="run-1",
            role="user",
            text="继续补充并发部分",
            context_mode="chat",
            sources=[],
            metadata_json={
                "chatMode": "chat",
                "attachedSelection": {
                    "text": "goroutine",
                    "noteId": "note-1",
                    "noteTitle": "Go",
                },
            },
            created_at=now,
        )

        session_payload = _session_out(session)
        message_payload = _message_out(message)

        self.assertEqual(session_payload["title"], "Go 学习笔记")
        self.assertEqual(message_payload["agentSessionId"], session.id)
        self.assertEqual(message_payload["agentRunId"], "run-1")
        self.assertEqual(message_payload["attachedSelection"]["text"], "goroutine")
        self.assertEqual(message_payload["chatMode"], "chat")

    def test_historical_draft_card_is_restored_on_its_original_run_message(self):
        now = datetime.utcnow()
        message = ChatMessage(
            id="message-draft",
            session_id="session-1",
            user_id="user-1",
            run_id="run-draft",
            role="assistant",
            text="大纲已经准备好了。",
            context_mode="chat",
            sources=[],
            metadata_json={},
            created_at=now,
        )

        payload = _message_out(
            message,
            {
                "run-draft": {
                    "seed": "Go 语言学习笔记",
                    "checkpointId": "checkpoint-1",
                    "draftId": "draft-1",
                    "status": "waiting_user_confirm",
                }
            },
        )

        self.assertEqual(payload["draftCard"]["seed"], "Go 语言学习笔记")
        self.assertEqual(payload["draftCard"]["checkpointId"], "checkpoint-1")
        self.assertEqual(payload["agentRunId"], "run-draft")

    def test_legacy_naive_utc_timestamps_have_explicit_api_offsets(self):
        utc_time = datetime(2026, 10, 10, 18, 47, 12, 123456)
        session = ChatSession(created_at=utc_time, updated_at=utc_time, last_message_at=utc_time)
        message = ChatMessage(created_at=utc_time)
        for field in ("createdAt", "updatedAt", "lastMessageAt"):
            self.assertEqual(_session_out(session)[field], "2026-10-10T18:47:12.123456+00:00")
        self.assertEqual(_message_out(message)["createdAt"], "2026-10-10T18:47:12.123456+00:00")
        self.assertIsNone(utc_time.tzinfo, "serialization must not rewrite database timestamps")

    def test_aware_and_missing_chat_timestamps_preserve_the_instant(self):
        china_time = datetime(2026, 10, 11, 2, 47, tzinfo=timezone(timedelta(hours=8)))
        message = ChatMessage(created_at=china_time)
        self.assertEqual(_message_out(message)["createdAt"], "2026-10-10T18:47:00+00:00")
        self.assertEqual(_message_out(ChatMessage())["createdAt"], None)
        self.assertIsNone(_session_out(ChatSession())["lastMessageAt"])

    def test_chat_pagination_cursor_uses_the_existing_naive_utc_database_contract(self):
        from app.routers.chat_sessions import _utc_naive

        china_time = datetime(2026, 10, 11, 2, 47, tzinfo=timezone(timedelta(hours=8)))
        utc_time = datetime(2026, 10, 10, 18, 47)
        self.assertEqual(_utc_naive(china_time), utc_time)
        self.assertEqual(_utc_naive(utc_time.replace(tzinfo=timezone.utc)), utc_time)
        self.assertEqual(_utc_naive(utc_time), utc_time)
        self.assertIsNone(_utc_naive(china_time).tzinfo)


class ChatTimeApiContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_history_endpoint_labels_utc_and_normalizes_offset_pagination_without_database_access(self):
        test_app = FastAPI()
        test_app.include_router(chat_sessions.router, prefix="/api")
        test_app.dependency_overrides[chat_sessions.get_current_user] = lambda: SimpleNamespace(id="time-test-user")
        message = ChatMessage(
            id="time-test-message", session_id="time-test-session", user_id="time-test-user",
            role="assistant", text="合成消息", metadata_json={}, sources=[],
            created_at=datetime(2026, 10, 10, 18, 47),
        )
        statements = []

        class MemoryDatabase:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

            async def execute(self, statement):
                statements.append(statement)
                return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [message]))

        with patch.object(chat_sessions, "AsyncSessionLocal", MemoryDatabase), patch.object(chat_sessions, "_owned_session", AsyncMock()):
            async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://time-test.invalid") as client:
                for before in ("2026-10-11T02:48:00+08:00", "2026-10-10T18:48:00Z", "2026-10-10T18:48:00"):
                    response = await client.get("/api/chat-sessions/time-test-session/messages", params={"before": before})
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.json()["messages"][0]["createdAt"], "2026-10-10T18:47:00+00:00")
                    cursor = statements[-1].compile().params["created_at_1"]
                    self.assertEqual(cursor, datetime(2026, 10, 10, 18, 48))
                    self.assertIsNone(cursor.tzinfo)


if __name__ == "__main__":
    unittest.main()
