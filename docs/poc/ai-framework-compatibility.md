# NoteFlow AI 框架兼容性 PoC

执行日期：2026-07-17（Asia/Shanghai）

> 历史记录：本 PoC 已完成使命。隔离镜像、专用依赖文件和运行脚本已在
> 2026-07-23 清理；当前正式依赖以 `server/requirements.txt` 为准，验证由正式测试套件承担。

## 结论

步骤 3 的框架组合可以进入后续实现，但本阶段不切换生产路径。生产默认仍是 `legacy`，LangGraph、LlamaIndex 和 Mem0 只存在于隔离 PoC 与稳定接口边界中。

- 目标运行时固定为 Python 3.12；本机系统 Python 3.9 不作为新 AI 栈的运行环境。
- LangGraph PostgreSQL Checkpoint 已完成建表、写入、关闭连接后重新打开并恢复状态。
- LlamaIndex `TextNode` 可以无损携带 NoteFlow 的 `user_id/note_id/section_id/chunk_id` 元数据。
- 中文 BM25 使用 `bm25s + jieba-py.cut_for_search` 可以正确召回“缓存雪崩”样例。
- Markdown 使用 `markdown-it-py` 生成 CommonMark token/AST，不再依赖正则表达式解析结构。
- Mem0 配置固定使用 PostgreSQL/pgvector 独立 collection，不部署 Qdrant，不建立第二业务真相源。
- DeepSeek 实测支持流式返回、JSON 结构化输出和 token usage；DashScope 实测支持批量请求与 1024 维向量。

## 当时验证的版本

下表保留当时的验证记录，不再代表当前正式依赖版本。

| 依赖 | 锁定版本 | PoC 结果 |
|---|---:|---|
| `langgraph` | `1.2.9` | StateGraph 与 InMemorySaver 通过 |
| `langgraph-checkpoint-postgres` | `3.1.0` | setup、保存、重连恢复通过 |
| `langchain-core` | `1.4.9` | 与 LangGraph 依赖集合兼容 |
| `llama-index-core` | `0.14.23` | TextNode 映射通过 |
| `llama-index-vector-stores-postgres` | `0.8.1` | PGVectorStore 导入通过 |
| `llama-index-retrievers-bm25` | `0.7.1` | BM25Retriever 导入通过 |
| `bm25s` | `0.3.9` | 中文检索样例通过 |
| `jieba-py` | `0.46.12` | 搜索分词通过 |
| `markdown-it-py` | `4.2.0` | heading、inline、fence AST 通过 |
| `mem0ai` | `2.0.12` | pgvector 配置边界通过 |
| `psycopg[binary,pool]` | `3.3.4` | PostgreSQL Checkpoint 连接通过 |

选择 `jieba-py` 而不是长期未更新的 `jieba 0.42.1`。所有版本必须通过 PoC 后单独升级，禁止在功能 PR 中顺带解除精确锁定。

## 第一版参数

| 参数 | 第一版值 | 理由 |
|---|---:|---|
| `RAG_CHUNK_SIZE` | `900` | 保留足够段落语义，又不让单节点过大 |
| `RAG_CHUNK_OVERLAP` | `120` | 约 13% 重叠，覆盖标题/段落边界 |
| `RAG_CANDIDATE_K` | `40` | 为 lexical 与 vector 融合保留候选空间 |
| `RAG_TOP_K` | `8` | 控制最终上下文和引用数量 |
| `RAG_RRF_K` | `60` | 使用常见的稳定 RRF 平滑常数作为首版 |
| `RAG_RERANK_TIMEOUT_SECONDS` | `3` | reranker 超时后允许退回融合排序 |
| `RAG_BM25_TOKENIZER` | `jieba_search` | 中文短问召回明显优于空格切词 |
| Embedding dimensions | `1024` | 与现有 pgvector 列和 DashScope 配置一致 |
| Mem0 collection | `noteflow_mem0_v1` | 与笔记向量 namespace 分离，仍在同一 PostgreSQL 集群 |

这些值是进入 RAG v2 Shadow 的首版参数，不是最终调优结论。步骤 10～12 必须使用固定数据集比较 legacy 与新实现后再调整。

## Provider 实测

当前本机配置的 Chat 模型是 `deepseek-v4-pro`，代码和示例环境的安全默认仍是 `deepseek-chat`；模型名只从 `DEEPSEEK_MODEL` 读取，不在新模块中硬编码。

2026-07-17 实测结果：

```json
{
  "chatModel": "deepseek-v4-pro",
  "embeddingModel": "text-embedding-v4",
  "embeddingDimensions": 1024,
  "embeddingBatch": 2,
  "structuredOutput": true,
  "streaming": true,
  "tokenUsage": {"prompt": 23, "completion": 35, "total": 58},
  "controlledProviderError": true
}
```

- 非流式 DeepSeek timeout：60 秒。
- 流式 DeepSeek timeout：300 秒。
- DashScope timeout：由 `EMBEDDING_TIMEOUT_SECONDS` 控制，默认 60 秒。
- 缺失 Provider 凭证时返回受控 `ValueError`，API 层映射为公开错误，不泄露密钥。

## 数据适配策略

LlamaIndex 不拥有第二套 NoteFlow 数据。映射规则如下：

| LlamaIndex Node | NoteFlow 字段 |
|---|---|
| `node.id_` | `note_chunks.id` |
| `node.text` | `note_chunks.content` |
| `metadata.user_id` | `note_chunks.user_id` |
| `metadata.note_id` | `note_chunks.note_id` |
| `metadata.section_id` | `note_chunks.section_id` |
| embedding | `note_embeddings.embedding vector(1024)` |

正式接入时通过 NoteFlow Repository/adapter 读取现有表；不能让 LlamaIndex 自动再建一套业务文档表。Mem0 只使用独立 collection/namespace 保存长期记忆向量，业务事实仍以 `user_memories` 和事件表为准。

`mem0ai` 当前会传递安装 `qdrant-client`，但本项目配置和运行时没有创建 Qdrant client、Qdrant collection 或 Qdrant 服务。若未来要求“依赖树中也不能出现 qdrant-client”，需要等待 Mem0 拆分 extras 或维护内部安装包；这不影响当前“不使用 Qdrant、不新增第二真相源”的架构约束。

## 当前验证方式

隔离 PoC 已退役。请使用 `npm run test:backend`、`npm run test:architecture`、
`npm run test:rag` 和 `npm run test:memory-safety` 验证正式实现。

## 回滚与升级规则

- 历史 PoC 文件已经删除，不影响当前 API。
- 新依赖在正式 Docker 环境中升级，并运行固定 RAG/Memory、Checkpoint 和 Provider 测试。
- 一次只升级一个框架簇；LangGraph/checkpointer、LlamaIndex adapters、Mem0 分开升级。
- 未通过 Python 3.12 Docker、PostgreSQL 恢复和跨用户测试的版本不得进入主运行镜像。

## 参考

- [LangGraph on PyPI](https://pypi.org/project/langgraph/)
- [LangGraph PostgreSQL Checkpoint on PyPI](https://pypi.org/project/langgraph-checkpoint-postgres/)
- [LlamaIndex Core on PyPI](https://pypi.org/project/llama-index-core/)
- [Mem0 on PyPI](https://pypi.org/project/mem0ai/)
- [BM25S on PyPI](https://pypi.org/project/bm25s/)
- [markdown-it-py on PyPI](https://pypi.org/project/markdown-it-py/)
