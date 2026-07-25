from __future__ import annotations

import unittest
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch

from app.deps import CurrentUser
from app.routers import agent
from app.schemas.agent import AgentChatPayload
from app.services.turn_planner import (
    ChatMode,
    IntentParameters,
    PlanResult,
    PrimaryIntent,
    TurnPlan,
)


class AgentDraftCreateTest(unittest.IsolatedAsyncioTestCase):
    async def test_draft_card_metadata_is_persisted_after_checkpoint_creation(self) -> None:
        plan = TurnPlan(
            mode=ChatMode.CHAT,
            primary_intent=PrimaryIntent.NOTE_CREATE,
            intent_parameters=IntentParameters(
                topic="Python",
                requirements="生成一份 Python 学习笔记",
            ),
            confidence=0.99,
            result=PlanResult.EXECUTE,
            source="llm",
        )

        @asynccontextmanager
        async def fake_checkpointer():
            yield object()

        checkpoint = {
            "id": "checkpoint-python",
            "runId": "run-python",
            "sessionId": "session-python",
            "checkpointType": "draft_workspace",
            "status": "waiting_user_confirm",
            "payload": {"seed": "Python"},
        }
        create_checkpoint = AsyncMock(return_value=checkpoint)
        complete_run = AsyncMock(
            return_value={
                "type": "tool_trace",
                "toolName": "note_draft_tool",
                "action": "open_draft_workspace",
            }
        )

        with (
            patch.object(agent, "postgres_checkpointer", fake_checkpointer),
            patch.object(agent, "graph_waiting_for_clarification", AsyncMock(return_value=False)),
            patch.object(
                agent,
                "invoke_turn_graph",
                AsyncMock(return_value={"turn_plan": plan.model_dump(mode="json"), "status": "ready"}),
            ),
            patch.object(agent, "_update_agent_run_intent", AsyncMock(return_value=None)),
            patch.object(agent, "_checkpoint_for_plan", AsyncMock(return_value=None)),
            patch.object(agent, "_effective_memory_enabled", AsyncMock(return_value=False)),
            patch.object(
                agent,
                "_start_agent_run",
                AsyncMock(
                    return_value={
                        "session_id": "session-python",
                        "run_id": "run-python",
                        "route_step_id": "step-python",
                        "trace_id": "trace-python",
                    }
                ),
            ),
            patch.object(
                agent,
                "_record_tool_trace",
                AsyncMock(return_value={"type": "tool_trace", "toolName": "response_mode", "action": "chat"}),
            ),
            patch.object(agent, "_create_checkpoint", create_checkpoint),
            patch.object(agent, "_complete_tool_only_run", complete_run),
        ):
            response = await agent.chat(
                AgentChatPayload(question="帮我生成一份 Python 学习笔记", mode="chat", memoryEnabled=False),
                CurrentUser(id="user-python", email="test@example.com", display_name="Tester"),
            )
            chunks: list[str] = []
            async for chunk in response.body_iterator:
                chunks.append(chunk.decode() if isinstance(chunk, bytes) else chunk)

        self.assertIn('"action": "open_draft_workspace"', "".join(chunks))
        self.assertNotIn("agent_error", "".join(chunks))
        self.assertNotIn("message_metadata", create_checkpoint.await_args.kwargs)
        self.assertEqual(
            complete_run.await_args.kwargs["message_metadata"],
            {"draftCard": {"seed": "Python", "checkpointId": "checkpoint-python"}},
        )


if __name__ == "__main__":
    unittest.main()
