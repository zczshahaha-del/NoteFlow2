# NoteFlow Service / Repository 迁移说明

## 目标边界

公开 API、OpenAPI 和 SSE 保持不变，内部调用固定为：

```text
Router / Agent Tool
        ↓
Application / Domain Service
        ↓
Repository + Legacy algorithm adapter
        ↓
PostgreSQL / Redis / Object Storage / Provider
```

模型不能提交 `user_id`。Tool 只接受由认证层创建的 `ToolContext`，Service 和 Repository 再把该身份带入所有数据查询。

## 新模块职责

| 目录 | 职责 | 当前状态 |
|---|---|---|
| `app/agent/` | AgentState、RuntimeEvent、稳定错误码 | 契约已建立 |
| `app/rag/` | RagService 协议与 legacy RAG adapter | 已建立 |
| `app/memory/` | Memory 服务边界与 legacy adapter | 已建立 |
| `app/tools/` | ToolContext、ToolResult、SourceRef | 已建立，禁止 ORM 依赖 |
| `app/providers/` | Chat/Embedding/Reranker/Vector/Memory Provider 协议 | 已建立 |
| `app/repositories/` | 所有权约束的数据访问 | 7 个 Repository 已建立 |
| `app/workers/` | 后续 worker 入口 | 骨架已建立 |
| `app/observability/` | 兼容现有观测能力的入口 | facade 已建立 |

## Legacy 到目标模块映射

| 旧实现 | 新入口 | 迁移策略 |
|---|---|---|
| `services.ai.stream_chat` | `ChatModelProvider` | `LegacyChatModelProvider` 保持原 SSE chunk |
| `services.embeddings.embed_texts` | `EmbeddingProvider` | `LegacyEmbeddingProvider` |
| `services.note_library` | `RagService` / `VectorStoreProvider` | legacy adapter，不复制算法 |
| `app.memory.domain` | `MemoryProvider` / `MemoryService` | 领域规则集中在 Memory 包，写入只走 Service |
| Agent 运行与 checkpoint services | `RunService` / `RunRepository` | 取消和 scoped read 已迁移 |
| Router 内附件 SQL/存储流程 | `AttachmentService` / `AttachmentRepository` | 已迁移 |
| Router 内 Memory CRUD | `MemoryService` / `MemoryRepository` | 已迁移 |
| Router 内 Note/Draft/Edit 查询 | 对应 Repository | SQL 已迁移，旧 Router 保留兼容编排 facade |
| 索引任务查询 | `IndexJobRepository` | 已迁移 |

## Repository 所有权规则

以下 Repository 的公开查询均要求第二个参数为 `user_id`：

- `NoteRepository`
- `DraftRepository`
- `EditRepository`
- `AttachmentRepository`
- `MemoryRepository`
- `RunRepository`
- `IndexJobRepository`

空 `user_id` 立即失败；SQL 同时约束资源 id 与 `user_id`。唯一例外是附件签名 URL 验证后的 `get_by_signed_id`：Router 必须先通过 HMAC 常量时间比较，Repository 方法名和文档明确标记该边界。

## 事务边界

- Memory create/update/delete/search-used 由 `MemoryService` 单 session 提交。
- Attachment create/read/delete 由 `AttachmentService` 管理数据库与对象存储调用。
- Run cancel 与等待确认 Checkpoint 的取消由 `RunService` 单事务提交。
- AI chat 上下文准备由 `AIApplicationService` 组合 Memory、RAG 与 Note Repository。
- Note/Draft/Edit 的旧公开路由仍作为兼容 facade 保留原有显式事务和状态机；其 SQL 查询已全部迁入 Repository。新 Agent Tool 不允许调用这些 Router，也不允许直接操作 ORM，只能进入 Service。

附件的数据库与本地对象存储还不是原子事务；步骤 6～7 的 Outbox 会解决提交后清理和重试。本步骤不伪装跨系统事务，也不改变现有行为。

## Feature flags

| Flag | 当前默认 | 后续值 |
|---|---|---|
| `AGENT_RUNTIME` | `legacy` | `langgraph` |
| `RAG_PROVIDER` | `legacy` | `llamaindex` |
| `MEMORY_PROVIDER` | `legacy` | `mem0` / `none` |
| `RERANKER_PROVIDER` | `legacy` | 后续 provider |
| `VECTOR_STORE_PROVIDER` | `legacy` | `llamaindex` |
| `AGENT_SHADOW_ENABLED` | `false` | Shadow 阶段开启 |
| `RAG_SHADOW_ENABLED` | `false` | Shadow 阶段开启 |
| `MEMORY_SHADOW_ENABLED` | `false` | Shadow 阶段开启 |
| `AI_CANARY_PERCENT` | `0` | 验收后渐进提高 |

未接线的新值会显式报错，不能静默切换或半启用。

## 自动约束

`server/tests/test_architecture_contracts.py` 固定以下规则：

- legacy flags 是安全默认。
- Legacy adapters 实现全部 Provider Protocol。
- 模型参数不能覆盖 ToolContext 的用户身份。
- Tool 层不能导入数据库、ORM 或 SQLAlchemy。
- 已迁移 Router 不能重新嵌入 SQL 查询。
- Repository 的拥有者查询必须显式带 `user_id`。

`server/tests/test_database_integration.py` 使用真实 PostgreSQL 验证 Note、Draft、Edit、Attachment、Memory、Run 和 IndexJob 跨用户隔离，并验证跨用户 Memory 修改与 Run 取消不会改变所有者数据。

## 回滚

- 所有 flags 保持 `legacy` 即使用旧算法与旧运行时。
- Legacy service 文件和公开 Router 均未删除。
- 本步骤没有数据库迁移。
- 若新 adapter 有问题，可移除 Provider registry 的路由调用并直接恢复旧 service 调用，OpenAPI/SSE 无需改变。
