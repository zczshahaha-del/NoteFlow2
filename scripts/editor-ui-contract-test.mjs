import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const editor = readFileSync(new URL("../src/components/TiptapPilotEditor.tsx", import.meta.url), "utf8");
const tiptapExtensions = readFileSync(new URL("../src/editor/tiptapExtensions.ts", import.meta.url), "utf8");
const aiPanel = readFileSync(new URL("../src/components/AIPanel.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const directoryTree = readFileSync(new URL("../src/components/DirectoryTree.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

for (const forbidden of [
  "查看 Markdown",
  "隐藏 Markdown",
  "Markdown 实时输出",
  "Markdown 唯一保存格式",
  "NoteFlow 新版编辑器",
  "切换经典编辑器",
]) {
  assert.equal(editor.includes(forbidden), false, `editor must not expose technical control: ${forbidden}`);
}

assert.match(editor, /className="document-editor/);
assert.match(editor, /aria-label="文档格式工具栏"/);
assert.match(editor, /aria-label": "笔记正文"/);
assert.match(editor, /<BubbleMenu/);
assert.match(editor, /aria-label="选中文字格式工具栏"/);
assert.match(styles, /\.document-editor[\s\S]*outline: none !important/);
assert.match(styles, /\.document-toolbar-button:focus-visible::after/);
assert.match(aiPanel, /className="ai-chat-composer/);
assert.match(aiPanel, /ai-large-composer/);
assert.match(aiPanel, /className="ai-chat-input/);
assert.equal(aiPanel.includes("focus-within:shadow-[0_0_0_3px"), false);
assert.equal(aiPanel.includes("focus-within:border-[#8bbbd9]"), false);
for (const hiddenChatControl of ["本次上下文", "统一输入 · 随时切换", "setContextScope"]) {
  assert.equal(aiPanel.includes(hiddenChatControl), false, `chat must not expose context mode control: ${hiddenChatControl}`);
}
assert.match(aiPanel, /对话/);
assert.match(aiPanel, /全库搜索/);
assert.match(aiPanel, /当前笔记引用/);
assert.equal(aiPanel.includes(">问笔记<"), false);
assert.match(aiPanel, /mode: composerMode/);
assert.match(aiPanel, /contextScope,/);
assert.match(aiPanel, /"knowledge_base"/);
assert.match(aiPanel, /"current_note"/);
assert.match(aiPanel, /"selection"/);
assert.equal(aiPanel.includes("window.getSelection"), false, "chat must not treat arbitrary page selection as note context");
assert.match(aiPanel, /直接说你想做什么/);
assert.match(aiPanel, /ref=\{modeMenuRef\}/);
assert.match(aiPanel, /document\.addEventListener\("mousedown", closeOnOutsideClick, true\)/);
assert.equal(aiPanel.includes("笔记索引 ·"), false);
assert.equal(aiPanel.includes("listIndexJobs"), false);
assert.match(app, /className="ai-orb-launcher absolute bottom-5 right-5/);
assert.doesNotMatch(app, /<span className="hidden sm:inline">AI 助手<\/span>/);
assert.match(directoryTree, /view === "all" && !tag/);
assert.match(directoryTree, /setRenamingId\(id\);[\s\S]*?setRenameDraft\("新建文件夹"\);/);
assert.match(directoryTree, /className=\{`directory-tree/);
assert.match(directoryTree, /newTooltipOpen && !newMenuOpen/);
assert.match(directoryTree, /border border-jelly-border bg-white[\s\S]*?text-jelly-text-soft/);
assert.match(directoryTree, /fixed inset-0 z-\[70\] flex items-center justify-center/);
assert.match(directoryTree, /role="alertdialog"/);
assert.doesNotMatch(directoryTree, /getDeleteConfirmPosition/);
assert.match(styles, /\.directory-tree :where\(button, input, select, textarea, \[tabindex\]\):focus-visible[\s\S]*?outline: none !important;/);
assert.match(styles, /\.directory-tree \.ui-input:focus-within[\s\S]*?box-shadow: none;/);
assert.equal(aiPanel.includes("toggleSources"), false);
assert.equal(aiPanel.includes("sourcesExpanded"), false);
assert.equal(aiPanel.includes("source.snippet &&"), false);
assert.match(aiPanel, /onClick=\{\(\) => focusChatSource\(source\)\}/);
assert.match(styles, /\.ai-chat-composer :where\(input, textarea, button\):focus[\s\S]*box-shadow: none !important/);
assert.equal(styles.includes(".ai-chat-composer button:focus-visible"), false);
for (const badCodeIcon of ["▣", "•••", "⠿"]) {
  assert.equal(styles.includes(badCodeIcon), false, `code toolbar must not use glyph icon: ${badCodeIcon}`);
}
assert.match(styles, /\.document-canvas \.note-content \.code-copy-button::before/);
assert.match(styles, /\.document-canvas \.note-content \.code-copy-button::after/);
assert.match(styles, /\.document-canvas \.note-content \.code-more-button/);
assert.match(
  styles,
  /\.document-canvas \.note-content \.code-toolbar-actions \{[\s\S]*?opacity: 1 !important;[\s\S]*?pointer-events: auto !important;/,
  "code toolbar actions must remain visible and interactive"
);
assert.match(tiptapExtensions, /addNodeView\(\)/);
assert.match(tiptapExtensions, /contentDOM: code/);
assert.equal(tiptapExtensions.includes("TextSelection"), false, "code selection must remain native and draggable");
assert.match(tiptapExtensions, /toolbarView\.toolbar\.addEventListener\("mousedown", onToolbarMouseDown, true\)/);
assert.equal(
  tiptapExtensions.includes('document.addEventListener("mousedown", onToolbarMouseDown'),
  false,
  "code toolbar mouse handling must not capture code-body selection"
);
assert.match(styles, /\.document-canvas \.note-content \.code-block pre code,[\s\S]*?user-select: text !important;/);
assert.match(tiptapExtensions, /const languageButton = document\.createElement\("button"\)/);
assert.match(tiptapExtensions, /function openCodeLanguageMenu/);
assert.match(tiptapExtensions, /closest\("\[data-language-toggle\]"\)/);
assert.match(tiptapExtensions, /if \(menuClose\) \{[\s\S]*?closeMenu\(\);[\s\S]*?return;/);
assert.match(styles, /\.code-language-floating-popover/);
assert.match(styles, /\.code-language-floating-options \{[\s\S]*?overflow-y: auto;/);
assert.match(styles, /\.document-canvas \.note-content \.code-language-current \{[\s\S]*?text-overflow: ellipsis !important;[\s\S]*?white-space: nowrap !important;/);
assert.doesNotMatch(tiptapExtensions, /document\.createElement\("select"\)/);
assert.doesNotMatch(styles, /\.document-canvas \.note-content \.code-language-menu::after/);
assert.match(tiptapExtensions, /setNodeMarkup\(position/);
assert.match(tiptapExtensions, /closest\("\[data-copy-code\]"\)/);
assert.match(tiptapExtensions, /setAttribute\("aria-label", "已拷贝"\)[\s\S]*?navigator\.clipboard\.writeText\(codeText\)/);
assert.match(tiptapExtensions, /stopEvent\(event\)[\s\S]*?toolbarView\.toolbar\.contains\(target\)/);
assert.match(tiptapExtensions, /ignoreMutation\(mutation\)[\s\S]*?toolbarView\.toolbar\.contains\(mutation\.target\)/);
assert.doesNotMatch(editor, /onClickCapture=\{handleCodeBlockClick\}/);
assert.match(styles, /\.document-editor \{[\s\S]*?z-index: 0;[\s\S]*?isolation: isolate;/);
assert.match(styles, /\.document-canvas \.note-content \.code-toolbar \{[\s\S]*?z-index: 5 !important;/);
assert.doesNotMatch(
  styles,
  /\.document-canvas \.note-content \.code-toolbar \{[\s\S]*?z-index: 120 !important;/,
  "note code toolbar must stay below drawers and modal backdrops"
);
assert.match(styles, /max-width: 920px !important/);
assert.match(styles, /font-size: 16px !important/);

console.log(JSON.stringify({
  ok: true,
  hiddenTechnicalControls: 6,
  focusStyle: "no-click-frame",
  chatComposer: "large-context-composer",
  chatContext: "dialog-or-library-search",
  chatSources: "compact-click-through",
}));
