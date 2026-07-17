from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import time
import urllib.error
import urllib.request


def _base_url() -> str:
    env_url = os.environ.get("NOTEFLOW_API_BASE_URL", "").strip().rstrip("/")
    if env_url:
        return env_url
    port_file = Path(__file__).resolve().parent / ".dev-api-port"
    try:
        port = port_file.read_text().strip()
        if port.isdigit():
            return f"http://127.0.0.1:{port}"
    except OSError:
        pass
    return "http://127.0.0.1:8080"


BASE_URL = _base_url()


def _request(path: str, payload: dict, token: str | None = None) -> bytes:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(BASE_URL + path, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read()


def _get(path: str, token: str) -> dict:
    request = urllib.request.Request(
        BASE_URL + path,
        headers={"Authorization": f"Bearer {token}"},
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        return json.loads(response.read().decode("utf-8"))


def _put(path: str, payload: dict, token: str) -> dict:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        BASE_URL + path,
        data=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="PUT",
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        return json.loads(response.read().decode("utf-8"))


def _auth() -> str:
    suffix = int(time.time() * 1000)
    email = f"planner-live-{suffix}@noteflow.test"
    payload = {"email": email, "password": "noteflow-test", "displayName": "Planner Live"}
    data = json.loads(_request("/api/auth/register", payload).decode("utf-8"))
    return data["token"]


def _create_note(token: str) -> dict:
    content = """# Redis 缓存三大问题

## 缓存穿透
查询不存在的数据，请求绕过缓存打到数据库。

## 缓存击穿
热点 key 过期，大量请求瞬间打到数据库。

解决方式：
- 设置热点 key 永不过期，定期异步刷新。
- 使用互斥锁，只允许一个请求重建缓存。

## 缓存雪崩
大量 key 同时过期，数据库压力暴增。
"""
    data = json.loads(
        _request(
            "/api/notes",
            {
                "title": "Redis 缓存三大问题",
                "content": content,
                "tags": ["Redis", "缓存"],
            },
            token,
        ).decode("utf-8")
    )
    return data["note"]


def _agent_events(question: str, token: str, session_id: str | None = None, page_state: dict | None = None) -> list[dict]:
    payload = {
        "sessionId": session_id,
        "question": question,
        "history": [],
        "pageState": page_state or {
            "currentNoteId": None,
            "selectedText": "",
            "centerMode": "note",
        },
        "memoryEnabled": True,
    }
    raw = _request("/api/agent/chat", payload, token).decode("utf-8")
    events: list[dict] = []
    for block in raw.split("\n\n"):
        line = block.strip()
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if not data or data == "[DONE]":
            continue
        try:
            parsed = json.loads(data)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            events.append(parsed)
    return events


def _assert(condition: bool, message: str):
    if not condition:
        raise AssertionError(message)


def main():
    try:
        token = _auth()
    except urllib.error.URLError as exc:
        raise SystemExit(f"live route check skipped: local server is not reachable: {exc}") from exc

    initial_categories = _get("/api/categories", token).get("categories") or []
    initial_notes = _get("/api/notes?includeDeleted=true", token).get("notes") or []
    initial_kb = _get("/api/knowledge-base", token).get("snapshot")
    _assert(initial_categories == [], f"new user should start with no categories, got {initial_categories}")
    _assert(initial_notes == [], f"new user should start with no notes, got {initial_notes}")
    _assert(
        initial_kb is None or (initial_kb.get("treeData") in (None, []) and initial_kb.get("fileContents") in (None, {})),
        f"new user should not start with legacy knowledge base content, got {initial_kb}",
    )
    initial_settings = _get("/api/settings", token).get("settings") or {}
    _assert(initial_settings.get("memoryEnabled") is True, f"memory should default on, got {initial_settings}")
    disabled_settings = _put("/api/settings", {"memoryEnabled": False}, token).get("settings") or {}
    _assert(disabled_settings.get("memoryEnabled") is False, f"memory should be disabled, got {disabled_settings}")
    disabled_memory_events = _agent_events("记住我喜欢通俗解释", token)
    disabled_session = next((event for event in disabled_memory_events if event.get("type") == "agent_session"), None)
    _assert(disabled_session is not None, "disabled memory route should still emit agent_session")
    _assert(
        disabled_session.get("intent") == "memory_manage",
        f"disabled memory query should still be recognized, got {disabled_session}",
    )
    _assert(
        not any(
            event.get("type") == "tool_action"
            and event.get("toolName") == "memory_tool"
            and event.get("action") in {"save_memory", "list_memories"}
            for event in disabled_memory_events
        ),
        "server-disabled memory should not run memory read/write tool actions",
    )
    enabled_settings = _put("/api/settings", {"memoryEnabled": True}, token).get("settings") or {}
    _assert(enabled_settings.get("memoryEnabled") is True, f"memory should be re-enabled, got {enabled_settings}")

    draft_events = _agent_events("帮我写一篇 SSE 知识笔记", token)
    session = next((event for event in draft_events if event.get("type") == "agent_session"), None)
    _assert(session is not None, "draft route should emit agent_session")
    _assert(session.get("intent") == "note_draft_create", f"draft intent should be note_draft_create, got {session}")

    draft_action = next(
        (
            event
            for event in draft_events
            if event.get("type") == "tool_action"
            and event.get("toolName") == "note_draft_tool"
            and event.get("action") == "open_draft_workspace"
        ),
        None,
    )
    _assert(draft_action is not None, "draft route should emit note_draft_tool/open_draft_workspace")
    seed = ((draft_action or {}).get("payload") or {}).get("seed")
    _assert(seed and "SSE" in seed and "帮我" not in seed, f"draft seed should be cleaned topic, got {seed!r}")

    feedback_events = _agent_events(
        "大纲不够详细",
        token,
        session_id=session.get("sessionId"),
        page_state={
            "currentNoteId": None,
            "selectedText": "",
            "centerMode": "draft",
            "draftSeed": seed,
        },
    )
    feedback_session = next((event for event in feedback_events if event.get("type") == "agent_session"), None)
    _assert(feedback_session is not None, "draft feedback should emit agent_session")
    _assert(
        feedback_session.get("intent") == "note_draft_continue",
        f"draft feedback intent should be note_draft_continue, got {feedback_session}",
    )
    feedback_action = next(
        (
            event
            for event in feedback_events
            if event.get("type") == "tool_action"
            and event.get("toolName") == "note_draft_tool"
            and event.get("action") == "regenerate_outline"
        ),
        None,
    )
    _assert(feedback_action is not None, "draft feedback should emit note_draft_tool/regenerate_outline")
    _assert(
        ((feedback_action or {}).get("payload") or {}).get("feedback") == "大纲不够详细",
        "draft feedback payload should keep user feedback",
    )

    critique_events = _agent_events(
        "你这大纲为什么这么不对劲啊，他不像那种学习笔记啊",
        token,
        session_id=session.get("sessionId"),
        page_state={
            "currentNoteId": None,
            "selectedText": "",
            "centerMode": "draft",
            "draftSeed": seed,
        },
    )
    critique_session = next((event for event in critique_events if event.get("type") == "agent_session"), None)
    _assert(critique_session is not None, "draft critique should emit agent_session")
    _assert(
        critique_session.get("intent") == "note_draft_continue",
        f"draft critique intent should be note_draft_continue, got {critique_session}",
    )
    critique_action = next(
        (
            event
            for event in critique_events
            if event.get("type") == "tool_action"
            and event.get("toolName") == "note_draft_tool"
            and event.get("action") == "regenerate_outline"
        ),
        None,
    )
    _assert(critique_action is not None, "draft critique should emit note_draft_tool/regenerate_outline")
    _assert(
        ((critique_action or {}).get("payload") or {}).get("feedback")
        == "你这大纲为什么这么不对劲啊，他不像那种学习笔记啊",
        "draft critique payload should keep user feedback",
    )

    concise_events = _agent_events(
        "能不能再简洁一点这个大纲",
        token,
        session_id=session.get("sessionId"),
        page_state={
            "currentNoteId": None,
            "selectedText": "",
            "centerMode": "draft",
            "draftSeed": seed,
            "activeDraftId": "local-fastapi-draft",
            "activeDraftTitle": "FastAPI 学习笔记",
            "activeDraftTopic": "FastAPI",
        },
    )
    concise_action = next(
        (
            event
            for event in concise_events
            if event.get("type") == "tool_action"
            and event.get("toolName") == "note_draft_tool"
            and event.get("action") == "regenerate_outline"
        ),
        None,
    )
    _assert(concise_action is not None, "draft concise feedback should regenerate outline")
    _assert(
        ((concise_action or {}).get("payload") or {}).get("seed") == "FastAPI",
        f"active draft topic should win over stale seed, got {concise_action}",
    )

    memory_events = _agent_events("你还记得我叫什么吗", token)
    memory_session = next((event for event in memory_events if event.get("type") == "agent_session"), None)
    _assert(memory_session is not None, "memory route should emit agent_session")
    _assert(memory_session.get("intent") == "memory_manage", f"memory intent should be memory_manage, got {memory_session}")
    _assert(
        any(event.get("type") == "tool_action" and event.get("toolName") == "memory_tool" for event in memory_events),
        "memory route should emit memory_tool action",
    )

    note = _create_note(token)
    selected_text = "设置热点 key 永不过期，定期异步刷新。"
    selection_events = _agent_events(
        "啥意思",
        token,
        page_state={
            "currentNoteId": note["id"],
            "selectedText": selected_text,
            "currentSectionId": None,
            "centerMode": "note",
            "draftSeed": "",
        },
    )
    selection_session = next((event for event in selection_events if event.get("type") == "agent_session"), None)
    _assert(selection_session is not None, "selection QA should emit agent_session")
    _assert(
        selection_session.get("intent") == "note_context_qa",
        f"selection QA intent should be note_context_qa, got {selection_session}",
    )
    context_event = next((event for event in selection_events if event.get("type") == "context"), None)
    _assert(context_event is not None, "selection QA should emit context event")
    _assert(context_event.get("contextMode") == "selection", f"context mode should be selection, got {context_event}")
    sources = context_event.get("sources") or []
    _assert(len(sources) == 1, f"selection QA should expose only one selection source, got {sources}")
    _assert(sources[0].get("sourceType") == "selection", f"source should be selection, got {sources}")
    _assert("永不过期" in sources[0].get("snippet", ""), "selection snippet should contain selected text")

    print("agent live route checks passed")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as exc:
        print(f"agent live route checks failed: {exc}", file=sys.stderr)
        raise
