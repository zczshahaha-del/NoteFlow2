from __future__ import annotations

import asyncio
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any, AsyncIterator, Awaitable, Callable, Optional, TypedDict
from urllib.parse import quote

from app.agent.contracts import RuntimeEvent
from app.config import cfg
from app.providers.contracts import ChatProviderRequest, ProviderChatMessage


class ReadonlyAgentState(TypedDict, total=False):
    user_id: str
    session_id: str
    run_id: str
    trace_id: str
    thread_id: str
    question: str
    mode: str
    history: list[dict[str, str]]
    page_state: dict[str, Any]
    memory_enabled: bool
    plan_only: bool
    status: str
    intent: str
    route: str
    requires_sources: bool
    memory_context: str
    context_mode: str
    context_text: str
    sources: list[dict[str, Any]]
    rag_called: bool
    answer: str
    error_code: str
    error_message: str


EmitEvent = Callable[[RuntimeEvent], Awaitable[None]]
MemoryRecall = Callable[[ReadonlyAgentState], Awaitable[str]]
RagSearch = Callable[[ReadonlyAgentState], Awaitable[dict[str, Any]]]
AnswerStream = Callable[[ReadonlyAgentState], AsyncIterator[dict[str, Any]]]


async def _ignore_event(_event: RuntimeEvent) -> None:
    return None


async def _default_memory_recall(state: ReadonlyAgentState) -> str:
    from app.memory.service import LegacyMemoryService
    return await LegacyMemoryService().context(
        user_id=state["user_id"], requested=bool(state.get("memory_enabled", True)),
        query=state["question"], scopes=["global"], memory_types=[],
    )


async def _default_rag_search(state: ReadonlyAgentState) -> dict[str, Any]:
    from app.rag.service import RagRequest, configured_rag_service
    page_state = state.get("page_state") or {}
    library_scope = state.get("mode") == "ask_notes" or page_state.get("contextScope") == "knowledge_base"
    result = await configured_rag_service().retrieve(RagRequest(
        user_id=state["user_id"], question=state["question"],
        note_id=None, fallback_query=state["question"],
        selected_text="" if library_scope else str(page_state.get("selectedText") or ""),
        current_section_id=page_state.get("currentSectionId"),
        unsaved_content=(
            ""
            if library_scope or not page_state.get("dirty")
            else str(page_state.get("unsavedContent") or "")
        ),
    ))
    return {"context_mode": result.context_mode, "context_text": result.context_text, "sources": result.sources}


async def _default_answer_stream(state: ReadonlyAgentState) -> AsyncIterator[dict[str, Any]]:
    from app.providers.legacy import LegacyChatModelProvider
    provider = LegacyChatModelProvider()
    history = [
        ProviderChatMessage(role=str(item.get("role") or "user"), text=str(item.get("text") or ""))
        for item in state.get("history", [])[-8:]
    ]
    request = ChatProviderRequest(
        question=state["question"],
        document_title="用户笔记库" if state.get("requires_sources") else "",
        document_content=state.get("context_text", ""),
        memory_context=state.get("memory_context", ""),
        history=history,
        strict_note_answer=bool(state.get("requires_sources")),
    )
    async for chunk in provider.stream(request):
        yield chunk


@dataclass
class ReadonlyGraphDependencies:
    emit: EmitEvent = _ignore_event
    memory_recall: MemoryRecall = _default_memory_recall
    rag_search: RagSearch = _default_rag_search
    answer_stream: AnswerStream = _default_answer_stream


def new_readonly_state(
    *, user_id: str, question: str, mode: str, history: list[dict[str, str]] | None = None,
    page_state: dict[str, Any] | None = None, memory_enabled: bool = True,
    session_id: str | None = None, run_id: str | None = None,
    trace_id: str = "", thread_id: str | None = None, plan_only: bool = False,
) -> ReadonlyAgentState:
    resolved_session = session_id or uuid.uuid4().hex
    resolved_run = run_id or uuid.uuid4().hex
    return ReadonlyAgentState(
        user_id=user_id, session_id=resolved_session, run_id=resolved_run,
        trace_id=trace_id, thread_id=thread_id or resolved_session,
        question=(question or "").strip(), mode=mode,
        history=history or [], page_state=page_state or {},
        memory_enabled=memory_enabled, plan_only=plan_only,
        status="running", sources=[], rag_called=False, answer="",
        error_code="", error_message="",
    )


def _choice_delta(text: str) -> RuntimeEvent:
    return RuntimeEvent(type="choices", payload={"choices": [{"delta": {"content": text}, "finish_reason": "stop"}]})


def _chunk_text(chunk: dict[str, Any]) -> str:
    choices = chunk.get("choices") or []
    if not choices or not isinstance(choices[0], dict):
        return ""
    delta = choices[0].get("delta") or {}
    return str(delta.get("content") or "") if isinstance(delta, dict) else ""


