import assert from "node:assert/strict";
import { diffMarkdownLines } from "../src/utils/markdownDiff.ts";

const result = diffMarkdownLines(
  "# 标题\n\n旧内容\n保持不变",
  "# 标题\n\n新内容\n保持不变\n补充一行"
);

assert.equal(result.added, 2);
assert.equal(result.removed, 1);
assert.equal(result.unchanged, 3);
assert.equal(result.simplified, false);
assert.deepEqual(
  result.rows.filter((row) => row.kind !== "equal").map((row) => [row.kind, row.text]),
  [["add", "新内容"], ["remove", "旧内容"], ["add", "补充一行"]]
);

const identical = diffMarkdownLines("同一行", "同一行");
assert.deepEqual({ added: identical.added, removed: identical.removed, unchanged: identical.unchanged }, { added: 0, removed: 0, unchanged: 1 });

console.log(JSON.stringify({ ok: true, rows: result.rows.length, added: result.added, removed: result.removed }));
