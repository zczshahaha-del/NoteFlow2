from app.providers.contracts import MemoryProvider


def legacy_memory_index() -> MemoryProvider:
    """The legacy projection is isolated from the new formal-fact engine."""
    from app.providers.mem0 import get_mem0_provider
    return get_mem0_provider()
