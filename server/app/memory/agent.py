from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import desc, select

from app.config import cfg
from app.database import AsyncSessionLocal
from app.models.db import ChatMessage as DbChatMessage, UserMemory
from app.schemas.agent import AgentChatMessageIn
from app.services.ai import ChatMessage
from app.memory.domain import (
    add_memory_event,
    candidate_review_tags,
    clamp_importance,
    episodic_tags,
    find_memories,
    is_episodic_memory,
    is_single_value_key,
    mark_memories_used,
    memory_candidate_status,
    memory_canonical_key,
    memory_value,
    normalize_memory_type,
    normalize_scope,
)
from app.memory.extraction import MemoryExtractionFailure, extract_memory_candidates_smart
from app.memory.planning import MemoryReadPlan, broad_memory_read_plan
from app.memory.policy import filter_eligible_memories
from app.memory.runtime import resolve_memory_read
from app.memory.service import MemoryService
from app.services.outbox import enqueue_memory_sync
from app.workers.outbox_worker import notify_outbox_worker
from app.services.user_settings import update_user_memory_enabled

logger = logging.getLogger(__name__)


def _new_id() -> str:
    return uuid.uuid4().hex


def _short(text: str, limit: int = 180) -> str:
    normalized = " ".join((text or "").split())
    if len(normalized) <= limit:
        return normalized
    return normalized[:limit].rstrip() + "..."


def _memory_out(memory: UserMemory) -> dict:
    return {
        "id": memory.id,
        "memoryType": memory.memory_type,
        "content": memory.content,
        "canonicalKey": memory_canonical_key(memory),
        "value": memory_value(memory),
        "importance": memory.importance,
        "confidence": memory.confidence,
        "source": memory.source,
        "scope": memory.scope,
        "tags": memory.tags or [],
        "status": memory.status,
        "createdAt": memory.created_at.isoformat() if memory.created_at else None,
        "updatedAt": memory.updated_at.isoformat() if memory.updated_at else None,
    }


def _format_memory_list(memories: list[UserMemory]) -> str:
    if not memories:
        return "现在还没有查到关于你身份、偏好、兴趣或目标的信息。"
    lines = ["查到的信息有："]
    for index, memory in enumerate(memories, start=1):
        lines.append(f"{index}. {memory.content}")
    return "\n".join(lines)


def memory_tool_context(action: str, memories: list[dict], question: str) -> str:
    if action == "list_memories":
        if not memories:
            memory_text = "没有查到已保存的长期记忆，尤其没有查到用户身份、称呼或偏好的记录。"
        else:
            memory_text = "\n".join(
                f"{index}. [{memory.get('memoryType')}/{memory.get('scope')}] {memory.get('content')}"
                for index, memory in enumerate(memories, start=1)
            )
        return (
            "NoteFlow 长期记忆工具刚刚完成查询。\n"
            f"用户原问题：{question}\n"
            f"查询结果：\n{memory_text}\n\n"
            "请基于查询结果自然回答用户。"
            "不要说自己没有长期记忆能力。"
            "不要提‘长期记忆’‘记忆工具’‘保存记录’等内部机制，除非用户明确问记忆功能本身。"
            "如果查到了名字、偏好、兴趣或目标，直接自然回答。"
            "如果没查到相关信息，就自然说明还不知道，不要假装知道。"
        )

    if action in {"delete_memories", "disable_memory"}:
        result = (
            f"已删除 {len(memories)} 条匹配记忆。"
            if action == "delete_memories"
            else "已关闭长期记忆功能。"
        )
        return (
            "NoteFlow 记忆管理操作已完成。\n"
            f"用户原问题：{question}\n操作结果：{result}\n"
            "请只简短、明确地确认结果，不要声称仍会保存或读取记忆。"
        )

    memory_text = (
        "\n".join(f"{index}. {memory.get('content')}" for index, memory in enumerate(memories, start=1))
        if memories
        else "没有保存新的长期记忆，因为这句话没有形成明确、稳定、可复用的记忆。"
    )
    return (
        "NoteFlow 长期记忆工具刚刚完成保存判断。\n"
        f"用户原话：{question}\n"
        f"工具结果：\n{memory_text}\n\n"
        "请自然回复用户。"
        "如果用户明确要求‘记住’，可以简短说‘好，我记住了’。"
        "如果用户只是自然分享个人信息、兴趣、状态或目标，不要说已经保存，不要提‘长期记忆’，也不要问要不要保存。"
        "不要机械复述模板；围绕用户这句话正常接话。"
    )


