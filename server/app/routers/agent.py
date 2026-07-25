from __future__ import annotations

import logging
import re
import time
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from app.config import cfg
from app.database import AsyncSessionLocal
from app.deps import CurrentUser, get_current_user, redis_rate_limit
from app.memory.service import MemoryContextService
from app.rag.service import RagRequest, configured_rag_service
from app.repositories.runs import RunRepository
from app.services.ai import ChatMessage, ChatRequest, stream_chat
from app.services.context_planner import ContextPlan
from app.services.memory_read import memory_read_plan_from_turn_plan
from app.services.runtime_errors import public_error_message
from app.services.run_service import RunService
from app.agent.sse import encode_event
from app.observability.context import trace_scope
from app.agent.langgraph_readonly import (
    new_readonly_state,
    postgres_checkpointer,
    stream_readonly_graph,
)
from app.agent.langgraph_turn import (
    graph_waiting_for_clarification,
    invoke_turn_graph,
    new_turn_state,
)
from app.services.agent_runtime import (
    finish_agent_run as _finish_agent_run,
    record_tool_trace as _record_tool_trace,
    start_agent_run as _start_agent_run,
    update_agent_run_intent as _update_agent_run_intent,
)
from app.services.agent_checkpoints import (
    agent_run_history as _agent_run_history,
    agent_task_snapshot as _agent_task_snapshot,
    checkpoint_out as _checkpoint_out,
    create_checkpoint as _create_checkpoint,
    latest_waiting_checkpoint as _latest_waiting_checkpoint,
    patch_working_memory_status as _patch_working_memory_status,
)
from app.services.agent_memory import (
    auto_save_memory_from_question as _auto_save_memory_from_question,
    episode_summary_from_checkpoint as _episode_summary_from_checkpoint,
    history_recall_context as _history_recall_context,
    list_memories_for_agent as _list_memories_for_agent,
    memory_context_from_records as _memory_context_from_records,
    memory_fallback_answer as _memory_fallback_answer,
    memory_tool_context as _memory_tool_context,
    query_memories_for_agent as _query_memories_for_agent,
    save_episode_memory as _save_episode_memory,
    save_memory_from_question as _save_memory_from_question,
    delete_memories_from_question as _delete_memories_from_question,
    disable_memory_for_user as _disable_memory_for_user,
)
from app.schemas.agent import (
    AgentChatPageState,
    AgentChatMessageIn,
    AgentChatPayload,
    CheckpointBindPayload,
    CheckpointResolvePayload,
    RunCancelPayload,
)
from app.services.turn_planner import ContextSource, PrimaryIntent, TurnPlan

router = APIRouter(prefix="/agent", tags=["agent"])
logger = logging.getLogger(__name__)


def _event_delta_text(data: dict[str, Any]) -> str:
    choices = data.get("choices") or []
    if not choices or not isinstance(choices[0], dict):
        return ""
    delta = choices[0].get("delta") or {}
    return str(delta.get("content") or "") if isinstance(delta, dict) else ""


def _langgraph_response(
    *, payload: AgentChatPayload, user_id: str, intent: str,
    run_state: dict[str, Any], turn_plan: TurnPlan, memory_enabled: bool,
) -> StreamingResponse:
    session_id = run_state["session_id"]
    run_id = run_state["run_id"]
    route_step_id = run_state["route_step_id"]
    state = new_readonly_state(
        user_id=user_id,
        question=payload.question,
        mode=payload.mode,
        history=[item.model_dump() for item in payload.history],
        page_state=_page_state_dict(payload.pageState) or {},
        turn_plan=turn_plan.model_dump(mode="json"),
        memory_enabled=memory_enabled,
        session_id=session_id,
        run_id=run_id,
        trace_id=run_state.get("trace_id") or "",
        thread_id=session_id,
    )

    async def stream():
        answer_parts: list[str] = []
        sources: list[dict] = []
        context_mode: Optional[str] = None
        failed = False
        error_message = ""
        with trace_scope(
            trace_id=run_state.get("trace_id") or "",
            session_id=session_id, run_id=run_id, node="langgraph",
        ):
            trace = await _record_tool_trace(
                user_id=user_id, run_id=run_id, step_id=route_step_id,
                tool_name="agent_runtime", action="langgraph_readonly",
                status="success", duration_ms=0,
                input_summary=payload.question,
                output_summary="LangGraph fixed runtime",
                metadata={"runtime": "langgraph", "ragProvider": "llamaindex"},
            )
            yield _sse_format(trace)
            try:
                async with postgres_checkpointer() as saver:
                    async for event in stream_readonly_graph(state, checkpointer=saver):
                        data = event.to_wire()
                        if event.type == "agent_session":
                            data.setdefault("intent", intent)
                        elif event.type == "choices":
                            answer_parts.append(_event_delta_text(data))
                        elif event.type == "answer_replace":
                            answer_parts = [str(data.get("content") or "")]
                        elif event.type == "context":
                            context_mode = data.get("contextMode")
                            sources = list(data.get("sources") or [])
                        elif event.type == "agent_error":
                            failed = True
                            error_message = str(data.get("message") or "LangGraph failed")
                        yield _sse_format(data)
            except Exception as exc:
                failed = True
                error_message = public_error_message(exc)
                yield _sse_format(_agent_error_event(session_id, run_id, error_message))
                yield _sse_format(_choice_delta(error_message))
                answer_parts.append(error_message)
                yield _sse_format(_agent_done_event(session_id, run_id, "failed"))

            answer = "".join(answer_parts).strip()
            await _finish_agent_run(
                user_id=user_id, session_id=session_id, run_id=run_id,
                status="failed" if failed else "completed", answer=answer,
                context_mode=context_mode, sources=sources,
                error_message=error_message or None,
            )
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        stream(), media_type="text/event-stream; charset=utf-8",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


def _sse_format(data: dict) -> str:
    return encode_event(data)


def _short(text: str, limit: int = 180) -> str:
    normalized = " ".join((text or "").split())
    if len(normalized) <= limit:
        return normalized
    return normalized[:limit].rstrip() + "..."


