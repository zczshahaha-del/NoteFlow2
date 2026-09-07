# NoteFlow Living Canvas · V3 设计依据

## 为什么前两版仍然显得陈旧

前两版虽然提高了整洁度，但核心结构仍是传统知识库的三段式框架：常驻导航、居中文档、固定聊天面板。视觉装饰发生了变化，用户与内容、AI 的关系却没有改变。

V3 不再把“现代感”理解为圆角、玻璃或渐变，而是重新定义界面中的空间关系：内容是底层画布，导航与控制是短暂浮起的功能层，AI 结果从被选内容中生长出来。

## 研究结论

### 1. 内容层与控制层必须分开

Apple 的最新设计指导把 Liquid Glass 定义为浮在内容之上的功能层，并明确不建议把玻璃材质铺进内容层。V3 因此只让顶部模式、工作区入口和工具动作悬浮，正文仍保持稳定、清晰和低噪音。

来源：[Apple Human Interface Guidelines · Materials](https://developer.apple.com/design/human-interface-guidelines/materials)、[Get to know the new design system](https://developer.apple.com/videos/play/wwdc2025/356/)

### 2. 现代界面需要表达性，但不能堆装饰

Material 3 Expressive 强调灵活排版、对比形状、适应性组件和基于物理感的动效。V3 使用强烈但有限的标题排版、软硬形状对比和状态驱动的过渡，不使用成排同质卡片。

来源：[Material Design 3](https://m3.material.io/)

### 3. AI 不应继续等同于聊天框

Figma 的 AI 研究指出，产品需要判断聊天是不是最有效的交互，按钮命令或贴合任务的操作可能更直观。V3 把 AI 入口放在选区上，把结果表现为连接到原文的可执行修改，而不是常驻右侧聊天窗口。

来源：[Figma 2025 AI Report](https://www.figma.com/blog/figma-2025-ai-report-perspectives/)

### 4. AI 工作应发生在共享画布，而不是孤立提示框

Figma 2026 年研究显示，团队工作正在由单人提示空间转向多人共享画布。V3 同时呈现正文、知识关系、协作者和 AI 修改，让人和 AI 围绕同一个对象工作。

来源：[Figma 2026 AI Report](https://www.figma.com/blog/2026-ai-report/)

### 5. 图标必须作为系统整体设计

Figma 对新图标体系的复盘强调：图标既要单独可辨识，也要形成统一家族。V3 采用一致的 24×24 坐标、1.65–1.7px 描边、圆端点和“线性默认／色块选中”的两态规则；品牌标识则使用两条流动色带，不再使用通用文档图标充当 Logo。

来源：[Figma · How curiosity reshaped Figma’s icon suite](https://www.figma.com/blog/how-to-harness-skills-that-ai-cant-automate/)

### 6. 安静不是灰，而是让主内容获得对比

Linear 2026 UI refresh 的重点是统一页面结构、重绘图标并降低导航的视觉亮度，使主要内容更容易扫描。V3 将导航压到左侧边缘，采用低对比图标，只让当前对象和关键动作获得色彩。

来源：[Linear · UI refresh](https://linear.app/changelog/2026-03-12-ui-refresh)

## V3 设计语言

- 视觉定位：编辑式排版 × 空间画布 × 内联智能
- 品牌色：光谱紫负责“知识关系”，荧光绿只负责“当前动作”
- 字体：中文使用现代无衬线粗体建立标题张力；元信息使用等宽字体建立编辑感
- 圆角：只服务于浮动控制、选区和 AI 结果；正文不装进大圆角卡片
- 图标：统一网格、统一线宽、两态规则，避免混用 Emoji 和不同风格图标
- 动效：对象从触发源生长；模式切换改变内容重心；后台状态低频呼吸
- AI 交互：选择内容 → 出现贴身动作 → 连接到建议 → 预览修改 → 用户确认

## 与 V2 的本质区别

V2 是“文档 + AI 面板”；V3 是“内容画布 + 内联智能”。AI 不再拥有一个与正文竞争注意力的固定区域，而是围绕当前对象出现、解释并执行。
