import type { FileNode } from "../types";

const fields = ["id", "name", "type", "createdAt", "updatedAt", "summary", "tags", "pinned", "favorite", "lastOpenedAt"] as const;

/** Metadata-only view for navigation. Full bodies remain authoritative in the
 * store; content, contentHash and indexing status are not navigation labels. */
export function createNavigationTreeSelector() {
  const cache = new WeakMap<FileNode[], FileNode[]>();
  let previous: FileNode[] = [];
  function project(nodes: FileNode[], old: FileNode[]): FileNode[] {
    const cached = cache.get(nodes);
    if (cached) return cached;
    const next = nodes.map((node, index) => {
      const prior = old[index];
      const children = node.children ? project(node.children, prior?.children ?? []) : undefined;
      if (prior && children === prior.children && fields.every(key => node[key] === prior[key])) return prior;
      const view: FileNode = { id: node.id, name: node.name, type: node.type };
      for (const key of fields) {
        if (node[key] !== undefined) Object.assign(view, { [key]: node[key] });
      }
      if (children) view.children = children;
      return view;
    });
    const result = next.length === old.length && next.every((node, i) => node === old[i]) ? old : next;
    cache.set(nodes, result);
    return result;
  }
  return (nodes: FileNode[]) => (previous = project(nodes, previous));
}
