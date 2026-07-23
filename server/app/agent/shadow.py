from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from datetime import datetime
from typing import Any

from sqlalchemy import func, select

from app.agent.langgraph_readonly import invoke_readonly_graph, new_readonly_state
from app.config import cfg
from app.database import AsyncSessionLocal
from app.models.db import AgentShadowRun
from app.observability.context import current_trace, structured_log, trace_scope
from app.services.observability import record_metric
from app.utils import random_id

logger = logging.getLogger(__name__)
_semaphore = asyncio.Semaphore(cfg.LANGGRAPH_SHADOW_MAX_CONCURRENCY)
_tasks: set[asyncio.Task] = set()
READONLY_LEGACY_INTENTS = {"general_chat", "note_search", "note_context_qa"}


def shadow_selected(*, user_id: str, request_id: str) -> bool:
    if not cfg.LANGGRAPH_SHADOW_ENABLED:
        return False
    if cfg.LANGGRAPH_SHADOW_USER_IDS:
        return user_id in cfg.LANGGRAPH_SHADOW_USER_IDS
    percentage = cfg.LANGGRAPH_SHADOW_SAMPLE_PERCENT
    if percentage <= 0:
        return False
    bucket = int(hashlib.sha256(f"{user_id}:{request_id}".encode()).hexdigest()[:8], 16) % 100
    return bucket < percentage


def readonly_legacy_route(mode: str, intent: str) -> str:
    if mode == "ask_notes" or intent in {"note_search", "note_context_qa"}:
        return "note_qa"
    return "general_chat"


def compare_shadow(
    *, mode: str, legacy_intent: str, graph_intent: str,
    legacy_requires_sources: bool, graph_requires_sources: bool,
) -> tuple[dict[str, Any], bool]:
    legacy_route = readonly_legacy_route(mode, legacy_intent)
    graph_route = "note_qa" if graph_intent == "note_qa" else "general_chat"
    differences = {
        "intent": legacy_intent != graph_intent,
        "route": legacy_route != graph_route,
        "requiresSources": legacy_requires_sources != graph_requires_sources,
    }
    hard_violation = (
        (mode == "chat" and graph_route != "general_chat")
        or (mode == "ask_notes" and (graph_route != "note_qa" or not graph_requires_sources))
    )
    return {**differences, "legacyRoute": legacy_route, "graphRoute": graph_route}, hard_violation


async def run_shadow_once(
    *, user_id: str, question: str, mode: str, history: list[dict[str, str]],
    page_state: dict[str, Any], legacy_intent: str, legacy_requires_sources: bool,
    request_id: str, trace_id: str,
) -> None:
    started = time.perf_counter()
    input_hash = hashlib.sha256(question.strip().encode()).hexdigest()
    row = AgentShadowRun(
        id=random_id(), user_id=user_id, request_id=request_id or None, trace_id=trace_id or None,
        input_hash=input_hash, mode=mode, legacy_intent=legacy_intent,
        legacy_route=readonly_legacy_route(mode, legacy_intent),
        legacy_requires_sources=legacy_requires_sources, status="running",
    )
    try:
        state = new_readonly_state(
            user_id=user_id, question=question, mode=mode, history=history,
            page_state=page_state, memory_enabled=False, trace_id=trace_id,
            thread_id=f"shadow:{request_id or random_id()}", plan_only=True,
        )
        graph_state = await asyncio.wait_for(
            invoke_readonly_graph(state), timeout=cfg.LANGGRAPH_SHADOW_TIMEOUT_MS / 1000,
        )
        graph_intent = str(graph_state.get("intent") or "")
        graph_requires_sources = bool(graph_state.get("requires_sources"))
        differences, hard_violation = compare_shadow(
            mode=mode, legacy_intent=legacy_intent, graph_intent=graph_intent,
            legacy_requires_sources=legacy_requires_sources,
            graph_requires_sources=graph_requires_sources,
        )
        row.graph_intent = graph_intent
        row.graph_route = str(differences["graphRoute"])
        row.graph_requires_sources = graph_requires_sources
        row.differences = differences
        row.hard_violation = hard_violation
        row.status = "mismatch" if any(differences[key] for key in ("route", "requiresSources")) else "matched"
        row.graph_summary = {
            "status": graph_state.get("status"), "ragCalled": bool(graph_state.get("rag_called")),
            "readOnly": True, "planOnly": True,
        }
    except asyncio.TimeoutError:
        row.status = "timeout"
        row.error_code = "SHADOW_TIMEOUT"
        row.error_message = "LangGraph shadow exceeded its isolated timeout"
    except Exception as exc:
        row.status = "failed"
        row.error_code = type(exc).__name__[:80]
        row.error_message = str(exc)[:500]
    row.duration_ms = int((time.perf_counter() - started) * 1000)
    async with AsyncSessionLocal() as session:
        session.add(row)
        await session.commit()
    metric_status = "failed" if row.status in {"failed", "timeout"} else "success"
    record_metric("agent", "langgraph_shadow", status=metric_status, duration_ms=row.duration_ms)
    if row.hard_violation:
        structured_log(
            logger, logging.ERROR, "langgraph_shadow_hard_violation",
            shadow_id=row.id, mode=mode, differences=row.differences,
        )


