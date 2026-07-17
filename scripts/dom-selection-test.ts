import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
Object.defineProperty(globalThis, "NodeFilter", { configurable: true, value: dom.window.NodeFilter });

const { findNormalizedTextRange } = await import("../src/utils/domSelection.ts");

const root = document.createElement("div");
root.innerHTML = "<p>修改前缀 <strong>AI   修改后的内容</strong> 结束</p><p>第二段</p>";

const inlineRange = findNormalizedTextRange(root, "AI 修改后的内容");
assert.ok(inlineRange, "should find formatted inline content");
assert.equal(inlineRange.toString().replace(/\s+/g, " "), "AI 修改后的内容");

const crossNodeRange = findNormalizedTextRange(root, "修改前缀 AI 修改后的内容 结束");
assert.ok(crossNodeRange, "should find text spanning multiple DOM nodes");
assert.equal(
  crossNodeRange.toString().replace(/\s+/g, " "),
  "修改前缀 AI 修改后的内容 结束"
);

assert.equal(findNormalizedTextRange(root, "不存在的内容"), null);

console.log(JSON.stringify({ ok: true, cases: 3 }));
