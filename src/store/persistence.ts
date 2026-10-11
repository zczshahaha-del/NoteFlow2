import type { KnowledgeBaseSnapshot } from "../services/knowledgeBase";
import type { FileNode } from "../types";
import { findFileById } from "../workspaceTree";
import { updateFileContentInTree } from "./tree";

const BUNDLED_DEMO_FILE_IDS = new Set([
  "redis-cache-3-problems",
  "redis-distributed-lock",
  "redis-persistence",
  "redis-data-types",
  "redis-cluster",
]);

function userStorageKey(userId: string, suffix: string): string {
  return `noteflow:${userId}:${suffix}`;
}

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch {}
  return fallback;
}

function saveToStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch { return false; }
}

// A synchronous, per-note journal: typing never serializes other notes, and there
// is no debounce window in which closing the tab would lose the last characters.
function draftPrefix(userId: string) { return userStorageKey(userId, "note-draft:"); }
export function saveLocalNoteContent(userId: string, noteId: string, content: string) {
  return saveToStorage(draftPrefix(userId) + noteId, content);
}

function findFirstFileId(nodes: FileNode[]): string | null {
  for (const node of nodes) {
    if (node.type === "file") return node.id;
    const childId = node.children ? findFirstFileId(node.children) : null;
    if (childId) return childId;
  }
  return null;
}

export function resolveSelectedFileId(
  treeData: FileNode[],
  preferred: string | null
): string | null {
  if (preferred === null) return null;
  if (preferred && findFileById(treeData, preferred)) return preferred;
  return findFirstFileId(treeData);
}

function collectBundledDemoFileIds(nodes: FileNode[]): string[] {
  return nodes.flatMap((node) => {
    if (node.type === "file") return [node.id];
    return node.children ? collectBundledDemoFileIds(node.children) : [];
  });
}

export function isBundledDemoSnapshot(
  snapshot: KnowledgeBaseSnapshot
): boolean {
  const fileIds = collectBundledDemoFileIds(snapshot.treeData);
  return (
    fileIds.length === BUNDLED_DEMO_FILE_IDS.size &&
    fileIds.every((id) => BUNDLED_DEMO_FILE_IDS.has(id))
  );
}

export function loadLocalSnapshot(userId: string): KnowledgeBaseSnapshot {
  let treeData = loadFromStorage<FileNode[]>(
    userStorageKey(userId, "tree-data"),
    []
  );
  let fileContents = loadFromStorage<Record<string, string>>(
    userStorageKey(userId, "file-contents"),
    {}
  );
  if (isBundledDemoSnapshot({ treeData, fileContents, selectedFileId: null })) {
    treeData = [];
    fileContents = {};
  }
  // Only hydrate live note IDs from the authoritative tree, never resurrect a
  // deleted note from a journal. Empty strings are valid edits.
  const restore = (nodes: FileNode[]) => {
    for (const node of nodes) {
      if (node.type === "file") {
        const content = loadFromStorage<unknown>(draftPrefix(userId) + node.id, null);
        if (typeof content === "string") {
          fileContents[node.id] = content;
          treeData = updateFileContentInTree(treeData, node.id, content);
        }
      } else if (node.children) restore(node.children);
    }
  };
  restore(treeData);
  const selectedFileId = resolveSelectedFileId(
    treeData,
    loadFromStorage<string | null>(
      userStorageKey(userId, "selected-file-id"),
      null
    )
  );

  return { treeData, fileContents, selectedFileId };
}

export function saveLocalSnapshot(
  userId: string,
  snapshot: KnowledgeBaseSnapshot
) {
  const contentsSaved = saveToStorage(userStorageKey(userId, "file-contents"), snapshot.fileContents);
  const treeSaved = saveToStorage(userStorageKey(userId, "tree-data"), snapshot.treeData);
  const selectionSaved = saveToStorage(
    userStorageKey(userId, "selected-file-id"),
    snapshot.selectedFileId
  );
  // Compact only after both baseline writes succeed. On quota/storage failure,
  // retain the journal so the last successfully written edit is recoverable.
  if (contentsSaved && treeSaved) {
    try {
      const prefix = draftPrefix(userId);
      const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
      for (const key of keys) if (key?.startsWith(prefix)) localStorage.removeItem(key);
    } catch {}
  }
  return contentsSaved && treeSaved && selectionSaved;
}
