import { useEffect, type ReactNode } from "react";
import { create } from "zustand";
import type {
  AgentToolAction,
  AgentToolTrace,
  ChatMessage,
  ChatSource,
  ChatSessionSummary,
  FileNode,
} from "../types";
import { findFileById, initialWorkspaceTree } from "../workspaceTree";
import { askAIStream } from "../services/aiStream";
import type { ChatPageState } from "../services/aiStream";
import {
  clearKnowledgeBase,
  loadKnowledgeBase,
  migrateKnowledgeBase,
  type KnowledgeBaseSnapshot,
} from "../services/knowledgeBase";
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from "../services/categories";
import {
  createNote,
  deleteNote,
  getNote,
  listIndexJobs,
  listNotes,
  reindexNote as reindexNoteRequest,
  restoreNote,
  restoreNoteVersion as restoreNoteVersionRequest,
  updateNote,
} from "../services/notes";
import {
  applyEditPreview,
  cancelEditPreview,
  createEditPreview,
  getEditPreview,
  restoreEditPreviewRevision,
  reviseEditPreview,
  type EditTargetType,
  type NoteEditPreviewRecord,
} from "../services/edits";
import {
  createMemory,
  extractMemory,
  isMemoryEnabled,
  listMemories,
} from "../services/memories";
import {
  bindAgentCheckpoint,
  cancelAgentRun,
  getLatestAgentCheckpoint,
  getLatestAgentTask,
  listAgentRuns,
  resolveAgentCheckpoint,
  type AgentCheckpointRecord,
  type AgentTaskSnapshot,
} from "../services/agent";
import {
  createChatSession,
  deleteChatSession as deleteChatSessionRequest,
  listChatMessages,
  listChatSessions,
  renameChatSession as renameChatSessionRequest,
} from "../services/chatSessions";
import {
  hasRemoteConflict,
  listOfflineNoteEdits,
  queueOfflineNoteEdit,
  removeOfflineNoteEdit,
} from "../services/offlineQueue";
import {
  buildTreeFromRecords,
  collectFileIds,
  collectFolderIds,
  findNode,
  findParentFolderId,
  insertNode,
  moveNodeToParent,
  reconcilePersistedNoteRecord,
  removeNode,
  renameNode,
  replaceNoteRecordInTree,
  titleFromNodeName,
  togglePinned,
  updateFileContentInTree,
  updateFileMetadata,
  updateNodeIndexStatus,
} from "./tree";
import {
  isBundledDemoSnapshot,
  loadLocalSnapshot,
  resolveSelectedFileId,
  saveLocalSnapshot,
} from "./persistence";

export { reconcilePersistedNoteRecord };

type NoteSaveStatus = "idle" | "unsaved" | "saving" | "saved" | "offline" | "error";
type CenterMode = "note" | "draft" | "edit";
type ChatMode = "chat" | "ask_notes";

interface DraftCommand {
  id: string;
  action: "generate_outline" | "regenerate_outline" | "generate_all" | "stop" | "cancel";
  seed: string;
  feedback: string;
}

interface ChatSelectionContext {
  id: string;
  text: string;
  noteId: string | null;
  noteTitle: string;
  createdAt: string;
}

interface ActiveDraftContext {
  id: string;
  title: string;
  topic: string;
  stage: "configuring" | "outline_ready" | "generating" | "assembled" | "failed";
  busy: boolean;
  statusText: string;
  errorText: string;
  completedSections: number;
  totalSections: number;
}

interface NoteSaveState {
  status: NoteSaveStatus;
  message?: string;
  updatedAt?: string;
}

interface DeletedNoteItem {
  id: string;
  title: string;
  deletedAt: string | null;
}

interface EditorSelectionRequest {
  id: string;
  noteId: string;
  markdown: string;
  mode: "select" | "caret-start";
}

interface AppState {
  centerMode: CenterMode;
  draftSeed: string;
  draftCommand: DraftCommand | null;
  activeDraftContext: ActiveDraftContext | null;
  chatSelection: ChatSelectionContext | null;
  activeEditPreview: NoteEditPreviewRecord | null;
  editPreviewError: string;
  pendingCheckpoint: AgentCheckpointRecord | null;
  pendingSourceFocus: ChatSource | null;
  pendingEditorSelection: EditorSelectionRequest | null;
  activeEditorSectionId: string | null;
  startDraft: (seed?: string) => void;
  openPendingDraft: () => void;
  dismissDraftWorkspace: () => void;
  openPendingEditPreview: () => void;
  setActiveDraftContext: (context: ActiveDraftContext | null) => void;
  requestDraftCommand: (action: DraftCommand["action"], feedback?: string) => void;
  consumeDraftCommand: (id: string) => void;
  addSelectionToChat: (selection: { text: string; noteId?: string | null; noteTitle?: string }) => void;
  clearChatSelection: () => void;
  closeDraft: () => void;
  createEditPreviewRequest: (
    instruction: string,
    selectedText?: string,
    targetType?: EditTargetType | null,
    sectionId?: string | null
  ) => void;
  reviseEditPreviewRequest: (instruction: string) => void;
  restoreEditPreviewRevisionRequest: (revisionId: string) => Promise<void>;
  applyEditPreviewRequest: () => void;
  cancelEditPreviewRequest: () => void;
  closeEditPreview: () => void;
  focusChatSource: (source: ChatSource) => void;
  clearPendingSourceFocus: () => void;
  clearPendingEditorSelection: () => void;
  setActiveEditorSectionId: (sectionId: string | null) => void;
  saveMemoryFromText: (text: string) => void;
  listMemoryRequest: (text?: string) => void;
  selectedFileId: string | null;
  setSelectedFileId: (id: string | null) => void;
  expandedFolderIds: Set<string>;
  toggleFolder: (id: string) => void;
  fileContents: Record<string, string>;
  updateFileContent: (id: string, content: string) => void;
  noteSaveState: NoteSaveState;
  deletedNotes: DeletedNoteItem[];
  restoreDeletedNote: (id: string) => void;
  reindexNote: (id: string) => void;
  restoreNoteVersion: (noteId: string, versionId: string) => Promise<void>;
  workspaceLoading: boolean;
  workspaceError: string | null;
  reloadWorkspace: (preferredSelectedFileId?: string | null, successMessage?: string) => void;
  agentSessionId: string | null;
  agentTask: AgentTaskSnapshot | null;
  agentRunHistory: AgentTaskSnapshot[];
  agentTaskDetailOpen: boolean;
  refreshAgentTask: (sessionId?: string | null) => void;
  refreshAgentRunHistory: (sessionId?: string | null) => void;
  setAgentTaskDetailOpen: (open: boolean) => void;
  retryAgentTask: () => void;
  chatMessages: ChatMessage[];
  chatLoading: boolean;
  chatSessions: ChatSessionSummary[];
  chatSessionsLoading: boolean;
  refreshChatSessions: () => Promise<void>;
  newChatSession: () => Promise<void>;
  switchChatSession: (sessionId: string) => Promise<void>;
  renameChatSession: (sessionId: string, title: string) => Promise<void>;
  deleteChatSession: (sessionId: string) => Promise<void>;
  sendMessage: (text: string, pageState?: Partial<ChatPageState>, options?: { mode?: ChatMode }) => void;
  stopGeneration: () => void;
  treeData: FileNode[];
  addNode: (parentId: string | null, node: FileNode) => void;
  updateNodeName: (id: string, name: string) => void;
  deleteNode: (id: string) => void;
  moveNode: (id: string, parentId: string | null) => void;
  toggleNodePinned: (id: string) => void;
  toggleNodeFavorite: (id: string) => void;
  setNoteTags: (id: string, tags: string[]) => void;
}

interface InternalAppState extends AppState {
  hydratedUserId: string | null;
  serverSyncReady: boolean;
  hydrate: (userId: string) => void;
  replaceSnapshot: (snapshot: KnowledgeBaseSnapshot) => void;
  setServerSyncReady: (ready: boolean) => void;
  setWorkspaceLoading: (loading: boolean) => void;
  setWorkspaceError: (message: string | null) => void;
}

let chatMsgCounter = 0;
let nodeCounter = 0;
let generationAbortController: AbortController | null = null;
let noteSaveTimer: ReturnType<typeof window.setTimeout> | null = null;
const indexJobPollTimers = new Map<string, ReturnType<typeof window.setTimeout>>();
let noteSaveInFlight: Promise<void> | null = null;
const noteMutationQueues = new Map<string, Promise<void>>();

function enqueueNoteMutation<T>(noteId: string, operation: () => Promise<T>): Promise<T> {
  const previous = noteMutationQueues.get(noteId) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const settled = result.then(
    () => undefined,
    () => undefined
  );
  noteMutationQueues.set(noteId, settled);
  void settled.finally(() => {
    if (noteMutationQueues.get(noteId) === settled) noteMutationQueues.delete(noteId);
  });
  return result;
}

function taskWithCheckpoint(
  task: AgentTaskSnapshot | null,
  checkpoint: AgentCheckpointRecord | null
): AgentTaskSnapshot | null {
  if (!task) return task;
  return {
    ...task,
    checkpoint,
    run: {
      ...task.run,
      status: checkpoint ? "waiting_user_confirm" : task.run.rawStatus || task.run.status,
    },
  };
}

function checkpointFromPayload(value: unknown): AgentCheckpointRecord | null {
  if (!value || typeof value !== "object") return null;
  const checkpoint = value as Partial<AgentCheckpointRecord>;
  if (
    typeof checkpoint.id === "string" &&
    typeof checkpoint.runId === "string" &&
    typeof checkpoint.sessionId === "string" &&
    typeof checkpoint.checkpointType === "string"
  ) {
    return {
      id: checkpoint.id,
      runId: checkpoint.runId,
      sessionId: checkpoint.sessionId,
      intent: checkpoint.intent ?? "",
      status: checkpoint.status ?? "waiting_user_confirm",
      checkpointType: checkpoint.checkpointType,
      payload: checkpoint.payload ?? {},
      createdAt: checkpoint.createdAt ?? null,
      updatedAt: checkpoint.updatedAt ?? null,
      resolvedAt: checkpoint.resolvedAt ?? null,
    };
  }
  return null;
}