def memory_fallback_answer(action: str, memories: list[dict]) -> str:
    if action == "list_memories":
        if not memories:
            return "我现在还不知道这点。"
        lines = ["我查到的是："]
        lines.extend(f"{index}. {memory.get('content')}" for index, memory in enumerate(memories, start=1))
        return "\n".join(lines)
    return "明白。"


def chat_history_for_memory(history: list[AgentChatMessageIn] | None) -> list[ChatMessage]:
    result: list[ChatMessage] = []
    for item in (history or [])[-8:]:
        role = item.role if item.role in {"user", "assistant"} else "user"
        text = (item.text or "").strip()
        if text:
            result.append(ChatMessage(role=role, text=text))
    return result


async def auto_save_memory_from_question(
    user_id: str,
    question: str,
    history: list[AgentChatMessageIn] | None = None,
) -> list[dict]:
    """Run the independent model-based MemoryWriter after the primary action."""
    if not (question or "").strip():
        return []
    try:
        _, memories = await save_memory_from_question(user_id, question, history)
        return memories
    except MemoryExtractionFailure:
        # Implicit memory must never turn an otherwise successful user action
        # into a failed turn. Explicit memory commands still surface the error.
        logger.warning("Implicit MemoryWriter skipped because extraction failed")
        return []


async def save_memory_from_question(
    user_id: str,
    question: str,
    history: list[AgentChatMessageIn] | None = None,
) -> tuple[str, list[dict]]:
    candidates = await extract_memory_candidates_smart(question, "global", chat_history_for_memory(history))
    storable = [
        (candidate, memory_candidate_status(candidate))
        for candidate in candidates
        if memory_candidate_status(candidate) != "rejected"
    ]
    if not storable:
        return "这句话暂时没有形成稳定记忆。", []

    saved: list[dict] = []
    async with AsyncSessionLocal() as db:
        for candidate, target_status in storable:
            memory_type = normalize_memory_type(candidate.memory_type)
            tags = candidate.tags[:12] if target_status == "active" else candidate_review_tags(candidate)
            if target_status == "pending":
                duplicate_result = await db.execute(
                    select(UserMemory)
                    .where(
                        UserMemory.user_id == user_id,
                        UserMemory.memory_type == memory_type,
                        UserMemory.content == candidate.content[:2000],
                        UserMemory.status == "pending",
                        UserMemory.deleted_at.is_(None),
                    )
                    .limit(1)
                )
                duplicate = duplicate_result.scalar_one_or_none()
                if duplicate is not None:
                    saved.append(_memory_out(duplicate))
                    continue
                memory = UserMemory(
                    id=_new_id(),
                    user_id=user_id,
                    memory_type=memory_type,
                    content=candidate.content[:2000],
                    importance=clamp_importance(candidate.importance),
                    confidence=candidate.confidence,
                    source=candidate.source,
                    scope=normalize_scope(candidate.scope),
                    tags=tags,
                    status="pending",
                    canonical_key=candidate.canonical_key,
                    memory_layer=candidate.layer,
                )
                db.add(memory)
                add_memory_event(
                    db,
                    memory=memory,
                    user_id=user_id,
                    event_type="candidate_created",
                    new_content=memory.content,
                    reason=f"memory_candidate:{candidate.canonical_key or memory_type}",
                )
                saved.append(_memory_out(memory))
                continue

            if memory_type == "identity":
                result = await db.execute(
                    select(UserMemory)
                    .where(
                        UserMemory.user_id == user_id,
                        UserMemory.memory_type == "identity",
                        UserMemory.status == "active",
                        UserMemory.deleted_at.is_(None),
                    )
                    .order_by(desc(UserMemory.updated_at), desc(UserMemory.created_at))
                    .limit(1)
                )
                existing = result.scalar_one_or_none()
                if existing is not None:
                    old_content = existing.content
                    existing.content = candidate.content[:2000]
                    existing.importance = clamp_importance(candidate.importance)
                    existing.confidence = candidate.confidence
                    existing.source = candidate.source
                    existing.scope = normalize_scope(candidate.scope)
                    existing.tags = tags
                    existing.canonical_key = candidate.canonical_key or "identity.name"
                    existing.memory_layer = candidate.layer
                    existing.updated_at = datetime.utcnow()
                    add_memory_event(
                        db,
                        memory=existing,
                        user_id=user_id,
                        event_type="updated",
                        old_content=old_content,
                        new_content=existing.content,
                        reason="agent_memory_manage_identity",
                    )
                    saved.append(_memory_out(existing))
                    continue

            canonical_key = candidate.canonical_key
            existing_for_key: Optional[UserMemory] = None
            if canonical_key and is_single_value_key(canonical_key):
                existing_result = await db.execute(
                    select(UserMemory)
                    .where(
                        UserMemory.user_id == user_id,
                        UserMemory.status == "active",
                        UserMemory.deleted_at.is_(None),
                    )
                    .order_by(desc(UserMemory.updated_at), desc(UserMemory.created_at))
                )
                for memory in existing_result.scalars().all():
                    if memory_canonical_key(memory) == canonical_key:
                        existing_for_key = memory
                        break
                if existing_for_key is not None:
                    old_content = existing_for_key.content
                    old_value = memory_value(existing_for_key)
                    if old_content == candidate.content[:2000] and old_value == (candidate.value or old_value):
                        saved.append(_memory_out(existing_for_key))
                        continue
                    existing_for_key.content = candidate.content[:2000]
                    existing_for_key.memory_type = memory_type
                    existing_for_key.importance = clamp_importance(candidate.importance)
                    existing_for_key.confidence = candidate.confidence
                    existing_for_key.source = candidate.source
                    existing_for_key.scope = normalize_scope(candidate.scope)
                    existing_for_key.tags = tags
                    existing_for_key.canonical_key = canonical_key
                    existing_for_key.memory_layer = candidate.layer
                    existing_for_key.updated_at = datetime.utcnow()
                    add_memory_event(
                        db,
                        memory=existing_for_key,
                        user_id=user_id,
                        event_type="updated",
                        old_content=old_content,
                        new_content=existing_for_key.content,
                        reason=f"semantic_upsert:{canonical_key}",
                    )
                    saved.append(_memory_out(existing_for_key))
                    continue

            duplicate_result = await db.execute(
                select(UserMemory)
                .where(
                    UserMemory.user_id == user_id,
                    UserMemory.memory_type == memory_type,
                    UserMemory.content == candidate.content[:2000],
                    UserMemory.status == "active",
                    UserMemory.deleted_at.is_(None),
                )
                .limit(1)
            )
            duplicate = duplicate_result.scalar_one_or_none()
            if duplicate is not None:
                saved.append(_memory_out(duplicate))
                continue

            memory = UserMemory(
                id=_new_id(),
                user_id=user_id,
                memory_type=memory_type,
                content=candidate.content[:2000],
                importance=clamp_importance(candidate.importance),
                confidence=candidate.confidence,
                source=candidate.source,
                scope=normalize_scope(candidate.scope),
                tags=tags,
                status="active",
                canonical_key=candidate.canonical_key,
                memory_layer=candidate.layer,
            )
            db.add(memory)
            add_memory_event(
                db,
                memory=memory,
                user_id=user_id,
                event_type="created",
                new_content=memory.content,
                reason="agent_memory_manage",
            )
            saved.append(_memory_out(memory))
        await db.flush()
        saved_ids = {str(item.get("id") or "") for item in saved if item.get("id")}
        if saved_ids:
            sync_rows = await db.execute(
                select(UserMemory).where(UserMemory.user_id == user_id, UserMemory.id.in_(saved_ids))
            )
            for memory in sync_rows.scalars().all():
                await enqueue_memory_sync(
                    db,
                    memory_id=memory.id,
                    user_id=user_id,
                    operation="upsert" if memory.status == "active" else "delete",
                    version=MemoryService._sync_version(memory),
                )
        await db.commit()
        if saved_ids:
            notify_outbox_worker()

    return ("已同步 1 条记忆。" if len(saved) == 1 else f"已同步 {len(saved)} 条记忆。"), saved


