from __future__ import annotations

import argparse
import importlib.metadata
import os
from typing import TypedDict


LOCKED = {
    "langgraph": "1.2.9",
    "langgraph-checkpoint-postgres": "3.1.0",
    "langchain-core": "1.4.9",
    "llama-index-core": "0.14.23",
    "llama-index-vector-stores-postgres": "0.8.1",
    "llama-index-retrievers-bm25": "0.7.1",
    "bm25s": "0.3.9",
    "jieba-py": "0.46.12",
    "markdown-it-py": "4.2.0",
    "mem0ai": "2.0.12",
    "psycopg": "3.3.4",
}


class CounterState(TypedDict):
    count: int


def check_versions() -> None:
    actual = {name: importlib.metadata.version(name) for name in LOCKED}
    if actual != LOCKED:
        raise AssertionError(f"version mismatch: {actual}")


def check_langgraph_memory() -> None:
    from langgraph.checkpoint.memory import InMemorySaver
    from langgraph.graph import END, START, StateGraph

    builder = StateGraph(CounterState)
    builder.add_node("increment", lambda state: {"count": state["count"] + 1})
    builder.add_edge(START, "increment")
    builder.add_edge("increment", END)
    graph = builder.compile(checkpointer=InMemorySaver())
    config = {"configurable": {"thread_id": "noteflow-poc-memory"}}
    result = graph.invoke({"count": 1}, config)
    if result["count"] != 2 or graph.get_state(config).values["count"] != 2:
        raise AssertionError("LangGraph state/checkpoint roundtrip failed")


def check_llamaindex_nodes() -> None:
    from llama_index.core.schema import TextNode
    from llama_index.retrievers.bm25 import BM25Retriever
    from llama_index.vector_stores.postgres import PGVectorStore

    node = TextNode(
        id_="chunk-poc",
        text="NoteFlow 使用 PostgreSQL pgvector 保存向量。",
        metadata={"user_id": "user-poc", "note_id": "note-poc", "section_id": "section-poc"},
    )
    if node.metadata["note_id"] != "note-poc" or node.get_content() != "NoteFlow 使用 PostgreSQL pgvector 保存向量。":
        raise AssertionError("LlamaIndex TextNode metadata mapping failed")
    if BM25Retriever is None or PGVectorStore is None:
        raise AssertionError("LlamaIndex integrations failed to import")


def check_bm25_chinese() -> None:
    import bm25s
    import jieba

    corpus = ["缓存 雪崩 限流 熔断", "Python 异步 事件循环", "PostgreSQL 向量 检索"]
    tokenized = [list(jieba.cut_for_search(text)) for text in corpus]
    retriever = bm25s.BM25()
    retriever.index(tokenized)
    query = [list(jieba.cut_for_search("缓存雪崩"))]
    results, _scores = retriever.retrieve(query, corpus=corpus, k=1)
    if "缓存" not in str(results[0][0]):
        raise AssertionError("BM25 Chinese tokenizer retrieval failed")


def check_markdown_ast() -> None:
    from markdown_it import MarkdownIt

    tokens = MarkdownIt("commonmark").parse("# 标题\n\n正文\n\n```python\nprint('ok')\n```\n")
    token_types = {item.type for item in tokens}
    if not {"heading_open", "inline", "fence"}.issubset(token_types):
        raise AssertionError(f"Markdown AST tokens incomplete: {token_types}")


def check_mem0_config_boundary() -> None:
    from mem0.configs.base import MemoryConfig

    config = MemoryConfig(
        vector_store={
            "provider": "pgvector",
            "config": {
                "collection_name": "noteflow_mem0_poc",
                "dbname": "noteflow_poc",
                "host": "postgres",
                "port": 5432,
                "user": "noteflow",
                "password": "not-used-by-config-validation",
                "embedding_model_dims": 1024,
            },
        }
    )
    vector_store = config.vector_store
    if vector_store.provider != "pgvector":
        raise AssertionError("Mem0 is not configured for pgvector")
    if "qdrant" in repr(vector_store.config).lower():
        raise AssertionError("Mem0 PoC config unexpectedly uses Qdrant")


def check_postgres_checkpoint(database_url: str) -> None:
    from langgraph.checkpoint.postgres import PostgresSaver
    from langgraph.graph import END, START, StateGraph

    os.environ.setdefault("LANGGRAPH_STRICT_MSGPACK", "true")
    builder = StateGraph(CounterState)
    builder.add_node("increment", lambda state: {"count": state["count"] + 1})
    builder.add_edge(START, "increment")
    builder.add_edge("increment", END)
    config = {"configurable": {"thread_id": "noteflow-poc-postgres", "checkpoint_ns": ""}}
    with PostgresSaver.from_conn_string(database_url) as saver:
        saver.setup()
        graph = builder.compile(checkpointer=saver)
        if graph.invoke({"count": 4}, config)["count"] != 5:
            raise AssertionError("PostgreSQL checkpoint write failed")
    with PostgresSaver.from_conn_string(database_url) as restarted_saver:
        restored = restarted_saver.get(config)
        if not restored or restored.get("channel_values", {}).get("count") != 5:
            raise AssertionError("PostgreSQL checkpoint process-restart restore failed")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--postgres-url", default="")
    args = parser.parse_args()
    check_versions()
    check_langgraph_memory()
    check_llamaindex_nodes()
    check_bm25_chinese()
    check_markdown_ast()
    check_mem0_config_boundary()
    if args.postgres_url:
        check_postgres_checkpoint(args.postgres_url)
    print("AI framework compatibility PoC passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
