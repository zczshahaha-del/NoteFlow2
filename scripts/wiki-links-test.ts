import assert from "node:assert/strict";
import { extractWikiLinks, findWikiBacklinks, flattenWikiNotes } from "../src/utils/wikiLinks.ts";
import type { FileNode } from "../src/types.ts";

const markdown = [
  "连接 [[产品路线]]、[[编辑器#迁移门禁|编辑器门禁]]。",
  "`[[行内代码不算]]`",
  "```md\n[[代码块不算]]\n```",
].join("\n\n");
const links = extractWikiLinks(markdown);
assert.deepEqual(links.map((link) => link.title), ["产品路线", "编辑器"]);
assert.equal(links[1].heading, "迁移门禁");
assert.equal(links[1].label, "编辑器门禁");

const tree: FileNode[] = [
  { id: "current", name: "产品路线.md", type: "file" },
  { id: "backlink", name: "周会.md", type: "file", content: "参见 [[产品路线]]" },
  { id: "other", name: "杂记.md", type: "file", content: "[[不存在]]" },
];
const flat = flattenWikiNotes(tree, {});
assert.deepEqual(findWikiBacklinks(flat, "current", "产品路线").map((note) => note.node.id), ["backlink"]);

console.log(JSON.stringify({ ok: true, parsedLinks: links.length, backlinkCount: 1 }));
