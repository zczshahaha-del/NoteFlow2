# NoteFlow 完全体实施执行计划

> 文档性质：后续逐步实施的唯一执行顺序与验收清单  
> 依据文档：`NoteFlow_统一架构与功能设计说明书_v2.0_整合版.docx`  
> 当前目标：在不推翻现有前端 UI 和稳定业务能力的前提下，把 NoteFlow 完成到可正式运行、可测试、可灰度、可回滚、可维护的完全体。  
> 核心选型：LangGraph 全局编排、LlamaIndex RAG v2、Mem0 OSS 长期记忆、PostgreSQL + pgvector、Redis、FastAPI、React/Tiptap、SSE。

---

## 1. 这份计划怎么使用

后续实施严格按本文档的步骤编号推进。原则上不跨阶段开发；确需提前做的工作，只允许是不会改变外部行为的接口、测试或只读基础设施。

每一步都使用同一执行闭环：

1. 读取本步骤范围内的现有代码、测试和数据库迁移，确认用户已有修改。
2. 在修改前运行本步骤要求的基线测试，记录失败项，不把旧失败误认为新回归。
3. 先补接口、适配器或测试，再移动/替换实现，避免一次性重写。
4. 所有数据库变化使用 Alembic；所有外部能力通过 Provider/Service 接口接入。
5. 完成目标代码后先跑定向测试，再跑全量门禁。
6. 输出本步骤的修改文件、测试结果、已知风险、回滚方式和下一步入口。
7. 只有“完成门槛”全部满足，才进入下一步。

### 1.1 每一步的完成状态

- `未开始`：尚未修改代码。
- `进行中`：正在实现或验证，不能并行开始有依赖的下一步。
- `待验收`：代码已完成，但门禁、压测或人工检查尚未全部通过。
- `已完成`：所有产出、测试、数据验证和回滚检查均通过。
- `阻塞`：外部服务、密钥、产品决策或不可恢复环境问题阻止继续。

### 1.2 统一回滚规则

- 功能切换必须有 feature flag 或 Provider 选择，禁止通过临时改代码回滚。
- 数据库迁移必须可前滚和可回滚；涉及数据转换时先备份、再对账。
- 新索引、向量和 Mem0 数据均视为可重建派生数据，不覆盖笔记正文真相源。
- 正式笔记、版本、草稿、编辑预览、聊天记录和用户可见记忆不得无备份迁移。
- Shadow 阶段的新实现不影响用户结果，只记录差异和指标。

---

## 2. 完全体的最终定义

当且仅当以下能力全部满足，NoteFlow 才算完成“完全体”：

### 2.1 产品能力

- 账户、会话、笔记、分类/文件夹、搜索、附件、版本、软删除与恢复完整可用。
- Markdown/Tiptap 编辑稳定，代码块可编辑、可选择、可复制、可切换语言。
- AI 支持普通对话、当前笔记上下文、全库问笔记、生成草稿、修改预览和长期记忆。
- 普通对话不会偷偷切换到全库搜索；全库问答有真实来源，无证据时不编造。
- AI 写入正式笔记前有预览/确认、版本保护、幂等、取消和恢复。
- 用户能够查看、修改、删除、关闭长期记忆。

### 2.2 架构能力

- LangGraph 负责全局状态、路由、子图、interrupt、resume、checkpoint 和恢复。
- LlamaIndex 只作为可调用的 RAG 模块，不控制全局对话和业务写入。
- Mem0 OSS 负责长期记忆召回与更新能力，NoteFlow 保留策略、审计和用户控制。
- PostgreSQL 是业务真相源，pgvector 承载向量；Redis 只承担短暂状态、缓存、限流和锁。
- Router 只处理传输职责，业务规则在 Service，数据库访问在 Repository。
- 所有 AI 工具和 Provider 都有类型化输入输出、超时、重试、降级和 trace。

### 2.3 质量能力

- 前端、API、数据库、Agent、RAG、Memory 和 E2E 测试均形成稳定门禁。
- 权限隔离测试 100% 通过，不发生跨用户 note/chunk/vector/memory/run 泄漏。
- RAG 固定评测集的 Recall@K、MRR、nDCG 和引用覆盖率达到项目门槛。
- Agent interrupt/resume、取消、幂等和进程重启恢复测试 100% 通过。
- P95 首 token、检索、重排和 API 延迟在预算内，外部服务失败可以受控降级。
- 生产具备结构化日志、metrics、trace、备份恢复、迁移回滚和告警。

---

## 3. 总体执行顺序

| 步骤 | 阶段 | 核心结果 | 是否改变用户行为 |
|---|---|---|---|
| 0 | 执行前保护 | 工作区、数据和配置可恢复 | 否 |
| 1 | 冻结当前基线 | 当前能力、API、SSE、数据库和测试有事实清单 | 否 |
| 2 | 完善质量门禁 | 一键测试、固定评测集、性能与安全基线 | 否 |
| 3 | 依赖与 PoC 固化 | 框架版本和关键参数确定 | 否 |
| 4 | 建立目标骨架与契约 | Provider、Tool、RuntimeEvent、目录边界可用 | 否 |
| 5 | 拆分 Service/Repository | 旧逻辑从 Router 解耦且行为不变 | 否 |
| 6 | 数据库与异步基础 | checkpoint、outbox、RAG 评测和 trace 表就绪 | 否 |
| 7 | 统一可观测性与 SSE | 新旧运行时都映射到稳定前端事件 | 否 |
| 8 | LangGraph 只读 PoC | 普通对话/问笔记图可运行和恢复 | Shadow |
| 9 | LangGraph Shadow | 与 legacy 双跑并比较路由和事件 | Shadow |
| 10 | RAG 索引 v2 | AST 解析、结构化 chunk、增量索引 | 后台 Shadow |
| 11 | 混合检索 v2 | Title + BM25 + Vector + 权限前置 + RRF | Shadow |
| 12 | Reranker/引用/评测 | 可解释、可降级、可评测的完整 RAG | Shadow/灰度 |
| 13 | 只读 Agent/RAG 切换 | 普通聊天与问笔记默认走新链路 | 是，可回滚 |
| 14 | 草稿子图 | 生成、确认、暂停、恢复和保存完整 | 是，可回滚 |
| 15 | 编辑子图 | 差异预览、确认、冲突、版本与局部索引完整 | 是，可回滚 |
| 16 | Mem0 Shadow | 长期记忆双写/双读对照与安全策略完整 | Shadow |
| 17 | Mem0 灰度切换 | 长期记忆默认新实现且用户可管理 | 是，可回滚 |
| 18 | 全系统安全与韧性 | 限流、熔断、降级、备份和故障演练 | 小范围改善 |
| 19 | 全量 E2E 与性能验收 | 功能、质量、安全和成本达到门槛 | 否 |
| 20 | 灰度发布与默认切换 | 新架构成为默认，legacy 保留一个周期 | 是 |
| 21 | 清理与最终交付 | 删除重复逻辑、补齐文档、完全体验收 | 否 |

