# NoteFlow 当前 SSE 契约基线

## 传输约定

- 端点：`POST /api/ai/notes/generate`、`POST /api/agent/chat`。
- Content-Type：`text/event-stream; charset=utf-8`。
- 每帧：`data: <JSON>\n\n`。
- 正常或受控失败流的最终结束标记：`data: [DONE]\n\n`。
- 文本 token 沿用 OpenAI-compatible `choices[0].delta.content`。

## Agent 事件

| 类型 | 必需字段 | 作用 | 前端消费 |
|---|---|---|---|
| token delta | `choices[].delta.content` | 流式回答正文 | 追加到当前助手消息 |
| `agent_session` | `sessionId`, `runId`, `intent` | 建立运行上下文 | 保存会话与 run id |
| `tool_trace` | `toolName`, `action`, `status`, `durationMs` 等 | 工具可观测记录 | 非 silent 轨迹进入任务状态 |
| `tool_action` | `toolName`, `action`, `payload`, `message` | 请求前端打开草稿/预览或执行确认动作 | Store action dispatcher |
| `context` | `contextMode`, `sources` | RAG/当前笔记上下文与引用来源 | 显示紧凑来源 |
| `checkpoint` | `checkpoint` | 等待确认或恢复任务 | 保存 pending checkpoint |
| `agent_done` | `sessionId`, `runId`, `status` | Agent 业务完成 | 完成任务状态 |
| `agent_error` | `sessionId`, `runId`, `status`, `code`, `message` | Agent 受控错误 | 展示公开错误信息 |
| `stream_error` | `code`, `message`, `retryable` | LLM/流式底层错误 | 展示错误并结束 |

## 顺序基线

1. Agent 正常路径先发送 `agent_session`。
2. 可发送一个或多个 `tool_trace`、`context`、`checkpoint`、`tool_action`。
3. 回答正文通过 token delta 发送。
4. Agent 路径发送 `agent_done` 或 `agent_error`。
5. 最后发送 `[DONE]`；前端把 `[DONE]` 视为传输终止，不是业务事件。

## 运行边界

- 内部事件统一为 `RuntimeEvent`，由 SSE Adapter 映射为浏览器协议；Router 的 `_sse_format` 入口统一委托给 Adapter。
- Adapter 保证结束标记只输出一次，并拒绝在 `[DONE]` 后继续发送事件。
- 请求与运行通过 `requestId`、`traceId`、`sessionId`、`runId` 关联。
- 前端当前明确识别：`agent_session`、`tool_trace`、`tool_action`、`agent_done`、`agent_error`、`stream_error`、`context`。
- LangGraph 运行时必须持续输出以上事件和结束顺序。
