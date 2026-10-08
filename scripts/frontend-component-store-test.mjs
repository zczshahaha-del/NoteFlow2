import assert from "node:assert/strict";

import React, { act } from "react";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: "http://127.0.0.1:5173/",
});

Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement,
  HTMLButtonElement: dom.window.HTMLButtonElement,
  Element: dom.window.Element,
  Node: dom.window.Node,
  NodeFilter: dom.window.NodeFilter,
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: dom.window.navigator,
});
window.matchMedia ??= () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});
dom.window.HTMLElement.prototype.attachEvent ??= function attachEvent() {};
dom.window.HTMLElement.prototype.detachEvent ??= function detachEvent() {};
dom.window.HTMLElement.prototype.scrollIntoView ??= function scrollIntoView() {};
dom.window.HTMLElement.prototype.scrollTo ??= function scrollTo() {};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const testFetch = async (input) => new Response(JSON.stringify(
  String(input).endsWith("/api/auth/sessions") ? []
    : String(input).endsWith("/api/settings")
      ? { settings: { memoryEnabled: true, preferences: {}, createdAt: null, updatedAt: null } }
      : { revisions: [] }
), {
  status: 200,
  headers: { "Content-Type": "application/json" },
});
globalThis.fetch = testFetch;
window.fetch = testFetch;

async function renderClient(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  const html = container.innerHTML;
  await act(async () => root.unmount());
  container.remove();
  return html;
}

const vite = await createServer({
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});
const traceFrontend = (phase) => {
  if (process.env.NOTEFLOW_TEST_TRACE === "1") console.error(JSON.stringify({ phase, rssMiB: Math.round(process.memoryUsage().rss / 1024 / 1024) }));
};
traceFrontend("vite-ready");