def _context_plan_from_turn_plan(plan: TurnPlan) -> ContextPlan:
    sources = set(plan.context_sources)
    intent_map = {
        PrimaryIntent.GENERAL_CHAT: "general_chat",
        PrimaryIntent.NOTE_CREATE: "note_draft_create",
        PrimaryIntent.NOTE_EDIT: "note_edit_create",
        PrimaryIntent.MEMORY: "memory_manage",
        PrimaryIntent.UNKNOWN: "general_chat",
    }
    intent = intent_map[plan.primary_intent]
    if ContextSource.KNOWLEDGE_BASE in sources:
        intent = "note_search"
    parameters = plan.intent_parameters
    return ContextPlan(
        primary_intent=intent,
        confidence=plan.confidence,
        reply_surface=(
            "draft_workspace"
            if intent == "note_draft_create"
            else "editor_patch"
            if intent == "note_edit_create"
            else "note_reference"
            if intent == "note_search"
            else "chat_bubble"
        ),
        memory_action=parameters.memory_action,
        context_plan={
            "use_current_selection": ContextSource.SELECTED_TEXT in sources,
            "use_current_note": ContextSource.CURRENT_NOTE in sources,
            "search_note_library": ContextSource.KNOWLEDGE_BASE in sources,
            "read_user_memory": ContextSource.USER_MEMORY in sources,
            "write_user_memory": False,
            "continue_working_task": False,
            "topic": parameters.topic or "",
            "focus": parameters.requirements,
        },
        draft_request={
            "topic": parameters.topic or "",
            "brief": parameters.requirements,
            "note_type": "智能笔记",
            "source_mode": "model_knowledge",
            "style": "按用户需求自动组织",
        }
        if intent == "note_draft_create"
        else {},
        edit_request={
            "target_type": "selection" if ContextSource.SELECTED_TEXT in sources else "note",
            "instruction": parameters.instruction,
        }
        if intent == "note_edit_create"
        else {},
        memory_read_request={
            "query": parameters.memory_query,
            "canonicalKey": parameters.memory_key,
            "scope": parameters.memory_scope,
            "layers": list(parameters.memory_layers),
            "memoryTypes": list(parameters.memory_types),
        }
        if intent == "memory_manage"
        else {},
        reason=plan.reason,
        source=plan.source,
    )


def _terminal_turn_response(
    *,
    user_id: str,
    run_state: dict[str, Any],
    intent: str,
    answer: str,
    turn_plan: TurnPlan | None = None,
) -> StreamingResponse:
    session_id = run_state["session_id"]
    run_id = run_state["run_id"]

    async def stream():
        yield _sse_format(
            {
                "type": "agent_session",
                "sessionId": session_id,
                "runId": run_id,
                "intent": intent,
            }
        )
        if turn_plan is not None:
            yield _sse_format(
                {
                    "type": "tool_trace",
                    "toolName": "turn_planner",
                    "action": turn_plan.result.value,
                    "status": "success",
                    "metadata": {"turnPlan": turn_plan.model_dump(mode="json"), "silent": True},
                }
            )
        yield _sse_format(_choice_delta(answer))
        await _finish_agent_run(
            user_id=user_id,
            session_id=session_id,
            run_id=run_id,
            status="completed",
            answer=answer,
        )
        yield _sse_format(_agent_done_event(session_id, run_id, "completed"))
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream; charset=utf-8",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


def _page_state_dict(page_state: AgentChatPageState | None) -> dict[str, Any] | None:
    return page_state.model_dump() if page_state else None


def _note_sources_fallback(sources: list[dict]) -> str:
    if not sources:
        return "我在你的笔记里没有找到相关内容。"
    return "我找到了相关笔记，但当前 AI 服务不可用，暂时无法根据笔记生成回答。[1]"


def _infer_edit_target_type(question: str) -> Optional[str]:
    if re.search(r"(删掉|删除|移除)", question):
        return "delete"
    if re.search(r"(插入|插到|插在)", question):
        return "insert"
    if re.search(r"(当前小节|这个小节|这一个小节|这一小节|本小节|小节|当前章节|这个章节|这一个章节|这一章节|章节|当前节|这一节|这节|本节|这一章|这章|本章|段落)", question):
        return "section"
    return None


async def _checkpoint_for_plan(user_id: str, session_id: Optional[str], intent: str) -> Optional[dict]:
    if intent in {"resume_work", "note_draft_continue", "confirm_action", "cancel_action", "note_edit_revise"}:
        return await _latest_working_checkpoint(user_id, session_id)
    if session_id:
        return await _latest_waiting_checkpoint(user_id, session_id)
    return None


async def _effective_memory_enabled(user_id: str, requested: bool) -> bool:
    return await MemoryContextService().enabled(user_id=user_id, requested=requested)


async def _resolve_checkpoint_by_id(
    *,
    user_id: str,
    checkpoint_id: str,
    status: str,
    payload_patch: Optional[dict] = None,
) -> Optional[dict]:
    async with AsyncSessionLocal() as db:
        checkpoint = await RunRepository(db).get_checkpoint(user_id, checkpoint_id)
        if checkpoint is None:
            return None
        if checkpoint.status != "waiting_user_confirm" and status == "cancelled":
            return _checkpoint_out(checkpoint)
        payload = dict(checkpoint.payload or {})
        if payload_patch:
            payload.update(payload_patch)
        if checkpoint.checkpoint_type in {"draft_workspace", "edit_preview"} or payload.get("workingMemory"):
            working_extra = {}
            if payload.get("draftId"):
                working_extra["relatedDraftId"] = payload.get("draftId")
            if payload.get("editPreviewId"):
                working_extra["relatedEditPreviewId"] = payload.get("editPreviewId")
            if payload.get("noteId"):
                working_extra["relatedNoteId"] = payload.get("noteId")
            payload = _patch_working_memory_status(payload, status, working_extra)
            if status in {"resolved", "cancelled", "failed"}:
                event_type, summary, episode_tags_list = _episode_summary_from_checkpoint(
                    checkpoint.checkpoint_type,
                    payload,
                    status,
                )
                await _save_episode_memory(
                    db,
                    user_id=user_id,
                    event_type=event_type,
                    summary=summary,
                    source="work_memory",
                    tags=episode_tags_list,
                )
        checkpoint.payload = payload
        checkpoint.status = status
        checkpoint.resolved_at = datetime.utcnow() if status != "waiting_user_confirm" else None
        checkpoint.updated_at = datetime.utcnow()
        await db.commit()
        await db.refresh(checkpoint)
        return _checkpoint_out(checkpoint)


def _choice_delta(text: str) -> dict:
    return {
        "choices": [
            {
                "delta": {"content": text},
                "finish_reason": "stop",
            }
        ]
    }


