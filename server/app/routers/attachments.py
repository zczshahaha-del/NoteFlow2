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
from app.config import cfg
from app.deps import CurrentUser, get_current_user
from app.models.db import NoteAttachment
from app.services.attachment_service import AttachmentService

router = APIRouter(tags=["attachments"])


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

    try:
        item = await AttachmentService().create(
            user_id=user.id,
            note_id=x_note_id,
            file_name=file_name,
            content_type=content_type,
            content=content,
        )
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return {"attachment": _attachment_out(item)}


@router.get("/notes/{note_id}/attachments")
async def list_note_attachments(note_id: str, user: CurrentUser = Depends(get_current_user)):
    items = await AttachmentService().list_for_note(user.id, note_id)
    return {"attachments": [_attachment_out(item) for item in items]}


@router.get("/attachments/{attachment_id}")
async def download_attachment(attachment_id: str, user: CurrentUser = Depends(get_current_user)):
    try:
        item, content = await AttachmentService().read(user.id, attachment_id)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
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
    try:
        item, content = await AttachmentService().read_signed(attachment_id)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
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
    try:
        await AttachmentService().delete(user.id, attachment_id)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return {"ok": True}
