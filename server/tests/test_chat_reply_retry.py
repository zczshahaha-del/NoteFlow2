from __future__ import annotations

import unittest
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, Mock, patch

from app.deps import CurrentUser
from app.routers import agent
from app.schemas.agent import AgentChatPayload
from app.services.turn_planner import PrimaryIntent, PlanResult, TurnPlan
from app.models.db import ChatMessage
from app.routers.chat_sessions import _visible_reply_attempts
from app.services import agent_runtime
from app.models.db import AgentRun, ChatSession


class ChatReplyRetryTest(unittest.IsolatedAsyncioTestCase):
    async def test_runtime_persists_retry_link_and_failure_separately(self):
        class Database:
            def __init__(self):
                self.added = []
                self.session = ChatSession(id="s", user_id="u", title="合成对话")
                self.run = None

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

            async def execute(self, statement):
                from types import SimpleNamespace
                return SimpleNamespace(scalar_one_or_none=lambda: self.session)

            async def get(self, model, key):
                return self.run

            def add_all(self, items):
                self.added.extend(items)
                self.run = next(item for item in items if isinstance(item, AgentRun))

            def add(self, item):
                self.added.append(item)

            async def commit(self):
                pass

        database = Database()
        with patch.object(agent_runtime, "AsyncSessionLocal", lambda: database):
            state = await agent_runtime.start_agent_run(AgentChatPayload(sessionId="s", question="原问题", retryAnswerOnly=True, retryOfRunId="old-run"), "u", "planning")
            self.assertEqual(database.run.metadata_json["retryOfRunId"], "old-run")
            await agent_runtime.finish_agent_run(user_id="u", session_id="s", run_id=state["run_id"], status="failed", answer="部分回答", error_message="连接中断")
        assistant = database.added[-1]
        self.assertEqual(assistant.text, "部分回答")
        self.assertEqual(assistant.metadata_json, {"retryOfRunId": "old-run", "replyState": "failed", "replyError": "连接中断"})

    def test_reopening_history_folds_retry_chain_and_keeps_failed_partial_reply(self):
        def message(run, role, text, parent=None, failed=False):
            return ChatMessage(id=run+role, user_id="u", session_id="s", run_id=run,
                role=role, text=text, sources=[], metadata_json={"retryOfRunId": parent,
                    "replyState": "failed" if failed else "completed", "replyError": "暂时不可用" if failed else None})
        original = [message("r1", "user", "原问题"), message("r1", "assistant", "部分回答", failed=True)]
        failed_retry = [message("r2", "user", "原问题", "r1"), message("r2", "assistant", "", "r1", failed=True)]
        visible = _visible_reply_attempts(original+failed_retry, {})
        self.assertEqual(len(visible), 2)
        self.assertEqual(visible[1]["text"], "部分回答")
        self.assertEqual(visible[1]["streamState"], "failed")
        success = [message("r3", "user", "原问题", "r2"), message("r3", "assistant", "完整新回答", "r2")]
        visible = _visible_reply_attempts(original+failed_retry+success, {})
        self.assertEqual([m["text"] for m in visible], ["原问题", "完整新回答"])
        self.assertEqual(visible[1]["agentRunId"], "r3")
        different = [message("r4", "user", "不同问题", "r3"), message("r4", "assistant", "独立回答", "r3")]
        self.assertEqual(len(_visible_reply_attempts(original+failed_retry+success+different, {})), 4)
        self.assertEqual(len(_visible_reply_attempts(failed_retry, {})), 2, "Missing parent on a history page must not hide data")

    async def test_retry_cannot_dispatch_note_or_memory_operations(self):
        @asynccontextmanager
        async def checkpointer():
            yield object()

        for intent in (PrimaryIntent.NOTE_CREATE, PrimaryIntent.NOTE_EDIT, PrimaryIntent.MEMORY):
            with self.subTest(intent=intent):
                plan = TurnPlan(primary_intent=intent, confidence=1, result=PlanResult.EXECUTE)
                finish = AsyncMock()
                checkpoint = AsyncMock()
                readonly = Mock()
                with (
                    patch.object(agent, "postgres_checkpointer", checkpointer),
                    patch.object(agent, "graph_waiting_for_clarification", AsyncMock(return_value=False)),
                    patch.object(agent, "invoke_turn_graph", AsyncMock(return_value={"turn_plan": plan.model_dump(mode="json"), "status": "ready"})),
                    patch.object(agent, "_start_agent_run", AsyncMock(return_value={"session_id": "s", "run_id": "r", "route_step_id": "step"})),
                    patch.object(agent, "_update_agent_run_intent", AsyncMock()),
                    patch.object(agent, "_checkpoint_for_plan", checkpoint),
                    patch.object(agent, "_langgraph_response", readonly),
                    patch.object(agent, "_finish_agent_run", finish),
                ):
                    response = await agent.chat(AgentChatPayload(question="原问题", retryAnswerOnly=True), CurrentUser(id="u", email="test@example.com", display_name="Tester"))
                    chunks = [chunk async for chunk in response.body_iterator]
                wire = "".join(chunk.decode() if isinstance(chunk, bytes) else chunk for chunk in chunks)
                self.assertIn('"type": "agent_error"', wire)
                self.assertIn('"status": "failed"', wire)
                self.assertNotIn('"type": "tool_action"', wire)
                checkpoint.assert_not_awaited()
                readonly.assert_not_called()
                self.assertEqual(finish.await_args.kwargs["status"], "failed")

    async def test_planning_failure_is_not_reported_as_success(self):
        finish = AsyncMock()
        response = agent._terminal_turn_response(user_id="u", run_state={"session_id": "s", "run_id": "r"}, intent="unknown", answer="暂时不可用", status="failed")
        with patch.object(agent, "_finish_agent_run", finish):
            wire = "".join([chunk async for chunk in response.body_iterator])
        self.assertIn('"type": "agent_error"', wire)
        self.assertNotIn('"choices"', wire, "Error text is not reply content")
        self.assertEqual(finish.await_args.kwargs["answer"], "")


if __name__ == "__main__":
    unittest.main()
