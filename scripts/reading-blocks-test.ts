import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { readingCalloutKind } from "../src/utils/readingCallout.ts";
const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "Node", "NodeFilter", "Element", "HTMLElement", "Text", "DOMParser", "MutationObserver"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
}
Object.defineProperty(globalThis, "getComputedStyle", { value: dom.window.getComputedStyle.bind(dom.window), configurable: true });
const [{ Editor }, { createNoteFlowTiptapExtensions }, { renderChatMarkdown }] = await Promise.all([
  import("@tiptap/core"), import("../src/editor/tiptapExtensions.ts"), import("../src/utils/chatMarkdown.ts"),
]);
for (const [cue, kind] of [["💡 提示", "note"], ["⚠️ 小心", "warning"], ["注意：零值", "warning"], ["✅ 成功", "success"], ["人话：说明", "note"], ["普通引用", null], ["正文中提到💡", null]] as const) assert.equal(readingCalloutKind(cue), kind);
const source = "## 1. 标题\n\n> 普通引用\n\n> 💡 **原文字保留**\n\n> ⚠️ 注意零值\n\n> ✅ 成功\n\n```md\n> 💡 代码不可变成提示块\n```\n\n结尾。";
let updates = 0;
const editor = new Editor({ element: document.createElement("div"), extensions: createNoteFlowTiptapExtensions(), content: source, contentType: "markdown", onUpdate: () => updates++ });
const doc = editor.state.doc;
assert.equal(updates, 0);
assert.equal(editor.getMarkdown(), source);
const quotes = [...editor.view.dom.querySelectorAll("blockquote")];
assert.deepEqual(quotes.map(e => e.getAttribute("data-reading-callout")), [null, "note", "warning", "success"]);
assert(!JSON.stringify(doc.toJSON()).includes("reading-callout"));
for (let i = 1; i <= 5; i++) editor.commands.setTextSelection(i);
assert.strictEqual(editor.state.doc, doc);
assert.equal(updates, 0, "Presentation must not emit save transactions");
const container = document.createElement("div");
container.innerHTML = renderChatMarkdown(source);
assert.deepEqual([...container.querySelectorAll("blockquote")].map(e => e.getAttribute("data-reading-callout")), quotes.map(e => e.getAttribute("data-reading-callout")), "Draft renderer and editor classify the same source identically");
let quotePosition = 0;
doc.descendants((node, position) => { if (node.type.name === "blockquote" && node.textContent.startsWith("💡")) quotePosition = position; });
editor.commands.deleteRange({ from: quotePosition + 2, to: quotePosition + 5 });
assert.equal(editor.view.dom.querySelectorAll("blockquote")[1].hasAttribute("data-reading-callout"), false, "Removing the cue immediately restores normal quote styling");
editor.commands.undo();
assert.equal(editor.getMarkdown(), source);
assert.equal(editor.view.dom.querySelectorAll("blockquote")[1].getAttribute("data-reading-callout"), "note");
editor.commands.selectAll();
const copied = editor.view.serializeForClipboard(editor.state.selection.content());
assert(copied.text.includes("💡 原文字保留"));
assert(!copied.text.includes("reading-callout"));
editor.destroy();dom.window.close();
console.log("reading blocks passed: explicit cues only, same renderer/editor, exact Markdown/JSON, no load/selection writes, live removal, undo, copy, code preserved");
