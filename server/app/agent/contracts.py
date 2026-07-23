from __future__ import annotations

from enum import Enum
from typing import Any, Literal, Optional, TypedDict

from pydantic import BaseModel, Field

from app.tools.contracts import SourceRef


class RuntimeErrorCode(str, Enum):
    AI_NOT_CONFIGURED = "ai_not_configured"
    AI_RATE_LIMITED = "ai_rate_limited"
    AI_TIMEOUT = "ai_timeout"
    AI_STREAM_FAILED = "ai_stream_failed"
    AGENT_FAILED = "agent_failed"
    TOOL_FAILED = "tool_failed"
    PERMISSION_DENIED = "permission_denied"
    NOT_FOUND = "not_found"
    CONFLICT = "conflict"


class RuntimeEvent(BaseModel):
    type: str
    status: Optional[str] = None
    code: Optional[str] = None
    message: Optional[str] = None
    sessionId: Optional[str] = None
    runId: Optional[str] = None
    requestId: Optional[str] = None
    traceId: Optional[str] = None
    contextMode: Optional[str] = None
    sources: list[SourceRef] = Field(default_factory=list)
    payload: dict[str, Any] = Field(default_factory=dict)

    def to_wire(self) -> dict[str, Any]:
        data = self.model_dump(exclude_none=True)
        payload = data.pop("payload", {})
        if data.get("type") == "choices" and "choices" in payload:
            data.pop("type", None)
        if not data.get("sources"):
            data.pop("sources", None)
        return {**data, **payload}

    @classmethod
    def from_wire(cls, data: dict[str, Any]) -> "RuntimeEvent":
        known = {"type", "status", "code", "message", "sessionId", "runId", "requestId", "traceId", "contextMode", "sources"}
        values = {key: value for key, value in data.items() if key in known}
        values["type"] = values.get("type") or ("choices" if "choices" in data else "runtime_event")
        return cls(**values, payload={key: value for key, value in data.items() if key not in known})


class AgentState(TypedDict, total=False):
    user_id: str
    session_id: str
    run_id: str
    question: str
    intent: str
    status: Literal["running", "interrupted", "success", "failed", "cancelled"]
    current_note_id: Optional[str]
    context_mode: str
    source_refs: list[dict[str, Any]]
    answer: str
    error_code: Optional[str]
    working_memory: dict[str, Any]
