# NoteFlow 步骤 16～18 完成报告

执行日期：2026-07-17（Asia/Shanghai）

## 结论

Mem0 OSS 数据面、NoteFlow MemoryPolicy、Shadow 审计、用户级灰度、限流/熔断、安全拦截和灾备脚本已经接入。主库升级到 `20260717_0009`；真实 PostgreSQL 备份恢复与迁移回滚演练通过。生产默认仍为 `MEMORY_PROVIDER=legacy`、Shadow 关闭、灰度 0%，本次没有重启当前服务，也没有让 Mem0 改变现有用户回答。

| 步骤 | 工程状态 | 生产状态 |
|---|---|---|
| 16：Mem0 Shadow | 已完成 | 默认关闭，待内部账户采样 |
| 17：用户级灰度 | 已完成 | 默认 0%，待逐级观察 |
| 18：安全与灾备 | 已完成 | 安全策略生效；灾备演练 6/6 通过 |

## 步骤 16：Mem0 Shadow

- 锁定 `mem0ai==2.0.0`，使用 PostgreSQL/pgvector 独立 collection `noteflow_mem0_v1`；容器内真实导入验证通过。
- `Mem0Provider` 懒加载，搜索强制携带认证用户 `user_id`；NoteFlow 已提取的结构化记忆用 `infer=False` 写入，避免 Mem0 再做一套不受控提取。
- `user_memories` 与 `user_memory_events` 仍是状态、权限、TTL、删除、纠正和审计真相源；Mem0 只保存派生向量和 external id。
- 新增统一 MemoryPolicy，拒绝密码、Token/API key、私钥、银行卡标识、医疗记录标识、第三方个人信息和临时指令。
- 普通推断继续使用 pending/rejected；显式低风险记忆可 active；上下文只注入 active、未删除、未过期、策略允许的 3～8 条。
- Outbox 异步执行 Mem0 upsert/delete，保留幂等、退避、最大重试和 dead-letter；删除先在 NoteFlow 投影不可见，再删除外部向量。
- 新增 `memory_shadow_runs`，只记录 query hash、NoteFlow/Mem0 id、overlap、延迟、状态和安全违规，不记录查询明文。
- Shadow read 永远返回 legacy 结果；Mem0 只产生差异记录，失败不改变主回答。

## 步骤 17：用户级灰度

生效顺序：

1. 保持 `MEMORY_PROVIDER=legacy`，仅设置 `MEMORY_SHADOW_ENABLED=true`、内部用户采样或小比例 read shadow。
2. 开启 `MEMORY_SHADOW_WRITE_ENABLED=true`，验证写入、纠正和删除闭环。
3. 设置 `MEMORY_PROVIDER=mem0`、`MEM0_CANARY_ENABLED=true`、`MEM0_CANARY_PERCENT=0`，只在 `MEM0_CANARY_USER_IDS` 放内部账户。
4. 按 1%、5%、10%、25%、50%、100% 提高比例；同一用户使用稳定 SHA-256 分桶，不会随机抖动。
5. 完成生产观察后，可保持 `MEMORY_PROVIDER=mem0` 并关闭 canary，表示全量 Mem0；NoteFlow 投影和事件审计仍保留。

Mem0 召回不能直接进入 Prompt：返回结果必须用 `noteflow_memory_id` 映射回当前用户的 NoteFlow 投影，并再次验证 active、deleted、TTL 和敏感策略。任何未知 id 或跨用户 id 都被丢弃并记为 hard violation。Mem0 失败时 canary 本轮不注入长期记忆，普通聊天和笔记功能继续工作。

## 步骤 18：安全、韧性和灾备

- 生产模式继续强制长 JWT secret、Secure Cookie、禁止 wildcard CORS；Cookie 为 HttpOnly、SameSite=Lax。
- 登录、AI、Embedding、Reranker、Memory 和 Index 分开配置限额。Redis 断开时登录和认证用户限流自动退回进程内窗口，不会失去保护。
- Mem0 有 timeout、错误窗口、熔断和 cooldown；Outbox 提供退避重试、stale lock recovery、heartbeat 和 dead-letter。
- RAG 已有独立通道 timeout：Reranker 失败回 RRF；Vector/Embedding/BM25 通道失败仍保留其他召回通道。
- Context Planner 严格过滤 tool allowlist 和 memory action allowlist；模型不能构造 shell/tool 或跨用户参数。
- 结构化日志按字段和内容双重脱敏，明文 password/API key/Bearer/sk-token 不进入日志。
- 新增 `backup_noteflow.py`、`restore_noteflow.py`、`run_steps_16_18_drill.py`。恢复脚本只接受 `noteflow_drill_*` 或 `noteflow_restore_*` 隔离数据库名，拒绝覆盖主库。

## 实际灾备演练

- PostgreSQL custom-format dump：8,098,106 bytes。
- 数据库、附件归档、配置结构三类对象 SHA-256 全部通过；运行时 secret 未进入备份。
- 恢复后 `notes,user_memories` 与主库计数一致：`16,12`。
- 临时库迁移 roundtrip：`20260717_0009 → 20260717_0008 → 20260717_0009`。
- Mem0 timeout/circuit、灰度默认、敏感策略测试通过。
- 随机临时数据库 `noteflow_drill_18762e205f` 已删除。
- 证据：`quality/reports/archive/steps-16-18-resilience-drill.md` 与 `.json`。

## 默认配置

```dotenv
MEMORY_PROVIDER=legacy
MEMORY_SHADOW_ENABLED=false
MEMORY_SHADOW_READ_PERCENT=0
MEMORY_SHADOW_WRITE_ENABLED=false
MEM0_CANARY_ENABLED=false
MEM0_CANARY_PERCENT=0
MEM0_CANARY_USER_IDS=
```

## 紧急回滚

1. `MEM0_CANARY_ENABLED=false` 并把 `MEMORY_PROVIDER=legacy`。
2. `MEMORY_SHADOW_READ_PERCENT=0`、`MEMORY_SHADOW_ENABLED=false`、`MEMORY_SHADOW_WRITE_ENABLED=false`。
3. 保留 `user_memories/user_memory_events/external_id` 和未完成 Outbox，先停止外部影响，再排查一致性。
4. 正常事故不 downgrade 数据库；`0009` 只是审计表。只有明确要删除 Shadow 审计数据时才回退迁移。
5. 主库恢复前必须先在 `noteflow_restore_*` 隔离库验证 manifest、checksum、行数和迁移版本。

## 验收结果

- 后端默认单元回归：107 tests 通过，11 个显式外部/真实数据库条件测试跳过。
- 真实 PostgreSQL/pgvector 集成：8 通过、1 个 LangGraph 版本条件测试跳过。
- Memory 安全集：12/12，已登记缺口 0。
- 灾备与故障演练：6/6。
- Python 3.12 后端镜像：构建通过，`mem0ai 2.0.0` 和 Provider 真实导入通过。
- 最终全量质量门禁结果见 `quality/reports/archive/steps-16-18-final.*`。

## 尚需生产流量完成的事项

代码和演练已经完成，但“Mem0 召回质量/成本达到生产切换阈值”必须来自真实内部 Shadow 和逐级灰度观察，不能由离线测试伪造。本阶段没有擅自打开这些开关。步骤 19 全量验收前，应先完成至少一个内部观察窗口并确认 hard violation=0、删除成功率和延迟达到门槛。
