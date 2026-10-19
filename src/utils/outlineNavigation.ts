export interface OutlineHeading {
  id: string;
  level: number;
  text: string;
  displayNumber?: string;
  numberJoinsText?: boolean;
  hierarchyDepth?: number;
}
export interface OutlineNode { item: OutlineHeading; key: string; depth: number; children: OutlineNode[] }
export interface OutlineModel {
  roots: OutlineNode[];
  nodes: Map<string, OutlineNode>;
  parents: Map<string, string>;
  expandable: Set<string>;
  defaults: Set<string>;
}

export function buildOutlineModel(headings: OutlineHeading[]): OutlineModel {
  const roots: OutlineNode[] = [], stack: OutlineNode[] = [];
  const nodes = new Map<string, OutlineNode>(), parents = new Map<string, string>();
  const occurrences = new Map<string, number>(), expandable = new Set<string>();
  for (const item of headings) {
    const depth = item.hierarchyDepth ?? item.level;
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const signature = JSON.stringify([depth, item.text]);
    const occurrence = occurrences.get(signature) ?? 0;
    occurrences.set(signature, occurrence + 1);
    // Positions change during typing. Names + occurrence preserve groups when
    // ordinary body edits shift all following ProseMirror positions.
    const key = `${signature}:${occurrence}`;
    const node: OutlineNode = { item, key, depth, children: [] };
    const parent = stack[stack.length - 1];
    if (parent) { parent.children.push(node); parents.set(item.id, parent.item.id); expandable.add(parent.key); }
    else roots.push(node);
    nodes.set(item.id, node); stack.push(node);
  }
  const defaults = headings.length > 100 ? new Set(expandable) : new Set<string>();
  // A single document-title spine should not conceal the whole chapter list.
  let spine = roots;
  while (spine.length === 1) { defaults.delete(spine[0].key); spine = spine[0].children; }
  return { roots, nodes, parents, expandable, defaults };
}

export function outlineAncestors(model: OutlineModel, id: string): string[] {
  const keys: string[] = [];
  let parent = model.parents.get(id);
  while (parent) { keys.push(model.nodes.get(parent)!.key); parent = model.parents.get(parent); }
  return keys;
}

export function visibleOutlineNodes(model: OutlineModel, collapsed: Set<string>) {
  const visible: { node: OutlineNode; depth: number }[] = [];
  const visit = (nodes: OutlineNode[], depth: number) => {
    for (const node of nodes) {
      visible.push({ node, depth });
      if (!collapsed.has(node.key)) visit(node.children, depth + 1);
    }
  };
  visit(model.roots, 0);
  return visible;
}

export function headingBeforeOffset<T extends { id: string; offset: number }>(items: T[], offset: number): string {
  if (!items.length) return "";
  let low = 0, high = items.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (items[middle].offset <= offset) low = middle;
    else high = middle - 1;
  }
  return items[low].id;
}
