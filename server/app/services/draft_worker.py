from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timedelta

from sqlalchemy import select

from app.config import cfg
from app.database import AsyncSessionLocal
from app.models.db import NoteDraft, NoteDraftSection
from app.services.ai import ERR_RATE_LIMITED, complete_chat
from app.services.prompts import NoteGenerateRequest, build_note_generate_prompt

logger = logging.getLogger(__name__)

_worker_task: asyncio.Task | None = None
_wake_event: asyncio.Event | None = None
_stop_event: asyncio.Event | None = None
_active_claim_tasks: dict[str, asyncio.Task] = {}
_STALE_GENERATION_AFTER = timedelta(minutes=30)
_PENDING_SECTION_STATUSES = {"outline_only", "failed", "generating", "needs_revision"}


def _now() -> datetime:
    return datetime.utcnow()


def _job_config(draft: NoteDraft) -> dict:
    config = dict(draft.draft_config or {})
    job = dict(config.get("generationJob") or {})
    job["attempts"] = dict(job.get("attempts") or {})
    return job


def _persist_job_config(draft: NoteDraft, job: dict) -> None:
    config = dict(draft.draft_config or {})
    config["generationJob"] = {
        **job,
        "attempts": dict(job.get("attempts") or {}),
    }
    draft.draft_config = config


def notify_draft_worker() -> None:
    if _wake_event is not None:
        _wake_event.set()


def reset_interrupted_sections(sections: list[NoteDraftSection]) -> None:
    for section in sections:
        if section.status == "generating":
            section.status = "generated" if (section.content or "").strip() else "outline_only"


