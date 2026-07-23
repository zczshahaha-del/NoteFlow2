from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, Mock, patch

from app.agent.rollout import RuntimeDecision
from app.deps import CurrentUser
from app.routers import agent
from app.schemas.agent import AgentChatPayload
from app.services.context_planner import ContextPlan


class AgentDraftCreateTest(unittest.IsolatedAsyncioTestCase):
    async def test_draft_card_metadata_is_persisted_after_checkpoint_creation(self) -> None:
        plan = ContextPlan(
            primary_intent="note_draft_create",
            confidence=0.99,
            reply_surface="draft_workspace",
            context_plan={"topic": "Python"},
            draft_request={
                "topic": "Python",
                "brief": "生成一份 Python 学习笔记",
                "note_type": "智能笔记",
                "source_mode": "model_knowledge",
            },
            source="test",
        )
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
            patch.object(agent, "plan_context_smart", AsyncMock(return_value=plan)),
            patch.object(agent, "_latest_working_checkpoint", AsyncMock(return_value=None)),
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
            patch.object(agent, "schedule_langgraph_shadow", Mock()),
            patch.object(
                agent,
                "select_agent_runtime",
                Mock(return_value=RuntimeDecision("legacy", "test", 0)),
            ),
            patch.object(agent, "select_child_runtime", Mock(return_value="langgraph")),
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
