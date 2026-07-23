# NoteFlow 当前模型、Provider 与开关矩阵

本文档不包含任何密钥值。

| 能力 | 本机实际配置 | 示例/代码默认 | 当前是否接入 | 后续目标 |
|---|---|---|---:|---|
| Chat LLM | DeepSeek OpenAI-compatible，`deepseek-v4-pro` | `deepseek-chat` | 是 | 通过类型化 `LLMProvider` 被 LangGraph 调用 |
| Embedding | DashScope，`text-embedding-v4`，1024 维 | 同左 | 是 | 通过 `EmbeddingProvider` 被 RAG v2 调用 |
| 向量库 | PostgreSQL + pgvector 0.8.4 | pgvector | 是 | 保留，不引入 Qdrant |
| Lexical retrieval | PostgreSQL pg_trgm + 自研评分 | 同左 | 是 | LlamaIndex + 标准 BM25 adapter |
| Global orchestration | 自研 FastAPI Router | 自研 | 是 | LangGraph |
| RAG module | 自研 `note_library` | 自研 | 是 | LlamaIndex，作为 LangGraph tool |
| Long-term memory | 自研 Memory services | 自研 | 是 | Mem0 OSS self-hosted shadow/灰度 |
| Cache/limit | Redis，可降级内存 | Redis | 是 | 保留并补熔断/指标 |

## 实际开关语义

- **Intent 不是关闭状态**：`plan_context_smart` 优先调用 LLM，失败后使用规则 fallback。
- **RAG 不是全局关闭状态**：`note_context_qa` 和显式 `note_search` 会调用检索；普通聊天受到 visible mode policy 保护，不自动升级为全库搜索。
- **Memory 不是关闭状态**：有效值由用户数据库设置控制；全库搜索模式不读取用户记忆，普通对话按需读取。
- **Embedding 可降级**：API key 不可用时索引仍保留 lexical sections/chunks，并把 embedding 标记为 skipped/failed，不阻塞核心笔记能力。

## 已知配置差异

本机 `server/.env` 使用 `deepseek-v4-pro`，但 `server/app/config.py`、`.env.example`、`server/.env.example` 和 `docker-compose.yml` 默认均为 `deepseek-chat`。步骤 3 的 Provider PoC 必须验证实际模型可用性并把模型选择改为单一配置真相源，不能继续靠环境差异隐式决定。
