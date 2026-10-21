import { useEffect, useRef } from "react";
import { ChevronRight, ChevronsLeft, ListTree } from "lucide-react";
import type { HeadingGroups } from "../hooks/useHeadingGroups";
import type { OutlineHeading as HeadingItem } from "../utils/outlineNavigation";
import { headingLabel } from "../utils/headingNumbering";
import "./chapter-navigation.css";

export default function OutlinePanel({
  headings,
  activeId,
  onHeadingClick,
  onClose,
  groups,
}: {
  headings: HeadingItem[];
  activeId: string;
  onHeadingClick: (id: string) => void;
  onClose?: () => void;
  groups: HeadingGroups;
}) {
  const visibleHeadings = groups.rows;
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = listRef.current;
    if (!list || list.contains(document.activeElement)) return;
    const active = list.querySelector<HTMLElement>('[aria-current="location"]');
    if (!active) return;
    const row = active.getBoundingClientRect(), box = list.getBoundingClientRect();
    if (row.top < box.top) list.scrollTop -= box.top - row.top;
    else if (row.bottom > box.bottom) list.scrollTop += row.bottom - box.bottom;
  }, [activeId, groups.rows]);

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
        {headings.length > 100 && groups.model.expandable.size > 0 && <div className="outline-group-tools ml-auto flex gap-2 text-[11px] text-jelly-text-muted">
          <button type="button" onClick={groups.expandAll}>展开全部</button>
          <button type="button" onClick={groups.collapseGroups}>收起分组</button>
        </div>}
      </div>

      {/* Heading list */}
      {headings.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-4 pb-8">
          <p className="text-[12px] text-jelly-text-muted">暂无标题</p>
        </div>
      ) : (
        <div ref={listRef} className="flex-1 overflow-y-auto px-2 py-3">
          {visibleHeadings.map(({ node, depth }) => {
            const h = node.item;
            const hasChildren = node.children.length > 0;
            const collapsed = groups.collapsed.has(node.key);
            return (
              <div key={h.id} className="flex min-w-0 items-center">
                <button
                  type="button"
                  className={`document-outline-toggle flex h-7 w-5 shrink-0 items-center justify-center rounded-md transition-colors ${
                    hasChildren
                      ? "text-jelly-text-muted hover:bg-jelly-blue-pale hover:text-jelly-blue-deep"
                      : "cursor-default text-transparent"
                  }`}
                  style={{ marginLeft: `${depth * 18}px` }}
                  onClick={() => {
                    if (hasChildren) groups.toggle(node.key);
                  }}
                  disabled={!hasChildren}
                  aria-expanded={hasChildren ? !collapsed : undefined}
                  aria-label={`${collapsed ? "展开" : "收起"}小节：${h.text}`}
                  title={collapsed ? "展开小节" : "收起小节"}
                >
                  <ChevronRight
                    size={13}
                    strokeWidth={1.9}
                    className={`transition-transform ${hasChildren && !collapsed ? "rotate-90" : ""}`}
                  />
                </button>
                <button
                  type="button"
                  data-heading-id={h.id}
                  aria-label={headingLabel(h)}
                  aria-current={activeId === h.id ? "location" : undefined}
                  className={`document-outline-heading
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
