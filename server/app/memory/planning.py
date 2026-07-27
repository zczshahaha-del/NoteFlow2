from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.services.turn_planner import TurnPlan


@dataclass
class MemoryReadPlan:
    """Database/Mem0 retrieval parameters derived from the single TurnPlan."""

    is_memory_query: bool = True
    query: str = ""
    layers: list[str] = field(default_factory=list)
    memory_types: list[str] = field(default_factory=list)
    canonical_keys: list[str] = field(default_factory=list)
    scopes: list[str] = field(default_factory=lambda: ["global"])
    limit: int = 8
    confidence: float = 1.0
    reason: str = ""


def memory_read_plan_from_turn_plan(
    plan: TurnPlan,
    *,
    question: str,
    limit: int = 8,
) -> MemoryReadPlan:
    """Translate an already validated TurnPlan without another model call."""

    parameters = plan.intent_parameters
    key = str(parameters.memory_key or "").strip()
    query = str(parameters.memory_query or "").strip() or question.strip()
    scope = str(parameters.memory_scope or "global").strip() or "global"
    return MemoryReadPlan(
        is_memory_query=True,
        query=query,
        layers=list(parameters.memory_layers),
        memory_types=list(parameters.memory_types),
        canonical_keys=[key] if key else [],
        scopes=[scope],
        limit=max(1, min(int(limit), 12)),
        confidence=plan.confidence,
        reason=f"turn_plan:{plan.reason or plan.primary_intent.value}",
    )


def broad_memory_read_plan(
    question: str,
    *,
    memory_types: list[str] | None = None,
    scopes: list[str] | None = None,
    limit: int = 8,
    reason: str = "trusted_internal_context",
) -> MemoryReadPlan:
    """Build a non-semantic internal read for callers that already chose memory."""

    return MemoryReadPlan(
        query=(question or "").strip(),
        memory_types=list(memory_types or []),
        scopes=list(scopes or ["global"]),
        limit=max(1, min(int(limit), 12)),
        confidence=1.0,
        reason=reason,
    )