try {
  const {
    reconcilePersistedNoteRecord,
    useAppStore,
    useWorkspaceSlice,
    LoginPage,
    NoteMetadataControls,
    EditPreviewWorkspace,
    DirectoryTree,
    LibrarySearchDialog,
    AccountMenu,
    AIPanel,
    SoftMenu,
  } = await vite.ssrLoadModule("/src/testing/frontendHarness.ts");
  traceFrontend("harness-loaded");

  const initialState = useAppStore.getInitialState();
  useAppStore.setState(initialState, true);

  // Production menu lifecycle with synthetic contents, no browser/session or API access.
  const softContainer = document.createElement("div"); document.body.appendChild(softContainer);
  traceFrontend("soft-menu");
  const softRoot = createRoot(softContainer);
  let softOpen = true;
  let softActionCalls = 0;
  const renderSoft = () => softRoot.render(React.createElement("div", null,
    React.createElement("button", { "aria-expanded": softOpen }, "菜单入口"),
    React.createElement(SoftMenu, { open: softOpen, onClose() { softOpen = false; renderSoft(); } },
      React.createElement("button", { onClick() { softActionCalls++; } }, "原有操作"))));
  await act(async () => renderSoft());
  softContainer.querySelector('.nf-soft-menu button').focus();
  await act(async () => softContainer.querySelector('.nf-soft-menu button').dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, isComposing: true })));
  assert.equal(softOpen, true);
  await act(async () => softContainer.querySelector('.nf-soft-menu button').dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.equal(softOpen, false);
  assert.equal(document.activeElement, softContainer.querySelector('button[aria-expanded]'));
  assert.equal(softContainer.querySelector('.nf-soft-menu').getAttribute('aria-hidden'), "true");
  assert.equal(softContainer.querySelector('.nf-soft-menu').hasAttribute('inert'), true);
  await act(async () => softContainer.querySelector('.nf-soft-menu button').click());
  assert.equal(softActionCalls, 0, "closed visual contents cannot execute actions");
  await act(async () => { softOpen = true; renderSoft(); });
  await act(async () => new Promise(resolve => window.setTimeout(resolve, 160)));
  assert.equal(softContainer.querySelector('.nf-soft-menu').dataset.open, "true", "reopen cancels stale exit timer");
  await act(async () => { softOpen = false; renderSoft(); });
  await act(async () => new Promise(resolve => window.setTimeout(resolve, 160)));
  assert.equal(softContainer.querySelector('.nf-soft-menu'), null);
  const savedMatchMedia = window.matchMedia;
  window.matchMedia = () => ({ matches: true });
  await act(async () => { softOpen = true; renderSoft(); });
  await act(async () => { softOpen = false; renderSoft(); });
  assert.equal(softContainer.querySelector('.nf-soft-menu'), null, "reduced motion closes immediately");
  window.matchMedia = savedMatchMedia;
  await act(async () => softRoot.unmount()); softContainer.remove();

  const note = {
    id: "note-test-1",
    type: "file",
    name: "组件测试笔记.md",
    content: "# 组件测试\n\n正文",
    tags: ["测试", "前端"],
    favorite: true,
    pinned: false,
    indexStatus: "indexed",
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T01:00:00.000Z",
  };
  const snapshot = {
    treeData: [note],
    fileContents: { [note.id]: note.content },
    selectedFileId: note.id,
  };
  useAppStore.getState().replaceSnapshot(snapshot);

  assert.equal(useAppStore.getState().selectedFileId, note.id);
  assert.equal(useAppStore.getState().fileContents[note.id], note.content);

  const reconciledTree = reconcilePersistedNoteRecord(
    [{ ...note, contentHash: "hash-before" }],
    {
      id: note.id,
      title: "组件测试笔记",
      categoryId: null,
      summary: null,
      tags: note.tags,
      content: "# 组件测试\n\n第一次保存",
      contentHash: "hash-after-first-save",
      isPinned: false,
      isFavorite: true,
      indexStatus: "pending",
      createdAt: note.createdAt,
      updatedAt: "2026-07-15T02:00:00.000Z",
      deletedAt: null,
    },
    "# 组件测试\n\n第一次保存后继续输入"
  );
  assert.equal(reconciledTree[0].content, "# 组件测试\n\n第一次保存后继续输入");
  assert.equal(reconciledTree[0].contentHash, "hash-after-first-save");
  assert.equal(reconciledTree[0].updatedAt, "2026-07-15T02:00:00.000Z");

  useAppStore.getState().startDraft("测试主题");
  assert.equal(useAppStore.getState().centerMode, "note");
  assert.equal(useAppStore.getState().draftSeed, "测试主题");
  assert.match(useAppStore.getState().chatMessages.at(-1)?.text ?? "", /整理一份大纲/);
  assert.equal(useAppStore.getState().chatMessages.at(-1)?.draftCard?.seed, "测试主题");
  useAppStore.getState().dismissDraftWorkspace();
  assert.equal(useAppStore.getState().centerMode, "note");
  assert.equal(useAppStore.getState().draftSeed, "测试主题");
  useAppStore.getState().openPendingDraft();
  assert.equal(useAppStore.getState().centerMode, "note");
  useAppStore.getState().setActiveDraftContext({
    ...useAppStore.getState().activeDraftContext,
    id: "draft-test-1",
    title: "测试主题",
    topic: "测试主题",
    stage: "outline_ready",
    busy: false,
    statusText: "大纲已生成。",
    errorText: "",
    completedSections: 0,
    totalSections: 3,
  });
  useAppStore.setState({
    pendingCheckpoint: {
      id: "checkpoint-draft-test-1",
      sessionId: "session-draft-test-1",
      runId: "run-draft-test-1",
      checkpointType: "draft_workspace",
      status: "waiting_user_confirm",
      payload: { seed: "测试主题", draftId: "draft-test-1" },
    },
  });
  useAppStore.getState().openPendingDraft();
  assert.equal(useAppStore.getState().centerMode, "draft");
  assert.equal(useAppStore.getState().activeDraftContext?.stage, "outline_ready");
  useAppStore.getState().dismissDraftWorkspace();
  assert.equal(useAppStore.getState().centerMode, "note");
  assert.equal(useAppStore.getState().activeDraftContext?.stage, "outline_ready");
  useAppStore.getState().openPendingDraft();
  assert.equal(useAppStore.getState().centerMode, "draft");
  useAppStore.getState().closeDraft();
  assert.equal(useAppStore.getState().centerMode, "note");

  useAppStore.getState().addSelectionToChat({
    text: "选中的正文",
    noteId: note.id,
    noteTitle: "组件测试笔记",
  });
  assert.equal(useAppStore.getState().chatSelection?.text, "选中的正文");
  useAppStore.getState().clearChatSelection();
  assert.equal(useAppStore.getState().chatSelection, null);

  function WorkspaceProbe() {
    const { selectedFileId, treeData } = useWorkspaceSlice();
    return React.createElement("output", null, `${selectedFileId}:${treeData.length}`);
  }
  assert.equal(await renderClient(React.createElement(WorkspaceProbe)), '<output>note-test-1:1</output>');

  // Drive production conversation UI with synthetic messages; never call the live AI.
  const beforeConversation = useAppStore.getState();
  const conversationContainer = document.createElement("div"); document.body.appendChild(conversationContainer);
  traceFrontend("conversation");
  const conversationRoot = createRoot(conversationContainer);
  const userMessage = { id: "ui-user", role: "user", text: "帮我解释这段笔记" };
  const assistantMessage = { id: "ui-assistant", role: "assistant", text: "" };
  const sentMessages = [];
  const openedChatSources = [];
  let stoppedMessages = 0;
  useAppStore.setState({ ...initialState, ...snapshot, chatMessages: [userMessage, assistantMessage], chatLoading: true,
    sendMessage(...args) { sentMessages.push(args); },
    focusChatSource(source) { openedChatSources.push(source); },
    stopGeneration() { stoppedMessages += 1; useAppStore.setState({ chatLoading: false }); },
  }, true);
  await act(async () => conversationRoot.render(React.createElement(AIPanel)));
  const conversationStatus = () => conversationContainer.querySelector('.nf-chat-status');
  const composer = conversationContainer.querySelector('.nf-chat-composer');
  const composerInput = conversationContainer.querySelector('textarea[aria-label="消息输入框"]');
  assert.ok(composer);
  assert.ok(composerInput);
  assert.equal(conversationContainer.querySelectorAll('[role="status"]').length, 1);
  assert.equal(conversationStatus().textContent, "正在思考");
  assert.equal(conversationStatus().querySelector('.nf-chat-status-dot').getAttribute('aria-hidden'), "true");
  assert.equal(conversationContainer.querySelector('.typing-caret'), null);
  assert.equal(conversationContainer.querySelector('.nf-chat-message--assistant .chat-markdown'), null);
  assert.equal(composer.dataset.generating, "true");
  assert.ok(conversationContainer.querySelector('button[aria-label="停止生成"]'));
  await act(async () => useAppStore.setState({ chatMessages: [userMessage, { ...assistantMessage, text: "   " }] }));
  assert.equal(conversationStatus().textContent, "正在思考");
  await act(async () => useAppStore.setState({ chatMessages: [userMessage, { ...assistantMessage, text: "这是 **重点**。" }] }));
  assert.equal(conversationStatus(), null);
  assert.equal(conversationContainer.querySelector('.chat-markdown strong').textContent, "重点");
  assert.equal(conversationContainer.querySelector('.chat-markdown').getAttribute('aria-busy'), "true");
  assert.equal(conversationContainer.querySelectorAll('[role="status"]').length, 0);
  assert.equal(composer.dataset.generating, "true");
  assert.ok(conversationContainer.querySelector('button[aria-label="停止生成"]'));
  // The final-looking text must not keep a status while transport cleanup is pending.
  await act(async () => useAppStore.setState({ chatMessages: [userMessage, { ...assistantMessage, text: "这是 **重点**。回复正文已输出。" }] }));
  assert.equal(conversationStatus(), null);
  await act(async () => useAppStore.setState({ chatLoading: false }));
  assert.equal(conversationStatus(), null);
  assert.match(conversationContainer.querySelector('.chat-markdown').textContent, /重点/);
  await act(async () => useAppStore.setState({ chatLoading: true }));
  await act(async () => conversationContainer.querySelector('button[aria-label="停止生成"]').click());
  assert.equal(stoppedMessages, 1);
  assert.equal(conversationStatus(), null);
  assert.match(conversationContainer.querySelector('.chat-markdown').textContent, /重点/);
  assert.equal(conversationContainer.querySelector('.chat-markdown').hasAttribute('aria-busy'), false);
  assert.equal(conversationContainer.querySelector('button[aria-label="发送"]').disabled, true);
  await act(async () => useAppStore.setState({ chatLoading: true, chatMessages: [userMessage] }));
  assert.equal(conversationContainer.querySelectorAll('[role="status"]').length, 1);
  assert.equal(conversationStatus().textContent, "正在思考");
  await act(async () => useAppStore.setState({ chatLoading: false, chatMessages: [userMessage, { ...assistantMessage, text: "请求失败，请稍后重试。" }] }));
  assert.equal(conversationStatus(), null);
  assert.match(conversationContainer.querySelector('.chat-markdown').textContent, /请求失败/);
  const changeComposerInput = async (value) => act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(composerInput, value);
    composerInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  await changeComposerInput("继续解释");
  assert.equal(conversationContainer.querySelector('button[aria-label="发送"]').disabled, false);
  await act(async () => composerInput.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })));
  assert.equal(sentMessages.length, 0);
  await act(async () => composerInput.dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true })));
  await act(async () => composerInput.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
  assert.equal(sentMessages.length, 0);
  await act(async () => composerInput.dispatchEvent(new dom.window.CompositionEvent('compositionend', { bubbles: true })));
  await act(async () => composerInput.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0][0], "继续解释");
  assert.equal(sentMessages[0][1].contextScope, "current_note");
  assert.equal(sentMessages[0][2].mode, "chat");
  assert.equal(composerInput.value, "");
  const modeTrigger = conversationContainer.querySelector('.nf-chat-mode');
  await act(async () => modeTrigger.click());
  const libraryMode = conversationContainer.querySelector('[role="option"][aria-selected="false"]');
  assert.match(libraryMode.textContent, /全库搜索/);
  await act(async () => libraryMode.click());
  await changeComposerInput("全库查找");
  await act(async () => conversationContainer.querySelector('button[aria-label="发送"]').click());
  assert.equal(sentMessages[1][1].contextScope, "knowledge_base");
  assert.equal(sentMessages[1][2].mode, "ask_notes");
  const removeNoteReference = conversationContainer.querySelector('button[aria-label="移除当前笔记引用"]');
  assert.ok(removeNoteReference);
  await act(async () => removeNoteReference.click());
  assert.equal(conversationContainer.querySelector('button[aria-label="移除当前笔记引用"]'), null);
  const chatSource = { noteId: note.id, noteTitle: "组件测试笔记", sectionId: "ui-section", sectionTitle: "重点章节", sectionPath: ["重点章节"], chunkId: null, sourceType: "note", snippet: "合成引用", score: 1 };
  const attachedSelection = { text: "合成选中原文".repeat(20), noteId: note.id, noteTitle: "组件测试笔记" };
  await act(async () => useAppStore.setState({ chatMessages: [{ ...userMessage, attachedSelection }, { ...assistantMessage, text: "参考原文【1】", sources: [chatSource] }], chatSelection: attachedSelection }));
  assert.match(conversationContainer.textContent, /参考 · 1 篇笔记 · 1 处原文/);
  await act(async () => conversationContainer.querySelector('[data-chat-citation="1"]').click());
  assert.deepEqual(openedChatSources, [chatSource]);
  await act(async () => conversationContainer.querySelector('.nf-chat-message--user button').click());
  assert.ok(conversationContainer.querySelector('.nf-chat-message--user p.max-h-44'));
  assert.ok(Array.from(conversationContainer.querySelectorAll('button')).find(button => button.textContent.trim() === "补充理解"));
  await act(async () => modeTrigger.click());
  await act(async () => conversationContainer.querySelector('[role="option"][aria-selected="false"]').click());
  await changeComposerInput("解释引用");
  await act(async () => conversationContainer.querySelector('button[aria-label="发送"]').click());
  assert.equal(sentMessages[2][1].contextScope, "selection");
  assert.equal(sentMessages[2][1].selectedText, attachedSelection.text);
  assert.equal(conversationContainer.querySelector('button[aria-label="移除选中文字引用"]'), null);

  const historyCalls = [];
  await act(async () => useAppStore.setState({
    agentSessionId: "history-current",
    chatSessions: [
      { id: "history-current", title: "当前对话", updatedAt: new Date().toISOString() },
      { id: "history-other", title: "历史对话", updatedAt: new Date().toISOString() },
    ],
    async renameChatSession(id, title) { historyCalls.push(["rename", id, title]); },
    async switchChatSession(id) { historyCalls.push(["switch", id]); },
    async deleteChatSession(id) { historyCalls.push(["delete", id]); },
  }));
  const historyTrigger = conversationContainer.querySelector('button[aria-haspopup="menu"]');
  await act(async () => historyTrigger.click());
  const historyMenu = conversationContainer.querySelector('.nf-history-menu');
  assert.ok(historyMenu);
  assert.equal(historyMenu.querySelectorAll('.nf-history-row').length, 2);
  const renameHistory = historyMenu.querySelector('button[aria-label="重命名历史对话"]');
  renameHistory.focus();
  assert.equal(document.activeElement === renameHistory, true);
  assert.equal(renameHistory.classList.contains('nf-history-action'), true);
  assert.equal(renameHistory.closest('.nf-history-row').querySelectorAll('.nf-history-action').length, 2, "actions stay inline");
  await act(async () => renameHistory.click());
  const renameHistoryInput = historyMenu.querySelector('.nf-history-rename');
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(renameHistoryInput, "修改后的对话");
    renameHistoryInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  await act(async () => historyMenu.querySelector('button[aria-label="保存名称"]').click());
  assert.deepEqual(historyCalls, [["rename", "history-other", "修改后的对话"]]);
  await act(async () => historyMenu.querySelector('button[aria-label="删除历史对话"]').click());
  assert.equal(historyCalls.length, 1, "deletion still requires confirmation");
  const historyDeleteDialog = conversationContainer.querySelector('[role="dialog"][aria-label="删除对话"]');
  assert.ok(historyDeleteDialog);
  await act(async () => Array.from(historyDeleteDialog.querySelectorAll('button')).find(button => button.textContent === "取消").click());
  await act(async () => historyMenu.querySelector('.nf-history-name').dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.equal(historyTrigger.getAttribute('aria-expanded'), "false");
  assert.equal(document.activeElement === historyTrigger, true);
  assert.equal(historyMenu.hasAttribute('inert'), true);
  await act(async () => historyTrigger.click());
  await act(async () => Array.from(conversationContainer.querySelectorAll('.nf-history-name')).find(button => button.textContent === "历史对话").click());
  assert.deepEqual(historyCalls.at(-1), ["switch", "history-other"]);
  await act(async () => conversationRoot.unmount()); conversationContainer.remove();
  useAppStore.setState(beforeConversation, true);

  const loginHtml = await renderClient(
    React.createElement(LoginPage, {
      onSignIn: async () => {},
      onEmailCodeSignIn: async () => {},
      onSignUp: async () => {},
    }),
  );
  assert.match(loginHtml, /登录 NoteFlow/);
  assert.match(loginHtml, /欢迎回来/);
  assert.match(loginHtml, /选择登录或注册/);
  assert.match(loginHtml, /注册/);
  assert.match(loginHtml, /密码登录/);
  assert.match(loginHtml, /获取验证码/);

  const metadataHtml = await renderClient(React.createElement(NoteMetadataControls, { note }));
  assert.match(metadataHtml, /测试/);
  assert.match(metadataHtml, /前端/);
  assert.match(metadataHtml, /已收藏/);

  useAppStore.setState({
    centerMode: "edit",
    chatLoading: false,
    activeEditPreview: {
      id: "edit-test-1",
      noteId: note.id,
      targetType: "note",
      sectionId: null,
      oldContent: "第一行\n旧内容",
      newContent: "第一行\n新内容",
      instruction: "更新第二行",
      changeSummary: ["替换第二行"],
      status: "preview",
      createdAt: null,
      updatedAt: null,
      appliedAt: null,
      cancelledAt: null,
    },
  });
  const editHtml = await renderClient(React.createElement(EditPreviewWorkspace));
  assert.match(editHtml, /修改预览/);
  assert.match(editHtml, /旧内容/);
  assert.match(editHtml, /新内容/);
  assert.match(editHtml, /应用修改/);

  useAppStore.setState({
    treeData: [note],
    fileContents: { [note.id]: note.content },
    selectedFileId: note.id,
    deletedNotes: [],
  });
  const directoryContainer = document.createElement("div");
  traceFrontend("directory");
  document.body.appendChild(directoryContainer);
  const directoryRoot = createRoot(directoryContainer);
  let directoryPinnedChange = null;
  await act(async () => {
    directoryRoot.render(React.createElement(DirectoryTree, {
      pinned: true,
      onPinnedChange(value) { directoryPinnedChange = value; },
      themeMode: "light",
      onThemeModeChange() {},
      userEmail: "test@example.com",
      userName: "测试用户",
      onSignOut() {},
    }));
  });
  const activeFileButton = directoryContainer.querySelector('button[aria-current="page"]');
  assert.ok(activeFileButton);
  assert.ok(activeFileButton.classList.contains("directory-node-open"));
  assert.equal(activeFileButton.closest(".directory-node-row").dataset.selected, "true");
  assert.equal(activeFileButton.getAttribute("aria-label"), "组件测试笔记");
  assert.equal(activeFileButton.getAttribute("title"), "组件测试笔记");
  assert.equal(activeFileButton.querySelector("span[aria-hidden]"), null);
  assert.ok(activeFileButton.closest(".directory-node-row")
    .querySelector(".file-node-menu-button").classList.contains("opacity-100"));
  assert.match(directoryContainer.textContent ?? "", /目录1 篇/);
  assert.doesNotMatch(directoryContainer.textContent ?? "", /\d+\s*个文件夹/);
  const accountFooter = directoryContainer.querySelector('[data-account-footer]');
  assert.ok(accountFooter);
  assert.doesNotMatch(accountFooter.className, /border/);
  const searchButton = directoryContainer.querySelector('button[aria-label="搜索全部笔记"]');
  const collapseButton = directoryContainer.querySelector('button[aria-label="收起目录"]');
  assert.ok(searchButton);
  assert.ok(collapseButton);
  const assertIcon = (button, iconClass, size, weight) => {
    const icon = button.querySelector(`svg.${iconClass}`);
    assert.ok(icon);
    assert.equal(icon.getAttribute("width"), String(size));
    assert.equal(icon.getAttribute("height"), String(size));
    assert.equal(icon.getAttribute("stroke-width"), String(weight));
    assert.equal(icon.getAttribute("aria-hidden"), "true");
    return icon;
  };
  assertIcon(searchButton, "lucide-search", 17, 1.8);
  const collapseIcon = assertIcon(collapseButton, "sidebar-toggle-icon", 18, 1.6);
  assert.equal(collapseIcon.querySelectorAll("rect").length, 1);
  assert.equal(collapseIcon.querySelectorAll("path").length, 1);
  assert.equal(collapseIcon.querySelector("path").getAttribute("d"), "M9 3v18");
  assert.deepEqual(
    Array.from(searchButton.parentElement.querySelectorAll("button"))
      .map((button) => button.getAttribute("aria-label")),
    ["搜索全部笔记", "新建", "收起目录"],
    "directory actions must use the same search / new / collapse order for DOM and keyboard navigation"
  );
  assert.ok(collapseButton.parentElement.classList.contains("ml-1"));
  await act(async () => {
    collapseButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.equal(directoryPinnedChange, false);
  const newButton = directoryContainer.querySelector('button[aria-label="新建"]');
  assert.ok(newButton);
  assertIcon(newButton, "lucide-plus", 19, 1.8);
  await act(async () => {
    newButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.deepEqual(Array.from(directoryContainer.querySelector('.nf-new-menu[data-open="true"]').querySelectorAll('button')).map(button => button.textContent.trim()), ["新建笔记", "新建文件夹"]);
  await act(async () => {
    searchButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.equal(newButton.getAttribute("aria-expanded"), "false");
  assert.ok(document.querySelector('input[aria-label="搜索全部笔记"]'));
  await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
    key: "Escape", bubbles: true,
  })));
  assert.equal(document.querySelector('.nf-library-search').hasAttribute('inert'), true);
  await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 160)); });
  assert.equal(Boolean(document.querySelector('input[aria-label="搜索全部笔记"]')), false);
  await act(async () => {
    newButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  const newFolderButton = Array.from(directoryContainer.querySelectorAll("button"))
    .find((button) => button.textContent?.includes("新建文件夹"));
  assert.ok(newFolderButton);
  await act(async () => {
    newFolderButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.match(directoryContainer.textContent ?? "", /确认后才会创建/);
  assert.ok(directoryContainer.querySelector('[role="dialog"][aria-labelledby="new-folder-title"]'));
  const closeNewFolder = directoryContainer.querySelector('button[aria-label="关闭新建文件夹"]');
  assert.ok(closeNewFolder);
  await act(async () => {
    closeNewFolder.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  const fileMenu = directoryContainer.querySelector('button[aria-label="文件操作"]');
  assert.ok(fileMenu);
  await act(async () => {
    fileMenu.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.deepEqual(Array.from(directoryContainer.querySelector('.nf-action-menu[data-open="true"]').querySelectorAll('button')).map(button => button.textContent.trim()), ["重命名", "移动到", "导出", "置顶", "取消收藏", "删除"]);
  let moveButton = Array.from(directoryContainer.querySelectorAll("button"))
    .find((button) => button.textContent?.trim() === "移动到");
  assert.ok(moveButton);
  await act(async () => {
    document.body.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true }));
  });
  moveButton = Array.from(directoryContainer.querySelectorAll("button"))
    .find((button) => button.textContent?.trim() === "移动到" && !button.closest('[inert]'));
  assert.equal(moveButton, undefined);
  await act(async () => {
    fileMenu.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  moveButton = Array.from(directoryContainer.querySelectorAll("button"))
    .find((button) => button.textContent?.trim() === "移动到");
  assert.ok(moveButton);
  await act(async () => {
    moveButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.match(directoryContainer.textContent ?? "", /选择目标位置/);
  assert.ok(directoryContainer.querySelector('[role="dialog"][aria-labelledby="move-item-title"]'));
  await act(async () => directoryRoot.unmount());
  directoryContainer.remove();

  // Row appearance must not couple disclosure, note opening or menu actions.
  const nestedNote = { ...note, pinned: true };
  const folder = { id: "row-folder", type: "folder", name: "全栈开发", children: [nestedNote] };
  useAppStore.setState({
    treeData: [folder], selectedFileId: nestedNote.id,
    expandedFolderIds: new Set([folder.id]),
  });
  const rowContainer = document.createElement("div");
  traceFrontend("directory-rows");
  document.body.appendChild(rowContainer);
  const rowRoot = createRoot(rowContainer);
  let fileOpenCalls = 0;
  await act(async () => rowRoot.render(React.createElement(DirectoryTree, {
    pinned: true, onPinnedChange() {}, themeMode: "light", onThemeModeChange() {},
    userEmail: "test@example.com", userName: "测试用户", onSignOut() {},
    onFileOpen() { fileOpenCalls++; },
  })));
  const selectedRow = rowContainer.querySelector('[data-selected="true"]');
  assert.equal(selectedRow.style.marginLeft, "12px");
  assert.ok(selectedRow.querySelector('svg[aria-label="已置顶"]'));
  assert.ok(selectedRow.querySelector('svg[aria-label="已收藏"]'));
  const folderArrow = rowContainer.querySelector('button[aria-label="收起全栈开发"]');
  const rowFolderMore = folderArrow.closest('.directory-node-row').querySelector('button[aria-label="文件操作"]');
  await act(async () => rowFolderMore.click());
  const folderMenu = rowContainer.querySelector('.nf-action-menu[data-open="true"]');
  assert.deepEqual(Array.from(folderMenu.querySelectorAll('button')).map(button => button.textContent.trim()), ["重命名", "移动到", "置顶", "删除"]);
  await act(async () => folderMenu.querySelector('button').dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.equal(document.activeElement === rowFolderMore, true);
  await act(async () => folderArrow.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  assert.equal(rowContainer.querySelector('[aria-current="page"]'), null);
  assert.equal(useAppStore.getState().selectedFileId, nestedNote.id);
  assert.equal(fileOpenCalls, 0);
  const folderOpen = rowContainer.querySelector('.directory-node-row[data-folder] .directory-node-open');
  assert.equal(folderOpen.getAttribute("aria-expanded"), "false");
  await act(async () => folderOpen.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  await act(async () => rowContainer.querySelector('[aria-current="page"]')
    .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  assert.equal(fileOpenCalls, 1);
  const rowMenu = rowContainer.querySelector('[data-selected] .file-node-menu-button');
  await act(async () => rowMenu.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  assert.equal(rowMenu.closest('.directory-node-row').dataset.menuOpen, "true");
  assert.equal(fileOpenCalls, 1);
  const rename = Array.from(rowContainer.querySelector('.nf-action-menu[data-open="true"]').querySelectorAll('button'))
    .find(button => button.textContent?.trim() === "重命名");
  await act(async () => rename.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  const renameInput = rowContainer.querySelector('.directory-node-open input');
  assert.equal(renameInput.value, "组件测试笔记");
  await act(async () => renameInput.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.equal(rowContainer.querySelector('.directory-node-open input'), null);
  assert.equal(useAppStore.getState().treeData[0].children[0].name, note.name);
  await act(async () => rowRoot.unmount());
  rowContainer.remove();

  useAppStore.setState({
    treeData: [],
    fileContents: {},
    selectedFileId: null,
    deletedNotes: [],
  });
  const emptyDirectoryContainer = document.createElement("div");
  document.body.appendChild(emptyDirectoryContainer);
  const emptyDirectoryRoot = createRoot(emptyDirectoryContainer);
  await act(async () => {
    emptyDirectoryRoot.render(React.createElement(DirectoryTree, {
      pinned: true,
      onPinnedChange() {},
      themeMode: "light",
      onThemeModeChange() {},
      userEmail: "test@example.com",
      userName: "测试用户",
      onSignOut() {},
    }));
  });
  assert.match(emptyDirectoryContainer.textContent ?? "", /还没有笔记/);
  assert.ok(
    Array.from(emptyDirectoryContainer.querySelectorAll("button"))
      .some((button) => button.textContent?.includes("新建第一篇笔记"))
  );
  await act(async () => emptyDirectoryRoot.unmount());
  emptyDirectoryContainer.remove();

  useAppStore.setState({
    treeData: [note],
    fileContents: { [note.id]: note.content },
    selectedFileId: note.id,
    deletedNotes: [],
  });
  const collapsedDirectoryContainer = document.createElement("div");
  document.body.appendChild(collapsedDirectoryContainer);
  const collapsedDirectoryRoot = createRoot(collapsedDirectoryContainer);
  await act(async () => {
    collapsedDirectoryRoot.render(React.createElement(DirectoryTree, {
      pinned: false,
      onPinnedChange() {},
      themeMode: "light",
      onThemeModeChange() {},
      userEmail: "test@example.com",
      userName: "测试用户",
      onSignOut() {},
    }));
  });
  assert.ok(collapsedDirectoryContainer.querySelector('button[aria-label="展开目录"]'));
  assertIcon(collapsedDirectoryContainer.querySelector('button[aria-label="展开目录"]'), "sidebar-toggle-icon", 18, 1.6);
  assert.equal(
    (collapsedDirectoryContainer.textContent ?? "").includes("组件测试笔记"),
    false
  );
  await act(async () => collapsedDirectoryRoot.unmount());
  collapsedDirectoryContainer.remove();

  // One footer entry and one modal workspace preserve the real service contracts.
  let signOutCalls = 0, changedSession = null, restoredId = null;
  const accountStore = useAppStore.getState();
  const apiCalls = [];
  let failSessions = false, failMemorySetting = false;
  const sessionFixture = (id, current) => ({ id, current, userAgent: "Chrome/130 Mac OS X", ipAddress: null, createdAt: "2026-01-01T00:00:00Z", lastSeenAt: "2026-01-01T00:00:00Z", expiresAt: "2027-01-01T00:00:00Z" });
  const memoryFixture = { id: "memory-ui-test", memoryType: "preference", content: "偏好简洁排版", layer: "semantic", importance: 3, status: "pending" };
  const accountFetch = async (input, options = {}) => {
    const path = new URL(String(input), "http://127.0.0.1").pathname;
    const method = options.method ?? "GET";
    const payload = options.body ? JSON.parse(options.body) : null;
    apiCalls.push({ path, method, payload });
    let data = {}, status = 200;
    if (path === "/api/settings") {
      if (method === "PUT" && failMemorySetting) { status = 500; data = { detail: "保存设置失败" }; }
      else data = { settings: { memoryEnabled: payload?.memoryEnabled ?? true, preferences: {} } };
    } else if (path === "/api/auth/sessions") {
      if (failSessions) { status = 500; data = { detail: "设备加载失败" }; }
      else data = [sessionFixture("other-device", false), sessionFixture("current-device", true)];
    } else if (path.startsWith("/api/auth/sessions/")) data = { currentSessionRevoked: path.endsWith("/current-device") };
    else if (path.endsWith("/email-change/request")) data = { message: "验证码已发送", developmentCode: "123456" };
    else if (path.endsWith("/email-change/confirm")) data = { user: { id: "test-user", email: "test@example.com", displayName: "test", emailVerified: true } };
    else if (path === "/api/memories") data = { memories: [memoryFixture] };
    else if (path === "/api/memories/memory-ui-test") data = { memory: { ...memoryFixture, ...payload, status: method === "DELETE" ? "deleted" : payload?.status ?? "active" } };
    return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  };
  globalThis.fetch = window.fetch = accountFetch;
  const importCalls = [], selectCalls = [];
  useAppStore.setState({ deletedNotes: [{ id: "trash-test", title: "待恢复笔记", deletedAt: null }], restoreDeletedNote(id) { restoredId = id; }, addNode(parent, node) { importCalls.push({ parent, node }); }, setSelectedFileId(id) { selectCalls.push(id); } });
  const accountContainer = document.createElement("div");
  traceFrontend("account");
  document.body.appendChild(accountContainer);
  const accountRoot = createRoot(accountContainer);
  const accountProps = { themeMode: "light", onThemeModeChange(mode) { themeCalls.push(mode); }, userEmail: "test@example.com", userName: "test", userEmailVerified: true, trashCount: 1, onEmailChanged(session) { changedSession = session; }, onSignOut() { signOutCalls += 1; } };
  const themeCalls = [];
  const clickAccount = async (button) => { assert.ok(button); await act(async () => button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))); };
  const activeSettings = () => document.querySelector('.nf-overlay[data-open="true"] [role="dialog"][aria-label="设置"]');
  const accountPanel = () => accountContainer.querySelector('.nf-account-popover[data-open="true"]');
  const action = (scope, label) => Array.from(scope?.querySelectorAll("button") ?? []).find(b => b.textContent.trim() === label);
  const settingAction = label => action(activeSettings(), label);
  const waitExit = async () => { await act(async () => new Promise(resolve => setTimeout(resolve, 210))); };
  await act(async () => accountRoot.render(React.createElement(AccountMenu, accountProps)));
  const accountTrigger = accountContainer.querySelector('button[aria-label="test的账号菜单"]');
  assert.ok(accountTrigger);
  assert.equal(accountContainer.querySelectorAll("button").length, 1);
  assert.equal(accountTrigger.querySelector(".nf-username").textContent, "test");
  assert.equal(accountTrigger.querySelector(".nf-avatar").textContent, "T");
  assert.equal(accountTrigger.querySelector("svg"), null);
  assert.equal(accountContainer.querySelector('[title]'), null);
  assert.doesNotMatch(accountContainer.textContent, /test@example.com|我的账号/);
  await clickAccount(accountTrigger.querySelector(".nf-username"));
  assert.equal(document.activeElement, action(accountPanel(), "设置"));
  assert.equal(accountTrigger.getAttribute("aria-controls"), accountPanel().id);
  assert.equal(accountPanel().querySelectorAll("button").length, 3);
  assert.equal(accountPanel().querySelector('[title]'), null);
  assert.equal(accountPanel().querySelector('.nf-divider'), null);
  assert.ok(action(accountPanel(), "退出登录").classList.contains("nf-account-signout"));
  assert.doesNotMatch(accountPanel().textContent, /登录邮箱|登录设备|test@example.com/);
  await act(async () => document.body.dispatchEvent(new dom.window.FocusEvent("focusin", { bubbles: true })));
  assert.ok(accountPanel());
  await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true })));
  assert.ok(accountPanel());
  await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.equal(accountPanel(), null);
  assert.equal(document.activeElement, accountTrigger);
  assert.ok(accountContainer.querySelector('.nf-account-popover[data-open="false"]'));
  assert.equal(accountContainer.querySelector(".nf-account-popover").hasAttribute("inert"), true);
  await waitExit();
  assert.equal(accountContainer.querySelector(".nf-account-popover"), null);
  await clickAccount(accountTrigger);
  await act(async () => document.body.dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true })));
  assert.equal(accountPanel(), null);
  await waitExit();
  await clickAccount(accountTrigger);
  const outsideButton = document.createElement("button"); document.body.appendChild(outsideButton);
  await act(async () => outsideButton.focus());
  assert.equal(accountPanel(), null);
  outsideButton.remove(); await waitExit();

  await clickAccount(accountTrigger);
  await clickAccount(action(accountPanel(), "设置"));
  assert.ok(activeSettings());
  assert.equal(accountPanel(), null);
  assert.equal(accountContainer.inert, true);
  assert.equal(document.activeElement.getAttribute("aria-label"), "关闭设置");
  assert.equal(activeSettings().querySelector('.nf-identity [title]'), null);
  const firstNav = settingAction("账号与安全");
  await act(async () => firstNav.focus());
  await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true })));
  assert.ok(document.activeElement === Array.from(activeSettings().querySelectorAll("button")).at(-1));
  await clickAccount(Array.from(activeSettings().querySelectorAll("button")).find(b => b.textContent.includes("登录邮箱")));
  assert.equal(activeSettings().querySelector('input[type="email"]').value, "test@example.com");
  await clickAccount(settingAction("发送验证码"));
  assert.equal(activeSettings().querySelector('input[aria-label="邮箱验证码"]').value, "123456");
  await clickAccount(settingAction("确认并绑定"));
  assert.equal(changedSession.user.email, "test@example.com");
  assert.ok(apiCalls.some(call => call.path.endsWith("/email-change/confirm") && call.payload.code === "123456"));
  assert.equal(activeSettings().querySelector('input[type="email"]'), null);
  await clickAccount(Array.from(activeSettings().querySelectorAll("button")).find(b => b.textContent.includes("登录设备")));
  assert.match(activeSettings().textContent, /有效会话|当前设备/);
  const sessionExits = () => Array.from(activeSettings().querySelectorAll(".nf-device button"));
  await clickAccount(sessionExits()[0]);
  assert.equal(sessionExits().length, 1);
  await clickAccount(sessionExits()[0]);
  assert.equal(signOutCalls, 1);
  failSessions = true;
  await clickAccount(settingAction("刷新"));
  assert.match(activeSettings().querySelector('[role="alert"]').textContent, /设备加载失败/);
  failSessions = false;

  await clickAccount(settingAction("外观")); await clickAccount(settingAction("深色"));
  assert.deepEqual(themeCalls, ["dark"]);
  await clickAccount(settingAction("AI 与记忆"));
  failMemorySetting = true;
  await clickAccount(activeSettings().querySelector('button[aria-label="长期记忆"]'));
  assert.equal(activeSettings().querySelector('button[aria-label="长期记忆"]').getAttribute("aria-pressed"), "true");
  assert.match(activeSettings().textContent, /保存设置失败/);
  failMemorySetting = false;
  await clickAccount(activeSettings().querySelector('button[aria-label="长期记忆"]'));
  assert.equal(activeSettings().querySelector('button[aria-label="长期记忆"]').getAttribute("aria-pressed"), "false");
  await clickAccount(Array.from(activeSettings().querySelectorAll("button")).find(b => b.textContent.includes("记忆管理")));
  assert.match(activeSettings().textContent, /偏好简洁排版/);
  await clickAccount(settingAction("确认"));
  assert.ok(apiCalls.some(call => call.payload?.reason === "profile_memory_approve"));
  await clickAccount(activeSettings().querySelector('button[aria-label="编辑记忆"]'));
  assert.ok(activeSettings().querySelector('textarea[aria-label="记忆内容"]'));
  await clickAccount(activeSettings().querySelector('button[aria-label="保存记忆"]'));
  assert.ok(apiCalls.some(call => call.payload?.reason === "profile_memory_edit"));
  await clickAccount(activeSettings().querySelector('button[aria-label="删除记忆"]'));
  assert.doesNotMatch(activeSettings().textContent, /偏好简洁排版/);
  await clickAccount(settingAction("数据管理"));
  assert.ok(settingAction("导出笔记备份")); assert.ok(settingAction("导出完整数据"));
  const downloads = [];
  const originalCreateUrl = URL.createObjectURL, originalRevokeUrl = URL.revokeObjectURL;
  const originalLinkClick = dom.window.HTMLAnchorElement.prototype.click;
  URL.createObjectURL = blob => { downloads.push({ type: blob.type, size: blob.size }); return "blob:test-export"; };
  URL.revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = function () { downloads[downloads.length - 1].name = this.download; };
  await clickAccount(settingAction("导出笔记备份"));
  await clickAccount(settingAction("导出完整数据"));
  assert.match(downloads[0].name, /\.zip$/); assert.ok(downloads[0].size > 0);
  assert.match(downloads[1].name, /\.json$/); assert.ok(downloads[1].size > 0);
  URL.createObjectURL = originalCreateUrl; URL.revokeObjectURL = originalRevokeUrl;
  dom.window.HTMLAnchorElement.prototype.click = originalLinkClick;
  const importInput = activeSettings().querySelector('input[type="file"]');
  assert.ok(importInput.multiple && importInput.accept.includes(".zip"));
  Object.defineProperty(importInput, "files", { configurable: true, value: [{ name: "导入验证.md", text: async () => "# 导入验证\n\n测试正文" }] });
  await act(async () => importInput.dispatchEvent(new dom.window.Event("change", { bubbles: true })));
  assert.equal(importCalls.length, 1);
  assert.equal(selectCalls[0], importCalls[0].node.id);
  assert.match(activeSettings().textContent, /已导入 1 篇笔记/);
  await clickAccount(settingAction("回收站"));
  assert.match(activeSettings().textContent, /待恢复笔记/);
  await clickAccount(activeSettings().querySelector('button[aria-label="恢复 待恢复笔记"]'));
  assert.equal(restoredId, "trash-test");
  await clickAccount(settingAction("数据管理"));
  assert.ok(settingAction("导入笔记文件"));
  await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true })));
  assert.ok(activeSettings());
  await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.equal(activeSettings(), null);
  assert.equal(document.activeElement, accountTrigger);
  assert.equal(accountContainer.inert, undefined);
  await waitExit();
  assert.equal(document.querySelector(".nf-overlay"), null);
  await clickAccount(accountTrigger);
  await clickAccount(Array.from(accountPanel().querySelectorAll("button")).find(b => b.textContent.startsWith("回收站")));
  assert.equal(activeSettings().querySelector("h2").textContent, "回收站");
  await clickAccount(activeSettings().querySelector('button[aria-label="关闭设置"]'));
  await waitExit();
  await clickAccount(accountTrigger);
  await clickAccount(action(accountPanel(), "退出登录"));
  assert.equal(signOutCalls, 2);
  await act(async () => accountRoot.unmount()); accountContainer.remove();

  const compactAccountContainer = document.createElement("div"); document.body.appendChild(compactAccountContainer);
  const compactAccountRoot = createRoot(compactAccountContainer);
  await act(async () => compactAccountRoot.render(React.createElement(AccountMenu, { ...accountProps, compact: true, themeMode: "dark", userName: "测试用户" })));
  const compactTrigger = compactAccountContainer.querySelector('button[aria-label="测试用户的账号菜单"]');
  assert.equal(compactAccountContainer.querySelectorAll("button").length, 1);
  assert.equal(compactTrigger.querySelector(".nf-username"), null);
  assert.equal(compactTrigger.hasAttribute("title"), false);
  await clickAccount(compactTrigger);
  assert.match(compactAccountContainer.textContent, /测试用户/);
  assert.equal(compactAccountContainer.querySelector('[title]'), null);
  assert.equal(compactAccountContainer.querySelector(".nf-settings-system").dataset.theme, "dark");
  await act(async () => compactAccountRoot.unmount()); compactAccountContainer.remove();
  const fallbackContainer = document.createElement("div"); document.body.appendChild(fallbackContainer);
  const fallbackRoot = createRoot(fallbackContainer);
  await act(async () => fallbackRoot.render(React.createElement(AccountMenu, { ...accountProps, userName: "12345@example.com", userEmail: "12345@example.com" })));
  assert.ok(fallbackContainer.querySelector('.nf-avatar svg.lucide-user-round'));
  assert.doesNotMatch(fallbackContainer.textContent, /@example.com/);
  const longName = "一个很长的真实用户名需要在弹出菜单中完整呈现而不是依赖悬停小框";
  await act(async () => fallbackRoot.render(React.createElement(AccountMenu, { ...accountProps, userName: longName })));
  const longNameTrigger = fallbackContainer.querySelector('.nf-account-trigger');
  assert.equal(longNameTrigger.getAttribute("aria-label"), longName + "的账号菜单");
  assert.equal(longNameTrigger.querySelector('.nf-username').textContent, longName);
  await clickAccount(longNameTrigger);
  assert.equal(fallbackContainer.querySelector('.nf-account-heading .nf-username').textContent, longName);
  assert.equal(fallbackContainer.querySelector('[title]'), null);
  await act(async () => fallbackRoot.unmount()); fallbackContainer.remove();
  globalThis.fetch = window.fetch = testFetch;
  useAppStore.setState(accountStore, true);

  // Delete confirmations stay note-scoped; never mutate a real workspace in these tests.
  const deleteCalls = [];
  const deleteFolder = { id: "delete-folder", name: "待删文件夹", type: "folder", children: [] };
  useAppStore.setState({ treeData: [note, deleteFolder], fileContents: { [note.id]: note.content }, deleteNode(id) { deleteCalls.push(id); } });
  const deleteContainer = document.createElement("div"); document.body.appendChild(deleteContainer);
  const deleteRoot = createRoot(deleteContainer);
  await act(async () => deleteRoot.render(React.createElement(DirectoryTree, { ...accountProps, pinned: true, onPinnedChange() {} })));
  const confirmDialog = () => document.querySelector('.nf-overlay[data-open="true"] [role="alertdialog"]');
  const deleteMore = label => deleteContainer.querySelector('button[aria-label="' + label + '"]').closest('.directory-node-row').querySelector('button[aria-label="文件操作"]');
  const noteMore = deleteMore("组件测试笔记");
  await clickAccount(noteMore);
  await clickAccount(action(noteMore.closest('[data-file-menu-root]'), "删除"));
  assert.match(confirmDialog().textContent, /笔记将移至回收站，可随时恢复/);
  assert.equal(document.activeElement.textContent, "取消");
  await clickAccount(action(confirmDialog(), "取消"));
  assert.deepEqual(deleteCalls, []); assert.ok(document.activeElement === noteMore);
  await waitExit();
  await clickAccount(noteMore); await clickAccount(action(noteMore.closest('[data-file-menu-root]'), "删除"));
  await clickAccount(action(confirmDialog(), "移至回收站"));
  assert.deepEqual(deleteCalls, [note.id]); await waitExit();
  const folderMore = deleteMore("待删文件夹");
  await clickAccount(folderMore); await clickAccount(action(folderMore.closest('[data-file-menu-root]'), "删除"));
  assert.match(confirmDialog().textContent, /所有子文件和内容也会一起删除/);
  assert.doesNotMatch(confirmDialog().textContent, /可随时恢复/);
  assert.ok(action(confirmDialog(), "删除文件夹"));
  await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.deepEqual(deleteCalls, [note.id]); assert.ok(document.activeElement === folderMore);
  await waitExit(); await act(async () => deleteRoot.unmount()); deleteContainer.remove();
  useAppStore.setState(accountStore, true);

  const searchCalls = [];
  traceFrontend("search-regressions");
  let searchCloseCalls = 0;
  let selectedSearchSource = null;
  const searchNotesStub = async (query, options) => {
    searchCalls.push({ query, options });
    return {
      query: {
        originalQuery: query,
        searchQuery: query,
        intent: "lookup",
        scopeHint: "library",
        terms: [query],
        rewrittenQueries: [query],
      },
      results: [
        {
          noteId: note.id,
          noteTitle: "组件测试笔记",
          sectionId: "section-test-1",
          sectionTitle: "输入法",
          chunkId: null,
          sourceType: "section_heading",
          snippet: "中文输入法",
          score: 10,
          retrievalChannels: ["heading"],
        },
        {
          noteId: note.id,
          noteTitle: "组件测试笔记",
          sectionId: "section-test-2",
          sectionTitle: "防抖",
          chunkId: "chunk-test-2",
          sourceType: "chunk_content",
          snippet: "中文输入法的第二处命中",
          score: 9,
          retrievalChannels: ["content"],
        },
      ],
    };
  };
  const searchDialogContainer = document.createElement("div");
  document.body.appendChild(searchDialogContainer);
  const searchDialogRoot = createRoot(searchDialogContainer);
  await act(async () => {
    searchDialogRoot.render(React.createElement(LibrarySearchDialog, {
      open: true,
      treeData: [note],
      onClose() {
        searchCloseCalls += 1;
      },
      onSelect(source) {
        selectedSearchSource = source;
      },
      searchNotesFn: searchNotesStub,
    }));
  });
  const searchInput = document.querySelector('input[aria-label="搜索全部笔记"]');
  assert.ok(searchInput);

  await act(async () => {
    searchInput.dispatchEvent(new dom.window.CompositionEvent("compositionstart", {
      bubbles: true,
      data: "zhong",
    }));
  });
  await act(async () => {
    document.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
      bubbles: true,
      key: "Escape",
    }));
  });
  assert.equal(searchCloseCalls, 0);
  await act(async () => {
    searchInput.value = "zhong";
    searchInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 380));
  });
  assert.equal(searchCalls.length, 0);

  await act(async () => {
    searchInput.value = "中文";
    searchInput.dispatchEvent(new dom.window.CompositionEvent("compositionend", {
      bubbles: true,
      data: "中文",
    }));
  });
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 380));
  });
  assert.equal(searchCalls.length, 1);
  assert.equal(searchCalls[0].query, "中文");
  assert.equal(searchCalls[0].options.mode, "literal");
  assert.equal(searchCalls[0].options.scope, "all");
  assert.equal(document.querySelectorAll('[id^="library-search-result-"]').length, 1);
  assert.match(document.body.textContent ?? "", /另有 1 处命中/);
  const groupedResult = document.querySelector('[id^="library-search-result-"]');
  assert.ok(groupedResult);
  await act(async () => {
    groupedResult.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.equal(selectedSearchSource?.sourceType, "section_heading");
  assert.equal(searchCloseCalls, 1);
  await act(async () => searchDialogRoot.unmount());
  searchDialogContainer.remove();

  // Approved search surface with the production async lifecycle and synthetic
  // results only. No service calls, note writes, or user browser/session access.
  const searchSurfaceContainer = document.createElement("div");
  document.body.appendChild(searchSurfaceContainer);
  const searchTrigger = document.createElement("button");
  searchTrigger.textContent = "搜索入口"; document.body.appendChild(searchTrigger); searchTrigger.focus();
  const surfaceRoot = createRoot(searchSurfaceContainer);
  const pendingSearches = [];
  const surfaceSearchFn = (query, options) => new Promise((resolve, reject) => pendingSearches.push({ query, options, resolve, reject }));
  let surfaceOpen = true;
  let surfaceSelections = [];
  let surfaceCloses = 0;
  const renderSearchSurface = () => surfaceRoot.render(React.createElement(LibrarySearchDialog, {
    open: surfaceOpen, treeData: [note], searchNotesFn: surfaceSearchFn,
    onClose() { surfaceCloses++; surfaceOpen = false; renderSearchSurface(); },
    onSelect(source) { surfaceSelections.push(source); },
  }));
  const searchSurface = () => document.querySelector('.nf-library-search');
  const surfaceInput = () => searchSurface().querySelector('input');
  const setSearchQuery = async (query) => act(async () => {
    surfaceInput().value = query;
    surfaceInput().dispatchEvent(new dom.window.CompositionEvent("compositionend", { bubbles: true, data: query }));
  });
  const debounceSearch = async () => act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 380)); });
  const surfaceClick = async (element) => act(async () => element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  const surfaceKey = async (element, key, options = {}) => act(async () => element.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options })));
  const sourceA = { noteId: note.id, noteTitle: "Redis", sectionId: "section-a", sectionTitle: "缓存基础", sourceType: "chunk_content", snippet: "Redis 缓存", retrievalChannels: ["content"] };
  const sourceB = { ...sourceA, noteId: "search-note-b", noteTitle: "Python 的面试常见问题", sectionId: "section-b" };
  await act(async () => renderSearchSurface());
  await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 1)); });
  assert.equal(document.activeElement, surfaceInput());
  assert.equal(document.getElementById('root').inert, true);
  assert.equal(document.body.style.overflow, 'hidden');
  assert.equal(surfaceInput().getAttribute('aria-expanded'), 'false');
  assert.equal(searchSurface().querySelector('.nf-search-body').textContent, '输入笔记标题、章节名或正文关键词。');
  assert.equal(searchSurface().querySelectorAll('svg').length, 2);
  assert.equal(searchSurface().querySelector('.nf-search-scope').textContent, '全部');

  await setSearchQuery('Redis');
  assert.equal(searchSurface().querySelectorAll('[role="status"]').length, 1);
  assert.equal(searchSurface().querySelector('.nf-search-summary').textContent, '');
  assert.equal(pendingSearches.length, 0);
  await debounceSearch();
  assert.equal(pendingSearches.length, 1);
  assert.equal(pendingSearches[0].options.limit, 20);
  assert.equal(pendingSearches[0].options.mode, 'literal');
  assert.equal(searchSurface().querySelectorAll('[role="status"]').length, 1);
  assert.equal(searchSurface().querySelector('[role="status"]').textContent, '正在搜索…');
  await act(async () => pendingSearches[0].resolve({ results: [sourceA, { ...sourceA, sectionId: 'section-a2' }, sourceB] }));
  assert.equal(searchSurface().querySelectorAll('[role="option"]').length, 2);
  assert.equal(searchSurface().querySelector('.nf-search-summary').textContent, '2 篇笔记 · 3 处命中');
  assert.equal(searchSurface().querySelectorAll('[role="status"]').length, 0);
  assert.equal(surfaceInput().getAttribute('aria-expanded'), 'true');
  assert.match(searchSurface().textContent, /另有 1 处命中/);
  assert.ok(searchSurface().querySelector('mark'));
  await surfaceKey(surfaceInput(), 'ArrowDown');
  assert.equal(surfaceInput().getAttribute('aria-activedescendant'), 'library-search-result-1');
  const lastSearchControl = searchSurface().querySelectorAll('button')[searchSurface().querySelectorAll('button').length - 1];
  lastSearchControl.focus(); await surfaceKey(lastSearchControl, 'Tab');
  assert.equal(document.activeElement, surfaceInput());
  await surfaceKey(surfaceInput(), 'Tab', { shiftKey: true });
  assert.equal(document.activeElement, lastSearchControl);
  surfaceInput().focus(); await surfaceKey(surfaceInput(), 'Enter');
  assert.equal(surfaceSelections[0], sourceB);
  assert.equal(surfaceCloses, 1);
  assert.equal(searchSurface().hasAttribute('inert'), true);
  assert.equal(searchSurface().getAttribute('aria-hidden'), 'true');
  assert.notEqual(document.getElementById('root').inert, true);
  assert.equal(document.activeElement, searchTrigger);
  await surfaceClick(searchSurface().querySelector('[role="option"]'));
  assert.equal(surfaceSelections.length, 1, 'closing contents must not dispatch selection');
  surfaceOpen = true; await act(async () => renderSearchSurface());
  await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 160)); });
  assert.equal(searchSurface().hasAttribute('inert'), false, 'quick reopen cancels the delayed exit');
  await surfaceClick(searchSurface().querySelector('.nf-search-clear'));
  assert.equal(surfaceInput().value, '');
  assert.equal(document.activeElement, surfaceInput());
  assert.equal(surfaceInput().hasAttribute('aria-activedescendant'), false);

  const callsBeforeRace = pendingSearches.length;
  await setSearchQuery('旧查询'); await debounceSearch();
  const stale = pendingSearches[callsBeforeRace];
  await setSearchQuery('新查询');
  assert.equal(stale.options.signal.aborted, true);
  await debounceSearch();
  const current = pendingSearches[callsBeforeRace + 1];
  await act(async () => stale.resolve({ results: [sourceA] }));
  assert.equal(searchSurface().querySelectorAll('[role="option"]').length, 0);
  await act(async () => current.resolve({ results: [] }));
  assert.match(searchSurface().querySelector('[role="status"]').textContent, /没有找到“新查询”/);
  assert.equal(searchSurface().querySelector('.nf-search-summary').textContent, '0 篇笔记 · 0 处命中');
  await surfaceClick([...searchSurface().querySelectorAll('.nf-search-scope')].find((node) => node.textContent === '标题'));
  await debounceSearch();
  const titleSearch = pendingSearches.at(-1);
  assert.equal(titleSearch.options.scope, 'title');
  await act(async () => titleSearch.reject(new Error('合成网络错误')));
  assert.match(searchSurface().querySelector('[role="alert"]').textContent, /搜索没有完成.*合成网络错误.*重新搜索/);
  await surfaceClick(searchSurface().querySelector('.nf-search-retry'));
  await debounceSearch();
  assert.equal(pendingSearches.at(-1).query, '新查询');
  assert.equal(pendingSearches.at(-1).options.scope, 'title');
  await act(async () => pendingSearches.at(-1).resolve({ results: [sourceA] }));
  await surfaceClick([...searchSurface().querySelectorAll('.nf-search-scope')].find((node) => node.textContent === '正文'));
  await debounceSearch(); assert.equal(pendingSearches.at(-1).options.scope, 'content');
  await act(async () => pendingSearches.at(-1).resolve({ results: [] }));
  await setSearchQuery('<img src=x onerror=alert(1)>'); await debounceSearch();
  await act(async () => pendingSearches.at(-1).resolve({ results: [] }));
  assert.equal(searchSurface().querySelectorAll('img').length, 0);

  await act(async () => surfaceInput().dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true })));
  assert.equal(searchSurface().querySelectorAll('[role="status"]').length, 1);
  await surfaceKey(surfaceInput(), 'Escape', { isComposing: true });
  assert.equal(surfaceOpen, true);
  await surfaceClick(searchSurface().querySelector('.nf-search-close'));
  assert.equal(surfaceOpen, false);
  surfaceOpen = true; await act(async () => renderSearchSurface());
  assert.notEqual(searchSurface().querySelector('[role="status"]')?.textContent, '继续完成输入');
  await surfaceKey(surfaceInput(), 'Escape');
  assert.equal(surfaceOpen, false, 'pointer-close / quick-reopen must not keep a stale IME lock');
  surfaceOpen = true; await act(async () => renderSearchSurface());
  await setSearchQuery('关闭前查询'); await debounceSearch();
  const closingRequest = pendingSearches.at(-1);
  await surfaceKey(surfaceInput(), 'Escape');
  assert.equal(surfaceOpen, false); assert.equal(closingRequest.options.signal.aborted, true);
  assert.equal(searchSurface().querySelector('[role="status"]').textContent, '正在搜索…', 'exit freezes visual loading state');
  await act(async () => closingRequest.resolve({ results: [sourceA] }));
  await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 160)); });
  assert.equal(searchSurface(), null);
  assert.equal(document.body.style.overflow, '');
  surfaceOpen = true; await act(async () => renderSearchSurface());
  assert.equal(surfaceInput().value, '');
  assert.equal(searchSurface().querySelector('[aria-pressed="true"]').textContent, '全部');
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = () => ({ matches: true });
  await surfaceClick(searchSurface().querySelector('.nf-search-close'));
  assert.equal(searchSurface(), null, 'reduced motion closes without a delayed surface');
  window.matchMedia = originalMatchMedia;
  await act(async () => surfaceRoot.unmount()); searchSurfaceContainer.remove(); searchTrigger.remove();

  console.log(JSON.stringify({
    ok: true,
    storeAssertions: 10,
    componentAssertionGroups: 42,
    components: [
      "SoftMenu",
      "LoginPage",
      "NoteMetadataControls",
      "EditPreviewWorkspace",
      "DirectoryTree",
      "LibrarySearchDialog",
      "AccountMenu",
      "AIPanel",
    ],
    accountMenuCoverage: ["single-entry", "username", "no-native-tooltip", "username-click", "long-username", "unframed-footer-menu", "numeric-avatar-fallback", "enter-exit", "email-confirm", "devices-revoke", "device-error", "memory-CRUD", "memory-button-rollback-only", "ZIP-JSON-export", "import", "trash-restore", "modal-focus-trap", "escape-focus", "IME", "outside-pointer", "focus-leave", "sign-out", "compact", "note-folder-delete-confirm"],
    directoryRowCoverage: ["whole-row-selection", "full-name", "selected-more", "nested-indent", "pin-favorite-glyphs", "folder-disclosure", "file-open-callback", "independent-menu", "rename-cancel"],
    conversationCoverage: ["empty-wait", "whitespace-wait", "streaming-markdown", "hide-status-on-first-text", "no-status-during-transport-cleanup", "single-status", "completion", "stop-callback", "error-clears-status", "fallback-wait", "empty-send-disabled", "Enter-Shift-IME", "send-context", "library-mode", "remove-note-reference", "citation-open", "selection-expand", "selection-send"],
    softMenuCoverage: ["exit-inert", "unmount-after-exit", "quick-reopen", "reduced-motion", "Escape-focus", "IME-Escape", "file-action-order", "history-inline-actions", "history-rename-callback", "history-delete-confirmation", "history-switch-callback"],
    searchSurfaceCoverage: ["compact-initial", "single-wait", "groups-count-highlight", "keyboard-select", "focus-trap-return", "background-inert", "exit-inert-click-block", "quick-reopen", "clear", "abort-stale-response", "empty", "title-content-scope", "error-retry", "escaped-input", "IME", "IME-pointer-close-reopen", "abort-close", "frozen-exit", "reopen-reset", "reduced-motion"],
  }));
} finally {
  await vite.close();
  dom.window.close();
}