def _route_after(state: ReadonlyAgentState) -> str:
    if state.get("error_code"):
        return "error"
    return "note_qa" if state.get("route") == "note_qa" else "general_chat"


def _error_or_next(next_node: str):
    def route(state: ReadonlyAgentState) -> str:
        return "error" if state.get("error_code") else next_node
    return route


def build_readonly_graph(
    dependencies: ReadonlyGraphDependencies | None = None,
    *, checkpointer=None, interrupt_after: list[str] | None = None,
):
    try:
        from langgraph.graph import END, START, StateGraph
    except ImportError as exc:
        raise RuntimeError("LangGraph runtime is not installed; use the locked AI runtime image") from exc

    deps = dependencies or ReadonlyGraphDependencies()

    async def ingress(state: ReadonlyAgentState) -> dict[str, Any]:
        if not state.get("question"):
            return {"error_code": "invalid_input", "error_message": "问题不能为空", "status": "failed"}
        await deps.emit(RuntimeEvent(
            type="agent_session", status="running",
            sessionId=state.get("session_id"), runId=state.get("run_id"), traceId=state.get("trace_id"),
            payload={"runtime": "langgraph_readonly"},
        ))
        return {"status": "running"}

    async def policy(state: ReadonlyAgentState) -> dict[str, Any]:
        mode = state.get("mode")
        if mode not in {"chat", "ask_notes"}:
            return {"error_code": "mode_not_allowed", "error_message": "只读图仅支持 chat 和 ask_notes", "status": "failed"}
        return {"mode": mode}

    async def planner(state: ReadonlyAgentState) -> dict[str, Any]:
        ask_notes = state["mode"] == "ask_notes"
        intent = "note_qa" if ask_notes else "general_chat"
        route = intent
        await deps.emit(RuntimeEvent(
            type="tool_trace", status="success", sessionId=state.get("session_id"), runId=state.get("run_id"),
            payload={
                "toolName": "langgraph_planner", "action": route, "durationMs": 0,
                "metadata": {"mode": state["mode"], "hardPolicy": True, "readOnly": True},
            },
        ))
        return {"intent": intent, "route": route, "requires_sources": ask_notes}

    async def memory_recall(state: ReadonlyAgentState) -> dict[str, Any]:
        if state.get("plan_only") or not state.get("memory_enabled") or state.get("route") == "note_qa":
            return {"memory_context": ""}
        try:
            return {"memory_context": await deps.memory_recall(state)}
        except Exception as exc:
            return {"error_code": "memory_read_failed", "error_message": str(exc), "status": "failed"}

    async def general_chat(state: ReadonlyAgentState) -> dict[str, Any]:
        return {"context_mode": "general", "context_text": "", "sources": [], "rag_called": False}

    async def note_qa(state: ReadonlyAgentState) -> dict[str, Any]:
        if state.get("plan_only"):
            return {"context_mode": "shadow_plan", "context_text": "", "sources": [], "rag_called": False}
        try:
            result = await deps.rag_search(state)
            sources = list(result.get("sources") or [])
            await deps.emit(RuntimeEvent(
                type="context", status="success", sessionId=state.get("session_id"), runId=state.get("run_id"),
                contextMode=str(result.get("context_mode") or "library"),
                payload={"sources": sources, "ragCalled": True, "readOnly": True},
            ))
            return {
                "context_mode": str(result.get("context_mode") or "library"),
                "context_text": str(result.get("context_text") or ""),
                "sources": sources, "rag_called": True,
            }
        except Exception as exc:
            return {"error_code": "rag_read_failed", "error_message": str(exc), "status": "failed", "rag_called": True}

    async def answer(state: ReadonlyAgentState) -> dict[str, Any]:
        if state.get("plan_only"):
            return {"answer": ""}
        if state.get("requires_sources") and not state.get("sources"):
            text = "我在你的笔记里没有找到相关内容。"
            await deps.emit(_choice_delta(text))
            return {"answer": text}
        parts: list[str] = []
        try:
            async for chunk in deps.answer_stream(state):
                if chunk.get("type") in {"stream_error", "agent_error"}:
                    return {
                        "error_code": str(chunk.get("code") or "ai_stream_failed"),
                        "error_message": str(chunk.get("message") or "AI 流式回答失败"),
                        "status": "failed",
                    }
                parts.append(_chunk_text(chunk))
                await deps.emit(RuntimeEvent.from_wire(chunk))
            return {"answer": "".join(parts)}
        except Exception as exc:
            return {"error_code": "ai_stream_failed", "error_message": str(exc), "status": "failed"}

    async def finalize(state: ReadonlyAgentState) -> dict[str, Any]:
        await deps.emit(RuntimeEvent(
            type="agent_done", status="completed", sessionId=state.get("session_id"), runId=state.get("run_id"),
            payload={"runtime": "langgraph_readonly", "readOnly": True},
        ))
        return {"status": "success"}

    async def error(state: ReadonlyAgentState) -> dict[str, Any]:
        public_message = "只读 Agent 暂时无法完成请求。"
        await deps.emit(RuntimeEvent(
            type="agent_error", status="failed", code=state.get("error_code") or "agent_failed",
            message=public_message, sessionId=state.get("session_id"), runId=state.get("run_id"),
        ))
        await deps.emit(_choice_delta(public_message))
        await deps.emit(RuntimeEvent(
            type="agent_done", status="failed", sessionId=state.get("session_id"), runId=state.get("run_id"),
            payload={"runtime": "langgraph_readonly", "readOnly": True},
        ))
        return {"status": "failed", "answer": public_message}

    builder = StateGraph(ReadonlyAgentState)
    for name, node in (
        ("ingress", ingress), ("policy", policy), ("planner", planner),
        ("memory_recall", memory_recall), ("general_chat", general_chat),
        ("note_qa", note_qa), ("answer_node", answer), ("finalize", finalize), ("error_node", error),
    ):
        builder.add_node(name, node)
    builder.add_edge(START, "ingress")
    builder.add_conditional_edges("ingress", _error_or_next("policy"), {"policy": "policy", "error": "error_node"})
    builder.add_conditional_edges("policy", _error_or_next("planner"), {"planner": "planner", "error": "error_node"})
    builder.add_edge("planner", "memory_recall")
    builder.add_conditional_edges(
        "memory_recall", _route_after,
        {"general_chat": "general_chat", "note_qa": "note_qa", "error": "error_node"},
    )
    builder.add_edge("general_chat", "answer_node")
    builder.add_conditional_edges("note_qa", _error_or_next("answer_node"), {"answer_node": "answer_node", "error": "error_node"})
    builder.add_conditional_edges("answer_node", _error_or_next("finalize"), {"finalize": "finalize", "error": "error_node"})
    builder.add_edge("finalize", END)
    builder.add_edge("error_node", END)
    kwargs = {"checkpointer": checkpointer}
    if interrupt_after:
        kwargs["interrupt_after"] = interrupt_after
    return builder.compile(**kwargs)


