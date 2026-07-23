__all__ = ["LegacyMemoryService"]


def __getattr__(name):
    if name == "LegacyMemoryService":
        from app.memory.service import LegacyMemoryService
        return LegacyMemoryService
    raise AttributeError(name)
