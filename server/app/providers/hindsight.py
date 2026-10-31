"""Hindsight 1.1 HTTP adapter; no SDK or ORM escapes this boundary."""
from __future__ import annotations

import hashlib
from datetime import datetime
from typing import Literal
from urllib.parse import quote

import httpx

from app.config import cfg
from app.memory.engine import (
    MemoryChanges, MemoryDocument, MemoryFact, MemoryGraph, MemoryGraphEdge,
    MemoryGraphNode, MemoryUnavailable,
)


def _object(value) -> dict:
    if not isinstance(value, dict):
        raise MemoryUnavailable("记忆服务返回了无法识别的数据，请稍后重试。")
    return value


def _rows(result, key: str) -> list:
    rows = _object(result).get(key, [])
    if not isinstance(rows, list):
        raise MemoryUnavailable("记忆服务返回了无法识别的数据，请稍后重试。")
    return rows


def _string(value) -> str:
    return value if isinstance(value, str) else ""


def _fact(row: dict) -> MemoryFact:
    """All Hindsight field and lifecycle translation stays in this adapter."""
    row = _object(row)
    if not isinstance(row.get("id"), str) or not row["id"]:
        raise MemoryUnavailable("记忆服务返回了无法识别的数据，请稍后重试。")
    updated_at = row.get("updated_at")
    if isinstance(updated_at, str):
        try:
            updated_at = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
        except ValueError:
            updated_at = None
    tags = row.get("tags")
    return MemoryFact(
        id=row["id"], content=_string(row.get("text")), source_id=_string(row.get("document_id")),
        # An unknown upstream state must never become an eligible fact.
        status={"valid": "active", "invalidated": "archived"}.get(_string(row.get("state")), "unavailable"),
        derived=row.get("fact_type", row.get("type")) == "observation",
        updated_at=updated_at if isinstance(updated_at, datetime) else None,
        tags=tuple(tag for tag in tags if isinstance(tag, str)) if isinstance(tags, list) else (),
    )


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

    async def list(self, user_id: str, *, source_id: str | None = None,
                   status: Literal["active", "archived"] | None = None) -> list[MemoryFact]:
        if status is None:
            return await self.list(user_id, source_id=source_id, status="active") + await self.list(user_id, source_id=source_id, status="archived")
        if status not in {"active", "archived"}:
            raise ValueError("unsupported memory status")
        filters = {"state": "valid" if status == "active" else "invalidated"}
        if source_id is not None:
            filters["document_id"] = source_id
        items = []
        for offset in range(0, 10000, 100):
            result = await self.request("GET", self.path(user_id, "/memories/list"),
                params={"limit": 100, "offset": offset, **filters}, missing=True)
            if result is None:
                return []
            rows = _rows(result, "items")
            items.extend(_fact(row) for row in rows)
            if len(rows) < 100:
                return items
        raise MemoryUnavailable("记忆数量超过单次管理上限，请缩小查询范围。")

    async def recall(self, user_id: str, query: str) -> list[MemoryFact]:
        result = await self.request("POST", self.path(user_id, "/memories/recall"), missing=True,
            json={"query": query or "用户长期偏好、背景与目标", "types": ["world", "experience"],
                  "budget": "low", "max_tokens": 1800})
        return [_fact(row) for row in _rows(result or {}, "results")]

    async def get(self, user_id: str, memory_id: str) -> MemoryFact:
        return _fact(await self.request("GET", self.path(user_id, "/memories/" + quote(memory_id, safe=""))))

    async def retain(self, user_id, *, content, source_id, metadata):
        await self.request("POST", self.path(user_id, "/memories"), json={"async": False, "items": [{
            "content": content, "document_id": source_id,
            "context": "当前已认证用户本人的消息；引用、示例及他人信息不是本人事实。",
            "metadata": {str(k): str(v) for k, v in metadata.items()},
        }]})

    async def curate(self, user_id: str, memory_id: str, changes: MemoryChanges) -> MemoryFact:
        payload = {"reason": changes.reason}
        if changes.content is not None:
            payload["text"] = changes.content
        if changes.status is not None:
            if changes.status not in {"active", "archived"}:
                raise ValueError("unsupported memory status")
            payload["state"] = "valid" if changes.status == "active" else "invalidated"
        return _fact(await self.request("PATCH", self.path(user_id, "/memories/" + quote(memory_id, safe="")), json=payload))

    async def delete_source(self, user_id, source_id):
        await self.request("DELETE", self.path(user_id, "/documents/" + quote(source_id, safe="")), missing=True)

    async def graph(self, user_id: str) -> MemoryGraph:
        result = await self.request("GET", self.path(user_id, "/graph"), params={"limit": 400}, missing=True) or {}
        nodes, edges = [], []
        for wrapped in _rows(result, "nodes"):
            row = _object(_object(wrapped).get("data", wrapped))
            if isinstance(row.get("id"), str):
                nodes.append(MemoryGraphNode(
                    id=row["id"], content=_string(row.get("text")) or _string(row.get("label")),
                    source_id=_string(row.get("document_id")),
                ))
        for wrapped in _rows(result, "edges"):
            row = _object(_object(wrapped).get("data", wrapped))
            if isinstance(row.get("source"), str) and isinstance(row.get("target"), str):
                edges.append(MemoryGraphEdge(
                    source=row["source"], target=row["target"],
                    relation=_string(row.get("linkType")) or _string(row.get("link_type")) or "关联",
                ))
        return MemoryGraph(nodes=tuple(nodes), edges=tuple(edges))

    async def document(self, user_id: str, source_id: str) -> MemoryDocument | None:
        row = await self.request("GET", self.path(user_id, "/documents/" + quote(source_id, safe="")), missing=True)
        if row is None:
            return None
        row = _object(row)
        return MemoryDocument(id=source_id, content=_string(row.get("original_text")) or _string(row.get("content")))

    async def delete_bank(self, user_id):
        await self.request("DELETE", self.path(user_id), missing=True)
