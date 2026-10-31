import unittest
import httpx
from app.providers.hindsight import HindsightProvider
from app.memory.engine import MemoryUnavailable


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
        self.assertEqual(len(await provider.list("a", document_id="d", state="valid")), 100)
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
        self.assertEqual({r['state'] for r in rows}, {'valid', 'invalidated'})

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
