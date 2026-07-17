from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import desc, select

from app.database import AsyncSessionLocal
from app.models.db import AgentCheckpoint, AgentRun, AgentToolTrace


def _short(text: str, limit: int = 180) -> str:
    normalized = " ".join((text or "").split())
    return normalized if len(normalized) <= limit else normalized[:limit].rstrip() + "..."


def checkpoint_out(checkpoint: AgentCheckpoint) -> dict:
    payload = checkpoint.payload or {}
    return {
        "id": checkpoint.id,
        "runId": checkpoint.run_id,
        "sessionId": checkpoint.session_id,
        "intent": checkpoint.intent,
        "status": checkpoint.status,
        "checkpointType": checkpoint.checkpoint_type,
        "payload": payload,
        "workingMemory": payload.get("workingMemory"),
        "createdAt": checkpoint.created_at.isoformat() if checkpoint.created_at else None,
        "updatedAt": checkpoint.updated_at.isoformat() if checkpoint.updated_at else None,
        "resolvedAt": checkpoint.resolved_at.isoformat() if checkpoint.resolved_at else None,
    }


def _tool_trace_out(trace: AgentToolTrace) -> dict:
    return {
        "id": trace.id,
        "runId": trace.run_id,
        "toolName": trace.tool_name,
        "action": trace.action,
        "status": trace.status,
        "durationMs": trace.duration_ms,
        "inputSummary": trace.input_summary or "",
        "outputSummary": trace.output_summary or "",
        "metadata": trace.metadata_json or {},
        "createdAt": trace.created_at.isoformat() if trace.created_at else None,
    }


def _run_out(run: AgentRun, traces: list[AgentToolTrace], checkpoint: Optional[dict]) -> dict:
    status = "waiting_user_confirm" if checkpoint and checkpoint.get("status") == "waiting_user_confirm" else run.status
    return {
        "id": run.id,
        "sessionId": run.session_id,
        "intent": run.intent,
        "status": status,
        "rawStatus": run.status,
        "inputText": run.input_text,
        "outputText": run.output_text,
        "errorMessage": run.error_message,
        "startedAt": run.started_at.isoformat() if run.started_at else None,
        "finishedAt": run.finished_at.isoformat() if run.finished_at else None,
        "toolTraces": [_tool_trace_out(trace) for trace in traces],
    }


def working_memory_payload(checkpoint_type: str, payload: dict) -> dict:
    now = datetime.utcnow().isoformat()
    existing = payload.get("workingMemory") if isinstance(payload.get("workingMemory"), dict) else {}
    if checkpoint_type == "draft_workspace":
        title = payload.get("title") or payload.get("seed") or "AI 笔记草稿"
        base = {
            "layer": "working", "taskType": "note_draft", "title": f"生成笔记草稿：{_short(str(title), 80)}",
            "status": "active", "currentStep": "draft_workspace_opened", "completedSteps": [],
            "pendingSteps": ["生成大纲", "分节生成正文", "确认并保存"], "relatedDraftId": payload.get("draftId"),
            "relatedNoteId": None, "createdAt": now, "updatedAt": now,
        }
    elif checkpoint_type == "edit_preview":
        title = payload.get("instruction") or "AI 修改预览"
        base = {
            "layer": "working", "taskType": "note_edit", "title": f"修改正式笔记：{_short(str(title), 80)}",
            "status": "active", "currentStep": "waiting_preview_confirmation", "completedSteps": ["创建修改预览"],
            "pendingSteps": ["继续调整", "应用预览", "取消预览"], "relatedDraftId": None,
            "relatedNoteId": payload.get("noteId"), "createdAt": now, "updatedAt": now,
        }
    else:
        base = {
            "layer": "working", "taskType": checkpoint_type or "agent_task",
            "title": _short(str(payload.get("title") or payload.get("seed") or "进行中的任务"), 100),
            "status": "active", "currentStep": "waiting_user_action", "completedSteps": [], "pendingSteps": [],
            "relatedDraftId": payload.get("draftId"), "relatedNoteId": payload.get("noteId"),
            "createdAt": now, "updatedAt": now,
        }
    base.update({key: value for key, value in existing.items() if value not in (None, "", [])})
    base["updatedAt"] = now
    return base


def patch_working_memory_status(payload: dict, status: str, extra: Optional[dict] = None) -> dict:
    patched = dict(payload or {})
    working = dict(working_memory_payload("", patched) if "workingMemory" not in patched else patched.get("workingMemory") or {})
    now = datetime.utcnow().isoformat()
    mapped = {"resolved": "completed", "cancelled": "cancelled", "failed": "failed", "waiting_user_confirm": "active"}.get(status, status)
    working["status"] = mapped
    working["updatedAt"] = now
    if mapped == "completed":
        working["completedAt"] = now
        if working.get("currentStep"):
            completed = list(working.get("completedSteps") or [])
            if working["currentStep"] not in completed:
                completed.append(working["currentStep"])
            working["completedSteps"] = completed
        working["pendingSteps"] = []
    elif mapped == "cancelled":
        working["cancelledAt"] = now
    elif mapped == "failed":
        working["failedAt"] = now
    if extra:
        working.update(extra)
    patched["workingMemory"] = working
    return patched


