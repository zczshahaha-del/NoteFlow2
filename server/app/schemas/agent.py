from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class AgentChatMessageIn(BaseModel):
    role: str
    text: str


class AgentChatPageState(BaseModel):
    currentNoteId: Optional[str] = None
    selectedText: str = ""
    currentSectionId: Optional[str] = None
    dirty: bool = False
    unsavedContent: str = ""
    centerMode: Optional[str] = None
    activeEditPreviewId: Optional[str] = None
    draftSeed: str = ""
    activeDraftId: Optional[str] = None
    activeDraftTitle: str = ""
    activeDraftTopic: str = ""
    contextScope: str = "auto"


class AgentChatPayload(BaseModel):
    sessionId: Optional[str] = None
    question: str
    mode: str = "chat"
    documentTitle: str = ""
    documentContent: str = ""
    history: list[AgentChatMessageIn] = Field(default_factory=list)
    maxTokens: int = 0
    temperature: Optional[float] = None
    pageState: Optional[AgentChatPageState] = None
    memoryEnabled: bool = True


class CheckpointBindPayload(BaseModel):
    editPreviewId: Optional[str] = None
    draftId: Optional[str] = None
    payload: dict = Field(default_factory=dict)


class CheckpointResolvePayload(BaseModel):
    status: str = "resolved"
    payload: dict = Field(default_factory=dict)


class RunCancelPayload(BaseModel):
    reason: str = "user_cancelled"