---

## 4. 分步执行说明

### 步骤 0：执行前保护与工作区确认

#### 目标

在任何架构修改前确保代码、配置和数据库都可以恢复，避免后续重构覆盖用户已有工作。

#### 我会怎么执行

1. 检查工作区所有已修改、未跟踪和忽略文件，区分用户修改与本次任务文件。
2. 记录当前 Node、Python、PostgreSQL、Redis、Docker 和系统版本。
3. 检查 `server/.env`、根目录环境配置和 Docker 配置，但不在日志或文档中输出密钥。
4. 对 PostgreSQL 做结构和数据备份，记录恢复命令与校验结果。
5. 记录 pgvector 扩展版本、当前迁移版本和全部表数量。
6. 检查对象存储/本地附件目录，确认备份范围。
7. 建立后续执行日志，按步骤记录变更、测试和回滚点。

#### 产出物

- 当前工作区变更清单。
- 环境版本清单。
- 数据库与附件备份。
- 恢复验证记录。

#### 验证

- 备份文件存在且可读取。
- Alembic 当前 revision 可确认。
- 在隔离数据库中至少完成一次结构恢复或恢复抽样验证。

#### 完成门槛

- 代码和数据库均有明确恢复路径。
- 不存在来源不明、可能被覆盖的用户修改。

#### 回滚

本步骤只读为主；若备份失败，停止后续工作，不修改业务代码。

---

### 步骤 1：冻结当前系统事实基线

#### 目标

明确“现在已经有什么”，把当前行为固定为后续重构必须保持的兼容基线。

#### 我会怎么执行

1. 盘点前端组件、store slices、API service、编辑器 codec、SSE 消费和离线逻辑。
2. 盘点 FastAPI routers、services、models、schemas、workers 和现有测试。
3. 导出当前公开 API：路径、方法、请求、响应、状态码、认证方式。
4. 导出当前 SSE 类型、字段、顺序、结束标记和错误行为。
5. 导出数据库表、字段、索引、外键、唯一约束和软删除规则。
6. 确认当前实际模型配置：本机 `deepseek-v4-pro`、代码/容器 fallback `deepseek-chat` 的差异。
7. 确认现有 RAG、Memory、草稿、编辑预览、checkpoint 和 worker 的真实开启状态。
8. 把能力标记为“已实现、保留改造、目标新增、后续扩展”。

#### 产出物

- `docs/current-baseline/` 下的 API、SSE、数据库和能力基线。
- 当前模型与 Provider 配置矩阵。
- 当前测试命令和已知失败清单。

#### 验证

- API 文档与真实路由一致。
- SSE 基线可以由现有前端测试消费。
- 数据库模型与 Alembic/真实数据库一致。

#### 完成门槛

- 后续任何功能都能判断是“新增”还是“回归”。
- 当前 UI 和业务行为具有可执行的基线测试或明确人工验收步骤。

#### 回滚

只新增文档和测试，不改变生产行为。

---

### 步骤 2：完善一键质量门禁与评测基线

#### 目标

先建立能发现回归的测试系统，再开始迁移框架和业务逻辑。

#### 我会怎么执行

1. 整理并统一现有前端测试入口：编辑器往返、代码块、选区、输入法、离线冲突、PWA、目录和 AI 面板。
2. 整理后端测试入口：认证、安全、API 合约、索引队列、RAG、Memory、草稿、编辑和 Runtime E2E。
3. 增加缺失的数据库集成测试，使用真实 PostgreSQL + pgvector，而不是只用 mock。
4. 建立固定 RAG 评测集：中文短问、英文缩写、代码符号、同名笔记、过期版本、无答案和跨用户场景。
5. 建立固定 Memory 安全集：明确记住、临时指令、敏感信息、第三方信息、纠正、删除和关闭开关。
6. 记录 legacy 检索的 Recall@K、MRR、nDCG、无结果率、引用覆盖率和延迟。
7. 记录 API、SSE、Embedding、首 token 和 worker 的 p50/p95。
8. 建立一条全量验证命令，失败时明确是前端、后端、数据库、RAG 还是 E2E。

#### 产出物

- 可重复执行的测试总入口。
- RAG 固定评测数据与基线报告。
- Memory 安全测试集。
- 性能基线报告。

#### 验证

- 连续运行两次测试结果一致。
- 评测集可在空缓存和热缓存两种条件运行。
- 跨用户泄漏用例必须在当前和目标实现中均为 0。

#### 完成门槛

- 所有现有能力都有自动测试或清晰人工门禁。
- 已知失败被记录，新增修改不能扩大失败范围。

#### 回滚

新增测试和脚本不改变用户行为；有不稳定测试时先隔离原因，不删除测试掩盖问题。

