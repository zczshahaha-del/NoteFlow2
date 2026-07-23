# NoteFlow 当前 SQLAlchemy 数据模型基线

> 此文件描述代码模型；真实 PostgreSQL 运行时结构另见 `database-runtime.md`。

- 模型表数量：34
- 业务真相源：PostgreSQL
- 向量字段：pgvector `vector(1024)`

## `rag_eval_cases`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `id` | `VARCHAR(64)` | 否 | 是 | `-` | `-` |
| `name` | `VARCHAR(160)` | 否 | 否 | `-` | `-` |
| `dataset_version` | `VARCHAR(80)` | 否 | 否 | `-` | `v1` |
| `input_data` | `JSON` | 否 | 否 | `-` | `<function RagEvalCase.<lambda> at 0x10abffca0>` |
| `expected` | `JSON` | 否 | 否 | `-` | `<function RagEvalCase.<lambda> at 0x10ab09ca0>` |
| `tags` | `JSON` | 否 | 否 | `-` | `<function RagEvalCase.<lambda> at 0x10ad9b4c0>` |
| `active` | `BOOLEAN` | 否 | 否 | `-` | `True` |
| `created_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10adfd160>` |
| `updated_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10adfd9d0>` |

- 索引：`uq_rag_eval_case_version_name`
- 唯一约束：无

## `users`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `id` | `VARCHAR(64)` | 否 | 是 | `-` | `<function User.<lambda> at 0x10aa28c10>` |
| `email` | `VARCHAR(255)` | 否 | 否 | `-` | `-` |
| `display_name` | `VARCHAR(120)` | 否 | 否 | `-` | `-` |
| `password_hash` | `VARCHAR(255)` | 否 | 否 | `-` | `-` |
| `created_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10aa28ee0>` |
| `updated_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10aa3c040>` |

- 索引：无
- 唯一约束：`(unnamed)`

## `agent_shadow_runs`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `id` | `VARCHAR(64)` | 否 | 是 | `-` | `-` |
| `user_id` | `VARCHAR(64)` | 是 | 否 | `users.id` | `-` |
| `request_id` | `VARCHAR(80)` | 是 | 否 | `-` | `-` |
| `trace_id` | `VARCHAR(80)` | 是 | 否 | `-` | `-` |
| `input_hash` | `VARCHAR(64)` | 否 | 否 | `-` | `-` |
| `mode` | `VARCHAR(32)` | 否 | 否 | `-` | `-` |
| `legacy_intent` | `VARCHAR(80)` | 否 | 否 | `-` | `-` |
| `graph_intent` | `VARCHAR(80)` | 是 | 否 | `-` | `-` |
| `legacy_route` | `VARCHAR(80)` | 否 | 否 | `-` | `-` |
| `graph_route` | `VARCHAR(80)` | 是 | 否 | `-` | `-` |
| `legacy_requires_sources` | `BOOLEAN` | 否 | 否 | `-` | `False` |
| `graph_requires_sources` | `BOOLEAN` | 是 | 否 | `-` | `-` |
| `hard_violation` | `BOOLEAN` | 否 | 否 | `-` | `False` |
| `status` | `VARCHAR(32)` | 否 | 否 | `-` | `running` |
| `differences` | `JSON` | 否 | 否 | `-` | `<function AgentShadowRun.<lambda> at 0x10add7700>` |
| `graph_summary` | `JSON` | 否 | 否 | `-` | `<function AgentShadowRun.<lambda> at 0x10add78b0>` |
| `duration_ms` | `INTEGER` | 否 | 否 | `-` | `0` |
| `error_code` | `VARCHAR(80)` | 是 | 否 | `-` | `-` |
| `error_message` | `TEXT` | 是 | 否 | `-` | `-` |
| `created_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10add7b80>` |

- 索引：`ix_agent_shadow_runs_created_at`, `ix_agent_shadow_runs_hard_violation`, `ix_agent_shadow_runs_input_hash`, `ix_agent_shadow_runs_request_id`, `ix_agent_shadow_runs_status`, `ix_agent_shadow_runs_trace_id`, `ix_agent_shadow_runs_user_id`
- 唯一约束：无

## `integration_outbox`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `id` | `VARCHAR(64)` | 否 | 是 | `-` | `-` |
| `user_id` | `VARCHAR(64)` | 是 | 否 | `users.id` | `-` |
| `topic` | `VARCHAR(120)` | 否 | 否 | `-` | `-` |
| `aggregate_type` | `VARCHAR(80)` | 否 | 否 | `-` | `-` |
| `aggregate_id` | `VARCHAR(160)` | 否 | 否 | `-` | `-` |
| `payload` | `JSON` | 否 | 否 | `-` | `<function IntegrationOutbox.<lambda> at 0x10add7550>` |
| `idempotency_key` | `VARCHAR(240)` | 否 | 否 | `-` | `-` |
| `status` | `VARCHAR(32)` | 否 | 否 | `-` | `pending` |
| `available_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10abff550>` |
| `locked_by` | `VARCHAR(160)` | 是 | 否 | `-` | `-` |
| `locked_at` | `DATETIME` | 是 | 否 | `-` | `-` |
| `heartbeat_at` | `DATETIME` | 是 | 否 | `-` | `-` |
| `attempts` | `INTEGER` | 否 | 否 | `-` | `0` |
| `max_attempts` | `INTEGER` | 否 | 否 | `-` | `8` |
| `error_code` | `VARCHAR(80)` | 是 | 否 | `-` | `-` |
| `last_error` | `TEXT` | 是 | 否 | `-` | `-` |
| `trace_id` | `VARCHAR(64)` | 是 | 否 | `-` | `-` |
| `created_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10adfd0d0>` |
| `processed_at` | `DATETIME` | 是 | 否 | `-` | `-` |

