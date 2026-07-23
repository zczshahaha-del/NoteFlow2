# NoteFlow Memory 灰度与灾备运行手册

## Memory 灰度

### 仅 Shadow read

```dotenv
MEMORY_PROVIDER=legacy
MEMORY_SHADOW_ENABLED=true
MEMORY_SHADOW_READ_PERCENT=5
MEMORY_SHADOW_WRITE_ENABLED=false
```

此模式下用户答案完全使用 legacy。检查 `memory_shadow_runs` 的 failed、hard_violation、overlap_ratio 和 latency_ms。

### Shadow write

```dotenv
MEMORY_SHADOW_WRITE_ENABLED=true
```

确认 Embedding key 可用后开启。检查 `integration_outbox` 中 `memory.sync.requested` 的 pending/dead，以及 `user_memories.external_provider/external_id`。关闭开关不会删除 NoteFlow 记忆。

### 内部账户 canary

```dotenv
MEMORY_PROVIDER=mem0
MEM0_CANARY_ENABLED=true
MEM0_CANARY_PERCENT=0
MEM0_CANARY_USER_IDS=<authenticated-user-id>
```

观察至少一个完整窗口后再升百分比。发生跨用户 hard violation、删除失败堆积、错误记忆上升或延迟超阈值时立即切回 legacy。

## 备份

```bash
python3 scripts/backup_noteflow.py --output /安全挂载/noteflow-backup-YYYYMMDD-HHMMSS
```

备份包含 PostgreSQL custom dump、附件归档、配置变量结构和 manifest/checksum；不包含运行时 secret 值。Secret 必须由独立密钥管理系统备份。

## 隔离恢复验证

```bash
python3 scripts/restore_noteflow.py \
  --backup /安全挂载/noteflow-backup-YYYYMMDD-HHMMSS \
  --target-database noteflow_restore_YYYYMMDD \
  --create
```

恢复工具拒绝 `noteflow` 等非隔离库名。验证 checksum、迁移 head、核心表行数、附件 hash 和登录/笔记只读抽查后，才能制定正式切换方案。

## 一键演练

```bash
python3 scripts/run_steps_16_18_drill.py
```

脚本会创建随机 `noteflow_drill_*` 数据库，完成备份、恢复、行数对比、迁移前滚/回滚、安全测试并自动删除临时库。报告写入 `quality/reports/steps-16-18-resilience-drill.*`。

## 事故顺序

1. 停止扩大灰度，把 `MEMORY_PROVIDER=legacy`。
2. 关闭 Shadow read/write，保留 Outbox 和 external id 证据。
3. 检查 PostgreSQL、Redis、Embedding/LLM、Outbox dead-letter 和 `memory_shadow_runs`。
4. 如果只是 Mem0 故障，不恢复主库；普通回答继续，记忆写入排队。
5. 只有确认主库损坏时才启动隔离恢复验证和正式恢复变更流程。
