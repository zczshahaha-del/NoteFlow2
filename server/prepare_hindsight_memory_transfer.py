"""Inventory one account, or stage its reviewed facts without changing the live backend."""
from __future__ import annotations

import argparse
import asyncio
import json
from dataclasses import asdict

from app.config import cfg
from app.database import AsyncSessionLocal, engine
from app.memory.engine import MemoryUnavailable
from app.memory.portability import stage_hindsight_memories
from app.providers.memory_registry import configured_engine


async def run(user_id: str, expected_fingerprint: str | None) -> None:
    if cfg.MEMORY_ENGINE != "hindsight":
        raise ValueError("Prepare the transfer while Hindsight is still the active backend")
    try:
        async with AsyncSessionLocal.begin() as session:
            result = await stage_hindsight_memories(
                session, user_id=user_id, engine=configured_engine(),
                expected_fingerprint=expected_fingerprint,
            )
        print(json.dumps(asdict(result), ensure_ascii=False))
    finally:
        await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--apply-fingerprint", help="Fingerprint returned by a read-only preview")
    args = parser.parse_args()
    try:
        asyncio.run(run(args.user_id, args.apply_fingerprint))
    except (LookupError, ValueError, MemoryUnavailable) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
