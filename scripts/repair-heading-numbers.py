"""Local-development-only, exact-ID, hash-guarded heading repair.

Dry run: node scripts/run-python.mjs scripts/repair-heading-numbers.py --user-id USER --note ID
Apply: repeat --note ID:SOURCE_SHA256:TARGET_SHA256 with --apply after reviewing dry run.
Never automatically migrates a note when opening it. Do not commit output/private IDs.
"""
import argparse
import asyncio
import json
import re

from app.config import cfg
from app.database import AsyncSessionLocal, engine
from app.services.heading_number_repair import repair_heading_numbers


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--note", action="append", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if cfg.ENVIRONMENT != "development" or cfg.DB_HOST not in {"127.0.0.1", "localhost", "::1"}:
        parser.error("本脚本仅允许本地开发数据库，不支持生产批量迁移")
    targets = {}
    for target in args.note:
        parts = target.split(":")
        if len(parts) not in {1, 3} or parts[0] in targets or (len(parts) == 3 and any(not re.fullmatch(r"[0-9a-f]{64}", value) for value in parts[1:])):
            parser.error("--note 必须是唯一 ID 或 ID:SOURCE_SHA256:TARGET_SHA256")
        targets[parts[0]] = tuple(parts[1:]) if len(parts) == 3 else None
    try:
        async with AsyncSessionLocal() as session:
            async with session.begin():
                result = await repair_heading_numbers(session, args.user_id, targets, apply=args.apply)
        print(json.dumps({"applied": args.apply, "notes": result}, ensure_ascii=False, indent=2))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
