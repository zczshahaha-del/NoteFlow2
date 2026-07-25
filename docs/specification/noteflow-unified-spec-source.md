# NoteFlow 统一架构与功能设计说明书

版本：v2.0 整合版

状态：架构决策基线 / 后续重构与验收的统一依据

日期：2026-07-17

适用范围：NoteFlow Web 前端、FastAPI 后端、Agent 编排、RAG、长期记忆、数据层、异步任务、API/SSE 契约、测试与迁移。

> 核心结论：前端现有三栏工作台、编辑器与 AI 面板交互不重做；升级重点是后端模块化与 AI 能力工程化。LangGraph 管全局流程和可恢复状态，LlamaIndex 作为 LangGraph 可调用的 RAG 模块，Mem0 OSS 作为长期记忆引擎；PostgreSQL + pgvector 继续作为统一数据底座，Redis 只承担缓存、锁、限流和短暂运行状态。

## 0. 文档说明

### 0.1 文档目的

本文档把 v2.0 RAG 升级方案、当前仓库真实实现、已经确定的技术选型以及后续迁移方法合并成一份完整说明书。它同时回答四类问题：NoteFlow 已经具备什么；目标架构是什么；各模块如何协作和实现；如何在不推翻现有产品的前提下分阶段落地。

### 0.2 信息状态标记

- 已实现：当前代码中已经存在并可由接口或测试验证。
- 保留改造：已有能力继续使用，但拆分边界、接口或实现方式需要调整。
- 目标新增：已经纳入本设计，但依赖尚未接入或代码尚未迁移。
- 后续扩展：不是本轮上线前置条件，预留接口但不提前建设。

### 0.3 设计依据

- v2.0 文档的企业级 RAG Pipeline：Query Rewrite、Hybrid Retrieval、Permission Filter、Fusion、Reranker、Context Builder、Retrieval Evaluation。
- 当前 NoteFlow 仓库中的 React/TypeScript 前端、FastAPI 后端、SQLAlchemy 模型、Alembic 迁移、PostgreSQL/pgvector、Redis、SSE、Agent Runtime、草稿、编辑预览、索引和记忆实现。
- 已确定的架构决策：LangGraph + LlamaIndex + Mem0 OSS；继续使用 PostgreSQL + pgvector；暂不迁移 Qdrant；前端 UI 保持现状。

### 0.4 统一口径

- 笔记是产品主数据；RAG 索引、向量和摘要都是可重建的派生数据。
- 用户当前输入、显式模式和确认结果优先于模型推断与历史记忆。
- AI 不允许绕过业务服务直接修改数据库。
- 正式笔记的创建、修改、删除等可见副作用必须经过确定性校验；高风险操作必须确认。
- 规划中的能力不得在状态说明中写成已经完成。

## 1. 产品定位与能力范围

### 1.1 产品定位

NoteFlow 是以 Markdown 笔记为核心的个人知识工作台。它同时提供可靠编辑、结构化知识管理、基于笔记的问答、AI 草稿生成、受控修改、长期个性化记忆和可追踪的 Agent 工作流。

### 1.2 目标用户与核心场景

- 学习者：构建课程笔记、复习资料和主题知识库。
- 开发者与知识工作者：管理技术笔记、项目文档和代码片段。
- 需要 AI 辅助但重视可控性的用户：要求答案可引用、修改可预览、任务可恢复、记忆可管理。

### 1.3 完整能力地图

- 账户与会话：注册、登录、刷新、退出、设备会话管理、密码重置。
- 知识组织：分类树、笔记列表、搜索、固定、收藏、删除与恢复。
- 编辑器：Markdown/Tiptap、代码块、选中文本工具栏、大纲、附件、版本历史、自动保存与离线冲突处理。
- AI 对话：普通对话、显式“全库搜索/问笔记”、当前笔记上下文、来源引用、流式回答。
- AI 草稿：需求澄清、大纲、分节生成、暂停/恢复、组装、保存为正式笔记。
- AI 修改：选择范围、生成修改预览、修订预览、应用或取消、应用前版本保护。
- RAG：Markdown 解析、分块、Embedding、标题/关键词/向量混合检索、融合、重排、引用和评测。
- 记忆：用户开关、提取、查询、增删改、冲突处理、审计和上下文注入。
- Agent Runtime：会话、运行、步骤、工具轨迹、Checkpoint、取消、恢复和 SSE 状态。
- 工程能力：Docker Compose、PostgreSQL、Redis、Alembic、限流、缓存、诊断、指标和自动化测试。

### 1.4 本轮非目标

- 不重做已经稳定的三栏 UI、配色、代码块样式或 AI 面板布局。
- 不将 NoteFlow 改成无约束的通用自主 Agent。
- 不把 Qdrant、OpenViking 或另一套知识库作为第二个并行真相源。
- 不为尚不存在的团队工作区提前重写权限体系。
- 不一次性删除旧流程；所有替换都必须支持灰度、对照和回滚。

## 2. 当前系统事实基线

### 2.1 当前技术栈

| 层级 | 当前实现 | 说明 |
|---|---|---|
| 前端 | React 19、TypeScript 6、Vite 8 | Zustand 状态、TanStack Query、SSE 客户端 |
| 编辑器 | Tiptap 3、ProseMirror、Tiptap Markdown | Markdown 往返、代码块、选区工具栏、版本历史 |
| 后端 | Python、FastAPI 0.115、Pydantic 2 | 业务接口与流式接口 |
| ORM/迁移 | SQLAlchemy Async 2、Alembic | asyncpg 连接 PostgreSQL |
| 主数据库 | PostgreSQL 16 + pgvector | 业务数据、向量、运行记录 |
| 缓存 | Redis 7 | 限流、AI 缓存、锁与短暂状态 |
| LLM | DeepSeek OpenAI-compatible API | 本地 server/.env 当前为 deepseek-v4-pro |
| Embedding | DashScope text-embedding-v4 | 1024 维，是否启用取决于 API Key |
| 部署 | Docker Compose + Nginx | 前后端、PostgreSQL、Redis |

### 2.2 模型配置真实状态

- 当前开发环境 server/.env 指定 DEEPSEEK_MODEL=deepseek-v4-pro，因此本机实际默认模型是 DeepSeek V4 Pro。
- config.py 与 docker-compose.yml 的回退值仍是 deepseek-chat。环境变量优先，所以两者并不等于当前实际运行值。
- 目标改造必须统一默认值，避免本地、Docker 和文档显示不一致。建议保留 DEEPSEEK_MODEL 兼容读取，同时新增通用 LLM_PROVIDER、LLM_BASE_URL、LLM_MODEL 配置层。
- Embedding 默认 provider 为 dashscope，模型 text-embedding-v4，维度 1024；没有 Key 时语义向量链路降级，词法检索仍应可用。

### 2.3 当前已经实现的后端能力

- 认证安全：Cookie 会话、刷新、会话撤销、登录限流、密码重置、生产安全校验。
- 笔记数据：分类、笔记 CRUD、软删除/恢复、版本、附件、相关笔记、索引状态和手动重建索引。
- 知识库兼容：旧 knowledge_bases JSON 快照读取、迁移和清理。
- 索引：Markdown 标题解析、section/chunk、内容哈希、队列、重试、Embedding 和 HNSW 向量索引。
- 检索：标题通道、内容通道、向量通道、RRF 融合、去重和相关性过滤。
- RAG 评测：手工用例、自动构造用例、通道统计和结果汇总。
- 草稿：分节生成、确认、删除/恢复、组装、生成全部、停止、保存为笔记。
- 编辑预览：创建、修订、版本恢复、应用和取消。
- 记忆：开关、候选提取、类型/层级/作用域、查询、写入、更新、软删除和事件审计。
- Agent Runtime：聊天会话、消息、run、step、tool trace、业务 checkpoint、取消和恢复。
- 可观测性：诊断、指标、统一错误输出和 AI 缓存。

### 2.4 当前 AI、意图识别和 RAG 是否开启

