from __future__ import annotations

import hashlib
import hmac
import mimetypes
import re
from datetime import datetime
from pathlib import Path
from typing import Optional
from urllib.parse import unquote

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Response
from sqlalchemy import and_, select

from app.config import cfg
from app.database import AsyncSessionLocal
from app.deps import CurrentUser, get_current_user
from app.models.db import Note, NoteAttachment
from app.services.object_storage import build_object_storage
from app.utils import random_id

router = APIRouter(tags=["attachments"])
storage = build_object_storage(cfg.ATTACHMENT_STORAGE_ROOT)


def _dt(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _safe_filename(value: str) -> str:
    name = Path(unquote(value).strip().replace("\\", "/")).name
    name = re.sub(r"[^\w.()\-\u4e00-\u9fff ]+", "-", name).strip(" .-")
    return (name or "attachment")[:180]


def _attachment_out(item: NoteAttachment) -> dict:
    return {
        "id": item.id,
        "noteId": item.note_id,
        "fileName": item.file_name,
        "contentType": item.content_type,
        "size": item.size,
        "sha256": item.sha256,
        "downloadUrl": _signed_url(item.id),
        "createdAt": _dt(item.created_at),
    }


def _attachment_signature(attachment_id: str) -> str:
    return hmac.new(
        cfg.JWT_SECRET.encode("utf-8"),
        f"attachment:{attachment_id}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _signed_url(attachment_id: str) -> str:
    return f"/api/attachments/{attachment_id}/content?sig={_attachment_signature(attachment_id)}"


@router.post("/attachments")
async def upload_attachment(
    content: bytes = Body(..., media_type="application/octet-stream"),
    x_file_name: str = Header("attachment", alias="X-File-Name"),
    x_note_id: Optional[str] = Header(None, alias="X-Note-Id"),
    x_content_type: Optional[str] = Header(None, alias="X-Content-Type"),
    user: CurrentUser = Depends(get_current_user),
):
    if not content:
        raise HTTPException(status_code=400, detail="attachment is empty")
    if len(content) > cfg.ATTACHMENT_MAX_BYTES:
        raise HTTPException(status_code=413, detail="attachment exceeds size limit")

    file_name = _safe_filename(x_file_name)
    content_type = (x_content_type or mimetypes.guess_type(file_name)[0] or "application/octet-stream")[:120]
    if content_type.startswith(("text/html", "image/svg")):
        raise HTTPException(status_code=415, detail="active HTML/SVG attachments are not allowed")

    async with AsyncSessionLocal() as session:
        if x_note_id:
            note = await session.scalar(
                select(Note).where(and_(Note.id == x_note_id, Note.user_id == user.id, Note.deleted_at.is_(None)))
            )
            if note is None:
                raise HTTPException(status_code=404, detail="note not found")

        attachment_id = f"att_{random_id()}"
        suffix = Path(file_name).suffix.lower()[:16]
        key = f"{user.id}/{attachment_id}{suffix}"
        stored = await storage.put(key, content)
        item = NoteAttachment(
            id=attachment_id,
            user_id=user.id,
            note_id=x_note_id,
            file_name=file_name,
            content_type=content_type,
            size=stored.size,
            sha256=stored.sha256,
            storage_key=stored.key,
        )
        session.add(item)
        await session.commit()
        await session.refresh(item)
        return {"attachment": _attachment_out(item)}


@router.get("/notes/{note_id}/attachments")
async def list_note_attachments(note_id: str, user: CurrentUser = Depends(get_current_user)):
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(NoteAttachment)
            .where(and_(NoteAttachment.note_id == note_id, NoteAttachment.user_id == user.id))
            .order_by(NoteAttachment.created_at.desc())
        )
        return {"attachments": [_attachment_out(item) for item in result.scalars().all()]}


@router.get("/attachments/{attachment_id}")
async def download_attachment(attachment_id: str, user: CurrentUser = Depends(get_current_user)):
    async with AsyncSessionLocal() as session:
        item = await session.scalar(
            select(NoteAttachment).where(
                and_(NoteAttachment.id == attachment_id, NoteAttachment.user_id == user.id)
            )
        )
        if item is None:
            raise HTTPException(status_code=404, detail="attachment not found")
        try:
            content = await storage.get(item.storage_key)
        except FileNotFoundError as error:
            raise HTTPException(status_code=410, detail="attachment content is missing") from error
        return Response(
            content=content,
            media_type=item.content_type,
            headers={"Content-Disposition": f'inline; filename="{item.file_name.encode("ascii", "ignore").decode() or "attachment"}"'},
        )


@router.get("/attachments/{attachment_id}/content")
async def read_signed_attachment(attachment_id: str, sig: str):
    if not hmac.compare_digest(sig, _attachment_signature(attachment_id)):
        raise HTTPException(status_code=403, detail="invalid attachment signature")
    async with AsyncSessionLocal() as session:
        item = await session.scalar(select(NoteAttachment).where(NoteAttachment.id == attachment_id))
        if item is None:
            raise HTTPException(status_code=404, detail="attachment not found")
        try:
            content = await storage.get(item.storage_key)
        except FileNotFoundError as error:
            raise HTTPException(status_code=410, detail="attachment content is missing") from error
        return Response(
            content=content,
            media_type=item.content_type,
            headers={
                "Cache-Control": "private, max-age=3600",
                "Content-Disposition": f'inline; filename="{item.file_name.encode("ascii", "ignore").decode() or "attachment"}"',
                "X-Content-Type-Options": "nosniff",
            },
        )


@router.delete("/attachments/{attachment_id}")
async def delete_attachment(attachment_id: str, user: CurrentUser = Depends(get_current_user)):
    async with AsyncSessionLocal() as session:
        item = await session.scalar(
            select(NoteAttachment).where(
                and_(NoteAttachment.id == attachment_id, NoteAttachment.user_id == user.id)
            )
        )
        if item is None:
            raise HTTPException(status_code=404, detail="attachment not found")
        await storage.delete(item.storage_key)
        await session.delete(item)
        await session.commit()
        return {"ok": True}
