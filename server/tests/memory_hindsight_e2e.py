"""Explicit real-service acceptance: synthetic users, bounded model calls, cleanup.

Run: node scripts/run-python.mjs server/tests/memory_hindsight_e2e.py
Not part of unittest discovery: requires PostgreSQL + pinned Hindsight.
"""
import asyncio
import json
import uuid
from unittest.mock import patch

import httpx
from sqlalchemy import delete, select

from app.database import AsyncSessionLocal, engine as db_engine
from app.deps import CurrentUser, get_current_user
from app.main import app
from app.memory.gateway import MemoryGateway
from app.memory.engine import MemoryUnavailable
from app.models.db import User, UserSettings, IntegrationOutbox, MemorySource
from app.repositories.outbox import OutboxRepository
from app.services.outbox import dispatch_outbox


async def main():
    prefix = "memory-e2e-" + uuid.uuid4().hex[:12]
    owners = [prefix + "-a", prefix + "-b"]
    active = owners[0]
    cases = []
    gateway = MemoryGateway()
    original_enqueue = OutboxRepository.enqueue

    async def isolated_enqueue(self, **kwargs):
        # Other developer workers must not consume synthetic jobs. Dispatch is
        # exercised explicitly below with the same production implementation.
        kwargs["max_attempts"] = 0
        return await original_enqueue(self, **kwargs)

    async def auth():
        return CurrentUser(id=active, email="synthetic@example.invalid", display_name="Synthetic")

    async def process(source_id):
        async with AsyncSessionLocal() as session:
            item = await session.scalar(select(IntegrationOutbox).where(
                IntegrationOutbox.aggregate_id == source_id, IntegrationOutbox.topic == "memory.retain.requested").with_for_update())
            await dispatch_outbox(session, item)
            await OutboxRepository(session).succeed(item)
            await session.commit()

    async def call(client, method, path, expected=200, **kwargs):
        response = await client.request(method, "/api" + path, **kwargs)
        assert response.status_code == expected, (path, response.status_code, response.text[:300])
        return response.json()

    try:
        async with AsyncSessionLocal() as session:
            session.add_all([User(id=u, email=u + "@example.invalid", display_name="Synthetic") for u in owners])
            await session.commit()
            session.add(UserSettings(user_id=owners[1], memory_enabled=False,
                preferences={"memoryControl": {"engine": "mem0", "generation": 7}}))
            await session.commit()
        app.dependency_overrides[get_current_user] = auth
        with patch.object(OutboxRepository, "enqueue", isolated_enqueue):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                assert (await call(client, "GET", "/memory-console"))['engine'] == 'hindsight'
                cases.append('new account uses memory automatically without activation')
                key = prefix + "-message"
                sid = await gateway.submit(active, "我刚开始学习 Go，喜欢通俗的中文和简短例子。", source_key=key)
                async with AsyncSessionLocal() as session:
                    queued = await session.scalar(select(IntegrationOutbox).where(IntegrationOutbox.aggregate_id == sid))
                    assert queued.status == 'memory_pending'
                    legacy_visible = await session.scalar(select(IntegrationOutbox.id).where(
                        IntegrationOutbox.aggregate_id == sid, IntegrationOutbox.status.in_(['pending','processing'])))
                    assert legacy_visible is None
                cases.append('legacy worker cannot claim new memory jobs')
                assert sid == await gateway.submit(active, "我刚开始学习 Go，喜欢通俗的中文和简短例子。", source_key=key)
                await process(sid)
                records = await gateway.read(active, query="用户希望怎样解释 Go？")
                assert records and any("Go" in r.content or "中文" in r.content for r in records)
                cases += ["Chinese retain/recall", "idempotent submission"]
                memory_id = records[0].id
                listing = await call(client, "GET", "/memories")
                assert listing["memories"] and listing["memories"][0]["provider"] == "hindsight"
                source = await call(client, "GET", "/memory-console/source/" + sid)
                assert "Go" in source["document"]["original_text"]
                cases += ["settings use engine facts", "source provenance"]
                active = owners[1]
                assert (await call(client, "GET", "/memory-console"))['engine'] == 'hindsight'
                assert (await call(client, 'GET', '/settings'))['settings']['memoryEnabled'] is False
                assert await gateway.submit(active, '我喜欢简短例子。') is None
                cases.append('existing legacy account routes automatically and preserves disabled switch')
                await call(client, 'PUT', '/memory-console/rules', json={
                    'mission':'只记录用户长期学习偏好，忽略临时指令和引用。', 'expectedVersion':1})
                cases.append('first rule save prepares bank without activation')
                await call(client, 'PUT', '/settings', json={'memoryEnabled':True})
                assert not (await call(client, "GET", "/memories"))["memories"]
                await call(client, "PUT", "/memories/" + memory_id, expected=404, json={"content": "用户喜欢图示。"})
                await call(client, "GET", "/memory-console/source/" + sid, expected=404)
                cases += ["cross-account list isolation", "cross-account ID/source isolation"]
                temporary = await gateway.submit(active, '把这句话改一下。', source_key=prefix + '-temporary')
                await process(temporary)
                async with AsyncSessionLocal() as session:
                    assert (await session.get(MemorySource, temporary)).status == 'empty'
                from app.memory.control import DEFAULT_MISSION
                previewed = await call(client, 'POST', '/memory-console/preview', json={
                    'mission':DEFAULT_MISSION, 'text':'下面是一本小说的引用：“我在北京工作。”请解释这句话。'})
                assert not previewed['facts']
                assert not await gateway.read(active)
                cases += ['temporary instruction is not memory', 'quoted text preview stays out of personal facts']
                active = owners[0]
                await call(client, "PUT", "/memories/" + memory_id, json={"content": "用户希望讲解先给结论，再给简短例子。"})
                listed = (await call(client, "GET", "/memories"))["memories"]
                assert next(r for r in listed if r["id"] == memory_id)["content"].startswith("用户希望讲解先给结论")
                await call(client, "PUT", "/memories/" + memory_id, json={"status": "archived"})
                assert memory_id not in {r.id for r in await gateway.read(active, query="用户的讲解偏好")}
                archived = (await call(client, "GET", "/memories"))["memories"]
                assert next(r for r in archived if r["id"] == memory_id)["status"] == "archived"
                import sys
                from pathlib import Path
                sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
                from hindsight_db import hindsight_db
                snapshot = await asyncio.to_thread(hindsight_db, 'backup')
                restore_target = 'noteflow_drill_memory_' + uuid.uuid4().hex[:8]
                try:
                    await asyncio.to_thread(hindsight_db, 'restore', target=restore_target, payload=snapshot)
                    restored = (await asyncio.to_thread(hindsight_db, 'inspect', target=restore_target)).decode().strip().splitlines()
                    assert int(restored[0]) >= 1 and int(restored[2]) >= 1 and int(restored[3]) >= 1
                    cases.append('backup preserves curated and invalidated facts')
                finally:
                    await asyncio.to_thread(hindsight_db, 'drop', target=restore_target)
                await call(client, "PUT", "/memories/" + memory_id, json={"status": "active"})
                cases += ["curation is visible", "disable/restore fact"]
                graph = await call(client, "GET", "/memory-console/graph")
                assert graph["nodes"]
                cases.append("scoped graph")
                state = await call(client, "GET", "/memory-console")
                mission = state["mission"] + "优先保留用户的学习偏好。"
                await call(client, "PUT", "/memory-console/rules", json={"mission": mission, "expectedVersion": state["ruleVersion"]})
                await call(client, "PUT", "/memory-console/rules", expected=409, json={"mission": mission, "expectedVersion": state["ruleVersion"]})
                state2 = await call(client, "GET", "/memory-console")
                assert state2["history"][0]["mission"] == state["mission"]
                cases += ["rule version/history", "stale rule update rejected"]
                impact = await call(client, "GET", "/memory-console/impact/" + memory_id)
                assert impact["sourceId"] == sid and impact["memories"]
                await call(client, "DELETE", "/memories/" + memory_id, expected=409)
                await call(client, "DELETE", "/memories/" + memory_id + "?confirmedSource=true")
                assert not await gateway.read(active)
                assert await gateway.submit(active, "我喜欢通俗的中文。", source_key=key) is None
                await process(sid)
                assert not await gateway.read(active)
                cases += ["delete impact confirmation", "deleted source cannot replay"]
                sid2 = await gateway.submit(active, "我喜欢用图示理解概念。", source_key=prefix + "-queued")
                await call(client, "PUT", "/settings", json={"memoryEnabled": False})
                assert await gateway.submit(active, "我喜欢短答案。") is None
                await call(client, "PUT", "/settings", json={"memoryEnabled": True})
                await process(sid2)
                async with AsyncSessionLocal() as session:
                    assert (await session.get(MemorySource, sid2)).status == "skipped"
                assert not await gateway.read(active)
                cases += ["closed writes blocked", "queued work not replayed after reopen"]
                pending_source = await gateway.submit(active, "我正在学习数据库，喜欢用图示理解索引。", source_key=prefix + '-after-curation')
                await process(pending_source)
                pending = [r for r in await gateway.read(active) if r.source_ref == pending_source]
                assert pending and all(r.status == 'pending' for r in pending)
                assert not {r.id for r in pending}.intersection({r.id for r in await gateway.read(active, query='用户数据库学习偏好')})
                await call(client, 'PUT', '/memories/' + pending[0].id, json={'status':'active'})
                approved = [r for r in await gateway.read(active) if r.id == pending[0].id]
                assert approved[0].status == 'active'
                cases.append('manual correction protects future facts until confirmation')
                print(json.dumps({"ok": True, "cases": cases, "count": len(cases), "realHindsight": True, "realPostgres": True}, ensure_ascii=False))
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        for owner in owners:
            await gateway.engine.delete_bank(owner)
        async with AsyncSessionLocal() as session:
            await session.execute(delete(IntegrationOutbox).where(IntegrationOutbox.user_id.in_(owners)))
            await session.execute(delete(User).where(User.id.in_(owners)))
            await session.commit()
        await db_engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
