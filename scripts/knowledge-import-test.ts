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
assert.equal(records[0].content, contents.a);
assert.equal(records[1].content, contents.b);
console.log(JSON.stringify({ ok: true, imported: records.length }));