- 索引：`ix_integration_outbox_aggregate_id`, `ix_integration_outbox_available_at`, `ix_integration_outbox_locked_by`, `ix_integration_outbox_status`, `ix_integration_outbox_topic`, `ix_integration_outbox_trace_id`, `ix_integration_outbox_user_id`
- 唯一约束：`(unnamed)`

## `knowledge_bases`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `user_id` | `VARCHAR(64)` | 否 | 是 | `users.id` | `-` |
| `tree_data` | `JSON` | 否 | 否 | `-` | `<function KnowledgeBase.<lambda> at 0x10aa3ce50>` |
| `file_contents` | `JSON` | 否 | 否 | `-` | `<function KnowledgeBase.<lambda> at 0x10aa3cdc0>` |
| `selected_file_id` | `VARCHAR(255)` | 是 | 否 | `-` | `-` |
| `created_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10aa7f8b0>` |
| `updated_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10aa7f9d0>` |

- 索引：无
- 唯一约束：无

## `note_categories`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `id` | `VARCHAR(64)` | 否 | 是 | `-` | `-` |
| `user_id` | `VARCHAR(64)` | 否 | 否 | `users.id` | `-` |
| `name` | `VARCHAR(100)` | 否 | 否 | `-` | `-` |
| `parent_id` | `VARCHAR(64)` | 是 | 否 | `note_categories.id` | `-` |
| `sort_order` | `INTEGER` | 否 | 否 | `-` | `0` |
| `created_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10aa7fb80>` |
| `updated_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10aa67040>` |
| `deleted_at` | `DATETIME` | 是 | 否 | `-` | `-` |

- 索引：`ix_note_categories_user_id`
- 唯一约束：无

## `password_reset_tokens`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `id` | `VARCHAR(64)` | 否 | 是 | `-` | `-` |
| `user_id` | `VARCHAR(64)` | 否 | 否 | `users.id` | `-` |
| `token_hash` | `VARCHAR(64)` | 否 | 否 | `-` | `-` |
| `requested_ip` | `VARCHAR(64)` | 是 | 否 | `-` | `-` |
| `created_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10aa28f70>` |
| `expires_at` | `DATETIME` | 否 | 否 | `-` | `-` |
| `used_at` | `DATETIME` | 是 | 否 | `-` | `-` |

- 索引：`ix_password_reset_tokens_expires_at`, `ix_password_reset_tokens_user_id`
- 唯一约束：`(unnamed)`

## `rag_eval_runs`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `id` | `VARCHAR(64)` | 否 | 是 | `-` | `-` |
| `case_id` | `VARCHAR(64)` | 是 | 否 | `rag_eval_cases.id` | `-` |
| `provider` | `VARCHAR(50)` | 否 | 否 | `-` | `legacy` |
| `status` | `VARCHAR(32)` | 否 | 否 | `-` | `running` |
| `parameters` | `JSON` | 否 | 否 | `-` | `<function RagEvalRun.<lambda> at 0x10add7940>` |
| `result` | `JSON` | 否 | 否 | `-` | `<function RagEvalRun.<lambda> at 0x10adfdb80>` |
| `metrics` | `JSON` | 否 | 否 | `-` | `<function RagEvalRun.<lambda> at 0x10ae2f0d0>` |
| `trace_id` | `VARCHAR(64)` | 是 | 否 | `-` | `-` |
| `started_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10ae2f280>` |
| `finished_at` | `DATETIME` | 是 | 否 | `-` | `-` |

- 索引：`ix_rag_eval_runs_case_id`, `ix_rag_eval_runs_status`, `ix_rag_eval_runs_trace_id`
- 唯一约束：无

## `user_memories`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `id` | `VARCHAR(64)` | 否 | 是 | `-` | `-` |
| `user_id` | `VARCHAR(64)` | 否 | 否 | `users.id` | `-` |
| `memory_type` | `VARCHAR(50)` | 否 | 否 | `-` | `preference` |
| `content` | `TEXT` | 否 | 否 | `-` | `-` |
| `importance` | `INTEGER` | 否 | 否 | `-` | `3` |
| `confidence` | `FLOAT` | 是 | 否 | `-` | `-` |
| `source` | `VARCHAR(50)` | 否 | 否 | `-` | `user_explicit` |
| `scope` | `VARCHAR(50)` | 否 | 否 | `-` | `global` |
| `tags` | `JSON` | 否 | 否 | `-` | `<function UserMemory.<lambda> at 0x10abef160>` |
| `status` | `VARCHAR(50)` | 否 | 否 | `-` | `active` |
| `external_provider` | `VARCHAR(50)` | 是 | 否 | `-` | `-` |
| `external_id` | `VARCHAR(160)` | 是 | 否 | `-` | `-` |
| `canonical_key` | `VARCHAR(120)` | 是 | 否 | `-` | `-` |
| `memory_layer` | `VARCHAR(50)` | 是 | 否 | `-` | `-` |
| `expires_at` | `DATETIME` | 是 | 否 | `-` | `-` |
| `source_ref` | `VARCHAR(255)` | 是 | 否 | `-` | `-` |
| `provider_metadata` | `JSON` | 否 | 否 | `-` | `<function UserMemory.<lambda> at 0x10abef700>` |
| `idempotency_key` | `VARCHAR(160)` | 是 | 否 | `-` | `-` |
| `last_used_at` | `DATETIME` | 是 | 否 | `-` | `-` |
| `access_count` | `INTEGER` | 否 | 否 | `-` | `0` |
| `created_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10abef9d0>` |
| `updated_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10abefaf0>` |
| `deleted_at` | `DATETIME` | 是 | 否 | `-` | `-` |