---

### 步骤 3：框架依赖、版本与关键参数 PoC

#### 目标

在进入正式重构前，用最小 PoC 固定兼容版本和关键实现参数。

#### 我会怎么执行

1. 建立独立 PoC 分支或目录，不直接接入生产路由。
2. 验证以下依赖与当前 Python/FastAPI/SQLAlchemy 兼容：
   - `langgraph`
   - `langgraph-checkpoint-postgres`
   - `langchain-core` 或最小自有模型适配器
   - `llama-index-core`
   - LlamaIndex PostgreSQL/pgvector adapter
   - LlamaIndex BM25 retriever、`bm25s`
   - `jieba` 或可替换中文 tokenizer
   - `markdown-it-py`/CommonMark AST parser
   - `mem0ai`
3. 验证 DeepSeek OpenAI-compatible 流式调用、结构化输出、超时与 token usage。
4. 验证 DashScope `text-embedding-v4`、1024 维和批量请求。
5. 验证 LangGraph PostgreSQL checkpointer 的建表、保存、恢复和进程重启。
6. 验证 LlamaIndex Node 与现有 `note_chunks/note_embeddings` 的适配方式。
7. 验证 Mem0 使用 PostgreSQL/pgvector 独立 namespace，不新增 Qdrant。
8. 用小评测集确定第一版参数范围：chunk、overlap、candidate K、Top K、RRF、rerank timeout、BM25 tokenizer。
9. 锁定依赖精确版本和升级策略。

#### 产出物

- `docs/poc/ai-framework-compatibility.md`。
- 后端 AI 依赖锁定文件。
- 第一版参数配置和选择理由。
- PoC 测试脚本。

#### 验证

- PoC 可以在本地和 Docker 中重复运行。
- 不依赖 Qdrant 或额外第二真相源。
- 断开任一外部 Provider 后能返回受控错误或降级。

#### 完成门槛

- 所有框架版本兼容，关键 PoC 通过。
- 未解决的框架问题不会被带入主业务代码。

#### 回滚

PoC 与生产路径隔离；失败可直接移除 PoC 依赖，不影响现有应用。

---

### 步骤 4：建立目标目录骨架和类型化契约

#### 目标

先定义清晰边界，让 legacy 和新实现都能接入同一接口。

#### 我会怎么执行

1. 创建目标目录骨架：`agent/`、`rag/`、`memory/`、`tools/`、`providers/`、`repositories/`、`workers/`、`observability/`。
2. 定义 `ChatModelProvider`、`EmbeddingProvider`、`RerankerProvider`、`VectorStoreProvider` 和 `MemoryProvider`。
3. 定义 `RagService`、`ToolResult`、`SourceRef`、`RuntimeEvent`、`AgentState` 和稳定错误码。
4. 把 user_id 规定为从认证上下文注入，工具 schema 不允许模型指定其他用户。
5. 建立 legacy adapter：当前 agent、note_library、embedding、memory 都能通过新接口调用。
6. 增加 Provider/Tool 合约测试，验证 mock 与 legacy adapter 一致。
7. 增加 feature flags：`AGENT_RUNTIME`、`RAG_PROVIDER`、`MEMORY_PROVIDER`、shadow 和灰度配置。

#### 产出物

- 新模块目录与协议/抽象类。
- Legacy adapters。
- 类型化 schema 与合约测试。
- Feature flag 配置层。

#### 验证

- 全部 Provider 选择为 `legacy` 时现有 API/SSE 和测试结果不变。
- 新目录没有复制业务实现，只包含接口、适配器和必要基础代码。

#### 完成门槛

- 后续模块可以通过稳定接口替换，不需要修改前端或公开 API。
- Router、Agent 和 Provider 不直接共享任意 dict。

#### 回滚

将 feature flags 保持为 `legacy`；新接口未被外部用户依赖时可以独立回退。

---

### 步骤 5：拆分领域 Service 和 Repository

#### 目标

把当前 Router 和大 Service 中的 SQL、业务规则、AI 编排拆开，为 LangGraph 和 LlamaIndex 提供安全工具入口。

#### 我会怎么执行

1. 从 `routers/agent.py`、`routers/ai.py` 和其他 routers 中提取可搬出的 SQL 与长流程。
2. 建立 Note、Draft、Edit、Attachment、Memory、Run、IndexJob 等 Repository。
3. 每个 Repository 查询强制接收 `user_id`，并在 SQL 层约束所有权与删除状态。
4. 建立领域 Service，事务边界只放在 Service，不让 Tool 跨多个隐式 session。
5. 把当前 `note_library`、`markdown_index`、`embedding_index`、`agent_runtime` 等按职责包进新 Service/adapter。
6. 保留旧模块 facade，逐个路由迁移，不一次性删除旧文件。
7. 为每次迁移增加 API/Repository 回归测试。

#### 产出物

- 明确的 Service/Repository 边界。
- 旧模块到新模块的迁移映射。
- 数据权限与事务集成测试。

#### 验证

- 公开 API 和 SSE 不变。
- Router 不再包含复杂 SQL、RAG 算法或长期流程。
- 跨用户读取、修改、删除和索引查询全部被数据库条件拒绝。

#### 完成门槛

- Agent 工具只能调用 Service，不能直接操作 ORM。
- 所有主要数据写入有明确事务和幂等入口。

#### 回滚

旧 facade 保留并可切回原实现；数据库结构本步骤原则上不变。

---

### 步骤 6：数据库迁移、双层 Checkpoint 与 Outbox

> 执行状态：已于 2026-07-17 完成。实现与验证记录见 `docs/execution/steps-6-7-completion.md`。

#### 目标

建立新架构所需的可靠状态、索引、评测、trace 和最终一致性基础。

#### 我会怎么执行