def _delete_memory_keys(question: str) -> tuple[set[str], set[str]]:
    keys: set[str] = set()
    types: set[str] = set()
    mapping = (
        (r"年龄|几岁", "profile.age", "personal_info"),
        (r"名字|称呼|叫我", "identity.name", "identity"),
        (r"作息|熬夜|睡眠", "lifestyle.sleep_schedule", "personal_info"),
        (r"回答风格|表达偏好", "communication.answer_style", "writing_style"),
        (r"求职|工作状态", "career.current_status", "goal"),
        (r"面试", "career.interview_history", "episode"),
        (r"兴趣|爱好", "interest.general", "interest"),
    )
    for pattern, key, memory_type in mapping:
        if re.search(pattern, question, re.I):
            keys.add(key)
            types.add(memory_type)
    return keys, types


async def delete_memories_from_question(
    user_id: str,
    question: str,
    *,
    canonical_keys: list[str] | None = None,
    memory_types: list[str] | None = None,
) -> tuple[str, list[dict]]:
    if canonical_keys is not None or memory_types is not None:
        keys = {
            str(item).strip()
            for item in (canonical_keys or [])
            if str(item).strip()
        }
        types = {
            normalize_memory_type(item)
            for item in (memory_types or [])
            if str(item).strip()
        }
    else:
        # Compatibility for direct/internal callers outside the Agent TurnPlan.
        keys, types = _delete_memory_keys(question)
    if not keys and not types:
        return "没有识别出要删除的具体记忆。", []
    deleted: list[dict] = []
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(UserMemory).where(
                UserMemory.user_id == user_id,
                UserMemory.status != "deleted",
                UserMemory.deleted_at.is_(None),
            )
        )
        for memory in result.scalars().all():
            if memory_canonical_key(memory) not in keys and memory.memory_type not in types:
                continue
            old_content = memory.content
            memory.status = "deleted"
            memory.deleted_at = datetime.utcnow()
            add_memory_event(
                db, memory=memory, user_id=user_id, event_type="deleted",
                old_content=old_content, reason="user_natural_language_delete",
            )
            await enqueue_memory_sync(
                db, memory_id=memory.id, user_id=user_id, operation="delete",
                version=MemoryService._sync_version(memory),
            )
            deleted.append(_memory_out(memory))
        await db.commit()
    if deleted:
        notify_outbox_worker()
    return f"已删除 {len(deleted)} 条相关记忆。", deleted


