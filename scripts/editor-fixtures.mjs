export const editorFixtures = [
  {
    name: "headings-inline-links",
    markdown: "# 主标题\n\n## 小节\n\n这是 **粗体**、*斜体*、~~删除~~ 和 [链接](https://example.com)。",
    required: [/^# 主标题/m, /\*\*粗体\*\*/, /\[链接\]\(https:\/\/example\.com\)/],
  },
  {
    name: "lists-and-quote",
    markdown: "- 第一项\n  - 子项\n- 第二项\n\n1. 步骤一\n2. 步骤二\n\n> 一段引用内容",
    required: [/-\s+第一项/, /子项/, /1\.\s+步骤一/, /> 一段引用内容/],
  },
  {
    name: "gfm-table",
    markdown: "| 名称 | 状态 |\n| :--- | ---: |\n| 搜索 | 完成 |\n| 版本 | 进行中 |",
    required: [/\|\s*名称\s+\|\s*状态\s+\|/, /\|\s*搜索\s+\|\s*完成\s+\|/],
  },
  {
    name: "fenced-code",
    markdown: "```ts\nconst answer: number = 42;\nconsole.log(answer);\n```",
    required: [/```(?:ts|typescript)/, /const answer: number = 42;/],
  },
  {
    name: "editor-html-marks",
    markdown: "普通 <u>下划线</u>、<mark>高亮</mark> 与 <span style=\"font-size: 15px\">字号</span>。",
    required: [/<u>下划线<\/u>/, /<mark>高亮<\/mark>/, /<span style="font-size: 15px">字号<\/span>/],
  },
  {
    name: "task-list",
    markdown: "- [x] 已完成迁移评估\n- [ ] 待验证中文输入法",
    required: [/- \[x\] 已完成迁移评估/i, /- \[ \] 待验证中文输入法/],
  },
  {
    name: "image-and-escaped-text",
    markdown: "![架构图](https://example.com/arch.png \"NoteFlow 架构\")\n\n保留字面符号：\\*不是斜体\\*、\\#不是标题。",
    required: [/!\[架构图\]\(https:\/\/example\.com\/arch\.png \"NoteFlow 架构\"\)/, /不是斜体/, /不是标题/],
  },
  {
    name: "blank-lines-and-mixed-html",
    markdown: "第一段\n\n\n\n第二段使用 <kbd>⌘</kbd> + <code>K</code>。",
    required: [/第一段/, /第二段使用/, /<kbd>⌘<\/kbd>/, /`K`/],
  },
];
