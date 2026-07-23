from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class ToolContext(BaseModel):
    user_id: str
    run_id: Optional[str] = None
    session_id: Optional[str] = None


class SourceRef(BaseModel):
    note_id: str
    note_title: str
    section_id: Optional[str] = None
    section_title: Optional[str] = None
    chunk_id: Optional[str] = None
    snippet: str = ""
    score: float = 0.0


class ToolResult(BaseModel):
    status: Literal["success", "failed", "needs_confirmation"]
    code: str = "ok"
    message: str = ""
    data: dict[str, Any] = Field(default_factory=dict)
    sources: list[SourceRef] = Field(default_factory=list)


def reject_model_user_id(arguments: dict[str, Any]) -> None:
    if "user_id" in arguments or "userId" in arguments:
        raise ValueError("tool user identity must come from ToolContext")
