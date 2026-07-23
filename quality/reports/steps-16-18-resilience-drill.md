# NoteFlow 步骤 16～18 灾备与故障演练

- 时间：2026-07-17T14:47:03.786137+00:00
- 结果：通过
- 临时数据库：`noteflow_drill_18762e205f`（演练结束已清理）

| 检查 | 结果 | 说明 |
|---|---|---|
| `backup` | 通过 | 3 个备份对象，数据库 dump 8098106 bytes |
| `checksums` | 通过 | 数据库、附件、配置结构 SHA-256 全部匹配；未包含运行时密钥 |
| `restore` | 通过 | notes,user_memories 计数一致：16,12 |
| `migration-roundtrip` | 通过 | 20260717_0009 → 20260717_0008 → 20260717_0009 |
| `fault-and-safety` | 通过 | Mem0 timeout/circuit、跨用户裁决、敏感信息与灰度默认关闭测试通过 |
| `cleanup` | 通过 | 临时恢复数据库已删除 |
