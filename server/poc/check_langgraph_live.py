from __future__ import annotations

import asyncio
import json

import httpx

from app.agent.langgraph_readonly import ReadonlyGraphDependencies, new_readonly_state, stream_readonly_graph
from app.config import cfg


async def no_memory(_state):
    return ""


async def no_rag(_state):
    raise AssertionError("chat mode must not call RAG")


async def deepseek_stream(state):
    if not cfg.DEEPSEEK_API_KEY:
        raise RuntimeError("DEEPSEEK_API_KEY is not configured")
    request = {
        "model": cfg.DEEPSEEK_MODEL,
        "messages": [{"role": "user", "content": state["question"]}],
        "temperature": 0.0,
        "max_tokens": 64,
        "stream": True,
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
        async with client.stream(
            "POST", f"{cfg.DEEPSEEK_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {cfg.DEEPSEEK_API_KEY}"}, json=request,
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    break
                if payload:
                    yield json.loads(payload)


async def main_async() -> None:
    dependencies = ReadonlyGraphDependencies(
        memory_recall=no_memory, rag_search=no_rag, answer_stream=deepseek_stream,
    )
    events = []
    async for event in stream_readonly_graph(
        new_readonly_state(
            user_id="live-poc", question="只回复 LANGGRAPH_STREAM_OK", mode="chat",
            memory_enabled=False,
        ),
        dependencies=dependencies,
    ):
        events.append(event.to_wire())
    content = "".join(
        str((((item.get("choices") or [{}])[0].get("delta") or {}).get("content") or ""))
        for item in events
    )
    if not content.strip() or events[-1].get("type") != "agent_done" or events[-1].get("status") != "completed":
        raise AssertionError("live LangGraph stream did not finish successfully")
    print(json.dumps({
        "model": cfg.DEEPSEEK_MODEL, "streaming": True,
        "eventCount": len(events), "completed": True,
    }, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main_async())
