from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


@dataclass(frozen=True)
class StoredObject:
    key: str
    size: int
    sha256: str


class ObjectStorage(Protocol):
    async def put(self, key: str, content: bytes) -> StoredObject: ...
    async def get(self, key: str) -> bytes: ...
    async def delete(self, key: str) -> None: ...


class LocalObjectStorage:
    def __init__(self, root: str):
        self.root = Path(root).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        normalized = key.replace("\\", "/").lstrip("/")
        path = (self.root / normalized).resolve()
        if self.root not in path.parents:
            raise ValueError("invalid storage key")
        return path

    async def put(self, key: str, content: bytes) -> StoredObject:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return StoredObject(key=key, size=len(content), sha256=hashlib.sha256(content).hexdigest())

    async def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    async def delete(self, key: str) -> None:
        path = self._path(key)
        if path.exists():
            path.unlink()


def build_object_storage(root: str) -> ObjectStorage:
    # The API is intentionally provider-neutral. S3/R2/OSS adapters only need
    # to implement the three ObjectStorage methods.
    return LocalObjectStorage(root)
