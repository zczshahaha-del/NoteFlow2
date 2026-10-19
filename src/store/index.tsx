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
import { draftConversationIndex, updateDraftConversation, type DraftOutcome, type DraftWritingStage } from "../utils/aiWritingFlow";
import type { DraftBrief } from "../utils/draftBrief";
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
  saveLocalNoteContent,
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
  brief?: DraftBrief;
  messageId?: string;
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
  stage: DraftWritingStage;
  busy: boolean;
  statusText: string;
  errorText: string;
  completedSections: number;
  totalSections: number;
  hasBody?: boolean;
}

interface NoteSaveState {
  status: NoteSaveStatus;
  message?: string;
  updatedAt?: string;
}

interface WorkspaceIssue { id: string; label: string; message: string; busy: boolean }

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
  editDraftBrief: (messageId: string, patch: { title?: string; requirements?: string; generatedBrief?: DraftBrief; requestPending?: boolean }) => void;
  generateDraftBrief: (messageId: string) => void;
  consumeDraftCommand: (id: string) => void;
  addSelectionToChat: (selection: { text: string; noteId?: string | null; noteTitle?: string }) => void;
  clearChatSelection: () => void;
  closeDraft: (outcome?: DraftOutcome) => void;
  createEditPreviewRequest: (
    instruction: string,
    selectedText?: string,
    targetType?: EditTargetType | null,
    sectionId?: string | null
  ) => void;
  reviseEditPreviewRequest: (instruction: string) => Promise<boolean>;
  restoreEditPreviewRevisionRequest: (revisionId: string) => Promise<void>;
  applyEditPreviewRequest: () => Promise<void>;
  cancelEditPreviewRequest: () => Promise<void>;
  closeEditPreview: () => void;
  focusChatSource: (source: ChatSource) => void;
  clearPendingSourceFocus: () => void;
  clearPendingEditorSelection: () => void;
  setActiveEditorSectionId: (sectionId: string | null) => void;
  saveMemoryFromText: (text: string) => void;
  listMemoryRequest: (text?: string) => void;
  selectedFileId: string | null;
  noteOpenError: { noteId: string } | null;
  setSelectedFileId: (id: string | null) => void;
  expandedFolderIds: Set<string>;
  toggleFolder: (id: string) => void;
  fileContents: Record<string, string>;
  updateFileContent: (id: string, content: string) => void;
  noteSaveState: NoteSaveState;
  noteSaveStates: Record<string, NoteSaveState>;
  retryNoteSave: (noteId: string) => void;
  deletedNotes: DeletedNoteItem[];
  restoreDeletedNote: (id: string) => void;
  reindexNote: (id: string) => void;
  restoreNoteVersion: (noteId: string, versionId: string) => Promise<void>;
  workspaceLoading: boolean;
  workspaceError: string | null;
  workspaceIssues: WorkspaceIssue[];
  retryWorkspaceOperation: (id: string) => void;
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
  sendMessage: (text: string, pageState?: Partial<ChatPageState>, options?: { mode?: ChatMode; retryMessageId?: string }) => void;
  retryChatReply: (messageId: string) => void;
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
function newChatMessageMetadata(): Pick<ChatMessage, "id" | "createdAt"> {
  return { id: `msg-${++chatMsgCounter}`, createdAt: new Date().toISOString() };
}
let nodeCounter = 0;
let generationAbortController: AbortController | null = null;
const noteSaveTimers = new Map<string, ReturnType<typeof window.setTimeout>>();
const indexJobPollTimers = new Map<string, ReturnType<typeof window.setTimeout>>();
const noteSavesInFlight = new Map<string, Promise<void>>();
let workspaceEpoch = 0;
const noteMutationQueues = new Map<string, Promise<void>>();
const noteOpenRequests = new Map<string, object>();
const localNoteEdits = new Map<string, { userId: string | null; content: string }>();
const noteCreationRequests = new Map<string, object>();
let workspaceLoadRequest: object | null = null;
const workspaceOperations = new Map<string, { nodeId: string; deletedIds: Set<string>; run: () => Promise<void>; busy: boolean }>();

function runWorkspaceOperation<T>(id: string, nodeId: string, label: string, operation: (active: () => boolean, retrying: boolean) => Promise<T>, success?: (value: T) => void, deletedIds = new Set<string>()) {
  const userId = useAppStore.getState().hydratedUserId, epoch = workspaceEpoch;
  const task = { nodeId, deletedIds, busy: false, run: async () => {} };
  let retrying = false;
  const active = () => workspaceOperations.get(id) === task && useAppStore.getState().hydratedUserId === userId && workspaceEpoch === epoch;
  task.run = async () => {
    if (task.busy || !active()) return;
    task.busy = true;
    useAppStore.setState(state => ({ workspaceIssues: state.workspaceIssues.map(issue => issue.id === id ? { ...issue, busy: true } : issue) }));
    try {
      const value = await operation(active, retrying);
      if (!active()) return;
      success?.(value);
      workspaceOperations.delete(id);
      useAppStore.setState(state => ({ workspaceIssues: state.workspaceIssues.filter(issue => issue.id !== id), workspaceError: null }));
      persistLocalCurrentState();
    } catch (error) {
      if (!active()) return;
      retrying = true;
      const message = error instanceof Error ? error.message : `${label}未完成`;
      useAppStore.setState(state => ({ workspaceIssues: [...state.workspaceIssues.filter(issue => issue.id !== id), { id, label, message, busy: false }], workspaceError: message }));
    } finally { task.busy = false; }
  };
  workspaceOperations.set(id, task);
  void task.run();
}

