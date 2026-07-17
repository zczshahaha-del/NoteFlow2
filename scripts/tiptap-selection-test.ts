import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { findTiptapTextRange } from "../src/utils/tiptapSelection.ts";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
  pretendToBeVisual: true,
});

const browserGlobals = {
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  Node: dom.window.Node,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  Text: dom.window.Text,
  DOMParser: dom.window.DOMParser,
  MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
};

Object.entries(browserGlobals).forEach(([key, value]) => {
  Object.defineProperty(globalThis, key, { configurable: true, value });
});

if (!("ResizeObserver" in globalThis)) {
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
}

const [{ Editor }, { createNoteFlowTiptapExtensions }] = await Promise.all([
  import("@tiptap/core"),
  import("../src/editor/tiptapExtensions.ts"),
]);

const element = document.createElement("div");
document.body.appendChild(element);
const editor = new Editor({
  element,
  extensions: createNoteFlowTiptapExtensions(),
  content: "第一段 **跨格式中文** 与 [链接文字](https://example.com)。\n\n第二段包含 emoji 🎯 和结尾。",
  contentType: "markdown",
});

const cases = [
  "跨格式中文 与 链接文字",
  "第二段包含 emoji 🎯 和结尾。",
  "emoji 🎯",
  "链接文字。 第二段包含 emoji",
];

const results = cases.map((target) => {
  const range = findTiptapTextRange(editor.state.doc, target);
  assert.ok(range, `missing range for ${target}`);
  const selected = editor.state.doc.textBetween(range.from, range.to, " ");
  assert.equal(selected.replace(/\s+/g, " ").trim(), target);
  return { target, range };
});

assert.equal(findTiptapTextRange(editor.state.doc, "不存在的内容"), null);
editor.destroy();
element.remove();

console.log(JSON.stringify({ ok: true, caseCount: results.length + 1, results }));
