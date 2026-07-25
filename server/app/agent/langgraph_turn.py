from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, TypedDict

from app.services.ai import ChatMessage
from app.services.turn_planner import (
    PlanResult,
    TurnPlan,
    clarification_question,
    plan_turn_smart,
    resume_turn_plan_smart,
    validate_turn_plan,
)


class TurnGraphState(TypedDict, total=False):
    user_id: str
    session_id: str
    thread_id: str
    question: str
    mode: str
    history: list[dict[str, str]]
    page_state: dict[str, Any]
    turn_plan: dict[str, Any]
    clarification_question: str
    status: str
    error_code: str
    error_message: str


PlanTurn = Callable[[TurnGraphState], Awaitable[TurnPlan]]
ResumeTurn = Callable[[TurnGraphState, TurnPlan, str], Awaitable[TurnPlan]]


async def _default_plan_turn(state: TurnGraphState) -> TurnPlan:
    history = [
        ChatMessage(role=str(item.get("role") or "user"), text=str(item.get("text") or ""))
        for item in state.get("history", [])[-8:]
    ]
    return await plan_turn_smart(
        question=state.get("question", ""),
        mode=state.get("mode", "chat"),
        history=history,
        page_state=state.get("page_state") or {},
    )


async def _default_resume_turn(
    state: TurnGraphState,
    plan: TurnPlan,
    answer: str,
) -> TurnPlan:
    history = [
        ChatMessage(role=str(item.get("role") or "user"), text=str(item.get("text") or ""))
        for item in state.get("history", [])[-8:]
    ]
    return await resume_turn_plan_smart(
        original_question=state.get("question", ""),
        answer=answer,
        plan=plan,
        history=history,
        page_state=state.get("page_state") or {},
    )


@dataclass
class TurnGraphDependencies:
    plan_turn: PlanTurn = _default_plan_turn
    resume_turn: ResumeTurn = _default_resume_turn


def _checkpoint_thread_id(thread_id: str) -> str:
    # checkpoint_ns is reserved by LangGraph for real nested subgraphs.
    # This is a root graph, so isolate it with a thread-id prefix instead.
    return f"turn-plan:{thread_id}"


def new_turn_state(
    *,
    user_id: str,
    session_id: str,
    question: str,
    mode: str,
    history: list[dict[str, str]] | None = None,
    page_state: dict[str, Any] | None = None,
) -> TurnGraphState:
    return TurnGraphState(
        user_id=user_id,
        session_id=session_id,
        thread_id=session_id,
        question=(question or "").strip(),
        mode=mode,
        history=history or [],
        page_state=page_state or {},
        status="planning",
        error_code="",
        error_message="",
    )


def _route_after_validation(state: TurnGraphState) -> str:
    if state.get("error_code"):
        return "error"
    plan = TurnPlan.model_validate(state.get("turn_plan") or {})
    if plan.result == PlanResult.CLARIFY:
        return "clarify"
    if plan.result == PlanResult.UNKNOWN:
        return "unknown"
    return "ready"


