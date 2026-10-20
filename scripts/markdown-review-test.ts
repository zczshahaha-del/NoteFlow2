import assert from "node:assert/strict";
import { compareMarkdownBlocks, markdownReferenceContext } from "../src/utils/markdownReview.ts";
import { marked } from "marked";

let checks = 0;

function compare(oldContent: string, newContent: string) {
  const result = compareMarkdownBlocks(oldContent, newContent);
  assert.equal(result.map(block => block.oldContent).join(""), oldContent, "old Markdown must round-trip exactly");
  assert.equal(result.map(block => block.newContent).join(""), newContent, "new Markdown must round-trip exactly");
  assert.equal(new Set(result.map(block => block.id)).size, result.length, "review IDs must be unique");
  assert.deepEqual(compareMarkdownBlocks(oldContent, newContent), result, "matching and IDs must be deterministic");
  for (const block of result) {
    assert.ok(block.oldContent || block.newContent);
    if (block.kind === "equal") assert.equal(block.oldContent, block.newContent);
    if (block.kind === "add") assert.equal(block.oldContent, "");
    if (block.kind === "remove") assert.equal(block.newContent, "");
    if (block.kind === "replace") assert.ok(block.oldContent && block.newContent && block.oldContent !== block.newContent);
  }
  checks += 1;
  return result;
}

assert.deepEqual(compare("", ""), []);
assert.equal(compare("# 标题\n\n原文\n", "# 标题\n\n原文\n")[0].kind, "equal");
assert.equal(compare("", "新文\r\n")[0].kind, "add");
assert.equal(compare("原文\r\n", "")[0].kind, "remove");

const inserted = compare(
  "# 学习笔记\n\n开头。\n\n## 安装\n\n安装步骤。\n",
  "# 学习笔记\n\n开头。\n\n补充第一段。\n\n补充第二段。\n\n## 安装\n\n安装步骤。\n",
);
assert.deepEqual(inserted.filter(block => block.kind !== "equal").map(block => [block.kind, block.newContent]), [
  ["add", "补充第一段。\n\n补充第二段。\n\n"],
]);
assert.ok(inserted.some(block => block.kind === "equal" && block.newContent === "## 安装\n\n"));

const expanded = compare(
  "# API\n\n简短介绍。\n\n## 准备工作\n\n获取密钥。\n",
  "# API\n\n详细介绍请求。\n\n补充响应过程。\n\n补充例子。\n\n## 准备工作\n\n获取密钥。\n",
);
assert.deepEqual(expanded.filter(block => block.kind !== "equal").map(block => [block.kind, block.oldContent, block.newContent]), [
  ["replace", "简短介绍。\n\n", "详细介绍请求。\n\n补充响应过程。\n\n补充例子。\n\n"],
]);
assert.ok(expanded.some(block => block.kind === "equal" && block.newContent === "## 准备工作\n\n"), "the later corresponding heading must not become an addition");

const removedSection = compare(
  "# 开始\n\n保留开头。\n\n## 删除本节\n\n重复文字。\n\n## 保留本节\n\n重复文字。\n",
  "# 开始\n\n保留开头。\n\n## 保留本节\n\n重复文字。\n",
);
assert.deepEqual(removedSection.filter(block => block.kind !== "equal").map(block => [block.kind, block.oldContent]), [
  ["remove", "## 删除本节\n\n重复文字。\n\n"],
]);

const duplicateHeadings = compare(
  "## 相同标题\n\n第一节内容。\n\n## 相同标题\n\n第二节内容。\n\n## 结束\n\n完成。\n",
  "## 相同标题\n\n第二节内容。\n\n## 结束\n\n完成。\n",
);
assert.deepEqual(duplicateHeadings.filter(block => block.kind !== "equal").map(block => [block.kind, block.oldContent]), [
  ["remove", "## 相同标题\n\n第一节内容。\n\n"],
], "equal section content disambiguates repeated heading names");

const adjacentSectionChanges = compare(
  "# 标题\n\n旧开场。\n\n## 删除小节\n\n仅旧稿有这段。\n\n## 保留小节\n\n完全相同。\n\n## 改写小节\n\n旧句。\n\n## 结尾\n\n共同结尾。",
  "# 标题\n\n新开场。\n\n## 保留小节\n\n完全相同。\n\n## 改写小节\n\n新句。\n\n## 新增小节\n\n只有新稿有这段。\n\n## 结尾\n\n共同结尾。",
);
assert.ok(adjacentSectionChanges.some(block => block.kind === "add" && block.newContent.includes("## 新增小节") && !block.newContent.includes("新句。")), "a new section is distinct from the preceding rewritten paragraph");
assert.ok(adjacentSectionChanges.some(block => block.kind === "remove" && block.oldContent.includes("## 删除小节") && !block.oldContent.includes("旧开场。")), "a deleted section is distinct from the preceding rewritten paragraph");
assert.equal(adjacentSectionChanges.filter(block => block.kind === "replace").length, 2);

const repeatedParagraph = compare(
  "# 一\n\n相同段落。\n\n相同段落。\n\n结束。\n",
  "# 一\n\n相同段落。\n\n结束。\n",
);
assert.deepEqual(repeatedParagraph.filter(block => block.kind !== "equal").map(block => [block.kind, block.oldContent]), [["remove", "相同段落。\n\n"]]);

const code = compare(
  "# 示例\n\n```js\nconst a = 1;\n\nconsole.log(a);\n```\n\n保留。\n",
  "# 示例\n\n```js\nconst a = 2;\n\nconsole.log(a);\n```\n\n保留。\n",
);
assert.deepEqual(code.filter(block => block.kind !== "equal").map(block => [block.kind, block.oldContent, block.newContent]), [
  ["replace", "```js\nconst a = 1;\n\nconsole.log(a);\n```\n\n", "```js\nconst a = 2;\n\nconsole.log(a);\n```\n\n"],
], "blank lines inside fences cannot split a code block");

