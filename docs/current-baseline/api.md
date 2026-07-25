# NoteFlow 当前 API 基线

> 由 `scripts/export_current_baseline.py` 从 FastAPI OpenAPI 事实导出。

- API 路径数：77
- 操作数：91
- 全局错误结构：`ApiErrorEnvelope { error: { code, message }, requestId, traceId }`（OpenAPI schema 保持向后兼容，traceId 为运行时关联字段）。
- 认证实现：HttpOnly session cookie 为当前主路径；部分旧客户端仍兼容 Bearer。

| 方法 | 路径 | 操作 | 请求模型 | 成功响应 | 已声明状态码 | 认证基线 |
|---|---|---|---|---|---|---|
| POST | `/api/agent/chat` | Chat | AgentChatPayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| GET | `/api/agent/checkpoints/latest` | Latest Checkpoint | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/agent/checkpoints/{checkpoint_id}/bind` | Bind Checkpoint | CheckpointBindPayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/agent/checkpoints/{checkpoint_id}/resolve` | Resolve Checkpoint | CheckpointResolvePayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| GET | `/api/agent/runs` | List Runs | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| GET | `/api/agent/runs/latest` | Latest Run | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/agent/runs/{run_id}/cancel` | Cancel Run | RunCancelPayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/ai/notes/generate` | Generate Note | NoteGeneratePayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/attachments` | Upload Attachment | string | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| GET | `/api/attachments/{attachment_id}` | Download Attachment | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| DELETE | `/api/attachments/{attachment_id}` | Delete Attachment | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| GET | `/api/attachments/{attachment_id}/content` | Read Signed Attachment | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | route dependency / public |
| POST | `/api/auth/login` | Login | AuthPayload | AuthResponse | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | route dependency / public |
| POST | `/api/auth/logout` | Logout | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | route dependency / public |
| GET | `/api/auth/me` | Me | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/auth/migrate-legacy-token` | Migrate Legacy Token | - | AuthResponse | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | route dependency / public |
| POST | `/api/auth/password-reset/confirm` | Confirm Password Reset | PasswordResetConfirm | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | route dependency / public |
| POST | `/api/auth/password-reset/request` | Request Password Reset | PasswordResetRequest | PasswordResetRequestResponse | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | route dependency / public |
| POST | `/api/auth/refresh` | Refresh Session | - | AuthResponse | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | route dependency / public |
| POST | `/api/auth/register` | Register | AuthPayload | AuthResponse | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | route dependency / public |
| GET | `/api/auth/sessions` | List Sessions | - | SessionOut[] | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| DELETE | `/api/auth/sessions/{session_id}` | Revoke Session | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| GET | `/api/categories` | List Categories | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/categories` | Create Category | CategoryPayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| PUT | `/api/categories/{category_id}` | Update Category | CategoryPayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| DELETE | `/api/categories/{category_id}` | Delete Category | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| GET | `/api/chat-sessions` | List Chat Sessions | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/chat-sessions` | Create Chat Session | ChatSessionCreatePayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| PATCH | `/api/chat-sessions/{session_id}` | Update Chat Session | ChatSessionUpdatePayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| DELETE | `/api/chat-sessions/{session_id}` | Delete Chat Session | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| GET | `/api/chat-sessions/{session_id}/messages` | List Chat Messages | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| GET | `/api/diagnostics` | Diagnostics | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | route dependency / public |
| GET | `/api/health` | Health | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | route dependency / public |
| GET | `/api/index-jobs` | List Index Jobs | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| GET | `/api/knowledge-base` | Load Knowledge Base | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| PUT | `/api/knowledge-base` | Save Knowledge Base | KnowledgeBaseSnapshot | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| DELETE | `/api/knowledge-base` | Delete Knowledge Base | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/knowledge-base/migrate` | Migrate Knowledge Base | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| GET | `/api/memories` | List Memories | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/memories` | Create Memory | MemoryPayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| GET | `/api/memories/context` | Get Memory Context | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/memories/extract` | Extract Memory | MemoryExtractPayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| GET | `/api/memories/provider` | Get Memory Provider | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/memories/search` | Search Memories | MemorySearchPayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| PUT | `/api/memories/{memory_id}` | Update Memory | MemoryUpdatePayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| DELETE | `/api/memories/{memory_id}` | Delete Memory | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| GET | `/api/metrics` | Metrics | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/note-drafts` | Create Draft | DraftCreatePayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| GET | `/api/note-drafts/{draft_id}` | Get Draft | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| PUT | `/api/note-drafts/{draft_id}` | Update Draft | DraftUpdatePayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/note-drafts/{draft_id}/assemble` | Assemble Draft | DraftAssemblePayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/note-drafts/{draft_id}/cancel` | Cancel Draft | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/note-drafts/{draft_id}/generate-all` | Generate All Draft Sections | DraftGenerateAllPayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/note-drafts/{draft_id}/generate-all/stop` | Stop All Draft Sections | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/note-drafts/{draft_id}/save-to-notes` | Save Draft To Notes | DraftSavePayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/note-drafts/{draft_id}/sections` | Create Draft Section | DraftSectionPayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| PUT | `/api/note-drafts/{draft_id}/sections/{section_id}` | Update Draft Section | DraftSectionUpdatePayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/note-drafts/{draft_id}/sections/{section_id}/confirm` | Confirm Draft Section | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/note-drafts/{draft_id}/sections/{section_id}/delete` | Delete Draft Section | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/note-drafts/{draft_id}/sections/{section_id}/generate` | Generate Draft Section | DraftSectionUpdatePayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/note-drafts/{draft_id}/sections/{section_id}/restore` | Restore Draft Section | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/note-edit-previews` | Create Edit Preview | EditPreviewPayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| GET | `/api/note-edit-previews/{edit_id}` | Get Edit Preview | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/note-edit-previews/{edit_id}/apply` | Apply Preview | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/note-edit-previews/{edit_id}/cancel` | Cancel Preview | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/note-edit-previews/{edit_id}/restore-revision` | Restore Edit Preview Revision | RestorePreviewRevisionPayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/note-edit-previews/{edit_id}/revise` | Revise Preview | RevisePreviewPayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| GET | `/api/note-edit-previews/{edit_id}/revisions` | List Edit Preview Revisions | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| GET | `/api/notes` | List Notes | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/notes` | Create Note | NotePayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/notes/context` | Build Global Note Context | NoteContextPayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/notes/rag-eval` | Evaluate Rag | RagEvalPayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/notes/rag-eval/auto` | Evaluate Rag Auto | RagEvalAutoPayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/notes/search` | Search Notes | NoteSearchPayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| GET | `/api/notes/{note_id}` | Get Note | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| PUT | `/api/notes/{note_id}` | Update Note | NoteUpdatePayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| DELETE | `/api/notes/{note_id}` | Delete Note | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| GET | `/api/notes/{note_id}/attachments` | List Note Attachments | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/notes/{note_id}/context` | Build Current Note Context | NoteContextPayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| GET | `/api/notes/{note_id}/embedding-status` | Get Note Embedding Status | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| GET | `/api/notes/{note_id}/outline` | Get Note Outline | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/notes/{note_id}/reindex` | Reindex Note | object | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| GET | `/api/notes/{note_id}/related` | Get Related Notes | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/notes/{note_id}/restore` | Restore Note | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/notes/{note_id}/sections/read` | Read Current Note Sections | ReadSectionsPayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| GET | `/api/notes/{note_id}/versions` | List Note Versions | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/notes/{note_id}/versions/{version_id}/restore` | Restore Note Version | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| GET | `/api/rag-v2/index-status` | Rag V2 Index Status | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| POST | `/api/rag-v2/reindex` | Reindex Rag V2 | RagV2ReindexPayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| GET | `/api/settings` | Get Settings | - | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |
| PUT | `/api/settings` | Update Settings | SettingsUpdatePayload | object | 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 | cookie / bearer |

完整机器可读版本见 `openapi.json`。路由是否公开以 FastAPI dependency 为最终事实，OpenAPI 当前未完整表达所有 dependency 认证要求。