async def invoke_readonly_graph(
    state: ReadonlyAgentState | None, *, dependencies: ReadonlyGraphDependencies | None = None,
    checkpointer=None, thread_id: str | None = None, interrupt_after: list[str] | None = None,
) -> ReadonlyAgentState:
    graph = build_readonly_graph(dependencies, checkpointer=checkpointer, interrupt_after=interrupt_after)
    resolved_thread = thread_id or (state or {}).get("thread_id") or uuid.uuid4().hex
    config = {"configurable": {"thread_id": resolved_thread, "checkpoint_ns": ""}}
    return await graph.ainvoke(state, config=config)


async def stream_readonly_graph(
    state: ReadonlyAgentState, *, checkpointer=None,
    dependencies: ReadonlyGraphDependencies | None = None,
) -> AsyncIterator[RuntimeEvent]:
    queue: asyncio.Queue[RuntimeEvent | object] = asyncio.Queue()
    done = object()

    async def emit(event: RuntimeEvent) -> None:
        await queue.put(event)

    async def execute() -> None:
        try:
            base = dependencies or ReadonlyGraphDependencies()
            runtime_dependencies = ReadonlyGraphDependencies(
                emit=emit, memory_recall=base.memory_recall,
                rag_search=base.rag_search, answer_stream=base.answer_stream,
            )
            await invoke_readonly_graph(
                state, dependencies=runtime_dependencies,
                checkpointer=checkpointer, thread_id=state.get("thread_id"),
            )
        except Exception:
            await emit(RuntimeEvent(
                type="agent_error", status="failed", code="langgraph_runtime_failed",
                message="只读 Agent 暂时无法完成请求。", sessionId=state.get("session_id"), runId=state.get("run_id"),
            ))
            await emit(RuntimeEvent(type="agent_done", status="failed", sessionId=state.get("session_id"), runId=state.get("run_id")))
        finally:
            await queue.put(done)

    task = asyncio.create_task(execute(), name=f"langgraph-readonly-{state.get('run_id', 'run')}")
    try:
        while True:
            item = await queue.get()
            if item is done:
                break
            yield item  # type: ignore[misc]
    finally:
        await task


def postgres_checkpoint_uri() -> str:
    return (
        f"postgresql://{quote(cfg.DB_USER)}:{quote(cfg.DB_PASSWORD)}"
        f"@{cfg.DB_HOST}:{cfg.DB_PORT}/{quote(cfg.DB_NAME)}"
    )


@asynccontextmanager
async def postgres_checkpointer():
    try:
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    except ImportError as exc:
        raise RuntimeError("langgraph-checkpoint-postgres is not installed") from exc
    async with AsyncPostgresSaver.from_conn_string(postgres_checkpoint_uri()) as saver:
        yield saver
