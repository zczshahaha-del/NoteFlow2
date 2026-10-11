// Real editor documents; no user notes, persistence or network.
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
for (const [key, value] of Object.entries({
  window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
  Node: dom.window.Node, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, Text: dom.window.Text,
  DOMParser: dom.window.DOMParser, MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
})) Object.defineProperty(globalThis, key, { configurable: true, value });
const [{ Editor }, { createNoteFlowTiptapExtensions }, { getEditorMarkdown, getDocumentHeadings, getDocumentNumberedHeadings }, { closeHistory }, { setHeadingNumbering }] = await Promise.all([
  import("@tiptap/core"), import("../src/editor/tiptapExtensions.ts"),
  import("../src/editor/documentCache.ts"), import("@tiptap/pm/history"), import("../src/editor/headingDecorations.ts"),
]);
function createEditor(content: string) {
  const element = document.createElement("div");document.body.append(element);
  const editor = new Editor({ element, extensions: createNoteFlowTiptapExtensions(), content, contentType: "markdown" });
  editor.commands.setTextSelection(1); // Complete the initial trailing-node transaction.
  const original = editor.getMarkdown.bind(editor);
  let calls = 0, fail = false;
  editor.getMarkdown = () => { calls++;if(fail) throw new Error("Synthetic serialization failure");return original(); };
  return { editor, calls: () => calls, original, fail: (value: boolean) => { fail=value; }, destroy: () => { editor.destroy();element.remove(); } };
}
const sample = "## 标题\n\nhello\n\n```go\nvar users []User\n```";
const first = createEditor(sample);
assert.equal(getEditorMarkdown(first.editor), first.original());
assert.equal(getEditorMarkdown(first.editor), first.original());
assert.equal(first.calls(),1,"Repeated reads of one document must serialize once");
const doc = first.editor.state.doc;
const headings = getDocumentHeadings(doc), numbers = getDocumentNumberedHeadings(doc);
assert.strictEqual(getDocumentHeadings(doc),headings);assert.strictEqual(getDocumentNumberedHeadings(doc),numbers);
assert.equal(first.editor.view.dom.querySelector("h2")?.dataset.headingNumber,"1.");
first.editor.commands.setTextSelection(2);
assert.strictEqual(first.editor.state.doc,doc);
getEditorMarkdown(first.editor);assert.equal(first.calls(),1,"Selection cannot invalidate content");
assert.strictEqual(getDocumentHeadings(first.editor.state.doc),headings);
let settingUpdates = 0;const onUpdate = () => { settingUpdates++; };first.editor.on("update",onUpdate);
setHeadingNumbering(first.editor,false);setHeadingNumbering(first.editor,false);
assert.equal(first.editor.view.dom.querySelector("h2")?.dataset.headingNumber,undefined);
assert.equal(first.editor.view.dom.classList.contains("heading-numbering-enabled"),false);
setHeadingNumbering(first.editor,true);
assert.equal(first.editor.view.dom.querySelector("h2")?.dataset.headingNumber,"1.");
assert.strictEqual(first.editor.state.doc,doc);assert.equal(settingUpdates,0,"Display settings cannot save a note or enter edit history");
first.editor.off("update",onUpdate);getEditorMarkdown(first.editor);assert.equal(first.calls(),1);

first.editor.chain().setTextSelection(1).insertContent("新").run();
assert.notStrictEqual(first.editor.state.doc,doc);
assert.equal(getEditorMarkdown(first.editor),first.original());
getEditorMarkdown(first.editor);assert.equal(first.calls(),2,"Text edits invalidate once");
first.editor.view.dispatch(closeHistory(first.editor.state.tr));
first.editor.chain().setTextSelection({from:1,to:2}).toggleBold().run();
const marked = getEditorMarkdown(first.editor);
assert.match(marked,/\*\*新\*\*/);assert.equal(first.calls(),3,"Mark-only changes invalidate");
first.editor.commands.undo();
assert.equal(getEditorMarkdown(first.editor),first.original());
assert.doesNotMatch(getEditorMarkdown(first.editor),/\*\*新\*\*/);assert.equal(first.calls(),4);
first.editor.commands.redo();
assert.equal(getEditorMarkdown(first.editor),marked);assert.equal(first.calls(),5);

first.editor.commands.setContent("## 外部\n\n替换",{contentType:"markdown",emitUpdate:false});
assert.match(getEditorMarkdown(first.editor),/外部[\s\S]*替换/);assert.equal(first.calls(),6,"Silent external replacement must invalidate");
assert.equal(getDocumentHeadings(first.editor.state.doc)[0]?.text,"外部");
assert.equal(first.editor.view.dom.querySelector("h2")?.dataset.headingNumber,"1.");
first.editor.commands.setContent(sample,{contentType:"markdown",emitUpdate:false});
assert.match(getEditorMarkdown(first.editor),/```go\nvar users \[\]User\n```/);
assert.doesNotMatch(getEditorMarkdown(first.editor),/token-|<span/);assert.equal(first.calls(),7,"Saved output remains raw source");

const second = createEditor(sample);
assert.equal(getEditorMarkdown(second.editor),second.original());assert.equal(second.calls(),1,"New editors must not reuse another note's output");
const broken = createEditor("失败后重试");broken.fail(true);
assert.throws(() => getEditorMarkdown(broken.editor),/Synthetic/);
broken.fail(false);assert.equal(getEditorMarkdown(broken.editor),broken.original());
assert.equal(broken.calls(),2,"Failures must not poison the cache");
const hierarchy = createEditor("## 3. 手写章节\n\n### 子章节\n\n## 自动章节\n\n结尾");
assert.equal(hierarchy.editor.view.dom.querySelector("h2")?.dataset.headingNumber,undefined);
assert.equal(hierarchy.editor.view.dom.querySelector("h3")?.dataset.headingNumber,"3.1");
assert.equal(hierarchy.editor.view.dom.querySelectorAll("h2")[1]?.dataset.headingNumber,"4.");
const beforeHeading = getEditorMarkdown(hierarchy.editor);
setHeadingNumbering(hierarchy.editor,false);setHeadingNumbering(hierarchy.editor,true);
assert.equal(getEditorMarkdown(hierarchy.editor),beforeHeading);
assert.doesNotMatch(hierarchy.editor.getHTML(),/data-heading-number/);
assert.equal(getDocumentNumberedHeadings(hierarchy.editor.state.doc)[1]?.displayNumber,"3.1");
first.destroy();second.destroy();broken.destroy();hierarchy.destroy();dom.window.close();
console.log(JSON.stringify({ok:true,cases:12,selection:true,text:true,marks:true,undoRedo:true,externalReplacement:true,editorIsolation:true,rawSource:true,errorRecovery:true,headingCaches:true,displayOnly:true,manualHierarchy:true}));
