import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "Node", "Element", "HTMLElement", "Text", "DOMParser", "MutationObserver", "KeyboardEvent"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
}
Object.defineProperty(globalThis, "getComputedStyle", { value: dom.window.getComputedStyle.bind(dom.window), configurable: true });
Object.defineProperty(globalThis, "requestAnimationFrame", { value: dom.window.requestAnimationFrame.bind(dom.window), configurable: true });
const [{ Editor }, { createNoteFlowTiptapExtensions }, { getDocumentOutlineHeadings }, { closeHistory }] = await Promise.all([
  import("@tiptap/core"), import("../src/editor/tiptapExtensions.ts"), import("../src/editor/documentCache.ts"), import("@tiptap/pm/history"),
]);
const source = '# 文档名\n\n## **4. CRUD**\n\n### 4.1 增（Create）\n\n#### 一、深入\n\n##### 1.5版本\n\n###### 2026 年计划\n\n## 没有编号\n\n结束。';
let updates = 0;
const create = (content: string) => new Editor({element: document.createElement('div'), extensions:createNoteFlowTiptapExtensions('文档名'), content, contentType:'markdown', onUpdate:()=>updates++});
const editor = create(source);
assert.equal(updates,0);
assert.equal(editor.getMarkdown(),source);
assert.deepEqual([...editor.view.dom.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(n=>n.textContent), ['文档名','4. CRUD','4.1 增（Create）','一、深入','1.5版本','2026 年计划','没有编号']);
assert(!editor.getHTML().includes('sourcePrefix'));
assert.equal(editor.view.dom.querySelectorAll('[data-heading-number]').length,0);
assert.equal(getDocumentOutlineHeadings(editor.state.doc,'文档名')[0].isDocumentTitle,true);
editor.view.dispatch(closeHistory(editor.state.tr));
const child = getDocumentOutlineHeadings(editor.state.doc,'文档名')[2];
editor.commands.deleteRange({from:child.position+3,to:child.position+4});
assert.equal(editor.view.dom.querySelector('h3')?.textContent,'4. 增（Create）','Each numeric character is ordinary editable text');
editor.commands.undo();assert.equal(editor.getMarkdown(),source);
editor.commands.redo();assert(editor.getMarkdown().includes('### 4. 增（Create）'));
editor.view.dispatch(closeHistory(editor.state.tr));
editor.commands.deleteRange({from:child.position+1,to:child.position+4});
assert.equal(editor.view.dom.querySelector('h3')?.textContent,'增（Create）','Deleted numbering is never regenerated');
const saved=editor.getMarkdown(), reopened=create(saved);
assert.equal(reopened.view.dom.querySelector('h3')?.textContent,'增（Create）');
assert.equal(reopened.getMarkdown(),saved);
editor.commands.setContent(source,{contentType:'markdown',emitUpdate:false});
editor.commands.insertContentAt(editor.state.doc.content.size,'<h2><strong>9. 手动粘贴</strong></h2>');
assert.equal(editor.view.dom.querySelectorAll('h2')[2]?.textContent,'9. 手动粘贴');
editor.commands.setTextSelection(child.position+4);
editor.commands.splitBlock();
assert.equal(editor.view.dom.querySelectorAll('h3')[0]?.textContent,'4.1','Splitting uses ordinary text behavior, without cloned numbering metadata');
editor.destroy();reopened.destroy();dom.window.close();
console.log('editable headings passed: all levels, literal numbers, character deletion, no regeneration, source/marks, undo/redo, split, paste and reopen');