async def disable_memory_for_user(user_id: str) -> tuple[str, list[dict]]:
    async with AsyncSessionLocal() as db:
        await update_user_memory_enabled(db, user_id, False)
        await db.commit()
    return "已关闭长期记忆；之后不会读取或保存个人记忆。", []


async def list_memories_for_agent(user_id: str) -> tuple[str, list[dict]]:
    async with AsyncSessionLocal() as db:
        memories = await find_memories(db, user_id, include_deleted=False, limit=50)
        active = filter_eligible_memories(memories, limit=8)
        return _format_memory_list(active), [_memory_out(memory) for memory in active]


async def query_memories_for_agent(
    user_id: str,
    question: str,
    history: list[AgentChatMessageIn] | None = None,
    read_plan: MemoryReadPlan | None = None,
) -> tuple[str, list[dict]]:
    # The public Agent path passes the single validated TurnPlan projection.
    # This broad plan is only for trusted internal/direct callers.
    read_plan = read_plan or broad_memory_read_plan(
        question,
        reason="trusted_direct_memory_read",
    )
    async with AsyncSessionLocal() as db:
        memories = await find_memories(
            db,
            user_id,
            query=read_plan.query or question,
            memory_types=read_plan.memory_types,
            canonical_keys=read_plan.canonical_keys,
            layers=read_plan.layers,
            scopes=read_plan.scopes,
            include_deleted=False,
            limit=read_plan.limit,
        )
        active = await resolve_memory_read(
            db,
            user_id=user_id,
            query=read_plan.query or question,
            candidate_memories=memories,
            limit=min(read_plan.limit, cfg.MEMORY_CONTEXT_LIMIT),
        )
        await mark_memories_used(db, user_id, active, reason=f"read_plan:{read_plan.reason or 'memory_query'}")
        await db.commit()
        return _format_memory_list(active), [_memory_out(memory) for memory in active]


def memory_context_from_records(memories: list[dict]) -> str:
    active = [memory for memory in memories if memory.get("status") == "active"]
    if not active:
        return ""
    lines = ["用户相关记忆上下文（自然使用，不要提数据库、长期记忆或工具）："]
    for index, memory in enumerate(active[:8], start=1):
        lines.append(f"{index}. {memory.get('content')}")
    return "\n".join(lines)


