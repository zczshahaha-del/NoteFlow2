from __future__ import annotations

import asyncio
import unittest
from unittest.mock import patch

from app.agent.langgraph_readonly import (
    ReadonlyGraphDependencies,
    _default_rag_search,
    invoke_readonly_graph,
    new_readonly_state,
    stream_readonly_graph,
)
from app.rag.service import RagResult
from app.agent.sse import DONE_FRAME, SSEStreamAdapter


class FakeReadonlyTools:
    def __init__(self, *, sources: list[dict] | None = None, answer_text: str = "answer"):
        self.rag_calls = 0
        self.memory_calls = 0
        self.answer_calls = 0
        self.memory_write_calls = 0
        self.sources = sources if sources is not None else [{"noteId": "note-1", "noteTitle": "Note"}]
        self.answer_text = answer_text
        self.events = []

    async def emit(self, event):
        self.events.append(event.to_wire())

    async def memory(self, _state):
        self.memory_calls += 1
        return "memory"

    async def rag(self, _state):
        self.rag_calls += 1
        return {"context_mode": "library", "context_text": "evidence", "sources": self.sources}

    async def answer(self, _state):
        self.answer_calls += 1
        yield {"choices": [{"delta": {"content": self.answer_text}, "finish_reason": None}]}

    async def memory_write(self, _state):
        self.memory_write_calls += 1
        return 1

    def dependencies(self):
        return ReadonlyGraphDependencies(
            emit=self.emit, memory_recall=self.memory,
            rag_search=self.rag, answer_stream=self.answer,
            memory_write=self.memory_write,
        )


class LangGraphReadonlyTest(unittest.TestCase):
    def test_library_search_does_not_leak_editor_content_or_fall_back(self) -> None:
        captured = []

        async def fake_retrieve(_service, request):
            captured.append(request)
            return RagResult(context_mode="rag_v2_library", context_text="evidence", sources=[])

        state = new_readonly_state(
            user_id="u",
            question="我的笔记里有没有讲 Redis",
            mode="ask_notes",
            page_state={
                "contextScope": "knowledge_base",
                "dirty": True,
                "selectedText": "当前选区",
                "unsavedContent": "当前编辑器全文",
            },
        )
        with patch("app.rag.v2.service.LlamaIndexRagService.retrieve", new=fake_retrieve):
            result = asyncio.run(_default_rag_search(state))

        self.assertEqual(result["context_mode"], "rag_v2_library")
        self.assertEqual(len(captured), 1)
        self.assertEqual(captured[0].selected_text, "")
        self.assertEqual(captured[0].unsaved_content, "")

    def test_chat_hard_policy_never_searches_library(self) -> None:
        tools = FakeReadonlyTools()
        result = asyncio.run(invoke_readonly_graph(
            new_readonly_state(user_id="u", question="我的笔记里有什么", mode="chat"),
            dependencies=tools.dependencies(),
        ))
        self.assertEqual(result["route"], "general_chat")
        self.assertFalse(result["requires_sources"])
        self.assertFalse(result["rag_called"])
        self.assertEqual(tools.rag_calls, 0)
        self.assertEqual(result["answer"], "answer")

    def test_ask_notes_always_calls_readonly_rag(self) -> None:
        tools = FakeReadonlyTools()
        result = asyncio.run(invoke_readonly_graph(
            new_readonly_state(user_id="u", question="缓存雪崩", mode="ask_notes"),
            dependencies=tools.dependencies(),
        ))
        self.assertEqual(result["route"], "note_qa")
        self.assertTrue(result["requires_sources"])
        self.assertTrue(result["rag_called"])
        self.assertEqual(tools.rag_calls, 1)
        self.assertEqual(result["sources"][0]["noteId"], "note-1")

    def test_no_source_result_is_controlled_and_skips_model(self) -> None:
        tools = FakeReadonlyTools(sources=[])
        result = asyncio.run(invoke_readonly_graph(
            new_readonly_state(user_id="u", question="不存在", mode="ask_notes"),
            dependencies=tools.dependencies(),
        ))
        self.assertEqual(result["status"], "success")
        self.assertIn("没有找到", result["answer"])
        self.assertEqual(tools.answer_calls, 0)

    def test_invalid_citation_number_is_removed_and_replacement_is_emitted(self) -> None:
        tools = FakeReadonlyTools(answer_text="有效来源 [1]，虚构来源 [9]。")
        result = asyncio.run(invoke_readonly_graph(
            new_readonly_state(user_id="u", question="q", mode="ask_notes"),
            dependencies=tools.dependencies(),
        ))

        self.assertEqual(result["answer"], "有效来源 [1]，虚构来源 。")
        replacements = [item for item in tools.events if item.get("type") == "answer_replace"]
        self.assertEqual(len(replacements), 1)
        self.assertEqual(replacements[0]["citationValidation"]["invalid"], [9])

    def test_invalid_mode_returns_stable_error_events(self) -> None:
        tools = FakeReadonlyTools()
        result = asyncio.run(invoke_readonly_graph(
            new_readonly_state(user_id="u", question="q", mode="write_note"),
            dependencies=tools.dependencies(),
        ))
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["error_code"], "mode_not_allowed")
        self.assertEqual([item.get("type") for item in tools.events][-2:], [None, "agent_done"])
        self.assertEqual(tools.rag_calls, 0)

    def test_stream_maps_to_existing_sse_and_one_done(self) -> None:
        async def exercise():
            tools = FakeReadonlyTools()
            # stream_readonly_graph uses default tools, so verify the adapter on
            # the deterministic graph events produced by the injected graph.
            await invoke_readonly_graph(
                new_readonly_state(user_id="u", question="q", mode="chat"),
                dependencies=tools.dependencies(),
            )
            adapter = SSEStreamAdapter()
            frames = [adapter.event(item) for item in tools.events]
            frames.append(adapter.done())
            return frames
        frames = asyncio.run(exercise())
        self.assertEqual(frames[-1], DONE_FRAME)
        self.assertEqual(sum(frame == DONE_FRAME for frame in frames), 1)
        self.assertIn('"type": "agent_session"', frames[0])

    def test_memory_writer_runs_after_primary_answer(self) -> None:
        tools = FakeReadonlyTools()
        result = asyncio.run(invoke_readonly_graph(
            new_readonly_state(
                user_id="u",
                question="我叫张成",
                mode="chat",
                memory_enabled=True,
            ),
            dependencies=tools.dependencies(),
        ))
        self.assertEqual(result["answer"], "answer")
        self.assertEqual(result["memory_write_count"], 1)
        self.assertEqual(tools.memory_write_calls, 1)

    def test_checkpoint_can_resume_after_planner_interrupt(self) -> None:
        try:
            from langgraph.checkpoint.memory import InMemorySaver
        except ImportError:
            from langgraph.checkpoint.memory import MemorySaver as InMemorySaver

        async def exercise():
            saver = InMemorySaver()
            tools = FakeReadonlyTools()
            state = new_readonly_state(
                user_id="u", question="q", mode="chat", thread_id="resume-thread",
            )
            interrupted = await invoke_readonly_graph(
                state, dependencies=tools.dependencies(), checkpointer=saver,
                thread_id="resume-thread", interrupt_after=["planner"],
            )
            resumed = await invoke_readonly_graph(
                None, dependencies=tools.dependencies(), checkpointer=saver,
                thread_id="resume-thread",
            )
            return interrupted, resumed
        interrupted, resumed = asyncio.run(exercise())
        self.assertEqual(interrupted["route"], "general_chat")
        self.assertEqual(resumed["status"], "success")


if __name__ == "__main__":
    unittest.main()
