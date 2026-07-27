import type { NoteCategoryRecord } from "../services/categories";
import type { KnowledgeBaseSnapshot } from "../services/knowledgeBase";
import type { NoteRecord } from "../services/notes";
import type { FileNode } from "../types";

export function collectFolderIds(nodes: FileNode[]): string[] {
  return nodes.flatMap((node) => {
    if (node.type !== "folder") return [];
    return [
      node.id,
      ...(node.children ? collectFolderIds(node.children) : []),
    ];
  });
}

export function insertNode(
  nodes: FileNode[],
  parentId: string,
  newNode: FileNode
): FileNode[] {
  return nodes.map((node) => {
    if (node.id === parentId && node.type === "folder") {
      return { ...node, children: [...(node.children || []), newNode] };
    }
    if (node.children) {
      return { ...node, children: insertNode(node.children, parentId, newNode) };
    }
    return node;
  });
}

export function renameNode(nodes: FileNode[], id: string, name: string): FileNode[] {
  return nodes.map((node) => {
    if (node.id === id) return { ...node, name };
    if (node.children) {
      return { ...node, children: renameNode(node.children, id, name) };
    }
    return node;
  });
}

export function collectFileIds(node: FileNode): string[] {
  if (node.type === "file") return [node.id];
  return (node.children ?? []).flatMap(collectFileIds);
}

export function findNode(nodes: FileNode[], id: string): FileNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = node.children ? findNode(node.children, id) : null;
    if (child) return child;
  }
  return null;
}

export function findParentFolderId(
  nodes: FileNode[],
  targetId: string
): string | null {
  for (const node of nodes) {
    if (node.type === "folder" && node.children) {
      for (const child of node.children) {
        if (child.id === targetId) return node.id;
      }
      const found = findParentFolderId(node.children, targetId);
      if (found) return found;
    }
  }
  return null;
}

function containsNode(nodes: FileNode[] | undefined, id: string): boolean {
  if (!nodes) return false;
  return nodes.some((node) => node.id === id || containsNode(node.children, id));
}

export function removeNode(nodes: FileNode[], id: string): FileNode[] {
  return nodes
    .filter((node) => node.id !== id)
    .map((node) => (
      node.children
        ? { ...node, children: removeNode(node.children, id) }
        : node
    ));
}

function addNodeToParent(
  nodes: FileNode[],
  parentId: string | null,
  nodeToAdd: FileNode
): FileNode[] {
  if (!parentId) return [...nodes, nodeToAdd];
  return nodes.map((node) => {
    if (node.id === parentId && node.type === "folder") {
      return { ...node, children: [...(node.children ?? []), nodeToAdd] };
    }
    if (node.children) {
      return {
        ...node,
        children: addNodeToParent(node.children, parentId, nodeToAdd),
      };
    }
    return node;
  });
}

export function moveNodeToParent(
  nodes: FileNode[],
  id: string,
  parentId: string | null
): FileNode[] {
  const nodeToMove = findNode(nodes, id);
  if (!nodeToMove || nodeToMove.id === parentId) return nodes;
  if (
    nodeToMove.type === "folder" &&
    containsNode(nodeToMove.children, parentId ?? "")
  ) {
    return nodes;
  }
  return addNodeToParent(removeNode(nodes, id), parentId, nodeToMove);
}

export function togglePinned(nodes: FileNode[], id: string): FileNode[] {
  return nodes.map((node) => {
    if (node.id === id) return { ...node, pinned: !node.pinned };
    if (node.children) {
      return { ...node, children: togglePinned(node.children, id) };
    }
    return node;
  });
}

export function updateFileMetadata(
  nodes: FileNode[],
  id: string,
  metadata: Partial<Pick<FileNode, "tags" | "favorite" | "lastOpenedAt">>
): FileNode[] {
  return nodes.map((node) => {
    if (node.id === id && node.type === "file") {
      return { ...node, ...metadata };
    }
    if (node.children) {
      return {
        ...node,
        children: updateFileMetadata(node.children, id, metadata),
      };
    }
    return node;
  });
}