1. 对照现有表确认哪些已经存在，禁止重复建模。
2. 增加或扩展：
   - `agent_runs/agent_steps/agent_tool_traces`
   - `agent_checkpoints` 业务任务状态
   - LangGraph 官方 PostgreSQL checkpoint 表
   - `integration_outbox`
   - `rag_query_logs`
   - `rag_eval_cases/rag_eval_runs`
   - 索引版本、parser/chunker/embedding/graph version 字段
   - Mem0 external provider/id、canonical key、memory layer、过期与来源字段
3. 增加唯一键和幂等键，防止重复保存笔记、应用编辑或写记忆。
4. 增加索引任务的 owner、claim、heartbeat、retry、error code 和 source version。
5. 编写 Alembic 前滚、回滚和数据对账脚本。
6. 建立 outbox worker，保证数据库提交后再同步索引和 Mem0。
7. 验证旧数据不迁移也能继续由 legacy 路径读取。

#### 产出物

- Alembic migrations。
- 数据对账和恢复脚本。
- Outbox 与 worker 基础。
- 新表/字段数据字典。

#### 验证

- 空库可以从零升级到最新。
- 现有数据库可以无数据丢失升级并回滚。
- 同一幂等请求重复执行不产生重复副作用。
- worker 崩溃重启后任务可继续或安全重试。

#### 完成门槛

- 所有状态都有唯一真相源和明确生命周期。
- LangGraph checkpoint 与业务 checkpoint 表和语义分离。

#### 回滚

先关新 worker/feature flag，再执行兼容回滚；派生索引可清空重建，业务数据不可直接删除。

---

### 步骤 7：统一 RuntimeEvent、SSE Adapter 和可观测性

> 执行状态：已于 2026-07-17 完成。实现与验证记录见 `docs/execution/steps-6-7-completion.md`。

#### 目标

让 legacy 与未来 LangGraph 使用同一内部事件模型，同时保持前端现有 SSE 契约。

#### 我会怎么执行

1. 定义内部 `RuntimeEvent`：session、run、tool trace、context、checkpoint、tool action、choices、done、error。
2. 建立 SSE Adapter，把内部事件映射到前端现有事件和 `[DONE]`。
3. 为每个请求生成 request_id、trace_id、session_id、run_id。
4. 让 router、service、graph node、tool、SQL、Provider 和 worker 共享 trace 关联。
5. 日志统一为结构化 JSON，对 Token、Cookie、密码、API Key、正文和敏感输入做脱敏/截断。
6. 增加基础 metrics：API、Agent、RAG、Index、Memory、Provider。
7. 增加 SSE 顺序、断线、重连、错误和结束标记测试。

#### 产出物

- RuntimeEvent schema。
- SSE Adapter。
- 结构化日志、trace 和 metrics 基础。
- 前后端 SSE 合约测试。

#### 验证

- Legacy 路径经 Adapter 后前端表现完全一致。
- 每条流无论成功、取消或失败都以受控结束事件和 `[DONE]` 收口。
- 日志和 trace 中无原始密钥或完整敏感数据。

#### 完成门槛

- 后续 LangGraph 不需要直接了解前端事件细节。
- 任一错误可以定位到 run/node/tool/provider。

#### 回滚

保留原 SSE 适配入口；通过 flag 切回旧 emitter。

---

### 步骤 8：LangGraph 只读主图 PoC

> 执行状态：已于 2026-07-17 完成。实现与验证记录见 `docs/execution/steps-8-9-completion.md`。

#### 目标

先实现没有副作用的普通聊天和问笔记图，验证 state、routing、streaming 和 checkpoint。

#### 我会怎么执行

1. 建立 `AgentState`，只保存必要字段和结构化结果，不塞入 ORM 对象。
2. 建立主节点：ingress、policy、planner/router、memory recall、rag search、answer、finalize、error。
3. 建立 `general_chat` 与 `note_qa` 只读子图。
4. 把前端显式 `chat/ask_notes` 模式作为硬约束，禁止模型偷换。
5. 通过 Tool 调用现有 Service，不允许图节点直接写 SQL。
6. 接入 PostgreSQL checkpointer，验证同一 thread/run 的恢复。
7. 接入 RuntimeEvent 与 SSE Adapter，但只在测试路由输出。
8. 使用 mock 模型做确定性 graph 测试，再用真实 DeepSeek sandbox 验证流式行为。

#### 产出物

- LangGraph 主图和只读子图。
- AgentState、routing 和 policy 测试。
- Checkpointer 恢复测试。

#### 验证

- `chat` 永远不自动搜索全库。
- `ask_notes` 必须调用 RAG Tool，无来源时返回受控结果。
- 进程重启后只读 run 可从 checkpoint 恢复或正确结束。
- Graph 错误经 SSE Adapter 返回稳定错误码。

#### 完成门槛

- 只读图在隔离入口完整运行，且不产生笔记/记忆副作用。

#### 回滚

生产 `AGENT_RUNTIME` 仍为 legacy；PoC 路由可完全关闭。

---

### 步骤 9：LangGraph Shadow 双跑

> 执行状态：已于 2026-07-17 完成。实现与验证记录见 `docs/execution/steps-8-9-completion.md`。

#### 目标

让同一请求同时执行 legacy planner 与 LangGraph planner，只比较差异，不改变用户结果。

#### 我会怎么执行

1. 用户请求仍由 legacy 返回结果。
2. 后台以相同规范化输入运行 LangGraph，只允许只读工具。
3. 记录 intent、route、tool plan、来源需求、错误和耗时差异。
4. 对显式模式、安全规则和权限规则设置硬性不一致告警。
5. 给 Shadow 设置独立限流、超时和采样率，避免成本翻倍失控。
6. 建立按用户/请求的灰度开关和快速停止开关。
7. 修正差异，直到路由一致率和安全门槛达标。

#### 产出物

- Shadow runner。
- Legacy/Graph 差异报告与指标面板。
- 灰度和停止开关。

#### 验证

- Shadow 不写正式笔记、长期记忆或业务 checkpoint。
- Shadow 失败不影响主回答。
- 权限和模式硬约束差异为 0。

#### 完成门槛

- 只读路由一致率达到设定目标。
- 无跨用户、额外副作用或不可控成本。

#### 回滚

关闭 `LANGGRAPH_SHADOW_ENABLED`，用户路径不受影响。

---

### 步骤 10：RAG v2 索引基础

> 执行状态：已于 2026-07-17 完成。实现与验证记录见 `docs/execution/steps-10-12-completion.md`。

#### 目标

把当前正则/字符串切分升级为 AST 解析、结构化节点和可增量重建索引。

#### 我会怎么执行

1. 使用 CommonMark/`markdown-it-py` AST 解析标题、段落、列表、引用、代码块和表格。
2. 使用 LlamaIndex Markdown NodeParser 或自定义 NodeParser 生成结构化 Node。
3. 设计稳定 node_id：note_id、section path、chunk index、content hash。
4. chunk 初始目标 400-800 tokens、最大 1000、overlap 60-120；最终由评测确定。
5. 代码块、表格和短列表默认保持原子性；标题路径写 metadata，不重复污染正文。
6. 保留 source_version、parser_version、chunker_version、embedding_model/dimension。
7. 实现 content_hash 增量更新：未变化复用向量，变化局部重建，删除标记失效。
8. IndexWorker 使用 claim/heartbeat/幂等/source version 防止旧任务回写。
9. 新旧索引并存，v2 尚未完成时继续使用 legacy fallback。

#### 产出物

- AST parser、chunker、LlamaIndex Node adapter。
- v2 IndexWorker 和增量索引。
- 索引版本与状态诊断接口。
- Parser/chunker 单元与真实笔记回归测试。

#### 验证

- Markdown 往返不改正文。
- 标题层级、代码块、表格和中英文内容节点正确。
- 修改单个 section 只重建相关 chunk。
- 旧任务不能覆盖新 source_version。

#### 完成门槛

- 所有现有笔记可后台重建 v2 索引，失败可诊断和重试。
- 保存笔记不等待外部 Embedding。

#### 回滚

切回 legacy index version；v2 派生表/记录可清理后重建，不改笔记正文。

---

### 步骤 11：权限前置的混合检索

> 执行状态：已于 2026-07-17 完成。实现与验证记录见 `docs/execution/steps-10-12-completion.md`。

#### 目标

完成 Title/Metadata、BM25、Vector 三通道并行召回和 RRF 融合。

#### 我会怎么执行

1. 实现 Query normalize、classify、必要时 Rewrite/Expansion 和缓存。
2. 在每个检索通道查询阶段前置 `user_id`、deleted、source version 和可见范围过滤。
3. Title 通道保留精确标题、前缀、标签、分类、section title 和 pg_trgm。
4. BM25 使用 LlamaIndex BM25 Retriever + `bm25s`，中文 tokenizer 使用 `jieba` 或 PoC 选定实现。
5. Vector 使用 DashScope embedding + PostgreSQL pgvector HNSW cosine。
6. 三通道并行执行，单通道失败不阻断其他通道。
7. 对 note/section/content_hash 去重。
8. 使用 RRF 融合，不直接相加不同尺度原始分数；权重从配置读取。
9. 输出完整 retrieval trace：query、通道、rank、融合分、过滤和降级。

#### 产出物

- Query Understanding/Rewrite。
- Title、BM25、Vector retrievers。
- Permission Filter、dedupe、RRF fusion。
- 检索 trace 和缓存。

#### 验证

- 跨用户同名笔记场景零泄漏。
- 中文术语、英文缩写、代码符号和标题检索明显优于单通道。
- Embedding 失败时 Title + BM25 可用。
- BM25 未就绪时 Title + Vector + trigram fallback 可用。

#### 完成门槛

- 固定评测集 Recall@K/MRR 不低于 legacy 基线。
- 权限测试 100% 通过。

#### 回滚

`RAG_PROVIDER=legacy`；v2 检索继续 Shadow 收集数据但不返回用户。

---

### 步骤 12：Reranker、Context Builder、引用与 RAG 评测

> 执行状态：已于 2026-07-17 完成。实现与验证记录见 `docs/execution/steps-10-12-completion.md`。

#### 目标

完成真正可上线的 RAG v2，而不是只换成 LlamaIndex 框架名。

#### 我会怎么执行

1. 实现 `RerankerProvider`，支持 Cross Encoder 或选定云端 API。
2. 将融合后的 20-50 个候选限制长度后交给 Reranker，最终取 6-10 个来源。
3. 设置超时、批量上限和熔断；失败立即回退 RRF。
4. Context Builder 按 token budget、section 多样性和来源新鲜度构造上下文。
5. 生成稳定 citation id，保存 note、title、section path、chunk、score、source version。
6. 严格问笔记模式只允许依据提供来源回答；无来源时明确说明未找到。
7. 校验生成回答中的引用编号真实存在，未引用来源可折叠但不能伪造。
8. 建立离线 RAG eval runner 和在线指标。
9. 调优 chunk、BM25 tokenizer、RRF 权重、candidate K、Top K 和 rerank timeout。

#### 产出物

- Reranker Provider。
- Context Builder 和 citation formatter。
- 严格模式 Prompt 与引用校验。
- RAG 固定评测、对照报告和参数配置。

#### 验证

- Reranker 成功、超时、异常和不可用均有测试。
- 引用与真实来源一一对应。
- 无证据问题不生成伪笔记答案。
- Recall@K、MRR、nDCG、引用覆盖率、延迟达到门槛。

#### 完成门槛

- RAG v2 在固定评测集显著不劣于 legacy，且权限、引用、降级 100% 通过。

#### 回滚

分别关闭 Rewrite、BM25、Reranker 或整个 v2 Provider；始终保留 legacy fallback。

---

### 步骤 13：只读 Agent 与 RAG 灰度切换

> 工程实施状态（2026-07-17）：已完成；生产默认保持 legacy 与 0% 灰度。详见 `docs/execution/steps-13-15-completion.md`。

#### 目标

让普通聊天和全库问笔记开始真实使用 LangGraph + LlamaIndex，同时保持可快速回滚。

#### 我会怎么执行

1. 先内部用户，再小比例用户启用 `AGENT_RUNTIME=langgraph`。
2. 普通聊天使用 general_chat；显式全库搜索使用 note_qa + RAG v2。
3. 保持前端 UI、API 和 SSE 格式不变。
4. 对每轮记录 graph、RAG、Provider、来源和降级指标。
5. 比较错误率、首 token、检索延迟、无结果率、用户追问/改写率。
6. 自动触发安全回退：权限异常、错误率超阈、checkpoint 故障或 Provider 大面积失败。
7. 灰度稳定后逐步提高比例。

#### 产出物

- 用户级灰度规则。
- 只读新运行时生产指标。
- 自动回退和事故处置步骤。

#### 验证

- 普通聊天/全库搜索不会串模式。
- 前端来源、流式回答和错误提示正常。
- Legacy 切回不需要数据库回滚。

#### 完成门槛

- 只读链路全量或目标比例稳定运行。
- 性能、错误率、安全和 RAG 指标通过。

#### 回滚

按用户或全局切回 legacy Agent/RAG，不删除新 checkpoint 或评测记录。

---

### 步骤 14：AI 草稿 LangGraph 子图

> 工程实施状态（2026-07-17）：已完成；生产默认 `DRAFT_RUNTIME=legacy`。

#### 目标

把生成完整笔记的流程迁入可暂停、可恢复、可取消的草稿子图。

#### 我会怎么执行

1. 保留现有 DraftService、DraftWorker 和前端草稿工作区。
2. 子图按顺序实现：需求检查、clarify、可选 RAG/Memory、大纲、创建 Draft、interrupt、分节生成、assemble、保存。
3. 用户确认前不创建正式笔记。
4. 每个 section 任务有幂等键、状态、版本、重试和取消标记。
5. 进程重启后从 LangGraph checkpoint + 业务 draft checkpoint 恢复。
6. 重复 resume 不重复生成或保存。
7. 保存正式笔记时创建 NoteVersion 与 IndexJob。
8. SSE Adapter 继续驱动现有草稿 UI，不重做界面。

#### 产出物

- Draft subgraph。
- interrupt/resume/cancel/worker 协议。
- 草稿恢复和幂等 E2E。

#### 验证

- 需求不足时先澄清。
- 大纲确认、分节暂停、重启恢复、取消、重试和保存全部可用。
- 重复确认只创建一份正式笔记。

#### 完成门槛

- 草稿全链路 E2E 100% 通过，前端行为无回退。

#### 回滚

`DRAFT_RUNTIME=legacy` 或关闭子图路由；现有 Draft 数据继续由旧 Service 读取。

---

### 步骤 15：AI 编辑 LangGraph 子图

> 工程实施状态（2026-07-17）：已完成；生产默认 `EDIT_RUNTIME=legacy`。

#### 目标

把正式笔记修改做成有范围、有差异预览、有确认、有版本和冲突保护的完整流程。

#### 我会怎么执行

1. 保留现有 EditService、EditPreviewWorkspace 和版本系统。
2. 明确 selection、section 或 whole note 范围；不明确时先 clarify。
3. 生成 `new_content/change_summary/sources`，写 EditPreview，不直接修改正式笔记。
4. 支持用户继续修订预览、恢复旧 revision、取消和应用。
5. interrupt 等待应用确认。
6. 应用前校验 expected version/content hash；冲突时拒绝覆盖并要求重新生成。
7. 应用前写 NoteVersion，应用后触发局部 IndexJob 和 tool trace。
8. 使用幂等键防止重复应用。
9. 当前未保存编辑内容只进入 pageState，不写长期索引和记忆。

#### 产出物

- Edit subgraph。
- 范围解析、预览、冲突和幂等协议。
- 编辑恢复、版本和局部索引 E2E。

#### 验证

- 选区、section、整篇范围正确。
- 原文变化后不能静默覆盖。
- 重复确认不重复写版本或应用修改。
- 取消不改变正式笔记。

#### 完成门槛

- 编辑预览、应用、版本恢复、冲突和索引全部通过。

#### 回滚

切回 legacy Edit flow；EditPreview 和 NoteVersion 数据保持兼容。

---

### 步骤 16：Mem0 长期记忆 Shadow

> 2026-07-17 工程完成：Provider、Policy、Outbox、Shadow 审计、安全集与默认关闭配置已落地；等待内部 Shadow 生产观察。

#### 目标

在不影响用户答案的前提下验证 Mem0 的召回、写入、冲突、删除和安全性。

#### 我会怎么执行

1. 实现 `Mem0Provider`，使用 PostgreSQL/pgvector 独立 schema/namespace。
2. 保留 `LegacyMemoryProvider` 与现有 `user_memories/user_memory_events`。
3. 建立 NoteFlow MemoryPolicy：显式性、敏感、第三方、临时性、冲突、TTL 和用户开关。
4. 回答主链结束后异步提取候选，不阻塞首屏回答。
5. 显式“记住”且低风险可 active；普通推断默认 pending 或丢弃。
6. Shadow write：旧系统生效，Mem0 保存对照数据。
7. Shadow read：旧系统注入，Mem0 只记录召回差异。
8. 使用 canonical key、单值替换、多值增删、内容指纹和幂等处理冲突。
9. 删除先让 NoteFlow 投影不可见，再异步删除 Mem0 vector；失败重试。
10. 记录错误记忆、冲突、延迟、召回命中和跨用户安全指标。

