import { useEffect, useMemo, useState } from "react";
import { ChevronRight, ChevronsLeft, ListTree } from "lucide-react";

interface HeadingItem {
  level: number;
  text: string;
  id: string;
  displayNumber?: string;
  hierarchyDepth?: number;
}

interface HeadingNode {
  item: HeadingItem;
  children: HeadingNode[];
}

interface VisibleHeading {
  node: HeadingNode;
  depth: number;
}

function buildHeadingTree(headings: HeadingItem[]): HeadingNode[] {
  const roots: HeadingNode[] = [];
  const stack: HeadingNode[] = [];

  headings.forEach((heading) => {
    const node: HeadingNode = { item: heading, children: [] };
    const headingDepth = heading.hierarchyDepth ?? heading.level;

    while (
      stack.length > 0 &&
      (stack[stack.length - 1].item.hierarchyDepth ?? stack[stack.length - 1].item.level) >=
        headingDepth
    ) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
    stack.push(node);
  });

  return roots;
}

function flattenVisibleHeadings(
  nodes: HeadingNode[],
  collapsedIds: Set<string>,
  depth = 0
): VisibleHeading[] {
  return nodes.flatMap((node) => {
    const current = { node, depth };
    if (collapsedIds.has(node.item.id)) return [current];
    return [
      current,
      ...flattenVisibleHeadings(node.children, collapsedIds, depth + 1),
    ];
  });
}

function collectExpandableIds(nodes: HeadingNode[], ids = new Set<string>()): Set<string> {
  nodes.forEach((node) => {
    if (node.children.length > 0) ids.add(node.item.id);
    collectExpandableIds(node.children, ids);
  });
  return ids;
}

function collectParentIds(nodes: HeadingNode[], parentId = ""): Map<string, string> {
  const parents = new Map<string, string>();
  nodes.forEach((node) => {
    if (parentId) parents.set(node.item.id, parentId);
    collectParentIds(node.children, node.item.id).forEach((value, key) => {
      parents.set(key, value);
    });
  });
  return parents;
}

function getAncestorIds(id: string, parents: Map<string, string>): string[] {
  const ancestors: string[] = [];
  let current = parents.get(id);
  while (current) {
    ancestors.push(current);
    current = parents.get(current);
  }
  return ancestors;
}

export default function OutlinePanel({
  headings,
  activeId,
  onHeadingClick,
  onClose,
}: {
  headings: HeadingItem[];
  activeId: string;
  onHeadingClick: (id: string) => void;
  onClose?: () => void;
}) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const headingTree = useMemo(() => buildHeadingTree(headings), [headings]);
  const expandableIds = useMemo(() => collectExpandableIds(headingTree), [headingTree]);
  const parentIds = useMemo(() => collectParentIds(headingTree), [headingTree]);
  const visibleHeadings = useMemo(
    () => flattenVisibleHeadings(headingTree, collapsedIds),
    [collapsedIds, headingTree]
  );

  useEffect(() => {
    setCollapsedIds((current) => {
      const next = new Set<string>();
      current.forEach((id) => {
        if (expandableIds.has(id)) next.add(id);
      });
      return next.size === current.size ? current : next;
    });
  }, [expandableIds]);

  useEffect(() => {
    if (!activeId) return;
    const ancestors = getAncestorIds(activeId, parentIds);
    if (ancestors.length === 0) return;
    setCollapsedIds((current) => {
      let changed = false;
      const next = new Set(current);
      ancestors.forEach((id) => {
        if (next.delete(id)) changed = true;
      });
      return changed ? next : current;
    });
  }, [activeId, parentIds]);

  const toggleHeading = (id: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col bg-jelly-surface">
      {/* Header */}
      <div className="flex items-center border-b border-jelly-border px-3 py-3">
        {onClose && (
          <button
            className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-jelly-text transition-colors hover:bg-jelly-blue-pale hover:text-jelly-blue-deep"
            onClick={onClose}
            title="收起目录"
            aria-label="收起目录"
          >
            <ChevronsLeft size={14} strokeWidth={2} className="shrink-0" />
            <span className="truncate text-[13px] font-semibold">目录</span>
          </button>
        )}
        {!onClose && (
          <div className="flex min-w-0 items-center gap-2">
            <ListTree size={14} className="shrink-0 text-jelly-blue-deep" strokeWidth={1.8} />
            <span className="truncate text-[13px] font-semibold text-jelly-text">
              目录
            </span>
          </div>
        )}
      </div>

      {/* Heading list */}
      {headings.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-4 pb-8">
          <p className="text-[12px] text-jelly-text-muted">暂无标题</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-2 py-3">
          {visibleHeadings.map(({ node, depth }) => {
            const h = node.item;
            const hasChildren = node.children.length > 0;
            const collapsed = collapsedIds.has(h.id);
            return (
              <div key={h.id} className="flex min-w-0 items-center">
                <button
                  type="button"
                  className={`flex h-7 w-5 shrink-0 items-center justify-center rounded-md transition-colors ${
                    hasChildren
                      ? "text-jelly-text-muted hover:bg-jelly-blue-pale hover:text-jelly-blue-deep"
                      : "cursor-default text-transparent"
                  }`}
                  style={{ marginLeft: `${depth * 18}px` }}
                  onClick={() => {
                    if (hasChildren) toggleHeading(h.id);
                  }}
                  aria-label={collapsed ? "展开小节" : "收起小节"}
                  title={collapsed ? "展开小节" : "收起小节"}
                >
                  <ChevronRight
                    size={13}
                    strokeWidth={1.9}
                    className={`transition-transform ${hasChildren && !collapsed ? "rotate-90" : ""}`}
                  />
                </button>
                <button
                  className={`
                    min-w-0 flex-1 truncate rounded-md border-l-[3px] py-1.5 pr-2 text-left transition-colors duration-100
                    ${
                      activeId === h.id
                        ? "border-l-jelly-blue bg-jelly-blue-pale font-medium text-jelly-blue-deep"
                        : "border-l-transparent text-jelly-text-soft hover:bg-jelly-blue-pale hover:text-jelly-text"
                    }
                  `}
                  style={{
                    paddingLeft: "7px",
                    fontSize: depth === 0 ? "13px" : depth === 1 ? "12px" : "11.5px",
                    fontWeight: depth === 0 ? 590 : 450,
                  }}
                  onClick={() => onHeadingClick(h.id)}
                >
                  {h.displayNumber && (
                    <span className="mr-1.5 tabular-nums text-jelly-text-muted" aria-hidden="true">
                      {h.displayNumber}
                    </span>
                  )}
                  {h.text}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
