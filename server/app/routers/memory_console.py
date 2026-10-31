from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.deps import CurrentUser
from app.deps import redis_rate_limit
from app.config import cfg
from app.memory.control import DEFAULT_MISSION, control, lock_owner, save_control, uses_hindsight
from app.memory.engine import configured_engine
from app.memory.gateway import MemoryGateway, public_record
from app.models.db import MemorySource, IntegrationOutbox, UserMemory

router = APIRouter(prefix="/memory-console", tags=["memory-console"])
console_user = redis_rate_limit("memory-console", cfg.MEMORY_RATE_LIMIT)


class RuleInput(BaseModel):
    mission: str = Field(min_length=1, max_length=4000)
    expectedVersion: int


class PreviewInput(BaseModel):
    mission: str = Field(min_length=1, max_length=4000)
    text: str = Field(min_length=1, max_length=4000)


async def require_engine(user_id):
    if not await uses_hindsight(user_id):
        raise HTTPException(409, "请先启用自建记忆库。旧记忆仍保留。")


@router.get("")
async def overview(user: CurrentUser = Depends(console_user)):
    async with AsyncSessionLocal() as session:
        settings, state = await control(session, user.id)
        jobs = (await session.scalars(select(IntegrationOutbox).where(
            IntegrationOutbox.user_id == user.id,
            IntegrationOutbox.topic.in_(["memory.retain.requested", "memory.source.delete"])
        ).order_by(IntegrationOutbox.created_at.desc()).limit(30))).all()
        sources = {s.id: s.status for s in (await session.scalars(select(MemorySource).where(
            MemorySource.user_id == user.id, MemorySource.id.in_([j.aggregate_id for j in jobs])))).all()}
        await session.commit()
        return {"engine": state.get("engine", cfg.MEMORY_ENGINE), "mission": state.get("mission", DEFAULT_MISSION),
            "ruleVersion": state.get("ruleVersion", 1), "history": state.get("ruleHistory", []),
            "reviewNewFacts": state.get("reviewNewFacts", False),
            "jobs": [{"id": j.id, "sourceId": j.aggregate_id, "status": j.status,
                      "attempts": j.attempts, "sourceStatus": sources.get(j.aggregate_id), "error": j.error_code} for j in jobs]}


@router.post("/retry/{job_id}")
async def retry(job_id: str, user: CurrentUser = Depends(console_user)):
    async with AsyncSessionLocal() as session:
        # Worker owns the outbox row before taking the owner lock; keep the same order.
        item = await session.scalar(select(IntegrationOutbox).where(IntegrationOutbox.id == job_id,
            IntegrationOutbox.user_id == user.id).with_for_update())
        if item is None or item.topic not in {"memory.retain.requested", "memory.source.delete"}:
            raise HTTPException(404, "处理记录不存在。")
        await lock_owner(session, user.id)
        settings, state = await control(session, user.id)
        source = await session.get(MemorySource, item.aggregate_id)
        if item.status != "dead" or source is None or source.user_id != user.id:
            raise HTTPException(409, "该任务无需重试。")
        if item.topic == "memory.retain.requested" and (not settings.memory_enabled or source.status != "queued"
            or source.generation != state.get("generation", 0) or source.rule_version != state.get("ruleVersion", 1)):
            raise HTTPException(409, "开关或规则已变化，旧任务不会重新写入。")
        from datetime import datetime
        item.status, item.attempts, item.available_at = "pending", 0, datetime.utcnow()
        item.error_code = item.last_error = None
        await session.commit()
    from app.workers.outbox_worker import notify_outbox_worker
    notify_outbox_worker()
    return {"status": "pending"}


@router.post("/activate")
async def activate(user: CurrentUser = Depends(console_user)):
    async with AsyncSessionLocal() as session:
        await lock_owner(session, user.id)
        settings, state = await control(session, user.id)
        await configured_engine().ensure_bank(user.id, state.get("mission", DEFAULT_MISSION))
        save_control(settings, {**state, "engine": "hindsight", "generation": state.get("generation", 0) + 1})
        await session.commit()
    return {"engine": "hindsight"}


@router.put("/rules")
async def rules(payload: RuleInput, user: CurrentUser = Depends(console_user)):
    await require_engine(user.id)
    async with AsyncSessionLocal() as session:
        await lock_owner(session, user.id)
        settings, state = await control(session, user.id)
        version = state.get("ruleVersion", 1)
        if version != payload.expectedVersion:
            raise HTTPException(409, "规则已更新，请刷新后重试。")
        await configured_engine().configure(user.id, payload.mission.strip())
        history = ([{"version": version, "mission": state.get("mission", DEFAULT_MISSION)}] + state.get("ruleHistory", []))[:10]
        save_control(settings, {**state, "mission": payload.mission.strip(), "ruleVersion": version + 1, "ruleHistory": history})
        await session.commit()
    return {"version": version + 1}


@router.post("/preview")
async def preview(payload: PreviewInput, user: CurrentUser = Depends(console_user)):
    try:
        return await MemoryGateway().preview(user.id, mission=payload.mission, text=payload.text)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/graph")
async def graph(user: CurrentUser = Depends(console_user)):
    await require_engine(user.id)
    return await MemoryGateway().graph(user.id)


@router.get("/impact/{memory_id}")
async def impact(memory_id: str, user: CurrentUser = Depends(console_user)):
    await require_engine(user.id)
    try:
        return await MemoryGateway().delete_impact(user.id, memory_id)
    except LookupError as exc:
        raise HTTPException(404, "记忆不存在。") from exc


@router.get("/source/{source_id}")
async def source(source_id: str, user: CurrentUser = Depends(console_user)):
    async with AsyncSessionLocal() as session:
        source = await session.scalar(select(MemorySource).where(MemorySource.id == source_id, MemorySource.user_id == user.id))
        if source is None:
            raise HTTPException(404, "来源不存在。")
        document = await configured_engine().document(user.id, source.id)
        return {"id": source.id, "status": source.status, "ruleVersion": source.rule_version,
                "createdAt": source.created_at.isoformat(), "document": document}


@router.get("/legacy")
async def legacy(user: CurrentUser = Depends(console_user)):
    from app.memory.policy import memory_is_eligible
    from app.routers.memories import _memory_out
    async with AsyncSessionLocal() as session:
        rows = (await session.scalars(select(UserMemory).where(UserMemory.user_id == user.id,
            UserMemory.status != "deleted").order_by(UserMemory.created_at))).all()
        return {"memories": [{**_memory_out(r), "suggested": memory_is_eligible(r) and r.source != "work_memory"} for r in rows]}


class MigrationInput(BaseModel):
    ids: list[str] = Field(max_length=100)


@router.post("/import")
async def import_legacy(payload: MigrationInput, user: CurrentUser = Depends(console_user)):
    await require_engine(user.id)
    async with AsyncSessionLocal() as session:
        rows = (await session.scalars(select(UserMemory).where(UserMemory.user_id == user.id,
            UserMemory.id.in_(payload.ids), UserMemory.status == "active", UserMemory.deleted_at.is_(None)))).all()
    gateway = MemoryGateway()
    sources = []
    for r in rows:
        source = await gateway.submit(user.id, r.content, source_key="migration:" + r.id,
            metadata={"source": "legacy_import", "memoryType": r.memory_type, "scope": r.scope,
                      "canonicalKey": r.canonical_key, "legacyId": r.id})
        if source:
            sources.append(source)
    return {"submitted": len(sources), "sourceIds": sources}
