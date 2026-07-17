export interface NoteTemplate {
  id: string;
  name: string;
  description: string;
  tags: string[];
  content: string;
}

export const noteTemplates: NoteTemplate[] = [
  {
    id: "meeting",
    name: "会议记录",
    description: "议题、决定、行动项与负责人",
    tags: ["会议"],
    content: "# {{title}}\n\n日期：{{date}}\n\n## 参会者\n\n- \n\n## 议题\n\n- \n\n## 关键讨论\n\n\n## 决定\n\n- \n\n## 行动项\n\n- [ ] 事项 — 负责人 / 截止日期\n",
  },
  {
    id: "project",
    name: "项目主页",
    description: "目标、里程碑、风险和关联资料",
    tags: ["项目"],
    content: "# {{title}}\n\n## 项目目标\n\n\n## 成功标准\n\n- \n\n## 里程碑\n\n- [ ] M1\n- [ ] M2\n\n## 当前风险\n\n| 风险 | 影响 | 应对 |\n| --- | --- | --- |\n|  |  |  |\n\n## 关联笔记\n\n- [[笔记名]]\n",
  },
  {
    id: "reading",
    name: "阅读笔记",
    description: "来源、核心观点、摘录和个人思考",
    tags: ["阅读"],
    content: "# {{title}}\n\n来源：\n日期：{{date}}\n\n## 一句话总结\n\n\n## 核心观点\n\n1. \n\n## 重要摘录\n\n> \n\n## 我的思考\n\n\n## 延伸关联\n\n- [[笔记名]]\n",
  },
  {
    id: "decision",
    name: "决策记录",
    description: "背景、方案、取舍和复盘日期",
    tags: ["决策"],
    content: "# {{title}}\n\n日期：{{date}}\n\n## 背景\n\n\n## 备选方案\n\n| 方案 | 优点 | 风险 |\n| --- | --- | --- |\n| A |  |  |\n| B |  |  |\n\n## 最终决定\n\n\n## 决策理由\n\n\n## 复盘日期\n\n",
  },
];

export function instantiateTemplate(template: NoteTemplate, title: string, date = new Date()): string {
  const dateLabel = date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
  return template.content.split("{{title}}").join(title).split("{{date}}").join(dateLabel);
}
