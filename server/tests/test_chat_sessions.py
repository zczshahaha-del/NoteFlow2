from datetime import datetime
import unittest

from app.main import app
from app.models.db import ChatMessage, ChatSession
from app.routers.chat_sessions import _message_out, _session_out


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


if __name__ == "__main__":
    unittest.main()
