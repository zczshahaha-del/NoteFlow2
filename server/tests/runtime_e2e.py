from __future__ import annotations

import asyncio
import http.cookiejar
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

from app.config import cfg  # noqa: E402
from app.models.db import User  # noqa: E402

BASE_URL = "http://127.0.0.1:8080"
TEST_EMAIL = "noteflow-runtime-e2e@local.test"
TEST_PASSWORD = "NoteFlow-E2E-2026!"


async def cleanup_test_user() -> None:
    engine = create_async_engine(cfg.DATABASE_URL, pool_pre_ping=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with session_factory() as session:
            await session.execute(delete(User).where(User.email == TEST_EMAIL))
            await session.commit()
    finally:
        await engine.dispose()


class ApiClient:
    def __init__(self) -> None:
        self.cookie_jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookie_jar))

    def request(
        self,
        method: str,
        path: str,
        payload: dict | None = None,
        expected_status: int = 200,
    ) -> tuple[dict, dict[str, str]]:
        body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            BASE_URL + path,
            data=body,
            method=method,
            headers={"Content-Type": "application/json", "User-Agent": "NoteFlow-Runtime-E2E/1.0"},
        )
        try:
            with self.opener.open(request, timeout=30) as response:
                status = response.status
                raw = response.read().decode("utf-8")
                headers = {key.lower(): value for key, value in response.headers.items()}
        except urllib.error.HTTPError as error:
            status = error.code
            raw = error.read().decode("utf-8")
            headers = {key.lower(): value for key, value in error.headers.items()}
        if status != expected_status:
            raise AssertionError(f"{method} {path}: expected {expected_status}, got {status}: {raw[:500]}")
        data = json.loads(raw) if raw else {}
        return data, headers

    def request_sse(self, path: str, payload: dict, expected_status: int = 200) -> tuple[list[dict], str]:
        request = urllib.request.Request(
            BASE_URL + path,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
                "User-Agent": "NoteFlow-Runtime-E2E/1.0",
            },
        )
        with self.opener.open(request, timeout=90) as response:
            if response.status != expected_status:
                raise AssertionError(f"POST {path}: expected {expected_status}, got {response.status}")
            raw = response.read().decode("utf-8")
        events: list[dict] = []
        for line in raw.splitlines():
            if not line.startswith("data: "):
                continue
            value = line[6:]
            if value == "[DONE]":
                continue
            events.append(json.loads(value))
        return events, raw


def wait_for_index(client: ApiClient, note_id: str, timeout_seconds: float = 30.0) -> dict:
    deadline = time.monotonic() + timeout_seconds
    latest: dict = {}
    while time.monotonic() < deadline:
        data, _ = client.request(
            "GET",
            f"/api/index-jobs?{urllib.parse.urlencode({'noteId': note_id})}",
        )
        jobs = data.get("jobs") or []
        if jobs:
            latest = jobs[0]
            if latest.get("status") == "success":
                return latest
            if latest.get("status") == "failed":
                raise AssertionError(f"index failed: {latest.get('errorMessage')}")
        time.sleep(0.5)
    raise AssertionError(f"index timeout for {note_id}: {latest}")


