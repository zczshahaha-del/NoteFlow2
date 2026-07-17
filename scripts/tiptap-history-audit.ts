import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { Marked } from "marked";

interface CorpusRecord {
  kind: "note" | "version";
  id: string;
  noteId: string;
  title: string;
  user: string;
  content: string;
}

interface Corpus {
  records: CorpusRecord[];
}

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
const { evaluateEditorCompatibility } = await import("../src/editor/compatibility.ts");

const marked = new Marked({ breaks: true, gfm: true });
const trackedTags = [
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "strong", "em", "del", "a", "img",
  "ul", "ol", "li", "input", "blockquote", "table", "tr", "th", "td", "pre", "code",
  "u", "mark", "kbd", "span",
];

function semanticSignature(markdown: string) {
  const template = document.createElement("template");
  template.innerHTML = marked.parse(markdown) as string;
  const root = template.content;
  const attributes = [
    ...Array.from(root.querySelectorAll("a")).map((node) => `a:${node.getAttribute("href") || ""}`),
    ...Array.from(root.querySelectorAll("img")).map((node) =>
      `img:${node.getAttribute("src") || ""}|${node.getAttribute("alt") || ""}|${node.getAttribute("title") || ""}`
    ),
    ...Array.from(root.querySelectorAll("input[type=checkbox]")).map((node) =>
      `task:${node.hasAttribute("checked") ? "checked" : "open"}`
    ),
    ...Array.from(root.querySelectorAll("span[style]")).map((node) => `span:${node.getAttribute("style") || ""}`),
  ];
  return {
    text: (root.textContent || "").replace(/\s+/g, " ").trim(),
    tags: Object.fromEntries(trackedTags.map((tag) => [tag, root.querySelectorAll(tag).length])),
    attributes,
  };
}

function sameRecord(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function firstDifference(left: string, right: string) {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  if (index === limit && left.length === right.length) return null;
  return { index };
}

const input = readFileSync(0, "utf8").trim();
if (!input) throw new Error("history audit requires a JSON corpus on stdin");
const corpus = JSON.parse(input) as Corpus;
if (!Array.isArray(corpus.records)) throw new Error("invalid corpus: records must be an array");

const results = corpus.records.map((record) => {
  const firstElement = document.createElement("div");
  document.body.appendChild(firstElement);
  const firstEditor = new Editor({
    element: firstElement,
    extensions: createNoteFlowTiptapExtensions(),
    content: record.content,
    contentType: "markdown",
  });
  const serialized = firstEditor.getMarkdown().trim();
  firstEditor.destroy();
  firstElement.remove();

  const secondElement = document.createElement("div");
  document.body.appendChild(secondElement);
  const secondEditor = new Editor({
    element: secondElement,
    extensions: createNoteFlowTiptapExtensions(),
    content: serialized,
    contentType: "markdown",
  });
  const secondSerialized = secondEditor.getMarkdown().trim();
  secondEditor.destroy();
  secondElement.remove();

  const inputSignature = semanticSignature(record.content);
  const outputSignature = semanticSignature(serialized);
  const reasons: string[] = [];
  if (!sameRecord(inputSignature, outputSignature)) {
    reasons.push("semantic-signature-changed");
  }
  if (secondSerialized !== serialized) reasons.push("second-pass-unstable");
  const compatibility = evaluateEditorCompatibility(record.content);
  const guardedByFallback = reasons.length > 0 && !compatibility.useModernEditor;

  return {
    kind: record.kind,
    id: record.id,
    noteId: record.noteId,
    title: record.title,
    ok: reasons.length === 0 || guardedByFallback,
    conversionOk: reasons.length === 0,
    guardedByFallback,
    fallbackReason: guardedByFallback ? compatibility.reason : undefined,
    reasons,
    inputLength: record.content.length,
    outputLength: serialized.length,
    diagnostics: reasons.length > 0 ? {
      changedTags: Object.fromEntries(
        Object.keys(inputSignature.tags)
          .filter((tag) => inputSignature.tags[tag] !== outputSignature.tags[tag])
          .map((tag) => [tag, [inputSignature.tags[tag], outputSignature.tags[tag]]])
      ),
      textChanged: inputSignature.text !== outputSignature.text,
      attributesChanged: !sameRecord(inputSignature.attributes, outputSignature.attributes),
      firstPassDifference: firstDifference(record.content, serialized),
      secondPassDifference: firstDifference(serialized, secondSerialized),
    } : undefined,
  };
});

const blocked = results.filter((result) => !result.ok);
const guarded = results.filter((result) => result.guardedByFallback);
console.log(JSON.stringify({
  ok: blocked.length === 0,
  readOnly: true,
  recordCount: results.length,
  noteCount: results.filter((result) => result.kind === "note").length,
  versionCount: results.filter((result) => result.kind === "version").length,
  directPassCount: results.filter((result) => result.conversionOk).length,
  guardedFallbackCount: guarded.length,
  blockedCount: blocked.length,
  guarded,
  blocked,
}));

if (blocked.length > 0) process.exitCode = 1;