export function updateFileContentInTree(
  nodes: FileNode[],
  id: string,
  content: string
): FileNode[] {
  return nodes.map((node) => {
    if (node.id === id && node.type === "file") {
      return { ...node, content, indexStatus: "outdated" };
    }
    if (node.children) {
      return {
        ...node,
        children: updateFileContentInTree(node.children, id, content),
      };
    }
    return node;
  });
}

export function titleFromNodeName(name: string): string {
  return name.trim().replace(/\.md$/i, "").trim() || "未命名笔记";
}

function noteName(title: string): string {
  const normalized = titleFromNodeName(title);
  return normalized.endsWith(".md") ? normalized : `${normalized}.md`;
}

function findFirstFileId(nodes: FileNode[]): string | null {
  for (const node of nodes) {
    if (node.type === "file") return node.id;
    const childId = node.children ? findFirstFileId(node.children) : null;
    if (childId) return childId;
  }
  return null;
}

export function buildTreeFromRecords(
  categories: NoteCategoryRecord[],
  notes: NoteRecord[]
): KnowledgeBaseSnapshot {
  const categoryNodes = new Map<string, FileNode>();
  const sortedCategories = [...categories].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.name.localeCompare(b.name, "zh-Hans-CN");
  });
  const roots: FileNode[] = [];
  const fileContents: Record<string, string> = {};

  sortedCategories.forEach((category) => {
    categoryNodes.set(category.id, {
      id: category.id,
      name: category.name,
      type: "folder",
      children: [],
    });
  });

  sortedCategories.forEach((category) => {
    const node = categoryNodes.get(category.id);
    if (!node) return;
    const parent = category.parentId
      ? categoryNodes.get(category.parentId)
      : null;
    if (parent) {
      parent.children = [...(parent.children ?? []), node];
    } else {
      roots.push(node);
    }
  });

  const sortedNotes = [...notes].sort((a, b) => {
    if (a.isPinned !== b.isPinned) {
      return Number(b.isPinned) - Number(a.isPinned);
    }
    return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
  });

  sortedNotes.forEach((note) => {
    const node: FileNode = {
      id: note.id,
      name: noteName(note.title),
      type: "file",
      content: note.content,
      contentHash: note.contentHash,
      pinned: note.isPinned,
      createdAt: note.createdAt ?? undefined,
      updatedAt: note.updatedAt ?? undefined,
      summary: note.summary ?? undefined,
      tags: note.tags ?? [],
      favorite: note.isFavorite,
      indexStatus: note.indexStatus,
    };
    fileContents[note.id] = note.content ?? "";
    const parent = note.categoryId
      ? categoryNodes.get(note.categoryId)
      : null;
    if (parent) {
      parent.children = [...(parent.children ?? []), node];
    } else {
      roots.push(node);
    }
  });

  return {
    treeData: roots,
    fileContents,
    selectedFileId: findFirstFileId(roots),
  };
}

export function replaceNoteRecordInTree(
  nodes: FileNode[],
  note: NoteRecord
): FileNode[] {
  return nodes.map((node) => {
    if (node.id === note.id && node.type === "file") {
      return {
        ...node,
        name: noteName(note.title),
        content: note.content,
        contentHash: note.contentHash,
        pinned: note.isPinned,
        createdAt: note.createdAt ?? node.createdAt,
        updatedAt: note.updatedAt ?? node.updatedAt,
        summary: note.summary ?? node.summary,
        tags: note.tags ?? node.tags ?? [],
        favorite: note.isFavorite,
        indexStatus: note.indexStatus,
      };
    }
    if (node.children) {
      return {
        ...node,
        children: replaceNoteRecordInTree(node.children, note),
      };
    }
    return node;
  });
}

export function reconcilePersistedNoteRecord(
  nodes: FileNode[],
  persistedNote: NoteRecord,
  latestLocalContent: string
): FileNode[] {
  return replaceNoteRecordInTree(nodes, {
    ...persistedNote,
    content: latestLocalContent,
  });
}

export function updateNodeIndexStatus(
  nodes: FileNode[],
  noteId: string,
  indexStatus: string
): FileNode[] {
  return nodes.map((node) => {
    if (node.id === noteId && node.type === "file") {
      return { ...node, indexStatus };
    }
    if (node.children) {
      return {
        ...node,
        children: updateNodeIndexStatus(node.children, noteId, indexStatus),
      };
    }
    return node;
  });
}
