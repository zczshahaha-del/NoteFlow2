# NoteFlow 文档导航

文档按用途分类保存，避免当前设计、运行手册和历史执行记录混在一起。

- `architecture/`：当前系统架构与模块边界
- `current-baseline/`：当前接口、能力、数据库和测试基线
- `operations/`：部署、发布、备份与故障恢复手册
- `evaluations/`：尚未落地或需要评估的产品、编辑器和桌面能力
- `specification/`：统一设计说明书及其生成源文件
- `releases/`：版本发布说明
- `poc/`：技术可行性验证
- `archive/`：已经完成的实施计划、交接材料和阶段执行记录

新增文档应放入对应分类；已完成且不再指导当前开发的材料应移入 `archive/`。

项目文件与模块的放置规则见[项目目录规范](architecture/project-layout.md)。

记忆与 AI 运行架构的重规划提案见[整体架构、记忆与意图识别重规划](architecture/architecture-replanning-2026-10-24.md)；该文为待实施方案，当前运行事实仍以源码及现有架构文档为准。

允许放弃旧技术选型后的独立方案见[从零架构设计与技术选型调研](architecture/greenfield-architecture-2026-10-25.md)：比较领域 harness、全 TypeScript、托管 Agent 与本地优先路线，给出正文、任务、检索、记忆、部署及验证设计。该文为研究提案，尚未实施或完成候选运行 PoC，不替代当前运行说明。

从用户操作理解当前 Agent，按顺序阅读[当前 Agent 全链路分支图解](architecture/agent-flow-explained-2026-10-27.md)：覆盖对话 / 全库、选区 / 当前笔记、创建、修改、记忆、澄清、重试、停止与恢复，并标明已确认的入口限制。
