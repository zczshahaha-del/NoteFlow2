import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const editor = readFileSync(new URL("../src/components/NoteEditor.tsx", import.meta.url), "utf8");
const outlinePanel = readFileSync(new URL("../src/components/OutlinePanel.tsx", import.meta.url), "utf8");
const tiptapExtensions = readFileSync(new URL("../src/editor/tiptapExtensions.ts", import.meta.url), "utf8");
const aiPanel = readFileSync(new URL("../src/components/AIPanel.tsx", import.meta.url), "utf8");
const aiDraftWorkspace = readFileSync(new URL("../src/components/AIDraftWorkspace.tsx", import.meta.url), "utf8");
const editPreviewWorkspace = readFileSync(new URL("../src/components/EditPreviewWorkspace.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const directoryTree = readFileSync(new URL("../src/components/DirectoryTree.tsx", import.meta.url), "utf8");
const librarySearch = readFileSync(new URL("../src/components/LibrarySearchDialog.tsx", import.meta.url), "utf8");
const accountMenu = readFileSync(new URL("../src/components/AppNav.tsx", import.meta.url), "utf8");
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
assert.match(editor, /placement: "top"/);
assert.match(editor, /flip: false/);
assert.match(editor, /className="chapter-rail"/);
assert.match(editor, /aria-label="章节快速导航"/);
assert.doesNotMatch(editor, /className="chapter-rail-toc"/);
assert.match(editor, /function smoothScrollToEditorHeading/);
assert.match(editor, /closest<HTMLElement>\("\.document-scroll"\)/);
assert.match(editor, /scroller\.scrollTo\(\{[\s\S]*?behavior: reduceMotion \? "auto" : "smooth"/);
assert.doesNotMatch(
  editor,
  /const scrollToHeading[\s\S]{0,260}\.focus\(\)[\s\S]{0,120}\.scrollIntoView\(\)/,
  "outline navigation must not jump by focusing the editor before smooth scrolling"
);
assert.match(editor, /numberHeadings\(headings\)/);
assert.match(editor, /aria-label="文档显示设置"/);
assert.match(editor, /显示章节编号/);
assert.match(editor, /role="menuitemcheckbox"/);
assert.match(editor, /HEADING_NUMBERING_STORAGE_KEY/);
assert.match(editor, /headings=\{visibleHeadings\}/);
assert.match(styles, /\.note-content\.heading-numbering-enabled[\s\S]*?\[data-heading-number\]::before/);
assert.match(styles, /--noteflow-heading-ink: #232528;/);
assert.match(styles, /--noteflow-body-ink: #36393d;/);
assert.match(styles, /\.document-canvas \.note-content \{[\s\S]*?font-weight: 450;/);
assert.match(styles, /\.document-canvas \.note-content p \{[\s\S]*?color: var\(--noteflow-body-ink\) !important;/);
assert.match(styles, /\.document-canvas \.note-content h1,[\s\S]*?color: var\(--noteflow-heading-ink\) !important;/);
assert.match(editor, /heading\.hierarchyDepth/);
assert.match(outlinePanel, /heading\.hierarchyDepth/);
assert.match(outlinePanel, /depth \* 18/);
assert.doesNotMatch(editor, /false && !isMobile.*outline/);
assert.match(styles, /\.tiptap-selection-toolbar \{[\s\S]*?transform: none;/);
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
assert.equal(aiPanel.includes("直接说你想做什么"), false, "chat header must stay compact");
assert.match(aiPanel, /搜索历史对话/);
assert.match(aiPanel, /新建对话/);
assert.match(aiPanel, /id="new-chat-tooltip"[\s\S]*?top-full/);
assert.doesNotMatch(aiPanel, /aria-label="新建对话"[\s\S]{0,100}title="新建对话"/);
assert.doesNotMatch(aiPanel, /if \(chatSelection\) inputRef\.current\?\.focus\(\)/);
assert.doesNotMatch(aiPanel, /title="移除当前笔记引用"/);
assert.doesNotMatch(aiPanel, /title="移除选中文字引用"/);
assert.match(aiPanel, /删除这段对话/);
assert.match(aiPanel, /chatSessions/);
assert.match(aiPanel, /ref=\{modeMenuRef\}/);
assert.match(aiPanel, /document\.addEventListener\("mousedown", closeOnOutsideClick, true\)/);
assert.doesNotMatch(aiPanel, /draftFallbackAnchorRef/);
assert.doesNotMatch(aiPanel, /fallbackDraftAnchor/);
assert.match(aiPanel, /renderDraftConversationCard\(msg\.draftCard\)/);
assert.match(aiPanel, /outlineCanOpen/);
assert.match(aiPanel, /大纲生成中…/);
assert.match(aiPanel, /重新生成大纲/);
assert.match(aiPanel, /requestDraftCommand\("generate_outline"\)/);
assert.equal(aiPanel.includes("笔记索引 ·"), false);
assert.equal(aiPanel.includes("listIndexJobs"), false);
assert.match(aiPanel, /aria-label="收起 AI 助手"/);
assert.match(aiPanel, /id="collapse-ai-tooltip"[\s\S]*?role="tooltip"[\s\S]*?收起聊天/);
assert.doesNotMatch(aiPanel, /aria-label="收起 AI 助手"[\s\S]{0,120}title="收起 AI 助手"/);
assert.doesNotMatch(aiPanel, /false && onCollapse/);
assert.match(app, /className="ai-orb-launcher absolute bottom-5 right-5/);
assert.match(app, /<AIDraftWorkspace key=\{draftWorkspaceKey\}/);
assert.match(app, /<NoteEditor \/>/);
assert.doesNotMatch(app, /TiptapPilotEditor|manualLegacy|editorMode|evaluateEditorCompatibility/);
assert.match(editor, /选择一篇笔记开始阅读/);
assert.match(editor, /从左侧目录打开笔记/);
assert.match(
  app,
  /defaultWidth=\{350\}[\s\S]*?minWidth=\{300\}[\s\S]*?maxWidth=\{600\}[\s\S]*?resizeEdge="left"/,
  "desktop AI panel must remain horizontally resizable"
);
assert.match(app, /className=\{`app-frame[\s\S]*?stable-workspace-layout/);
assert.match(app, /"--workspace-left-width"/);
assert.match(app, /"--workspace-right-width"/);
assert.match(app, /workspace-center-layer absolute inset-0 z-0/);
assert.match(app, /onWidthChange=\{setAiPanelWidth\}/);
assert.match(
  styles,
  /\.app-frame\.stable-workspace-layout \.document-canvas \.note-page \{[\s\S]*?margin-left: clamp\(/,
  "desktop document must remain globally centered until a side panel reaches its safety edge"
);
assert.match(
  styles,
  /--document-page-width: min\([\s\S]*?780px,[\s\S]*?--workspace-left-width[\s\S]*?--workspace-right-width/,
  "document width must shrink only after side panels consume the available gutters"
);
assert.match(
  styles,
  /\.app-frame\.stable-workspace-layout \.chapter-rail \{[\s\S]*?right: calc\(var\(--workspace-right-width, 0px\) \+ 10px\);/,
  "the document outline rail must remain visible beside the resizable AI panel"
);
assert.match(editPreviewWorkspace, /role="alert"/);
assert.match(editPreviewWorkspace, /editPreviewError/);
assert.match(app, /draftSeed\.trim\(\) \|\| checkpointDraftSeed \|\| activeDraftContext\?\.topic/);
assert.doesNotMatch(app, /draftWorkspaceKey[\s\S]{0,180}activeDraftContext\?\.id/);
assert.doesNotMatch(app, /<span className="hidden sm:inline">AI 助手<\/span>/);
for (const requiredDraftControl of [
  "大纲目录",
  "全部生成",
  "生成本章正文",
  "重新生成本章",
  "告诉 AI 如何修改本章内容",
  "按要求修改",
  "添加一级章节",
  "按新要求调整大纲",
  "按要求重新规划",
  "放弃草稿",
  "全文要求",
  "全文写作要求",
  "应用到后续章节",
  "重写已生成章节",
  "目录管理",
  "保存位置",
  "确认保存",
  "更多草稿操作",
]) {
  assert.equal(
    aiDraftWorkspace.includes(requiredDraftControl),
    true,
    `AI draft workspace must expose control: ${requiredDraftControl}`
  );
}
const draftRail = aiDraftWorkspace.match(/<aside[\s\S]*?<\/aside>/)?.[0] ?? "";
assert.match(draftRail, /aria-label="草稿章节目录"/);
for (const controlMovedOutOfRail of ["添加一级章节", "按新要求调整大纲", "保存到", "放弃草稿"]) {
  assert.equal(
    draftRail.includes(controlMovedOutOfRail),
    false,
    `draft rail must remain navigation-only: ${controlMovedOutOfRail}`
  );
}
assert.match(aiDraftWorkspace, /sectionOrder: reordered\.map/);
assert.equal(aiDraftWorkspace.includes("· AI 草稿"), false, "draft header must show only the note title");
assert.equal(aiDraftWorkspace.includes("workspaceStatus"), false, "draft header must not repeat persistent status text");
assert.equal(aiDraftWorkspace.includes("statusClass("), false, "chapter header must not repeat a status badge");
assert.equal(
  aiDraftWorkspace.match(/生成本章正文/g)?.length ?? 0,
  1,
  "an ungenerated chapter must expose exactly one primary generate action"
);
assert.equal(
  aiDraftWorkspace.includes("完整大纲"),
  false,
  "AI draft workspace right pane must show the selected chapter body, not a full-outline view"
);
assert.match(aiDraftWorkspace, /selectedSection\?\.content[\s\S]*?dangerouslySetInnerHTML=\{\{ __html: renderedSection \}\}/);
assert.match(aiDraftWorkspace, /disabled=\{!outlineInstruction\.trim\(\) \|\| isBusy\}/);
assert.match(aiDraftWorkspace, /\{errorText && \(/);
assert.match(aiDraftWorkspace, /outlineGenerationError\(error\)/);
assert.doesNotMatch(aiDraftWorkspace, /\{\(statusText \|\| errorText\) && \(/);
assert.match(aiDraftWorkspace, /draft-control-no-focus-ring/);
assert.match(aiDraftWorkspace, /bodyInstruction: instruction/);
assert.match(aiDraftWorkspace, /正在后台逐章重写/);
assert.match(aiDraftWorkspace, /aria-haspopup="dialog"/);
assert.match(styles, /\.draft-modal-shell \.draft-control-no-focus-ring:focus[\s\S]*?outline: none !important;[\s\S]*?box-shadow: none !important;/);
assert.match(directoryTree, /const handleNewFolder[\s\S]*?setNewFolderOpen\(true\);/);
assert.match(directoryTree, /aria-labelledby="new-folder-title"/);
assert.match(directoryTree, /const handleCreateFolderConfirm[\s\S]*?addNode\(newFolderParentId/);
assert.match(directoryTree, /className=\{`directory-tree/);
assert.match(directoryTree, /<h1[^>]*>目录<\/h1>[\s\S]*?\{fileCount\} 篇/);
assert.doesNotMatch(directoryTree, /folderCount|个文件夹/);
assert.match(directoryTree, /id="collapse-directory-tooltip"[\s\S]*?role="tooltip"[\s\S]*?收起目录/);
assert.doesNotMatch(directoryTree, /aria-label="收起目录"[\s\S]{0,120}title="收起目录"/);
assert.match(directoryTree, /aria-label="搜索全部笔记"/);
assert.match(directoryTree, /<Plus[\s\S]*?aria-label="搜索全部笔记"[\s\S]*?<Search/);
assert.match(directoryTree, /<LibrarySearchDialog[\s\S]*?open=\{searchOpen\}/);
assert.doesNotMatch(directoryTree, /searchQuery|searchResults\.map|正在检索知识库/);
assert.match(directoryTree, /if \(!searchShortcutEnabled\) return/);
assert.match(app, /searchShortcutEnabled=\{isDesktop \|\| !libraryDrawerOpen\}/);
assert.match(app, /keyEvent\.isComposing \|\| keyEvent\.keyCode === 229/);
assert.match(librarySearch, /const SEARCH_DEBOUNCE_MS = 340/);
assert.match(librarySearch, /onCompositionStart=\{handleCompositionStart\}/);
assert.match(librarySearch, /onCompositionEnd=\{handleCompositionEnd\}/);
assert.match(librarySearch, /requestSequenceRef/);
assert.match(librarySearch, /activeControllerRef/);
assert.match(librarySearch, /mode: "literal"/);
assert.match(librarySearch, /scope,/);
assert.match(librarySearch, /搜索只显示真实文字命中/);
assert.match(librarySearch, /SEARCH_SCOPES/);
assert.match(librarySearch, /createPortal/);
assert.match(
  directoryTree,
  /isSelected[\s\S]*?"border-transparent bg-jelly-blue-pale font-medium text-jelly-blue-deep shadow-none"/,
  "the selected note must have a clear visual state"
);
assert.match(directoryTree, /bg-jelly-blue-pale\/60 hover:text-jelly-text/);
assert.match(directoryTree, /depth \* 12/);
assert.match(directoryTree, /group-focus-within\/node:opacity-100/);
assert.match(directoryTree, /还没有笔记/);
assert.match(directoryTree, /新建第一篇笔记/);
assert.match(directoryTree, /expanded[\s\S]*?\? "w-full shadow-none"/);
assert.doesNotMatch(directoryTree, /filteredTree\.slice\(0, 9\)/);
assert.doesNotMatch(directoryTree, /未找到匹配的笔记/);
assert.match(directoryTree, /newTooltipOpen && !newMenuOpen/);
assert.match(directoryTree, /border border-jelly-border bg-white[\s\S]*?text-jelly-text-soft/);
assert.match(directoryTree, /fixed inset-0 z-\[70\] flex items-center justify-center/);
assert.match(directoryTree, /role="alertdialog"/);
assert.doesNotMatch(directoryTree, /getDeleteConfirmPosition/);
assert.match(directoryTree, /compact=\{!expanded\}/);
assert.match(directoryTree, /trashCount=\{deletedNotes\.length\}/);
assert.match(directoryTree, /onOpenTrash=\{\(\) => setTrashOpen\(true\)\}/);
assert.match(directoryTree, /fixed inset-0 z-\[85\]/);
assert.match(directoryTree, /role="dialog"[\s\S]*?aria-modal="true"[\s\S]*?aria-label="回收站"/);
assert.doesNotMatch(directoryTree, /max-h-36/);
assert.match(accountMenu, />设置</);
assert.match(accountMenu, />回收站</);
assert.match(accountMenu, /onOpenTrash/);
assert.match(styles, /\.directory-tree :where\(button, input, select, textarea, \[tabindex\]\):focus-visible[\s\S]*?outline: none !important;/);
assert.match(
  styles,
  /\.directory-tree :where\(button, input, select, textarea, \[tabindex\]\):focus-visible[\s\S]*?box-shadow: inset 0 -2px 0 color-mix/,
  "directory keyboard focus must remain visible without drawing a full frame"
);
assert.match(styles, /\.directory-tree \.ui-input:focus-within[\s\S]*?box-shadow: none;/);
assert.match(styles, /@media \(hover: none\)[\s\S]*?\.directory-tree \.file-node-menu-button[\s\S]*?opacity: 1;/);
assert.match(
  editor,
  /className="floating-launcher absolute right-3 top-3 z-40[\s\S]*?aria-label="展开目录"/,
  "the mobile document outline launcher must not overlap the left-side library launcher"
);
assert.match(
  app,
  /className="floating-launcher absolute left-3 top-3 z-50[\s\S]*?aria-label="打开知识库"/,
  "the mobile library launcher remains on the left"
);
assert.match(
  styles,
  /\.chapter-rail-item \{[\s\S]*?justify-content: flex-start;/,
  "expanded chapter rail items must align from the left"
);
assert.match(
  styles,
  /\.chapter-rail \{[\s\S]*?width: 34px;[\s\S]*?color: var\(--color-jelly-text-muted\);/,
  "the collapsed chapter rail must leave enough room for active chapter markers"
);
assert.match(
  styles,
  /\.chapter-rail:not\(:hover\):not\(:focus-within\) \.chapter-rail-item \{[\s\S]*?gap: 0;[\s\S]*?justify-content: center;[\s\S]*?min-height: 16px;[\s\S]*?padding-left: 0 !important;/,
  "collapsed chapter rail must contain only compact, centered markers"
);
assert.match(
  styles,
  /\.chapter-rail-track \{[\s\S]*?display: flex;[\s\S]*?flex-direction: column;[\s\S]*?gap: 2px;/,
  "collapsed chapter markers must form one continuous vertical track"
);
assert.doesNotMatch(
  styles,
  /var\(--jelly-/,
  "chapter rail colors must use the defined --color-jelly-* theme variables"
);
assert.match(
  styles,
  /\.chapter-rail-label \{[\s\S]*?text-align: left;/,
  "chapter rail labels must be left-aligned"
);
assert.equal(aiPanel.includes("toggleSources"), false);
assert.equal(aiPanel.includes("sourcesExpanded"), false);
assert.equal(aiPanel.includes("source.snippet &&"), false);
assert.match(aiPanel, /onClick=\{\(\) => focusChatSource\(source\)\}/);
assert.match(styles, /\.ai-chat-composer :where\(input, textarea, button\):focus[\s\S]*box-shadow: none !important/);
assert.equal(styles.includes(".ai-chat-composer button:focus-visible"), false);
assert.match(
  styles,
  /:where\(button, input, select, textarea, \[contenteditable="true"\], \[tabindex\]\):focus-visible \{[\s\S]*?outline: none;/,
  "global controls must not show the heavy blue focus frame"
);
assert.equal(aiDraftWorkspace.includes("focus:ring-"), false, "draft inputs must not add blue focus rings");
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
assert.match(
  styles,
  /\.code-language-floating-popover \{[\s\S]*?z-index: 1000;/,
  "code language popover must stay above every code block toolbar"
);
assert.match(styles, /\.code-language-floating-options \{[\s\S]*?overflow-y: auto;/);
assert.match(styles, /\.document-canvas \.note-content \.code-language-current \{[\s\S]*?text-overflow: ellipsis !important;[\s\S]*?white-space: nowrap !important;/);
assert.match(styles, /\.document-canvas \.note-content \.code-language-trigger \{[\s\S]*?background: transparent !important;/);
assert.match(styles, /\.code-language-menu\.is-open \.code-language-trigger \{[\s\S]*?background: #ecebe8 !important;/);
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
