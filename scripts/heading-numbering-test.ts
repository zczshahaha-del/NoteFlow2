import assert from "node:assert/strict";
import { headingLabel, numberHeadings } from "../src/utils/headingNumbering.ts";

const input = [
  { level: 2, text: "十二、随机章节甲" },
  { level: 3, text: "9.7 子节甲" },
  { level: 4, text: "（二）深层内容" },
  { level: 3, text: "子节乙" },
  { level: 2, text: "第三章 随机章节乙" },
  { level: 3, text: "1. 准备" },
  { level: 3, text: "1. 运行" },
];
assert.deepEqual(numberHeadings(input).map(headingLabel), [
  "1. 随机章节甲", "1.1 子节甲", "1.1.1 深层内容", "1.2 子节乙", "2. 随机章节乙", "2.1 准备", "2.2 运行",
]);
assert.equal(input[0].text, "十二、随机章节甲", "Input source is never mutated");
assert.deepEqual(numberHeadings(input).map(h => h.hierarchyDepth), [0, 1, 2, 1, 0, 1, 1]);
assert.deepEqual(numberHeadings([
  { level: 2, text: "2. 根" }, { level: 2, text: "2.1 仍然是同级标题" },
  { level: 3, text: "2.2.实际子节" }, { level: 2, text: "下章" },
]).map(headingLabel), ["1. 根", "2. 仍然是同级标题", "2.1 实际子节", "3. 下章"], "Textual numbers cannot invent a hierarchy");
assert.deepEqual(numberHeadings([...input.slice(4), ...input.slice(0, 4)]).map(headingLabel), [
  "1. 随机章节乙", "1.1 准备", "1.2 运行", "2. 随机章节甲", "2.1 子节甲", "2.1.1 深层内容", "2.2 子节乙",
], "Moving a chapter recalculates from structure, not the old ordinal");
for (const title of ["2026 年总结", "3D 图形", "1.5版本变化", "一体化设计", "二叉树", "（Docker）基础", "1."]) {
  const [heading] = numberHeadings([{ level: 2, text: title }]);
  assert.equal(heading.hasManualNumber, false, title);
  assert.equal(headingLabel(heading), "1. " + title);
}
assert.deepEqual(numberHeadings(input.map(h => ({ ...h, level: h.level - 1 }))).map(headingLabel), numberHeadings(input).map(headingLabel));
assert.deepEqual(numberHeadings([]), []);
for (let seed = 0; seed < 40; seed++) {
  const plain = Array.from({length: 25}, (_, i) => ({level: 1 + ((seed * 7 + i * 5) % 6), text: `主题${seed}·条目${i}🎯`}));
  const prefixes = ["一、", "99. ", "9.8.7 ", "（三）", "第十二章 "];
  const legacy = plain.map((heading, i) => ({...heading, text: prefixes[(seed+i)%prefixes.length] + heading.text}));
  assert.deepEqual(numberHeadings(legacy).map(headingLabel), numberHeadings(plain).map(headingLabel), "Ordinal text never determines structure, regardless of note/title names");
}
console.log("heading numbering passed: structure/order, Chinese/Arabic prefixes, reorder, protected names, all heading depths");