def build_turn_graph(dependencies: TurnGraphDependencies | None = None, *, checkpointer=None):
    try:
        from langgraph.graph import END, START, StateGraph
        from langgraph.types import interrupt
    except ImportError as exc:
        raise RuntimeError("LangGraph runtime is not installed") from exc

    deps = dependencies or TurnGraphDependencies()

    async def ingress(state: TurnGraphState) -> dict[str, Any]:
        if not state.get("question"):
            return {
                "status": "failed",
                "error_code": "invalid_input",
                "error_message": "问题不能为空",
            }
        mode = "ask_notes" if state.get("mode") == "ask_notes" else "chat"
        return {"mode": mode, "status": "planning"}

    async def planner(state: TurnGraphState) -> dict[str, Any]:
        try:
            plan = await deps.plan_turn(state)
        except Exception as exc:
            return {
                "status": "failed",
                "error_code": "planner_failed",
                "error_message": str(exc) or "规划服务暂时不可用，请稍后重试。",
            }
        return {"turn_plan": plan.model_dump(mode="json")}

    async def validator(state: TurnGraphState) -> dict[str, Any]:
        plan = validate_turn_plan(
            TurnPlan.model_validate(state.get("turn_plan") or {}),
            page_state=state.get("page_state") or {},
        )
        return {"turn_plan": plan.model_dump(mode="json")}

    async def clarify_prompt(state: TurnGraphState) -> dict[str, Any]:
        plan = TurnPlan.model_validate(state.get("turn_plan") or {})
        return {
            "clarification_question": clarification_question(plan),
            "status": "waiting_user_input",
        }

    async def clarify_wait(state: TurnGraphState) -> dict[str, Any]:
        plan = TurnPlan.model_validate(state.get("turn_plan") or {})
        answer = interrupt(
            {
                "type": "clarification",
                "question": state.get("clarification_question") or clarification_question(plan),
                "missingFields": plan.missing_fields,
                "turnPlan": plan.model_dump(mode="json"),
            }
        )
        reply = str(answer or "").strip()
        if re.fullmatch(r"(取消|算了|不用了|停止|不要了|cancel)", reply, re.I):
            return {"status": "cancelled", "clarification_question": ""}
        updated = (
            plan
            if re.fullmatch(r"(确认|确定|好的?|可以|行|继续|yes|ok)", reply, re.I)
            else await deps.resume_turn(state, plan, reply)
        )
        return {
            "turn_plan": updated.model_dump(mode="json"),
            "clarification_question": "",
            "status": "planning",
        }

    async def unknown(state: TurnGraphState) -> dict[str, Any]:
        return {
            "clarification_question": "我还没确定你想让我做什么，可以再具体说明一下吗？",
            "status": "unknown",
        }

    async def ready(state: TurnGraphState) -> dict[str, Any]:
        return {"status": "ready"}

    async def cancelled(state: TurnGraphState) -> dict[str, Any]:
        return {"status": "cancelled"}

    async def error(state: TurnGraphState) -> dict[str, Any]:
        return {
            "status": "failed",
            "error_message": state.get("error_message") or "意图识别失败",
        }

    builder = StateGraph(TurnGraphState)
    for name, node in (
        ("ingress", ingress),
        ("planner", planner),
        ("validator", validator),
        ("clarify_prompt", clarify_prompt),
        ("clarify_wait", clarify_wait),
        ("unknown", unknown),
        ("ready", ready),
        ("cancelled", cancelled),
        ("error", error),
    ):
        builder.add_node(name, node)

    builder.add_edge(START, "ingress")
    builder.add_conditional_edges(
        "ingress",
        lambda state: "error" if state.get("error_code") else "planner",
        {"planner": "planner", "error": "error"},
    )
    builder.add_conditional_edges(
        "planner",
        lambda state: "error" if state.get("error_code") else "validator",
        {"validator": "validator", "error": "error"},
    )
    builder.add_conditional_edges(
        "validator",
        _route_after_validation,
        {
            "clarify": "clarify_prompt",
            "unknown": "unknown",
            "ready": "ready",
            "error": "error",
        },
    )
    builder.add_edge("clarify_prompt", "clarify_wait")
    builder.add_conditional_edges(
        "clarify_wait",
        lambda state: "cancelled" if state.get("status") == "cancelled" else "validator",
        {"cancelled": "cancelled", "validator": "validator"},
    )
    builder.add_edge("unknown", END)
    builder.add_edge("ready", END)
    builder.add_edge("cancelled", END)
    builder.add_edge("error", END)
    return builder.compile(checkpointer=checkpointer)


async def invoke_turn_graph(
    state: TurnGraphState | None,
    *,
    checkpointer=None,
    thread_id: str,
    dependencies: TurnGraphDependencies | None = None,
    resume: str | None = None,
) -> TurnGraphState:
    graph = build_turn_graph(dependencies, checkpointer=checkpointer)
    config = {
        "configurable": {
            "thread_id": _checkpoint_thread_id(thread_id),
            "checkpoint_ns": "",
        }
    }
    if resume is not None:
        from langgraph.types import Command

        return await graph.ainvoke(Command(resume=resume), config=config)
    return await graph.ainvoke(state, config=config)


async def graph_waiting_for_clarification(
    *,
    checkpointer,
    thread_id: str,
    dependencies: TurnGraphDependencies | None = None,
) -> bool:
    graph = build_turn_graph(dependencies, checkpointer=checkpointer)
    config = {
        "configurable": {
            "thread_id": _checkpoint_thread_id(thread_id),
            "checkpoint_ns": "",
        }
    }
    snapshot = await graph.aget_state(config)
    return any(getattr(task, "interrupts", ()) for task in snapshot.tasks)