async def create_checkpoint(*, user_id: str, session_id: str, run_id: str, intent: str, checkpoint_type: str, payload: dict) -> dict:
    payload = dict(payload or {})
    payload["workingMemory"] = working_memory_payload(checkpoint_type, payload)
    checkpoint = AgentCheckpoint(
        id=uuid.uuid4().hex, run_id=run_id, session_id=session_id, user_id=user_id, intent=intent,
        status="waiting_user_confirm", checkpoint_type=checkpoint_type, payload=payload,
    )
    async with AsyncSessionLocal() as db:
        db.add(checkpoint)
        await db.commit()
        await db.refresh(checkpoint)
        return checkpoint_out(checkpoint)


async def latest_waiting_checkpoint(user_id: str, session_id: Optional[str] = None) -> Optional[dict]:
    async with AsyncSessionLocal() as db:
        conditions = [AgentCheckpoint.user_id == user_id, AgentCheckpoint.status == "waiting_user_confirm"]
        if session_id:
            conditions.append(AgentCheckpoint.session_id == session_id)
        result = await db.execute(
            select(AgentCheckpoint).where(*conditions)
            .order_by(desc(AgentCheckpoint.updated_at), desc(AgentCheckpoint.created_at)).limit(1)
        )
        checkpoint = result.scalar_one_or_none()
        return checkpoint_out(checkpoint) if checkpoint else None


async def agent_task_snapshot(user_id: str, session_id: Optional[str] = None, run_id: Optional[str] = None) -> dict:
    checkpoint = None if run_id else await latest_waiting_checkpoint(user_id, session_id)
    async with AsyncSessionLocal() as db:
        run: Optional[AgentRun] = None
        if run_id:
            run = await db.get(AgentRun, run_id)
            if run is None or run.user_id != user_id:
                run = None
        elif checkpoint:
            run = await db.get(AgentRun, checkpoint["runId"])
            if run is None or run.user_id != user_id:
                run = None
        else:
            conditions = [AgentRun.user_id == user_id]
            if session_id:
                conditions.append(AgentRun.session_id == session_id)
            result = await db.execute(select(AgentRun).where(*conditions).order_by(desc(AgentRun.started_at)).limit(1))
            run = result.scalar_one_or_none()
        if run is None:
            return {"task": None}
        if checkpoint is None:
            result = await db.execute(
                select(AgentCheckpoint).where(
                    AgentCheckpoint.user_id == user_id, AgentCheckpoint.run_id == run.id,
                    AgentCheckpoint.status == "waiting_user_confirm",
                ).order_by(desc(AgentCheckpoint.updated_at), desc(AgentCheckpoint.created_at)).limit(1)
            )
            value = result.scalar_one_or_none()
            checkpoint = checkpoint_out(value) if value else None
        traces_result = await db.execute(
            select(AgentToolTrace).where(AgentToolTrace.user_id == user_id, AgentToolTrace.run_id == run.id)
            .order_by(AgentToolTrace.created_at)
        )
        traces = list(traces_result.scalars().all())
        return {"task": {"run": _run_out(run, traces, checkpoint), "checkpoint": checkpoint}}


async def agent_run_history(user_id: str, session_id: Optional[str] = None, limit: int = 8) -> dict:
    safe_limit = min(max(limit, 1), 20)
    async with AsyncSessionLocal() as db:
        conditions = [AgentRun.user_id == user_id]
        if session_id:
            conditions.append(AgentRun.session_id == session_id)
        result = await db.execute(select(AgentRun).where(*conditions).order_by(desc(AgentRun.started_at)).limit(safe_limit))
        runs = list(result.scalars().all())
        if not runs:
            return {"tasks": []}
        run_ids = [run.id for run in runs]
        traces_result = await db.execute(
            select(AgentToolTrace).where(AgentToolTrace.user_id == user_id, AgentToolTrace.run_id.in_(run_ids))
            .order_by(AgentToolTrace.created_at)
        )
        traces_by_run: dict[str, list[AgentToolTrace]] = {run_id: [] for run_id in run_ids}
        for trace in traces_result.scalars().all():
            traces_by_run.setdefault(trace.run_id, []).append(trace)
        checkpoints_result = await db.execute(
            select(AgentCheckpoint).where(AgentCheckpoint.user_id == user_id, AgentCheckpoint.run_id.in_(run_ids))
            .order_by(desc(AgentCheckpoint.updated_at), desc(AgentCheckpoint.created_at))
        )
        checkpoints_by_run: dict[str, dict] = {}
        for checkpoint in checkpoints_result.scalars().all():
            if checkpoint.run_id not in checkpoints_by_run:
                checkpoints_by_run[checkpoint.run_id] = checkpoint_out(checkpoint)
        return {"tasks": [
            {"run": _run_out(run, traces_by_run.get(run.id, []), checkpoints_by_run.get(run.id)), "checkpoint": checkpoints_by_run.get(run.id)}
            for run in runs
        ]}