- 索引：`ix_user_memories_expires_at`, `ix_user_memories_user_id`
- 唯一约束：无

## `user_sessions`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `id` | `VARCHAR(64)` | 否 | 是 | `-` | `-` |
| `user_id` | `VARCHAR(64)` | 否 | 否 | `users.id` | `-` |
| `user_agent` | `VARCHAR(512)` | 是 | 否 | `-` | `-` |
| `ip_address` | `VARCHAR(64)` | 是 | 否 | `-` | `-` |
| `created_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10aa3c8b0>` |
| `last_seen_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10aa3cd30>` |
| `expires_at` | `DATETIME` | 否 | 否 | `-` | `-` |
| `revoked_at` | `DATETIME` | 是 | 否 | `-` | `-` |

- 索引：`ix_user_sessions_expires_at`, `ix_user_sessions_user_id`
- 唯一约束：无

## `user_settings`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `user_id` | `VARCHAR(64)` | 否 | 是 | `users.id` | `-` |
| `memory_enabled` | `BOOLEAN` | 否 | 否 | `-` | `True` |
| `preferences` | `JSON` | 否 | 否 | `-` | `<function UserSettings.<lambda> at 0x10aa28ca0>` |
| `created_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10aa3c1f0>` |
| `updated_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10aa3c700>` |

- 索引：无
- 唯一约束：无

## `notes`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `id` | `VARCHAR(64)` | 否 | 是 | `-` | `-` |
| `user_id` | `VARCHAR(64)` | 否 | 否 | `users.id` | `-` |
| `title` | `VARCHAR(255)` | 否 | 否 | `-` | `-` |
| `category_id` | `VARCHAR(64)` | 是 | 否 | `note_categories.id` | `-` |
| `summary` | `TEXT` | 是 | 否 | `-` | `-` |
| `tags` | `JSON` | 否 | 否 | `-` | `<function Note.<lambda> at 0x10aa67160>` |
| `content` | `TEXT` | 否 | 否 | `-` | `-` |
| `is_pinned` | `BOOLEAN` | 否 | 否 | `-` | `False` |
| `is_favorite` | `BOOLEAN` | 否 | 否 | `-` | `False` |
| `index_status` | `VARCHAR(50)` | 否 | 否 | `-` | `pending` |
| `index_version` | `VARCHAR(128)` | 是 | 否 | `-` | `-` |
| `idempotency_key` | `VARCHAR(160)` | 是 | 否 | `-` | `-` |
| `created_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10aa679d0>` |
| `updated_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10aa67af0>` |
| `deleted_at` | `DATETIME` | 是 | 否 | `-` | `-` |

- 索引：`ix_notes_user_id`
- 唯一约束：无

## `user_memory_events`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `id` | `VARCHAR(64)` | 否 | 是 | `-` | `-` |
| `memory_id` | `VARCHAR(64)` | 是 | 否 | `user_memories.id` | `-` |
| `user_id` | `VARCHAR(64)` | 否 | 否 | `users.id` | `-` |
| `event_type` | `VARCHAR(50)` | 否 | 否 | `-` | `-` |
| `old_content` | `TEXT` | 是 | 否 | `-` | `-` |
| `new_content` | `TEXT` | 是 | 否 | `-` | `-` |
| `reason` | `TEXT` | 是 | 否 | `-` | `-` |
| `created_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10abef4c0>` |

- 索引：`ix_user_memory_events_memory_id`, `ix_user_memory_events_user_id`
- 唯一约束：无

## `chat_sessions`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `id` | `VARCHAR(64)` | 否 | 是 | `-` | `-` |
| `user_id` | `VARCHAR(64)` | 否 | 否 | `users.id` | `-` |
| `title` | `VARCHAR(255)` | 否 | 否 | `-` | `新对话` |
| `status` | `VARCHAR(50)` | 否 | 否 | `-` | `active` |
| `current_note_id` | `VARCHAR(64)` | 是 | 否 | `notes.id` | `-` |
| `metadata_json` | `JSON` | 否 | 否 | `-` | `<function ChatSession.<lambda> at 0x10abefc10>` |
| `created_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10ab09d30>` |
| `updated_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10ab09f70>` |
| `last_message_at` | `DATETIME` | 是 | 否 | `-` | `-` |
| `archived_at` | `DATETIME` | 是 | 否 | `-` | `-` |

- 索引：`ix_chat_sessions_user_id`
- 唯一约束：无