async def _bounded_shadow(**kwargs) -> None:
    if _semaphore.locked():
        record_metric("agent", "langgraph_shadow_dropped", status="failed")
        return
    async with _semaphore:
        trace_id = str(kwargs.get("trace_id") or "")
        request_id = str(kwargs.get("request_id") or "")
        with trace_scope(trace_id=trace_id, request_id=request_id, node="langgraph_shadow"):
            try:
                await run_shadow_once(**kwargs)
            except Exception as exc:
                # Shadow telemetry must never be able to fail the user response.
                record_metric("agent", "langgraph_shadow_runner", status="failed")
                structured_log(logger, logging.WARNING, "langgraph_shadow_runner_failed", error=str(exc))


def schedule_langgraph_shadow(
    *, user_id: str, question: str, mode: str, history: list[dict[str, str]],
    page_state: dict[str, Any], legacy_intent: str, legacy_requires_sources: bool,
) -> bool:
    if legacy_intent not in READONLY_LEGACY_INTENTS:
        return False
    trace = current_trace()
    request_id = trace.request_id or random_id()
    if not shadow_selected(user_id=user_id, request_id=request_id):
        return False
    task = asyncio.create_task(_bounded_shadow(
        user_id=user_id, question=question, mode=mode, history=history,
        page_state=page_state, legacy_intent=legacy_intent,
        legacy_requires_sources=legacy_requires_sources,
        request_id=request_id, trace_id=trace.trace_id,
    ), name=f"langgraph-shadow-{request_id}")
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return True


async def shadow_summary(user_id: str) -> dict[str, Any]:
    async with AsyncSessionLocal() as session:
        rows = await session.execute(
            select(
                func.count(AgentShadowRun.id),
                func.count(AgentShadowRun.id).filter(AgentShadowRun.status == "matched"),
                func.count(AgentShadowRun.id).filter(AgentShadowRun.status == "mismatch"),
                func.count(AgentShadowRun.id).filter(AgentShadowRun.hard_violation.is_(True)),
                func.count(AgentShadowRun.id).filter(AgentShadowRun.status.in_(["failed", "timeout"])),
                func.avg(AgentShadowRun.duration_ms),
            ).where(AgentShadowRun.user_id == user_id)
        )
        total, matched, mismatched, violations, failures, average = rows.one()
    comparable = int(matched or 0) + int(mismatched or 0)
    return {
        "total": int(total or 0), "matched": int(matched or 0),
        "mismatched": int(mismatched or 0), "hardViolations": int(violations or 0),
        "failures": int(failures or 0), "routeAgreement": round(int(matched or 0) / comparable, 4) if comparable else None,
        "averageDurationMs": round(float(average or 0), 2),
    }
