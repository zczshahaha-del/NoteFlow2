import assert from "node:assert/strict";
import { numberHeadings } from "../src/utils/headingNumbering.ts";

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

console.log("heading numbering checks passed");
