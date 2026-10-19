import assert from "node:assert/strict";
import { headingLabel, numberHeadings } from "../src/utils/headingNumbering.ts";

const generated = numberHeadings([
  { id: "a", level: 2, text: "安装" },
  { id: "b", level: 3, text: "Windows" },
  { id: "c", level: 4, text: "环境变量" },
  { id: "d", level: 2, text: "模型" },
  { id: "e", level: 3, text: "字段标签" },
]);

assert.deepEqual(
  generated.map((heading) => heading.displayNumber),
  ["1.", "1.1", "", "2.", "2.1"]
);
assert.deepEqual(
  generated.map((heading) => heading.hierarchyDepth),
  [0, 1, 2, 0, 1]
);

const existing = numberHeadings([
  { level: 2, text: "2. 模型" },
  { level: 3, text: "2.1 字段" },
  { level: 3, text: "索引" },
  { level: 2, text: "3. 自动建表" },
  { level: 3, text: "3.1.无空格小节" },
]);

assert.deepEqual(
  existing.map((heading) => heading.displayNumber),
  ["", "", "2.2", "", ""]
);
assert.deepEqual(
  existing.map((heading) => heading.hierarchyDepth),
  [0, 1, 1, 0, 1],
  "manual decimal numbers should restore hierarchy even in older flat outlines"
);

assert.equal(numberHeadings([{ level: 1, text: "2026 年总结" }])[0].displayNumber, "1.");

const mixedSource = [
  { level: 2, text: "模型接口与API调用基础" },
  ...Array.from({ length: 7 }, (_, index) => ({ level: 3, text: `${index + 1}. 小节` })),
  { level: 2, text: "提示工程与上下文管理" },
  { level: 3, text: "提示工程的核心思路" },
];
const mixed = numberHeadings(mixedSource);
assert.deepEqual(mixed.map(h => h.hierarchyDepth), [0, 1, 1, 1, 1, 1, 1, 1, 0, 1],
  "Nested manual numbers must not become root chapters");
assert.equal(mixed[8].displayNumber, "2.", "Seven manual subsections cannot advance the next chapter to eight");
assert.deepEqual(mixed.map(headingLabel), [
  "1. 模型接口与API调用基础", ...Array.from({ length: 7 }, (_, i) => `1.${i + 1}. 小节`),
  "2. 提示工程与上下文管理", "2.1 提示工程的核心思路",
]);
assert.deepEqual(mixed.map(h => h.text), mixedSource.map(h => h.text), "Never rewrite stored titles");
assert.deepEqual(numberHeadings([
  { level: 2, text: "3. 手动起点" }, { level: 3, text: "1、子节" },
  { level: 3, text: "自动子节" }, { level: 2, text: "下一章" },
]).map(headingLabel), ["3. 手动起点", "3.1、子节", "3.2 自动子节", "4. 下一章"]);
assert.deepEqual(numberHeadings([
  { level: 2, text: "2. 根" }, { level: 2, text: "2.1 旧平级子节" },
  { level: 3, text: "2.2.带句点子节" }, { level: 2, text: "下章" },
]).map(h => [headingLabel(h), h.hierarchyDepth]), [["2. 根", 0], ["2.1 旧平级子节", 1], ["2.2.带句点子节", 1], ["3. 下章", 0]]);

console.log("heading numbering checks passed");
