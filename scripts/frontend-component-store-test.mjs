import assert from "node:assert/strict";

import React, { act } from "react";
import { createRoot } from "react-dom/client";
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
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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
      onSignUp: async () => {},
    }),
  );
  assert.match(loginHtml, /登录 NoteFlow/);
  assert.match(loginHtml, /忘记密码/);
  assert.match(loginHtml, /注册/);

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

  console.log(JSON.stringify({
    ok: true,
    storeAssertions: 10,
    componentAssertions: 19,
    components: ["LoginPage", "NoteMetadataControls", "EditPreviewWorkspace", "DirectoryTree"],
  }));
} finally {
  await vite.close();
  dom.window.close();
}