function editPreviewIdFromCheckpoint(checkpoint: AgentCheckpointRecord | null): string | null {
  if (checkpoint?.checkpointType !== "edit_preview") return null;
  const payload = checkpoint.payload ?? {};
  return typeof payload.editPreviewId === "string" ? payload.editPreviewId : null;
}

function taskWithRunStatus(
  task: AgentTaskSnapshot | null,
  runId: string,
  status: string
): AgentTaskSnapshot | null {
  if (!task || task.run.id !== runId) return task;
  return {
    ...task,
    run: {
      ...task.run,
      status,
      rawStatus: status,
      finishedAt: status === "running" ? task.run.finishedAt : new Date().toISOString(),
    },
  };
}

export function generateId(): string {
  return `node-${++nodeCounter}-${Date.now()}`;
}

function snapshotFromState(state: InternalAppState): KnowledgeBaseSnapshot {
  return {
    treeData: state.treeData,
    fileContents: state.fileContents,
    selectedFileId: state.selectedFileId,
  };
}

function noteSaveState(status: NoteSaveStatus, message?: string): NoteSaveState {
  return {
    status,
    message,
    updatedAt: status === "saved" ? new Date().toISOString() : undefined,
  };
}

function memoryTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    episode: "历史事件",
    identity: "身份称呼",
    personal_info: "个人信息",
    interest: "兴趣爱好",
    preference: "偏好",
    goal: "目标",
    writing_style: "写作风格",
    project: "项目背景",
    skill: "技能方向",
    constraint: "限制",
    workflow: "工作流",
  };
  return labels[type] ?? "记忆";
}

function memoryLayerLabel(layer: string): string {
  const labels: Record<string, string> = {
    semantic: "用户画像",
    episodic: "历史经历",
    working: "任务状态",
    short_term: "短期上下文",
    instant: "当前上下文",
  };
  return labels[layer] ?? "记忆层";
}

function formatMemoryList(memories: Awaited<ReturnType<typeof listMemories>>): string {
  const active = memories.filter((memory) => memory.status === "active");
  if (active.length === 0) {
    return "现在还没有保存任何记忆。";
  }

  const groups = new Map<string, typeof active>();
  active.forEach((memory) => {
    const label = `${memoryLayerLabel(memory.layer)} · ${memoryTypeLabel(memory.memoryType)}`;
    groups.set(label, [...(groups.get(label) ?? []), memory]);
  });

  return Array.from(groups.entries())
    .map(([label, items]) => {
      const lines = items
        .map((memory, index) => `${index + 1}. ${memory.content}`)
        .join("\n");
      return `**${label}**\n${lines}`;
    })
    .join("\n\n");
}

function persistLocalCurrentState() {
  const state = useAppStore.getState();
  if (state.hydratedUserId) {
    saveLocalSnapshot(state.hydratedUserId, snapshotFromState(state));
  }
}

function clearScheduledNoteSave() {
  if (noteSaveTimer) {
    window.clearTimeout(noteSaveTimer);
    noteSaveTimer = null;
  }
}

function startPersistNoteContent(noteId: string, content: string) {
  const promise = persistNoteContent(noteId, content);
  noteSaveInFlight = promise;
  void promise.finally(() => {
    if (noteSaveInFlight === promise) {
      noteSaveInFlight = null;
    }
  });
}

function scheduleNoteSave(noteId: string, content: string) {
  clearScheduledNoteSave();
  noteSaveTimer = window.setTimeout(() => {
    noteSaveTimer = null;
    startPersistNoteContent(noteId, content);
  }, 700);
}

async function persistNoteContent(noteId: string, content: string) {
  if (useAppStore.getState().fileContents[noteId] !== content) return;
  let baseUpdatedAt: string | null = null;
  let baseContentHash: string | null = null;
  useAppStore.setState({ noteSaveState: noteSaveState("saving") });
  try {
    const note = await enqueueNoteMutation(noteId, async () => {
      const beforeSave = useAppStore.getState();
      if (beforeSave.fileContents[noteId] !== content) return null;
      const beforeSaveNote = findFileById(beforeSave.treeData, noteId);
      baseUpdatedAt = beforeSaveNote?.updatedAt ?? null;
      baseContentHash = beforeSaveNote?.contentHash ?? null;
      return updateNote(noteId, {
        content,
        source: "auto_save",
        changeSummary: "自动保存正文",
        expectedUpdatedAt: baseUpdatedAt,
        expectedContentHash: baseContentHash,
      });
    });
    if (!note) return;
    const current = useAppStore.getState();
    if (current.fileContents[noteId] !== content) {
      const latestLocalContent = current.fileContents[note.id] ?? note.content;
      useAppStore.setState({
        treeData: reconcilePersistedNoteRecord(current.treeData, note, latestLocalContent),
      });
      persistLocalCurrentState();
      return;
    }
    useAppStore.setState({
      fileContents: { ...current.fileContents, [note.id]: note.content },
      treeData: replaceNoteRecordInTree(current.treeData, note),
      noteSaveState: noteSaveState("saved"),
    });
    persistLocalCurrentState();
  } catch (error) {
    const current = useAppStore.getState();
    const message = error instanceof Error ? error.message : "保存失败";
    const isNetworkFailure =
      (typeof navigator !== "undefined" && !navigator.onLine) ||
      error instanceof TypeError ||
      /failed to fetch|networkerror|network request failed/i.test(message);
    if (isNetworkFailure && current.hydratedUserId) {
      try {
        await queueOfflineNoteEdit({
          userId: current.hydratedUserId,
          noteId,
          content,
          baseUpdatedAt,
          baseContentHash,
        });
        useAppStore.setState({
          noteSaveState: noteSaveState("offline", "已离线保存在本机，联网后会自动同步。"),
        });
        persistLocalCurrentState();
        return;
      } catch {}
    }
    if (/同步冲突|其他设备更新/.test(message) && current.hydratedUserId) {
      try {
        await preserveConflictCopy(current.hydratedUserId, noteId, content);
        return;
      } catch {}
    }
    useAppStore.setState({
      noteSaveState: noteSaveState("error", message),
    });
  }
}

