from __future__ import annotations

from app.routers.agent import (
    _classify_intent,
    _episode_summary_from_checkpoint,
    _history_recall_context,
    AgentChatPayload,
)
from app.memory.domain import episodic_tags, is_episodic_memory


class _FakeMemory:
    memory_type = "episode"
    tags = ["layer:episodic", "event:work_completed"]


def _assert(condition: bool, message: str):
    if not condition:
        raise AssertionError(message)


def main():
    recall_payload = AgentChatPayload(question="你还记得那天我们聊过的笔记项目吗")
    _assert(_classify_intent(recall_payload) == "history_recall", "history recall query should route to history_recall")

    recent_payload = AgentChatPayload(question="我最近在忙什么")
    _assert(_classify_intent(recent_payload) == "history_recall", "recent life query should route to history_recall")

    memory_query = AgentChatPayload(question="你还记得我叫什么吗")
    _assert(_classify_intent(memory_query) == "memory_manage", "personal memory query should keep memory_manage")

    payload = {
        "workingMemory": {
            "taskType": "note_draft",
            "title": "生成笔记草稿：SSE 知识",
        },
        "draftId": "draft_1",
        "noteId": "note_1",
    }
    event_type, summary, tags = _episode_summary_from_checkpoint("draft_workspace", payload, "resolved")
    _assert(event_type == "work_completed", "resolved checkpoint should create completed episode")
    _assert("完成" in summary and "SSE 知识" in summary, "episode summary should describe completed task")
    _assert("note_draft" in tags and "draft_workspace" in tags, "episode tags should keep task metadata")
    _assert("note:note_1" in tags and "draft:draft_1" in tags, "episode tags should keep related resource ids")

    cancelled_event, cancelled_summary, _ = _episode_summary_from_checkpoint("edit_preview", payload, "cancelled")
    _assert(cancelled_event == "work_cancelled", "cancelled checkpoint should create cancelled episode")
    _assert("取消" in cancelled_summary, "cancelled summary should describe cancellation")

    tag_values = episodic_tags("work_completed", ["note_draft"], "完成 SSE 知识笔记")
    _assert("layer:episodic" in tag_values, "episodic tags should mark episodic layer")
    _assert("event:work_completed" in tag_values, "episodic tags should mark event type")
    _assert(is_episodic_memory(_FakeMemory()), "episode memory should be recognized as episodic")

    _assert(callable(_history_recall_context), "history recall context builder should be importable")

    print("memory stage3 checks passed")


if __name__ == "__main__":
    main()
