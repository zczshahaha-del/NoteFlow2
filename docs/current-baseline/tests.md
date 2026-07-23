# NoteFlow 修改前测试基线

执行时间：2026-07-17，基线提交：`a9fd010`

## 结果摘要

| 分组 | 结果 |
|---|---|
| 前端编辑器与 codec | 8 个 Markdown fixtures、Tiptap codec、选区、兼容策略全部通过 |
| 前端功能脚本 | wiki link、知识导入、diff、离线冲突、目录/store、PWA、IME 全部通过 |
| 后端 unittest | 45/45 通过，0.614 秒 |
| 运行时静态检查 | context planner、runtime events、diagnostics、memory stage 1/3/4 通过 |
| 生产构建 | TypeScript + Vite 通过，1890 modules transformed |
| 既有失败 | `check_memory_stage2.py` 引用了迁移后已删除的 Router 私有函数 |

## 已知警告

- Node 26 对 `module.register()` 输出弃用警告；当前不影响测试和构建。
- Vite 主入口压缩后约 461 kB，尚未设置 bundle budget 门禁。
- legacy editor round-trip 明确记录三个缺口：`execCommand`、复杂合并单元格、浏览器原生 undo/selection E2E。

## 既有失败处置

`check_memory_stage2.py` 的断言仍然有效，但实现已经从 Router 移到 `app.services.agent_checkpoints`。步骤 2 只修正检查脚本的 import，不改变业务行为。修正后该检查必须纳入统一门禁。

## 当前命令入口

前端脚本分散在 `package.json` 的 `test:*` 命令；后端使用：

```bash
cd server
python3 -m unittest discover -s tests -p 'test_*.py'
```

步骤 2 会新增 `npm run test:quality` 作为分类明确的统一入口，并把固定 RAG/Memory 评测与 PostgreSQL 集成门禁纳入报告。
