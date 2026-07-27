# NoteFlow 项目目录规范

## 根目录

根目录只放项目入口和跨前后端配置：

- `src/`：React 前端
- `server/`：FastAPI 后端、数据库迁移和后端测试
- `scripts/`：开发、质量检查、备份和运维命令入口
- `docs/`：当前文档与历史归档
- `quality/`：固定评测数据、当前基线和历史报告
- `public/`、`nginx/`：前端静态资源和部署配置

`node_modules/`、`dist/`、`__pycache__/`、本地数据库附件和备份目录都属于本机生成物，不得提交。

## 前端

```text
src/
├── components/       页面和可复用界面
├── editor/           Tiptap 扩展
├── hooks/            React hooks
├── services/         HTTP、SSE 和浏览器持久化适配
├── store/
│   ├── index.tsx     Zustand 状态与业务动作
│   ├── persistence.ts
│   ├── tree.ts
│   └── selectors/    面向组件的状态选择器
├── testing/          前端测试入口
└── utils/            无状态通用算法
```

业务代码不使用 `mock`、`pilot` 或具体 AI 供应商名称作为正式模块名。

## 后端

```text
server/app/
├── routers/          HTTP/SSE 输入输出
├── schemas/          API 请求与响应模型
├── agent/            Agent 状态机和运行时协议
├── memory/           Memory 领域规则、提取、检索和服务
├── rag/              RAG 协议、评测和生产检索流水线
├── services/         跨领域应用服务
├── repositories/     带用户范围的数据访问
├── providers/        外部 AI/Memory Provider 适配
├── workers/          后台任务入口
├── models/           SQLAlchemy 数据模型
└── observability/    Trace 上下文
```

调用方向固定为：

```text
Router / Agent
    → Domain or Application Service
    → Repository / Provider
    → Database / External Service
```

Router 和 Agent Tool 不直接写 SQL。Memory 代码统一进入 `app.memory`，RAG 代码统一进入 `app.rag`；数据库中的历史 `rag_v2_*` 名称仅作为兼容标识保留。

## 文档与报告

- 当前事实：`docs/current-baseline/`
- 当前架构：`docs/architecture/`
- 运维手册：`docs/operations/`
- 待评估能力：`docs/evaluations/`
- 历史材料：`docs/archive/`
- 当前质量结果：`quality/reports/`
- 历史质量结果：`quality/reports/archive/`

新文件必须能明确归入以上分类；不能确定用途的临时文件应留在项目外。