def _agent_done_event(session_id: str, run_id: str, status: str = "completed") -> dict:
    return {
        "type": "agent_done",
        "sessionId": session_id,
        "runId": run_id,
        "status": status,
    }


def _public_error_message(exc: Exception) -> str:
    return public_error_message(exc)


def _agent_error_event(session_id: str, run_id: str, message: str, code: str = "agent_failed") -> dict:
    return {
        "type": "agent_error",
        "sessionId": session_id,
        "runId": run_id,
        "status": "failed",
        "code": code,
        "message": message,
    }


def _tool_action(tool_name: str, action: str, payload: dict, message: str) -> dict:
    return {
        "type": "tool_action",
        "toolName": tool_name,
        "action": action,
        "payload": payload,
        "message": message,
    }


def _draft_seed_from_plan(context_plan: ContextPlan, question: str) -> str:
    draft_request = context_plan.draft_request or {}
    context = context_plan.context_plan or {}
    for value in (
        draft_request.get("topic"),
        context.get("topic"),
        draft_request.get("title"),
    ):
        text = _short(str(value or ""), 140).strip()
        if text:
            return text
    return question


def _draft_seed_for_continue(
    context_plan: ContextPlan,
    checkpoint: dict | None,
    page_state: AgentChatPageState | None,
    question: str,
) -> str:
    checkpoint_payload = (checkpoint or {}).get("payload") or {}
    for value in (
        page_state.activeDraftTopic if page_state else "",
        page_state.activeDraftTitle if page_state else "",
        page_state.draftSeed if page_state else "",
        checkpoint_payload.get("draftTopic"),
        checkpoint_payload.get("draftTitle"),
        checkpoint_payload.get("seed"),
        (context_plan.draft_request or {}).get("topic"),
        (context_plan.context_plan or {}).get("topic"),
    ):
        text = _short(str(value or ""), 140).strip()
        if text:
            return text
    return _draft_seed_from_plan(context_plan, question)


def _working_memory_summary(checkpoint: dict | None) -> str:
    if not checkpoint:
        return ""
    working = checkpoint.get("workingMemory") or (checkpoint.get("payload") or {}).get("workingMemory") or {}
    if not working:
        return ""
    title = working.get("title") or "进行中的任务"
    current = working.get("currentStep") or "等待继续"
    pending = working.get("pendingSteps") or []
    pending_text = "、".join(str(item) for item in pending[:3]) if pending else "等待下一步操作"
    return f"{title}；当前步骤：{current}；下一步：{pending_text}"


async def _latest_working_checkpoint(user_id: str, session_id: Optional[str] = None) -> Optional[dict]:
    checkpoint = await _latest_waiting_checkpoint(user_id, session_id)
    if checkpoint:
        return checkpoint
    if session_id:
        return await _latest_waiting_checkpoint(user_id, None)
    return None


async def _complete_tool_only_run(
    *,
    user_id: str,
    session_id: str,
    run_id: str,
    route_step_id: str,
    tool_name: str,
    action: str,
    answer: str,
    input_summary: str,
    output_summary: str,
    metadata: Optional[dict] = None,
    message_metadata: Optional[dict] = None,
) -> dict:
    trace = await _record_tool_trace(
        user_id=user_id,
        run_id=run_id,
        step_id=route_step_id,
        tool_name=tool_name,
        action=action,
        status="success",
        duration_ms=0,
        input_summary=input_summary,
        output_summary=output_summary,
        metadata=metadata or {},
    )
    await _finish_agent_run(
        user_id=user_id,
        session_id=session_id,
        run_id=run_id,
        status="completed",
        answer=answer,
        message_metadata=message_metadata,
    )
    return trace


@router.get("/checkpoints/latest")
async def latest_checkpoint(
    sessionId: Optional[str] = None,
    user: CurrentUser = Depends(get_current_user),
):
    checkpoint = await _latest_waiting_checkpoint(user.id, sessionId)
    return {"checkpoint": checkpoint}


@router.get("/runs/latest")
async def latest_run(
    sessionId: Optional[str] = None,
    user: CurrentUser = Depends(get_current_user),
):
    return await _agent_task_snapshot(user.id, sessionId)


@router.get("/runs")
async def list_runs(
    sessionId: Optional[str] = None,
    limit: int = 8,
    user: CurrentUser = Depends(get_current_user),
):
    return await _agent_run_history(user.id, sessionId, limit)


@router.post("/runs/{run_id}/cancel")
async def cancel_run(
    run_id: str,
    payload: RunCancelPayload,
    user: CurrentUser = Depends(get_current_user),
):
    if not await RunService().cancel(user.id, run_id, payload.reason):
        return {"task": None}

    return await _agent_task_snapshot(user.id, run_id=run_id)


@router.post("/checkpoints/{checkpoint_id}/bind")
async def bind_checkpoint(
    checkpoint_id: str,
    payload: CheckpointBindPayload,
    user: CurrentUser = Depends(get_current_user),
):
    patch = dict(payload.payload or {})
    if payload.editPreviewId:
        patch["editPreviewId"] = payload.editPreviewId
    if payload.draftId:
        patch["draftId"] = payload.draftId
    checkpoint = await _resolve_checkpoint_by_id(
        user_id=user.id,
        checkpoint_id=checkpoint_id,
        status="waiting_user_confirm",
        payload_patch=patch,
    )
    return {"checkpoint": checkpoint}


@router.post("/checkpoints/{checkpoint_id}/resolve")
async def resolve_checkpoint(
    checkpoint_id: str,
    payload: CheckpointResolvePayload,
    user: CurrentUser = Depends(get_current_user),
):
    status = payload.status if payload.status in {"resolved", "cancelled", "failed"} else "resolved"
    checkpoint = await _resolve_checkpoint_by_id(
        user_id=user.id,
        checkpoint_id=checkpoint_id,
        status=status,
        payload_patch=payload.payload,
    )
    return {"checkpoint": checkpoint}


