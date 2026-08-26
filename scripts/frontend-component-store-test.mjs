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
  Node: dom.window.Node,
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
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const testFetch = async () => new Response(JSON.stringify({ revisions: [] }), {
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
  } = await vite.ssrLoadModule("/src/testing/frontendHarness.ts");

  const initialState = useAppStore.getInitialState();
  useAppStore.setState(initialState, true);

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

  const loginHtml = await renderClient(
    React.createElement(LoginPage, {
      onSignIn: async () => {},
      onEmailCodeSignIn: async () => {},
      onSignUp: async () => {},
    }),
  );
  assert.match(loginHtml, /登录 NoteFlow/);
  assert.match(loginHtml, /验证码登录/);
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
  document.body.appendChild(directoryContainer);
  const directoryRoot = createRoot(directoryContainer);
  await act(async () => {
    directoryRoot.render(React.createElement(DirectoryTree, {
      pinned: true,
      onPinnedChange() {},
      themeMode: "light",
      onThemeModeChange() {},
      userEmail: "test@example.com",
      userName: "测试用户",
      onSignOut() {},
    }));
  });
  const activeFileButton = directoryContainer.querySelector('button[aria-current="page"]');
  assert.ok(activeFileButton);
  assert.match(activeFileButton.className, /bg-jelly-blue-pale/);
  assert.match(directoryContainer.textContent ?? "", /目录1 篇/);
  assert.doesNotMatch(directoryContainer.textContent ?? "", /\d+\s*个文件夹/);
  assert.ok(directoryContainer.querySelector('button[aria-label="搜索全部笔记"]'));
  const newButton = directoryContainer.querySelector('button[aria-label="新建"]');
  assert.ok(newButton);
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
  let moveButton = Array.from(directoryContainer.querySelectorAll("button"))
    .find((button) => button.textContent?.trim() === "移动到");
  assert.ok(moveButton);
  await act(async () => {
    document.body.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true }));
  });
  moveButton = Array.from(directoryContainer.querySelectorAll("button"))
    .find((button) => button.textContent?.trim() === "移动到");
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
  assert.equal(
    (collapsedDirectoryContainer.textContent ?? "").includes("组件测试笔记"),
    false
  );
  await act(async () => collapsedDirectoryRoot.unmount());
  collapsedDirectoryContainer.remove();

  const searchCalls = [];
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

  console.log(JSON.stringify({
    ok: true,
    storeAssertions: 10,
    componentAssertions: 39,
    components: [
      "LoginPage",
      "NoteMetadataControls",
      "EditPreviewWorkspace",
      "DirectoryTree",
      "LibrarySearchDialog",
    ],
  }));
} finally {
  await vite.close();
  dom.window.close();
}