#### 产出物

- Mem0Provider 和 MemoryPolicy。
- Shadow read/write、outbox 同步和差异报告。
- 记忆安全、冲突、删除和关闭开关测试。

#### 验证

- 密码、Token、银行卡、医疗隐私、第三方信息默认拒绝。
- 临时指令不进入长期记忆。
- 当前用户输入优先于旧记忆。
- 关闭 memory 后不读不写。
- Mem0 失败不影响主回答。
- 跨用户召回和 external_id 关联零泄漏。

#### 完成门槛

- Shadow 质量和安全达到切换门槛，删除闭环可靠。

#### 回滚

关闭 Mem0 shadow worker；旧记忆系统继续工作，Mem0 派生数据可清理。

---

### 步骤 17：Mem0 用户级灰度与默认切换

> 2026-07-17 工程完成：稳定分桶、内部白名单、逐用户回退和 NoteFlow 投影二次裁决已落地；当前仍为 legacy/0%，未擅自全量切换。

#### 目标

让长期记忆真实使用 Mem0 智能层，同时保持 NoteFlow 用户控制和审计。

#### 我会怎么执行

1. 先内部账户，再按用户小比例启用 `MEMORY_PROVIDER=mem0`。
2. 读取结果仍经过 NoteFlow status、scope、sensitivity、TTL 和冲突过滤。
3. 只注入少量结构化记忆，默认 3-8 条，不塞入完整历史。
4. 用户界面继续使用现有 Memory API 查看、修改、删除和关闭。
5. 监控错误记忆反馈、安全拒绝、删除成功率、召回延迟和成本。
6. 对旧记忆保留一个发布周期，并支持按用户切回 legacy。
7. 稳定后把 Mem0 设为默认，但保留 NoteFlow 投影与事件审计。

#### 产出物

- 用户级灰度和回退。
- Mem0 默认读取/写入路径。
- 记忆运营指标和用户管理闭环。

#### 验证

- 用户关闭、删除和纠正立即在产品层生效。
- 旧偏好与当前指令冲突时当前指令优先。
- Memory 失败时回答继续且写入可重试。

#### 完成门槛

- 生产灰度指标稳定，安全规则不弱于旧系统。

#### 回滚

按用户或全局切回 `legacy`，保留事件和 external_id 供后续一致性修复。

---

### 步骤 18：安全、韧性、降级与灾备

> 2026-07-17 完成：安全门禁、Mem0 熔断、Redis 降级限流、备份恢复和迁移 roundtrip 均有自动化与真实演练证据。

#### 目标

让完全体不仅“能跑”，还能够在外部服务失败、并发、断线和数据事故中安全运行。

#### 我会怎么执行

1. 统一认证、Cookie、CORS、JWT、密码、刷新和会话安全配置。
2. 对登录、AI、Embedding、Reranker、Memory 和索引任务分别限流。
3. 所有 Provider 增加 timeout、retry、backoff、circuit breaker 和错误映射。
4. 固化降级顺序：
   - Reranker -> RRF
   - Vector/Embedding -> Title + BM25
   - BM25 -> Title + Vector + trigram
   - Mem0 -> 不注入长期记忆，写入排队
   - Checkpoint 故障 -> 只读可完成，副作用/恢复拒绝
   - LLM -> 可重试错误并保留 run/checkpoint
5. 增加任务锁、heartbeat、取消、幂等、死信和管理员诊断。
6. 做 PostgreSQL、附件和配置备份恢复演练。
7. 做 Alembic 前滚/回滚演练和索引全量重建演练。
8. 做 Provider 断网、限流、超时、错误响应和 Redis 故障演练。
9. 检查 Prompt Injection、工具 allowlist、范围校验和敏感日志。

#### 产出物

- 安全基线和限流策略。
- Provider 韧性中间层。
- 故障演练报告。
- 备份恢复与事故处理手册。

#### 验证

- 权限隔离和 Prompt Injection 测试 100% 通过。
- 单个外部 Provider 故障不会导致整个应用不可用。
- 备份可恢复，索引可重建，迁移可回滚。

#### 完成门槛

- 安全、灾备和降级均有真实演练结果，而不只是文档描述。

#### 回滚

安全修复原则上不回退；若新熔断/限流误伤，切回已验证的保守配置。

---

### 步骤 19：全量功能、性能、成本与 E2E 验收

#### 目标

在默认切换前，用接近生产的环境验证整个完全体。

#### 我会怎么执行

1. 在干净环境从零安装依赖、启动 Docker、迁移数据库和构建前端。
2. 运行全部前端测试、后端测试、Repository 集成测试和 E2E。
3. 验证账户、目录、笔记、编辑器、附件、版本、删除/恢复和 PWA。
4. 验证普通对话、问笔记、草稿、编辑预览、恢复、取消和长期记忆。
5. 运行 RAG 固定评测集和 Memory 安全集。
6. 进行并发、长笔记、大量笔记、长对话和 worker 堆积压测。
7. 测量 API、首 token、Rewrite、检索、Rerank、Memory、索引任务 p50/p95。
8. 统计 LLM、Embedding、Reranker 和 Memory 每功能 token/调用/费用。
9. 验证缓存命中、降级、断线重连、进程重启和数据库恢复。
10. 形成最终验收报告，所有未通过项必须修复或明确阻塞，不能带病默认切换。

#### 产出物

- 全量测试报告。
- RAG/Memory 质量报告。
- 性能与成本报告。
- 安全与恢复报告。
- 发布候选版本。

#### 验证

- 构建和全部测试通过。
- 权限隔离 100%。
- interrupt/resume/幂等 E2E 100%。
- RAG 指标不低于基线并达到门槛。
- 性能在预算内，降级不破坏可用性。

#### 完成门槛

- 发布门禁全部通过，无高严重缺陷和数据一致性缺陷。