@router.post("/chat")
async def chat(
    payload: AgentChatPayload,
    user: CurrentUser = Depends(redis_rate_limit("agent-chat", cfg.AI_RATE_LIMIT)),
):
    run_state = await _start_agent_run(payload, user.id, "planning")
    session_id = run_state["session_id"]
    run_id = run_state["run_id"]
    route_step_id = run_state["route_step_id"]
    page_state_dict = _page_state_dict(payload.pageState) or {}

    try:
        async with postgres_checkpointer() as saver:
            waiting = bool(payload.sessionId) and await graph_waiting_for_clarification(
                checkpointer=saver,
                thread_id=session_id,
            )
            turn_state = await invoke_turn_graph(
                None
                if waiting
                else new_turn_state(
                    user_id=user.id,
                    session_id=session_id,
                    question=payload.question,
                    mode=payload.mode,
                    history=[item.model_dump() for item in payload.history],
                    page_state=page_state_dict,
                ),
                checkpointer=saver,
                thread_id=session_id,
                resume=payload.question if waiting else None,
            )
    except Exception as exc:
        logger.exception("Turn planning failed")
        answer = public_error_message(exc)
        await _update_agent_run_intent(
            user_id=user.id,
            run_id=run_id,
            step_id=route_step_id,
            intent="unknown",
        )
        return _terminal_turn_response(
            user_id=user.id,
            run_state=run_state,
            intent="unknown",
            answer=answer,
        )

    raw_plan = turn_state.get("turn_plan") or {}
    turn_plan = TurnPlan.model_validate(raw_plan) if raw_plan else None
    if turn_state.get("status") == "cancelled":
        intent = turn_plan.primary_intent.value if turn_plan else "unknown"
        await _update_agent_run_intent(
            user_id=user.id,
            run_id=run_id,
            step_id=route_step_id,
            intent=intent,
        )
        return _terminal_turn_response(
            user_id=user.id,
            run_state=run_state,
            intent=intent,
            answer="已取消本次请求。",
            turn_plan=turn_plan,
        )
    if "__interrupt__" in turn_state:
        answer = (
            str(turn_state.get("clarification_question") or "").strip()
            or "还缺少一些必要信息，可以再具体说明一下吗？"
        )
        intent = turn_plan.primary_intent.value if turn_plan else "unknown"
        await _update_agent_run_intent(
            user_id=user.id,
            run_id=run_id,
            step_id=route_step_id,
            intent=intent,
        )
        return _terminal_turn_response(
            user_id=user.id,
            run_state=run_state,
            intent=intent,
            answer=answer,
            turn_plan=turn_plan,
        )

    if turn_plan is None or turn_state.get("status") == "failed":
        answer = str(turn_state.get("error_message") or "意图识别失败，请再说具体一点。")
        return _terminal_turn_response(
            user_id=user.id,
            run_state=run_state,
            intent="unknown",
            answer=answer,
        )

    if turn_plan.primary_intent == PrimaryIntent.UNKNOWN:
        answer = (
            str(turn_state.get("clarification_question") or "").strip()
            or "我还没确定你想让我做什么，可以再具体说明一下吗？"
        )
        await _update_agent_run_intent(
            user_id=user.id,
            run_id=run_id,
            step_id=route_step_id,
            intent="unknown",
        )
        return _terminal_turn_response(
            user_id=user.id,
            run_state=run_state,
            intent="unknown",
            answer=answer,
            turn_plan=turn_plan,
        )

    context_plan = _context_plan_from_turn_plan(turn_plan)
    force_note_answer = ContextSource.KNOWLEDGE_BASE in turn_plan.context_sources
    intent = context_plan.primary_intent
    await _update_agent_run_intent(
        user_id=user.id,
        run_id=run_id,
        step_id=route_step_id,
        intent=intent,
    )
    active_checkpoint = await _checkpoint_for_plan(user.id, payload.sessionId, intent)
    memory_enabled = await _effective_memory_enabled(user.id, not force_note_answer)

    if intent in {"general_chat", "note_search", "note_context_qa"}:
        return _langgraph_response(
            payload=payload,
            user_id=user.id,
            intent=intent,
            run_state=run_state,
            turn_plan=turn_plan,
            memory_enabled=memory_enabled,
        )

    async def _stream_impl():
        answer_parts: list[str] = []
        context_mode: Optional[str] = None
        sources: list[dict] = []

        yield _sse_format(
            {
                "type": "agent_session",
                "sessionId": session_id,
                "runId": run_id,
                "intent": intent,
            }
        )

        try:
            planner_trace = await _record_tool_trace(
                user_id=user.id,
                run_id=run_id,
                step_id=route_step_id,
                tool_name="response_mode",
                action=payload.mode,
                status="success",
                duration_ms=0,
                input_summary=payload.question,
                output_summary="全库搜索" if force_note_answer else f"对话模式：{intent}",
                metadata={"mode": payload.mode, "intent": intent, "contextPlan": context_plan.to_metadata(), "silent": True},
            )
            yield _sse_format(planner_trace)

            selected_text = (payload.pageState.selectedText if payload.pageState else "").strip()
            document_title = "用户明确附带的文字" if selected_text and not force_note_answer else ""
            document_content = selected_text if selected_text and not force_note_answer else ""
            memory_context = ""
            page_state = payload.pageState

            if memory_enabled and context_plan.context_plan.get("read_user_memory"):
                started = time.perf_counter()
                memory_plan = memory_read_plan_from_turn_plan(
                    turn_plan,
                    question=payload.question,
                )
                _, context_memories = await _query_memories_for_agent(
                    user.id,
                    payload.question,
                    payload.history,
                    read_plan=memory_plan,
                )
                memory_context = _memory_context_from_records(context_memories)
                trace = await _record_tool_trace(
                    user_id=user.id,
                    run_id=run_id,
                    step_id=route_step_id,
                    tool_name="memory_tool",
                    action="build_context",
                    status="success",
                    duration_ms=int((time.perf_counter() - started) * 1000),
                    input_summary=payload.question,
                    output_summary="已读取相关个人资料" if memory_context else "本轮不需要个人资料",
                    metadata={
                        "enabled": True,
                        "silent": True,
                        "plannerConfidence": turn_plan.confidence,
                        "singleTurnPlan": True,
                    },
                )
                yield _sse_format(trace)

            if intent in {"confirm_action", "cancel_action", "note_edit_revise"}:
                checkpoint_payload = (active_checkpoint or {}).get("payload") or {}
                checkpoint_id = (active_checkpoint or {}).get("id")
                checkpoint_type = (active_checkpoint or {}).get("checkpointType")
                if intent == "cancel_action" and (
                    checkpoint_type == "draft_workspace" or (page_state and page_state.centerMode == "draft")
                ):
                    answer = "已取消当前草稿任务。"
                    trace = await _complete_tool_only_run(
                        user_id=user.id,
                        session_id=session_id,
                        run_id=run_id,
                        route_step_id=route_step_id,
                        tool_name="note_draft_tool",
                        action="cancel_draft",
                        answer=answer,
                        input_summary=payload.question,
                        output_summary=answer,
                        metadata={"checkpointId": checkpoint_id},
                    )
                    yield _sse_format(trace)
                    yield _sse_format(
                        _tool_action(
                            "note_draft_tool",
                            "cancel_draft",
                            {"checkpointId": checkpoint_id},
                            answer,
                        )
                    )
                    yield _sse_format(_choice_delta(answer))
                    yield _sse_format(
                        {
                            "type": "agent_done",
                            "sessionId": session_id,
                            "runId": run_id,
                            "status": "completed",
                        }
                    )
                    yield "data: [DONE]\n\n"
                    return

                edit_preview_id = (
                    page_state.activeEditPreviewId
                    if page_state and page_state.activeEditPreviewId
                    else checkpoint_payload.get("editPreviewId")
                )
                if not edit_preview_id:
                    answer = "当前没有等待确认的修改预览。请先让我生成修改预览。"
                    yield _sse_format(_choice_delta(answer))
                    await _finish_agent_run(
                        user_id=user.id,
                        session_id=session_id,
                        run_id=run_id,
                        status="completed",
                        answer=answer,
                    )
                    yield _sse_format(_agent_done_event(session_id, run_id, "completed"))
                    yield "data: [DONE]\n\n"
                    return

                if intent == "confirm_action":
                    tool_action = "apply_preview"
                    answer = "我会应用当前修改预览，并保存旧版本。"
                elif intent == "cancel_action":
                    tool_action = "cancel_preview"
                    answer = "我会取消当前修改预览，正式笔记不会变化。"
                else:
                    tool_action = "revise_preview"
                    answer = "我会基于当前预览继续调整，仍然不会写回正式笔记。"

                trace = await _complete_tool_only_run(
                    user_id=user.id,
                    session_id=session_id,
                    run_id=run_id,
                    route_step_id=route_step_id,
                    tool_name="note_edit_tool",
                    action=tool_action,
                    answer=answer,
                    input_summary=payload.question,
                    output_summary=answer,
                    metadata={"checkpointId": checkpoint_id, "editPreviewId": edit_preview_id},
                )
                yield _sse_format(trace)
                yield _sse_format(
                    _tool_action(
                        "note_edit_tool",
                        tool_action,
                        {
                            "editPreviewId": edit_preview_id,
                            "instruction": payload.question,
                            "checkpointId": checkpoint_id,
                        },
                        answer,
                    )
                )
                yield _sse_format(_choice_delta(answer))
                if memory_enabled:
                    await _auto_save_memory_from_question(
                        user.id,
                        payload.question,
                        payload.history,
                    )
                yield _sse_format(
                    {
                        "type": "agent_done",
                        "sessionId": session_id,
                        "runId": run_id,
                        "status": "completed",
                    }
                )
                yield "data: [DONE]\n\n"
                return

            if intent == "resume_work":
                checkpoint = active_checkpoint
                if not checkpoint:
                    answer = "我这边没有找到正在等待继续的任务。你可以直接告诉我接下来要做什么。"
                    yield _sse_format(_choice_delta(answer))
                    await _finish_agent_run(
                        user_id=user.id,
                        session_id=session_id,
                        run_id=run_id,
                        status="completed",
                        answer=answer,
                    )
                    yield _sse_format(_agent_done_event(session_id, run_id, "completed"))
                    yield "data: [DONE]\n\n"
                    return

                checkpoint_type = checkpoint.get("checkpointType")
                payload_data = checkpoint.get("payload") or {}
                summary = _working_memory_summary(checkpoint)
                if checkpoint_type == "draft_workspace":
                    answer = f"可以，继续上次的草稿任务：{summary}。我会把草稿工作区打开，你可以接着生成大纲或正文。"
                    tool_name = "note_draft_tool"
                    action = "open_draft_workspace"
                    action_payload = {
                        "seed": payload_data.get("seed", ""),
                        "draftId": payload_data.get("draftId"),
                        "checkpointId": checkpoint.get("id"),
                        "checkpoint": checkpoint,
                        "resume": True,
                    }
                elif checkpoint_type == "edit_preview":
                    answer = f"可以，继续上次的修改预览：{summary}。你可以继续调整，也可以输入“应用吧”或“取消”。"
                    tool_name = "note_edit_tool"
                    action = "resume_edit_preview"
                    action_payload = {
                        "editPreviewId": payload_data.get("editPreviewId"),
                        "noteId": payload_data.get("noteId"),
                        "checkpointId": checkpoint.get("id"),
                        "checkpoint": checkpoint,
                    }
                else:
                    answer = f"可以，继续上次的任务：{summary or '等待下一步操作'}。"
                    tool_name = "agent_working_memory"
                    action = "resume_task"
                    action_payload = {"checkpointId": checkpoint.get("id")}

                trace = await _complete_tool_only_run(
                    user_id=user.id,
                    session_id=session_id,
                    run_id=run_id,
                    route_step_id=route_step_id,
                    tool_name=tool_name,
                    action=action,
                    answer=answer,
                    input_summary=payload.question,
                    output_summary=answer,
                    metadata={
                        "checkpointId": checkpoint.get("id"),
                        "checkpointType": checkpoint_type,
                        "workingMemory": checkpoint.get("workingMemory"),
                    },
                )
                yield _sse_format(trace)
                yield _sse_format({"type": "checkpoint", "checkpoint": checkpoint})
                yield _sse_format(_tool_action(tool_name, action, action_payload, answer))
                yield _sse_format(_choice_delta(answer))
                yield _sse_format(
                    {
                        "type": "agent_done",
                        "sessionId": session_id,
                        "runId": run_id,
                        "status": "completed",
                    }
                )
                yield "data: [DONE]\n\n"
                return

            if intent == "history_recall":
                started = time.perf_counter()
                recall_context, episodes = await _history_recall_context(user.id, payload.question)
                trace = await _record_tool_trace(
                    user_id=user.id,
                    run_id=run_id,
                    step_id=route_step_id,
                    tool_name="memory_tool",
                    action="history_recall",
                    status="success",
                    duration_ms=int((time.perf_counter() - started) * 1000),
                    input_summary=payload.question,
                    output_summary=f"读取 {len(episodes)} 条历史事件",
                    metadata={"episodeCount": len(episodes), "silent": True},
                )
                yield _sse_format(trace)
                chat_req = ChatRequest(
                    question=payload.question,
                    documentTitle="NoteFlow 历史回忆上下文",
                    documentContent=recall_context,
                    history=[ChatMessage(role=m.role, text=m.text) for m in payload.history],
                    maxTokens=payload.maxTokens or 900,
                    temperature=payload.temperature,
                )
                ai_started = time.perf_counter()
                try:
                    async for chunk in stream_chat(chat_req):
                        choice = (chunk.get("choices") or [{}])[0]
                        delta = ((choice.get("delta") or {}).get("content")) or ""
                        if delta:
                            answer_parts.append(delta)
                        yield _sse_format(chunk)
                except ValueError as e:
                    if "not configured" not in str(e).lower():
                        raise
                    if episodes:
                        fallback = "我记得最近有这些相关事情：\n" + "\n".join(
                            f"{index}. {episode.get('content')}" for index, episode in enumerate(episodes, start=1)
                        )
                    else:
                        fallback = "我暂时没有找到足够明确的历史记录。你可以给我一个关键词，我再帮你找。"
                    answer_parts.append(fallback)
                    yield _sse_format(_choice_delta(fallback))

                answer = "".join(answer_parts).strip()
                ai_trace = await _record_tool_trace(
                    user_id=user.id,
                    run_id=run_id,
                    step_id=route_step_id,
                    tool_name="ai_chat",
                    action="stream_answer",
                    status="success",
                    duration_ms=int((time.perf_counter() - ai_started) * 1000),
                    input_summary=payload.question,
                    output_summary=f"生成 {len(answer)} 个字符",
                    metadata={"intent": intent},
                )
                yield _sse_format(ai_trace)
                await _finish_agent_run(
                    user_id=user.id,
                    session_id=session_id,
                    run_id=run_id,
                    status="completed",
                    answer=answer,
                )
                yield _sse_format(
                    {
                        "type": "agent_done",
                        "sessionId": session_id,
                        "runId": run_id,
                        "status": "completed",
                    }
                )
                yield "data: [DONE]\n\n"
                return

            if intent == "memory_manage":
                if not memory_enabled:
                    answer = "记忆功能现在是关闭的，我不会保存或读取你的个人记忆。你可以在个人资料里重新开启。"
                    trace = await _record_tool_trace(
                        user_id=user.id,
                        run_id=run_id,
                        step_id=route_step_id,
                        tool_name="memory_tool",
                        action="memory_disabled",
                        status="success",
                        duration_ms=0,
                        input_summary=payload.question,
                        output_summary=answer,
                        metadata={"memoryEnabled": False, "silent": True},
                    )
                    yield _sse_format(trace)
                    yield _sse_format(_choice_delta(answer))
                    await _finish_agent_run(
                        user_id=user.id,
                        session_id=session_id,
                        run_id=run_id,
                        status="completed",
                        answer=answer,
                    )
                    yield _sse_format(
                        {
                            "type": "agent_done",
                            "sessionId": session_id,
                            "runId": run_id,
                            "status": "completed",
                        }
                    )
                    yield "data: [DONE]\n\n"
                    return

                started = time.perf_counter()
                memory_action = (
                    context_plan.memory_action
                    if context_plan.memory_action
                    in {"read", "list", "write", "update", "delete", "disable"}
                    else "read"
                )
                if memory_action == "list":
                    tool_summary, memories = await _list_memories_for_agent(user.id)
                    action = "list_memories"
                    output_summary = f"读取 {len(memories)} 条长期记忆"
                elif memory_action == "read":
                    tool_summary, memories = await _query_memories_for_agent(
                        user.id,
                        payload.question,
                        payload.history,
                        read_plan=memory_read_plan_from_turn_plan(
                            turn_plan,
                            question=payload.question,
                        ),
                    )
                    action = "list_memories"
                    output_summary = f"读取 {len(memories)} 条长期记忆"
                elif memory_action == "delete":
                    tool_summary, memories = await _delete_memories_from_question(
                        user.id,
                        payload.question,
                        canonical_keys=(
                            [turn_plan.intent_parameters.memory_key]
                            if turn_plan.intent_parameters.memory_key
                            else []
                        ),
                        memory_types=list(turn_plan.intent_parameters.memory_types),
                    )
                    action = "delete_memories"
                    output_summary = tool_summary
                elif memory_action == "disable":
                    tool_summary, memories = await _disable_memory_for_user(user.id)
                    action = "disable_memory"
                    output_summary = tool_summary
                else:
                    tool_summary, memories = await _save_memory_from_question(user.id, payload.question, payload.history)
                    action = "save_memory"
                    output_summary = f"保存 {len(memories)} 条长期记忆"
                trace = await _record_tool_trace(
                    user_id=user.id,
                    run_id=run_id,
                    step_id=route_step_id,
                    tool_name="memory_tool",
                    action=action,
                    status="success",
                    duration_ms=int((time.perf_counter() - started) * 1000),
                    input_summary=payload.question,
                    output_summary=output_summary,
                    metadata={"memoryCount": len(memories)},
                )
                yield _sse_format(trace)
                yield _sse_format(
                    _tool_action(
                        "memory_tool",
                        action,
                        {"memories": memories},
                        "长期记忆工具已完成，正在组织回复。",
                    )
                )
                memory_result_context = _memory_tool_context(action, memories, payload.question)
                chat_req = ChatRequest(
                    question=payload.question,
                    documentTitle="NoteFlow 长期记忆工具结果",
                    documentContent=memory_result_context,
                    history=[ChatMessage(role=m.role, text=m.text) for m in payload.history],
                    maxTokens=payload.maxTokens or 900,
                    temperature=payload.temperature,
                )
                answer_parts: list[str] = []
                ai_started = time.perf_counter()
                try:
                    async for chunk in stream_chat(chat_req):
                        choice = (chunk.get("choices") or [{}])[0]
                        delta = ((choice.get("delta") or {}).get("content")) or ""
                        if delta:
                            answer_parts.append(delta)
                        yield _sse_format(chunk)
                except ValueError as e:
                    if "not configured" not in str(e).lower():
                        raise
                    fallback = _memory_fallback_answer(action, memories)
                    answer_parts.append(fallback)
                    yield _sse_format(_choice_delta(fallback))

                answer = "".join(answer_parts).strip() or tool_summary
                ai_trace = await _record_tool_trace(
                    user_id=user.id,
                    run_id=run_id,
                    step_id=route_step_id,
                    tool_name="ai_chat",
                    action="stream_answer",
                    status="success",
                    duration_ms=int((time.perf_counter() - ai_started) * 1000),
                    input_summary=payload.question,
                    output_summary=f"生成 {len(answer)} 个字符",
                    metadata={"intent": intent, "memoryAction": action},
                )
                yield _sse_format(ai_trace)
                await _finish_agent_run(
                    user_id=user.id,
                    session_id=session_id,
                    run_id=run_id,
                    status="completed",
                    answer=answer,
                )
                yield _sse_format(
                    {
                        "type": "agent_done",
                        "sessionId": session_id,
                        "runId": run_id,
                        "status": "completed",
                    }
                )
                yield "data: [DONE]\n\n"
                return

            if intent == "clarify" or context_plan.should_ask_clarification:
                answer = context_plan.clarification_question.strip() or "在生成课程前，我想先确认一下：你目前的基础、学习目标，以及希望学到什么深度？"
                yield _sse_format(_choice_delta(answer))
                await _finish_agent_run(
                    user_id=user.id,
                    session_id=session_id,
                    run_id=run_id,
                    status="completed",
                    answer=answer,
                )
                yield _sse_format(_agent_done_event(session_id, run_id, "completed"))
                yield "data: [DONE]\n\n"
                return

            if intent == "note_draft_continue":
                checkpoint = active_checkpoint
                page_state = payload.pageState
                draft_seed = _draft_seed_for_continue(context_plan, checkpoint, page_state, payload.question)
                checkpoint_id = (checkpoint or {}).get("id")
                if not checkpoint_id and not draft_seed:
                    answer = "我没有找到当前草稿任务。你可以先告诉我要写什么主题，我再重新生成大纲。"
                    yield _sse_format(_choice_delta(answer))
                    await _finish_agent_run(
                        user_id=user.id,
                        session_id=session_id,
                        run_id=run_id,
                        status="completed",
                        answer=answer,
                    )
                    yield _sse_format(_agent_done_event(session_id, run_id, "completed"))
                    yield "data: [DONE]\n\n"
                    return

                answer = "收到，我按你的反馈重新调整大纲。"
                metadata = {
                    "seed": draft_seed,
                    "feedback": payload.question,
                    "checkpointId": checkpoint_id,
                    "draftRequest": context_plan.draft_request,
                }
                trace = await _complete_tool_only_run(
                    user_id=user.id,
                    session_id=session_id,
                    run_id=run_id,
                    route_step_id=route_step_id,
                    tool_name="note_draft_tool",
                    action="regenerate_outline",
                    answer=answer,
                    input_summary=payload.question,
                    output_summary="重新生成 AI 草稿大纲",
                    metadata=metadata,
                )
                yield _sse_format(trace)
                if checkpoint:
                    yield _sse_format({"type": "checkpoint", "checkpoint": checkpoint})
                yield _sse_format(
                    _tool_action(
                        "note_draft_tool",
                        "regenerate_outline",
                        metadata,
                        answer,
                    )
                )
                yield _sse_format(_choice_delta(answer))
                if memory_enabled:
                    await _auto_save_memory_from_question(
                        user.id,
                        payload.question,
                        payload.history,
                    )
                yield _sse_format(
                    {
                        "type": "agent_done",
                        "sessionId": session_id,
                        "runId": run_id,
                        "status": "completed",
                    }
                )
                yield "data: [DONE]\n\n"
                return

            if intent == "note_draft_create":
                draft_runtime = "langgraph"
                draft_seed = _draft_seed_from_plan(context_plan, payload.question)
                planned_brief = _short(
                    str((context_plan.draft_request or {}).get("brief") or ""),
                    2000,
                ).strip()
                draft_raw_request = planned_brief or payload.question
                draft_memory_context = ""
                draft_memories: list[dict] = []
                if memory_enabled and context_plan.context_plan.get("read_user_memory"):
                    _, draft_memories = await _query_memories_for_agent(user.id, payload.question, payload.history)
                    draft_memory_context = _memory_context_from_records(draft_memories)
                answer = (
                    f"好，我会先为《{draft_seed or '这篇'}》整理一份大纲。"
                    "准备好后，你可以打开完整查看和调整。"
                )
                checkpoint = await _create_checkpoint(
                    user_id=user.id,
                    session_id=session_id,
                    run_id=run_id,
                    intent=intent,
                    checkpoint_type="draft_workspace",
                    payload={
                        "seed": draft_seed,
                        "rawRequest": draft_raw_request,
                        "draftRequest": context_plan.draft_request,
                        "memoryContext": draft_memory_context,
                        "runtime": draft_runtime,
                    },
                )
                trace = await _complete_tool_only_run(
                    user_id=user.id,
                    session_id=session_id,
                    run_id=run_id,
                    route_step_id=route_step_id,
                    tool_name="note_draft_tool",
                    action="open_draft_workspace",
                    answer=answer,
                    input_summary=payload.question,
                    output_summary="打开 AI 草稿工作区",
                    metadata={
                        "seed": draft_seed,
                        "rawRequest": draft_raw_request,
                        "draftRequest": context_plan.draft_request,
                        "memoryCount": len(draft_memories),
                        "runtime": draft_runtime,
                    },
                    message_metadata={
                        "draftCard": {
                            "seed": draft_seed,
                            "checkpointId": checkpoint["id"],
                        }
                    },
                )
                yield _sse_format(trace)
                yield _sse_format({"type": "checkpoint", "checkpoint": checkpoint})
                yield _sse_format(
                    _tool_action(
                        "note_draft_tool",
                        "open_draft_workspace",
                        {
                            "seed": draft_seed,
                            "rawRequest": draft_raw_request,
                            "draftRequest": context_plan.draft_request,
                            "memoryContext": draft_memory_context,
                            "checkpointId": checkpoint["id"],
                            "checkpoint": checkpoint,
                            "runtime": draft_runtime,
                        },
                        answer,
                    )
                )
                yield _sse_format(_choice_delta(answer))
                if memory_enabled:
                    await _auto_save_memory_from_question(
                        user.id,
                        payload.question,
                        payload.history,
                    )
                yield _sse_format(
                    {
                        "type": "agent_done",
                        "sessionId": session_id,
                        "runId": run_id,
                        "status": "completed",
                    }
                )
                yield "data: [DONE]\n\n"
                return

            if intent == "note_edit_create":
                edit_runtime = "langgraph"
                if not page_state or not page_state.currentNoteId:
                    answer = "请先打开一篇正式笔记，再让我生成修改预览。"
                    yield _sse_format(_choice_delta(answer))
                    await _finish_agent_run(
                        user_id=user.id,
                        session_id=session_id,
                        run_id=run_id,
                        status="completed",
                        answer=answer,
                    )
                    yield _sse_format(_agent_done_event(session_id, run_id, "completed"))
                    yield "data: [DONE]\n\n"
                    return

                answer = "我正在生成修改预览，不会直接改正式笔记。"
                checkpoint = await _create_checkpoint(
                    user_id=user.id,
                    session_id=session_id,
                    run_id=run_id,
                    intent=intent,
                    checkpoint_type="edit_preview",
                    payload={
                        "noteId": page_state.currentNoteId,
                        "instruction": payload.question,
                        "selectedText": page_state.selectedText,
                        "sectionId": page_state.currentSectionId,
                        "targetType": _infer_edit_target_type(payload.question),
                        "runtime": edit_runtime,
                    },
                )
                trace = await _complete_tool_only_run(
                    user_id=user.id,
                    session_id=session_id,
                    run_id=run_id,
                    route_step_id=route_step_id,
                    tool_name="note_edit_tool",
                    action="create_preview",
                    answer=answer,
                    input_summary=payload.question,
                    output_summary="创建 AI 修改预览",
                    metadata={"noteId": page_state.currentNoteId, "runtime": edit_runtime},
                )
                yield _sse_format(trace)
                yield _sse_format({"type": "checkpoint", "checkpoint": checkpoint})
                yield _sse_format(
                    _tool_action(
                        "note_edit_tool",
                        "create_preview",
                        {
                            "noteId": page_state.currentNoteId,
                            "instruction": payload.question,
                            "selectedText": page_state.selectedText,
                            "sectionId": page_state.currentSectionId,
                            "targetType": _infer_edit_target_type(payload.question),
                            "checkpointId": checkpoint["id"],
                            "runtime": edit_runtime,
                        },
                        answer,
                    )
                )
                yield _sse_format(_choice_delta(answer))
                if memory_enabled:
                    await _auto_save_memory_from_question(
                        user.id,
                        payload.question,
                        payload.history,
                    )
                yield _sse_format(
                    {
                        "type": "agent_done",
                        "sessionId": session_id,
                        "runId": run_id,
                        "status": "completed",
                    }
                )
                yield "data: [DONE]\n\n"
                return

            if intent == "note_search":
                started = time.perf_counter()
                context = await configured_rag_service().retrieve(
                    RagRequest(user_id=user.id, question=payload.question)
                )
                document_title = "NoteFlow 本地笔记库"
                document_content = context.context_text
                context_mode = context.context_mode
                sources = context.sources
                trace = await _record_tool_trace(
                    user_id=user.id,
                    run_id=run_id,
                    step_id=route_step_id,
                    tool_name="note_library_tool",
                    action="search_notes",
                    status="success",
                    duration_ms=int((time.perf_counter() - started) * 1000),
                    input_summary=payload.question,
                    output_summary=f"找到 {len(sources)} 个片段",
                    metadata={"contextMode": context_mode, "sourceCount": len(sources)},
                )
                yield _sse_format(trace)
                yield _sse_format(
                    {
                        "type": "context",
                        "contextMode": context_mode,
                        "sources": sources,
                    }
                )
            chat_req = ChatRequest(
                question=payload.question,
                documentTitle=document_title,
                documentContent=document_content,
                memoryContext=memory_context,
                history=[ChatMessage(role=m.role, text=m.text) for m in payload.history],
                maxTokens=payload.maxTokens,
                temperature=payload.temperature,
                strictNoteAnswer=force_note_answer,
            )

            started = time.perf_counter()
            try:
                async for chunk in stream_chat(chat_req):
                    choice = (chunk.get("choices") or [{}])[0]
                    delta = ((choice.get("delta") or {}).get("content")) or ""
                    if delta:
                        answer_parts.append(delta)
                    yield _sse_format(chunk)
            except ValueError as e:
                if "not configured" not in str(e).lower():
                    raise
                fallback = (
                    _note_sources_fallback(sources)
                    if force_note_answer
                    else "AI 服务暂未配置 DeepSeek API Key，但本次 Agent 运行记录、上下文和工具轨迹已经生成。"
                )
                answer_parts.append(fallback)
                yield _sse_format(_choice_delta(fallback))

            answer = "".join(answer_parts).strip()
            trace = await _record_tool_trace(
                user_id=user.id,
                run_id=run_id,
                step_id=route_step_id,
                tool_name="ai_chat",
                action="stream_answer",
                status="success",
                duration_ms=int((time.perf_counter() - started) * 1000),
                input_summary=payload.question,
                output_summary=f"生成 {len(answer)} 个字符",
                metadata={"intent": intent},
            )
            yield _sse_format(trace)
            await _finish_agent_run(
                user_id=user.id,
                session_id=session_id,
                run_id=run_id,
                status="completed",
                answer=answer,
                context_mode=context_mode,
                sources=sources,
            )
            yield _sse_format(
                {
                    "type": "agent_done",
                    "sessionId": session_id,
                    "runId": run_id,
                    "status": "completed",
                }
            )
        except Exception as e:
            logger.exception("Agent chat failed for run %s (intent=%s)", run_id, intent)
            error_text = _public_error_message(e)
            trace = await _record_tool_trace(
                user_id=user.id,
                run_id=run_id,
                step_id=route_step_id,
                tool_name="agent_runtime",
                action="chat",
                status="failed",
                duration_ms=0,
                input_summary=payload.question,
                output_summary=error_text,
                metadata={"intent": intent},
            )
            yield _sse_format(trace)
            await _finish_agent_run(
                user_id=user.id,
                session_id=session_id,
                run_id=run_id,
                status="failed",
                answer=error_text,
                context_mode=context_mode,
                sources=sources,
                error_message=error_text,
            )
            yield _sse_format(_agent_error_event(session_id, run_id, error_text))
            yield _sse_format(_choice_delta(error_text))
            yield _sse_format(_agent_done_event(session_id, run_id, "failed"))

        yield "data: [DONE]\n\n"

    async def _stream():
        with trace_scope(
            trace_id=run_state.get("trace_id") or "",
            session_id=session_id,
            run_id=run_id,
            node="agent_stream",
        ):
            async for frame in _stream_impl():
                yield frame

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream; charset=utf-8",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )
