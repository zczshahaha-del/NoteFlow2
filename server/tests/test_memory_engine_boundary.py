"""Exercise the real governance layer against a non-Hindsight engine contract.

The reference engine is local test infrastructure, not a production provider or
proof that an existing Mem0 database can be migrated without adaptation.
"""
from __future__ import annotations

import unittest
from dataclasses import fields
from typing import get_type_hints
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import cfg
from app.deps import CurrentUser
from app.memory.context import MemoryContextService
from app.memory.control import control, save_control
from app.memory.engine import (
    MemoryChanges, MemoryDocument, MemoryEngine, MemoryFact, MemoryGraph,
    MemoryGraphEdge, MemoryGraphNode, MemoryUnavailable,
)
from app.memory.gateway import MemoryGateway
from app.memory.portability import stage_hindsight_memories
from app.memory.service import MemoryService, SourceDeletionConfirmationRequired
from app.models.db import Base, IntegrationOutbox, MemorySource, User, UserMemory, UserMemoryEvent, UserSettings
from app.providers.memory_registry import MEMORY_ENGINES, configured_engine
from app.routers import memory_console
from app.routers.memories import MemoryUpdatePayload


class ReferenceEngine:
    """Own storage vocabulary; conversion occurs at its public boundary."""

    name = "reference"

    def __init__(self):
        self.records = {}
        self.documents = {}
        self.missions = {}
        self.delete_fails = False
        self.graph_result = None

    def fact(self, key, native):
        return MemoryFact(id=key, content=native['body'], source_id=native['origin'],
                          status='active' if native['enabled'] else 'archived')

    async def ensure_bank(self, user_id, mission):
        self.missions[user_id] = mission

    async def configure(self, user_id, mission):
        self.missions[user_id] = mission

    async def retain(self, user_id, *, content, source_id, metadata):
        self.documents[user_id, source_id] = content
        key = f'fact-{len(self.records) + 1}'
        self.records[user_id, key] = {'body': content, 'origin': source_id, 'enabled': True}

    async def list(self, user_id, *, source_id=None, status=None):
        facts = [self.fact(key, value) for (owner, key), value in self.records.items() if owner == user_id]
        return [fact for fact in facts if (source_id is None or fact.source_id == source_id)
                and (status is None or fact.status == status)]

    async def recall(self, user_id, query):
        # Deliberately includes archived hits: governance must re-read and filter.
        return await self.list(user_id)

    async def get(self, user_id, memory_id):
        if (user_id, memory_id) not in self.records:
            raise LookupError('not found')
        return self.fact(memory_id, self.records[user_id, memory_id])

    async def curate(self, user_id, memory_id, changes):
        await self.get(user_id, memory_id)
        value = self.records[user_id, memory_id]
        if changes.content is not None:
            value['body'] = changes.content
        if changes.status is not None:
            value['enabled'] = changes.status == 'active'
        return self.fact(memory_id, value)

    async def delete_source(self, user_id, source_id):
        if self.delete_fails:
            raise MemoryUnavailable('synthetic outage')
        self.records = {key: value for key, value in self.records.items()
                        if key[0] != user_id or value['origin'] != source_id}
        self.documents.pop((user_id, source_id), None)

    async def graph(self, user_id):
        if self.graph_result is not None:
            return self.graph_result
        return MemoryGraph(nodes=tuple(MemoryGraphNode(fact.id, fact.content, fact.source_id)
                                       for fact in await self.list(user_id)))

    async def document(self, user_id, source_id):
        value = self.documents.get((user_id, source_id))
        return MemoryDocument(source_id, value) if value is not None else None

    async def delete_bank(self, user_id):
        self.records = {key: value for key, value in self.records.items() if key[0] != user_id}
        self.documents = {key: value for key, value in self.documents.items() if key[0] != user_id}
        self.missions.pop(user_id, None)


class MemoryEngineBoundaryTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.database = create_async_engine('sqlite+aiosqlite:///:memory:')
        self.addAsyncCleanup(self.database.dispose)
        self.sessions = async_sessionmaker(self.database, expire_on_commit=False)
        async with self.database.begin() as connection:
            await connection.run_sync(lambda conn: Base.metadata.create_all(conn, tables=[
                User.__table__, UserSettings.__table__, MemorySource.__table__, IntegrationOutbox.__table__,
                UserMemory.__table__, UserMemoryEvent.__table__]))
        async with self.sessions() as session:
            session.add_all([User(id=owner, email=owner + '@local.test', display_name='Synthetic') for owner in ('a', 'b')])
            await session.flush()
            session.add_all([UserSettings(user_id=owner, memory_enabled=True, preferences={}) for owner in ('a', 'b')])
            await session.commit()
        self.engine = ReferenceEngine()
        for replacement in (
            patch.object(cfg, 'MEMORY_ENGINE', 'reference'),
            patch.dict(MEMORY_ENGINES, {'reference': lambda: self.engine}),
            patch('app.memory.gateway.AsyncSessionLocal', self.sessions),
            patch('app.memory.gateway.lock_owner', AsyncMock()),
            patch('app.routers.memory_console.AsyncSessionLocal', self.sessions),
        ):
            replacement.start()
            self.addCleanup(replacement.stop)
        self.gateway = MemoryGateway()

    async def publish(self, owner, content, *, key=None, metadata=None):
        source_id = await self.gateway.submit(owner, content, source_key=key, metadata=metadata)
        async with self.sessions() as session:
            item = await session.scalar(select(IntegrationOutbox).where(IntegrationOutbox.aggregate_id == source_id))
            await self.gateway.process(session, item)
            await session.commit()
        return source_id

    async def test_registry_and_application_consumers_use_the_same_normalized_contract(self):
        self.assertIs(configured_engine(), self.engine)
        source = await self.publish('a', '我喜欢用图示理解数据库。', metadata={'memoryType': 'preference', 'scope': 'global'})
        rows = await MemoryService().search('a', query='学习偏好', memory_types=[], scopes=[], limit=6)
        self.assertEqual((rows[0].source_ref, rows[0].provider), (source, 'reference'))
        context = await MemoryContextService().context(user_id='a', requested=True, query='偏好', scopes=[], memory_types=[])
        self.assertIn('图示', context)
        self.assertEqual(get_type_hints(MemoryEngine.list)['return'], list[MemoryFact])
        self.assertEqual({field.name for field in fields(MemoryChanges)}, {'content', 'status', 'reason'})

    async def test_transfer_preview_is_read_only_and_keeps_published_lifecycle(self):
        source_id = await self.publish("a", "用户偏好小例子。")
        await self.publish("b", "用户正在学习法语。")
        async with self.sessions.begin() as session:
            source = await session.get(MemorySource, source_id)
            source.engine = "hindsight"
            source.metadata_json = {"pendingIds": ["review"], "hiddenIds": ["duplicate"]}
        initial = self.engine.records["a", "fact-1"]
        self.engine.records.update({
            ("a", "related"): {**initial, "body": "用户属兔。 | Involving: user"},
            ("a", "paused"): {**initial, "body": "用户喜欢长视频。", "enabled": False},
            ("a", "review"): {**initial, "body": "用户开始学习数据库。", "enabled": False},
            ("a", "duplicate"): {**initial, "enabled": False},
        })
        self.engine.name = "hindsight"
        self.engine.graph_result = MemoryGraph(
            nodes=tuple(MemoryGraphNode(key, native["body"], source_id)
                        for (owner, key), native in self.engine.records.items() if owner == "a"),
            edges=(MemoryGraphEdge("fact-1", "related", "学习方式"), MemoryGraphEdge("related", "review", "主题")),
        )

        async def stage(fingerprint=None):
            async with self.sessions.begin() as session:
                return await stage_hindsight_memories(
                    session, user_id="a", engine=self.engine, expected_fingerprint=fingerprint,
                )

        with patch("app.memory.portability.lock_owner", AsyncMock()):
            with self.assertRaisesRegex(ValueError, "outstanding"):
                await stage()
            async with self.sessions.begin() as session:
                job = await session.scalar(select(IntegrationOutbox).where(IntegrationOutbox.aggregate_id == source_id))
                job.status = "processed"
            preview = await stage()
            self.assertEqual((preview.active, preview.archived, preview.pending), (2, 1, 1))
            self.assertEqual((preview.source_documents, preview.graph_edges), (1, 2))
            self.assertEqual(preview.ignored_facts, 1)
            with self.assertRaisesRegex(ValueError, "preview"):
                await stage("outdated")
            async with self.sessions() as session:
                self.assertEqual(list(await session.scalars(select(UserMemory))), [])
            self.assertEqual((await stage(preview.fingerprint)).staged, 4)
            replay = await stage(preview.fingerprint)
            self.assertEqual((replay.staged, replay.already_staged), (0, 4))
            owner = CurrentUser("a", "a@local.test", "Synthetic")
            stranger = CurrentUser("b", "b@local.test", "Synthetic")
            with patch.object(cfg, "MEMORY_ENGINE", "local"):
                graph = await memory_console.graph(owner)
                self.assertEqual(len(graph["nodes"]), 2)
                self.assertEqual([edge["relation"] for edge in graph["edges"]], ["学习方式"])
                document = await memory_console.source(source_id, owner)
                self.assertEqual(document["document"]["content"], "用户偏好小例子。")
                self.assertFalse((await memory_console.graph(stranger))["nodes"])
                with self.assertRaises(HTTPException):
                    await memory_console.source(source_id, stranger)
            async with self.sessions.begin() as session:
                memories = list(await session.scalars(select(UserMemory)))
                self.assertTrue(all(row.user_id == "a" and row.source_ref == source_id for row in memories))
                zodiac = next(row for row in memories if "属兔" in row.content)
                self.assertEqual(zodiac.canonical_key, "profile.zodiac")
                zodiac.canonical_key = ""
            self.assertEqual((await stage(preview.fingerprint)).already_staged, 4)
            async with self.sessions.begin() as session:
                memories = list(await session.scalars(select(UserMemory)))
                self.assertEqual(next(row for row in memories if "属兔" in row.content).canonical_key, "profile.zodiac")
                next(row for row in memories if row.status == "active").content = "用户现在偏好图示。"
            with self.assertRaisesRegex(ValueError, "Existing local records"):
                await stage(preview.fingerprint)

    async def test_copied_source_deletes_all_siblings_and_cannot_be_revived(self):
        async with self.sessions.begin() as session:
            session.add(MemorySource(id="source-a", user_id="a", source_key="source-key", status="stored"))
            session.add_all([
                UserMemory(id="hsp-a1", user_id="a", source_ref="source-a", content="用户喜欢短例子。"),
                UserMemory(id="hsp-a2", user_id="a", source_ref="source-a", content="用户喜欢流程图。", status="pending"),
                UserMemory(id="ordinary", user_id="a", content="用户正在学习数据库。"),
                UserMemory(id="hsp-b1", user_id="b", source_ref="source-a", content="用户正在学习法语。"),
            ])
        owner = CurrentUser("a", "a@local.test", "Synthetic")
        stranger = CurrentUser("b", "b@local.test", "Synthetic")
        service = MemoryService()
        with (patch.object(cfg, "MEMORY_ENGINE", "local"),
              patch("app.memory.service.AsyncSessionLocal", self.sessions),
              patch("app.memory.control.lock_owner", AsyncMock()),
              patch("app.memory.service.notify_outbox_worker")):
            impact = await memory_console.impact("hsp-a1", owner)
            self.assertEqual({item["id"] for item in impact["memories"]}, {"hsp-a1", "hsp-a2"})
            for record_id in ("hsp-a1", "hsp-b1"):
                with self.assertRaises(HTTPException) as error:
                    await memory_console.impact(record_id, stranger)
                self.assertEqual(error.exception.status_code, 404)
            with self.assertRaises(SourceDeletionConfirmationRequired):
                await service.delete("a", "hsp-a1")
            with self.assertRaises(SourceDeletionConfirmationRequired):
                await service.update("a", "hsp-a1", MemoryUpdatePayload(status="deleted"))
            await service.delete("a", "hsp-a1", confirmed_source=True)
            await service.delete("a", "hsp-a1", confirmed_source=True)
            with self.assertRaises(LookupError):
                await service.update("a", "hsp-a2", MemoryUpdatePayload(status="active"))
        async with self.sessions() as session:
            self.assertEqual((await session.get(MemorySource, "source-a")).status, "deleted")
            jobs = list(await session.scalars(select(IntegrationOutbox)))
            self.assertEqual({(job.topic, job.aggregate_id) for job in jobs}, {
                ("memory.source.delete", "source-a"),
                ("memory.sync.requested", "hsp-a1"), ("memory.sync.requested", "hsp-a2"),
            })
            self.assertEqual(len(jobs), 3)
            self.assertEqual((await session.get(UserMemory, "ordinary")).status, "active")
            self.assertEqual((await session.get(UserMemory, "hsp-b1")).status, "active")

    async def test_account_source_and_live_curation_filters_do_not_depend_on_native_state(self):
        await self.publish('a', '我喜欢简短例子。')
        await self.publish('b', '我正在学习法语。')
        own = (await self.gateway.read('a'))[0]
        self.assertEqual(len(await self.gateway.read('a')), 1)
        with self.assertRaises(LookupError):
            await self.gateway.curated('b', own.id, content='修改别人的内容')
        await self.gateway.curated('a', own.id, status='archived')
        self.assertEqual(await self.gateway.read('a', query='偏好'), [])
        self.assertEqual((await self.gateway.read('a'))[0].status, 'archived')
        await self.gateway.curated('a', own.id, status='active')
        self.assertEqual((await self.gateway.read('a', query='偏好'))[0].id, own.id)

    async def test_manual_curation_pending_confirmation_and_duplicates_remain_protected(self):
        await self.publish('a', '我喜欢简短例子。')
        first = (await self.gateway.read('a'))[0]
        await self.gateway.curated('a', first.id, content='用户喜欢图示。')
        pending_source = await self.publish('a', '我正在学习数据库。')
        pending = next(row for row in await self.gateway.read('a') if row.source_ref == pending_source)
        self.assertEqual(pending.status, 'pending')
        self.assertNotIn(pending.id, {row.id for row in await self.gateway.read('a', query='偏好')})
        await self.gateway.curated('a', pending.id, status='active')
        self.assertIn(pending.id, {row.id for row in await self.gateway.read('a', query='偏好')})
        duplicate_source = await self.publish('a', '用户喜欢图示。')
        self.assertFalse(any(row.source_ref == duplicate_source for row in await self.gateway.read('a')))

    async def test_deleted_source_stays_hidden_even_when_engine_deletion_fails(self):
        source = await self.publish('a', '我喜欢简短例子。', key='stable-source')
        memory = (await self.gateway.read('a'))[0]
        self.engine.delete_fails = True
        with self.assertRaises(MemoryUnavailable):
            await self.gateway.delete('a', memory.id)
        self.assertEqual(await self.gateway.read('a'), [])
        self.assertIsNone(await self.gateway.submit('a', '我喜欢简短例子。', source_key='stable-source'))
        async with self.sessions() as session:
            self.assertEqual((await session.get(MemorySource, source)).status, 'deleted')
        self.assertTrue(await self.engine.list('a'))  # external data can outlive the barrier

    async def test_closed_or_changed_generation_skips_queued_work(self):
        source = await self.gateway.submit('a', '我喜欢简短例子。')
        async with self.sessions() as session:
            settings, state = await control(session, 'a')
            save_control(settings, {**state, 'generation': 1})
            settings.memory_enabled = False
            await session.commit()
            item = await session.scalar(select(IntegrationOutbox).where(IntegrationOutbox.aggregate_id == source))
            await self.gateway.process(session, item)
            await session.commit()
            self.assertEqual((await session.get(MemorySource, source)).status, 'skipped')
        self.assertEqual(await self.engine.list('a'), [])
        self.assertIsNone(await self.gateway.submit('a', '我喜欢图示。'))

    async def test_graph_uses_current_public_facts_and_filters_hidden_nodes_and_edges(self):
        source = await self.publish('a', '我喜欢简短例子。')
        own = (await self.gateway.read('a'))[0]
        self.engine.graph_result = MemoryGraph(
            nodes=(MemoryGraphNode(own.id, '过时文字', 'wrong-source'), MemoryGraphNode('foreign', '不应泄漏')),
            edges=(MemoryGraphEdge(own.id, 'foreign', '关系'),))
        result = await self.gateway.graph('a')
        self.assertEqual(result, {'nodes': [{'id': own.id, 'content': own.content, 'sourceRef': source}], 'edges': []})
        response = await memory_console.source(source, CurrentUser('a', 'a@local.test', 'Synthetic'))
        self.assertEqual(response['document'], {'id': source, 'content': own.content})
        overview = await memory_console.overview(CurrentUser('a', 'a@local.test', 'Synthetic'))
        self.assertEqual(overview['engine'], 'reference')
        self.assertTrue(overview['capabilities']['rules'])

    async def test_preview_is_isolated_and_unknown_configuration_fails_explicitly(self):
        result = await self.gateway.preview('a', mission='只保存偏好', text='我喜欢简短例子。')
        self.assertEqual(result, {'facts': ['我喜欢简短例子。']})
        self.assertEqual(self.engine.records, {})
        with patch.object(cfg, 'MEMORY_ENGINE', 'unsupported'):
            with self.assertRaises(MemoryUnavailable):
                configured_engine()


if __name__ == '__main__':
    unittest.main()