#### 回滚

本步骤不切默认流量；未达标则停留在灰度/legacy，不进入步骤 20。

---

### 步骤 20：生产灰度、默认切换与观察期

#### 目标

安全地把新架构从小比例逐步切为默认，并保留一个发布周期回滚路径。

#### 我会怎么执行

1. 发布前再次备份数据库和配置，确认告警与值班入口。
2. 依次灰度：内部用户、1%、5%、20%、50%、100%，每档观察核心指标。
3. 默认配置逐步切为：
   - `AGENT_RUNTIME=langgraph`
   - `RAG_PROVIDER=llamaindex`
   - `MEMORY_PROVIDER=mem0`
4. 每档检查 API 错误率、首 token、SSE 中断、RAG 无结果、引用、权限、Memory 错误和 worker 队列。
5. 出现阈值异常自动停止扩量并切回对应 Provider，不进行紧急数据库破坏性回滚。
6. 100% 后保留一个发布周期 legacy 路径和数据对账。
7. 在观察期内修复边缘问题，不立即删除旧代码。

#### 产出物

- 灰度记录与每档指标。
- 默认配置变更。
- 回退演练记录。
- 观察期问题清单。

#### 验证

- 每个灰度档位达到约定观察窗口且指标稳定。
- 全量时仍能通过 flag 快速切回 legacy。
- 新旧数据数量、索引状态和记忆投影可对账。

#### 完成门槛

- 新架构全量稳定运行一个完整观察周期。

#### 回滚

按模块独立切回 legacy；只在 schema 不兼容时使用已演练的数据库回滚。

---

### 步骤 21：清理重复实现、补齐运维文档并完成最终交付

#### 目标

结束迁移状态，让代码、文档、配置和运维都只保留清晰、可维护的正式路径。

#### 我会怎么执行

1. 根据调用图确认 legacy 代码已无生产流量和回滚需求。
2. 删除重复的手写 Agent 编排、伪 BM25、扩大化正则 Markdown 解析和重复 Memory 路径。
3. 保留必要 adapter 接口，但删除只用于迁移且已无价值的 shadow/facade。
4. 整理 requirements/lock、环境变量示例、Docker 和生产配置。
5. 更新 README、架构说明、API/SSE、数据库字典、部署、监控、备份、恢复、故障和升级手册。
6. 删除无用 migration 临时代码、调试日志、废弃 flags 和测试夹具。
7. 再运行一次从干净环境安装到全量 E2E 的最终验证。
8. 生成完全体版本说明、已知限制、后续扩展边界和维护清单。
9. 对照“完全体最终定义”逐项签收。

#### 产出物

- 清理后的正式代码目录。
- 锁定依赖和统一配置。
- 完整开发/部署/运维/恢复文档。
- 最终全量测试与验收报告。
- NoteFlow 完全体发布版本。

#### 验证

- 无重复生产编排和第二套数据真相源。
- 新开发者可以按文档从零启动、测试和理解模块边界。
- 所有 feature flag 的默认值、保留理由和删除计划明确。
- 完全体最终定义全部满足。

#### 完成门槛

- 功能、架构、数据、安全、质量、性能、成本和运维门禁全部通过。
- 项目不再依赖迁移期临时代码才能运行。

#### 回滚

清理发生在完整观察期之后；删除前保留发布 tag/归档分支和数据库备份。若发现遗漏，从归档恢复最小适配，不回退整个架构。

---

## 5. 每个步骤结束时我必须提交的结果

后续你让我执行任一步时，我在该步结束必须给出以下信息：

1. 本步骤最终状态：已完成、待验收或阻塞。
2. 实际修改的文件和数据库迁移。
3. 实现了什么，以及明确没有做什么。
4. 运行过的测试、命令和结果。
5. 数据对账、性能、安全或评测结果。
6. 当前启用的 feature flags 和默认 Provider。
7. 已知风险与处理方式。
8. 精确回滚步骤。
9. 是否满足完成门槛。
10. 下一步编号及开始前条件。

---

## 6. 全程禁止事项

- 禁止一次性重写整个后端。
- 禁止为了接框架而复制第二套笔记、权限或用户真相源。
- 禁止先全局召回再在 Python 中过滤用户权限。
- 禁止让 LangGraph、LlamaIndex 和 Mem0 同时控制全局流程。
- 禁止让模型直接访问 ORM、指定 user_id 或绕过 Service 写数据库。
- 禁止用 Redis 作为唯一 checkpoint、聊天记录或业务状态真相源。
- 禁止把未保存正文写入长期索引或长期记忆。
- 禁止没有引用校验却声称回答来自用户笔记。
- 禁止没有固定评测集就调整 chunk、RRF、BM25 或 Reranker 参数。
- 禁止没有备份、回滚和对账就执行破坏性迁移。
- 禁止在 Shadow 阶段产生正式副作用。
- 禁止为了后端重构重做已经稳定的前端 UI。

---

## 7. 下一步开始方式

本计划书完成后，正式实施从“步骤 0：执行前保护与工作区确认”开始。每次只推进一个步骤；如果某一步规模过大，我会在该步骤内部拆成可独立验收的小批次，但不会改变本文档的总体顺序和完成门槛。

最终执行链为：

```text
保护与冻结
-> 测试和评测基线
-> 依赖 PoC
-> 接口/目录骨架
-> Service/Repository
-> 数据库/Outbox/Checkpoint
-> RuntimeEvent/SSE/Observability
-> LangGraph PoC + Shadow
-> RAG 索引 v2
-> 混合检索 + Reranker + 引用 + 评测
-> 只读链路灰度
-> 草稿子图
-> 编辑子图
-> Mem0 Shadow + 灰度
-> 安全/韧性/灾备
-> 全量 E2E/性能/成本验收
-> 生产灰度与默认切换
-> 清理重复实现
-> NoteFlow 完全体交付
```
