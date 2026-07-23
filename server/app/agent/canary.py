from __future__ import annotations

import time
from collections.abc import AsyncIterator

from app.agent.contracts import RuntimeEvent
from app.agent.langgraph_readonly import (
    ReadonlyGraphDependencies,
    ReadonlyAgentState,
    postgres_checkpointer,
    stream_readonly_graph,
)
from app.agent.rollout import runtime_circuit
from app.rag.service import RagRequest
from app.rag.v2.service import LlamaIndexRagService
from app.services.observability import record_metric


async def _rag_v2_search(state: ReadonlyAgentState) -> dict:
    page_state = state.get("page_state") or {}
    library_scope = state.get("mode") == "ask_notes" or page_state.get("contextScope") == "knowledge_base"
    started = time.perf_counter()
    result = await LlamaIndexRagService().retrieve(RagRequest(
        user_id=state["user_id"],
        question=state["question"],
        note_id=None,
        fallback_query=state["question"],
        selected_text="" if library_scope else str(page_state.get("selectedText") or ""),
        current_section_id=page_state.get("currentSectionId"),
        unsaved_content=(
            ""
            if library_scope or not page_state.get("dirty")
            else str(page_state.get("unsavedContent") or "")
        ),
    ))
    record_metric("agent_canary", "retrieval", duration_ms=(time.perf_counter() - started) * 1000)
    return {
        "context_mode": result.context_mode,
        "context_text": result.context_text,
        "sources": result.sources,
    }


def canary_dependencies() -> ReadonlyGraphDependencies:
    defaults = ReadonlyGraphDependencies()
    return ReadonlyGraphDependencies(
        memory_recall=defaults.memory_recall,
        rag_search=_rag_v2_search,
        answer_stream=defaults.answer_stream,
    )


async def stream_canary(state: ReadonlyAgentState) -> AsyncIterator[RuntimeEvent]:
    """Run the read-only graph with RAG v2 and update the next-request circuit."""
    started = time.perf_counter()
    failed = False
    failure_code = ""
    first_payload_at: float | None = None
    try:
        async with postgres_checkpointer() as saver:
            async for event in stream_readonly_graph(
                state,
                checkpointer=saver,
                dependencies=canary_dependencies(),
            ):
                if event.type == "agent_error":
                    failed = True
                    failure_code = event.code or "agent_failed"
                if first_payload_at is None and event.type in {"choices", "context"}:
                    first_payload_at = time.perf_counter()
                    record_metric(
                        "agent_canary", "first_payload",
                        duration_ms=(first_payload_at - started) * 1000,
                    )
                yield event
    except Exception:
        failed = True
        failure_code = "checkpoint_or_runtime_failed"
        raise
    finally:
        duration_ms = (time.perf_counter() - started) * 1000
        record_metric(
            "agent_canary", "latency",
            status=failure_code if failed else "success",
            duration_ms=duration_ms,
        )
        if failed:
            runtime_circuit.failure(failure_code)
        else:
            runtime_circuit.success()
