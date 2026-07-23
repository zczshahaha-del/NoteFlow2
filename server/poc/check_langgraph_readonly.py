from __future__ import annotations

import argparse
import asyncio
import os

from app.agent.langgraph_readonly import (
    ReadonlyGraphDependencies,
    invoke_readonly_graph,
    new_readonly_state,
    stream_readonly_graph,
)


class DeterministicTools:
    def __init__(self):
        self.rag_calls = 0

    async def memory(self, _state):
        return ""

    async def rag(self, _state):
        self.rag_calls += 1
        return {
            "context_mode": "library", "context_text": "SSE evidence",
            "sources": [{"noteId": "note-poc", "noteTitle": "SSE"}],
        }

    async def answer(self, _state):
        for token in ("STREAM_", "OK"):
            yield {"choices": [{"delta": {"content": token}, "finish_reason": None}]}

    def deps(self):
        return ReadonlyGraphDependencies(
            memory_recall=self.memory, rag_search=self.rag, answer_stream=self.answer,
        )


async def check_routes_and_stream() -> None:
    chat_tools = DeterministicTools()
    chat = await invoke_readonly_graph(
        new_readonly_state(user_id="poc", question="解释 SSE", mode="chat"),
        dependencies=chat_tools.deps(),
    )
    if chat["route"] != "general_chat" or chat["rag_called"] or chat_tools.rag_calls:
        raise AssertionError("chat mode violated the no-library-search policy")

    note_tools = DeterministicTools()
    note = await invoke_readonly_graph(
        new_readonly_state(user_id="poc", question="我的笔记里有 SSE 吗", mode="ask_notes"),
        dependencies=note_tools.deps(),
    )
    if note["route"] != "note_qa" or not note["rag_called"] or note_tools.rag_calls != 1:
        raise AssertionError("ask_notes did not execute the read-only RAG route")

    events = []
    async for event in stream_readonly_graph(
        new_readonly_state(user_id="poc", question="stream", mode="chat"),
        dependencies=DeterministicTools().deps(),
    ):
        events.append(event.to_wire())
    text = "".join(
        str((((item.get("choices") or [{}])[0].get("delta") or {}).get("content") or ""))
        for item in events
    )
    if text != "STREAM_OK" or events[-1].get("type") != "agent_done":
        raise AssertionError("LangGraph RuntimeEvent streaming contract failed")


async def check_postgres_restart(database_url: str) -> None:
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

    os.environ.setdefault("LANGGRAPH_STRICT_MSGPACK", "true")
    thread_id = "noteflow-readonly-step8-restart"
    tools = DeterministicTools()
    initial = new_readonly_state(
        user_id="poc", question="checkpoint", mode="chat",
        thread_id=thread_id, plan_only=True,
    )
    async with AsyncPostgresSaver.from_conn_string(database_url) as saver:
        interrupted = await invoke_readonly_graph(
            initial, dependencies=tools.deps(), checkpointer=saver,
            thread_id=thread_id, interrupt_after=["planner"],
        )
        if interrupted.get("route") != "general_chat":
            raise AssertionError("checkpoint was not written after planner")

    async with AsyncPostgresSaver.from_conn_string(database_url) as restarted:
        resumed = await invoke_readonly_graph(
            None, dependencies=tools.deps(), checkpointer=restarted,
            thread_id=thread_id,
        )
        if resumed.get("status") != "success":
            raise AssertionError("read-only graph did not resume after process restart")


async def run(database_url: str) -> None:
    await check_routes_and_stream()
    if database_url:
        await check_postgres_restart(database_url)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--postgres-url", default="")
    args = parser.parse_args()
    asyncio.run(run(args.postgres_url))
    print("LangGraph read-only graph PoC passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
