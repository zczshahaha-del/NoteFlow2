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
  await act(async () => {
    searchButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.equal(newButton.getAttribute("aria-expanded"), "false");
  assert.ok(document.querySelector('input[aria-label="搜索全部笔记"]'));
  await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
    key: "Escape", bubbles: true,
  })));
  assert.equal(document.querySelector('input[aria-label="搜索全部笔记"]'), null);
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

  // Row appearance must not couple disclosure, note opening or menu actions.
  const nestedNote = { ...note, pinned: true };
  const folder = { id: "row-folder", type: "folder", name: "全栈开发", children: [nestedNote] };
  useAppStore.setState({
    treeData: [folder], selectedFileId: nestedNote.id,
    expandedFolderIds: new Set([folder.id]),
  });
  const rowContainer = document.createElement("div");
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
  const rename = Array.from(rowContainer.querySelectorAll('button'))
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

  // Account disclosure keeps real actions, closes predictably, and never steals IME Escape.
  let signOutCalls = 0;
  let trashCalls = 0;
  const accountContainer = document.createElement("div");
  document.body.appendChild(accountContainer);
  const accountRoot = createRoot(accountContainer);
  const accountProps = {
    themeMode: "light",
    onThemeModeChange() {},
    userEmail: "test@example.com",
    userName: "test",
    userEmailVerified: true,
    trashCount: 2,
    onOpenTrash() { trashCalls += 1; },
    onSignOut() { signOutCalls += 1; },
  };
  await act(async () => accountRoot.render(React.createElement(AccountMenu, accountProps)));
  const accountTrigger = accountContainer.querySelector('button[aria-label="我的账号"]');
  assert.ok(accountTrigger.classList.contains("mr-2"));
  assert.equal(accountTrigger.querySelector("span.block.truncate").parentElement.classList.contains("flex-1"), false);
  assert.ok(accountTrigger.querySelector(".account-menu-chevron"));
  assertIcon(accountTrigger, "lucide-chevron-up", 14, 1.9);
  assertIcon(accountContainer.querySelector('button[aria-label="回收站"]'), "lucide-trash", 18, 1.65);
  assertIcon(accountContainer.querySelector('button[aria-label="设置"]'), "lucide-settings", 18, 1.55);
  const accountPanel = () => accountContainer.querySelector('[role="dialog"][aria-label="账号操作"]');
  const accountAction = (label) => Array.from(accountPanel()?.querySelectorAll("button") ?? [])
    .find((button) => button.textContent?.includes(label));
  const clickAccount = async (button) => {
    assert.ok(button);
    await act(async () => button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  };
  assert.equal(accountTrigger.getAttribute("aria-expanded"), "false");
  assert.equal(accountPanel(), null);
  assert.doesNotMatch(accountContainer.textContent, /test@example.com/);
  await clickAccount(accountTrigger);
  assert.equal(accountTrigger.getAttribute("aria-expanded"), "true");
  assert.equal(accountTrigger.getAttribute("aria-controls"), accountPanel().id);
  assert.equal(accountPanel().className, "account-popover");
  assert.equal(document.activeElement, accountAction("登录邮箱"));
  assert.ok(accountAction("登录设备"));
  assert.ok(accountAction("退出登录"));
  await act(async () => document.body.dispatchEvent(new dom.window.FocusEvent("focusin", { bubbles: true })));
  assert.ok(accountPanel());
  await clickAccount(accountAction("登录邮箱"));
  assert.ok(accountPanel().querySelector('input[aria-label="登录邮箱地址"]'));
  assert.equal(accountPanel().querySelector('input[type="email"]').value, "test@example.com");
  assert.ok(accountAction("发送验证码"));
  await clickAccount(accountAction("登录设备"));
  assert.match(accountPanel().textContent, /有效会话/);
  await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
    key: "Escape", isComposing: true, bubbles: true,
  })));
  assert.ok(accountPanel());
  await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
    key: "Escape", bubbles: true,
  })));
  assert.equal(accountPanel(), null);
  assert.equal(document.activeElement, accountTrigger);
  await clickAccount(accountTrigger);
  await act(async () => document.body.dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true })));
  assert.equal(accountPanel(), null);
  await clickAccount(accountTrigger);
  const outsideButton = document.createElement("button");
  document.body.appendChild(outsideButton);
  await act(async () => outsideButton.focus());
  assert.equal(accountPanel(), null);
  outsideButton.remove();
  await clickAccount(accountTrigger);
  await clickAccount(accountAction("退出登录"));
  assert.equal(signOutCalls, 1);
  await clickAccount(accountContainer.querySelector('button[aria-label="回收站"]'));
  assert.equal(trashCalls, 1);
  assert.equal(accountPanel(), null);
  await clickAccount(accountTrigger);
  await clickAccount(accountContainer.querySelector('button[aria-label="设置"]'));
  assert.equal(accountPanel(), null);
  assert.ok(document.querySelector('[role="dialog"][aria-label="设置"]'));
  await act(async () => accountRoot.unmount());
  accountContainer.remove();

  const compactAccountContainer = document.createElement("div");
  document.body.appendChild(compactAccountContainer);
  const compactAccountRoot = createRoot(compactAccountContainer);
  await act(async () => compactAccountRoot.render(React.createElement(AccountMenu, {
    ...accountProps, compact: true, themeMode: "dark", userName: "测试用户",
  })));
  const compactTrigger = compactAccountContainer.querySelector('button[aria-label="我的账号"]');
  assert.equal(compactTrigger.classList.contains("mr-2"), false);
  assert.equal(compactTrigger.querySelector(".account-menu-chevron"), null);
  assertIcon(compactAccountContainer.querySelector('button[aria-label="回收站"]'), "lucide-trash", 18, 1.65);
  assertIcon(compactAccountContainer.querySelector('button[aria-label="设置"]'), "lucide-settings", 18, 1.55);
  await clickAccount(compactTrigger);
  assert.ok(compactAccountContainer.querySelector('.account-menu-root[data-compact="true"] .account-popover'));
  assert.match(compactAccountContainer.textContent, /测试用户/);
  await clickAccount(compactTrigger);
  assert.equal(compactTrigger.getAttribute("aria-expanded"), "false");
  await act(async () => compactAccountRoot.unmount());
  compactAccountContainer.remove();

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
      "AccountMenu",
    ],
    accountMenuCoverage: ["open-close", "email-form", "devices", "escape-focus", "IME", "outside-pointer", "focus-leave", "sign-out", "trash", "settings", "compact"],
    directoryRowCoverage: ["whole-row-selection", "full-name", "selected-more", "nested-indent", "pin-favorite-glyphs", "folder-disclosure", "file-open-callback", "independent-menu", "rename-cancel"],
  }));
} finally {
  await vite.close();
  dom.window.close();
}
