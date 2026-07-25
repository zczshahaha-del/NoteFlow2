__all__ = ["MemoryContextService"]


def __getattr__(name):
    if name == "MemoryContextService":
        from app.memory.service import MemoryContextService
        return MemoryContextService
    raise AttributeError(name)