const nested = "- 外层\n\n  外层第二段。\n\n  - 内层\n\n    内层第二段。\n\n- 下一项\n\n";
const table = "| 列一 | 列二 |\n| --- | --- |\n| 内容 | 内容 |\n\n";
const quote = "> 第一段。\n>\n> 第二段。\n\n";
const structured = compare(`# 内容\n\n${nested}${table}${quote}结尾。\n`, `# 内容\n\n新增。\n\n${nested}${table}${quote}结尾。\n`);
for (const source of [nested, table, quote]) {
  assert.ok(structured.some(block => block.kind === "equal" && block.newContent === source), "lists, tables, and blockquotes keep their top-level boundaries");
}

const crlfOld = "\r\n# 旧标题\r\n\r\n段落。\r\n\r\n```txt\r\n一\r\n\r\n二\r\n```\r\n\r\n结束。\r\n";
const crlfNew = "\r\n# 旧标题\r\n\r\n新段落。\r\n\r\n```txt\r\n一\r\n\r\n二\r\n```\r\n\r\n结束。\r\n";
assert.equal(compare(crlfOld, crlfNew).filter(block => block.kind === "replace").length, 1);
compare("# 标题\r\n\r\n第一段。\r第二行。\r\n\r\n结束。\n", "# 标题\r\n\r\n第一段改变。\r第二行。\r\n\r\n结束。\n");
compare(crlfOld, crlfOld.replace(/\r\n/g, "\n"));
compare("\n\n", "\r\n\r\n");

const definitions = compare(
  "# 链接\n\n[示例][ref]\n\n[ref]: https://example.com/first\n[ref]: https://example.com/ignored\n\n结束。\n",
  "# 链接\n\n[示例][ref]\n\n[ref]: https://example.com/second\n[ref]: https://example.com/ignored\n\n结束。\n",
);
assert.ok(definitions.some(block => block.kind === "replace" && block.oldContent.includes("https://example.com/first") && block.newContent.includes("https://example.com/second")));
assert.ok(definitions.map(block => block.oldContent).join("").includes("[ref]: https://example.com/ignored"), "duplicate reference definitions omitted by marked must survive");
compare("[a]: /first\n[a]: /second\n\n[a]", "[a]: /first\n[a]: /third\n\n[a]");
compare("[a]: /first\r\n[a]: /second\r\n\r\n[a]\r\n", "[a]: /first\r\n[a]: /third\r\n\r\n[a]\r\n");

const sections = Array.from({ length: 1_400 }, (_, index) => `段落 ${index}。\n\n`).join("");
const budgeted = compare(sections, `新增开头。\n\n${sections}`);
assert.equal(budgeted.filter(block => block.kind === "equal").length, 1_400);
assert.deepEqual(budgeted.filter(block => block.kind !== "equal").map(block => [block.kind, block.newContent]), [["add", "新增开头。\n\n"]]);

const hugeOld = `# 标题\n\n${"原文。".repeat(140_000)}`;
const hugeNew = `# 标题\n\n${"新文。".repeat(140_000)}`;
assert.equal(compare(hugeOld, hugeNew).length, 1, "oversized input explicitly degrades to one exact replacement");
const tooManyBlocks = Array.from({ length: 4_001 }, (_, index) => `内容 ${index}。\n\n`).join("");
assert.equal(compare(tooManyBlocks, `新增。\n\n${tooManyBlocks}`).length, 1, "excessive block count explicitly degrades instead of allocating an unbounded matching table");

const referenceSource = "[正文链接][real]\n\n```md\n[fake]: /must-not-be-a-link\n```\n\n> [quoted]: /quoted\n\n- [listed]: /listed\n\n[real]: https://example.com \"标题\"\n[real]: /ignored\n";
const referenceContext = markdownReferenceContext(referenceSource);
assert.ok(referenceContext.includes("[real]: https://example.com"));
assert.ok(referenceContext.includes("[quoted]: /quoted"));
assert.ok(referenceContext.includes("[listed]: /listed"));
assert.ok(!referenceContext.includes("must-not-be-a-link"));
assert.ok(!referenceContext.includes("/ignored"), "duplicate definitions retain Markdown's original first-definition precedence");
assert.match(marked.parse(`${referenceContext}\n\n[正文链接][real] [引用链接][quoted] [列表链接][listed]`, { async: false }), /href="https:\/\/example.com" title="标题"/);
assert.match(marked.parse(`${referenceContext}\n\n[正文链接][real] [引用链接][quoted] [列表链接][listed]`, { async: false }), /href="\/quoted"/);
assert.match(marked.parse(`${referenceContext}\n\n[正文链接][real] [引用链接][quoted] [列表链接][listed]`, { async: false }), /href="\/listed"/);
assert.equal(markdownReferenceContext(hugeOld), "");

// Cross-product fixtures catch source-boundary losses without mirroring the
// matching algorithm, including whitespace-only, HTML, tabs, and Setext titles.
const sources = ["", "\n", "\r\n", "a\n", "a\r\nb\r", "标题\n===\n\n内容。\n", "\t代码\n\n结尾。", "<div>\n\n内容\n\n</div>\n", nested, table, quote];
for (const oldContent of sources) for (const newContent of sources) compare(oldContent, newContent);

console.log(JSON.stringify({ ok: true, checks, longDocumentBlocks: budgeted.length }));