- 意图识别不是全局关闭。/api/agent/chat 会调用 context planner；当用户显式选择普通对话或“问笔记”模式时，UI 模式是硬约束并覆盖模型猜测。
- RAG 不是全局关闭。显式问笔记、规划结果要求检索、当前笔记上下文等路径会调用现有 note_library 服务。
- Memory 由用户设置 memoryEnabled 控制；关闭时不得读取或写入长期记忆。
- Embedding 是否可用由配置与 API Key 决定；不可用时必须降级到标题和内容检索，而不是让整个问答失败。

### 2.5 当前实现与目标差距

| 模块 | 当前状态 | 目标差距 |
|---|---|---|
| Agent | agent.py 中存在大量手工分支 | 迁移为 LangGraph 状态图和子图 |
| Checkpoint | 业务级 PostgreSQL checkpoint 已有 | 增加 LangGraph 内部持久化并明确双层边界 |
| RAG 编排 | 自定义服务和 SQL | 用 LlamaIndex 封装索引/检索模块，保留必要适配器 |
| Markdown 解析 | 正则标题解析、字符切块 | 改用 AST Parser + 标题感知/结构感知分块 |
| 关键词检索 | trigram/LIKE 加权，不是真正 BM25 | 接入 BM25 库和中文分词 |
| Query Rewrite | 规则化 query understanding | 增加可控 LLM Rewrite/Expansion 和缓存 |
| Reranker | 没有独立 Cross Encoder | 增加可插拔重排器和超时降级 |
| 记忆 | 自研规则 + LLM 提取，词法排序 | 接入 Mem0，同时保留 NoteFlow 策略与审计层 |
| 数据库 | PostgreSQL + pgvector 已就绪 | 不换库，补充索引版本、评测和迁移字段 |
| 模块边界 | routers/services 文件偏大 | 拆成 agent/rag/memory/tools/repositories/workers |

## 3. 已确定的架构决策

### 3.1 决策总览

| 决策项 | 最终选择 | 原因 |
|---|---|---|
| 全局 Agent 编排 | LangGraph | 状态图、interrupt、checkpoint、streaming、可恢复 |
| RAG 框架 | LlamaIndex | 文档节点、检索器、融合、后处理与评测生态 |
| 长期记忆 | Mem0 OSS 自托管 | 减少自研提取/检索代码，数据可控 |
| 主数据库 | PostgreSQL | 已稳定承载业务表和运行记录 |
| 向量数据库 | pgvector | 现有数据、索引和运维都已建立，当前无需 Qdrant |
| 临时状态/缓存 | Redis | 缓存、限流、锁、幂等键和流状态，不作为唯一持久层 |
| LLM | DeepSeek OpenAI-compatible | 保留现有适配，当前开发模型 deepseek-v4-pro |
| Embedding | DashScope text-embedding-v4 / 1024 | 保留现有向量兼容性 |
| 前端 UI | 保持现状 | 当前改造目标是能力与代码结构，不重新设计界面 |

### 3.2 框架边界

- LangGraph 只负责流程、状态、分支、重试、interrupt 和节点编排，不承载笔记 CRUD 细节。
- LlamaIndex 只作为 RAG 模块，被 LangGraph 的 rag_search 工具或节点调用；它不控制全局对话。
- Mem0 只负责长期记忆智能层；NoteFlow 继续负责用户开关、敏感策略、审计、展示和删除语义。
- SQLAlchemy Repository/Service 继续是业务写入入口；框架不得绕过 user_id 校验或直接修改正式笔记。
- 前端只依赖稳定 API 与 SSE 契约，不感知内部从 legacy 切换到 LangGraph/LlamaIndex/Mem0。

### 3.3 为什么当前不换 Qdrant

- 当前 note_embeddings 已使用 pgvector、HNSW cosine 索引和 1024 维向量。
- NoteFlow 的业务过滤、事务、用户隔离和向量查询都在 PostgreSQL 内，单库更容易保证一致性。
- 当前主要瓶颈是检索质量、重排和模块边界，而不是向量数据库规模。
- 只有在向量规模、查询并发或独立扩缩容需求被压测证明后，才重新评估 Qdrant；RAG 的 VectorStore 接口应保证以后可替换。

### 3.4 OpenViking 的位置

OpenViking 可以作为未来外部知识源或知识组织实验，但不进入当前核心路径。若以后接入，必须通过 ExternalKnowledgeProvider 接口提供只读检索，不能和 NoteFlow 笔记索引重复写入、重复召回或成为第二套权限真相源。

## 4. 目标总体架构

[DIAGRAM:architecture]

### 4.1 分层职责

- 表现层：React 三栏工作台、Tiptap/Markdown 编辑器、AI 面板、草稿和修改预览。
- 传输层：FastAPI routers、Pydantic schema、认证、限流、SSE 适配和错误协议。
- 应用编排层：LangGraph 主图和子图，维护本轮 state、节点跳转、interrupt 与恢复。
- 工具层：Note、RAG、Memory、Draft、Edit 等类型化工具，只暴露经过校验的业务能力。
- 领域服务层：笔记、草稿、编辑、附件、版本、权限、索引任务和审计规则。
- AI 能力层：LlamaIndex RAG、Mem0 Memory、LLM/Embedding/Reranker Provider。
- 基础设施层：PostgreSQL/pgvector、Redis、对象存储、后台 worker、日志和指标。

### 4.2 端到端请求路径

1. 前端将 question、mode、pageState、sessionId 和历史摘要发送到 /api/agent/chat。
2. FastAPI 完成认证、限流、请求校验，创建或复用 ChatSession 与 AgentRun。
3. LangGraph ingress 节点构造 AgentState；policy 节点先应用显式 UI 模式和安全规则。
4. Router 决定普通聊天、笔记 RAG、草稿、编辑、记忆管理或恢复任务。
5. 对应子图调用类型化工具；工具通过领域服务和 Repository 访问数据。
6. 各节点产生统一 RuntimeEvent，SSE Adapter 映射成现有前端事件。
7. 结果写入 chat_messages、agent_runs、agent_steps、agent_tool_traces；需要等待确认时同时产生业务 checkpoint。
8. 回答完成后异步执行记忆候选提取、质量日志和必要的索引任务，不阻塞首屏回答。

### 4.3 数据真相源

- notes 及其版本是笔记正文真相源。
- note_sections、note_chunks、note_embeddings 是可重建的 RAG 派生索引。
- user_memories 是用户可见且可管理的记忆投影与审计入口；Mem0 向量记录通过 external_id 与其关联。
- chat_sessions/messages 是对话记录；LangGraph checkpoint 不替代聊天历史。
- agent_runs/steps/tool_traces 是运行审计；业务 checkpoint 表示等待用户动作的产品状态。

## 5. 前端模块与交互契约

### 5.1 保持不变的 UI 基线

- 左侧目录与搜索、中间笔记正文、右侧 AI 助手的三栏结构保持不变。
- 已完成的代码块语言菜单、复制、可编辑行为、选中文本工具栏、AI 悬浮入口等交互不因后端重构再次改版。
- 草稿工作区、编辑预览、版本历史、附件和任务详情继续使用现有组件。
- 内部框架切换不得改变用户操作路径、颜色体系或主要文案。

### 5.2 前端主要模块职责

