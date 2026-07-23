# NoteFlow 步骤 13～15 完成报告

执行日期：2026-07-17（Asia/Shanghai）

## 结论

只读 LangGraph + RAG v2 灰度、AI 草稿子图和 AI 编辑子图已经接入现有 API、SSE、Draft、EditPreview、NoteVersion 与 IndexJob 链路。工程验收完成，生产默认仍保持 legacy 和 0% 灰度，不会自动改变当前用户行为。

| 步骤 | 工程状态 | 生产状态 |
|---|---|---|
| 13：只读 Agent/RAG 灰度 | 已完成 | 默认关闭，等待配置内部用户 |
| 14：草稿 LangGraph 子图 | 已完成 | `DRAFT_RUNTIME=legacy` |
| 15：编辑 LangGraph 子图 | 已完成 | `EDIT_RUNTIME=legacy` |

## 步骤 13：只读灰度

- `/api/agent/chat` 保持原 API、前端模式和 SSE 协议。
- 只有 `general_chat`、`note_search/note_qa` 可以进入只读 LangGraph；生成、编辑、确认、取消和恢复类意图强制留在 legacy/write 子图。
- 用户通过 SHA-256 稳定分桶，同一用户不会在相同比例下随机抖动；内部白名单优先于百分比。
- `chat` 永不搜索全库；显式 `ask_notes` 固定走 `note_qa + LlamaIndexRagService`。
- 记录 `agent_canary.run/latency/first_payload/retrieval` 指标，以及 runtime rollout tool trace、来源和 fallback 原因。
- 首个用户可见回答前发生 checkpoint、RAG 或 Provider 故障时，自动回退 legacy readonly；连续错误达到阈值后打开进程级熔断，后续请求直接走 legacy。
- 全局开关、用户白名单、比例开关和熔断均不需要数据库回滚。

### 推荐启用顺序

1. 保持 `AGENT_RUNTIME=legacy`，确认 `/api/metrics` 和现有流量稳定。
2. 设置 `AGENT_RUNTIME=langgraph`、`LANGGRAPH_CANARY_ENABLED=true`，比例仍为 0。
3. 在 `LANGGRAPH_CANARY_USER_IDS` 中加入内部用户，观察错误率、首个 payload、检索延迟、来源和无结果行为。
4. 依次把 `LANGGRAPH_CANARY_PERCENT` 提高到 1、5、10、25、50、100；每一级达到项目观察窗口后再提高。
5. 发生权限异常、checkpoint 故障、Provider 集中失败或错误阈值触发时，先把 `LANGGRAPH_CANARY_ENABLED=false`；无需删除 checkpoint 或回滚 0008。

## 步骤 14：草稿子图

草稿状态机：

`requirements → context → outline → persist Draft → interrupt(outline) → dispatch sections → interrupt(worker) → assemble → interrupt(save) → formal Note`

- `langgraph_draft.py` 提供类型化 State、依赖回调、三处 durable interrupt 和 Postgres checkpoint resume。
- `write_runtime.py` 把子图接到现有草稿 API；checkpoint 不可用时单次请求自动降级为 legacy，业务草稿仍可继续。
- DraftWorker 只生成 section 并 assemble。生成完成后状态为 `assembled/awaiting_save_confirmation`，不再后台创建正式 Note。
- 只有 `save-to-notes` 且 `confirm=true` 才创建 Note、NoteVersion 和 IndexJob。
- Draft、section generation 和 save 都保留幂等信息；保存使用行锁，重复确认返回同一 Note，不重复创建。
- `generation_key/retry_count` 支持 section 重试审计；取消标记和现有 worker 协议保留。
- PostgreSQL 中的 NoteDraft 是业务真相源；LangGraph checkpoint 负责流程位置，两者可独立诊断。

## 步骤 15：编辑子图

编辑状态机：

`resolve scope → optional clarify → EditPreview → interrupt → revise/restore loop | cancel | apply`

- selection、section、whole note、insert、delete 继续复用现有范围解析逻辑。
- 子图只创建和修改 EditPreview；正式 Note 在 apply 前保持不变。
- revise 与 restore 后回到同一个 apply interrupt，cancel 直接结束。
- 预览创建时记录整篇正文 `source_content_hash`；apply 时加行锁并重新计算，原文变化即返回 409，禁止静默覆盖。
- apply 前写 NoteVersion，apply 后创建 IndexJob；重复 apply 返回已应用结果，不重复写版本和索引任务。
- pageState 的未保存正文只作为临时上下文，不写索引和长期记忆。
- checkpoint 故障不会阻断 legacy EditPreview 业务链路；回滚只需 `EDIT_RUNTIME=legacy`。

## 数据库迁移

主库已升级到 `20260717_0008`，新增：

- Draft：`runtime`、`graph_thread_id`。
- DraftSection：`generation_key`、`retry_count`。
- EditPreview：`runtime`、`graph_thread_id`、`source_content_hash`、`applied_content_hash`。
- Draft/Edit 用户级幂等唯一索引和 graph thread 查询索引。

迁移只增加流程与并发保护元数据，不改笔记正文。关闭运行时不要求 downgrade；如必须 downgrade，先保持三个 runtime 为 legacy，再回退 0008。

## 默认配置与回滚

```dotenv
AGENT_RUNTIME=legacy
LANGGRAPH_CANARY_ENABLED=false
LANGGRAPH_CANARY_PERCENT=0
LANGGRAPH_CANARY_USER_IDS=
DRAFT_RUNTIME=legacy
EDIT_RUNTIME=legacy
```

紧急回滚顺序：

1. `LANGGRAPH_CANARY_ENABLED=false`。
2. `AGENT_RUNTIME=legacy`。
3. `DRAFT_RUNTIME=legacy`、`EDIT_RUNTIME=legacy`。
4. 保留 Draft、EditPreview、NoteVersion、IndexJob 和 checkpoint 数据，排查后可继续恢复。
5. 只有确认新字段必须删除时才 downgrade 0008；正常事故处置不做数据库回滚。

## 验收结果

- 写入子图专项：锁定 Python 3.12 / LangGraph 1.2.9 镜像中 5/5 通过。
- 步骤 13～15 + 架构 + 编辑匹配定向测试：27/27 通过。
- 默认后端回归：99 tests 通过；本机旧 LangGraph 和真实数据库项目按条件跳过。
- 锁定 Python 3.12 / LangGraph 1.2.9 的真实 PostgreSQL/pgvector 集成：9/9 通过，包含 Draft/Edit durable checkpoint 与 resume。
- 前端 production build：通过。
- 最终全量质量门禁：26/26 通过。
- 最终报告：`quality/reports/steps-13-15-final.md` 与 `.json`。

## 下一步

进入步骤 16～18：Mem0 长期记忆 Shadow、灰度、安全与灾备。开始步骤 16 时继续保持本阶段全部生产开关为默认值，先做 memory shadow，不同时扩大 Agent canary。
