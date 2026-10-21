import assert from "node:assert/strict";
import { createKnowledgeZipBlob } from "../src/utils/exportKnowledgeZip.ts";
import { parseZipMarkdown } from "../src/utils/importKnowledge.ts";
import type { FileNode } from "../src/types.ts";

const tree: FileNode[] = [{
  id: "folder",
  name: "项目",
  type: "folder",
  children: [
    { id: "a", name: "计划.md", type: "file", tags: ["项目"] },
    { id: "b", name: "复盘.md", type: "file" },
  ],
}];
const contents = { a: "# 计划\n\n- [ ] M1", b: "# 复盘\n\n完成。" };
const blob = createKnowledgeZipBlob(tree, contents);
const records = await parseZipMarkdown(await blob.arrayBuffer());
assert.equal(records.length, 2);
assert.deepEqual(records.map((record) => record.sourcePath), ["项目/计划.md", "项目/复盘.md"]);
assert.equal(records[0].content, "# 计划\n\n- [ ] M1", "A matching document title is not a chapter");
assert.equal(records[1].content, "# 复盘\n\n完成。");
const reexported = createKnowledgeZipBlob(tree, { a: records[0].content, b: records[1].content });
assert.deepEqual((await parseZipMarkdown(await reexported.arrayBuffer())).map(r => r.content), records.map(r => r.content), "Reimporting a numbered Markdown export never adds a second number");
assert.equal(contents.a, "# 计划\n\n- [ ] M1", "Export does not update the source store");
console.log(JSON.stringify({ ok: true, imported: records.length }));