## `note_attachments`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `id` | `VARCHAR(64)` | 否 | 是 | `-` | `-` |
| `user_id` | `VARCHAR(64)` | 否 | 否 | `users.id` | `-` |
| `note_id` | `VARCHAR(64)` | 是 | 否 | `notes.id` | `-` |
| `file_name` | `VARCHAR(255)` | 否 | 否 | `-` | `-` |
| `content_type` | `VARCHAR(120)` | 否 | 否 | `-` | `-` |
| `size` | `INTEGER` | 否 | 否 | `-` | `-` |
| `sha256` | `VARCHAR(64)` | 否 | 否 | `-` | `-` |
| `storage_key` | `VARCHAR(512)` | 否 | 否 | `-` | `-` |
| `created_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10aa28b80>` |

- 索引：`ix_note_attachments_note_id`, `ix_note_attachments_sha256`, `ix_note_attachments_user_id`
- 唯一约束：`(unnamed)`

## `note_drafts`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `id` | `VARCHAR(64)` | 否 | 是 | `-` | `-` |
| `user_id` | `VARCHAR(64)` | 否 | 否 | `users.id` | `-` |
| `title` | `VARCHAR(255)` | 否 | 否 | `-` | `-` |
| `topic` | `VARCHAR(255)` | 否 | 否 | `-` | `-` |
| `category_id` | `VARCHAR(64)` | 是 | 否 | `note_categories.id` | `-` |
| `note_type` | `VARCHAR(64)` | 否 | 否 | `-` | `学习笔记` |
| `writing_tone` | `VARCHAR(64)` | 否 | 否 | `-` | `通俗易懂` |
| `note_format` | `VARCHAR(64)` | 否 | 否 | `-` | `详细教程` |
| `heading_level` | `VARCHAR(64)` | 否 | 否 | `-` | `H2 / H3 / H4` |
| `include_code` | `BOOLEAN` | 否 | 否 | `-` | `True` |
| `include_exercises` | `BOOLEAN` | 否 | 否 | `-` | `True` |
| `extra_request` | `TEXT` | 否 | 否 | `-` | `-` |
| `draft_config` | `JSON` | 否 | 否 | `-` | `<function NoteDraft.<lambda> at 0x10ab730d0>` |
| `outline` | `TEXT` | 否 | 否 | `-` | `-` |
| `assembled_content` | `TEXT` | 否 | 否 | `-` | `-` |
| `status` | `VARCHAR(50)` | 否 | 否 | `-` | `configuring` |
| `saved_note_id` | `VARCHAR(64)` | 是 | 否 | `notes.id` | `-` |
| `idempotency_key` | `VARCHAR(160)` | 是 | 否 | `-` | `-` |
| `created_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10ab73820>` |
| `updated_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10ab73940>` |
| `canceled_at` | `DATETIME` | 是 | 否 | `-` | `-` |
| `saved_at` | `DATETIME` | 是 | 否 | `-` | `-` |

- 索引：`ix_note_drafts_user_id`
- 唯一约束：无

## `note_index_jobs`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `id` | `VARCHAR(64)` | 否 | 是 | `-` | `-` |
| `note_id` | `VARCHAR(64)` | 否 | 否 | `notes.id` | `-` |
| `user_id` | `VARCHAR(64)` | 否 | 否 | `users.id` | `-` |
| `status` | `VARCHAR(50)` | 否 | 否 | `-` | `pending` |
| `error_message` | `TEXT` | 是 | 否 | `-` | `-` |
| `stats` | `JSON` | 否 | 否 | `-` | `<function NoteIndexJob.<lambda> at 0x10aa67a60>` |
| `retry_count` | `INTEGER` | 否 | 否 | `-` | `0` |
| `max_retries` | `INTEGER` | 否 | 否 | `-` | `3` |
| `next_attempt_at` | `DATETIME` | 是 | 否 | `-` | `-` |
| `claim_owner` | `VARCHAR(160)` | 是 | 否 | `-` | `-` |
| `claimed_at` | `DATETIME` | 是 | 否 | `-` | `-` |
| `heartbeat_at` | `DATETIME` | 是 | 否 | `-` | `-` |
| `error_code` | `VARCHAR(80)` | 是 | 否 | `-` | `-` |
| `source_version` | `VARCHAR(128)` | 是 | 否 | `-` | `-` |
| `idempotency_key` | `VARCHAR(200)` | 是 | 否 | `-` | `-` |
| `parser_version` | `VARCHAR(80)` | 是 | 否 | `-` | `-` |
| `chunker_version` | `VARCHAR(80)` | 是 | 否 | `-` | `-` |
| `embedding_version` | `VARCHAR(120)` | 是 | 否 | `-` | `-` |
| `graph_version` | `VARCHAR(80)` | 是 | 否 | `-` | `-` |
| `created_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10ab09e50>` |
| `started_at` | `DATETIME` | 是 | 否 | `-` | `-` |
| `finished_at` | `DATETIME` | 是 | 否 | `-` | `-` |

- 索引：`ix_note_index_jobs_claim_owner`, `ix_note_index_jobs_heartbeat_at`, `ix_note_index_jobs_next_attempt_at`, `ix_note_index_jobs_note_id`, `ix_note_index_jobs_user_id`
- 唯一约束：无