async function contentFingerprint(value: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fallback-${(hash >>> 0).toString(16)}-${value.length}`;
}

async function preserveConflictCopy(userId: string, noteId: string, localContent: string) {
  const remote = await getNote(noteId);
  if (remote.content === localContent) {
    const current = useAppStore.getState();
    useAppStore.setState({
      fileContents: { ...current.fileContents, [remote.id]: remote.content },
      treeData: replaceNoteRecordInTree(current.treeData, remote),
      noteSaveState: noteSaveState("saved", "内容已经同步，无需创建冲突副本。"),
    });
    await removeOfflineNoteEdit(userId, noteId).catch(() => undefined);
    persistLocalCurrentState();
    return;
  }
  const conflictFingerprint = await contentFingerprint(
    `${noteId}\n${remote.contentHash}\n${localContent}`
  );
  const stamp = new Date().toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).replace(/[/:]/g, "-");
  const conflict = await createNote({
    title: `${remote.title}（同步冲突 ${stamp}）`,
    categoryId: remote.categoryId,
    summary: "离线编辑与远端版本发生冲突，已保留为独立副本，请人工合并。",
    tags: Array.from(new Set([...(remote.tags ?? []), "同步冲突"])),
    content: localContent,
    idempotencyKey: `sync-conflict:${conflictFingerprint}`,
  });
  await removeOfflineNoteEdit(userId, noteId).catch(() => undefined);
  await loadStructuredWorkspace(userId, conflict.id);
  useAppStore.setState({
    noteSaveState: noteSaveState("saved", "检测到其他设备的更新，离线内容已保留为“同步冲突”副本。"),
  });
}

async function flushOfflineNoteQueue(userId: string) {
  if (typeof indexedDB === "undefined") return;
  const edits = await listOfflineNoteEdits(userId);
  if (!edits.length) return;
  let changed = false;
  for (const edit of edits) {
    try {
      const remote = await getNote(edit.noteId);
      if (remote.content === edit.content) {
        await removeOfflineNoteEdit(userId, edit.noteId);
        changed = true;
        continue;
      }
      if (hasRemoteConflict(
        edit.baseContentHash,
        remote.contentHash,
        edit.baseUpdatedAt,
        remote.updatedAt,
        remote.content,
        edit.content
      )) {
        await preserveConflictCopy(userId, edit.noteId, edit.content);
        changed = true;
        continue;
      }
      await updateNote(edit.noteId, {
        content: edit.content,
        source: "auto_save",
        changeSummary: "离线队列恢复",
        expectedUpdatedAt: remote.updatedAt,
        expectedContentHash: remote.contentHash,
      });
      await removeOfflineNoteEdit(userId, edit.noteId);
      changed = true;
    } catch {
      if (typeof navigator !== "undefined" && !navigator.onLine) break;
    }
  }
  if (changed) {
    const selectedFileId = useAppStore.getState().selectedFileId;
    await loadStructuredWorkspace(userId, selectedFileId);
    useAppStore.setState({
      noteSaveState: noteSaveState("saved", "离线修改已同步完成。"),
    });
  }
}

async function syncNoteContentBeforeAiEdit(noteId: string) {
  const hadScheduledSave = Boolean(noteSaveTimer);
  clearScheduledNoteSave();
  if (noteSaveInFlight) {
    await noteSaveInFlight.catch(() => null);
  }

  const current = useAppStore.getState();
  const shouldPersist =
    hadScheduledSave ||
    current.noteSaveState.status === "unsaved" ||
    current.noteSaveState.status === "saving" ||
    current.noteSaveState.status === "offline" ||
    current.noteSaveState.status === "error";
  if (!shouldPersist) return;

  const content = current.fileContents[noteId];
  if (content === undefined) return;

  useAppStore.setState({ noteSaveState: noteSaveState("saving") });
  const note = await updateNote(noteId, {
    content,
    source: "auto_save",
    changeSummary: "AI 修改前同步正文",
  });
  const latest = useAppStore.getState();
  useAppStore.setState({
    fileContents: { ...latest.fileContents, [note.id]: note.content },
    treeData: replaceNoteRecordInTree(latest.treeData, note),
    noteSaveState: noteSaveState("saved"),
  });
  persistLocalCurrentState();
}

export const useAppStore = create<InternalAppState>((set, get) => ({
  hydratedUserId: null,
  serverSyncReady: false,
  centerMode: "note",
  draftSeed: "",
  draftCommand: null,
  activeDraftContext: null,
  chatSelection: null,
  activeEditPreview: null,
  editPreviewError: "",
  pendingCheckpoint: null,
  pendingSourceFocus: null,
  pendingEditorSelection: null,
  activeEditorSectionId: null,
  selectedFileId: null,
  expandedFolderIds: new Set(),
  fileContents: {},
  noteSaveState: noteSaveState("idle"),
  deletedNotes: [],
  workspaceLoading: false,
  workspaceError: null,
  agentSessionId: null,
  agentTask: null,
  agentRunHistory: [],
  agentTaskDetailOpen: false,
  chatMessages: [],
  chatLoading: false,
  chatSessions: [],
  chatSessionsLoading: false,
  treeData: initialWorkspaceTree,

  startDraft: (seed = "") => {
    const trimmedSeed = seed.trim();
    const messages: ChatMessage[] = trimmedSeed
      ? [
          {
            id: `msg-${++chatMsgCounter}`,
            role: "user",
            text: trimmedSeed,
          },
          {
            id: `msg-${++chatMsgCounter}`,
            role: "assistant",
            text: "好，我会先整理一份大纲。准备好后，你可以打开查看和调整。",
            draftCard: { seed: trimmedSeed },
          },
        ]
      : [];
    set((state) => ({
      centerMode: "note",
      draftSeed: trimmedSeed,
      draftCommand: null,
      activeDraftContext: trimmedSeed
        ? {
            id: "",
            title: trimmedSeed,
            topic: trimmedSeed,
            stage: "configuring",
            busy: false,
            statusText: "正在根据你的要求生成大纲…",
            errorText: "",
            completedSections: 0,
            totalSections: 0,
          }
        : null,
      chatSelection: null,
      activeEditPreview: null,
      editPreviewError: "",
      pendingCheckpoint: null,
      agentTask: null,
      pendingSourceFocus: null,
      pendingEditorSelection: null,
      activeEditorSectionId: null,
      noteSaveState: noteSaveState("idle"),
      chatMessages: messages.length ? [...state.chatMessages, ...messages] : state.chatMessages,
    }));
  },

  openPendingDraft: () => {
    const activeDraft = get().activeDraftContext;
    if (!activeDraft || activeDraft.stage === "configuring" || activeDraft.stage === "failed") {
      return;
    }
    const checkpoint = get().pendingCheckpoint ?? get().agentTask?.checkpoint ?? null;
    if (checkpoint?.checkpointType !== "draft_workspace") {
      set({ centerMode: "draft" });
      return;
    }
    const payload = checkpoint.payload ?? {};
    const seed = typeof payload.seed === "string" ? payload.seed.trim() : "";
    set((state) => ({
      centerMode: "draft",
      draftSeed: seed,
      draftCommand: null,
      activeDraftContext: null,
      activeEditPreview: null,
      chatSelection: null,
      pendingCheckpoint: checkpoint,
      agentTask: taskWithCheckpoint(state.agentTask, checkpoint),
      pendingSourceFocus: null,
      noteSaveState: noteSaveState("idle"),
    }));
  },

  dismissDraftWorkspace: () => {
    set((state) => ({
      centerMode: state.centerMode === "draft" ? "note" : state.centerMode,
      draftCommand: null,
    }));
  },

  openPendingEditPreview: async () => {
    const checkpoint = get().pendingCheckpoint ?? get().agentTask?.checkpoint ?? null;
    const editPreviewId = editPreviewIdFromCheckpoint(checkpoint);
    if (!editPreviewId || get().chatLoading) return;
    try {
      const preview = await getEditPreview(editPreviewId);
      set((state) => ({
        centerMode: "edit",
        activeEditPreview: preview,
        editPreviewError: "",
        pendingCheckpoint: checkpoint,
        agentSessionId: checkpoint?.sessionId ?? state.agentSessionId,
        agentTask: taskWithCheckpoint(state.agentTask, checkpoint),
        draftSeed: "",
        draftCommand: null,
        activeDraftContext: null,
        chatSelection: null,
        pendingSourceFocus: null,
        pendingEditorSelection: null,
        noteSaveState: noteSaveState("idle"),
      }));
    } catch (error) {
      const text = error instanceof Error ? error.message : "打开修改预览失败";
      set((state) => ({
        chatMessages: [
          ...state.chatMessages,
          { id: `msg-${++chatMsgCounter}`, role: "assistant", text },
        ],
      }));
    }
  },

  closeDraft: () => {
    set((state) => ({
      centerMode: "note",
      draftSeed: "",
      draftCommand: null,
      activeDraftContext: null,
      chatSelection: null,
      pendingCheckpoint: null,
      agentTask: taskWithCheckpoint(state.agentTask, null),
    }));
  },

  consumeDraftCommand: (id) => {
    set((state) => ({
      draftCommand: state.draftCommand?.id === id ? null : state.draftCommand,
    }));
  },

  setActiveDraftContext: (context) => {
    set({ activeDraftContext: context });
  },

  requestDraftCommand: (action, feedback = "") => {
    const state = get();
    set({
      draftCommand: {
        id: `draft-command-${Date.now()}`,
        action,
        seed: state.activeDraftContext?.topic || state.draftSeed,
        feedback,
      },
    });
  },

  addSelectionToChat: (selection) => {
    const text = selection.text.trim();
    if (!text) return;
    set({
      chatSelection: {
        id: `chat-selection-${Date.now()}`,
        text,
        noteId: selection.noteId ?? null,
        noteTitle: selection.noteTitle?.trim() || "当前笔记",
        createdAt: new Date().toISOString(),
      },
    });
  },

  clearChatSelection: () => {
    set({ chatSelection: null });
  },

  createEditPreviewRequest: async (instruction, selectedText = "", targetType = null, sectionId = null) => {
    const state = get();
    if (state.chatLoading) return;
    if (!state.selectedFileId) {
      const userMsg: ChatMessage = { id: `msg-${++chatMsgCounter}`, role: "user", text: instruction };
      const assistantMsg: ChatMessage = {
        id: `msg-${++chatMsgCounter}`,
        role: "assistant",
        text: "请先打开一篇正式笔记，再让我生成修改预览。",
      };
      set((current) => ({ chatMessages: [...current.chatMessages, userMsg, assistantMsg] }));
      return;
    }

    const userMsg: ChatMessage = { id: `msg-${++chatMsgCounter}`, role: "user", text: instruction };
    const assistantMsg: ChatMessage = {
      id: `msg-${++chatMsgCounter}`,
      role: "assistant",
      text: "我正在生成修改预览，不会直接改正式笔记。",
    };
    set((current) => ({
      chatMessages: [...current.chatMessages, userMsg, assistantMsg],
      chatLoading: true,
      editPreviewError: "",
    }));

    try {
      await syncNoteContentBeforeAiEdit(state.selectedFileId);
      const preview = await createEditPreview({
        noteId: state.selectedFileId,
        targetType,
        sectionId,
        selectedText,
        instruction,
        keepStyle: true,
        memoryEnabled: isMemoryEnabled(),
      });
      set((current) => ({
      centerMode: "edit",
      activeEditPreview: preview,
      editPreviewError: "",
      draftSeed: "",
      draftCommand: null,
      activeDraftContext: null,
        chatMessages: current.chatMessages.map((message) =>
          message.id === assistantMsg.id
            ? {
                ...message,
                text: `已生成 AI 修改预览，正式笔记还没有变化。你可以在中间区域查看原文和修改后内容，再决定应用或取消。`,
              }
            : message
        ),
      }));
    } catch (error) {
      const text = error instanceof Error ? error.message : "修改预览生成失败";
      set((current) => ({
        chatMessages: current.chatMessages.map((message) =>
          message.id === assistantMsg.id ? { ...message, text } : message
        ),
      }));
    } finally {
      set({ chatLoading: false });
    }
  },

  reviseEditPreviewRequest: async (instruction) => {
    const preview = get().activeEditPreview;
    if (!preview || get().chatLoading) return;
    const userMsg: ChatMessage = { id: `msg-${++chatMsgCounter}`, role: "user", text: instruction };
    const assistantMsg: ChatMessage = {
      id: `msg-${++chatMsgCounter}`,
      role: "assistant",
      text: "我会基于当前预览继续调整，仍然不会写回正式笔记。",
    };
    set((current) => ({
      chatMessages: [...current.chatMessages, userMsg, assistantMsg],
      chatLoading: true,
      centerMode: "edit",
      activeDraftContext: null,
      editPreviewError: "",
    }));
    try {
      const nextPreview = await reviseEditPreview(preview.id, instruction, isMemoryEnabled());
      const checkpoint = get().pendingCheckpoint;
      let nextCheckpoint: AgentCheckpointRecord | null = checkpoint;
      if (checkpoint?.checkpointType === "edit_preview") {
        nextCheckpoint = await bindAgentCheckpoint(checkpoint.id, {
          editPreviewId: nextPreview.id,
          payload: { editPreviewId: nextPreview.id },
        }).catch(() => checkpoint);
      }
      set((current) => ({
        activeEditPreview: nextPreview,
        editPreviewError: "",
        pendingCheckpoint: nextCheckpoint,
        agentTask: taskWithCheckpoint(current.agentTask, nextCheckpoint),
        chatMessages: current.chatMessages.map((message) =>
          message.id === assistantMsg.id
            ? { ...message, text: "预览已更新。请在中间区域确认修改效果。" }
            : message
        ),
      }));
    } catch (error) {
      const text = error instanceof Error ? error.message : "继续调整失败";
      set((current) => ({
        chatMessages: current.chatMessages.map((message) =>
          message.id === assistantMsg.id ? { ...message, text } : message
        ),
      }));
    } finally {
      set({ chatLoading: false });
    }
  },

  restoreEditPreviewRevisionRequest: async (revisionId) => {
    const preview = get().activeEditPreview;
    if (!preview || get().chatLoading) return;
    set({ chatLoading: true, editPreviewError: "" });
    try {
      const nextPreview = await restoreEditPreviewRevision(preview.id, revisionId);
      set({ activeEditPreview: nextPreview, centerMode: "edit", editPreviewError: "" });
    } catch (error) {
      const text = error instanceof Error ? error.message : "恢复预览版本失败";
      set((current) => ({
        chatMessages: [
          ...current.chatMessages,
          { id: `msg-${++chatMsgCounter}`, role: "assistant", text },
        ],
      }));
      throw error;
    } finally {
      set({ chatLoading: false });
    }
  },

  applyEditPreviewRequest: async () => {
    const preview = get().activeEditPreview;
    if (!preview || get().chatLoading) return;
    set({ chatLoading: true, editPreviewError: "" });
    try {
      await syncNoteContentBeforeAiEdit(preview.noteId);
      const result = await applyEditPreview(preview.id);
      const current = get();
      const checkpoint = current.pendingCheckpoint;
      if (checkpoint?.checkpointType === "edit_preview") {
        void resolveAgentCheckpoint(checkpoint.id, "resolved", {
          editPreviewId: preview.id,
          noteId: result.note.id,
        })
          .then(() => get().refreshAgentRunHistory(checkpoint.sessionId))
          .catch(() => null);
      }
      set({
        activeEditPreview: null,
        editPreviewError: "",
        pendingCheckpoint: null,
        agentTask: taskWithCheckpoint(current.agentTask, null),
        centerMode: "note",
        activeDraftContext: null,
        selectedFileId: result.note.id,
        fileContents: { ...current.fileContents, [result.note.id]: result.note.content },
        treeData: replaceNoteRecordInTree(current.treeData, result.note),
        noteSaveState: noteSaveState("saved"),
        pendingEditorSelection: {
          id: `editor-selection-${Date.now()}`,
          noteId: result.note.id,
          markdown: result.preview.newContent,
          mode:
            result.preview.targetType === "selection" ||
            result.preview.targetType === "section" ||
            result.preview.targetType === "insert"
              ? "select"
              : "caret-start",
        },
        chatMessages: [
          ...current.chatMessages,
          {
            id: `msg-${++chatMsgCounter}`,
            role: "assistant",
            text: "修改已应用到正式笔记，并已保存旧版本和更新索引。",
          },
        ],
      });
      persistLocalCurrentState();
    } catch (error) {
      const text = error instanceof Error ? error.message : "应用修改失败，正式笔记未变化";
      set((current) => ({
        editPreviewError: text,
        chatMessages: [
          ...current.chatMessages,
          { id: `msg-${++chatMsgCounter}`, role: "assistant", text },
        ],
      }));
    } finally {
      set({ chatLoading: false });
    }
  },

  cancelEditPreviewRequest: async () => {
    const current = get();
    const preview = current.activeEditPreview;
    const checkpoint = current.pendingCheckpoint ?? current.agentTask?.checkpoint ?? null;
    const editPreviewId = preview?.id ?? editPreviewIdFromCheckpoint(checkpoint);
    if (!editPreviewId) return;
    try {
      await cancelEditPreview(editPreviewId);
      if (checkpoint?.checkpointType === "edit_preview") {
        void resolveAgentCheckpoint(checkpoint.id, "cancelled", {
          editPreviewId,
        })
          .then(() => get().refreshAgentRunHistory(checkpoint.sessionId))
          .catch(() => null);
      }
    } catch {}
    set((current) => ({
      activeEditPreview: null,
      editPreviewError: "",
      pendingCheckpoint: null,
      agentTask: taskWithCheckpoint(current.agentTask, null),
      centerMode: "note",
      activeDraftContext: null,
      chatMessages: [
        ...current.chatMessages,
        {
          id: `msg-${++chatMsgCounter}`,
          role: "assistant",
          text: "已取消本次修改预览，正式笔记没有变化。",
        },
      ],
    }));
  },

  closeEditPreview: () => {
    set((state) => ({
      activeEditPreview: null,
      editPreviewError: "",
      pendingCheckpoint: null,
      agentTask: taskWithCheckpoint(state.agentTask, null),
      centerMode: "note",
      activeDraftContext: null,
    }));
  },

  focusChatSource: (source) => {
    set((state) => ({
      selectedFileId: source.noteId,
      centerMode: "note",
      draftSeed: "",
      draftCommand: null,
      activeDraftContext: null,
      chatSelection: null,
      activeEditPreview: null,
      pendingCheckpoint: null,
      agentTask: taskWithCheckpoint(state.agentTask, null),
      pendingSourceFocus: source,
      noteSaveState: noteSaveState("idle"),
    }));
  },

  clearPendingSourceFocus: () => {
    set({ pendingSourceFocus: null });
  },

  clearPendingEditorSelection: () => {
    set({ pendingEditorSelection: null });
  },

  setActiveEditorSectionId: (sectionId) => {
    set((current) => current.activeEditorSectionId === sectionId ? current : { activeEditorSectionId: sectionId });
  },

  saveMemoryFromText: async (text) => {
    const trimmed = text.trim();
    if (!trimmed || get().chatLoading) return;
    const userMsg: ChatMessage = { id: `msg-${++chatMsgCounter}`, role: "user", text: trimmed };
    const assistantMsg: ChatMessage = {
      id: `msg-${++chatMsgCounter}`,
      role: "assistant",
      text: "我在判断这是不是适合长期保存的偏好。",
    };
    set((current) => ({
      chatMessages: [...current.chatMessages, userMsg, assistantMsg],
      chatLoading: true,
    }));
    try {
      const extracted = await extractMemory(trimmed, "global");
      const candidate =
        extracted.candidates.find((item) => item.shouldSave) ?? extracted.candidates[0];
      if (!candidate) {
        set((current) => ({
          chatMessages: current.chatMessages.map((message) =>
            message.id === assistantMsg.id
              ? { ...message, text: extracted.reason || "这句话暂时没有形成稳定记忆。" }
              : message
          ),
        }));
        return;
      }

      const memory = await createMemory({
        memoryType: candidate.memoryType,
        content: candidate.content,
        importance: candidate.importance,
        confidence: candidate.confidence,
        source: candidate.source,
        scope: candidate.scope,
        tags: candidate.tags,
      });
      const disabledHint = isMemoryEnabled()
        ? ""
        : "\n\n记忆功能当前是关闭状态，这条会保存，但暂时不会自动影响生成和修改。";
      set((current) => ({
        chatMessages: current.chatMessages.map((message) =>
          message.id === assistantMsg.id
            ? { ...message, text: `已保存。${disabledHint}` }
            : message
        ),
      }));
    } catch (error) {
      const errorText = error instanceof Error ? error.message : "保存记忆失败";
      set((current) => ({
        chatMessages: current.chatMessages.map((message) =>
          message.id === assistantMsg.id ? { ...message, text: errorText } : message
        ),
      }));
    } finally {
      set({ chatLoading: false });
    }
  },

  listMemoryRequest: async (text = "你记住了什么") => {
    if (get().chatLoading) return;
    const userMsg: ChatMessage = { id: `msg-${++chatMsgCounter}`, role: "user", text };
    const assistantMsg: ChatMessage = {
      id: `msg-${++chatMsgCounter}`,
      role: "assistant",
      text: "正在读取你的长期记忆。",
    };
    set((current) => ({
      chatMessages: [...current.chatMessages, userMsg, assistantMsg],
      chatLoading: true,
    }));
    try {
      const memories = await listMemories(false);
      set((current) => ({
        chatMessages: current.chatMessages.map((message) =>
          message.id === assistantMsg.id
            ? { ...message, text: formatMemoryList(memories) }
            : message
        ),
      }));
    } catch (error) {
      const errorText = error instanceof Error ? error.message : "读取记忆失败";
      set((current) => ({
        chatMessages: current.chatMessages.map((message) =>
          message.id === assistantMsg.id ? { ...message, text: errorText } : message
        ),
      }));
    } finally {
      set({ chatLoading: false });
    }
  },

  refreshAgentTask: (sessionId) => {
    const targetSessionId = sessionId === undefined ? get().agentSessionId : sessionId;
    void getLatestAgentTask(targetSessionId)
      .then((task) => {
        set((current) => ({
          agentTask: task,
          pendingCheckpoint: task?.checkpoint ?? current.pendingCheckpoint,
          agentSessionId: task?.run.sessionId ?? current.agentSessionId,
        }));
      })
      .catch(() => {});
  },

  refreshAgentRunHistory: (sessionId) => {
    const targetSessionId = sessionId === undefined ? get().agentSessionId : sessionId;
    void listAgentRuns(targetSessionId, 8)
      .then((tasks) => {
        set({ agentRunHistory: tasks });
      })
      .catch(() => {});
  },

  setAgentTaskDetailOpen: (open) => {
    set({ agentTaskDetailOpen: open });
    if (open) {
      get().refreshAgentRunHistory(get().agentSessionId);
    }
  },

  retryAgentTask: () => {
    const state = get();
    const inputText = state.agentTask?.run.inputText?.trim();
    if (!inputText || state.chatLoading) return;
    state.sendMessage(inputText);
  },

  refreshChatSessions: async () => {
    set({ chatSessionsLoading: true });
    try {
      const sessions = await listChatSessions(60);
      set({ chatSessions: sessions });
    } finally {
      set({ chatSessionsLoading: false });
    }
  },

  newChatSession: async () => {
    if (get().chatLoading) get().stopGeneration();
    const session = await createChatSession(get().selectedFileId);
    set((current) => ({
      agentSessionId: session.id,
      agentTask: null,
      agentRunHistory: [],
      pendingCheckpoint: null,
      agentTaskDetailOpen: false,
      chatMessages: [],
      chatLoading: false,
      chatSelection: null,
      centerMode: "note",
      draftSeed: "",
      draftCommand: null,
      activeDraftContext: null,
      activeEditPreview: null,
      chatSessions: [session, ...current.chatSessions.filter((item) => item.id !== session.id)],
    }));
  },

  switchChatSession: async (sessionId) => {
    if (!sessionId || sessionId === get().agentSessionId && get().chatMessages.length > 0) return;
    if (get().chatLoading) get().stopGeneration();
    set({
      agentSessionId: sessionId,
      agentTask: null,
      agentRunHistory: [],
      pendingCheckpoint: null,
      agentTaskDetailOpen: false,
      chatMessages: [],
      chatLoading: false,
      chatSelection: null,
      centerMode: "note",
      draftSeed: "",
      draftCommand: null,
      activeDraftContext: null,
      activeEditPreview: null,
      chatSessionsLoading: true,
    });
    try {
      const [messages, task, history] = await Promise.all([
        listChatMessages(sessionId),
        getLatestAgentTask(sessionId).catch(() => null),
        listAgentRuns(sessionId, 8).catch(() => []),
      ]);
      if (get().agentSessionId !== sessionId) return;
      const checkpoint = task?.checkpoint ?? null;
      set({
        chatMessages: messages,
        agentTask: task,
        agentRunHistory: history,
        pendingCheckpoint: checkpoint,
        draftSeed:
          checkpoint?.checkpointType === "draft_workspace" && typeof checkpoint.payload?.seed === "string"
            ? checkpoint.payload.seed
            : "",
      });
    } finally {
      if (get().agentSessionId === sessionId) set({ chatSessionsLoading: false });
    }
  },

  renameChatSession: async (sessionId, title) => {
    const session = await renameChatSessionRequest(sessionId, title.trim());
    set((current) => ({
      chatSessions: current.chatSessions.map((item) => item.id === sessionId ? session : item),
    }));
  },

  deleteChatSession: async (sessionId) => {
    if (get().chatLoading && get().agentSessionId === sessionId) get().stopGeneration();
    await deleteChatSessionRequest(sessionId);
    const remaining = get().chatSessions.filter((item) => item.id !== sessionId);
    set({ chatSessions: remaining });
    if (get().agentSessionId !== sessionId) return;
    if (remaining[0]) {
      await get().switchChatSession(remaining[0].id);
    } else {
      set({
        agentSessionId: null,
        agentTask: null,
        agentRunHistory: [],
        pendingCheckpoint: null,
        chatMessages: [],
        chatLoading: false,
        chatSelection: null,
        centerMode: "note",
        draftSeed: "",
        draftCommand: null,
        activeDraftContext: null,
        activeEditPreview: null,
      });
    }
  },

  hydrate: (userId) => {
    const snapshot = loadLocalSnapshot(userId);
    set({
      hydratedUserId: userId,
      serverSyncReady: false,
      centerMode: "note",
      draftSeed: "",
      draftCommand: null,
      activeDraftContext: null,
      activeEditPreview: null,
      pendingSourceFocus: null,
      pendingEditorSelection: null,
      selectedFileId: snapshot.selectedFileId,
      expandedFolderIds: new Set(),
      fileContents: snapshot.fileContents,
      noteSaveState: noteSaveState("idle"),
      deletedNotes: [],
      workspaceLoading: true,
      workspaceError: null,
      treeData: snapshot.treeData,
      agentSessionId: null,
      agentTask: null,
      agentRunHistory: [],
      agentTaskDetailOpen: false,
      pendingCheckpoint: null,
      chatMessages: [],
      chatLoading: false,
      chatSessions: [],
      chatSessionsLoading: true,
    });
    void get().refreshChatSessions()
      .then(async () => {
        const latestSession = get().chatSessions[0];
        if (latestSession) {
          await get().switchChatSession(latestSession.id);
        } else {
          set({ agentSessionId: null, chatMessages: [], chatSessionsLoading: false });
        }
      })
      .catch(() => set({ chatSessionsLoading: false }));
  },

  replaceSnapshot: (snapshot) => {
    set((state) => ({
      selectedFileId: snapshot.selectedFileId,
      fileContents: snapshot.fileContents,
      treeData: snapshot.treeData,
      expandedFolderIds:
        state.expandedFolderIds.size > 0
          ? state.expandedFolderIds
          : new Set(collectFolderIds(snapshot.treeData)),
    }));
  },

  setServerSyncReady: (ready) => set({ serverSyncReady: ready }),
  setWorkspaceLoading: (loading) => set({ workspaceLoading: loading }),
  setWorkspaceError: (message) => set({ workspaceError: message }),

  reloadWorkspace: (preferredSelectedFileId, successMessage) => {
    const userId = get().hydratedUserId;
    if (!userId) return;
    void loadStructuredWorkspace(userId, preferredSelectedFileId ?? null).then(() => {
      if (!successMessage) return;
      const current = get();
      if (!preferredSelectedFileId || current.selectedFileId === preferredSelectedFileId) {
        set({ noteSaveState: noteSaveState("saved", successMessage) });
      }
    });
  },

  setSelectedFileId: (id) => {
    set((state) => {
      const keepBackgroundDraft =
        state.pendingCheckpoint?.checkpointType === "draft_workspace" &&
        Boolean(state.activeDraftContext);
      return {
        selectedFileId: id,
        treeData: id
          ? updateFileMetadata(state.treeData, id, { lastOpenedAt: new Date().toISOString() })
          : state.treeData,
        centerMode: "note",
        draftSeed: keepBackgroundDraft ? state.draftSeed : "",
        draftCommand: null,
        activeDraftContext: keepBackgroundDraft ? state.activeDraftContext : null,
        activeEditPreview: null,
        pendingCheckpoint: keepBackgroundDraft ? state.pendingCheckpoint : null,
        agentTask: keepBackgroundDraft
          ? state.agentTask
          : taskWithCheckpoint(state.agentTask, null),
        pendingSourceFocus: null,
        pendingEditorSelection: null,
        noteSaveState: noteSaveState("idle"),
      };
    });
    persistLocalCurrentState();
    if (!id) return;
    void getNote(id)
      .then((note) => {
        const current = get();
        set({
          fileContents: { ...current.fileContents, [note.id]: note.content },
          treeData: replaceNoteRecordInTree(current.treeData, note),
        });
        persistLocalCurrentState();
      })
      .catch(() => {});
  },

  toggleFolder: (id) =>
    set((state) => {
      const next = new Set(state.expandedFolderIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { expandedFolderIds: next };
    }),

  updateFileContent: (id, content) => {
    set((state) => ({
      fileContents: { ...state.fileContents, [id]: content },
      treeData: updateFileContentInTree(state.treeData, id, content),
      noteSaveState: noteSaveState("unsaved"),
    }));
    persistLocalCurrentState();
    scheduleNoteSave(id, content);
  },

  sendMessage: async (text, pageState, options) => {
    const state = get();
    if (state.chatLoading) return;
    const chatMode: ChatMode = options?.mode ?? "chat";

    generationAbortController?.abort();
    const abortController = new AbortController();
    generationAbortController = abortController;

    const userMsg: ChatMessage = {
      id: `msg-${++chatMsgCounter}`,
      role: "user",
      text,
      chatMode,
      attachedSelection: state.chatSelection
        ? {
            text: state.chatSelection.text,
            noteId: state.chatSelection.noteId,
            noteTitle: state.chatSelection.noteTitle,
          }
        : undefined,
    };
    const assistantMsg: ChatMessage = {
      id: `msg-${++chatMsgCounter}`,
      role: "assistant",
      text: "",
      chatMode,
    };

    set((current) => ({
      chatMessages: [...current.chatMessages, userMsg, assistantMsg],
      chatLoading: true,
    }));

    try {
      const latest = get();
      const selectedFile = latest.selectedFileId
        ? findFileById(latest.treeData, latest.selectedFileId)
        : undefined;
      const documentContent = selectedFile
        ? (latest.fileContents[selectedFile.id] ?? selectedFile.content ?? "")
        : "";
      const requestPageState: ChatPageState = {
        currentNoteId: selectedFile?.id ?? null,
        selectedText: pageState?.selectedText ?? "",
        currentSectionId: pageState?.currentSectionId ?? latest.activeEditorSectionId,
        dirty: Boolean(
          selectedFile &&
            (latest.noteSaveState.status === "unsaved" ||
              latest.noteSaveState.status === "saving" ||
              latest.noteSaveState.status === "offline" ||
              latest.noteSaveState.status === "error")
        ),
        unsavedContent: selectedFile
          ? latest.fileContents[selectedFile.id] ?? selectedFile.content ?? ""
          : "",
        centerMode: latest.centerMode,
        activeEditPreviewId: latest.activeEditPreview?.id ?? null,
        draftSeed: latest.draftSeed,
        activeDraftId: latest.activeDraftContext?.id ?? null,
        activeDraftTitle: latest.activeDraftContext?.title ?? "",
        activeDraftTopic: latest.activeDraftContext?.topic ?? "",
        contextScope: pageState?.contextScope ?? "auto",
      };
      const toolActionTasks: Promise<void>[] = [];

        const handleAgentToolAction = async (action: AgentToolAction) => {
          const payload = action.payload ?? {};
          const checkpointId = typeof payload.checkpointId === "string" ? payload.checkpointId : null;
        if (action.toolName === "note_draft_tool" && action.action === "open_draft_workspace") {
          const plannedSeed = typeof payload.seed === "string" ? payload.seed.trim() : "";
          const seed = plannedSeed || text;
          const payloadCheckpoint = checkpointFromPayload(payload.checkpoint);
          set({
            centerMode: "note",
            draftSeed: seed,
            draftCommand: null,
            activeDraftContext: {
              id: "",
              title: seed || "未命名笔记",
              topic: seed || "未命名笔记",
              stage: "configuring",
              busy: false,
              statusText: "正在根据你的要求生成大纲…",
              errorText: "",
              completedSections: 0,
              totalSections: 0,
            },
            activeEditPreview: null,
            pendingCheckpoint: payloadCheckpoint,
            pendingSourceFocus: null,
            noteSaveState: noteSaveState("idle"),
          });
          set((current) => ({
            chatMessages: current.chatMessages.map((message) =>
              message.id === assistantMsg.id
                ? {
                    ...message,
                    draftCard: { seed, checkpointId },
                  }
                : message
            ),
          }));
          if (checkpointId && !payloadCheckpoint) {
            const checkpoint = await getLatestAgentCheckpoint(get().agentSessionId).catch(() => null);
            if (checkpoint?.id === checkpointId) {
              set((current) => ({
                pendingCheckpoint: checkpoint,
                agentTask: taskWithCheckpoint(current.agentTask, checkpoint),
              }));
            }
          } else if (payloadCheckpoint) {
            set((current) => ({
              agentSessionId: payloadCheckpoint.sessionId,
              agentTask: taskWithCheckpoint(current.agentTask, payloadCheckpoint),
            }));
          }
          return;
        }

        if (action.toolName === "note_draft_tool" && action.action === "regenerate_outline") {
          const currentDraft = get().activeDraftContext;
          const payloadSeed = typeof payload.seed === "string" ? payload.seed.trim() : "";
          const seed =
            currentDraft?.topic.trim() ||
            currentDraft?.title.trim() ||
            payloadSeed ||
            get().draftSeed ||
            text;
          const feedback =
            typeof payload.feedback === "string" && payload.feedback.trim()
              ? payload.feedback.trim()
              : text;
          set({
            centerMode: "draft",
            draftSeed: seed,
            draftCommand: {
              id: `draft-command-${Date.now()}`,
              action: "regenerate_outline",
              seed,
              feedback,
            },
            activeEditPreview: null,
            pendingSourceFocus: null,
            noteSaveState: noteSaveState("idle"),
          });
          return;
        }

        if (action.toolName === "note_draft_tool" && action.action === "cancel_draft") {
          get().closeDraft();
          set((current) => ({
            chatMessages: current.chatMessages.map((message) =>
              message.id === assistantMsg.id
                ? { ...message, text: action.message || "已取消当前草稿任务。" }
                : message
            ),
          }));
          return;
        }

        if (action.toolName === "note_edit_tool" && action.action === "apply_preview") {
          const editId =
            typeof payload.editPreviewId === "string" ? payload.editPreviewId : get().activeEditPreview?.id;
          if (!editId) return;
          try {
            const noteId =
              typeof payload.noteId === "string" ? payload.noteId : get().activeEditPreview?.noteId;
            if (noteId) {
              await syncNoteContentBeforeAiEdit(noteId);
            }
            const result = await applyEditPreview(editId);
            const current = get();
            set({
              activeEditPreview: null,
              pendingCheckpoint: null,
              agentTask: taskWithCheckpoint(current.agentTask, null),
              centerMode: "note",
              activeDraftContext: null,
              selectedFileId: result.note.id,
              fileContents: { ...current.fileContents, [result.note.id]: result.note.content },
              treeData: replaceNoteRecordInTree(current.treeData, result.note),
              noteSaveState: noteSaveState("saved"),
              pendingEditorSelection: {
                id: `editor-selection-${Date.now()}`,
                noteId: result.note.id,
                markdown: result.preview.newContent,
                mode:
                  result.preview.targetType === "selection" ||
                  result.preview.targetType === "section" ||
                  result.preview.targetType === "insert"
                    ? "select"
                    : "caret-start",
              },
              chatMessages: current.chatMessages.map((message) =>
                message.id === assistantMsg.id
                  ? { ...message, text: "修改已应用到正式笔记，并已保存旧版本和更新索引。" }
                  : message
              ),
            });
            persistLocalCurrentState();
            if (checkpointId) {
              await resolveAgentCheckpoint(checkpointId, "resolved", {
                editPreviewId: editId,
                noteId: result.note.id,
              }).catch(() => null);
            }
          } catch (error) {
            const errorText = error instanceof Error ? error.message : "应用修改失败，正式笔记未变化";
            set((current) => ({
              agentTask: taskWithRunStatus(current.agentTask, current.agentTask?.run.id ?? "", "failed"),
              chatMessages: current.chatMessages.map((message) =>
                message.id === assistantMsg.id ? { ...message, text: errorText } : message
              ),
            }));
            if (checkpointId) {
              await resolveAgentCheckpoint(checkpointId, "failed", { error: errorText }).catch(() => null);
            }
          }
          return;
        }

        if (action.toolName === "note_edit_tool" && action.action === "cancel_preview") {
          const editId =
            typeof payload.editPreviewId === "string" ? payload.editPreviewId : get().activeEditPreview?.id;
          if (!editId) return;
          try {
            await cancelEditPreview(editId);
            set((current) => ({
              activeEditPreview: null,
              pendingCheckpoint: null,
              agentTask: taskWithCheckpoint(current.agentTask, null),
              centerMode: "note",
              activeDraftContext: null,
              chatMessages: current.chatMessages.map((message) =>
                message.id === assistantMsg.id
                  ? { ...message, text: "已取消本次修改预览，正式笔记没有变化。" }
                  : message
              ),
            }));
            if (checkpointId) {
              await resolveAgentCheckpoint(checkpointId, "cancelled", { editPreviewId: editId }).catch(() => null);
            }
          } catch (error) {
            const errorText = error instanceof Error ? error.message : "取消修改预览失败";
            set((current) => ({
              chatMessages: current.chatMessages.map((message) =>
                message.id === assistantMsg.id ? { ...message, text: errorText } : message
              ),
            }));
          }
          return;
        }

        if (action.toolName === "note_edit_tool" && action.action === "revise_preview") {
          const editId =
            typeof payload.editPreviewId === "string" ? payload.editPreviewId : get().activeEditPreview?.id;
          const instruction = typeof payload.instruction === "string" ? payload.instruction : text;
          if (!editId) return;
          try {
            const nextPreview = await reviseEditPreview(editId, instruction, isMemoryEnabled());
            set((current) => ({
              centerMode: "edit",
              activeEditPreview: nextPreview,
              activeDraftContext: null,
              chatMessages: current.chatMessages.map((message) =>
                message.id === assistantMsg.id
                  ? { ...message, text: "预览已更新。请在中间区域确认修改效果。" }
                  : message
              ),
            }));
            if (checkpointId) {
              const checkpoint = await bindAgentCheckpoint(checkpointId, {
                editPreviewId: nextPreview.id,
                payload: { editPreviewId: nextPreview.id },
              }).catch(() => null);
              if (checkpoint) {
                set((current) => ({
                  pendingCheckpoint: checkpoint,
                  agentTask: taskWithCheckpoint(current.agentTask, checkpoint),
                }));
              }
            }
          } catch (error) {
            const errorText = error instanceof Error ? error.message : "继续调整失败";
            set((current) => ({
              chatMessages: current.chatMessages.map((message) =>
                message.id === assistantMsg.id ? { ...message, text: errorText } : message
              ),
            }));
          }
          return;
        }

        if (action.toolName === "note_edit_tool" && action.action === "resume_edit_preview") {
          const editId = typeof payload.editPreviewId === "string" ? payload.editPreviewId : null;
          if (!editId) return;
          try {
            const preview = await getEditPreview(editId);
            let checkpoint = checkpointFromPayload(payload.checkpoint) ?? get().pendingCheckpoint;
            if (checkpointId) {
              checkpoint = checkpointFromPayload(payload.checkpoint)
                ?? await getLatestAgentCheckpoint(get().agentSessionId).catch(() => checkpoint);
            }
            set((current) => ({
              centerMode: "edit",
              activeEditPreview: preview,
              activeDraftContext: null,
              pendingCheckpoint: checkpoint,
              agentSessionId: checkpoint?.sessionId ?? current.agentSessionId,
              agentTask: taskWithCheckpoint(current.agentTask, checkpoint ?? current.agentTask?.checkpoint ?? null),
            }));
          } catch (error) {
            const errorText = error instanceof Error ? error.message : "恢复修改预览失败";
            set((current) => ({
              chatMessages: current.chatMessages.map((message) =>
                message.id === assistantMsg.id ? { ...message, text: errorText } : message
              ),
            }));
          }
          return;
        }

        if (action.toolName === "note_edit_tool" && action.action === "create_preview") {
          const noteId = typeof payload.noteId === "string" ? payload.noteId : latest.selectedFileId;
          const instruction =
            typeof payload.instruction === "string" ? payload.instruction : text;
          const selectedText =
            typeof payload.selectedText === "string" ? payload.selectedText : pageState?.selectedText ?? "";
          const sectionId =
            typeof payload.sectionId === "string" ? payload.sectionId : requestPageState.currentSectionId ?? null;
          const targetType =
            typeof payload.targetType === "string" ? (payload.targetType as EditTargetType) : null;

          if (!noteId) {
            set((current) => ({
              chatMessages: current.chatMessages.map((message) =>
                message.id === assistantMsg.id
                  ? { ...message, text: "请先打开一篇正式笔记，再让我生成修改预览。" }
                  : message
              ),
            }));
            return;
          }

          try {
            await syncNoteContentBeforeAiEdit(noteId);
            const preview = await createEditPreview({
              noteId,
              targetType,
              sectionId,
              selectedText,
              instruction,
              keepStyle: true,
              memoryEnabled: isMemoryEnabled(),
            });
            set((current) => ({
              centerMode: "edit",
              activeEditPreview: preview,
              pendingCheckpoint: current.pendingCheckpoint,
              draftSeed: "",
              draftCommand: null,
              activeDraftContext: null,
              chatMessages: current.chatMessages.map((message) =>
                message.id === assistantMsg.id
                  ? {
                      ...message,
                      text: "已生成 AI 修改预览，正式笔记还没有变化。你可以在中间区域查看原文和修改后内容，再决定应用或取消。",
                    }
                  : message
              ),
            }));
            if (checkpointId) {
              const checkpoint = await bindAgentCheckpoint(checkpointId, {
                editPreviewId: preview.id,
                payload: { editPreviewId: preview.id },
              }).catch(() => null);
              if (checkpoint) {
                set((current) => ({
                  pendingCheckpoint: checkpoint,
                  agentTask: taskWithCheckpoint(current.agentTask, checkpoint),
                }));
              }
            }
          } catch (error) {
            const errorText = error instanceof Error ? error.message : "修改预览生成失败";
            set((current) => ({
              agentTask: current.agentTask?.run.id
                ? taskWithRunStatus(current.agentTask, current.agentTask.run.id, "failed")
                : current.agentTask,
              chatMessages: current.chatMessages.map((message) =>
                message.id === assistantMsg.id ? { ...message, text: errorText } : message
              ),
            }));
            if (checkpointId) {
              await resolveAgentCheckpoint(checkpointId, "failed", { error: errorText }).catch(() => null);
            }
          }
        }
      };

      await askAIStream({
        sessionId: latest.agentSessionId,
        question: text,
        mode: chatMode,
        documentTitle: selectedFile?.name.replace(/\.md$/, ""),
        documentContent,
        pageState: requestPageState,
        history: state.chatMessages,
        memoryEnabled: isMemoryEnabled(),
        signal: abortController.signal,
        onContext: (context) => {
          set((current) => ({
            chatMessages: current.chatMessages.map((message) =>
              message.id === assistantMsg.id
                ? {
                    ...message,
                    contextMode: context.contextMode,
                    sources: context.sources,
                  }
                : message
            ),
          }));
        },
        onAnswerReplace: (content) => {
          set((current) => ({
            chatMessages: current.chatMessages.map((message) =>
              message.id === assistantMsg.id
                ? { ...message, text: content }
                : message
            ),
          }));
        },
        onAgentSession: (session) => {
          set((current) => ({
            agentSessionId: session.sessionId,
            agentTask: {
              run: {
                id: session.runId,
                sessionId: session.sessionId,
                intent: session.intent,
                status: "running",
                rawStatus: "running",
                inputText: text,
                outputText: "",
                errorMessage: null,
                startedAt: new Date().toISOString(),
                finishedAt: null,
                toolTraces: [],
              },
              checkpoint: current.pendingCheckpoint?.sessionId === session.sessionId
                ? current.pendingCheckpoint
                : null,
            },
            chatMessages: current.chatMessages.map((message) =>
              message.id === assistantMsg.id
                ? {
                    ...message,
                    agentSessionId: session.sessionId,
                    agentRunId: session.runId,
                  }
                : message.id === userMsg.id
                  ? {
                      ...message,
                      agentSessionId: session.sessionId,
                      agentRunId: session.runId,
                    }
                  : message
            ),
          }));
        },
        onToolTrace: (trace: AgentToolTrace) => {
          const visibleTrace = trace.metadata?.silent !== true;
          set((current) => {
            const task = current.agentTask;
            return {
              agentTask:
                visibleTrace && task && task.run.id === trace.runId
                  ? {
                      ...task,
                      checkpoint: task.checkpoint ?? null,
                      run: {
                        ...task.run,
                        toolTraces: [...task.run.toolTraces, trace],
                      },
                    }
                  : task,
              chatMessages: current.chatMessages.map((message) =>
                visibleTrace && message.id === assistantMsg.id
                  ? {
                      ...message,
                      toolTraces: [...(message.toolTraces ?? []), trace],
                    }
                  : message
              ),
            };
          });
        },
        onAgentDone: (result) => {
          set((current) => ({
            agentTask: result.status === "failed"
              ? taskWithRunStatus(current.agentTask, result.runId, "failed")
              : current.agentTask?.checkpoint
              ? taskWithCheckpoint(current.agentTask, current.agentTask.checkpoint)
              : taskWithRunStatus(current.agentTask, result.runId, result.status),
          }));
        },
        onAgentError: (event) => {
          const errorText = event.message || "Agent 执行失败，请稍后重试。";
          set((current) => {
            const runId = event.runId ?? current.agentTask?.run.id;
            const failedTask = runId ? taskWithRunStatus(current.agentTask, runId, "failed") : current.agentTask;
            return {
              agentTask: failedTask
                ? {
                    ...failedTask,
                    run: {
                      ...failedTask.run,
                      errorMessage: errorText,
                    },
                  }
                : failedTask,
            };
          });
        },
        onToolAction: (action) => {
          toolActionTasks.push(handleAgentToolAction(action));
        },
        onDelta: (delta) => {
          set((current) => ({
            chatMessages: current.chatMessages.map((message) =>
              message.id === assistantMsg.id
                ? { ...message, text: message.text + delta }
                : message
            ),
          }));
        },
      });
      await Promise.all(toolActionTasks);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        set((current) => ({
          agentTask: current.agentTask?.run.id
            ? taskWithRunStatus(current.agentTask, current.agentTask.run.id, "cancelled")
            : current.agentTask,
          chatMessages: current.chatMessages.map((message) =>
            message.id === assistantMsg.id && !message.text
              ? { ...message, text: "已停止生成。" }
              : message
          ),
        }));
        return;
      }

      const errorText =
        error instanceof Error ? error.message : "DeepSeek API 调用失败，请稍后重试。";
      set((current) => ({
        agentTask: current.agentTask?.run.id
          ? {
              ...taskWithRunStatus(current.agentTask, current.agentTask.run.id, "failed")!,
              run: {
                ...taskWithRunStatus(current.agentTask, current.agentTask.run.id, "failed")!.run,
                errorMessage: errorText,
              },
            }
          : current.agentTask,
        chatMessages: current.chatMessages.map((message) =>
          message.id === assistantMsg.id ? { ...message, text: errorText } : message
        ),
      }));
    } finally {
      if (generationAbortController === abortController) {
        generationAbortController = null;
        set({ chatLoading: false });
      }
      get().refreshAgentRunHistory(get().agentSessionId);
      void get().refreshChatSessions().catch(() => {});
    }
  },

  stopGeneration: () => {
    const current = get();
    const runId =
      current.agentTask?.run.id ??
      [...current.chatMessages].reverse().find((message) => message.agentRunId)?.agentRunId;
    generationAbortController?.abort();
    set((state) => ({
      chatLoading: false,
      agentTask: runId ? taskWithRunStatus(state.agentTask, runId, "cancelled") : state.agentTask,
    }));
    if (runId) {
      void cancelAgentRun(runId)
        .then((task) => {
          if (task) {
            set({
              agentTask: task,
              pendingCheckpoint: task.checkpoint ?? null,
            });
          }
          get().refreshAgentRunHistory(get().agentSessionId);
        })
        .catch(() => {});
    }
  },

  addNode: (parentId, node) => {
    set((state) => {
      const now = new Date().toISOString();
      const nextNode = node.type === "file"
        ? {
            ...node,
            createdAt: node.createdAt ?? now,
            updatedAt: node.updatedAt ?? now,
            indexStatus: node.indexStatus ?? "pending",
          }
        : node;
      const nextExpanded = parentId
        ? new Set(state.expandedFolderIds).add(parentId)
        : state.expandedFolderIds;
      const nextTreeData = parentId
        ? insertNode(state.treeData, parentId, nextNode)
        : [...state.treeData, nextNode];
      const nextFileContents =
        node.type === "file"
          ? { ...state.fileContents, [node.id]: node.content ?? "" }
          : state.fileContents;
      return {
        treeData: nextTreeData,
        fileContents: nextFileContents,
        expandedFolderIds: nextExpanded,
      };
    });
    persistLocalCurrentState();

    if (node.type === "folder") {
      void createCategory({
        id: node.id,
        name: node.name,
        parentId,
      }).catch((error) => {
        set({ workspaceError: error instanceof Error ? error.message : "创建分类失败" });
      });
      return;
    }

    void createNote({
      id: node.id,
      title: titleFromNodeName(node.name),
      categoryId: parentId,
      content: node.content ?? "",
      summary: node.summary ?? null,
      isPinned: Boolean(node.pinned),
      isFavorite: Boolean(node.favorite),
      tags: node.tags ?? [],
    })
      .then((note) => {
        const current = get();
        set({
          fileContents: { ...current.fileContents, [note.id]: note.content },
          treeData: replaceNoteRecordInTree(current.treeData, note),
        });
      })
      .catch((error) => {
        set({ workspaceError: error instanceof Error ? error.message : "创建笔记失败" });
      });
  },

  updateNodeName: (id, name) => {
    const currentTree = get().treeData;
    const node = findNode(currentTree, id);
    const parentId = findParentFolderId(currentTree, id);
    set((state) => ({ treeData: renameNode(state.treeData, id, name) }));
    persistLocalCurrentState();
    if (!node) return;

    if (node.type === "folder") {
      void updateCategory(id, {
        id,
        name,
        parentId,
      }).catch((error) => {
        set({ workspaceError: error instanceof Error ? error.message : "重命名分类失败" });
      });
      return;
    }

    void enqueueNoteMutation(id, () =>
      updateNote(id, {
        title: titleFromNodeName(name),
        source: "manual_edit",
        changeSummary: "重命名笔记",
      })
    )
      .then((note) => {
        const current = get();
        const localContent = current.fileContents[note.id];
        set({
          treeData: replaceNoteRecordInTree(current.treeData, {
            ...note,
            content: localContent ?? note.content,
          }),
        });
        persistLocalCurrentState();
      })
      .catch((error) => {
        set({ workspaceError: error instanceof Error ? error.message : "重命名笔记失败" });
      });
  },

  deleteNode: (id) => {
    const nodeToDelete = findNode(get().treeData, id);
    if (!nodeToDelete) return;
    set((state) => {
      const nextTree = removeNode(state.treeData, id);
      const deletedFileIds = new Set(collectFileIds(nodeToDelete));
      const nextContents = { ...state.fileContents };
      deletedFileIds.forEach((fileId) => delete nextContents[fileId]);

      return {
        treeData: nextTree,
        fileContents: nextContents,
        deletedNotes:
          nodeToDelete.type === "file"
            ? [
                {
                  id: nodeToDelete.id,
                  title: titleFromNodeName(nodeToDelete.name),
                  deletedAt: new Date().toISOString(),
                },
                ...state.deletedNotes.filter((note) => note.id !== nodeToDelete.id),
              ]
            : state.deletedNotes,
        selectedFileId:
          state.selectedFileId && deletedFileIds.has(state.selectedFileId)
            ? resolveSelectedFileId(nextTree, null)
            : state.selectedFileId,
      };
    });
    persistLocalCurrentState();

    const request = nodeToDelete.type === "folder" ? deleteCategory(id) : deleteNote(id);
    void request.catch((error) => {
      set({ workspaceError: error instanceof Error ? error.message : "删除失败" });
    });
  },

  restoreDeletedNote: (id) => {
    const userId = get().hydratedUserId;
    if (!userId) return;
    void restoreNote(id)
      .then(() => loadStructuredWorkspace(userId, id))
      .catch((error) => {
        set({ workspaceError: error instanceof Error ? error.message : "恢复笔记失败" });
      });
  },

  reindexNote: (id) => {
    const previousPollTimer = indexJobPollTimers.get(id);
    if (previousPollTimer) {
      window.clearTimeout(previousPollTimer);
      indexJobPollTimers.delete(id);
    }
    set((state) => ({ treeData: updateNodeIndexStatus(state.treeData, id, "indexing") }));
    void reindexNoteRequest(id)
      .then(({ note, job }) => {
        const current = get();
        set({
          fileContents: { ...current.fileContents, [note.id]: note.content },
          treeData: replaceNoteRecordInTree(current.treeData, note),
        });
        persistLocalCurrentState();

        let attempts = 0;
        const pollJob = () => {
          void listIndexJobs(id)
            .then((jobs) => {
              const currentJob = jobs.find((candidate) => candidate.id === job.id) ?? jobs[0];
              if (!currentJob) return;
              if (currentJob.status === "success") {
                indexJobPollTimers.delete(id);
                set((state) => ({ treeData: updateNodeIndexStatus(state.treeData, id, "indexed") }));
                persistLocalCurrentState();
                return;
              }
              if (currentJob.status === "failed") {
                indexJobPollTimers.delete(id);
                set((state) => ({
                  treeData: updateNodeIndexStatus(state.treeData, id, "failed"),
                  workspaceError: currentJob.errorMessage || "重新索引失败",
                }));
                return;
              }
              attempts += 1;
              if (attempts < 45) {
                indexJobPollTimers.set(id, window.setTimeout(pollJob, 1000));
              }
            })
            .catch(() => {
              attempts += 1;
              if (attempts < 45) {
                indexJobPollTimers.set(id, window.setTimeout(pollJob, 1000));
              }
            });
        };
        pollJob();
      })
      .catch((error) => {
        set((state) => ({
          treeData: updateNodeIndexStatus(state.treeData, id, "failed"),
          workspaceError: error instanceof Error ? error.message : "重新索引失败",
        }));
      });
  },

  restoreNoteVersion: async (noteId, versionId) => {
    set({ noteSaveState: noteSaveState("saving") });
    try {
      const note = await restoreNoteVersionRequest(noteId, versionId);
      const current = get();
      set({
        selectedFileId: note.id,
        fileContents: { ...current.fileContents, [note.id]: note.content },
        treeData: replaceNoteRecordInTree(current.treeData, note),
        noteSaveState: noteSaveState("saved"),
      });
      persistLocalCurrentState();
    } catch (error) {
      const message = error instanceof Error ? error.message : "恢复历史版本失败";
      set({ noteSaveState: noteSaveState("error", message) });
      throw error;
    }
  },

  moveNode: (id, parentId) => {
    const node = findNode(get().treeData, id);
    set((state) => ({
      treeData: moveNodeToParent(state.treeData, id, parentId),
      expandedFolderIds: parentId
        ? new Set(state.expandedFolderIds).add(parentId)
        : state.expandedFolderIds,
    }));
    persistLocalCurrentState();
    if (!node) return;

    if (node.type === "folder") {
      void updateCategory(id, {
        id,
        name: node.name,
        parentId,
      }).catch((error) => {
        set({ workspaceError: error instanceof Error ? error.message : "移动分类失败" });
      });
      return;
    }

    void updateNote(id, {
      categoryId: parentId,
      source: "manual_edit",
      changeSummary: "移动笔记",
    }).catch((error) => {
      set({ workspaceError: error instanceof Error ? error.message : "移动笔记失败" });
    });
  },

  toggleNodePinned: (id) => {
    const node = findNode(get().treeData, id);
    set((state) => ({ treeData: togglePinned(state.treeData, id) }));
    persistLocalCurrentState();
    if (!node || node.type !== "file") return;
    void updateNote(id, {
      isPinned: !node.pinned,
      source: "manual_edit",
      changeSummary: node.pinned ? "取消置顶" : "置顶笔记",
    }).catch((error) => {
      set({ workspaceError: error instanceof Error ? error.message : "更新置顶失败" });
    });
  },

  toggleNodeFavorite: (id) => {
    const node = findNode(get().treeData, id);
    if (!node || node.type !== "file") return;
    const nextFavorite = !node.favorite;
    set((state) => ({
      treeData: updateFileMetadata(state.treeData, id, { favorite: nextFavorite }),
    }));
    persistLocalCurrentState();
    void updateNote(id, {
      isFavorite: nextFavorite,
      source: "manual_edit",
      changeSummary: nextFavorite ? "收藏笔记" : "取消收藏",
    })
      .then((note) => {
        const current = get();
        set({ treeData: replaceNoteRecordInTree(current.treeData, note) });
        persistLocalCurrentState();
      })
      .catch((error) => {
        set((state) => ({
          treeData: updateFileMetadata(state.treeData, id, { favorite: !nextFavorite }),
          workspaceError: error instanceof Error ? error.message : "更新收藏失败",
        }));
      });
  },

  setNoteTags: (id, tags) => {
    const node = findNode(get().treeData, id);
    if (!node || node.type !== "file") return;
    const previousTags = node.tags ?? [];
    const normalized = Array.from(
      new Set(tags.map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean))
    )
      .map((tag) => tag.slice(0, 24))
      .slice(0, 12);
    set((state) => ({
      treeData: updateFileMetadata(state.treeData, id, { tags: normalized }),
    }));
    persistLocalCurrentState();
    void updateNote(id, {
      tags: normalized,
      source: "manual_edit",
      changeSummary: "更新标签",
    })
      .then((note) => {
        const current = get();
        set({ treeData: replaceNoteRecordInTree(current.treeData, note) });
        persistLocalCurrentState();
      })
      .catch((error) => {
        set((state) => ({
          treeData: updateFileMetadata(state.treeData, id, { tags: previousTags }),
          workspaceError: error instanceof Error ? error.message : "更新标签失败",
        }));
      });
  },
}));

async function loadStructuredWorkspace(userId: string, preferredSelectedFileId?: string | null) {
  useAppStore.getState().setWorkspaceLoading(true);
  useAppStore.getState().setWorkspaceError(null);

  try {
    let categories = await listCategories();
    let allNotes = await listNotes(true);
    let notes = allNotes.filter((note) => !note.deletedAt);

    if (categories.length === 0 && notes.length === 0) {
      const legacySnapshot = await loadKnowledgeBase(userId);
      if (legacySnapshot && legacySnapshot.treeData.length > 0) {
        if (isBundledDemoSnapshot(legacySnapshot)) {
          await clearKnowledgeBase().catch(() => {});
        } else {
          await migrateKnowledgeBase();
          categories = await listCategories();
          allNotes = await listNotes(true);
          notes = allNotes.filter((note) => !note.deletedAt);
        }
      }
    }

    if (categories.length > 0 || notes.length > 0) {
      const snapshot = buildTreeFromRecords(categories, notes);
      snapshot.selectedFileId = resolveSelectedFileId(
        snapshot.treeData,
        preferredSelectedFileId ?? useAppStore.getState().selectedFileId
      );
      useAppStore.getState().replaceSnapshot(snapshot);
      useAppStore.setState({
        deletedNotes: allNotes
          .filter((note) => note.deletedAt)
          .map((note) => ({
            id: note.id,
            title: note.title,
            deletedAt: note.deletedAt,
          })),
      });
      saveLocalSnapshot(userId, snapshot);
      await clearKnowledgeBase().catch(() => {});
    } else {
      const emptySnapshot: KnowledgeBaseSnapshot = {
        treeData: [],
        fileContents: {},
        selectedFileId: null,
      };
      useAppStore.getState().replaceSnapshot(emptySnapshot);
      useAppStore.setState({
        deletedNotes: allNotes
          .filter((note) => note.deletedAt)
          .map((note) => ({
            id: note.id,
            title: note.title,
            deletedAt: note.deletedAt,
          })),
      });
      saveLocalSnapshot(userId, emptySnapshot);
    }

    useAppStore.getState().setServerSyncReady(true);
  } catch (error) {
    const message = error instanceof Error ? error.message : "结构化笔记加载失败";
    const isOffline =
      (typeof navigator !== "undefined" && !navigator.onLine) ||
      error instanceof TypeError ||
      /failed to fetch|networkerror|network request failed/i.test(message);
    useAppStore
      .getState()
      .setWorkspaceError(
        isOffline
          ? "当前处于离线状态，正在使用本机缓存；联网后可重新同步。"
          : message
      );
  } finally {
    useAppStore.getState().setWorkspaceLoading(false);
  }
}

export function AppProvider({
  children,
  userId,
}: {
  children: ReactNode;
  userId: string;
}) {
  const hydratedUserId = useAppStore((state) => state.hydratedUserId);
  const selectedFileId = useAppStore((state) => state.selectedFileId);
  const fileContents = useAppStore((state) => state.fileContents);
  const treeData = useAppStore((state) => state.treeData);

  useEffect(() => {
    useAppStore.getState().hydrate(userId);
    return () => {
      generationAbortController?.abort();
      generationAbortController = null;
      if (noteSaveTimer) {
        window.clearTimeout(noteSaveTimer);
        noteSaveTimer = null;
      }
    };
  }, [userId]);

  useEffect(() => {
    if (hydratedUserId !== userId) return;
    void loadStructuredWorkspace(userId);
  }, [hydratedUserId, userId]);

  useEffect(() => {
    if (hydratedUserId !== userId) return;
    const flush = () => void flushOfflineNoteQueue(userId).catch(() => undefined);
    window.addEventListener("online", flush);
    if (navigator.onLine) flush();
    return () => window.removeEventListener("online", flush);
  }, [hydratedUserId, userId]);

  useEffect(() => {
    if (hydratedUserId !== userId) return;
    saveLocalSnapshot(userId, snapshotFromState(useAppStore.getState()));
  }, [fileContents, hydratedUserId, selectedFileId, treeData, userId]);

  return <>{children}</>;
}

export function useAppState(): AppState {
  return useAppStore();
}
