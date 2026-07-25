from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class ContextPlan:
    """Executor-facing projection of the single validated TurnPlan.

    Semantic planning lives exclusively in services.turn_planner. This class is
    intentionally data-only so the executor cannot silently run a second intent
    classifier or revive the removed keyword fallback.
    """

    primary_intent: str = "general_chat"
    confidence: float = 0.0
    reply_surface: str = "chat_bubble"
    memory_action: str = "none"
    context_plan: dict[str, Any] = field(default_factory=dict)
    tool_plan: list[dict[str, Any]] = field(default_factory=list)
    draft_request: dict[str, Any] = field(default_factory=dict)
    edit_request: dict[str, Any] = field(default_factory=dict)
    memory_read_request: dict[str, Any] = field(default_factory=dict)
    should_ask_clarification: bool = False
    clarification_question: str = ""
    reason: str = ""
    source: str = "turn_plan"

    def to_metadata(self) -> dict[str, Any]:
        return {
            "primaryIntent": self.primary_intent,
            "confidence": self.confidence,
            "replySurface": self.reply_surface,
            "memoryAction": self.memory_action,
            "contextPlan": self.context_plan,
            "toolPlan": self.tool_plan,
            "draftRequest": self.draft_request,
            "editRequest": self.edit_request,
            "memoryReadRequest": self.memory_read_request,
            "shouldAskClarification": self.should_ask_clarification,
            "clarificationQuestion": self.clarification_question,
            "reason": self.reason,
            "source": self.source,
        }
