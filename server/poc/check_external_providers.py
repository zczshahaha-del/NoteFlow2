from __future__ import annotations

import argparse
import asyncio
import json
import uuid

import httpx

from app.config import cfg
from app.services.ai import ERR_NOT_CONFIGURED, ChatMessage, ChatRequest, complete_chat, stream_chat
from app.services.embeddings import embed_texts


async def run() -> dict:
    embedding = await embed_texts(["NoteFlow DashScope 兼容性测试", "批量向量请求"])
    if len(embedding.embeddings) != 2 or embedding.dimensions != 1024:
        raise AssertionError("DashScope batch embedding dimensions mismatch")

    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
        response = await client.post(
            f"{cfg.DEEPSEEK_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {cfg.DEEPSEEK_API_KEY}"},
            json={
                "model": cfg.DEEPSEEK_MODEL,
                "messages": [
                    {"role": "system", "content": "只输出 JSON，不要 Markdown。"},
                    {"role": "user", "content": '输出 {"ok":true,"provider":"deepseek"}'},
                ],
                "max_tokens": 128,
                "temperature": 0.0,
            },
        )
    response.raise_for_status()
    completion = response.json()
    structured_raw = str((((completion.get("choices") or [{}])[0].get("message") or {}).get("content") or ""))
    structured = json.loads(structured_raw.strip().removeprefix("```json").removesuffix("```").strip())
    if structured.get("ok") is not True:
        raise AssertionError("DeepSeek structured output failed")
    usage = completion.get("usage") or {}
    if int(usage.get("total_tokens") or 0) <= 0:
        raise AssertionError("DeepSeek response did not expose token usage")

    chunks = []
    async for chunk in stream_chat(
        ChatRequest(
            question="只回复 STREAM_OK",
            history=[ChatMessage(role="user", text="开始流式测试")],
            maxTokens=64,
            temperature=0.0,
        )
    ):
        chunks.append(chunk)
    if not chunks:
        raise AssertionError("DeepSeek stream returned no chunks")

    original_api_key = cfg.DEEPSEEK_API_KEY
    try:
        cfg.DEEPSEEK_API_KEY = ""
        try:
            await complete_chat(
                [{"role": "user", "content": f"provider-disconnect-{uuid.uuid4().hex}"}],
                max_tokens=64,
            )
        except ValueError as exc:
            if str(exc) != ERR_NOT_CONFIGURED:
                raise AssertionError(f"unexpected provider disconnect error: {exc}") from exc
        else:
            raise AssertionError("missing Provider credentials did not return a controlled error")
    finally:
        cfg.DEEPSEEK_API_KEY = original_api_key

    return {
        "chatModel": cfg.DEEPSEEK_MODEL,
        "embeddingModel": embedding.model,
        "embeddingDimensions": embedding.dimensions,
        "embeddingBatch": len(embedding.embeddings),
        "structuredOutput": True,
        "streaming": True,
        "tokenUsage": {
            "prompt": int(usage.get("prompt_tokens") or 0),
            "completion": int(usage.get("completion_tokens") or 0),
            "total": int(usage.get("total_tokens") or 0),
        },
        "controlledProviderError": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.parse_args()
    print(json.dumps(asyncio.run(run()), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