function mergeWorkspaceRefresh(remote: KnowledgeBaseSnapshot, started: KnowledgeBaseSnapshot, current: KnowledgeBaseSnapshot, userId: string) {
  const flatten = (nodes: FileNode[], parentId: string | null = null, result = new Map<string, { node: FileNode; parentId: string | null }>()) => {
    for (const node of nodes) { result.set(node.id, { node, parentId }); if (node.children) flatten(node.children, node.id, result); }
    return result;
  };
  const before = flatten(started.treeData), local = flatten(current.treeData), next = flatten(remote.treeData);
  const pendingNodes = new Set([...workspaceOperations.values()].map(task => task.nodeId));
  const pendingDeletes = new Set([...workspaceOperations.values()].flatMap(task => [...task.deletedIds]));
  const dirty = (id: string) => localNoteEdits.get(id)?.userId === userId ||
    current.fileContents[id] !== started.fileContents[id];
  for (const [id, entry] of next) {
    const previous = before.get(id), latest = local.get(id);
    if (pendingDeletes.has(id) || (previous && !latest)) { next.delete(id); delete remote.fileContents[id]; continue; }
    if (!latest) continue;
    const node = { ...entry.node };
    if (latest.node.type === 'file' && dirty(id)) {
      node.content = current.fileContents[id] ?? latest.node.content ?? '';
      node.indexStatus = 'outdated';
      remote.fileContents[id] = node.content;
    }
    for (const field of ['name', 'pinned', 'favorite', 'tags'] as const) {
      if (pendingNodes.has(id) || (previous && latest.node[field] !== previous.node[field])) Object.assign(node, { [field]: latest.node[field] });
    }
    next.set(id, { node, parentId: pendingNodes.has(id) || (previous && latest.parentId !== previous.parentId) ? latest.parentId : entry.parentId });
  }
  const keepLocal = (id: string) => {
    if (next.has(id)) return;
    const entry = local.get(id); if (!entry) return;
    next.set(id, { node: { ...entry.node }, parentId: entry.parentId });
    if (entry.node.type === 'file') remote.fileContents[id] = current.fileContents[id] ?? entry.node.content ?? '';
    if (entry.parentId) keepLocal(entry.parentId);
  };
  for (const [id, entry] of local) {
    if (!before.has(id) || pendingNodes.has(id) || noteCreationRequests.has(id) || (entry.node.type === 'file' && dirty(id))) keepLocal(id);
  }
  const roots: FileNode[] = [];
  for (const entry of next.values()) if (entry.node.type === 'folder') entry.node.children = [];
  for (const entry of next.values()) {
    const parent = entry.parentId ? next.get(entry.parentId)?.node : null;
    if (parent?.type === 'folder') parent.children!.push(entry.node); else roots.push(entry.node);
  }
  return { ...remote, treeData: roots };
}

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

let localStateCheckpoint: { userId: string; snapshot: KnowledgeBaseSnapshot } | null = null;
function persistLocalCurrentState() {
  const state = useAppStore.getState();
  if (state.hydratedUserId) {
    const snapshot = snapshotFromState(state);
    if (saveLocalSnapshot(state.hydratedUserId, snapshot)) {
      localStateCheckpoint = { userId: state.hydratedUserId, snapshot };
    }
  }
}

function clearScheduledNoteSave(noteId?: string) {
  for (const [id, timer] of noteSaveTimers) if (!noteId || id === noteId) {
    window.clearTimeout(timer); noteSaveTimers.delete(id);
  }
}

function setNoteSaveState(noteId: string, value: NoteSaveState) {
  useAppStore.setState(state => ({
    noteSaveStates: { ...state.noteSaveStates, [noteId]: value },
    ...(state.selectedFileId === noteId ? { noteSaveState: value } : {}),
  }));
}

function startPersistNoteContent(noteId: string, content: string) {
  const promise = persistNoteContent(noteId, content);
  noteSavesInFlight.set(noteId, promise);
  void promise.finally(() => {
    if (noteSavesInFlight.get(noteId) === promise) noteSavesInFlight.delete(noteId);
  });
}

function scheduleNoteSave(noteId: string, content: string) {
  clearScheduledNoteSave(noteId);
  const ownerId = useAppStore.getState().hydratedUserId, epoch = workspaceEpoch;
  noteSaveTimers.set(noteId, window.setTimeout(() => {
    noteSaveTimers.delete(noteId);
    if (useAppStore.getState().hydratedUserId !== ownerId || workspaceEpoch !== epoch || !findFileById(useAppStore.getState().treeData, noteId)) return;
    startPersistNoteContent(noteId, content);
  }, 700));
}

