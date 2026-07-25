# NoteFlow 当前模型与 Provider

本文档不包含任何密钥值。

| 能力 | 当前实现 | 状态 |
|---|---|---:|
| Chat LLM | DeepSeek OpenAI-compatible，当前 `deepseek-v4-pro` | 已接入 LangGraph |
| Embedding | DashScope `text-embedding-v4`，1024 维 | 已接入 RAG v2 |
| Reranker | DashScope `qwen3-rerank` | 已启用 |
| 向量库 | PostgreSQL + pgvector | 已启用 |
| Lexical retrieval | BM25 + 标题召回 + weighted RRF | 已启用 |
| Global orchestration | LangGraph | 唯一运行时 |
| RAG module | LlamaIndex RAG v2 | 唯一检索链路 |
| Long-term memory | Mem0 + NoteFlow 权限和安全投影 | 唯一记忆链路 |
| Cache/limit | Redis | 已启用 |

## 实际运行语义

- **Intent 不是关闭状态**：`plan_context_smart` 优先调用 LLM，失败后使用规则 fallback。
- **RAG 固定使用新链路**：当前笔记和全库搜索均调用 LlamaIndex RAG v2。
- **Memory 固定使用 Mem0**：NoteFlow 数据库继续负责权限、状态和敏感信息过滤。
- **Embedding 可降级**：API key 不可用时索引仍保留 lexical sections/chunks，并把 embedding 标记为 skipped/failed，不阻塞核心笔记能力。

## 配置来源

本地和 Docker 后端统一读取 `server/.env`。示例配置保留安全占位值，不包含任何真实密钥。
