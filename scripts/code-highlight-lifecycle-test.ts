// Actual editor extension; all notes, paste events and clipboard data are synthetic.
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true });
for (const [key, value] of Object.entries({
  window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
  Node: dom.window.Node, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, Text: dom.window.Text,
  DOMParser: dom.window.DOMParser, MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
})) Object.defineProperty(globalThis, key, { configurable: true, value });
const [{ Editor }, { createNoteFlowTiptapExtensions }, { highlightCode, getCodeHighlight, normalizeCodeLanguage, CODE_LANGUAGES }] = await Promise.all([
  import("@tiptap/core"), import("../src/editor/tiptapExtensions.ts"), import("../src/editor/codeHighlight.ts"),
]);
const { closeHistory } = await import("@tiptap/pm/history");
function createEditor(content: string = "<p></p>", markdown = false) {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({ element, extensions: createNoteFlowTiptapExtensions(), content, ...(markdown ? { contentType: "markdown" } : {}) });
  return { editor, element, destroy() { editor.destroy(); element.remove(); } };
}
const fixtures = [
  { language: "javascript", text: 'class MyExample {}\nconst value = 42;', keyword: "const" },
  { language: "javascript", text: 'var value = 42;\nconsole.log(value);', keyword: "var" },
  { language: "javascript", text: 'const result = db.delete("users");', keyword: "const" },
  { language: "typescript", text: 'interface User { name: string; age: number }', keyword: "interface" },
  { language: "javascript", text: 'const App = () => <div className="title">Hello</div>;', keyword: "const" },
  { language: "go", text: 'var users []User\ndb.Preload("Posts").Find(&users)', keyword: "var" },
  { language: "python", text: 'def example():\n    return True', keyword: "def" },
  { language: "python", text: 'from pathlib import Path\nprint(Path("."))', keyword: "from" },
  { language: "java", text: 'public class Hello { public static void main(String[] args) { System.out.println("Hi"); } }', keyword: "public" },
  { language: "sql", text: 'select * from users where age > 18;', keyword: "select" },
  { language: "bash", text: 'if [ -f file ]; then\n  echo "hello"\nfi', keyword: "if" },
  { language: "json", text: '{"name":"张成", "active":true, "count":42}' },
  { language: "yaml", text: 'name: NoteFlow\nitems:\n  - notebook\n  - chat' },
  { language: "markdown", text: '# Title\n\n**bold** and `code`' },
  { language: "rust", text: 'pub fn example() -> bool { true }', keyword: "pub" },
  { language: "c", text: '#include <stdio.h>\nint main(void) { printf("hi"); return 0; }', keyword: "int" },
  { language: "cpp", text: '#include <iostream>\nint main() { std::cout << "Hi"; return 0; }', keyword: "int" },
  { language: "csharp", text: 'using System;\nclass Hello { static void Main() { Console.WriteLine("Hi"); } }', keyword: "using" },
  { language: "html", text: '<div class="note">Hello</div>' },
  { language: "css", text: '.note { color: red; padding: 12px; }' },
  { language: "javascript", text: '\nconst text = "😀张成 <img src=x onerror=alert(1)>";\n// return 99 example()\nconst value = 42;', keyword: "const" },
];
const reports = [];
for (const fixture of fixtures) {
  const { editor, element, destroy } = createEditor();
  editor.commands.toggleCodeBlock();
  assert.equal(editor.state.doc.firstChild?.attrs.language, null, "New blocks default to automatic mode");
  editor.view.pasteText(fixture.text, new dom.window.Event("paste", { bubbles: true, cancelable: true }));
  const codeNode = editor.state.doc.firstChild!;
  assert.equal(codeNode.type.name, "codeBlock");
  assert.equal(codeNode.textContent, fixture.text, "Pasting must preserve all source text");
  assert.equal(codeNode.attrs.language, null, "Inference must not create an extra saved transaction");
  assert.equal(element.querySelector(".code-block")?.getAttribute("data-language"), fixture.language);
  assert.equal(element.querySelector(".code-block")?.getAttribute("data-language-mode"), "auto");
  assert.equal(element.querySelector("pre code")?.textContent, fixture.text);
  assert(element.querySelector("pre code [class^=token-]"), "Fresh pasted code needs real token decorations");
  if (fixture.keyword) assert([...element.querySelectorAll(".token-keyword")].some(token => token.textContent?.split(/\s+/).includes(fixture.keyword!)), fixture.text);
  assert.equal(element.querySelectorAll("pre code img, pre code script").length, 0, "Source code must never become injected HTML");
  const cached = getCodeHighlight(codeNode);
  for (const token of cached.tokens) {
    assert(token.from >= 0 && token.to > token.from && token.to <= fixture.text.length);
    assert.match(token.className, /^token-(keyword|string|number|comment|property|function|operator)$/);
  }
  for (let index = 1; index < cached.tokens.length; index++) assert(cached.tokens[index - 1].to <= cached.tokens[index].from, "No overlapping or shifted color ranges");
  editor.commands.setTextSelection(1);
  assert.strictEqual(getCodeHighlight(editor.state.doc.firstChild!), cached, "Moving the caret must reuse parsed results");
  const serialized = editor.getMarkdown();
  assert.doesNotMatch(serialized, /token-|<span|style=/, "Save source, not painted HTML");
  assert.match(serialized, /^```\n/, "Automatic mode must stay automatic after reopening");
  const reopened = createEditor(serialized, true);
  assert.equal(reopened.editor.state.doc.firstChild?.textContent, fixture.text);
  assert.equal(reopened.editor.state.doc.firstChild?.attrs.language, null);
  assert.equal(reopened.element.querySelector(".code-block")?.getAttribute("data-language"), fixture.language);
  assert.deepEqual(getCodeHighlight(reopened.editor.state.doc.firstChild!).tokens, cached.tokens);
  const html = editor.getHTML();
  const htmlReopened = createEditor(html);
  assert.equal(htmlReopened.editor.state.doc.firstChild?.attrs.language, null, "HTML roundtrip must not freeze an automatic guess");
  assert.equal(htmlReopened.editor.state.doc.firstChild?.textContent, fixture.text);
  htmlReopened.destroy(); reopened.destroy(); destroy();
  reports.push({ language: fixture.language, freshPaste: true, automaticReopen: true, keyword: fixture.keyword ?? null });
}

// All manual choices use real grammars, including JSX/TSX and aliases.
for (const language of CODE_LANGUAGES.filter(item => !["auto", "plaintext"].includes(item.value))) {
  const fixture = fixtures.find(item => item.language === language.value) ?? fixtures.find(item => item.language === (language.value === "tsx" ? "typescript" : "javascript"))!;
  const parsed = highlightCode(fixture.text, language.value);
  assert.equal(parsed.language, language.value);
  assert(parsed.tokens.length > 0, `Missing grammar for ${language.value}`);
  const manual = createEditor('```' + language.value + '\n' + fixture.text + '\n```', true);
  assert.equal(manual.element.querySelector('.code-block')?.getAttribute('data-language-mode'), 'manual');
  assert.equal(manual.element.querySelector('.code-block')?.getAttribute('data-language'), language.value);
  assert(manual.element.querySelector('pre code [class^=token-]'));
  assert.match(manual.editor.getMarkdown(), new RegExp('^```' + language.value + '\\n'));
  manual.destroy();
}
assert.equal(normalizeCodeLanguage("language-js"), "javascript");
assert.equal(normalizeCodeLanguage("rs"), "rust");
assert.equal(normalizeCodeLanguage("alien-language"), "auto");
assert.equal(highlightCode(fixtures[6].text, "alien-language").language, "python", "Unknown fences fall back to content detection");
const unknown = createEditor('```alien-language\n' + fixtures[6].text + '\n```', true);
const unknownHtml = createEditor(unknown.editor.getHTML());
assert.equal(unknownHtml.editor.state.doc.firstChild?.attrs.language, 'alien-language');
assert.equal(unknownHtml.element.querySelector('.code-block')?.getAttribute('data-language'), 'python');
unknownHtml.destroy(); unknown.destroy();
assert.deepEqual(highlightCode("普通文本，不是代码。", null), { language: "plaintext", tokens: [] });
assert.deepEqual(highlightCode("hello world", null), { language: "plaintext", tokens: [] });
assert.deepEqual(highlightCode(fixtures[0].text, "plaintext"), { language: "plaintext", tokens: [] }, "Explicit Plain Text deliberately disables color");
const pythonTokens = highlightCode(fixtures[6].text, null).tokens;
assert(pythonTokens.some(token => token.className === 'token-function' && fixtures[6].text.slice(token.from, token.to) === 'example'), 'Function titles must not become keywords');
const protectedCode = 'const CONST = "return 99 example()";\n/* def fake():\nreturn 42 */';
const protectedTokens = highlightCode(protectedCode, 'javascript').tokens;
const stringFrom = protectedCode.indexOf('"');
const stringTo = protectedCode.lastIndexOf('"') + 1;
const commentFrom = protectedCode.indexOf('/*');
assert(protectedTokens.some(token => token.from === stringFrom && token.to === stringTo && token.className === 'token-string'));
assert(protectedTokens.some(token => token.from === commentFrom && token.to === protectedCode.length && token.className === 'token-comment'));
assert(!protectedTokens.some(token => token.className === 'token-keyword' && protectedCode.slice(token.from, token.to) === 'CONST'), 'Language keywords must keep case sensitivity');

const lifecycle = createEditor();
lifecycle.editor.commands.toggleCodeBlock();
lifecycle.editor.view.pasteText(fixtures[0].text, new dom.window.Event("paste"));
const original = lifecycle.editor.state.doc.firstChild!;
const replace = (text: string) => lifecycle.editor.view.dispatch(lifecycle.editor.state.tr.insertText(text, 1, lifecycle.editor.state.doc.firstChild!.nodeSize - 1));
replace(fixtures[6].text);
assert.equal(lifecycle.element.querySelector(".code-block")?.getAttribute("data-language"), "python", "Editing recomputes automatic grammar");
lifecycle.editor.commands.updateAttributes("codeBlock", { language: "plaintext" });
replace(fixtures[5].text);
assert.equal(lifecycle.element.querySelectorAll("pre code [class^=token-]").length, 0, "Editing does not override an explicit plain-text choice");
lifecycle.editor.commands.updateAttributes("codeBlock", { language: null });
assert.equal(lifecycle.element.querySelector(".code-block")?.getAttribute("data-language"), "go");
assert(lifecycle.element.querySelectorAll("pre code [class^=token-]").length > 0);
// These programmatic operations run in the same tick. Begin a distinct user
// action rather than letting ProseMirror group all edits into one undo step.
lifecycle.editor.view.dispatch(closeHistory(lifecycle.editor.state.tr));
replace('def incomplete(');
assert.equal(lifecycle.element.querySelector("pre code")?.textContent, 'def incomplete(', "Incomplete input must stay editable");
assert.equal(lifecycle.element.querySelector(".code-block")?.getAttribute("data-language"), "python");
lifecycle.editor.commands.undo();
assert.equal(lifecycle.editor.state.doc.firstChild?.textContent, fixtures[5].text, "Highlighting cannot add undo history steps");
assert.equal(original.textContent, fixtures[0].text, "The cache does not mutate old document nodes");
lifecycle.destroy();

// Cache unchanged blocks when another block changes; also measure a longer parse.
const many = createEditor('```python\n' + fixtures[6].text + '\n```\n\n正文', true);
const beforeNode = many.editor.state.doc.firstChild!;
const beforeResult = getCodeHighlight(beforeNode);
many.editor.view.dispatch(many.editor.state.tr.insertText("输入", many.editor.state.doc.content.size - 1));
assert.strictEqual(many.editor.state.doc.firstChild, beforeNode);
assert.strictEqual(getCodeHighlight(many.editor.state.doc.firstChild!), beforeResult);
const start = performance.now();
const long = highlightCode('const value = "😀张成"; // comment\n'.repeat(400), null);
const parseMs = Math.round(performance.now() - start);
assert(long.tokens.length > 1000);
many.destroy();
dom.window.close();
console.log(JSON.stringify({ ok: true, fixtureCount: reports.length, reports, aliasesAndManual: true, sourcePreserved: true, selectionCache: true, editRedetection: true, plaintextRespected: true, undo: true, unknownFallback: true, incompleteInput: true, unchangedBlockCache: true, longerBlockParseMs: parseMs }, null, 2));
