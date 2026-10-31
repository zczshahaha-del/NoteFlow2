"""Hindsight 1.1 HTTP adapter; no SDK or ORM escapes this boundary."""
from __future__ import annotations

import hashlib
from urllib.parse import quote

import httpx

from app.config import cfg
from app.memory.engine import MemoryUnavailable


class HindsightProvider:
    name = "hindsight"

    def __init__(self, *, transport=None, url: str | None = None):
        self.transport = transport
        self.url = url or cfg.HINDSIGHT_URL

    @staticmethod
    def bank_id(user_id: str) -> str:
        return "nf-" + hashlib.sha256(user_id.encode()).hexdigest()[:40]

    def path(self, user_id: str, suffix="") -> str:
        return f"/v1/default/banks/{self.bank_id(user_id)}{suffix}"

    async def request(self, method, path, *, missing=False, **kwargs):
        headers = {"Authorization": f"Bearer {cfg.HINDSIGHT_API_KEY}"} if cfg.HINDSIGHT_API_KEY else {}
        try:
            async with httpx.AsyncClient(base_url=self.url, transport=self.transport,
                                         timeout=cfg.HINDSIGHT_TIMEOUT_SECONDS, headers=headers) as client:
                response = await client.request(method, path, **kwargs)
            if response.status_code == 404:
                if missing:
                    return None
                raise LookupError("memory not found")
            response.raise_for_status()
            return response.json() if response.content else {}
        except (httpx.HTTPError, ValueError) as exc:
            # Upstream bodies may contain prompts, credentials or service URLs.
            raise MemoryUnavailable("记忆服务暂时不可用，请稍后重试。") from exc

    async def ensure_bank(self, user_id, mission):
        config = await self.request("GET", self.path(user_id, "/config"), missing=True)
        if config is None:
            await self.request("PUT", self.path(user_id), json={"name": "NoteFlow personal memory"})
        await self.configure(user_id, mission)

    async def configure(self, user_id, mission):
        await self.request("PATCH", self.path(user_id, "/config"), json={"updates": {
            "retain_mission": mission, "retain_extraction_mode": "concise",
            # Derived observations are excluded from the first-version read contract.
            "enable_observations": False,
        }})

    async def list(self, user_id, **filters):
        if "state" not in filters:
            return await self.list(user_id, **filters, state="valid") + await self.list(user_id, **filters, state="invalidated")
        items = []
        for offset in range(0, 10000, 100):
            result = await self.request("GET", self.path(user_id, "/memories/list"),
                params={"limit": 100, "offset": offset, **filters}, missing=True)
            if result is None:
                return []
            rows = result.get("items", [])
            items.extend(rows)
            if len(rows) < 100:
                return items
        raise MemoryUnavailable("记忆数量超过单次管理上限，请缩小查询范围。")

    async def recall(self, user_id, query):
        result = await self.request("POST", self.path(user_id, "/memories/recall"), missing=True,
            json={"query": query or "用户长期偏好、背景与目标", "types": ["world", "experience"],
                  "budget": "low", "max_tokens": 1800})
        return (result or {}).get("results", [])

    async def get(self, user_id, memory_id):
        return await self.request("GET", self.path(user_id, "/memories/" + quote(memory_id, safe="")))

    async def retain(self, user_id, *, content, source_id, metadata):
        await self.request("POST", self.path(user_id, "/memories"), json={"async": False, "items": [{
            "content": content, "document_id": source_id,
            "context": "当前已认证用户本人的消息；引用、示例及他人信息不是本人事实。",
            "metadata": {str(k): str(v) for k, v in metadata.items()},
        }]})

    async def curate(self, user_id, memory_id, changes):
        return await self.request("PATCH", self.path(user_id, "/memories/" + quote(memory_id, safe="")), json=changes)

    async def delete_source(self, user_id, source_id):
        await self.request("DELETE", self.path(user_id, "/documents/" + quote(source_id, safe="")), missing=True)

    async def graph(self, user_id):
        return await self.request("GET", self.path(user_id, "/graph"), params={"limit": 400}, missing=True) or {"nodes": [], "edges": []}

    async def document(self, user_id, source_id):
        return await self.request("GET", self.path(user_id, "/documents/" + quote(source_id, safe="")), missing=True)

    async def delete_bank(self, user_id):
        await self.request("DELETE", self.path(user_id), missing=True)
