from __future__ import annotations

import asyncio
import logging
import time
from typing import Optional

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import text
import redis.asyncio as aioredis

from app.config import cfg
from app.migrations import upgrade_database

logger = logging.getLogger(__name__)

engine = create_async_engine(
    cfg.DATABASE_URL,
    pool_size=10,
    max_overflow=90,
    pool_recycle=3600,
    echo=False,
)

AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def wait_for_postgres(max_wait: float = 45.0):
    deadline = time.monotonic() + max_wait
    last_err = None
    while time.monotonic() < deadline:
        try:
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            return
        except Exception as e:
            last_err = e
            logger.warning("waiting for PostgreSQL: %s", e)
            await asyncio.sleep(2)
    raise RuntimeError(f"failed to connect PostgreSQL: {last_err}")


async def init_db():
    await wait_for_postgres()
    await asyncio.to_thread(upgrade_database)


redis_client: Optional[aioredis.Redis] = None


async def init_redis():
    global redis_client
    if not cfg.REDIS_ADDR:
        return
    try:
        redis_client = aioredis.Redis(
            host=cfg.REDIS_ADDR.split(":")[0] if ":" in cfg.REDIS_ADDR else cfg.REDIS_ADDR,
            port=int(cfg.REDIS_ADDR.split(":")[1]) if ":" in cfg.REDIS_ADDR else 6379,
            password=cfg.REDIS_PASSWORD or None,
            db=cfg.REDIS_DB,
            decode_responses=True,
        )
        await redis_client.ping()
        logger.info("Redis connected")
    except Exception as e:
        logger.warning("Redis unavailable, continuing without Redis: %s", e)
        if redis_client:
            await redis_client.close()
        redis_client = None