def run() -> dict:
    client = ApiClient()
    summary: dict[str, object] = {}

    auth, headers = client.request(
        "POST",
        "/api/auth/register",
        {
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD,
            "displayName": "NoteFlow Runtime E2E",
        },
    )
    assert auth["user"]["email"] == TEST_EMAIL
    assert "token" not in auth
    assert any(cookie.name == cfg.AUTH_COOKIE_NAME for cookie in client.cookie_jar)
    assert headers.get("x-request-id")
    summary["login"] = "cookie_session_ok"

    current, _ = client.request("GET", "/api/auth/me")
    sessions, _ = client.request("GET", "/api/auth/sessions")
    assert current["user"]["email"] == TEST_EMAIL
    assert any(session.get("current") for session in sessions)

    agent_events, agent_raw = client.request_sse(
        "/api/agent/chat",
        {
            "question": "请只回复 E2E_AI_OK，不要添加其他内容。",
            "mode": "chat",
            "documentTitle": "",
            "documentContent": "",
            "history": [],
            "maxTokens": 32,
            "memoryEnabled": False,
            "pageState": {"contextScope": "auto"},
        },
    )
    assert "data: [DONE]" in agent_raw
    assert any(event.get("type") == "agent_session" for event in agent_events)
    assert any(event.get("type") == "tool_trace" for event in agent_events)
    assert any(event.get("type") == "agent_done" and event.get("status") == "completed" for event in agent_events)
    assert any(event.get("choices") for event in agent_events)
    summary["agent"] = "real_ai_stream_with_tool_trace_ok"

    unique_key = "NOTEFLOW_E2E_SEARCH_20260715"
    created, _ = client.request(
        "POST",
        "/api/notes",
        {
            "title": "Runtime E2E 主笔记",
            "tags": ["e2e", "runtime"],
            "content": f"# Runtime E2E\n\n{unique_key}\n\nE2E_DELETE_ME",
        },
    )
    note = created["note"]
    note_id = note["id"]
    index_job = wait_for_index(client, note_id)
    summary["note"] = {"created": True, "indexed": index_job["status"]}

    search, _ = client.request(
        "POST",
        "/api/notes/search",
        {"query": unique_key, "limit": 8},
    )
    assert any(item.get("noteId") == note_id for item in search.get("results", []))
    summary["search"] = "result_found"

    draft_data, _ = client.request(
        "POST",
        "/api/note-drafts",
        {
            "title": "Runtime E2E 草稿",
            "topic": "Runtime E2E 草稿",
            "noteType": "测试笔记",
            "writingTone": "简洁",
            "noteFormat": "结构化",
            "headingLevel": "H2 / H3",
            "includeCode": False,
            "includeExercises": False,
            "extraRequest": "runtime e2e",
            "outline": "## 第一节\n## 第二节",
            "sections": [
                {"title": "第一节", "level": 2, "sortOrder": 0, "content": "第一节正文", "status": "generated"},
                {"title": "第二节", "level": 2, "sortOrder": 1, "content": "第二节正文", "status": "generated"},
            ],
        },
    )
    draft = draft_data["draft"]
    draft_id = draft["id"]
    for section in draft["sections"]:
        confirmed, _ = client.request(
            "POST",
            f"/api/note-drafts/{draft_id}/sections/{section['id']}/confirm",
        )
        assert any(item["id"] == section["id"] and item["status"] == "confirmed" for item in confirmed["draft"]["sections"])
    assembled, _ = client.request("POST", f"/api/note-drafts/{draft_id}/assemble", {})
    assert assembled["draft"]["status"] == "assembled"
    saved, _ = client.request(
        "POST",
        f"/api/note-drafts/{draft_id}/save-to-notes",
        {"confirm": True, "title": "Runtime E2E 草稿成品"},
    )
    assert saved["draft"]["status"] == "saved"
    draft_note_id = saved["note"]["id"]
    wait_for_index(client, draft_note_id)
    summary["draft"] = "create_confirm_assemble_save_ok"

    preview_data, _ = client.request(
        "POST",
        "/api/note-edit-previews",
        {
            "noteId": note_id,
            "targetType": "delete",
            "selectedText": "E2E_DELETE_ME",
            "instruction": "删除选中测试标记",
            "keepStyle": True,
            "memoryEnabled": False,
        },
    )
    preview = preview_data["preview"]
    revisions, _ = client.request("GET", f"/api/note-edit-previews/{preview['id']}/revisions")
    assert len(revisions.get("revisions", [])) >= 1
    applied, _ = client.request("POST", f"/api/note-edit-previews/{preview['id']}/apply")
    assert "E2E_DELETE_ME" not in applied["note"]["content"]
    wait_for_index(client, note_id)
    summary["edit"] = "preview_revision_apply_ok"

    memory_data, _ = client.request(
        "POST",
        "/api/memories",
        {
            "memoryType": "preference",
            "content": "Runtime E2E 偏好结构化笔记",
            "importance": 4,
            "source": "runtime_e2e",
            "scope": "global",
            "tags": ["e2e"],
        },
    )
    memory = memory_data["memory"]
    memory_search, _ = client.request(
        "POST",
        "/api/memories/search",
        {"query": "结构化笔记", "limit": 10},
    )
    assert any(item["id"] == memory["id"] for item in memory_search.get("memories", []))
    updated_memory, _ = client.request(
        "PUT",
        f"/api/memories/{memory['id']}",
        {"content": "Runtime E2E 偏好结构化且简洁的笔记", "reason": "runtime_e2e_update"},
    )
    assert "简洁" in updated_memory["memory"]["content"]
    client.request("DELETE", f"/api/memories/{memory['id']}")
    summary["memory"] = "create_search_update_delete_ok"

    fresh, _ = client.request("GET", f"/api/notes/{note_id}")
    base_updated_at = fresh["note"]["updatedAt"]
    first_update, _ = client.request(
        "PUT",
        f"/api/notes/{note_id}",
        {
            "content": fresh["note"]["content"] + "\n\n设备 A 更新",
            "expectedUpdatedAt": base_updated_at,
            "source": "runtime_e2e_device_a",
        },
    )
    assert "设备 A 更新" in first_update["note"]["content"]
    conflict, _ = client.request(
        "PUT",
        f"/api/notes/{note_id}",
        {
            "content": fresh["note"]["content"] + "\n\n设备 B 更新",
            "expectedUpdatedAt": base_updated_at,
            "source": "runtime_e2e_device_b",
        },
        expected_status=409,
    )
    assert conflict["error"]["code"] == "NOTE_VERSION_CONFLICT"
    summary["multiDeviceConflict"] = "409_detected"

    refreshed, _ = client.request("POST", "/api/auth/refresh")
    assert refreshed["user"]["email"] == TEST_EMAIL
    summary["sessionRefresh"] = "ok"
    return summary


if __name__ == "__main__":
    asyncio.run(cleanup_test_user())
    try:
        result = run()
        print(json.dumps({"ok": True, **result}, ensure_ascii=False))
    finally:
        asyncio.run(cleanup_test_user())
