import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { numberedMarkdown } from "../src/utils/numberedMarkdown.ts";
import { createKnowledgeJsonBlob, createKnowledgeZipBlob } from "../src/utils/exportKnowledgeZip.ts";
import { normalizeHeadingNumbers, headingNumberEdits } from "../src/editor/normalizeHeadingNumbers.ts";
const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "Node", "Element", "HTMLElement", "Text", "DOMParser", "MutationObserver"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
}
Object.defineProperty(globalThis, "getComputedStyle", { value: dom.window.getComputedStyle.bind(dom.window), configurable: true });
Object.defineProperty(globalThis, "requestAnimationFrame", { value: dom.window.requestAnimationFrame.bind(dom.window), configurable: true });
const [{ Editor }, { createNoteFlowTiptapExtensions }] = await Promise.all([
  import("@tiptap/core"), import("../src/editor/tiptapExtensions.ts"),
]);
const source = '## 一、Docker 是什么\n\n### 一句话定义\n\n### （二）容器\n\n## 下一章\n\n### 1. 运行\n\n```md\n## 1. 代码示例不可改\n```';
const expected = source.replace('### 一句话定义', '### 1.1 一句话定义')
  .replace('## 下一章', '## 2. 下一章').replace('### 1. 运行', '### 2.1. 运行');
assert.equal(numberedMarkdown(source), expected);
assert.equal(numberedMarkdown(expected), expected, "Export/reimport cannot duplicate numbering");
assert.equal(numberedMarkdown(source.replaceAll('\n', '\r\n')), expected.replaceAll('\n', '\r\n'));
assert.equal(numberedMarkdown('## **一、Docker**\n\n### `定义`'), '## **一、Docker**\n\n### 1.1 `定义`');
assert.equal(numberedMarkdown('> ## 章节\n>\n> ### 子节\n\n- ### 列表小节\n'), '> ## 1. 章节\n>\n> ### 1.1 子节\n\n- ### 1.2 列表小节\n');
assert.equal(numberedMarkdown('章节\n===\n\n子节\n---\n'), '1. 章节\n===\n\n1.1 子节\n---\n');
const editor = new Editor({ element: document.createElement('div'), extensions: createNoteFlowTiptapExtensions(), content: source, contentType: 'markdown' });
editor.commands.selectAll(); // Let Tiptap finish its initial trailing-node transaction.
const originalDoc = editor.state.doc;
const fullCopy = () => {
  editor.commands.selectAll();
  return editor.view.serializeForClipboard(editor.state.selection.content());
};
const copy = fullCopy();
const labels = Array.from(copy.dom.querySelectorAll('h2,h3')).map(n => n.textContent);
assert.deepEqual(labels, ['一、Docker 是什么', '1.1 一句话定义', '（二）容器', '2. 下一章', '2.1. 运行']);
assert(copy.text.includes('1.1 一句话定义') && copy.text.includes('2.1. 运行'));
assert.equal(copy.dom.querySelector('code')?.textContent, '## 1. 代码示例不可改');
assert.equal(editor.state.doc, originalDoc, "Copy never changes the document or undo history");
const heading = editor.state.doc.child(0);
editor.commands.setTextSelection({ from: 1, to: 3 });
assert.equal(editor.view.serializeForClipboard(editor.state.selection.content()).text, heading.textContent.slice(0, 2), 'Partial heading copy does not inject a chapter number');
editor.commands.setContent(copy.dom.innerHTML);
const pastedCopy = fullCopy();
assert.deepEqual(Array.from(pastedCopy.dom.querySelectorAll('h2,h3')).map(n => n.textContent), labels, 'Pasted numbered headings stay idempotent');
const legacy='## **一、Docker**\n\n### 9.7 定义\n\n段落 1. 不改\n\n#### 一、深层手写标题\n\n## 二、安装\n\n### 1. 安装 Docker\n\n### 2026 年环境\n\n```md\n## 一、代码不改\n```';
editor.commands.setContent(legacy, {contentType:'markdown'});
editor.commands.setTextSelection(1);
const beforeFormatting=editor.getMarkdown();
let formattingUpdates=0;
editor.on('update',()=>formattingUpdates++);
assert.equal(normalizeHeadingNumbers(editor),true);
const clean=beforeFormatting.replace('**一、Docker**','**Docker**').replace('9.7 定义','定义').replace('二、安装','安装').replace('1. 安装 Docker','安装 Docker');
assert.equal(editor.getMarkdown(),clean,'Only ordinal prefixes in headings are changed, marks and code remain intact');
assert.deepEqual(Array.from(editor.view.dom.querySelectorAll('h2,h3')).map(n=>n.getAttribute('data-heading-number')),['1.','1.1','2.','2.1','2.2']);
assert.equal(formattingUpdates,1,'One formatting transaction uses the normal save path');
assert.equal(headingNumberEdits(editor.state.doc).length,0);
assert.equal(normalizeHeadingNumbers(editor),false,'Repeated formatting is a no-op');
assert.equal(formattingUpdates,1);
editor.commands.undo();assert.equal(editor.getMarkdown(),beforeFormatting,'One undo restores every original ordinal');
editor.commands.redo();assert.equal(editor.getMarkdown(),clean);
assert.equal(formattingUpdates,3);
editor.destroy();
const tree = [{ id: 'note', name: 'Docker', type: 'file' as const }], contents = { note: source };
assert(new TextDecoder().decode(await createKnowledgeZipBlob(tree, contents).arrayBuffer()).includes(expected));
assert.equal(JSON.parse(await createKnowledgeJsonBlob(tree, contents).text()).fileContents.note, source, 'JSON backup remains lossless');
assert.equal(contents.note, source);
console.log('heading copy/export checks passed (actual editor clipboard, partial copy, paste, Markdown ZIP, raw JSON, CRLF, nested headings, fenced code)');
