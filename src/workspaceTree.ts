import type { FileNode } from "./types";

/**
 * The workspace is populated from the API after authentication.
 * Keeping the initial tree empty prevents demo content from entering production state.
 */
export const initialWorkspaceTree: FileNode[] = [];

export function findFileById(
  nodes: FileNode[],
  id: string
): FileNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findFileById(node.children, id);
      if (found) return found;
    }
  }
  return undefined;
}