## `note_sections`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `id` | `VARCHAR(64)` | 否 | 是 | `-` | `-` |
| `note_id` | `VARCHAR(64)` | 否 | 否 | `notes.id` | `-` |
| `user_id` | `VARCHAR(64)` | 否 | 否 | `users.id` | `-` |
| `parent_id` | `VARCHAR(64)` | 是 | 否 | `note_sections.id` | `-` |
| `title` | `VARCHAR(255)` | 否 | 否 | `-` | `-` |
| `level` | `INTEGER` | 否 | 否 | `-` | `1` |
| `sort_order` | `INTEGER` | 否 | 否 | `-` | `0` |
| `content` | `TEXT` | 否 | 否 | `-` | `-` |
| `token_count` | `INTEGER` | 否 | 否 | `-` | `0` |
| `content_hash` | `VARCHAR(64)` | 否 | 否 | `-` | `-` |
| `created_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10ab3c790>` |

- 索引：`ix_note_sections_content_hash`, `ix_note_sections_note_id`, `ix_note_sections_user_id`
- 唯一约束：无

## `note_versions`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `id` | `VARCHAR(64)` | 否 | 是 | `-` | `-` |
| `note_id` | `VARCHAR(64)` | 否 | 否 | `notes.id` | `-` |
| `user_id` | `VARCHAR(64)` | 否 | 否 | `users.id` | `-` |
| `title` | `VARCHAR(255)` | 否 | 否 | `-` | `-` |
| `content` | `TEXT` | 否 | 否 | `-` | `-` |
| `change_summary` | `TEXT` | 是 | 否 | `-` | `-` |
| `source` | `VARCHAR(50)` | 否 | 否 | `-` | `manual_edit` |
| `created_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10aa67c10>` |

- 索引：`ix_note_versions_note_id`, `ix_note_versions_user_id`
- 唯一约束：无

## `rag_v2_index_states`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `note_id` | `VARCHAR(64)` | 否 | 是 | `notes.id` | `-` |
| `user_id` | `VARCHAR(64)` | 否 | 否 | `users.id` | `-` |
| `source_version` | `VARCHAR(128)` | 否 | 否 | `-` | `-` |
| `parser_version` | `VARCHAR(80)` | 否 | 否 | `-` | `-` |
| `chunker_version` | `VARCHAR(80)` | 否 | 否 | `-` | `-` |
| `embedding_version` | `VARCHAR(120)` | 否 | 否 | `-` | `-` |
| `status` | `VARCHAR(32)` | 否 | 否 | `-` | `pending` |
| `node_count` | `INTEGER` | 否 | 否 | `-` | `0` |
| `error_code` | `VARCHAR(80)` | 是 | 否 | `-` | `-` |
| `error_message` | `TEXT` | 是 | 否 | `-` | `-` |
| `created_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10ab09280>` |
| `updated_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10ab09430>` |
| `indexed_at` | `DATETIME` | 是 | 否 | `-` | `-` |

- 索引：`ix_rag_v2_index_states_status`, `ix_rag_v2_index_states_user_id`
- 唯一约束：无

## `rag_v2_nodes`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `id` | `VARCHAR(64)` | 否 | 是 | `-` | `-` |
| `note_id` | `VARCHAR(64)` | 否 | 否 | `notes.id` | `-` |
| `user_id` | `VARCHAR(64)` | 否 | 否 | `users.id` | `-` |
| `section_key` | `VARCHAR(64)` | 否 | 否 | `-` | `-` |
| `section_path` | `JSON` | 否 | 否 | `-` | `<function RagV2Node.<lambda> at 0x10ab09b80>` |
| `node_type` | `VARCHAR(32)` | 否 | 否 | `-` | `text` |
| `node_index` | `INTEGER` | 否 | 否 | `-` | `0` |
| `content` | `TEXT` | 否 | 否 | `-` | `-` |
| `token_count` | `INTEGER` | 否 | 否 | `-` | `0` |
| `content_hash` | `VARCHAR(64)` | 否 | 否 | `-` | `-` |
| `source_version` | `VARCHAR(128)` | 否 | 否 | `-` | `-` |
| `parser_version` | `VARCHAR(80)` | 否 | 否 | `-` | `-` |
| `chunker_version` | `VARCHAR(80)` | 否 | 否 | `-` | `-` |
| `block_types` | `JSON` | 否 | 否 | `-` | `<function RagV2Node.<lambda> at 0x10aae6700>` |
| `node_metadata` | `JSON` | 否 | 否 | `-` | `<function RagV2Node.<lambda> at 0x10aae68b0>` |
| `active` | `BOOLEAN` | 否 | 否 | `-` | `False` |
| `created_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10aae69d0>` |
| `updated_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10aae6b80>` |

- 索引：`ix_rag_v2_nodes_active`, `ix_rag_v2_nodes_content_hash`, `ix_rag_v2_nodes_note_id`, `ix_rag_v2_nodes_note_section`, `ix_rag_v2_nodes_section_key`, `ix_rag_v2_nodes_source_version`, `ix_rag_v2_nodes_user_id`, `ix_rag_v2_nodes_visible`
- 唯一约束：无

