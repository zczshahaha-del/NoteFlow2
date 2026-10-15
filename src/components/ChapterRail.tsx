import { useEffect, useRef, type CSSProperties } from "react";
import { ChevronRight } from "lucide-react";
import type { HeadingGroups } from "../hooks/useHeadingGroups";
import type { OutlineHeading } from "../utils/outlineNavigation";
import "./chapter-navigation.css";

export default function ChapterRail({ headings, activeId, onHeadingClick, groups }: {
  headings: OutlineHeading[]; activeId: string; onHeadingClick: (id: string) => void; groups: HeadingGroups;
}) {
  const navRef = useRef<HTMLElement>(null);
  const grouped = headings.length > 100 && groups.model.expandable.size > 0;
  const rows = grouped ? groups.rows : headings.map(item => ({ node: { item, key: item.id, children: [] }, depth: item.hierarchyDepth ?? 0 }));
  const revealActive = () => {
    const nav = navRef.current;
    if (!nav || nav.matches(":hover") || nav.querySelector(":focus-visible")) return;
    const track = nav.querySelector<HTMLElement>(".chapter-rail-track");
    const active = nav.querySelector<HTMLElement>('[aria-current="location"]');
    if (!track || !active) return;
    const row = active.getBoundingClientRect(), box = track.getBoundingClientRect();
    if (row.top < box.top) track.scrollTop -= box.top - row.top;
    else if (row.bottom > box.bottom) track.scrollTop += row.bottom - box.bottom;
  };
  useEffect(() => { revealActive(); }, [activeId, groups.rows]);
  return <nav ref={navRef} className="chapter-rail" aria-label="章节快速导航" data-grouped={grouped}>
    {grouped && <div className="chapter-rail-tools">
      <button type="button" onClick={groups.expandAll}>展开全部</button>
      <button type="button" onClick={groups.collapseGroups}>收起分组</button>
    </div>}
    <div className="chapter-rail-track">
      {rows.map(({ node, depth }) => {
        const heading = node.item;
        const expandable = grouped && node.children.length > 0;
        const label = `${heading.displayNumber ? `${heading.displayNumber} ` : ""}${heading.text}`;
        const item = <button type="button" className={`chapter-rail-item ${activeId === heading.id ? "is-active" : ""}`}
          data-heading-id={heading.id} aria-current={activeId === heading.id ? "location" : undefined}
          onClick={() => onHeadingClick(heading.id)} title={label}
          style={{ "--chapter-indent": `${Math.min(depth, 3) * 12}px` } as CSSProperties}>
          <span className="chapter-rail-mark" aria-hidden="true" />
          <span className="chapter-rail-label">{label}</span>
        </button>;
        return expandable ? <div key={heading.id} className="chapter-rail-row" style={{ "--chapter-indent": `${Math.min(depth, 3) * 12}px` } as CSSProperties}>
          {item}
          <button type="button" className="chapter-rail-group-toggle" aria-expanded={!groups.collapsed.has(node.key)}
            aria-label={`${groups.collapsed.has(node.key) ? "展开" : "收起"}小节：${heading.text}`} onClick={() => groups.toggle(node.key)}>
            <ChevronRight size={12} aria-hidden="true" />
          </button>
        </div> : <div key={heading.id} className="chapter-rail-row">{item}</div>;
      })}
    </div>
  </nav>;
}
