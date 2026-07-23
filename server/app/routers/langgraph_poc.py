from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.agent.langgraph_readonly import (
    new_readonly_state,
    postgres_checkpointer,
    stream_readonly_graph,
)
from app.agent.shadow import shadow_summary
from app.agent.sse import SSEStreamAdapter
from app.config import cfg
from app.deps import CurrentUser, get_current_user, redis_rate_limit
from app.observability.context import current_trace, trace_scope
from app.schemas.agent import AgentChatPayload

router = APIRouter(prefix="/agent", tags=["agent-poc"])


@router.post("/langgraph-poc/chat")
async def langgraph_poc_chat(
    payload: AgentChatPayload,
    user: CurrentUser = Depends(redis_rate_limit("langgraph-poc", max(1, cfg.AI_RATE_LIMIT // 3))),
):
    if not cfg.LANGGRAPH_POC_ENABLED:
        raise HTTPException(status_code=404, detail="LangGraph PoC route is disabled")
    if payload.mode not in {"chat", "ask_notes"}:
        raise HTTPException(status_code=400, detail="LangGraph PoC only supports chat and ask_notes")
    trace = current_trace()
    state = new_readonly_state(
        user_id=user.id, question=payload.question, mode=payload.mode,
        history=[item.model_dump() for item in payload.history],
        page_state=payload.pageState.model_dump() if payload.pageState else {},
        memory_enabled=payload.memoryEnabled, session_id=payload.sessionId,
        trace_id=trace.trace_id, thread_id=payload.sessionId,
    )

    async def stream():
        adapter = SSEStreamAdapter()
        with trace_scope(
            trace_id=trace.trace_id, request_id=trace.request_id,
            session_id=state["session_id"], run_id=state["run_id"], node="langgraph_poc",
        ):
            try:
                async with postgres_checkpointer() as saver:
                    async for event in stream_readonly_graph(state, checkpointer=saver):
                        yield adapter.event(event)
            finally:
                terminal = adapter.done()
                if terminal:
                    yield terminal

    return StreamingResponse(
        stream(), media_type="text/event-stream; charset=utf-8",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@router.get("/langgraph-shadow/summary")
async def langgraph_shadow_summary(user: CurrentUser = Depends(get_current_user)):
    return await shadow_summary(user.id)