## `agent_runs`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `id` | `VARCHAR(64)` | 否 | 是 | `-` | `-` |
| `session_id` | `VARCHAR(64)` | 否 | 否 | `chat_sessions.id` | `-` |
| `user_id` | `VARCHAR(64)` | 否 | 否 | `users.id` | `-` |
| `intent` | `VARCHAR(80)` | 否 | 否 | `-` | `general_chat` |
| `status` | `VARCHAR(50)` | 否 | 否 | `-` | `running` |
| `input_text` | `TEXT` | 否 | 否 | `-` | `-` |
| `output_text` | `TEXT` | 否 | 否 | `-` | `-` |
| `error_message` | `TEXT` | 是 | 否 | `-` | `-` |
| `request_id` | `VARCHAR(64)` | 是 | 否 | `-` | `-` |
| `trace_id` | `VARCHAR(64)` | 是 | 否 | `-` | `-` |
| `idempotency_key` | `VARCHAR(160)` | 是 | 否 | `-` | `-` |
| `metadata_json` | `JSON` | 否 | 否 | `-` | `<function AgentRun.<lambda> at 0x10abffd30>` |
| `started_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10abffe50>` |
| `finished_at` | `DATETIME` | 是 | 否 | `-` | `-` |

- 索引：`ix_agent_runs_request_id`, `ix_agent_runs_session_id`, `ix_agent_runs_trace_id`, `ix_agent_runs_user_id`
- 唯一约束：无

## `note_chunks`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `id` | `VARCHAR(64)` | 否 | 是 | `-` | `-` |
| `note_id` | `VARCHAR(64)` | 否 | 否 | `notes.id` | `-` |
| `section_id` | `VARCHAR(64)` | 否 | 否 | `note_sections.id` | `-` |
| `user_id` | `VARCHAR(64)` | 否 | 否 | `users.id` | `-` |
| `chunk_index` | `INTEGER` | 否 | 否 | `-` | `0` |
| `content` | `TEXT` | 否 | 否 | `-` | `-` |
| `token_count` | `INTEGER` | 否 | 否 | `-` | `0` |
| `content_hash` | `VARCHAR(64)` | 否 | 否 | `-` | `-` |
| `created_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10ab3c670>` |

- 索引：`ix_note_chunks_content_hash`, `ix_note_chunks_note_id`, `ix_note_chunks_section_id`, `ix_note_chunks_user_id`
- 唯一约束：无

## `note_draft_sections`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `id` | `VARCHAR(64)` | 否 | 是 | `-` | `-` |
| `draft_id` | `VARCHAR(64)` | 否 | 否 | `note_drafts.id` | `-` |
| `user_id` | `VARCHAR(64)` | 否 | 否 | `users.id` | `-` |
| `title` | `VARCHAR(255)` | 否 | 否 | `-` | `-` |
| `level` | `INTEGER` | 否 | 否 | `-` | `2` |
| `sort_order` | `INTEGER` | 否 | 否 | `-` | `0` |
| `outline_text` | `TEXT` | 否 | 否 | `-` | `-` |
| `content` | `TEXT` | 否 | 否 | `-` | `-` |
| `status` | `VARCHAR(50)` | 否 | 否 | `-` | `outline_only` |
| `created_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10ab09ee0>` |
| `updated_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10ab09310>` |
| `deleted_at` | `DATETIME` | 是 | 否 | `-` | `-` |
| `confirmed_at` | `DATETIME` | 是 | 否 | `-` | `-` |

- 索引：`ix_note_draft_sections_draft_id`, `ix_note_draft_sections_user_id`
- 唯一约束：无

## `note_edit_previews`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `id` | `VARCHAR(64)` | 否 | 是 | `-` | `-` |
| `user_id` | `VARCHAR(64)` | 否 | 否 | `users.id` | `-` |
| `note_id` | `VARCHAR(64)` | 否 | 否 | `notes.id` | `-` |
| `target_type` | `VARCHAR(50)` | 否 | 否 | `-` | `note` |
| `section_id` | `VARCHAR(64)` | 是 | 否 | `note_sections.id` | `-` |
| `old_content` | `TEXT` | 否 | 否 | `-` | `-` |
| `new_content` | `TEXT` | 否 | 否 | `-` | `-` |
| `instruction` | `TEXT` | 否 | 否 | `-` | `-` |
| `change_summary` | `JSON` | 否 | 否 | `-` | `<function NoteEditPreview.<lambda> at 0x10abc04c0>` |
| `status` | `VARCHAR(50)` | 否 | 否 | `-` | `preview` |
| `idempotency_key` | `VARCHAR(160)` | 是 | 否 | `-` | `-` |
| `apply_idempotency_key` | `VARCHAR(160)` | 是 | 否 | `-` | `-` |
| `created_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10abc0790>` |
| `updated_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10abc08b0>` |
| `applied_at` | `DATETIME` | 是 | 否 | `-` | `-` |
| `cancelled_at` | `DATETIME` | 是 | 否 | `-` | `-` |

- 索引：`ix_note_edit_previews_note_id`, `ix_note_edit_previews_user_id`
- 唯一约束：无

## `rag_v2_embeddings`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `id` | `VARCHAR(64)` | 否 | 是 | `-` | `-` |
| `node_id` | `VARCHAR(64)` | 否 | 否 | `rag_v2_nodes.id` | `-` |
| `note_id` | `VARCHAR(64)` | 否 | 否 | `notes.id` | `-` |
| `user_id` | `VARCHAR(64)` | 否 | 否 | `users.id` | `-` |
| `provider` | `VARCHAR(50)` | 否 | 否 | `-` | `-` |
| `embedding_model` | `VARCHAR(100)` | 否 | 否 | `-` | `-` |
| `embedding_dim` | `INTEGER` | 否 | 否 | `-` | `-` |
| `content_hash` | `VARCHAR(64)` | 否 | 否 | `-` | `-` |
| `embedding` | `vector(1024)` | 是 | 否 | `-` | `-` |
| `status` | `VARCHAR(32)` | 否 | 否 | `-` | `pending` |
| `error_message` | `TEXT` | 是 | 否 | `-` | `-` |
| `created_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10ab09c10>` |
| `updated_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10ab09700>` |
| `indexed_at` | `DATETIME` | 是 | 否 | `-` | `-` |

