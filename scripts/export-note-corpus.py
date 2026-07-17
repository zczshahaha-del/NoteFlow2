from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

from sqlalchemy import select, text


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SERVER_ROOT = PROJECT_ROOT / "server"
sys.path.insert(0, str(SERVER_ROOT))
os.chdir(PROJECT_ROOT)

from app.database import AsyncSessionLocal, engine  # noqa: E402
from app.models.db import Note, NoteVersion, User  # noqa: E402


async def export_corpus() -> None:
    user_email = os.environ.get("NOTEFLOW_AUDIT_USER_EMAIL", "").strip().lower()
    async with AsyncSessionLocal() as session:
        await session.execute(text("SET TRANSACTION READ ONLY"))

        note_query = select(Note, User.email).join(User, User.id == Note.user_id)
        version_query = select(NoteVersion, User.email).join(User, User.id == NoteVersion.user_id)
        if user_email:
            note_query = note_query.where(User.email == user_email)
            version_query = version_query.where(User.email == user_email)

        notes = (await session.execute(note_query.order_by(Note.updated_at.desc()))).all()
        versions = (
            await session.execute(version_query.order_by(NoteVersion.created_at.desc()))
        ).all()

        records = [
            {
                "kind": "note",
                "id": note.id,
                "noteId": note.id,
                "title": note.title,
                "user": email,
                "content": note.content or "",
            }
            for note, email in notes
        ]
        records.extend(
            {
                "kind": "version",
                "id": version.id,
                "noteId": version.note_id,
                "title": version.title,
                "user": email,
                "content": version.content or "",
            }
            for version, email in versions
        )
        print(json.dumps({"records": records}, ensure_ascii=False))

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(export_corpus())
