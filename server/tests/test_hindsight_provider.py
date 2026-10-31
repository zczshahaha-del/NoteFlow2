import unittest
import json
import httpx
from app.providers.hindsight import HindsightProvider
from app.memory.engine import MemoryChanges, MemoryDocument, MemoryFact, MemoryGraph, MemoryUnavailable


class HindsightProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_bank_is_derived_from_owner_and_ids_are_escaped(self):
        seen = []
        def handler(request):
            seen.append(request)
            return httpx.Response(404)
        provider = HindsightProvider(transport=httpx.MockTransport(handler), url="http://engine.test")
        self.assertNotEqual(provider.bank_id("a"), provider.bank_id("b"))
        with self.assertRaises(LookupError):
            await provider.get("a", "../other?user=b")
        self.assertIn(provider.bank_id("a"), seen[0].url.path)
        self.assertEqual(seen[0].url.query, b"")

    async def test_failure_does_not_expose_upstream_body(self):
        provider = HindsightProvider(transport=httpx.MockTransport(lambda r: httpx.Response(502, text="synthetic-secret")))
        with self.assertRaises(MemoryUnavailable) as error:
            await provider.recall("a", "query")
        self.assertNotIn("synthetic-secret", str(error.exception))

    async def test_list_reads_every_page(self):
        seen = []
        def handler(request):
            offset = int(request.url.params["offset"])
            seen.append(offset)
            return httpx.Response(200, json={"items": [{"id": str(i)} for i in range(100)] if offset == 0 else []})
        provider = HindsightProvider(transport=httpx.MockTransport(handler))
        self.assertEqual(len(await provider.list("a", source_id="d", status="active")), 100)
        self.assertEqual(seen, [0, 100])

    async def test_missing_bank_is_empty_but_service_error_is_not(self):
        provider = HindsightProvider(transport=httpx.MockTransport(lambda r: httpx.Response(404)))
        self.assertEqual(await provider.list("new-owner"), [])
        self.assertEqual(await provider.recall("new-owner", "query"), [])

    async def test_management_list_includes_both_live_and_archived_facts(self):
        def handler(request):
            state = request.url.params["state"]
            return httpx.Response(200, json={"items": [{"id": state, "state": state}]})
        provider = HindsightProvider(transport=httpx.MockTransport(handler))
        rows = await provider.list("a")
        self.assertEqual({r.status for r in rows}, {'active', 'archived'})

    async def test_fact_fields_filters_and_curation_are_normalized(self):
        seen = []
        fact = {"id": "fact-a", "text": "用户喜欢图示。", "document_id": "source-a",
                "state": "valid", "fact_type": "world", "updated_at": "2026-10-31T01:02:03Z", "tags": ["学习"]}
        def handler(request):
            seen.append(request)
            if request.method == "PATCH":
                changes = json.loads(request.content)
                return httpx.Response(200, json={**fact, **changes})
            return httpx.Response(200, json={"items": [fact]})
        provider = HindsightProvider(transport=httpx.MockTransport(handler))
        rows = await provider.list("a", source_id="source-a", status="active")
        self.assertIsInstance(rows[0], MemoryFact)
        self.assertEqual((rows[0].content, rows[0].source_id, rows[0].status), (fact['text'], 'source-a', 'active'))
        self.assertEqual(rows[0].updated_at.year, 2026)
        self.assertEqual(rows[0].tags, ('学习',))
        self.assertEqual(dict(seen[0].url.params), {'limit': '100', 'offset': '0', 'state': 'valid', 'document_id': 'source-a'})
        changed = await provider.curate('a', 'fact-a', MemoryChanges(content='新内容', status='archived', reason='用户修改'))
        self.assertEqual((changed.content, changed.status), ('新内容', 'archived'))
        self.assertEqual(json.loads(seen[-1].content), {'text': '新内容', 'state': 'invalidated', 'reason': '用户修改'})

    async def test_unknown_state_cannot_become_active_and_inferences_are_explicit(self):
        provider = HindsightProvider(transport=httpx.MockTransport(lambda request: httpx.Response(200, json={
            'id': 'fact-a', 'text': '推测', 'state': 'future_state', 'fact_type': 'observation'})))
        fact = await provider.get('a', 'fact-a')
        self.assertEqual(fact.status, 'unavailable')
        self.assertTrue(fact.derived)

    async def test_graph_and_source_return_only_domain_fields(self):
        def handler(request):
            if request.url.path.endswith('/graph'):
                return httpx.Response(200, json={'nodes': [{'data': {
                    'id': 'a', 'text': '内容', 'document_id': 'source-a', 'vendor_field': 'internal'}}],
                    'edges': [{'data': {'source': 'a', 'target': 'b', 'linkType': '语义关联'}}]})
            return httpx.Response(200, json={'original_text': '来源原文', 'vendor_field': 'internal'})
        provider = HindsightProvider(transport=httpx.MockTransport(handler))
        graph = await provider.graph('owner')
        self.assertIsInstance(graph, MemoryGraph)
        self.assertEqual((graph.nodes[0].content, graph.nodes[0].source_id), ('内容', 'source-a'))
        self.assertEqual(graph.edges[0].relation, '语义关联')
        self.assertEqual(await provider.document('owner', 'source-a'), MemoryDocument('source-a', '来源原文'))

    async def test_malformed_response_is_a_safe_service_failure(self):
        provider = HindsightProvider(transport=httpx.MockTransport(lambda request: httpx.Response(200, json={'items': 'synthetic-private-data'})))
        with self.assertRaises(MemoryUnavailable) as error:
            await provider.list('a', status='active')
        self.assertNotIn('synthetic-private-data', str(error.exception))

    async def test_preview_engine_can_be_replaced_and_cleanup_runs_on_failure(self):
        from app.memory.gateway import MemoryGateway
        class FakeEngine:
            cleaned = False
            async def ensure_bank(self, owner, mission): pass
            async def retain(self, *args, **kwargs): raise MemoryUnavailable('unavailable')
            async def delete_bank(self, owner): self.cleaned = True
        fake = FakeEngine()
        with self.assertRaises(MemoryUnavailable):
            await MemoryGateway(fake).preview('a', mission='偏好', text='我喜欢简短例子。')
        self.assertTrue(fake.cleaned)