- 索引：`ix_rag_v2_embeddings_content_hash`, `ix_rag_v2_embeddings_node_id`, `ix_rag_v2_embeddings_note_id`, `ix_rag_v2_embeddings_user_id`, `ix_rag_v2_embeddings_vector_ready`
- 唯一约束：`uq_rag_v2_embedding_version`

## `agent_checkpoints`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `id` | `VARCHAR(64)` | 否 | 是 | `-` | `-` |
| `run_id` | `VARCHAR(64)` | 否 | 否 | `agent_runs.id` | `-` |
| `session_id` | `VARCHAR(64)` | 否 | 否 | `chat_sessions.id` | `-` |
| `user_id` | `VARCHAR(64)` | 否 | 否 | `users.id` | `-` |
| `intent` | `VARCHAR(80)` | 否 | 否 | `-` | `general_chat` |
| `status` | `VARCHAR(50)` | 否 | 否 | `-` | `open` |
| `checkpoint_type` | `VARCHAR(80)` | 否 | 否 | `-` | `runtime` |
| `payload` | `JSON` | 否 | 否 | `-` | `<function AgentCheckpoint.<lambda> at 0x10abef8b0>` |
| `created_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10ad9b940>` |
| `updated_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10ad9baf0>` |
| `resolved_at` | `DATETIME` | 是 | 否 | `-` | `-` |

- 索引：`ix_agent_checkpoints_run_id`, `ix_agent_checkpoints_session_id`, `ix_agent_checkpoints_user_id`
- 唯一约束：无

## `agent_steps`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `id` | `VARCHAR(64)` | 否 | 是 | `-` | `-` |
| `run_id` | `VARCHAR(64)` | 否 | 否 | `agent_runs.id` | `-` |
| `user_id` | `VARCHAR(64)` | 否 | 否 | `users.id` | `-` |
| `step_index` | `INTEGER` | 否 | 否 | `-` | `0` |
| `name` | `VARCHAR(120)` | 否 | 否 | `-` | `-` |
| `status` | `VARCHAR(50)` | 否 | 否 | `-` | `running` |
| `input_summary` | `TEXT` | 是 | 否 | `-` | `-` |
| `output_summary` | `TEXT` | 是 | 否 | `-` | `-` |
| `trace_id` | `VARCHAR(64)` | 是 | 否 | `-` | `-` |
| `metadata_json` | `JSON` | 否 | 否 | `-` | `<function AgentStep.<lambda> at 0x10abef820>` |
| `started_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10abef670>` |
| `finished_at` | `DATETIME` | 是 | 否 | `-` | `-` |

- 索引：`ix_agent_steps_run_id`, `ix_agent_steps_trace_id`, `ix_agent_steps_user_id`
- 唯一约束：无

## `chat_messages`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `id` | `VARCHAR(64)` | 否 | 是 | `-` | `-` |
| `session_id` | `VARCHAR(64)` | 否 | 否 | `chat_sessions.id` | `-` |
| `user_id` | `VARCHAR(64)` | 否 | 否 | `users.id` | `-` |
| `run_id` | `VARCHAR(64)` | 是 | 否 | `agent_runs.id` | `-` |
| `role` | `VARCHAR(20)` | 否 | 否 | `-` | `-` |
| `text` | `TEXT` | 否 | 否 | `-` | `-` |
| `context_mode` | `VARCHAR(50)` | 是 | 否 | `-` | `-` |
| `sources` | `JSON` | 否 | 否 | `-` | `<function ChatMessage.<lambda> at 0x10abef550>` |
| `metadata_json` | `JSON` | 否 | 否 | `-` | `<function ChatMessage.<lambda> at 0x10abff5e0>` |
| `created_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10abff700>` |

- 索引：`ix_chat_messages_run_id`, `ix_chat_messages_session_id`, `ix_chat_messages_user_id`
- 唯一约束：无

## `note_draft_section_versions`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `id` | `VARCHAR(64)` | 否 | 是 | `-` | `-` |
| `draft_section_id` | `VARCHAR(64)` | 否 | 否 | `note_draft_sections.id` | `-` |
| `draft_id` | `VARCHAR(64)` | 否 | 否 | `note_drafts.id` | `-` |
| `user_id` | `VARCHAR(64)` | 否 | 否 | `users.id` | `-` |
| `title` | `VARCHAR(255)` | 否 | 否 | `-` | `-` |
| `outline_text` | `TEXT` | 否 | 否 | `-` | `-` |
| `content` | `TEXT` | 否 | 否 | `-` | `-` |
| `status` | `VARCHAR(50)` | 否 | 否 | `-` | `outline_only` |
| `source` | `VARCHAR(50)` | 否 | 否 | `-` | `revise_section` |
| `created_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10aae6550>` |

- 索引：`ix_note_draft_section_versions_draft_id`, `ix_note_draft_section_versions_draft_section_id`, `ix_note_draft_section_versions_user_id`
- 唯一约束：无

