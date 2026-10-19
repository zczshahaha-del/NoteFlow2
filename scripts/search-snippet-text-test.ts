import assert from "node:assert/strict";
import { searchSnippetText } from "../src/utils/searchSnippetText.ts";

const cases = [
  ["", ""],
  ["普通文字与 API_KEY、snake_case、a * b、a > b、C++", "普通文字与 API_KEY、snake_case、a * b、a > b、C++"],
  ["Python 幂运算：x **2，与 a_b_c 标识符", "Python 幂运算：x **2，与 a_b_c 标识符"],
  ["**Redis** 与 *Git*、~~旧写法~~", "Redis 与 Git、旧写法"],
  ["... - **私有模块管理**：通过 `GOPRIVATE` 配合 `.netrc`。", "... - 私有模块管理：通过 GOPRIVATE 配合 .netrc。"],
  ['import os api_key = os.getenv("OPENAI_API_KEY") ``` > **常见错误**：不要公开。', 'import os api_key = os.getenv("OPENAI_API_KEY") 常见错误：不要公开。'],
  ["## Git 学习\n\n> 配置 **身份**\n\n- `git init`\n- [文档](https://example.invalid)", "Git 学习 配置 身份 git init 文档"],
  ["[**Git 文档**](https://example.invalid/git \"说明\")", "Git 文档"],
  ["![Git 流程图](https://example.invalid/image)", "Git 流程图"],
  ["请查看 [Git 文档](https://example.invalid/guide...", "请查看 Git 文档..."],
  ["...源码：[https://github.com/redis/src/object.c]...", "...源码：https://github.com/redis/src/object.c..."],
  ["...ate/oss_and_stack/management/persistence/) - Redis 底层编码实现", "… - Redis 底层编码实现"],
  ["**尚未闭合的重点...", "尚未闭合的重点..."],
  ["`ValueError...", "ValueError..."],
  ["`API_KEY * 2 <T> &amp;`", "API_KEY * 2 <T> &amp;"],
  ['```python\nprint("**raw**", "API_KEY")\n```', 'print("**raw**", "API_KEY")'],
  ["\\*保留字面星号\\*", "*保留字面星号*"],
  ["A &amp; B &lt; C &#x4e2d;&#25991; &nbsp; D", "A & B < C 中文 D"],
  ["| 命令 | 用法 |\n| --- | --- |\n| `git init` | **初始化** |", "命令 · 用法 git init · 初始化"],
  ['<p>Git <b>文档</b></p>\n<img src="https://example.invalid/x" onerror="alert(1)">', "Git 文档"],
  ["<script>window.bad = true</script>\n\n正常文字", "正常文字"],
];
for (const [input, expected] of cases) assert.equal(searchSnippetText(input), expected, input);
console.log(`search snippet text: ${cases.length} plain-text, Markdown, clipped fragment, code and HTML cases passed (no DOM or network)`);
