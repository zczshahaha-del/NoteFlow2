import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { editorFixtures } from "./editor-fixtures.mjs";

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

const results = editorFixtures.map((fixture) => {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: createNoteFlowTiptapExtensions(),
    content: fixture.markdown,
    contentType: "markdown",
  });
  const serialized = editor.getMarkdown().trim();
  fixture.required.forEach((pattern) => {
    assert.match(serialized, pattern, `${fixture.name} lost ${pattern}\n${serialized}`);
  });
  editor.destroy();
  element.remove();

  const secondElement = document.createElement("div");
  document.body.appendChild(secondElement);
  const secondEditor = new Editor({
    element: secondElement,
    extensions: createNoteFlowTiptapExtensions(),
    content: serialized,
    contentType: "markdown",
  });
  const secondSerialized = secondEditor.getMarkdown().trim();
  assert.equal(secondSerialized, serialized, `${fixture.name} is not stable after a second Tiptap pass`);
  secondEditor.destroy();
  secondElement.remove();

  return { name: fixture.name, ok: true, outputLength: serialized.length };
});

console.log(JSON.stringify({
  ok: true,
  codec: "tiptap-markdown",
  fixtureCount: results.length,
  results,
}));
