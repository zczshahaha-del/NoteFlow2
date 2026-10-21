import type { FileNode } from "../types";

/** Folder names only; the document name has its own editable field. */
export function documentFolderPath(nodes: FileNode[], noteId: string): string[] {
  for (const node of nodes) {
    if (node.id === noteId) return [];
    if (node.type !== "folder" || !node.children) continue;
    const path = findFolderPath(node.children, noteId);
    if (path) return [node.name, ...path];
  }
  return [];
}

function findFolderPath(nodes: FileNode[], noteId: string): string[] | null {
  for (const node of nodes) {
    if (node.id === noteId) return [];
    if (node.type === "folder" && node.children) {
      const path = findFolderPath(node.children, noteId);
      if (path) return [node.name, ...path];
    }
  }
  return null;
}

/** Compare only the first block, never strip a heading or rewrite Markdown. */
export function hasMatchingDocumentTitle(title: string, firstBlock: {
  type: { name: string };
  attrs: Record<string, unknown>;
  textContent: string;
} | null | undefined): boolean {
  const normalize = (text: string) => text.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return firstBlock?.type.name === "heading" && firstBlock.attrs.level === 1
    && !firstBlock.attrs.sourcePrefix
    && Boolean(normalize(title)) && normalize(title) === normalize(firstBlock.textContent);
}