def episode_summary_from_checkpoint(checkpoint_type: str, payload: dict, status: str) -> tuple[str, str, list[str]]:
    working = payload.get("workingMemory") if isinstance(payload.get("workingMemory"), dict) else {}
    task_type = working.get("taskType") or checkpoint_type or "agent_task"
    title = working.get("title") or payload.get("seed") or payload.get("instruction") or "一次 NoteFlow 任务"
    if status == "resolved":
        event_type, verb = "work_completed", "完成"
    elif status == "cancelled":
        event_type, verb = "work_cancelled", "取消"
    elif status == "failed":
        event_type, verb = "work_failed", "未完成"
    else:
        event_type, verb = "work_updated", "更新"
    today = datetime.utcnow().date().isoformat()
    summary = f"{today}，用户{verb}了任务：{_short(str(title), 120)}"
    tags = [str(task_type), checkpoint_type]
    if payload.get("noteId"):
        tags.append(f"note:{payload.get('noteId')}")
    if payload.get("draftId"):
        tags.append(f"draft:{payload.get('draftId')}")
    if payload.get("editPreviewId"):
        tags.append(f"edit:{payload.get('editPreviewId')}")
    return event_type, summary, tags


async def save_episode_memory(
    db,
    *,
    user_id: str,
    event_type: str,
    summary: str,
    source: str,
    tags: list[str],
):
    content = f"历史事件：{summary}"
    duplicate_result = await db.execute(
        select(UserMemory)
        .where(
            UserMemory.user_id == user_id,
            UserMemory.memory_type == "episode",
            UserMemory.content == content,
            UserMemory.status == "active",
            UserMemory.deleted_at.is_(None),
        )
        .limit(1)
    )
    duplicate = duplicate_result.scalar_one_or_none()
    if duplicate is not None:
        return duplicate
    memory = UserMemory(
        id=_new_id(),
        user_id=user_id,
        memory_type="episode",
        content=content[:2000],
        importance=4 if event_type == "work_completed" else 3,
        confidence=0.9,
        source=source,
        scope="global",
        tags=episodic_tags(event_type, tags, summary),
        status="active",
        canonical_key=f"episode.{event_type}",
        memory_layer="episodic",
    )
    db.add(memory)
    add_memory_event(
        db,
        memory=memory,
        user_id=user_id,
        event_type="created",
        new_content=memory.content,
        reason=f"episode:{event_type}",
    )
    await db.flush()
    await enqueue_memory_sync(
        db, memory_id=memory.id, user_id=user_id, operation="upsert",
        version=MemoryService._sync_version(memory),
    )
    notify_outbox_worker()
    return memory


async def history_recall_context(user_id: str, question: str) -> tuple[str, list[dict]]:
    async with AsyncSessionLocal() as db:
        memories = await find_memories(
            db,
            user_id,
            query=question,
            memory_types=["episode", "project", "goal"],
            include_deleted=False,
            limit=8,
        )
        episodes = [memory for memory in memories if memory.status == "active" and is_episodic_memory(memory)]
        terms = [
            term
            for term in re.findall(r"[\w\u4e00-\u9fff]{2,}", question)
            if term not in {"之前", "以前", "上次", "昨天", "最近", "我们", "咱们", "什么", "记得"}
        ]
        result = await db.execute(
            select(DbChatMessage)
            .where(DbChatMessage.user_id == user_id, DbChatMessage.role == "user")
            .order_by(desc(DbChatMessage.created_at))
            .limit(120)
        )
        messages = []
        for message in result.scalars().all():
            text = message.text or ""
            if not terms or any(term in text for term in terms):
                messages.append(message)
            if len(messages) >= 8:
                break

    lines = [
        "以下是 NoteFlow 可用于回答用户历史回忆问题的上下文。",
        "只根据这些上下文和必要的常识自然回答；不要提数据库、工具或内部记忆机制。",
    ]
    if episodes:
        lines.append("\n[历史事件]")
        for index, memory in enumerate(episodes, start=1):
            created = memory.created_at.date().isoformat() if memory.created_at else ""
            lines.append(f"{index}. {created} {memory.content}")
    if messages:
        lines.append("\n[相关历史聊天]")
        for index, message in enumerate(messages, start=1):
            created = message.created_at.date().isoformat() if message.created_at else ""
            lines.append(f"{index}. {created} 用户说：{_short(message.text, 180)}")
    if not episodes and not messages:
        lines.append("\n没有查到足够明确的历史事件或聊天片段。")
    return "\n".join(lines), [_memory_out(memory) for memory in episodes]
