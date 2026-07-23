from __future__ import annotations

from app.agent.langgraph_draft import (
    DraftGraphDependencies,
    invoke_draft_graph,
    new_draft_state,
)
from app.agent.langgraph_edit import (
    EditGraphDependencies,
    invoke_edit_graph,
    new_edit_state,
)
from app.agent.langgraph_readonly import postgres_checkpointer
from app.services.observability import record_metric


async def initialize_draft_graph(*, user_id: str, thread_id: str, draft_id: str,
                                 topic: str, outline: str) -> bool:
    async def generated_outline(_state):
        return {"outline": outline}

    async def existing_draft(_state):
        return {"draft_id": draft_id}

    deps = DraftGraphDependencies(
        generate_outline=generated_outline,
        create_draft=existing_draft,
    )
    try:
        async with postgres_checkpointer() as saver:
            await invoke_draft_graph(
                new_draft_state(user_id=user_id, topic=topic, thread_id=thread_id),
                dependencies=deps, checkpointer=saver, thread_id=thread_id,
            )
        record_metric("draft_graph", "initialize")
        return True
    except Exception:
        record_metric("draft_graph", "initialize", status="failed")
        return False


async def resume_draft_generation(*, thread_id: str) -> bool:
    try:
        async with postgres_checkpointer() as saver:
            await invoke_draft_graph(
                None, dependencies=DraftGraphDependencies(), checkpointer=saver,
                thread_id=thread_id, resume={"action": "confirm"},
            )
        record_metric("draft_graph", "resume_generation")
        return True
    except Exception:
        record_metric("draft_graph", "resume_generation", status="failed")
        return False


async def authorize_draft_save(*, thread_id: str, assembled_content: str) -> bool:
    async def assembled(_state):
        return {"assembled_content": assembled_content}

    deps = DraftGraphDependencies(assemble=assembled)
    try:
        async with postgres_checkpointer() as saver:
            for _ in range(3):
                result = await invoke_draft_graph(
                    None, dependencies=deps, checkpointer=saver, thread_id=thread_id,
                    resume={"action": "confirm"},
                )
                if result.get("status") == "saved":
                    break
            else:
                raise RuntimeError("draft graph did not reach save authorization")
        record_metric("draft_graph", "authorize_save")
        return True
    except Exception:
        record_metric("draft_graph", "authorize_save", status="failed")
        return False


async def initialize_edit_graph(*, user_id: str, thread_id: str, note_id: str,
                                instruction: str, preview_id: str, target_type: str,
                                section_id: str, selected_text: str,
                                source_content_hash: str) -> bool:
    async def resolved(_state):
        return {
            "target_type": target_type, "section_id": section_id,
            "source_content_hash": source_content_hash, "ambiguous": False,
        }

    async def existing_preview(_state):
        return {"preview_id": preview_id}

    deps = EditGraphDependencies(resolve_target=resolved, create_preview=existing_preview)
    try:
        async with postgres_checkpointer() as saver:
            await invoke_edit_graph(
                new_edit_state(
                    user_id=user_id, note_id=note_id, instruction=instruction,
                    target_type=target_type, section_id=section_id,
                    selected_text=selected_text, thread_id=thread_id,
                ),
                dependencies=deps, checkpointer=saver, thread_id=thread_id,
            )
        record_metric("edit_graph", "initialize")
        return True
    except Exception:
        record_metric("edit_graph", "initialize", status="failed")
        return False


async def resume_edit_graph(*, thread_id: str, action: str, payload: dict | None = None) -> bool:
    async def changed(_state):
        return {}

    deps = EditGraphDependencies(
        revise_preview=changed, restore_preview=changed,
        apply_preview=changed, cancel_preview=changed,
    )
    try:
        async with postgres_checkpointer() as saver:
            await invoke_edit_graph(
                None, dependencies=deps, checkpointer=saver, thread_id=thread_id,
                resume={"action": action, **(payload or {})},
            )
        record_metric("edit_graph", action)
        return True
    except Exception:
        record_metric("edit_graph", action, status="failed")
        return False