async function persistNoteContent(noteId: string, content: string) {
  const ownerId = useAppStore.getState().hydratedUserId, epoch = workspaceEpoch;
  const ownsNote = () => useAppStore.getState().hydratedUserId === ownerId && workspaceEpoch === epoch && Boolean(findFileById(useAppStore.getState().treeData, noteId));
  if (!ownsNote() || useAppStore.getState().fileContents[noteId] !== content) return;
  const editOwner = localNoteEdits.get(noteId);
  let baseUpdatedAt: string | null = null;
  let baseContentHash: string | null = null;
  setNoteSaveState(noteId, noteSaveState("saving"));
  try {
    const note = await enqueueNoteMutation(noteId, async () => {
      const beforeSave = useAppStore.getState();
      if (!ownsNote() || beforeSave.fileContents[noteId] !== content) return null;
      if (noteCreationRequests.has(noteId)) throw new Error('笔记尚未创建成功，请先重试创建；当前正文已保留。');
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
    if (!note || !ownsNote() || note.id !== noteId) return;
    const current = useAppStore.getState();
    if (current.fileContents[noteId] !== content || localNoteEdits.get(noteId) !== editOwner) {
      const latestLocalContent = current.fileContents[note.id] ?? note.content;
      useAppStore.setState({
        treeData: updateNodeIndexStatus(reconcilePersistedNoteRecord(current.treeData, note, latestLocalContent), noteId, 'outdated'),
      });
      persistLocalCurrentState();
      return;
    }
    useAppStore.setState({
      fileContents: { ...current.fileContents, [note.id]: note.content },
      treeData: replaceNoteRecordInTree(current.treeData, note),
    });
    setNoteSaveState(noteId, noteSaveState("saved"));
    if (localNoteEdits.get(noteId) === editOwner) localNoteEdits.delete(noteId);
    persistLocalCurrentState();
  } catch (error) {
    if (!ownsNote() || useAppStore.getState().fileContents[noteId] !== content || localNoteEdits.get(noteId) !== editOwner) return;
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
        if (!ownsNote() || useAppStore.getState().fileContents[noteId] !== content || localNoteEdits.get(noteId) !== editOwner) return;
        setNoteSaveState(noteId, noteSaveState("offline", "已离线保存在本机，联网后会自动同步。"));
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
    if (ownsNote() && useAppStore.getState().fileContents[noteId] === content && localNoteEdits.get(noteId) === editOwner) setNoteSaveState(noteId, noteSaveState("error", message));
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
  if (useAppStore.getState().hydratedUserId !== userId || !findFileById(useAppStore.getState().treeData, noteId)) return;
  if (remote.content === localContent) {
    const current = useAppStore.getState();
    if (current.fileContents[noteId] !== localContent) return;
    useAppStore.setState({
      fileContents: { ...current.fileContents, [remote.id]: remote.content },
      treeData: replaceNoteRecordInTree(current.treeData, remote),
    });
    if (current.fileContents[noteId] === localContent) {
      localNoteEdits.delete(noteId);
      setNoteSaveState(noteId, noteSaveState("saved", "内容已经同步，无需创建冲突副本。"));
    }
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
  if (useAppStore.getState().hydratedUserId !== userId) return;
  if (useAppStore.getState().fileContents[noteId] === localContent) {
    localNoteEdits.delete(noteId);
    setNoteSaveState(noteId, noteSaveState("saved", "离线内容已保留为同步冲突副本。"));
  }
  await removeOfflineNoteEdit(userId, noteId).catch(() => undefined);
  await loadStructuredWorkspace(userId, conflict.id);
  if (useAppStore.getState().hydratedUserId === userId) setNoteSaveState(conflict.id, noteSaveState("saved", "检测到其他设备的更新，离线内容已保留为“同步冲突”副本。"));
}

async function flushOfflineNoteQueue(userId: string) {
  if (typeof indexedDB === "undefined") return;
  const edits = await listOfflineNoteEdits(userId);
  if (!edits.length) return;
  let changed = false;
  for (const edit of edits) {
    if (useAppStore.getState().hydratedUserId !== userId) return;
    try {
      const remote = await getNote(edit.noteId);
      if (remote.content === edit.content) {
        await removeOfflineNoteEdit(userId, edit.noteId);
        if (useAppStore.getState().hydratedUserId === userId && useAppStore.getState().fileContents[edit.noteId] === edit.content) {
          localNoteEdits.delete(edit.noteId); setNoteSaveState(edit.noteId, noteSaveState('saved'));
        }
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
      if (useAppStore.getState().hydratedUserId === userId && useAppStore.getState().fileContents[edit.noteId] === edit.content) {
        localNoteEdits.delete(edit.noteId); setNoteSaveState(edit.noteId, noteSaveState('saved'));
      }
      changed = true;
    } catch {
      if (typeof navigator !== "undefined" && !navigator.onLine) break;
    }
  }
  if (changed && useAppStore.getState().hydratedUserId === userId) {
    const selectedFileId = useAppStore.getState().selectedFileId;
    await loadStructuredWorkspace(userId, selectedFileId);
  }
}

async function syncNoteContentBeforeAiEdit(noteId: string) {
  const hadScheduledSave = noteSaveTimers.has(noteId);
  clearScheduledNoteSave(noteId);
  await noteSavesInFlight.get(noteId)?.catch(() => null);

  const current = useAppStore.getState();
  const shouldPersist =
    hadScheduledSave ||
    ['unsaved', 'saving', 'offline', 'error'].includes((current.noteSaveStates[noteId] ?? current.noteSaveState).status);
  if (!shouldPersist) return;

  const content = current.fileContents[noteId];
  if (content === undefined) return;

  await persistNoteContent(noteId, content);
  const latest = useAppStore.getState();
  if (latest.hydratedUserId !== current.hydratedUserId || latest.fileContents[noteId] !== content ||
    (latest.noteSaveStates[noteId]?.status ?? latest.noteSaveState.status) !== 'saved') throw new Error('正文尚未同步完成，请重试后再应用 AI 修改。');
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
  noteOpenError: null,
  expandedFolderIds: new Set(),
  fileContents: {},
  noteSaveState: noteSaveState("idle"),
  noteSaveStates: {},
  retryNoteSave: (noteId) => {
    const creation = workspaceOperations.get(`create:${noteId}`);
    if (noteCreationRequests.has(noteId) && creation) { void creation.run(); return; }
    if (noteSavesInFlight.has(noteId)) return;
    const content = get().fileContents[noteId];
    if (content === undefined || !findFileById(get().treeData, noteId)) return;
    clearScheduledNoteSave(noteId); startPersistNoteContent(noteId, content);
  },
  deletedNotes: [],
  workspaceLoading: false,
  workspaceError: null,
  workspaceIssues: [],
  retryWorkspaceOperation: (id) => { void workspaceOperations.get(id)?.run(); },
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
            ...newChatMessageMetadata(),
            role: "user",
            text: trimmedSeed,
          },
          {
            ...newChatMessageMetadata(),
            role: "assistant",
            text: "你可以先调整卡片里的标题和要求，再生成大纲。",
            draftCard: { seed: trimmedSeed, title: trimmedSeed, requirements: "", rawRequest: trimmedSeed, manualOutline: true },
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
            statusText: "等待确认标题和要求",
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
    if (!activeDraft || activeDraft.stage === "configuring" || (activeDraft.stage === "failed" && !activeDraft.id)) {
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
      // Keep the conversation card's durable status while the workspace is
      // open. Clearing it here made the card fall back to "configuring" after
      // the workspace was dismissed, even though the outline already existed.
      activeDraftContext: state.activeDraftContext,
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
          { ...newChatMessageMetadata(), role: "assistant", text },
        ],
      }));
    }
  },

  closeDraft: (outcome) => {
    set((state) => outcome?.draftId && state.activeDraftContext?.id !== outcome.draftId ? state : ({
      chatMessages: outcome ? updateDraftConversation(state.chatMessages, {
        checkpointId: state.pendingCheckpoint?.checkpointType === "draft_workspace" ? state.pendingCheckpoint.id : null,
        draftId: outcome.draftId || state.activeDraftContext?.id,
        seed: state.draftSeed || state.activeDraftContext?.topic || "",
      }, { status: outcome.status, draftId: outcome.draftId || state.activeDraftContext?.id }) : state.chatMessages,
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
    set((state) => ({ activeDraftContext: context,
      chatMessages: context?.id ? updateDraftConversation(state.chatMessages, {
        checkpointId: state.pendingCheckpoint?.checkpointType === "draft_workspace" ? state.pendingCheckpoint.id : null,
        draftId: context.id,
        seed: state.draftSeed || context.topic,
      }, { draftId: context.id }) : state.chatMessages,
    }));
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

  editDraftBrief: (messageId, patch) => {
    set(state => ({ chatMessages: state.chatMessages.map(message => message.id === messageId && message.draftCard && !["resolved", "cancelled"].includes(message.draftCard.status || "")
      ? { ...message, draftCard: { ...message.draftCard, ...patch } } : message) }));
  },

  generateDraftBrief: (messageId) => {
    const state = get();
    const checkpoint = state.pendingCheckpoint ?? state.agentTask?.checkpoint;
    const owner = { checkpointId: checkpoint?.checkpointType === "draft_workspace" ? checkpoint.id : null,
      draftId: state.activeDraftContext?.id, seed: state.draftSeed || state.activeDraftContext?.topic || "" };
    const index = draftConversationIndex(state.chatMessages, owner);
    const message = state.chatMessages[index];
    const card = message?.draftCard;
    if (!card || message.id !== messageId || card.requestPending || state.draftCommand || state.activeDraftContext?.busy) return;
    const brief = { title: (card.title ?? state.activeDraftContext?.title ?? card.seed).trim(), requirements: (card.requirements ?? "").trim(),
      rawRequest: card.rawRequest || (typeof checkpoint?.payload?.rawRequest === "string" ? checkpoint.payload.rawRequest : card.seed) };
    if (!brief.title) return;
    set({ chatMessages: state.chatMessages.map(item => item.id === messageId ? {...item, draftCard:{...item.draftCard!,requestPending:true}} : item),
      draftCommand: { id: `draft-brief-${newChatMessageMetadata().id}`, action: "generate_outline", seed: state.draftSeed,
      feedback: "", brief, messageId } });
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
      const userMsg: ChatMessage = { ...newChatMessageMetadata(), role: "user", text: instruction };
      const assistantMsg: ChatMessage = {
        ...newChatMessageMetadata(),
        role: "assistant",
        text: "请先打开一篇正式笔记，再让我生成修改预览。",
      };
      set((current) => ({ chatMessages: [...current.chatMessages, userMsg, assistantMsg] }));
      return;
    }

    const userMsg: ChatMessage = { ...newChatMessageMetadata(), role: "user", text: instruction };
    const assistantMsg: ChatMessage = {
      ...newChatMessageMetadata(),
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
    if (!preview || get().chatLoading) return false;
    const userMsg: ChatMessage = { ...newChatMessageMetadata(), role: "user", text: instruction };
    const assistantMsg: ChatMessage = {
      ...newChatMessageMetadata(),
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
      return true;
    } catch (error) {
      const text = error instanceof Error ? error.message : "继续调整失败";
      set((current) => ({
        editPreviewError: text,
        chatMessages: current.chatMessages.map((message) =>
          message.id === assistantMsg.id ? { ...message, text } : message
        ),
      }));
      return false;
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
        editPreviewError: text,
        chatMessages: [
          ...current.chatMessages,
          { ...newChatMessageMetadata(), role: "assistant", text },
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
        noteSaveStates: { ...current.noteSaveStates, [result.note.id]: noteSaveState('saved') },
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
            ...newChatMessageMetadata(),
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
          { ...newChatMessageMetadata(), role: "assistant", text },
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
    if (!editPreviewId || current.chatLoading) return;
    set({ chatLoading: true, editPreviewError: "" });
    try {
      await cancelEditPreview(editPreviewId);
      if (checkpoint?.checkpointType === "edit_preview") {
        void resolveAgentCheckpoint(checkpoint.id, "cancelled", {
          editPreviewId,
        })
          .then(() => get().refreshAgentRunHistory(checkpoint.sessionId))
          .catch(() => null);
      }
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
            ...newChatMessageMetadata(),
            role: "assistant",
            text: "已取消本次修改预览，正式笔记没有变化。",
          },
        ],
      }));
    } catch (error) {
      set({ editPreviewError: error instanceof Error ? error.message : "取消失败，请重试；预览已保留。" });
    } finally {
      set({ chatLoading: false });
    }
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
    const userMsg: ChatMessage = { ...newChatMessageMetadata(), role: "user", text: trimmed };
    const assistantMsg: ChatMessage = {
      ...newChatMessageMetadata(),
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
    const userMsg: ChatMessage = { ...newChatMessageMetadata(), role: "user", text };
    const assistantMsg: ChatMessage = {
      ...newChatMessageMetadata(),
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
    workspaceEpoch += 1;
    clearScheduledNoteSave();
    noteSavesInFlight.clear();
    workspaceOperations.clear();
    workspaceLoadRequest = null;
    noteCreationRequests.clear();
    noteOpenRequests.clear();
    localNoteEdits.clear();
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
      noteOpenError: null,
      expandedFolderIds: new Set(),
      fileContents: snapshot.fileContents,
      noteSaveState: noteSaveState("idle"),
      noteSaveStates: {},
      deletedNotes: [],
      workspaceLoading: true,
      workspaceError: null,
      workspaceIssues: [],
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
      noteOpenError: null,
      fileContents: snapshot.fileContents,
      treeData: snapshot.treeData,
      expandedFolderIds:
        state.expandedFolderIds.size > 0
          ? state.expandedFolderIds
          : new Set(collectFolderIds(snapshot.treeData)),
    }));
    persistLocalCurrentState();
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
      if (current.hydratedUserId === userId && !current.workspaceError && current.selectedFileId &&
        (!preferredSelectedFileId || current.selectedFileId === preferredSelectedFileId) && !localNoteEdits.has(current.selectedFileId)) {
        setNoteSaveState(current.selectedFileId, noteSaveState("saved", successMessage));
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
        noteOpenError: null,
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
        noteSaveState: id ? state.noteSaveStates[id] ?? noteSaveState("idle") : noteSaveState("idle"),
      };
    });
    persistLocalCurrentState();
    if (!id) return;
    const openedState = get();
    const openedNode = findFileById(openedState.treeData, id);
    const openedContent = openedState.fileContents[id];
    const request = {};
    noteOpenRequests.set(id, request);
    const ownsRequest = () => noteOpenRequests.get(id) === request &&
      get().hydratedUserId === openedState.hydratedUserId;
    void getNote(id)
      .then((note) => {
        const current = get();
        const localEdit = localNoteEdits.get(id);
        // The cached editor is usable while this read is pending. Never replace
        // newer typing, save/rename results, removed notes or another account.
        if (!ownsRequest() || note.id !== id || !openedNode ||
          findFileById(current.treeData, id) !== openedNode ||
          current.fileContents[id] !== openedContent ||
          (localEdit?.userId === current.hydratedUserId && localEdit?.content === openedContent)) return;
        set({
          fileContents: { ...current.fileContents, [note.id]: note.content },
          treeData: replaceNoteRecordInTree(current.treeData, note),
        });
        persistLocalCurrentState();
      })
      .catch(() => {
        if (ownsRequest() && get().selectedFileId === id) set({ noteOpenError: { noteId: id } });
      })
      .finally(() => {
        if (noteOpenRequests.get(id) === request) noteOpenRequests.delete(id);
      });
  },

  toggleFolder: (id) =>
    set((state) => {
      const next = new Set(state.expandedFolderIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { expandedFolderIds: next };
    }),

  updateFileContent: (id, content) => {
    const unsaved = noteSaveState("unsaved");
    set((state) => ({
      fileContents: { ...state.fileContents, [id]: content },
      treeData: updateFileContentInTree(state.treeData, id, content),
      noteSaveStates: { ...state.noteSaveStates, [id]: unsaved },
      ...(state.selectedFileId === id ? { noteSaveState: unsaved } : {}),
    }));
    const userId = get().hydratedUserId;
    localNoteEdits.set(id, { userId, content });
    if (userId && saveLocalNoteContent(userId, id, content)) {
      localStateCheckpoint = { userId, snapshot: snapshotFromState(get()) };
    }
    scheduleNoteSave(id, content);
  },

  retryChatReply: (messageId) => {
    const state = get();
    const message = state.chatMessages[state.chatMessages.length - 1];
    if (state.chatLoading || message?.id !== messageId || message.role !== "assistant" ||
        message.streamState !== "failed" || !message.replyRequest || message.retryBlocked ||
        state.pendingCheckpoint || state.activeDraftContext || state.activeEditPreview) return;
    state.sendMessage(message.replyRequest.question, undefined, { retryMessageId: messageId });
  },

  sendMessage: async (text, pageState, options) => {
    const state = get();
    if (state.chatLoading) return;
    const retryMessage = options?.retryMessageId ? state.chatMessages[state.chatMessages.length - 1] : undefined;
    if (options?.retryMessageId && (retryMessage?.id !== options.retryMessageId ||
        retryMessage.streamState !== "failed" || !retryMessage.replyRequest || retryMessage.retryBlocked ||
        state.pendingCheckpoint || state.activeDraftContext || state.activeEditPreview)) return;
    const retryRequest = retryMessage?.replyRequest;
    const chatMode: ChatMode = retryRequest?.mode ?? options?.mode ?? "chat";
    let replaceOnFirstDelta = Boolean(retryRequest);

    generationAbortController?.abort();
    const abortController = new AbortController();
    generationAbortController = abortController;
    const isCurrentReply = () => generationAbortController === abortController && !abortController.signal.aborted;

    const userMsg: ChatMessage = {
      ...newChatMessageMetadata(),
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
      ...(retryMessage ? { ...retryMessage, createdAt: new Date().toISOString() } : newChatMessageMetadata()),
      role: "assistant",
      text: retryMessage?.text ?? "",
      chatMode,
      streamState: "streaming",
      errorText: undefined,
      retrying: Boolean(retryRequest),
    };

    set((current) => {
      // Only the latest recoverable turn needs a full request snapshot.
      const messages = current.chatMessages.map(message => message.id === retryMessage?.id
        ? assistantMsg : message.replyRequest ? { ...message, replyRequest: undefined } : message);
      return { chatMessages: retryMessage ? messages : [...messages, userMsg, assistantMsg], chatLoading: true };
    });

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
      const replyRequest = retryRequest ?? {
        question: text,
        mode: chatMode,
        documentTitle: selectedFile?.name.replace(/\.md$/, "") ?? "",
        documentContent,
        pageState: requestPageState,
        history: state.chatMessages.map(({ role, text }) => ({ role, text })),
        memoryEnabled: isMemoryEnabled(),
      };
      set(current => ({ chatMessages: current.chatMessages.map(message =>
        message.id === assistantMsg.id ? { ...message, replyRequest } : message) }));
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
                    draftCard: { seed, checkpointId, title: typeof payload.draftBrief === "object" && payload.draftBrief ? String((payload.draftBrief as Record<string, unknown>).title || seed) : seed,
                      requirements: typeof payload.draftBrief === "object" && payload.draftBrief ? String((payload.draftBrief as Record<string, unknown>).requirements || "") : "",
                      rawRequest: typeof payload.rawRequest === "string" ? payload.rawRequest : text,
                      manualOutline: Boolean(payload.manualOutline) },
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
          get().closeDraft({ status: "cancelled", draftId: get().activeDraftContext?.id });
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
              noteSaveStates: { ...current.noteSaveStates, [result.note.id]: noteSaveState('saved') },
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
        ...replyRequest,
        sessionId: latest.agentSessionId,
        retryAnswerOnly: Boolean(retryRequest),
        retryOfRunId: retryMessage?.agentRunId,
        signal: abortController.signal,
        onContext: (context) => {
          if (!isCurrentReply()) return;
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
          if (!isCurrentReply()) return;
          replaceOnFirstDelta = false;
          set((current) => ({
            chatMessages: current.chatMessages.map((message) =>
              message.id === assistantMsg.id
                ? { ...message, text: content }
                : message
            ),
          }));
        },
        onAgentSession: (session) => {
          if (!isCurrentReply()) return;
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
                    retryBlocked: !["general_chat", "note_search", "note_context_qa", "unknown"].includes(session.intent),
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
          if (!isCurrentReply()) return;
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
          if (!isCurrentReply()) return;
          set((current) => ({
            chatMessages: result.status === "failed" || result.status === "cancelled"
              ? current.chatMessages.map(message => message.id === assistantMsg.id
                ? { ...message, streamState: result.status === "failed" ? "failed" : "stopped" }
                : message)
              : current.chatMessages,
            agentTask: result.status === "failed"
              ? taskWithRunStatus(current.agentTask, result.runId, "failed")
              : current.agentTask?.checkpoint
              ? taskWithCheckpoint(current.agentTask, current.agentTask.checkpoint)
              : taskWithRunStatus(current.agentTask, result.runId, result.status),
          }));
        },
        onAgentError: (event) => {
          if (!isCurrentReply()) return;
          const errorText = event.message || "Agent 执行失败，请稍后重试。";
          set((current) => {
            const runId = event.runId ?? current.agentTask?.run.id;
            const failedTask = runId ? taskWithRunStatus(current.agentTask, runId, "failed") : current.agentTask;
            return {
              chatMessages: current.chatMessages.map(message => message.id === assistantMsg.id
                ? { ...message, streamState: "failed", errorText }
                : message),
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
          if (!isCurrentReply()) return;
          set(current => ({ chatMessages: current.chatMessages.map(message =>
            message.id === assistantMsg.id ? { ...message, retryBlocked: true } : message) }));
          if (retryRequest) throw new Error("这次请求需要处理笔记任务，请回到对应任务继续。");
          toolActionTasks.push(handleAgentToolAction(action));
        },
        onDelta: (delta) => {
          if (!isCurrentReply()) return;
          set((current) => ({
            chatMessages: current.chatMessages.map((message) =>
              message.id === assistantMsg.id && message.streamState !== "failed"
                ? { ...message, text: (replaceOnFirstDelta ? "" : message.text) + delta }
                : message
            ),
          }));
          replaceOnFirstDelta = false;
        },
      });
      await Promise.all(toolActionTasks);
    } catch (error) {
      if (generationAbortController !== abortController) return;
      if (error instanceof Error && error.name === "AbortError") {
        set((current) => ({
          agentTask: current.agentTask?.run.id
            ? taskWithRunStatus(current.agentTask, current.agentTask.run.id, "cancelled")
            : current.agentTask,
          chatMessages: current.chatMessages.map((message) =>
            message.id === assistantMsg.id
              ? { ...message, text: message.text || "已停止生成。", streamState: "stopped" }
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
          message.id === assistantMsg.id ? { ...message, errorText, streamState: "failed" } : message
        ),
      }));
    } finally {
      if (generationAbortController === abortController) {
        generationAbortController = null;
        set((current) => ({
          chatLoading: false,
          chatMessages: current.chatMessages.map(message =>
            message.id === assistantMsg.id
              ? { ...message, retrying: false,
                replyRequest: message.streamState === "failed" ? message.replyRequest : undefined,
                streamState: message.streamState === "streaming"
                ? abortController.signal.aborted ? "stopped" : "completed" : message.streamState }
              : message
          ),
        }));
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
      chatMessages: state.chatMessages.map(message =>
        message.streamState === "streaming" ? { ...message, streamState: "stopped", retrying: false, replyRequest: undefined } : message
      ),
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
    const ownerId = get().hydratedUserId;
    const creation = {};
    if (node.type === 'file') noteCreationRequests.set(node.id, creation);
    const ownsCreation = () => get().hydratedUserId === ownerId && noteCreationRequests.get(node.id) === creation && Boolean(findFileById(get().treeData, node.id));
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
      runWorkspaceOperation(`create:${node.id}`, node.id, '创建文件夹', async (active, retrying) => {
        const latest = findNode(get().treeData, node.id);
        if (!latest) return null;
        const payload = { id: node.id, name: latest.name, parentId: findParentFolderId(get().treeData, node.id) };
        // A lost response may have committed the initial POST. Retry the same
        // identity, never create another folder or repeat an unsafe duplicate POST.
        if (retrying) {
          const existing = (await listCategories()).find(category => category.id === node.id);
          if (!active()) return null;
          if (existing) return updateCategory(node.id, payload);
        }
        return createCategory(payload);
      });
      return;
    }

    runWorkspaceOperation(`create:${node.id}`, node.id, '创建笔记', (active) => enqueueNoteMutation(node.id, () => active() && ownsCreation() ? createNote({
      id: node.id,
      title: titleFromNodeName(findFileById(get().treeData, node.id)?.name ?? node.name),
      categoryId: findParentFolderId(get().treeData, node.id),
      content: get().fileContents[node.id] ?? node.content ?? "",
      idempotencyKey: `create:${ownerId}:${node.id}`,
      summary: node.summary ?? null,
      isPinned: Boolean(node.pinned),
      isFavorite: Boolean(node.favorite),
      tags: node.tags ?? [],
    }) : Promise.resolve(null)), (note) => {
        if (!note || !ownsCreation() || note.id !== node.id) return;
        const current = get();
        const currentNode = findFileById(current.treeData, node.id)!;
        const content = current.fileContents[node.id] ?? note.content;
        const merged = { ...note, content,
          title: currentNode.name !== node.name ? titleFromNodeName(currentNode.name) : note.title,
          indexStatus: content !== note.content ? 'outdated' : note.indexStatus };
        set({
          fileContents: { ...current.fileContents, [note.id]: content },
          treeData: replaceNoteRecordInTree(current.treeData, merged),
        });
        persistLocalCurrentState();
        if (content === note.content) {
          clearScheduledNoteSave(node.id); localNoteEdits.delete(node.id); setNoteSaveState(node.id, noteSaveState('saved'));
        } else {
          setNoteSaveState(node.id, noteSaveState('unsaved')); scheduleNoteSave(node.id, content);
        }
        if (noteCreationRequests.get(node.id) === creation) noteCreationRequests.delete(node.id);
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
      runWorkspaceOperation(`rename:${id}`, id, '重命名文件夹', () => updateCategory(id, {
        id,
        name,
        parentId,
      }));
      return;
    }

    runWorkspaceOperation(`rename:${id}`, id, '重命名笔记', (active) => enqueueNoteMutation(id, () =>
      active() ? updateNote(id, {
        title: titleFromNodeName(name),
        source: "manual_edit",
        changeSummary: "重命名笔记",
      }) : Promise.resolve(null)
    ), (note) => {
        if (!note || !findFileById(get().treeData, id)) return;
        const current = get();
        const localContent = current.fileContents[note.id];
        set({
          treeData: replaceNoteRecordInTree(current.treeData, {
            ...note,
            content: localContent ?? note.content,
          }),
        });
        persistLocalCurrentState();
      });
  },

  deleteNode: (id) => {
    const nodeToDelete = findNode(get().treeData, id);
    if (!nodeToDelete) return;
    set((state) => {
      const nextTree = removeNode(state.treeData, id);
      const deletedFileIds = new Set(collectFileIds(nodeToDelete));
      const nextContents = { ...state.fileContents };
      const nextSaveStates = { ...state.noteSaveStates };
      deletedFileIds.forEach((fileId) => {
        delete nextContents[fileId];
        delete nextSaveStates[fileId];
        localNoteEdits.delete(fileId);
        noteOpenRequests.delete(fileId);
        noteCreationRequests.delete(fileId);
        clearScheduledNoteSave(fileId);
      });

      return {
        treeData: nextTree,
        fileContents: nextContents,
        noteSaveStates: nextSaveStates,
        noteSaveState: nextSaveStates[state.selectedFileId && !deletedFileIds.has(state.selectedFileId) ? state.selectedFileId : resolveSelectedFileId(nextTree, null) ?? ''] ?? noteSaveState('idle'),
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

    const removedIds = new Set<string>();
    const collect = (node: FileNode) => { removedIds.add(node.id); node.children?.forEach(collect); }; collect(nodeToDelete);
    for (const [key, task] of workspaceOperations) if (removedIds.has(task.nodeId)) workspaceOperations.delete(key);
    set(state => ({ workspaceIssues: state.workspaceIssues.filter(issue => workspaceOperations.has(issue.id)) }));
    runWorkspaceOperation(`delete:${id}`, id, nodeToDelete.type === 'folder' ? '删除文件夹' : '删除笔记', () => nodeToDelete.type === "folder" ? deleteCategory(id) : deleteNote(id), undefined, removedIds);
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
      runWorkspaceOperation(`move:${id}`, id, '移动文件夹', () => updateCategory(id, {
        id,
        name: node.name,
        parentId,
      }));
      return;
    }

    runWorkspaceOperation(`move:${id}`, id, '移动笔记', active => enqueueNoteMutation(id, () => active() ? updateNote(id, {
      categoryId: parentId,
      source: "manual_edit",
      changeSummary: "移动笔记",
    }) : Promise.resolve(null)));
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
  const request = {};
  workspaceLoadRequest = request;
  const started = snapshotFromState(useAppStore.getState());
  const ownsRequest = () => workspaceLoadRequest === request && useAppStore.getState().hydratedUserId === userId;
  useAppStore.getState().setWorkspaceLoading(true);
  useAppStore.getState().setWorkspaceError(null);

  try {
    let categories = await listCategories();
    if (!ownsRequest()) return;
    let allNotes = await listNotes(true);
    if (!ownsRequest()) return;
    let notes = allNotes.filter((note) => !note.deletedAt);

    if (categories.length === 0 && notes.length === 0) {
      const legacySnapshot = await loadKnowledgeBase(userId);
      if (!ownsRequest()) return;
      if (legacySnapshot && legacySnapshot.treeData.length > 0) {
        if (isBundledDemoSnapshot(legacySnapshot)) {
          await clearKnowledgeBase().catch(() => {});
        } else {
          await migrateKnowledgeBase();
          categories = await listCategories();
          allNotes = await listNotes(true);
          if (!ownsRequest()) return;
          notes = allNotes.filter((note) => !note.deletedAt);
        }
      }
    }

    if (!ownsRequest()) return;
    if (categories.length > 0 || notes.length > 0) {
      const current = snapshotFromState(useAppStore.getState());
      const snapshot = mergeWorkspaceRefresh(buildTreeFromRecords(categories, notes), started, current, userId);
      snapshot.selectedFileId = resolveSelectedFileId(
        snapshot.treeData,
        current.selectedFileId !== started.selectedFileId ? current.selectedFileId : preferredSelectedFileId ?? current.selectedFileId
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
      await clearKnowledgeBase().catch(() => {});
    } else {
      const current = snapshotFromState(useAppStore.getState());
      const emptySnapshot = mergeWorkspaceRefresh({
        treeData: [],
        fileContents: {},
        selectedFileId: null,
      }, started, current, userId);
      emptySnapshot.selectedFileId = resolveSelectedFileId(emptySnapshot.treeData, current.selectedFileId);
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
    }

    if (ownsRequest()) useAppStore.getState().setServerSyncReady(true);
  } catch (error) {
    if (!ownsRequest()) return;
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
    if (ownsRequest()) useAppStore.getState().setWorkspaceLoading(false);
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

  useEffect(() => {
    useAppStore.getState().hydrate(userId);
    return () => {
      generationAbortController?.abort();
      generationAbortController = null;
      clearScheduledNoteSave();
    };
  }, [userId]);

  useEffect(() => {
    if (hydratedUserId !== userId) return;
    void loadStructuredWorkspace(userId);
  }, [hydratedUserId, userId]);

  // Preserve the old safety net for rollback / bulk state changes, without
  // subscribing React to every keystroke or duplicating the action's write.
  useEffect(() => {
    let active = true;
    let queued = false;
    const schedule = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        const state = useAppStore.getState();
        if (!active || state.hydratedUserId !== userId) return;
        const checkpoint = localStateCheckpoint?.userId === userId ? localStateCheckpoint.snapshot : null;
        if (checkpoint?.treeData === state.treeData && checkpoint.fileContents === state.fileContents && checkpoint.selectedFileId === state.selectedFileId) return;
        persistLocalCurrentState();
      });
    };
    const unsubscribe = useAppStore.subscribe((state, previous) => {
      if (state.treeData !== previous.treeData || state.fileContents !== previous.fileContents || state.selectedFileId !== previous.selectedFileId || state.hydratedUserId !== previous.hydratedUserId) schedule();
    });
    // Keep the legacy baseline current when leaving, including a code rollback.
    const flush = () => {
      if (useAppStore.getState().hydratedUserId === userId) persistLocalCurrentState();
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    schedule();
    return () => {
      active = false; unsubscribe();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, [userId]);

  useEffect(() => {
    if (hydratedUserId !== userId) return;
    const flush = () => void flushOfflineNoteQueue(userId).catch(() => undefined);
    window.addEventListener("online", flush);
    if (navigator.onLine) flush();
    return () => window.removeEventListener("online", flush);
  }, [hydratedUserId, userId]);

  return <>{children}</>;
}

export function useAppState(): AppState {
  return useAppStore();
}
