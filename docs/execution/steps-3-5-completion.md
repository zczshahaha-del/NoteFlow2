# NoteFlow 步骤 3～5 完成报告

执行日期：2026-07-17（Asia/Shanghai）

## 结论

《NoteFlow 完全体实施执行计划》的步骤 3、4、5 已执行。新 AI 框架尚未切入生产流量；默认 API、SSE、前端 UI 与数据库结构不变。

| 步骤 | 状态 | 结果 |
|---|---|---|
| 3：依赖与 PoC | 已完成 | Python 3.12 隔离镜像、精确锁定、Provider/Checkpoint/RAG/Memory 关键兼容性通过 |
| 4：目录与契约 | 已完成 | 8 个目标模块、Provider/Tool/Runtime/RAG 类型契约、legacy adapters 与 flags 已建立 |
| 5：Service/Repository | 已完成 | 7 个 owned Repository、4 个领域 Service/facade、主要 Router SQL 迁移和真实权限测试已建立 |

## 步骤 3

- 新增 `server/requirements-ai.txt` 精确锁定 AI 依赖。
- 新增多阶段 Python 3.12 PoC 镜像；编译工具只存在于 builder，不进入运行层。
- 新增本地/Docker 可重复脚本和真实 Provider 检查。
- LangGraph PostgreSQL Checkpoint 在一次性数据库中完成 setup、保存、连接关闭、重新连接和恢复；数据库随后已删除。
- DeepSeek 当前配置 `deepseek-v4-pro` 的流式、JSON、usage 与缺少凭证受控错误通过。
- DashScope `text-embedding-v4` 批量 2 条、1024 维通过。
- 完整版本、参数与数据映射见 `docs/poc/ai-framework-compatibility.md`。

## 步骤 4

- 新建 `agent/rag/memory/tools/providers/repositories/workers/observability`。
- 定义 Chat、Embedding、Reranker、Vector Store、Memory Provider Protocol。
- 定义 RagService、ToolContext、ToolResult、SourceRef、RuntimeEvent、AgentState 和稳定错误码。
- Tool 参数中的 `user_id/userId` 被拒绝，身份只能来自认证上下文。
- legacy adapter 复用当前实现，没有复制一套算法。
- 所有新实现 flags 默认关闭，灰度为 0。

## 步骤 5

- 建立 Note、Draft、Edit、Attachment、Memory、Run、IndexJob Repository。
- `ai.py`、`agent.py`、`attachments.py`、`memories.py`、`notes.py`、`drafts.py`、`edits.py` 已移除直接 SQL 查询。
- AI 上下文、Memory CRUD、Attachment 生命周期和 Run cancel 进入 Service。
- Note/Draft/Edit 的旧状态机继续作为兼容 facade，后续 LangGraph Tool 只能走 Service，不能调用 Router/ORM。
- OpenAPI 机器比较完全一致：71 paths、45 schemas。
- 迁移映射和回滚见 `docs/architecture/service-repository-migration.md`。

## 验证记录

- 隔离 AI Docker PoC：通过。
- LangGraph PostgreSQL restart restore：通过。
- DeepSeek/DashScope 真实 Provider：通过。
- Python compileall：通过。
- 后端独立单元测试：64 tests，其中 5 个需真实数据库的测试在默认模式跳过，其余通过。
- 架构合约：9/9 通过。
- 真实 PostgreSQL 集成：5/5 通过。
- OpenAPI：字节语义对象比较一致。
- 最终全量质量门禁结果记录在 `quality/reports/steps-3-5-final.*`。

## 已知边界

- 本步骤只完成新运行时的安全接入面，不启用 LangGraph/LlamaIndex/Mem0 生产实现。
- `mem0ai` 传递安装 `qdrant-client`，但配置、容器和运行时均不使用 Qdrant。
- 对象存储与 PostgreSQL 的原子协调需等待步骤 6～7 Outbox。
- Note/Draft/Edit 旧路由的写编排保留为 legacy facade；新 Tool 入口已被架构测试禁止直接依赖 ORM。

## 下一步

按计划进入步骤 6～7：数据库演进、LangGraph Checkpoint 正式表策略、Outbox/SSE 与可观测性；生产 flags 仍保持 `legacy`，直到步骤 8～9 Shadow 通过。
