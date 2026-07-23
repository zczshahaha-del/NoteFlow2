# NoteFlow 步骤 8～9 完成报告

执行日期：2026-07-17（Asia/Shanghai）

## 结论

步骤 8 的 LangGraph 只读主图和步骤 9 的 Shadow 双跑基础已完成。生产用户结果仍 100% 来自 legacy；PoC 路由、Shadow 总开关和采样率默认全部关闭。

| 步骤 | 状态 | 结果 |
|---|---|---|
| 8：只读主图 PoC | 已完成 | `chat/general_chat`、`ask_notes/note_qa`、只读 Memory/RAG、Provider token→RuntimeEvent、PostgreSQL Checkpoint 恢复 |
| 9：Shadow 双跑 | 已完成 | plan-only 后台图、确定性采样/用户 allowlist、超时/并发隔离、差异表、硬违规、用户级汇总 |

## 关键实现

- 新增 `app/agent/langgraph_readonly.py`：结构化 State、9 个主节点、硬模式路由、只读 Tool adapter、流式事件队列和官方 PostgreSQL checkpointer factory。
- 新增隔离路由 `POST /api/agent/langgraph-poc/chat`，默认关闭且只允许 `chat/ask_notes`。
- 新增 `app/agent/shadow.py`：只对 legacy 只读 intent 旁路执行，主回答不等待 Shadow。
- 新增 `agent_shadow_runs` 与 Alembic `20260717_0006`，只保存问题 hash 和结构化差异，不保存正文。
- 新增 `GET /api/agent/langgraph-shadow/summary` 和 Agent Shadow metrics。
- 后端运行依赖锁定 `langgraph 1.2.9`、`langgraph-checkpoint-postgres 3.1.0`、`psycopg 3.3.4`。

## 硬规则验证

- `chat` 输入即使文字包含“我的笔记”，也不调用全库 RAG。
- `ask_notes` 必须进入 `note_qa`，有来源时输出 context/source；无来源时返回受控“没有找到”。
- 不支持的写模式进入稳定 `mode_not_allowed` 错误流。
- Graph Node 不依赖 ORM，不接受模型提供的 `user_id`。
- Shadow `plan_only` 不调用 RAG、Memory、Chat Provider，不写笔记、长期记忆或业务 Checkpoint。
- Shadow 失败、超时或并发满不会影响 legacy 主响应。

## Checkpoint 与真实 Provider

- 在一次性 Python 3.12 锁定依赖容器中通过：LangGraph `1.2.9`、Checkpoint Postgres `3.1.0`。
- 使用主库官方 checkpoint 表完成 planner 后中断，关闭 saver 连接，重新连接并恢复至 `success`。
- 固定测试 thread 的 checkpoint/blobs/writes 已在验证后清理。
- 使用当前真实 DeepSeek `deepseek-v4-pro` 完成最小只读图流式测试：27 个 RuntimeEvent，`agent_done(completed)` 收口。

## 数据库验证

- 主库已升级到 `20260717_0006`。
- 临时库完成 base→0006、0006→0005、0005→0006 往返；临时库已删除。
- 真实 PostgreSQL 集成 7/7 通过，其中 Shadow 测试确认 notes、user_memories、agent_checkpoints 行数不变，仅生成并清理 Shadow 遥测。

## 测试

- LangGraph/Shadow 专项：10/10 通过。
- 后端默认 unittest：82 tests，75 通过，7 个真实数据库测试默认跳过。
- 锁定版本 Docker PoC：通过。
- Python 3.12 生产后端镜像（含 LangGraph/PostgreSQL Checkpointer 运行依赖）：构建通过。
- 真实 DeepSeek 流式图：通过。
- 全量质量门禁结果见 `quality/reports/steps-8-9-final.*`。

## 默认与回滚

- `AGENT_RUNTIME=legacy`
- `LANGGRAPH_POC_ENABLED=false`
- `LANGGRAPH_SHADOW_ENABLED=false`
- `LANGGRAPH_SHADOW_SAMPLE_PERCENT=0`

关闭 Shadow 总开关即可立即停止旁路；用户路径不需要切换。`agent_shadow_runs` 是遥测派生数据，可按保留策略清理。数据库 downgrade 0006 只删除该遥测表，不碰业务表。

## 下一步

按计划进入步骤 10～12：完整 RAG v2。LangGraph 仍不接管生产回答；后续只有在 Shadow 样本积累且硬违规为 0 后才讨论灰度切换。
