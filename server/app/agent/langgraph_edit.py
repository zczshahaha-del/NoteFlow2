from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, TypedDict


class EditGraphState(TypedDict, total=False):
    user_id: str
    thread_id: str
    note_id: str
    instruction: str
    target_type: str
    section_id: str
    selected_text: str
    preview_id: str
    source_content_hash: str
    action: str
    action_payload: dict[str, Any]
    status: str


EditCallback = Callable[[EditGraphState], Awaitable[dict[str, Any]]]


async def _noop(_state: EditGraphState) -> dict[str, Any]:
    return {}


@dataclass
class EditGraphDependencies:
    resolve_target: EditCallback = _noop
    create_preview: EditCallback = _noop
    revise_preview: EditCallback = _noop
    restore_preview: EditCallback = _noop
    apply_preview: EditCallback = _noop
    cancel_preview: EditCallback = _noop


def new_edit_state(*, user_id: str, note_id: str, instruction: str,
                   target_type: str = "", section_id: str = "", selected_text: str = "",
                   thread_id: str | None = None) -> EditGraphState:
    return EditGraphState(
        user_id=user_id, note_id=note_id, instruction=instruction.strip(),
        target_type=target_type, section_id=section_id, selected_text=selected_text,
        thread_id=thread_id or f"edit-{uuid.uuid4().hex}", status="planning", action="",
    )


def build_edit_graph(dependencies: EditGraphDependencies | None = None, *, checkpointer=None):
    try:
        from langgraph.graph import END, START, StateGraph
        from langgraph.types import interrupt
    except ImportError as exc:
        raise RuntimeError("LangGraph runtime is not installed") from exc
    deps = dependencies or EditGraphDependencies()

    async def resolve(state: EditGraphState) -> dict:
        return await deps.resolve_target(state)

    def clarify(state: EditGraphState) -> dict:
        answer = interrupt({
            "kind": "clarify_edit_target",
            "noteId": state.get("note_id"),
            "targetType": state.get("target_type"),
        })
        if not isinstance(answer, dict) or answer.get("action") == "cancel":
            return {"action": "cancel", "status": "cancelled"}
        return {**answer, "ambiguous": False}

    async def preview(state: EditGraphState) -> dict:
        return {**await deps.create_preview(state), "status": "preview"}

    def decision(state: EditGraphState) -> dict:
        answer = interrupt({
            "kind": "confirm_edit_preview", "previewId": state.get("preview_id"),
            "noteId": state.get("note_id"),
        })
        if not isinstance(answer, dict):
            answer = {"action": str(answer or "cancel")}
        return {"action": str(answer.get("action") or "cancel"), "action_payload": answer}

    async def revise(state: EditGraphState) -> dict:
        return {**await deps.revise_preview(state), "action": "", "status": "preview"}

    async def restore(state: EditGraphState) -> dict:
        return {**await deps.restore_preview(state), "action": "", "status": "preview"}

    async def apply(state: EditGraphState) -> dict:
        return {**await deps.apply_preview(state), "status": "applied"}

    async def cancel(state: EditGraphState) -> dict:
        return {**await deps.cancel_preview(state), "status": "cancelled"}

    def after_resolve(state: EditGraphState) -> str:
        return "clarify" if state.get("ambiguous") else "preview"

    def after_clarify(state: EditGraphState) -> str:
        return "cancel" if state.get("status") == "cancelled" else "preview"

    def after_decision(state: EditGraphState) -> str:
        action = state.get("action")
        return action if action in {"apply", "revise", "restore"} else "cancel"

    graph = StateGraph(EditGraphState)
    for name, node in (
        ("resolve", resolve), ("clarify", clarify), ("preview", preview), ("decision", decision),
        ("revise", revise), ("restore", restore), ("apply", apply), ("cancel", cancel),
    ):
        graph.add_node(name, node)
    graph.add_edge(START, "resolve")
    graph.add_conditional_edges("resolve", after_resolve, {"preview": "preview", "clarify": "clarify"})
    graph.add_conditional_edges("clarify", after_clarify, {"preview": "preview", "cancel": "cancel"})
    graph.add_edge("preview", "decision")
    graph.add_conditional_edges(
        "decision", after_decision,
        {"apply": "apply", "revise": "revise", "restore": "restore", "cancel": "cancel"},
    )
    graph.add_edge("revise", "decision")
    graph.add_edge("restore", "decision")
    graph.add_edge("apply", END)
    graph.add_edge("cancel", END)
    return graph.compile(checkpointer=checkpointer)


async def invoke_edit_graph(state: EditGraphState | None, *, dependencies=None,
                            checkpointer=None, thread_id: str, resume: dict | None = None):
    graph = build_edit_graph(dependencies, checkpointer=checkpointer)
    config = {"configurable": {"thread_id": thread_id, "checkpoint_ns": "edit"}}
    if resume is not None:
        from langgraph.types import Command
        return await graph.ainvoke(Command(resume=resume), config=config)
    return await graph.ainvoke(state, config=config)
