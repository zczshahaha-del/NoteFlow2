# NoteFlow Memory 与灾备运行手册

## 当前记忆链路

长期记忆固定使用 Mem0。`user_memories` 继续承担用户归属、状态、安全策略和审计真相，
Outbox 负责把合格记忆同步到 Mem0。读取结果还会经过 NoteFlow 权限和敏感信息过滤。

## 备份

```bash
python3 scripts/backup_noteflow.py --output /安全挂载/noteflow-backup-YYYYMMDD-HHMMSS
```

备份包含 PostgreSQL custom dump、附件归档、配置变量结构和 manifest/checksum；
不包含运行时 secret 值。Secret 必须由独立密钥管理系统备份。

## 隔离恢复验证

```bash
python3 scripts/restore_noteflow.py \
  --backup /安全挂载/noteflow-backup-YYYYMMDD-HHMMSS \
  --target-database noteflow_restore_YYYYMMDD \
  --create
```

恢复工具拒绝直接覆盖正式库。完成 checksum、迁移版本、核心表行数、附件 hash、
登录和笔记只读检查后，才能制定正式恢复方案。

## 一键演练

```bash
python3 scripts/run_steps_16_18_drill.py
```

脚本创建隔离数据库，完成备份、恢复、迁移、安全测试并自动清理临时库。

## Mem0 故障处理

1. 检查 PostgreSQL、Mem0 collection、Embedding、Outbox 和错误日志。
2. 暂停 Outbox worker，避免失败任务持续重试。
3. 修复 Provider 后恢复 worker，让积压事件继续同步。
4. 不要删除 `user_memories` 或 external id；它们用于一致性修复。
5. 只有主数据库损坏时才启动备份恢复。
