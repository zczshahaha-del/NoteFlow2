from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, TypedDict


class DraftGraphState(TypedDict, total=False):
    user_id: str
    thread_id: str
    topic: str
    requirements: dict[str, Any]
    requirements_complete: bool
    context: dict[str, Any]
    outline: str
    draft_id: str
    assembled_content: str
    saved_note_id: str
    action: str
    status: str
    error: str


DraftCallback = Callable[[DraftGraphState], Awaitable[dict[str, Any]]]


async def _noop(_state: DraftGraphState) -> dict[str, Any]:
    return {}


@dataclass
class DraftGraphDependencies:
    collect_context: DraftCallback = _noop
    generate_outline: DraftCallback = _noop
    create_draft: DraftCallback = _noop
    generate_sections: DraftCallback = _noop
    assemble: DraftCallback = _noop
    save: DraftCallback = _noop
    cancel: DraftCallback = _noop


def new_draft_state(*, user_id: str, topic: str, requirements: dict | None = None,
                    thread_id: str | None = None) -> DraftGraphState:
    resolved_requirements = requirements or {}
    return DraftGraphState(
        user_id=user_id, thread_id=thread_id or f"draft-{uuid.uuid4().hex}",
        topic=topic.strip(), requirements=resolved_requirements,
        requirements_complete=bool(topic.strip()), status="planning", action="",
    )


def build_draft_graph(dependencies: DraftGraphDependencies | None = None, *, checkpointer=None):
    try:
        from langgraph.graph import END, START, StateGraph
        from langgraph.types import interrupt
    except ImportError as exc:
        raise RuntimeError("LangGraph runtime is not installed") from exc
    deps = dependencies or DraftGraphDependencies()

    def requirements_node(state: DraftGraphState) -> dict:
        if state.get("requirements_complete"):
            return {}
        answer = interrupt({"kind": "clarify_requirements", "topic": state.get("topic", "")})
        if not isinstance(answer, dict) or not str(answer.get("topic") or state.get("topic") or "").strip():
            return {"status": "cancelled", "action": "cancel"}
        return {
            "topic": str(answer.get("topic") or state.get("topic") or "").strip(),
            "requirements": {**state.get("requirements", {}), **answer},
            "requirements_complete": True,
        }

    async def context(state: DraftGraphState) -> dict:
        return await deps.collect_context(state)

    async def outline(state: DraftGraphState) -> dict:
        return await deps.generate_outline(state)

    async def persist_draft(state: DraftGraphState) -> dict:
        result = await deps.create_draft(state)
        return {**result, "status": "outline_ready"}

    def approve_outline(state: DraftGraphState) -> dict:
        decision = interrupt({
            "kind": "confirm_outline", "draftId": state.get("draft_id"),
            "outline": state.get("outline", ""),
        })
        action = str((decision or {}).get("action") if isinstance(decision, dict) else decision or "")
        return {"action": action or "cancel"}

    async def cancel(state: DraftGraphState) -> dict:
        result = await deps.cancel(state)
        return {**result, "status": "cancelled"}

    async def sections(state: DraftGraphState) -> dict:
        result = await deps.generate_sections(state)
        return {**result, "status": "generating"}

    def wait_sections(state: DraftGraphState) -> dict:
        decision = interrupt({
            "kind": "sections_ready", "draftId": state.get("draft_id"),
        })
        action = str((decision or {}).get("action") if isinstance(decision, dict) else decision or "")
        return {"action": action or "cancel"}

    async def assemble(state: DraftGraphState) -> dict:
        result = await deps.assemble(state)
        return {**result, "status": "assembled"}

    def approve_save(state: DraftGraphState) -> dict:
        decision = interrupt({
            "kind": "confirm_save", "draftId": state.get("draft_id"),
            "content": state.get("assembled_content", ""),
        })
        action = str((decision or {}).get("action") if isinstance(decision, dict) else decision or "")
        return {"action": action or "cancel"}

    async def save(state: DraftGraphState) -> dict:
        result = await deps.save(state)
        return {**result, "status": "saved"}

    def after_requirements(state: DraftGraphState) -> str:
        return "cancel" if state.get("status") == "cancelled" else "context"

    def after_outline(state: DraftGraphState) -> str:
        return "sections" if state.get("action") == "confirm" else "cancel"

    def after_save(state: DraftGraphState) -> str:
        return "save" if state.get("action") == "confirm" else "cancel"

    graph = StateGraph(DraftGraphState)
    for name, node in (
        ("requirements_node", requirements_node), ("context_node", context), ("outline_node", outline),
        ("persist_draft_node", persist_draft), ("approve_outline_node", approve_outline),
        ("sections_node", sections), ("wait_sections_node", wait_sections),
        ("assemble_node", assemble), ("approve_save_node", approve_save),
        ("save_node", save), ("cancel_node", cancel),
    ):
        graph.add_node(name, node)
    graph.add_edge(START, "requirements_node")
    graph.add_conditional_edges("requirements_node", after_requirements, {"context": "context_node", "cancel": "cancel_node"})
    graph.add_edge("context_node", "outline_node")
    graph.add_edge("outline_node", "persist_draft_node")
    graph.add_edge("persist_draft_node", "approve_outline_node")
    graph.add_conditional_edges("approve_outline_node", after_outline, {"sections": "sections_node", "cancel": "cancel_node"})
    graph.add_edge("sections_node", "wait_sections_node")
    graph.add_conditional_edges(
        "wait_sections_node", after_outline,
        {"sections": "assemble_node", "cancel": "cancel_node"},
    )
    graph.add_edge("assemble_node", "approve_save_node")
    graph.add_conditional_edges("approve_save_node", after_save, {"save": "save_node", "cancel": "cancel_node"})
    graph.add_edge("save_node", END)
    graph.add_edge("cancel_node", END)
    return graph.compile(checkpointer=checkpointer)


async def invoke_draft_graph(state: DraftGraphState | None, *, dependencies=None,
                             checkpointer=None, thread_id: str, resume: dict | None = None):
    graph = build_draft_graph(dependencies, checkpointer=checkpointer)
    config = {"configurable": {"thread_id": thread_id, "checkpoint_ns": "draft"}}
    if resume is not None:
        from langgraph.types import Command
        return await graph.ainvoke(Command(resume=resume), config=config)
    return await graph.ainvoke(state, config=config)
