# 步骤 0：执行前保护与恢复记录

执行日期：2026-07-17（Asia/Shanghai）

## 结论

步骤 0 的代码、数据库、配置和附件恢复路径已经建立。NoteFlow 当前完整项目已提交并推送到全新的 GitHub 仓库 `zczshahaha-del/NoteFlow2`；数据库完整备份已在隔离临时数据库中成功恢复验证。

## Git 与工作区

- 远端：`https://github.com/zczshahaha-del/NoteFlow2.git`
- 分支：`main`
- 架构改造前基线提交：`a9fd01024303173ac97fa0b0d29bf7ed72adfd2e`
- 旧仓库 `zczshahaha-del/NoteFlow` 未被修改，仍停留在 `ba618ec68ce21f36c88fe2406aba33899ba29d90`。
- `server/.env`、附件、数据库备份、崩溃快照、构建目录、依赖目录和 Office 临时文件均已加入 `.gitignore`。
- 本步骤之后出现的未提交文件均属于步骤 0～2 的基线与质量门禁产物。

## 环境版本

| 项目 | 版本 |
|---|---|
| macOS | 26.5.2（Build 25F84） |
| 架构 | arm64 |
| Node.js | v26.0.0 |
| npm | 11.12.1 |
| Python | 3.9.6 |
| Git | 2.50.1 |
| Docker | 29.4.3 |
| Docker Compose | v5.1.3 |
| PostgreSQL | 16.14 |
| Redis | 7.4.9 |
| pgvector | 0.8.4 |

本机没有独立安装 `psql` 和 `redis-server` CLI；数据库管理与恢复使用版本一致的 Docker 容器工具，避免客户端/服务端版本漂移。

## 备份清单

备份目录：`backups/step-0-20260717/`（已忽略，不进入 Git）

| 文件 | 内容 | SHA-256 |
|---|---|---|
| `noteflow-source-pre-architecture.tar.gz` | 排除密钥、依赖、构建产物、数据库备份和附件后的源码快照 | `472aa2f0d601f5dbac5b1bbaef9fb85c394cd27e6bd2ae4d10a6d803118957c7` |
| `noteflow-postgres.dump` | PostgreSQL custom-format 完整数据库备份 | `a16accf0e5ea5cfe2269837b3b0c7c4bd3c6017ed63212f787337a78db6f1c43` |
| `noteflow-postgres-globals.sql` | PostgreSQL roles/globals | `692652a3e377968babe02b0252e8c3524fb0b49c8373e48f02aa1c021e039ae6` |

当前附件目录没有文件，数据库 `note_attachments` 行数为 0，因此本次不存在附件漏备份。后续出现附件后，备份范围为 `server/data/attachments/` 或 `ATTACHMENT_STORAGE_ROOT` 指定目录。

## 数据库恢复验证

- 当前 Alembic revision：`20260715_0004`
- 当前业务表数：27
- 在一次性数据库 `noteflow_restore_verify_20260717` 中完成了完整 `pg_restore`。
- 恢复后抽样：27 张表、16 篇笔记、610 个 chunks、610 个 embeddings，与源库快照一致。
- 验证结束后已删除一次性数据库，正式数据库未被修改。

### 恢复命令

```bash
docker compose exec -T postgres createdb -U noteflow noteflow_restore
docker compose cp backups/step-0-20260717/noteflow-postgres.dump postgres:/tmp/noteflow-postgres.dump
docker compose exec -T postgres pg_restore -U noteflow -d noteflow_restore --no-owner --no-privileges /tmp/noteflow-postgres.dump
```

正式恢复前必须先停止写入、另做当时快照并核对目标数据库名；禁止直接向当前 `noteflow` 数据库覆盖恢复。

## 配置保护

- 已检查根目录示例配置、`server/.env` 的变量名称和 Docker Compose 注入范围。
- 文档只记录非敏感 Provider、模型、地址、维度和开关，不记录 API key、数据库密码或 JWT secret。
- 当前本机 Chat 模型为 `deepseek-v4-pro`；代码、示例配置和容器 fallback 为 `deepseek-chat`。
- Embedding 为 DashScope `text-embedding-v4`，1024 维，batch size 10。

## 回滚入口

1. 代码级：回到 Git 提交 `a9fd010`。
2. 文件级：从源码 tar 快照抽取单个文件，不直接覆盖整个工作区。
3. 数据级：先恢复到新数据库并对账，再计划受控切换。
4. 派生数据：`note_sections`、`note_chunks`、`note_embeddings` 可由正式笔记重建，但本次备份仍完整保留。

## 已知限制

- 备份目前位于本机同一磁盘，只能防止代码重构和逻辑误操作，不能替代异地灾备；步骤 18 再建立生产级异地备份与恢复演练。
- 当前 GitHub 初始提交使用 `zczshahaha-del@users.noreply.github.com`，不会公开本机私人邮箱。