| 模块 | 职责 |
|---|---|
| App / storeSlices | 组合 workspace、editor、chat、agent、draft 状态 |
| DirectoryTree | 分类/文件夹、笔记选择、搜索、新建与删除确认 |
| TiptapPilotEditor | 唯一的 Markdown 编辑器，负责选区、代码块、大纲和自动保存 |
| AIPanel | 模式选择、输入、SSE 消费、来源、轨迹和任务状态 |
| AIDraftWorkspace | 大纲与分节生成、确认、停止、保存 |
| EditPreviewWorkspace | 差异预览、修订、应用与取消 |
| VersionHistoryPanel | 版本列表和恢复 |
| services/* | 对后端 API 和 SSE 的唯一访问层 |

### 5.3 对话模式的确定性规则

- 普通“对话”模式：不自动搜索全库；只有用户显式要求或产品策略允许时才读取当前笔记/记忆。
- “全库搜索/问笔记”模式：必须检索笔记，严格依据来源回答；没有证据就明确说明未找到。
- 当前笔记动作：pageState 带 currentNoteId、selection 和未保存内容摘要；未保存内容只用于本轮上下文，不写入 RAG 索引。
- 显式模式是硬规则。LangGraph 可以在规则内部规划，但不能把普通对话偷偷改为全库检索。

### 5.4 SSE 兼容原则

- 前端继续通过现有 askDeepSeekStream/agent service 消费 text/event-stream。
- 后端内部事件可以升级，但对外必须经过 SSE Adapter，保证旧组件仍能理解 context、tool_trace、checkpoint、agent_done、agent_error、choices delta 和 [DONE]。
- 每个事件都带 sessionId/runId；可以重放的状态事件带 eventId 和 sequence。
- 断线重连优先读取最新 run/checkpoint 快照，再决定是否续流或提示用户恢复。

## 6. FastAPI 传输层与业务服务

### 6.1 Router 原则

- Router 只做认证、请求校验、状态码、SSE 输出和 service/graph 调用。
- 不在 router 内编写长流程、检索 SQL、记忆冲突或笔记写入算法。
- agent.py 现有的大量分支逐步搬入 graph nodes/subgraphs；迁移期间 router 保持同一路径。
- Pydantic schema 分为 public API schema、internal tool schema 和 runtime event schema，避免 dict 漫延。

### 6.2 领域服务原则

- NoteService 管理笔记 CRUD、软删除、恢复、版本和索引触发。
- DraftService 管理草稿/分节生命周期；DraftWorker 只执行已持久化任务。
- EditService 生成和应用预览；应用时必须基于期望版本或 content hash 做并发校验。
- AttachmentService 负责对象存储、大小/类型/哈希检查。
- Agent 不直接使用 ORM model；通过 Tool -> Service -> Repository 调用。

### 6.3 Repository 原则

- 每个查询都显式接受 user_id；任何 note_id、memory_id、run_id 查询都同时约束所属用户。
- 事务边界位于应用服务；工具不跨多个隐式 session。
- RAG 检索 SQL 必须把 user_id 和删除状态写进数据库条件，而不是全局检索后再过滤。
- Repository 返回领域 DTO，避免把 ORM 对象带到图状态或 SSE 中。

## 7. LangGraph Agent 设计

[DIAGRAM:langgraph]

### 7.1 LangGraph 的职责

- 管理 AgentState 和节点跳转。
- 把普通聊天、RAG 问答、草稿生成、编辑预览、记忆管理拆成可测试子图。
- 使用 interrupt 等待用户确认，并在新请求中恢复。
- 记录节点耗时、错误、重试和工具轨迹。
- 通过 checkpointer 保存内部执行状态；通过业务 checkpoint 暴露用户可见任务状态。

### 7.2 AgentState 建议字段

```python
class AgentState(TypedDict, total=False):
    user_id: str
    session_id: str
    run_id: str
    question: str
    mode: Literal["chat", "ask_notes"]
    page_state: PageState
    primary_intent: str
    policy: PolicyDecision
    memory_context: list[MemoryItem]
    rag_query: str
    rag_sources: list[RagSource]
    answer: str
    pending_action: PendingAction | None
    runtime_events: list[RuntimeEvent]
    error: RuntimeErrorInfo | None
```

### 7.3 主图节点

1. ingress：规范化请求，创建 run，加载会话和业务 checkpoint。
2. apply_ui_policy：应用 chat/ask_notes 硬约束、用户开关和危险操作规则。
3. plan_intent：识别 general_chat、note_qa、note_draft、note_edit、memory_manage、resume、clarify。
4. load_memory：只在计划允许时读取相关长期记忆。
5. rag_search：调用 LlamaIndex RAG Tool 并返回结构化来源。
6. answer：调用 LLM 流式生成；严格 RAG 模式必须绑定引用。
7. draft_subgraph：需求澄清、大纲、interrupt、分节任务和保存。
8. edit_subgraph：目标定位、预览、interrupt、应用或取消。
9. memory_subgraph：显式查询/保存/删除记忆。
10. finalize：持久化消息、run 状态、事件和异步后处理任务。
11. handle_error：错误分级、降级、审计和用户安全文案。

### 7.4 路由规则

- mode=ask_notes 时强制进入 note_qa，不由 LLM 改写为普通聊天。
- 创建或修改正式笔记必须进入对应子图，不能由自由 ReAct 直接调用写工具。
- 只有低风险、只读工具允许在有限 ReAct 循环中动态选择；最大迭代次数固定。
- 存在 open checkpoint 且用户动作与其匹配时优先 resume；否则保留 checkpoint 并处理新问题。
- 不确定且会改变产品行为时进入 clarify；无副作用的一般问答可以保守降级。

### 7.5 双层 Checkpoint

- LangGraph 内部 checkpoint：保存图 state、节点位置和版本，生产使用 PostgreSQL checkpointer；这是框架运行细节。
- NoteFlow 业务 checkpoint：保存 draft_workspace、edit_preview、confirmation 等用户可见状态，继续使用 agent_checkpoints 表。
- 两层通过 run_id、session_id、thread_id 关联，但不得共用同一 payload 语义。
- Redis 只用于 checkpoint 热缓存、分布式锁、取消标记和短暂 stream cursor，不能成为唯一恢复来源。

### 7.6 幂等与恢复

- 每个副作用工具接受 idempotency_key=run_id:step:action。
- create_note、apply_edit、save_draft 在数据库中保存幂等记录或唯一键，重复恢复不得创建两份结果。
- LangGraph 版本升级时记录 graph_version；不兼容 checkpoint 进入受控迁移或提示重新开始。
- 用户取消后设置 run=cancelled，worker 和 graph 节点每个边界都检查取消标记。

## 8. 类型化工具系统

### 8.1 统一工具契约

```python
class ToolResult(BaseModel):
    ok: bool
    code: str
    data: dict
    summary: str
    sources: list[SourceRef] = []
    retryable: bool = False
```

- 输入输出全部使用 Pydantic；工具内部不接收任意 dict。
- user_id 从认证上下文注入，不允许模型在参数中指定其他用户。
- 工具返回结构化数据，面向用户的自然语言由 Answer 节点生成。
- 每次调用自动写 AgentToolTrace，记录脱敏 input/output summary、duration、status 和 provider 信息。

### 8.2 Note Tools

- search_notes：标题/元数据轻量搜索，适合目录定位。
- read_note：按 note_id 读取经过权限校验的正文或 outline。
- create_note_draft：创建草稿，不直接创建正式笔记。
- save_draft_to_note：确认后把草稿保存为正式笔记并触发索引。
- create_edit_preview：根据 selection/section/note 生成差异预览。
- apply_edit_preview：确认后应用，写版本并触发局部索引。
- delete/restore：必须使用确定性二次确认和业务服务。

### 8.3 RAG Tool

- 输入：query、scope、current_note_id、strict、top_k、filters。
- 输出：rewritten_query、sources、context、citations、retrieval_trace、degraded_steps。
- 只读，不修改笔记或记忆。
- strict=true 且无可靠来源时返回 no_evidence，不让模型用常识补齐。

### 8.4 Memory Tool

- recall：读取与当前问题相关的用户记忆。
- propose：提取候选，不等于直接生效。
- remember：显式用户请求写入，经过 Policy Engine。
- update/forget/list：用户管理操作。
- 记忆工具不得从笔记正文自动推断用户个人事实。

## 9. LlamaIndex RAG v2.0

[DIAGRAM:rag]

### 9.1 模块定位

LlamaIndex 作为独立 RagService 实现索引节点、检索器组合、后处理和评测。LangGraph 只看到一个稳定 RAG Tool；FastAPI、前端和领域写入不依赖 LlamaIndex 类型。

### 9.2 索引入口

- 笔记创建、正文更新、标题/标签/分类变化、恢复和 AI 应用修改后创建 note_index_job。
- 数据库提交成功后再通知 IndexWorker；失败重试使用 next_attempt_at、retry_count 和指数退避。
- 同一 note_id 的新任务可以合并；旧 content_hash 的结果不得覆盖新版本。
- 删除笔记时先标记 source deleted，再异步清理派生节点和向量。

### 9.3 Markdown Parser 与结构化分块

- 用 markdown-it-py 或等价 CommonMark AST Parser 替换仅靠正则的主解析路径。
- 使用 LlamaIndex MarkdownNodeParser/自定义 NodeParser 把标题层级、段落、列表、引用、代码块和表格转为节点。
- 代码块、表格和短列表默认保持原子性；长段落按 token 切分。
- 建议正文 chunk 目标 400-800 tokens，最大 1000；长文本 overlap 60-120 tokens，标题路径重复写入 metadata 而不是正文。
- 稳定 node_id 由 note_id、section_path、chunk_index、content_hash 生成，支持局部更新和评测追踪。

### 9.4 Node Metadata

```json
{
  "user_id": "...",
  "workspace_id": null,
  "note_id": "...",
  "section_id": "...",
  "title": "Redis 学习笔记",
  "section_path": ["缓存", "缓存雪崩"],
  "tags": ["Redis", "缓存"],
  "category_id": "...",
  "chunk_index": 3,
  "content_hash": "...",
  "source_version": 18,
  "is_deleted": false,
  "updated_at": "..."
}
```

- workspace_id 当前可为空；只有引入团队工作区后才升级为必填。
- user_id、note_id、deleted 状态和版本是检索前置过滤字段。
- citation 所需标题、section_path 和版本必须随节点保存。

### 9.5 Query Understanding、Rewrite 与 Expansion

- normalize：去空格、统一标点、保留代码符号和专有名词。
- classify：判断事实查找、解释、比较、总结、代码定位、当前笔记或全库范围。
- rewrite：只在问题过短、代词不清或依赖最近对话时调用 LLM；必须保留原始实体和用户约束。
- expansion：生成 0-3 个同义词/缩写/中英文术语，用于召回，不直接展示给用户。
- Redis 缓存 key 包含 user_id、query_hash、history_hash、rewrite_model 和 prompt_version；短 TTL，用户隐私数据不进入共享 key。
- Rewrite 失败时使用原 query，不能阻断检索。

### 9.6 Permission Filter 必须前置

- 所有标题、BM25 和向量检索在数据库或索引查询阶段限制 user_id。
- 默认过滤 deleted_at、无效 index version 和不可见分类。
- 指定 current_note_id 时同时验证该 note 属于当前用户。
- 未来 workspace 模式增加 workspace_id、membership、role 和 document_acl；任何通道都不能先检索全局再在 Python 中过滤。
- Reranker 只接收已经通过权限过滤的候选。

### 9.7 Hybrid Retrieval 三个并行通道

#### A. 标题与元数据通道

- 精确标题、前缀、section title、标签和分类匹配。
- 使用 PostgreSQL pg_trgm/GIN 与业务权重，优先保证专有名词和代码符号命中。
- 当前已有 heading channel 可作为第一阶段适配器保留。

#### B. BM25 关键词通道

- 使用 LlamaIndex BM25Retriever 与 bm25s，中文通过 jieba 或可替换 tokenizer 分词。
- 索引按 user_id（未来按 workspace_id）分区，索引版本随 note_index_job 更新；多进程不能依赖单机内存唯一副本。
- 对标题、section_path 和正文使用不同 field boost；停用词与技术词词典版本化。
- 当前 trigram 内容检索作为 fallback，不再把它称为 BM25。

#### C. 向量通道

- 使用 DashScope text-embedding-v4、1024 维，继续写入 PostgreSQL pgvector。
- cosine distance + HNSW；查询同时带 user_id、deleted 状态、模型和维度过滤。
- Embedding 模型切换时使用 index_version 或并行 embedding_model 字段，不覆盖旧向量后立即切流量。

### 9.8 Result Fusion

- 不直接相加 BM25、标题分和 cosine 原始分，因为三个尺度不同。
- 默认使用 Reciprocal Rank Fusion：score = sum(weight_channel / (k + rank_channel))，k 建议 60。
- 推荐初始权重：title 1.2、BM25 1.0、vector 1.0；以评测集调优，不写死在业务代码。
- 对相同 note_id/section_id/content_hash 去重；同步冲突副本使用逻辑标题合并。
- Fusion 召回 20-50 个候选交给 Reranker。

### 9.9 Reranker

- 通过 RerankerProvider 接口调用 Cross Encoder 或云端重排 API；模型名、超时和批大小配置化。
- 输入为 query + 候选 chunk + 精简 metadata；不把未过滤数据发送给外部服务。
- 默认候选 30，最终 Top K 6-10；代码类长块可使用更小批次。
- 超时或服务不可用时使用 RRF 排名降级，并在 retrieval_trace 中记录 reranker_skipped。
- Reranker 不是答案模型；它只输出相关性和排序。

### 9.10 Context Builder 与引用

- 按 token budget 选择来源，避免同一 section 重复占满上下文。
- 每个来源包含 citation_id、note_id、title、section_path、chunk、score、updated_at 和 source_version。
- 严格模式 Prompt 明确：只能依据提供来源；无法回答就说明证据不足。
- 生成后校验引用编号是否存在；未引用的来源可以折叠，不制造假引用。
- 当前笔记未保存 selection/content 作为 ephemeral source，标记 unsaved=true，不写索引。

### 9.11 无结果与降级

- ask_notes 严格模式：返回“未在笔记中找到足够依据”，同时给出可能的搜索建议。
- 普通对话：RAG 无结果不影响通用回答，但不能声称答案来自用户笔记。
- Embedding 失败：保留标题 + BM25/词法通道。
- BM25 索引未就绪：保留标题 + vector + trigram fallback。
- Reranker 失败：使用 RRF 排名。
- 全部检索失败：返回结构化 degraded 错误并记录指标，不静默伪造来源。

### 9.12 Retrieval Evaluation

- 离线指标：Recall@K、MRR、nDCG@K、Hit Rate、无关来源率、引用覆盖率。
- 在线指标：检索延迟 p50/p95、各通道候选数、rerank 延迟、无结果率、降级率、用户追问/改写率。
- 评测用例至少覆盖中文短问、英文术语、代码符号、同名笔记、过时版本、权限隔离和无答案问题。
- 每次修改 tokenizer、chunking、embedding、fusion 权重或 reranker 都必须跑固定评测集并和基线对比。

## 10. 索引与数据一致性

### 10.1 索引状态机

- pending：已创建任务，等待 worker。
- indexing：已领取并开始处理。
- indexed：当前 source_version 的所有必需派生数据完成。
- partial：词法索引完成但 embedding/rerank 依赖失败；允许降级检索。
- failed：达到重试上限，保留 error_code 和可重试入口。
- outdated：正文版本高于已完成索引版本。

### 10.2 增量更新

- 先解析新旧 section，按稳定 section path 和 content_hash 比较。
- 未变化 chunk 复用 embedding；新增/变化 chunk 重新生成；删除 chunk 标记失效后清理。
- 标题或 metadata 变化只更新相关索引字段，不重复生成正文向量。
- 保存正式笔记的事务只写主数据和 outbox/index job，不等待外部 Embedding。

### 10.3 并发和重复任务

- worker 使用数据库行锁或 SKIP LOCKED 领取任务。
- 每个 note_id 同时只运行一个 active job；更新期间到来的新 job 合并到最新 source_version。
- 写入派生数据前再次校验 content_hash/source_version，防止旧任务回写。
- 失败采用有上限的指数退避；不可重试错误直接 failed。

## 11. Mem0 长期记忆系统

[DIAGRAM:memory]

### 11.1 职责边界

- Mem0 OSS 自托管负责记忆候选的提取、语义检索和基础更新能力。
- NoteFlow MemoryPolicy 负责是否允许保存、敏感等级、第三方信息、冲突、确认、TTL 和用户当前指令优先。
- NoteFlow user_memories/user_memory_events 负责产品展示、审计、软删除和可撤销性。
- LangGraph Store/Checkpoint 用于图状态和工作记忆，不代替长期用户记忆。
- 笔记知识不自动进入个人记忆；RAG 和 Memory 使用不同 namespace。

### 11.2 五层记忆模型

| 层级 | 内容 | 存储与生命周期 |
|---|---|---|
| 瞬时记忆 | 当前输入、selection、临时页面状态 | 仅 AgentState，本轮结束清理 |
| 短期记忆 | 最近对话窗口与会话摘要 | chat_messages/summary，有窗口预算 |
| 工作记忆 | 草稿、编辑、待确认任务 | 业务 checkpoint + LangGraph state，有 TTL |
| 情景记忆 | 用户经历、近期项目事件 | Mem0 + user_memories，时间衰减/可归档 |
| 语义记忆 | 稳定偏好、身份、长期目标 | Mem0 + user_memories，冲突更新/用户可管理 |

### 11.3 记忆写入流程

1. 回答主链路结束后，把允许的对话片段写入 memory extraction 队列。
2. Mem0/LLM 生成结构化候选：type、key、value、scope、evidence、source_message_id。
3. MemoryPolicy 执行敏感、第三方、临时性、显式性、冲突和重复判断。
4. 显式“记住”且低风险可直接 active；普通推断默认 pending 或丢弃。
5. 写 user_memories 和 event，生成/更新 Mem0 向量；通过 outbox 保证最终一致。
6. 失败不影响聊天回答；后台重试并记录 memory_write_failed。

### 11.4 记忆读取流程

- 先由 deterministic read plan 判断是否需要记忆以及允许的类别/作用域。
- Mem0 按 user_id namespace 做语义召回；NoteFlow 再做 status、敏感、scope、TTL 和当前请求冲突过滤。
- 排序综合 semantic similarity、importance、recency、access_count 和 scope match。
- 只注入少量结构化事实，默认 3-8 条；不得把完整历史事件塞进 Prompt。
- 用户当前话语与记忆冲突时，当前话语优先，并产生可选更新候选。

### 11.5 允许和禁止保存

- 允许：明确称呼、回答风格、稳定兴趣、长期学习/工作目标、项目技术栈、用户明确要求记住的事实。
- 临时：这次任务偏好、当前草稿细节、一次性指令，进入瞬时/工作记忆，不长期保存。
- 默认禁止：密码、Token、银行卡、精确住址、医疗隐私、未经同意的第三方个人信息、从笔记正文猜出的用户身份。
- 用户关闭记忆后停止读写；历史记忆默认保留但不使用，用户可继续删除或选择清空。

### 11.6 冲突、版本与删除

- 单值字段（name、preferred_language 等）采用新值替换并写 old/new event。
- 多值字段（interests、skills）使用 add/remove 语义，不以整段文本覆盖。
- 内容指纹 + canonical_key 保证幂等；相同事实只提升 confidence/access，不重复创建。
- 删除先软删除 NoteFlow 投影，再删除 Mem0 向量；两者通过 outbox 重试，界面立即不可见。
- 每个记忆显示来源、创建时间、最近使用和删除入口。

### 11.7 Mem0 接入策略

- Mem0Provider 已成为唯一长期记忆检索和同步实现。
- `user_memories` 继续承担权限、安全策略、状态投影和审计，不作为第二套检索运行时。
- 自托管 OSS 不支付 Mem0 Cloud 订阅，但仍有数据库、模型调用、计算、监控、备份和升级维护成本。
- Mem0 使用现有 PostgreSQL/pgvector 或独立 schema/namespace，不新增 Qdrant。

## 12. 笔记、草稿与编辑功能设计

### 12.1 正式笔记生命周期

- 新建：先创建空笔记或由已确认草稿保存；写入 version 0 和 index job。
- 编辑：自动保存使用 debounce 与 optimistic concurrency；服务端比较 updated_at/content hash。
- 版本：手动编辑、AI 应用、恢复和批量变更前保存版本。
- 删除：默认软删除；恢复后重新索引；永久删除必须二次确认并清理派生数据。
- 附件：对象存储 key 与 note_id 关联，校验大小、类型和哈希。

### 12.2 AI 草稿子图

1. 收集 topic、目标读者、深度、长度、来源模式和风格。
2. 缺少关键条件时 clarify，不盲目生成。
3. 可选调用 RAG 获取现有笔记来源与用户记忆偏好。
4. 生成大纲，写 NoteDraft/Sections，创建 draft_workspace checkpoint。
5. interrupt 等待用户确认或修改大纲。
6. DraftWorker 分节生成，支持暂停、重试、删除/恢复和版本。
7. assemble 后用户确认保存；save_to_notes 创建正式笔记、版本和索引任务。

### 12.3 AI 修改子图

1. 从 selection、section 或整篇确定目标范围。
2. 若范围不明确，先 clarify；不得默默扩大修改范围。
3. 生成 new_content、change_summary 和来源，写 NoteEditPreview。
4. 展示 diff，允许用户继续修订预览或恢复旧 revision。
5. interrupt 等待应用/取消。
6. apply 时校验基线 content hash；冲突则拒绝并要求重新生成预览。
7. 应用前写 NoteVersion；应用后触发局部索引和 tool trace。

### 12.4 正文编辑与 AI 的边界

- 用户正在编辑的未保存内容以 pageState 进入本轮，不写数据库、不生成长期索引。
- AI 返回的代码块和 Markdown 必须经过前端已有渲染/编辑器兼容层，不直接注入不受控 HTML。
- 选中文本工具栏只是发起指令；真正修改仍走 EditPreview，不直接覆盖正文。

## 13. 数据模型设计

### 13.1 当前表分组

| 分组 | 当前表 |
|---|---|
| 账户 | users、user_settings、user_sessions、password_reset_tokens |
| 知识组织 | knowledge_bases、note_categories、notes、note_attachments、note_versions |
| RAG 索引 | note_sections、note_chunks、note_embeddings、note_index_jobs |
| AI 草稿 | note_drafts、note_draft_sections、note_draft_section_versions |
| AI 修改 | note_edit_previews、note_edit_preview_revisions |
| 记忆 | user_memories、user_memory_events |
| 对话/运行 | chat_sessions、chat_messages、agent_runs、agent_steps、agent_tool_traces、agent_checkpoints |

### 13.2 现有 RAG 表继续保留

- note_sections：结构化标题、父子关系、正文、token_count、content_hash。
- note_chunks：section 下的稳定 chunk，正文和 content_hash。
- note_embeddings：chunk 对应 provider、model、dimension、vector、status 和 error。
- 把 embedding 与 chunk 分表是正确设计：同一 chunk 可以并存不同模型/维度/版本，不需要把 vector 塞回 note_chunks。

### 13.3 建议新增或扩展字段

- notes.source_version：每次正文/关键 metadata 变化递增。
- note_sections/chunks.index_version、parser_version、chunker_version。
- note_embeddings.index_version、embedding_version；唯一键覆盖 chunk_id + model + index_version。
- note_index_jobs.job_type、source_version、claimed_by、heartbeat_at、error_code。
- agent_runs.graph_version、request_id、degraded_flags。
- agent_tool_traces.provider、model、token_usage、error_code、trace_id。
- user_memories.external_provider、external_id、canonical_key、memory_layer、expires_at、source_message_id。

### 13.4 建议新增表

- rag_query_logs：query hash、rewrite、通道数量、Top K、耗时、降级和反馈；正文按隐私规则脱敏或不存。
- rag_eval_cases/rag_eval_runs：固定评测集、版本、指标和对比结果。
- integration_outbox：索引和 Mem0 同步的可靠异步事件。
- langgraph checkpoint tables：由官方 PostgreSQL checkpointer 管理，独立于业务 agent_checkpoints。
- 可选 workspace/membership/ACL 表属于后续多用户协作扩展，本轮不创建空壳。

### 13.5 关键索引与约束

- notes(user_id, deleted_at, updated_at)、note_sections(note_id, content_hash)、note_chunks(note_id, content_hash)。
- note_embeddings HNSW cosine，查询必须同时限制 user_id/status/model/dimension。
- title/content/section/chunk 的 pg_trgm GIN 索引继续保留作为标题和 fallback 词法通道。
- agent run/trace/checkpoint 按 user_id、session_id、run_id 和 created_at 建组合索引。
- user_memories 按 user_id、status、canonical_key、scope 建索引；单值 active key 可使用部分唯一约束。

## 14. API 与 SSE 设计

### 14.1 现有公开 API 保留

- /api/auth：注册、登录、刷新、迁移旧 Token、退出、当前用户、会话、密码重置。
- /api/notes 和 /api/categories：CRUD、搜索、上下文、版本、恢复、重建索引、outline、embedding 状态、related、index jobs。
- /api/note-drafts：创建、更新、分节、确认、生成全部、停止、组装、保存和取消。
- /api/note-edit-previews：创建、修订、恢复 revision、应用和取消。
- /api/memories、/api/settings：记忆搜索/提取/CRUD/上下文和用户开关。
- /api/agent：chat、runs、cancel、checkpoint bind/resolve。
- /api/health、/api/diagnostics、/api/metrics。

### 14.2 内部 API 收敛

- /api/ai/chat 和 /api/notes/generate 作为 legacy 兼容入口，逐步转发到统一 Agent Application Service。
- 新增 /api/agent/runs/{run_id}/events 可选重连/回放接口。
- LlamaIndex、Mem0 和 Tool 不直接暴露公网 API；只有应用服务可调用。
- 所有写请求支持 request_id/idempotency_key，错误使用稳定 code 而不是只返回字符串。

### 14.3 SSE 事件类型

| type | 关键字段 | 用途 |
|---|---|---|
| agent_session | sessionId、runId、intent | 初始化本轮 |
| tool_trace | toolName、action、status、durationMs | 用户可见或调试轨迹 |
| context | contextMode、sources、queryTrace | RAG 来源 |
| checkpoint | checkpoint | 等待确认/可恢复任务 |
| tool_action | toolName、action、payload | 打开草稿或预览工作区 |
| choices | delta.content | 兼容现有流式文本 |
| agent_done | runId、status | 正常结束/取消/失败 |
| agent_error | code、message、retryable | 结构化错误 |
| [DONE] | 无 | 流结束标记 |

### 14.4 事件可靠性

- sequence 对同一 run 单调递增，重复事件可由 event_id 去重。
- tool trace 可以标记 silent，前端不展示内部 policy/planner 噪音。
- 错误事件后仍发送 agent_done(status=failed) 和 [DONE]，保证前端收口。
- 敏感工具输入只写摘要，原始 Token、密码、完整个人数据不得进入 SSE 或 trace。

## 15. 配置、依赖与 Provider 设计

### 15.1 新增后端依赖组

```text
langgraph
langgraph-checkpoint-postgres
langchain-core
langchain-openai（用于 OpenAI-compatible Provider，可用自有适配器替代）
llama-index-core
llama-index-vector-stores-postgres
llama-index-retrievers-bm25
bm25s
jieba
markdown-it-py
mem0ai
```

- Reranker SDK 按最终 provider 单独加入，也可先用 httpx 实现 Provider。
- 新依赖在 PoC 通过后锁定精确版本；生产不使用无上限范围。
- 拆分 requirements/base.txt、ai.txt、dev.txt 或迁移 pyproject + lock，避免一个文件无法表达可选能力。

### 15.2 目标环境变量

```text
GRAPH_VERSION=v1
LLM_PROVIDER=deepseek
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-v4-pro
RAG_REWRITE_ENABLED=true
RAG_BM25_ENABLED=true
RAG_RERANK_ENABLED=true
RAG_CANDIDATE_K=30
RAG_TOP_K=8
RERANK_PROVIDER=...
RERANK_MODEL=...
EMBEDDING_PROVIDER=dashscope
EMBEDDING_MODEL=text-embedding-v4
EMBEDDING_DIMENSIONS=1024
```

### 15.3 Provider 接口

- ChatModelProvider：stream、complete、structured_output、token usage。
- EmbeddingProvider：embed_documents、embed_query、dimension、model_version。
- RerankerProvider：rerank(query, nodes, top_n)。
- VectorStoreProvider：upsert/delete/query，默认 PgVector。
- MemoryProvider：add/search/update/delete，默认迁移后 Mem0。
- 每个 Provider 都定义 timeout、retry、circuit breaker 和错误映射。

## 16. 目标代码目录结构

### 16.1 前端目录保持现有结构

```text
src/
├── components/
│   ├── AppNav.tsx
│   ├── DirectoryTree.tsx
│   ├── TiptapPilotEditor.tsx
│   ├── AIPanel.tsx
│   ├── AIDraftWorkspace.tsx
│   ├── EditPreviewWorkspace.tsx
│   ├── VersionHistoryPanel.tsx
│   └── AttachmentPanel.tsx
├── editor/
│   ├── compatibility.ts
│   └── tiptapExtensions.ts
├── hooks/
│   └── useAuthSession.ts
├── services/
│   ├── api.ts
│   ├── auth.ts
│   ├── notes.ts
│   ├── categories.ts
│   ├── attachments.ts
│   ├── agent.ts
│   ├── deepseek.ts
│   ├── drafts.ts
│   ├── edits.ts
│   ├── memories.ts
│   └── offlineQueue.ts
├── storeSlices/
│   ├── workspace.ts
│   ├── editor.ts
│   ├── chat.ts
│   ├── agent.ts
│   └── draft.ts
└── utils/
```

### 16.2 目标后端目录

```text
server/app/
├── main.py
├── config.py
├── database.py
├── deps.py
├── routers/                    # 只保留 HTTP/SSE 传输职责
│   ├── auth.py
│   ├── notes.py
│   ├── attachments.py
│   ├── drafts.py
│   ├── edits.py
│   ├── memories.py
│   ├── settings.py
│   ├── agent.py
│   └── health.py
├── schemas/
│   ├── api/
│   ├── tools/
│   ├── runtime.py
│   └── common.py
├── models/
│   ├── db.py                  # 迁移期保留；稳定后可按领域拆分
│   └── enums.py
├── agent/
│   ├── graph.py
│   ├── state.py
│   ├── policy.py
│   ├── routing.py
│   ├── prompts.py
│   ├── events.py
│   ├── nodes/
│   │   ├── ingress.py
│   │   ├── planner.py
│   │   ├── answer.py
│   │   ├── finalize.py
│   │   └── errors.py
│   └── subgraphs/
│       ├── note_qa.py
│       ├── draft.py
│       ├── edit.py
│       └── memory.py
├── rag/
│   ├── service.py
│   ├── schemas.py
│   ├── parser.py
│   ├── chunker.py
│   ├── ingestion.py
│   ├── query.py
│   ├── retrievers/
│   │   ├── title.py
│   │   ├── bm25.py
│   │   └── vector.py
│   ├── fusion.py
│   ├── reranker.py
│   ├── context_builder.py
│   ├── citations.py
│   ├── permissions.py
│   └── evaluation.py
├── memory/
│   ├── service.py
│   ├── provider.py
│   ├── mem0_provider.py
│   ├── legacy_provider.py
│   ├── policy.py
│   ├── extraction.py
│   ├── retrieval.py
│   ├── conflicts.py
│   └── schemas.py
├── tools/
│   ├── registry.py
│   ├── notes.py
│   ├── rag.py
│   ├── drafts.py
│   ├── edits.py
│   └── memory.py
├── services/                   # 领域应用服务，不再承担全局编排
│   ├── notes.py
│   ├── drafts.py
│   ├── edits.py
│   ├── attachments.py
│   ├── auth.py
│   └── settings.py
├── repositories/
│   ├── notes.py
│   ├── rag.py
│   ├── memory.py
│   ├── agent.py
│   └── outbox.py
├── providers/
│   ├── llm.py
│   ├── embeddings.py
│   └── reranker.py
├── workers/
│   ├── index_worker.py
│   ├── draft_worker.py
│   ├── memory_worker.py
│   └── outbox_worker.py
└── observability/
    ├── logging.py
    ├── metrics.py
    └── tracing.py
```

### 16.3 现有文件迁移映射

| 当前文件 | 目标位置/处理 |
|---|---|
| routers/agent.py | 保留路由薄壳，流程迁入 agent/graph、nodes、subgraphs |
| services/context_planner.py | 拆为 agent/policy.py、routing.py、planner node |
| services/note_library.py | 拆为 rag/query、retrievers、fusion、context_builder |
| services/markdown_index.py | 拆为 rag/parser、chunker、ingestion |
| services/embedding_index.py、embeddings.py | providers/embeddings + rag/ingestion |
| services/memory*.py、agent_memory.py | memory/provider、policy、retrieval、extraction、legacy_adapter |
| services/agent_checkpoints.py、agent_runtime.py | agent runtime repository + graph checkpoint adapter |
| services/index_worker.py、draft_worker.py | workers/，保留当前行为和测试 |

### 16.4 拆分纪律

- 先建立新接口和适配器，再移动实现；每次移动保持 API 测试通过。
- 不为目录整齐把相关逻辑拆成大量只有几十行的文件；以稳定职责和独立测试为边界。
- `services` 不再成为所有功能的混合目录，但迁移期允许 legacy facade 转发。
- 禁止新增第二套同名模型或重复路由。

## 17. 安全、权限与隐私

### 17.1 用户隔离

- user_id 只从认证上下文获取；模型输入中的 user_id 一律忽略。
- 所有 Note/Chunk/Embedding/Memory/Run 查询同时约束 user_id。
- RAG 三个通道和 rerank 前都执行权限过滤；评测必须包含跨用户泄漏测试。
- 未来 workspace 权限必须在 Repository/Vector metadata filter 层统一实现。

### 17.2 Prompt Injection 防护

- 笔记正文和检索来源被视为不可信数据，不得覆盖系统规则或工具权限。
- Prompt 用明确边界包裹来源，并告诉模型忽略来源中的指令性文本。
- Tool 调用由 graph policy 和 schema 校验，不能仅凭模型生成的 tool name/arguments 执行。
- 写工具有 allowlist、范围校验、确认和幂等保护。

### 17.3 敏感信息与日志

- API Key、Cookie、Authorization、密码和重置 Token 不进入日志、trace、记忆和 RAG。
- ToolTrace 只保留摘要；来源正文按需要截断。
- RAG query log 默认存 hash、指标和脱敏摘要；用户可配置是否用于质量分析。
- 附件访问使用用户校验和不可猜测 storage key。

### 17.4 生产安全基线

- JWT secret 至少 32 字符、Secure/HttpOnly/SameSite Cookie、精确 CORS origin。
- 登录、AI、重排、Embedding 和索引重试分别限流。
- 外部 Provider 使用超时、最大响应大小、证书校验和最小权限密钥。
- 数据库备份、恢复演练、迁移回滚和对象存储生命周期纳入发布流程。

## 18. 缓存、异步任务与降级

### 18.1 Redis 使用范围

- AI response cache：仅缓存安全、可复用且不含未保存正文的请求。
- Query Rewrite cache、RAG 结果短缓存：key 必须包含 user_id、索引版本和配置版本。
- 分布式锁：同一 note 索引、同一 run resume、同一 draft section worker。
- 限流与取消标记。
- SSE cursor/事件热缓存；持久记录仍在 PostgreSQL。

### 18.2 后台任务

- IndexWorker：解析、chunk、BM25/向量索引。
- DraftWorker：分节生成与组装。
- MemoryWorker：候选提取、Mem0 同步、过期和冲突处理。
- OutboxWorker：跨数据库/外部 provider 的可靠最终一致。
- 任务包含 owner、attempt、heartbeat、deadline 和 idempotency key。

### 18.3 降级顺序

1. Reranker 失败 -> 使用 RRF。
2. Vector/Embedding 失败 -> 标题 + BM25/词法。
3. BM25 未就绪 -> 标题 + vector + trigram fallback。
4. Mem0 失败 -> 不注入长期记忆，显式记忆写入排队，不影响主回答。
5. LangGraph checkpoint 临时失败 -> 当前请求可完成只读回答；需要副作用/恢复时拒绝继续。
6. LLM 失败 -> 返回可重试错误，保留 run/checkpoint 和用户输入。

## 19. 可观测性、性能与成本

### 19.1 Trace 关联

- 每个请求生成 request_id、trace_id、session_id、run_id。
- graph node、tool、SQL、LLM、Embedding、Reranker、worker job 使用同一 trace 关联。
- 日志为结构化 JSON；用户可见 trace 与内部技术 trace 分离。

### 19.2 关键指标

- API：请求量、错误率、p50/p95、SSE 中断率。
- Agent：各 intent 数量、节点耗时、interrupt 数、恢复成功率、取消率。
- RAG：rewrite/rerank 命中率、各通道候选数、Recall@K、无结果率、引用覆盖率。
- Index：队列深度、等待时间、成功/失败/重试、过时索引数量。
- Memory：候选数、接受/拒绝、冲突、错误记忆反馈、读写延迟。
- Provider：调用次数、token、费用、超时、限流、降级。

### 19.3 初始延迟预算

| 阶段 | 目标 p95 |
|---|---|
| API 认证/初始化 | 150 ms |
| Memory recall | 250 ms，可并行/超时跳过 |
| Query Rewrite | 800 ms，缓存命中 < 50 ms |
| Hybrid Retrieval | 500 ms |
| Reranker | 800 ms，超时降级 |
| 首个 LLM token | 总体 2.5-4 s 内 |
| Index 单篇任务 | 异步，不阻塞保存 |

### 19.4 成本控制

- Rewrite 只对需要的 query 调用小模型；短期缓存。
- Reranker 限制候选数量和文本长度。
- Embedding 按 content_hash 复用，批量调用。
- Memory extraction 异步批处理，普通寒暄不调用。
- 保存 provider/model/token usage 到 run/trace，支持按用户和功能统计。

## 20. 测试与质量评估

### 20.1 测试分层

- 单元测试：policy、router、chunker、fusion、permission filter、memory conflict、tool schema。
- Repository 集成测试：真实 PostgreSQL + pgvector，验证 user_id、事务、索引和锁。
- Graph 测试：固定 state 驱动节点与分支，不依赖真实模型。
- Provider 合约测试：Mock 与真实 sandbox，验证超时、重试、结构化输出。
- API 合约测试：现有路径、状态码、SSE 顺序与兼容字段。
- E2E：前端操作到数据库、索引、RAG、草稿、编辑、恢复和记忆。

### 20.2 RAG 必测场景

- 精确标题、模糊标题、中文同义词、英文缩写、代码符号。
- 同一 query 在 title/BM25/vector 不同排名下的 RRF。
- Reranker 成功、超时和返回异常。
- 当前用户和其他用户拥有同名笔记时零泄漏。
- 删除、恢复、修改后 source_version 正确。
- 严格模式无来源不生成常识答案。
- 引用编号与真实 source 一一对应。

### 20.3 Memory 必测场景

- 明确“记住”写入；临时指令不写长期；第三方信息拒绝。
- 单值更新、多值增删、重复幂等、用户纠正和删除。
- 关闭 memory 后不读不写。
- 当前输入覆盖旧记忆。
- Mem0 失败时主回答继续，写入进入重试。
- 跨用户 search 和 external_id 关联零泄漏。

### 20.4 Agent/Runtime 必测场景

- chat 与 ask_notes 模式不会被 planner 偷换。
- draft/edit interrupt 后重启进程仍可恢复。
- 重复 resume 不重复创建笔记或应用修改。
- 取消能终止 worker 和后续节点。
- SSE 每条流最终有 agent_done 与 [DONE]。
- graph 版本不兼容时给出受控错误。

### 20.5 前端回归

- 代码块可编辑、可选中、语言菜单和复制正常。
- 选区工具栏、目录搜索、新建文件夹、删除确认、AI 圆形入口等现有行为不回退。
- 普通对话/全库搜索模式切换和关闭菜单正常。
- 来源、工具轨迹、草稿和编辑预览能消费新 SSE Adapter。
- 构建、编辑器往返、选择、输入法、离线冲突和 PWA 测试持续通过。

## 21. 分阶段迁移方案

### 21.1 Phase 0：冻结基线

- 固定现有 API/SSE 合约、数据库快照和前端回归测试。
- 建立 RAG 固定评测集和 Memory 安全用例。
- 记录当前延迟、错误率和检索指标。
- 统一模型配置显示，明确本地 deepseek-v4-pro 与 fallback 差异。

验收：不改用户行为，现有测试全绿，能够一键回滚。

### 21.2 Phase 1：建立模块接口

- 新增 ChatModelProvider、RagService、MemoryProvider、ToolResult 和 RuntimeEvent。
- 建立统一 Provider 和 Tool 边界。
- 把 router 中可搬出的 SQL/业务逻辑移到 service/repository。

验收：所有正式入口统一使用类型化 Provider 和 RuntimeEvent。

### 21.3 Phase 2：LangGraph Shadow

- 建立主图、state、policy、只读 note_qa/general_chat 子图和 PostgreSQL checkpointer。
- 相同请求同时运行 legacy plan 与 graph plan，只记录差异，不影响用户结果。
- 完成 SSE Adapter、run/step/trace 关联。

验收：路由一致率达目标；无跨用户/副作用风险；可按用户灰度。

### 21.4 Phase 3：LlamaIndex RAG v2

- 接入 AST Parser、结构化 chunk、LlamaIndex Node 和 pgvector adapter。
- 先保留 title/vector，实现 BM25、Query Rewrite、Permission Filter、RRF、Reranker、Context Builder。
- 双跑 legacy 与 v2 检索，比较 Recall@K、MRR、延迟和来源差异。

验收：固定评测集显著不劣于 legacy；权限测试 100%；Reranker 失败可降级。

### 21.5 Phase 4：草稿/编辑迁入子图

- 把 draft/edit 的流程控制迁入 LangGraph，继续调用现有 DraftService/EditService 和 worker。
- 建立 interrupt、resume、幂等和双层 checkpoint。

验收：进程重启恢复、重复确认、取消和并发冲突全部通过。

### 21.6 Phase 5：Mem0 Shadow 与切换

- 实现 Mem0Provider，使用 PostgreSQL/pgvector namespace。
- shadow write/read，对比召回质量、错误记忆、延迟和删除一致性。
- 用户级灰度切换；旧 user_memories 保留为产品投影与审计。

验收：安全规则不弱于旧系统，删除闭环和关闭开关可靠，跨用户零泄漏。

### 21.7 Phase 6：默认切换与清理

- LangGraph、LlamaIndex RAG v2 和 Mem0 已成为唯一正式运行链路。
- 灰度、Shadow、Canary 和重复编排代码已删除。
- 更新运维手册、告警、数据迁移和灾备文档。

验收：全量 E2E、性能、安全、RAG 评测和生产灰度指标通过。

## 22. 发布门禁与最终验收

### 22.1 功能门禁

- 现有笔记、编辑器、目录、AI 面板、草稿、编辑预览和版本能力无回退。
- 普通对话不会未经用户选择搜索全库。
- 问笔记回答带真实来源；无证据时不编造。
- 正式写入有确认、版本、幂等和可恢复状态。
- 用户能查看、修改、删除并关闭长期记忆。

### 22.2 数据门禁

- 迁移前后 notes、versions、drafts、previews、memories 和 chat 记录数量可核对。
- 旧向量可重建；新索引完成前有 fallback。
- 任意请求不能读取其他用户的 note/chunk/vector/memory/run。
- 删除、恢复和版本切换后 RAG 不返回过时内容。

### 22.3 工程门禁

- 新模块有类型化接口和单元测试，router 不再承载长流程。
- 所有外部 Provider 有 timeout、retry、circuit breaker 和降级。
- 关键路径有 metrics/trace，错误可定位到 node/tool/provider。
- Docker、本地开发和生产配置使用同一模型命名和版本策略。
- 数据库迁移可前滚、可回滚，备份恢复演练通过。

### 22.4 质量目标

- RAG 固定评测集 Recall@8、MRR、nDCG 不低于 legacy 基线，并达到项目设定阈值。
- 权限隔离测试 100% 通过。
- Agent interrupt/resume 和幂等 E2E 100% 通过。
- P95 首 token、检索和 rerank 延迟在预算内，降级不影响可用性。
- Memory 错误保存率、安全拒绝率和用户删除成功率可持续监控。

## 23. 风险与控制

| 风险 | 表现 | 控制措施 |
|---|---|---|
| 框架叠加过度 | LangGraph/LlamaIndex/Mem0 都控制同一逻辑 | 明确边界，统一 Tool/Provider 接口 |
| 双写不一致 | legacy、Mem0 或两套索引结果不同 | outbox、external_id、shadow 指标、可重建 |
| RAG 假升级 | 只换框架名，没有 BM25/rerank/eval | 固定评测集和通道 trace 作为验收 |
| 权限泄漏 | 先全局向量召回后过滤 | 每个通道查询阶段前置 user_id/ACL |
| checkpoint 混乱 | 框架 state 与产品任务状态互相覆盖 | 双层 checkpoint、独立表与语义 |
| 前端回退 | 后端事件变化破坏现有 UI | SSE Adapter + 前端合约测试 |
| 成本失控 | 每轮都 Rewrite/Rerank/Memory extract | 条件触发、缓存、批处理、预算和指标 |
| 一次性重写 | 难定位问题、无法回滚 | adapter、shadow、feature flag、逐用户灰度 |

## 24. 决策记录与待确认项

### 24.1 已确定，不再反复讨论

- 前端 UI 基本不改，功能升级以保持现有交互为约束。
- LangGraph 管全局流程；LlamaIndex 是被调用的 RAG 模块。
- Mem0 OSS 用于长期记忆；NoteFlow 保留策略、审计和用户控制。
- 继续使用 PostgreSQL + pgvector，不迁移 Qdrant。
- Markdown 使用 Parser/AST，不继续扩大手写正则解析。
- BM25 使用成熟库，不自研排序公式；中文分词可替换且版本化。
- RAG 必须包含权限前置、融合、Reranker、引用和评测。
- 分阶段迁移，不一次性重写。

### 24.2 实施前只需在 PoC 固化的参数

- Reranker provider/model、单批文本长度和超时。
- BM25 tokenizer 词典、索引持久化方式和缓存容量。
- chunk token 大小、overlap、RRF 权重、candidate K、Top K。
- Mem0 具体 schema/namespace 与 user_memories 投影同步细节。
- LangGraph 官方 PostgreSQL checkpointer 的版本和迁移方式。

这些是可通过评测和压测确定的实现参数，不改变本文档的总体架构。

## 25. 典型流程示例

### 25.1 基于笔记回答

```text
用户选择“全库搜索”并提问
-> FastAPI 认证/限流
-> LangGraph 应用 ask_notes 硬规则
-> 可选 Memory Recall（只用于回答风格，不作为知识来源）
-> RAG Query Rewrite/Expansion
-> Permission Filter
-> Title + BM25 + Vector 并行召回
-> RRF -> Reranker -> Context Builder
-> LLM 严格依据来源流式回答
-> SSE 输出 context/citations/answer
-> 写 ChatMessage、Run、Trace 和 RAG Metrics
```

### 25.2 生成课程笔记

```text
用户提出主题
-> Planner 检查目标/基础/深度是否足够
-> 需要时 clarify
-> 读取允许的偏好记忆
-> 可选检索用户已有笔记
-> 生成大纲并创建 Draft
-> interrupt 等待确认
-> DraftWorker 分节生成
-> 用户修订/确认
-> 保存正式 Note + Version + IndexJob
-> 后台索引与可选项目情景记忆更新
```

### 25.3 修改正式笔记

```text
选中文本 + 修改指令
-> 创建 EditPreview
-> 展示 diff，用户可继续修订
-> interrupt 等待应用
-> 校验原文 hash
-> 写旧版本
-> 应用修改
-> 创建局部 IndexJob
-> SSE/ToolTrace 返回完成
```

### 25.4 长期记忆

```text
用户：“以后回答尽量简洁，记住。”
-> 当前回答优先完成
-> Memory candidate: answer_style=concise
-> Policy：显式、低敏、长期 -> active
-> 写 user_memories/event + Mem0 vector
-> 后续需要个性化时 recall
-> 用户当前要求与旧偏好冲突时，以当前要求为准
```

## 26. 最终架构结论

NoteFlow 不需要推翻现有产品，也不需要用框架替代所有业务代码。最合理的升级方式是保留已经稳定的前端、API、数据模型和领域能力，在其上建立清晰的编排与 AI 能力边界：LangGraph 负责全局流程和恢复；LlamaIndex 负责可评测的 RAG v2；Mem0 负责长期记忆智能；PostgreSQL + pgvector 继续统一承载业务与向量数据；Redis 提供短暂基础设施能力。

完成迁移后的 NoteFlow 应同时具备四个特征：用户体验不因重构而回退；AI 行为可控、可追踪、可恢复；RAG 有真实的混合召回、重排、权限和评测；长期记忆可用但不越权。本文档作为后续代码重构、技术评审、任务拆分和最终验收的统一依据。
