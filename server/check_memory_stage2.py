from __future__ import annotations

from app.routers.agent import (
    _classify_intent,
    _patch_working_memory_status,
    _working_memory_payload,
    AgentChatPayload,
)


def _assert(condition: bool, message: str):
    if not condition:
        raise AssertionError(message)


def main():
    resume_payload = AgentChatPayload(question="继续上次那个草稿任务")
    _assert(_classify_intent(resume_payload) == "resume_work", "resume query should route to resume_work")

    draft_payload = {
        "seed": "帮我生成 SSE 知识笔记",
        "draftId": "draft_1",
    }
    draft_work = _working_memory_payload("draft_workspace", draft_payload)
    _assert(draft_work["layer"] == "working", "draft work memory should be working layer")
    _assert(draft_work["taskType"] == "note_draft", "draft work memory should be note_draft")
    _assert(draft_work["status"] == "active", "draft work memory should start active")
    _assert(draft_work["relatedDraftId"] == "draft_1", "draft work memory should keep draft id")

    edit_payload = {
        "noteId": "note_1",
        "editPreviewId": "edit_1",
        "instruction": "把当前小节写得通俗一点",
    }
    edit_work = _working_memory_payload("edit_preview", edit_payload)
    _assert(edit_work["taskType"] == "note_edit", "edit work memory should be note_edit")
    _assert(edit_work["relatedNoteId"] == "note_1", "edit work memory should keep note id")
    _assert(edit_work["currentStep"] == "waiting_preview_confirmation", "edit work should wait for confirmation")

    completed_payload = _patch_working_memory_status(
        {"workingMemory": edit_work, "editPreviewId": "edit_1"},
        "resolved",
    )
    completed = completed_payload["workingMemory"]
    _assert(completed["status"] == "completed", "resolved checkpoint should complete work memory")
    _assert(completed["pendingSteps"] == [], "completed work memory should clear pending steps")
    _assert("completedAt" in completed, "completed work memory should record completedAt")

    cancelled_payload = _patch_working_memory_status({"workingMemory": draft_work}, "cancelled")
    cancelled = cancelled_payload["workingMemory"]
    _assert(cancelled["status"] == "cancelled", "cancelled checkpoint should cancel work memory")
    _assert("cancelledAt" in cancelled, "cancelled work memory should record cancelledAt")

    print("memory stage2 checks passed")


if __name__ == "__main__":
    main()