def _job_updated_at(draft: NoteDraft) -> datetime:
    raw_value = str(
        ((draft.draft_config or {}).get("generationJob") or {}).get("updatedAt") or ""
    ).strip()
    if raw_value:
        try:
            return datetime.fromisoformat(raw_value.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            pass
    return draft.updated_at or draft.created_at or _now()


async def _recover_stale_generation_jobs() -> int:
    recovered = 0
    cutoff = _now() - _STALE_GENERATION_AFTER
    async with AsyncSessionLocal() as session:
        async with session.begin():
            result = await session.execute(
                select(NoteDraft).where(NoteDraft.status == "generating").with_for_update()
            )
            for draft in result.scalars().all():
                if _job_updated_at(draft) >= cutoff:
                    continue
                sections_result = await session.execute(
                    select(NoteDraftSection).where(
                        NoteDraftSection.draft_id == draft.id,
                        NoteDraftSection.user_id == draft.user_id,
                    )
                )
                sections = list(sections_result.scalars().all())
                reset_interrupted_sections(sections)
                job = _job_config(draft)
                job["status"] = "interrupted"
                job["cancelRequested"] = False
                job["error"] = "上次后台生成已中断，请点击全部生成继续。"
                job.pop("currentSectionId", None)
                job.pop("currentSectionTitle", None)
                job["updatedAt"] = _now().isoformat()
                _persist_job_config(draft, job)
                draft.status = "outline_ready"
                recovered += 1
    if recovered:
        logger.warning("recovered %s stale note draft generation job(s)", recovered)
    return recovered


async def cancel_active_draft_generation(draft_id: str) -> bool:
    task = _active_claim_tasks.get(draft_id)
    if task is None or task.done():
        return False
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    except Exception:
        logger.exception("cancelled draft task ended with an error draft=%s", draft_id)
    finally:
        if _active_claim_tasks.get(draft_id) is task:
            _active_claim_tasks.pop(draft_id, None)
    return True


def _raw_request(draft: NoteDraft) -> str:
    config = draft.draft_config or {}
    raw = str(config.get("rawRequest") or config.get("trigger") or "").strip()
    return raw or draft.extra_request.strip() or draft.topic


def _body_instruction(draft: NoteDraft) -> str:
    return str((draft.draft_config or {}).get("bodyInstruction") or "").strip()


def _section_outline(section: NoteDraftSection) -> str:
    heading = "#" * max(2, min(section.level, 4))
    text = section.outline_text.strip()
    if text.startswith(f"{heading} "):
        return text
    return f"{heading} {section.title}\n{text}".strip()


def _strip_main_title(content: str, title: str) -> str:
    normalized_title = title.strip()
    if not normalized_title:
        return content.strip()
    title_pattern = re.compile(
        rf"(^|\n{{2,}})#\s+{re.escape(normalized_title)}\s*\n+",
        re.IGNORECASE,
    )
    return title_pattern.sub(lambda match: match.group(1), content).strip()


def _assemble(draft: NoteDraft, sections: list[NoteDraftSection]) -> str:
    parts: list[str] = []
    for section in sorted(sections, key=lambda item: item.sort_order):
        if section.deleted_at is not None:
            continue
        content = (section.content or "").strip()
        if content:
            parts.append(_strip_main_title(content, draft.title))
    return "\n\n".join(parts).strip()


async def _complete_with_retry(messages: list[dict], *, max_tokens: int, temperature: float) -> str:
    delays = [4.0, 10.0, 20.0]
    for attempt in range(len(delays) + 1):
        try:
            return await complete_chat(
                messages,
                max_tokens=max_tokens,
                temperature=temperature,
                thinking="disabled",
            )
        except ValueError as error:
            if str(error) != ERR_RATE_LIMITED or attempt >= len(delays):
                raise
            await asyncio.sleep(delays[attempt])
    return ""


async def _generate_section(draft: NoteDraft, section: NoteDraftSection) -> str:
    raw_request = _raw_request(draft)
    body_instruction = _body_instruction(draft)
    generation_request = raw_request
    if body_instruction:
        generation_request = (
            f"{raw_request}\n\n全文写作要求（适用于每一个章节）：\n{body_instruction}\n"
            "如果章节单独要求与全文要求冲突，以章节单独要求为准。"
        )
    provider_context = (
        "本产品当前可用的模型接口是 DeepSeek 的 OpenAI 兼容 API"
        f"（base URL: {cfg.DEEPSEEK_BASE_URL}，model: {cfg.DEEPSEEK_MODEL}）。"
        "凡是需要调用大模型的可运行示例，默认使用这个接口，不要要求用户另备 OpenAI API Key；"
        "只有在客观比较不同厂商时才提到其他模型。"
    )
    prompt = build_note_generate_prompt(
        NoteGenerateRequest(
            mode="section",
            topic=draft.topic,
            noteType=draft.note_type,
            writingTone=draft.writing_tone,
            noteFormat=draft.note_format,
            headingLevel=draft.heading_level,
            includeCode=draft.include_code,
            includeExercises=draft.include_exercises,
            extraRequest=generation_request,
            outlinePlan=_section_outline(section),
        )
    )
    first_pass = await _complete_with_retry(
        [
            {
                "role": "system",
                "content": (
                    "你是一名优秀的中文技术课程作者。把复杂技术讲清楚，优先保证准确、连贯、可学习，"
                    "不要写空泛套话。只返回本节 Markdown 正文。"
                ),
            },
            {"role": "user", "content": f"{provider_context}\n\n{prompt}"},
        ],
        max_tokens=7000,
        temperature=0.55,
    )
    if not first_pass.strip():
        raise ValueError("模型返回了空内容")

    review_prompt = f"""
请作为资深大模型应用工程师兼技术编辑，复核并直接重写下面这一节课程正文。

课程主题：{draft.topic}
用户原始需求：{raw_request}
全文写作要求：{body_instruction or "无额外全文要求"}
本节目标：{_section_outline(section)}
运行环境约束：{provider_context}

重点检查事实、术语、代码、前后逻辑和初学者可读性。保留有价值的内容，修掉错误、空话和重复；
示例代码要能说明问题，重要概念要解释为什么。涉及会随版本变化的内容时要明确边界，不要装作已经联网。
如能确定官方一手资料地址，在文末加入折叠的“官方资料”区；不确定的链接不要编造。
只返回重写后的本节 Markdown，不要解释你的修改过程。

待复核正文：
{first_pass}
""".strip()
    reviewed = await _complete_with_retry(
        [
            {
                "role": "system",
                "content": "你负责技术事实复核和课程编辑。自由组织最适合本节的讲法，只返回最终 Markdown。",
            },
            {"role": "user", "content": review_prompt},
        ],
        max_tokens=7600,
        temperature=0.25,
    )
    return reviewed.strip() or first_pass.strip()


async def _claim_one() -> tuple[str, str] | None:
    async with AsyncSessionLocal() as session:
        async with session.begin():
            result = await session.execute(
                select(NoteDraft)
                .where(NoteDraft.status == "generating")
                .order_by(NoteDraft.updated_at, NoteDraft.created_at)
                .with_for_update(skip_locked=True)
                .limit(20)
            )
            draft = next(
                (
                    item
                    for item in result.scalars().all()
                    if isinstance((item.draft_config or {}).get("generationJob"), dict)
                ),
                None,
            )
            if draft is None:
                return None

            job = _job_config(draft)
            if job.get("cancelRequested"):
                sections_result = await session.execute(
                    select(NoteDraftSection).where(
                        NoteDraftSection.draft_id == draft.id,
                        NoteDraftSection.user_id == draft.user_id,
                    )
                )
                reset_interrupted_sections(list(sections_result.scalars().all()))
                draft.status = "outline_ready"
                job["status"] = "stopped"
                job.pop("currentSectionId", None)
                job.pop("currentSectionTitle", None)
                job["updatedAt"] = _now().isoformat()
                _persist_job_config(draft, job)
                return None

            sections_result = await session.execute(
                select(NoteDraftSection)
                .where(NoteDraftSection.draft_id == draft.id, NoteDraftSection.user_id == draft.user_id)
                .order_by(NoteDraftSection.sort_order, NoteDraftSection.created_at)
            )
            sections = [item for item in sections_result.scalars().all() if item.deleted_at is None]
            pending = next(
                (
                    item
                    for item in sections
                    if item.status in _PENDING_SECTION_STATUSES
                    and int(job["attempts"].get(item.id, 0)) < 3
                ),
                None,
            )
            if pending is None:
                exhausted = [
                    item
                    for item in sections
                    if item.status == "failed" and int(job["attempts"].get(item.id, 0)) >= 3
                ]
                if exhausted:
                    draft.status = "failed"
                    job["status"] = "failed"
                    job["error"] = f"{exhausted[0].title} 连续生成失败，可点击继续重试"
                    job["updatedAt"] = _now().isoformat()
                    _persist_job_config(draft, job)
                    return None
                if sections and all(item.status in {"generated", "confirmed"} for item in sections):
                    job["status"] = "assembling"
                    job["updatedAt"] = _now().isoformat()
                    _persist_job_config(draft, job)
                    return draft.id, ""
                draft.status = "failed"
                job["status"] = "failed"
                job["error"] = "生成队列状态异常，请点击继续重试。"
                job["updatedAt"] = _now().isoformat()
                _persist_job_config(draft, job)
                return None

            attempts = int(job["attempts"].get(pending.id, 0)) + 1
            job["attempts"][pending.id] = attempts
            job["status"] = "generating"
            job["currentSectionId"] = pending.id
            job["currentSectionTitle"] = pending.title
            job["updatedAt"] = _now().isoformat()
            _persist_job_config(draft, job)
            pending.status = "generating"
            pending.retry_count = max(0, attempts - 1)
            pending.generation_key = f"{draft.id}:{pending.id}:{attempts}"
            return draft.id, pending.id


async def _finalize_draft(draft_id: str) -> None:
    async with AsyncSessionLocal() as session:
        async with session.begin():
            draft_result = await session.execute(
                select(NoteDraft).where(NoteDraft.id == draft_id).with_for_update()
            )
            draft = draft_result.scalar_one_or_none()
            if draft is None or draft.status != "generating" or draft.saved_note_id:
                return
            sections_result = await session.execute(
                select(NoteDraftSection)
                .where(NoteDraftSection.draft_id == draft.id, NoteDraftSection.user_id == draft.user_id)
                .order_by(NoteDraftSection.sort_order, NoteDraftSection.created_at)
            )
            sections = list(sections_result.scalars().all())
            active = [item for item in sections if item.deleted_at is None]
            if not active or not all(item.status in {"generated", "confirmed"} for item in active):
                return
            content = _assemble(draft, active)
            if not content:
                raise ValueError("课程正文为空")

            draft.assembled_content = content
            # A generated draft is still only a draft. The formal Note and its
            # index job are created exclusively by the explicit save endpoint.
            draft.status = "assembled"
            job = _job_config(draft)
            job["status"] = "awaiting_save_confirmation"
            job["updatedAt"] = _now().isoformat()
            _persist_job_config(draft, job)


async def _mark_claim_cancelled(draft_id: str, section_id: str) -> None:
    async with AsyncSessionLocal() as session:
        async with session.begin():
            draft = (
                await session.execute(select(NoteDraft).where(NoteDraft.id == draft_id).with_for_update())
            ).scalar_one_or_none()
            section = (
                await session.execute(
                    select(NoteDraftSection).where(
                        NoteDraftSection.id == section_id,
                        NoteDraftSection.draft_id == draft_id,
                    ).with_for_update()
                )
            ).scalar_one_or_none()
            if draft is None or section is None:
                return
            job = _job_config(draft)
            if not job.get("cancelRequested"):
                return
            reset_interrupted_sections([section])
            draft.status = "outline_ready"
            job["status"] = "stopped"
            job.pop("currentSectionId", None)
            job.pop("currentSectionTitle", None)
            job["updatedAt"] = _now().isoformat()
            _persist_job_config(draft, job)


async def _run_claim(draft_id: str, section_id: str) -> None:
    if not section_id:
        await _finalize_draft(draft_id)
        return

    try:
        async with AsyncSessionLocal() as session:
            draft = (
                await session.execute(select(NoteDraft).where(NoteDraft.id == draft_id))
            ).scalar_one_or_none()
            section = (
                await session.execute(
                    select(NoteDraftSection).where(
                        NoteDraftSection.id == section_id,
                        NoteDraftSection.draft_id == draft_id,
                    )
                )
            ).scalar_one_or_none()
            if draft is None or section is None:
                return
            try:
                content = await _generate_section(draft, section)
                error_text = ""
            except Exception as error:
                logger.exception("draft section generation failed draft=%s section=%s", draft_id, section_id)
                content = ""
                error_text = str(error)[:1000]
    except asyncio.CancelledError:
        await _mark_claim_cancelled(draft_id, section_id)
        raise

    async with AsyncSessionLocal() as session:
        async with session.begin():
            draft = (
                await session.execute(select(NoteDraft).where(NoteDraft.id == draft_id).with_for_update())
            ).scalar_one_or_none()
            section = (
                await session.execute(
                    select(NoteDraftSection).where(
                        NoteDraftSection.id == section_id,
                        NoteDraftSection.draft_id == draft_id,
                    ).with_for_update()
                )
            ).scalar_one_or_none()
            if draft is None or section is None:
                return
            job = _job_config(draft)
            if job.get("cancelRequested"):
                reset_interrupted_sections([section])
                draft.status = "outline_ready"
                job["status"] = "stopped"
                job.pop("currentSectionId", None)
                job.pop("currentSectionTitle", None)
            elif content:
                section.content = content
                section.status = "generated"
                job["error"] = ""
            else:
                section.status = "failed"
                job["error"] = error_text or "本节生成失败"
            job["updatedAt"] = _now().isoformat()
            _persist_job_config(draft, job)


async def _worker_loop() -> None:
    assert _wake_event is not None and _stop_event is not None
    logger.info("note draft generation worker started")
    while not _stop_event.is_set():
        try:
            claimed = await _claim_one()
            if claimed is not None:
                draft_id, section_id = claimed
                claim_task = asyncio.create_task(
                    _run_claim(draft_id, section_id),
                    name=f"noteflow-draft-claim-{draft_id}",
                )
                _active_claim_tasks[draft_id] = claim_task
                try:
                    await claim_task
                except asyncio.CancelledError:
                    if _stop_event.is_set():
                        break
                finally:
                    if _active_claim_tasks.get(draft_id) is claim_task:
                        _active_claim_tasks.pop(draft_id, None)
                await asyncio.sleep(1.5)
                continue
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("note draft worker iteration failed")

        _wake_event.clear()
        try:
            await asyncio.wait_for(_wake_event.wait(), timeout=2.0)
        except asyncio.TimeoutError:
            pass
    logger.info("note draft generation worker stopped")


async def start_draft_worker() -> None:
    global _worker_task, _wake_event, _stop_event
    if _worker_task and not _worker_task.done():
        return
    await _recover_stale_generation_jobs()
    _wake_event = asyncio.Event()
    _stop_event = asyncio.Event()
    _worker_task = asyncio.create_task(_worker_loop(), name="noteflow-draft-worker")


async def stop_draft_worker() -> None:
    global _worker_task
    if _stop_event is not None:
        _stop_event.set()
    if _wake_event is not None:
        _wake_event.set()
    if _worker_task is not None:
        try:
            await asyncio.wait_for(_worker_task, timeout=5)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            _worker_task.cancel()
        _worker_task = None