## `note_edit_preview_revisions`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `id` | `VARCHAR(64)` | 否 | 是 | `-` | `-` |
| `edit_id` | `VARCHAR(64)` | 否 | 否 | `note_edit_previews.id` | `-` |
| `user_id` | `VARCHAR(64)` | 否 | 否 | `users.id` | `-` |
| `new_content` | `TEXT` | 否 | 否 | `-` | `-` |
| `instruction` | `TEXT` | 否 | 否 | `-` | `-` |
| `change_summary` | `JSON` | 否 | 否 | `-` | `<function NoteEditPreviewRevision.<lambda> at 0x10aae6820>` |
| `source` | `VARCHAR(50)` | 否 | 否 | `-` | `generated` |
| `created_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10abc09d0>` |

- 索引：`ix_note_edit_preview_revisions_edit_id`, `ix_note_edit_preview_revisions_user_id`
- 唯一约束：无

## `note_embeddings`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `id` | `VARCHAR(64)` | 否 | 是 | `-` | `-` |
| `chunk_id` | `VARCHAR(64)` | 否 | 否 | `note_chunks.id` | `-` |
| `note_id` | `VARCHAR(64)` | 否 | 否 | `notes.id` | `-` |
| `section_id` | `VARCHAR(64)` | 否 | 否 | `note_sections.id` | `-` |
| `user_id` | `VARCHAR(64)` | 否 | 否 | `users.id` | `-` |
| `provider` | `VARCHAR(50)` | 否 | 否 | `-` | `dashscope` |
| `embedding_model` | `VARCHAR(100)` | 否 | 否 | `-` | `-` |
| `embedding_dim` | `INTEGER` | 否 | 否 | `-` | `0` |
| `content_hash` | `VARCHAR(64)` | 否 | 否 | `-` | `-` |
| `embedding` | `vector(1024)` | 是 | 否 | `-` | `-` |
| `status` | `VARCHAR(50)` | 否 | 否 | `-` | `pending` |
| `error_message` | `TEXT` | 是 | 否 | `-` | `-` |
| `created_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10ab093a0>` |
| `updated_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10ab094c0>` |
| `indexed_at` | `DATETIME` | 是 | 否 | `-` | `-` |

- 索引：`ix_note_embeddings_chunk_id`, `ix_note_embeddings_content_hash`, `ix_note_embeddings_note_id`, `ix_note_embeddings_section_id`, `ix_note_embeddings_user_id`
- 唯一约束：无

## `rag_query_logs`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `id` | `VARCHAR(64)` | 否 | 是 | `-` | `-` |
| `user_id` | `VARCHAR(64)` | 是 | 否 | `users.id` | `-` |
| `query_hash` | `VARCHAR(64)` | 否 | 否 | `-` | `-` |
| `query_preview` | `VARCHAR(300)` | 是 | 否 | `-` | `-` |
| `provider` | `VARCHAR(50)` | 否 | 否 | `-` | `legacy` |
| `mode` | `VARCHAR(50)` | 否 | 否 | `-` | `hybrid` |
| `candidate_count` | `INTEGER` | 否 | 否 | `-` | `0` |
| `result_count` | `INTEGER` | 否 | 否 | `-` | `0` |
| `latency_ms` | `INTEGER` | 否 | 否 | `-` | `0` |
| `trace_id` | `VARCHAR(64)` | 是 | 否 | `-` | `-` |
| `run_id` | `VARCHAR(64)` | 是 | 否 | `agent_runs.id` | `-` |
| `metrics` | `JSON` | 否 | 否 | `-` | `<function RagQueryLog.<lambda> at 0x10add79d0>` |
| `created_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10add7a60>` |

- 索引：`ix_rag_query_logs_created_at`, `ix_rag_query_logs_query_hash`, `ix_rag_query_logs_run_id`, `ix_rag_query_logs_trace_id`, `ix_rag_query_logs_user_id`
- 唯一约束：无

## `agent_tool_traces`

| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |
|---|---|---:|---:|---|---|
| `id` | `VARCHAR(64)` | 否 | 是 | `-` | `-` |
| `run_id` | `VARCHAR(64)` | 否 | 否 | `agent_runs.id` | `-` |
| `step_id` | `VARCHAR(64)` | 是 | 否 | `agent_steps.id` | `-` |
| `user_id` | `VARCHAR(64)` | 否 | 否 | `users.id` | `-` |
| `tool_name` | `VARCHAR(120)` | 否 | 否 | `-` | `-` |
| `action` | `VARCHAR(120)` | 否 | 否 | `-` | `-` |
| `status` | `VARCHAR(50)` | 否 | 否 | `-` | `success` |
| `duration_ms` | `INTEGER` | 否 | 否 | `-` | `0` |
| `input_summary` | `TEXT` | 是 | 否 | `-` | `-` |
| `output_summary` | `TEXT` | 是 | 否 | `-` | `-` |
| `trace_id` | `VARCHAR(64)` | 是 | 否 | `-` | `-` |
| `metadata_json` | `JSON` | 否 | 否 | `-` | `<function AgentToolTrace.<lambda> at 0x10ad9b8b0>` |
| `created_at` | `DATETIME` | 否 | 否 | `-` | `<function datetime.utcnow at 0x10ad9b9d0>` |

- 索引：`ix_agent_tool_traces_run_id`, `ix_agent_tool_traces_step_id`, `ix_agent_tool_traces_trace_id`, `ix_agent_tool_traces_user_id`
- 唯一约束：无
