# NoteFlow 步骤 6～7 完成报告

执行日期：2026-07-17（Asia/Shanghai）

## 结论

《NoteFlow 完全体实施执行计划》的步骤 6、7 已完成。现有前端 UI、旧 Agent 编排、RAG 与 Memory 仍是默认生产路径；本次只建立可靠数据面和统一运行时边界，没有把 LangGraph/LlamaIndex/Mem0 切入用户流量。

| 步骤 | 状态 | 结果 |
|---|---|---|
| 6：数据库、Checkpoint、Outbox | 已完成 | Alembic `20260717_0005`、双层 Checkpoint、Outbox、RAG 日志/评测表、幂等键、索引任务抢占与崩溃恢复 |
| 7：RuntimeEvent、SSE、可观测性 | 已完成 | 统一事件和 SSE Adapter、四级关联 ID、结构化脱敏日志、领域 metrics、流顺序/结束/重连测试 |

## 步骤 6：数据面

### 新增应用表

- `integration_outbox`：数据库提交后的外部集成任务，包含唯一 `idempotency_key`、状态、可执行时间、claim owner、心跳、尝试次数、错误码、trace 和完成时间。
- `rag_query_logs`：只保存 query hash、截断 preview、provider/mode、候选/结果数、耗时和 trace/run 关联。
- `rag_eval_cases`：带 dataset version 的固定评测用例。
- `rag_eval_runs`：评测运行参数、结果、指标、状态和 trace。

### 扩展字段

- Note/草稿/编辑/Memory/Agent Run 增加幂等入口，唯一索引均以 `user_id` 为作用域。
- `note_index_jobs` 增加 `claim_owner/claimed_at/heartbeat_at/error_code/source_version` 和 parser/chunker/embedding/graph 版本。
- `notes.index_version` 记录最后成功索引的源码版本。
- `user_memories` 增加 external provider/id、canonical key、memory layer、expiry、source ref、provider metadata。
- Agent Run/Step/Tool Trace 增加 request/trace 关联。

### 双层 Checkpoint

- `agent_checkpoints`：NoteFlow 业务任务、用户确认、草稿/编辑工作记忆；由应用模型和 Service 管理。
- `checkpoint_migrations/checkpoints/checkpoint_blobs/checkpoint_writes`：严格按 `langgraph-checkpoint-postgres 3.1.0` 的官方 schema 建立，由 LangGraph saver 管理，不进入 SQLAlchemy 业务模型。
- 两层表不互相替代，也不共享业务语义。官方实现参考：[langgraph checkpoint postgres](https://github.com/langchain-ai/langgraph/blob/main/libs/checkpoint-postgres/langgraph/checkpoint/postgres/__init__.py)。

### Outbox 与 Worker

Memory 的 create/update/delete 在同一个 PostgreSQL 事务中写入 outbox；提交后才唤醒 worker。`legacy/none` provider 是受控 no-op，Mem0 未启用时不会改变现有数据真相源。相同业务版本重复写入只得到一条 outbox；processing 任务心跳超时后可被新 worker 重新 claim。

索引 Worker 已拆分“短事务 claim”和“执行事务”，持久化 worker owner、claim 时间和 heartbeat。进程在 claim 后崩溃，任务可在 stale timeout 后恢复；失败继续沿用既有有界重试。

## 步骤 7：运行时与可观测性

- `RuntimeEvent.from_wire/to_wire` 统一 session、run、context、checkpoint、tool action、choices、done 和 error 的内部边界。
- `SSEStreamAdapter` 保持当前 `data: <JSON>\n\n` 和 `data: [DONE]\n\n` 字节协议，保证单一结束，并拒绝结束后的事件。
- Router 的兼容 `_sse_format` 已委托给统一 encoder；`SSE_ADAPTER_ENABLED=false` 是即时回退开关。
- HTTP 生成 `request_id/trace_id`，Agent Stream 继续绑定 `session_id/run_id`；Run、Step、Tool Trace、RAG Log、Outbox 共用关联 ID。
- JSON 日志对 Authorization、Cookie、password、secret、token、API key 自动遮蔽，普通长字符串截断。
- `/api/metrics` 在原 API route/status 指标之外增加 `api/agent/rag/index/memory/provider/outbox` operation、failure 和平均耗时。

## 数据库验证

- 主库：`20260715_0004 → 20260717_0005` 成功。
- 核心数据升级前后相同：users 3、notes 16、user_memories 12、agent_runs 42、agent_checkpoints 11。
- 对账：重复幂等键 0、孤儿 outbox owner 0、官方 checkpoint migration 版本 10/10。
- 空库：从 base 升到 head、降到 0004、再升到 head 成功。
- 真实数据副本：从 0005 降到 0004、再升到 0005 成功，核心行数完全不变。
- 临时验证数据库和 dump 已删除，主库保持 0005。

## 测试结果

- 后端 unittest：71 tests，65 通过，6 个真实 DB 测试在默认模式按设计跳过。
- 真实 PostgreSQL：6/6 通过，包括 runtime table 对账、pgvector/HNSW、Outbox 幂等与 stale recovery、索引回归、跨用户隔离。
- Runtime/SSE 专项：6/6 通过，包括 wire round-trip、单一 `[DONE]`、失败顺序、断线/重连边界、legacy rollback 字节兼容、脱敏与 provider metrics。
- 全量质量门禁结果另见 `quality/reports/archive/steps-6-7-final.*`。

## 回滚与边界

- 运行时回滚：关闭 `OUTBOX_WORKER_ENABLED`，将 `SSE_ADAPTER_ENABLED=false`；旧 Agent/RAG/Memory provider 默认值无需更改。
- 数据库回滚：0005 downgrade 已在空库和真实数据副本验证；主库不应在有新 outbox/RAG eval 数据后无备份直接降级。
- 尚未完成：LangGraph 主图、LlamaIndex RAG v2、Mem0 实际 adapter；它们属于后续步骤 8～18。

## 下一步

按计划进入步骤 8～9：LangGraph 只读主图 PoC 与 Shadow。继续保持 `AGENT_RUNTIME=legacy`、`RAG_PROVIDER=legacy`、`MEMORY_PROVIDER=legacy` 和灰度 0，直到 Shadow 门禁通过。
