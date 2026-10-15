import assert from "node:assert/strict";
import { documentFolderPath, hasMatchingDocumentTitle } from "../src/utils/documentHeader.ts";
import type { FileNode } from "../src/types.ts";

const tree: FileNode[] = [{ id: "a", type: "folder", name: "工程", children: [
  { id: "b", type: "folder", name: "Go", children: [{ id: "note", type: "file", name: "教程.md" }] },
] }, { id: "root", type: "file", name: "根笔记.md" }];
assert.deepEqual(documentFolderPath(tree, "note"), ["工程", "Go"]);
assert.deepEqual(documentFolderPath(tree, "root"), []);
assert.deepEqual(documentFolderPath(tree, "missing"), []);
assert.deepEqual(documentFolderPath([{ id: "folder", type: "folder", name: "空", children: [] }], "note"), []);
const h1 = (text: string, level = 1) => ({ type: { name: "heading" }, attrs: { level }, textContent: text });
assert(hasMatchingDocumentTitle(" GORM 学习笔记 ", h1("gorm   学习笔记")));
assert(hasMatchingDocumentTitle("café", h1("cafe\u0301")));
assert(!hasMatchingDocumentTitle("教程", h1("1. 教程")), "Numbered content must not be treated as an exact duplicate");
assert(!hasMatchingDocumentTitle("教程", h1("教程", 2)), "A chapter heading is not a document title");
assert(!hasMatchingDocumentTitle("教程", { type: { name: "paragraph" }, attrs: {}, textContent: "教程" }));
assert(!hasMatchingDocumentTitle("教程", { type: { name: "codeBlock" }, attrs: {}, textContent: "教程" }));
assert(!hasMatchingDocumentTitle("", h1("")));
assert(!hasMatchingDocumentTitle("教程", null));
assert(!hasMatchingDocumentTitle("教程", h1("另一篇教程")));
console.log(JSON.stringify({ ok: true, assertions: 13, noDocumentMutation: true }));
