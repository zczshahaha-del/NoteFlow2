# NoteFlow LangGraph 正式运行架构

## 本轮入口

`POST /api/agent/chat` 的每条请求先进入 `langgraph_turn`：

```text
Ingress → TurnPlanner → PlanValidator
                     ├─ execute → 业务执行图
                     ├─ clarify → LangGraph interrupt → 用户补充 → 再验证
                     └─ unknown → 说明无法确定
```

前端模式是硬规则：

| 模式 | 行为 |
|---|---|
| `chat` | 普通对话，不允许自动升级为全库检索 |
| `ask_notes` | 必须使用 `knowledge_base`，进入 LlamaIndex RAG |

## 强类型 TurnPlan

规划结果使用 Pydantic 模型，不再传递任意结构的 planner dict：

- `mode`
- `primary_intent`：`general_chat / note_create / note_edit / memory / unknown`
- `intent_parameters`
- `context_sources`：`current_note / selected_text / knowledge_base / user_memory`
- `missing_fields`
- `result`：`execute / clarify / unknown`

Planner 只提出计划；Validator 负责模式约束、必填字段、页面上下文与字段格式校验。`chat` 模式的语义只能由模型 Planner 判断；模型不可用或结构化结果自动修复失败时返回独立的 `planner_failed`，不会退回关键词规则，也不会伪装成 `unknown`。`ask_notes` 仍由用户显式模式直接决定。

模型按 JSON Schema 输出 `PlannerOutput`，后端使用 Pydantic 严格校验。格式不合法时只自动修复一次；`unknown` 仅表示模型确实无法判断用户意图，和系统异常严格分开。

## Context 与执行

- 普通聊天不读取笔记。
- 当前笔记或选区问答进入只读 LangGraph，并由 RAG Service 读取指定范围。
- 全库模式进入 LlamaIndex RAG。
- 创建笔记和修改笔记继续使用现有 LangGraph 草稿图、编辑图与业务 checkpoint。
- LangGraph checkpoint 保存图的中断位置；`agent_checkpoints` 保存草稿/编辑等业务状态，二者职责不同。

## 记忆

显式记忆管理是 `memory` 主意图。自然陈述中的个人信息不是主意图，而是在主任务成功后由独立 `MemoryWriter` 判断持久性、安全性和重复项，再写入 PostgreSQL 并通过 Outbox 同步到 Mem0。

`MemoryWriter` 每轮独立读取当前用户消息，使用模型输出强类型候选。后端再执行主体、安全、时效、置信度、规范键、单值覆盖和重复校验。模型异常时不会用正则猜测并写入；隐式写入失败只跳过本轮写入，显式记忆管理则向用户返回错误。

记忆读取直接由唯一的 `TurnPlan` 转换成 `MemoryReadPlan`，不会再调用第二个 Planner。读取过程也不会从聊天历史偷偷补写姓名，或在查询时迁移旧候选；历史迁移只能通过显式迁移任务执行。

记忆写入失败不会把已经成功的聊天、搜索或笔记任务改成失败。
