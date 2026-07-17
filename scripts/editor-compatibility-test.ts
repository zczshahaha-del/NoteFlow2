import assert from "node:assert/strict";

import {
  evaluateEditorCompatibility,
  TIPTAP_AUTO_OPEN_MAX_CHARS,
} from "../src/editor/compatibility.ts";

assert.equal(evaluateEditorCompatibility("# 普通笔记\n\n正文").useModernEditor, true);

const courseWithSources = evaluateEditorCompatibility(
  "# 课程\n\n<details><summary>官方资料</summary>\n\n- 来源\n\n</details>",
);
assert.equal(courseWithSources.useModernEditor, false);
assert.match(courseWithSources.reason || "", /完整阅读模式/);

const longMarkdown = `# 长文\n\n${"内容".repeat(TIPTAP_AUTO_OPEN_MAX_CHARS)}`;
const fallback = evaluateEditorCompatibility(longMarkdown);
assert.equal(fallback.useModernEditor, false);
assert.match(fallback.reason || "", /自动使用兼容编辑模式/);

console.log(JSON.stringify({
  ok: true,
  autoOpenMaxChars: TIPTAP_AUTO_OPEN_MAX_CHARS,
  longDocumentFallback: true,
  collapsibleSourcesFallback: true,
}));
