from __future__ import annotations

import json
import os
import platform
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SERVER_ROOT = ROOT / "server"
OUTPUT_ROOT = ROOT / "docs" / "current-baseline"


def _run(*args: str) -> str:
    try:
        result = subprocess.run(
            args,
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        return "unavailable"
    value = (result.stdout or result.stderr).strip().splitlines()
    return value[0] if value else "unavailable"


def _schema_name(schema: object) -> str:
    if not isinstance(schema, dict):
        return "-"
    if "$ref" in schema:
        return str(schema["$ref"]).rsplit("/", 1)[-1]
    if schema.get("type") == "array":
        return f"{_schema_name(schema.get('items'))}[]"
    return str(schema.get("type") or "object")


def _request_schema(operation: dict) -> str:
    content = (operation.get("requestBody") or {}).get("content") or {}
    for media_type in ("application/json", "multipart/form-data", "application/octet-stream"):
        if media_type in content:
            return _schema_name(content[media_type].get("schema"))
    return "-"


def _response_schema(operation: dict) -> str:
    responses = operation.get("responses") or {}
    response = responses.get("200") or responses.get("201") or responses.get("204") or {}
    content = response.get("content") or {}
    for media_type in ("application/json", "text/event-stream"):
        if media_type in content:
            return _schema_name(content[media_type].get("schema"))
    return "SSE" if "text/event-stream" in str(content) else "-"


def _escape(value: object) -> str:
    return str(value or "-").replace("|", "\\|").replace("\n", " ")


def _write_api(openapi: dict) -> None:
    rows: list[str] = []
    methods = {"get", "post", "put", "patch", "delete"}
    for path, path_item in sorted((openapi.get("paths") or {}).items()):
        for method, operation in path_item.items():
            if method.lower() not in methods:
                continue
            responses = ", ".join(sorted((operation.get("responses") or {}).keys()))
            security = "cookie / bearer" if operation.get("security") else "route dependency / public"
            rows.append(
                "| {method} | `{path}` | {summary} | {request} | {response} | {statuses} | {security} |".format(
                    method=method.upper(),
                    path=path,
                    summary=_escape(operation.get("summary") or operation.get("operationId")),
                    request=_escape(_request_schema(operation)),
                    response=_escape(_response_schema(operation)),
                    statuses=_escape(responses),
                    security=security,
                )
            )

    content = "\n".join(
        [
            "# NoteFlow 当前 API 基线",
            "",
            "> 由 `scripts/export_current_baseline.py` 从 FastAPI OpenAPI 事实导出。",
            "",
            f"- API 路径数：{len(openapi.get('paths') or {})}",
            f"- 操作数：{len(rows)}",
            "- 全局错误结构：`ApiErrorEnvelope { error: { code, message }, requestId, traceId }`（OpenAPI schema 保持向后兼容，traceId 为运行时关联字段）。",
            "- 认证实现：HttpOnly session cookie 为当前主路径；部分旧客户端仍兼容 Bearer。",
            "",
            "| 方法 | 路径 | 操作 | 请求模型 | 成功响应 | 已声明状态码 | 认证基线 |",
            "|---|---|---|---|---|---|---|",
            *rows,
            "",
            "完整机器可读版本见 `openapi.json`。路由是否公开以 FastAPI dependency 为最终事实，OpenAPI 当前未完整表达所有 dependency 认证要求。",
            "",
        ]
    )
    (OUTPUT_ROOT / "api.md").write_text(content, encoding="utf-8")
    (OUTPUT_ROOT / "openapi.json").write_text(
        json.dumps(openapi, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _write_database_model(metadata) -> None:
    sections = [
        "# NoteFlow 当前 SQLAlchemy 数据模型基线",
        "",
        "> 此文件描述代码模型；真实 PostgreSQL 运行时结构另见 `database-runtime.md`。",
        "",
        f"- 模型表数量：{len(metadata.sorted_tables)}",
        "- 业务真相源：PostgreSQL",
        "- 向量字段：pgvector `vector(1024)`",
        "",
    ]
    for table in metadata.sorted_tables:
        sections.extend(
            [
                f"## `{table.name}`",
                "",
                "| 字段 | 类型 | 可空 | 主键 | 外键 | 默认值 |",
                "|---|---|---:|---:|---|---|",
            ]
        )
        for column in table.columns:
            foreign_keys = ", ".join(sorted(str(item.target_fullname) for item in column.foreign_keys)) or "-"
            default = str(column.default.arg) if column.default is not None else "-"
            sections.append(
                f"| `{column.name}` | `{column.type}` | {'是' if column.nullable else '否'} | "
                f"{'是' if column.primary_key else '否'} | `{foreign_keys}` | `{_escape(default)}` |"
            )
        indexes = sorted(index.name for index in table.indexes if index.name)
        uniques = sorted(
            constraint.name or "(unnamed)"
            for constraint in table.constraints
            if constraint.__class__.__name__ == "UniqueConstraint"
        )
        sections.extend(
            [
                "",
                f"- 索引：{', '.join(f'`{name}`' for name in indexes) or '无'}",
                f"- 唯一约束：{', '.join(f'`{name}`' for name in uniques) or '无'}",
                "",
            ]
        )
    (OUTPUT_ROOT / "database-model.md").write_text("\n".join(sections), encoding="utf-8")


def _write_sse() -> None:
    content = """# NoteFlow 当前 SSE 契约基线

## 传输约定

- 端点：`POST /api/ai/notes/generate`、`POST /api/agent/chat`。
- Content-Type：`text/event-stream; charset=utf-8`。
- 每帧：`data: <JSON>\\n\\n`。
- 正常或受控失败流的最终结束标记：`data: [DONE]\\n\\n`。
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
"""
    (OUTPUT_ROOT / "sse.md").write_text(content, encoding="utf-8")


def _count_files(relative: str, pattern: str) -> int:
    return len(list((ROOT / relative).glob(pattern)))


def _write_inventory(cfg) -> None:
    content = f"""# NoteFlow 当前环境与代码清单

## 环境

| 项目 | 当前值 |
|---|---|
| 操作系统 | {platform.platform()} |
| 架构 | {platform.machine()} |
| Node | {_run('node', '--version')} |
| npm | {_run('npm', '--version')} |
| Python | {platform.python_version()} |
| Docker | {_run('docker', '--version')} |
| Git | {_run('git', '--version')} |

## AI Provider（不包含密钥）

| 能力 | 当前本机配置 | 代码/容器默认 |
|---|---|---|
| Chat completion | `{cfg.DEEPSEEK_BASE_URL}` / `{cfg.DEEPSEEK_MODEL}` | DeepSeek / `deepseek-chat` |
| Embedding | `{cfg.EMBEDDING_PROVIDER}` / `{cfg.EMBEDDING_MODEL}` | DashScope `text-embedding-v4` |
| Embedding dimensions | `{cfg.EMBEDDING_DIMENSIONS}` | `1024` |
| Embedding batch | `{cfg.EMBEDDING_BATCH_SIZE}` | `10` |
| Database endpoint | `{cfg.DB_HOST}:{cfg.DB_PORT}/{cfg.DB_NAME}` | Docker PostgreSQL `postgres:5432/noteflow` |
| Redis endpoint | `{cfg.REDIS_ADDR}` | Docker Redis `redis:6379` |

## 代码清单

| 分组 | 数量 |
|---|---:|
| React TSX 组件 | {_count_files('src/components', '*.tsx')} |
| Store slices | {_count_files('src/storeSlices', '*.ts')} |
| 前端 API services | {_count_files('src/services', '*.ts')} |
| FastAPI routers | {_count_files('server/app/routers', '*.py') - 1} |
| 后端 services | {_count_files('server/app/services', '*.py') - 1} |
| SQLAlchemy model modules | {_count_files('server/app/models', '*.py') - 1} |
| Alembic revisions | {_count_files('server/alembic/versions', '*.py')} |
| Python unit test files | {_count_files('server/tests', 'test_*.py')} |
| 前端 test/audit scripts | {_count_files('scripts', '*test*')} |

## 当前实现状态摘要

- 前端：React/TypeScript、Tiptap/Markdown 双编辑兼容、三栏工作台、AI 面板、草稿与修改预览。
- 后端：主要 Router 已迁移到 Service/Repository，AI 运行时只保留正式实现。
- RAG：LlamaIndex RAG、BM25/向量融合、引用与可选 Qwen Reranker 已成为唯一检索链路。
- Intent：`context_planner` 已启用 LLM 规划并带规则 fallback；并非关闭状态。
- Memory：五层记忆规则、用户设置与 CRUD 继续作为安全真相层，相关性检索和同步固定使用 Mem0。
- Agent：LangGraph 是唯一运行时；业务 checkpoint 与 LangGraph checkpoint 表语义分离，RuntimeEvent/SSE Adapter/trace 已启用。
- Reliability：Outbox、索引任务 claim/heartbeat/崩溃恢复与 RAG 评测/查询日志数据面已建立。
- Draft/Edit：LangGraph 草稿图和修改图负责持久化状态流转，并保留 worker、确认、取消和版本保护。
"""
    (OUTPUT_ROOT / "inventory.md").write_text(content, encoding="utf-8")


def main() -> None:
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(SERVER_ROOT))
    os.chdir(ROOT)

    from app.config import cfg
    from app.main import app
    from app.models.db import Base

    _write_api(app.openapi())
    _write_database_model(Base.metadata)
    _write_sse()
    _write_inventory(cfg)
    print(f"current baseline exported to {OUTPUT_ROOT}")


if __name__ == "__main__":
    main()
