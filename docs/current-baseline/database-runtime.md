# NoteFlow 当前 PostgreSQL 运行时基线

> 由 `scripts/export_database_runtime.py` 从真实 PostgreSQL 只读导出；不包含密码、正文或用户内容。

- PostgreSQL：`PostgreSQL 16.14 (Debian 16.14-1.pgdg12+1) on aarch64-unknown-linux-gnu, compiled by gcc (Debian 12.2.0-14+deb12u1) 12.2.0, 64-bit`
- Alembic revision：`20260717_0007`
- 运行时表数：39
- SQLAlchemy 模型表数：34
- 仅数据库存在：alembic_version, checkpoint_blobs, checkpoint_migrations, checkpoint_writes, checkpoints
- 仅模型存在：无
- 索引数：156
- 外键数：67

## 扩展

| 扩展 | 版本 |
|---|---|
| `pg_trgm` | `1.6` |
| `plpgsql` | `1.0` |
| `vector` | `0.8.4` |

## 表行数快照

| 表 | 行数 |
|---|---:|
| `agent_checkpoints` | 11 |
| `agent_runs` | 42 |
| `agent_shadow_runs` | 0 |
| `agent_steps` | 42 |
| `agent_tool_traces` | 105 |
| `alembic_version` | 1 |
| `chat_messages` | 83 |
| `chat_sessions` | 3 |
| `checkpoint_blobs` | 0 |
| `checkpoint_migrations` | 10 |
| `checkpoint_writes` | 0 |
| `checkpoints` | 0 |
| `integration_outbox` | 0 |
| `knowledge_bases` | 0 |
| `note_attachments` | 0 |
| `note_categories` | 15 |
| `note_chunks` | 703 |
| `note_draft_section_versions` | 112 |
| `note_draft_sections` | 449 |
| `note_drafts` | 46 |
| `note_edit_preview_revisions` | 0 |
| `note_edit_previews` | 3 |
| `note_embeddings` | 703 |
| `note_index_jobs` | 52 |
| `note_sections` | 703 |
| `note_versions` | 51 |
| `notes` | 16 |
| `password_reset_tokens` | 0 |
| `rag_eval_cases` | 0 |
| `rag_eval_runs` | 0 |
| `rag_query_logs` | 0 |
| `rag_v2_embeddings` | 701 |
| `rag_v2_index_states` | 5 |
| `rag_v2_nodes` | 701 |
| `user_memories` | 12 |
| `user_memory_events` | 20 |
| `user_sessions` | 12 |
| `user_settings` | 2 |
| `users` | 3 |

## pgvector 索引

- `ix_note_embeddings_embedding_hnsw`：`CREATE INDEX ix_note_embeddings_embedding_hnsw ON public.note_embeddings USING hnsw (embedding vector_cosine_ops) WHERE (((status)::text = 'indexed'::text) AND (embedding IS NOT NULL))`
- `ix_rag_v2_embeddings_hnsw`：`CREATE INDEX ix_rag_v2_embeddings_hnsw ON public.rag_v2_embeddings USING hnsw (embedding vector_cosine_ops) WHERE (((status)::text = 'indexed'::text) AND (embedding IS NOT NULL))`
- `ix_rag_v2_embeddings_vector_ready`：`CREATE INDEX ix_rag_v2_embeddings_vector_ready ON public.rag_v2_embeddings USING btree (user_id, status)`

## 软删除基线

- `notes`、`note_categories`、`user_memories` 使用 `deleted_at` 软删除语义。
- 草稿、编辑预览、运行记录和索引任务使用状态字段控制生命周期。
- 用户删除依赖外键级联清理所属数据；笔记删除默认不物理删除正文。
