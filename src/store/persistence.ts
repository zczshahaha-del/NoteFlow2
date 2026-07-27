import type { KnowledgeBaseSnapshot } from "../services/knowledgeBase";
import type { FileNode } from "../types";
import { findFileById } from "../workspaceTree";

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
  } catch {}
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
  saveToStorage(userStorageKey(userId, "tree-data"), snapshot.treeData);
  saveToStorage(userStorageKey(userId, "file-contents"), snapshot.fileContents);
  saveToStorage(
    userStorageKey(userId, "selected-file-id"),
    snapshot.selectedFileId
  );
}
